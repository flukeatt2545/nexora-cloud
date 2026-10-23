"use client";

// Adding a bot in three steps: name and language, where the code comes from, then the token.
// The bot is created when step two finishes, so closing at step three still leaves it in place.
import { ArrowLeft, Check, ChevronDown, Eye, EyeOff, FileArchive, FileCode, FolderOpen, GitBranch, LayoutTemplate, Play, Upload, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, botApi, botSend, errorMessage, runtimeLabel, runtimeLibrary, uploadBotZip, type Bot, type BotRuntime, type SourceReport } from "./botsShared";
import { formatBytes, makeBotPick, pickedFromEntries, pickedFromInput, zipPickedFiles, type BotPick, type PickedFile } from "./botSourcePack";

type Notify = (notice: { kind: "success" | "error"; text: string; title?: string }) => void;
type Source = "zip" | "github" | "template";

const LISTED_FILES = 6;

const steps = ["ตั้งชื่อ", "ใส่โค้ด", "ใส่โทเคน"];

/** With forAdmin, step one also asks whose bot it is (empty means the admin's own). */
export default function BotCreateWizard({ onClose, onCreated, notify, forAdmin = false }: { onClose: () => void; onCreated: (bot: Bot) => void; notify: Notify; forAdmin?: boolean }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [runtime, setRuntime] = useState<BotRuntime>("node");
  const [source, setSource] = useState<Source>("zip");
  const [pick, setPick] = useState<BotPick | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [bot, setBot] = useState<Bot | null>(null);
  const [report, setReport] = useState<SourceReport | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [variable, setVariable] = useState("DISCORD_TOKEN");
  const [verified, setVerified] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const close = () => (bot ? onCreated(bot) : onClose());
  useScrollLock(true);
  useEscape(!busy, close);

  function go(next: number) {
    setDirection(next > step ? "forward" : "back");
    setError("");
    setStep(next);
  }

  function choose(picked: PickedFile[], skipped = 0) {
    if (picked.length === 0 && skipped === 0) return; // the picker was cancelled
    try {
      setPick(makeBotPick(picked, skipped));
      setError("");
    } catch (pickError) {
      setPick(null);
      setError(errorMessage(pickError));
    }
  }

  function openPicker(input: HTMLInputElement | null, event?: MouseEvent) {
    event?.stopPropagation();
    if (!input) return;
    input.value = "";
    input.click();
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    // Take the entries now: the browser empties dataTransfer as soon as this handler yields.
    const entries = Array.from(event.dataTransfer.items ?? [], (item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
    if (entries.length === 0) {
      choose(pickedFromInput(event.dataTransfer.files));
      return;
    }
    setReading(true);
    try {
      const walked = await pickedFromEntries(entries);
      if (walked.files.length === 0 && walked.skipped === 0) setError("โฟลเดอร์ที่ลากมาว่างเปล่า");
      else choose(walked.files, walked.skipped);
    } catch {
      setPick(null);
      setError("อ่านไฟล์ที่ลากมาไม่ได้ ลองกดเลือกโฟลเดอร์แทน");
    } finally {
      setReading(false);
    }
  }

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("ตั้งชื่อบอทก่อน");
      return;
    }
    go(1);
  }

  async function submitSource(event: FormEvent) {
    event.preventDefault();
    if (source === "zip" && !pick) {
      setError("เลือกโฟลเดอร์ ไฟล์โค้ด หรือไฟล์ ZIP ของบอทก่อน");
      return;
    }
    if (source === "github" && !repo.trim()) {
      setError("ใส่ลิงก์ GitHub ก่อน");
      return;
    }
    setBusy(true);
    setError("");
    let file: File | null = null;
    if (source === "zip" && pick) {
      // Pack before creating the bot, so a selection that is too big never leaves an empty bot behind.
      try {
        file = pick.kind === "zip" ? pick.file : await zipPickedFiles(pick.files);
      } catch (packError) {
        setError(errorMessage(packError));
        setBusy(false);
        return;
      }
    }
    try {
      const created = await botApi<{ bot: Bot; source: SourceReport | null }>("/api/bots", botSend("POST", {
        name: name.trim(), runtime, source, githubRepo: repo.trim(), githubRef: ref.trim(), ownerUsername: owner.trim(),
      }));
      let result = created.source;
      setBot(created.bot);
      if (source === "zip" && file) {
        setProgress(0);
        try {
          const uploaded = await uploadBotZip(created.bot.id, file, false, setProgress);
          result = uploaded.source;
        } catch (uploadError) {
          // The bot exists already; let the owner add the code from its page instead of retrying here.
          notify({ kind: "error", text: `สร้างบอทแล้ว แต่อัปโหลดไฟล์ไม่สำเร็จ: ${errorMessage(uploadError)} ลองอัปโหลดอีกครั้งในแท็บไฟล์` });
          onCreated(created.bot);
          return;
        }
      }
      setReport(result);
      const tokenName = result?.envNames?.find((item) => /TOKEN/.test(item));
      if (tokenName) setVariable(tokenName);
      go(2);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function saveToken(event: FormEvent) {
    event.preventDefault();
    if (!bot) return;
    if (!token.trim()) {
      setError("วางโทเคนก่อน หรือกดข้ามไปก่อน");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await botApi<{ bot: Bot; checked: boolean }>(`/api/bots/${encodeURIComponent(bot.id)}/token`, botSend("PUT", { token: token.trim(), variable }));
      setBot(saved.bot);
      setToken("");
      setVerified(true);
      if (!saved.checked) notify({ kind: "success", text: "บันทึกโทเคนแล้ว ตอนนี้ตรวจกับ Discord ไม่ได้ จะรู้ผลตอนเปิดบอท" });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function startNow() {
    if (!bot) return;
    setBusy(true);
    try {
      await botApi(`/api/bots/${encodeURIComponent(bot.id)}/operations`, botSend("POST", { action: "start" }));
      onCreated(bot);
    } catch (startError) {
      setError(errorMessage(startError));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="bt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className="bt-dialog bt-wizard" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="bw-head">
          <div className="bw-head-text">
            <h2 id={titleId}>{bot ? `เพิ่ม ${bot.name}` : "เพิ่มบอท"}</h2>
            <small>ขั้นที่ {step + 1} จาก {steps.length} · {steps[step]}</small>
          </div>
          <button type="button" className="bt-icon-btn bw-close" onClick={close} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </header>

        <ol className="bw-steps" aria-label="ขั้นตอน">
          {steps.map((label, index) => (
            <li key={label} className={index < step ? "is-done" : index === step ? "is-current" : ""} aria-current={index === step ? "step" : undefined}>
              <span className="bw-steps-label">{index < step && <Check size={13} aria-hidden="true" />}{label}</span>
            </li>
          ))}
        </ol>

        <div key={step} className={`bt-wizard-body is-${direction}`}>
          {step === 0 && (
            <form className="bw-form" onSubmit={submitName}>
              <div className="bw-body">
                <label className="bt-field">
                  <span>ชื่อบอท</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="เช่น บอทเพลงห้องเกม" autoFocus />
                  <small>ใช้เรียกในเว็บนี้เท่านั้น ชื่อที่เห็นใน Discord มาจากหน้า Developer Portal</small>
                </label>
                {forAdmin && (
                  <label className="bt-field">
                    <span>เจ้าของบอท <em>ไม่ใส่ก็ได้</em></span>
                    <input value={owner} onChange={(event) => setOwner(event.target.value.replace(/[^A-Za-z0-9@]/g, ""))} maxLength={40} placeholder="ชื่อผู้ใช้ เว้นว่างไว้ถ้าเป็นบอทของคุณเอง" spellCheck={false} />
                    <small>บอทจะไปอยู่ในหน้าบอทของผู้ใช้คนนั้น และนับในโควตาของเขา</small>
                  </label>
                )}
                <fieldset className="bt-field">
                  <legend>เขียนด้วยภาษาอะไร</legend>
                  <div className="bt-choice-grid">
                    {(["node", "python"] as BotRuntime[]).map((item) => (
                      <label key={item} className={`bt-choice is-${item}${runtime === item ? " is-picked" : ""}`}>
                        <input type="radio" name="runtime" value={item} checked={runtime === item} onChange={() => setRuntime(item)} />
                        <span className="bt-choice-mark" aria-hidden="true">{item === "node" ? "JS" : "PY"}</span>
                        <span className="bt-choice-text"><b>{runtimeLabel[item]}</b><small>{runtimeLibrary[item]} {item === "node" ? "· Node 22" : "· Python 3.12"}</small></span>
                        <span className="bw-radio" aria-hidden="true" />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {error && <p className="bt-error" role="alert">{error}</p>}
              </div>
              <footer className="bw-foot">
                <button type="button" className="bt-btn" onClick={onClose}>ยกเลิก</button>
                <button type="submit" className="bt-btn bt-btn-primary">ถัดไป</button>
              </footer>
            </form>
          )}

          {step === 1 && (
            <form className="bw-form" onSubmit={submitSource}>
              <div className="bw-body">
                <div className="bt-segment" role="radiogroup" aria-label="เอาโค้ดมาจากไหน">
                  {([["zip", "อัปโหลดไฟล์", FileArchive], ["github", "GitHub", GitBranch], ["template", "บอทตัวอย่าง", LayoutTemplate]] as const).map(([value, label, Icon]) => (
                    <label key={value} className={source === value ? "is-picked" : ""}>
                      <input type="radio" name="source" value={value} checked={source === value} onChange={() => { setSource(value); setError(""); }} />
                      <Icon size={16} aria-hidden="true" />{label}
                    </label>
                  ))}
                </div>

                {source === "zip" && (
                  <div className="bt-form-stack">
                    <div
                      className={`bt-drop${dragging ? " is-over" : ""}${pick ? " has-file" : ""}`}
                      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => void onDrop(event)}
                      onClick={() => openPicker(fileInput.current)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(fileInput.current); } }}
                      role="button"
                      tabIndex={0}
                      aria-label="เลือกไฟล์โค้ดหรือไฟล์ ZIP ของบอท"
                      aria-busy={reading}
                    >
                      {/* Any file type: loose code files are zipped here, and .zip still goes up as it is. */}
                      <input ref={fileInput} type="file" multiple hidden onChange={(event) => choose(pickedFromInput(event.target.files))} />
                      <span className="bt-drop-icon"><Upload size={22} aria-hidden="true" /></span>
                      {reading ? (
                        <><b>กำลังอ่านไฟล์</b><small>โฟลเดอร์ใหญ่อาจใช้เวลาสักครู่</small></>
                      ) : pick?.kind === "zip" ? (
                        <><b>{pick.file.name}</b><small>{formatBytes(pick.file.size)} · คลิกเพื่อเปลี่ยน</small></>
                      ) : pick ? (
                        <><b>{pick.files.length} ไฟล์ · {formatBytes(pick.size)}</b><small>ระบบบีบอัดเป็น ZIP ให้ตอนกดสร้างบอท · คลิกเพื่อเปลี่ยน</small></>
                      ) : (
                        <><b>ลากโฟลเดอร์บอท ไฟล์โค้ด หรือไฟล์ ZIP มาวาง</b><small>หรือคลิกเพื่อเลือกไฟล์ · ไม่เกิน 50 MB · ข้าม node_modules, .venv, __pycache__ ให้เอง</small></>
                      )}
                      {progress !== null && <span className="bt-progress" style={{ ["--value" as string]: `${progress}%` }} aria-label={`อัปโหลดแล้ว ${progress}%`} />}
                    </div>
                    <div className="bt-pick-actions">
                      <input ref={(node) => { folderInput.current = node; if (node) node.webkitdirectory = true; }} type="file" hidden onChange={(event) => choose(pickedFromInput(event.target.files))} />
                      <button type="button" className="bt-link" onClick={() => openPicker(folderInput.current)} disabled={busy || reading}>
                        <FolderOpen size={15} aria-hidden="true" />เลือกทั้งโฟลเดอร์
                      </button>
                      {pick && <button type="button" className="bt-link" onClick={() => setPick(null)} disabled={busy}><X size={14} aria-hidden="true" />ล้างที่เลือก</button>}
                    </div>
                    {pick?.kind === "files" && (
                      <div className="bt-pick-list">
                        <ul aria-label="ไฟล์ที่จะอัปโหลด">
                          {pick.files.slice(0, LISTED_FILES).map((item) => (
                            <li key={item.path}><FileCode size={14} aria-hidden="true" /><span>{item.path}</span><small>{formatBytes(item.file.size)}</small></li>
                          ))}
                        </ul>
                        <p>
                          {pick.files.length > LISTED_FILES && <>และอีก {pick.files.length - LISTED_FILES} ไฟล์ · </>}
                          รวม {pick.files.length} ไฟล์ {formatBytes(pick.size)}
                          {pick.skipped > 0 && <> · ข้าม {pick.skipped} รายการ (node_modules, .venv, __pycache__, .git)</>}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {source === "github" && (
                  <div className="bt-form-stack">
                    <label className="bt-field">
                      <span>ลิงก์ repo</span>
                      <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/ชื่อผู้ใช้/ชื่อrepo" inputMode="url" autoFocus />
                    </label>
                    <label className="bt-field">
                      <span>branch <em>ไม่ใส่ก็ได้</em></span>
                      <input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="ใช้ branch หลักของ repo" />
                      <small>ใช้ได้กับ repo สาธารณะ ถ้าเป็น repo ส่วนตัว ให้ดาวน์โหลดเป็น ZIP แล้วอัปโหลดแทน</small>
                    </label>
                  </div>
                )}

                {source === "template" && (
                  <div className="bt-template">
                    <pre className="bt-template-code" aria-label="ตัวอย่างโค้ด">{runtime === "node"
                      ? "client.on(InteractionCreate, (i) => {\n  if (i.commandName === \"ping\")\n    i.reply(\"pong\");\n});"
                      : "@tree.command(name=\"ping\")\nasync def ping(interaction):\n    await interaction.response.send_message(\"pong\")"}</pre>
                    <p>บอทที่ตอบคำสั่ง <code>/ping</code> เขียนด้วย {runtimeLibrary[runtime]} ใส่โทเคนแล้วเปิดได้เลย จากนั้นค่อยแก้โค้ดในแท็บไฟล์</p>
                  </div>
                )}

                {error && <p className="bt-error" role="alert">{error}</p>}
              </div>
              <footer className="bw-foot">
                <button type="button" className="bt-btn" onClick={() => go(0)} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />ย้อนกลับ</button>
                <button type="submit" className="bt-btn bt-btn-primary" disabled={busy || reading}>
                  {busy && <span className="bt-spinner" aria-hidden="true" />}
                  {busy ? (progress !== null ? `กำลังอัปโหลด ${progress}%` : source === "github" ? "กำลังดึงจาก GitHub" : "กำลังสร้าง") : "สร้างบอท"}
                </button>
              </footer>
            </form>
          )}

          {step === 2 && bot && (
            verified ? (
              <div className="bw-form">
                <div className="bw-body bt-verified">
                  <div className="bt-verified-avatar"><BotAvatar bot={bot} size={72} /><span className="bt-verified-check"><Check size={16} aria-hidden="true" /></span></div>
                  <h3>{bot.discord.username ? `เชื่อมกับ @${bot.discord.username} แล้ว` : "บันทึกโทเคนแล้ว"}</h3>
                  <p>โทเคนเก็บแบบเข้ารหัส หลังจากนี้เว็บจะไม่แสดงค่าอีก</p>
                  {error && <p className="bt-error" role="alert">{error}</p>}
                </div>
                <footer className="bw-foot">
                  <button type="button" className="bt-btn" onClick={() => onCreated(bot)} disabled={busy}>ไว้ก่อน</button>
                  <button type="button" className="bt-btn bt-btn-primary" onClick={() => void startNow()} disabled={busy}>
                    {busy ? <span className="bt-spinner" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}เปิดบอทเลย
                  </button>
                </footer>
              </div>
            ) : (
              <form className="bw-form" onSubmit={saveToken}>
                <div className="bw-body">
                  {report?.envDropped && (
                    <p className="bt-note">
                      ไม่ได้เก็บไฟล์ .env ไว้กับโค้ด {report.envNames?.length ? <>พบตัวแปร <code>{report.envNames.join(", ")}</code> ใส่ค่าที่เหลือได้ในแท็บตัวแปรลับ</> : null}
                    </p>
                  )}
                  {report?.entryMissing && <p className="bt-note is-warn">ไม่เจอไฟล์เริ่มต้นของบอท เลือกไฟล์ในแท็บตั้งค่าหลังจากนี้</p>}
                  <label className="bt-field">
                    <span>โทเคนบอท</span>
                    <span className="bt-secret-input">
                      <input
                        type={showToken ? "text" : "password"}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="วางโทเคนที่คัดลอกมา"
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                      />
                      <button type="button" className="bt-icon-btn" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? "ซ่อนโทเคน" : "แสดงโทเคน"}>
                        {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    <small>ระบบตรวจกับ Discord ให้ทันทีว่าโทเคนใช้ได้ไหม</small>
                  </label>
                  <details className="bt-guide">
                    <summary><ChevronDown size={15} aria-hidden="true" />หาโทเคนจากไหน</summary>
                    <ol>
                      <li>เปิด <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal</a> แล้วเลือกแอปของบอท</li>
                      <li>ไปที่เมนู Bot แล้วกด Reset Token</li>
                      <li>คัดลอกโทเคนมาวางที่ช่องด้านบน ถ้าบอทอ่านข้อความในห้อง ให้เปิด Message Content Intent ในหน้าเดียวกันด้วย</li>
                    </ol>
                  </details>
                  <details className="bt-guide">
                    <summary><ChevronDown size={15} aria-hidden="true" />โค้ดอ่านโทเคนจากตัวแปรชื่ออื่น</summary>
                    <label className="bt-field">
                      <span>ชื่อตัวแปร</span>
                      <input value={variable} onChange={(event) => setVariable(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} maxLength={64} spellCheck={false} />
                      <small>โค้ดอ่านด้วย {runtime === "python" ? <code>{`os.environ["${variable || "DISCORD_TOKEN"}"]`}</code> : <code>{`process.env.${variable || "DISCORD_TOKEN"}`}</code>}</small>
                    </label>
                  </details>
                  {error && <p className="bt-error" role="alert">{error}</p>}
                </div>
                <footer className="bw-foot">
                  <button type="button" className="bt-btn" onClick={() => onCreated(bot)} disabled={busy}>ข้ามไปก่อน</button>
                  <button type="submit" className="bt-btn bt-btn-primary" disabled={busy}>
                    {busy && <span className="bt-spinner" aria-hidden="true" />}{busy ? "กำลังตรวจ" : "บันทึกโทเคน"}
                  </button>
                </footer>
              </form>
            )
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
