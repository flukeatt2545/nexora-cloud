"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  AudioLines, Bot, Check, ExternalLink, Eye, Gamepad2, Headphones, LayoutDashboard, Mail, PenLine, Radio, Trophy, Users, type LucideIcon,
} from "lucide-react";
import { type BotConnectionState, ConnectionActions, connectionFacts, useBotConnection } from "./DiscordBotConnection";
import { Card, LoadError, type Notice, SaveBar } from "./DiscordBotParts";
import { ACTIVITY_TEXT_MAX, type ActivityType, MailBotSelfServiceSettings, useBotPresence } from "./DiscordMailBotSettings";
import { DiscordCommunity, type CommunitySection } from "./DiscordCommunity";
import { DiscordProtect } from "./DiscordProtect";
import { DiscordVoiceMessages } from "./DiscordVoiceMessages";
import { DiscordVoiceRooms } from "./DiscordVoiceRooms";
import { DiscordVoiceSessions } from "./DiscordVoiceSessions";
import "./hosting-view.css";
import "./discord-bot-page.css";

// One bot does everything. The page has the bot on top (who it is, online or not, its token),
// a menu on the left with the parts of the bot, and the settings of the chosen part on the right.

const BOT = { key: "community" as const, name: "บอทดูแลเซิร์ฟ", defaultText: "เซิร์ฟเวอร์" };

type Part = { key: string; label: string; title: string; text: string; commands?: string[]; superadminOnly?: boolean };
type Group = { key: string; label: string | null; icon: LucideIcon; text: string; parts: Part[]; superadminOnly?: boolean };

const GROUPS: Group[] = [
  {
    key: "home", label: null, icon: LayoutDashboard, text: "",
    parts: [{ key: "overview", label: "ภาพรวม", title: "ภาพรวม", text: "สถานะของบอท และทางลัดไปแต่ละส่วน" }],
  },
  {
    key: "server", label: "ดูแลเซิร์ฟ", icon: Users, superadminOnly: true,
    text: "ต้อนรับคนใหม่ ยืนยันตัวตน Ticket ห้องสถิติ บูสต์ และกันคนทำลายเซิร์ฟ",
    parts: [
      { key: "server", label: "ทั่วไป", title: "ทั่วไป", text: "เซิร์ฟที่บอทดูแล หน้าตาของชื่อห้อง และคนที่ตั้งค่าบอทได้", commands: ["/setup", "/create", "/ticket", "/protect"] },
      { key: "server-members", label: "สมาชิก", title: "สมาชิก", text: "ข้อความต้อนรับ ข้อความตอนมีคนออก ยืนยันตัวตน และเช็กยศ" },
      { key: "server-rooms", label: "ห้องต่างๆ", title: "ห้องต่างๆ", text: "Ticket ห้องเสียงชั่วคราว แจ้งเว็บล่ม บูสต์ และห้องสถิติ" },
      { key: "server-security", label: "ความปลอดภัย", title: "ความปลอดภัย", text: "ห้องแจ้งเตือน กันคนลบห้อง และกันสแปม" },
      { key: "server-history", label: "ประวัติ", title: "ประวัติ", text: "Ticket ล่าสุด และช่วงที่เว็บล่ม" },
    ],
  },
  {
    key: "voice", label: "ห้องเสียงมีรหัส", icon: AudioLines, superadminOnly: true,
    text: "ห้องเสียงที่ตั้งรหัสล็อกได้ พร้อมประวัติคนเข้าออก",
    parts: [
      { key: "voice", label: "ห้องเสียง", title: "ห้องเสียง", text: "กติกาของห้อง และห้องที่เปิดอยู่ตอนนี้",
        commands: ["/room", "/setup-join-to-create", "/setup-room-log", "/setup-voice-log", "/voice-history", "/setup-stop", "/setup-room-panel"] },
      { key: "voice-protect", label: "ป้องกันเซิร์ฟ", title: "ป้องกันเซิร์ฟ", text: "กันลิงก์ สแปม และคำต้องห้ามในทุกเซิร์ฟที่บอทอยู่" },
      { key: "voice-history", label: "ประวัติเสียง", title: "ประวัติเสียง", text: "ใครอยู่ห้องไหน นานเท่าไร" },
      { key: "voice-messages", label: "ข้อความบอท", title: "ข้อความบอท", text: "แผงและข้อความที่บอทลงไว้ในห้อง" },
    ],
  },
  {
    key: "mail", label: "เมล", icon: Mail,
    text: "อ่านเมล เขียนเมล และรับแจ้งเมลใหม่ใน Discord ใช้ /mail ใน DM ได้",
    parts: [
      { key: "mail", label: "สร้างเมลเอง", title: "เมล", text: "อ่านเมล เขียนเมล และรับแจ้งเมลใหม่ใน Discord ใช้ /mail ใน DM ได้",
        commands: ["/mail", "/mail-admin", "/mail-bind", "/mail-unbind", "/setup-mail-panel", "/setup-mail-admin-panel"] },
    ],
  },
  {
    key: "nexora", label: "NEXORA", icon: Bot,
    text: "ฐานข้อมูลนักศึกษา อัปโหลดรูป แกลเลอรี และปุ่มล็อกเว็บฉุกเฉิน",
    parts: [
      { key: "nexora", label: "คำสั่ง", title: "NEXORA", text: "ฐานข้อมูลนักศึกษา อัปโหลดรูป แกลเลอรี และปุ่มล็อกเว็บฉุกเฉิน",
        commands: ["/db", "/code", "/upload", "/my-uploads", "/gallery", "/lockdown", "/crowdsec", "/bot-control", "/bot-panel", "/setup-panel", "/admin-map"] },
    ],
  },
];

const SERVER_PARTS: Record<string, CommunitySection> = {
  server: "general", "server-members": "members", "server-rooms": "rooms", "server-security": "security", "server-history": "history",
};

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
  const groups = GROUPS.filter((group) => !group.superadminOnly || isSuperadmin);
  const parts = groups.flatMap((group) => group.parts);
  const [active, setActive] = useState("overview");
  // A part is built the first time it is opened and then kept, so what is typed in it survives
  // a look at another part.
  const [opened, setOpened] = useState<string[]>(["overview"]);
  // The server settings are one form with five tabs; this is the tab it shows.
  const [serverPart, setServerPart] = useState("server");
  const presence = useBotPresence(BOT.key, BOT.defaultText, notify);
  const conn = useBotConnection(BOT.key, isSuperadmin);

  function show(key: string) {
    setActive(key);
    if (key in SERVER_PARTS) setServerPart(key);
    setOpened((list) => (list.includes(key) ? list : [...list, key]));
  }

  // A link like /admin/discord-bot#voice opens that part.
  useEffect(() => {
    const fromAddress = () => {
      const wanted = window.location.hash.slice(1);
      if (parts.some((part) => part.key === wanted)) show(wanted);
    };
    const timer = window.setTimeout(fromAddress, 0);
    window.addEventListener("hashchange", fromAddress);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", fromAddress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin]);

  function choose(key: string) {
    show(key);
    try {
      window.history.replaceState(null, "", key === "overview" ? window.location.pathname : `#${key}`);
    } catch {
      // The part still opens without the address.
    }
  }

  const part = parts.find((item) => item.key === active) ?? parts[0];
  const seen = (key: string) => opened.includes(key);
  const inServer = active in SERVER_PARTS;

  return (
    <div className="bp hv">
      <header className="bp-top">
        <h1>บอท Discord</h1>
        <p>บอทตัวเดียวดูแลเซิร์ฟ ห้องเสียง เมล และ NEXORA</p>
      </header>

      <Hero conn={conn} presence={presence} canManage={isSuperadmin} notify={notify} />

      <div className="bp-layout">
        <nav className="bp-rail" aria-label="ส่วนของบอท">
          {groups.map((group) => (
            <div className="bp-rail-group" key={group.key}>
              {group.label && <p className="bp-rail-label"><group.icon size={14} aria-hidden="true" />{group.label}</p>}
              {group.parts.map((item) => (
                <button key={item.key} type="button" className={`bp-nav${item.key === part.key ? " is-active" : ""}`}
                  aria-current={item.key === part.key ? "page" : undefined} onClick={() => choose(item.key)}>
                  {!group.label && <group.icon size={16} aria-hidden="true" />}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="bp-main" id="bp-main">
          <header className="bp-head">
            <div>
              <h2>{part.title}</h2>
              <p>{part.text}</p>
            </div>
            {part.commands && (
              <div className="bp-commands" aria-label="คำสั่งใน Discord">
                {part.commands.map((command) => <code key={command}>{command}</code>)}
              </div>
            )}
          </header>

          <div className="bp-pane" hidden={active !== "overview"}>
            <Overview presence={presence} groups={groups} canManage={isSuperadmin} onOpen={choose}
              avatarUrl={conn.connection?.botAvatarUrl || ""} online={isSuperadmin && conn.connection ? conn.status?.text === "ออนไลน์" : true} />
          </div>

          {isSuperadmin && (seen("server") || inServer) && (
            <div className="bp-pane" hidden={!inServer}>
              <DiscordCommunity notify={notify} section={SERVER_PARTS[serverPart] ?? "general"} />
            </div>
          )}

          {isSuperadmin && seen("voice") && <div className="bp-pane" hidden={active !== "voice"}><DiscordVoiceRooms notify={notify} /></div>}
          {isSuperadmin && seen("voice-protect") && <div className="bp-pane" hidden={active !== "voice-protect"}><DiscordProtect notify={notify} /></div>}
          {isSuperadmin && seen("voice-history") && <div className="bp-pane" hidden={active !== "voice-history"}><DiscordVoiceSessions /></div>}
          {isSuperadmin && seen("voice-messages") && <div className="bp-pane" hidden={active !== "voice-messages"}><DiscordVoiceMessages notify={notify} /></div>}

          {seen("mail") && <div className="bp-pane" hidden={active !== "mail"}><MailBotSelfServiceSettings notify={notify} /></div>}

          {seen("nexora") && (
            <div className="bp-pane" hidden={active !== "nexora"}>
              <Card icon={Bot} title="ตั้งค่าผ่านคำสั่งใน Discord" text="ส่วนนี้ไม่มีหน้าตั้งค่าบนเว็บ">
                <p className="bp-note">ตั้งสิทธิ์ใช้คำสั่งด้วย /bot-control หรือแผง /bot-panel ใน Discord ส่วนรูปที่สมาชิกอัปโหลดผ่านบอท ดูได้ที่หน้าประวัติอัปโหลด</p>
                <div><Link className="hv-btn" href="/admin/bot-uploads"><ExternalLink size={16} aria-hidden="true" /> ประวัติอัปโหลดจากบอท</Link></div>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** The bot itself: its picture, name, whether it is online, a few facts, and the token buttons. */
function Hero({ conn, presence, canManage, notify }: { conn: BotConnectionState; presence: Presence; canManage: boolean; notify: Notice }) {
  const avatarUrl = conn.connection?.botAvatarUrl || "";
  const facts = connectionFacts(conn);
  const saved = presence.saved;
  return (
    <section className="bp-hero" aria-labelledby="bp-bot-name">
      <span className="bp-hero-avatar" aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <Users size={26} />}
      </span>
      <div className="bp-hero-copy">
        <div className="bp-hero-name">
          <h2 id="bp-bot-name">{BOT.name}</h2>
          <StatusPill canManage={canManage} conn={conn} savedType={saved?.activityType} />
        </div>
        <ul className="bp-facts">
          {canManage ? (
            conn.loadError ? <li className="is-bad">โหลดสถานะไม่สำเร็จ: {conn.loadError}</li>
              : conn.connection ? facts.map((fact) => <li key={fact}>{fact}</li>)
              : <li><i className="aov-skel" aria-hidden="true" /><span className="sr-only">กำลังโหลดการเชื่อมต่อ</span></li>
          ) : saved ? (
            <li>ตอนนี้{activityOf(saved.activityType).label} {saved.activityType === "custom" ? saved.activityText : <b>{saved.activityText}</b>}</li>
          ) : null}
        </ul>
      </div>
      {canManage && <ConnectionActions notify={notify} botKey={BOT.key} botName={BOT.name} conn={conn} />}
    </section>
  );
}

/** Superadmins see whether the bot is online; other admins see which status is set. */
function StatusPill({ canManage, conn, savedType }: { canManage: boolean; conn: BotConnectionState; savedType?: ActivityType }) {
  if (canManage) {
    if (conn.status) return <span className={`hv-status bp-pill ${conn.status.tone}`}><i aria-hidden="true" />{conn.status.text}</span>;
    if (conn.loadError) return <span className="hv-status bp-pill is-error"><i aria-hidden="true" />เช็กไม่ได้</span>;
    return <span className="hv-status bp-pill is-loading"><i aria-hidden="true" />กำลังเช็ก</span>;
  }
  if (!savedType) return null;
  const activity = activityOf(savedType);
  return <span className="hv-status bp-pill"><activity.icon size={13} aria-hidden="true" />{activity.label}</span>;
}

type Presence = ReturnType<typeof useBotPresence>;

function Overview({ presence, groups, canManage, onOpen, avatarUrl, online }: {
  presence: Presence; groups: Group[]; canManage: boolean; onOpen: (key: string) => void; avatarUrl: string; online: boolean;
}) {
  return (
    <>
      <PresenceCard presence={presence} avatarUrl={avatarUrl} online={online} />

      <Card icon={Radio} title="ส่วนที่ตั้งค่าได้" text="เลือกส่วนที่อยากเข้าไปแก้" flush>
        <div className="bp-jumps">
          {groups.filter((group) => group.label).map((group) => (
            <button key={group.key} type="button" className="bp-jump" onClick={() => onOpen(group.parts[0].key)}>
              <span className="bp-icon" aria-hidden="true"><group.icon size={17} /></span>
              <span>
                <b>{group.label}</b>
                <small>{group.text}</small>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {canManage && (
        <Card icon={Check} title="ตั้งบอทครั้งแรก" text="ทำตามลำดับนี้ ครั้งเดียวก็พอ">
          <ol className="bp-steps">
            <li>ใส่ token ของบอทที่ปุ่มด้านบน</li>
            <li>ใน Discord Developer Portal หน้า Bot เปิด <b>Server Members Intent</b> กับ <b>Message Content Intent</b></li>
            <li>กด เชิญเข้าเซิร์ฟ แล้วลากยศของบอทขึ้นไปไว้บนสุดของเซิร์ฟ</li>
            <li>พิมพ์ /setup ในเซิร์ฟ แล้วกด สร้างที่ขาดให้</li>
          </ol>
        </Card>
      )}
    </>
  );
}

function PresenceCard({ presence, avatarUrl, online }: { presence: Presence; avatarUrl: string; online: boolean }) {
  const { form, setForm, loading, loadError, busy, dirty, valid, load, save, reset } = presence;
  const textId = "bp-presence-text";
  const length = form.activityText.length;
  const left = ACTIVITY_TEXT_MAX - length;
  const countTone = left <= 0 ? " is-max" : left <= 16 ? " is-warn" : "";
  const empty = !loading && form.activityText.trim().length === 0;

  if (loadError) {
    return (
      <Card icon={Radio} title="สถานะใต้ชื่อบอท" text="ข้อความเล็กๆ ที่โชว์ใต้ชื่อบอทในรายชื่อสมาชิก">
        <LoadError title="โหลดสถานะของบอทไม่ได้" message={loadError} onRetry={load} />
      </Card>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="bp-pane" aria-busy={loading}>
      <Card icon={Radio} title="สถานะใต้ชื่อบอท" text="ข้อความเล็กๆ ที่โชว์ใต้ชื่อบอทในรายชื่อสมาชิก">
        <div className="bp-split">
          <div className="bp-edit">
            {loading ? (
              <>
                <i className="aov-skel" style={{ width: 90, height: 12 }} aria-hidden="true" />
                <i className="aov-skel" style={{ width: "100%", height: 62, borderRadius: 11 }} aria-hidden="true" />
                <i className="aov-skel" style={{ width: "100%", height: 40, borderRadius: 9 }} aria-hidden="true" />
              </>
            ) : (
              <>
                <div className="hv-field">
                  <span id={`${textId}-type`}>ประเภท</span>
                  <ActivitySegments labelledBy={`${textId}-type`} value={form.activityType} disabled={busy}
                    onChange={(activityType) => setForm({ ...form, activityType })} />
                </div>
                <div className="hv-field">
                  <div className="hv-field-row">
                    <label htmlFor={textId}>ข้อความ</label>
                    <small id={`${textId}-count`} className={`bp-count-note${countTone}`}>
                      {length}/{ACTIVITY_TEXT_MAX}
                      {left <= 16 && <span className="sr-only">{left <= 0 ? " ครบจำนวนแล้ว" : ` เหลือ ${left} ตัวอักษร`}</span>}
                    </small>
                  </div>
                  <input id={textId} value={form.activityText} maxLength={ACTIVITY_TEXT_MAX}
                    onChange={(event) => setForm({ ...form, activityText: event.target.value })}
                    placeholder={BOT.defaultText} required disabled={busy} aria-invalid={empty || undefined}
                    aria-describedby={`${textId}-count`} />
                  {empty && <small className="bp-warn">ใส่ข้อความก่อนบันทึก</small>}
                </div>
              </>
            )}
          </div>
          <DiscordPreview name={BOT.name} avatarUrl={avatarUrl} online={online} loading={loading}
            type={form.activityType} text={form.activityText.trim() || BOT.defaultText} />
        </div>
      </Card>
      <SaveBar dirty={dirty && valid} busy={busy} onCancel={reset} text="ยังไม่ได้บันทึกสถานะ" />
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
    <div className="bp-seg" role="radiogroup" aria-labelledby={labelledBy}>
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
    <figure className="bp-dc">
      <figcaption>ที่เห็นใน Discord</figcaption>
      <div className="bp-dc-list">
        <p className="bp-dc-group" aria-hidden="true">{online ? "ออนไลน์" : "ออฟไลน์"} — 1</p>
        <div className={`bp-dc-member${online ? "" : " is-offline"}`}>
          <span className="bp-dc-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
            <i />
          </span>
          <span className="bp-dc-copy">
            <span className="bp-dc-name">
              <b>{name}</b>
              <em><Check size={10} strokeWidth={3.5} aria-hidden="true" />BOT</em>
            </span>
            <span className="bp-dc-activity" aria-live="polite">
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
