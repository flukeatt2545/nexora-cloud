"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, ShieldCheck, X } from "lucide-react";
import { api } from "./DiscordMailBotSettings";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

type Settings = {
  protectChannels: boolean;
  blockLinks: boolean;
  allowedDomains: string[];
  blockInvites: boolean;
  blockSpam: boolean;
  mentionLimit: number;
  blockedWords: string[];
  floodEnabled: boolean;
  floodMessages: number;
  floodSeconds: number;
  floodTimeoutMinutes: number;
  version: number;
};

type Guild = { guildId: string; guildName: string; appliedVersion: number; problems: string[]; updatedAt: string };

type Form = {
  protectChannels: boolean;
  blockLinks: boolean;
  domains: string[];
  blockInvites: boolean;
  blockSpam: boolean;
  mentions: string;
  words: string[];
  floodEnabled: boolean;
  floodMessages: string;
  floodSeconds: string;
  floodTimeout: string;
};

function toForm(s: Settings): Form {
  return {
    protectChannels: s.protectChannels,
    blockLinks: s.blockLinks,
    domains: s.allowedDomains,
    blockInvites: s.blockInvites,
    blockSpam: s.blockSpam,
    mentions: String(s.mentionLimit),
    words: s.blockedWords,
    floodEnabled: s.floodEnabled,
    floodMessages: String(s.floodMessages),
    floodSeconds: String(s.floodSeconds),
    floodTimeout: String(s.floodTimeoutMinutes),
  };
}

/** "https://www.YouTube.com/watch?v=1" → "youtube.com", as the site stores it. */
function cleanDomain(raw: string) {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
}

/**
 * A list edited as chips: type and press Enter (or comma) to add, paste several lines at once,
 * × or Backspace on an empty field to remove.
 */
function TagInput({ id, label, hint, values, onChange, clean, placeholder, disabled, max }: {
  id: string; label: string; hint: string; values: string[]; onChange: (values: string[]) => void;
  clean: (raw: string) => string; placeholder: string; disabled: boolean; max: number;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const next = [...values];
    for (const part of raw.split(/[\n,]/)) {
      const value = clean(part);
      if (value && !next.some((item) => item.toLowerCase() === value.toLowerCase()) && next.length < max) next.push(value);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (draft.trim()) add(draft);
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (/[\n,]/.test(text)) {
      event.preventDefault();
      add(text);
    }
  }

  return (
    <div className="hv-field">
      <div className="hv-field-row">
        <label htmlFor={id}>{label}</label>
        <small>{values.length}/{max}</small>
      </div>
      <div className={`dpr-tags${disabled ? " is-disabled" : ""}`} onClick={() => !disabled && document.getElementById(id)?.focus()}>
        {values.map((value) => (
          <span className="dpr-tag" key={value}>
            {value}
            <button type="button" onClick={(event) => { event.stopPropagation(); onChange(values.filter((item) => item !== value)); }}
              disabled={disabled} aria-label={`เอา ${value} ออก`} title="เอาออก">
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={values.length ? "" : placeholder}
          disabled={disabled || values.length >= max}
          enterKeyHint="done"
        />
      </div>
      <small>{hint}</small>
    </div>
  );
}

function Switch({ label, hint, on, onChange, disabled }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void; disabled: boolean }) {
  return (
    <div className="dbot-switch-row">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sc-switch${on ? " is-on" : ""}`} onClick={() => onChange(!on)} disabled={disabled}>
        <span />
      </button>
    </div>
  );
}

/**
 * Server protection run by the voice bot in every server it is in (superadmin). The bot applies
 * changes within about 15 seconds; what it stops shows on the logs page.
 */
export function DiscordProtect({ notify }: { notify: Notice }) {
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [version, setVersion] = useState(0);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: { settings: Settings; guilds: Guild[] }, resetForm: boolean) => {
    setGuilds(data.guilds || []);
    setVersion(data.settings.version);
    if (resetForm) {
      setForm(toForm(data.settings));
      setSaved(toForm(data.settings));
    }
  }, []);

  const load = useCallback((resetForm: boolean) => {
    api<{ settings: Settings; guilds: Guild[] }>("/api/admin/discord-protect")
      .then((data) => { apply(data, resetForm); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"));
  }, [apply]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Until every server has the latest rules, check again every few seconds.
  const waiting = guilds.some((guild) => guild.appliedVersion < version);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => load(false), 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const loading = !form;
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const numbers = {
      mentionLimit: Number(form.mentions), floodMessages: Number(form.floodMessages),
      floodSeconds: Number(form.floodSeconds), floodTimeoutMinutes: Number(form.floodTimeout),
    };
    if (Object.values(numbers).some((value) => !Number.isInteger(value))) {
      notify({ kind: "error", text: "ใส่ตัวเลขให้ครบ" });
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ settings: Settings; guilds: Guild[] }>("/api/admin/discord-protect", {
        method: "PUT",
        body: JSON.stringify({
          protectChannels: form.protectChannels, blockLinks: form.blockLinks, allowedDomains: form.domains,
          blockInvites: form.blockInvites, blockSpam: form.blockSpam, blockedWords: form.words,
          floodEnabled: form.floodEnabled, ...numbers,
        }),
      });
      apply(data, true);
      notify({ kind: "success", text: "บันทึกแล้ว บอทจะใช้กฎใหม่ในทุกเซิร์ฟภายใน 15 วินาที" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="aov-panel dbot-card dbot-wide">
        <div className="dbot-body">
          <div className="hv-callout is-error">
            <CircleAlert size={18} aria-hidden="true" />
            <p><strong>โหลดระบบป้องกันไม่ได้</strong><span>{loadError}</span></p>
            <button type="button" onClick={() => load(true)}>ลองอีกครั้ง</button>
          </div>
        </div>
      </section>
    );
  }

  const set = (next: Partial<Form>) => form && setForm({ ...form, ...next });
  const off = loading || busy;

  return (
    <form className="aov-panel dbot-card dbot-wide" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <header className="dbot-card-head">
        <span className="dbot-mark" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div>
          <h2>ระบบป้องกันเซิร์ฟเวอร์</h2>
          <p>ทำงานเงียบๆ ในทุกเซิร์ฟที่บอทห้องเสียงอยู่ คนทำผิดเห็นแค่ข้อความเตือนของตัวเอง แอดมินดูรายละเอียดได้ที่หน้าบันทึกระบบ</p>
        </div>
      </header>
      {form && (
        <div className="dbot-body dpr-body">
          <div className="dpr-col">
            <Switch label="ป้องกันการลบห้อง" hint="ใครลบห้อง บอทสร้างคืนทันที (เจ้าของเซิร์ฟลบห้องทั่วไปได้)" on={form.protectChannels}
              onChange={(on) => set({ protectChannels: on })} disabled={off} />
            <Switch label="กันลิงก์" hint="ส่งได้เฉพาะลิงก์เว็บที่อนุญาตด้านล่าง" on={form.blockLinks} onChange={(on) => set({ blockLinks: on })} disabled={off} />
            <TagInput id="dpr-domains" label="เว็บที่อนุญาต" values={form.domains} onChange={(domains) => set({ domains })} clean={cleanDomain} max={90}
              placeholder="พิมพ์ชื่อเว็บ เช่น youtube.com แล้วกด Enter" disabled={off || !form.blockLinks}
              hint="วางลิงก์ทั้งลิงก์ก็ได้ ระบบเหลือแค่ชื่อเว็บให้เอง เว็บย่อยใช้ได้ด้วย เช่น m.youtube.com" />
            <Switch label="กันลิงก์เชิญเซิร์ฟอื่น" hint="discord.gg และลิงก์เชิญทุกแบบ" on={form.blockInvites} onChange={(on) => set({ blockInvites: on })} disabled={off} />
            <Switch label="กันข้อความสแปม" hint="Discord ตรวจข้อความที่ดูเหมือนสแปมให้" on={form.blockSpam} onChange={(on) => set({ blockSpam: on })} disabled={off} />
          </div>
          <div className="dpr-col">
            <div className="hv-field">
              <label htmlFor="dpr-mentions">แท็กได้สูงสุดต่อข้อความ</label>
              <input id="dpr-mentions" type="number" inputMode="numeric" min={0} max={50} value={form.mentions} onChange={(event) => set({ mentions: event.target.value })} disabled={off} />
              <small>เกินนี้ข้อความถูกบล็อกและพักการพิมพ์ 10 นาที ใส่ 0 = ไม่จำกัด</small>
            </div>
            <TagInput id="dpr-words" label="คำต้องห้าม" values={form.words} onChange={(words) => set({ words })} clean={(raw) => raw.trim().slice(0, 60)} max={900}
              placeholder="พิมพ์คำแล้วกด Enter (ว่างไว้ = ไม่กันคำ)" disabled={off}
              hint="คำภาษาไทยถูกกันแม้อยู่ติดกับคำอื่น วางหลายคำพร้อมกันได้ (คั่นด้วยบรรทัดใหม่หรือ ,)" />
            <Switch label="กันพิมพ์รัว" hint="ส่งข้อความเร็วเกินไป ถูกพักการพิมพ์และลบข้อความชุดนั้น" on={form.floodEnabled} onChange={(on) => set({ floodEnabled: on })} disabled={off} />
            <div className="dpr-flood">
              <div className="hv-field">
                <label htmlFor="dpr-fm">ข้อความ</label>
                <input id="dpr-fm" type="number" inputMode="numeric" min={3} max={30} value={form.floodMessages} onChange={(event) => set({ floodMessages: event.target.value })} disabled={off || !form.floodEnabled} />
              </div>
              <div className="hv-field">
                <label htmlFor="dpr-fs">ภายใน (วินาที)</label>
                <input id="dpr-fs" type="number" inputMode="numeric" min={2} max={60} value={form.floodSeconds} onChange={(event) => set({ floodSeconds: event.target.value })} disabled={off || !form.floodEnabled} />
              </div>
              <div className="hv-field">
                <label htmlFor="dpr-ft">พัก (นาที)</label>
                <input id="dpr-ft" type="number" inputMode="numeric" min={1} max={1440} value={form.floodTimeout} onChange={(event) => set({ floodTimeout: event.target.value })} disabled={off || !form.floodEnabled} />
              </div>
            </div>
          </div>
          <div className="dpr-guilds">
            <strong>สถานะแต่ละเซิร์ฟ</strong>
            {guilds.length === 0 ? (
              <p>ยังไม่มีข้อมูล บอทจะรายงานภายใน 15 วินาทีหลังออนไลน์</p>
            ) : (
              <ul>
                {guilds.map((guild) => (
                  <li key={guild.guildId}>
                    <span className={`dpr-dot${guild.problems.length ? " is-warn" : ""}`} aria-hidden="true">
                      {guild.problems.length ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
                    </span>
                    <div>
                      <b>{guild.guildName || guild.guildId}</b>
                      <small>
                        {guild.appliedVersion < version ? "กำลังใช้กฎใหม่..." : guild.problems.length ? "ใช้งานได้บางส่วน" : "ใช้งานได้ครบ"}
                      </small>
                      {guild.problems.map((problem) => <small key={problem} className="dpr-problem">{problem}</small>)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p>แอดมินและคนที่มีสิทธิ์จัดการเซิร์ฟเวอร์ไม่โดนกฎเหล่านี้</p>
          </div>
        </div>
      )}
      <footer className="dbot-foot">
        <span className="dbot-state">{loading ? "กำลังโหลด..." : dirty ? "ยังไม่ได้บันทึก" : "ไม่มีอะไรเปลี่ยน"}</span>
        {dirty && <button type="button" className="hv-btn" onClick={() => saved && setForm(saved)} disabled={busy}>ยกเลิก</button>}
        <button className="hv-btn hv-btn-primary" disabled={busy || loading || !dirty}>
          {busy && <span className="hv-spinner" aria-hidden="true" />}
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </footer>
    </form>
  );
}
