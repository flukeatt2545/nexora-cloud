package filemanager

import "testing"

func TestResultPathRejectsTraversal(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../secret", `..\\secret`, "/tmp/secret"} {
		if _, err := store.ResultPath("12345678", name); err == nil {
			t.Fatalf("expected traversal rejection for %q", name)
		}
	}
	if _, err := store.ResultPath("12345678", "track.mp3"); err != nil {
		t.Fatalf("expected safe filename: %v", err)
	}
}
