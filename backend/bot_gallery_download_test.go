package main

import "testing"

func TestGalleryZipName(t *testing.T) {
	used := map[string]bool{}
	for _, tc := range []struct{ in, want string }{
		{"cat.png", "cat.png"},
		{"CAT.png", "CAT (2).png"},
		{"cat.png", "cat (3).png"},
		{"../../etc/passwd", "_.._etc_passwd"},
		{"a\\b.jpg", "a_b.jpg"},
		{"...", "image"},
		{"", "image (2)"},
		{"รูป.webp", "รูป.webp"},
	} {
		if got := galleryZipName(tc.in, used); got != tc.want {
			t.Errorf("%q: got %q, want %q", tc.in, got, tc.want)
		}
	}
}
