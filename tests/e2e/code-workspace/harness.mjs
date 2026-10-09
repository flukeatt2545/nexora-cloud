import path from 'node:path';

export function canonicalWorkspacePath(inputPath, allowWildcard = false) {
  if (typeof inputPath !== 'string') return { path: '', valid: false };
  let normalized = inputPath.replace(/\\/g, '/').trim();
  normalized = normalized.replace(/^\/+/, '');
  if (!normalized) return { path: '', valid: true };

  const segments = normalized.split('/');
  const clean = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return { path: '', valid: false };
    if (!allowWildcard && (seg.includes('*') || seg.includes('?'))) {
      return { path: '', valid: false };
    }
    clean.push(seg);
  }
  return { path: clean.join('/'), valid: true };
}

export function editableWorkspacePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.endsWith('/') || inputPath.endsWith('\\')) {
    return { path: '', valid: false };
  }
  const { path: clean, valid } = canonicalWorkspacePath(inputPath, false);
  if (!valid || !clean) return { path: '', valid: false };
  return { path: clean, valid: true };
}

export function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const base = path.basename(filename).toLowerCase();
  
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'nginx.conf' || base.endsWith('.nginx') || base.endsWith('.conf')) return 'nginx';
  if (base === 'package.json' || base === 'tsconfig.json' || base === 'composer.json') return 'json';
  if (base === '.env' || base.startsWith('.env.')) return 'shell';
  if (base === 'makefile') return 'shell';

  const ext = path.extname(base).toLowerCase();
  switch (ext) {
    case '.php':
    case '.phtml':
    case '.blade.php':
      return 'php';
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.jsx':
      return 'javascript';
    case '.ts':
    case '.mts':
    case '.cts':
    case '.tsx':
      return 'typescript';
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return 'css';
    case '.json':
      return 'json';
    case '.py':
    case '.pyw':
      return 'python';
    case '.go':
      return 'go';
    case '.sql':
      return 'sql';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'shell';
    case '.xml':
    case '.svg':
      return 'html';
    default:
      return 'plaintext';
  }
}

export function resolveFileIcon(filename, isDir = false) {
  if (isDir) {
    return { icon: 'Folder', color: '#eab308' };
  }
  const lang = detectLanguage(filename);
  switch (lang) {
    case 'php':
      return { icon: 'FileCode', color: '#818cf8' };
    case 'javascript':
      return { icon: 'FileCode2', color: '#facc15' };
    case 'typescript':
      return { icon: 'FileCode2', color: '#60a5fa' };
    case 'html':
      return { icon: 'FileCode', color: '#fb923c' };
    case 'css':
      return { icon: 'FileSpreadsheet', color: '#38bdf8' };
    case 'json':
      return { icon: 'FileJson', color: '#a3e635' };
    case 'python':
      return { icon: 'FileCode', color: '#38bdf8' };
    case 'go':
      return { icon: 'FileCode', color: '#2dd4bf' };
    case 'sql':
      return { icon: 'Database', color: '#f472b6' };
    case 'markdown':
      return { icon: 'FileText', color: '#94a3b8' };
    case 'yaml':
      return { icon: 'FileJson', color: '#c084fc' };
    case 'dockerfile':
      return { icon: 'Container', color: '#38bdf8' };
    case 'nginx':
      return { icon: 'Server', color: '#4ade80' };
    case 'shell':
      return { icon: 'Terminal', color: '#4ade80' };
    default:
      return { icon: 'File', color: '#94a3b8' };
  }
}

export function computeLineDiff(oldText = '', newText = '') {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const hunks = [];
  let additions = 0;
  let deletions = 0;

  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      hunks.push({ type: 'unchanged', line: oldLines[i], oldLine: oldLineNum++, newLine: newLineNum++ });
      i++;
      j++;
    } else {
      let foundInNew = -1;
      let foundInOld = -1;
      for (let k = j; k < Math.min(j + 5, newLines.length); k++) {
        if (i < oldLines.length && oldLines[i] === newLines[k]) {
          foundInNew = k;
          break;
        }
      }
      for (let k = i; k < Math.min(i + 5, oldLines.length); k++) {
        if (j < newLines.length && oldLines[k] === newLines[j]) {
          foundInOld = k;
          break;
        }
      }

      if (foundInNew !== -1 && (foundInOld === -1 || (foundInNew - j) <= (foundInOld - i))) {
        while (j < foundInNew) {
          hunks.push({ type: 'added', line: newLines[j], newLine: newLineNum++ });
          additions++;
          j++;
        }
      } else if (foundInOld !== -1) {
        while (i < foundInOld) {
          hunks.push({ type: 'deleted', line: oldLines[i], oldLine: oldLineNum++ });
          deletions++;
          i++;
        }
      } else {
        if (i < oldLines.length) {
          hunks.push({ type: 'deleted', line: oldLines[i], oldLine: oldLineNum++ });
          deletions++;
          i++;
        }
        if (j < newLines.length) {
          hunks.push({ type: 'added', line: newLines[j], newLine: newLineNum++ });
          additions++;
          j++;
        }
      }
    }
  }

  return { additions, deletions, hunks };
}

export class MockHostingBackend {
  constructor(initialFiles = {}) {
    this.files = new Map();
    this.siteId = 'site_1001';
    this.maxEditorSize = 2 * 1024 * 1024;
    this.maxUploadSize = 20 * 1024 * 1024;
    this.seedFiles(initialFiles);
  }

  seedFiles(filesObj) {
    for (const [filePath, content] of Object.entries(filesObj)) {
      const { path: clean } = canonicalWorkspacePath(filePath);
      if (typeof content === 'object' && content !== null && content.isDir) {
        this.files.set(clean, { data: Buffer.alloc(0), isDir: true, updatedAt: new Date() });
      } else {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
        this.files.set(clean, { data: buf, isDir: false, updatedAt: new Date() });
        const parts = clean.split('/');
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join('/');
          if (!this.files.has(parent)) {
            this.files.set(parent, { data: Buffer.alloc(0), isDir: true, updatedAt: new Date() });
          }
        }
      }
    }
  }

  listFiles(dirPath = '') {
    const { path: clean, valid } = canonicalWorkspacePath(dirPath);
    if (!valid) throw new Error('400: invalid_path');

    const prefix = clean ? clean + '/' : '';
    const itemsMap = new Map();

    for (const [filePath, entry] of this.files.entries()) {
      if (!filePath.startsWith(prefix) || filePath === clean) continue;
      const rel = filePath.slice(prefix.length);
      const first = rel.split('/')[0];
      const childPath = clean ? (clean + '/' + first) : first;
      const isDir = entry.isDir || rel.includes('/');

      if (!itemsMap.has(first)) {
        itemsMap.set(first, {
          name: first,
          path: childPath,
          type: isDir ? 'directory' : 'file',
          size: isDir ? 0 : entry.data.length
        });
      } else if (isDir) {
        itemsMap.get(first).type = 'directory';
        itemsMap.get(first).size = 0;
      }
    }

    const items = Array.from(itemsMap.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return { path: clean, items };
  }

  readFile(filePath) {
    const { path: clean, valid } = editableWorkspacePath(filePath);
    if (!valid) throw new Error('400: invalid_path');
    const entry = this.files.get(clean);
    if (!entry || entry.isDir) throw new Error('404: file_not_found');

    if (entry.data.length > this.maxEditorSize) {
      throw new Error('415: file_too_large_for_editor');
    }
    if (entry.data.includes(0)) {
      throw new Error('415: not_editable');
    }

    const text = entry.data.toString('utf8');
    return { path: clean, content: text, size: entry.data.length };
  }

  previewFile(filePath, newContent) {
    const { path: clean, valid } = editableWorkspacePath(filePath);
    if (!valid) throw new Error('400: invalid_path');
    if (Buffer.byteLength(newContent, 'utf8') > this.maxEditorSize) {
      throw new Error('400: file_too_large');
    }
    let old = '';
    const entry = this.files.get(clean);
    if (entry && !entry.isDir) {
      old = entry.data.toString('utf8');
    }
    return computeLineDiff(old, newContent);
  }

  saveFile(filePath, content, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: clean, valid } = editableWorkspacePath(filePath);
    if (!valid) throw new Error('400: invalid_path');
    const buf = Buffer.from(content, 'utf8');
    if (buf.length > this.maxEditorSize) {
      throw new Error('400: file_too_large');
    }
    this.files.set(clean, { data: buf, isDir: false, updatedAt: new Date() });
    return { success: true, path: clean, size: buf.length };
  }

  createFolder(folderPath, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: clean, valid } = canonicalWorkspacePath(folderPath);
    if (!valid || !clean) throw new Error('400: invalid_path');
    if (this.files.has(clean)) throw new Error('409: path_exists');
    this.files.set(clean, { data: Buffer.alloc(0), isDir: true, updatedAt: new Date() });
    return { success: true, path: clean };
  }

  moveFile(fromPath, toPath, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: fromClean, valid: fromValid } = canonicalWorkspacePath(fromPath);
    const { path: toClean, valid: toValid } = canonicalWorkspacePath(toPath);
    if (!fromValid || !toValid || !fromClean || !toClean) throw new Error('400: invalid_path');
    if (this.files.has(toClean)) throw new Error('409: path_exists');

    let movedCount = 0;
    const entries = Array.from(this.files.entries());
    for (const [p, entry] of entries) {
      if (p === fromClean) {
        this.files.delete(p);
        this.files.set(toClean, entry);
        movedCount++;
      } else if (p.startsWith(fromClean + '/')) {
        const nextPath = toClean + p.slice(fromClean.length);
        this.files.delete(p);
        this.files.set(nextPath, entry);
        movedCount++;
      }
    }
    if (movedCount === 0) throw new Error('404: not_found');
    return { success: true, from: fromClean, to: toClean, movedCount };
  }

  deleteFile(filePath, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: clean, valid } = canonicalWorkspacePath(filePath);
    if (!valid || !clean) throw new Error('400: invalid_path');

    let deleted = false;
    for (const [p] of Array.from(this.files.entries())) {
      if (p === clean || p.startsWith(clean + '/')) {
        this.files.delete(p);
        deleted = true;
      }
    }
    if (!deleted) throw new Error('404: not_found');
    return { success: true, path: clean };
  }

  uploadFile(targetDir, filename, contentBuffer, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    if (contentBuffer.length > this.maxUploadSize) throw new Error('400: file_too_large');
    const base = path.basename(filename.replace(/\\/g, '/'));
    const dirClean = canonicalWorkspacePath(targetDir).path;
    const target = dirClean ? (dirClean + '/' + base) : base;
    const { path: clean, valid } = canonicalWorkspacePath(target);
    if (!valid || !clean) throw new Error('400: invalid_path');

    this.files.set(clean, { data: contentBuffer, isDir: false, updatedAt: new Date() });
    return { success: true, path: clean, size: contentBuffer.length };
  }

  downloadFile(filePath) {
    const { path: clean, valid } = canonicalWorkspacePath(filePath);
    if (!valid || !clean) throw new Error('400: invalid_path');
    const entry = this.files.get(clean);
    if (!entry || entry.isDir) throw new Error('404: not_found');
    return {
      path: clean,
      filename: path.basename(clean),
      data: entry.data,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + path.basename(clean) + '"'
      }
    };
  }

  archiveFiles(paths, targetZipName, role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: targetClean, valid } = canonicalWorkspacePath(targetZipName);
    if (!valid || !targetClean || !targetClean.endsWith('.zip')) {
      throw new Error('400: invalid_archive_target');
    }
    let matched = 0;
    for (const reqPath of paths) {
      const { path: c } = canonicalWorkspacePath(reqPath);
      for (const [p] of this.files.entries()) {
        if (p === c || p.startsWith(c + '/')) matched++;
      }
    }
    if (matched === 0) throw new Error('404: no_files_matched');
    this.files.set(targetClean, { data: Buffer.from('PK\x03\x04 simulated zip content'), isDir: false, updatedAt: new Date() });
    return { success: true, target: targetClean, archivedFiles: matched };
  }

  extractArchive(zipPath, targetDir = '', role = 'owner') {
    if (role === 'viewer') throw new Error('403: viewer_readonly');
    const { path: zipClean, valid: zipValid } = canonicalWorkspacePath(zipPath);
    if (!zipValid || !zipClean) throw new Error('400: invalid_path');
    const entry = this.files.get(zipClean);
    if (!entry) throw new Error('404: archive_not_found');

    const { path: dirClean } = canonicalWorkspacePath(targetDir);
    const extractedFile = dirClean ? (dirClean + '/extracted_sample.txt') : 'extracted_sample.txt';
    this.files.set(extractedFile, { data: Buffer.from('Extracted content from ' + zipClean), isDir: false, updatedAt: new Date() });
    return { success: true, targetDir: dirClean, extracted: [extractedFile] };
  }
}

export class WorkspaceSession {
  constructor({ backend, role = 'owner', siteId = 'site_1001', isMobile = false }) {
    this.backend = backend;
    this.role = role;
    this.siteId = siteId;
    this.isMobile = isMobile;

    this.tabs = [];
    this.activeTabId = null;
    this.expandedFolders = new Set();
    this.treeCache = new Map();
    this.dialog = null;
    this.notifications = [];
    this.searchQuery = { text: '', replaceText: '', matchCase: false, isRegex: false, matches: [] };
    this.cursorPosition = { line: 1, col: 1 };
  }

  notify(message, type = 'info') {
    this.notifications.push({ message, type, timestamp: Date.now() });
  }

  async loadTree(dirPath = '') {
    const res = this.backend.listFiles(dirPath);
    this.treeCache.set(res.path, res.items);
    return res.items;
  }

  toggleFolder(folderPath) {
    if (this.expandedFolders.has(folderPath)) {
      this.expandedFolders.delete(folderPath);
    } else {
      this.expandedFolders.add(folderPath);
      this.loadTree(folderPath);
    }
  }

  async openFile(filePath) {
    const { path: clean } = canonicalWorkspacePath(filePath);
    const existing = this.tabs.find(t => t.path === clean);
    if (existing) {
      this.activeTabId = existing.id;
      return existing;
    }

    const fileData = this.backend.readFile(clean);
    const lang = detectLanguage(clean);
    const newTab = {
      id: clean,
      path: clean,
      name: path.basename(clean),
      originalContent: fileData.content,
      currentContent: fileData.content,
      isDirty: false,
      language: lang,
      scrollPosition: 0,
      cursorPosition: { line: 1, col: 1 }
    };
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
    return newTab;
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId) || null;
  }

  switchTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      this.activeTabId = tab.id;
      this.cursorPosition = tab.cursorPosition || { line: 1, col: 1 };
    }
  }

  updateActiveContent(newContent) {
    const tab = this.getActiveTab();
    if (!tab) return;
    if (this.role === 'viewer') {
      throw new Error('Cannot modify content in read-only viewer mode');
    }
    tab.currentContent = newContent;
    tab.isDirty = (tab.currentContent !== tab.originalContent);
  }

  updateCursor(line, col) {
    this.cursorPosition = { line, col };
    const tab = this.getActiveTab();
    if (tab) {
      tab.cursorPosition = { line, col };
    }
  }

  closeTab(tabId, force = false) {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const tab = this.tabs[idx];
    if (tab.isDirty && !force) {
      this.dialog = {
        type: 'unsaved_confirm',
        tabId: tab.id,
        filename: tab.name
      };
      return { requiresConfirmation: true, tab };
    }

    this.tabs.splice(idx, 1);
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        this.activeTabId = this.tabs[nextIdx].id;
      } else {
        this.activeTabId = null;
      }
    }
    return { requiresConfirmation: false };
  }

  confirmDiscardAndClose() {
    if (this.dialog && this.dialog.type === 'unsaved_confirm') {
      const tabId = this.dialog.tabId;
      this.dialog = null;
      return this.closeTab(tabId, true);
    }
  }

  async triggerSave(withDiffPreview = false) {
    const tab = this.getActiveTab();
    if (!tab) return;
    if (this.role === 'viewer') {
      throw new Error('403: viewer_readonly');
    }

    if (withDiffPreview && tab.isDirty) {
      const diff = this.backend.previewFile(tab.path, tab.currentContent);
      this.dialog = {
        type: 'diff',
        tabId: tab.id,
        diff
      };
      return { status: 'diff_requested', diff };
    }

    const res = this.backend.saveFile(tab.path, tab.currentContent, this.role);
    tab.originalContent = tab.currentContent;
    tab.isDirty = false;
    this.notify('บันทึกไฟล์ ' + tab.name + ' สำเร็จ', 'success');
    return { status: 'saved', result: res };
  }

  confirmDiffAndSave() {
    if (this.dialog && this.dialog.type === 'diff') {
      const tabId = this.dialog.tabId;
      this.dialog = null;
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        const res = this.backend.saveFile(tab.path, tab.currentContent, this.role);
        tab.originalContent = tab.currentContent;
        tab.isDirty = false;
        this.notify('บันทึกไฟล์ ' + tab.name + ' สำเร็จ', 'success');
        return { status: 'saved', result: res };
      }
    }
  }

  search(query, matchCase = false, isRegex = false) {
    const tab = this.getActiveTab();
    if (!tab) return [];
    this.searchQuery = { text: query, matchCase, isRegex, matches: [] };
    if (!query) return [];

    const content = tab.currentContent;
    const matches = [];
    if (isRegex) {
      try {
        const re = new RegExp(query, matchCase ? 'g' : 'gi');
        let m;
        while ((m = re.exec(content)) !== null) {
          matches.push({ index: m.index, length: m[0].length, text: m[0] });
        }
      } catch {
        // Invalid regex
      }
    } else {
      const src = matchCase ? content : content.toLowerCase();
      const target = matchCase ? query : query.toLowerCase();
      let pos = 0;
      while ((pos = src.indexOf(target, pos)) !== null && pos !== -1) {
        matches.push({ index: pos, length: query.length, text: content.slice(pos, pos + query.length) });
        pos += query.length;
      }
    }
    this.searchQuery.matches = matches;
    return matches;
  }

  replaceAll(query, replacement, matchCase = false, isRegex = false) {
    const tab = this.getActiveTab();
    if (!tab) return 0;
    if (this.role === 'viewer') throw new Error('Viewer mode is read-only');

    const matches = this.search(query, matchCase, isRegex);
    if (matches.length === 0) return 0;

    let newContent = tab.currentContent;
    if (isRegex) {
      const re = new RegExp(query, matchCase ? 'g' : 'gi');
      newContent = newContent.replace(re, replacement);
    } else {
      newContent = newContent.split(query).join(replacement);
    }
    this.updateActiveContent(newContent);
    return matches.length;
  }

  getStatusInfo() {
    const tab = this.getActiveTab();
    return {
      path: tab ? tab.path : 'No file open',
      language: tab ? tab.language : 'plaintext',
      line: this.cursorPosition.line,
      col: this.cursorPosition.col,
      isDirty: tab ? tab.isDirty : false,
      role: this.role,
      isReadOnly: this.role === 'viewer'
    };
  }
}