package ffmpeg

import "testing"

func TestValidateOptions(t *testing.T) {
	for _, test := range []struct {
		format  string
		quality int
		valid   bool
	}{
		{"mp3", 320, true}, {"mp3", 512, false}, {"m4a", 256, true},
		{"flac", 0, true}, {"flac", 320, false}, {"wav", 0, false},
	} {
		if got := ValidateOptions(test.format, test.quality) == nil; got != test.valid {
			t.Fatalf("ValidateOptions(%q, %d) valid=%v, want %v", test.format, test.quality, got, test.valid)
		}
	}
}

func TestLongThaiTitlePreservedInMetadata(t *testing.T) {
	const title = "เธอไม่ได้เป็นแฟนฉัน ฉันไม่ได้เป็นแฟนของเธอ+ถ้าเราได้เจอกัน#จัดไปสายปาร์ตี้ @ผู้บ่าวหนวด"
	if got := cleanMetadata(title); got != title {
		t.Fatalf("original title must be preserved in tags: %q", got)
	}
}
