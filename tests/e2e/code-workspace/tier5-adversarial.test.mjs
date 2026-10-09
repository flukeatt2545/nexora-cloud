import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockHostingBackend,
  WorkspaceSession,
  computeLineDiff,
  canonicalWorkspacePath,
  editableWorkspacePath,
  detectLanguage
} from './harness.mjs';

test('Tier 5 Adversarial: Path Traversal & Unicode Directory Injections', async () => {
  const backend = new MockHostingBackend({
    'public/index.php': '<?php echo "ok";',
    'config/app.json': '{"name": "test"}'
  });
  const session = new WorkspaceSession({ backend });

  const traversalAttempts = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\win.ini',
    'public/../../secret.env',
    'public/./../../app',
    'config/.././../system.conf'
  ];

  for (const attackPath of traversalAttempts) {
    const check = canonicalWorkspacePath(attackPath);
    assert.equal(
      check.valid,
      false,
      `Path traversal attack was not rejected: ${attackPath}`
    );
    assert.throws(
      () => backend.readFile(attackPath),
      /invalid_path|400/i
    );
  }
});

test('Tier 5 Adversarial: Prototype Pollution & Special Object Keys', async () => {
  const backend = new MockHostingBackend();
  const session = new WorkspaceSession({ backend });

  const dangerousNames = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];

  for (const name of dangerousNames) {
    const created = backend.saveFile(`src/${name}.js`, 'const a = 1;');
    assert.equal(created.success, true);
    assert.equal(typeof Object.prototype.polluted, 'undefined');

    await session.openFile(`src/${name}.js`);
    assert.equal(session.activeTabId, `src/${name}.js`);
    session.updateActiveContent(`const a = 2; // ${name}`);
    assert.equal(session.getActiveTab().isDirty, true);
    assert.equal(typeof ({}).polluted, 'undefined');
  }
});

test('Tier 5 Adversarial: Massive Single-Line Buffer & Token Bombing', async () => {
  const tokenBomb = 'x'.repeat(100_000);
  const backend = new MockHostingBackend({
    'huge_line.txt': tokenBomb
  });
  const session = new WorkspaceSession({ backend });

  await session.openFile('huge_line.txt');
  const tab = session.getActiveTab();
  assert.equal(tab.currentContent.length, 100_000);

  // Edit massive line
  session.updateActiveContent(tokenBomb + ' appended');
  assert.equal(session.getActiveTab().isDirty, true);

  const diff = computeLineDiff(tokenBomb, tokenBomb + ' appended');
  assert.equal(diff.additions > 0 || diff.deletions > 0, true);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);
});

test('Tier 5 Adversarial: Binary Data & Null Byte Payload Protection', async () => {
  const backend = new MockHostingBackend({
    'corrupted.bin': Buffer.from([0x68, 0x65, 0x61, 0x64, 0x00, 0x01, 0x02]),
    'app.exe': Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
  });

  // Backend should reject opening non-text / binary files in code editor
  assert.throws(
    () => backend.readFile('corrupted.bin'),
    /binary|not_editable|415/i
  );

  assert.throws(
    () => backend.readFile('app.exe'),
    /binary|not_editable|415/i
  );
});

test('Tier 5 Adversarial: Viewer Role Lockdown & Mutation Defense', async () => {
  const backend = new MockHostingBackend({
    'protected/routes.php': '<?php Route::get("/", fn() => "hello");'
  });

  const viewerSession = new WorkspaceSession({
    backend,
    role: 'viewer'
  });

  await viewerSession.openFile('protected/routes.php');
  assert.equal(viewerSession.role, 'viewer');

  // Attempting to type or save in viewer mode should throw
  assert.throws(
    () => viewerSession.updateActiveContent('<?php HACKED();'),
    /read-only|viewer|cannot modify/i
  );

  assert.throws(
    () => backend.saveFile('protected/routes.php', '<?php HACKED();', 'viewer'),
    /viewer_readonly|403/i
  );

  assert.throws(
    () => backend.deleteFile('protected/routes.php', 'viewer'),
    /forbidden|403|unauthorized/i
  );
});

test('Tier 5 Adversarial: High Concurrency Rapid Switching & State Integrity', async () => {
  const fileMap = {};
  for (let i = 1; i <= 20; i++) {
    fileMap[`file_${i}.ts`] = `export const v${i} = ${i};`;
  }

  const backend = new MockHostingBackend(fileMap);
  const session = new WorkspaceSession({ backend });

  // Open 20 files
  for (let i = 1; i <= 20; i++) {
    await session.openFile(`file_${i}.ts`);
  }
  assert.equal(session.tabs.length, 20);

  // Perform 200 rapid switch, edit, and cursor operations
  for (let step = 0; step < 200; step++) {
    const targetIdx = (step % 20) + 1;
    const targetPath = `file_${targetIdx}.ts`;
    session.switchTab(targetPath);
    session.updateCursor(step + 1, (step % 40) + 1);

    if (step % 3 === 0) {
      session.updateActiveContent(`export const v${targetIdx} = ${step * 100};`);
    }
  }

  // Verify all 20 tabs preserved their respective state without corruption
  for (let i = 1; i <= 20; i++) {
    const tab = session.tabs.find((t) => t.id === `file_${i}.ts`);
    assert.ok(tab);
    assert.equal(tab.path, `file_${i}.ts`);
  }
});

test('Tier 5 Adversarial: 20-Level Deep Directory Hierarchy', async () => {
  let deepPath = 'root';
  for (let level = 1; level <= 20; level++) {
    deepPath += `/level_${level}`;
  }
  deepPath += '/deep_config.json';

  const backend = new MockHostingBackend({
    [deepPath]: '{"status": "deeply_nested"}'
  });

  const session = new WorkspaceSession({ backend });
  await session.openFile(deepPath);

  const activeTab = session.getActiveTab();
  assert.equal(activeTab.id, deepPath);
  assert.equal(activeTab.name, 'deep_config.json');
  assert.equal(activeTab.language, 'json');
  assert.equal(JSON.parse(activeTab.currentContent).status, 'deeply_nested');
});

test('Tier 5 Adversarial: Lifecycle Thrash & Memory Safety', async () => {
  const backend = new MockHostingBackend({
    'app.js': 'console.log("app");',
    'style.css': 'body { background: #000; }'
  });

  // Spin up and tear down 100 sessions sequentially
  for (let cycle = 0; cycle < 100; cycle++) {
    const session = new WorkspaceSession({ backend });
    await session.openFile('app.js');
    await session.openFile('style.css');
    session.updateActiveContent('body { background: #fff; }');
    session.closeTab('app.js', true);
    session.closeTab('style.css', true);
    assert.equal(session.tabs.length, 0);
  }
});
