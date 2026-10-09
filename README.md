<pre align="center">
███╗   ██╗███████╗██╗  ██╗ ██████╗ ██████╗  █████╗
████╗  ██║██╔════╝╚██╗██╔╝██╔═══██╗██╔══██╗██╔══██╗
██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║██████╔╝███████║
██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║██╔══██╗██╔══██║
██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝██║  ██║██║  ██║
╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
                        C L O U D
</pre>

<p align="center">
  <strong>แพลตฟอร์ม Store · Hosting · Wallet สำหรับทีม NKN</strong><br/>
  Frontend + Go API + Docker — รันครบในเครื่องเดียว
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/React_19-111111?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-111111?style=for-the-badge&logo=typescript&logoColor=3178C6" />
  <img alt="Go" src="https://img.shields.io/badge/Go_API-111111?style=for-the-badge&logo=go&logoColor=00ADD8" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-111111?style=for-the-badge&logo=docker&logoColor=2496ED" />
  <img alt="Postgres" src="https://img.shields.io/badge/PostgreSQL-111111?style=for-the-badge&logo=postgresql&logoColor=4169E1" />
</p>

---

## ภาพรวม

NEXORA CLOUD คือระบบหลังบ้านและหน้าร้านของ NKN — จัดการสินค้า, โฮสติ้งเว็บลูกค้า, เติมเงิน, ไฟล์ผู้ใช้ และสิทธิ์แอดมิน ในสแต็กเดียว

| โซน | หน้าที่ |
| --- | --- |
| **Store** | ขายสินค้า / ควบคุมการแสดงผลหน้าแรก |
| **Hosting** | สร้างไซต์, runtime, env, file manager, phpMyAdmin |
| **Wallet** | เติมเงินผ่านสลิป (CheckSlips) + แอดมินตรวจสอบ |
| **Files** | คลังไฟล์ผู้ใช้ / แอดมินจัดการ |

Production: [`nkn02.com`](https://nkn02.com)

---

## สถาปัตยกรรม

```text
                         ┌─────────────┐
          Browser ──────►│    Caddy    │ :8088
                         └──────┬──────┘
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
           ┌────────┐     ┌──────────┐    ┌─────────────┐
           │  web   │     │   api    │    │   runtime   │
           │ Vite   │     │  Fiber   │    │   gateway   │
           └────────┘     └────┬─────┘    └─────────────┘
                               │
           ┌──────────┬────────┼─────────┬────────────┐
           ▼          ▼        ▼         ▼            ▼
      PostgreSQL    Redis    MinIO     MySQL      phpMyAdmin
      (platform)   (sess)    (S3)    (tenant)      (db.*)
```

| ส่วน | เทคโนโลยี |
| --- | --- |
| UI | React 19 · TypeScript · Vite / Vinext · Tailwind |
| API | Go · Fiber |
| Data | PostgreSQL 17 · Redis 7 · MinIO · MySQL 8 (tenant) |
| Edge | Caddy reverse proxy · Cloudflare DNS (hosting) |

---

## เริ่มต้นเร็ว

### 1) เตรียม env

```bash
cp .env.example .env
```

แก้รหัสผ่าน / secret ใน `.env` ให้ครบ (อย่าใช้ค่าตัวอย่างบน production)

### 2) ขึ้นทั้งสแต็ก

```bash
docker compose up -d --build
```

เปิดระบบที่

```text
http://localhost:8088
```

API ตรงๆ ที่ `http://localhost:8080`

### 3) พัฒนา UI แยก (optional)

```bash
npm install
npm run dev
```

| URL | ใช้ทำอะไร |
| --- | --- |
| `http://localhost:3000` | Frontend hot reload |
| `http://localhost:8080` | API ที่ UI ชี้ไปตอน dev |
| `http://localhost:8088` | Full stack ผ่าน Caddy |

---

## คำสั่งที่ใช้บ่อย

```bash
# ทดสอบ frontend (build + smoke tests)
npm test

# ทดสอบ backend
cd backend && go test ./...

# ล็อก / รีสตาร์ท
docker compose logs -f api
docker compose up -d --build web
```

---

## โครงสร้างโปรเจกต์

```text
nkn-v6-new-ui/
├── app/                 # หน้า Store, Admin, User dashboard
├── backend/             # Go API, migrations, hosting runtime
├── phpmyadmin_config/   # sign-on + MySQL CA
├── public/              # static assets
├── Caddyfile            # routing / security headers
├── docker-compose.yml   # full local / prod-like stack
└── .env.example         # ตัวแปรที่ต้องตั้ง
```

---

## ความปลอดภัย (ไฮไลต์)

- แฮชรหัสผ่านด้วย **Argon2id**
- Session opaque ใน **HttpOnly** cookie + hash ใน DB/Redis
- Rate limit สำหรับ register / login
- RBAC: `user` · `admin` · `superadmin`
- Audit log สำหรับแอ็กชันสำคัญ
- phpMyAdmin ใช้ ticket อายุสั้น — ไม่ฝังรหัสผ่านใน URL
- File manager กัน path traversal / symlink escape

> Local: `COOKIE_SECURE=false` ได้ · Production (HTTPS): ตั้ง `true`

---

## Env สำคัญ

ดูรายการเต็มใน [`.env.example`](.env.example)

| กลุ่ม | ตัวอย่าง |
| --- | --- |
| Core | `POSTGRES_PASSWORD` · `REDIS_PASSWORD` · `S3_SECRET_KEY` |
| Hosting | `HOSTING_ENCRYPTION_KEY` · `CLOUDFLARE_API_TOKEN` · `CF_ZONE_ID` |
| Auth OAuth | Discord / Google / GitHub client id+secret |
| Top-up | `CHECKSLIPS_*` · `TOPUP_RECEIVER_*` |
| phpMyAdmin | `PMA_INTERNAL_SECRET` · `PMA_CONTROL_PASSWORD` |

---

## สถานะโปรเจกต์

repo นี้เป็น **private** สำหรับทีมพัฒนา NKN / NEXORA

ถ้าเจอบั๊กหรืออยากเพิ่มฟีเจอร์ — คุยในทีมก่อนแล้วเปิด issue/PR ตาม workflow ที่ตกลงกัน

---

<p align="center">
  <sub>NEXORA CLOUD · built for NKN</sub>
</p>
