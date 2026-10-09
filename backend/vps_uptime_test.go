package main

import (
	"strings"
	"testing"
)

func TestParseVPSUptime(t *testing.T) {
	seconds, err := parseVPSUptime("8824167.73 33255202.49\n")
	if err != nil || seconds != 8824167 {
		t.Fatalf("unexpected uptime: seconds=%d err=%v", seconds, err)
	}
	for _, input := range []string{"", "invalid", "-1 0", "NaN 0", "Inf 0"} {
		if _, err := parseVPSUptime(input); err == nil {
			t.Fatalf("invalid uptime %q was accepted", input)
		}
	}
}

func TestVPSUptimePagesArePrivateAndResponsive(t *testing.T) {
	access := vpsUptimeAccessHTML(false)
	for _, expected := range []string{"เข้าสู่ระบบผ่าน NEXORA", "PRIVATE", `/vps/style.css`, `/vps/app.js`} {
		if !strings.Contains(access, expected) {
			t.Fatalf("access page is missing %q", expected)
		}
	}
	for _, expected := range []string{"VPS ทำงานมาแล้ว", "uptime-clock", "เฉพาะผู้ดูแล"} {
		if !strings.Contains(vpsUptimeDashboardHTML, expected) {
			t.Fatalf("dashboard is missing %q", expected)
		}
	}
	for _, expected := range []string{"@media(max-width:640px)", "font-variant-numeric:tabular-nums", "place-items:center"} {
		if !strings.Contains(vpsUptimeCSS, expected) {
			t.Fatalf("responsive CSS is missing %q", expected)
		}
	}
	if strings.Contains(vpsUptimeDashboardHTML, "uptimeSeconds") || strings.Contains(access, "token") {
		t.Fatal("page leaks internal access details")
	}
}

func TestVPSUptimeTicketIsRemovedFromURL(t *testing.T) {
	for _, expected := range []string{"history.replaceState", "window.location.replace('/vps/')", "credentials: 'same-origin'"} {
		if !strings.Contains(vpsUptimeJS, expected) {
			t.Fatalf("script is missing %q", expected)
		}
	}
}
