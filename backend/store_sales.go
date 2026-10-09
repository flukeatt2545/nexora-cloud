package main

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Store sales are reported in Thai time so "today" and the daily buckets match what admins see.
var storeSalesZone = time.FixedZone("Asia/Bangkok", 7*3600)

type storeSalesPoint struct {
	Date    string  `json:"date"`
	Revenue float64 `json:"revenue"`
	Orders  int64   `json:"orders"`
}

type storeSalesProduct struct {
	ID            int        `json:"id"`
	Title         string     `json:"title"`
	CoverImageURL string     `json:"coverImageUrl"`
	CoverCrop     *CoverCrop `json:"coverCrop"`
	Price         float64    `json:"price"`
	IsVisible     bool       `json:"isVisible"`
	SoldCount     int64      `json:"soldCount"`
	Revenue       float64    `json:"revenue"`
	RefundCount   int64      `json:"refundCount"`
	Refunded      float64    `json:"refunded"`
	LastSoldAt    *time.Time `json:"lastSoldAt"`
}

// salesPeriodStart is the first instant counted for a period of `days` days ending today
// (Thai time). days == 0 means all time and returns nil.
func salesPeriodStart(now time.Time, days int) *time.Time {
	if days <= 0 {
		return nil
	}
	local := now.In(storeSalesZone)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, storeSalesZone).AddDate(0, 0, -(days - 1))
	return &start
}

// GET /api/admin/store/sales?days=7|30|90|365|0
// Totals for the period, a revenue series (daily, or monthly for a year or all time) and
// every product's figures. Refunded orders are left out of sales and reported separately.
func (s *server) adminStoreSales(c *fiber.Ctx) error {
	days := queryInt(c, "days", 30, 0, 365)
	switch days {
	case 0, 7, 30, 90, 365:
	default:
		days = 30
	}
	ctx := c.Context()
	since := salesPeriodStart(time.Now(), days)

	var summary struct {
		Revenue     float64 `json:"revenue"`
		Orders      int64   `json:"orders"`
		Buyers      int64   `json:"buyers"`
		Refunded    float64 `json:"refunded"`
		RefundCount int64   `json:"refundCount"`
	}
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(price_paid) FILTER (WHERE refunded_at IS NULL), 0),
		       COUNT(*) FILTER (WHERE refunded_at IS NULL),
		       COUNT(DISTINCT user_id) FILTER (WHERE refunded_at IS NULL),
		       COALESCE(SUM(price_paid) FILTER (WHERE refunded_at IS NOT NULL), 0),
		       COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)
		FROM purchases
		WHERE $1::timestamptz IS NULL OR purchased_at >= $1
	`, since).Scan(&summary.Revenue, &summary.Orders, &summary.Buyers, &summary.Refunded, &summary.RefundCount); err != nil {
		log.Printf("store sales summary failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Daily buckets up to 90 days; a year or all time is grouped by month (at most 24).
	unit, step := "day", "1 day"
	if days == 0 || days > 90 {
		unit, step = "month", "1 month"
	}
	rows, err := s.db.Query(ctx, `
		WITH local AS (
			SELECT date_trunc($1, purchased_at AT TIME ZONE 'Asia/Bangkok') AS bucket, price_paid
			FROM purchases
			WHERE refunded_at IS NULL AND ($2::timestamptz IS NULL OR purchased_at >= $2)
		), bounds AS (
			SELECT date_trunc($1, NOW() AT TIME ZONE 'Asia/Bangkok') AS last_bucket,
			       CASE WHEN $2::timestamptz IS NULL
			            THEN GREATEST(
			                   COALESCE((SELECT MIN(bucket) FROM local), date_trunc($1, NOW() AT TIME ZONE 'Asia/Bangkok')),
			                   date_trunc($1, NOW() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '23 months')
			            ELSE date_trunc($1, $2::timestamptz AT TIME ZONE 'Asia/Bangkok') END AS first_bucket
		)
		SELECT to_char(g.bucket, 'YYYY-MM-DD'), COALESCE(SUM(l.price_paid), 0), COUNT(l.price_paid)
		FROM bounds, generate_series(bounds.first_bucket, bounds.last_bucket, $3::text::interval) AS g(bucket)
		LEFT JOIN local l ON l.bucket = g.bucket
		GROUP BY g.bucket
		ORDER BY g.bucket
	`, unit, since, step)
	if err != nil {
		log.Printf("store sales series failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	series := make([]storeSalesPoint, 0)
	for rows.Next() {
		var point storeSalesPoint
		if err := rows.Scan(&point.Date, &point.Revenue, &point.Orders); err != nil {
			rows.Close()
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		series = append(series, point)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	rows, err = s.db.Query(ctx, `
		SELECT p.id, p.title, COALESCE(p.cover_image_url, ''), p.cover_crop, p.price, p.is_visible,
		       COUNT(pu.id) FILTER (WHERE pu.refunded_at IS NULL),
		       COALESCE(SUM(pu.price_paid) FILTER (WHERE pu.refunded_at IS NULL), 0),
		       COUNT(pu.id) FILTER (WHERE pu.refunded_at IS NOT NULL),
		       COALESCE(SUM(pu.price_paid) FILTER (WHERE pu.refunded_at IS NOT NULL), 0),
		       MAX(pu.purchased_at) FILTER (WHERE pu.refunded_at IS NULL)
		FROM products p
		LEFT JOIN purchases pu ON pu.product_id = p.id AND ($1::timestamptz IS NULL OR pu.purchased_at >= $1)
		GROUP BY p.id
		ORDER BY 8 DESC, 7 DESC, p.id DESC
	`, since)
	if err != nil {
		log.Printf("store sales products failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	products := make([]storeSalesProduct, 0)
	for rows.Next() {
		var p storeSalesProduct
		if err := rows.Scan(&p.ID, &p.Title, &p.CoverImageURL, &p.CoverCrop, &p.Price, &p.IsVisible, &p.SoldCount, &p.Revenue, &p.RefundCount, &p.Refunded, &p.LastSoldAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	return c.JSON(fiber.Map{"days": days, "unit": unit, "summary": summary, "series": series, "products": products})
}
