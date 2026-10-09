package main

import (
	"math"
	"testing"
)

func TestCheckedWorkspaceArchiveSizeRejectsOverflow(t *testing.T) {
	const limit = int64(50 * 1024 * 1024)
	if _, ok := checkedWorkspaceArchiveSize(math.MaxUint64, limit); ok {
		t.Fatal("expected uint64 overflow-sized entry to be rejected")
	}
	if _, ok := checkedWorkspaceArchiveSize(uint64(limit)+1, limit); ok {
		t.Fatal("expected oversized entry to be rejected")
	}
	if got, ok := checkedWorkspaceArchiveSize(uint64(limit), limit); !ok || got != limit {
		t.Fatalf("expected boundary size to pass, got %d, %v", got, ok)
	}
}
