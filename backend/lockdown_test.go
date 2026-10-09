package main

import (
	"strings"
	"testing"
	"time"
)

func TestValidateLockdownInput(t *testing.T) {
	valid := []int64{0, 1, 60, int64(maxLockdownDuration / time.Second)}
	for _, seconds := range valid {
		input := lockdownUpdateInput{Enabled: true, DurationSeconds: seconds, Reason: strings.Repeat("ก", 250)}
		if err := validateLockdownInput(&input); err != nil {
			t.Fatalf("duration %d rejected: %v", seconds, err)
		}
		if len([]rune(input.Reason)) > 200 {
			t.Fatal("reason was not limited")
		}
	}
	for _, seconds := range []int64{-1, int64(maxLockdownDuration/time.Second) + 1} {
		input := lockdownUpdateInput{Enabled: true, DurationSeconds: seconds}
		if validateLockdownInput(&input) == nil {
			t.Fatalf("duration %d accepted", seconds)
		}
	}
}

func TestControlPageEscapesPrivateValues(t *testing.T) {
	now := time.Now()
	page := controlPageHTML(lockdownState{Enabled: true, StartedAt: &now, PrivateReason: `<script>alert(1)</script>`, Actor: `<admin>`}, lockdownControlSession{Actor: "1546900952940937237", CSRF: `\"bad`}, "พร้อม")
	if strings.Contains(page, `<script>alert(1)</script>`) || strings.Contains(page, `value="\"bad"`) {
		t.Fatal("control page rendered unescaped values")
	}
	if !strings.Contains(page, "ปลดล็อกเว็บไซต์") || !strings.Contains(page, "พร้อม") {
		t.Fatal("control page is missing expected content")
	}
	if !strings.Contains(page, `<details class="meta">`) {
		t.Fatal("control page should hide operator details behind a disclosure")
	}
}

func TestControlAccessPageHasResponsiveLayout(t *testing.T) {
	page := controlAccessPageHTML("401", "ยังเข้าใช้งานไม่ได้", "หน้านี้ต้องเปิดผ่านลิงก์ยืนยันตัวตนความปลอดภัยที่ได้รับอนุญาตเท่านั้น")
	for _, expected := range []string{"error-code", "ช่องทางความปลอดภัยที่กำหนด", "@media(max-width:899px)", "@media(max-height:540px)"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("access page is missing %q", expected)
		}
	}
	for _, forbidden := range []string{"/lockdown access", "บอท Discord", "lock.nove666.pro"} {
		if strings.Contains(page, forbidden) {
			t.Fatalf("access page contains sensitive detail %q", forbidden)
		}
	}
}

func TestControlPagesEmbedFontWithoutRemoteRequests(t *testing.T) {
	for name, page := range map[string]string{
		"access":  controlAccessPageHTML("401", "ยังเข้าใช้งานไม่ได้", "เปิดผ่านลิงก์ส่วนตัว"),
		"control": controlPageHTML(lockdownState{}, lockdownControlSession{Actor: "1546900952940937237", CSRF: "token"}, ""),
	} {
		if !strings.Contains(page, `font-family:"Nexora Thai"`) || !strings.Contains(page, "data:font/woff2;base64,") {
			t.Fatalf("%s page does not embed the Nexora Thai font", name)
		}
		if !strings.Contains(page, "unicode-range:U+0E00-0E7F") {
			t.Fatalf("%s page does not declare Thai unicode range", name)
		}
		if strings.Contains(page, "fonts.googleapis.com") || strings.Contains(page, "fonts.gstatic.com") {
			t.Fatalf("%s page still references a remote font host blocked by CSP", name)
		}
	}
}
