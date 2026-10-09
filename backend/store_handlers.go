package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type ProductCategory struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	IsVisible bool      `json:"isVisible"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Product struct {
	ID            int       `json:"id"`
	CategoryID    int       `json:"categoryId"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Price         float64   `json:"price"`
	Stock         int       `json:"stock"`
	IsRecommended bool      `json:"isRecommended"`
	IsPopular     bool      `json:"isPopular"`
	IsSoldOut     bool      `json:"isSoldOut"`
	IsVisible     bool      `json:"isVisible"`
	CoverImageURL string    `json:"coverImageUrl"`
	CoverCrop     *CoverCrop `json:"coverCrop"`
	FileKey       string    `json:"fileKey,omitempty"`
	DeliveryType  string    `json:"deliveryType,omitempty"`
	SoldCount     int       `json:"soldCount"`
	Revenue       *float64  `json:"revenue,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type userTopupHistoryItem struct {
	ID         int64      `json:"id"`
	Amount     float64    `json:"amount"`
	Status     string     `json:"status"`
	TransRef   string     `json:"transRef"`
	CreatedAt  time.Time  `json:"createdAt"`
	VerifiedAt *time.Time `json:"verifiedAt"`
}

type Purchase struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"userId"`
	ProductID   int       `json:"productId"`
	PricePaid   float64   `json:"pricePaid"`
	PurchasedAt time.Time `json:"purchasedAt"`
}

// Public Store Handlers
func (s *server) getStoreCategories(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT id, name, is_visible, sort_order, created_at, updated_at FROM product_categories WHERE is_visible = true ORDER BY sort_order ASC, id DESC`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var items []ProductCategory
	for rows.Next() {
		var cat ProductCategory
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt); err == nil {
			items = append(items, cat)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) getStoreProducts(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT p.id, p.category_id, p.title, COALESCE(p.description, ''), p.price, p.stock,
		       p.is_recommended, p.is_popular, p.is_sold_out, p.is_visible,
		       COALESCE(p.cover_image_url, ''), p.cover_crop, p.file_key, p.created_at, p.updated_at,
		       (SELECT COUNT(*) FROM purchases pu WHERE pu.product_id = p.id AND pu.refunded_at IS NULL)
		FROM products p
		WHERE p.is_visible = true
		ORDER BY p.is_recommended DESC, p.id DESC
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]Product, 0)
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.CategoryID, &p.Title, &p.Description, &p.Price, &p.Stock, &p.IsRecommended, &p.IsPopular, &p.IsSoldOut, &p.IsVisible, &p.CoverImageURL, &p.CoverCrop, &p.FileKey, &p.CreatedAt, &p.UpdatedAt, &p.SoldCount); err == nil {
			// The file being sold is only revealed to buyers, via /api/store/purchases/:id/download.
			p.DeliveryType = productDeliveryType(p.FileKey)
			p.FileKey = ""
			items = append(items, p)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

// User Actions
func (s *server) topupConfig(c *fiber.Ctx) error {
	settings, err := s.loadEffectiveTopupSettings(c.Context())
	if err != nil {
		log.Printf("[ERROR] loadEffectiveTopupSettings failed: %v", err)
		return c.JSON(fiber.Map{
			"configured":    false,
			"enabled":       false,
			"bankCode":      "",
			"bankName":      "",
			"accountNumber": "",
			"accountName":   "",
			"provider":      "CheckSlips",
			"maxFileSize":   checkSlipsMaxImageSize,
		})
	}
	receiver := settings.Receiver

	return c.JSON(fiber.Map{
		"configured":    topupSettingsConfigured(settings),
		"enabled":       settings.Enabled,
		"bankCode":      receiver.BankCode,
		"bankName":      receiver.BankName,
		"accountNumber": receiver.AccountNumber,
		"accountName":   receiver.AccountName,
		"provider":      "CheckSlips",
		"maxFileSize":   checkSlipsMaxImageSize,
	})
}

func (s *server) topupHistory(c *fiber.Ctx) error {
	user := current(c)
	page := queryInt(c, "page", 1, 1, 100000)
	perPage := queryInt(c, "perPage", 10, 5, 50)

	rows, err := s.db.Query(c.Context(), `
		SELECT id, amount, status, COALESCE(trans_ref, ''), created_at, verified_at
		FROM topup_transactions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, user.ID, perPage, (page-1)*perPage)
	if err != nil {
		log.Printf("load topup history failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]userTopupHistoryItem, 0)
	for rows.Next() {
		var item userTopupHistoryItem
		if err := rows.Scan(&item.ID, &item.Amount, &item.Status, &item.TransRef, &item.CreatedAt, &item.VerifiedAt); err != nil {
			log.Printf("scan topup history failed for user %d: %v", user.ID, err)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		log.Printf("iterate topup history failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	var total int64
	var totalAmount, monthAmount float64
	if err := s.db.QueryRow(c.Context(), `
		SELECT COUNT(*),
		       COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0),
		       COALESCE(SUM(amount) FILTER (WHERE status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())), 0)
		FROM topup_transactions
		WHERE user_id = $1
	`, user.ID).Scan(&total, &totalAmount, &monthAmount); err != nil {
		log.Printf("summarize topup history failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{
		"items": items,
		"summary": fiber.Map{
			"totalAmount": totalAmount,
			"monthAmount": monthAmount,
			"total":       total,
		},
		"page":    page,
		"perPage": perPage,
		"total":   total,
	})
}

func (s *server) topupWithSlip(c *fiber.Ctx) error {
	user := current(c)
	settings, err := s.loadEffectiveTopupSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !settings.Enabled {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบเติมเงินถูกปิดใช้งานชั่วคราว", Code: "topup_disabled"})
	}
	receiver := settings.Receiver
	if !topupSettingsConfigured(settings) {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบตรวจสลิปยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ", Code: "topup_not_configured"})
	}

	file, err := c.FormFile("slip")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาแนบไฟล์สลิป"})
	}
	if file.Size <= 0 || file.Size > checkSlipsMaxImageSize {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB", Code: "invalid_slip_size"})
	}

	fileData, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer fileData.Close()
	image, err := io.ReadAll(io.LimitReader(fileData, checkSlipsMaxImageSize+1))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if len(image) == 0 || len(image) > checkSlipsMaxImageSize {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB", Code: "invalid_slip_size"})
	}
	contentType := http.DetectContentType(image)
	if contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รองรับเฉพาะไฟล์ JPG, PNG และ WebP", Code: "invalid_slip_type"})
	}

	client := checkSlipsClient{
		baseURL:  s.cfg.checkSlipsAPIBaseURL,
		apiToken: settings.APIToken,
		tenantID: settings.TenantID,
	}
	processingCtx, cancelProcessing := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancelProcessing()
	remark := fmt.Sprintf("nexora_topup_user_%d", user.ID)
	result, rawPayload, err := client.verify(processingCtx, file.Filename, contentType, image, remark)
	if err != nil {
		return s.handleCheckSlipsError(c, err)
	}

	status := strings.ToLower(strings.TrimSpace(result.Status))
	if status == "duplicate" || result.IsDuplicate {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สลิปนี้เคยถูกใช้งานแล้ว", Code: "duplicate_slip"})
	}
	if status != "verified" {
		message := "สลิปไม่ผ่านการตรวจสอบ กรุณาใช้ภาพสลิปต้นฉบับ"
		code := "slip_rejected"
		httpStatus := fiber.StatusUnprocessableEntity
		switch status {
		case "flagged":
			message, code = checkSlipsFlagMessage(result.Flags)
		}
		s.audit(c, auditEvent{Actor: user, Category: "store", Action: "topup.slip_rejected", Target: "user", TargetID: fmt.Sprint(user.ID), Outcome: "failure", Metadata: map[string]any{"status": status, "flags": result.Flags, "authenticityStatus": result.AuthenticityStatus, "confidenceScore": result.ConfidenceScore, "verificationId": result.verificationID()}})
		return c.Status(httpStatus).JSON(apiError{Error: message, Code: code})
	}
	if !checkSlipsReceiverMatches(result, receiver) {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(apiError{Error: "เลขบัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีที่ระบบกำหนด", Code: "receiver_mismatch"})
	}
	if result.Amount == nil || *result.Amount <= 0 || *result.Amount > 1_000_000 {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(apiError{Error: "ไม่สามารถอ่านยอดเงินจากสลิปได้", Code: "invalid_slip_amount"})
	}
	amountSatang := int64(math.Round(*result.Amount * 100))
	if amountSatang <= 0 || math.Abs(*result.Amount*100-float64(amountSatang)) > 0.001 {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(apiError{Error: "ยอดเงินในสลิปไม่ถูกต้อง", Code: "invalid_slip_amount"})
	}
	amount := float64(amountSatang) / 100
	verificationID := result.verificationID()
	transRef := ""
	if result.TransRef != nil {
		transRef = strings.TrimSpace(*result.TransRef)
	}
	if verificationID == "" || transRef == "" {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(apiError{Error: "ไม่พบเลขอ้างอิงธุรกรรมในสลิป", Code: "missing_transaction_reference"})
	}
	if len(rawPayload) == 0 {
		rawPayload, _ = json.Marshal(result)
	}

	tx, err := s.db.Begin(processingCtx)
	if err != nil {
		log.Printf("topup transaction begin failed for user %d: %v", user.ID, err)
		return topupProcessingError(c)
	}
	defer tx.Rollback(processingCtx)

	var topupID int64
	err = tx.QueryRow(processingCtx, `
		INSERT INTO topup_transactions (
			user_id, amount, status, slip_payload, provider, verification_id,
			trans_ref, confidence_score, verified_at, updated_at
		)
		VALUES ($1, $2, 'completed', $3::jsonb, 'checkslips', $4, $5, $6, NOW(), NOW())
		ON CONFLICT DO NOTHING
		RETURNING id
	`, user.ID, amount, string(rawPayload), verificationID, transRef, result.ConfidenceScore).Scan(&topupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สลิปนี้เคยถูกใช้งานแล้ว", Code: "duplicate_slip"})
	}
	if err != nil {
		log.Printf("topup transaction insert failed for user %d (verification %s): %v", user.ID, verificationID, err)
		return topupProcessingError(c)
	}

	var newPoints float64
	err = tx.QueryRow(processingCtx, `
		UPDATE users SET points = points + $1 WHERE id = $2 RETURNING points
	`, amount, user.ID).Scan(&newPoints)
	if err != nil {
		log.Printf("topup points update failed for user %d (topup %d): %v", user.ID, topupID, err)
		return topupProcessingError(c)
	}

	if err := tx.Commit(processingCtx); err != nil {
		log.Printf("topup transaction commit failed for user %d (topup %d): %v", user.ID, topupID, err)
		return topupProcessingError(c)
	}

	s.audit(c, auditEvent{Actor: user, Category: "store", Action: "topup.slip", Target: "topup", TargetID: fmt.Sprint(topupID), Metadata: map[string]any{"amount": amount, "verificationId": verificationID}})

	return c.JSON(fiber.Map{
		"success":        true,
		"message":        fmt.Sprintf("เติมเงินสำเร็จ %.2f พอยต์", amount),
		"amount":         amount,
		"newPoints":      newPoints,
		"points":         newPoints,
		"verificationId": verificationID,
	})
}

func checkSlipsReceiverMatches(result checkSlipsVerification, expected checkSlipsReceiver) bool {
	if result.ReceiverMatch != nil && *result.ReceiverMatch {
		return true
	}
	if result.Receiver == nil || result.Receiver.Account == nil || result.Receiver.Account.Masked == nil {
		return false
	}

	actualBankCode := ""
	actualBankName := ""
	if result.ReceiverBankCode != nil {
		actualBankCode = strings.TrimSpace(*result.ReceiverBankCode)
	}
	if result.Receiver.Bank != nil {
		if actualBankCode == "" {
			actualBankCode = strings.TrimSpace(result.Receiver.Bank.Code)
		}
		actualBankName = strings.TrimSpace(result.Receiver.Bank.Name)
	}
	if expected.BankCode != "" && !strings.EqualFold(strings.TrimSpace(expected.BankCode), actualBankCode) {
		return false
	}
	if expected.BankCode == "" && expected.BankName != "" && !strings.EqualFold(strings.TrimSpace(expected.BankName), actualBankName) {
		return false
	}
	return maskedAccountMatches(expected.AccountNumber, *result.Receiver.Account.Masked)
}

func maskedAccountMatches(accountNumber, masked string) bool {
	expected := digitsOnly(accountNumber)
	pattern := make([]rune, 0, len(masked))
	for _, char := range strings.ToLower(masked) {
		if char >= '0' && char <= '9' || char == 'x' || char == '*' {
			pattern = append(pattern, char)
		}
	}
	if len(expected) == 0 || len(pattern) != len(expected) {
		return false
	}
	visible := 0
	for index, char := range pattern {
		if char >= '0' && char <= '9' {
			visible++
			if byte(char) != expected[index] {
				return false
			}
		}
	}
	return visible >= 4
}

func digitsOnly(value string) string {
	var digits strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			digits.WriteRune(char)
		}
	}
	return digits.String()
}

func checkSlipsFlagMessage(flags []string) (string, string) {
	joined := strings.ToUpper(strings.Join(flags, " "))
	switch {
	case strings.Contains(joined, "DUPLICATE"):
		return "สลิปนี้เคยถูกใช้งานแล้ว", "duplicate_slip"
	case strings.Contains(joined, "RECEIVER_UNREADABLE"):
		return "อ่านข้อมูลผู้รับจากสลิปไม่ได้ กรุณาใช้ภาพสลิปต้นฉบับที่เห็นข้อมูลและ QR Code ชัดเจน", "receiver_unreadable"
	case strings.Contains(joined, "NO_AMOUNT_FOUND"):
		return "อ่านยอดเงินจากสลิปไม่ได้ กรุณาใช้ภาพสลิปต้นฉบับที่ชัดเจน", "slip_amount_unreadable"
	case strings.Contains(joined, "NO_TRANSACTION_REF_FOUND"):
		return "อ่านเลขอ้างอิงธุรกรรมจากสลิปไม่ได้ กรุณาใช้ภาพสลิปต้นฉบับที่ชัดเจน", "slip_reference_unreadable"
	case strings.Contains(joined, "PROVIDER_REFERENCE_MISMATCH"):
		return "เลขอ้างอิงใน QR Code ไม่ตรงกับข้อมูลบนสลิป กรุณาใช้ภาพสลิปต้นฉบับจากแอปธนาคาร", "slip_reference_mismatch"
	case strings.Contains(joined, "VERIFY_LINK_NO_DATA"):
		return "ธนาคารยังไม่ยืนยันข้อมูลธุรกรรมจากสลิปนี้ กรุณาตรวจสอบ QR Code หรือลองใหม่ภายหลัง", "slip_transaction_not_found"
	case strings.Contains(joined, "RECEIVER_MISMATCH") || strings.Contains(joined, "RECEIVER_NAME_MISMATCH"):
		return "บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีที่ระบบกำหนด กรุณาตรวจสอบเลขบัญชีผู้รับ", "receiver_mismatch"
	case strings.Contains(joined, "QR"):
		return "ไม่สามารถยืนยัน QR Code ในสลิปได้ กรุณาใช้ภาพสลิปต้นฉบับที่ชัดเจน", "slip_qr_unverified"
	default:
		return "ระบบไม่สามารถยืนยันข้อมูลในสลิปได้ กรุณาใช้ภาพสลิปต้นฉบับ", "slip_flagged"
	}
}

func (s *server) handleCheckSlipsError(c *fiber.Ctx, err error) error {
	var apiErr *checkSlipsAPIError
	if errors.As(err, &apiErr) {
		log.Printf("checkslips API error: %v", err)
		message := strings.ToLower(apiErr.Message)
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบตรวจสลิปยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ", Code: "slip_provider_auth"})
		case http.StatusTooManyRequests:
			return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "โควตาตรวจสลิปหมดชั่วคราว กรุณาลองใหม่ภายหลัง", Code: "slip_provider_quota"})
		case http.StatusUnprocessableEntity, http.StatusBadRequest:
			if strings.Contains(message, "duplicate") || strings.Contains(message, "already used") || strings.Contains(apiErr.Message, "ซ้ำ") {
				return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สลิปนี้เคยถูกใช้งานแล้ว", Code: "duplicate_slip"})
			}
			if isCheckSlipsConfigurationError(message) {
				return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "การตั้งค่า CheckSlips ไม่ถูกต้อง กรุณาตรวจสอบ API Key, Tenant ID และบัญชีผู้รับ", Code: "slip_provider_config"})
			}
			if apiErr.Message != "" {
				return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: apiErr.Message, Code: "invalid_slip"})
			}
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปสลิปไม่ถูกต้องหรืออ่านไม่ได้", Code: "invalid_slip"})
		}
	}
	log.Printf("checkslips verification failed: %v", err)
	return c.Status(fiber.StatusBadGateway).JSON(apiError{Error: "ไม่สามารถเชื่อมต่อระบบตรวจสลิปได้ กรุณาลองใหม่", Code: "slip_provider_unavailable"})
}

func topupProcessingError(c *fiber.Ctx) error {
	return c.Status(fiber.StatusInternalServerError).JSON(apiError{
		Error: "ระบบบันทึกยอดเติมเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
		Code:  "topup_processing_failed",
	})
}

func isCheckSlipsConfigurationError(message string) bool {
	for _, keyword := range []string{
		"api key", "api_key", "authorization", "bearer", "token", "tenant",
		"receiver_validation", "expected_receiver", "sandbox", "live api", "configuration",
	} {
		if strings.Contains(message, keyword) {
			return true
		}
	}
	return false
}

func (s *server) buyProduct(c *fiber.Ctx) error {
	user := current(c)
	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil || productID <= 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า", Code: "product_not_found"})
	}
	ctx := c.Context()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(ctx)

	// Lock the buyer first so repeated clicks from one account run one after another.
	var balance float64
	if err := tx.QueryRow(ctx, `SELECT points FROM users WHERE id = $1 FOR UPDATE`, user.ID).Scan(&balance); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Lock the product row so stock cannot be oversold.
	var title, fileKey string
	var price float64
	var stock int
	var isSoldOut, isVisible bool
	err = tx.QueryRow(ctx, `SELECT title, file_key, price, stock, is_sold_out, is_visible FROM products WHERE id = $1 FOR UPDATE`, productID).
		Scan(&title, &fileKey, &price, &stock, &isSoldOut, &isVisible)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !isVisible) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า หรือสินค้านี้ปิดการขายแล้ว", Code: "product_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	var owned bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM purchases WHERE user_id = $1 AND product_id = $2 AND refunded_at IS NULL)`, user.ID, productID).Scan(&owned); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if owned {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "คุณซื้อสินค้านี้แล้ว ดาวน์โหลดได้จากรายการที่ซื้อแล้ว", Code: "already_owned"})
	}
	if isSoldOut || stock == 0 {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สินค้านี้ขายหมดแล้ว", Code: "sold_out"})
	}
	if strings.TrimSpace(fileKey) == "" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สินค้านี้ยังไม่พร้อมขาย", Code: "product_not_ready"})
	}

	// Compare and deduct in NUMERIC inside the database so no float rounding touches the balance.
	var newPoints float64
	err = tx.QueryRow(ctx, `
		UPDATE users u SET points = u.points - p.price
		FROM products p
		WHERE u.id = $1 AND p.id = $2 AND u.points >= p.price
		RETURNING u.points
	`, user.ID, productID).Scan(&newPoints)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
			"error":   fmt.Sprintf("พอยท์ไม่พอ ต้องใช้ %s แต่มี %s", formatPoints(price), formatPoints(balance)),
			"code":    "insufficient_points",
			"price":   price,
			"balance": balance,
			"missing": math.Max(0, price-balance),
		})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if stock > 0 {
		if _, err := tx.Exec(ctx, `UPDATE products SET stock = stock - 1, updated_at = NOW() WHERE id = $1`, productID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}

	var purchaseID int64
	var pricePaid float64
	var purchasedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO purchases (user_id, product_id, price_paid)
		SELECT $1, id, price FROM products WHERE id = $2
		RETURNING id, price_paid, purchased_at
	`, user.ID, productID).Scan(&purchaseID, &pricePaid, &purchasedAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{Actor: user, Category: "store", Action: "product.purchased", Target: "product", TargetID: fmt.Sprint(productID), Metadata: map[string]any{"title": title, "price": pricePaid, "purchaseId": purchaseID, "balanceAfter": newPoints}})

	return c.JSON(fiber.Map{
		"success":      true,
		"message":      fmt.Sprintf("ซื้อ %s สำเร็จ", title),
		"purchaseId":   purchaseID,
		"productId":    productID,
		"title":        title,
		"pricePaid":    pricePaid,
		"purchasedAt":  purchasedAt,
		"newPoints":    newPoints,
		"points":       newPoints,
		"deliveryType": productDeliveryType(fileKey),
	})
}

func formatPoints(value float64) string {
	if value == math.Trunc(value) {
		return fmt.Sprintf("%.0f พอยท์", value)
	}
	return fmt.Sprintf("%.2f พอยท์", value)
}

// Admin Handlers for Store Categories
func (s *server) adminGetCategories(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT id, name, is_visible, sort_order, created_at, updated_at FROM product_categories ORDER BY sort_order ASC, id DESC`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var items []ProductCategory
	for rows.Next() {
		var cat ProductCategory
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt); err == nil {
			items = append(items, cat)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminCreateCategory(c *fiber.Ctx) error {
	var body struct {
		Name      string `json:"name"`
		IsVisible bool   `json:"isVisible"`
		SortOrder int    `json:"sortOrder"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	if strings.TrimSpace(body.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อหมวดหมู่สินค้า"})
	}

	var cat ProductCategory
	err := s.db.QueryRow(c.Context(), `
		INSERT INTO product_categories (name, is_visible, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, name, is_visible, sort_order, created_at, updated_at
	`, strings.TrimSpace(body.Name), body.IsVisible, body.SortOrder).Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt)

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{Actor: current(c), Category: "store", Action: "category.created", Target: "category", TargetID: fmt.Sprint(cat.ID)})
	return c.JSON(cat)
}

func (s *server) adminUpdateCategory(c *fiber.Ctx) error {
	id := c.Params("id")
	var body struct {
		Name      string `json:"name"`
		IsVisible bool   `json:"isVisible"`
		SortOrder int    `json:"sortOrder"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	if strings.TrimSpace(body.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อหมวดหมู่สินค้า"})
	}

	var cat ProductCategory
	err := s.db.QueryRow(c.Context(), `
		UPDATE product_categories
		SET name = $1, is_visible = $2, sort_order = $3, updated_at = NOW()
		WHERE id = $4
		RETURNING id, name, is_visible, sort_order, created_at, updated_at
	`, strings.TrimSpace(body.Name), body.IsVisible, body.SortOrder, id).Scan(&cat.ID, &cat.Name, &cat.IsVisible, &cat.SortOrder, &cat.CreatedAt, &cat.UpdatedAt)

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	return c.JSON(cat)
}

func (s *server) adminDeleteCategory(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := s.db.Exec(c.Context(), `DELETE FROM product_categories WHERE id = $1`, id)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากอาจมีสินค้าอยู่ภายใน"})
	}
	return c.JSON(fiber.Map{"success": true})
}

// Admin Handlers for Store Products
func (s *server) adminGetProducts(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT p.id, p.category_id, p.title, COALESCE(p.description, ''), p.price, p.stock, p.is_recommended, p.is_popular, p.is_sold_out, p.is_visible, COALESCE(p.cover_image_url, ''), p.cover_crop, p.file_key, p.created_at, p.updated_at,
		       COUNT(pu.id) FILTER (WHERE pu.refunded_at IS NULL), COALESCE(SUM(pu.price_paid) FILTER (WHERE pu.refunded_at IS NULL), 0)
		FROM products p
		LEFT JOIN purchases pu ON pu.product_id = p.id
		GROUP BY p.id
		ORDER BY p.id DESC
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]Product, 0)
	for rows.Next() {
		var p Product
		var revenue float64
		if err := rows.Scan(&p.ID, &p.CategoryID, &p.Title, &p.Description, &p.Price, &p.Stock, &p.IsRecommended, &p.IsPopular, &p.IsSoldOut, &p.IsVisible, &p.CoverImageURL, &p.CoverCrop, &p.FileKey, &p.CreatedAt, &p.UpdatedAt, &p.SoldCount, &revenue); err == nil {
			p.Revenue = &revenue
			p.DeliveryType = productDeliveryType(p.FileKey)
			items = append(items, p)
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminCreateProduct(c *fiber.Ctx) error {
	var body Product
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	if strings.TrimSpace(body.Title) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อสินค้า"})
	}
	if body.CategoryID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกหมวดหมู่สินค้า"})
	}
	if body.Price < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ราคาสินค้าต้องไม่ติดลบ"})
	}
	if strings.TrimSpace(body.FileKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์ที่จะผูกกับสินค้า"})
	}
	if body.Stock < -1 {
		body.Stock = -1
	}
	if err := s.validateProductFile(c.Context(), body.FileKey); err != nil {
		return productFileError(c)
	}

	var p Product
	err := s.db.QueryRow(c.Context(), `
		INSERT INTO products (category_id, title, description, price, stock, is_recommended, is_popular, is_sold_out, is_visible, cover_image_url, file_key, cover_crop)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11, $12::jsonb)
		RETURNING id, category_id, title, COALESCE(description, ''), price, stock, is_recommended, is_popular, is_sold_out, is_visible, COALESCE(cover_image_url, ''), cover_crop, file_key, created_at, updated_at
	`, body.CategoryID, strings.TrimSpace(body.Title), strings.TrimSpace(body.Description), body.Price, body.Stock, body.IsRecommended, body.IsPopular, body.IsSoldOut, body.IsVisible, strings.TrimSpace(body.CoverImageURL), strings.TrimSpace(body.FileKey), coverCropJSON(body.CoverCrop, body.CoverImageURL)).
		Scan(&p.ID, &p.CategoryID, &p.Title, &p.Description, &p.Price, &p.Stock, &p.IsRecommended, &p.IsPopular, &p.IsSoldOut, &p.IsVisible, &p.CoverImageURL, &p.CoverCrop, &p.FileKey, &p.CreatedAt, &p.UpdatedAt)

	if err != nil {
		log.Printf("adminCreateProduct error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := s.prepareProductDelivery(c.Context(), p.ID, p.FileKey); err != nil {
		log.Printf("prepare delivery for new product %d failed: %v", p.ID, err)
		_, _ = s.db.Exec(c.Context(), `DELETE FROM products WHERE id = $1`, p.ID)
		return productFileError(c)
	}

	s.audit(c, auditEvent{Actor: current(c), Category: "store", Action: "product.created", Target: "product", TargetID: fmt.Sprint(p.ID), Metadata: map[string]any{"title": p.Title, "price": p.Price}})
	return c.JSON(p)
}

func (s *server) adminUpdateProduct(c *fiber.Ctx) error {
	id, convErr := strconv.Atoi(c.Params("id"))
	if convErr != nil || id <= 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า"})
	}
	var body Product
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	if strings.TrimSpace(body.Title) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อสินค้า"})
	}
	if body.CategoryID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกหมวดหมู่สินค้า"})
	}
	if body.Price < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ราคาสินค้าต้องไม่ติดลบ"})
	}
	if strings.TrimSpace(body.FileKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์ที่จะผูกกับสินค้า"})
	}
	if body.Stock < -1 {
		body.Stock = -1
	}
	// Refresh the buyers' private copy first; a missing file leaves the product unchanged.
	if err := s.prepareProductDelivery(c.Context(), id, body.FileKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า"})
		}
		log.Printf("prepare delivery for product %d failed: %v", id, err)
		return productFileError(c)
	}

	var p Product
	err := s.db.QueryRow(c.Context(), `
		UPDATE products
		SET category_id = $1, title = $2, description = $3, price = $4, stock = $5, is_recommended = $6, is_popular = $7, is_sold_out = $8, is_visible = $9, cover_image_url = NULLIF($10, ''), file_key = $11, cover_crop = $13::jsonb, updated_at = NOW()
		WHERE id = $12
		RETURNING id, category_id, title, COALESCE(description, ''), price, stock, is_recommended, is_popular, is_sold_out, is_visible, COALESCE(cover_image_url, ''), cover_crop, file_key, created_at, updated_at
	`, body.CategoryID, strings.TrimSpace(body.Title), strings.TrimSpace(body.Description), body.Price, body.Stock, body.IsRecommended, body.IsPopular, body.IsSoldOut, body.IsVisible, strings.TrimSpace(body.CoverImageURL), strings.TrimSpace(body.FileKey), id, coverCropJSON(body.CoverCrop, body.CoverImageURL)).
		Scan(&p.ID, &p.CategoryID, &p.Title, &p.Description, &p.Price, &p.Stock, &p.IsRecommended, &p.IsPopular, &p.IsSoldOut, &p.IsVisible, &p.CoverImageURL, &p.CoverCrop, &p.FileKey, &p.CreatedAt, &p.UpdatedAt)

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{Actor: current(c), Category: "store", Action: "product.updated", Target: "product", TargetID: fmt.Sprint(p.ID), Metadata: map[string]any{"title": p.Title, "price": p.Price}})
	return c.JSON(p)
}

func (s *server) adminDeleteProduct(c *fiber.Ctx) error {
	id := c.Params("id")
	var deliveryKey string
	err := s.db.QueryRow(c.Context(), `DELETE FROM products WHERE id = $1 RETURNING COALESCE(delivery_key, '')`, id).Scan(&deliveryKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า"})
	}
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ลบสินค้านี้ไม่ได้ เพราะมีคนซื้อไปแล้ว ให้ปิดการแสดงผลแทน ผู้ซื้อจะยังดาวน์โหลดได้", Code: "product_has_purchases"})
	}
	s.removePrivateDelivery(c.Context(), deliveryKey)
	s.audit(c, auditEvent{Actor: current(c), Category: "store", Action: "product.deleted", Target: "product", TargetID: id})
	return c.JSON(fiber.Map{"success": true})
}

// storeClosedError is the answer to buying, top-ups and the storefront lists while the
// store is switched off in system settings. Purchase history and downloads stay open.
const storeClosedError = "ร้านค้าปิดให้บริการชั่วคราว ซื้อสินค้าและเติมเงินไม่ได้ในขณะนี้"

func (s *server) requireStoreOpen(c *fiber.Ctx) error {
	var open bool
	if err := s.db.QueryRow(c.Context(), `SELECT store_enabled FROM system_settings WHERE id=1`).Scan(&open); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !open {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: storeClosedError, Code: "store_closed"})
	}
	return c.Next()
}
