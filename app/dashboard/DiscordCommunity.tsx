"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, CircleAlert, CircleCheck, ListChecks, Settings2, Ticket, X } from "lucide-react";
import { api } from "./DiscordMailBotSettings";
import "./discord-community.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

// Same fields as communitySettings in backend/discord_community.go.
type NameStyle = "plain" | "frame" | "line" | "cute";

// The same examples as STYLE_LABELS in discord-community-bot/src/style.ts.
const NAME_STYLES: { value: NameStyle; label: string }[] = [
  { value: "frame", label: "กรอบ  『👋』ยินดีต้อนรับ · 『👑』𝐎𝐰𝐧𝐞𝐫" },
  { value: "line", label: "เส้นคั่น  ┊👋┊ยินดีต้อนรับ · ┊👑┊𝗢𝘄𝗻𝗲𝗿" },
  { value: "cute", label: "น่ารัก  ꒰👋꒱・ยินดีต้อนรับ · ꒰👑꒱ ᴏᴡɴᴇʀ" },
  { value: "plain", label: "เรียบ ๆ  👋・ยินดีต้อนรับ · 👑 Owner" },
];

type Settings = {
  guildId: string;
  nameStyle: NameStyle;
  nameEmoji: boolean;
  welcomeEnabled: boolean;
  welcomeChannelId: string;
  welcomeMessage: string;
  welcomeImage: boolean;
  roleCheckEnabled: boolean;
  roleCheckChannelId: string;
  leaveEnabled: boolean;
  leaveChannelId: string;
  leaveMessage: string;
  leaveImage: boolean;
  verifyEnabled: boolean;
  verifyChannelId: string;
  verifyMessage: string;
  memberRoleId: string;
  managerRoleIds: string[];
  staffRoleIds: string[];
  usageRoleIds: string[];
  ticketsEnabled: boolean;
  ticketChannelId: string;
  ticketCategoryId: string;
  ticketLogChannelId: string;
  ticketMessage: string;
  ticketMaxOpen: number;
  tempVoiceEnabled: boolean;
  tempHubChannelId: string;
  tempNameTemplate: string;
  statsEnabled: boolean;
  statsCategoryId: string;
  statsMembersChannelId: string;
  statsOnlineChannelId: string;
  statsSiteChannelId: string;
  statusEnabled: boolean;
  statusChannelId: string;
  statusMentionRoleId: string;
  statusImage: boolean;
  boostEnabled: boolean;
  boostChannelId: string;
  boostLoungeChannelId: string;
  boostPerks: string;
  securityEnabled: boolean;
  securityChannelId: string;
  securitySiteEvents: boolean;
  antiNukeEnabled: boolean;
  antiSpamEnabled: boolean;
  newAccountDays: number;
};

type Channel = { id: string; name: string; type: string; parentId: string; position: number };
type Role = { id: string; name: string; color: number; position: number; assignable: boolean };
type Guild = {
  guildId: string; guildName: string; memberCount: number; channels: Channel[]; roles: Role[];
  appliedVersion: number; problems: string[]; updatedAt: string;
};
type TicketItem = {
  id: number; guildId: string; channelId: string; openerName: string; openerId: string; subject: string; status: "open" | "closed";
  claimedByName: string; closedByName: string; closeReason: string; messageCount: number; createdAt: string; closedAt: string | null;
};
type Incident = { id: number; target: "web" | "api"; startedAt: string; endedAt: string; detail: string };
type Data = { settings: Settings; version: number; guild: Guild | null; tickets: TicketItem[]; openTickets: number; incidents: Incident[] };

type ChannelKind = "text" | "voice" | "category";

const KIND_TYPES: Record<ChannelKind, string[]> = { text: ["text", "announcement"], voice: ["voice", "stage"], category: ["category"] };

function ago(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีก่อน`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงก่อน`;
  return `${Math.round(hours / 24)} วันก่อน`;
}

function duration(from: string, to: string) {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

const roleColor = (color: number) => (color ? `#${color.toString(16).padStart(6, "0")}` : "var(--theme-text-soft)");

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

/** A channel from the list the bot sent, grouped under its category. */
function ChannelPicker({ id, label, hint, kind, value, onChange, guild, disabled }: {
  id: string; label: string; hint?: string; kind: ChannelKind; value: string; onChange: (value: string) => void; guild: Guild | null; disabled: boolean;
}) {
  const groups = useMemo(() => {
    const channels = guild?.channels ?? [];
    const wanted = channels.filter((channel) => KIND_TYPES[kind].includes(channel.type)).sort((a, b) => a.position - b.position);
    if (kind === "category") return [{ name: "", items: wanted }];
    const categories = channels.filter((channel) => channel.type === "category").sort((a, b) => a.position - b.position);
    return [
      { name: "ไม่มีหมวด", items: wanted.filter((channel) => !channel.parentId) },
      ...categories.map((category) => ({ name: category.name, items: wanted.filter((channel) => channel.parentId === category.id) })),
    ].filter((group) => group.items.length > 0);
  }, [guild, kind]);
  const known = !value || Boolean(guild?.channels.some((channel) => channel.id === value));
  const prefix = kind === "text" ? "# " : kind === "voice" ? "🔊 " : "";
  return (
    <div className="hv-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="hv-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !guild}>
        <option value="">— ไม่ตั้ง —</option>
        {!known && <option value={value}>ไม่พบห้องนี้ ({value})</option>}
        {groups.map((group) => group.name ? (
          <optgroup key={group.name} label={group.name}>
            {group.items.map((channel) => <option key={channel.id} value={channel.id}>{prefix}{channel.name}</option>)}
          </optgroup>
        ) : group.items.map((channel) => <option key={channel.id} value={channel.id}>{prefix}{channel.name}</option>))}
      </select>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function RolePicker({ id, label, hint, value, onChange, guild, disabled, giveable }: {
  id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; guild: Guild | null; disabled: boolean; giveable?: boolean;
}) {
  const roles = guild?.roles ?? [];
  const known = !value || roles.some((role) => role.id === value);
  const picked = roles.find((role) => role.id === value);
  return (
    <div className="hv-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="hv-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !guild}>
        <option value="">— ไม่ตั้ง —</option>
        {!known && <option value={value}>ไม่พบยศนี้ ({value})</option>}
        {roles.map((role) => (
          <option key={role.id} value={role.id} disabled={giveable && !role.assignable}>
            @{role.name}{giveable && !role.assignable ? " (สูงกว่ายศบอท)" : ""}
          </option>
        ))}
      </select>
      {giveable && picked && !picked.assignable ? <small className="cmb-warn">บอทให้ยศนี้ไม่ได้ ลากยศของบอทให้อยู่เหนือยศนี้ในตั้งค่าเซิร์ฟ</small> : hint && <small>{hint}</small>}
    </div>
  );
}

/** Several roles as chips; the select below adds one more. */
function RolesPicker({ id, label, hint, value, onChange, guild, disabled, max, giveable }: {
  id: string; label: string; hint: string; value: string[]; onChange: (value: string[]) => void; guild: Guild | null; disabled: boolean; max: number; giveable?: boolean;
}) {
  const roles = guild?.roles ?? [];
  const byId = new Map(roles.map((role) => [role.id, role]));
  const left = roles.filter((role) => !value.includes(role.id) && (!giveable || role.assignable));
  return (
    <div className="hv-field">
      <div className="hv-field-row">
        <label htmlFor={id}>{label}</label>
        <small>{value.length}/{max}</small>
      </div>
      {value.length > 0 && (
        <div className="cmb-chips">
          {value.map((roleId) => {
            const role = byId.get(roleId);
            return (
              <span className={`dpr-tag cmb-chip${role && (!giveable || role.assignable) ? "" : " is-warn"}`} key={roleId}>
                <i style={{ background: roleColor(role?.color ?? 0) }} aria-hidden="true" />
                @{role?.name ?? `ไม่พบยศ ${roleId}`}
                <button type="button" onClick={() => onChange(value.filter((item) => item !== roleId))} disabled={disabled}
                  aria-label={`เอา ${role?.name ?? roleId} ออก`} title="เอาออก">
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <select id={id} className="hv-select" value="" onChange={(event) => event.target.value && onChange([...value, event.target.value])}
        disabled={disabled || !guild || value.length >= max}>
        <option value="">{value.length >= max ? "ครบจำนวนแล้ว" : "+ เพิ่มยศ"}</option>
        {left.map((role) => <option key={role.id} value={role.id}>@{role.name}</option>)}
      </select>
      <small>{hint}</small>
    </div>
  );
}

function TextBox({ id, label, hint, value, onChange, disabled, max = 1500 }: {
  id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; disabled: boolean; max?: number;
}) {
  return (
    <div className="hv-field">
      <div className="hv-field-row">
        <label htmlFor={id}>{label}</label>
        <small>{value.length}/{max}</small>
      </div>
      <textarea id={id} className="hv-textarea cmb-text" rows={3} maxLength={max} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** One feature: its switch (or title) on top, its settings below. */
function Feature({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="cmb-feature">
      {title}
      {children}
    </div>
  );
}

/**
 * The community bot (one server: welcome, verification, tickets, voice rooms, stats,
 * boost room, site status). The same settings can be changed with /setup in Discord; the bot applies a save
 * within about 15 seconds and reports what it could not do.
 */
export function DiscordCommunity({ notify }: { notify: Notice }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback((resetForm: boolean) => {
    api<Data>("/api/admin/discord-community")
      .then((next) => {
        setData(next);
        if (resetForm) setForm(next.settings);
        setLoadError("");
      })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Until the bot has applied the latest save, check again every few seconds.
  const waiting = Boolean(data?.guild && data.guild.appliedVersion < data.version);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => load(false), 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const dirty = Boolean(form && data && JSON.stringify(form) !== JSON.stringify(data.settings));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    setBusy(true);
    try {
      const next = await api<Data>("/api/admin/discord-community", { method: "PUT", body: JSON.stringify({ ...form, version: data.version }) });
      setData(next);
      setForm(next.settings);
      notify({ kind: "success", text: "บันทึกแล้ว บอทจะใช้ค่าใหม่ภายใน 15 วินาที" });
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
            <p><strong>โหลดการตั้งค่าบอทดูแลเซิร์ฟไม่ได้</strong><span>{loadError}</span></p>
            <button type="button" onClick={() => load(true)}>ลองอีกครั้ง</button>
          </div>
        </div>
      </section>
    );
  }

  const guild = data?.guild ?? null;
  const loading = !form;
  const off = loading || busy;
  const set = (next: Partial<Settings>) => form && setForm({ ...form, ...next });

  return (
    <>
      <form className="aov-panel dbot-card dbot-wide" onSubmit={(event) => void save(event)} aria-busy={loading}>
        <header className="dbot-card-head">
          <span className="dbot-mark" aria-hidden="true"><Settings2 size={18} /></span>
          <div>
            <h2>ตั้งค่าบอทดูแลเซิร์ฟ</h2>
            <p>ค่าเดียวกับคำสั่ง /setup ใน Discord · ใช้ /setup แล้วกด สร้างที่ขาดให้ เพื่อให้บอทสร้างห้อง หมวด และยศที่ต้องใช้</p>
          </div>
        </header>
        {form && (
          <div className="dbot-body">
            <div className="cmb-server">
              <div className="cmb-server-fields">
                <div className="hv-field">
                  <label htmlFor="cmb-guild">Server ID</label>
                  <input id="cmb-guild" value={form.guildId || "1164629034248974418"} readOnly disabled />
                  <small>บอทนี้ล็อกไว้ที่เซิร์ฟนี้เซิร์ฟเดียว ถ้าถูกเชิญไปเซิร์ฟอื่นจะออกเอง</small>
                </div>
                <div className="hv-field">
                  <label htmlFor="cmb-style">สไตล์ชื่อห้องและยศ</label>
                  <select id="cmb-style" className="hv-select" value={form.nameStyle} onChange={(event) => set({ nameStyle: event.target.value as NameStyle })} disabled={off}>
                    {NAME_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                  </select>
                  <small>ใช้กับห้อง หมวด และยศที่บอทสร้าง · เปลี่ยนชื่อห้องและยศที่มีอยู่ด้วยปุ่ม 🎨 แต่งชื่อ ใน /setup</small>
                  <Switch label="ใส่อีโมจิในชื่อ" hint="ปิด = กรอบกับอักษรพิเศษอย่างเดียว ไม่มีอีโมจิ" on={form.nameEmoji} onChange={(on) => set({ nameEmoji: on })} disabled={off} />
                </div>
              </div>
              <div className={`cmb-guild${guild?.problems.length ? " is-warn" : ""}`} role="status">
                <span className="dpr-dot" aria-hidden="true">{guild && !guild.problems.length ? <CircleCheck size={16} /> : <CircleAlert size={16} />}</span>
                <div>
                  {guild ? (
                    <>
                      <b>{guild.guildName || guild.guildId}</b>
                      <small>
                        {guild.memberCount.toLocaleString("th-TH")} สมาชิก · {guild.channels.length} ห้อง · {guild.roles.length} ยศ · รายงานล่าสุด {ago(guild.updatedAt)}
                      </small>
                      <small>{waiting ? "บอทกำลังใช้ค่าใหม่..." : guild.problems.length ? "ใช้งานได้บางส่วน" : "ใช้งานได้ครบ"}</small>
                      {guild.problems.map((problem) => <small key={problem} className="dpr-problem">{problem}</small>)}
                    </>
                  ) : (
                    <>
                      <b>ยังไม่มีข้อมูลเซิร์ฟ</b>
                      <small>ใส่ token ของบอทในการ์ดด้านบน แล้วเชิญบอทเข้าเซิร์ฟ รายชื่อห้องและยศจะขึ้นให้เลือกที่นี่</small>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="cmb-body">
              <div className="dpr-col">
                <Feature title={<Switch label="ต้อนรับสมาชิกใหม่" hint="ส่งข้อความเมื่อมีคนเข้าเซิร์ฟ" on={form.welcomeEnabled} onChange={(on) => set({ welcomeEnabled: on })} disabled={off} />}>
                  <ChannelPicker id="cmb-welcome" label="ห้องต้อนรับ" kind="text" value={form.welcomeChannelId} onChange={(welcomeChannelId) => set({ welcomeChannelId })} guild={guild} disabled={off || !form.welcomeEnabled} />
                  <TextBox id="cmb-welcome-text" label="ข้อความต้อนรับ" value={form.welcomeMessage} onChange={(welcomeMessage) => set({ welcomeMessage })} disabled={off || !form.welcomeEnabled}
                    hint="{user} = แท็กคนเข้า · {name} = ชื่อ · {server} = ชื่อเซิร์ฟ · {count} = ลำดับสมาชิก" />
                  <Switch label="ภาพต้อนรับ" hint="แนบการ์ดต้อนรับพร้อมรูปโปรไฟล์ ชื่อ และลำดับสมาชิก" on={form.welcomeImage} onChange={(on) => set({ welcomeImage: on })} disabled={off || !form.welcomeEnabled} />
                </Feature>

                <Feature title={<Switch label="ห้องเช็คยศ" hint="แผงปุ่มเช็คยศของฉัน กดแล้วเห็นยศของตัวเองคนเดียว ดูยศของคนอื่นไม่ได้" on={form.roleCheckEnabled} onChange={(on) => set({ roleCheckEnabled: on })} disabled={off} />}>
                  <ChannelPicker id="cmb-rolecheck" label="ห้องเช็คยศ" kind="text" value={form.roleCheckChannelId} onChange={(roleCheckChannelId) => set({ roleCheckChannelId })} guild={guild} disabled={off || !form.roleCheckEnabled}
                    hint="ไม่มีห้อง? กด สร้างที่ขาดให้ ใน /setup บอทจะสร้างห้อง ROLES" />
                </Feature>

                <Feature title={<Switch label="แจ้งคนออก" hint="ส่งข้อความลาก่อนในห้องคนออกเมื่อมีคนออกจากเซิร์ฟ" on={form.leaveEnabled} onChange={(on) => set({ leaveEnabled: on })} disabled={off} />}>
                  <ChannelPicker id="cmb-leave" label="ห้องคนออก" kind="text" value={form.leaveChannelId} onChange={(leaveChannelId) => set({ leaveChannelId })} guild={guild} disabled={off || !form.leaveEnabled} />
                  <TextBox id="cmb-leave-text" label="ข้อความคนออก" value={form.leaveMessage} onChange={(leaveMessage) => set({ leaveMessage })} disabled={off || !form.leaveEnabled}
                    hint="{name} = ชื่อ · {server} = ชื่อเซิร์ฟ · {count} = จำนวนสมาชิกที่เหลือ" />
                  <Switch label="ภาพคนออก" hint="แนบการ์ดลาก่อนพร้อมรูปโปรไฟล์ (ขาวดำ) และจำนวนวันที่อยู่ด้วยกัน" on={form.leaveImage} onChange={(on) => set({ leaveImage: on })} disabled={off || !form.leaveEnabled} />
                </Feature>

                <Feature title={<Switch label="ยืนยันตัวตน" hint="กดปุ่มแล้วได้ยศสมาชิก (ปิด = ได้ยศสมาชิกทันทีที่เข้า)" on={form.verifyEnabled} onChange={(on) => set({ verifyEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-verify" label="ห้องยืนยันตัวตน" kind="text" value={form.verifyChannelId} onChange={(verifyChannelId) => set({ verifyChannelId })} guild={guild} disabled={off || !form.verifyEnabled} />
                    <RolePicker id="cmb-member" label="ยศสมาชิก" value={form.memberRoleId} onChange={(memberRoleId) => set({ memberRoleId })} guild={guild} disabled={off} giveable />
                  </div>
                  <TextBox id="cmb-verify-text" label="ข้อความแผงยืนยันตัวตน" value={form.verifyMessage} onChange={(verifyMessage) => set({ verifyMessage })} disabled={off || !form.verifyEnabled} />
                </Feature>

                <Feature title={<Switch label="ห้องบูสต์" hint="แผงบอกเลเวลและแถบความคืบหน้าบูสต์ สิทธิประโยชน์ และรายชื่อบูสเตอร์ (อัปเดตเอง) · มีห้องคุยเฉพาะคนบูสต์" on={form.boostEnabled} onChange={(on) => set({ boostEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-boost" label="ห้องแผงบูสต์" kind="text" value={form.boostChannelId} onChange={(boostChannelId) => set({ boostChannelId })} guild={guild} disabled={off || !form.boostEnabled} />
                    <ChannelPicker id="cmb-boost-lounge" label="ห้องบูสเตอร์" kind="text" value={form.boostLoungeChannelId} onChange={(boostLoungeChannelId) => set({ boostLoungeChannelId })} guild={guild} disabled={off || !form.boostEnabled}
                      hint="เห็นเฉพาะคนที่มียศ Server Booster และทีมงาน" />
                  </div>
                  <TextBox id="cmb-boost-perks" label="สิทธิประโยชน์ของบูสเตอร์" value={form.boostPerks} onChange={(boostPerks) => set({ boostPerks })} disabled={off || !form.boostEnabled}
                    hint="เขียนเป็นบรรทัด ๆ แสดงในแผงบูสต์" />
                </Feature>
              </div>

              <div className="dpr-col">
                <Feature title={<Switch label="Ticket" hint="ปุ่มเปิดห้องคุยส่วนตัวกับทีมงาน ปิดแล้วส่งประวัติไปห้อง log" on={form.ticketsEnabled} onChange={(on) => set({ ticketsEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-ticket" label="ห้องปุ่มเปิด Ticket" kind="text" value={form.ticketChannelId} onChange={(ticketChannelId) => set({ ticketChannelId })} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <ChannelPicker id="cmb-ticket-cat" label="หมวดที่สร้างห้อง Ticket" kind="category" value={form.ticketCategoryId} onChange={(ticketCategoryId) => set({ ticketCategoryId })} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <ChannelPicker id="cmb-ticket-log" label="ห้อง log Ticket" kind="text" value={form.ticketLogChannelId} onChange={(ticketLogChannelId) => set({ ticketLogChannelId })} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <div className="hv-field">
                      <label htmlFor="cmb-ticket-max">เปิดค้างได้ต่อคน</label>
                      <input id="cmb-ticket-max" type="number" inputMode="numeric" min={1} max={5} value={form.ticketMaxOpen}
                        onChange={(event) => set({ ticketMaxOpen: Number(event.target.value) })} disabled={off || !form.ticketsEnabled} />
                    </div>
                  </div>
                  <RolesPicker id="cmb-staff" label="ยศทีมงาน" hint="เห็นทุก Ticket รับเรื่อง ปิด และเพิ่มคนเข้าห้องได้" value={form.staffRoleIds} onChange={(staffRoleIds) => set({ staffRoleIds })} guild={guild} disabled={off || !form.ticketsEnabled} max={10} />
                  <TextBox id="cmb-ticket-text" label="ข้อความแผง Ticket" value={form.ticketMessage} onChange={(ticketMessage) => set({ ticketMessage })} disabled={off || !form.ticketsEnabled} />
                </Feature>

                <Feature title={<Switch label="ห้องเสียงชั่วคราว" hint="เข้าห้อง ➕ แล้วได้ห้องเสียงของตัวเอง ห้องว่างแล้วลบเอง" on={form.tempVoiceEnabled} onChange={(on) => set({ tempVoiceEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-hub" label="ห้อง ➕ สร้างห้องเสียง" kind="voice" value={form.tempHubChannelId} onChange={(tempHubChannelId) => set({ tempHubChannelId })} guild={guild} disabled={off || !form.tempVoiceEnabled} />
                    <div className="hv-field">
                      <label htmlFor="cmb-temp-name">ชื่อห้องที่สร้าง</label>
                      <input id="cmb-temp-name" maxLength={60} value={form.tempNameTemplate} onChange={(event) => set({ tempNameTemplate: event.target.value })} disabled={off || !form.tempVoiceEnabled} />
                      <small>{"{user}"} = ชื่อเจ้าของห้อง</small>
                    </div>
                  </div>
                </Feature>

                <Feature title={<Switch label="ห้องสถิติ" hint="ชื่อห้องเสียงบอกจำนวนสมาชิก คนออนไลน์ และสถานะเว็บ (อัปเดตทุก 5–10 นาที)" on={form.statsEnabled} onChange={(on) => set({ statsEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-stats-members" label="ห้องจำนวนสมาชิก" kind="voice" value={form.statsMembersChannelId} onChange={(statsMembersChannelId) => set({ statsMembersChannelId })} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cmb-stats-online" label="ห้องคนออนไลน์" kind="voice" value={form.statsOnlineChannelId} onChange={(statsOnlineChannelId) => set({ statsOnlineChannelId })} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cmb-stats-site" label="ห้องสถานะเว็บ" kind="voice" value={form.statsSiteChannelId} onChange={(statsSiteChannelId) => set({ statsSiteChannelId })} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cmb-stats-cat" label="หมวดสถิติ" kind="category" value={form.statsCategoryId} onChange={(statsCategoryId) => set({ statsCategoryId })} guild={guild} disabled={off || !form.statsEnabled} />
                  </div>
                </Feature>

                <Feature title={<Switch label="แจ้งเว็บล่ม" hint="เช็กเว็บและ API ทุก 30 วินาที (ภาพสถานะอัปเดตทุกครั้ง) ล่มติดกัน 2 ครั้งจึงแจ้ง และแจ้งอีกครั้งเมื่อกลับมา" on={form.statusEnabled} onChange={(on) => set({ statusEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-status" label="ห้องแจ้งสถานะ" kind="text" value={form.statusChannelId} onChange={(statusChannelId) => set({ statusChannelId })} guild={guild} disabled={off || !form.statusEnabled} />
                    <RolePicker id="cmb-status-role" label="แท็กยศตอนล่ม" hint="ไม่ตั้ง = ไม่แท็กใคร · ยศต้องเปิดให้ @mention ได้" value={form.statusMentionRoleId} onChange={(statusMentionRoleId) => set({ statusMentionRoleId })} guild={guild} disabled={off || !form.statusEnabled} />
                  </div>
                  <Switch label="ภาพสถานะระบบ" hint="ภาพสถานะเว็บ API และบอท พร้อมเวลาตอบสนองและ uptime อัปเดตเองในห้องแจ้งสถานะ" on={form.statusImage} onChange={(on) => set({ statusImage: on })} disabled={off || !form.statusEnabled} />
                </Feature>
              </div>

              <div className="cmb-wide">
                <Feature title={<Switch label="แจ้งเตือนความปลอดภัย" hint="ห้องที่เห็นเฉพาะทีมงาน: ใครเตะ แบน ลบห้อง/ยศ ให้ยศสิทธิ์สูง เชิญบอทหรือสร้าง webhook และบัญชีเพิ่งสร้างที่เข้าเซิร์ฟ" on={form.securityEnabled} onChange={(on) => set({ securityEnabled: on })} disabled={off} />}>
                  <div className="dbot-fields">
                    <ChannelPicker id="cmb-security" label="ห้องแจ้งเตือนความปลอดภัย" kind="text" value={form.securityChannelId} onChange={(securityChannelId) => set({ securityChannelId })} guild={guild} disabled={off || !form.securityEnabled}
                      hint="ไม่มีห้อง? กด สร้างที่ขาดให้ ใน /setup บอทจะสร้างห้อง แจ้งเตือนความปลอดภัย ในหมวดทีมงาน" />
                    <div className="hv-field">
                      <label htmlFor="cmb-new-days">บัญชีใหม่ = อายุน้อยกว่า (วัน)</label>
                      <input id="cmb-new-days" type="number" inputMode="numeric" min={0} max={30} value={form.newAccountDays}
                        onChange={(event) => set({ newAccountDays: Number(event.target.value) })} disabled={off} />
                      <small>แจ้งเมื่อบัญชีที่อายุน้อยกว่านี้เข้าเซิร์ฟ และเตะออกตอนมีคนเข้ารัว · 0 = ไม่เช็ก</small>
                    </div>
                  </div>
                  <Switch label="เหตุการณ์ความปลอดภัยของเว็บ" hint="ส่งเหตุการณ์ที่ติ๊กไว้ใน Webhook ความปลอดภัยของเว็บ (ล็อกอิน เปลี่ยนรหัส ลบบัญชี ล็อกเว็บ ฯลฯ) เข้าห้องนี้ด้วย"
                    on={form.securitySiteEvents} onChange={(on) => set({ securitySiteEvents: on })} disabled={off || !form.securityEnabled} />
                  <Switch label="Anti-nuke" hint="ใครลบห้องหรือยศ 3 ครั้ง หรือเตะ/แบน 4 ครั้งภายใน 1 นาที ถูกถอดยศและพักการพิมพ์ 1 ชั่วโมง (บอทถูกเตะ) · เจ้าของเซิร์ฟไม่โดน"
                    on={form.antiNukeEnabled} onChange={(on) => set({ antiNukeEnabled: on })} disabled={off} />
                  <Switch label="กันสแปมและคนเข้ารัว" hint="ลบลิงก์เชิญเซิร์ฟอื่น แท็กเกิน 5 คน พิมพ์รัว/ซ้ำ แล้วพักการพิมพ์ · คนเข้า 8 คนใน 30 วินาทีเปิดโหมดกัน raid 10 นาที · ทีมงานไม่โดน"
                    on={form.antiSpamEnabled} onChange={(on) => set({ antiSpamEnabled: on })} disabled={off} />
                </Feature>
              </div>

              <div className="cmb-wide">
                <Feature title={<div className="cmb-title"><strong>สิทธิ์</strong><small>แอดมินเซิร์ฟ (Manage Server) ใช้ได้ทุกอย่างเสมอ</small></div>}>
                  <div className="dbot-fields">
                    <RolesPicker id="cmb-managers" label="ยศผู้ดูแลบอท" hint="ใช้ /setup และ /create ได้" value={form.managerRoleIds} onChange={(managerRoleIds) => set({ managerRoleIds })} guild={guild} disabled={off} max={10} />
                    <RolesPicker id="cmb-usage" label="ยศที่ใช้ Ticket และห้องเสียงชั่วคราวได้" hint="ไม่เลือก = ทุกคน" value={form.usageRoleIds} onChange={(usageRoleIds) => set({ usageRoleIds })} guild={guild} disabled={off} max={10} />
                  </div>
                </Feature>
              </div>
            </div>
          </div>
        )}
        <footer className="dbot-foot">
          <span className="dbot-state">{loading ? "กำลังโหลด..." : dirty ? "ยังไม่ได้บันทึก" : "ไม่มีอะไรเปลี่ยน"}</span>
          {dirty && <button type="button" className="hv-btn" onClick={() => data && setForm(data.settings)} disabled={busy}>ยกเลิก</button>}
          <button className="hv-btn hv-btn-primary" disabled={busy || loading || !dirty}>
            {busy && <span className="hv-spinner" aria-hidden="true" />}
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </footer>
      </form>

      <section className="aov-panel dbot-card" aria-busy={loading}>
        <header className="dbot-card-head">
          <span className="dbot-mark" aria-hidden="true"><Ticket size={18} /></span>
          <div>
            <h2>Ticket ล่าสุด <span className="dbot-count">{data?.openTickets ?? 0} เปิดอยู่</span></h2>
            <p>ประวัติการคุยของแต่ละ Ticket อยู่ในห้อง log ใน Discord</p>
          </div>
        </header>
        {!data?.tickets.length ? (
          <p className="dbot-empty">{loading ? "กำลังโหลด..." : "ยังไม่มี Ticket"}</p>
        ) : (
          <ul className="dbot-rooms">
            {data.tickets.map((ticket) => (
              <li key={ticket.id}>
                <span className={`cmb-badge${ticket.status === "open" ? " is-open" : ""}`}>{ticket.status === "open" ? "เปิด" : "ปิด"}</span>
                <div className="dbot-room-copy">
                  {ticket.status === "open" && ticket.channelId ? (
                    <a href={`https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`} target="_blank" rel="noreferrer">#{ticket.id} {ticket.subject}</a>
                  ) : <strong className="cmb-subject">#{ticket.id} {ticket.subject}</strong>}
                  <small>
                    @{ticket.openerName || ticket.openerId} · {ago(ticket.createdAt)}
                    {ticket.claimedByName && <> · รับเรื่องโดย @{ticket.claimedByName}</>}
                    {ticket.status === "closed" && <> · ปิด{ticket.closedByName ? `โดย @${ticket.closedByName}` : ""}{ticket.closeReason ? ` (${ticket.closeReason})` : ""}</>}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="aov-panel dbot-card" aria-busy={loading}>
        <header className="dbot-card-head">
          <span className="dbot-mark" aria-hidden="true"><Activity size={18} /></span>
          <div>
            <h2>ประวัติเว็บล่ม</h2>
            <p>บันทึกตอนที่บอทเห็นว่าเว็บหรือ API กลับมาแล้ว</p>
          </div>
        </header>
        {!data?.incidents.length ? (
          <p className="dbot-empty">{loading ? "กำลังโหลด..." : "ยังไม่เคยล่ม"}</p>
        ) : (
          <ul className="dbot-rooms">
            {data.incidents.map((incident) => (
              <li key={incident.id}>
                <span className="cmb-badge is-down">{incident.target === "web" ? "เว็บ" : "API"}</span>
                <div className="dbot-room-copy">
                  <strong className="cmb-subject">ล่ม {duration(incident.startedAt, incident.endedAt)}</strong>
                  <small>
                    {new Date(incident.startedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                    {incident.detail && <> · {incident.detail}</>}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="cmb-steps">
          <strong><ListChecks size={15} aria-hidden="true" /> เริ่มใช้บอทนี้</strong>
          <ol className="dbot-steps">
            <li>ใส่ token ของบอทในการ์ด บอทดูแลเซิร์ฟ ด้านบน</li>
            <li>ใน Discord Developer Portal หน้า Bot เปิด <b>Server Members Intent</b> และ <b>Message Content Intent</b></li>
            <li>เชิญบอทเข้าเซิร์ฟด้วยลิงก์เชิญในการ์ด แล้วลากยศของบอทขึ้นไปไว้บนสุด</li>
            <li>พิมพ์ /setup ในเซิร์ฟ แล้วกด สร้างที่ขาดให้</li>
          </ol>
        </div>
      </section>
    </>
  );
}
