package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// The phpMyAdmin container holds PMA_INTERNAL_SECRET. It must not open the bot API, and a bot
// must not become an admin by saying so in a header.
func TestBotAPIIsSeparateFromPhpMyAdminSecret(t *testing.T) {
	s := &server{}
	s.cfg.botInternalSecret = "bot-secret"
	s.cfg.phpMyAdminInternalSecret = "pma-secret"
	app := fiber.New()
	app.Get("/secret", func(c *fiber.Ctx) error {
		if err := s.verifyBotSecret(c); err != nil {
			return err
		}
		return c.SendStatus(fiber.StatusOK)
	})
	app.Get("/scope", func(c *fiber.Ctx) error {
		if err := s.requireBotScope(c, "lockdown.manage"); err != nil {
			return err
		}
		return c.SendStatus(fiber.StatusOK)
	})

	cases := []struct {
		name    string
		path    string
		headers map[string]string
		want    int
	}{
		{"bot secret", "/secret", map[string]string{"X-Bot-Internal-Secret": "bot-secret"}, 200},
		{"pma secret in pma header", "/secret", map[string]string{"X-PMA-Internal-Secret": "pma-secret"}, 403},
		{"pma secret in bot header", "/secret", map[string]string{"X-Bot-Internal-Secret": "pma-secret"}, 403},
		{"no secret", "/secret", nil, 403},
		{"asserted admin is ignored", "/scope", map[string]string{
			"X-Bot-Internal-Secret":  "bot-secret",
			"X-Bot-Actor-Discord-Id": "123456789012345678",
			"X-Bot-Actor-Is-Admin":   "true",
		}, 403},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", tc.path, nil)
		for k, v := range tc.headers {
			req.Header.Set(k, v)
		}
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%s: status %d, want %d", tc.name, res.StatusCode, tc.want)
		}
	}

	// A configured admin id still gets the scope, without any header claim.
	s.cfg.discordAdminIDs = map[string]bool{"123456789012345678": true}
	req := httptest.NewRequest("GET", "/scope", nil)
	req.Header.Set("X-Bot-Internal-Secret", "bot-secret")
	req.Header.Set("X-Bot-Actor-Discord-Id", "123456789012345678")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("configured admin denied: %d", res.StatusCode)
	}

	// A bot secret equal to the phpMyAdmin secret fails closed.
	s.cfg.botInternalSecret = "pma-secret"
	req = httptest.NewRequest("GET", "/secret", nil)
	req.Header.Set("X-Bot-Internal-Secret", "pma-secret")
	res, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("shared secret accepted: %d", res.StatusCode)
	}
}
