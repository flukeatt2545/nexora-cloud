package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONBoundary(t *testing.T) {
	for _, test := range []struct {
		body, contentType string
		valid             bool
	}{
		{`{"url":"https://youtu.be/jNQXAC9IVRw"}`, "application/json; charset=utf-8", true},
		{`{"url":"x","path":"../secret"}`, "application/json", false},
		{`{"url":"x"} garbage`, "application/json", false},
		{`{"url":"x"}{"url":"y"}`, "application/json", false},
		{`null`, "text/plain", false},
		{`{"url":22}`, "application/json", false},
	} {
		request := httptest.NewRequest("POST", "/", strings.NewReader(test.body))
		request.Header.Set("Content-Type", test.contentType)
		var payload struct {
			URL string `json:"url"`
		}
		err := decodeJSON(httptest.NewRecorder(), request, &payload)
		if (err == nil) != test.valid {
			t.Fatalf("body=%q contentType=%q: %v", test.body, test.contentType, err)
		}
	}
}
