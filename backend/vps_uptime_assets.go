package main

const vpsUptimeDocumentHead = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#09090b"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2309090b'/%3E%3Cpath d='M8 23V9l16 14V9' fill='none' stroke='%23f4f4f5' stroke-width='3'/%3E%3C/svg%3E"><title>สถานะ VPS | nove666.pro</title><link rel="stylesheet" href="/vps/style.css?v=20260922"><script defer src="/vps/app.js?v=20260922"></script></head>`

const vpsUptimeBrand = `<a class="brand" href="https://nove666.pro/" aria-label="nove666.pro"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg><span>nove666</span></a>`

const vpsUptimeDashboardHTML = vpsUptimeDocumentHead + `<body><div class="ambient" aria-hidden="true"></div><div class="shell"><header class="topbar">` + vpsUptimeBrand + `<span class="status"><span class="status-dot" aria-hidden="true"></span> VPS ONLINE</span></header><main class="stage"><section class="uptime" aria-labelledby="page-title"><p class="eyebrow">SERVER UPTIME</p><h1 id="page-title">VPS ทำงานมาแล้ว</h1><p class="days" id="uptime-days">กำลังตรวจสอบ</p><div class="clock" id="uptime-clock" aria-label="เวลาที่เซิร์ฟเวอร์ทำงาน">--:--:--</div><div class="clock-labels" aria-hidden="true"><span>ชั่วโมง</span><span>นาที</span><span>วินาที</span></div><div class="rule"></div><p class="boot-time" id="boot-time">กำลังอ่านเวลาเริ่มทำงาน</p><p class="update-time" id="update-time" role="status">ข้อมูลจาก VPS โดยตรง</p></section></main><footer class="footer"><span>nove666.pro <span class="footer-divider">/</span> เฉพาะผู้ดูแล</span><button class="logout" id="vps-logout" type="button">ออกจากหน้านี้</button></footer></div></body></html>`

func vpsUptimeAccessHTML(denied bool) string {
	title := "หน้าสำหรับผู้ดูแล"
	detail := "เข้าสู่ระบบด้วยบัญชีแอดมิน NEXORA เพื่อดูเวลาทำงานของ VPS"
	if denied {
		title = "บัญชีนี้ยังไม่มีสิทธิ์"
		detail = "หน้านี้เปิดให้เฉพาะบัญชีแอดมิน NEXORA เท่านั้น"
	}
	return vpsUptimeDocumentHead + `<body><div class="ambient" aria-hidden="true"></div><div class="shell"><header class="topbar">` + vpsUptimeBrand + `<span class="status private">PRIVATE</span></header><main class="stage"><section class="access" aria-labelledby="page-title"><span class="access-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/></svg></span><p class="eyebrow">NOVE / PRIVATE ACCESS</p><h1 id="page-title">` + title + `</h1><p class="access-detail">` + detail + `</p><p class="access-error" id="access-error" role="alert" hidden></p><a class="access-button" href="https://nkn02.com/api/vps-uptime/start">เข้าสู่ระบบผ่าน NEXORA <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a></section></main><footer class="footer"><span>nove666.pro <span class="footer-divider">/</span> VPS STATUS</span></footer></div></body></html>`
}

const vpsUptimeCSS = `
:root{color-scheme:dark;background:#09090b;color:#f4f4f5;font-family:"Nexora Thai",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
html{min-width:280px}
body{margin:0;min-height:100vh;min-height:100svh;background:#09090b;color:#f4f4f5;-webkit-font-smoothing:antialiased}
button,a{font:inherit}
.ambient{position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse 60% 38% at 50% 51%,rgba(34,197,94,.045),transparent 72%)}
.shell{position:relative;display:flex;flex-direction:column;width:min(1100px,100%);min-height:100vh;min-height:100svh;margin:auto;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))}
.topbar,.footer{display:flex;align-items:center;justify-content:space-between;gap:20px}
.brand{display:inline-flex;align-items:center;gap:10px;color:#f4f4f5;font-size:15px;font-weight:700;letter-spacing:-.03em;text-decoration:none}
.brand svg{color:#e4e4e7}
.brand:hover{color:#fff}
.brand:focus-visible,.logout:focus-visible,.access-button:focus-visible{outline:2px solid #4ade80;outline-offset:5px;border-radius:4px}
.status{display:inline-flex;align-items:center;gap:9px;color:#a1a1aa;font:600 11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em}
.status-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.1)}
.status.private{color:#71717a}
.stage{flex:1;display:grid;place-items:center;padding:52px 0}
.uptime,.access{width:min(760px,100%);text-align:center}
.eyebrow{margin:0 0 19px;color:#a1a1aa;font:600 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.2em}
h1{margin:0;color:#f4f4f5;font-size:clamp(27px,4.3vw,42px);font-weight:650;line-height:1.35;letter-spacing:-.04em}
.days{min-height:27px;margin:34px 0 3px;color:#4ade80;font-size:14px;font-weight:600;letter-spacing:.02em}
.clock{white-space:nowrap;color:#f4f4f5;font:600 clamp(42px,10.4vw,116px)/1.15 ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.09em;text-align:center}
.clock-labels{display:grid;grid-template-columns:repeat(3,1fr);width:min(480px,73%);margin:9px auto 0;color:#71717a;font-size:12px}
.rule{width:min(460px,82%);height:1px;margin:42px auto 26px;background:linear-gradient(90deg,transparent,#27272a 14%,#27272a 86%,transparent)}
.boot-time,.update-time{margin:0;color:#a1a1aa;font-size:14px;line-height:1.7}
.update-time{margin-top:6px;color:#71717a;font-size:12px}
.footer{border-top:1px solid rgba(255,255,255,.08);padding-top:17px;color:#71717a;font-size:12px}
.footer-divider{padding:0 8px;color:#3f3f46}
.logout{border:0;background:transparent;color:#a1a1aa;cursor:pointer;padding:5px 0}
.logout:hover{color:#f4f4f5}
.access-mark{display:inline-grid;place-items:center;width:54px;height:54px;margin-bottom:25px;border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#a1a1aa;background:#121215}
.access-mark svg{width:24px;height:24px}
.access-detail{max-width:470px;margin:17px auto 0;color:#a1a1aa;font-size:15px;line-height:1.8}
.access-error{margin:16px auto 0;color:#fca5a5;font-size:13px}
.access-button{display:inline-flex;align-items:center;justify-content:center;gap:14px;min-height:48px;margin-top:34px;padding:11px 22px;border:1px solid #3f3f46;border-radius:10px;background:#18181c;color:#f4f4f5;text-decoration:none;font-size:14px;font-weight:600;transition:background .15s,border-color .15s}
.access-button:hover{background:#27272a;border-color:#71717a}
.access-button svg{color:#4ade80}
@media(max-width:640px){.shell{padding:max(19px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom))}.stage{padding:36px 0}.clock{font-size:clamp(39px,11vw,70px);letter-spacing:-.085em}.days{margin-top:31px}.clock-labels{width:min(370px,82%)}.rule{margin-top:35px}.footer{font-size:11px}}
@media(max-width:340px){.clock{font-size:38px}.clock-labels{width:88%}.status{letter-spacing:0}}
@media(max-height:560px){.stage{padding:30px 0}.days{margin-top:18px}.rule{margin:23px auto 16px}}

`

const vpsUptimeJS = `(() => {
  const ticket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
  if (ticket) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    fetch('/vps/exchange', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket })
    }).then(response => {
      if (!response.ok) throw new Error('exchange_failed');
      window.location.replace('/vps/');
    }).catch(() => {
      const error = document.getElementById('access-error');
      if (error) { error.textContent = 'ลิงก์หมดอายุหรือใช้ไปแล้ว กรุณาลองเข้าสู่ระบบใหม่'; error.hidden = false; }
    });
    return;
  }

  const clock = document.getElementById('uptime-clock');
  if (!clock) return;
  const days = document.getElementById('uptime-days');
  const bootTime = document.getElementById('boot-time');
  const updateTime = document.getElementById('update-time');
  let baseline = null;
  let sampledAt = 0;

  function tick() {
    if (baseline === null) return;
    const total = Math.max(0, baseline + Math.floor((performance.now() - sampledAt) / 1000));
    const dayCount = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    clock.textContent = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
    days.textContent = dayCount > 0 ? dayCount.toLocaleString('th-TH') + ' วัน' : 'ยังไม่ครบ 1 วัน';
  }

  async function refresh() {
    try {
      const response = await fetch('/vps/data', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { window.location.reload(); return; }
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!Number.isFinite(data.uptimeSeconds) || data.uptimeSeconds < 0) throw new Error('invalid_data');
      baseline = Math.floor(data.uptimeSeconds);
      sampledAt = performance.now();
      tick();
      const boot = new Date(data.bootedAt);
      if (!Number.isNaN(boot.getTime())) {
        bootTime.textContent = 'เปิดเครื่องล่าสุด ' + new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(boot) + ' น.';
      }
      updateTime.textContent = 'ตรวจสอบข้อมูลจาก VPS แล้ว';
    } catch {
      updateTime.textContent = 'ติดต่อ VPS ไม่สำเร็จ กำลังลองใหม่';
    }
  }

  const logout = document.getElementById('vps-logout');
  if (logout) logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await fetch('/vps/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }); }
    finally { window.location.replace('/vps/'); }
  });
  refresh();
  setInterval(tick, 1000);
  setInterval(refresh, 30000);
})();`
