package main

import (
	"strings"
	"testing"
)

func TestCleanBotUploadFilename(t *testing.T) {
	cases := map[string]string{
		"photo.png":                "photo.png",
		"C:\\Users\\me\\photo.png": "photo.png",
		"../../etc/passwd":         "passwd",
		"  spaced name.jpg  ":      "spaced name.jpg",
		"evil\u202egnp.exe":        "evilgnp.exe",
		"line\nbreak.gif":          "linebreak.gif",
		"":                         "image",
		"..":                       "image",
		"folder/":                  "image",
		"รูปภาพ.webp":              "รูปภาพ.webp",
	}
	for in, want := range cases {
		if got := cleanBotUploadFilename(in); got != want {
			t.Errorf("cleanBotUploadFilename(%q) = %q, want %q", in, got, want)
		}
	}
	long := strings.Repeat("ก", 300) + ".png"
	if got := []rune(cleanBotUploadFilename(long)); len(got) != botUploadNameRunes {
		t.Errorf("long name kept %d runes, want %d", len(got), botUploadNameRunes)
	}
}
