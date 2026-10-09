package main

import "strings"

func shouldStartMailVerification(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "not_started", "failed", "temporary_failure", "partially_failed":
		return true
	default:
		return false
	}
}
