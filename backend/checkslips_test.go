package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCheckSlipsVerifyAsync(t *testing.T) {
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Tenant-ID") != "tenant-1" {
			t.Errorf("unexpected tenant header: %q", r.Header.Get("X-Tenant-ID"))
		}

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/verify":
			if err := r.ParseMultipartForm(checkSlipsMaxImageSize); err != nil {
				t.Fatalf("parse multipart: %v", err)
			}
			if got := r.FormValue("check_duplicate"); got != "true" {
				t.Errorf("check_duplicate=%q", got)
			}
			if got := r.FormValue("receiver_validation_mode"); got != "none" {
				t.Errorf("receiver_validation_mode=%q", got)
			}
			if got := r.FormValue("expected_receiver_bank_code"); got != "" {
				t.Errorf("receiver bank should be validated locally: %q", got)
			}
			if got := r.FormValue("expected_receiver_account_number"); got != "" {
				t.Errorf("receiver account should be validated locally: %q", got)
			}
			if got := r.FormValue("expected_receiver_account_name"); got != "" {
				t.Errorf("receiver name should not be sent with an account number: %q", got)
			}
			file, header, err := r.FormFile("image")
			if err != nil {
				t.Fatalf("image is missing: %v", err)
			}
			defer file.Close()
			if strings.ContainsAny(header.Filename, "\r\n") {
				t.Fatalf("unsafe filename: %q", header.Filename)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data":    map[string]any{"verification_id": "v_test_1", "status": "processing"},
				"message": "accepted",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/verify/v_test_1":
			polls.Add(1)
			receiverMatch := true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data": map[string]any{
					"verification_id": "v_test_1",
					"status":          "verified",
					"amount":          150.25,
					"trans_ref":       "tx-123",
					"receiver_match":  receiverMatch,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := checkSlipsClient{
		baseURL:    server.URL,
		apiToken:   "test-token",
		tenantID:   "tenant-1",
		httpClient: server.Client(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	result, raw, err := client.verify(ctx, "slip\r\n.jpg", "image/jpeg", []byte("image-data"), "topup-test")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "verified" || result.verificationID() != "v_test_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Amount == nil || *result.Amount != 150.25 || result.TransRef == nil || *result.TransRef != "tx-123" {
		t.Fatalf("verification fields were not decoded: %#v", result)
	}
	if polls.Load() != 1 || len(raw) == 0 {
		t.Fatalf("polls=%d raw=%d", polls.Load(), len(raw))
	}
}

func TestCheckSlipsTerminalStatuses(t *testing.T) {
	for _, status := range []string{"verified", "flagged", "duplicate", "rejected", "failed", "ERROR"} {
		if !isCheckSlipsTerminalStatus(status) {
			t.Fatalf("terminal status rejected: %s", status)
		}
	}
	for _, status := range []string{"", "queued", "pending", "processing"} {
		if isCheckSlipsTerminalStatus(status) {
			t.Fatalf("non-terminal status accepted: %s", status)
		}
	}
}

func TestParseCheckSlipsErrorMessage(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "detail string", raw: `{"detail":"Invalid tenant"}`, want: "Invalid tenant"},
		{name: "validation details", raw: `{"detail":[{"loc":["body","image"],"msg":"Field required","type":"missing"}]}`, want: "Field required"},
		{name: "nested message", raw: `{"detail":{"message":"Sandbox keys cannot verify live slips"}}`, want: "Sandbox keys cannot verify live slips"},
		{name: "top-level message", raw: `{"message":"Unsupported image"}`, want: "Unsupported image"},
		{name: "plain text", raw: `Bad request`, want: "Bad request"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := parseCheckSlipsErrorMessage([]byte(test.raw)); got != test.want {
				t.Fatalf("parseCheckSlipsErrorMessage()=%q want %q", got, test.want)
			}
		})
	}
}

func TestCheckSlipsConfigurationErrors(t *testing.T) {
	for _, message := range []string{"Invalid API key", "Tenant not found", "receiver_validation_mode is invalid", "Sandbox key"} {
		if !isCheckSlipsConfigurationError(strings.ToLower(message)) {
			t.Fatalf("configuration error not detected: %q", message)
		}
	}
	if isCheckSlipsConfigurationError("QR code could not be read") {
		t.Fatal("slip image error was classified as a configuration error")
	}
}

func TestCheckSlipsFlagMessage(t *testing.T) {
	message, code := checkSlipsFlagMessage([]string{"PROVIDER_CONFIRMATION_REQUIRED", "RECEIVER_NAME_MISMATCH"})
	if code != "receiver_mismatch" || !strings.Contains(message, "บัญชีผู้รับเงิน") {
		t.Fatalf("unexpected receiver mismatch result: code=%q message=%q", code, message)
	}

	message, code = checkSlipsFlagMessage([]string{"VERIFY_LINK_NO_DATA"})
	if code != "slip_transaction_not_found" || !strings.Contains(message, "QR Code") {
		t.Fatalf("unexpected missing transaction result: code=%q message=%q", code, message)
	}

	message, code = checkSlipsFlagMessage([]string{"RECEIVER_UNREADABLE", "RECEIVER_MISMATCH"})
	if code != "receiver_unreadable" || !strings.Contains(message, "อ่านข้อมูลผู้รับ") {
		t.Fatalf("unreadable receiver should take priority: code=%q message=%q", code, message)
	}

	message, code = checkSlipsFlagMessage([]string{"PROVIDER_REFERENCE_MISMATCH", "VERIFY_LINK_NO_DATA"})
	if code != "slip_reference_mismatch" || !strings.Contains(message, "เลขอ้างอิง") {
		t.Fatalf("reference mismatch should be explicit: code=%q message=%q", code, message)
	}
}

func TestCheckSlipsReceiverMatchesMaskedAccount(t *testing.T) {
	bankCode := "KTB"
	masked := "xxx-x-x0004-x"
	result := checkSlipsVerification{
		ReceiverBankCode: &bankCode,
		Receiver:         &checkSlipsPartyInfo{Account: &checkSlipsAccountInfo{Masked: &masked}},
	}
	expected := checkSlipsReceiver{BankCode: "KTB", AccountNumber: "6614200046", AccountName: "นาย นพกร ราชชารี"}
	if !checkSlipsReceiverMatches(result, expected) {
		t.Fatal("matching bank and masked account should be accepted")
	}
	expected.AccountNumber = "6614299946"
	if checkSlipsReceiverMatches(result, expected) {
		t.Fatal("different visible account digits should be rejected")
	}
	expected.AccountNumber = "6614200046"
	expected.BankCode = "SCB"
	if checkSlipsReceiverMatches(result, expected) {
		t.Fatal("different bank should be rejected")
	}
}
