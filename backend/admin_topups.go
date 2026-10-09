package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type effectiveTopupSettings struct {
	Enabled   bool
	APIToken  string
	TenantID  string
	Receiver  checkSlipsReceiver
	Source    string
	UpdatedAt *time.Time
}

type adminTopupTransactionItem struct {
	ID              int64      `json:"id"`
	UserID          int64      `json:"userId"`
	Username        string     `json:"username"`
	DisplayName     string     `json:"displayName"`
	Amount          float64    `json:"amount"`
	Status          string     `json:"status"`
	Provider        string     `json:"provider"`
	VerificationID  string     `json:"verificationId"`
	TransRef        string     `json:"transRef"`
	ConfidenceScore *float64   `json:"confidenceScore"`
	ProviderStatus  string     `json:"providerStatus"`
	ReceiverMatch   *bool      `json:"receiverMatch"`
	TransactionDate *string    `json:"transactionDate"`
	CreatedAt       time.Time  `json:"createdAt"`
	VerifiedAt      *time.Time `json:"verifiedAt"`
}

func (s *server) loadEffectiveTopupSettings(ctx context.Context) (effectiveTopupSettings, error) {
	settings := effectiveTopupSettings{
		Enabled:  true,
		APIToken: s.cfg.checkSlipsAPIToken,
		TenantID: s.cfg.checkSlipsTenantID,
		Receiver: s.cfg.topupReceiver,
		Source:   "environment",
	}

	var useDatabase, enabled bool
	var ciphertext, tenantID, bankCode, bankName, accountNumber, accountName string
	var updatedAt time.Time
	err := s.db.QueryRow(ctx, `
		SELECT use_database_config, enabled, api_token_ciphertext, tenant_id,
		       receiver_bank_code, receiver_bank_name, receiver_account_number,
		       receiver_account_name, updated_at
		FROM topup_settings WHERE id = 1
	`).Scan(&useDatabase, &enabled, &ciphertext, &tenantID, &bankCode, &bankName, &accountNumber, &accountName, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return effectiveTopupSettings{}, err
	}
	if !useDatabase {
		return settings, nil
	}

	token := ""
	if ciphertext != "" {
		var decErr error
		token, decErr = decryptSecret(ciphertext, s.cfg.checkSlipsEncryptionKey)
		if decErr != nil && s.cfg.webhookKey != "" {
			var fallbackErr error
			token, fallbackErr = decryptSecret(ciphertext, s.cfg.webhookKey)
			if fallbackErr == nil {
				decErr = nil
				if s.cfg.checkSlipsEncryptionKey != "" && s.cfg.checkSlipsEncryptionKey != s.cfg.webhookKey {
					if newCipher, encErr := encryptSecret(token, s.cfg.checkSlipsEncryptionKey); encErr == nil {
						_, _ = s.db.Exec(ctx, `UPDATE topup_settings SET api_token_ciphertext = $1 WHERE id = 1`, newCipher)
					}
				}
			}
		}
		if decErr != nil {
			log.Printf("[WARN] Failed to decrypt checkslips token: %v", decErr)
			token = ""
		}
	}
	settings = effectiveTopupSettings{
		Enabled:  enabled,
		APIToken: token,
		TenantID: tenantID,
		Receiver: checkSlipsReceiver{
			BankCode:      bankCode,
			BankName:      bankName,
			AccountNumber: accountNumber,
			AccountName:   accountName,
		},
		Source:    "database",
		UpdatedAt: &updatedAt,
	}
	return settings, nil
}

func topupSettingsConfigured(settings effectiveTopupSettings) bool {
	return settings.Enabled && strings.TrimSpace(settings.APIToken) != "" &&
		strings.TrimSpace(settings.TenantID) != "" &&
		strings.TrimSpace(settings.Receiver.AccountNumber) != "" &&
		strings.TrimSpace(settings.Receiver.AccountName) != "" &&
		(strings.TrimSpace(settings.Receiver.BankName) != "" || strings.TrimSpace(settings.Receiver.BankCode) != "")
}

func (s *server) adminTopupSummary(c *fiber.Ctx) error {
	var totalAmount, todayAmount, monthAmount float64
	var totalTransactions, todayTransactions, monthTransactions, uniqueUsers int64
	err := s.db.QueryRow(c.Context(), `
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0),
			COUNT(*) FILTER (WHERE status='completed'),
			COALESCE(SUM(amount) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE), 0),
			COUNT(*) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE),
			COALESCE(SUM(amount) FILTER (WHERE status='completed' AND created_at >= DATE_TRUNC('month', NOW())), 0),
			COUNT(*) FILTER (WHERE status='completed' AND created_at >= DATE_TRUNC('month', NOW())),
			COUNT(DISTINCT user_id) FILTER (WHERE status='completed')
		FROM topup_transactions
	`).Scan(&totalAmount, &totalTransactions, &todayAmount, &todayTransactions, &monthAmount, &monthTransactions, &uniqueUsers)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	settings, err := s.loadEffectiveTopupSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	items, err := s.queryAdminTopupTransactions(c.Context(), "", "", "all", 1, 5)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{
		"totalAmount":        totalAmount,
		"totalTransactions":  totalTransactions,
		"todayAmount":        todayAmount,
		"todayTransactions":  todayTransactions,
		"monthAmount":        monthAmount,
		"monthTransactions":  monthTransactions,
		"uniqueUsers":        uniqueUsers,
		"configured":         topupSettingsConfigured(settings),
		"enabled":            settings.Enabled,
		"configSource":       settings.Source,
		"recentTransactions": items,
	})
}

func (s *server) adminTopupTransactions(c *fiber.Ctx) error {
	page := queryInt(c, "page", 1, 1, 100000)
	perPage := queryInt(c, "perPage", 25, 10, 100)
	query := cleanText(c.Query("q"), 100)
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	if status != "" && status != "completed" && status != "pending" && status != "failed" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "สถานะไม่ถูกต้อง"})
	}
	period := strings.ToLower(strings.TrimSpace(c.Query("period", "30d")))
	if period != "today" && period != "7d" && period != "30d" && period != "all" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ช่วงเวลาไม่ถูกต้อง"})
	}

	items, err := s.queryAdminTopupTransactions(c.Context(), query, status, period, page, perPage)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	countSQL, args := buildTopupTransactionFilter(query, status, period)
	var total int64
	if err := s.db.QueryRow(c.Context(), "SELECT COUNT(*) FROM topup_transactions t JOIN users u ON u.id=t.user_id "+countSQL, args...).Scan(&total); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"items": items, "page": page, "perPage": perPage, "total": total})
}

func (s *server) queryAdminTopupTransactions(ctx context.Context, query, status, period string, page, perPage int) ([]adminTopupTransactionItem, error) {
	filterSQL, args := buildTopupTransactionFilter(query, status, period)
	args = append(args, perPage, (page-1)*perPage)
	rows, err := s.db.Query(ctx, `
		SELECT t.id, t.user_id, u.identifier, COALESCE(u.display_name,''), t.amount,
		       t.status, t.provider, COALESCE(t.verification_id,''), COALESCE(t.trans_ref,''),
		       t.confidence_score,
		       COALESCE(t.slip_payload->'data'->>'status',''),
		       CASE WHEN t.slip_payload->'data' ? 'receiver_match' THEN (t.slip_payload->'data'->>'receiver_match')::boolean ELSE NULL END,
		       NULLIF(t.slip_payload->'data'->>'transaction_date',''),
		       t.created_at, t.verified_at
		FROM topup_transactions t
		JOIN users u ON u.id=t.user_id
	`+filterSQL+` ORDER BY t.created_at DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]adminTopupTransactionItem, 0)
	for rows.Next() {
		var item adminTopupTransactionItem
		if err := rows.Scan(&item.ID, &item.UserID, &item.Username, &item.DisplayName, &item.Amount,
			&item.Status, &item.Provider, &item.VerificationID, &item.TransRef, &item.ConfidenceScore,
			&item.ProviderStatus, &item.ReceiverMatch, &item.TransactionDate, &item.CreatedAt, &item.VerifiedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func buildTopupTransactionFilter(query, status, period string) (string, []any) {
	conditions := make([]string, 0, 3)
	args := make([]any, 0, 3)
	if query != "" {
		args = append(args, "%"+query+"%")
		placeholder := "$" + strconv.Itoa(len(args))
		conditions = append(conditions, "(u.identifier ILIKE "+placeholder+" OR u.display_name ILIKE "+placeholder+" OR t.verification_id ILIKE "+placeholder+" OR t.trans_ref ILIKE "+placeholder+")")
	}
	if status != "" {
		args = append(args, status)
		conditions = append(conditions, "t.status=$"+strconv.Itoa(len(args)))
	}
	switch period {
	case "today":
		conditions = append(conditions, "t.created_at >= CURRENT_DATE")
	case "7d":
		conditions = append(conditions, "t.created_at >= NOW() - INTERVAL '7 days'")
	case "30d":
		conditions = append(conditions, "t.created_at >= NOW() - INTERVAL '30 days'")
	}
	if len(conditions) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func (s *server) adminTopupTransaction(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || id <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รายการไม่ถูกต้อง"})
	}
	var item adminTopupTransactionItem
	var payload []byte
	err = s.db.QueryRow(c.Context(), `
		SELECT t.id, t.user_id, u.identifier, COALESCE(u.display_name,''), t.amount,
		       t.status, t.provider, COALESCE(t.verification_id,''), COALESCE(t.trans_ref,''),
		       t.confidence_score,
		       COALESCE(t.slip_payload->'data'->>'status',''),
		       CASE WHEN t.slip_payload->'data' ? 'receiver_match' THEN (t.slip_payload->'data'->>'receiver_match')::boolean ELSE NULL END,
		       NULLIF(t.slip_payload->'data'->>'transaction_date',''),
		       t.created_at, t.verified_at, t.slip_payload
		FROM topup_transactions t JOIN users u ON u.id=t.user_id WHERE t.id=$1
	`, id).Scan(&item.ID, &item.UserID, &item.Username, &item.DisplayName, &item.Amount,
		&item.Status, &item.Provider, &item.VerificationID, &item.TransRef, &item.ConfidenceScore,
		&item.ProviderStatus, &item.ReceiverMatch, &item.TransactionDate, &item.CreatedAt, &item.VerifiedAt, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรายการเติมเงิน"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	var providerResult any
	_ = json.Unmarshal(payload, &providerResult)
	return c.JSON(fiber.Map{"item": item, "providerResult": providerResult})
}

func (s *server) adminTopupSettings(c *fiber.Ctx) error {
	settings, err := s.loadEffectiveTopupSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{
		"enabled":               settings.Enabled,
		"configured":            topupSettingsConfigured(settings),
		"source":                settings.Source,
		"apiTokenConfigured":    strings.TrimSpace(settings.APIToken) != "",
		"tenantId":              settings.TenantID,
		"receiverBankCode":      settings.Receiver.BankCode,
		"receiverBankName":      settings.Receiver.BankName,
		"receiverAccountNumber": settings.Receiver.AccountNumber,
		"receiverAccountName":   settings.Receiver.AccountName,
		"updatedAt":             settings.UpdatedAt,
	})
}

func (s *server) updateAdminTopupSettings(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		Enabled               bool   `json:"enabled"`
		APIToken              string `json:"apiToken"`
		ClearAPIToken         bool   `json:"clearApiToken"`
		TenantID              string `json:"tenantId"`
		ReceiverBankCode      string `json:"receiverBankCode"`
		ReceiverBankName      string `json:"receiverBankName"`
		ReceiverAccountNumber string `json:"receiverAccountNumber"`
		ReceiverAccountName   string `json:"receiverAccountName"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	body.APIToken = strings.TrimSpace(body.APIToken)
	body.TenantID = cleanText(body.TenantID, 200)
	body.ReceiverBankCode = strings.ToUpper(cleanText(body.ReceiverBankCode, 30))
	body.ReceiverBankName = cleanText(body.ReceiverBankName, 100)
	body.ReceiverAccountNumber = cleanText(body.ReceiverAccountNumber, 60)
	body.ReceiverAccountName = cleanText(body.ReceiverAccountName, 150)

	currentSettings, err := s.loadEffectiveTopupSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := currentSettings.APIToken
	if body.ClearAPIToken {
		token = ""
	} else if body.APIToken != "" {
		if len(body.APIToken) > 500 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "API Token ยาวเกินกำหนด"})
		}
		token = body.APIToken
	}
	settings := effectiveTopupSettings{
		Enabled:  body.Enabled,
		APIToken: token,
		TenantID: body.TenantID,
		Receiver: checkSlipsReceiver{
			BankCode:      body.ReceiverBankCode,
			BankName:      body.ReceiverBankName,
			AccountNumber: body.ReceiverAccountNumber,
			AccountName:   body.ReceiverAccountName,
		},
	}
	if body.Enabled && !topupSettingsConfigured(settings) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณากรอก API Token, Tenant ID และข้อมูลบัญชีรับเงินให้ครบ"})
	}
	ciphertext := ""
	if token != "" {
		ciphertext, err = encryptSecret(token, s.cfg.checkSlipsEncryptionKey)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	_, err = s.db.Exec(c.Context(), `
		UPDATE topup_settings SET
			use_database_config=TRUE, enabled=$1, api_token_ciphertext=$2,
			tenant_id=$3, receiver_bank_code=$4, receiver_bank_name=$5,
			receiver_account_number=$6, receiver_account_name=$7,
			updated_by=$8, updated_at=NOW()
		WHERE id=1
	`, body.Enabled, ciphertext, body.TenantID, body.ReceiverBankCode, body.ReceiverBankName,
		body.ReceiverAccountNumber, body.ReceiverAccountName, actor.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "settings", Action: "topup.settings_updated", Target: "topup_settings", TargetID: "1", Metadata: map[string]any{"enabled": body.Enabled, "tokenChanged": body.APIToken != "" || body.ClearAPIToken}})
	return s.adminTopupSettings(c)
}

func queryInt(c *fiber.Ctx, key string, fallback, min, max int) int {
	value, err := strconv.Atoi(c.Query(key))
	if err != nil || value < min || value > max {
		return fallback
	}
	return value
}
