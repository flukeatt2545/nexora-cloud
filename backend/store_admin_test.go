package main

import (
	"strings"
	"testing"
)

func TestBotUploadKeyPatternKeepsDiscordImagesPublic(t *testing.T) {
	bot := []string{
		"uploads/0123456789abcdef01234567.png",
		"uploads/0123456789abcdef01234567.jpg",
		"uploads/abcdefabcdefabcdefabcdef.webp",
		"uploads/abcdefabcdefabcdefabcdef.gif",
	}
	for _, key := range bot {
		if !botUploadKeyPattern.MatchString(key) {
			t.Errorf("%s should be treated as a Discord upload and stay in uploads/", key)
		}
	}
	library := []string{
		"uploads/report.pdf",
		"uploads/my-game-pack.zip",
		"uploads/0123456789abcdef01234567.zip",
		"uploads/0123456789abcdef0123456.png",
		"uploads/sub/0123456789abcdef01234567.png",
		"uploads/0123456789ABCDEF01234567.png",
	}
	for _, key := range library {
		if botUploadKeyPattern.MatchString(key) {
			t.Errorf("%s should be treated as a library file and move to library/", key)
		}
	}
}

func TestCoverAndProductFilesUseSeparatePrefixes(t *testing.T) {
	if got := adminLibraryPrefixFor("cover"); got != storeCoverPrefix {
		t.Fatalf("cover kind should use %s, got %s", storeCoverPrefix, got)
	}
	for _, kind := range []string{"", "product", "COVER", "../x"} {
		if got := adminLibraryPrefixFor(kind); got != adminLibraryPrefix {
			t.Errorf("kind %q should use the product library, got %s", kind, got)
		}
	}
	if strings.HasPrefix(storeCoverPrefix, adminLibraryPrefix) || strings.HasPrefix(adminLibraryPrefix, storeCoverPrefix) {
		t.Fatal("cover and product prefixes must not nest, or one picker would list the other's files")
	}
	if coverImageTypes["image/svg+xml"] {
		t.Fatal("covers are public; SVG must not be allowed")
	}
}
