"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import { Card, LoadError } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

type Session = {
  id: number;
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  discordId: string;
  username: string;
  displayName: string;
  joinedAt: string;
  leftAt: string | null;
  seconds: number;
};

type Page = { sessions: Session[]; hasMore: boolean; count: number; totalSeconds: number; people: number; guilds: number };

/** 3725 → "1 ชั่วโมง 2 นาที 5 วินาที" */
export function voiceDuration(total: number) {
  let left = Math.max(0, Math.round(total));
  const parts: string[] = [];
  for (const [size, unit] of [[86400, "วัน"], [3600, "ชั่วโมง"], [60, "นาที"], [1, "วินาที"]] as const) {
    const count = Math.floor(left / size);
    left -= count * size;
    if (count) parts.push(`${count} ${unit}`);
  }
  return parts.length ? parts.join(" ") : "0 วินาที";
}

const timeFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clockFormat = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });

function when(session: Session) {
  const joined = new Date(session.joinedAt);
  if (!session.leftAt) return `ตั้งแต่ ${timeFormat.format(joined)}`;
  const left = new Date(session.leftAt);
  const sameDay = joined.toDateString() === left.toDateString();
  return `${timeFormat.format(joined)} – ${sameDay ? clockFormat.format(left) : timeFormat.format(left)}`;
}

/** Who was in which voice channel and for how long, in every server the voice bot is in (superadmin). */
export function DiscordVoiceSessions() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback((q: string) => {
    setLoading(true);
    api<Page>(`/api/admin/discord-voice-sessions?q=${encodeURIComponent(q)}`)
      .then((data) => { setPage(data); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  // Search a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(search), 0);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  async function more() {
    if (!page?.sessions.length) return;
    setLoadingMore(true);
    try {
      const last = page.sessions[page.sessions.length - 1].id;
      const data = await api<Page>(`/api/admin/discord-voice-sessions?q=${encodeURIComponent(search)}&before=${last}`);
      setPage({ ...data, sessions: [...page.sessions, ...data.sessions] });
    } catch (error) {
      setLoadError((error as Error).message || "โหลดไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  }

  const manyServers = Boolean(page && page.guilds > 1);

  return (
    <Card icon={History} title="ประวัติเข้าออกห้องเสียง" text="ใครอยู่ห้องไหน นานเท่าไร ทุกเซิร์ฟที่บอทอยู่ เก็บไว้ 90 วัน" flush busy={loading}
      aside={(
        <button type="button" className="hv-btn hv-icon-btn bp-refresh" onClick={() => load(search)} disabled={loading} aria-label="โหลดใหม่" title="โหลดใหม่">
          <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
        </button>
      )}>
      <div className="bp-tools">
        <label className="bp-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นชื่อคน ชื่อห้อง หรือชื่อเซิร์ฟ"
            aria-label="ค้นประวัติ"
          />
        </label>
        {page && (
          <span className="bp-state">
            {page.count.toLocaleString("th-TH")} ครั้ง, {page.people.toLocaleString("th-TH")} คน, รวม {voiceDuration(page.totalSeconds)}
          </span>
        )}
      </div>
      {loadError ? (
        <div className="bp-card-body">
          <LoadError title="โหลดประวัติไม่ได้" message={loadError} onRetry={() => load(search)} />
        </div>
      ) : !page || page.sessions.length === 0 ? (
        <p className="bp-empty">{loading ? "กำลังโหลด..." : search ? "ไม่พบประวัติที่ตรงกับคำค้น" : "ยังไม่มีประวัติ จะเริ่มเก็บเมื่อมีคนเข้าห้องเสียง"}</p>
      ) : (
        <>
          <ul className="bp-list">
            {page.sessions.map((session) => (
              <li key={session.id}>
                <div className="bp-item">
                  <strong>
                    {session.displayName || session.username || session.discordId}
                    {session.username && session.displayName && session.username !== session.displayName && <small> @{session.username}</small>}
                  </strong>
                  <small>
                    <a href={`https://discord.com/channels/${session.guildId}/${session.channelId}`} target="_blank" rel="noreferrer">{session.channelName || "ห้องเสียง"}</a>
                    {manyServers && session.guildName && <>, {session.guildName}</>}
                    {", "}{when(session)}
                  </small>
                </div>
                <span className="bp-time">
                  {!session.leftAt && <span className="bp-live">อยู่ตอนนี้</span>}
                  {voiceDuration(session.seconds)}
                </span>
              </li>
            ))}
          </ul>
          {page.hasMore && (
            <div className="bp-more">
              <button type="button" className="hv-btn" onClick={() => void more()} disabled={loadingMore}>
                {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
