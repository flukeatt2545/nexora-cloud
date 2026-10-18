"use client";

// The bot's code: a file tree, an editor (CodeMirror, loaded only when this tab opens), and the
// ways to replace everything at once (a new ZIP or pulling GitHub again).
import { ArrowLeft, ChevronRight, File as FileIcon, FilePlus, Folder, FolderOpen, FolderPlus, GitBranch, Pencil, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Ask } from "./types";
import { botApi, botSend, errorMessage, uploadBotZip, type Bot, type BotFileItem, type SourceReport } from "./botsShared";

type Notify = (notice: { kind: "success" | "error"; text: string; title?: string }) => void;
type TreeNode = { name: string; path: string; isDir: boolean; item?: BotFileItem; children: TreeNode[] };
type Draft = { kind: "file" | "folder" | "rename"; value: string; from?: string } | null;

function buildTree(items: BotFileItem[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const folderFor = (folderPath: string): TreeNode => {
    const existing = folders.get(folderPath);
    if (existing) return existing;
    const slash = folderPath.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : folderPath.slice(0, slash));
    const node: TreeNode = { name: folderPath.slice(slash + 1), path: folderPath, isDir: true, children: [] };
    parent.children.push(node);
    folders.set(folderPath, node);
    return node;
  };
  for (const item of items) {
    if (item.isDir) { folderFor(item.path); continue; }
    const slash = item.path.lastIndexOf("/");
    folderFor(slash < 0 ? "" : item.path.slice(0, slash)).children.push({ name: item.path.slice(slash + 1), path: item.path, isDir: false, item, children: [] });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

function sizeText(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function BotFiles({ bot, onChanged, notify, ask }: { bot: Bot; onChanged: (bot?: Bot) => void; notify: Notify; ask: Ask }) {
  const [items, setItems] = useState<BotFileItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [fileState, setFileState] = useState<"idle" | "loading" | "error">("idle");
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState<"" | "save" | "restart">("");
  const [draft, setDraft] = useState<Draft>(null);
  const [github, setGithub] = useState<{ repo: string; ref: string } | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [pane, setPane] = useState<"tree" | "editor">("tree");
  const zipInput = useRef<HTMLInputElement>(null);
  const base = `/api/bots/${encodeURIComponent(bot.id)}`;

  const load = useCallback(async () => {
    try {
      const data = await botApi<{ items: BotFileItem[] }>(`${base}/files`);
      setItems(data.items);
      setLoadError("");
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [base]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const tree = useMemo(() => buildTree(items || []), [items]);
  const dirty = Boolean(selected) && content !== original;

  async function openFile(item: BotFileItem) {
    if (dirty && !window.confirm("ไฟล์ที่เปิดอยู่ยังไม่ได้บันทึก ทิ้งการแก้ไขไหม")) return;
    setSelected(item.path);
    setPane("editor");
    if (!item.editable) {
      setFileState("error");
      setFileError("ไฟล์นี้ไม่ใช่ไฟล์ข้อความ หรือใหญ่เกิน 1 MB จึงแก้ในเว็บไม่ได้");
      return;
    }
    setFileState("loading");
    try {
      const data = await botApi<{ content: string }>(`${base}/files/content?path=${encodeURIComponent(item.path)}`);
      setContent(data.content);
      setOriginal(data.content);
      setFileState("idle");
    } catch (error) {
      setFileState("error");
      setFileError(errorMessage(error));
    }
  }

  const save = useCallback(async (restart: boolean) => {
    if (!selected || saving) return;
    setSaving(restart ? "restart" : "save");
    try {
      const result = await botApi<{ queued: boolean }>(`${base}/files/content`, botSend("PUT", { path: selected, content, restart }));
      setOriginal(content);
      notify({ kind: "success", text: result.queued ? "บันทึกแล้ว กำลังรีสตาร์ตบอทด้วยโค้ดใหม่" : "บันทึกแล้ว" });
      onChanged();
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setSaving("");
    }
  }, [base, content, load, notify, onChanged, saving, selected]);

  async function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const value = draft.value.trim().replace(/^\/+/, "");
    if (!value) return;
    try {
      if (draft.kind === "file") {
        await botApi(`${base}/files/content`, botSend("PUT", { path: value, content: "" }));
        setDraft(null);
        await load();
        await openFile({ path: value, isDir: false, size: 0, editable: true });
      } else if (draft.kind === "folder") {
        await botApi(`${base}/files/folders`, botSend("POST", { path: value }));
        setDraft(null);
        setOpen((current) => new Set(current).add(value));
        await load();
      } else if (draft.from) {
        await botApi(`${base}/files/move`, botSend("POST", { from: draft.from, to: value }));
        if (selected === draft.from) setSelected(value);
        setDraft(null);
        await load();
      }
      onChanged();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    }
  }

  function remove(node: TreeNode) {
    ask({
      title: node.isDir ? "ลบโฟลเดอร์" : "ลบไฟล์",
      message: node.isDir ? `ลบ ${node.path} และทุกไฟล์ข้างใน` : `ลบ ${node.path}`,
      confirmLabel: "ลบ",
      danger: true,
      action: async () => {
        await botApi(`${base}/files?path=${encodeURIComponent(node.path)}`, botSend("DELETE"));
        if (selected === node.path || selected.startsWith(`${node.path}/`)) { setSelected(""); setPane("tree"); }
        await load();
        onChanged();
      },
    });
  }

  function afterReplace(report: SourceReport, queued: boolean) {
    const parts = [`ได้ไฟล์ ${report.files} ไฟล์`];
    if (report.skipped) parts.push(`ข้าม ${report.skipped} ไฟล์ที่ระบบติดตั้งให้เอง`);
    if (report.envDropped) parts.push("ไม่เก็บไฟล์ .env ใส่ค่าในแท็บตัวแปรลับแทน");
    if (queued) parts.push("กำลังรีสตาร์ตบอท");
    notify({ kind: "success", text: parts.join(" · ") });
    setSelected("");
    setPane("tree");
    onChanged();
    void load();
  }

  async function replaceWithZip(file: File | undefined) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { notify({ kind: "error", text: "เลือกไฟล์ .zip เท่านั้น" }); return; }
    setReplacing(0);
    try {
      const result = await uploadBotZip(bot.id, file, false, setReplacing);
      afterReplace(result.source, result.queued);
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setReplacing(null);
      if (zipInput.current) zipInput.current.value = "";
    }
  }

  async function pullGitHub(event: FormEvent) {
    event.preventDefault();
    if (!github) return;
    setReplacing(-1);
    try {
      const result = await botApi<{ queued: boolean; source: SourceReport }>(`${base}/github/pull`, botSend("POST", { repo: github.repo, ref: github.ref }));
      setGithub(null);
      afterReplace(result.source, result.queued);
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setReplacing(null);
    }
  }

  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map((node) => {
      const expanded = open.has(node.path);
      const isEntry = !node.isDir && node.path === bot.entryFile && bot.startMode === "entry";
      return (
        <li key={node.path}>
          <div className={`bt-tree-row${selected === node.path ? " is-selected" : ""}`} style={{ paddingLeft: 8 + depth * 14 }}>
            <button
              type="button"
              className="bt-tree-name"
              onClick={() => node.isDir
                ? setOpen((current) => { const next = new Set(current); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next; })
                : node.item && void openFile(node.item)}
              aria-expanded={node.isDir ? expanded : undefined}
            >
              {node.isDir ? <ChevronRight size={14} className={`bt-tree-chevron${expanded ? " is-open" : ""}`} aria-hidden="true" /> : <span className="bt-tree-chevron" />}
              {node.isDir ? (expanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />) : <FileIcon size={15} aria-hidden="true" />}
              <span className="bt-tree-label">{node.name}</span>
              {isEntry && <span className="bt-tree-badge">เริ่มต้น</span>}
            </button>
            <span className="bt-tree-actions">
              <button type="button" className="bt-icon-btn is-sm" onClick={() => setDraft({ kind: "rename", value: node.path, from: node.path })} aria-label={`เปลี่ยนชื่อ ${node.path}`} title="เปลี่ยนชื่อหรือย้าย"><Pencil size={14} /></button>
              <button type="button" className="bt-icon-btn is-sm is-danger" onClick={() => remove(node)} aria-label={`ลบ ${node.path}`} title="ลบ"><Trash2 size={14} /></button>
            </span>
          </div>
          {node.isDir && expanded && node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <div className={`bt-files is-${pane}`}>
      <aside className="bt-files-side">
        <div className="bt-files-bar">
          <button type="button" className="bt-icon-btn" onClick={() => setDraft({ kind: "file", value: "" })} title="ไฟล์ใหม่" aria-label="ไฟล์ใหม่"><FilePlus size={16} /></button>
          <button type="button" className="bt-icon-btn" onClick={() => setDraft({ kind: "folder", value: "" })} title="โฟลเดอร์ใหม่" aria-label="โฟลเดอร์ใหม่"><FolderPlus size={16} /></button>
          <span className="bt-files-bar-gap" />
          <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void replaceWithZip(event.target.files?.[0])} />
          <button
            type="button"
            className="bt-btn is-sm"
            disabled={replacing !== null}
            onClick={() => bot.source.hasCode
              ? ask({ title: "อัปโหลด ZIP ใหม่", message: "ไฟล์ทั้งหมดของบอทจะถูกแทนด้วยไฟล์ใน ZIP ใหม่ ข้อมูลใน DATA_DIR ยังอยู่เหมือนเดิม", confirmLabel: "เลือกไฟล์", action: () => zipInput.current?.click() })
              : zipInput.current?.click()}
          >
            {replacing !== null && replacing >= 0 ? <><span className="bt-spinner" aria-hidden="true" />{replacing}%</> : <><Upload size={15} aria-hidden="true" />ZIP</>}
          </button>
          <button type="button" className="bt-btn is-sm" disabled={replacing !== null} onClick={() => setGithub({ repo: bot.source.githubRepo ? `https://github.com/${bot.source.githubRepo}` : "", ref: bot.source.githubRef })}>
            {replacing === -1 ? <span className="bt-spinner" aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}GitHub
          </button>
        </div>

        {github && (
          <form className="bt-inline-form" onSubmit={pullGitHub}>
            <input value={github.repo} onChange={(event) => setGithub({ ...github, repo: event.target.value })} placeholder="https://github.com/ชื่อผู้ใช้/repo" aria-label="ลิงก์ repo" autoFocus />
            <input value={github.ref} onChange={(event) => setGithub({ ...github, ref: event.target.value })} placeholder="branch (ไม่ใส่ก็ได้)" aria-label="branch" />
            <small>ไฟล์ทั้งหมดจะถูกแทนด้วยโค้ดจาก repo นี้</small>
            <span className="bt-inline-actions">
              <button type="button" className="bt-btn is-sm" onClick={() => setGithub(null)} disabled={replacing !== null}>ยกเลิก</button>
              <button type="submit" className="bt-btn is-sm bt-btn-primary" disabled={replacing !== null || !github.repo.trim()}>ดึงโค้ด</button>
            </span>
          </form>
        )}

        {draft && (
          <form className="bt-inline-form" onSubmit={submitDraft}>
            <label>
              <span className="bt-sr">{draft.kind === "file" ? "ชื่อไฟล์ใหม่" : draft.kind === "folder" ? "ชื่อโฟลเดอร์ใหม่" : "ชื่อใหม่"}</span>
              <input value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder={draft.kind === "folder" ? "เช่น commands" : "เช่น commands/ping.js"} autoFocus spellCheck={false} />
            </label>
            <span className="bt-inline-actions">
              <button type="button" className="bt-icon-btn is-sm" onClick={() => setDraft(null)} aria-label="ยกเลิก"><X size={15} /></button>
              <button type="submit" className="bt-btn is-sm bt-btn-primary">{draft.kind === "rename" ? "เปลี่ยนชื่อ" : "สร้าง"}</button>
            </span>
          </form>
        )}

        {loadError && <p className="bt-error">{loadError}</p>}
        {items === null && !loadError && <div className="bt-tree-skeleton" aria-busy="true"><span /><span /><span /></div>}
        {items && items.length === 0 && (
          <div className="bt-files-empty">
            <p>ยังไม่มีไฟล์</p>
            <small>อัปโหลด ZIP หรือดึงจาก GitHub ด้วยปุ่มด้านบน</small>
          </div>
        )}
        {items && items.length > 0 && <ul className="bt-tree" aria-label="ไฟล์ของบอท">{renderNodes(tree, 0)}</ul>}
      </aside>

      <section className="bt-editor-pane">
        {!selected ? (
          <div className="bt-editor-empty">
            <FileIcon size={28} aria-hidden="true" />
            <p>เลือกไฟล์ทางซ้ายเพื่อแก้ไข</p>
            <small>แก้เสร็จกด Ctrl+S เพื่อบันทึก ถ้าบอทเปิดอยู่ให้กดบันทึกและรีสตาร์ตเพื่อใช้โค้ดใหม่</small>
          </div>
        ) : (
          <>
            <header className="bt-editor-head">
              <button type="button" className="bt-icon-btn bt-editor-back" onClick={() => setPane("tree")} aria-label="กลับไปที่รายการไฟล์"><ArrowLeft size={16} /></button>
              <span className="bt-editor-path" title={selected}>{selected}{dirty && <i className="bt-dirty" aria-label="ยังไม่ได้บันทึก" />}</span>
              {fileState === "idle" && (
                <span className="bt-editor-actions">
                  <button type="button" className="bt-btn is-sm" onClick={() => void save(false)} disabled={!dirty || Boolean(saving)}>
                    {saving === "save" ? <span className="bt-spinner" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}บันทึก
                  </button>
                  <button type="button" className="bt-btn is-sm bt-btn-primary" onClick={() => void save(true)} disabled={Boolean(saving) || !bot.source.hasCode}>
                    {saving === "restart" ? <span className="bt-spinner" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}บันทึกและรีสตาร์ต
                  </button>
                </span>
              )}
            </header>
            {fileState === "loading" && <div className="bt-editor-loading"><span className="bt-spinner" aria-hidden="true" />กำลังเปิดไฟล์</div>}
            {fileState === "error" && <div className="bt-editor-empty"><p>{fileError}</p>{items?.find((item) => item.path === selected) && <small>{sizeText(items.find((item) => item.path === selected)!.size)}</small>}</div>}
            {fileState === "idle" && <CodeEditor key={selected} path={selected} value={original} onChange={setContent} onSave={() => void save(false)} />}
          </>
        )}
      </section>
    </div>
  );
}

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  if (["js", "mjs", "cjs", "jsx"].includes(extension)) return "js";
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return "ts";
  if (extension === "py") return "py";
  if (extension === "json") return "json";
  if (extension === "md") return "md";
  if (extension === "yml" || extension === "yaml") return "yaml";
  if (extension === "css") return "css";
  if (extension === "html" || extension === "htm") return "html";
  return "";
}

// CodeMirror pieces are imported when an editor first opens, so the bot list stays light.
function CodeEditor({ path, value, onChange, onSave }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [ready, setReady] = useState(false);
  useEffect(() => { onChangeRef.current = onChange; onSaveRef.current = onSave; });

  useEffect(() => {
    let cancelled = false;
    let destroy = () => {};
    void (async () => {
      const [view, state, commands, language, oneDark, search, autocomplete] = await Promise.all([
        import("@codemirror/view"), import("@codemirror/state"), import("@codemirror/commands"),
        import("@codemirror/language"), import("@codemirror/theme-one-dark"), import("@codemirror/search"), import("@codemirror/autocomplete"),
      ]);
      const kind = languageFor(path);
      let lang = null;
      if (kind === "js" || kind === "ts") lang = (await import("@codemirror/lang-javascript")).javascript({ typescript: kind === "ts" });
      else if (kind === "py") lang = (await import("@codemirror/lang-python")).python();
      else if (kind === "json") lang = (await import("@codemirror/lang-json")).json();
      else if (kind === "md") lang = (await import("@codemirror/lang-markdown")).markdown();
      else if (kind === "yaml") lang = (await import("@codemirror/lang-yaml")).yaml();
      else if (kind === "css") lang = (await import("@codemirror/lang-css")).css();
      else if (kind === "html") lang = (await import("@codemirror/lang-html")).html();
      if (cancelled || !host.current) return;
      const light = document.documentElement.getAttribute("data-theme") === "light";
      const editor = new view.EditorView({
        parent: host.current,
        state: state.EditorState.create({
          doc: value,
          extensions: [
            view.lineNumbers(),
            view.highlightActiveLineGutter(),
            view.highlightActiveLine(),
            view.drawSelection(),
            commands.history(),
            language.indentOnInput(),
            language.bracketMatching(),
            autocomplete.closeBrackets(),
            search.highlightSelectionMatches(),
            language.syntaxHighlighting(light ? language.defaultHighlightStyle : oneDark.oneDarkHighlightStyle, { fallback: true }),
            state.EditorState.tabSize.of(2),
            view.keymap.of([
              { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
              commands.indentWithTab,
              ...autocomplete.closeBracketsKeymap,
              ...commands.defaultKeymap,
              ...commands.historyKeymap,
              ...search.searchKeymap,
            ]),
            view.EditorView.updateListener.of((update) => { if (update.docChanged) onChangeRef.current(update.state.doc.toString()); }),
            ...(lang ? [lang] : []),
          ],
        }),
      });
      destroy = () => editor.destroy();
      setReady(true);
    })();
    return () => { cancelled = true; destroy(); };
    // The editor is created once per file (the parent keys it by path); later typing lives in CodeMirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`bt-editor${ready ? " is-ready" : ""}`}>
      {!ready && <div className="bt-editor-loading"><span className="bt-spinner" aria-hidden="true" />กำลังเตรียมตัวแก้โค้ด</div>}
      <div className="bt-editor-host" ref={host} />
    </div>
  );
}
