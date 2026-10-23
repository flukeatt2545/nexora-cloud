// Turns what the owner picked (one ZIP, some files, or a whole folder) into a single ZIP for
// POST /api/bots/:id/deploy, so the server keeps checking one archive the way it always has.

export const BOT_ZIP_LIMIT = 50 * 1024 * 1024;
const RAW_LIMIT = 200 * 1024 * 1024;
const FILE_LIMIT = 5000;

// Same folders and files the server leaves out (backend/bot_files.go botSkippedPath); skipping them
// here means they are never read from disk or sent.
const skippedDirs = new Set(["node_modules", "__pycache__", ".git", ".venv", "venv", ".idea", ".vscode", ".deps", ".mypy_cache", ".pytest_cache"]);
const skippedFiles = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const otherArchive = /\.(rar|7z|tar|gz|tgz|bz2|xz)$/i;

export type PickedFile = { path: string; file: File };
export type BotPick =
  | { kind: "zip"; file: File }
  | { kind: "files"; files: PickedFile[]; skipped: number; size: number };

function skipped(path: string) {
  const parts = path.toLowerCase().split("/");
  return parts.slice(0, -1).some((part) => skippedDirs.has(part)) || skippedFiles.has(parts[parts.length - 1]);
}

/** Drops a folder name that every path shares, so "bot-test/bot.py" shows and uploads as "bot.py". */
function dropCommonRoot(files: PickedFile[]) {
  const first = files[0]?.path.split("/")[0];
  if (!first || !files.every((item) => item.path.startsWith(`${first}/`))) return files;
  return files.map((item) => ({ ...item, path: item.path.slice(first.length + 1) }));
}

/** Checks a selection and says in Thai what is wrong with it; throws when nothing usable is left. */
export function makeBotPick(picked: PickedFile[], skippedAlready = 0): BotPick {
  if (picked.length === 0 && skippedAlready === 0) throw new Error("ไม่พบไฟล์ในที่เลือก ลองเลือกใหม่อีกครั้ง");
  const archives = picked.filter((item) => /\.zip$/i.test(item.path));
  if (picked.length === 1 && archives.length === 1) {
    if (picked[0].file.size > BOT_ZIP_LIMIT) throw new Error("ไฟล์ ZIP ใหญ่เกิน 50 MB ลบโฟลเดอร์ node_modules ออกก่อนบีบอัด");
    return { kind: "zip", file: picked[0].file };
  }
  if (picked.length === 1 && otherArchive.test(picked[0].path)) {
    throw new Error("รองรับเฉพาะไฟล์ .zip ถ้าเป็น .rar .7z หรือ .tar ให้แตกไฟล์ก่อน แล้วเลือกทั้งโฟลเดอร์แทน");
  }
  // A ZIP picked next to loose files is almost always a mistake; inside a folder it may be a bot asset.
  if (archives.some((item) => !item.path.includes("/"))) {
    throw new Error("เลือกไฟล์ ZIP ได้ทีละไฟล์ และไม่รวมกับไฟล์อื่น");
  }
  const files = dropCommonRoot(picked.map((item) => ({ ...item, path: item.path.replace(/\\/g, "/").replace(/^\/+/, "") })));
  const kept = files.filter((item) => !skipped(item.path));
  const skippedCount = skippedAlready + files.length - kept.length;
  if (kept.length === 0) throw new Error("ไม่พบไฟล์โค้ดในที่เลือก (ข้าม node_modules, .venv, __pycache__ และ .git ให้อัตโนมัติ)");
  if (kept.length > FILE_LIMIT) throw new Error(`ไฟล์เยอะเกินไป (เกิน ${FILE_LIMIT} ไฟล์) เลือกเฉพาะโฟลเดอร์ของบอท`);
  const size = kept.reduce((total, item) => total + item.file.size, 0);
  if (size > RAW_LIMIT) throw new Error("โค้ดรวมกันใหญ่เกิน 200 MB เลือกเฉพาะไฟล์ที่บอทใช้");
  kept.sort((a, b) => a.path.localeCompare(b.path));
  return { kind: "files", files: kept, skipped: skippedCount, size };
}

/** Files from an <input type="file">, with folder paths when it was a webkitdirectory input. */
export function pickedFromInput(list: FileList | null): PickedFile[] {
  return Array.from(list ?? [], (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

function readAllEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries hands back at most ~100 entries per call, so keep asking until it returns none.
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(all);
      else { all.push(...batch); next(); }
    }, reject);
    next();
  });
}

function entryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

/**
 * Walks dropped files and folders. Entries must be taken from the drop event before any await,
 * because the browser empties dataTransfer once the handler returns.
 */
export async function pickedFromEntries(entries: FileSystemEntry[]) {
  const files: PickedFile[] = [];
  let skippedCount = 0;
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    const path = entry.fullPath.replace(/^\/+/, "") || entry.name;
    if (entry.isDirectory) {
      if (skippedDirs.has(entry.name.toLowerCase())) { skippedCount += 1; return; }
      for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) await walk(child);
      return;
    }
    if (entry.isFile) files.push({ path, file: await entryFile(entry as FileSystemFileEntry) });
  };
  for (const entry of entries) await walk(entry);
  return { files, skipped: skippedCount };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Builds a plain ZIP (deflate where the browser can, stored otherwise) from the picked files. */
export async function zipPickedFiles(files: PickedFile[], onProgress?: (percent: number) => void): Promise<File> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const [index, item] of files.entries()) {
    const name = new Uint8Array(encoder.encode(item.path));
    const raw = new Uint8Array(await item.file.arrayBuffer());
    const crc = crc32(raw);
    const deflated = await deflateRaw(raw);
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, body);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, method, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + body.length;
    if (offset > BOT_ZIP_LIMIT) throw new Error("โค้ดหลังบีบอัดใหญ่เกิน 50 MB เลือกเฉพาะไฟล์ที่บอทใช้");
    onProgress?.(Math.round(((index + 1) / files.length) * 100));
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new File([...parts, ...central, end.buffer], "bot.zip", { type: "application/zip" });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
