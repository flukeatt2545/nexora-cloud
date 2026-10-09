package main

import "testing"

func TestStripMailHTML(t *testing.T) {
	got := stripMailHTML("<p>สวัสดี<br>โลก</p>")
	if got == "" || !containsAll(got, "สวัสดี", "โลก") {
		t.Fatalf("unexpected text: %q", got)
	}
}

func TestValidDiscordSnowflake(t *testing.T) {
	if validDiscordSnowflake("1084025347009433650") != true {
		t.Fatal("expected valid snowflake")
	}
	if validDiscordSnowflake("not-an-id") || validDiscordSnowflake("123") || validDiscordSnowflake("") {
		t.Fatal("expected invalid snowflakes to be rejected")
	}
}

func TestParseDiscordIDList(t *testing.T) {
	ids := parseDiscordIDList("1084025347009433650, junk, 1266835970443972609")
	if !ids["1084025347009433650"] || !ids["1266835970443972609"] || len(ids) != 2 {
		t.Fatalf("unexpected allowlist: %#v", ids)
	}
}

func TestValidMailboxPublicID(t *testing.T) {
	if !validMailboxPublicID("abc12345deadbeef") {
		t.Fatal("expected valid mailbox id")
	}
	if validMailboxPublicID("../etc/passwd") || validMailboxPublicID("short") {
		t.Fatal("expected invalid mailbox ids to be rejected")
	}
}

func TestParseDiscordBotKey(t *testing.T) {
	key, fallback, ok := parseDiscordBotKey("nexora")
	if !ok || key != "nexora" || fallback != "NEXORA" {
		t.Fatalf("got %q %q %v", key, fallback, ok)
	}
	if _, _, ok := parseDiscordBotKey("unknown"); ok {
		t.Fatal("expected unknown bot to be rejected")
	}
}

func TestNormalizeMailDiscordActivity(t *testing.T) {
	gotType, gotText, err := normalizeMailDiscordActivity(" Watching ", "  เมลของคุณ\nตอนนี้  ")
	if err != nil || gotType != "watching" || gotText != "เมลของคุณ ตอนนี้" {
		t.Fatalf("got %q %q %v", gotType, gotText, err)
	}
	if _, _, err := normalizeMailDiscordActivity("streaming", "เมล"); err == nil {
		t.Fatal("expected invalid type")
	}
	if _, _, err := normalizeMailDiscordActivity("playing", "   "); err == nil {
		t.Fatal("expected empty text")
	}
	gotType, gotText, err = normalizeMailDiscordActivity("custom", "ออนไลน์")
	if err != nil || gotType != "custom" || gotText != "ออนไลน์" {
		t.Fatalf("custom type: %q %q %v", gotType, gotText, err)
	}
}

func TestClipDiscordText(t *testing.T) {
	if clipDiscordText("abc", 10) != "abc" {
		t.Fatal("short text should stay intact")
	}
	got := clipDiscordText("สวัสดีชาวโลก", 4)
	if got == "สวัสดีชาวโลก" || !containsString(got, "…") {
		t.Fatalf("got %q", got)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !containsString(value, part) {
			return false
		}
	}
	return true
}

func containsString(value, part string) bool {
	return len(value) >= len(part) && (value == part || len(part) == 0 || (len(value) > 0 && (func() bool {
		for i := 0; i+len(part) <= len(value); i++ {
			if value[i:i+len(part)] == part {
				return true
			}
		}
		return false
	})()))
}
