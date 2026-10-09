import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockHostingBackend,
  WorkspaceSession
} from './harness.mjs';

// ============================================================================
// TIER 3: CROSS-FEATURE INTERACTIONS (Complex Workflows & State Combinations)
// ============================================================================

test('Scenario 3.1: Edit file -> switch tab -> create new file -> switch back -> diff dialog -> save -> verify state', async () => {
  const backend = new MockHostingBackend({
    'src/index.ts': 'export const API_URL = "http://localhost";',
    'src/config.ts': 'export const PORT = 3000;'
  });
  const session = new WorkspaceSession({ backend });

  // 1. Open index.ts and edit
  await session.openFile('src/index.ts');
  session.updateActiveContent('export const API_URL = "https://api.nexora.cloud";');
  assert.equal(session.getActiveTab().isDirty, true);

  // 2. Switch tab to config.ts
  await session.openFile('src/config.ts');
  assert.equal(session.activeTabId, 'src/config.ts');
  assert.equal(session.getActiveTab().isDirty, false);

  // 3. Create a new file via backend
  backend.saveFile('src/types.ts', 'export interface User { id: string; }', 'owner');
  const tree = await session.loadTree('src');
  assert.ok(tree.some(item => item.name === 'types.ts'));

  // 4. Switch back to index.ts
  session.switchTab('src/index.ts');
  assert.equal(session.getActiveTab().currentContent, 'export const API_URL = "https://api.nexora.cloud";');
  assert.equal(session.getActiveTab().isDirty, true);

  // 5. Trigger save with diff preview
  const diffRes = await session.triggerSave(true);
  assert.equal(diffRes.status, 'diff_requested');
  assert.equal(session.dialog.type, 'diff');
  assert.equal(session.dialog.diff.additions, 1);
  assert.equal(session.dialog.diff.deletions, 1);

  // 6. Confirm diff and commit save
  const saveRes = session.confirmDiffAndSave();
  assert.equal(saveRes.status, 'saved');
  assert.equal(session.getActiveTab().isDirty, false);
  assert.equal(backend.readFile('src/index.ts').content, 'export const API_URL = "https://api.nexora.cloud";');
});

test('Scenario 3.2: Viewer role attempting mutations while switching tabs & navigating tree', async () => {
  const backend = new MockHostingBackend({
    'public/index.html': '<h1>Home</h1>',
    'public/about.html': '<h1>About</h1>'
  });
  const session = new WorkspaceSession({ backend, role: 'viewer' });

  // Open tabs
  await session.openFile('public/index.html');
  await session.openFile('public/about.html');

  // Attempt mutations in active tab
  assert.throws(() => session.updateActiveContent('<h1>Hacked</h1>'), /read-only/);

  // Switch tab and attempt again
  session.switchTab('public/index.html');
  assert.throws(() => session.updateActiveContent('<h1>Hacked Home</h1>'), /read-only/);

  // Attempt backend CRUD operations
  assert.throws(() => backend.saveFile('public/index.html', 'hacked', 'viewer'), /403/);
  assert.throws(() => backend.createFolder('public/secret', 'viewer'), /403/);
  assert.throws(() => backend.deleteFile('public/about.html', 'viewer'), /403/);

  // But read and download must succeed
  const dl = backend.downloadFile('public/index.html');
  assert.equal(dl.data.toString('utf8'), '<h1>Home</h1>');
});

test('Scenario 3.3: Rename file while open in active tab -> verify tab updates and saves at new path', async () => {
  const backend = new MockHostingBackend({
    'app/OldService.php': '<?php class OldService {}'
  });
  const session = new WorkspaceSession({ backend });

  await session.openFile('app/OldService.php');
  const tab = session.getActiveTab();
  assert.equal(tab.name, 'OldService.php');

  // Move / Rename in backend
  backend.moveFile('app/OldService.php', 'app/NewService.php', 'owner');

  // Simulate tab path sync on file rename
  tab.path = 'app/NewService.php';
  tab.name = 'NewService.php';
  tab.id = 'app/NewService.php';
  session.activeTabId = 'app/NewService.php';

  session.updateActiveContent('<?php class NewService { public function run() {} }');
  await session.triggerSave(false);

  assert.equal(backend.readFile('app/NewService.php').content, '<?php class NewService { public function run() {} }');
  assert.throws(() => backend.readFile('app/OldService.php'), /404/);
});

test('Scenario 3.4: Extract ZIP archive -> refresh file tree -> open extracted file in new tab', async () => {
  const backend = new MockHostingBackend({
    'archive.zip': Buffer.from('PK\x03\x04 simulated zip')
  });
  const session = new WorkspaceSession({ backend });

  // Extract archive
  const extractRes = backend.extractArchive('archive.zip', 'dist', 'owner');
  assert.equal(extractRes.success, true);

  // Refresh tree
  const items = await session.loadTree('dist');
  assert.ok(items.some(it => it.name === 'extracted_sample.txt'));

  // Open extracted file
  const newTab = await session.openFile('dist/extracted_sample.txt');
  assert.equal(newTab.name, 'extracted_sample.txt');
  assert.ok(newTab.originalContent.includes('Extracted content'));
});

test('Scenario 3.5: Delete open file -> tab remains with unsaved edits and saves as recreation', async () => {
  const backend = new MockHostingBackend({
    'temp/scratchpad.txt': 'temporary notes'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('temp/scratchpad.txt');

  session.updateActiveContent('important notes that must not be lost');
  assert.equal(session.getActiveTab().isDirty, true);

  // File is deleted on server by external process
  backend.deleteFile('temp/scratchpad.txt', 'owner');
  assert.throws(() => backend.readFile('temp/scratchpad.txt'), /404/);

  // Saving dirty tab recreates the file
  await session.triggerSave(false);
  assert.equal(backend.readFile('temp/scratchpad.txt').content, 'important notes that must not be lost');
  assert.equal(session.getActiveTab().isDirty, false);
});

test('Scenario 3.6: Multi-tab search and replace refactoring across multiple open buffers', async () => {
  const backend = new MockHostingBackend({
    'moduleA.ts': 'import { oldFn } from "./utils";\noldFn();',
    'moduleB.ts': 'import { oldFn } from "./utils";\nconst res = oldFn(123);'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('moduleA.ts');
  await session.openFile('moduleB.ts');

  // Refactor tab B
  session.switchTab('moduleB.ts');
  const countB = session.replaceAll('oldFn', 'newFn', false, false);
  assert.equal(countB, 2);

  // Refactor tab A
  session.switchTab('moduleA.ts');
  const countA = session.replaceAll('oldFn', 'newFn', false, false);
  assert.equal(countA, 2);

  // Save both tabs
  await session.triggerSave(false);
  session.switchTab('moduleB.ts');
  await session.triggerSave(false);

  assert.equal(backend.readFile('moduleA.ts').content, 'import { newFn } from "./utils";\nnewFn();');
  assert.equal(backend.readFile('moduleB.ts').content, 'import { newFn } from "./utils";\nconst res = newFn(123);');
});

test('Scenario 3.7: Upload file overwriting existing path updates file on disk', async () => {
  const backend = new MockHostingBackend({
    'public/logo.svg': '<svg>Old Logo</svg>'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('public/logo.svg');

  // Upload new version
  const newLogoBuf = Buffer.from('<svg>New Brand Logo</svg>', 'utf8');
  backend.uploadFile('public', 'logo.svg', newLogoBuf, 'owner');

  assert.equal(backend.readFile('public/logo.svg').content, '<svg>New Brand Logo</svg>');
});

test('Scenario 3.8: Mobile viewport toggle during active multi-tab edit session', async () => {
  const backend = new MockHostingBackend({
    'mobile.css': 'body { font-size: 16px; }',
    'desktop.css': 'body { font-size: 14px; }'
  });
  const session = new WorkspaceSession({ backend, isMobile: false });
  await session.openFile('mobile.css');
  session.updateActiveContent('body { font-size: 18px; }');

  // Simulate mobile viewport switch
  session.isMobile = true;
  assert.equal(session.isMobile, true);
  assert.equal(session.getActiveTab().isDirty, true);
  assert.equal(session.getActiveTab().currentContent, 'body { font-size: 18px; }');
});

test('Scenario 3.9: Bulk archive selected files -> verify zip creation & tree node update', async () => {
  const backend = new MockHostingBackend({
    'backup/db.sql': 'SELECT 1;',
    'backup/config.json': '{"db": true}'
  });
  const session = new WorkspaceSession({ backend });

  const archiveRes = backend.archiveFiles(['backup'], 'export_2026.zip', 'owner');
  assert.equal(archiveRes.success, true);
  assert.ok(archiveRes.archivedFiles >= 2);

  const rootItems = await session.loadTree('');
  assert.ok(rootItems.some(i => i.name === 'export_2026.zip'));
});

test('Scenario 3.10: Unsaved changes prompt cancel vs discard vs save workflow when closing workspace modal', async () => {
  const backend = new MockHostingBackend({ 'critical.env': 'APP_ENV=production' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('critical.env');
  session.updateActiveContent('APP_ENV=staging\nDEBUG=true');

  // User attempts to close tab
  const res = session.closeTab('critical.env');
  assert.equal(res.requiresConfirmation, true);
  assert.equal(session.dialog.type, 'unsaved_confirm');

  // User cancels: tab stays open and dirty
  session.dialog = null;
  assert.equal(session.tabs.length, 1);
  assert.equal(session.getActiveTab().isDirty, true);

  // User triggers save before closing
  await session.triggerSave(false);
  assert.equal(session.getActiveTab().isDirty, false);

  // Now closing closes immediately without modal
  const cleanClose = session.closeTab('critical.env');
  assert.equal(cleanClose.requiresConfirmation, false);
  assert.equal(session.tabs.length, 0);
});