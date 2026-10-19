package main

// Discord bots that users bring and the platform runs. The API keeps each bot's code as a zip in
// object storage and queues jobs in bot_operations; runtime-worker (bots.go there) builds and
// runs the container and copies its output into bot_runtime_logs.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type botQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type botApp struct {
	ID                int64
	PublicID          string
	OwnerID           int64
	OwnerName         string
	Name              string
	Runtime           string
	EntryFile         string
	StartMode         string
	SourceKind        string
	GitHubRepo        string
	GitHubRef         string
	SourceKey         string
	DeployedSourceKey string
	SourceUpdatedAt   *time.Time
	Status            string
	StatusMessage     string
	LastExitCode      *int
	RestartCount      int
	StartedAt         *time.Time
	StoppedAt         *time.Time
	CPUMillicores     int
	MemoryMB          int
	DiskLimitMB       int
	DiskUsedMB        *int
	DiscordBotID      string
	DiscordUsername   string
	DiscordAvatar     string
	TokenVariable     string
	TokenState        string
	TokenCheckedAt    *time.Time
	CreatedAt         time.Time
	PendingKind       string
	PendingState      string
	PendingPhase      string
}

const botSelect = `
	SELECT b.id,b.public_id,b.owner_user_id,COALESCE(u.identifier,''),b.name,b.runtime,b.entry_file,b.start_mode,
	       b.source_kind,b.github_repo,b.github_ref,b.source_key,b.deployed_source_key,b.source_updated_at,
	       b.status,b.status_message,b.last_exit_code,b.restart_count,b.started_at,b.stopped_at,
	       b.cpu_millicores,b.memory_mb,b.disk_limit_mb,b.disk_used_mb,
	       b.discord_bot_id,b.discord_username,b.discord_avatar,b.token_variable,b.token_state,b.token_checked_at,
	       b.created_at,
	       COALESCE(op.kind,''),COALESCE(op.state,''),COALESCE(op.phase,'')
	FROM bot_apps b
	LEFT JOIN users u ON u.id=b.owner_user_id
	LEFT JOIN LATERAL (
	  SELECT kind,state,phase FROM bot_operations o
	  WHERE o.bot_id=b.id AND o.state IN ('queued','running')
	  ORDER BY o.id DESC LIMIT 1
	) op ON TRUE
`

func scanBot(row pgx.Row) (botApp, error) {
	var b botApp
	err := row.Scan(
		&b.ID, &b.PublicID, &b.OwnerID, &b.OwnerName, &b.Name, &b.Runtime, &b.EntryFile, &b.StartMode,
		&b.SourceKind, &b.GitHubRepo, &b.GitHubRef, &b.SourceKey, &b.DeployedSourceKey, &b.SourceUpdatedAt,
		&b.Status, &b.StatusMessage, &b.LastExitCode, &b.RestartCount, &b.StartedAt, &b.StoppedAt,
		&b.CPUMillicores, &b.MemoryMB, &b.DiskLimitMB, &b.DiskUsedMB,
		&b.DiscordBotID, &b.DiscordUsername, &b.DiscordAvatar, &b.TokenVariable, &b.TokenState, &b.TokenCheckedAt,
		&b.CreatedAt,
		&b.PendingKind, &b.PendingState, &b.PendingPhase,
	)
	return b, err
}

func isPlatformAdmin(actor *currentUser) bool {
	return actor != nil && (actor.Role == "admin" || actor.Role == "superadmin")
}

// loadBot finds a bot the actor owns (admins see every bot). With lock, it must run inside a
// transaction and holds the bot row until commit.
func loadBot(ctx context.Context, q botQuerier, actor *currentUser, publicID string, lock bool) (botApp, error) {
	query := botSelect + ` WHERE b.public_id=$1 AND b.deleted_at IS NULL AND (b.owner_user_id=$2 OR $3)`
	if lock {
		query += ` FOR UPDATE OF b`
	}
	return scanBot(q.QueryRow(ctx, query, strings.TrimSpace(publicID), actor.ID, isPlatformAdmin(actor)))
}

func (s *server) botFromRequest(c *fiber.Ctx) (botApp, error) {
	bot, err := loadBot(c.Context(), s.db, current(c), c.Params("id"), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return botApp{}, c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบบอทตัวนี้", Code: "bot_not_found"})
	}
	if err != nil {
		return botApp{}, fiber.NewError(fiber.StatusInternalServerError)
	}
	return bot, nil
}

func botAvatarURL(b botApp) string {
	if b.DiscordBotID == "" || b.DiscordAvatar == "" {
		return ""
	}
	return "https://cdn.discordapp.com/avatars/" + url.PathEscape(b.DiscordBotID) + "/" + url.PathEscape(b.DiscordAvatar) + ".png?size=128"
}

func botInviteURL(b botApp) string {
	if b.DiscordBotID == "" {
		return ""
	}
	return "https://discord.com/oauth2/authorize?client_id=" + url.QueryEscape(b.DiscordBotID) + "&scope=bot%20applications.commands&permissions=0"
}

func botJSON(b botApp, withOwner bool) fiber.Map {
	var pending any
	if b.PendingKind != "" {
		pending = fiber.Map{"kind": b.PendingKind, "state": b.PendingState, "phase": b.PendingPhase}
	}
	result := fiber.Map{
		"id":            b.PublicID,
		"name":          b.Name,
		"runtime":       b.Runtime,
		"entryFile":     b.EntryFile,
		"startMode":     b.StartMode,
		"status":        b.Status,
		"statusMessage": b.StatusMessage,
		"lastExitCode":  b.LastExitCode,
		"restartCount":  b.RestartCount,
		"startedAt":     b.StartedAt,
		"stoppedAt":     b.StoppedAt,
		"createdAt":     b.CreatedAt,
		"pending":       pending,
		"source": fiber.Map{
			"kind":       b.SourceKind,
			"githubRepo": b.GitHubRepo,
			"githubRef":  b.GitHubRef,
			"hasCode":    b.SourceKey != "",
			"updatedAt":  b.SourceUpdatedAt,
			// Code changed after the running container was built: a restart picks it up.
			"pendingChanges": b.SourceKey != "" && b.DeployedSourceKey != "" && b.SourceKey != b.DeployedSourceKey,
		},
		"resources": fiber.Map{
			"cpuMillicores": b.CPUMillicores,
			"memoryMb":      b.MemoryMB,
			"diskLimitMb":   b.DiskLimitMB,
			"diskUsedMb":    b.DiskUsedMB,
		},
		"discord": fiber.Map{
			"id":            b.DiscordBotID,
			"username":      b.DiscordUsername,
			"avatarUrl":     botAvatarURL(b),
			"inviteUrl":     botInviteURL(b),
			"tokenVariable": b.TokenVariable,
			"tokenState":    b.TokenState,
			"checkedAt":     b.TokenCheckedAt,
		},
	}
	if withOwner {
		result["owner"] = fiber.Map{"id": b.OwnerID, "username": b.OwnerName}
	}
	return result
}

func botDefaultLimit() int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv("BOT_DEFAULT_LIMIT")))
	if err != nil || value < 0 || value > 50 {
		return 2
	}
	return value
}

func (s *server) userBotQuota(ctx context.Context, q botQuerier, userID int64) (limit, used int, err error) {
	var custom *int
	err = q.QueryRow(ctx, `
		SELECT u.bot_limit,(SELECT COUNT(*) FROM bot_apps b WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL)
		FROM users u WHERE u.id=$1
	`, userID).Scan(&custom, &used)
	limit = botDefaultLimit()
	if custom != nil {
		limit = *custom
	}
	return limit, used, err
}

func (s *server) listBots(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), botSelect+` WHERE b.owner_user_id=$1 AND b.deleted_at IS NULL ORDER BY b.created_at`, actor.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]fiber.Map, 0)
	for rows.Next() {
		bot, err := scanBot(rows)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, botJSON(bot, false))
	}
	if rows.Err() != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	limit, used, err := s.userBotQuota(c.Context(), s.db, actor.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"items": items, "quota": fiber.Map{"limit": limit, "used": used}})
}

type createBotInput struct {
	Name       string `json:"name"`
	Runtime    string `json:"runtime"`
	Source     string `json:"source"`
	GitHubRepo string `json:"githubRepo"`
	GitHubRef  string `json:"githubRef"`
	// Admins may create a bot that belongs to someone else; it counts against that person's quota.
	OwnerUsername string `json:"ownerUsername"`
}

func cleanBotName(value string) (string, bool) {
	value = strings.Join(strings.Fields(value), " ")
	if value == "" || utf8.RuneCountInString(value) > 60 {
		return "", false
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return "", false
		}
	}
	return value, true
}

func defaultBotEntry(runtime string) string {
	if runtime == "python" {
		return "main.py"
	}
	return "index.js"
}

func (s *server) createBot(c *fiber.Ctx) error {
	actor := current(c)
	var input createBotInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	name, ok := cleanBotName(input.Name)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตั้งชื่อบอทยาวไม่เกิน 60 ตัวอักษร", Code: "invalid_name"})
	}
	if input.Runtime != "node" && input.Runtime != "python" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกภาษาเป็น Node.js หรือ Python", Code: "invalid_runtime"})
	}

	// Fetch the code before taking the quota slot, so a wrong repository link leaves nothing behind.
	var files map[string]sourceFile
	var report botSourceReport
	sourceKind := "zip"
	repo, ref := "", ""
	switch input.Source {
	case "template":
		sourceKind = "template"
		files = botTemplateFiles(input.Runtime, name)
	case "github":
		sourceKind = "github"
		var err error
		repo, ref, err = parseGitHubSource(input.GitHubRepo, input.GitHubRef)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_github_repo"})
		}
		data, err := downloadGitHubArchive(c.Context(), repo, ref)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "github_download_failed"})
		}
		files, report, err = botSourceFromZip(data)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_source"})
		}
	case "zip", "":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "แหล่งโค้ดไม่ถูกต้อง", Code: "invalid_source"})
	}

	entry, startMode := defaultBotEntry(input.Runtime), "entry"
	if files != nil {
		entry, startMode = detectBotEntry(files, input.Runtime, entry)
	}

	ownerID, ownerName := actor.ID, ""
	if wanted := strings.TrimPrefix(strings.TrimSpace(input.OwnerUsername), "@"); wanted != "" && !strings.EqualFold(wanted, actor.Username) {
		if !isPlatformAdmin(actor) {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "สร้างบอทให้คนอื่นได้เฉพาะแอดมิน", Code: "forbidden"})
		}
		err := s.db.QueryRow(c.Context(), `SELECT id,identifier FROM users WHERE LOWER(identifier)=LOWER($1)`, wanted).Scan(&ownerID, &ownerName)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้ชื่อ " + truncateRunes(wanted, 40), Code: "user_not_found"})
		}
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	// Holding the user row makes two quick "create" clicks count one after the other.
	if _, err := tx.Exec(c.Context(), `SELECT 1 FROM users WHERE id=$1 FOR UPDATE`, ownerID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	limit, used, err := s.userBotQuota(c.Context(), tx, ownerID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if used >= limit && ownerName != "" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: fmt.Sprintf("%s มีบอทครบโควตา %d ตัวแล้ว เพิ่มโควตาให้ก่อนในส่วนโควตาต่อคน", ownerName, limit), Code: "bot_quota_reached"})
	}
	if used >= limit {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: fmt.Sprintf("บัญชีนี้สร้างบอทได้ %d ตัว ลบตัวที่ไม่ใช้แล้วก่อน หรือขอแอดมินเพิ่มโควตา", limit), Code: "bot_quota_reached"})
	}
	publicID := randomSourceKey()
	var botID int64
	if err := tx.QueryRow(c.Context(), `
		INSERT INTO bot_apps (public_id,owner_user_id,name,runtime,entry_file,start_mode,source_kind,github_repo,github_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
	`, publicID, ownerID, name, input.Runtime, entry, startMode, sourceKind, repo, ref).Scan(&botID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	storedKey := ""
	if files != nil {
		storedKey, err = s.storeBotSource(c.Context(), botID, files)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_source"})
		}
		if _, err := tx.Exec(c.Context(), `UPDATE bot_apps SET source_key=$2,source_updated_at=NOW() WHERE id=$1`, botID, storedKey); err != nil {
			s.removeBotObject(storedKey)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		s.removeBotObject(storedKey)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.created", Target: "bot", TargetID: publicID, Metadata: map[string]any{"runtime": input.Runtime, "source": sourceKind, "owner": ownerName}})
	bot, err := loadBot(c.Context(), s.db, actor, publicID, false)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"bot": botJSON(bot, false), "source": report})
}

func (s *server) getBot(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	return c.JSON(fiber.Map{"bot": botJSON(bot, isPlatformAdmin(current(c)))})
}

type patchBotInput struct {
	Name      *string `json:"name"`
	EntryFile *string `json:"entryFile"`
	StartMode *string `json:"startMode"`
}

func (s *server) patchBot(c *fiber.Ctx) error {
	actor := current(c)
	var input patchBotInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	bot, err := loadBot(c.Context(), tx, actor, c.Params("id"), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบบอทตัวนี้", Code: "bot_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	name, entry, mode := bot.Name, bot.EntryFile, bot.StartMode
	if input.Name != nil {
		if name, err = cleanBotNameErr(*input.Name); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_name"})
		}
	}
	if input.EntryFile != nil {
		value, ok := validBotEntry(*input.EntryFile, bot.Runtime)
		if !ok {
			hint := ".js .mjs หรือ .cjs"
			if bot.Runtime == "python" {
				hint = ".py"
			}
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์เริ่มต้นต้องเป็นไฟล์ " + hint + " ที่อยู่ในโปรเจกต์", Code: "invalid_entry"})
		}
		entry = value
	}
	if input.StartMode != nil {
		if *input.StartMode != "entry" && *input.StartMode != "npm_start" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "วิธีสั่งรันไม่ถูกต้อง", Code: "invalid_start_mode"})
		}
		if *input.StartMode == "npm_start" && bot.Runtime != "node" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "npm start ใช้ได้กับ Node.js เท่านั้น", Code: "invalid_start_mode"})
		}
		mode = *input.StartMode
	}
	if _, err := tx.Exec(c.Context(), `UPDATE bot_apps SET name=$2,entry_file=$3,start_mode=$4,updated_at=NOW() WHERE id=$1`, bot.ID, name, entry, mode); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	bot, err = loadBot(c.Context(), s.db, actor, bot.PublicID, false)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"bot": botJSON(bot, isPlatformAdmin(actor))})
}

func cleanBotNameErr(value string) (string, error) {
	name, ok := cleanBotName(value)
	if !ok {
		return "", errors.New("ตั้งชื่อบอทยาวไม่เกิน 60 ตัวอักษร")
	}
	return name, nil
}

func (s *server) deleteBot(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอไม่สมบูรณ์ ลองรีเฟรชหน้าแล้วกดใหม่", Code: "invalid_idempotency_key"})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	bot, err := loadBot(c.Context(), tx, actor, c.Params("id"), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบบอทตัวนี้", Code: "bot_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if bot.PendingState == "running" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "บอทกำลังทำงานตามคำสั่งก่อนหน้า รอสักครู่แล้วลบอีกครั้ง", Code: "bot_busy"})
	}
	// A job still waiting would only start a bot that is about to be removed.
	if _, err := tx.Exec(c.Context(), `
		UPDATE bot_operations SET state='failed',phase='cancelled',error_code='bot_deleted',
		       error_message='ยกเลิกเพราะลบบอทแล้ว',finished_at=NOW(),updated_at=NOW()
		WHERE bot_id=$1 AND state='queued'
	`, bot.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(c.Context(), `UPDATE bot_apps SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1`, bot.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := enqueueBotOperation(c.Context(), tx, bot.ID, actor.ID, "bot.delete", key, nil); err != nil {
		return botOperationConflict(c, err)
	}
	if _, err := tx.Exec(c.Context(), `DELETE FROM bot_environment_variables WHERE bot_id=$1`, bot.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.deleted", Target: "bot", TargetID: bot.PublicID})
	return c.SendStatus(fiber.StatusNoContent)
}

var botOperationKinds = map[string]string{"start": "bot.start", "stop": "bot.stop", "restart": "bot.restart", "rebuild": "bot.deploy"}

func botOperationTimeout(kind string) int {
	switch kind {
	case "bot.stop", "bot.delete":
		return 180
	default:
		return 900
	}
}

// enqueueBotOperation queues a job for the worker. Replaying the same Idempotency-Key returns the
// job it created the first time.
func enqueueBotOperation(ctx context.Context, tx pgx.Tx, botID, actorID int64, kind, key string, metadata map[string]any) (string, error) {
	var existing string
	err := tx.QueryRow(ctx, `SELECT operation_id FROM bot_operations WHERE actor_user_id=$1 AND idempotency_key=$2`, actorID, key).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, _ := json.Marshal(metadata)
	operationID := randomSourceKey()
	_, err = tx.Exec(ctx, `
		INSERT INTO bot_operations (operation_id,bot_id,actor_user_id,kind,idempotency_key,timeout_seconds,metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, operationID, botID, actorID, kind, key, botOperationTimeout(kind), encoded)
	return operationID, err
}

func botOperationConflict(c *fiber.Ctx, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "บอทตัวนี้ยังทำคำสั่งก่อนหน้าไม่เสร็จ รอสักครู่แล้วลองใหม่", Code: "bot_busy"})
	}
	return fiber.NewError(fiber.StatusInternalServerError)
}

func (s *server) createBotOperation(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอไม่สมบูรณ์ ลองรีเฟรชหน้าแล้วกดใหม่", Code: "invalid_idempotency_key"})
	}
	var input struct {
		Action string `json:"action"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	kind, ok := botOperationKinds[input.Action]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำสั่งไม่ถูกต้อง", Code: "invalid_action"})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	bot, err := loadBot(c.Context(), tx, actor, c.Params("id"), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบบอทตัวนี้", Code: "bot_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if kind != "bot.stop" && bot.SourceKey == "" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่มีโค้ดของบอท อัปโหลดไฟล์หรือดึงจาก GitHub ก่อน", Code: "bot_no_source"})
	}
	operationID, err := enqueueBotOperation(c.Context(), tx, bot.ID, actor.ID, kind, key, nil)
	if err != nil {
		return botOperationConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return botOperationConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: kind, Target: "bot", TargetID: bot.PublicID})
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"operationId": operationID})
}

// botLogs returns log lines after the cursor (or the latest ones) together with the bot's
// current state, so the console needs one request per refresh.
func (s *server) botLogs(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	after, _ := strconv.ParseInt(c.Query("after"), 10, 64)
	var rows pgx.Rows
	if after > 0 {
		rows, err = s.db.Query(c.Context(), `
			SELECT id,stream,message,created_at FROM bot_runtime_logs
			WHERE bot_id=$1 AND id>$2 ORDER BY id LIMIT 300
		`, bot.ID, after)
	} else {
		rows, err = s.db.Query(c.Context(), `
			SELECT id,stream,message,created_at FROM (
			  SELECT id,stream,message,created_at FROM bot_runtime_logs
			  WHERE bot_id=$1 ORDER BY id DESC LIMIT 300
			) latest ORDER BY id
		`, bot.ID)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]fiber.Map, 0)
	for rows.Next() {
		var id int64
		var stream, message string
		var createdAt time.Time
		if err := rows.Scan(&id, &stream, &message, &createdAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, fiber.Map{"id": id, "stream": stream, "message": message, "at": createdAt})
	}
	return c.JSON(fiber.Map{"items": items, "bot": botJSON(bot, isPlatformAdmin(current(c)))})
}

// ---- Bot token -----------------------------------------------------------------------------

type discordIdentity struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar"`
	Bot      bool   `json:"bot"`
}

var discordAPIBase = "https://discord.com/api/v10"

// checkDiscordToken asks Discord who the token belongs to. valid=false with a nil error means
// Discord refused the token; an error means Discord could not be asked.
func checkDiscordToken(ctx context.Context, token string) (discordIdentity, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, discordAPIBase+"/users/@me", nil)
	if err != nil {
		return discordIdentity{}, false, err
	}
	request.Header.Set("Authorization", "Bot "+token)
	request.Header.Set("User-Agent", "DiscordBot (https://nkn02.com, 1.0)")
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return discordIdentity{}, false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return discordIdentity{}, false, nil
	}
	if response.StatusCode != http.StatusOK {
		return discordIdentity{}, false, fmt.Errorf("discord returned %d", response.StatusCode)
	}
	var identity discordIdentity
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&identity); err != nil || identity.ID == "" {
		return discordIdentity{}, false, errors.New("unexpected discord response")
	}
	return identity, identity.Bot, nil
}

func validDiscordTokenShape(token string) bool {
	if len(token) < 50 || len(token) > 120 || strings.Count(token, ".") != 2 {
		return false
	}
	for _, r := range token {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func (s *server) saveBotToken(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		Token    string `json:"token"`
		Variable string `json:"variable"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	token := strings.TrimSpace(input.Token)
	token = strings.TrimPrefix(token, "Bot ")
	variable := strings.ToUpper(strings.TrimSpace(input.Variable))
	if variable == "" {
		variable = "DISCORD_TOKEN"
	}
	if !validBotEnvironmentName(variable) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อตัวแปรใช้ได้แค่ A-Z, 0-9 และ _", Code: "invalid_environment_name"})
	}
	if !validDiscordTokenShape(token) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบโทเคนไม่ถูกต้อง คัดลอกจากหน้า Bot ใน Discord Developer Portal อีกครั้ง", Code: "invalid_token"})
	}
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	identity, valid, checkErr := checkDiscordToken(c.Context(), token)
	if checkErr == nil && !valid {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Discord ไม่รับโทเคนนี้ ลองกด Reset Token ในหน้า Discord แล้ววางใหม่", Code: "token_rejected"})
	}
	ciphertext, err := encryptSecret(token, s.cfg.hostingEncryptionKey)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	state := "valid"
	if checkErr != nil {
		state = "unknown"
		identity = discordIdentity{ID: bot.DiscordBotID, Username: bot.DiscordUsername, Avatar: bot.DiscordAvatar}
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if _, err := tx.Exec(c.Context(), `
		INSERT INTO bot_environment_variables (bot_id,name,value_ciphertext,is_secret)
		VALUES ($1,$2,$3,TRUE)
		ON CONFLICT (bot_id,name) DO UPDATE SET value_ciphertext=EXCLUDED.value_ciphertext,is_secret=TRUE,updated_at=NOW()
	`, bot.ID, variable, ciphertext); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if bot.TokenVariable != "" && bot.TokenVariable != variable {
		if _, err := tx.Exec(c.Context(), `DELETE FROM bot_environment_variables WHERE bot_id=$1 AND name=$2`, bot.ID, bot.TokenVariable); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	if _, err := tx.Exec(c.Context(), `
		UPDATE bot_apps SET token_variable=$2,token_state=$3,token_checked_at=NOW(),
		       discord_bot_id=$4,discord_username=$5,discord_avatar=$6,updated_at=NOW()
		WHERE id=$1
	`, bot.ID, variable, state, truncateRunes(identity.ID, 32), truncateRunes(identity.Username, 100), truncateRunes(identity.Avatar, 100)); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.token.updated", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"variable": variable, "state": state}})
	bot, err = loadBot(c.Context(), s.db, actor, bot.PublicID, false)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"bot": botJSON(bot, isPlatformAdmin(actor)), "checked": checkErr == nil})
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

// ---- Environment ---------------------------------------------------------------------------

var reservedBotEnvironmentNames = map[string]bool{
	"HOME": true, "PATH": true, "PWD": true, "USER": true, "SHELL": true, "HOSTNAME": true,
	"DATA_DIR": true, "PYTHONPATH": true, "PYTHONUNBUFFERED": true, "PYTHONDONTWRITEBYTECODE": true,
	"NODE_OPTIONS": true, "LD_PRELOAD": true, "LD_LIBRARY_PATH": true,
}

func validBotEnvironmentName(name string) bool {
	return hostingEnvironmentNamePattern.MatchString(name) && !reservedBotEnvironmentNames[name]
}

func (s *server) listBotEnvironment(c *fiber.Ctx) error {
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT name,value_ciphertext,is_secret,updated_at FROM bot_environment_variables
		WHERE bot_id=$1 ORDER BY name
	`, bot.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]fiber.Map, 0)
	for rows.Next() {
		var name, ciphertext string
		var isSecret bool
		var updatedAt time.Time
		if err := rows.Scan(&name, &ciphertext, &isSecret, &updatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		// Secret values never leave the server; only plain settings come back for editing.
		value := ""
		if !isSecret {
			if value, err = decryptSecret(ciphertext, s.cfg.hostingEncryptionKey); err != nil {
				value = ""
			}
		}
		items = append(items, fiber.Map{"name": name, "value": value, "isSecret": isSecret, "isToken": name == bot.TokenVariable, "updatedAt": updatedAt})
	}
	return c.JSON(fiber.Map{"items": items})
}

type botEnvironmentInput struct {
	Items []hostingEnvironmentInput `json:"items"`
}

// upsertBotEnvironment saves one or many variables (a pasted .env sends many at once).
func (s *server) upsertBotEnvironment(c *fiber.Ctx) error {
	actor := current(c)
	var input botEnvironmentInput
	if c.BodyParser(&input) != nil || len(input.Items) == 0 || len(input.Items) > 50 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	type prepared struct {
		name, ciphertext string
		secret           bool
	}
	values := make([]prepared, 0, len(input.Items))
	for _, item := range input.Items {
		name := strings.ToUpper(strings.TrimSpace(item.Name))
		if !validBotEnvironmentName(name) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อตัวแปร " + truncateRunes(item.Name, 64) + " ใช้ไม่ได้ ใช้ได้แค่ A-Z, 0-9 และ _ และห้ามขึ้นต้นด้วยตัวเลข", Code: "invalid_environment_name"})
		}
		if len(item.Value) > 32*1024 || strings.IndexByte(item.Value, 0) >= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ค่าของ " + name + " ยาวเกิน 32 KB", Code: "environment_value_too_large"})
		}
		ciphertext, err := encryptSecret(item.Value, s.cfg.hostingEncryptionKey)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		values = append(values, prepared{name, ciphertext, item.IsSecret || name == bot.TokenVariable})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	for _, value := range values {
		if _, err := tx.Exec(c.Context(), `
			INSERT INTO bot_environment_variables (bot_id,name,value_ciphertext,is_secret)
			VALUES ($1,$2,$3,$4)
			ON CONFLICT (bot_id,name) DO UPDATE SET value_ciphertext=EXCLUDED.value_ciphertext,
			       is_secret=EXCLUDED.is_secret,updated_at=NOW()
		`, bot.ID, value.name, value.ciphertext, value.secret); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	var count int
	if err := tx.QueryRow(c.Context(), `SELECT COUNT(*) FROM bot_environment_variables WHERE bot_id=$1`, bot.ID).Scan(&count); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if count > 50 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "บอทหนึ่งตัวมีตัวแปรได้ไม่เกิน 50 ตัว", Code: "environment_limit"})
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	names := make([]string, 0, len(values))
	for _, value := range values {
		names = append(names, value.name)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.environment.updated", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"names": names}})
	return c.JSON(fiber.Map{"ok": true, "restartRequired": bot.Status == "running"})
}

func (s *server) deleteBotEnvironment(c *fiber.Ctx) error {
	actor := current(c)
	name := strings.ToUpper(strings.TrimSpace(c.Params("name")))
	if !hostingEnvironmentNamePattern.MatchString(name) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อตัวแปรไม่ถูกต้อง", Code: "invalid_environment_name"})
	}
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	tag, err := s.db.Exec(c.Context(), `DELETE FROM bot_environment_variables WHERE bot_id=$1 AND name=$2`, bot.ID, name)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบตัวแปรนี้", Code: "environment_not_found"})
	}
	if name == bot.TokenVariable {
		if _, err := s.db.Exec(c.Context(), `
			UPDATE bot_apps SET token_variable='',token_state='unknown',token_checked_at=NULL,updated_at=NOW() WHERE id=$1
		`, bot.ID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.environment.deleted", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"name": name}})
	return c.JSON(fiber.Map{"ok": true, "restartRequired": bot.Status == "running"})
}
