"use client";

import { CalendarDays, Palette, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySiteTheme, SITE_THEMES, type SiteThemeId } from "../siteThemes";
import { Switch, type Notice } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";
import "./site-theme-card.css";

// The site's theme on the admin settings page: pick the one used all year, and list date ranges in
// which another one takes over by itself. Picking a tile previews it on this page right away; it is
// saved for everyone only with the save button. The rules for what is on today are in
// backend/site_theme.go.

type Rule = { id: string; label: string; theme: Exclude<SiteThemeId, "default">; start: string; end: string; yearly: boolean; enabled: boolean };
type Data = { theme: SiteThemeId; schedule: Rule[]; active: SiteThemeId; activeRuleId: string; today: string };

const NAMES: Record<string, string> = { default: "ธีมปกติ", ...Object.fromEntries(SITE_THEMES.map((theme) => [theme.id, theme.name])) };

const year = () => new Date().getFullYear();
const PRESETS: { label: string; theme: Rule["theme"]; start: () => string; end: () => string }[] = [
  { label: "ฮาโลวีน 25 ต.ค. – 1 พ.ย.", theme: "halloween", start: () => `${year()}-10-25`, end: () => `${year()}-11-01` },
];

const newId = () => Math.random().toString(36).slice(2, 10);

export function SiteThemeCard({ notify }: { notify: Notice }) {
  const [data, setData] = useState<Data | null>(null);
  const [theme, setTheme] = useState<SiteThemeId>("default");
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saved = useRef<SiteThemeId>("default");

  const load = useCallback(() => {
    api<Data>("/api/admin/site-theme")
      .then((next) => {
        setData(next);
        setTheme(next.theme);
        setRules(next.schedule);
        saved.current = next.active;
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Leaving the page puts back the theme that is really on.
  useEffect(() => () => applySiteTheme(saved.current, false), []);

  const dirty = useMemo(() => Boolean(data) && (theme !== data?.theme || JSON.stringify(rules) !== JSON.stringify(data?.schedule)), [data, theme, rules]);

  function pick(next: SiteThemeId) {
    setTheme(next);
    applySiteTheme(next, false);
  }
  const edit = (id: string, change: Partial<Rule>) => setRules((list) => list.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)));

  async function save() {
    setBusy(true);
    try {
      const next = await api<Data>("/api/admin/site-theme", { method: "PUT", body: JSON.stringify({ theme, schedule: rules }) });
      setData(next);
      setTheme(next.theme);
      setRules(next.schedule);
      saved.current = next.active;
      applySiteTheme(next.active);
      notify({ kind: "success", text: next.active === "default" ? "บันทึกแล้ว ตอนนี้เว็บใช้ธีมปกติ" : `บันทึกแล้ว ตอนนี้เว็บใช้ธีม${NAMES[next.active]}` });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (!data) return;
    setTheme(data.theme);
    setRules(data.schedule);
    applySiteTheme(data.active, false);
  }

  if (failed) return null;
  const activeRule = data?.schedule.find((rule) => rule.id === data.activeRuleId);
  const active = data?.active ?? "default";
  const tiles: { id: SiteThemeId; name: string; blurb: string; mode?: string }[] = [
    { id: "default", name: "ธีมปกติ", blurb: "ใช้สีหลักและโหมดสว่าง/มืดที่ตั้งไว้ด้านบน" },
    ...SITE_THEMES.map((item) => ({ id: item.id, name: item.name, blurb: item.blurb, mode: item.mode === "light" ? "สว่าง" : "มืด" })),
  ];

  return (
    <section className="msp-card" id="site-theme" aria-busy={!data}>
      <header className="msp-head">
        <span className="msp-mark"><Palette size={18} /></span>
        <div>
          <h3>ธีมเว็บไซต์</h3>
          <p>เปลี่ยนหน้าตาทั้งเว็บ รวมแดชบอร์ดและหลังบ้าน เลือกแล้วหน้านี้เปลี่ยนให้ดูก่อน คนอื่นเห็นหลังกดบันทึก</p>
        </div>
        {data && <span className={`msp-state ${active === "default" ? "" : "is-ok"}`}><i />ตอนนี้ใช้: {NAMES[active]}</span>}
      </header>
      <div className="msp-rows">
        <div className="stc-section">
          <div className="stc-title"><strong>ธีมตลอดปี</strong><span>ใช้ตลอด ยกเว้นช่วงวันที่ที่ตั้งไว้ด้านล่าง</span></div>
          <div className="stc-grid" role="radiogroup" aria-label="ธีมตลอดปี">
            {tiles.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={theme === item.id} className={`stc-tile${theme === item.id ? " is-on" : ""}`} onClick={() => pick(item.id)} disabled={busy || !data}>
                <i className={`stc-preview stc-prev-${item.id}`} aria-hidden="true"><b /><u /></i>
                <strong>{item.name}{item.mode && <em>{item.mode}</em>}</strong>
                <small>{item.blurb}</small>
              </button>
            ))}
          </div>
          {data && activeRule && <p className="stc-note"><CalendarDays size={15} aria-hidden="true" />วันนี้อยู่ในช่วง “{activeRule.label || NAMES[activeRule.theme]}” เว็บจึงใช้ธีม{NAMES[active]} แม้ธีมตลอดปีจะเป็นอีกแบบ</p>}
        </div>

        <div className="stc-section">
          <div className="stc-title"><strong>ตั้งเวลาเปลี่ยนธีมเอง</strong><span>ถึงช่วงวันที่ เว็บเปลี่ยนเป็นธีมนั้นเอง พ้นช่วงแล้วกลับเป็นธีมตลอดปี (เวลาไทย) ถ้าซ้อนกัน ใช้ช่วงที่อยู่บนสุด</span></div>
          {rules.length > 0 && (
            <ul className="stc-rules">
              {rules.map((rule) => (
                <li key={rule.id} className={rule.id === data?.activeRuleId ? "is-now" : ""}>
                  <Switch label={`เปิดช่วงวันที่ ${rule.label || NAMES[rule.theme]}`} on={rule.enabled} onChange={(enabled) => edit(rule.id, { enabled })} disabled={busy} />
                  <input className="stc-input stc-label" aria-label="ชื่อช่วง" placeholder="ชื่อช่วง เช่น ฮาโลวีน" maxLength={60} value={rule.label} onChange={(event) => edit(rule.id, { label: event.target.value })} disabled={busy} />
                  <select className="stc-input" aria-label="ธีมของช่วงนี้" value={rule.theme} onChange={(event) => edit(rule.id, { theme: event.target.value as Rule["theme"] })} disabled={busy}>
                    {SITE_THEMES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <span className="stc-dates">
                    <input className="stc-input" type="date" aria-label="วันเริ่ม" value={rule.start} onChange={(event) => edit(rule.id, { start: event.target.value })} disabled={busy} />
                    <span aria-hidden="true">ถึง</span>
                    <input className="stc-input" type="date" aria-label="วันสิ้นสุด" value={rule.end} onChange={(event) => edit(rule.id, { end: event.target.value })} disabled={busy} />
                  </span>
                  <label className="stc-yearly"><input type="checkbox" checked={rule.yearly} onChange={(event) => edit(rule.id, { yearly: event.target.checked })} disabled={busy} />ทุกปี</label>
                  <button type="button" className="stc-icon" aria-label="ลบช่วงนี้" title="ลบ" onClick={() => setRules((list) => list.filter((item) => item.id !== rule.id))} disabled={busy}><Trash2 size={16} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="stc-add">
            {PRESETS.map((preset) => (
              <button key={preset.theme} type="button" className="stc-chip" disabled={busy || !data || rules.length >= 24}
                onClick={() => setRules((list) => [...list, { id: newId(), label: preset.label.split(" ")[0], theme: preset.theme, start: preset.start(), end: preset.end(), yearly: true, enabled: true }])}>
                <Plus size={14} aria-hidden="true" />{preset.label}
              </button>
            ))}
            <button type="button" className="stc-chip is-plain" disabled={busy || !data || rules.length >= 24}
              onClick={() => setRules((list) => [...list, { id: newId(), label: "", theme: "halloween", start: `${year()}-01-01`, end: `${year()}-01-07`, yearly: false, enabled: true }])}>
              <Plus size={14} aria-hidden="true" />เพิ่มช่วงเอง
            </button>
          </div>
          <p className="stc-hint">“ทุกปี” ใช้เฉพาะเดือนกับวัน ไม่สนปี และข้ามปีใหม่ได้ เช่น 20 ธ.ค. ถึง 3 ม.ค. ลองดูธีมใดก็ได้โดยเพิ่ม <code>?theme=halloween</code> ท้ายที่อยู่หน้าใดก็ได้ (ดูอย่างเดียว ไม่บันทึก)</p>
        </div>

        {dirty && (
          <div className="stc-bar" role="status">
            <span><i />ยังไม่ได้บันทึก</span>
            <button type="button" className="stc-btn" onClick={cancel} disabled={busy}>ยกเลิก</button>
            <button type="button" className="stc-btn is-primary" onClick={() => void save()} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกธีม"}</button>
          </div>
        )}
      </div>
    </section>
  );
}

