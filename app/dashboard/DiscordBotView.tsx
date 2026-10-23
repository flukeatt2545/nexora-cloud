"use client";

import { Fragment, type KeyboardEvent, type ReactNode, useRef } from "react";
import { AudioLines, Bot, Check, CircleAlert, Eye, Gamepad2, Headphones, Mail, PenLine, RotateCcw, Save, Trophy, Users, type LucideIcon } from "lucide-react";
import { BotConnectionStrip, type BotConnectionState, useBotConnection } from "./DiscordBotConnection";
import { ACTIVITY_TEXT_MAX, type ActivityType, type BotKey, MailBotSelfServiceSettings, useBotPresence } from "./DiscordMailBotSettings";
import { DiscordCommunity } from "./DiscordCommunity";
import { DiscordProtect } from "./DiscordProtect";
import { DiscordVoiceMessages } from "./DiscordVoiceMessages";
import { DiscordVoiceRooms } from "./DiscordVoiceRooms";
import { DiscordVoiceSessions } from "./DiscordVoiceSessions";
import "./hosting-view.css";
import "./discord-mail-bot-settings.css";
import "./discord-bots-view.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

type BotExtra = { key: string; superadminOnly?: boolean; render: (notify: Notice) => ReactNode };
type BotConfig = {
  key: BotKey;
  name: string;
  description: string;
  icon: LucideIcon;
  /** The name the preview shows in the member list. */
  previewName: string;
  /** What the preview shows while the text box is empty. */
  defaultText: string;
  /** Settings only this bot has, shown under the cards. */
  extras: BotExtra[];
};

// Add a bot here and it gets a card (and its own settings group) with nothing else to change.
const BOTS: BotConfig[] = [
  {
    key: "nexora",
    name: "บอท NEXORA",
    description: "ฐานข้อมูลนักศึกษา อัปโหลดรูป และคำสั่งในห้อง",
    icon: Bot,
    previewName: "NEXORA",
    defaultText: "NEXORA",
    extras: [],
  },
  {
    key: "mail",
    name: "บอทเมล",
    description: "อ่านเมล สร้างเมล และแจ้งเมลใหม่ใน Discord",
    icon: Mail,
    previewName: "บอทเมล",
    defaultText: "เมลของคุณ",
    extras: [{ key: "self-service", render: (notify) => <MailBotSelfServiceSettings notify={notify} /> }],
  },
  {
    key: "voice",
    name: "บอทห้องเสียง",
    description: "ห้องเสียงแบบ Join to Create ห้องที่ต้องใส่รหัส และประวัติเข้าออก ใช้ได้ทุกเซิร์ฟเวอร์ที่บอทอยู่",
    icon: AudioLines,
    previewName: "บอทห้องเสียง",
    defaultText: "ห้องเสียง",
    extras: [
      { key: "rooms", superadminOnly: true, render: (notify) => <DiscordVoiceRooms notify={notify} /> },
      { key: "protect", superadminOnly: true, render: (notify) => <DiscordProtect notify={notify} /> },
      { key: "sessions", superadminOnly: true, render: () => <DiscordVoiceSessions /> },
      { key: "messages", superadminOnly: true, render: (notify) => <DiscordVoiceMessages notify={notify} /> },
    ],
  },
  {
    key: "community",
    name: "บอทดูแลเซิร์ฟ",
    description: "ต้อนรับ ยืนยันตัวตน เลือกยศ Ticket ห้องเสียงชั่วคราว ห้องสถิติ และแจ้งเว็บล่ม ในเซิร์ฟเดียวที่ตั้งไว้",
    icon: Users,
    previewName: "บอทดูแลเซิร์ฟ",
    defaultText: "เซิร์ฟเวอร์",
    extras: [{ key: "settings", superadminOnly: true, render: (notify) => <DiscordCommunity notify={notify} /> }],
  },
];

const ACTIVITY_TYPES: { value: ActivityType; label: string; icon: LucideIcon }[] = [
  { value: "playing", label: "กำลังเล่น", icon: Gamepad2 },
  { value: "watching", label: "กำลังดู", icon: Eye },
  { value: "listening", label: "กำลังฟัง", icon: Headphones },
  { value: "competing", label: "กำลังแข่ง", icon: Trophy },
  { value: "custom", label: "กำหนดเอง", icon: PenLine },
];

function activityOf(type: ActivityType) {
  return ACTIVITY_TYPES.find((item) => item.value === type) ?? ACTIVITY_TYPES[1];
}

export default function DiscordBotView({ notify, isSuperadmin }: { notify: Notice; isSuperadmin: boolean }) {
  const groups = BOTS
    .map((bot) => ({ bot, extras: bot.extras.filter((extra) => !extra.superadminOnly || isSuperadmin) }))
    .filter((group) => group.extras.length > 0);

  return (
    <div className="aov hv dbx">
      <header className="aov-head dbx-page-head">
        <div>
          <h1>บอท Discord</h1>
          <p className="aov-sub">
            ตั้งสถานะใต้ชื่อบอท{isSuperadmin ? " ดูการเชื่อมต่อ token" : ""} และการตั้งค่าของบอททั้ง {BOTS.length} ตัว
          </p>
        </div>
      </header>

      <section className="dbx-grid" aria-label="บอททั้งหมด">
        {BOTS.map((bot) => <BotCard key={bot.key} bot={bot} notify={notify} canManage={isSuperadmin} />)}
      </section>

      {groups.length > 0 && (
        <section className="dbx-extras" aria-labelledby="dbx-extras-title">
          <header className="dbx-section-head">
            <h2 id="dbx-extras-title">ตั้งค่าเฉพาะบอท</h2>
            <p>ความสามารถที่บอทแต่ละตัวมีไม่เหมือนกัน</p>
          </header>
          {groups.map(({ bot, extras }) => (
            <section key={bot.key} className="dbx-extra-group" aria-labelledby={`dbx-extra-${bot.key}`}>
              <h3 id={`dbx-extra-${bot.key}`}>
                <span className="dbx-extra-mark" aria-hidden="true"><bot.icon size={15} /></span>
                {bot.name}
              </h3>
              <div className="dbot-grid">
                {extras.map((extra) => <Fragment key={extra.key}>{extra.render(notify)}</Fragment>)}
              </div>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}

/** One bot: who it is and whether it is online, then the status under its name. */
function BotCard({ bot, notify, canManage }: { bot: BotConfig; notify: Notice; canManage: boolean }) {
  const presence = useBotPresence(bot.key, bot.defaultText, notify);
  const conn = useBotConnection(bot.key, canManage);
  const nameId = `dbx-${bot.key}-name`;
  const avatarUrl = conn.connection?.botAvatarUrl || "";

  return (
    <article className="aov-panel dbx-card" aria-labelledby={nameId}>
      <header className="dbx-head">
        <span className="dbx-mark" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <bot.icon size={20} />}
        </span>
        <div className="dbx-head-copy">
          <div className="dbx-title">
            <h2 id={nameId}>{bot.name}</h2>
            <StatusPill canManage={canManage} conn={conn} savedType={presence.saved?.activityType} />
          </div>
          <p>{bot.description}</p>
        </div>
      </header>

      {canManage && <BotConnectionStrip notify={notify} botKey={bot.key} botName={bot.name} conn={conn} />}

      <PresenceEditor bot={bot} presence={presence} avatarUrl={avatarUrl}
        online={canManage && conn.connection ? conn.status?.text === "ออนไลน์" : true} />
    </article>
  );
}

/** Superadmins see whether the bot is online; other admins see which status is set. */
function StatusPill({ canManage, conn, savedType }: { canManage: boolean; conn: BotConnectionState; savedType?: ActivityType }) {
  if (canManage) {
    if (conn.status) return <span className={`hv-status dbx-pill ${conn.status.tone}`}><i aria-hidden="true" />{conn.status.text}</span>;
    if (conn.loadError) return <span className="hv-status dbx-pill is-error"><i aria-hidden="true" />เช็กไม่ได้</span>;
    return <span className="hv-status dbx-pill is-loading"><i aria-hidden="true" />กำลังเช็ก</span>;
  }
  if (!savedType) return null;
  const activity = activityOf(savedType);
  return <span className="hv-status dbx-pill"><activity.icon size={13} aria-hidden="true" />{activity.label}</span>;
}

type Presence = ReturnType<typeof useBotPresence>;

function PresenceEditor({ bot, presence, avatarUrl, online }: { bot: BotConfig; presence: Presence; avatarUrl: string; online: boolean }) {
  const { form, setForm, loading, loadError, busy, dirty, valid, load, save, reset } = presence;
  const textId = `dbx-${bot.key}-text`;
  const length = form.activityText.length;
  const left = ACTIVITY_TEXT_MAX - length;
  const countTone = left <= 0 ? " is-max" : left <= 16 ? " is-warn" : "";
  const empty = !loading && form.activityText.trim().length === 0;

  if (loadError) {
    return (
      <div className="dbx-body">
        <div className="hv-callout is-error dbx-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p><strong>โหลดสถานะของบอทนี้ไม่ได้</strong><span>{loadError}</span></p>
        </div>
        <button type="button" className="hv-btn dbx-retry" onClick={load}>
          <RotateCcw size={16} aria-hidden="true" /> ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <form className="dbx-form" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <div className="dbx-body">
        <DiscordPreview name={bot.previewName} avatarUrl={avatarUrl} online={online} loading={loading}
          type={form.activityType} text={form.activityText.trim() || bot.defaultText} />

        {loading ? (
          <div className="dbx-skel" aria-hidden="true">
            <i className="aov-skel dbx-skel-label" />
            <i className="aov-skel dbx-skel-seg" />
            <i className="aov-skel dbx-skel-label" />
            <i className="aov-skel dbx-skel-input" />
          </div>
        ) : (
          <>
            <div className="hv-field">
              <span id={`${textId}-type`}>ประเภทสถานะ</span>
              <ActivitySegments labelledBy={`${textId}-type`} value={form.activityType} disabled={busy}
                onChange={(activityType) => setForm({ ...form, activityType })} />
            </div>
            <div className="hv-field dbx-text">
              <div className="hv-field-row">
                <label htmlFor={textId}>ข้อความ</label>
                <small id={`${textId}-count`} className={`dbx-count${countTone}`}>
                  {length}/{ACTIVITY_TEXT_MAX}
                  {left <= 16 && <span className="sr-only">{left <= 0 ? " ครบจำนวนแล้ว" : ` เหลือ ${left} ตัวอักษร`}</span>}
                </small>
              </div>
              <input
                id={textId}
                value={form.activityText}
                maxLength={ACTIVITY_TEXT_MAX}
                onChange={(event) => setForm({ ...form, activityText: event.target.value })}
                placeholder={bot.defaultText}
                required
                disabled={busy}
                aria-invalid={empty || undefined}
                aria-describedby={`${textId}-count${empty ? ` ${textId}-empty` : ""}`}
              />
              {empty && <small id={`${textId}-empty`} className="dbx-hint is-error">ใส่ข้อความก่อนบันทึก</small>}
            </div>
          </>
        )}
      </div>

      <footer className="dbx-foot">
        <span className={`dbx-dirty${dirty ? " is-dirty" : ""}`} role="status">
          {loading ? "กำลังโหลด..." : dirty ? <><i aria-hidden="true" />ยังไม่ได้บันทึก</> : <><Check size={14} aria-hidden="true" />บันทึกแล้ว</>}
        </span>
        <button type="button" className="hv-btn" onClick={reset} disabled={!dirty || busy}>
          <RotateCcw size={16} aria-hidden="true" /> คืนค่า
        </button>
        <button className="hv-btn hv-btn-primary" disabled={!dirty || !valid || busy || loading}>
          {busy ? <span className="hv-spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </footer>
    </form>
  );
}

/** A radio group drawn as segments: Tab enters it once, the arrow keys move between types. */
function ActivitySegments({ labelledBy, value, disabled, onChange }: {
  labelledBy: string;
  value: ActivityType;
  disabled: boolean;
  onChange: (value: ActivityType) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = ACTIVITY_TYPES.length - 1;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    onChange(ACTIVITY_TYPES[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div className="dbx-seg" role="radiogroup" aria-labelledby={labelledBy}>
      {ACTIVITY_TYPES.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { buttons.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={checked ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            disabled={disabled}
          >
            <option.icon size={18} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** How the bot looks in a server's member list, in Discord's own dark colours. */
function DiscordPreview({ name, avatarUrl, online, loading, type, text }: {
  name: string;
  avatarUrl: string;
  online: boolean;
  loading: boolean;
  type: ActivityType;
  text: string;
}) {
  const activity = activityOf(type);
  return (
    <figure className="dbx-dc">
      <figcaption>ตัวอย่างใน Discord</figcaption>
      <div className="dbx-dc-list">
        <p className="dbx-dc-group" aria-hidden="true">{online ? "ออนไลน์" : "ออฟไลน์"} — 1</p>
        <div className={`dbx-dc-member${online ? "" : " is-offline"}`}>
          <span className="dbx-dc-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
            <i />
          </span>
          <span className="dbx-dc-copy">
            <span className="dbx-dc-name">
              <b>{name}</b>
              <em><Check size={10} strokeWidth={3.5} aria-hidden="true" />BOT</em>
            </span>
            <span className="dbx-dc-activity" aria-live="polite">
              {loading ? <i className="aov-skel" aria-hidden="true" />
                : type === "custom" ? text
                : <>{activity.label} <b>{text}</b></>}
            </span>
          </span>
        </div>
      </div>
    </figure>
  );
}
