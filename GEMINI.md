# NEXORA Cloud - Guidelines & VPS Configuration

## VPS Connection Details
- **Host / IP**: `165.101.65.23` (or `nkn02.com`)
- **User**: `root`
- **SSH Private Key Path**: `C:\Users\nkn246\Desktop\vps\ssh-keys\nkn02_root_ed25519`
- **Remote Project Directory**: `/opt/app/nexora`

### Standard SSH Command Format
```bash
ssh -i "C:\Users\nkn246\Desktop\vps\ssh-keys\nkn02_root_ed25519" root@165.101.65.23 "<command>"
```

## Development Commands
- **Frontend Dev**: `npm run dev` (Runs Vinext/Vite dev server at `http://localhost:3000`)
- **Full Stack / Docker**: `docker compose up -d`
- **API Endpoint**: `http://localhost:8080`
- **Reverse Proxy**: `http://localhost:8088`

## UI / UX Design Guidelines
- **No Emojis Policy (ห้ามใช้อิโมจิเด็ดขาด)**: Do NOT use emojis in any UI, text, cards, buttons, titles, or code. Always use Lucide React icons or SVG icons instead to maintain a clean, high-end, human-crafted SaaS look and feel.

