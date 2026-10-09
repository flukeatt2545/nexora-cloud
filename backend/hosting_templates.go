package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

// starterHTML generates a modern landing page HTML for a newly created site.
// Improved from the old system: dark theme, better typography, responsive design.
func starterHTML(subdomain, domain, title, desc, langHint string) string {
	accentColor := "#6c63ff"
	accentBg := "rgba(108,99,255,0.12)"
	switch langHint {
	case "php":
		accentColor = "#5e5ee6"
		accentBg = "rgba(94,94,230,0.12)"
	case "node":
		accentColor = "#ff9900"
		accentBg = "rgba(255,153,0,0.12)"
	default:
		accentColor = "#00d084"
		accentBg = "rgba(0,208,132,0.12)"
	}

	return fmt.Sprintf(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Kanit:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet" />
  <title>%s</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: 'Kanit', 'Inter', 'Segoe UI', sans-serif;
      color: #e2e8f0;
      background: #0f0f1a;
      background-image:
        radial-gradient(ellipse 900px 400px at 50%% 0%%, %s 0%%, transparent 70%%),
        radial-gradient(ellipse 600px 300px at 80%% 100%%, rgba(94,94,230,0.08) 0%%, transparent 60%%);
    }
    .card {
      width: min(680px, 94vw);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(26,26,36,0.9);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 40px 32px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.4);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: %s;
      color: %s;
      padding: 6px 16px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      margin-bottom: 20px;
    }
    .badge svg { width: 14px; height: 14px; }
    h1 {
      font-size: clamp(1.6rem, 4vw, 2.2rem);
      font-weight: 800;
      color: #fff;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    .desc {
      color: #94a3b8;
      line-height: 1.72;
      font-size: 0.95rem;
      max-width: 520px;
      margin: 0 auto;
    }
    .domain {
      margin-top: 24px;
      color: %s;
      font-weight: 600;
      font-size: 0.95rem;
    }
    code {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 5px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #fff;
      font-size: 0.9rem;
    }
    .footer {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: #475569;
      font-size: 0.78rem;
    }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      NEXORA CLOUD
    </span>
    <h1>%s</h1>
    <p class="desc">%s</p>
    <p class="domain">%s</p>
    <div class="footer">Powered by NEXORA Cloud Hosting Platform</div>
  </main>
</body>
</html>`,
		title,
		accentBg,
		accentBg, accentColor,
		accentColor,
		title, desc,
		fmt.Sprintf(`<code>%s</code>`, domain),
	)
}

func generateStaticZip(subdomain, cfDomain string) ([]byte, error) {
	domain := subdomain + "." + cfDomain
	html := starterHTML(subdomain, domain,
		"Static HTML - "+domain,
		"เว็บไซต์เริ่มต้นพร้อมใช้งาน สามารถอัปโหลดไฟล์ HTML, CSS และ JavaScript ของคุณได้ทันที หรือจะแก้ไขไฟล์นี้โดยตรงก็ได้",
		"static",
	)
	return createZipFromFiles(map[string][]byte{
		"index.html": []byte(html),
	})
}

func generatePhpZip(subdomain, cfDomain string) ([]byte, error) {
	domain := subdomain + "." + cfDomain
	phpContent := generatePhpStarterPage(subdomain, domain)

	return createZipFromFiles(map[string][]byte{
		"index.php": []byte(phpContent),
	})
}

func generatePhpStarterPage(subdomain, domain string) string {
	return fmt.Sprintf(`<?php
$domain = '%s';
$subdomain = '%s';
?><!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Kanit:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet" />
  <title>PHP App - <?= htmlspecialchars($domain, ENT_QUOTES, 'UTF-8') ?></title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: 'Kanit', 'Inter', 'Segoe UI', sans-serif;
      color: #e2e8f0;
      background: #0f0f1a;
      background-image:
        radial-gradient(ellipse 900px 400px at 50%% 0%%, rgba(94,94,230,0.12) 0%%, transparent 70%%),
        radial-gradient(ellipse 600px 300px at 80%% 100%%, rgba(94,94,230,0.08) 0%%, transparent 60%%);
    }
    .card {
      width: min(680px, 94vw);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(26,26,36,0.9);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 40px 32px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.4);
      text-align: center;
    }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      border-radius: 999px; border: 1px solid rgba(255,255,255,0.1);
      background: rgba(94,94,230,0.12); color: #5e5ee6;
      padding: 6px 16px; font-size: 0.82rem; font-weight: 700;
      letter-spacing: 0.02em; margin-bottom: 20px;
    }
    .badge svg { width: 14px; height: 14px; }
    h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 800; color: #fff; margin-bottom: 12px; line-height: 1.3; }
    .desc { color: #94a3b8; line-height: 1.72; font-size: 0.95rem; max-width: 520px; margin: 0 auto; }
    .domain { margin-top: 24px; color: #5e5ee6; font-weight: 600; font-size: 0.95rem; }
    code { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 5px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #fff; font-size: 0.9rem; }
    .info { margin-top: 20px; padding: 16px; border-radius: 12px; border: 1px solid rgba(94,94,230,0.2); background: rgba(94,94,230,0.06); text-align: left; font-size: 0.85rem; color: #94a3b8; line-height: 1.6; }
    .info strong { color: #5e5ee6; }
    .footer { margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06); color: #475569; font-size: 0.78rem; }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      NEXORA CLOUD
    </span>
    <h1>PHP App พร้อมใช้งาน</h1>
    <p class="desc">เว็บไซต์ PHP เริ่มต้นพร้อมใช้งาน สามารถอัปโหลดไฟล์ PHP ของคุณและเชื่อมต่อฐานข้อมูลได้ทันที</p>
    <p class="domain"><code><?= htmlspecialchars($domain, ENT_QUOTES, 'UTF-8') ?></code></p>
    <div class="info">
      <strong>PHP Version:</strong> <?= phpversion() ?><br>
      <strong>Server:</strong> <?= htmlspecialchars($_SERVER['SERVER_SOFTWARE'] ?? 'N/A', ENT_QUOTES, 'UTF-8') ?><br>
      <strong>Document Root:</strong> <?= htmlspecialchars($_SERVER['DOCUMENT_ROOT'] ?? 'N/A', ENT_QUOTES, 'UTF-8') ?>
    </div>
    <div class="footer">Powered by NEXORA Cloud Hosting Platform</div>
  </main>
</body>
</html>`, domain, subdomain)
}

func generateNodeZip(subdomain, cfDomain string) ([]byte, error) {
	domain := subdomain + "." + cfDomain
	html := starterHTML(subdomain, domain,
		"Node.js - "+domain,
		"เว็บไซต์ Node.js เริ่มต้นพร้อมใช้งาน สามารถแก้ไข server.js หรือเปลี่ยนเป็นเฟรมเวิร์กที่ต้องการได้ทันที เช่น Express, Fastify หรือ Next.js",
		"node",
	)

	pkgJSON := fmt.Sprintf(`{
  "name": "%s-site",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  }
}
`, subdomain)

	// Escape the HTML for embedding in JS string
	escapedHTML := strings.ReplaceAll(html, "\\", "\\\\")
	escapedHTML = strings.ReplaceAll(escapedHTML, "`", "\\`")
	escapedHTML = strings.ReplaceAll(escapedHTML, "$", "\\$")

	serverJS := fmt.Sprintf(`const http = require('http');

const port = Number(process.env.PORT) || 3000;

const html = %s;

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(port, '0.0.0.0', () => {
  console.log('[NKN Hosting] Server listening on port ' + port);
});
`, "`"+html+"`")

	return createZipFromFiles(map[string][]byte{
		"package.json": []byte(pkgJSON),
		"server.js":    []byte(serverJS),
	})
}

func createZipFromFiles(files map[string][]byte) ([]byte, error) {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			return nil, fmt.Errorf("zip create %s: %w", name, err)
		}
		if _, err := f.Write(content); err != nil {
			return nil, fmt.Errorf("zip write %s: %w", name, err)
		}
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("zip close: %w", err)
	}
	return buf.Bytes(), nil
}

func (s *server) uploadGeneratedZip(ctx *fiber.Ctx, siteDBID int64, data []byte) (string, error) {
	if s.storage == nil {
		return "", fiber.NewError(fiber.StatusServiceUnavailable, "object storage unavailable")
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	key := fmt.Sprintf("deployments/%d/%s.zip", siteDBID, hex.EncodeToString(random))
	_, err := s.storage.PutObject(ctx.Context(), s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: "application/zip"})
	if err != nil {
		return "", err
	}
	return key, nil
}

func (s *server) generateHostingSiteStarter(c *fiber.Ctx) error {
	actor := current(c)
	publicID := strings.TrimSpace(c.Params("id"))

	key := strings.TrimSpace(c.Get("Idempotency-Key"))
	if key == "" || len(key) < 16 || len(key) > 128 {
		return fiber.NewError(fiber.StatusBadRequest, "โปรดระบุ Idempotency-Key ให้ถูกต้อง")
	}
	hash := "generate-" + key

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	_, processed, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "runtime.redeploy")
	if err != nil {
		return hostingIdempotencyError(c, err)
	}
	if processed {
		return c.SendStatus(fiber.StatusNoContent)
	}

	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบเว็บไซต์")
	}
	if err != nil {
		return err
	}
	if access.AccessRole == "viewer" {
		return fiber.NewError(fiber.StatusForbidden, "คุณไม่มีสิทธิ์จัดการเว็บไซต์นี้")
	}

	// Read site info from DB
	var subdomain, projectType string
	if err := tx.QueryRow(c.Context(), `SELECT subdomain, project_type FROM hosting_sites WHERE id=$1`, access.DBID).Scan(&subdomain, &projectType); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Generate zip based on project type
	var zipData []byte
	switch projectType {
	case "php":
		zipData, err = generatePhpZip(subdomain, s.cfg.cfDomain)
	case "node":
		zipData, err = generateNodeZip(subdomain, s.cfg.cfDomain)
	default:
		// static, auto -> generate static HTML
		zipData, err = generateStaticZip(subdomain, s.cfg.cfDomain)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "ไม่สามารถสร้าง Template ได้: "+err.Error())
	}

	// Upload to MinIO
	objectKey, err := s.uploadGeneratedZip(c, access.DBID, zipData)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "ไม่สามารถอัปโหลด Template ได้")
	}

	// Enqueue deploy operation
	if err := enqueueHostingDeployOperation(c.Context(), tx, access.DBID, actor.ID, key, hash, access.PublicID, objectKey); err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "hosting", Action: "hosting.generate_starter",
		Target: "site", TargetID: access.PublicID,
		Metadata: fiber.Map{"projectType": projectType, "deploymentKey": objectKey},
	})
	return c.JSON(fiber.Map{"status": "queued", "projectType": projectType})
}
