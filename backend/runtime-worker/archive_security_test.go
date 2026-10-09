package main

import (
	"math"
	"testing"
)

func TestCheckedArchiveSizeRejectsOverflowAndOversize(t *testing.T) {
	if _, err := checkedArchiveSize(math.MaxUint64, maxSingleFile); err == nil {
		t.Fatal("expected uint64 overflow-sized entry to be rejected")
	}
	if _, err := checkedArchiveSize(uint64(maxSingleFile)+1, maxSingleFile); err == nil {
		t.Fatal("expected oversized entry to be rejected")
	}
	if got, err := checkedArchiveSize(uint64(maxSingleFile), maxSingleFile); err != nil || got != maxSingleFile {
		t.Fatalf("expected boundary size to pass, got %d, %v", got, err)
	}
}
