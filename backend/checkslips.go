package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path/filepath"
	"strings"
	"time"
)

const (
	checkSlipsMaxImageSize = 5 * 1024 * 1024
	checkSlipsPollInterval = time.Second
	checkSlipsPollTimeout  = 35 * time.Second
)

type checkSlipsClient struct {
	baseURL    string
	apiToken   string
	tenantID   string
	httpClient *http.Client
}

type checkSlipsVerification struct {
	VerificationID         string               `json:"verification_id"`
	ID                     string               `json:"id"`
	Status                 string               `json:"status"`
	AuthenticityStatus     *string              `json:"authenticity_status"`
	ConfidenceScore        *float64             `json:"confidence_score"`
	Flags                  []string             `json:"flags"`
	IsDuplicate            bool                 `json:"is_duplicate"`
	Amount                 *float64             `json:"amount"`
	TransactionDate        *string              `json:"transaction_date"`
	SenderName             *string              `json:"sender_name"`
	ReceiverName           *string              `json:"receiver_name"`
	SenderBankCode         *string              `json:"sender_bank_code"`
	ReceiverBankCode       *string              `json:"receiver_bank_code"`
	TransRef               *string              `json:"trans_ref"`
	ReceiverMatch          *bool                `json:"receiver_match"`
	ReceiverMatchSource    *string              `json:"receiver_match_source"`
	ReceiverValidationMode *string              `json:"receiver_validation_mode"`
	Receiver               *checkSlipsPartyInfo `json:"receiver"`
}

type checkSlipsPartyInfo struct {
	Bank    *checkSlipsBankInfo    `json:"bank"`
	Account *checkSlipsAccountInfo `json:"account"`
}

type checkSlipsBankInfo struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type checkSlipsAccountInfo struct {
	Masked *string `json:"masked"`
}

type checkSlipsEnvelope struct {
	Success bool                   `json:"success"`
	Data    checkSlipsVerification `json:"data"`
	Message string                 `json:"message"`
}

type checkSlipsAPIError struct {
	StatusCode int
	Message    string
}

func (e *checkSlipsAPIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("checkslips returned %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("checkslips returned %d", e.StatusCode)
}

func (v checkSlipsVerification) verificationID() string {
	if strings.TrimSpace(v.VerificationID) != "" {
		return strings.TrimSpace(v.VerificationID)
	}
	return strings.TrimSpace(v.ID)
}

func (c checkSlipsClient) verify(
	ctx context.Context,
	filename string,
	contentType string,
	image []byte,
	remark string,
) (checkSlipsVerification, json.RawMessage, error) {
	if strings.TrimSpace(c.apiToken) == "" || strings.TrimSpace(c.tenantID) == "" {
		return checkSlipsVerification{}, nil, errors.New("checkslips is not configured")
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="%s"`, escapeMultipartFilename(filename)))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return checkSlipsVerification{}, nil, err
	}
	if _, err := part.Write(image); err != nil {
		return checkSlipsVerification{}, nil, err
	}
	_ = writer.WriteField("remark", remark)
	_ = writer.WriteField("check_duplicate", "true")
	// CheckSlips request mode requires bank, account and OCR-sensitive name
	// together. Validate the bank and masked account locally instead.
	_ = writer.WriteField("receiver_validation_mode", "none")
	if err := writer.Close(); err != nil {
		return checkSlipsVerification{}, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.baseURL, "/")+"/v1/verify", body)
	if err != nil {
		return checkSlipsVerification{}, nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	c.authorize(req)

	envelope, raw, err := c.do(req, http.StatusAccepted, http.StatusOK)
	if err != nil {
		return checkSlipsVerification{}, raw, err
	}
	verificationID := envelope.Data.verificationID()
	if verificationID == "" {
		return checkSlipsVerification{}, raw, errors.New("checkslips response did not include verification_id")
	}
	if isCheckSlipsTerminalStatus(envelope.Data.Status) {
		return envelope.Data, raw, nil
	}

	pollCtx, cancel := context.WithTimeout(ctx, checkSlipsPollTimeout)
	defer cancel()
	ticker := time.NewTicker(checkSlipsPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-pollCtx.Done():
			return checkSlipsVerification{}, raw, fmt.Errorf("checkslips verification timeout: %w", pollCtx.Err())
		case <-ticker.C:
			result, resultRaw, pollErr := c.getVerification(pollCtx, verificationID)
			if pollErr != nil {
				return checkSlipsVerification{}, resultRaw, pollErr
			}
			raw = resultRaw
			if isCheckSlipsTerminalStatus(result.Status) {
				return result, raw, nil
			}
		}
	}
}

func (c checkSlipsClient) getVerification(ctx context.Context, verificationID string) (checkSlipsVerification, json.RawMessage, error) {
	url := strings.TrimRight(c.baseURL, "/") + "/v1/verify/" + verificationID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return checkSlipsVerification{}, nil, err
	}
	c.authorize(req)
	envelope, raw, err := c.do(req, http.StatusOK)
	return envelope.Data, raw, err
}

func (c checkSlipsClient) authorize(req *http.Request) {
	token := strings.TrimSpace(c.apiToken)
	if !strings.HasPrefix(strings.ToLower(token), "bearer ") {
		token = "Bearer " + token
	}
	req.Header.Set("Authorization", token)
	req.Header.Set("X-Tenant-ID", strings.TrimSpace(c.tenantID))
}

func (c checkSlipsClient) do(req *http.Request, acceptedStatuses ...int) (checkSlipsEnvelope, json.RawMessage, error) {
	client := c.httpClient
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return checkSlipsEnvelope{}, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return checkSlipsEnvelope{}, nil, err
	}
	accepted := false
	for _, status := range acceptedStatuses {
		if resp.StatusCode == status {
			accepted = true
			break
		}
	}
	if !accepted {
		message := parseCheckSlipsErrorMessage(raw)
		return checkSlipsEnvelope{}, raw, &checkSlipsAPIError{StatusCode: resp.StatusCode, Message: message}
	}

	var envelope checkSlipsEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return checkSlipsEnvelope{}, raw, fmt.Errorf("decode checkslips response: %w", err)
	}
	return envelope, raw, nil
}

func parseCheckSlipsErrorMessage(raw []byte) string {
	var body map[string]any
	if json.Unmarshal(raw, &body) == nil {
		for _, key := range []string{"detail", "message", "error", "reason"} {
			if message := checkSlipsErrorValue(body[key]); message != "" {
				return limitCheckSlipsError(message)
			}
		}
	}

	message := strings.TrimSpace(string(raw))
	if message == "" || strings.HasPrefix(message, "<") || json.Valid(raw) {
		return ""
	}
	return limitCheckSlipsError(message)
}

func checkSlipsErrorValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.Join(strings.Fields(typed), " ")
	case []any:
		messages := make([]string, 0, len(typed))
		for _, item := range typed {
			if message := checkSlipsErrorValue(item); message != "" {
				messages = append(messages, message)
			}
		}
		return strings.Join(messages, "; ")
	case map[string]any:
		for _, key := range []string{"message", "msg", "detail", "error", "reason"} {
			if message := checkSlipsErrorValue(typed[key]); message != "" {
				return message
			}
		}
	}
	return ""
}

func limitCheckSlipsError(message string) string {
	const maxRunes = 300
	cleaned := []rune(strings.TrimSpace(message))
	if len(cleaned) <= maxRunes {
		return string(cleaned)
	}
	return string(cleaned[:maxRunes]) + "..."
}

func isCheckSlipsTerminalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "verified", "flagged", "duplicate", "rejected", "failed", "error":
		return true
	default:
		return false
	}
}

func escapeMultipartFilename(filename string) string {
	name := filepath.Base(strings.TrimSpace(filename))
	name = strings.ReplaceAll(name, `\`, "_")
	name = strings.ReplaceAll(name, `"`, "_")
	name = strings.ReplaceAll(name, "\r", "_")
	name = strings.ReplaceAll(name, "\n", "_")
	if name == "" || name == "." {
		return "slip.jpg"
	}
	return name
}
