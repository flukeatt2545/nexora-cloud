"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Link2, Search, X } from "lucide-react";
import { applyThemeColor } from "../themeColor";
import { getDocumentTitle, type SiteTitleMode } from "../pageTitle";
import { API_BASE } from "../runtime";
import { PageLoadingScreen } from "../components/PageLoadingScreen";
import { CHANGE_TYPES, type ChangeType } from "./entries";
import { LATEST_RELEASE, SORTED_RELEASES, markChangelogSeen } from "./seen";
import "./changelog.css";

interface PublicSettings {
  brandName: string;
  siteTitle: string;
  siteTitleMode: SiteTitleMode;
  primaryColor: string;
  themeMode: "light" | "dark";
  logoUrl: string;
}

type Lang = "th" | "en";

const TYPE_LABELS: Record<ChangeType, { name: string; th: string }> = {
  added: { name: "Added", th: "เพิ่มใหม่" },
  changed: { name: "Changed", th: "ปรับปรุง" },
  deprecated: { name: "Deprecated", th: "จะเลิกใช้" },
  removed: { name: "Removed", th: "นำออก" },
  fixed: { name: "Fixed", th: "แก้ไข" },
  security: { name: "Security", th: "ความปลอดภัย" },
};

const COPY = {
  th: {
    back: "หน้าหลัก",
    title: "บันทึกการอัปเดต",
    subtitle: "สิ่งที่เปลี่ยนในแต่ละเวอร์ชัน",
    search: "ค้นหา เช่น ล็อกอิน หรือ 1.0",
    clear: "ล้างคำค้นหา",
    all: "ทั้งหมด",
    latest: "ล่าสุด",
    filters: "กรองตามหมวด",
    empty: "ไม่มีรายการที่ตรงกับ",
    emptyFilter: "ไม่มีรายการในหมวดนี้",
    reset: "ดูทั้งหมด",
    copy: "คัดลอกลิงก์เวอร์ชันนี้",
    copied: "คัดลอกแล้ว",
    count: (n: number) => `${n} รายการ`,
    versions: "เวอร์ชัน",
    categories: "หมวด",
    releases: (n: number) => `${n} เวอร์ชัน`,
    updated: "อัปเดตเมื่อ",
    latestVersion: "เวอร์ชันล่าสุด",
    releaseCount: "จำนวนเวอร์ชัน",
  },
  en: {
    back: "Home",
    title: "Changelog",
    subtitle: "What changed in each release",
    search: "Search, e.g. sign-in or 1.0",
    clear: "Clear search",
    all: "All",
    latest: "Latest",
    filters: "Filter by category",
    empty: "Nothing matches",
    emptyFilter: "Nothing in this category",
    reset: "Show everything",
    copy: "Copy a link to this release",
    copied: "Copied",
    count: (n: number) => `${n} ${n === 1 ? "change" : "changes"}`,
    versions: "Versions",
    categories: "Categories",
    releases: (n: number) => `${n} ${n === 1 ? "release" : "releases"}`,
    updated: "Updated",
    latestVersion: "Latest version",
    releaseCount: "Releases",
  },
};

function formatDate(date: string, lang: Lang) {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return value.toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const anchorFor = (version: string) => `v${version.replace(/\./g, "-")}`;

/** The text with every occurrence of the search term wrapped in <mark>. */
function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

export default function ChangelogPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState<Lang>("th");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChangeType | "all">("all");
  const [copied, setCopied] = useState("");
  const [active, setActive] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const t = COPY[lang];
  const needle = query.trim().toLowerCase();

  // Opening the page clears the "new update" dot in the menus.
  useEffect(() => markChangelogSeen(), []);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((res) => (res.ok ? (res.json() as Promise<PublicSettings>) : null))
      .then((value) => {
        if (!value) return;
        setSettings(value);
        document.documentElement.dataset.theme = value.themeMode || "dark";
        applyThemeColor(value.primaryColor);
        document.title = getDocumentTitle(value, window.location.pathname);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  // A link to one release (#v1-1-0) can only scroll once the list is on the page.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [ready]);

  // "/" jumps to the search box, as on most docs sites.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // Search first, so each filter button can show how many of the matches it holds.
  // A version number in the search ("1.0", "v1.0.0") keeps that whole release.
  const searched = useMemo(() => SORTED_RELEASES.map((release) => ({
    ...release,
    changes: needle && !release.version.includes(needle.replace(/^v/, ""))
      ? release.changes.filter((change) => [change.th, change.en || "", TYPE_LABELS[change.type].name, TYPE_LABELS[change.type].th].some((text) => text.toLowerCase().includes(needle)))
      : release.changes,
  })), [needle]);

  const counts = useMemo(() => {
    const result = { all: 0 } as Record<ChangeType | "all", number>;
    for (const type of CHANGE_TYPES) result[type] = 0;
    for (const release of searched) {
      for (const change of release.changes) {
        result[change.type] += 1;
        result.all += 1;
      }
    }
    return result;
  }, [searched]);

  const shown = useMemo(() => searched
    .map((release) => ({ ...release, changes: filter === "all" ? release.changes : release.changes.filter((change) => change.type === filter) }))
    .filter((release) => release.changes.length > 0), [searched, filter]);

  // Only categories that exist somewhere get a button; an empty "Deprecated" chip is noise.
  const usedTypes = CHANGE_TYPES.filter((type) => SORTED_RELEASES.some((release) => release.changes.some((change) => change.type === type)));
  const shownCount = shown.reduce((total, release) => total + release.changes.length, 0);
  const brandName = settings?.brandName || "NEXORA CLOUD";

  // Highlight, in the version list, the release being read: the last one whose top has
  // scrolled past the sticky bars.
  useEffect(() => {
    if (!ready) return;
    const items = [...document.querySelectorAll<HTMLElement>(".cl-release")];
    if (!items.length) return;
    function update() {
      const line = 140;
      let current = items[0];
      for (const item of items) if (item.getBoundingClientRect().top - line <= 0) current = item;
      setActive(current.id);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ready, shown]);

  function copyLink(version: string) {
    const url = `${window.location.origin}${window.location.pathname}#${anchorFor(version)}`;
    window.history.replaceState(window.history.state, "", `#${anchorFor(version)}`);
    navigator.clipboard?.writeText(url).then(() => setCopied(version)).catch(() => undefined);
  }

  function reset() {
    setQuery("");
    setFilter("all");
  }

  if (!ready) return <PageLoadingScreen label="กำลังโหลดบันทึกการอัปเดต..." />;

  return (
    <div className="cl" lang={lang}>
      <header className="cl-nav">
        <div className="cl-wrap cl-nav-inner">
          <Link href="/" className="cl-back">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>{t.back}</span>
          </Link>
          <Link href="/" className="cl-brand">
            {settings?.logoUrl && <img src={settings.logoUrl} alt="" />}
            <span>{brandName}</span>
          </Link>
          <div className="cl-lang" role="group" aria-label="Language / ภาษา">
            <button type="button" aria-pressed={lang === "th"} onClick={() => setLang("th")}>TH</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </header>

      <div className="cl-wrap cl-page">
        <header className="cl-hero">
          <p className="cl-kicker">Changelog</p>
          <h1>{t.title}</h1>
          <p className="cl-sub">{t.subtitle}</p>
          {LATEST_RELEASE && (
            <dl className="cl-stats">
              <div><dt>{t.latestVersion}</dt><dd className="cl-mono">v{LATEST_RELEASE.version}</dd></div>
              <div><dt>{t.updated}</dt><dd>{formatDate(LATEST_RELEASE.date, lang)}</dd></div>
              <div><dt>{t.releaseCount}</dt><dd>{t.releases(SORTED_RELEASES.length)}</dd></div>
            </dl>
          )}
        </header>

        <div className="cl-layout">
          <aside className="cl-side">
            <div className="cl-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
                placeholder={t.search}
                aria-label={t.search}
                enterKeyHint="search"
                autoComplete="off"
              />
              {query
                ? <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label={t.clear}><X size={15} aria-hidden="true" /></button>
                : <kbd aria-hidden="true">/</kbd>}
            </div>

            <p className="cl-side-label">{t.categories}</p>
            <div className="cl-filters" role="group" aria-label={t.filters}>
              <button type="button" className="cl-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                <i aria-hidden="true" /><b>{t.all}</b><span>{counts.all}</span>
              </button>
              {usedTypes.map((type) => (
                <button key={type} type="button" className={`cl-chip t-${type}`} aria-pressed={filter === type} disabled={counts[type] === 0 && filter !== type} onClick={() => setFilter(filter === type ? "all" : type)}>
                  <i aria-hidden="true" /><b>{lang === "th" ? TYPE_LABELS[type].th : TYPE_LABELS[type].name}</b><span>{counts[type]}</span>
                </button>
              ))}
            </div>

            {shown.length > 0 && (
              <nav className="cl-toc" aria-label={t.versions}>
                <p className="cl-side-label">{t.versions}</p>
                <ul>
                  {shown.map((release) => (
                    <li key={release.version}>
                      <a href={`#${anchorFor(release.version)}`} aria-current={active === anchorFor(release.version) ? "location" : undefined}>
                        <span className="cl-mono">v{release.version}</span>
                        <time dateTime={release.date}>{formatDate(release.date, lang)}</time>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </aside>

          <main className="cl-main">
            <p className="cl-count" aria-live="polite">{t.count(shownCount)}</p>

            {shown.length === 0 ? (
              <div className="cl-empty">
                <p>{needle ? <>{t.empty} <q>{query.trim()}</q></> : t.emptyFilter}</p>
                <button type="button" onClick={reset}>{t.reset}</button>
              </div>
            ) : (
              <ol className="cl-list">
                {shown.map((release) => (
                  <li key={release.version} id={anchorFor(release.version)} className="cl-release">
                    <header className="cl-rel-head">
                      <h2 className="cl-mono">
                        <a href={`#${anchorFor(release.version)}`}>v{highlight(release.version, needle.replace(/^v/, ""))}</a>
                      </h2>
                      {release.version === LATEST_RELEASE?.version && <span className="cl-latest">{t.latest}</span>}
                      <time dateTime={release.date}>{formatDate(release.date, lang)}</time>
                      <button type="button" className="cl-copy" onClick={() => copyLink(release.version)} aria-label={t.copy} title={t.copy}>
                        {copied === release.version ? <><Check size={14} aria-hidden="true" /><span>{t.copied}</span></> : <Link2 size={14} aria-hidden="true" />}
                      </button>
                    </header>
                    <div className="cl-rel-body">
                      {CHANGE_TYPES.filter((type) => release.changes.some((change) => change.type === type)).map((type) => (
                        <section key={type} className={`cl-group t-${type}`}>
                          <h3 className="cl-tag" title={TYPE_LABELS[type].th}>{TYPE_LABELS[type].name}</h3>
                          <ul>
                            {release.changes.filter((change) => change.type === type).map((change) => (
                              <li key={change.th}>{highlight(lang === "en" ? change.en || change.th : change.th, needle)}</li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
