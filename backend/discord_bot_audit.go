package main

import (
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

// Only the internal bot can report activity. Discord cannot provide the actor's IP.
func (s *server) botActivity(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var body struct {
		ActorID   string `json:"actorId"`
		ActorName string `json:"actorName"`
		Command   string `json:"command"`
		Result    string `json:"result"`
		Target    string `json:"target"`
		Details   string `json:"details"`
		Outcome   string `json:"outcome"`
	}
	if len(c.Body()) > 12000 || c.BodyParser(&body) != nil || !discordAccessSnowflakePattern.MatchString(body.ActorID) || utf8.RuneCountInString(body.Command) > 100 || utf8.RuneCountInString(body.ActorName) > 100 || utf8.RuneCountInString(body.Result) > 300 || utf8.RuneCountInString(body.Target) > 200 || utf8.RuneCountInString(body.Details) > 1000 || (body.Outcome != "success" && body.Outcome != "failure" && body.Outcome != "unknown") {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_activity"})
	}
	if strings.TrimSpace(body.Command) == "" {
		return c.SendStatus(400)
	}
	s.audit(nil, auditEvent{Category: "discord", Action: "discord.bot.activity", Target: "discord_bot", TargetID: "nexora", Outcome: body.Outcome,
		Metadata: map[string]any{"discordActor": body.ActorID, "discordName": body.ActorName, "command": body.Command, "result": body.Result, "target": body.Target, "details": body.Details}})
	return c.SendStatus(202)
}

func buildBotActivityEmbed(event auditEvent) fiber.Map {
	copy := botCopy(fmtMetadata(event, "command"))
	color := 0x759BFF
	outcome := "ไม่ทราบผล"
	if event.Outcome == "success" {
		outcome = "สำเร็จ"
	}
	if event.Outcome == "failure" {
		outcome = "ไม่สำเร็จ"
		color = 0xF08F87
	}
	fields := []fiber.Map{
		{"name": "ทำโดย", "value": "<@" + fmtMetadata(event, "discordActor") + ">", "inline": false},
		{"name": "สถานะ", "value": outcome, "inline": false},
	}
	for _, item := range []struct{ key, label string }{{"target", "เป้าหมาย"}, {"details", "รายละเอียด"}, {"result", "สรุป"}} {
		if value := fmtMetadata(event, item.key); value != "" && !(item.key == "result" && (value == copy.title || value == "การควบคุมบอต" || value == "ตอบกลับแล้ว")) {
			fields = append(fields, fiber.Map{"name": item.label, "value": value})
		}
	}
	return fiber.Map{"title": copy.title, "description": copy.description, "color": color, "fields": fields, "footer": securityFooter("บอท NEXORA")}
}

func fmtMetadata(event auditEvent, key string) string {
	value, _ := event.Metadata[key].(string)
	return value
}
