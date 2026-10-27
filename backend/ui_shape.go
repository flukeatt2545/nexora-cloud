package main

import "github.com/gofiber/fiber/v2"

// The site's shape (system_settings.ui_shape): "round", the usual UI, or "square", the cut-corner
// look of the verify page (app/ui-square.css). Everyone sees the one the admin picks; it is
// saved on its own route, next to the main settings form's PATCH.
func (s *server) updateAdminUIShape(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		UIShape string `json:"uiShape"`
	}
	if err := c.BodyParser(&body); err != nil || (body.UIShape != "round" && body.UIShape != "square") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกรูปทรง UI เป็นแบบมนหรือแบบเหลี่ยม"})
	}
	var previous string
	if err := s.db.QueryRow(c.Context(), `
		WITH old AS (SELECT ui_shape FROM system_settings WHERE id=1)
		UPDATE system_settings SET ui_shape=$1, updated_by=$2, updated_at=NOW()
		WHERE id=1
		RETURNING (SELECT ui_shape FROM old)
	`, body.UIShape, actor.ID).Scan(&previous); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if previous != body.UIShape {
		s.audit(c, auditEvent{Actor: actor, Category: "settings", Action: "settings.ui_shape_changed", Target: "system", TargetID: "1", Metadata: map[string]any{"from": previous, "to": body.UIShape}})
	}
	return c.JSON(fiber.Map{"uiShape": body.UIShape})
}
