package main

// The code of a bot: zip upload, GitHub download, starter templates and the in-browser editor.
// Every way in ends as a cleaned file map stored as one zip (bots/<id>/<random>.zip); the
// worker installs packages and runs it.

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

const (
	botSourceCompressedLimit   = int64(50 * 1024 * 1024)
	botSourceUncompressedLimit = int64(200 * 1024 * 1024)
	botFileCountLimit          = 5000
	botEditorLimit             = 1024 * 1024
)

var (
	githubRepoPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$`)
	githubRefPattern  = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,120}$`)
)

// botSourceReport tells the owner what was left out of an upload.
type botSourceReport struct {
	Files        int      `json:"files"`
	Skipped      int      `json:"skipped"`
	EnvDropped   bool     `json:"envDropped"`
	EnvNames     []string `json:"envNames"`
	EntryFile    string   `json:"entryFile,omitempty"`
	EntryMissing bool     `json:"entryMissing"`
}

// Folders that are rebuilt on the server or only matter on the owner's machine.
var botSkippedDirs = map[string]bool{
	"node_modules": true, "__pycache__": true, ".git": true, ".venv": true, "venv": true,
	".idea": true, ".vscode": true, ".deps": true, ".mypy_cache": true, ".pytest_cache": true,
}

var botSkippedFiles = map[string]bool{".ds_store": true, "thumbs.db": true, "desktop.ini": true}

func botSkippedPath(name string) bool {
	parts := strings.Split(strings.ToLower(name), "/")
	for _, part := range parts[:len(parts)-1] {
		if botSkippedDirs[part] {
			return true
		}
	}
	last := parts[len(parts)-1]
	return botSkippedDirs[last] || botSkippedFiles[last] ||
		last == "dockerfile" || last == "docker-compose.yml" || last == "compose.yml"
}

func isEnvFileName(name string) bool {
	base := strings.ToLower(path.Base(name))
	return base == ".env" || strings.HasPrefix(base, ".env.")
}

// envNames lists the variable names in a .env file, never the values.
func envNames(data []byte) []string {
	names := make([]string, 0)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "export "))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, _, found := strings.Cut(line, "=")
		name = strings.TrimSpace(name)
		if found && hostingEnvironmentNamePattern.MatchString(name) {
			names = append(names, name)
		}
	}
	return names
}

// cleanBotSource drops what must not or need not be stored and reports it.
func cleanBotSource(files map[string]sourceFile) (map[string]sourceFile, botSourceReport, error) {
	files = flattenCommonSourceRoot(files)
	report := botSourceReport{EnvNames: []string{}}
	clean := make(map[string]sourceFile, len(files))
	var total int64
	for name, file := range files {
		canonical, ok := canonicalWorkspacePath(name, false)
		if !ok || canonical == "" {
			return nil, report, errors.New("ไฟล์ ZIP มีชื่อไฟล์ที่ไม่ปลอดภัย")
		}
		if isEnvFileName(canonical) {
			if !file.IsDir {
				report.EnvDropped = true
				report.EnvNames = append(report.EnvNames, envNames(file.Data)...)
			}
			continue
		}
		if botSkippedPath(canonical) || strings.HasPrefix(strings.ToLower(canonical), ".git/") {
			if !file.IsDir {
				report.Skipped++
			}
			continue
		}
		if !file.IsDir {
			total += int64(len(file.Data))
			report.Files++
		}
		clean[canonical] = file
	}
	if report.Files == 0 {
		return nil, report, errors.New("ไม่พบไฟล์โค้ดใน ZIP นี้")
	}
	if report.Files > botFileCountLimit {
		return nil, report, fmt.Errorf("ไฟล์เยอะเกินไป (เกิน %d ไฟล์) ลบ node_modules หรือไฟล์ที่ไม่ใช้ก่อนบีบอัด", botFileCountLimit)
	}
	if total > botSourceUncompressedLimit {
		return nil, report, errors.New("โค้ดรวมกันใหญ่เกิน 200 MB")
	}
	sort.Strings(report.EnvNames)
	return clean, report, nil
}

// parseSourceZip reads a zip into memory with the same checks as the hosting file manager.
func parseSourceZip(data []byte) (map[string]sourceFile, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("เปิดไฟล์ ZIP ไม่ได้ ไฟล์อาจเสีย")
	}
	if len(reader.File) > botFileCountLimit*4 {
		return nil, errors.New("ไฟล์ใน ZIP เยอะเกินไป")
	}
	files := make(map[string]sourceFile, len(reader.File))
	var total int64
	for _, entry := range reader.File {
		name, valid := canonicalWorkspacePath(entry.Name, true)
		if !valid {
			return nil, errors.New("ไฟล์ ZIP มีชื่อไฟล์ที่ไม่ปลอดภัย")
		}
		if name == "" {
			continue
		}
		if entry.FileInfo().IsDir() {
			files[name] = sourceFile{IsDir: true}
			continue
		}
		mode := entry.Mode()
		if mode&(^mode.Perm()) != 0 {
			// Symlinks and devices are left out rather than refusing the whole upload.
			continue
		}
		// Skip installed packages before reading them: a zipped node_modules is most of the size.
		if botSkippedPath(name) {
			files[name] = sourceFile{}
			continue
		}
		size, ok := checkedWorkspaceArchiveSize(entry.UncompressedSize64, botSourceUncompressedLimit-total)
		if !ok {
			return nil, errors.New("โค้ดรวมกันใหญ่เกิน 200 MB")
		}
		total += size
		file, err := entry.Open()
		if err != nil {
			return nil, errors.New("อ่านไฟล์ใน ZIP ไม่ได้")
		}
		content, readErr := io.ReadAll(io.LimitReader(file, size+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil || int64(len(content)) != size {
			return nil, errors.New("อ่านไฟล์ใน ZIP ไม่ได้")
		}
		files[name] = sourceFile{Data: content}
	}
	return files, nil
}

func botSourceFromZip(data []byte) (map[string]sourceFile, botSourceReport, error) {
	files, err := parseSourceZip(data)
	if err != nil {
		return nil, botSourceReport{EnvNames: []string{}}, err
	}
	return cleanBotSource(files)
}

func buildBotSourceZip(files map[string]sourceFile) ([]byte, error) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		file := files[name]
		canonical, ok := canonicalWorkspacePath(name, false)
		if !ok || canonical == "" || isEnvFileName(canonical) {
			return nil, errors.New("unsafe workspace path")
		}
		entryName := canonical
		if file.IsDir {
			entryName += "/"
		}
		header := &zip.FileHeader{Name: entryName, Method: zip.Deflate, Modified: time.Now().UTC()}
		if file.IsDir {
			header.SetMode(0o755 | ioModeDir)
		} else {
			header.SetMode(0o644)
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
	if int64(output.Len()) > botSourceCompressedLimit {
		return nil, errors.New("โค้ดหลังบีบอัดใหญ่เกิน 50 MB")
	}
	return output.Bytes(), nil
}

func (s *server) storeBotSource(ctx context.Context, botID int64, files map[string]sourceFile) (string, error) {
	if s.storage == nil {
		return "", errors.New("ที่เก็บไฟล์ไม่พร้อมใช้งาน")
	}
	archive, err := buildBotSourceZip(files)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("bots/%d/%s.zip", botID, randomSourceKey())
	if _, err := s.storage.PutObject(ctx, s.cfg.s3Bucket, key, bytes.NewReader(archive), int64(len(archive)), minio.PutObjectOptions{ContentType: "application/zip"}); err != nil {
		return "", errors.New("บันทึกโค้ดไม่สำเร็จ ลองอีกครั้ง")
	}
	return key, nil
}

func (s *server) removeBotObject(key string) {
	if key == "" || s.storage == nil {
		return
	}
	_ = s.storage.RemoveObject(context.Background(), s.cfg.s3Bucket, key, minio.RemoveObjectOptions{})
}

func (s *server) loadBotSource(ctx context.Context, bot botApp) (map[string]sourceFile, error) {
	if bot.SourceKey == "" {
		return map[string]sourceFile{}, nil
	}
	if !strings.HasPrefix(bot.SourceKey, fmt.Sprintf("bots/%d/", bot.ID)) {
		return nil, errors.New("invalid source key")
	}
	object, err := s.storage.GetObject(ctx, s.cfg.s3Bucket, bot.SourceKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()
	data, err := io.ReadAll(io.LimitReader(object, botSourceCompressedLimit+1))
	if err != nil || int64(len(data)) > botSourceCompressedLimit {
		return nil, errors.New("source archive unavailable")
	}
	return parseSourceZip(data)
}

// ---- Entry file ----------------------------------------------------------------------------

func validBotEntry(value, runtime string) (string, bool) {
	name, ok := canonicalWorkspacePath(value, false)
	if !ok || name == "" || len(name) > 200 || strings.HasPrefix(name, "-") || botSkippedPath(name) {
		return "", false
	}
	extension := strings.ToLower(path.Ext(name))
	if runtime == "python" {
		return name, extension == ".py"
	}
	return name, extension == ".js" || extension == ".mjs" || extension == ".cjs"
}

// detectBotEntry picks the file to run: the current choice when it exists, then package.json's
// "main", then the usual names. Node projects with only a start script run `npm start`.
func detectBotEntry(files map[string]sourceFile, runtime, current string) (string, string) {
	exists := func(name string) bool {
		file, ok := files[name]
		return ok && !file.IsDir
	}
	if exists(current) {
		if _, ok := validBotEntry(current, runtime); ok {
			return current, "entry"
		}
	}
	if runtime == "node" {
		var manifest struct {
			Main    string            `json:"main"`
			Scripts map[string]string `json:"scripts"`
		}
		if file, ok := files["package.json"]; ok {
			_ = json.Unmarshal(file.Data, &manifest)
		}
		if main, ok := validBotEntry(manifest.Main, runtime); ok && exists(main) {
			return main, "entry"
		}
		for _, name := range []string{"index.js", "bot.js", "main.js", "app.js", "src/index.js", "src/bot.js", "index.mjs", "src/index.mjs"} {
			if exists(name) {
				return name, "entry"
			}
		}
		if strings.TrimSpace(manifest.Scripts["start"]) != "" {
			return current, "npm_start"
		}
		return current, "entry"
	}
	for _, name := range []string{"main.py", "bot.py", "app.py", "index.py", "run.py", "src/main.py", "src/bot.py"} {
		if exists(name) {
			return name, "entry"
		}
	}
	return current, "entry"
}

// ---- GitHub --------------------------------------------------------------------------------

// parseGitHubSource accepts "owner/repo", a github.com link (with /tree/<branch> too) or a
// .git clone URL.
func parseGitHubSource(repoInput, refInput string) (string, string, error) {
	value := strings.TrimSpace(repoInput)
	value = strings.TrimSuffix(value, "/")
	value = strings.TrimSuffix(value, ".git")
	ref := strings.TrimSpace(refInput)
	if strings.Contains(value, "github.com") {
		if !strings.Contains(value, "://") {
			value = "https://" + value
		}
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Host != "github.com" && parsed.Host != "www.github.com") {
			return "", "", errors.New("ใส่ลิงก์ของ github.com หรือพิมพ์เป็น ชื่อผู้ใช้/ชื่อrepo")
		}
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) < 2 {
			return "", "", errors.New("ลิงก์ไม่ครบ ต้องมีทั้งชื่อผู้ใช้และชื่อ repo")
		}
		value = parts[0] + "/" + strings.TrimSuffix(parts[1], ".git")
		if ref == "" && len(parts) >= 4 && parts[2] == "tree" {
			ref = strings.Join(parts[3:], "/")
		}
	}
	if !githubRepoPattern.MatchString(value) {
		return "", "", errors.New("ชื่อ repo ไม่ถูกต้อง ตัวอย่าง: nkn-team/my-bot")
	}
	if ref != "" && (!githubRefPattern.MatchString(ref) || strings.Contains(ref, "..") || strings.HasPrefix(ref, "/") || strings.HasSuffix(ref, "/")) {
		return "", "", errors.New("ชื่อ branch ไม่ถูกต้อง")
	}
	return value, ref, nil
}

var githubArchiveBase = "https://github.com"

func githubDownloadClient() *http.Client {
	return &http.Client{
		Timeout: 90 * time.Second,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if request.URL.Scheme != "https" || (request.URL.Host != "github.com" && request.URL.Host != "codeload.github.com") {
				return errors.New("redirect outside GitHub")
			}
			return nil
		},
	}
}

// downloadGitHubArchive downloads a public repository as a zip; the host is fixed, so the input
// can only choose a repository and branch on GitHub.
func downloadGitHubArchive(ctx context.Context, repo, ref string) ([]byte, error) {
	if ref == "" {
		ref = "HEAD"
	}
	segments := strings.Split(ref, "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	target := githubArchiveBase + "/" + repo + "/archive/" + strings.Join(segments, "/") + ".zip"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errors.New("ลิงก์ GitHub ไม่ถูกต้อง")
	}
	request.Header.Set("User-Agent", "nexora-bot-hosting")
	response, err := githubDownloadClient().Do(request)
	if err != nil {
		return nil, errors.New("ติดต่อ GitHub ไม่ได้ ลองใหม่อีกครั้ง")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, errors.New("ไม่พบ repo หรือ branch นี้ ถ้าเป็น repo ส่วนตัว ให้ดาวน์โหลดเป็น ZIP แล้วอัปโหลดแทน")
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub ตอบกลับ %d ลองใหม่อีกครั้ง", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, botSourceCompressedLimit+1))
	if err != nil {
		return nil, errors.New("ดาวน์โหลดจาก GitHub ไม่ครบ ลองใหม่อีกครั้ง")
	}
	if int64(len(data)) > botSourceCompressedLimit {
		return nil, errors.New("repo นี้ใหญ่เกิน 50 MB")
	}
	return data, nil
}

// ---- Publishing new code -------------------------------------------------------------------

// publishBotSource stores a new version of the code. With restart (or when the bot is running and
// the owner uploaded new code), it also queues a rebuild so the new code goes live.
func (s *server) publishBotSource(c *fiber.Ctx, bot botApp, files map[string]sourceFile, restart bool, sourceKind, repo, ref string) (fiber.Map, error) {
	actor := current(c)
	key, err := s.storeBotSource(c.Context(), bot.ID, files)
	if err != nil {
		return nil, c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_source"})
	}
	committed := false
	defer func() {
		if !committed {
			s.removeBotObject(key)
		}
	}()
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	locked, err := loadBot(c.Context(), tx, actor, bot.PublicID, true)
	if err != nil {
		return nil, c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบบอทตัวนี้", Code: "bot_not_found"})
	}
	// Someone saved in another tab after this request read the files.
	if locked.SourceKey != bot.SourceKey {
		return nil, c.Status(fiber.StatusConflict).JSON(apiError{Error: "โค้ดถูกแก้จากที่อื่นระหว่างนี้ โหลดไฟล์ใหม่แล้วลองอีกครั้ง", Code: "source_changed"})
	}
	if sourceKind == "" {
		sourceKind = locked.SourceKind
		repo, ref = locked.GitHubRepo, locked.GitHubRef
	}
	// An owner who picked `npm start` keeps it; otherwise follow the file the new code starts from.
	entry, mode := locked.EntryFile, locked.StartMode
	if mode == "entry" {
		entry, mode = detectBotEntry(files, locked.Runtime, locked.EntryFile)
	}
	if _, err := tx.Exec(c.Context(), `
		UPDATE bot_apps SET source_key=$2,source_updated_at=NOW(),source_kind=$3,github_repo=$4,github_ref=$5,
		       entry_file=$6,start_mode=$7,updated_at=NOW()
		WHERE id=$1
	`, locked.ID, key, sourceKind, repo, ref, entry, mode); err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError)
	}
	queued := false
	if restart || (locked.Status == "running" && locked.PendingKind == "") {
		idempotency, keyErr := operationKey(c)
		if keyErr != nil {
			idempotency = "source-" + randomSourceKey()
		}
		if _, err := enqueueBotOperation(c.Context(), tx, locked.ID, actor.ID, "bot.deploy", idempotency, map[string]any{"sourceKey": key}); err != nil {
			return nil, botOperationConflict(c, err)
		}
		queued = true
	}
	if err := tx.Commit(c.Context()); err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError)
	}
	committed = true
	// The old zip is kept while a container still runs from it.
	if locked.SourceKey != "" && locked.SourceKey != locked.DeployedSourceKey {
		s.removeBotObject(locked.SourceKey)
	}
	_, hasEntry := files[entry]
	return fiber.Map{"queued": queued, "entryFile": entry, "startMode": mode, "entryMissing": mode == "entry" && !hasEntry}, nil
}

func (s *server) deployBotZip(c *fiber.Ctx) error {
	actor := current(c)
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	header, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกไฟล์ .zip ก่อน", Code: "file_required"})
	}
	if header.Size <= 0 || header.Size > botSourceCompressedLimit {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์ ZIP ต้องไม่เกิน 50 MB (ไม่ต้องใส่ node_modules)", Code: "file_too_large"})
	}
	file, err := header.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest)
	}
	data, err := io.ReadAll(io.LimitReader(file, botSourceCompressedLimit+1))
	_ = file.Close()
	if err != nil || http.DetectContentType(data) != "application/zip" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รองรับเฉพาะไฟล์ .zip", Code: "not_zip"})
	}
	files, report, err := botSourceFromZip(data)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_source"})
	}
	result, err := s.publishBotSource(c, bot, files, c.FormValue("restart") == "true", "zip", "", "")
	if err != nil || result == nil {
		return err
	}
	report.EntryFile, _ = result["entryFile"].(string)
	report.EntryMissing, _ = result["entryMissing"].(bool)
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.source.uploaded", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"files": report.Files}})
	result["source"] = report
	return c.JSON(result)
}

func (s *server) pullBotGitHub(c *fiber.Ctx) error {
	actor := current(c)
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	var input struct {
		Repo    string `json:"repo"`
		Ref     string `json:"ref"`
		Restart bool   `json:"restart"`
	}
	_ = c.BodyParser(&input)
	if strings.TrimSpace(input.Repo) == "" {
		input.Repo, input.Ref = bot.GitHubRepo, bot.GitHubRef
	}
	if input.Repo == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ใส่ลิงก์ repo ก่อน", Code: "invalid_github_repo"})
	}
	repo, ref, err := parseGitHubSource(input.Repo, input.Ref)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_github_repo"})
	}
	data, err := downloadGitHubArchive(c.Context(), repo, ref)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "github_download_failed"})
	}
	files, report, err := botSourceFromZip(data)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_source"})
	}
	result, err := s.publishBotSource(c, bot, files, input.Restart, "github", repo, ref)
	if err != nil || result == nil {
		return err
	}
	report.EntryFile, _ = result["entryFile"].(string)
	report.EntryMissing, _ = result["entryMissing"].(bool)
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.source.github", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"repo": repo, "ref": ref}})
	result["source"] = report
	return c.JSON(result)
}

// ---- Editor --------------------------------------------------------------------------------

func botTextFile(data []byte) bool {
	return len(data) <= botEditorLimit && utf8.Valid(data) && !bytes.ContainsRune(data, 0)
}

func (s *server) listBotFiles(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	items := make([]fiber.Map, 0, len(files))
	for name, file := range files {
		if botSkippedPath(name) {
			continue
		}
		items = append(items, fiber.Map{"path": name, "isDir": file.IsDir, "size": len(file.Data), "editable": !file.IsDir && botTextFile(file.Data)})
	}
	sort.Slice(items, func(a, b int) bool { return items[a]["path"].(string) < items[b]["path"].(string) })
	return c.JSON(fiber.Map{"items": items, "entryFile": bot.EntryFile})
}

func (s *server) readBotFile(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	name, ok := canonicalWorkspacePath(c.Query("path"), false)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	file, exists := files[name]
	if !exists || file.IsDir {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์นี้", Code: "file_not_found"})
	}
	if !botTextFile(file.Data) {
		return c.Status(fiber.StatusUnsupportedMediaType).JSON(apiError{Error: "ไฟล์นี้ไม่ใช่ไฟล์ข้อความ หรือใหญ่เกิน 1 MB จึงเปิดในเว็บไม่ได้", Code: "not_editable"})
	}
	return c.JSON(fiber.Map{"path": name, "content": string(file.Data)})
}

func botEditablePath(value string) (string, bool) {
	name, ok := canonicalWorkspacePath(value, false)
	if !ok || name == "" || len(name) > 300 || isEnvFileName(name) || botSkippedPath(name) {
		return "", false
	}
	return name, true
}

func (s *server) saveBotFile(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	var input struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Restart bool   `json:"restart"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	name, ok := botEditablePath(input.Path)
	if !ok {
		if isEnvFileName(strings.TrimSpace(input.Path)) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่เก็บไฟล์ .env ไว้กับโค้ด ใส่ค่าในแท็บตัวแปรลับแทน", Code: "env_file_blocked"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อไฟล์นี้ใช้ไม่ได้", Code: "invalid_path"})
	}
	if len(input.Content) > botEditorLimit || !utf8.ValidString(input.Content) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์ต้องเป็นข้อความและไม่เกิน 1 MB", Code: "file_too_large"})
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	if existing, found := files[name]; found && existing.IsDir {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีโฟลเดอร์ชื่อนี้อยู่แล้ว", Code: "path_is_folder"})
	}
	if _, found := files[name]; !found && len(files) >= botFileCountLimit {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์เต็มจำนวนที่รับได้แล้ว", Code: "too_many_files"})
	}
	files[name] = sourceFile{Data: []byte(input.Content)}
	result, err := s.publishBotSource(c, bot, files, input.Restart, "", "", "")
	if err != nil || result == nil {
		return err
	}
	return c.JSON(result)
}

func (s *server) createBotFolder(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	var input struct {
		Path string `json:"path"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	name, ok := botEditablePath(input.Path)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อโฟลเดอร์นี้ใช้ไม่ได้", Code: "invalid_path"})
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	if _, exists := files[name]; exists {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีไฟล์หรือโฟลเดอร์ชื่อนี้อยู่แล้ว", Code: "path_exists"})
	}
	files[name] = sourceFile{IsDir: true}
	result, err := s.publishBotSource(c, bot, files, false, "", "", "")
	if err != nil || result == nil {
		return err
	}
	return c.JSON(result)
}

func (s *server) moveBotFile(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	var input struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	from, okFrom := canonicalWorkspacePath(input.From, false)
	to, okTo := botEditablePath(input.To)
	if !okFrom || from == "" || !okTo {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อใหม่ใช้ไม่ได้", Code: "invalid_path"})
	}
	if from == to {
		return c.JSON(fiber.Map{"queued": false})
	}
	if strings.HasPrefix(to+"/", from+"/") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ย้ายโฟลเดอร์เข้าไปในตัวเองไม่ได้", Code: "invalid_path"})
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	if _, exists := files[to]; exists {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีไฟล์หรือโฟลเดอร์ชื่อนี้อยู่แล้ว", Code: "path_exists"})
	}
	moved := 0
	next := make(map[string]sourceFile, len(files))
	for name, file := range files {
		switch {
		case name == from:
			next[to] = file
			moved++
		case strings.HasPrefix(name, from+"/"):
			next[to+strings.TrimPrefix(name, from)] = file
			moved++
		default:
			next[name] = file
		}
	}
	if moved == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์นี้", Code: "file_not_found"})
	}
	result, err := s.publishBotSource(c, bot, next, false, "", "", "")
	if err != nil || result == nil {
		return err
	}
	return c.JSON(result)
}

func (s *server) deleteBotFile(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	name, ok := canonicalWorkspacePath(c.Query("path"), false)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อไฟล์ไม่ถูกต้อง", Code: "invalid_path"})
	}
	files, err := s.loadBotSource(c.Context(), bot)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โหลดไฟล์ของบอทไม่สำเร็จ", Code: "source_unavailable"})
	}
	removed := 0
	for existing := range files {
		if existing == name || strings.HasPrefix(existing, name+"/") {
			delete(files, existing)
			removed++
		}
	}
	if removed == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์นี้", Code: "file_not_found"})
	}
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ลบไฟล์สุดท้ายไม่ได้ บอทต้องมีโค้ดอย่างน้อยหนึ่งไฟล์", Code: "last_file"})
	}
	result, err := s.publishBotSource(c, bot, files, false, "", "", "")
	if err != nil || result == nil {
		return err
	}
	return c.JSON(result)
}
