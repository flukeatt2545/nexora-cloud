package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

const (
	userFileMaxBytes   int64 = 50 * 1024 * 1024
	userFileQuotaBytes int64 = 500 * 1024 * 1024
)

type userFileItem struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	ContentType     string     `json:"contentType"`
	Size            int64      `json:"size"`
	OwnerID         int64      `json:"ownerId,omitempty"`
	Owner           string     `json:"owner,omitempty"`
	IsOwner         bool       `json:"isOwner"`
	CategoryID      *int       `json:"categoryId,omitempty"`
	CategoryName    string     `json:"categoryName,omitempty"`
	FolderID        *int       `json:"folderId,omitempty"`
	FolderName      string     `json:"folderName,omitempty"`
	IsVisible       bool       `json:"isVisible"`
	PasswordEnabled bool       `json:"passwordEnabled"`
	ShareEnabled    bool       `json:"shareEnabled"`
	ShareExpiresAt  *time.Time `json:"shareExpiresAt,omitempty"`
	ShareURL        string     `json:"shareUrl,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
}

func isUserFileAdmin(actor *currentUser) bool {
	return actor != nil && (actor.Role == "admin" || actor.Role == "superadmin")
}

func canReadUserFile(actor *currentUser, ownerID int64) bool {
	return actor != nil && (actor.ID == ownerID || isUserFileAdmin(actor))
}

type userFileFolder struct {
	ID              int        `json:"id"`
	CategoryID      int        `json:"categoryId"`
	CategoryName    string     `json:"categoryName,omitempty"`
	ParentID        *int       `json:"parentId"`
	OwnerUserID     *int64     `json:"ownerUserId,omitempty"`
	Name            string     `json:"name"`
	SortOrder       int        `json:"sortOrder"`
	IsVisible       bool       `json:"isVisible"`
	PasswordEnabled bool       `json:"passwordEnabled"`
	FileCount       int        `json:"fileCount"`
	HiddenFileCount int        `json:"hiddenFileCount,omitempty"`
	SubfolderCount  int        `json:"subfolderCount"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	ShareEnabled    bool       `json:"shareEnabled"`
	ShareExpiresAt  *time.Time `json:"shareExpiresAt,omitempty"`
	ShareURL        string     `json:"shareUrl,omitempty"`
}

type userFileFolderCreateRequest struct {
	ParentID        *int    `json:"parentId"`
	Name            string  `json:"name"`
	SortOrder       int     `json:"sortOrder"`
	IsVisible       *bool   `json:"isVisible"`
	PasswordEnabled bool    `json:"passwordEnabled"`
	Password        *string `json:"password"`
}

type userFileFolderUpdateRequest struct {
	ParentID        *int    `json:"parentId"`
	ClearParent     bool    `json:"clearParent"`
	Name            *string `json:"name"`
	SortOrder       *int    `json:"sortOrder"`
	IsVisible       *bool   `json:"isVisible"`
	PasswordEnabled *bool   `json:"passwordEnabled"`
	Password        *string `json:"password"`
}

type batchFolderRequest struct {
	IDs         []string `json:"ids"`
	FolderID    *int     `json:"folderId"`
	ClearFolder bool     `json:"clearFolder"`
}

type publicSharedFile struct {
	Name            string
	ContentType     string
	Size            int64
	ObjectKey       string
	PasswordEnabled bool
	PasswordHash    *string
	ExpiresAt       *time.Time
}

func publicUserFileSharePath(token string) string {
	return "/files/d/" + token
}

func parseShareExpiresIn(value string, now time.Time) (*time.Time, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1d":
		t := now.Add(24 * time.Hour)
		return &t, nil
	case "7d":
		t := now.Add(7 * 24 * time.Hour)
		return &t, nil
	case "30d":
		t := now.Add(30 * 24 * time.Hour)
		return &t, nil
	case "never":
		return nil, nil
	default:
		return nil, errors.New("อายุลิงก์ไม่ถูกต้อง")
	}
}

func shareLinkActive(enabled bool, token string, expiresAt *time.Time, now time.Time) bool {
	if !enabled || strings.TrimSpace(token) == "" {
		return false
	}
	if expiresAt != nil && !expiresAt.After(now) {
		return false
	}
	return true
}

func validShareToken(token string) bool {
	if len(token) != 32 {
		return false
	}
	for _, r := range token {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func attachShareState(item *userFileItem, enabled bool, token *string, expiresAt *time.Time) {
	item.ShareEnabled = enabled
	item.ShareExpiresAt = expiresAt
	tokenValue := ""
	if token != nil {
		tokenValue = strings.TrimSpace(*token)
	}
	if shareLinkActive(enabled, tokenValue, expiresAt, time.Now()) {
		item.ShareURL = publicUserFileSharePath(tokenValue)
	}
}

func (s *server) newShareToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

type userFileCategory struct {
	ID                  int        `json:"id"`
	OwnerUserID         *int64     `json:"ownerUserId,omitempty"`
	Owner               string     `json:"owner,omitempty"`
	IsOwner             bool       `json:"isOwner"`
	Name                string     `json:"name"`
	IsVisible           bool       `json:"isVisible"`
	PasswordEnabled     bool       `json:"passwordEnabled"`
	SortOrder           int        `json:"sortOrder"`
	FileCount           int        `json:"fileCount"`
	HiddenFileCount     int        `json:"hiddenFileCount,omitempty"`
	FolderCount         int        `json:"folderCount"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
	ShareEnabled        bool       `json:"shareEnabled"`
	ShareExpiresAt      *time.Time `json:"shareExpiresAt,omitempty"`
	ShareURL            string     `json:"shareUrl,omitempty"`
	ActiveShareCount    int        `json:"activeShareCount,omitempty"`
	AdminShareURL       string     `json:"adminShareUrl,omitempty"`
	AdminShareExpiresAt *time.Time `json:"adminShareExpiresAt,omitempty"`
}

type publicSharedCategory struct {
	CategoryID int
	OwnerID    int64
	IsAdmin    bool
	Name       string
	ExpiresAt  *time.Time
	// Set for a folder share: the shared folder, it and its visible subfolders,
	// and whether the shared folder itself asks for a password.
	RootFolderID *int
	FolderIDs    []int
	RootLocked   bool
}

type publicSharedCategoryFile struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	ContentType      string    `json:"contentType"`
	Size             int64     `json:"size"`
	FolderID         *int      `json:"folderId,omitempty"`
	PasswordRequired bool      `json:"passwordRequired"`
	CreatedAt        time.Time `json:"createdAt"`
}

type publicSharedCategoryFolder struct {
	ID               int       `json:"id"`
	ParentID         *int      `json:"parentId"`
	Name             string    `json:"name"`
	FileCount        int       `json:"fileCount"`
	SubfolderCount   int       `json:"subfolderCount"`
	PasswordRequired bool      `json:"passwordRequired"`
	CreatedAt        time.Time `json:"createdAt"`
}

func publicUserFileCategorySharePath(token string) string { return "/files/c/" + token }

func attachFolderShareState(item *userFileFolder, enabled bool, token *string, expiresAt *time.Time) {
	if token != nil && shareLinkActive(enabled, *token, expiresAt, time.Now()) {
		item.ShareEnabled, item.ShareExpiresAt = true, expiresAt
		item.ShareURL = publicUserFileCategorySharePath(*token)
		return
	}
	item.ShareEnabled, item.ShareExpiresAt, item.ShareURL = false, nil, ""
}

func attachCategoryShareState(item *userFileCategory, enabled bool, token *string, expiresAt *time.Time) {
	item.ShareEnabled, item.ShareExpiresAt = enabled, expiresAt
	if token != nil && shareLinkActive(enabled, *token, expiresAt, time.Now()) {
		item.ShareURL = publicUserFileCategorySharePath(*token)
	}
}

func normalizeDetectedContentType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		return strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	return strings.ToLower(mediaType)
}

func safeUserFileType(contentType, extension string, data []byte) bool {
	contentType = normalizeDetectedContentType(contentType)
	if blockedExtensions[extension] || contentType == "image/svg+xml" {
		return false
	}
	if len(data) >= 2 && ((data[0] == 'M' && data[1] == 'Z') || (data[0] == '#' && data[1] == '!')) {
		return false
	}
	if len(data) >= 4 && data[0] == 0x7f && data[1] == 'E' && data[2] == 'L' && data[3] == 'F' {
		return false
	}
	if contentType == "application/octet-stream" {
		allowedBinaryExtensions := map[string]bool{
			".docx": true, ".xlsx": true, ".pptx": true,
			".doc": true, ".xls": true, ".ppt": true,
			".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
			".zip": true, ".rar": true, ".7z": true, ".tar": true, ".gz": true,
		}
		return allowedBinaryExtensions[extension]
	}
	return allowedMIMETypes[contentType]
}

func splitDisplayName(name string) (base, ext string) {
	name = strings.TrimSpace(name)
	ext = strings.ToLower(path.Ext(name))
	base = strings.TrimSuffix(name, path.Ext(name))
	base = strings.TrimSpace(base)
	return base, ext
}

func lockedRenameDisplayName(currentName, requestedName string) (string, error) {
	_, currentExt := splitDisplayName(currentName)
	if currentExt == "" {
		currentExt = strings.ToLower(path.Ext(currentName))
	}
	requested := strings.TrimSpace(requestedName)
	if requested == "" {
		return "", errors.New("กรุณาระบุชื่อไฟล์")
	}
	if strings.ContainsAny(requested, `/\:*?"<>|`) || strings.Contains(requested, "..") {
		return "", errors.New("ชื่อไฟล์มีอักขระที่ไม่อนุญาต")
	}
	reqBase, reqExt := splitDisplayName(requested)
	if reqExt != "" && currentExt != "" && reqExt != currentExt {
		return "", errors.New("ไม่สามารถเปลี่ยนนามสกุลไฟล์ได้")
	}
	sanitizedBase, _ := sanitizeFilename(reqBase + currentExt)
	if sanitizedBase == "" || sanitizedBase == "file" {
		sanitizedBase = "file"
	}
	return sanitizedBase + currentExt, nil
}

func (s *server) listOwnUserFiles(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT f.public_id, f.original_name, f.content_type, f.size_bytes,
		       f.owner_user_id, COALESCE(u.identifier, ''),
		       CASE WHEN c.id IS NOT NULL THEN f.category_id ELSE NULL END, c.name,
		       CASE WHEN fo.id IS NOT NULL THEN f.folder_id ELSE NULL END, fo.name,
		       f.is_visible, f.password_hash IS NOT NULL,
		       f.share_enabled, f.share_token, f.share_expires_at, f.created_at
		FROM user_files f
		JOIN users u ON u.id = f.owner_user_id
		LEFT JOIN user_file_categories c ON c.id = f.category_id AND (c.owner_user_id = f.owner_user_id OR c.owner_user_id IS NULL)
		LEFT JOIN user_file_folders fo ON fo.id = f.folder_id AND fo.owner_user_id = f.owner_user_id
		WHERE f.deleted_at IS NULL
		  AND f.owner_user_id = $1
		ORDER BY f.created_at DESC
	`, actor.ID)
	if err != nil {
		log.Printf("[listOwnUserFiles] query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileItem, 0)
	var usedBytes int64
	for rows.Next() {
		var it userFileItem
		var ownerID int64
		var ownerIdent string
		var catName *string
		var folderName *string
		var shareEnabled bool
		var shareToken *string
		var shareExpiresAt *time.Time
		if err := rows.Scan(
			&it.ID, &it.Name, &it.ContentType, &it.Size,
			&ownerID, &ownerIdent,
			&it.CategoryID, &catName, &it.FolderID, &folderName, &it.IsVisible, &it.PasswordEnabled,
			&shareEnabled, &shareToken, &shareExpiresAt, &it.CreatedAt,
		); err != nil {
			log.Printf("[listOwnUserFiles] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if catName != nil {
			it.CategoryName = *catName
		}
		if folderName != nil {
			it.FolderName = *folderName
		}
		it.OwnerID = ownerID
		it.Owner = ownerIdent
		it.IsOwner = (ownerID == actor.ID)
		if !it.IsOwner {
			// Defense in depth: the personal endpoint must never return another
			// account's file even if its SQL scope is changed later.
			continue
		}
		attachShareState(&it, shareEnabled, shareToken, shareExpiresAt)
		if it.IsOwner {
			usedBytes += it.Size
		}
		items = append(items, it)
	}
	return c.JSON(fiber.Map{
		"items":        items,
		"usedBytes":    usedBytes,
		"quotaBytes":   userFileQuotaBytes,
		"maxFileBytes": userFileMaxBytes,
	})
}

func (s *server) listAllUserFiles(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT f.public_id, f.original_name, f.content_type, f.size_bytes,
		       f.owner_user_id, u.identifier, f.category_id, c.name,
		       f.folder_id, fo.name,
		       f.is_visible, f.password_hash IS NOT NULL,
		       f.share_enabled, f.share_token, f.share_expires_at, f.created_at
		FROM user_files f
		JOIN users u ON u.id = f.owner_user_id
		LEFT JOIN user_file_categories c ON c.id = f.category_id
		LEFT JOIN user_file_folders fo ON fo.id = f.folder_id
		WHERE f.deleted_at IS NULL
		ORDER BY f.created_at DESC
	`)
	if err != nil {
		log.Printf("[listAllUserFiles] query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileItem, 0)
	var usedBytes int64
	for rows.Next() {
		var it userFileItem
		var catName *string
		var folderName *string
		var shareEnabled bool
		var shareToken *string
		var shareExpiresAt *time.Time
		if err := rows.Scan(
			&it.ID, &it.Name, &it.ContentType, &it.Size,
			&it.OwnerID, &it.Owner, &it.CategoryID, &catName,
			&it.FolderID, &folderName,
			&it.IsVisible, &it.PasswordEnabled,
			&shareEnabled, &shareToken, &shareExpiresAt, &it.CreatedAt,
		); err != nil {
			log.Printf("[listAllUserFiles] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if catName != nil {
			it.CategoryName = *catName
		}
		if folderName != nil {
			it.FolderName = *folderName
		}
		attachShareState(&it, shareEnabled, shareToken, shareExpiresAt)
		it.IsOwner = (actor != nil && it.OwnerID == actor.ID)
		usedBytes += it.Size
		items = append(items, it)
	}
	return c.JSON(fiber.Map{"items": items, "usedBytes": usedBytes, "maxFileBytes": userFileMaxBytes})
}

func (s *server) uploadOwnUserFile(c *fiber.Ctx) error {
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน", Code: "storage_unavailable"})
	}
	actor := current(c)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์", Code: "file_required"})
	}
	if fileHeader.Size <= 0 || fileHeader.Size > userFileMaxBytes {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์ต้องมีขนาดไม่เกิน 50 MB", Code: "file_too_large"})
	}

	baseName, extension := sanitizeFilename(fileHeader.Filename)
	originalName := baseName + extension
	if blockedExtensions[extension] {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่อนุญาตให้อัปโหลดไฟล์ประเภทนี้", Code: "file_type_blocked"})
	}
	file, err := fileHeader.Open()
	if err != nil {
		log.Printf("[uploadOwnUserFile] fileHeader.Open error: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถอ่านไฟล์ได้", Code: "file_read_error"})
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, userFileMaxBytes+1))
	if err != nil || int64(len(data)) > userFileMaxBytes {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์มีขนาดใหญ่เกินไป", Code: "file_too_large"})
	}
	contentType := normalizeDetectedContentType(http.DetectContentType(data))
	if !safeUserFileType(contentType, extension, data) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์ประเภทนี้ไม่ได้รับอนุญาต", Code: "file_type_blocked"})
	}

	var categoryID *int
	if raw := strings.TrimSpace(c.FormValue("categoryId")); raw != "" {
		id, err := strconv.Atoi(raw)
		if err != nil || id <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง", Code: "invalid_category"})
		}
		var exists bool
		if err := s.db.QueryRow(c.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM user_file_categories
				WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
			)
		`, id, actor.ID).Scan(&exists); err != nil {
			log.Printf("[uploadOwnUserFile] category check error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ตรวจสอบหมวดหมู่ไม่สำเร็จ", Code: "category_query_error"})
		}
		if !exists {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบหมวดหมู่", Code: "invalid_category"})
		}
		categoryID = &id
	}

	var folderID *int
	if raw := strings.TrimSpace(c.FormValue("folderId")); raw != "" {
		fID, err := strconv.Atoi(raw)
		if err != nil || fID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
		}
		// Admins see the system folders (owner NULL) in the file-system view and upload into
		// them through this endpoint; everyone else may only use their own folders.
		canUseSystemFolders := actor.Role == "admin" || actor.Role == "superadmin"
		var folderCatID int
		err = s.db.QueryRow(c.Context(), `
			SELECT category_id FROM user_file_folders
			WHERE id=$1 AND (owner_user_id=$2 OR ($3 AND owner_user_id IS NULL))
		`, fID, actor.ID, canUseSystemFolders).Scan(&folderCatID)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "invalid_folder"})
		}
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if categoryID == nil {
			categoryID = &folderCatID
		} else if *categoryID != folderCatID {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ได้อยู่ในหมวดหมู่ที่เลือก", Code: "folder_category_mismatch"})
		}
		folderID = &fID
	}

	randomID := make([]byte, 16)
	if _, err := rand.Read(randomID); err != nil {
		log.Printf("[uploadOwnUserFile] rand error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "สร้างรหัสไฟล์ไม่สำเร็จ", Code: "random_id_error"})
	}
	publicID := hex.EncodeToString(randomID)
	objectKey := fmt.Sprintf("user-files/%d/%s%s", actor.ID, publicID, extension)
	hash := sha256.Sum256(data)

	if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, objectKey, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: contentType,
	}); err != nil {
		log.Printf("[uploadOwnUserFile] MinIO PutObject error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "บันทึกไฟล์ลงพื้นที่จัดเก็บไม่สำเร็จ", Code: "storage_put_error"})
	}
	removeUploadedObject := func() {
		_ = s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{})
	}

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		removeUploadedObject()
		log.Printf("[uploadOwnUserFile] db BeginTx error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เริ่มทำรายการฐานข้อมูลไม่สำเร็จ", Code: "db_tx_error"})
	}
	defer tx.Rollback(c.Context())
	if _, err := tx.Exec(c.Context(), `SELECT pg_advisory_xact_lock($1)`, -actor.ID); err != nil {
		removeUploadedObject()
		log.Printf("[uploadOwnUserFile] advisory lock error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ระบบกำลังประมวลผล กรุณาลองใหม่อีกครั้ง", Code: "lock_error"})
	}
	var usedBytes int64
	if err := tx.QueryRow(c.Context(), `SELECT COALESCE(SUM(size_bytes),0) FROM user_files WHERE owner_user_id=$1 AND deleted_at IS NULL`, actor.ID).Scan(&usedBytes); err != nil {
		removeUploadedObject()
		log.Printf("[uploadOwnUserFile] query usedBytes error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "คำนวณพื้นที่จัดเก็บไม่สำเร็จ", Code: "db_query_error"})
	}
	if usedBytes+int64(len(data)) > userFileQuotaBytes {
		removeUploadedObject()
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "พื้นที่จัดเก็บของคุณเต็มแล้ว", Code: "storage_quota_exceeded"})
	}
	_, err = tx.Exec(c.Context(), `
		INSERT INTO user_files(public_id,owner_user_id,object_key,original_name,content_type,size_bytes,sha256_hex,category_id,folder_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, publicID, actor.ID, objectKey, originalName, contentType, len(data), hex.EncodeToString(hash[:]), categoryID, folderID)
	if err != nil {
		removeUploadedObject()
		log.Printf("[uploadOwnUserFile] insert user_files error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "บันทึกข้อมูลไฟล์ลงฐานข้อมูลไม่สำเร็จ", Code: "db_insert_error"})
	}
	if err := tx.Commit(c.Context()); err != nil {
		removeUploadedObject()
		log.Printf("[uploadOwnUserFile] commit tx error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ยืนยันรายการฐานข้อมูลไม่สำเร็จ", Code: "db_commit_error"})
	}

	item := userFileItem{
		ID: publicID, Name: originalName, ContentType: contentType, Size: int64(len(data)),
		CategoryID: categoryID, FolderID: folderID, IsVisible: true, PasswordEnabled: false, CreatedAt: time.Now().UTC(),
	}
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file.uploaded", Target: "user_file", TargetID: publicID, Metadata: map[string]any{"name": originalName, "size": len(data)}})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"item": item})
}

func (s *server) extractDownloadPassword(c *fiber.Ctx) string {
	if pw := strings.TrimSpace(c.Query("password")); pw != "" {
		return pw
	}
	if pw := strings.TrimSpace(c.FormValue("password")); pw != "" {
		return pw
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err == nil {
		return strings.TrimSpace(body.Password)
	}
	return ""
}

func (s *server) sendUserFileObject(c *fiber.Ctx, objectKey, originalName, contentType string, size int64, preview bool) error {
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน", Code: "storage_unavailable"})
	}
	object, err := s.storage.GetObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	defer object.Close()
	if _, err := object.Stat(); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	data, err := io.ReadAll(io.LimitReader(object, size+1))
	if err != nil || int64(len(data)) != size {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	disposition := "attachment"
	if preview && isSafeUserFilePreview(contentType) {
		disposition = "inline"
	}
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("%s; filename=%q", disposition, originalName))
	c.Set(fiber.HeaderCacheControl, "private, no-store, max-age=0")
	c.Set("X-Content-Type-Options", "nosniff")
	return c.Send(data)
}

func isSafeUserFilePreview(contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if contentType == "image/svg+xml" || contentType == "text/html" || contentType == "text/javascript" || contentType == "application/javascript" {
		return false
	}
	return (strings.HasPrefix(contentType, "image/")) ||
		contentType == "application/pdf" ||
		strings.HasPrefix(contentType, "audio/") ||
		strings.HasPrefix(contentType, "video/") ||
		contentType == "text/plain" ||
		contentType == "text/markdown" ||
		contentType == "text/csv" ||
		contentType == "application/json"
}

func (s *server) downloadUserFile(c *fiber.Ctx) error {
	actor := current(c)
	isAdmin := isUserFileAdmin(actor)
	var ownerID int64
	var objectKey, originalName, contentType string
	var size int64
	query := `
		SELECT f.owner_user_id, f.object_key, f.original_name, f.content_type, f.size_bytes
		FROM user_files f
		WHERE f.public_id=$1 AND f.deleted_at IS NULL
	`
	args := []any{c.Params("id")}
	if !isAdmin {
		query += ` AND f.owner_user_id=$2`
		args = append(args, actor.ID)
	}
	err := s.db.QueryRow(c.Context(), query, args...).Scan(&ownerID, &objectKey, &originalName, &contentType, &size)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !canReadUserFile(actor, ownerID) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	return s.sendUserFileObject(c, objectKey, originalName, contentType, size, c.QueryBool("preview"))
}

func (s *server) createOwnUserFileShare(c *fiber.Ctx) error {
	return s.createUserFileShare(c, false)
}

func (s *server) createAdminUserFileShare(c *fiber.Ctx) error {
	return s.createUserFileShare(c, true)
}

func (s *server) createUserFileShare(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	var body struct {
		ExpiresIn string `json:"expiresIn"`
	}
	_ = c.BodyParser(&body)
	expiresAt, err := parseShareExpiresIn(body.ExpiresIn, time.Now())
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_share_expiry"})
	}

	var ownerID int64
	err = s.db.QueryRow(c.Context(), `SELECT owner_user_id FROM user_files WHERE public_id=$1 AND deleted_at IS NULL`, c.Params("id")).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !asAdmin && ownerID != actor.ID {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์แชร์ไฟล์นี้", Code: "file_access_denied"})
	}

	var token string
	created := false
	for attempt := 0; attempt < 8; attempt++ {
		token, err = s.newShareToken()
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		query := `
			UPDATE user_files
			SET share_enabled=TRUE, share_token=$1, share_expires_at=$2
			WHERE public_id=$3 AND deleted_at IS NULL`
		args := []any{token, expiresAt, c.Params("id")}
		if !asAdmin {
			query += ` AND owner_user_id=$4`
			args = append(args, actor.ID)
		}
		tag, execErr := s.db.Exec(c.Context(), query, args...)
		if execErr != nil {
			if strings.Contains(strings.ToLower(execErr.Error()), "unique") {
				token = ""
				continue
			}
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if tag.RowsAffected() == 0 {
			return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
		}
		created = true
		break
	}
	if !created || token == "" {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	item, itemErr := s.loadOwnUserFileItem(c, c.Params("id"), asAdmin)
	if item == nil {
		return itemErr
	}
	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.shared",
		Target: "user_file", TargetID: c.Params("id"),
		Metadata: map[string]any{"expiresIn": strings.TrimSpace(body.ExpiresIn), "asAdmin": asAdmin, "ownerId": ownerID},
	})
	return c.JSON(fiber.Map{"item": item, "shareUrl": publicUserFileSharePath(token), "expiresAt": expiresAt})
}

func (s *server) revokeOwnUserFileShare(c *fiber.Ctx) error {
	return s.revokeUserFileShare(c, false)
}

func (s *server) revokeAdminUserFileShare(c *fiber.Ctx) error {
	return s.revokeUserFileShare(c, true)
}

func (s *server) revokeUserFileShare(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	var ownerID int64
	err := s.db.QueryRow(c.Context(), `SELECT owner_user_id FROM user_files WHERE public_id=$1 AND deleted_at IS NULL`, c.Params("id")).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !asAdmin && ownerID != actor.ID {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ยกเลิกลิงก์นี้", Code: "file_access_denied"})
	}
	if _, err := s.db.Exec(c.Context(), `
		UPDATE user_files
		SET share_enabled=FALSE, share_token=NULL, share_expires_at=NULL
		WHERE public_id=$1 AND deleted_at IS NULL
	`, c.Params("id")); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.share_revoked",
		Target: "user_file", TargetID: c.Params("id"),
		Metadata: map[string]any{"asAdmin": asAdmin, "ownerId": ownerID},
	})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) loadPublicSharedFile(c *fiber.Ctx, token string) (*publicSharedFile, error) {
	if !validShareToken(token) {
		return nil, c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบลิงก์นี้", Code: "share_not_found"})
	}
	var file publicSharedFile
	err := s.db.QueryRow(c.Context(), `
		SELECT original_name, content_type, size_bytes, object_key, password_enabled, password_hash, share_expires_at
		FROM user_files
		WHERE share_token=$1
		  AND share_enabled=TRUE
		  AND deleted_at IS NULL
		  AND (share_expires_at IS NULL OR share_expires_at > NOW())
	`, token).Scan(&file.Name, &file.ContentType, &file.Size, &file.ObjectKey, &file.PasswordEnabled, &file.PasswordHash, &file.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว", Code: "share_not_found"})
	}
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError)
	}
	return &file, nil
}

func (s *server) getPublicSharedUserFile(c *fiber.Ctx) error {
	file, err := s.loadPublicSharedFile(c, strings.ToLower(strings.TrimSpace(c.Params("token"))))
	if file == nil {
		return err
	}
	return c.JSON(fiber.Map{
		"name":             file.Name,
		"contentType":      file.ContentType,
		"size":             file.Size,
		"expiresAt":        file.ExpiresAt,
		"passwordRequired": file.PasswordEnabled,
	})
}

func (s *server) downloadPublicSharedUserFile(c *fiber.Ctx) error {
	file, err := s.loadPublicSharedFile(c, strings.ToLower(strings.TrimSpace(c.Params("token"))))
	if file == nil {
		return err
	}
	if file.PasswordEnabled {
		provided := s.extractDownloadPassword(c)
		if provided == "" || file.PasswordHash == nil || *file.PasswordHash == "" || !s.verifyPassword(provided, *file.PasswordHash) {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ต้องระบุรหัสผ่านที่ถูกต้อง", Code: "file_password_required"})
		}
	}
	return s.sendUserFileObject(c, file.ObjectKey, file.Name, file.ContentType, file.Size, c.QueryBool("preview"))
}

func (s *server) loadOwnUserFileItem(c *fiber.Ctx, publicID string, withOwner bool) (*userFileItem, error) {
	item := &userFileItem{}
	var categoryID *int
	var folderID *int
	var folderName *string
	var shareToken *string
	var err error
	if withOwner {
		err = s.db.QueryRow(c.Context(), `
			SELECT f.public_id, f.original_name, f.content_type, f.size_bytes, f.owner_user_id, u.identifier, f.created_at,
			       f.category_id, COALESCE(c.name, ''), f.folder_id, COALESCE(fo.name, ''), f.is_visible, f.password_enabled,
			       f.share_enabled, f.share_token, f.share_expires_at
			FROM user_files f
			JOIN users u ON u.id = f.owner_user_id
			LEFT JOIN user_file_categories c ON c.id = f.category_id
			LEFT JOIN user_file_folders fo ON fo.id = f.folder_id
			WHERE f.public_id=$1 AND f.deleted_at IS NULL
		`, publicID).Scan(&item.ID, &item.Name, &item.ContentType, &item.Size, &item.OwnerID, &item.Owner, &item.CreatedAt, &categoryID, &item.CategoryName, &folderID, &folderName, &item.IsVisible, &item.PasswordEnabled, &item.ShareEnabled, &shareToken, &item.ShareExpiresAt)
	} else {
		err = s.db.QueryRow(c.Context(), `
			SELECT f.public_id, f.original_name, f.content_type, f.size_bytes, f.created_at,
			       f.category_id, COALESCE(c.name, ''), f.folder_id, COALESCE(fo.name, ''), f.is_visible, f.password_enabled,
			       f.share_enabled, f.share_token, f.share_expires_at
			FROM user_files f
			LEFT JOIN user_file_categories c ON c.id = f.category_id
			LEFT JOIN user_file_folders fo ON fo.id = f.folder_id
			WHERE f.public_id=$1 AND f.deleted_at IS NULL
		`, publicID).Scan(&item.ID, &item.Name, &item.ContentType, &item.Size, &item.CreatedAt, &categoryID, &item.CategoryName, &folderID, &folderName, &item.IsVisible, &item.PasswordEnabled, &item.ShareEnabled, &shareToken, &item.ShareExpiresAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError)
	}
	item.CategoryID = categoryID
	item.FolderID = folderID
	if folderName != nil {
		item.FolderName = *folderName
	}
	actor := current(c)
	if actor != nil {
		if item.OwnerID > 0 {
			item.IsOwner = (item.OwnerID == actor.ID)
		} else {
			item.IsOwner = true
		}
	}
	attachShareState(item, item.ShareEnabled, shareToken, item.ShareExpiresAt)
	return item, nil
}

func (s *server) patchOwnUserFile(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		Name            *string `json:"name"`
		CategoryID      *int    `json:"categoryId"`
		ClearCategory   bool    `json:"clearCategory"`
		FolderID        *int    `json:"folderId"`
		ClearFolder     bool    `json:"clearFolder"`
		IsVisible       *bool   `json:"isVisible"`
		PasswordEnabled *bool   `json:"passwordEnabled"`
		Password        *string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}

	var ownerID int64
	var currentName string
	var currentCatID *int
	err := s.db.QueryRow(c.Context(), `SELECT owner_user_id, original_name, category_id FROM user_files WHERE public_id=$1 AND deleted_at IS NULL`, c.Params("id")).Scan(&ownerID, &currentName, &currentCatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		log.Printf("[patchOwnUserFile] select error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if ownerID != actor.ID {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์แก้ไขไฟล์นี้", Code: "file_access_denied"})
	}

	sets := make([]string, 0, 6)
	args := make([]any, 0, 6)
	argN := 1

	if body.Name != nil {
		nextName, renameErr := lockedRenameDisplayName(currentName, *body.Name)
		if renameErr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: renameErr.Error(), Code: "invalid_filename"})
		}
		sets = append(sets, fmt.Sprintf("original_name=$%d", argN))
		args = append(args, nextName)
		argN++
	}

	if body.ClearCategory {
		sets = append(sets, "category_id=NULL", "folder_id=NULL")
	} else if body.CategoryID != nil {
		if *body.CategoryID <= 0 {
			sets = append(sets, "category_id=NULL", "folder_id=NULL")
		} else {
			var exists bool
			if err := s.db.QueryRow(c.Context(), `
				SELECT EXISTS(
					SELECT 1 FROM user_file_categories
					WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
				)
			`, *body.CategoryID, actor.ID).Scan(&exists); err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
			if !exists {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบหมวดหมู่", Code: "invalid_category"})
			}
			sets = append(sets, fmt.Sprintf("category_id=$%d", argN))
			args = append(args, *body.CategoryID)
			argN++
			currentCatID = body.CategoryID
		}
	}

	if body.ClearFolder {
		sets = append(sets, "folder_id=NULL")
	} else if body.FolderID != nil {
		if *body.FolderID <= 0 {
			sets = append(sets, "folder_id=NULL")
		} else {
			var folderCatID int
			err := s.db.QueryRow(c.Context(), `SELECT category_id FROM user_file_folders WHERE id=$1 AND owner_user_id=$2`, *body.FolderID, actor.ID).Scan(&folderCatID)
			if errors.Is(err, pgx.ErrNoRows) {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "invalid_folder"})
			}
			if err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
			sets = append(sets, fmt.Sprintf("folder_id=$%d", argN))
			args = append(args, *body.FolderID)
			argN++

			// Automatically align category with folder
			sets = append(sets, fmt.Sprintf("category_id=$%d", argN))
			args = append(args, folderCatID)
			argN++
		}
	}

	if body.IsVisible != nil {
		sets = append(sets, fmt.Sprintf("is_visible=$%d", argN))
		args = append(args, *body.IsVisible)
		argN++
	}

	if body.PasswordEnabled != nil {
		if !*body.PasswordEnabled {
			sets = append(sets, "password_enabled=FALSE", "password_hash=NULL")
		} else {
			password := ""
			if body.Password != nil {
				password = strings.TrimSpace(*body.Password)
			}
			if password == "" {
				var hasHash bool
				_ = s.db.QueryRow(c.Context(), `SELECT password_hash IS NOT NULL AND password_hash <> '' FROM user_files WHERE public_id=$1`, c.Params("id")).Scan(&hasHash)
				if !hasHash {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อคไฟล์", Code: "password_required"})
				}
				sets = append(sets, "password_enabled=TRUE")
			} else {
				if msg := validatePasswordPolicy(password); msg != "" {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
				}
				hash, hashErr := s.hashPassword(password)
				if hashErr != nil {
					return fiber.NewError(fiber.StatusInternalServerError)
				}
				sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
				args = append(args, hash)
				argN++
			}
		}
	} else if body.Password != nil {
		password := strings.TrimSpace(*body.Password)
		if password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่าน", Code: "password_required"})
		}
		if msg := validatePasswordPolicy(password); msg != "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
		}
		hash, hashErr := s.hashPassword(password)
		if hashErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
		args = append(args, hash)
		argN++
	}

	if len(sets) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่มีข้อมูลที่จะอัปเดต", Code: "no_updates"})
	}

	query := fmt.Sprintf("UPDATE user_files SET %s WHERE public_id=$%d AND owner_user_id=$%d AND deleted_at IS NULL", strings.Join(sets, ", "), argN, argN+1)
	args = append(args, c.Params("id"), actor.ID)
	_, err = s.db.Exec(c.Context(), query, args...)
	if err != nil {
		log.Printf("[patchOwnUserFile] update error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return s.getUserFileJSON(c, c.Params("id"), false)
}

func (s *server) patchAdminUserFile(c *fiber.Ctx) error {
	var body struct {
		Name            *string `json:"name"`
		CategoryID      *int    `json:"categoryId"`
		ClearCategory   bool    `json:"clearCategory"`
		FolderID        *int    `json:"folderId"`
		ClearFolder     bool    `json:"clearFolder"`
		IsVisible       *bool   `json:"isVisible"`
		PasswordEnabled *bool   `json:"passwordEnabled"`
		Password        *string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}

	var currentName string
	err := s.db.QueryRow(c.Context(), `SELECT original_name FROM user_files WHERE public_id=$1 AND deleted_at IS NULL`, c.Params("id")).Scan(&currentName)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	sets := make([]string, 0, 6)
	args := make([]any, 0, 6)
	argN := 1

	if body.Name != nil {
		nextName, renameErr := lockedRenameDisplayName(currentName, *body.Name)
		if renameErr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: renameErr.Error(), Code: "invalid_filename"})
		}
		sets = append(sets, fmt.Sprintf("original_name=$%d", argN))
		args = append(args, nextName)
		argN++
	}

	if body.ClearCategory {
		sets = append(sets, "category_id=NULL", "folder_id=NULL")
	} else if body.CategoryID != nil {
		if *body.CategoryID <= 0 {
			sets = append(sets, "category_id=NULL", "folder_id=NULL")
		} else {
			var exists bool
			if err := s.db.QueryRow(c.Context(), `SELECT EXISTS(SELECT 1 FROM user_file_categories WHERE id=$1)`, *body.CategoryID).Scan(&exists); err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
			if !exists {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบหมวดหมู่", Code: "invalid_category"})
			}
			sets = append(sets, fmt.Sprintf("category_id=$%d", argN))
			args = append(args, *body.CategoryID)
			argN++
		}
	}

	if body.ClearFolder {
		sets = append(sets, "folder_id=NULL")
	} else if body.FolderID != nil {
		if *body.FolderID <= 0 {
			sets = append(sets, "folder_id=NULL")
		} else {
			var folderCatID int
			err := s.db.QueryRow(c.Context(), `SELECT category_id FROM user_file_folders WHERE id=$1`, *body.FolderID).Scan(&folderCatID)
			if errors.Is(err, pgx.ErrNoRows) {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "invalid_folder"})
			}
			if err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
			sets = append(sets, fmt.Sprintf("folder_id=$%d", argN))
			args = append(args, *body.FolderID)
			argN++

			// Automatically align category with folder
			sets = append(sets, fmt.Sprintf("category_id=$%d", argN))
			args = append(args, folderCatID)
			argN++
		}
	}

	if body.IsVisible != nil {
		sets = append(sets, fmt.Sprintf("is_visible=$%d", argN))
		args = append(args, *body.IsVisible)
		argN++
	}

	if body.PasswordEnabled != nil {
		if !*body.PasswordEnabled {
			sets = append(sets, "password_enabled=FALSE", "password_hash=NULL")
		} else {
			password := ""
			if body.Password != nil {
				password = strings.TrimSpace(*body.Password)
			}
			if password == "" {
				var hasHash bool
				_ = s.db.QueryRow(c.Context(), `SELECT password_hash IS NOT NULL AND password_hash <> '' FROM user_files WHERE public_id=$1`, c.Params("id")).Scan(&hasHash)
				if !hasHash {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อคไฟล์", Code: "password_required"})
				}
				sets = append(sets, "password_enabled=TRUE")
			} else {
				if msg := validatePasswordPolicy(password); msg != "" {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
				}
				hash, hashErr := s.hashPassword(password)
				if hashErr != nil {
					return fiber.NewError(fiber.StatusInternalServerError)
				}
				sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
				args = append(args, hash)
				argN++
			}
		}
	} else if body.Password != nil {
		password := strings.TrimSpace(*body.Password)
		if password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่าน", Code: "password_required"})
		}
		if msg := validatePasswordPolicy(password); msg != "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
		}
		hash, hashErr := s.hashPassword(password)
		if hashErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
		args = append(args, hash)
		argN++
	}

	if len(sets) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่มีข้อมูลที่จะอัปเดต"})
	}

	args = append(args, c.Params("id"))
	query := fmt.Sprintf(`UPDATE user_files SET %s WHERE public_id=$%d AND deleted_at IS NULL`, strings.Join(sets, ", "), argN)
	if _, err := s.db.Exec(c.Context(), query, args...); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{Actor: current(c), Category: "files", Action: "user_file.updated", Target: "user_file", TargetID: c.Params("id")})
	return s.getUserFileJSON(c, c.Params("id"), true)
}

func validatePasswordPolicy(password string) string {
	if len([]rune(password)) < 4 {
		return "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"
	}
	if len(password) > 128 {
		return "รหัสผ่านยาวเกินไป"
	}
	return ""
}

func (s *server) getUserFileJSON(c *fiber.Ctx, publicID string, withOwner bool) error {
	item, err := s.loadOwnUserFileItem(c, publicID, withOwner)
	if item == nil {
		return err
	}
	return c.JSON(fiber.Map{"item": item})
}

func (s *server) deleteOwnUserFile(c *fiber.Ctx) error {
	return s.deleteUserFile(c, false)
}

func (s *server) deleteAnyUserFile(c *fiber.Ctx) error {
	return s.deleteUserFile(c, true)
}

func (s *server) deleteUserFile(c *fiber.Ctx, admin bool) error {
	actor := current(c)
	var ownerID int64
	var objectKey, originalName string
	err := s.db.QueryRow(c.Context(), `SELECT owner_user_id,object_key,original_name FROM user_files WHERE public_id=$1 AND deleted_at IS NULL`, c.Params("id")).Scan(&ownerID, &objectKey, &originalName)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์", Code: "file_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !admin && ownerID != actor.ID {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ลบไฟล์นี้", Code: "file_access_denied"})
	}
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน", Code: "storage_unavailable"})
	}
	if err := s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := s.db.Exec(c.Context(), `
		UPDATE user_files
		SET deleted_at=NOW(), share_enabled=FALSE, share_token=NULL, share_expires_at=NULL
		WHERE public_id=$1 AND deleted_at IS NULL
	`, c.Params("id")); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file.deleted", Target: "user_file", TargetID: c.Params("id"), Metadata: map[string]any{"name": originalName, "ownerId": ownerID}})
	return c.SendStatus(fiber.StatusNoContent)
}

// --- Categories ---

const maxUserCategories = 30

func (s *server) listUserFileCategories(c *fiber.Ctx) error {
	actor := current(c)
	visibleOnly := c.QueryBool("visibleOnly")
	// Counts come from per-category subqueries. Joining shares, files and folders together
	// multiplied the rows and made PostgreSQL JIT-compile the plan, which took over a second.
	query := `
		SELECT c.id, c.owner_user_id, u.identifier, c.name, c.is_visible, c.password_enabled, c.sort_order, c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM user_file_category_shares s
		         WHERE s.category_id = c.id AND s.share_enabled = TRUE AND (s.share_expires_at IS NULL OR s.share_expires_at > NOW())),
		       (SELECT COUNT(*) FROM user_files f WHERE f.category_id = c.id AND f.deleted_at IS NULL),
		       (SELECT COUNT(*) FROM user_files f WHERE f.category_id = c.id AND f.deleted_at IS NULL AND f.is_visible = FALSE),
		       (SELECT COUNT(*) FROM user_file_folders fo WHERE fo.category_id = c.id),
		       COALESCE(sa.share_enabled,FALSE), sa.share_token, sa.share_expires_at
		FROM user_file_categories c
		LEFT JOIN users u ON u.id = c.owner_user_id
		LEFT JOIN user_file_category_shares sa ON sa.category_id = c.id AND sa.is_admin_share = TRUE
	`
	if visibleOnly {
		query += ` WHERE c.is_visible = TRUE`
	}
	query += ` ORDER BY c.sort_order ASC, c.id ASC`

	rows, err := s.db.Query(c.Context(), query)
	if err != nil {
		log.Printf("[listUserFileCategories] error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileCategory, 0)
	for rows.Next() {
		var cat userFileCategory
		var ownerIdent *string
		var adminShareEnabled bool
		var adminShareToken *string
		var adminShareExpires *time.Time
		if err := rows.Scan(
			&cat.ID, &cat.OwnerUserID, &ownerIdent, &cat.Name, &cat.IsVisible, &cat.PasswordEnabled, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt,
			&cat.ActiveShareCount, &cat.FileCount, &cat.HiddenFileCount, &cat.FolderCount,
			&adminShareEnabled, &adminShareToken, &adminShareExpires,
		); err != nil {
			log.Printf("[listUserFileCategories] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if ownerIdent != nil {
			cat.Owner = *ownerIdent
		}
		if actor != nil && cat.OwnerUserID != nil {
			cat.IsOwner = (*cat.OwnerUserID == actor.ID)
		} else if cat.OwnerUserID == nil {
			cat.IsOwner = true
		}
		if adminShareToken != nil && shareLinkActive(adminShareEnabled, *adminShareToken, adminShareExpires, time.Now()) {
			cat.AdminShareURL = publicUserFileCategorySharePath(*adminShareToken)
			cat.AdminShareExpiresAt = adminShareExpires
		}
		items = append(items, cat)
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) listUserFileCategoriesVisible(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT c.id, c.owner_user_id, u.identifier, c.name, c.is_visible, c.password_enabled, c.sort_order, c.created_at, c.updated_at,
		       COALESCE(s.share_enabled,FALSE), s.share_token, s.share_expires_at,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL),
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL AND f.is_visible = FALSE),
		       COUNT(DISTINCT fo.id)
		FROM user_file_categories c
		LEFT JOIN users u ON u.id = c.owner_user_id
		LEFT JOIN user_file_category_shares s ON s.category_id=c.id AND s.owner_user_id=$1
		LEFT JOIN user_files f ON f.category_id = c.id AND f.owner_user_id = $1
		LEFT JOIN user_file_folders fo ON fo.category_id = c.id AND fo.owner_user_id = $1
		WHERE (c.owner_user_id = $1 OR (c.owner_user_id IS NULL AND c.is_visible = TRUE))
		GROUP BY c.id, u.identifier, s.share_enabled, s.share_token, s.share_expires_at
		ORDER BY c.sort_order ASC, c.id ASC`, actor.ID)
	if err != nil {
		log.Printf("[listUserFileCategoriesVisible] error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileCategory, 0)
	for rows.Next() {
		var cat userFileCategory
		var ownerIdent *string
		var token *string
		if err := rows.Scan(
			&cat.ID, &cat.OwnerUserID, &ownerIdent, &cat.Name, &cat.IsVisible, &cat.PasswordEnabled, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt,
			&cat.ShareEnabled, &token, &cat.ShareExpiresAt,
			&cat.FileCount, &cat.HiddenFileCount, &cat.FolderCount,
		); err != nil {
			log.Printf("[listUserFileCategoriesVisible] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if ownerIdent != nil {
			cat.Owner = *ownerIdent
		}
		if cat.OwnerUserID != nil && *cat.OwnerUserID == actor.ID {
			cat.IsOwner = true
		}
		attachCategoryShareState(&cat, cat.ShareEnabled, token, cat.ShareExpiresAt)
		items = append(items, cat)
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) createOwnUserFileCategory(c *fiber.Ctx) error {
	actor := current(c)
	if actor == nil {
		return fiber.NewError(fiber.StatusUnauthorized)
	}

	var count int
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM user_file_categories WHERE owner_user_id=$1`, actor.ID).Scan(&count); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if count >= maxUserCategories && actor.Role != "admin" && actor.Role != "superadmin" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: fmt.Sprintf("คุณสร้างหมวดหมู่ครบโควตาสูงสุดแล้ว (%d หมวดหมู่)", maxUserCategories)})
	}

	var body struct {
		Name            string  `json:"name"`
		IsVisible       *bool   `json:"isVisible"`
		PasswordEnabled bool    `json:"passwordEnabled"`
		Password        *string `json:"password"`
		SortOrder       int     `json:"sortOrder"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อหมวดหมู่"})
	}
	if len(name) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อหมวดหมู่ต้องไม่เกิน 100 ตัวอักษร"})
	}

	isVisible := true
	if body.IsVisible != nil {
		isVisible = *body.IsVisible
	}

	var passwordHash *string
	passwordEnabled := body.PasswordEnabled
	if passwordEnabled {
		if body.Password == nil || strings.TrimSpace(*body.Password) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อกหมวดหมู่"})
		}
		p := strings.TrimSpace(*body.Password)
		if len(p) < 4 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"})
		}
		hash, err := s.hashPassword(p)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		passwordHash = &hash
	}

	var cat userFileCategory
	err := s.db.QueryRow(c.Context(), `
		INSERT INTO user_file_categories (owner_user_id, name, is_visible, password_enabled, password_hash, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, owner_user_id, name, is_visible, password_enabled, sort_order, created_at, updated_at
	`, actor.ID, name, isVisible, passwordEnabled, passwordHash, body.SortOrder).Scan(
		&cat.ID, &cat.OwnerUserID, &cat.Name, &cat.IsVisible, &cat.PasswordEnabled, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt,
	)
	if err != nil {
		log.Printf("[createOwnUserFileCategory] insert error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	cat.IsOwner = true
	cat.Owner = actor.Username

	s.audit(c, auditEvent{
		Actor:    actor,
		Category: "files",
		Action:   "user_file_category.created",
		Target:   "user_file_category",
		TargetID: fmt.Sprint(cat.ID),
		Metadata: map[string]any{"name": cat.Name, "passwordEnabled": cat.PasswordEnabled},
	})
	return c.Status(fiber.StatusCreated).JSON(cat)
}

func (s *server) updateOwnUserFileCategory(c *fiber.Ctx) error {
	actor := current(c)
	catID, err := strconv.Atoi(c.Params("id"))
	if err != nil || catID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}

	var ownerUserID *int64
	var currentPasswordHash *string
	err = s.db.QueryRow(c.Context(), `SELECT owner_user_id, password_hash FROM user_file_categories WHERE id=$1`, catID).Scan(&ownerUserID, &currentPasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบหมวดหมู่"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	isOwner := (ownerUserID != nil && *ownerUserID == actor.ID)
	isAdmin := actor.Role == "admin" || actor.Role == "superadmin"
	if !isOwner && !isAdmin {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์แก้ไขหมวดหมู่นี้"})
	}

	var body struct {
		Name            *string `json:"name"`
		IsVisible       *bool   `json:"isVisible"`
		PasswordEnabled *bool   `json:"passwordEnabled"`
		Password        *string `json:"password"`
		SortOrder       *int    `json:"sortOrder"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}

	sets := make([]string, 0, 5)
	args := make([]any, 0, 6)
	argN := 1

	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อหมวดหมู่"})
		}
		if len(name) > 100 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อหมวดหมู่ต้องไม่เกิน 100 ตัวอักษร"})
		}
		sets = append(sets, fmt.Sprintf("name=$%d", argN))
		args = append(args, name)
		argN++
	}

	if body.IsVisible != nil {
		sets = append(sets, fmt.Sprintf("is_visible=$%d", argN))
		args = append(args, *body.IsVisible)
		argN++
	}

	if body.SortOrder != nil {
		sets = append(sets, fmt.Sprintf("sort_order=$%d", argN))
		args = append(args, *body.SortOrder)
		argN++
	}

	if body.PasswordEnabled != nil {
		sets = append(sets, fmt.Sprintf("password_enabled=$%d", argN))
		args = append(args, *body.PasswordEnabled)
		argN++

		if *body.PasswordEnabled {
			if body.Password != nil && strings.TrimSpace(*body.Password) != "" {
				p := strings.TrimSpace(*body.Password)
				if len(p) < 4 {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"})
				}
				hash, err := s.hashPassword(p)
				if err != nil {
					return fiber.NewError(fiber.StatusInternalServerError)
				}
				sets = append(sets, fmt.Sprintf("password_hash=$%d", argN))
				args = append(args, hash)
				argN++
			} else if currentPasswordHash == nil {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อกหมวดหมู่"})
			}
		} else {
			sets = append(sets, "password_hash=NULL")
		}
	}

	if len(sets) == 0 {
		return c.JSON(fiber.Map{"success": true})
	}

	sets = append(sets, "updated_at=NOW()")
	args = append(args, catID)
	q := fmt.Sprintf("UPDATE user_file_categories SET %s WHERE id=$%d", strings.Join(sets, ", "), argN)

	if _, err := s.db.Exec(c.Context(), q, args...); err != nil {
		log.Printf("[updateOwnUserFileCategory] update error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor:    actor,
		Category: "files",
		Action:   "user_file_category.updated",
		Target:   "user_file_category",
		TargetID: strconv.Itoa(catID),
	})
	return c.JSON(fiber.Map{"success": true})
}

func (s *server) deleteOwnUserFileCategory(c *fiber.Ctx) error {
	actor := current(c)
	catID, err := strconv.Atoi(c.Params("id"))
	if err != nil || catID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}

	var ownerUserID *int64
	var catName string
	err = s.db.QueryRow(c.Context(), `SELECT owner_user_id, name FROM user_file_categories WHERE id=$1`, catID).Scan(&ownerUserID, &catName)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบหมวดหมู่"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	isOwner := (ownerUserID != nil && *ownerUserID == actor.ID)
	isAdmin := actor.Role == "admin" || actor.Role == "superadmin"
	if !isOwner && !isAdmin {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ลบหมวดหมู่นี้"})
	}

	cascade := c.QueryBool("cascade")

	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	if cascade {
		if _, err := tx.Exec(c.Context(), `UPDATE user_files SET deleted_at=NOW() WHERE category_id=$1 AND deleted_at IS NULL`, catID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	} else {
		if _, err := tx.Exec(c.Context(), `UPDATE user_files SET category_id=NULL, folder_id=NULL WHERE category_id=$1`, catID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}

	if _, err := tx.Exec(c.Context(), `DELETE FROM user_file_folders WHERE category_id=$1`, catID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if _, err := tx.Exec(c.Context(), `DELETE FROM user_file_category_shares WHERE category_id=$1`, catID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if _, err := tx.Exec(c.Context(), `DELETE FROM user_file_categories WHERE id=$1`, catID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor:    actor,
		Category: "files",
		Action:   "user_file_category.deleted",
		Target:   "user_file_category",
		TargetID: strconv.Itoa(catID),
		Metadata: map[string]any{"name": catName, "cascade": cascade},
	})
	return c.JSON(fiber.Map{"success": true})
}

func (s *server) verifyCategoryPassword(c *fiber.Ctx) error {
	actor := current(c)
	catID, err := strconv.Atoi(c.Params("id"))
	if err != nil || catID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}

	var passwordEnabled bool
	var passwordHash *string
	err = s.db.QueryRow(c.Context(), `
		SELECT password_enabled, password_hash
		FROM user_file_categories
		WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
	`, catID, actor.ID).Scan(&passwordEnabled, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบหมวดหมู่"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if !passwordEnabled || passwordHash == nil {
		return c.JSON(fiber.Map{"valid": true})
	}

	if !s.verifyPassword(strings.TrimSpace(body.Password), *passwordHash) {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "รหัสผ่านหมวดหมู่ไม่ถูกต้อง"})
	}

	return c.JSON(fiber.Map{"valid": true})
}

func (s *server) createUserFileCategory(c *fiber.Ctx) error {
	var body struct {
		Name      string `json:"name"`
		IsVisible *bool  `json:"isVisible"`
		SortOrder int    `json:"sortOrder"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อหมวดหมู่"})
	}
	isVisible := true
	if body.IsVisible != nil {
		isVisible = *body.IsVisible
	}

	var cat userFileCategory
	err := s.db.QueryRow(c.Context(), `
		INSERT INTO user_file_categories (name, is_visible, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, name, is_visible, sort_order, created_at, updated_at
	`, name, isVisible, body.SortOrder).Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "files", Action: "user_file_category.created", Target: "user_file_category", TargetID: fmt.Sprint(cat.ID)})
	return c.Status(fiber.StatusCreated).JSON(cat)
}

func (s *server) updateUserFileCategory(c *fiber.Ctx) error {
	return s.updateOwnUserFileCategory(c)
}

func (s *server) deleteUserFileCategory(c *fiber.Ctx) error {
	return s.deleteOwnUserFileCategory(c)
}

func (s *server) revokeAllUserFileCategoryShares(c *fiber.Ctx) error {
	categoryID, err := strconv.Atoi(c.Params("id"))
	if err != nil || categoryID <= 0 {
		return c.Status(400).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}
	tag, err := s.db.Exec(c.Context(), `UPDATE user_file_category_shares SET share_enabled=FALSE, share_expires_at=NULL, updated_at=NOW() WHERE category_id=$1 AND share_enabled=TRUE`, categoryID)
	if err != nil {
		return fiber.NewError(500)
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "files", Action: "user_file_category.shares_revoked", Target: "user_file_category", TargetID: strconv.Itoa(categoryID), Metadata: map[string]any{"count": tag.RowsAffected()}})
	return c.JSON(fiber.Map{"revoked": tag.RowsAffected()})
}

func (s *server) createAdminUserFileCategoryShare(c *fiber.Ctx) error {
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil || id < 1 {
		return c.Status(400).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}
	var body struct {
		ExpiresIn string `json:"expiresIn"`
	}
	_ = c.BodyParser(&body)
	expires, err := parseShareExpiresIn(body.ExpiresIn, time.Now())
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error()})
	}
	var name string
	if err = s.db.QueryRow(c.Context(), `SELECT name FROM user_file_categories WHERE id=$1`, id).Scan(&name); err != nil {
		return c.Status(404).JSON(apiError{Error: "ไม่พบหมวดหมู่"})
	}
	token, err := s.newShareToken()
	if err != nil {
		return fiber.NewError(500)
	}
	_, err = s.db.Exec(c.Context(), `INSERT INTO user_file_category_shares(category_id,owner_user_id,share_token,share_enabled,share_expires_at,is_admin_share) VALUES($1,NULL,$2,TRUE,$3,TRUE) ON CONFLICT (category_id) WHERE is_admin_share=TRUE DO UPDATE SET share_token=EXCLUDED.share_token,share_enabled=TRUE,share_expires_at=EXCLUDED.share_expires_at,updated_at=NOW()`, id, token, expires)
	if err != nil {
		return fiber.NewError(500)
	}
	return c.JSON(fiber.Map{"shareUrl": publicUserFileCategorySharePath(token), "expiresAt": expires})
}

func (s *server) revokeAdminUserFileCategoryShare(c *fiber.Ctx) error {
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil || id < 1 {
		return c.Status(400).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}
	_, err = s.db.Exec(c.Context(), `UPDATE user_file_category_shares SET share_enabled=FALSE,share_expires_at=NULL,updated_at=NOW() WHERE category_id=$1 AND is_admin_share=TRUE`, id)
	if err != nil {
		return fiber.NewError(500)
	}
	return c.SendStatus(204)
}

func (s *server) createOwnUserFileCategoryShare(c *fiber.Ctx) error {
	actor := current(c)
	categoryID, err := strconv.Atoi(c.Params("id"))
	if err != nil || categoryID <= 0 {
		return c.Status(400).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}
	var body struct {
		ExpiresIn string `json:"expiresIn"`
	}
	_ = c.BodyParser(&body)
	expiresAt, err := parseShareExpiresIn(body.ExpiresIn, time.Now())
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error()})
	}
	var cat userFileCategory
	if err := s.db.QueryRow(c.Context(), `SELECT id,name,is_visible,sort_order,created_at,updated_at FROM user_file_categories WHERE id=$1 AND is_visible=TRUE AND (owner_user_id=$2 OR owner_user_id IS NULL)`, categoryID, actor.ID).Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบหมวดหมู่ที่เปิดใช้งาน"})
	} else if err != nil {
		return fiber.NewError(500)
	}
	var token string
	for i := 0; i < 8; i++ {
		token, err = s.newShareToken()
		if err != nil {
			return fiber.NewError(500)
		}
		_, err = s.db.Exec(c.Context(), `INSERT INTO user_file_category_shares(category_id,owner_user_id,share_token,share_enabled,share_expires_at) VALUES($1,$2,$3,TRUE,$4) ON CONFLICT(owner_user_id,category_id) DO UPDATE SET share_token=EXCLUDED.share_token,share_enabled=TRUE,share_expires_at=EXCLUDED.share_expires_at,updated_at=NOW()`, categoryID, actor.ID, token, expiresAt)
		if err == nil {
			break
		}
		if !strings.Contains(strings.ToLower(err.Error()), "unique") {
			return fiber.NewError(500)
		}
		token = ""
	}
	if token == "" {
		return fiber.NewError(500)
	}
	cat.ShareEnabled = true
	cat.ShareExpiresAt = expiresAt
	cat.ShareURL = publicUserFileCategorySharePath(token)
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file_category.shared", Target: "user_file_category", TargetID: strconv.Itoa(categoryID)})
	return c.JSON(fiber.Map{"item": cat, "shareUrl": cat.ShareURL, "expiresAt": expiresAt})
}

func (s *server) revokeOwnUserFileCategoryShare(c *fiber.Ctx) error {
	actor := current(c)
	categoryID, err := strconv.Atoi(c.Params("id"))
	if err != nil || categoryID <= 0 {
		return c.Status(400).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง"})
	}
	tag, err := s.db.Exec(c.Context(), `UPDATE user_file_category_shares SET share_enabled=FALSE,share_token=$1,share_expires_at=NULL,updated_at=NOW() WHERE category_id=$2 AND owner_user_id=$3`, "revoked-"+strconv.FormatInt(time.Now().UnixNano(), 10), categoryID, actor.ID)
	if err != nil {
		return fiber.NewError(500)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(404).JSON(apiError{Error: "ไม่พบลิงก์แชร์หมวดหมู่นี้"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file_category.share_revoked", Target: "user_file_category", TargetID: strconv.Itoa(categoryID)})
	return c.SendStatus(204)
}

func (s *server) createOwnUserFileFolderShare(c *fiber.Ctx) error {
	return s.createFolderShare(c, false)
}

func (s *server) createAdminUserFileFolderShare(c *fiber.Ctx) error {
	return s.createFolderShare(c, true)
}

func (s *server) revokeOwnUserFileFolderShare(c *fiber.Ctx) error {
	return s.revokeFolderShare(c, false)
}

func (s *server) revokeAdminUserFileFolderShare(c *fiber.Ctx) error {
	return s.revokeFolderShare(c, true)
}

// createFolderShare makes (or renews) the link for one folder. A user can share only
// a folder they own in a category they can use; an admin share covers every owner's
// files in the folder, like an admin category share.
func (s *server) createFolderShare(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	folderID, err := strconv.Atoi(c.Params("id"))
	if err != nil || folderID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
	}
	var body struct {
		ExpiresIn string `json:"expiresIn"`
	}
	_ = c.BodyParser(&body)
	expiresAt, err := parseShareExpiresIn(body.ExpiresIn, time.Now())
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error()})
	}

	var visible bool
	query := `SELECT fo.is_visible FROM user_file_folders fo JOIN user_file_categories cat ON cat.id = fo.category_id WHERE fo.id=$1`
	args := []any{folderID}
	if !asAdmin {
		query += ` AND fo.owner_user_id=$2 AND (cat.owner_user_id=$2 OR (cat.owner_user_id IS NULL AND cat.is_visible=TRUE))`
		args = append(args, actor.ID)
	}
	if err := s.db.QueryRow(c.Context(), query, args...).Scan(&visible); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "folder_not_found"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !visible {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "แฟ้มนี้ถูกซ่อนอยู่ เปิดการแสดงก่อนแชร์", Code: "folder_hidden"})
	}

	var token string
	for i := 0; i < 8; i++ {
		token, err = s.newShareToken()
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if asAdmin {
			_, err = s.db.Exec(c.Context(), `INSERT INTO user_file_folder_shares(folder_id,owner_user_id,is_admin_share,share_token,share_enabled,share_expires_at) VALUES($1,NULL,TRUE,$2,TRUE,$3) ON CONFLICT (folder_id) WHERE is_admin_share=TRUE DO UPDATE SET share_token=EXCLUDED.share_token,share_enabled=TRUE,share_expires_at=EXCLUDED.share_expires_at,updated_at=NOW()`, folderID, token, expiresAt)
		} else {
			_, err = s.db.Exec(c.Context(), `INSERT INTO user_file_folder_shares(folder_id,owner_user_id,share_token,share_enabled,share_expires_at) VALUES($1,$2,$3,TRUE,$4) ON CONFLICT (folder_id,owner_user_id) DO UPDATE SET share_token=EXCLUDED.share_token,share_enabled=TRUE,share_expires_at=EXCLUDED.share_expires_at,updated_at=NOW()`, folderID, actor.ID, token, expiresAt)
		}
		if err == nil {
			break
		}
		if !strings.Contains(strings.ToLower(err.Error()), "unique") {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		token = ""
	}
	if token == "" {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file_folder.shared", Target: "user_file_folder", TargetID: strconv.Itoa(folderID), Metadata: map[string]any{"admin": asAdmin}})
	return c.JSON(fiber.Map{"shareUrl": publicUserFileCategorySharePath(token), "expiresAt": expiresAt})
}

func (s *server) revokeFolderShare(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	folderID, err := strconv.Atoi(c.Params("id"))
	if err != nil || folderID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
	}
	query := `UPDATE user_file_folder_shares SET share_enabled=FALSE,share_token=$1,share_expires_at=NULL,updated_at=NOW() WHERE folder_id=$2 AND share_enabled=TRUE`
	args := []any{"revoked-" + strconv.FormatInt(time.Now().UnixNano(), 10), folderID}
	if asAdmin {
		query += ` AND is_admin_share=TRUE`
	} else {
		query += ` AND owner_user_id=$3`
		args = append(args, actor.ID)
	}
	tag, err := s.db.Exec(c.Context(), query, args...)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบลิงก์แชร์แฟ้มนี้", Code: "share_not_found"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "files", Action: "user_file_folder.share_revoked", Target: "user_file_folder", TargetID: strconv.Itoa(folderID), Metadata: map[string]any{"admin": asAdmin}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) loadPublicSharedCategory(c *fiber.Ctx, token string) (*publicSharedCategory, error) {
	if !validShareToken(token) {
		return nil, c.Status(404).JSON(apiError{Error: "ไม่พบลิงก์นี้"})
	}
	item := &publicSharedCategory{}
	err := s.db.QueryRow(c.Context(), `SELECT s.category_id,COALESCE(s.owner_user_id,0),s.is_admin_share,c.name,s.share_expires_at FROM user_file_category_shares s JOIN user_file_categories c ON c.id=s.category_id WHERE s.share_token=$1 AND s.share_enabled=TRUE AND (s.share_expires_at IS NULL OR s.share_expires_at>NOW())`, token).Scan(&item.CategoryID, &item.OwnerID, &item.IsAdmin, &item.Name, &item.ExpiresAt)
	if err == nil {
		return item, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(500)
	}

	// A folder share opens the same page, limited to that folder and its visible subfolders.
	var rootID int
	err = s.db.QueryRow(c.Context(), `
		SELECT fo.category_id, COALESCE(s.owner_user_id,0), s.is_admin_share, fo.name, s.share_expires_at, fo.id, fo.password_hash IS NOT NULL
		FROM user_file_folder_shares s
		JOIN user_file_folders fo ON fo.id = s.folder_id
		WHERE s.share_token=$1 AND s.share_enabled=TRUE AND (s.share_expires_at IS NULL OR s.share_expires_at>NOW())
		  AND fo.is_visible=TRUE AND (s.is_admin_share OR fo.owner_user_id = s.owner_user_id)`, token).
		Scan(&item.CategoryID, &item.OwnerID, &item.IsAdmin, &item.Name, &item.ExpiresAt, &rootID, &item.RootLocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, c.Status(404).JSON(apiError{Error: "ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว"})
	}
	if err != nil {
		return nil, fiber.NewError(500)
	}
	rows, err := s.db.Query(c.Context(), `
		WITH RECURSIVE tree AS (
			SELECT id FROM user_file_folders WHERE id=$1
			UNION
			SELECT f.id FROM user_file_folders f JOIN tree t ON f.parent_id = t.id
			WHERE f.is_visible=TRUE AND ($2 OR f.owner_user_id=$3)
		)
		SELECT id FROM tree`, rootID, item.IsAdmin, item.OwnerID)
	if err != nil {
		return nil, fiber.NewError(500)
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, fiber.NewError(500)
		}
		item.FolderIDs = append(item.FolderIDs, id)
	}
	if rows.Err() != nil {
		return nil, fiber.NewError(500)
	}
	item.RootFolderID = &rootID
	return item, nil
}

// reRootSharedFolder presents a folder share as if the shared folder were the category:
// its own files become loose files and its subfolders become top-level. A password on the
// shared folder keeps it in the list so visitors can still unlock it.
func reRootSharedFolder(share *publicSharedCategory, folders []publicSharedCategoryFolder, files []publicSharedCategoryFile) ([]publicSharedCategoryFolder, []publicSharedCategoryFile) {
	if share.RootFolderID == nil {
		return folders, files
	}
	root := *share.RootFolderID
	out := make([]publicSharedCategoryFolder, 0, len(folders))
	for _, fo := range folders {
		switch {
		case fo.ID == root:
			if !share.RootLocked {
				continue
			}
			fo.ParentID = nil
		case fo.ParentID != nil && *fo.ParentID == root && !share.RootLocked:
			fo.ParentID = nil
		}
		out = append(out, fo)
	}
	if !share.RootLocked {
		for i := range files {
			if files[i].FolderID != nil && *files[i].FolderID == root {
				files[i].FolderID = nil
			}
		}
	}
	return out, files
}

func (s *server) getPublicSharedUserFileCategory(c *fiber.Ctx) error {
	item, err := s.loadPublicSharedCategory(c, strings.ToLower(strings.TrimSpace(c.Params("token"))))
	if item == nil {
		return err
	}

	// 1. Load Folders
	folderQuery := `
		SELECT fo.id, fo.name, fo.parent_id,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL AND f.is_visible=TRUE) AS file_count,
		       COUNT(DISTINCT sub.id) FILTER (WHERE sub.is_visible=TRUE) AS subfolder_count,
		       fo.password_hash IS NOT NULL,
		       fo.created_at
		FROM user_file_folders fo
		LEFT JOIN user_files f ON f.folder_id = fo.id
		LEFT JOIN user_file_folders sub ON sub.parent_id = fo.id
		WHERE fo.category_id=$1 AND fo.is_visible=TRUE
	`
	folderArgs := []any{item.CategoryID}
	if !item.IsAdmin {
		folderQuery += ` AND fo.owner_user_id=$2`
		folderArgs = append(folderArgs, item.OwnerID)
	}
	if item.RootFolderID != nil {
		folderArgs = append(folderArgs, item.FolderIDs)
		folderQuery += fmt.Sprintf(` AND fo.id = ANY($%d)`, len(folderArgs))
	}
	folderQuery += ` GROUP BY fo.id ORDER BY fo.sort_order ASC, fo.id ASC`

	folderRows, err := s.db.Query(c.Context(), folderQuery, folderArgs...)
	if err != nil {
		log.Printf("[getPublicSharedUserFileCategory] folders query error: %v", err)
		return fiber.NewError(500)
	}
	defer folderRows.Close()

	folders := make([]publicSharedCategoryFolder, 0)
	for folderRows.Next() {
		var fo publicSharedCategoryFolder
		if err := folderRows.Scan(&fo.ID, &fo.Name, &fo.ParentID, &fo.FileCount, &fo.SubfolderCount, &fo.PasswordRequired, &fo.CreatedAt); err != nil {
			log.Printf("[getPublicSharedUserFileCategory] folder scan error: %v", err)
			return fiber.NewError(500)
		}
		folders = append(folders, fo)
	}

	// 2. Load Files
	query := `SELECT public_id,original_name,content_type,size_bytes,folder_id,password_enabled,created_at FROM user_files WHERE category_id=$1 AND is_visible=TRUE AND deleted_at IS NULL`
	args := []any{item.CategoryID}
	if !item.IsAdmin {
		query += ` AND owner_user_id=$2`
		args = append(args, item.OwnerID)
	}
	if item.RootFolderID != nil {
		args = append(args, item.FolderIDs)
		query += fmt.Sprintf(` AND folder_id = ANY($%d)`, len(args))
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.Query(c.Context(), query, args...)
	if err != nil {
		return fiber.NewError(500)
	}
	defer rows.Close()

	files := make([]publicSharedCategoryFile, 0)
	for rows.Next() {
		var f publicSharedCategoryFile
		if err := rows.Scan(&f.ID, &f.Name, &f.ContentType, &f.Size, &f.FolderID, &f.PasswordRequired, &f.CreatedAt); err != nil {
			return fiber.NewError(500)
		}
		files = append(files, f)
	}
	folders, files = reRootSharedFolder(item, folders, files)
	scope := "category"
	if item.RootFolderID != nil {
		scope = "folder"
	}
	return c.JSON(fiber.Map{
		"name":      item.Name,
		"scope":     scope,
		"expiresAt": item.ExpiresAt,
		"fileCount": len(files),
		"folders":   folders,
		"files":     files,
	})
}

func (s *server) unlockPublicSharedUserCategoryFolder(c *fiber.Ctx) error {
	share, err := s.loadPublicSharedCategory(c, strings.ToLower(strings.TrimSpace(c.Params("token"))))
	if share == nil {
		return err
	}
	folderID, err := strconv.Atoi(c.Params("folderId"))
	if err != nil || folderID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
	}

	var passwordHash *string
	var passwordEnabled bool
	query := `SELECT password_enabled, password_hash FROM user_file_folders WHERE id=$1 AND category_id=$2 AND is_visible=TRUE`
	args := []any{folderID, share.CategoryID}
	if !share.IsAdmin {
		query += ` AND owner_user_id=$3`
		args = append(args, share.OwnerID)
	}
	if share.RootFolderID != nil {
		args = append(args, share.FolderIDs)
		query += fmt.Sprintf(` AND id = ANY($%d)`, len(args))
	}
	err = s.db.QueryRow(c.Context(), query, args...).Scan(&passwordEnabled, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มนี้", Code: "folder_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if !passwordEnabled || passwordHash == nil || *passwordHash == "" {
		return c.JSON(fiber.Map{"success": true, "folderId": folderID, "unlocked": true})
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil || strings.TrimSpace(body.Password) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านของแฟ้ม", Code: "password_required"})
	}

	if !s.verifyPassword(strings.TrimSpace(body.Password), *passwordHash) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "รหัสผ่านไม่ถูกต้อง", Code: "invalid_folder_password"})
	}

	return c.JSON(fiber.Map{"success": true, "folderId": folderID, "unlocked": true})
}

func (s *server) downloadPublicSharedUserCategoryFile(c *fiber.Ctx) error {
	share, err := s.loadPublicSharedCategory(c, strings.ToLower(strings.TrimSpace(c.Params("token"))))
	if share == nil {
		return err
	}
	var file publicSharedFile
	var folderID *int
	query := `SELECT original_name,content_type,size_bytes,object_key,folder_id,password_enabled,password_hash FROM user_files WHERE public_id=$1 AND category_id=$2 AND is_visible=TRUE AND deleted_at IS NULL`
	args := []any{c.Params("id"), share.CategoryID}
	if !share.IsAdmin {
		query += ` AND owner_user_id=$3`
		args = append(args, share.OwnerID)
	}
	if share.RootFolderID != nil {
		args = append(args, share.FolderIDs)
		query += fmt.Sprintf(` AND folder_id = ANY($%d)`, len(args))
	}
	err = s.db.QueryRow(c.Context(), query, args...).Scan(&file.Name, &file.ContentType, &file.Size, &file.ObjectKey, &folderID, &file.PasswordEnabled, &file.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบไฟล์ในหมวดหมู่นี้"})
	}
	if err != nil {
		return fiber.NewError(500)
	}

	// 1. Check folder password if file belongs to a password-protected folder
	if folderID != nil {
		var folderPwEnabled bool
		var folderPwHash *string
		folderQuery := `SELECT password_enabled, password_hash FROM user_file_folders WHERE id=$1 AND category_id=$2 AND is_visible=TRUE`
		folderArgs := []any{*folderID, share.CategoryID}
		if !share.IsAdmin {
			folderQuery += ` AND owner_user_id=$3`
			folderArgs = append(folderArgs, share.OwnerID)
		}
		fErr := s.db.QueryRow(c.Context(), folderQuery, folderArgs...).Scan(&folderPwEnabled, &folderPwHash)
		if errors.Is(fErr, pgx.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มของไฟล์นี้", Code: "folder_not_found"})
		}
		if fErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if folderPwEnabled && folderPwHash != nil && *folderPwHash != "" {
			folderPw := strings.TrimSpace(c.Query("folderPassword"))
			if folderPw == "" {
				folderPw = strings.TrimSpace(c.FormValue("folderPassword"))
			}
			if folderPw == "" {
				folderPw = s.extractDownloadPassword(c)
			}
			if !s.verifyPassword(folderPw, *folderPwHash) {
				return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ต้องระบุรหัสผ่านแฟ้มที่ถูกต้อง", Code: "folder_password_required"})
			}
		}
	}

	// 2. Check file password
	if file.PasswordEnabled {
		password := s.extractDownloadPassword(c)
		if password == "" || file.PasswordHash == nil || !s.verifyPassword(password, *file.PasswordHash) {
			return c.Status(403).JSON(apiError{Error: "ต้องระบุรหัสผ่านที่ถูกต้อง", Code: "file_password_required"})
		}
	}
	return s.sendUserFileObject(c, file.ObjectKey, file.Name, file.ContentType, file.Size, c.QueryBool("preview"))
}

// --- Folder CRUD Handlers ---

func (s *server) listUserFileFolders(c *fiber.Ctx) error {
	actor := current(c)
	categoryID, err := strconv.Atoi(c.Params("categoryId"))
	if err != nil || categoryID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง", Code: "invalid_category"})
	}

	var categoryAllowed bool
	if err := s.db.QueryRow(c.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM user_file_categories
			WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
		)
	`, categoryID, actor.ID).Scan(&categoryAllowed); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !categoryAllowed {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบหมวดหมู่ที่ระบุ", Code: "category_not_found"})
	}

	rows, err := s.db.Query(c.Context(), `
		SELECT fo.id, fo.category_id, c.name, fo.parent_id, fo.owner_user_id, fo.name, fo.sort_order, fo.is_visible,
		       fo.password_hash IS NOT NULL,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL AND f.owner_user_id=$2) AS file_count,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL AND f.is_visible = FALSE AND f.owner_user_id=$2) AS hidden_file_count,
		       COUNT(DISTINCT sub.id) FILTER (WHERE sub.owner_user_id=$2) AS subfolder_count,
		       fo.created_at, fo.updated_at,
		       COALESCE(sh.share_enabled,FALSE), sh.share_token, sh.share_expires_at
		FROM user_file_folders fo
		JOIN user_file_categories c ON c.id = fo.category_id
		LEFT JOIN user_files f ON f.folder_id = fo.id
		LEFT JOIN user_file_folders sub ON sub.parent_id = fo.id
		LEFT JOIN user_file_folder_shares sh ON sh.folder_id = fo.id AND sh.owner_user_id = $2
		WHERE fo.category_id = $1 AND fo.owner_user_id = $2
		GROUP BY fo.id, c.name, sh.share_enabled, sh.share_token, sh.share_expires_at
		ORDER BY fo.sort_order ASC, fo.id ASC
	`, categoryID, actor.ID)
	if err != nil {
		log.Printf("[listUserFileFolders] query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileFolder, 0)
	for rows.Next() {
		var f userFileFolder
		var shareToken *string
		if err := rows.Scan(
			&f.ID, &f.CategoryID, &f.CategoryName, &f.ParentID, &f.OwnerUserID, &f.Name, &f.SortOrder, &f.IsVisible,
			&f.PasswordEnabled, &f.FileCount, &f.HiddenFileCount, &f.SubfolderCount, &f.CreatedAt, &f.UpdatedAt,
			&f.ShareEnabled, &shareToken, &f.ShareExpiresAt,
		); err != nil {
			log.Printf("[listUserFileFolders] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		attachFolderShareState(&f, f.ShareEnabled, shareToken, f.ShareExpiresAt)
		if f.OwnerUserID == nil || *f.OwnerUserID != actor.ID {
			// Never expose another account's or a system-owned folder through
			// the personal folder endpoint.
			continue
		}
		items = append(items, f)
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) listAdminUserFileFolders(c *fiber.Ctx) error {
	categoryID, err := strconv.Atoi(c.Params("categoryId"))
	if err != nil || categoryID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง", Code: "invalid_category"})
	}

	rows, err := s.db.Query(c.Context(), `
		SELECT fo.id, fo.category_id, c.name, fo.parent_id, fo.owner_user_id, fo.name, fo.sort_order, fo.is_visible,
		       fo.password_hash IS NOT NULL,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL) AS file_count,
		       COUNT(DISTINCT f.public_id) FILTER (WHERE f.deleted_at IS NULL AND f.is_visible = FALSE) AS hidden_file_count,
		       COUNT(DISTINCT sub.id) AS subfolder_count,
		       fo.created_at, fo.updated_at,
		       COALESCE(sh.share_enabled,FALSE), sh.share_token, sh.share_expires_at
		FROM user_file_folders fo
		JOIN user_file_categories c ON c.id = fo.category_id
		LEFT JOIN user_files f ON f.folder_id = fo.id
		LEFT JOIN user_file_folders sub ON sub.parent_id = fo.id
		LEFT JOIN user_file_folder_shares sh ON sh.folder_id = fo.id AND sh.is_admin_share = TRUE
		WHERE fo.category_id = $1
		GROUP BY fo.id, c.name, sh.share_enabled, sh.share_token, sh.share_expires_at
		ORDER BY fo.sort_order ASC, fo.id ASC
	`, categoryID)
	if err != nil {
		log.Printf("[listAdminUserFileFolders] query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userFileFolder, 0)
	for rows.Next() {
		var f userFileFolder
		var shareToken *string
		if err := rows.Scan(
			&f.ID, &f.CategoryID, &f.CategoryName, &f.ParentID, &f.OwnerUserID, &f.Name, &f.SortOrder, &f.IsVisible,
			&f.PasswordEnabled, &f.FileCount, &f.HiddenFileCount, &f.SubfolderCount, &f.CreatedAt, &f.UpdatedAt,
			&f.ShareEnabled, &shareToken, &f.ShareExpiresAt,
		); err != nil {
			log.Printf("[listAdminUserFileFolders] scan error: %v", err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		attachFolderShareState(&f, f.ShareEnabled, shareToken, f.ShareExpiresAt)
		items = append(items, f)
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) createUserFileFolder(c *fiber.Ctx) error {
	return s.createFolderHandler(c, false)
}

func (s *server) createAdminUserFileFolder(c *fiber.Ctx) error {
	return s.createFolderHandler(c, true)
}

func (s *server) createFolderHandler(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	categoryID, err := strconv.Atoi(c.Params("categoryId"))
	if err != nil || categoryID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หมวดหมู่ไม่ถูกต้อง", Code: "invalid_category"})
	}

	var exists bool
	categoryCheck := `SELECT EXISTS(SELECT 1 FROM user_file_categories WHERE id=$1)`
	categoryArgs := []any{categoryID}
	if !asAdmin {
		categoryCheck = `
			SELECT EXISTS(
				SELECT 1 FROM user_file_categories
				WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
			)
		`
		categoryArgs = append(categoryArgs, actor.ID)
	}
	if err := s.db.QueryRow(c.Context(), categoryCheck, categoryArgs...).Scan(&exists); err != nil || !exists {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบหมวดหมู่ที่ระบุ", Code: "category_not_found"})
	}

	var body userFileFolderCreateRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}

	name := strings.TrimSpace(body.Name)
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อแฟ้ม", Code: "folder_name_required"})
	}
	if len([]rune(name)) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อแฟ้มต้องมีความยาวไม่เกิน 100 ตัวอักษร", Code: "folder_name_too_long"})
	}
	if strings.ContainsAny(name, `/\:*?"<>|`) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อแฟ้มมีอักขระที่ไม่อนุญาต", Code: "folder_name_invalid"})
	}

	var parentID *int
	if body.ParentID != nil && *body.ParentID > 0 {
		var parentCatID int
		var parentOwner *int64
		pErr := s.db.QueryRow(c.Context(), `SELECT category_id, owner_user_id FROM user_file_folders WHERE id=$1`, *body.ParentID).Scan(&parentCatID, &parentOwner)
		if pErr != nil || parentCatID != categoryID {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มหลักที่ระบุหรือแฟ้มไม่ได้อยู่ในหมวดหมู่เดียวกัน", Code: "invalid_parent_folder"})
		}
		if !asAdmin && (parentOwner == nil || *parentOwner != actor.ID) {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์สร้างแฟ้มย่อยในแฟ้มนี้", Code: "parent_folder_forbidden"})
		}
		parentID = body.ParentID
	}

	isVisible := true
	if body.IsVisible != nil {
		isVisible = *body.IsVisible
	}

	var passwordHash *string
	if body.PasswordEnabled && body.Password != nil && strings.TrimSpace(*body.Password) != "" {
		pw := strings.TrimSpace(*body.Password)
		if msg := validatePasswordPolicy(pw); msg != "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
		}
		hash, err := s.hashPassword(pw)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		passwordHash = &hash
	}

	var ownerUserID *int64
	if !asAdmin {
		ownerUserID = &actor.ID
	}

	var folder userFileFolder
	err = s.db.QueryRow(c.Context(), `
		INSERT INTO user_file_folders (category_id, parent_id, owner_user_id, name, sort_order, is_visible, password_enabled, password_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, category_id, parent_id, owner_user_id, name, sort_order, is_visible, password_hash IS NOT NULL, created_at, updated_at
	`, categoryID, parentID, ownerUserID, name, body.SortOrder, isVisible, passwordHash != nil, passwordHash).Scan(
		&folder.ID, &folder.CategoryID, &folder.ParentID, &folder.OwnerUserID, &folder.Name, &folder.SortOrder, &folder.IsVisible, &folder.PasswordEnabled, &folder.CreatedAt, &folder.UpdatedAt,
	)
	if err != nil {
		log.Printf("[createFolderHandler] insert error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file_folder.created",
		Target: "user_file_folder", TargetID: strconv.Itoa(folder.ID),
		Metadata: map[string]any{"name": folder.Name, "categoryId": categoryID, "parentId": parentID, "asAdmin": asAdmin},
	})
	return c.Status(fiber.StatusCreated).JSON(folder)
}

func (s *server) updateUserFileFolder(c *fiber.Ctx) error {
	return s.updateFolderHandler(c, false)
}

func (s *server) updateAdminUserFileFolder(c *fiber.Ctx) error {
	return s.updateFolderHandler(c, true)
}

func (s *server) updateFolderHandler(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	folderID, err := strconv.Atoi(c.Params("id"))
	if err != nil || folderID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
	}

	var ownerID *int64
	var currentCategoryID int
	err = s.db.QueryRow(c.Context(), `SELECT owner_user_id, category_id FROM user_file_folders WHERE id=$1`, folderID).Scan(&ownerID, &currentCategoryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "folder_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if !asAdmin && (ownerID == nil || *ownerID != actor.ID) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์แก้ไขแฟ้มนี้", Code: "folder_access_denied"})
	}

	var body userFileFolderUpdateRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}

	sets := make([]string, 0, 5)
	args := make([]any, 0, 5)
	argN := 1

	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อแฟ้ม", Code: "folder_name_required"})
		}
		if len([]rune(name)) > 100 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อแฟ้มต้องมีความยาวไม่เกิน 100 ตัวอักษร", Code: "folder_name_too_long"})
		}
		if strings.ContainsAny(name, `/\:*?"<>|`) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อแฟ้มมีอักขระที่ไม่อนุญาต", Code: "folder_name_invalid"})
		}
		sets = append(sets, fmt.Sprintf("name=$%d", argN))
		args = append(args, name)
		argN++
	}

	if body.SortOrder != nil {
		sets = append(sets, fmt.Sprintf("sort_order=$%d", argN))
		args = append(args, *body.SortOrder)
		argN++
	}

	if body.IsVisible != nil {
		sets = append(sets, fmt.Sprintf("is_visible=$%d", argN))
		args = append(args, *body.IsVisible)
		argN++
	}

	if body.ClearParent {
		sets = append(sets, "parent_id=NULL")
	} else if body.ParentID != nil {
		if *body.ParentID == folderID {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถย้ายแฟ้มไปอยู่ใต้ตัวเองได้", Code: "invalid_parent_folder"})
		}
		if *body.ParentID > 0 {
			var pCatID int
			var parentOwnerID *int64
			pErr := s.db.QueryRow(c.Context(), `SELECT category_id, owner_user_id FROM user_file_folders WHERE id=$1`, *body.ParentID).Scan(&pCatID, &parentOwnerID)
			if pErr != nil || pCatID != currentCategoryID {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มหลักที่ระบุ", Code: "invalid_parent_folder"})
			}
			if !asAdmin && (parentOwnerID == nil || *parentOwnerID != actor.ID) {
				return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ย้ายแฟ้มเข้าแฟ้มหลักนี้", Code: "parent_folder_forbidden"})
			}
			// Check circular reference
			var isDescendant bool
			_ = s.db.QueryRow(c.Context(), `
				WITH RECURSIVE subfolders AS (
					SELECT id FROM user_file_folders WHERE id = $1
					UNION ALL
					SELECT f.id FROM user_file_folders f
					INNER JOIN subfolders s ON f.parent_id = s.id
				)
				SELECT EXISTS(SELECT 1 FROM subfolders WHERE id = $2)
			`, folderID, *body.ParentID).Scan(&isDescendant)
			if isDescendant {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถย้ายแฟ้มไปอยู่ใต้แฟ้มย่อยของตัวเองได้", Code: "circular_folder_reference"})
			}
			sets = append(sets, fmt.Sprintf("parent_id=$%d", argN))
			args = append(args, *body.ParentID)
			argN++
		} else {
			sets = append(sets, "parent_id=NULL")
		}
	}

	if body.PasswordEnabled != nil {
		if !*body.PasswordEnabled {
			sets = append(sets, "password_enabled=FALSE", "password_hash=NULL")
		} else {
			password := ""
			if body.Password != nil {
				password = strings.TrimSpace(*body.Password)
			}
			if password == "" {
				var hasHash bool
				_ = s.db.QueryRow(c.Context(), `SELECT password_hash IS NOT NULL AND password_hash <> '' FROM user_file_folders WHERE id=$1`, folderID).Scan(&hasHash)
				if !hasHash {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อคแฟ้ม", Code: "password_required"})
				}
				sets = append(sets, "password_enabled=TRUE")
			} else {
				if msg := validatePasswordPolicy(password); msg != "" {
					return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
				}
				hash, hashErr := s.hashPassword(password)
				if hashErr != nil {
					return fiber.NewError(fiber.StatusInternalServerError)
				}
				sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
				args = append(args, hash)
				argN++
			}
		}
	} else if body.Password != nil {
		password := strings.TrimSpace(*body.Password)
		if password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัสผ่าน", Code: "password_required"})
		}
		if msg := validatePasswordPolicy(password); msg != "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: msg, Code: "invalid_password"})
		}
		hash, hashErr := s.hashPassword(password)
		if hashErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		sets = append(sets, "password_enabled=TRUE", fmt.Sprintf("password_hash=$%d", argN))
		args = append(args, hash)
		argN++
	}

	if len(sets) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่มีข้อมูลที่จะอัปเดต", Code: "no_updates"})
	}

	sets = append(sets, "updated_at=NOW()")
	where := fmt.Sprintf("id=$%d", argN)
	args = append(args, folderID)
	argN++
	if !asAdmin {
		where += fmt.Sprintf(" AND owner_user_id=$%d", argN)
		args = append(args, actor.ID)
	}
	query := fmt.Sprintf("UPDATE user_file_folders SET %s WHERE %s RETURNING id, category_id, parent_id, owner_user_id, name, sort_order, is_visible, password_hash IS NOT NULL, created_at, updated_at", strings.Join(sets, ", "), where)

	var folder userFileFolder
	err = s.db.QueryRow(c.Context(), query, args...).Scan(
		&folder.ID, &folder.CategoryID, &folder.ParentID, &folder.OwnerUserID, &folder.Name, &folder.SortOrder, &folder.IsVisible, &folder.PasswordEnabled, &folder.CreatedAt, &folder.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "folder_not_found"})
	}
	if err != nil {
		log.Printf("[updateFolderHandler] update error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file_folder.updated",
		Target: "user_file_folder", TargetID: strconv.Itoa(folder.ID),
		Metadata: map[string]any{"name": folder.Name, "asAdmin": asAdmin},
	})
	return c.JSON(folder)
}

func (s *server) deleteUserFileFolder(c *fiber.Ctx) error {
	return s.deleteFolderHandler(c, false)
}

func (s *server) deleteAdminUserFileFolder(c *fiber.Ctx) error {
	return s.deleteFolderHandler(c, true)
}

func (s *server) deleteFolderHandler(c *fiber.Ctx, asAdmin bool) error {
	actor := current(c)
	folderID, err := strconv.Atoi(c.Params("id"))
	if err != nil || folderID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แฟ้มไม่ถูกต้อง", Code: "invalid_folder"})
	}

	var ownerID *int64
	var folderName string
	err = s.db.QueryRow(c.Context(), `SELECT owner_user_id, name FROM user_file_folders WHERE id=$1`, folderID).Scan(&ownerID, &folderName)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "folder_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if !asAdmin && (ownerID == nil || *ownerID != actor.ID) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ลบแฟ้มนี้", Code: "folder_access_denied"})
	}

	deleteFiles := c.QueryBool("deleteFiles")
	if deleteFiles {
		// 1. Delete all files in this folder AND all descendant subfolders (and storage objects)
		deleteQuery := `
			WITH RECURSIVE all_folders AS (
				SELECT id FROM user_file_folders WHERE id=$1
				UNION ALL
				SELECT f.id FROM user_file_folders f
				JOIN all_folders a ON f.parent_id = a.id
			)
			SELECT public_id, object_key FROM user_files WHERE folder_id IN (SELECT id FROM all_folders) AND deleted_at IS NULL
		`
		deleteArgs := []any{folderID}
		if !asAdmin {
			deleteQuery = `
				WITH RECURSIVE all_folders AS (
					SELECT id FROM user_file_folders WHERE id=$1 AND owner_user_id=$2
					UNION ALL
					SELECT f.id FROM user_file_folders f
					JOIN all_folders a ON f.parent_id = a.id
					WHERE f.owner_user_id=$2
				)
				SELECT public_id, object_key FROM user_files
				WHERE folder_id IN (SELECT id FROM all_folders) AND owner_user_id=$2 AND deleted_at IS NULL
			`
			deleteArgs = append(deleteArgs, actor.ID)
		}
		rows, err := s.db.Query(c.Context(), deleteQuery, deleteArgs...)
		if err == nil {
			var publicIDs []string
			for rows.Next() {
				var pID, objKey string
				if err := rows.Scan(&pID, &objKey); err == nil {
					publicIDs = append(publicIDs, pID)
					if s.storage != nil && objKey != "" {
						_ = s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, objKey, minio.RemoveObjectOptions{})
					}
				}
			}
			rows.Close()
			if len(publicIDs) > 0 {
				_, _ = s.db.Exec(c.Context(), `
					UPDATE user_files
					SET deleted_at=NOW(), share_enabled=FALSE, share_token=NULL, share_expires_at=NULL
					WHERE public_id = ANY($1)
				`, publicIDs)
			}
		}
	} else {
		// 2. Promote child subfolders and files to this folder's parent
		var currentParentID *int
		if asAdmin {
			_ = s.db.QueryRow(c.Context(), `SELECT parent_id FROM user_file_folders WHERE id=$1`, folderID).Scan(&currentParentID)
			_, _ = s.db.Exec(c.Context(), `UPDATE user_file_folders SET parent_id=$1 WHERE parent_id=$2`, currentParentID, folderID)
			_, _ = s.db.Exec(c.Context(), `UPDATE user_files SET folder_id=$1 WHERE folder_id=$2`, currentParentID, folderID)
		} else {
			_ = s.db.QueryRow(c.Context(), `
				SELECT CASE WHEN parent.owner_user_id=$2 THEN folder.parent_id ELSE NULL END
				FROM user_file_folders folder
				LEFT JOIN user_file_folders parent ON parent.id=folder.parent_id
				WHERE folder.id=$1 AND folder.owner_user_id=$2
			`, folderID, actor.ID).Scan(&currentParentID)
			_, _ = s.db.Exec(c.Context(), `UPDATE user_file_folders SET parent_id=$1 WHERE parent_id=$2 AND owner_user_id=$3`, currentParentID, folderID, actor.ID)
			_, _ = s.db.Exec(c.Context(), `UPDATE user_files SET folder_id=$1 WHERE folder_id=$2 AND owner_user_id=$3`, currentParentID, folderID, actor.ID)
		}
	}

	deleteFolderQuery := `DELETE FROM user_file_folders WHERE id=$1`
	deleteFolderArgs := []any{folderID}
	if !asAdmin {
		// Legacy data may contain cross-owner nesting from the old permissive
		// checks. Detach those folders before deleting so the FK cascade cannot
		// remove another account's folder tree.
		_, _ = s.db.Exec(c.Context(), `
			WITH RECURSIVE owned_folders AS (
				SELECT id FROM user_file_folders WHERE id=$1 AND owner_user_id=$2
				UNION ALL
				SELECT child.id FROM user_file_folders child
				JOIN owned_folders parent ON child.parent_id=parent.id
				WHERE child.owner_user_id=$2
			)
			UPDATE user_file_folders
			SET parent_id=NULL, updated_at=NOW()
			WHERE parent_id IN (SELECT id FROM owned_folders)
			  AND owner_user_id IS DISTINCT FROM $2
		`, folderID, actor.ID)
		deleteFolderQuery += ` AND owner_user_id=$2`
		deleteFolderArgs = append(deleteFolderArgs, actor.ID)
	}
	_, err = s.db.Exec(c.Context(), deleteFolderQuery, deleteFolderArgs...)
	if err != nil {
		log.Printf("[deleteFolderHandler] delete error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file_folder.deleted",
		Target: "user_file_folder", TargetID: strconv.Itoa(folderID),
		Metadata: map[string]any{"name": folderName, "deleteFiles": deleteFiles, "asAdmin": asAdmin},
	})
	return c.JSON(fiber.Map{"success": true})
}

// --- Batch File Operations ---

type batchFilesRequest struct {
	IDs []string `json:"ids"`
}

type batchCategoryRequest struct {
	IDs           []string `json:"ids"`
	CategoryID    *int     `json:"categoryId"`
	ClearCategory bool     `json:"clearCategory"`
}

type batchVisibilityRequest struct {
	IDs       []string `json:"ids"`
	IsVisible bool     `json:"isVisible"`
}

func (s *server) batchDeleteUserFiles(c *fiber.Ctx, admin bool) error {
	actor := current(c)
	var body batchFilesRequest
	if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}
	if len(body.IDs) > 500 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกไฟล์ได้สูงสุดไม่เกิน 500 รายการต่อครั้ง", Code: "too_many_items"})
	}

	cleanIDs := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id != "" {
			cleanIDs = append(cleanIDs, id)
		}
	}
	if len(cleanIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}

	query := `SELECT public_id, owner_user_id, object_key, original_name FROM user_files WHERE public_id = ANY($1) AND deleted_at IS NULL`
	if !admin {
		query += fmt.Sprintf(" AND owner_user_id = %d", actor.ID)
	}

	rows, err := s.db.Query(c.Context(), query, cleanIDs)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	type fileToDelete struct {
		publicID  string
		ownerID   int64
		objectKey string
		name      string
	}
	var files []fileToDelete
	for rows.Next() {
		var f fileToDelete
		if err := rows.Scan(&f.publicID, &f.ownerID, &f.objectKey, &f.name); err == nil {
			files = append(files, f)
		}
	}

	if len(files) == 0 {
		return c.JSON(fiber.Map{"deletedCount": 0})
	}

	matchedIDs := make([]string, 0, len(files))
	for _, f := range files {
		matchedIDs = append(matchedIDs, f.publicID)
		if s.storage != nil && f.objectKey != "" {
			_ = s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, f.objectKey, minio.RemoveObjectOptions{})
		}
	}

	updateQuery := `
		UPDATE user_files
		SET deleted_at = NOW(), share_enabled = FALSE, share_token = NULL, share_expires_at = NULL
		WHERE public_id = ANY($1) AND deleted_at IS NULL
	`
	if !admin {
		updateQuery += fmt.Sprintf(" AND owner_user_id = %d", actor.ID)
	}
	res, err := s.db.Exec(c.Context(), updateQuery, matchedIDs)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.batch_deleted",
		Target: "user_files", TargetID: fmt.Sprintf("%d files", res.RowsAffected()),
		Metadata: map[string]any{"count": res.RowsAffected(), "asAdmin": admin},
	})

	return c.JSON(fiber.Map{"deletedCount": res.RowsAffected()})
}

func (s *server) batchDeleteOwnUserFiles(c *fiber.Ctx) error {
	return s.batchDeleteUserFiles(c, false)
}

func (s *server) batchDeleteAdminUserFiles(c *fiber.Ctx) error {
	return s.batchDeleteUserFiles(c, true)
}

func (s *server) batchUpdateUserFilesCategory(c *fiber.Ctx, admin bool) error {
	actor := current(c)
	var body batchCategoryRequest
	if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}
	cleanIDs := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id != "" {
			cleanIDs = append(cleanIDs, id)
		}
	}
	if len(cleanIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}

	var targetCatID any = nil
	if !body.ClearCategory && body.CategoryID != nil && *body.CategoryID > 0 {
		var exists bool
		categoryCheck := `SELECT EXISTS(SELECT 1 FROM user_file_categories WHERE id=$1)`
		categoryArgs := []any{*body.CategoryID}
		if !admin {
			categoryCheck = `
				SELECT EXISTS(
					SELECT 1 FROM user_file_categories
					WHERE id=$1 AND (owner_user_id=$2 OR (owner_user_id IS NULL AND is_visible=TRUE))
				)
			`
			categoryArgs = append(categoryArgs, actor.ID)
		}
		if err := s.db.QueryRow(c.Context(), categoryCheck, categoryArgs...).Scan(&exists); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if !exists {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบหมวดหมู่ที่เลือก", Code: "invalid_category"})
		}
		targetCatID = *body.CategoryID
	}

	query := `UPDATE user_files SET category_id = $1, folder_id = NULL WHERE public_id = ANY($2) AND deleted_at IS NULL`
	if !admin {
		query += fmt.Sprintf(" AND owner_user_id = %d", actor.ID)
	}

	res, err := s.db.Exec(c.Context(), query, targetCatID, cleanIDs)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.batch_category_updated",
		Target: "user_files", TargetID: fmt.Sprintf("%d files", res.RowsAffected()),
		Metadata: map[string]any{"count": res.RowsAffected(), "asAdmin": admin, "categoryId": targetCatID},
	})

	return c.JSON(fiber.Map{"updatedCount": res.RowsAffected()})
}

func (s *server) batchUpdateOwnUserFilesCategory(c *fiber.Ctx) error {
	return s.batchUpdateUserFilesCategory(c, false)
}

func (s *server) batchUpdateAdminUserFilesCategory(c *fiber.Ctx) error {
	return s.batchUpdateUserFilesCategory(c, true)
}

func (s *server) batchUpdateUserFilesFolder(c *fiber.Ctx, admin bool) error {
	actor := current(c)
	var body batchFolderRequest
	if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}
	cleanIDs := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id != "" {
			cleanIDs = append(cleanIDs, id)
		}
	}
	if len(cleanIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}

	if body.ClearFolder || body.FolderID == nil || *body.FolderID <= 0 {
		query := `UPDATE user_files SET folder_id = NULL WHERE public_id = ANY($1) AND deleted_at IS NULL`
		if !admin {
			query += fmt.Sprintf(" AND owner_user_id = %d", actor.ID)
		}
		res, err := s.db.Exec(c.Context(), query, cleanIDs)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		s.audit(c, auditEvent{
			Actor: actor, Category: "files", Action: "user_file.batch_folder_updated",
			Target: "user_files", TargetID: fmt.Sprintf("%d files", res.RowsAffected()),
			Metadata: map[string]any{"count": res.RowsAffected(), "asAdmin": admin, "folderId": nil},
		})
		return c.JSON(fiber.Map{"updatedCount": res.RowsAffected()})
	}

	// Verify folder exists and get its category ID
	var folderCatID int
	folderCheckQuery := `SELECT category_id FROM user_file_folders WHERE id=$1`
	folderCheckArgs := []any{*body.FolderID}
	if !admin {
		folderCheckQuery += ` AND owner_user_id=$2`
		folderCheckArgs = append(folderCheckArgs, actor.ID)
	}
	err := s.db.QueryRow(c.Context(), folderCheckQuery, folderCheckArgs...).Scan(&folderCatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบแฟ้มที่ระบุ", Code: "invalid_folder"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Update folder and sync category
	query := `UPDATE user_files SET folder_id = $1, category_id = $2 WHERE public_id = ANY($3) AND deleted_at IS NULL`
	if !admin {
		query += fmt.Sprintf(" AND owner_user_id = %d", actor.ID)
	}

	res, err := s.db.Exec(c.Context(), query, *body.FolderID, folderCatID, cleanIDs)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.batch_folder_updated",
		Target: "user_files", TargetID: fmt.Sprintf("%d files", res.RowsAffected()),
		Metadata: map[string]any{"count": res.RowsAffected(), "asAdmin": admin, "folderId": *body.FolderID, "categoryId": folderCatID},
	})

	return c.JSON(fiber.Map{"updatedCount": res.RowsAffected()})
}

func (s *server) batchUpdateOwnUserFilesFolder(c *fiber.Ctx) error {
	return s.batchUpdateUserFilesFolder(c, false)
}

func (s *server) batchUpdateAdminUserFilesFolder(c *fiber.Ctx) error {
	return s.batchUpdateUserFilesFolder(c, true)
}

func (s *server) batchUpdateAdminUserFilesVisibility(c *fiber.Ctx) error {
	actor := current(c)
	var body batchVisibilityRequest
	if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}
	cleanIDs := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id != "" {
			cleanIDs = append(cleanIDs, id)
		}
	}
	if len(cleanIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์อย่างน้อย 1 รายการ", Code: "empty_selection"})
	}

	res, err := s.db.Exec(c.Context(), `UPDATE user_files SET is_visible = $1 WHERE public_id = ANY($2) AND deleted_at IS NULL`, body.IsVisible, cleanIDs)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "files", Action: "user_file.batch_visibility_updated",
		Target: "user_files", TargetID: fmt.Sprintf("%d files", res.RowsAffected()),
		Metadata: map[string]any{"count": res.RowsAffected(), "isVisible": body.IsVisible},
	})

	return c.JSON(fiber.Map{"updatedCount": res.RowsAffected()})
}
