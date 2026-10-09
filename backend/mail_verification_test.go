package main

import "testing"

func TestShouldStartMailVerification(t *testing.T) {
	for _, status := range []string{"verified", "pending", "partially_verified", "", "unknown"} {
		if shouldStartMailVerification(status) {
			t.Errorf("must not restart verification for %q", status)
		}
	}
	for _, status := range []string{"not_started", "failed", "temporary_failure", "partially_failed", " FAILED "} {
		if !shouldStartMailVerification(status) {
			t.Errorf("must start verification for %q", status)
		}
	}
}
