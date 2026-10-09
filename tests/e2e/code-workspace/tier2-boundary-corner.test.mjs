import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockHostingBackend,
  WorkspaceSession,
  canonicalWorkspacePath,
  detectLanguage,
  computeLineDiff
} from './harness.mjs';

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (>=5 test cases per boundary category)
// ============================================================================

// Boundary 1: Empty Files (0-byte Edge Cases)
test('Boundary 1.1: 0-byte file loads successfully as empty string', async () => {
  const backend = new MockHostingBackend({ 'empty.txt': '' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('empty.txt');
  assert.equal(tab.originalContent, '');
  assert.equal(tab.currentContent, '');
  assert.equal(tab.isDirty, false);
});

test('Boundary 1.2: Saving empty string to empty file retains 0-byte state without corruption', async () => {
  const backend = new MockHostingBackend({ 'empty.php': '' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('empty.php');
  session.updateActiveContent('');
  const res = await session.triggerSave(false);
  assert.equal(res.status, 'saved');
  assert.equal(backend.readFile('empty.php').size, 0);
});

test('Boundary 1.3: Editing empty file to non-empty produces all additions in diff', async () => {
  const backend = new MockHostingBackend({ 'init.js': '' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('init.js');
  session.updateActiveContent('const a = 1;\nconst b = 2;');
  const diff = backend.previewFile('init.js', session.getActiveTab().currentContent);
  assert.equal(diff.deletions, 0);
  assert.equal(diff.additions, 2);
});

test('Boundary 1.4: Clearing all content from non-empty file produces all deletions in diff', async () => {
  const backend = new MockHostingBackend({ 'clear.css': 'body {\n  color: red;\n}' });
  const diff = backend.previewFile('clear.css', '');
  assert.equal(diff.additions, 0);
  assert.equal(diff.deletions, 3);
});

test('Boundary 1.5: Syntax detection on empty file (.php, .ts, .py) still determines correct language', () => {
  assert.equal(detectLanguage('empty.php'), 'php');
  assert.equal(detectLanguage('empty.ts'), 'typescript');
  assert.equal(detectLanguage('empty.py'), 'python');
  assert.equal(detectLanguage('empty.sql'), 'sql');
});

// Boundary 2: Massive Files Approaching 2MB Limit
test('Boundary 2.1: 1.95MB text file loads and opens in tab successfully', async () => {
  const largeContent = 'A'.repeat(Math.floor(1.95 * 1024 * 1024));
  const backend = new MockHostingBackend({ 'large.txt': largeContent });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('large.txt');
  assert.equal(tab.originalContent.length, largeContent.length);
});

test('Boundary 2.2: File exceeding 2MB limit (2.05MB) is rejected by backend with 415 error', () => {
  const oversizedContent = 'B'.repeat(Math.floor(2.05 * 1024 * 1024));
  const backend = new MockHostingBackend({ 'huge.txt': oversizedContent });
  assert.throws(() => backend.readFile('huge.txt'), /415/);
});

test('Boundary 2.3: Line splitting & diff on 10,000 line file completes within performance budget', () => {
  const lines = Array.from({ length: 10000 }, (_, i) => 'Line ' + i).join('\n');
  const modified = Array.from({ length: 10000 }, (_, i) => i === 5000 ? 'Modified Line 5000' : 'Line ' + i).join('\n');
  const start = Date.now();
  const diff = computeLineDiff(lines, modified);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, 'Diff on 10k lines should execute under 3000ms');
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);
});

test('Boundary 2.4: Search and replace on large file matches all instances accurately', async () => {
  const repeatedText = 'hello world\n'.repeat(5000);
  const backend = new MockHostingBackend({ 'search_huge.txt': repeatedText });
  const session = new WorkspaceSession({ backend });
  await session.openFile('search_huge.txt');

  const matches = session.search('hello', false, false);
  assert.equal(matches.length, 5000);

  const replacedCount = session.replaceAll('world', 'nexora', false, false);
  assert.equal(replacedCount, 5000);
  assert.ok(session.getActiveTab().currentContent.startsWith('hello nexora'));
});

test('Boundary 2.5: Saving 1.95MB file succeeds within payload limit', async () => {
  const largeContent = 'Z'.repeat(Math.floor(1.95 * 1024 * 1024));
  const backend = new MockHostingBackend({ 'save_large.txt': 'initial' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('save_large.txt');
  session.updateActiveContent(largeContent);

  const saveRes = await session.triggerSave(false);
  assert.equal(saveRes.status, 'saved');
  assert.equal(backend.readFile('save_large.txt').size, largeContent.length);
});

// Boundary 3: Deep Folder Structures (10+ Levels)
test('Boundary 3.1: 12-level nested path loads and canonicalizes without path truncation', () => {
  const deepPath = 'l1/l2/l3/l4/l5/l6/l7/l8/l9/l10/l11/deep.ts';
  const { path: clean, valid } = canonicalWorkspacePath(deepPath);
  assert.equal(valid, true);
  assert.equal(clean, deepPath);
});

test('Boundary 3.2: Tree listing at level 10 correctly returns level 11 children', () => {
  const deepPath = 'l1/l2/l3/l4/l5/l6/l7/l8/l9/l10/l11/file.txt';
  const backend = new MockHostingBackend({ [deepPath]: 'deep data' });
  const res = backend.listFiles('l1/l2/l3/l4/l5/l6/l7/l8/l9/l10');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].name, 'l11');
  assert.equal(res.items[0].type, 'directory');
});

test('Boundary 3.3: Moving deep folder tree relocates all descendants preserving structure', () => {
  const deepPath = 'old_root/a/b/c/d/e/f/g/h/i/j/nested.php';
  const backend = new MockHostingBackend({ [deepPath]: '<?php echo "deep";' });
  const moveRes = backend.moveFile('old_root', 'new_root', 'owner');
  assert.equal(moveRes.success, true);
  assert.equal(backend.readFile('new_root/a/b/c/d/e/f/g/h/i/j/nested.php').content, '<?php echo "deep";');
});

test('Boundary 3.4: Deleting top ancestor recursively cleans all 10+ nested levels', () => {
  const deepPath = 'root_to_del/1/2/3/4/5/6/7/8/9/10/file.txt';
  const backend = new MockHostingBackend({ [deepPath]: 'data' });
  backend.deleteFile('root_to_del', 'owner');
  assert.equal(backend.files.size, 0);
});

test('Boundary 3.5: Opening deep file in tab correctly captures basename and relative path', async () => {
  const deepPath = 'apps/backend/src/modules/billing/services/invoicing/v2/InvoiceGenerator.php';
  const backend = new MockHostingBackend({ [deepPath]: '<?php class InvoiceGenerator {}' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile(deepPath);
  assert.equal(tab.name, 'InvoiceGenerator.php');
  assert.equal(tab.path, deepPath);
});

// Boundary 4: Special Characters & Unicode / Thai Names
test('Boundary 4.1: Thai language directory and filename loads, edits, and saves correctly', async () => {
  const thaiPath = 'ภาษาไทย/ระบบจัดการผู้ใช้.php';
  const backend = new MockHostingBackend({ [thaiPath]: '<?php echo "สวัสดี";' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile(thaiPath);
  assert.equal(tab.name, 'ระบบจัดการผู้ใช้.php');

  session.updateActiveContent('<?php echo "แก้ไขแล้ว";');
  await session.triggerSave(false);
  assert.equal(backend.readFile(thaiPath).content, '<?php echo "แก้ไขแล้ว";');
});

test('Boundary 4.2: Spaces in filenames canonicalize and download properly', () => {
  const spacedPath = 'My Documents/Project Proposal 2026.md';
  const backend = new MockHostingBackend({ [spacedPath]: '# Proposal' });
  const dl = backend.downloadFile(spacedPath);
  assert.equal(dl.filename, 'Project Proposal 2026.md');
  assert.match(dl.headers['Content-Disposition'], /Project Proposal 2026\.md/);
});

test('Boundary 4.3: Symbols in filenames (@, _, -, ., [], (), !) handle without corruption', async () => {
  const symPath = 'config/@scope_v2.0-beta.1(release)#[test]!.json';
  const backend = new MockHostingBackend({ [symPath]: '{"scope": true}' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile(symPath);
  assert.equal(tab.name, '@scope_v2.0-beta.1(release)#[test]!.json');
  assert.equal(tab.language, 'json');
});

test('Boundary 4.4: Canonical path normalizes double slashes and backslashes with Unicode', () => {
  const mixedPath = 'โฟลเดอร์\\ย่อย//ไฟล์.txt';
  const { path: clean, valid } = canonicalWorkspacePath(mixedPath);
  assert.equal(valid, true);
  assert.equal(clean, 'โฟลเดอร์/ย่อย/ไฟล์.txt');
});

test('Boundary 4.5: Diff computation on Unicode / Thai text retains UTF-8 characters without mangling', () => {
  const oldText = 'แถวที่ 1: ข้อมูลเดิม\nแถวที่ 2: ไม่เปลี่ยนแปลง';
  const newText = 'แถวที่ 1: ข้อมูลใหม่\nแถวที่ 2: ไม่เปลี่ยนแปลง';
  const diff = computeLineDiff(oldText, newText);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);
  assert.equal(diff.hunks.find(h => h.type === 'added').line, 'แถวที่ 1: ข้อมูลใหม่');
});
// Boundary 5: Binary & Unsupported Media Types
test('Boundary 5.1: Binary file containing null bytes (\x00) is rejected for editor with 415 not_editable', () => {
  const binBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  const backend = new MockHostingBackend({ 'image.png': binBuf });
  assert.throws(() => backend.readFile('image.png'), /415: not_editable/);
});

test('Boundary 5.2: Image files (.png, .jpg) are recognized as binary / non-editable in editor', () => {
  const imgBuf = Buffer.from('GIF89a\x00\x00', 'binary');
  const backend = new MockHostingBackend({ 'photo.gif': imgBuf });
  assert.throws(() => backend.readFile('photo.gif'), /415: not_editable/);
});

test('Boundary 5.3: Zip archive is non-editable in editor but downloadable / extractable', () => {
  const zipBuf = Buffer.from('PK\x03\x04\x00\x00\x00\x00', 'binary');
  const backend = new MockHostingBackend({ 'archive.zip': zipBuf });
  assert.throws(() => backend.readFile('archive.zip'), /415: not_editable/);

  const dl = backend.downloadFile('archive.zip');
  assert.equal(dl.filename, 'archive.zip');
});

test('Boundary 5.4: Non-UTF-8 binary data download returns octet-stream header', () => {
  const binData = Buffer.from([0xff, 0xfe, 0x00, 0x00, 0xaa, 0xbb]);
  const backend = new MockHostingBackend({ 'blob.dat': binData });
  const dl = backend.downloadFile('blob.dat');
  assert.equal(dl.headers['Content-Type'], 'application/octet-stream');
});

test('Boundary 5.5: Attempting to preview binary file returns 415 unsupported media type', () => {
  const binBuf = Buffer.from([0x00, 0xff]);
  const backend = new MockHostingBackend({ 'raw.bin': binBuf });
  assert.throws(() => backend.readFile('raw.bin'), /415: not_editable/);
});

// Boundary 6: Rapid Tab Switching
test('Boundary 6.1: Rapid switching between 10 open tabs preserves each tab dirty status', async () => {
  const filesObj = {};
  for (let i = 1; i <= 10; i++) {
    filesObj['file_' + i + '.txt'] = 'Content ' + i;
  }
  const backend = new MockHostingBackend(filesObj);
  const session = new WorkspaceSession({ backend });

  for (let i = 1; i <= 10; i++) {
    await session.openFile('file_' + i + '.txt');
  }

  for (let i = 1; i <= 10; i += 2) {
    session.switchTab('file_' + i + '.txt');
    session.updateActiveContent('Modified Content ' + i);
  }

  for (let round = 0; round < 3; round++) {
    for (let i = 1; i <= 10; i++) {
      session.switchTab('file_' + i + '.txt');
      const tab = session.getActiveTab();
      if (i % 2 !== 0) {
        assert.equal(tab.isDirty, true, 'Odd tab ' + i + ' should remain dirty');
      } else {
        assert.equal(tab.isDirty, false, 'Even tab ' + i + ' should remain clean');
      }
    }
  }
});

test('Boundary 6.2: Rapid switching retains cursor positions for all 10 tabs', async () => {
  const filesObj = {};
  for (let i = 1; i <= 10; i++) filesObj['c_' + i + '.txt'] = 'C ' + i;
  const backend = new MockHostingBackend(filesObj);
  const session = new WorkspaceSession({ backend });

  for (let i = 1; i <= 10; i++) {
    await session.openFile('c_' + i + '.txt');
    session.updateCursor(i * 5, i * 2);
  }

  for (let i = 10; i >= 1; i--) {
    session.switchTab('c_' + i + '.txt');
    assert.deepEqual(session.cursorPosition, { line: i * 5, col: i * 2 });
  }
});

test('Boundary 6.3: Rapid switching does not leak memory or duplicate tabs', async () => {
  const backend = new MockHostingBackend({ 'a.txt': 'A', 'b.txt': 'B' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('a.txt');
  await session.openFile('b.txt');

  for (let i = 0; i < 100; i++) {
    session.switchTab(i % 2 === 0 ? 'a.txt' : 'b.txt');
  }
  assert.equal(session.tabs.length, 2);
});

test('Boundary 6.4: Switching to active tab is a no-op that maintains state', async () => {
  const backend = new MockHostingBackend({ 'stay.txt': 'Stay' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('stay.txt');
  session.updateActiveContent('Edits');
  session.switchTab('stay.txt');
  assert.equal(session.getActiveTab().currentContent, 'Edits');
});

test('Boundary 6.5: Alternating between 2 tabs with rapid edits maintains independent buffers', async () => {
  const backend = new MockHostingBackend({ 't1.js': '1', 't2.js': '2' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('t1.js');
  await session.openFile('t2.js');

  for (let step = 1; step <= 5; step++) {
    session.switchTab('t1.js');
    session.updateActiveContent('T1-Step-' + step);
    session.switchTab('t2.js');
    session.updateActiveContent('T2-Step-' + step);
  }

  session.switchTab('t1.js');
  assert.equal(session.getActiveTab().currentContent, 'T1-Step-5');
  session.switchTab('t2.js');
  assert.equal(session.getActiveTab().currentContent, 'T2-Step-5');
});

// Boundary 7: Rapid Typing & Auto-Dirty Toggling
test('Boundary 7.1: Rapid successive keystrokes append cleanly to currentContent', async () => {
  const backend = new MockHostingBackend({ 'type.txt': '' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('type.txt');

  let current = '';
  const textToAdd = 'Fast typing simulation 12345';
  for (const char of textToAdd) {
    current += char;
    session.updateActiveContent(current);
  }
  assert.equal(session.getActiveTab().currentContent, 'Fast typing simulation 12345');
  assert.equal(session.getActiveTab().isDirty, true);
});

test('Boundary 7.2: Dirty flag sets to true on first keystroke', async () => {
  const backend = new MockHostingBackend({ 'flag.txt': 'original' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('flag.txt');
  assert.equal(tab.isDirty, false);

  session.updateActiveContent('original ');
  assert.equal(tab.isDirty, true);
});

test('Boundary 7.3: Reverting edits back to originalContent automatically resets dirty flag to false', async () => {
  const backend = new MockHostingBackend({ 'revert.txt': 'exact match' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('revert.txt');

  session.updateActiveContent('exact match modified');
  assert.equal(tab.isDirty, true);

  session.updateActiveContent('exact match');
  assert.equal(tab.isDirty, false);
});

test('Boundary 7.4: Saving updates originalContent and clears dirty flag', async () => {
  const backend = new MockHostingBackend({ 'save_cycle.txt': 'v1' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('save_cycle.txt');

  session.updateActiveContent('v2');
  assert.equal(tab.isDirty, true);

  await session.triggerSave(false);
  assert.equal(tab.isDirty, false);
  assert.equal(tab.originalContent, 'v2');
});

test('Boundary 7.5: Rapid typing in viewer mode throws error on every attempt', async () => {
  const backend = new MockHostingBackend({ 'view_lock.txt': 'locked' });
  const session = new WorkspaceSession({ backend, role: 'viewer' });
  await session.openFile('view_lock.txt');

  for (let i = 0; i < 5; i++) {
    assert.throws(() => session.updateActiveContent('attempt ' + i), /read-only/);
  }
});

// Boundary 8: Closing Active vs Inactive Tabs
test('Boundary 8.1: Closing active tab activates next tab in list', async () => {
  const backend = new MockHostingBackend({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('a.txt');
  await session.openFile('b.txt');
  await session.openFile('c.txt');

  session.switchTab('b.txt');
  session.closeTab('b.txt');
  assert.equal(session.activeTabId, 'c.txt');
});

test('Boundary 8.2: Closing active tab when it is the last tab activates previous tab', async () => {
  const backend = new MockHostingBackend({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('a.txt');
  await session.openFile('b.txt');
  await session.openFile('c.txt');

  session.switchTab('c.txt');
  session.closeTab('c.txt');
  assert.equal(session.activeTabId, 'b.txt');
});

test('Boundary 8.3: Closing inactive clean tab leaves current active tab and editor focus untouched', async () => {
  const backend = new MockHostingBackend({ 'active.txt': '1', 'inactive.txt': '2' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('active.txt');
  await session.openFile('inactive.txt');

  session.switchTab('active.txt');
  session.closeTab('inactive.txt');
  assert.equal(session.activeTabId, 'active.txt');
  assert.equal(session.tabs.length, 1);
});

test('Boundary 8.4: Closing inactive dirty tab triggers confirmation dialog specifically for that tab', async () => {
  const backend = new MockHostingBackend({ 'active.txt': '1', 'inactive.txt': '2' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('active.txt');
  await session.openFile('inactive.txt');

  session.switchTab('inactive.txt');
  session.updateActiveContent('inactive dirty content');

  session.switchTab('active.txt');
  const closeRes = session.closeTab('inactive.txt');
  assert.equal(closeRes.requiresConfirmation, true);
  assert.equal(session.dialog.tabId, 'inactive.txt');
  assert.equal(session.activeTabId, 'active.txt');
});

test('Boundary 8.5: Closing all tabs sequentially empties workspace safely', async () => {
  const backend = new MockHostingBackend({ '1.txt': '1', '2.txt': '2' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('1.txt');
  await session.openFile('2.txt');

  session.closeTab('1.txt');
  session.closeTab('2.txt');
  assert.equal(session.tabs.length, 0);
  assert.equal(session.activeTabId, null);
  assert.equal(session.getStatusInfo().path, 'No file open');
});