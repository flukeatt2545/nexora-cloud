package main

import (
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func embedFieldNames(embed fiber.Map) []string {
	names := []string{}
	for _, field := range embed["fields"].([]fiber.Map) {
		names = append(names, field["name"].(string))
	}
	return names
}

func TestParseUserAgentMobileBeforeDesktop(t *testing.T) {
	cases := map[string]string{
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1":        "Safari บน iPhone",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1": "Chrome บน iPhone",
		"Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36":     "Samsung Internet บน Android",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15":                          "Safari บน macOS",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0":                  "Edge บน Windows",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0":                  "Opera บน Windows",
	}
	for ua, want := range cases {
		if got := parseUserAgent(ua); got != want {
			t.Errorf("parseUserAgent(%q) = %q, want %q", ua, got, want)
		}
	}
}

func TestSecurityLoginEmbedReadsAsOneSentence(t *testing.T) {
	embed := buildDiscordEmbed(auditEvent{
		Actor: &currentUser{Username: "nkn", Role: "superadmin"}, Action: "auth.login", Target: "user", TargetID: "2", Outcome: "success",
		IPAddress: "223.206.230.140", UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15",
		Geo: &GeoLocation{City: "Udon Thani", Country: "Thailand", ISP: "Triple T Broadband", Lat: 17.135, Lon: 102.972},
	})
	if embed["title"] != "เข้าสู่ระบบ" || embed["description"] != "**nkn** เข้าสู่ระบบด้วยรหัสผ่าน" {
		t.Fatalf("unexpected copy: %v / %v", embed["title"], embed["description"])
	}
	names := strings.Join(embedFieldNames(embed), "|")
	if names != "ทำโดย|IP|อุปกรณ์|ผู้ให้บริการเน็ต (จาก IP)" {
		t.Fatalf("unexpected fields: %s", names)
	}
	place := embed["fields"].([]fiber.Map)[3]["value"].(string)
	if place != "**Triple T Broadband · Thailand**\nพื้นที่ที่จดเลข IP: Udon Thani (ไม่ใช่ตำแหน่งจริงของผู้ใช้)" {
		t.Fatalf("provider field must lead with the ISP and never link a map: %q", place)
	}
	if _, ok := embed["timestamp"]; ok {
		t.Fatal("the Thai footer time replaces Discord's timestamp")
	}
	if footer := embed["footer"].(fiber.Map)["text"].(string); !strings.Contains(footer, "25") || !strings.Contains(footer, "น.") {
		t.Fatalf("footer should carry the Thai date: %s", footer)
	}
}

func TestSecurityEmbedFailureWording(t *testing.T) {
	register := buildDiscordEmbed(auditEvent{Action: "auth.register", Outcome: "failure", Metadata: map[string]any{"reason": "account_exists"}})
	if register["title"] != "สมัครสมาชิกไม่สำเร็จ" || strings.Contains(register["description"].(string), "รหัสผ่าน") {
		t.Fatalf("register failure must not blame the password: %v", register["description"])
	}
	oauth := buildDiscordEmbed(auditEvent{Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": "discord"}})
	if oauth["title"] != "เข้าสู่ระบบด้วย Discord ไม่สำเร็จ" {
		t.Fatalf("oauth failure title: %v", oauth["title"])
	}
	brute := buildDiscordEmbed(auditEvent{Action: "auth.login", Outcome: "failure", Metadata: map[string]any{"username": "a_b", "reason": "bruteforce_limit_reached", "threat": "bruteforce", "attempt_count": 5}})
	if !strings.Contains(brute["description"].(string), `**a\_b**`) || brute["color"] != securityColorThreat {
		t.Fatalf("brute force embed: %v", brute["description"])
	}
	alert := buildDiscordEmbed(auditEvent{Action: "ip.banned_access", Outcome: "failure", Target: "ip", TargetID: "1.2.3.4"})
	if strings.Contains(alert["title"].(string), "ไม่สำเร็จ") || !strings.Contains(alert["description"].(string), "`1.2.3.4`") {
		t.Fatalf("banned access alert: %v / %v", alert["title"], alert["description"])
	}
}

func TestSecurityEmbedNamesTheTarget(t *testing.T) {
	role := buildDiscordEmbed(auditEvent{Actor: &currentUser{Username: "nkn", Role: "superadmin"}, Action: "user.role_changed", Target: "user", TargetID: "9", TargetName: "bob",
		Metadata: map[string]any{"oldRole": "user", "newRole": "admin"}})
	if role["description"] != "**nkn** เปลี่ยนระดับสิทธิ์ของ **bob** จาก **ผู้ใช้งาน** เป็น **แอดมิน**" {
		t.Fatalf("role change: %v", role["description"])
	}
	status := buildDiscordEmbed(auditEvent{Actor: &currentUser{Username: "nkn", Role: "admin"}, Action: "user.status_changed", Target: "user", TargetID: "9",
		Metadata: map[string]any{"status": "suspended"}})
	if status["title"] != "ระงับบัญชี" || !strings.Contains(status["description"].(string), "บัญชี #9") {
		t.Fatalf("status change: %v / %v", status["title"], status["description"])
	}
	for _, name := range embedFieldNames(status) {
		if name == "IP" {
			t.Fatal("no IP field without an IP")
		}
	}
}

func TestSecurityEmbedAccountTargeted(t *testing.T) {
	embed := buildDiscordEmbed(auditEvent{Action: "auth.login", Outcome: "failure", IPAddress: "1.2.3.4",
		Metadata: map[string]any{"username": "nkn", "threat": "account_targeted", "reason": "account_targeted", "attempt_count": int64(10)}})
	if embed["title"] != "🚨 มีคนสุ่มรหัสผ่านบัญชีเดียวจากหลาย IP" || !strings.Contains(embed["description"].(string), "**nkn**") || !strings.Contains(embed["description"].(string), "10 ครั้ง") {
		t.Fatalf("account targeted embed: %v / %v", embed["title"], embed["description"])
	}
}

func TestAccountFailureDelayIsCapped(t *testing.T) {
	cases := map[int64]time.Duration{1: 0, 10: 0, 11: time.Second, 13: 3 * time.Second, 50: 3 * time.Second}
	for count, want := range cases {
		if got := accountFailureDelay(count); got != want {
			t.Errorf("accountFailureDelay(%d) = %v, want %v", count, got, want)
		}
	}
	if accountFailureKey(" NKN ") != accountFailureKey("nkn") {
		t.Fatal("account key must ignore case and spaces")
	}
}

func TestSecurityEmbedBulkDatabaseRestore(t *testing.T) {
	embed := buildDiscordEmbed(auditEvent{Actor: &currentUser{Username: "nkn", Role: "superadmin"}, Action: "hosting.database.unsuspended",
		Target: "hosting_database", TargetID: "2 databases", Metadata: map[string]any{"name": "nxdb_a, nxdb_b", "count": 2, "failed": ""}})
	if embed["title"] != "ปลดระงับฐานข้อมูล MySQL" || embed["description"] != "**nkn** ปลดระงับฐานข้อมูล 2 ตัวพร้อมกัน" {
		t.Fatalf("bulk restore embed: %v / %v", embed["title"], embed["description"])
	}
	if !strings.Contains(embed["fields"].([]fiber.Map)[1]["value"].(string), `nxdb\_a, nxdb\_b`) {
		t.Fatalf("bulk restore should list the databases: %v", embed["fields"])
	}
}

func TestVoiceLockoutEmbedNamesMemberAndRoom(t *testing.T) {
	embed := buildDiscordEmbed(auditEvent{
		Action: "discord.voice.locked_out", Target: "voice_room", TargetID: "7", Outcome: "denied", TargetName: "ห้องเล่นเกม",
		Metadata: map[string]any{"name": "ห้องเล่นเกม", "discordActor": "100000000000000001", "failures": 5, "lockoutMinutes": 10},
	})
	if embed["title"] != "ใส่รหัสห้องเสียงผิดจนถูกห้าม" {
		t.Fatalf("title = %v, want the lockout title without a failure suffix", embed["title"])
	}
	description, _ := embed["description"].(string)
	if !strings.Contains(description, "<@100000000000000001>") || !strings.Contains(description, "ห้องเล่นเกม") {
		t.Fatalf("description = %q, want the member mention and the room name", description)
	}
	if !strings.Contains(strings.Join(embedFieldNames(embed), ","), "รายละเอียด") {
		t.Fatalf("fields = %v, want the failure count under details", embedFieldNames(embed))
	}
}

func TestVoiceEventsCanBeChosenForDiscordAlerts(t *testing.T) {
	got := sanitizeWebhookEvents([]string{"discord.voice.locked_out", "discord.voice.entry_denied", "discord.bot_token.updated", "discord.voice.room_created"})
	want := []string{"discord.voice.locked_out", "discord.voice.entry_denied", "discord.bot_token.updated"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("sanitizeWebhookEvents = %v, want %v", got, want)
	}
}
