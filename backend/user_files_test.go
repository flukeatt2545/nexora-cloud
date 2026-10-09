package main

import (
	"testing"
	"time"
)

func TestCanReadUserFileIsOwnerScoped(t *testing.T) {
	owner := &currentUser{ID: 10, Role: "user"}
	other := &currentUser{ID: 11, Role: "user"}
	admin := &currentUser{ID: 12, Role: "admin"}
	superadmin := &currentUser{ID: 13, Role: "superadmin"}

	if !canReadUserFile(owner, 10) {
		t.Fatal("owner should be able to read their own file")
	}
	if canReadUserFile(other, 10) {
		t.Fatal("a different user must not be able to read the owner's file")
	}
	if canReadUserFile(nil, 10) {
		t.Fatal("an unauthenticated request must not be able to read a private file")
	}
	if !canReadUserFile(admin, 10) || !canReadUserFile(superadmin, 10) {
		t.Fatal("the explicit administrator endpoint must retain administrative access")
	}
}

func TestSafeUserFileType(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		extension   string
		data        []byte
		want        bool
	}{
		{name: "jpeg", contentType: "image/jpeg", extension: ".jpg", data: []byte{0xff, 0xd8, 0xff}, want: true},
		{name: "pdf", contentType: "application/pdf", extension: ".pdf", data: []byte("%PDF-1.7"), want: true},
		{name: "plain text with charset", contentType: "text/plain; charset=utf-8", extension: ".txt", data: []byte("NEXORA QA"), want: true},
		{name: "blocked extension", contentType: "text/plain", extension: ".php", data: []byte("plain text"), want: false},
		{name: "svg scripts", contentType: "image/svg+xml", extension: ".svg", data: []byte("<svg/>"), want: false},
		{name: "windows executable signature", contentType: "application/octet-stream", extension: ".docx", data: []byte{'M', 'Z', 0, 0}, want: false},
		{name: "linux executable signature", contentType: "application/octet-stream", extension: ".docx", data: []byte{0x7f, 'E', 'L', 'F'}, want: false},
		{name: "shell signature", contentType: "text/plain", extension: ".txt", data: []byte("#!/bin/sh"), want: false},
		{name: "unknown binary", contentType: "application/octet-stream", extension: ".bin", data: []byte{1, 2, 3}, want: false},
		{name: "office binary fallback", contentType: "application/octet-stream", extension: ".docx", data: []byte{'P', 'K', 3, 4}, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := safeUserFileType(test.contentType, test.extension, test.data); got != test.want {
				t.Fatalf("safeUserFileType() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestParseShareExpiresIn(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		value   string
		wantNil bool
		delta   time.Duration
		wantErr bool
	}{
		{value: "1d", delta: 24 * time.Hour},
		{value: "7d", delta: 7 * 24 * time.Hour},
		{value: "30d", delta: 30 * 24 * time.Hour},
		{value: "never", wantNil: true},
		{value: " NEVER ", wantNil: true},
		{value: "2d", wantErr: true},
		{value: "", wantErr: true},
	}
	for _, test := range tests {
		got, err := parseShareExpiresIn(test.value, now)
		if test.wantErr {
			if err == nil {
				t.Fatalf("%q: expected error", test.value)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%q: unexpected error: %v", test.value, err)
		}
		if test.wantNil {
			if got != nil {
				t.Fatalf("%q: expected nil expiry, got %v", test.value, got)
			}
			continue
		}
		if got == nil {
			t.Fatalf("%q: expected expiry", test.value)
		}
		if !got.Equal(now.Add(test.delta)) {
			t.Fatalf("%q: got %v want %v", test.value, got, now.Add(test.delta))
		}
	}
}

func TestShareLinkActive(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	past := now.Add(-time.Minute)
	token := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if shareLinkActive(false, token, nil, now) {
		t.Fatal("disabled link was treated as active")
	}
	if shareLinkActive(true, "", nil, now) {
		t.Fatal("empty token was treated as active")
	}
	if !shareLinkActive(true, token, nil, now) {
		t.Fatal("never-expiring link should be active")
	}
	if !shareLinkActive(true, token, &future, now) {
		t.Fatal("future expiry should be active")
	}
	if shareLinkActive(true, token, &past, now) {
		t.Fatal("expired link should be inactive")
	}
	if shareLinkActive(true, token, &now, now) {
		t.Fatal("exactly-now expiry should be inactive")
	}
}

func TestValidShareTokenAndPath(t *testing.T) {
	if validShareToken("short") {
		t.Fatal("short token accepted")
	}
	if validShareToken("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ") {
		t.Fatal("non-hex token accepted")
	}
	good := "0123456789abcdef0123456789abcdef"
	if !validShareToken(good) {
		t.Fatal("valid token rejected")
	}
	if got := publicUserFileSharePath(good); got != "/files/d/"+good {
		t.Fatalf("unexpected share path: %s", got)
	}
}

func TestSafeUserFilePreviewType(t *testing.T) {
	tests := []struct {
		contentType string
		want        bool
	}{
		{contentType: "application/pdf", want: true},
		{contentType: "image/png", want: true},
		{contentType: "video/mp4", want: true},
		{contentType: "audio/mpeg", want: true},
		{contentType: "text/plain", want: true},
		{contentType: "text/markdown", want: true},
		{contentType: "text/csv", want: true},
		{contentType: "application/json", want: true},
		{contentType: "application/pdf; charset=binary", want: true},
		{contentType: "image/svg+xml", want: false},
		{contentType: "text/html", want: false},
		{contentType: "text/javascript", want: false},
		{contentType: "application/javascript", want: false},
		{contentType: "application/zip", want: false},
	}
	for _, test := range tests {
		if got := isSafeUserFilePreview(test.contentType); got != test.want {
			t.Fatalf("isSafeUserFilePreview(%q) = %v, want %v", test.contentType, got, test.want)
		}
	}
}

func TestAttachShareStateOmitsExpiredURL(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	token := "0123456789abcdef0123456789abcdef"
	item := userFileItem{}
	attachShareState(&item, true, &token, &past)
	if item.ShareURL != "" {
		t.Fatalf("expired share still exposed URL %q", item.ShareURL)
	}
	if !item.ShareEnabled {
		t.Fatal("shareEnabled should stay true so owner can rotate or revoke")
	}
	attachShareState(&item, true, &token, nil)
	if item.ShareURL != publicUserFileSharePath(token) {
		t.Fatalf("active share missing URL: %q", item.ShareURL)
	}
}
