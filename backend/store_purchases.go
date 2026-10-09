package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

// Buyers download a private copy of the product file kept under store-private/, so later
// edits or deletions in the admin library never affect what was sold.
const storePrivatePrefix = "store-private/"

var errProductFileMissing = errors.New("product file missing")

type myPurchase struct {
	ID            int64     `json:"id"`
	ProductID     int       `json:"productId"`
	Title         string    `json:"title"`
	CoverImageURL string    `json:"coverImageUrl"`
	CoverCrop     *CoverCrop `json:"coverCrop"`
	PricePaid     float64   `json:"pricePaid"`
	PurchasedAt   time.Time `json:"purchasedAt"`
	DeliveryType  string    `json:"deliveryType"`
}

func isExternalProductLink(fileKey string) bool {
	lower := strings.ToLower(strings.TrimSpace(fileKey))
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://")
}

func productDeliveryType(fileKey string) string {
	if isExternalProductLink(fileKey) {
		return "link"
	}
	return "file"
}

// validateProductFile checks that a product's file exists before the product is saved.
func (s *server) validateProductFile(ctx context.Context, fileKey string) error {
	if isExternalProductLink(fileKey) {
		return nil
	}
	_, _, err := s.resolveAdminLibraryFile(ctx, fileKey)
	return err
}

// prepareProductDelivery makes (or keeps) the private copy buyers download for a product.
func (s *server) prepareProductDelivery(ctx context.Context, productID int, fileKey string) error {
	fileKey = strings.TrimSpace(fileKey)
	var oldKey, oldFrom string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(delivery_key, ''), COALESCE(delivery_from, '') FROM products WHERE id = $1`, productID).Scan(&oldKey, &oldFrom); err != nil {
		return err
	}
	if isExternalProductLink(fileKey) {
		if _, err := s.db.Exec(ctx, `UPDATE products SET delivery_key = NULL, delivery_from = $1, delivery_name = NULL WHERE id = $2`, fileKey, productID); err != nil {
			return err
		}
		s.removePrivateDelivery(ctx, oldKey)
		return nil
	}
	if s.storage == nil {
		return errProductFileMissing
	}
	if oldKey != "" && oldFrom == fileKey {
		if _, err := s.storage.StatObject(ctx, s.cfg.s3Bucket, oldKey, minio.StatObjectOptions{}); err == nil {
			return nil
		}
	}

	objectKey, info, err := s.resolveAdminLibraryFile(ctx, fileKey)
	if err != nil {
		return err
	}
	source, err := s.storage.GetObject(ctx, s.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return errProductFileMissing
	}
	defer source.Close()

	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	name := path.Base(objectKey)
	newKey := fmt.Sprintf("%s%d/%s/%s", storePrivatePrefix, productID, hex.EncodeToString(random), name)
	if _, err := s.storage.PutObject(ctx, s.cfg.s3Bucket, newKey, source, info.Size, minio.PutObjectOptions{ContentType: info.ContentType}); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE products SET delivery_key = $1, delivery_from = $2, delivery_name = $3 WHERE id = $4`, newKey, fileKey, name, productID); err != nil {
		s.removePrivateDelivery(ctx, newKey)
		return err
	}
	if oldKey != newKey {
		s.removePrivateDelivery(ctx, oldKey)
	}
	return nil
}

func (s *server) removePrivateDelivery(ctx context.Context, key string) {
	if key == "" || s.storage == nil || !strings.HasPrefix(key, storePrivatePrefix) {
		return
	}
	if err := s.storage.RemoveObject(ctx, s.cfg.s3Bucket, key, minio.RemoveObjectOptions{}); err != nil {
		log.Printf("remove store delivery copy %s failed: %v", key, err)
	}
}

func productFileError(c *fiber.Ctx) error {
	return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบไฟล์ที่ผูกกับสินค้า กรุณาเลือกไฟล์ใหม่", Code: "product_file_missing"})
}

// GET /api/store/purchases — the signed-in user's products, newest purchase first.
func (s *server) listMyPurchases(c *fiber.Ctx) error {
	user := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT DISTINCT ON (pu.product_id)
		       pu.id, pu.product_id, pu.price_paid, pu.purchased_at,
		       p.title, COALESCE(p.cover_image_url, ''), p.cover_crop, p.file_key
		FROM purchases pu
		JOIN products p ON p.id = pu.product_id
		WHERE pu.user_id = $1 AND pu.refunded_at IS NULL
		ORDER BY pu.product_id, pu.purchased_at DESC
		LIMIT 500
	`, user.ID)
	if err != nil {
		log.Printf("list purchases failed for user %d: %v", user.ID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := make([]myPurchase, 0)
	for rows.Next() {
		var item myPurchase
		var fileKey string
		if err := rows.Scan(&item.ID, &item.ProductID, &item.PricePaid, &item.PurchasedAt, &item.Title, &item.CoverImageURL, &item.CoverCrop, &fileKey); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		item.DeliveryType = productDeliveryType(fileKey)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].PurchasedAt.After(items[j].PurchasedAt) })

	var totalSpent float64
	if err := s.db.QueryRow(c.Context(), `SELECT COALESCE(SUM(price_paid), 0) FROM purchases WHERE user_id = $1 AND refunded_at IS NULL`, user.ID).Scan(&totalSpent); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"items": items, "totalSpent": totalSpent})
}

// GET /api/store/purchases/:id/download — deliver a bought product (id is the product id).
func (s *server) downloadPurchasedProduct(c *fiber.Ctx) error {
	user := current(c)
	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil || productID <= 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า", Code: "product_not_found"})
	}
	ctx := c.Context()

	var title, fileKey string
	err = s.db.QueryRow(ctx, `SELECT title, file_key FROM products WHERE id = $1`, productID).Scan(&title, &fileKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบสินค้า", Code: "product_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if user.Role != "admin" && user.Role != "superadmin" {
		var owned bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM purchases WHERE user_id = $1 AND product_id = $2 AND refunded_at IS NULL)`, user.ID, productID).Scan(&owned); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if !owned {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ต้องซื้อสินค้านี้ก่อนจึงจะดาวน์โหลดได้", Code: "not_purchased"})
		}
	}

	if isExternalProductLink(fileKey) {
		s.audit(c, auditEvent{Actor: user, Category: "store", Action: "product.downloaded", Target: "product", TargetID: fmt.Sprint(productID), Metadata: map[string]any{"type": "link"}})
		return c.JSON(fiber.Map{"type": "link", "url": strings.TrimSpace(fileKey)})
	}

	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน", Code: "storage_unavailable"})
	}
	// Products saved before private copies existed get theirs on first download.
	if err := s.prepareProductDelivery(ctx, productID, fileKey); err != nil {
		log.Printf("prepare delivery for product %d failed: %v", productID, err)
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไฟล์ของสินค้านี้ยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ", Code: "product_file_missing"})
	}
	var deliveryKey, deliveryName string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(delivery_key, ''), COALESCE(delivery_name, '') FROM products WHERE id = $1`, productID).Scan(&deliveryKey, &deliveryName); err != nil || deliveryKey == "" {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไฟล์ของสินค้านี้ยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ", Code: "product_file_missing"})
	}
	info, err := s.storage.StatObject(ctx, s.cfg.s3Bucket, deliveryKey, minio.StatObjectOptions{})
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไฟล์ของสินค้านี้ยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ", Code: "product_file_missing"})
	}
	if deliveryName == "" {
		deliveryName = path.Base(deliveryKey)
	}
	contentType := info.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	s.audit(c, auditEvent{Actor: user, Category: "store", Action: "product.downloaded", Target: "product", TargetID: fmt.Sprint(productID), Metadata: map[string]any{"type": "file", "title": title}})
	return s.sendUserFileObject(c, deliveryKey, deliveryName, contentType, info.Size, false)
}

// CoverCrop is the part of the cover a product card shows: a focus point in percent of the
// image plus a zoom factor. The cover file itself is never modified.
type CoverCrop struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// coverCropJSON clamps a crop from the admin form and returns it for a jsonb column.
// No cover, or a centred unzoomed crop, is stored as NULL.
func coverCropJSON(crop *CoverCrop, coverURL string) *string {
	if crop == nil || strings.TrimSpace(coverURL) == "" {
		return nil
	}
	clamp := func(v, lo, hi float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return lo
		}
		return math.Max(lo, math.Min(hi, v))
	}
	x := math.Round(clamp(crop.X, 0, 100)*10) / 10
	y := math.Round(clamp(crop.Y, 0, 100)*10) / 10
	zoom := math.Round(clamp(crop.Zoom, 1, 4)*100) / 100
	if x == 50 && y == 50 && zoom == 1 {
		return nil
	}
	value := fmt.Sprintf(`{"x":%g,"y":%g,"zoom":%g}`, x, y, zoom)
	return &value
}
