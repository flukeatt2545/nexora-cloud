"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, CircleAlert, CircleCheck, DoorOpen, Gem, Hash, LogOut, Megaphone, Palette, Server, ShieldAlert, ShieldCheck, Siren, Ticket, UserCheck, UserCog, UserPlus, Volume2, X,
} from "lucide-react";
import { Card, Fields, LoadError, type Notice, Rows, SaveBar, SwitchRow, ago } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

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
  securitySiteChannelId: string;
  antiNukeEnabled: boolean;
  antiSpamEnabled: boolean;
  newAccountDays: number;
  nukeChannelLimit: number;
  nukeTrustedUserIds: string[];
  nukeTrustedRoleIds: string[];
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

/** The tab of the server settings to show; the page's menu picks it. */
export type CommunitySection = "general" | "members" | "rooms" | "security" | "history";

type Data = { settings: Settings; version: number; guild: Guild | null; tickets: TicketItem[]; openTickets: number; incidents: Incident[] };

type ChannelKind = "text" | "voice" | "category";

const KIND_TYPES: Record<ChannelKind, string[]> = { text: ["text", "announcement"], voice: ["voice", "stage"], category: ["category"] };

function duration(from: string, to: string) {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

const roleColor = (color: number) => (color ? `#${color.toString(16).padStart(6, "0")}` : "var(--theme-text-soft)");

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
        <option value="">ยังไม่ตั้ง</option>
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
        <option value="">ยังไม่ตั้ง</option>
        {!known && <option value={value}>ไม่พบยศนี้ ({value})</option>}
        {roles.map((role) => (
          <option key={role.id} value={role.id} disabled={giveable && !role.assignable}>
            @{role.name}{giveable && !role.assignable ? " (สูงกว่ายศบอท)" : ""}
          </option>
        ))}
      </select>
      {giveable && picked && !picked.assignable ? <small className="bp-warn">บอทให้ยศนี้ไม่ได้ ลากยศของบอทให้อยู่เหนือยศนี้ในตั้งค่าเซิร์ฟ</small> : hint && <small>{hint}</small>}
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
        <div className="bp-chips">
          {value.map((roleId) => {
            const role = byId.get(roleId);
            return (
              <span className={`bp-chip${role && (!giveable || role.assignable) ? "" : " is-warn"}`} key={roleId}>
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

const DISCORD_ID = /^[0-9]{17,20}$/;

/** Discord user IDs, one per line (spaces and commas work too). Only valid IDs are saved. */
function IdsBox({ id, label, hint, value, onChange, disabled, max }: {
  id: string; label: string; hint: string; value: string[]; onChange: (value: string[]) => void; disabled: boolean; max: number;
}) {
  const [draft, setDraft] = useState(() => value.join("\n"));
  const wrong = draft.split(/[\s,;]+/).filter((word) => word && !DISCORD_ID.test(word));
  function edit(text: string) {
    setDraft(text);
    onChange([...new Set(text.split(/[\s,;]+/).filter((word) => DISCORD_ID.test(word)))].slice(0, max));
  }
  return (
    <div className="hv-field">
      <div className="hv-field-row">
        <label htmlFor={id}>{label}</label>
        <small>{value.length}/{max}</small>
      </div>
      <textarea id={id} className="hv-textarea" rows={3} inputMode="numeric" spellCheck={false} placeholder="123456789012345678"
        value={draft} onChange={(event) => edit(event.target.value)} disabled={disabled} />
      {wrong.length > 0
        ? <small className="bp-warn">ไม่ใช่ ID ที่ถูกต้อง เลยไม่ถูกบันทึก: {wrong.slice(0, 3).join(", ")}{wrong.length > 3 ? " ..." : ""}</small>
        : <small>{hint}</small>}
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
      <textarea id={id} className="hv-textarea bp-text" rows={3} maxLength={max} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

function NumberField({ id, label, hint, value, onChange, min, max, disabled }: {
  id: string; label: string; hint?: string; value: number; onChange: (value: number) => void; min: number; max: number; disabled: boolean;
}) {
  return (
    <div className="hv-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * The community bot's settings (welcome, verification, tickets, voice rooms, stats, boost, site
 * status, security). The page's menu picks which of five tabs shows; it is one form, so a change
 * made on one tab is saved together with the others. The same settings can be changed with /setup
 * in Discord; the bot applies a save within about 15 seconds and reports what it could not do.
 */
export function DiscordCommunity({ notify, section }: { notify: Notice; section: CommunitySection }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped when the form is reset, so the ID list shows the saved IDs again.
  const [resetCount, setResetCount] = useState(0);

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

  if (loadError) return <LoadError title="โหลดการตั้งค่าบอทไม่ได้" message={loadError} onRetry={() => load(true)} />;

  const guild = data?.guild ?? null;
  const loading = !form;
  const off = loading || busy;
  const set = (next: Partial<Settings>) => form && setForm({ ...form, ...next });
  const pick = (key: keyof Settings) => (value: string) => set({ [key]: value } as Partial<Settings>);

  return (
    <>
      <form className="bp-pane" hidden={section === "history"} onSubmit={(event) => void save(event)} aria-busy={loading}>
        {!form && <Card icon={Server} title="กำลังโหลด..." busy />}

        {form && (
          <>
            <div className="bp-pane" hidden={section !== "general"}>
              <Card icon={Server} title="เซิร์ฟที่บอทดูแล" text="บอทดูแลได้ทีละเซิร์ฟ">
                <div className="hv-field">
                  <label htmlFor="cm-guild">Server ID</label>
                  <input id="cm-guild" inputMode="numeric" maxLength={20} placeholder="1164629034248974418" value={form.guildId}
                    onChange={(event) => set({ guildId: event.target.value.replace(/[^0-9]/g, "") })} disabled={off} />
                  <small>เปลี่ยนที่นี่หรือใช้ /setup ก็ได้ บอทต้องถูกเชิญเข้าเซิร์ฟนั้นก่อน พอมีบอทในเซิร์ฟที่ตั้งไว้แล้ว บอทจะออกจากเซิร์ฟอื่นเอง</small>
                </div>
                <div className="bp-guild" role="status">
                  <span className={`bp-dot${guild?.problems.length || !guild ? " is-warn" : ""}`} aria-hidden="true">
                    {guild && !guild.problems.length ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
                  </span>
                  <div>
                    {guild ? (
                      <>
                        <b>{guild.guildName || guild.guildId}</b>
                        <small>{guild.memberCount.toLocaleString("th-TH")} สมาชิก, {guild.channels.length} ห้อง, {guild.roles.length} ยศ, บอทรายงานล่าสุด{ago(guild.updatedAt)}</small>
                        <small>{waiting ? "บอทกำลังใช้ค่าใหม่..." : guild.problems.length ? "ทำงานได้บางส่วน" : "ทำงานได้ครบ"}</small>
                        {guild.problems.map((problem) => <small key={problem} className="is-problem">{problem}</small>)}
                      </>
                    ) : (
                      <>
                        <b>ยังไม่มีข้อมูลเซิร์ฟ</b>
                        <small>ใส่ token แล้วเชิญบอทเข้าเซิร์ฟ รายชื่อห้องและยศจะขึ้นให้เลือกที่นี่</small>
                      </>
                    )}
                  </div>
                </div>
              </Card>

              <Card icon={Palette} title="ชื่อห้องและยศ" text="หน้าตาของชื่อที่บอทตั้งให้" flush>
                <Fields>
                  <div className="hv-field">
                    <label htmlFor="cm-style">สไตล์ชื่อ</label>
                    <select id="cm-style" className="hv-select" value={form.nameStyle} onChange={(event) => set({ nameStyle: event.target.value as NameStyle })} disabled={off}>
                      {NAME_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
                    </select>
                    <small>ใช้กับห้อง หมวด และยศที่บอทสร้าง ส่วนของที่มีอยู่แล้วจะเปลี่ยนชื่อตามเมื่อกด 🎨 แต่งชื่อ ใน /setup</small>
                  </div>
                </Fields>
                <Rows>
                  <SwitchRow title="ใส่อีโมจิในชื่อ" hint="ปิดแล้วเหลือแค่กรอบกับตัวอักษรพิเศษ" on={form.nameEmoji} onChange={(nameEmoji) => set({ nameEmoji })} disabled={off} />
                </Rows>
              </Card>

              <Card icon={UserCog} title="ใครตั้งค่าบอทได้" text="แอดมินที่มีสิทธิ์ Manage Server ใช้ได้ทุกอย่างอยู่แล้ว" flush>
                <Fields>
                  <RolesPicker id="cm-managers" label="ยศผู้ดูแลบอท" hint="ใช้ /setup และ /create ได้" value={form.managerRoleIds}
                    onChange={(managerRoleIds) => set({ managerRoleIds })} guild={guild} disabled={off} max={10} />
                  <RolesPicker id="cm-usage" label="ยศที่เปิด Ticket และสร้างห้องเสียงได้" hint="ไม่เลือกเลย = ทุกคนทำได้" value={form.usageRoleIds}
                    onChange={(usageRoleIds) => set({ usageRoleIds })} guild={guild} disabled={off} max={10} />
                </Fields>
              </Card>
            </div>

            <div className="bp-grid" hidden={section !== "members"}>
              <div className="bp-col">
                <Card icon={UserPlus} title="ต้อนรับคนใหม่" text="ส่งข้อความทักทายตอนมีคนเข้าเซิร์ฟ" flush
                  toggle={{ label: "ต้อนรับคนใหม่", on: form.welcomeEnabled, onChange: (welcomeEnabled) => set({ welcomeEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-welcome" label="ห้องต้อนรับ" kind="text" value={form.welcomeChannelId} onChange={pick("welcomeChannelId")} guild={guild} disabled={off || !form.welcomeEnabled} />
                    <TextBox id="cm-welcome-text" label="ข้อความ" value={form.welcomeMessage} onChange={pick("welcomeMessage")} disabled={off || !form.welcomeEnabled}
                      hint="ใส่ {user} แท็กคนเข้า, {name} ชื่อ, {server} ชื่อเซิร์ฟ, {count} ลำดับสมาชิก" />
                  </Fields>
                  <Rows>
                    <SwitchRow title="แนบภาพต้อนรับ" hint="การ์ดที่มีรูปโปรไฟล์ ชื่อ และลำดับสมาชิก" on={form.welcomeImage}
                      onChange={(welcomeImage) => set({ welcomeImage })} disabled={off || !form.welcomeEnabled} />
                  </Rows>
                </Card>

                <Card icon={LogOut} title="คนที่ออกจากเซิร์ฟ" text="ส่งข้อความลาก่อนตอนมีคนออก" flush
                  toggle={{ label: "แจ้งคนออก", on: form.leaveEnabled, onChange: (leaveEnabled) => set({ leaveEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-leave" label="ห้องคนออก" kind="text" value={form.leaveChannelId} onChange={pick("leaveChannelId")} guild={guild} disabled={off || !form.leaveEnabled} />
                    <TextBox id="cm-leave-text" label="ข้อความ" value={form.leaveMessage} onChange={pick("leaveMessage")} disabled={off || !form.leaveEnabled}
                      hint="ใส่ {name} ชื่อ, {server} ชื่อเซิร์ฟ, {count} จำนวนสมาชิกที่เหลือ" />
                  </Fields>
                  <Rows>
                    <SwitchRow title="แนบภาพลาก่อน" hint="การ์ดขาวดำ มีรูปโปรไฟล์และจำนวนวันที่อยู่ด้วยกัน" on={form.leaveImage}
                      onChange={(leaveImage) => set({ leaveImage })} disabled={off || !form.leaveEnabled} />
                  </Rows>
                </Card>
              </div>

              <div className="bp-col">
                <Card icon={UserCheck} title="ยืนยันตัวตน" text="กดปุ่มแล้วได้ยศสมาชิก ปิดไว้ก็ได้ยศทันทีที่เข้าเซิร์ฟ" flush
                  toggle={{ label: "ยืนยันตัวตน", on: form.verifyEnabled, onChange: (verifyEnabled) => set({ verifyEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-verify" label="ห้องยืนยันตัวตน" kind="text" value={form.verifyChannelId} onChange={pick("verifyChannelId")} guild={guild} disabled={off || !form.verifyEnabled} />
                    <RolePicker id="cm-member" label="ยศสมาชิก" value={form.memberRoleId} onChange={pick("memberRoleId")} guild={guild} disabled={off} giveable />
                  </Fields>
                  <Fields>
                    <TextBox id="cm-verify-text" label="ข้อความบนแผงยืนยัน" value={form.verifyMessage} onChange={pick("verifyMessage")} disabled={off || !form.verifyEnabled} />
                  </Fields>
                </Card>

                <Card icon={ShieldCheck} title="เช็กยศของตัวเอง" text="ปุ่มให้สมาชิกดูยศของตัวเอง ดูของคนอื่นไม่ได้" flush
                  toggle={{ label: "ห้องเช็กยศ", on: form.roleCheckEnabled, onChange: (roleCheckEnabled) => set({ roleCheckEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-rolecheck" label="ห้องเช็กยศ" kind="text" value={form.roleCheckChannelId} onChange={pick("roleCheckChannelId")} guild={guild} disabled={off || !form.roleCheckEnabled}
                      hint="ยังไม่มีห้อง? กด สร้างที่ขาดให้ ใน /setup บอทจะสร้างห้อง ROLES ให้" />
                  </Fields>
                </Card>
              </div>
            </div>

            <div className="bp-grid" hidden={section !== "rooms"}>
              <div className="bp-col">
                <Card icon={Ticket} title="Ticket" text="สมาชิกกดปุ่มเปิดห้องคุยส่วนตัวกับทีมงาน ปิดแล้วส่งประวัติไปห้อง log" flush
                  toggle={{ label: "Ticket", on: form.ticketsEnabled, onChange: (ticketsEnabled) => set({ ticketsEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-ticket" label="ห้องปุ่มเปิด Ticket" kind="text" value={form.ticketChannelId} onChange={pick("ticketChannelId")} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <ChannelPicker id="cm-ticket-cat" label="หมวดที่สร้างห้อง Ticket" kind="category" value={form.ticketCategoryId} onChange={pick("ticketCategoryId")} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <ChannelPicker id="cm-ticket-log" label="ห้อง log Ticket" kind="text" value={form.ticketLogChannelId} onChange={pick("ticketLogChannelId")} guild={guild} disabled={off || !form.ticketsEnabled} />
                    <NumberField id="cm-ticket-max" label="เปิดค้างได้ต่อคน" hint="ตั้ง 1 ถึง 5" value={form.ticketMaxOpen} onChange={(ticketMaxOpen) => set({ ticketMaxOpen })} min={1} max={5} disabled={off || !form.ticketsEnabled} />
                  </Fields>
                  <Fields>
                    <RolesPicker id="cm-staff" label="ยศทีมงาน" hint="เห็นทุก Ticket รับเรื่อง ปิด และเพิ่มคนเข้าห้องได้" value={form.staffRoleIds}
                      onChange={(staffRoleIds) => set({ staffRoleIds })} guild={guild} disabled={off || !form.ticketsEnabled} max={10} />
                    <TextBox id="cm-ticket-text" label="ข้อความบนปุ่มเปิด Ticket" value={form.ticketMessage} onChange={pick("ticketMessage")} disabled={off || !form.ticketsEnabled} />
                  </Fields>
                </Card>

                <Card icon={Volume2} title="ห้องเสียงชั่วคราว" text="เข้าห้อง ➕ แล้วได้ห้องเสียงของตัวเอง ห้องว่างแล้วลบเอง" flush
                  toggle={{ label: "ห้องเสียงชั่วคราว", on: form.tempVoiceEnabled, onChange: (tempVoiceEnabled) => set({ tempVoiceEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-hub" label="ห้อง ➕ สร้างห้องเสียง" kind="voice" value={form.tempHubChannelId} onChange={pick("tempHubChannelId")} guild={guild} disabled={off || !form.tempVoiceEnabled} />
                    <div className="hv-field">
                      <label htmlFor="cm-temp-name">ชื่อห้องที่สร้าง</label>
                      <input id="cm-temp-name" maxLength={60} value={form.tempNameTemplate} onChange={(event) => set({ tempNameTemplate: event.target.value })} disabled={off || !form.tempVoiceEnabled} />
                      <small>{"{user}"} คือชื่อเจ้าของห้อง</small>
                    </div>
                  </Fields>
                </Card>

                <Card icon={Activity} title="แจ้งเว็บล่ม" text="เช็กเว็บกับ API ทุก 30 วินาที แจ้งเมื่อล่มติดกัน 2 ครั้ง และแจ้งอีกทีตอนกลับมา" flush
                  toggle={{ label: "แจ้งเว็บล่ม", on: form.statusEnabled, onChange: (statusEnabled) => set({ statusEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-status" label="ห้องแจ้งสถานะ" kind="text" value={form.statusChannelId} onChange={pick("statusChannelId")} guild={guild} disabled={off || !form.statusEnabled} />
                    <RolePicker id="cm-status-role" label="ยศที่แท็กตอนล่ม" hint="ไม่เลือก = ไม่แท็กใคร ยศต้องเปิดให้ @mention ได้" value={form.statusMentionRoleId}
                      onChange={pick("statusMentionRoleId")} guild={guild} disabled={off || !form.statusEnabled} />
                  </Fields>
                  <Rows>
                    <SwitchRow title="ภาพสถานะ" hint="ภาพสถานะเว็บ API และบอท มีเวลาตอบสนองกับ uptime อัปเดตเองในห้องนี้" on={form.statusImage}
                      onChange={(statusImage) => set({ statusImage })} disabled={off || !form.statusEnabled} />
                  </Rows>
                </Card>
              </div>

              <div className="bp-col">
                <Card icon={Gem} title="ห้องบูสต์" text="แผงบอกเลเวล แถบความคืบหน้า สิทธิประโยชน์ และรายชื่อบูสเตอร์ อัปเดตเอง" flush
                  toggle={{ label: "ห้องบูสต์", on: form.boostEnabled, onChange: (boostEnabled) => set({ boostEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-boost" label="ห้องแผงบูสต์" kind="text" value={form.boostChannelId} onChange={pick("boostChannelId")} guild={guild} disabled={off || !form.boostEnabled} />
                    <ChannelPicker id="cm-boost-lounge" label="ห้องคุยของบูสเตอร์" kind="text" value={form.boostLoungeChannelId} onChange={pick("boostLoungeChannelId")} guild={guild} disabled={off || !form.boostEnabled}
                      hint="เห็นเฉพาะคนที่มียศ Server Booster และทีมงาน" />
                  </Fields>
                  <Fields>
                    <TextBox id="cm-boost-perks" label="สิทธิประโยชน์ของบูสเตอร์" value={form.boostPerks} onChange={pick("boostPerks")} disabled={off || !form.boostEnabled} hint="เขียนทีละบรรทัด" />
                  </Fields>
                </Card>

                <Card icon={Hash} title="ห้องสถิติ" text="ชื่อห้องเสียงบอกจำนวนสมาชิก คนออนไลน์ และสถานะเว็บ อัปเดตทุก 5 ถึง 10 นาที" flush
                  toggle={{ label: "ห้องสถิติ", on: form.statsEnabled, onChange: (statsEnabled) => set({ statsEnabled }), disabled: off }}>
                  <Fields>
                    <ChannelPicker id="cm-stats-members" label="ห้องจำนวนสมาชิก" kind="voice" value={form.statsMembersChannelId} onChange={pick("statsMembersChannelId")} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cm-stats-online" label="ห้องคนออนไลน์" kind="voice" value={form.statsOnlineChannelId} onChange={pick("statsOnlineChannelId")} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cm-stats-site" label="ห้องสถานะเว็บ" kind="voice" value={form.statsSiteChannelId} onChange={pick("statsSiteChannelId")} guild={guild} disabled={off || !form.statsEnabled} />
                    <ChannelPicker id="cm-stats-cat" label="หมวดสถิติ" kind="category" value={form.statsCategoryId} onChange={pick("statsCategoryId")} guild={guild} disabled={off || !form.statsEnabled} />
                  </Fields>
                </Card>
              </div>
            </div>

            <div className="bp-pane" hidden={section !== "security"}>
              <Card icon={Megaphone} title="ห้องแจ้งเตือน" text="เห็นเฉพาะทีมงาน: ใครเตะ แบน ลบห้องหรือยศ เชิญบอท สร้าง webhook และบัญชีใหม่ที่เข้าเซิร์ฟ" flush
                toggle={{ label: "แจ้งเตือนความปลอดภัย", on: form.securityEnabled, onChange: (securityEnabled) => set({ securityEnabled }), disabled: off }}>
                <Fields>
                  <ChannelPicker id="cm-security" label="ห้องแจ้งเรื่องใน Discord" kind="text" value={form.securityChannelId} onChange={pick("securityChannelId")} guild={guild} disabled={off || !form.securityEnabled}
                    hint="ไม่มีห้อง? กด สร้างที่ขาดให้ ใน /setup" />
                  <ChannelPicker id="cm-security-site" label="ห้องแจ้งเรื่องบนเว็บ" kind="text" value={form.securitySiteChannelId} onChange={pick("securitySiteChannelId")} guild={guild} disabled={off || !form.securityEnabled || !form.securitySiteEvents}
                    hint="เรื่องของเว็บไปห้องนี้ห้องเดียว ไม่ปนกับห้อง Discord ถ้ายังไม่ตั้ง บอทจะเก็บรอไว้ก่อน" />
                  <NumberField id="cm-new-days" label="บัญชีใหม่คืออายุน้อยกว่า (วัน)" hint="แจ้งเมื่อบัญชีแบบนี้เข้าเซิร์ฟ และเตะออกตอนมีคนเข้ารัว ใส่ 0 = ไม่เช็ก" value={form.newAccountDays}
                    onChange={(newAccountDays) => set({ newAccountDays })} min={0} max={30} disabled={off || !form.securityEnabled} />
                </Fields>
                <Rows>
                  <SwitchRow title="ส่งเรื่องของเว็บมาด้วย" hint="เหตุการณ์ที่ติ๊กไว้ใน Webhook ความปลอดภัยของเว็บ เช่น ล็อกอิน เปลี่ยนรหัส ลบบัญชี ล็อกเว็บ"
                    on={form.securitySiteEvents} onChange={(securitySiteEvents) => set({ securitySiteEvents })} disabled={off || !form.securityEnabled} />
                </Rows>
              </Card>

              <Card icon={ShieldAlert} title="กันคนลบห้อง" text="คนที่ลบห้อง ลบยศ เตะ หรือแบนรัวๆ ถูกถอดยศและพักการพิมพ์ 1 ชั่วโมง ถ้าเป็นบอทจะถูกเตะ เจ้าของเซิร์ฟไม่โดน" flush
                toggle={{ label: "กันคนลบห้อง", on: form.antiNukeEnabled, onChange: (antiNukeEnabled) => set({ antiNukeEnabled }), disabled: off }}>
                <Fields>
                  <NumberField id="cm-nuke-limit" label="ลบกี่ห้องใน 1 นาทีถึงถูกลงโทษ" value={form.nukeChannelLimit}
                    hint="ใส่ 1 = ห้องแรกที่ลบก็โดน ห้องเสียงชั่วคราวกับ Ticket ไม่นับ ลบยศ 3 ครั้ง เตะหรือแบน 4 ครั้งใน 1 นาทีก็โดนเหมือนกัน"
                    onChange={(nukeChannelLimit) => set({ nukeChannelLimit })} min={1} max={5} disabled={off || !form.antiNukeEnabled} />
                </Fields>
                <Fields>
                  <RolesPicker id="cm-trusted-roles" label="ยศที่ลบห้องได้" hint="ลบได้ ไม่ถูกลงโทษ และห้องไม่ถูกสร้างคืน เจ้าของเซิร์ฟ บอท และแอดมินของบอทลบได้อยู่แล้ว"
                    value={form.nukeTrustedRoleIds} onChange={(nukeTrustedRoleIds) => set({ nukeTrustedRoleIds })} guild={guild} disabled={off || !form.antiNukeEnabled} max={10} />
                  <IdsBox key={resetCount} id="cm-trusted-users" label="คนที่ลบห้องได้ (Discord ID)" max={20} value={form.nukeTrustedUserIds}
                    hint="ใส่ ID ทีละบรรทัด หรือพิมพ์ /protect trust ใน Discord"
                    onChange={(nukeTrustedUserIds) => set({ nukeTrustedUserIds })} disabled={off || !form.antiNukeEnabled} />
                </Fields>
                <Rows>
                  <div className="bp-row">
                    <div className="bp-row-copy">
                      <strong>ห้องที่ถูกลบ</strong>
                      <small>บอทสร้างคืนให้ทันที ใช้ชื่อ หมวด ตำแหน่ง และสิทธิ์เดิม แต่ข้อความเก่าในห้องกู้คืนไม่ได้ เปิดปิดการสร้างคืนได้ที่ ห้องเสียงมีรหัส &gt; ป้องกันเซิร์ฟ</small>
                    </div>
                  </div>
                </Rows>
              </Card>

              <Card icon={Siren} title="กันสแปมและคนเข้ารัว" text="ลบลิงก์เชิญเซิร์ฟอื่น แท็กเกิน 5 คน และข้อความที่พิมพ์รัวหรือซ้ำ แล้วพักการพิมพ์คนส่ง" flush
                toggle={{ label: "กันสแปมและคนเข้ารัว", on: form.antiSpamEnabled, onChange: (antiSpamEnabled) => set({ antiSpamEnabled }), disabled: off }}>
                <Rows>
                  <div className="bp-row">
                    <div className="bp-row-copy">
                      <small>ถ้ามีคนเข้า 8 คนใน 30 วินาที บอทเปิดโหมดกัน raid 10 นาทีและเตะบัญชีใหม่ที่เข้ามา ทีมงานไม่โดนกฎพวกนี้</small>
                    </div>
                  </div>
                </Rows>
              </Card>
            </div>

            <SaveBar dirty={dirty} busy={busy} onCancel={() => { if (data) { setForm(data.settings); setResetCount((count) => count + 1); } }} />
          </>
        )}
      </form>

      <div className="bp-pane" hidden={section !== "history"}>
        <Card icon={Ticket} title="Ticket ล่าสุด" text="ประวัติการคุยของแต่ละ Ticket อยู่ในห้อง log ใน Discord" flush busy={loading}
          aside={<span className="bp-count">{data?.openTickets ?? 0} เปิดอยู่</span>}>
          {!data?.tickets.length ? (
            <p className="bp-empty">{loading ? "กำลังโหลด..." : "ยังไม่มี Ticket"}</p>
          ) : (
            <ul className="bp-list">
              {data.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <span className={`bp-badge${ticket.status === "open" ? " is-open" : ""}`}>{ticket.status === "open" ? "เปิด" : "ปิด"}</span>
                  <div className="bp-item">
                    {ticket.status === "open" && ticket.channelId ? (
                      <a href={`https://discord.com/channels/${ticket.guildId}/${ticket.channelId}`} target="_blank" rel="noreferrer">#{ticket.id} {ticket.subject}</a>
                    ) : <strong>#{ticket.id} {ticket.subject}</strong>}
                    <small>
                      @{ticket.openerName || ticket.openerId}, {ago(ticket.createdAt)}
                      {ticket.claimedByName && <>, รับเรื่องโดย @{ticket.claimedByName}</>}
                      {ticket.status === "closed" && <>, ปิด{ticket.closedByName ? `โดย @${ticket.closedByName}` : ""}{ticket.closeReason ? ` (${ticket.closeReason})` : ""}</>}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card icon={DoorOpen} title="ช่วงที่เว็บล่ม" text="บันทึกไว้ตอนที่บอทเห็นว่าเว็บหรือ API กลับมาแล้ว" flush busy={loading}>
          {!data?.incidents.length ? (
            <p className="bp-empty">{loading ? "กำลังโหลด..." : "ยังไม่เคยล่ม"}</p>
          ) : (
            <ul className="bp-list">
              {data.incidents.map((incident) => (
                <li key={incident.id}>
                  <span className="bp-badge is-down">{incident.target === "web" ? "เว็บ" : "API"}</span>
                  <div className="bp-item">
                    <strong>ล่ม {duration(incident.startedAt, incident.endedAt)}</strong>
                    <small>
                      {new Date(incident.startedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                      {incident.detail && <>, {incident.detail}</>}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
