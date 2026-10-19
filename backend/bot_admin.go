package main

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// adminListBots lists every bot with its owner, and the people who own bots with their quota.
func (s *server) adminListBots(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), botSelect+` WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 500`)
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
		items = append(items, botJSON(bot, true))
	}
	if rows.Err() != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	owners, err := s.db.Query(c.Context(), `
		SELECT u.id,u.identifier,u.bot_limit,COUNT(b.id)
		FROM users u LEFT JOIN bot_apps b ON b.owner_user_id=u.id AND b.deleted_at IS NULL
		GROUP BY u.id
		HAVING COUNT(b.id)>0 OR u.bot_limit IS NOT NULL
		ORDER BY u.identifier
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer owners.Close()
	people := make([]fiber.Map, 0)
	for owners.Next() {
		var id int64
		var username string
		var custom *int
		var count int
		if err := owners.Scan(&id, &username, &custom, &count); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		people = append(people, fiber.Map{"id": id, "username": username, "limit": custom, "bots": count})
	}
	return c.JSON(fiber.Map{"items": items, "owners": people, "defaultLimit": botDefaultLimit()})
}

// adminSearchBotOwners finds users by name so a quota can be set before they have a bot.
func (s *server) adminSearchBotOwners(c *fiber.Ctx) error {
	query := strings.TrimPrefix(strings.TrimSpace(c.Query("q")), "@")
	if query == "" {
		return c.JSON(fiber.Map{"items": []fiber.Map{}})
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT u.id,u.identifier,u.bot_limit,
		       (SELECT COUNT(*) FROM bot_apps b WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL)
		FROM users u WHERE u.identifier ILIKE '%' || $1 || '%'
		ORDER BY LENGTH(u.identifier), u.identifier LIMIT 8
	`, strings.NewReplacer("%", "", "_", "").Replace(query))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]fiber.Map, 0)
	for rows.Next() {
		var id int64
		var username string
		var custom *int
		var count int
		if err := rows.Scan(&id, &username, &custom, &count); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, fiber.Map{"id": id, "username": username, "limit": custom, "bots": count})
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminUpdateBot(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		CPUMillicores *int `json:"cpuMillicores"`
		MemoryMB      *int `json:"memoryMb"`
		DiskLimitMB   *int `json:"diskLimitMb"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	bot, err := s.botFromRequest(c)
	if err != nil || bot.ID == 0 {
		return err
	}
	cpu, memory, disk := bot.CPUMillicores, bot.MemoryMB, bot.DiskLimitMB
	if input.CPUMillicores != nil {
		cpu = *input.CPUMillicores
	}
	if input.MemoryMB != nil {
		memory = *input.MemoryMB
	}
	if input.DiskLimitMB != nil {
		disk = *input.DiskLimitMB
	}
	if cpu < 50 || cpu > 2000 || memory < 64 || memory > 2048 || disk < 64 || disk > 4096 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "CPU 50-2000 millicores, RAM 64-2048 MB, ดิสก์ 64-4096 MB", Code: "invalid_resources"})
	}
	if _, err := s.db.Exec(c.Context(), `
		UPDATE bot_apps SET cpu_millicores=$2,memory_mb=$3,disk_limit_mb=$4,updated_at=NOW() WHERE id=$1
	`, bot.ID, cpu, memory, disk); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.resources.updated", Target: "bot", TargetID: bot.PublicID, Metadata: map[string]any{"cpuMillicores": cpu, "memoryMb": memory, "diskLimitMb": disk}})
	bot, err = loadBot(c.Context(), s.db, actor, bot.PublicID, false)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"bot": botJSON(bot, true), "restartRequired": bot.Status == "running"})
}

func (s *server) adminSetBotLimit(c *fiber.Ctx) error {
	actor := current(c)
	userID, err := strconv.ParseInt(strings.TrimSpace(c.Params("userId")), 10, 64)
	if err != nil || userID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ผู้ใช้ไม่ถูกต้อง", Code: "invalid_user"})
	}
	var input struct {
		Limit *int `json:"limit"`
	}
	if c.BodyParser(&input) != nil || (input.Limit != nil && (*input.Limit < 0 || *input.Limit > 50)) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "โควตาต้องอยู่ระหว่าง 0 ถึง 50", Code: "invalid_limit"})
	}
	var username string
	err = s.db.QueryRow(c.Context(), `UPDATE users SET bot_limit=$2 WHERE id=$1 RETURNING identifier`, userID, input.Limit).Scan(&username)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้", Code: "user_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "bots", Action: "bot.limit.updated", Target: "user", TargetID: strconv.FormatInt(userID, 10), Metadata: map[string]any{"limit": input.Limit}})
	return c.JSON(fiber.Map{"ok": true})
}
