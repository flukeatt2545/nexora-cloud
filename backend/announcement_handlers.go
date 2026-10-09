package main

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type announcementInput struct {
	Title       string  `json:"title"`
	Message     string  `json:"message"`
	ImageURL    string  `json:"imageUrl"`
	CustomColor string  `json:"customColor"`
	Kind        string  `json:"kind"`
	Placement   string  `json:"placement"`
	Severity    string  `json:"severity"`
	ButtonLabel string  `json:"buttonLabel"`
	ButtonURL   string  `json:"buttonUrl"`
	Active      bool    `json:"active"`
	StartsAt    *string `json:"startsAt"`
	EndsAt      *string `json:"endsAt"`
	Meta        map[string]any `json:"meta"`
}

func parseOptionalTime(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, *value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func validateAnnouncement(body *announcementInput) (*time.Time, *time.Time, string) {
	body.Title = cleanText(body.Title, 120)
	body.Message = cleanText(body.Message, 2000)
	body.ImageURL = cleanText(body.ImageURL, 1000)
	body.CustomColor = cleanText(body.CustomColor, 50)
	body.ButtonLabel = cleanText(body.ButtonLabel, 50)
	body.ButtonURL = cleanText(body.ButtonURL, 500)
	if body.Title == "" && body.Message == "" && body.ImageURL == "" {
		return nil, nil, "โปรดกรอกหัวข้อ ข้อความ หรือรูปภาพอย่างน้อย 1 รายการ"
	}
	if body.Kind != "banner" && body.Kind != "popup" && body.Kind != "marquee" {
		return nil, nil, "รูปแบบประกาศไม่ถูกต้อง"
	}
	if body.Placement != "homepage" && body.Placement != "login" && body.Placement != "both" {
		return nil, nil, "ตำแหน่งประกาศไม่ถูกต้อง"
	}
	if body.Severity != "info" && body.Severity != "success" && body.Severity != "warning" && body.Severity != "error" {
		return nil, nil, "ระดับประกาศไม่ถูกต้อง"
	}
	if body.ButtonURL != "" {
		parsed, err := url.Parse(body.ButtonURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https" && !strings.HasPrefix(body.ButtonURL, "/")) {
			return nil, nil, "ลิงก์ประกาศไม่ถูกต้อง"
		}
	}
	startsAt, err := parseOptionalTime(body.StartsAt)
	if err != nil {
		return nil, nil, "เวลาเริ่มต้นไม่ถูกต้อง"
	}
	endsAt, err := parseOptionalTime(body.EndsAt)
	if err != nil {
		return nil, nil, "เวลาสิ้นสุดไม่ถูกต้อง"
	}
	if startsAt != nil && endsAt != nil && !endsAt.After(*startsAt) {
		return nil, nil, "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น"
	}
	return startsAt, endsAt, ""
}

func scanAnnouncement(scanner interface{ Scan(...any) error }) (fiber.Map, error) {
	var id int64
	var title, message, imageURL, customColor, kind, placement, severity, buttonLabel, buttonURL string
	var active bool
	var startsAt, endsAt *time.Time
	var createdAt, updatedAt time.Time
	var metaBytes []byte

	err := scanner.Scan(&id, &title, &message, &imageURL, &customColor, &kind, &placement, &severity, &buttonLabel, &buttonURL, &active, &startsAt, &endsAt, &createdAt, &updatedAt, &metaBytes)
	var meta map[string]any
	if len(metaBytes) > 0 {
		json.Unmarshal(metaBytes, &meta)
	}
	if meta == nil {
		meta = map[string]any{}
	}
	return fiber.Map{
		"id": id, "title": title, "message": message, "imageUrl": imageURL, "customColor": customColor,
		"kind": kind, "placement": placement, "severity": severity, "buttonLabel": buttonLabel,
		"buttonUrl": buttonURL, "active": active, "startsAt": startsAt, "endsAt": endsAt,
		"createdAt": createdAt, "updatedAt": updatedAt, "meta": meta,
	}, err
}

const announcementColumns = `id,title,message,image_url,custom_color,kind,placement,severity,button_label,button_url,active,starts_at,ends_at,created_at,updated_at,meta`

func (s *server) publicAnnouncements(c *fiber.Ctx) error {
	placement := c.Query("placement", "homepage")
	if placement != "homepage" && placement != "login" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตำแหน่งไม่ถูกต้อง"})
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT `+announcementColumns+` FROM announcements
		WHERE active = TRUE
		  AND (placement = $1 OR placement = 'both')
		  AND (starts_at IS NULL OR starts_at <= NOW())
		  AND (ends_at IS NULL OR ends_at > NOW())
		ORDER BY kind, created_at DESC
	`, placement)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		item, scanErr := scanAnnouncement(rows)
		if scanErr == nil {
			items = append(items, item)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminAnnouncements(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+announcementColumns+` FROM announcements ORDER BY id DESC`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		item, scanErr := scanAnnouncement(rows)
		if scanErr == nil {
			items = append(items, item)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) createAnnouncement(c *fiber.Ctx) error {
	actor := current(c)
	var body announcementInput
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	startsAt, endsAt, message := validateAnnouncement(&body)
	if message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: message})
	}
	item, err := scanAnnouncement(s.db.QueryRow(c.Context(), `
		INSERT INTO announcements
		  (title,message,image_url,custom_color,kind,placement,severity,button_label,button_url,active,starts_at,ends_at,created_by,updated_by,meta)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14)
		RETURNING `+announcementColumns,
		body.Title, body.Message, body.ImageURL, body.CustomColor, body.Kind, body.Placement, body.Severity, body.ButtonLabel,
		body.ButtonURL, body.Active, startsAt, endsAt, actor.ID, body.Meta,
	))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "content", Action: "announcement.created", Target: "announcement", TargetID: strconv.FormatInt(item["id"].(int64), 10)})
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (s *server) updateAnnouncement(c *fiber.Ctx) error {
	actor := current(c)
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประกาศไม่ถูกต้อง"})
	}
	var body announcementInput
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	startsAt, endsAt, message := validateAnnouncement(&body)
	if message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: message})
	}
	item, err := scanAnnouncement(s.db.QueryRow(c.Context(), `
		UPDATE announcements SET title=$1,message=$2,image_url=$3,custom_color=$4,kind=$5,placement=$6,severity=$7,
		  button_label=$8,button_url=$9,active=$10,starts_at=$11,ends_at=$12,updated_by=$13,updated_at=NOW(),meta=$14
		WHERE id=$15 RETURNING `+announcementColumns,
		body.Title, body.Message, body.ImageURL, body.CustomColor, body.Kind, body.Placement, body.Severity, body.ButtonLabel,
		body.ButtonURL, body.Active, startsAt, endsAt, actor.ID, body.Meta, id,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบประกาศ"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "content", Action: "announcement.updated", Target: "announcement", TargetID: strconv.FormatInt(id, 10)})
	return c.JSON(item)
}

func (s *server) deleteAnnouncement(c *fiber.Ctx) error {
	actor := current(c)
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประกาศไม่ถูกต้อง"})
	}
	result, err := s.db.Exec(c.Context(), `DELETE FROM announcements WHERE id=$1`, id)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if result.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบประกาศ"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "content", Action: "announcement.deleted", Target: "announcement", TargetID: strconv.FormatInt(id, 10)})
	return c.SendStatus(fiber.StatusNoContent)
}
