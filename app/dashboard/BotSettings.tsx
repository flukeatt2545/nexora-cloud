"use client";

// The token and other variables a bot reads, and the bot's own settings.
import { ClipboardPaste, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Ask } from "./types";
import { BotAvatar, botApi, botIsUp, botSend, errorMessage, shortDateTime, type Bot, type BotEnvItem, type BotFileItem } from "./botsShared";

type Notify = (notice: { kind: "success" | "error"; text: string; title?: string }) => void;

const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** KEY=value lines from a pasted .env file; quotes around a value are removed. */
export function parseEnvText(text: string) {
  const items: { name: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const name = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (NAME.test(name)) items.push({ name, value });
  }
  return items;
}

export function BotEnvironment({ bot, onChanged, notify, ask, onRestart }: { bot: Bot; onChanged: (bot?: Bot) => void; notify: Notify; ask: Ask; onRestart: () => void }) {
  const [items, setItems] = useState<BotEnvItem[] | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [variable, setVariable] = useState(bot.discord.tokenVariable || "DISCORD_TOKEN");
  const [tokenOpen, setTokenOpen] = useState(!bot.discord.tokenVariable);
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [form, setForm] = useState<{ name: string; value: string; isSecret: boolean; editing: boolean } | null>(null);
  const [pasting, setPasting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const base = `/api/bots/${encodeURIComponent(bot.id)}`;

  const load = useCallback(async () => {
    try {
      const data = await botApi<{ items: BotEnvItem[] }>(`${base}/environment`);
      setItems(data.items);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [base]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function saveToken(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) { setTokenError("วางโทเคนก่อน"); return; }
    setSavingToken(true);
    setTokenError("");
    try {
      const result = await botApi<{ bot: Bot; checked: boolean }>(`${base}/token`, botSend("PUT", { token: token.trim(), variable }));
      setToken("");
      setTokenOpen(false);
      setChanged(true);
      onChanged(result.bot);
      notify({ kind: "success", text: result.checked ? `เชื่อมกับ @${result.bot.discord.username} แล้ว` : "บันทึกโทเคนแล้ว ตอนนี้ตรวจกับ Discord ไม่ได้ จะรู้ผลตอนเปิดบอท" });
      void load();
    } catch (saveError) {
      setTokenError(errorMessage(saveError));
    } finally {
      setSavingToken(false);
    }
  }

  async function saveItems(list: { name: string; value: string; isSecret: boolean }[]) {
    setSaving(true);
    try {
      await botApi(`${base}/environment`, botSend("PUT", { items: list }));
      setForm(null);
      setPasting(null);
      setChanged(true);
      notify({ kind: "success", text: list.length > 1 ? `บันทึก ${list.length} ตัวแปรแล้ว` : `บันทึก ${list[0].name} แล้ว` });
      await load();
    } catch (saveError) {
      notify({ kind: "error", text: errorMessage(saveError) });
    } finally {
      setSaving(false);
    }
  }

  function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const name = form.name.trim().toUpperCase();
    if (!NAME.test(name)) { notify({ kind: "error", text: "ชื่อตัวแปรใช้ได้แค่ A-Z, 0-9 และ _ และห้ามขึ้นต้นด้วยตัวเลข" }); return; }
    void saveItems([{ name, value: form.value, isSecret: form.isSecret }]);
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault();
    const parsed = parseEnvText(pasting || "");
    if (!parsed.length) { notify({ kind: "error", text: "ไม่พบบรรทัดแบบ NAME=value" }); return; }
    void saveItems(parsed.map((item) => ({ ...item, isSecret: true })));
  }

  function remove(item: BotEnvItem) {
    ask({
      title: `ลบ ${item.name}`,
      message: item.isToken ? "นี่คือโทเคนบอท ลบแล้วบอทจะเข้า Discord ไม่ได้จนกว่าจะใส่ใหม่" : "โค้ดที่อ่านตัวแปรนี้จะได้ค่าว่างหลังรีสตาร์ต",
      confirmLabel: "ลบ",
      danger: true,
      action: async () => {
        await botApi(`${base}/environment/${encodeURIComponent(item.name)}`, botSend("DELETE"));
        setChanged(true);
        await load();
        if (item.isToken) onChanged();
      },
    });
  }

  const others = (items || []).filter((item) => !item.isToken);
  const tokenTone = bot.discord.tokenState === "valid" ? "is-ok" : bot.discord.tokenState === "invalid" ? "is-bad" : "is-wait";

  return (
    <div className="bt-env">
      {changed && botIsUp(bot) && (
        <div className="bt-callout">
          <RotateCcw size={18} aria-hidden="true" />
          <span>ค่าใหม่จะมีผลหลังรีสตาร์ตบอท</span>
          <button type="button" className="bt-btn" onClick={() => { setChanged(false); onRestart(); }}>รีสตาร์ตตอนนี้</button>
        </div>
      )}

      <section className="bt-card-box bt-token">
        <header className="bt-box-head">
          <h2><KeyRound size={17} aria-hidden="true" />โทเคนบอท</h2>
          {bot.discord.tokenVariable && !tokenOpen && <button type="button" className="bt-btn is-sm" onClick={() => setTokenOpen(true)}>เปลี่ยนโทเคน</button>}
        </header>
        {bot.discord.tokenVariable && (
          <div className="bt-token-id">
            <BotAvatar bot={bot} size={44} />
            <div>
              <b>{bot.discord.username ? `@${bot.discord.username}` : "บอทใน Discord"}</b>
              <small>
                <span className={`bt-token-state ${tokenTone}`}>{bot.discord.tokenState === "valid" ? "ใช้ได้" : bot.discord.tokenState === "invalid" ? "ใช้ไม่ได้" : "ยังไม่ได้ตรวจ"}</span>
                {" "}อ่านจาก <code>{bot.discord.tokenVariable}</code>{bot.discord.checkedAt ? ` · ตรวจเมื่อ ${shortDateTime(bot.discord.checkedAt)}` : ""}
              </small>
            </div>
            <span className="bt-token-lock" title="เก็บแบบเข้ารหัส ไม่มีใครเปิดดูค่าได้"><Lock size={15} aria-hidden="true" />เข้ารหัสไว้</span>
          </div>
        )}
        {tokenOpen && (
          <form className="bt-form" onSubmit={saveToken}>
            <label className="bt-field">
              <span>{bot.discord.tokenVariable ? "โทเคนใหม่" : "วางโทเคนบอท"}</span>
              <span className="bt-secret-input">
                <input type={showToken ? "text" : "password"} value={token} onChange={(event) => setToken(event.target.value)} placeholder="คัดลอกจาก Discord Developer Portal > Bot > Reset Token" autoComplete="off" spellCheck={false} />
                <button type="button" className="bt-icon-btn" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? "ซ่อนโทเคน" : "แสดงโทเคน"}>{showToken ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
            </label>
            <label className="bt-field is-inline">
              <span>ชื่อตัวแปรที่โค้ดใช้</span>
              <input value={variable} onChange={(event) => setVariable(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} maxLength={64} spellCheck={false} />
            </label>
            {tokenError && <p className="bt-error" role="alert">{tokenError}</p>}
            <div className="bt-form-actions">
              {bot.discord.tokenVariable && <button type="button" className="bt-btn" onClick={() => { setTokenOpen(false); setToken(""); setTokenError(""); }}>ยกเลิก</button>}
              <button type="submit" className="bt-btn bt-btn-primary" disabled={savingToken}>{savingToken && <span className="bt-spinner" aria-hidden="true" />}{savingToken ? "กำลังตรวจกับ Discord" : "บันทึกโทเคน"}</button>
            </div>
          </form>
        )}
      </section>

      <section className="bt-card-box">
        <header className="bt-box-head">
          <h2>ตัวแปรอื่น ๆ</h2>
          <span className="bt-box-actions">
            <button type="button" className="bt-btn is-sm" onClick={() => { setPasting(""); setForm(null); }}><ClipboardPaste size={15} aria-hidden="true" />วางจาก .env</button>
            <button type="button" className="bt-btn is-sm" onClick={() => { setForm({ name: "", value: "", isSecret: true, editing: false }); setPasting(null); }}><Plus size={15} aria-hidden="true" />เพิ่ม</button>
          </span>
        </header>
        <p className="bt-box-note">เช่น ID ห้อง คีย์ API อื่น ๆ โค้ดอ่านได้จาก <code>{bot.runtime === "python" ? "os.environ[\"ชื่อ\"]" : "process.env.ชื่อ"}</code> และมี <code>DATA_DIR</code> ให้เสมอสำหรับเก็บไฟล์ถาวร</p>

        {pasting !== null && (
          <form className="bt-form bt-paste" onSubmit={submitPaste}>
            <textarea value={pasting} onChange={(event) => setPasting(event.target.value)} rows={6} placeholder={"GUILD_ID=123456789\nOPENAI_API_KEY=..."} spellCheck={false} autoFocus aria-label="เนื้อหาไฟล์ .env" />
            <small>ทุกค่าเก็บเป็นความลับ ตัวที่ชื่อซ้ำจะถูกแทนที่ {pasting ? `· พบ ${parseEnvText(pasting).length} ตัวแปร` : ""}</small>
            <div className="bt-form-actions">
              <button type="button" className="bt-btn" onClick={() => setPasting(null)}>ยกเลิก</button>
              <button type="submit" className="bt-btn bt-btn-primary" disabled={saving}>{saving && <span className="bt-spinner" aria-hidden="true" />}บันทึกทั้งหมด</button>
            </div>
          </form>
        )}

        {form && (
          <form className="bt-form bt-env-form" onSubmit={submitForm}>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} placeholder="ชื่อ เช่น GUILD_ID" aria-label="ชื่อตัวแปร" maxLength={64} readOnly={form.editing} spellCheck={false} autoFocus={!form.editing} />
            <input value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} placeholder={form.editing && form.isSecret ? "ใส่ค่าใหม่" : "ค่า"} aria-label="ค่า" type={form.isSecret ? "password" : "text"} autoComplete="off" spellCheck={false} autoFocus={form.editing} />
            <label className="bt-check"><input type="checkbox" checked={form.isSecret} onChange={(event) => setForm({ ...form, isSecret: event.target.checked })} />เก็บเป็นความลับ</label>
            <span className="bt-form-actions">
              <button type="button" className="bt-icon-btn" onClick={() => setForm(null)} aria-label="ยกเลิก"><X size={16} /></button>
              <button type="submit" className="bt-btn bt-btn-primary" disabled={saving}>{saving && <span className="bt-spinner" aria-hidden="true" />}บันทึก</button>
            </span>
          </form>
        )}

        {error && <p className="bt-error">{error}</p>}
        {items === null && !error && <div className="bt-tree-skeleton" aria-busy="true"><span /><span /></div>}
        {items && others.length === 0 && !form && pasting === null && <p className="bt-box-empty">ยังไม่มีตัวแปรอื่น</p>}
        {others.length > 0 && (
          <ul className="bt-env-list">
            {others.map((item) => (
              <li key={item.name}>
                <code className="bt-env-name">{item.name}</code>
                <span className="bt-env-value">{item.isSecret ? <><ShieldCheck size={14} aria-hidden="true" />ซ่อนค่าไว้</> : item.value || <em>ค่าว่าง</em>}</span>
                <span className="bt-env-actions">
                  <button type="button" className="bt-icon-btn is-sm" onClick={() => setForm({ name: item.name, value: item.isSecret ? "" : item.value, isSecret: item.isSecret, editing: true })} aria-label={`แก้ ${item.name}`}><Pencil size={14} /></button>
                  <button type="button" className="bt-icon-btn is-sm is-danger" onClick={() => remove(item)} aria-label={`ลบ ${item.name}`}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function BotSettings({ bot, onChanged, onDeleted, notify, ask }: { bot: Bot; onChanged: (bot?: Bot) => void; onDeleted: () => void; notify: Notify; ask: Ask }) {
  const [name, setName] = useState(bot.name);
  const [entry, setEntry] = useState(bot.entryFile);
  const [mode, setMode] = useState(bot.startMode);
  const [files, setFiles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const base = `/api/bots/${encodeURIComponent(bot.id)}`;

  useEffect(() => {
    let alive = true;
    botApi<{ items: BotFileItem[] }>(`${base}/files`).then((data) => {
      if (!alive) return;
      const pattern = bot.runtime === "python" ? /\.py$/i : /\.(js|mjs|cjs)$/i;
      setFiles(data.items.filter((item) => !item.isDir && pattern.test(item.path)).map((item) => item.path));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [base, bot.runtime]);

  const changed = name.trim() !== bot.name || entry !== bot.entryFile || mode !== bot.startMode;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await botApi<{ bot: Bot }>(base, botSend("PATCH", { name: name.trim(), entryFile: entry, startMode: mode }));
      onChanged(result.bot);
      notify({ kind: "success", text: botIsUp(bot) && (entry !== bot.entryFile || mode !== bot.startMode) ? "บันทึกแล้ว รีสตาร์ตบอทเพื่อใช้ค่าใหม่" : "บันทึกแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    ask({
      title: `ลบ ${bot.name}`,
      message: "บอทจะถูกปิด และโค้ด ตัวแปรลับ ข้อมูลใน DATA_DIR และคอนโซลทั้งหมดจะถูกลบ กู้คืนไม่ได้",
      confirmLabel: "ลบบอท",
      danger: true,
      action: async () => {
        setDeleting(true);
        try {
          await botApi(base, botSend("DELETE"));
          notify({ kind: "success", text: `ลบ ${bot.name} แล้ว` });
          onDeleted();
        } finally {
          setDeleting(false);
        }
      },
    });
  }

  const entryOptions = files.includes(entry) || !entry ? files : [entry, ...files];

  return (
    <div className="bt-settings">
      <form className="bt-card-box bt-form" onSubmit={save}>
        <header className="bt-box-head"><h2>ทั่วไป</h2></header>
        <label className="bt-field">
          <span>ชื่อบอท</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
        </label>
        {bot.runtime === "node" && (
          <fieldset className="bt-field">
            <legend>วิธีเปิดบอท</legend>
            <div className="bt-radio-row">
              <label className={mode === "entry" ? "is-picked" : ""}><input type="radio" name="mode" checked={mode === "entry"} onChange={() => setMode("entry")} />รันไฟล์ด้วย <code>node</code></label>
              <label className={mode === "npm_start" ? "is-picked" : ""}><input type="radio" name="mode" checked={mode === "npm_start"} onChange={() => setMode("npm_start")} />ใช้ <code>npm start</code> ใน package.json</label>
            </div>
          </fieldset>
        )}
        {mode === "entry" && (
          <label className="bt-field">
            <span>ไฟล์เริ่มต้น</span>
            {entryOptions.length > 0 ? (
              <select value={entry} onChange={(event) => setEntry(event.target.value)}>
                {entryOptions.map((path) => <option key={path} value={path}>{path}{!files.includes(path) ? " (ไม่พบไฟล์นี้)" : ""}</option>)}
              </select>
            ) : (
              <input value={entry} onChange={(event) => setEntry(event.target.value)} spellCheck={false} />
            )}
            <small>ระบบสั่ง <code>{bot.runtime === "python" ? `python -u ${entry}` : `node ${entry}`}</code></small>
          </label>
        )}
        <div className="bt-form-actions">
          <button type="submit" className="bt-btn bt-btn-primary" disabled={!changed || saving || !name.trim()}>{saving && <span className="bt-spinner" aria-hidden="true" />}บันทึก</button>
        </div>
      </form>

      <section className="bt-card-box">
        <header className="bt-box-head"><h2>ทรัพยากรที่ได้</h2></header>
        <dl className="bt-resource">
          <div><dt>หน่วยความจำ</dt><dd>{bot.resources.memoryMb} MB</dd></div>
          <div><dt>CPU</dt><dd>{(bot.resources.cpuMillicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} คอร์</dd></div>
          <div><dt>ดิสก์ (โค้ดรวม DATA_DIR)</dt><dd>{bot.resources.diskLimitMb} MB</dd></div>
        </dl>
        <p className="bt-box-note">ใช้หน่วยความจำเกินแล้วบอทจะถูกปิดและเปิดใหม่ ถ้าไม่พอให้ติดต่อแอดมิน</p>
      </section>

      <section className="bt-card-box bt-danger">
        <header className="bt-box-head"><h2><TriangleAlert size={17} aria-hidden="true" />ลบบอท</h2></header>
        <p className="bt-box-note">พิมพ์ชื่อบอท <b>{bot.name}</b> เพื่อยืนยัน</p>
        <div className="bt-danger-row">
          <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} aria-label="พิมพ์ชื่อบอทเพื่อยืนยัน" />
          <button type="button" className="bt-btn bt-btn-danger" disabled={confirmName.trim() !== bot.name || deleting} onClick={remove}><Trash2 size={15} aria-hidden="true" />ลบบอทนี้</button>
        </div>
      </section>
    </div>
  );
}
