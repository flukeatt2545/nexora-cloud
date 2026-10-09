package downloader

import "testing"

func TestValidateYouTubeURL(t *testing.T) {
	valid := []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
		"https://music.youtube.com/playlist?list=PL123",
	}
	for _, value := range valid {
		if _, err := ValidateYouTubeURL(value); err != nil {
			t.Fatalf("expected valid URL %q: %v", value, err)
		}
	}
	invalid := []string{
		"http://youtube.com/watch?v=1",
		"https://youtube.com.evil.test/watch?v=1",
		"https://user:pass@youtube.com/watch?v=1",
		"file:///etc/passwd",
	}
	for _, value := range invalid {
		if _, err := ValidateYouTubeURL(value); err == nil {
			t.Fatalf("expected invalid URL %q", value)
		}
	}
}
