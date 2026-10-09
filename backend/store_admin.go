package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

// ---------------------------------------------------------------------------
// Admin file library: private prefix
// ---------------------------------------------------------------------------

// The admin library used to live in uploads/, which the bucket policy serves publicly
// (Discord /upload images must stay public there). Library files are only ever reached
// through /f/ links, which the API reads with its own credentials, so they now live in
// library/ where nothing can fetch them directly.
const adminLibraryPrefix = "library/"
const legacyLibraryPrefix = "uploads/"

// Product covers live apart from the files that are sold, so the cover picker and the
// delivery picker never show each other's files. Covers are public through /f/ links;
// a cover name can never resolve as a product file because resolveAdminLibraryFile only
// looks in library/ (and the legacy uploads/).
const storeCoverPrefix = "store-covers/"

// coverImageTypes are the image types a cover may be. SVG is left out: covers are public
// and an SVG can carry script.
var coverImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// adminLibraryPrefixFor maps the ?kind= of the admin file endpoints to a storage prefix.
func adminLibraryPrefixFor(kind string) string {
	if kind == "cover" {
		return storeCoverPrefix
	}
	return adminLibraryPrefix
}

// Discord /upload images: uploads/<24 hex>.<ext>. Never moved, even without a bot_uploads row.
var botUploadKeyPattern = regexp.MustCompile(`^uploads/[0-9a-f]{24}\.(jpg|jpeg|png|gif|webp)$`)

// migrateAdminLibrary moves legacy library files out of the public uploads/ prefix.
// Safe to run on every start: anything already moved is simply not found again.
func (s *server) migrateAdminLibrary(ctx context.Context) {
	client, ok := s.storage.(*minio.Client)
	if !ok || client == nil {
		return
	}
	moved, skipped := 0, 0
	for object := range client.ListObjects(ctx, s.cfg.s3Bucket, minio.ListObjectsOptions{Prefix: legacyLibraryPrefix, Recursive: true}) {
		if object.Err != nil {
			log.Printf("[WARN] library migration: list failed: %v", object.Err)
			return
		}
		key := object.Key
		name := strings.TrimPrefix(key, legacyLibraryPrefix)
		if name == "" || strings.HasSuffix(name, "/") || botUploadKeyPattern.MatchString(key) {
			continue
		}
		var isBotUpload bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM bot_uploads WHERE object_key = $1)`, key).Scan(&isBotUpload); err != nil || isBotUpload {
			continue
		}
		target := adminLibraryPrefix + name
		if _, err := client.StatObject(ctx, s.cfg.s3Bucket, target, minio.StatObjectOptions{}); err == nil {
			skipped++
			log.Printf("[WARN] library migration: %s already exists, leaving %s in place", target, key)
			continue
		}
		if _, err := client.CopyObject(ctx,
			minio.CopyDestOptions{Bucket: s.cfg.s3Bucket, Object: target},
			minio.CopySrcOptions{Bucket: s.cfg.s3Bucket, Object: key},
		); err != nil {
			log.Printf("[WARN] library migration: copy %s failed: %v", key, err)
			continue
		}
		if _, err := s.db.Exec(ctx, `UPDATE file_aliases SET object_key = $1 WHERE object_key = $2`, target, key); err != nil {
			log.Printf("[WARN] library migration: alias update for %s failed: %v", key, err)
			_ = client.RemoveObject(ctx, s.cfg.s3Bucket, target, minio.RemoveObjectOptions{})
			continue
		}
		if err := client.RemoveObject(ctx, s.cfg.s3Bucket, key, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[WARN] library migration: remove %s failed: %v", key, err)
		}
		moved++
	}
	if moved > 0 || skipped > 0 {
		log.Printf("[INFO] library migration: moved %d file(s) to %s, skipped %d", moved, adminLibraryPrefix, skipped)
	}
}

// resolveAdminLibraryFile finds a library file by name, checking the private prefix first.
func (s *server) resolveAdminLibraryFile(ctx context.Context, fileKey string) (string, minio.ObjectInfo, error) {
	name := strings.TrimPrefix(strings.TrimSpace(fileKey), "/")
	name = strings.TrimPrefix(strings.TrimPrefix(name, legacyLibraryPrefix), adminLibraryPrefix)
	if name == "" || strings.Contains(name, "..") || strings.Contains(name, "\\") || s.storage == nil {
		return "", minio.ObjectInfo{}, errProductFileMissing
	}
	for _, prefix := range []string{adminLibraryPrefix, legacyLibraryPrefix} {
		key := prefix + name
		if prefix == legacyLibraryPrefix && botUploadKeyPattern.MatchString(key) {
			continue
		}
		if info, err := s.storage.StatObject(ctx, s.cfg.s3Bucket, key, minio.StatObjectOptions{}); err == nil {
			return key, info, nil
		}
	}
	return "", minio.ObjectInfo{}, errProductFileMissing
}

// ---------------------------------------------------------------------------
// Points history (top-ups, purchases, refunds)
// ---------------------------------------------------------------------------

type pointsHistoryItem struct {
	Kind   string    `json:"kind"` // topup | purchase | refund
	ID     int64     `json:"id"`
	Amount float64   `json:"amount"` // signed: + adds points, - spends them
	Status string    `json:"status"`
	Title  string    `json:"title"`
	Ref    string    `json:"ref"`
	At     time.Time `json:"at"`
}

// GET /api/store/points-history?type=all|topup|spend&page=&perPage=
func (s *server) pointsHistory(c *fiber.Ctx) error {
	user := current(c)
	page := queryInt(c, "page", 1, 1, 100000)
	perPage := queryInt(c, "perPage", 10, 5, 50)
	kind := c.Query("type", "all")

	parts := []string{}
	if kind == "all" || kind == "topup" {
		parts = append(parts, `SELECT 'topup' AS kind, id, amount, status, '' AS title, COALESCE(trans_ref, '') AS ref, COALESCE(verified_at, created_at) AS at
			FROM topup_transactions WHERE user_id = $1`)
	}
	if kind == "all" || kind == "spend" {
		parts = append(parts,
			`SELECT 'purchase' AS kind, pu.id, -pu.price_paid AS amount, 'completed' AS status, p.title AS title, '' AS ref, pu.purchased_at AS at
			FROM purchases pu JOIN products p ON p.id = pu.product_id WHERE pu.user_id = $1`,
			`SELECT 'refund' AS kind, pu.id, pu.price_paid AS amount, 'completed' AS status, p.title AS title, COALESCE(pu.refund_reason, '') AS ref, pu.refunded_at AS at
			FROM purchases pu JOIN products p ON p.id = pu.product_id WHERE pu.user_id = $1 AND pu.refunded_at IS NOT NULL`)
	}
	if len(parts) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประเภทรายการไม่ถูกต้อง"})
	}
	union := strings.Join(parts, " UNION ALL ")

	var total int64
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM (`+union+`) h`, user.ID).Scan(&total); err != nil {
		log.Printf("points history count failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	rows, err := s.db.Query(c.Context(), `SELECT kind, id, amount, status, title, ref, at FROM (`+union+`) h ORDER BY at DESC, id DESC LIMIT $2 OFFSET $3`, user.ID, perPage, (page-1)*perPage)
	if err != nil {
		log.Printf("points history failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]pointsHistoryItem, 0)
	for rows.Next() {
		var item pointsHistoryItem
		if err := rows.Scan(&item.Kind, &item.ID, &item.Amount, &item.Status, &item.Title, &item.Ref, &item.At); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	var topupTotal, topupMonth, spent, refunded float64
	var balance float64
	if err := s.db.QueryRow(c.Context(), `
		SELECT
			COALESCE((SELECT SUM(amount) FROM topup_transactions WHERE user_id = $1 AND status = 'completed'), 0),
			COALESCE((SELECT SUM(amount) FROM topup_transactions WHERE user_id = $1 AND status = 'completed' AND created_at >= DATE_TRUNC('month', NOW())), 0),
			COALESCE((SELECT SUM(price_paid) FROM purchases WHERE user_id = $1), 0),
			COALESCE((SELECT SUM(price_paid) FROM purchases WHERE user_id = $1 AND refunded_at IS NOT NULL), 0),
			(SELECT points FROM users WHERE id = $1)
	`, user.ID).Scan(&topupTotal, &topupMonth, &spent, &refunded, &balance); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{
		"items":   items,
		"page":    page,
		"perPage": perPage,
		"total":   total,
		"summary": fiber.Map{
			"balance":     balance,
			"topupTotal":  topupTotal,
			"topupMonth":  topupMonth,
			"spentTotal":  spent - refunded,
			"refundTotal": refunded,
		},
	})
}

// ---------------------------------------------------------------------------
// Admin: orders and refunds
// ---------------------------------------------------------------------------

type adminOrder struct {
	ID           int64      `json:"id"`
	UserID       int64      `json:"userId"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"displayName"`
	ProductID    int        `json:"productId"`
	ProductTitle string     `json:"productTitle"`
	PricePaid    float64    `json:"pricePaid"`
	PurchasedAt  time.Time  `json:"purchasedAt"`
	RefundedAt   *time.Time `json:"refundedAt"`
	RefundReason string     `json:"refundReason"`
	RefundedBy   string     `json:"refundedBy"`
}

// GET /api/admin/store/orders?q=&status=all|active|refunded&page=&perPage=
func (s *server) adminListOrders(c *fiber.Ctx) error {
	page := queryInt(c, "page", 1, 1, 100000)
	perPage := queryInt(c, "perPage", 20, 5, 100)
	where := []string{"TRUE"}
	args := []any{}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		args = append(args, "%"+strings.ToLower(q)+"%")
		n := len(args)
		cond := fmt.Sprintf("(LOWER(u.identifier) LIKE $%d OR LOWER(COALESCE(u.display_name, '')) LIKE $%d OR LOWER(p.title) LIKE $%d", n, n, n)
		if id, err := strconv.ParseInt(strings.TrimPrefix(q, "#"), 10, 64); err == nil {
			args = append(args, id)
			cond += fmt.Sprintf(" OR pu.id = $%d OR u.id = $%d", len(args), len(args))
		}
		where = append(where, cond+")")
	}
	switch c.Query("status") {
	case "active":
		where = append(where, "pu.refunded_at IS NULL")
	case "refunded":
		where = append(where, "pu.refunded_at IS NOT NULL")
	}
	from := ` FROM purchases pu JOIN users u ON u.id = pu.user_id JOIN products p ON p.id = pu.product_id
		LEFT JOIN users rb ON rb.id = pu.refunded_by WHERE ` + strings.Join(where, " AND ")

	var total int64
	var revenue, refunded float64
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*), COALESCE(SUM(pu.price_paid) FILTER (WHERE pu.refunded_at IS NULL), 0), COALESCE(SUM(pu.price_paid) FILTER (WHERE pu.refunded_at IS NOT NULL), 0)`+from, args...).Scan(&total, &revenue, &refunded); err != nil {
		log.Printf("admin orders count failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	args = append(args, perPage, (page-1)*perPage)
	rows, err := s.db.Query(c.Context(), `
		SELECT pu.id, u.id, u.identifier, COALESCE(u.display_name, ''), p.id, p.title, pu.price_paid, pu.purchased_at,
		       pu.refunded_at, COALESCE(pu.refund_reason, ''), COALESCE(rb.identifier, '')`+from+
		fmt.Sprintf(` ORDER BY pu.purchased_at DESC, pu.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		log.Printf("admin orders failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]adminOrder, 0)
	for rows.Next() {
		var o adminOrder
		if err := rows.Scan(&o.ID, &o.UserID, &o.Username, &o.DisplayName, &o.ProductID, &o.ProductTitle, &o.PricePaid, &o.PurchasedAt, &o.RefundedAt, &o.RefundReason, &o.RefundedBy); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, o)
	}
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"items": items, "page": page, "perPage": perPage, "total": total, "summary": fiber.Map{"revenue": revenue, "refunded": refunded}})
}

// POST /api/admin/store/orders/:id/refund {reason}
// Returns the points to the buyer, ends their download access and puts limited stock back.
func (s *server) adminRefundOrder(c *fiber.Ctx) error {
	actor := current(c)
	orderID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || orderID <= 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบคำสั่งซื้อ"})
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.BodyParser(&body)
	reason := strings.TrimSpace(body.Reason)
	if len([]rune(reason)) > 300 {
		reason = string([]rune(reason)[:300])
	}
	if reason == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุเหตุผลในการคืนพอยท์", Code: "reason_required"})
	}
	ctx := c.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(ctx)

	var userID int64
	var productID int
	var price float64
	var refundedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT user_id, product_id, price_paid, refunded_at FROM purchases WHERE id = $1 FOR UPDATE`, orderID).Scan(&userID, &productID, &price, &refundedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบคำสั่งซื้อ"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if refundedAt != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "คำสั่งซื้อนี้คืนพอยท์ไปแล้ว", Code: "already_refunded"})
	}

	var newPoints float64
	if err := tx.QueryRow(ctx, `UPDATE users SET points = points + (SELECT price_paid FROM purchases WHERE id = $1) WHERE id = $2 RETURNING points`, orderID, userID).Scan(&newPoints); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(ctx, `UPDATE purchases SET refunded_at = NOW(), refunded_by = $1, refund_reason = $2 WHERE id = $3`, actor.ID, reason, orderID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(ctx, `UPDATE products SET stock = stock + 1, updated_at = NOW() WHERE id = $1 AND stock >= 0`, productID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(ctx); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{Actor: actor, Category: "store", Action: "order.refunded", Target: "purchase", TargetID: fmt.Sprint(orderID), Metadata: map[string]any{"userId": userID, "productId": productID, "amount": price, "reason": reason, "balanceAfter": newPoints}})
	return c.JSON(fiber.Map{"success": true, "message": fmt.Sprintf("คืน %s ให้ผู้ซื้อแล้ว", formatPoints(price)), "newPoints": newPoints})
}
