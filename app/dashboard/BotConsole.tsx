"use client";

// What the bot prints, newest at the bottom. Follows new lines until the reader scrolls up.
import { ArrowDownToLine, Copy, Eraser, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { botIsUp, type Bot, type BotLogLine } from "./botsShared";
import { writeClipboard } from "./mailShared";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function timeOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function BotConsole({ lines, bot, onClear }: { lines: BotLogLine[]; bot: Bot; onClear: () => void }) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // Lines that were already there when the console opened do not animate in.
  const [firstId] = useState(() => (lines.length ? lines[lines.length - 1].id : 0));
  const seenCount = useRef(lines.length);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const clean = lines.map((line) => ({ ...line, text: line.message.replace(ANSI, "") }));
    return needle ? clean.filter((line) => line.text.toLowerCase().includes(needle)) : clean;
  }, [lines, query]);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (follow) box.scrollTop = box.scrollHeight;
  }, [shown, follow]);

  useEffect(() => {
    const added = lines.length - seenCount.current;
    seenCount.current = lines.length;
    if (added > 0 && !follow) {
      const timer = window.setTimeout(() => setUnseen((count) => count + added), 0);
      return () => window.clearTimeout(timer);
    }
  }, [lines, follow]);

  function onScroll() {
    const box = scroller.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
    if (atBottom !== follow) setFollow(atBottom);
    if (atBottom) setUnseen(0);
  }

  function jumpToEnd() {
    setFollow(true);
    setUnseen(0);
  }

  async function copyAll() {
    const text = shown.map((line) => `${timeOf(line.at)} ${line.stream === "stderr" ? "[err] " : ""}${line.text}`).join("\n");
    try {
      await writeClipboard(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="bt-console">
      <div className="bt-console-bar">
        <label className="bt-console-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นในคอนโซล" aria-label="ค้นในคอนโซล" />
        </label>
        <span className="bt-console-live" data-live={botIsUp(bot) ? "on" : "off"}>{botIsUp(bot) ? "สด" : "บอทปิดอยู่"}</span>
        <button type="button" className="bt-icon-btn" onClick={() => void copyAll()} disabled={!shown.length} title={copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"} aria-label="คัดลอกทั้งหมด"><Copy size={16} /></button>
        <button type="button" className="bt-icon-btn" onClick={onClear} disabled={!lines.length} title="ล้างหน้าจอ (ข้อความเดิมยังเก็บไว้ในระบบ)" aria-label="ล้างหน้าจอ"><Eraser size={16} /></button>
      </div>
      <div className="bt-console-screen" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="ข้อความจากบอท">
        {shown.length === 0 ? (
          <p className="bt-console-empty">
            {query ? "ไม่พบข้อความที่ค้น" : bot.source.hasCode ? "ยังไม่มีข้อความ สิ่งที่บอทพิมพ์ด้วย console.log หรือ print จะขึ้นที่นี่" : "ใส่โค้ดของบอทก่อน แล้วกดเปิดบอท"}
          </p>
        ) : (
          shown.map((line) => (
            <div key={line.id} className={`bt-line is-${line.stream}${line.id > firstId ? " is-new" : ""}`}>
              <time dateTime={line.at}>{timeOf(line.at)}</time>
              {line.stream === "system" && <span className="bt-line-tag">ระบบ</span>}
              <span className="bt-line-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
      {!follow && (
        <button type="button" className="bt-console-jump" onClick={jumpToEnd}>
          <ArrowDownToLine size={15} aria-hidden="true" />{unseen > 0 ? `ข้อความใหม่ ${unseen} บรรทัด` : "ไปบรรทัดล่าสุด"}
        </button>
      )}
    </div>
  );
}
