package main

import (
	"testing"
	"time"
)

func TestSalesPeriodStart(t *testing.T) {
	// 2026-10-05 01:30 in Bangkok is still 2026-10-04 in UTC.
	now := time.Date(2026, 10, 4, 18, 30, 0, 0, time.UTC)

	if got := salesPeriodStart(now, 0); got != nil {
		t.Fatalf("all time should have no start, got %v", got)
	}
	cases := map[int]string{
		1:  "2026-10-05T00:00:00+07:00",
		7:  "2026-09-29T00:00:00+07:00",
		30: "2026-09-06T00:00:00+07:00",
	}
	for days, want := range cases {
		got := salesPeriodStart(now, days)
		if got == nil || got.Format(time.RFC3339) != want {
			t.Errorf("days=%d: got %v, want %s", days, got, want)
		}
	}
}
