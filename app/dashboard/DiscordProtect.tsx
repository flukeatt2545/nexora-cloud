"use client";

import { ClipboardEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Link2, MessagesSquare, ServerCog, ShieldCheck, Timer, X } from "lucide-react";
import { Card, Fields, LoadError, type Notice, Rows, SaveBar, SwitchRow } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

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
      <div className={`bp-tags${disabled ? " is-disabled" : ""}`} onClick={() => !disabled && document.getElementById(id)?.focus()}>
        {values.map((value) => (
          <span className="bp-chip" key={value}>
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

  if (loadError) return <LoadError title="โหลดการป้องกันไม่ได้" message={loadError} onRetry={() => load(true)} />;

  const set = (next: Partial<Form>) => form && setForm({ ...form, ...next });
  const off = loading || busy;

  return (
    <form className="bp-pane" onSubmit={(event) => void save(event)} aria-busy={loading}>
      {!form ? <Card icon={ShieldCheck} title="กำลังโหลด..." busy /> : (
        <>
          <div className="bp-grid">
            <div className="bp-col">
              <Card icon={ShieldCheck} title="ห้องที่ถูกลบ" text="ใครลบห้อง บอทสร้างคืนให้ทันที" flush>
                <Rows>
                  <SwitchRow title="สร้างห้องคืน" hint="เจ้าของเซิร์ฟลบห้องทั่วไปได้ ส่วนคนอื่นที่ลบได้ตั้งที่ ดูแลเซิร์ฟ > ความปลอดภัย"
                    on={form.protectChannels} onChange={(protectChannels) => set({ protectChannels })} disabled={off} />
                </Rows>
              </Card>

              <Card icon={Link2} title="ลิงก์" text="คนที่ส่งลิงก์ที่ไม่อนุญาตจะเห็นแค่ข้อความเตือนของตัวเอง" flush>
                <Rows>
                  <SwitchRow title="กันลิงก์" hint="ส่งได้เฉพาะลิงก์ของเว็บที่อนุญาตด้านล่าง" on={form.blockLinks} onChange={(blockLinks) => set({ blockLinks })} disabled={off} />
                </Rows>
                <Fields>
                  <TagInput id="pr-domains" label="เว็บที่อนุญาต" values={form.domains} onChange={(domains) => set({ domains })} clean={cleanDomain} max={90}
                    placeholder="พิมพ์ชื่อเว็บ เช่น youtube.com แล้วกด Enter" disabled={off || !form.blockLinks}
                    hint="วางลิงก์ทั้งลิงก์ก็ได้ ตัดให้เหลือแค่ชื่อเว็บให้เอง เว็บย่อยใช้ได้ด้วย เช่น m.youtube.com" />
                </Fields>
                <Rows>
                  <SwitchRow title="กันลิงก์เชิญเซิร์ฟอื่น" hint="discord.gg และลิงก์เชิญทุกแบบ" on={form.blockInvites} onChange={(blockInvites) => set({ blockInvites })} disabled={off} />
                </Rows>
              </Card>
            </div>

            <div className="bp-col">
              <Card icon={MessagesSquare} title="ข้อความ" text="สแปม การแท็ก และคำต้องห้าม" flush>
                <Rows>
                  <SwitchRow title="กันข้อความสแปม" hint="ให้ Discord ตรวจข้อความที่ดูเหมือนสแปม" on={form.blockSpam} onChange={(blockSpam) => set({ blockSpam })} disabled={off} />
                </Rows>
                <Fields>
                  <div className="hv-field">
                    <label htmlFor="pr-mentions">แท็กได้สูงสุดต่อข้อความ</label>
                    <input id="pr-mentions" type="number" inputMode="numeric" min={0} max={50} value={form.mentions} onChange={(event) => set({ mentions: event.target.value })} disabled={off} />
                    <small>เกินแล้วข้อความถูกบล็อกและพักการพิมพ์ 10 นาที ใส่ 0 = ไม่จำกัด</small>
                  </div>
                  <TagInput id="pr-words" label="คำต้องห้าม" values={form.words} onChange={(words) => set({ words })} clean={(raw) => raw.trim().slice(0, 60)} max={900}
                    placeholder="พิมพ์คำแล้วกด Enter" disabled={off}
                    hint="คำไทยถูกกันแม้ติดกับคำอื่น วางหลายคำพร้อมกันได้ คั่นด้วยบรรทัดใหม่หรือ ," />
                </Fields>
              </Card>

              <Card icon={Timer} title="พิมพ์รัว" text="ส่งข้อความเร็วเกินไปจะถูกพักการพิมพ์ และลบข้อความชุดนั้น" flush
                toggle={{ label: "กันพิมพ์รัว", on: form.floodEnabled, onChange: (floodEnabled) => set({ floodEnabled }), disabled: off }}>
                <Fields>
                  <div className="bp-three">
                    <div className="hv-field">
                      <label htmlFor="pr-fm">ข้อความ</label>
                      <input id="pr-fm" type="number" inputMode="numeric" min={3} max={30} value={form.floodMessages} onChange={(event) => set({ floodMessages: event.target.value })} disabled={off || !form.floodEnabled} />
                    </div>
                    <div className="hv-field">
                      <label htmlFor="pr-fs">ภายใน (วินาที)</label>
                      <input id="pr-fs" type="number" inputMode="numeric" min={2} max={60} value={form.floodSeconds} onChange={(event) => set({ floodSeconds: event.target.value })} disabled={off || !form.floodEnabled} />
                    </div>
                    <div className="hv-field">
                      <label htmlFor="pr-ft">พัก (นาที)</label>
                      <input id="pr-ft" type="number" inputMode="numeric" min={1} max={1440} value={form.floodTimeout} onChange={(event) => set({ floodTimeout: event.target.value })} disabled={off || !form.floodEnabled} />
                    </div>
                  </div>
                </Fields>
              </Card>
            </div>
          </div>

          <Card icon={ServerCog} title="เซิร์ฟที่บอทอยู่" text="แอดมินและคนที่มีสิทธิ์จัดการเซิร์ฟไม่โดนกฎพวกนี้">
            {guilds.length === 0 ? (
              <p className="bp-note">ยังไม่มีข้อมูล บอทจะรายงานภายใน 15 วินาทีหลังออนไลน์</p>
            ) : (
              <ul className="bp-servers">
                {guilds.map((guild) => (
                  <li key={guild.guildId}>
                    <span className={`bp-dot${guild.problems.length ? " is-warn" : ""}`} aria-hidden="true">
                      {guild.problems.length ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
                    </span>
                    <div>
                      <b>{guild.guildName || guild.guildId}</b>
                      <small>{guild.appliedVersion < version ? "กำลังใช้กฎใหม่..." : guild.problems.length ? "ทำงานได้บางส่วน" : "ทำงานได้ครบ"}</small>
                      {guild.problems.map((problem) => <small key={problem} className="bp-warn">{problem}</small>)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <SaveBar dirty={dirty} busy={busy} onCancel={() => saved && setForm(saved)} />
        </>
      )}
    </form>
  );
}
