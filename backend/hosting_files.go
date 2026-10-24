package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

const (
	hostingSourceCompressedLimit   = int64(256 * 1024 * 1024)
	hostingSourceUncompressedLimit = int64(1024 * 1024 * 1024)
	hostingEditorLimit             = 2 * 1024 * 1024
	hostingFileCountLimit          = 10_000
)

type sourceFile struct {
	Data  []byte
	IsDir bool
}

type sourceAccess struct {
	SiteID   int64
	PublicID string
	Role     string
}

func (s *server) hostingSourceAccess(c *fiber.Ctx, write bool) (sourceAccess, error) {
	actor := current(c)
	item, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return sourceAccess{}, fiber.NewError(fiber.StatusNotFound, "ไม่พบเว็บไซต์")
	}
	if err != nil {
		return sourceAccess{}, fiber.NewError(fiber.StatusInternalServerError)
	}
	if write && item.AccessRole == "viewer" {
		return sourceAccess{}, fiber.NewError(fiber.StatusForbidden, "บัญชีนี้ดูไฟล์ได้อย่างเดียว")
	}
	var siteID int64
	if err := s.db.QueryRow(c.Context(), `SELECT id FROM hosting_sites WHERE public_id=$1 AND deleted_at IS NULL`, item.ID).Scan(&siteID); err != nil {
		return sourceAccess{}, fiber.NewError(fiber.StatusNotFound, "ไม่พบเว็บไซต์")
	}
	return sourceAccess{SiteID: siteID, PublicID: item.ID, Role: item.AccessRole}, nil
}

func (s *server) latestHostingSourceKey(ctx context.Context, siteID int64) (string, error) {
	var key string
	err := s.db.QueryRow(ctx, `
		SELECT metadata->>'deploymentKey'
		FROM hosting_operations
		WHERE site_id=$1 AND metadata ? 'deploymentKey'
		ORDER BY id DESC LIMIT 1
	`, siteID).Scan(&key)
	if err != nil {
		return "", err
	}
	prefix := fmt.Sprintf("deployments/%d/", siteID)
	if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(strings.ToLower(key), ".zip") {
		return "", errors.New("invalid source archive")
	}
	return key, nil
}

// hostingSourceSlots bounds how many source archives are inflated into memory at once. One
// archive can inflate to 1 GiB, and the API process is shared by every tenant.
var hostingSourceSlots = make(chan struct{}, 3)

func (s *server) loadHostingSource(ctx context.Context, siteID int64) (map[string]sourceFile, error) {
	select {
	case hostingSourceSlots <- struct{}{}:
		defer func() { <-hostingSourceSlots }()
	case <-time.After(15 * time.Second):
		return nil, errors.New("source archives are busy, try again")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	key, err := s.latestHostingSourceKey(ctx, siteID)
	if err != nil {
		return nil, err
	}
	object, err := s.storage.GetObject(ctx, s.cfg.s3Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()
	stat, err := object.Stat()
	if err != nil || stat.Size <= 0 || stat.Size > hostingSourceCompressedLimit {
		return nil, errors.New("source archive unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(object, hostingSourceCompressedLimit+1))
	if err != nil || int64(len(data)) > hostingSourceCompressedLimit {
		return nil, errors.New("source archive is too large")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(reader.File) > hostingFileCountLimit {
		return nil, errors.New("invalid source archive")
	}
	files := make(map[string]sourceFile, len(reader.File))
	var total int64
	for _, entry := range reader.File {
		name, valid := canonicalWorkspacePath(entry.Name, true)
		if !valid || name == "" {
			return nil, errors.New("unsafe source path")
		}
		mode := entry.Mode()
		if mode&(^mode.Perm()) != 0 && !entry.FileInfo().IsDir() {
			return nil, errors.New("unsupported source file type")
		}
		if _, duplicate := files[name]; duplicate {
			return nil, errors.New("duplicate source path")
		}
		if entry.FileInfo().IsDir() {
			files[name] = sourceFile{IsDir: true}
			continue
		}
		size, sizeOK := checkedWorkspaceArchiveSize(entry.UncompressedSize64, hostingSourceUncompressedLimit-total)
		if !sizeOK {
			return nil, errors.New("source archive exceeds quota")
		}
		total += size
		file, err := entry.Open()
		if err != nil {
			return nil, err
		}
		content, readErr := io.ReadAll(io.LimitReader(file, hostingSourceUncompressedLimit+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil {
			return nil, errors.New("cannot read source file")
		}
		files[name] = sourceFile{Data: content}
	}
	return flattenCommonSourceRoot(files), nil
}

// workspaceExtractLimit caps the total bytes one Unzip in the file manager may write.
const workspaceExtractLimit = int64(50 * 1024 * 1024)

// checkedWorkspaceArchiveSize turns a zip entry's declared size into an int64 only when it
// fits in what is left of the limit. Zip headers are attacker-supplied: a size above
// MaxInt64 would turn negative when converted, so it is compared as uint64 first.
func checkedWorkspaceArchiveSize(size uint64, remaining int64) (int64, bool) {
	if remaining < 0 || size > uint64(remaining) {
		return 0, false
	}
	return int64(size), true
}

func (s *server) listHostingFiles(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, false)
	if err != nil {
		return err
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(fiber.Map{"path": "", "items": []fiber.Map{}})
	}
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มีไฟล์เว็บไซต์", Code: "source_missing"})
	}
	directory, ok := canonicalWorkspacePath(c.Query("path"), false)
	if !ok || blockedWorkspacePath(directory) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตำแหน่งไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	prefix := ""
	if directory != "" {
		prefix = directory + "/"
	}
	items := map[string]fiber.Map{}
	for name, file := range files {
		if !strings.HasPrefix(name, prefix) || name == directory {
			continue
		}
		relative := strings.TrimPrefix(name, prefix)
		first := strings.SplitN(relative, "/", 2)[0]
		childPath := strings.TrimPrefix(prefix+first, "/")
		isDir := file.IsDir || strings.Contains(relative, "/")
		size := len(file.Data)
		if existing, found := items[first]; found {
			if isDir {
				existing["type"] = "directory"
				existing["size"] = 0
			}
			continue
		}
		itemType := "file"
		if isDir {
			itemType = "directory"
			size = 0
		}
		items[first] = fiber.Map{"name": first, "path": childPath, "type": itemType, "size": size}
	}
	result := make([]fiber.Map, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		leftDir := result[i]["type"] == "directory"
		rightDir := result[j]["type"] == "directory"
		if leftDir != rightDir {
			return leftDir
		}
		return strings.ToLower(result[i]["name"].(string)) < strings.ToLower(result[j]["name"].(string))
	})
	return c.JSON(fiber.Map{"path": directory, "items": result})
}

func (s *server) readHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, false)
	if err != nil {
		return err
	}
	name, ok := editableWorkspacePath(c.Query("path"))
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตำแหน่งไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มีไฟล์เว็บไซต์", Code: "source_missing"})
	}
	file, found := files[name]
	if !found || file.IsDir {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if len(file.Data) > hostingEditorLimit || !utf8.Valid(file.Data) || bytes.IndexByte(file.Data, 0) >= 0 {
		return c.Status(fiber.StatusUnsupportedMediaType).JSON(apiError{Error: "ไฟล์นี้เปิดใน Code Editor ไม่ได้", Code: "not_editable"})
	}
	return c.JSON(fiber.Map{"path": name, "content": string(file.Data), "size": len(file.Data)})
}

func (s *server) downloadHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, false)
	if err != nil {
		return err
	}
	name, ok := canonicalWorkspacePath(c.Query("path"), false)
	if !ok || name == "" || blockedWorkspacePath(name) {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	file, found := files[name]
	if !found || file.IsDir {
		return c.SendStatus(fiber.StatusNotFound)
	}
	c.Set(fiber.HeaderContentType, "application/octet-stream")
	c.Set(fiber.HeaderContentDisposition, `attachment; filename*=UTF-8''`+url.PathEscape(path.Base(name)))
	return c.Send(file.Data)
}

func (s *server) previewHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, false)
	if err != nil {
		return err
	}
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if c.BodyParser(&body) != nil || len(body.Content) > hostingEditorLimit {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	name, ok := editableWorkspacePath(body.Path)
	if !ok {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	old := ""
	if file, found := files[name]; found && !file.IsDir {
		if !utf8.Valid(file.Data) || len(file.Data) > hostingEditorLimit {
			return c.SendStatus(fiber.StatusUnsupportedMediaType)
		}
		old = string(file.Data)
	}
	return c.JSON(simpleDiff(old, body.Content))
}

func (s *server) saveHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if c.BodyParser(&body) != nil || len(body.Content) > hostingEditorLimit {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์มีขนาดใหญ่เกินกำหนด", Code: "file_too_large"})
	}
	name, ok := editableWorkspacePath(body.Path)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตำแหน่งไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มี Source archive", Code: "source_missing"})
	}
	if files == nil {
		files = map[string]sourceFile{}
	}
	files[name] = sourceFile{Data: []byte(body.Content)}
	return s.publishHostingSource(c, access, files, "hosting.file.saved", c.Body())
}

func (s *server) uploadHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	header, err := c.FormFile("file")
	if err != nil || header.Size <= 0 || header.Size > 20*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์ขนาดไม่เกิน 20MB", Code: "invalid_file"})
	}
	directory, ok := canonicalWorkspacePath(c.FormValue("path"), false)
	name := path.Base(strings.ReplaceAll(header.Filename, `\`, "/"))
	target, targetOK := canonicalWorkspacePath(strings.TrimPrefix(directory+"/"+name, "/"), false)
	if !ok || !targetOK || target == "" || blockedWorkspacePath(target) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อหรือตำแหน่งไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	source, err := header.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest)
	}
	defer source.Close()
	content, err := io.ReadAll(io.LimitReader(source, 20*1024*1024+1))
	if err != nil || len(content) > 20*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์มีขนาดใหญ่เกินกำหนด", Code: "file_too_large"})
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มี Source archive", Code: "source_missing"})
	}
	files[target] = sourceFile{Data: content}
	return s.publishHostingSource(c, access, files, "hosting.file.uploaded", append([]byte(target+"\n"), content...))
}

func (s *server) createHostingFolder(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	var body struct {
		Path string `json:"path"`
	}
	if c.BodyParser(&body) != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	name, ok := canonicalWorkspacePath(body.Path, false)
	if !ok || name == "" || blockedWorkspacePath(name) {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มี Source archive", Code: "source_missing"})
	}
	if _, exists := files[name]; exists {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีไฟล์หรือโฟลเดอร์ชื่อนี้แล้ว", Code: "path_exists"})
	}
	files[name] = sourceFile{IsDir: true}
	return s.publishHostingSource(c, access, files, "hosting.folder.created", c.Body())
}

func (s *server) moveHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if c.BodyParser(&body) != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	from, fromOK := canonicalWorkspacePath(body.From, false)
	to, toOK := canonicalWorkspacePath(body.To, false)
	if !fromOK || !toOK || from == "" || to == "" || blockedWorkspacePath(from) || blockedWorkspacePath(to) ||
		strings.HasPrefix(to+"/", from+"/") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตำแหน่งต้นทางหรือปลายทางไม่ถูกต้อง", Code: "invalid_path"})
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	if _, exists := files[to]; exists {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ปลายทางมีอยู่แล้ว", Code: "path_exists"})
	}
	changed := false
	next := make(map[string]sourceFile, len(files))
	for name, file := range files {
		if name == from || strings.HasPrefix(name, from+"/") {
			next[to+strings.TrimPrefix(name, from)] = file
			changed = true
		} else {
			next[name] = file
		}
	}
	if !changed {
		return c.SendStatus(fiber.StatusNotFound)
	}
	return s.publishHostingSource(c, access, next, "hosting.file.moved", c.Body())
}

func (s *server) archiveHostingFiles(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	var body struct {
		Paths  []string `json:"paths"`
		Target string   `json:"target"`
	}
	if c.BodyParser(&body) != nil || len(body.Paths) == 0 || len(body.Paths) > 500 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	target, ok := canonicalWorkspacePath(body.Target, false)
	if !ok || target == "" || blockedWorkspacePath(target) || !strings.HasSuffix(strings.ToLower(target), ".zip") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อไฟล์ Archive ต้องลงท้ายด้วย .zip", Code: "invalid_path"})
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	selected := map[string]sourceFile{}
	for _, requested := range body.Paths {
		name, valid := canonicalWorkspacePath(requested, false)
		if !valid || name == "" || blockedWorkspacePath(name) {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		for fileName, file := range files {
			if fileName == name || strings.HasPrefix(fileName, name+"/") {
				selected[fileName] = file
			}
		}
	}
	if len(selected) == 0 {
		return c.SendStatus(fiber.StatusNotFound)
	}
	archive, err := buildHostingSourceZip(selected)
	if err != nil || len(archive) > 20*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถสร้าง Archive ได้", Code: "archive_failed"})
	}
	files[target] = sourceFile{Data: archive}
	return s.publishHostingSource(c, access, files, "hosting.files.archived", c.Body())
}

func (s *server) extractHostingArchive(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	var body struct {
		Path   string `json:"path"`
		Target string `json:"target"`
	}
	if c.BodyParser(&body) != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	archivePath, archiveOK := canonicalWorkspacePath(body.Path, false)
	target, targetOK := canonicalWorkspacePath(body.Target, false)
	if !archiveOK || !targetOK || archivePath == "" || blockedWorkspacePath(archivePath) || blockedWorkspacePath(target) ||
		!strings.HasSuffix(strings.ToLower(archivePath), ".zip") {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	archive, found := files[archivePath]
	if !found || archive.IsDir || len(archive.Data) > 20*1024*1024 {
		return c.SendStatus(fiber.StatusNotFound)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive.Data), int64(len(archive.Data)))
	if err != nil || len(reader.File) > 2_000 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Archive ไม่ถูกต้อง", Code: "invalid_archive"})
	}
	var extracted int64
	for _, entry := range reader.File {
		relative, valid := canonicalWorkspacePath(entry.Name, true)
		finalPath, finalOK := canonicalWorkspacePath(strings.TrimPrefix(target+"/"+relative, "/"), false)
		if !valid || !finalOK || relative == "" || blockedWorkspacePath(finalPath) || entry.Mode()&(^entry.Mode().Perm()) != 0 && !entry.FileInfo().IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Archive มีตำแหน่งไฟล์ไม่ปลอดภัย", Code: "unsafe_archive"})
		}
		if entry.FileInfo().IsDir() {
			files[finalPath] = sourceFile{IsDir: true}
			continue
		}
		// The declared size comes from the archive, so it is checked before it is added: a
		// huge value would otherwise wrap the int64 total negative and skip the limit.
		size, sizeOK := checkedWorkspaceArchiveSize(entry.UncompressedSize64, workspaceExtractLimit-extracted)
		if !sizeOK {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลใน Archive มีขนาดใหญ่เกินกำหนด", Code: "archive_too_large"})
		}
		source, openErr := entry.Open()
		if openErr != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		content, readErr := io.ReadAll(io.LimitReader(source, size+1))
		source.Close()
		if readErr != nil || int64(len(content)) > size {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		extracted += int64(len(content))
		files[finalPath] = sourceFile{Data: content}
	}
	return s.publishHostingSource(c, access, files, "hosting.files.extracted", c.Body())
}

func (s *server) deleteHostingFile(c *fiber.Ctx) error {
	access, err := s.hostingSourceAccess(c, true)
	if err != nil {
		return err
	}
	name, ok := canonicalWorkspacePath(c.Query("path"), false)
	if !ok || name == "" || blockedWorkspacePath(name) {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	files, err := s.loadHostingSource(c.Context(), access.SiteID)
	if err != nil {
		return c.SendStatus(fiber.StatusConflict)
	}
	changed := false
	for fileName := range files {
		if fileName == name || strings.HasPrefix(fileName, name+"/") {
			delete(files, fileName)
			changed = true
		}
	}
	if !changed {
		return c.SendStatus(fiber.StatusNotFound)
	}
	return s.publishHostingSource(c, access, files, "hosting.file.deleted", []byte(name))
}

func (s *server) publishHostingSource(c *fiber.Ctx, access sourceAccess, files map[string]sourceFile, action string, requestBody []byte) error {
	actor := current(c)
	idempotencyKey, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key", Code: "invalid_idempotency_key"})
	}
	if len(files) == 0 || len(files) > hostingFileCountLimit {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนไฟล์ไม่ถูกต้อง", Code: "invalid_file_count"})
	}
	archive, err := buildHostingSourceZip(files)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถสร้าง Source archive ได้", Code: "invalid_source"})
	}
	objectKey := fmt.Sprintf("deployments/%d/%s.zip", access.SiteID, randomSourceKey())
	if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, objectKey, bytes.NewReader(archive), int64(len(archive)), minio.PutObjectOptions{ContentType: "application/zip"}); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "ไม่สามารถบันทึกไฟล์ได้")
	}
	cleanupObject := true
	defer func() {
		if cleanupObject {
			_ = s.storage.RemoveObject(context.Background(), s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{})
		}
	}()

	hash := requestDigest(action, requestBody)
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, idempotencyKey, hash, "runtime.redeploy"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		cleanupObject = true
		if existingID != access.PublicID {
			return c.SendStatus(fiber.StatusConflict)
		}
		return c.JSON(fiber.Map{"replayed": true})
	}
	locked, err := lockHostingSite(c.Context(), tx, actor, access.PublicID)
	if err != nil || locked.AccessRole == "viewer" {
		return c.SendStatus(fiber.StatusForbidden)
	}
	if err := enqueueHostingDeployOperation(c.Context(), tx, access.SiteID, actor.ID, idempotencyKey, hash, access.PublicID, objectKey); err != nil {
		return hostingConflict(c, err)
	}
	if _, err := tx.Exec(c.Context(), `UPDATE hosting_sites SET status='provisioning',health_status='starting',updated_at=NOW() WHERE id=$1`, access.SiteID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	cleanupObject = false
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: action, Target: "hosting_site", TargetID: access.PublicID})
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"queued": true})
}

func buildHostingSourceZip(files map[string]sourceFile) ([]byte, error) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	names := make([]string, 0, len(files))
	var total int64
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		file := files[name]
		canonical, ok := canonicalWorkspacePath(name, false)
		if !ok || canonical == "" || blockedWorkspacePath(canonical) {
			return nil, errors.New("unsafe workspace path")
		}
		entryName := canonical
		if file.IsDir {
			entryName += "/"
		}
		header := &zip.FileHeader{Name: entryName, Method: zip.Deflate}
		if file.IsDir {
			header.SetMode(0o755 | ioModeDir)
		} else {
			header.SetMode(0o644)
			total += int64(len(file.Data))
			if total > hostingSourceUncompressedLimit {
				return nil, errors.New("source exceeds quota")
			}
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if !file.IsDir {
			if _, err := entry.Write(file.Data); err != nil {
				return nil, err
			}
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	if int64(output.Len()) > hostingSourceCompressedLimit {
		return nil, errors.New("compressed source exceeds quota")
	}
	return output.Bytes(), nil
}

// os.ModeDir without importing the complete filesystem API into handler logic.
const ioModeDir = 1 << 31

func canonicalWorkspacePath(value string, allowTrailingSlash bool) (string, bool) {
	value = strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	if value == "" {
		return "", true
	}
	if strings.HasPrefix(value, "/") || strings.ContainsRune(value, '\x00') {
		return "", false
	}
	clean := path.Clean(value)
	if clean == "." {
		return "", true
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || len(clean) > 512 {
		return "", false
	}
	if !allowTrailingSlash {
		clean = strings.TrimSuffix(clean, "/")
	}
	return clean, true
}

func editableWorkspacePath(value string) (string, bool) {
	name, ok := canonicalWorkspacePath(value, false)
	if !ok || name == "" || blockedWorkspacePath(name) {
		return "", false
	}
	return name, true
}

func blockedWorkspacePath(value string) bool {
	value = strings.ToLower(strings.TrimPrefix(value, "./"))
	base := path.Base(value)
	return strings.HasPrefix(value, ".git/") || value == ".git" ||
		base == ".env" || strings.HasPrefix(base, ".env.") ||
		base == "dockerfile" || base == "docker-compose.yml" || base == "compose.yml"
}

func flattenCommonSourceRoot(files map[string]sourceFile) map[string]sourceFile {
	root := ""
	for name := range files {
		parts := strings.Split(name, "/")
		if len(parts) < 2 {
			if file := files[name]; file.IsDir {
				if root == "" {
					root = name
				}
				continue
			}
			return files
		}
		if root == "" {
			root = parts[0]
		} else if root != parts[0] {
			return files
		}
	}
	if root == "" {
		return files
	}
	result := make(map[string]sourceFile, len(files))
	prefix := root + "/"
	for name, file := range files {
		if name == root && file.IsDir {
			continue
		}
		result[strings.TrimPrefix(name, prefix)] = file
	}
	return result
}

func simpleDiff(oldValue, newValue string) fiber.Map {
	oldLines := strings.Split(oldValue, "\n")
	newLines := strings.Split(newValue, "\n")
	prefix := 0
	for prefix < len(oldLines) && prefix < len(newLines) && oldLines[prefix] == newLines[prefix] {
		prefix++
	}
	oldEnd, newEnd := len(oldLines), len(newLines)
	for oldEnd > prefix && newEnd > prefix && oldLines[oldEnd-1] == newLines[newEnd-1] {
		oldEnd--
		newEnd--
	}
	return fiber.Map{
		"changed":  oldValue != newValue,
		"oldLines": len(oldLines),
		"newLines": len(newLines),
		"hunks": []fiber.Map{{
			"oldStart": prefix + 1,
			"newStart": prefix + 1,
			"removed":  oldLines[prefix:oldEnd],
			"added":    newLines[prefix:newEnd],
		}},
	}
}

func randomSourceKey() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buffer)
}
