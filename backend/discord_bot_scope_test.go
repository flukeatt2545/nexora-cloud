package main

import (
	"github.com/gofiber/fiber/v2"
	"net/http/httptest"
	"testing"
)

func TestDelegatedMappingEndpointsFailClosed(t *testing.T) {
	s := &server{}
	s.cfg.phpMyAdminInternalSecret = "test-secret"
	app := fiber.New()
	app.Get("/list", s.botListStudentMappings)
	app.Post("/set", s.botSaveStudentMapping)
	app.Post("/unbind", s.botUnbindStudentDiscord)
	app.Post("/detect", s.botAutoDetectStudentMappings)
	app.Post("/scan", s.botBatchBindStudentDiscord)
	for _, route := range []string{"/list", "/set", "/unbind", "/detect", "/scan"} {
		for _, secret := range []string{"", "test-secret"} {
			method := "POST"
			if route == "/list" {
				method = "GET"
			}
			req := httptest.NewRequest(method, route, nil)
			req.Header.Set("X-Bot-Internal-Secret", secret)
			req.Header.Set("X-Bot-Actor-Discord-Id", "1546900952940937237")
			res, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 403 {
				t.Fatalf("%s accepted an unauthorized caller: %d", route, res.StatusCode)
			}
		}
	}
}
