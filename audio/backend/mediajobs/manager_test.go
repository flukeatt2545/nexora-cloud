package mediajobs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestThaiFilenameRetainsMarks(t *testing.T) {
	if got := safeName("01 - ทดสอบเสียง"); got != "01 - ทดสอบเสียง" {
		t.Fatalf("Thai marks lost: %s", got)
	}
	if got := safeName("../../outside"); got != "outside" {
		t.Fatalf("unsafe filename: %s", got)
	}
}

func TestLongUnicodeFilenames(t *testing.T) {
	const reportedTitle = "เธอไม่ได้เป็นแฟนฉัน ฉันไม่ได้เป็นแฟนของเธอ+ถ้าเราได้เจอกัน#จัดไปสายปาร์ตี้ @ผู้บ่าวหนวด"
	for _, title := range []string{reportedTitle, strings.Repeat("ทดสอบเสียง", 40), strings.Repeat("音楽", 100), strings.Repeat("a", 200)} {
		base := safeName("01 - " + title)
		if !utf8.ValidString(base) || len(base) > 240 || utf8.RuneCountInString(base) > 100 {
			t.Fatalf("invalid filename: bytes=%d runes=%d valid=%v", len(base), utf8.RuneCountInString(base), utf8.ValidString(base))
		}
		for _, extension := range []string{".mp3", ".m4a", ".flac", ".zip"} {
			name := base + extension
			if len(name) > 255 {
				t.Fatalf("filename exceeds filesystem byte limit: %d", len(name))
			}
			if err := os.WriteFile(filepath.Join(t.TempDir(), name), []byte("test"), 0o600); err != nil {
				t.Fatalf("cannot create %s file: %v", extension, err)
			}
		}
	}
}

func TestFilenameTrimmingAfterTruncation(t *testing.T) {
	if got := safeName(strings.Repeat("a", 99) + " .tail"); got != strings.Repeat("a", 99) {
		t.Fatalf("truncated filename ends in a space or dot: %q", got)
	}
	for _, input := range []string{"", "../..", " / ", "..."} {
		if got := safeName(input); got != "audio" {
			t.Fatalf("empty sanitized filename: %q", got)
		}
	}
}
