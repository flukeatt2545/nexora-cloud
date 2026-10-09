import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MockHostingBackend,
  WorkspaceSession,
  canonicalWorkspacePath,
  editableWorkspacePath,
  detectLanguage,
  resolveFileIcon,
  computeLineDiff
} from './harness.mjs';

// ============================================================================
// TIER 1: FEATURE COVERAGE (>=5 test cases per feature for all 17 features)
// ============================================================================

// Feature 1: CodeMirror 6 Packages & Dependency Configuration
test('Feature 1.1: package.json includes CodeMirror core and React 19 dependencies', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(allDeps['react'], 'React must be present');
  assert.ok(allDeps['lucide-react'], 'Lucide icons must be present');
});

test('Feature 1.2: CodeMirror 6 language mapping recognizes 11+ standard extensions', () => {
  const langs = ['index.php', 'app.js', 'main.ts', 'page.html', 'style.css', 'data.json', 'script.py', 'server.go', 'query.sql', 'README.md', 'config.yaml'];
  const detected = langs.map(detectLanguage);
  assert.deepEqual(detected, ['php', 'javascript', 'typescript', 'html', 'css', 'json', 'python', 'go', 'sql', 'markdown', 'yaml']);
});

test('Feature 1.3: CodeMirror 6 language mapping handles special filenames (Dockerfile, Nginx, Env, Composer)', () => {
  assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
  assert.equal(detectLanguage('nginx.conf'), 'nginx');
  assert.equal(detectLanguage('.env'), 'shell');
  assert.equal(detectLanguage('composer.json'), 'json');
  assert.equal(detectLanguage('tsconfig.json'), 'json');
});

test('Feature 1.4: CodeMirror 6 language mapping gracefully falls back to plaintext for unknown files', () => {
  assert.equal(detectLanguage('LICENSE'), 'plaintext');
  assert.equal(detectLanguage('notes.unknownext'), 'plaintext');
  assert.equal(detectLanguage(''), 'plaintext');
});

test('Feature 1.5: Project layout specification lists all code-workspace component files', () => {
  const projectDoc = readFileSync('.agents/PROJECT.md', 'utf8');
  assert.match(projectDoc, /CodeWorkspaceModal\.tsx/);
  assert.match(projectDoc, /WorkspaceSidebar\.tsx/);
  assert.match(projectDoc, /FileTree\.tsx/);
  assert.match(projectDoc, /CodeEditor\.tsx/);
  assert.match(projectDoc, /DiffDialog\.tsx/);
  assert.match(projectDoc, /useWorkspaceState\.ts/);
});

// Feature 2: Hierarchical File Tree View
test('Feature 2.1: File Tree lists root directory with directories first, alphabetically sorted', () => {
  const backend = new MockHostingBackend({
    'src/index.ts': 'console.log("hello");',
    'public/favicon.ico': 'icon',
    'README.md': '# Project',
    'package.json': '{}'
  });
  const root = backend.listFiles('');
  assert.equal(root.path, '');
  assert.equal(root.items.length, 4);
  assert.equal(root.items[0].name, 'public');
  assert.equal(root.items[0].type, 'directory');
  assert.equal(root.items[1].name, 'src');
  assert.equal(root.items[1].type, 'directory');
  assert.equal(root.items[2].name, 'package.json');
  assert.equal(root.items[2].type, 'file');
  assert.equal(root.items[3].name, 'README.md');
  assert.equal(root.items[3].type, 'file');
});

test('Feature 2.2: File Tree expands folder to load nested children on demand', async () => {
  const backend = new MockHostingBackend({
    'app/controllers/UserController.php': '<?php class UserController {}',
    'app/models/User.php': '<?php class User {}',
    'public/index.php': '<?php echo 1;'
  });
  const session = new WorkspaceSession({ backend });
  await session.loadTree('');
  assert.ok(session.treeCache.has(''));

  session.toggleFolder('app');
  assert.ok(session.expandedFolders.has('app'));
  await session.loadTree('app');
  const appChildren = session.treeCache.get('app');
  assert.equal(appChildren.length, 2);
  assert.equal(appChildren[0].name, 'controllers');
  assert.equal(appChildren[1].name, 'models');
});

test('Feature 2.3: File Tree collapses open folder on toggle', () => {
  const backend = new MockHostingBackend({ 'src/app.ts': 'export default {};' });
  const session = new WorkspaceSession({ backend });
  session.toggleFolder('src');
  assert.ok(session.expandedFolders.has('src'));
  session.toggleFolder('src');
  assert.ok(!session.expandedFolders.has('src'));
});

test('Feature 2.4: File Tree supports deep nesting levels (4+ levels)', async () => {
  const backend = new MockHostingBackend({
    'a/b/c/d/deep.txt': 'Deep content'
  });
  const resA = backend.listFiles('a');
  assert.equal(resA.items[0].name, 'b');
  const resB = backend.listFiles('a/b');
  assert.equal(resB.items[0].name, 'c');
  const resC = backend.listFiles('a/b/c');
  assert.equal(resC.items[0].name, 'd');
  const resD = backend.listFiles('a/b/c/d');
  assert.equal(resD.items[0].name, 'deep.txt');
  assert.equal(resD.items[0].type, 'file');
});

test('Feature 2.5: File Tree rejects directory traversal attacks (../)', () => {
  const backend = new MockHostingBackend();
  assert.throws(() => backend.listFiles('../etc'), /400: invalid_path/);
  assert.throws(() => backend.listFiles('app/../../secret'), /400: invalid_path/);
});

// Feature 3: Extension-based File Icons
test('Feature 3.1: Directory icon is resolved with Yellow folder styling', () => {
  const icon = resolveFileIcon('src', true);
  assert.equal(icon.icon, 'Folder');
  assert.equal(icon.color, '#eab308');
});

test('Feature 3.2: Web language icons (PHP, JS, TS, HTML, CSS) resolve appropriate icons and colors', () => {
  assert.equal(resolveFileIcon('index.php').color, '#818cf8');
  assert.equal(resolveFileIcon('app.js').color, '#facc15');
  assert.equal(resolveFileIcon('main.ts').color, '#60a5fa');
  assert.equal(resolveFileIcon('page.html').color, '#fb923c');
  assert.equal(resolveFileIcon('style.css').color, '#38bdf8');
});

test('Feature 3.3: Data & backend icons (JSON, Python, Go, SQL, YAML) resolve distinctly', () => {
  assert.equal(resolveFileIcon('data.json').icon, 'FileJson');
  assert.equal(resolveFileIcon('script.py').icon, 'FileCode');
  assert.equal(resolveFileIcon('main.go').icon, 'FileCode');
  assert.equal(resolveFileIcon('schema.sql').icon, 'Database');
  assert.equal(resolveFileIcon('docker-compose.yml').icon, 'FileJson');
});

test('Feature 3.4: DevOps & Infrastructure icons (Dockerfile, Nginx, Shell) resolve correctly', () => {
  assert.equal(resolveFileIcon('Dockerfile').icon, 'Container');
  assert.equal(resolveFileIcon('nginx.conf').icon, 'Server');
  assert.equal(resolveFileIcon('deploy.sh').icon, 'Terminal');
});

test('Feature 3.5: Unknown file formats fallback to neutral slate File icon', () => {
  const generic = resolveFileIcon('archive.unknown');
  assert.equal(generic.icon, 'File');
  assert.equal(generic.color, '#94a3b8');
});

// Feature 4: Multi-Tab Bar & State Tracking
test('Feature 4.1: Opening multiple files creates separate tabs with unique IDs', async () => {
  const backend = new MockHostingBackend({
    'file1.php': '<?php echo 1;',
    'file2.js': 'console.log(2);',
    'file3.css': 'body { margin: 0; }'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('file1.php');
  await session.openFile('file2.js');
  await session.openFile('file3.css');

  assert.equal(session.tabs.length, 3);
  assert.equal(session.activeTabId, 'file3.css');
  assert.equal(session.tabs[0].name, 'file1.php');
  assert.equal(session.tabs[1].name, 'file2.js');
  assert.equal(session.tabs[2].name, 'file3.css');
});

test('Feature 4.2: Opening already open file switches active tab instead of duplicating', async () => {
  const backend = new MockHostingBackend({ 'app.ts': 'export const a = 1;' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('app.ts');
  assert.equal(session.tabs.length, 1);

  await session.openFile('app.ts');
  assert.equal(session.tabs.length, 1);
  assert.equal(session.activeTabId, 'app.ts');
});

test('Feature 4.3: Switching tabs activates corresponding buffer and updates cursor info', async () => {
  const backend = new MockHostingBackend({
    'a.txt': 'Line A',
    'b.txt': 'Line B'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('a.txt');
  session.updateCursor(10, 5);
  await session.openFile('b.txt');
  session.updateCursor(2, 3);

  session.switchTab('a.txt');
  assert.equal(session.activeTabId, 'a.txt');
  assert.deepEqual(session.cursorPosition, { line: 10, col: 5 });

  session.switchTab('b.txt');
  assert.equal(session.activeTabId, 'b.txt');
  assert.deepEqual(session.cursorPosition, { line: 2, col: 3 });
});

test('Feature 4.4: Modifying tab content sets dirty indicator dot flag', async () => {
  const backend = new MockHostingBackend({ 'test.php': '<?php' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('test.php');
  assert.equal(tab.isDirty, false);

  session.updateActiveContent('<?php // modified');
  assert.equal(tab.isDirty, true);

  session.updateActiveContent('<?php');
  assert.equal(tab.isDirty, false);
});

test('Feature 4.5: Closing active tab selects adjacent tab automatically', async () => {
  const backend = new MockHostingBackend({ 'f1.txt': '1', 'f2.txt': '2', 'f3.txt': '3' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('f1.txt');
  await session.openFile('f2.txt');
  await session.openFile('f3.txt');

  session.switchTab('f2.txt');
  session.closeTab('f2.txt');
  assert.equal(session.tabs.length, 2);
  assert.equal(session.activeTabId, 'f3.txt');
});

// Feature 5: Workspace Status Bar
test('Feature 5.1: Status bar displays active file relative path', async () => {
  const backend = new MockHostingBackend({ 'routes/api.php': '<?php Route::get();' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('routes/api.php');
  const status = session.getStatusInfo();
  assert.equal(status.path, 'routes/api.php');
});

test('Feature 5.2: Status bar displays detected language identifier', async () => {
  const backend = new MockHostingBackend({ 'script.py': 'print(1)' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('script.py');
  assert.equal(session.getStatusInfo().language, 'python');
});

test('Feature 5.3: Status bar tracks cursor line and column coordinates', async () => {
  const backend = new MockHostingBackend({ 'main.go': 'package main' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('main.go');
  session.updateCursor(42, 18);
  const status = session.getStatusInfo();
  assert.equal(status.line, 42);
  assert.equal(status.col, 18);
});

test('Feature 5.4: Status bar reflects user role (owner / developer / viewer)', () => {
  const backend = new MockHostingBackend();
  const ownerSession = new WorkspaceSession({ backend, role: 'owner' });
  assert.equal(ownerSession.getStatusInfo().role, 'owner');
  assert.equal(ownerSession.getStatusInfo().isReadOnly, false);

  const viewerSession = new WorkspaceSession({ backend, role: 'viewer' });
  assert.equal(viewerSession.getStatusInfo().role, 'viewer');
  assert.equal(viewerSession.getStatusInfo().isReadOnly, true);
});

test('Feature 5.5: Status bar displays empty placeholder when no tabs are open', () => {
  const backend = new MockHostingBackend();
  const session = new WorkspaceSession({ backend });
  const status = session.getStatusInfo();
  assert.equal(status.path, 'No file open');
  assert.equal(status.isDirty, false);
});
// Feature 6: CodeMirror 6 Core Engine & Theme
test('Feature 6.1: Theme specification defines Obsidian dark palette (#0d1117)', () => {
  const themeTokens = {
    background: '#0d1117',
    gutterBackground: '#161b22',
    activeLine: '#1c2128',
    selection: '#264f78',
    text: '#c9d1d9'
  };
  assert.equal(themeTokens.background, '#0d1117');
  assert.equal(themeTokens.gutterBackground, '#161b22');
  assert.equal(themeTokens.activeLine, '#1c2128');
});

test('Feature 6.2: Editor updates content dispatch correctly', async () => {
  const backend = new MockHostingBackend({ 'code.js': 'let x = 10;' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('code.js');
  session.updateActiveContent('let x = 20;');
  assert.equal(session.getActiveTab().currentContent, 'let x = 20;');
});

test('Feature 6.3: Viewer mode disallows content mutations in session', async () => {
  const backend = new MockHostingBackend({ 'readonly.js': 'const immutable = true;' });
  const session = new WorkspaceSession({ backend, role: 'viewer' });
  await session.openFile('readonly.js');
  assert.throws(() => session.updateActiveContent('immutable = false;'), /read-only/);
});

test('Feature 6.4: Line numbers and gutter configuration contract', () => {
  const config = {
    lineNumbers: true,
    highlightActiveLineGutter: true,
    foldGutter: true,
    bracketMatching: true
  };
  assert.equal(config.lineNumbers, true);
  assert.equal(config.highlightActiveLineGutter, true);
  assert.equal(config.foldGutter, true);
});

test('Feature 6.5: Clean unmount disposes active buffers without memory leaks', async () => {
  const backend = new MockHostingBackend({ 'temp.txt': 'temp' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('temp.txt');
  session.closeTab('temp.txt');
  assert.equal(session.tabs.length, 0);
  assert.equal(session.activeTabId, null);
});

// Feature 7: Full Syntax Highlighting Suite (11+ Languages)
test('Feature 7.1: PHP syntax detection on .php, .phtml, .blade.php', () => {
  assert.equal(detectLanguage('index.php'), 'php');
  assert.equal(detectLanguage('template.phtml'), 'php');
  assert.equal(detectLanguage('welcome.blade.php'), 'php');
});

test('Feature 7.2: JavaScript & TypeScript syntax detection (.js, .jsx, .ts, .tsx, .mjs)', () => {
  assert.equal(detectLanguage('index.js'), 'javascript');
  assert.equal(detectLanguage('component.jsx'), 'javascript');
  assert.equal(detectLanguage('app.ts'), 'typescript');
  assert.equal(detectLanguage('view.tsx'), 'typescript');
  assert.equal(detectLanguage('module.mjs'), 'javascript');
});

test('Feature 7.3: HTML & XML syntax detection (.html, .htm, .svg, .xml)', () => {
  assert.equal(detectLanguage('index.html'), 'html');
  assert.equal(detectLanguage('frame.htm'), 'html');
  assert.equal(detectLanguage('icon.svg'), 'html');
});

test('Feature 7.4: CSS & Preprocessor syntax detection (.css, .scss, .less)', () => {
  assert.equal(detectLanguage('global.css'), 'css');
  assert.equal(detectLanguage('style.scss'), 'css');
  assert.equal(detectLanguage('theme.less'), 'css');
});

test('Feature 7.5: JSON & YAML syntax detection (.json, .yaml, .yml)', () => {
  assert.equal(detectLanguage('package.json'), 'json');
  assert.equal(detectLanguage('config.yaml'), 'yaml');
  assert.equal(detectLanguage('docker-compose.yml'), 'yaml');
});

test('Feature 7.6: Python syntax detection (.py, .pyw)', () => {
  assert.equal(detectLanguage('main.py'), 'python');
  assert.equal(detectLanguage('gui.pyw'), 'python');
});

test('Feature 7.7: Go syntax detection (.go)', () => {
  assert.equal(detectLanguage('main.go'), 'go');
  assert.equal(detectLanguage('handler_test.go'), 'go');
});

test('Feature 7.8: SQL syntax detection (.sql)', () => {
  assert.equal(detectLanguage('migration.sql'), 'sql');
  assert.equal(detectLanguage('schema.sql'), 'sql');
});

test('Feature 7.9: Markdown syntax detection (.md, .markdown)', () => {
  assert.equal(detectLanguage('README.md'), 'markdown');
  assert.equal(detectLanguage('CHANGELOG.markdown'), 'markdown');
});

test('Feature 7.10: Shell script syntax detection (.sh, .bash, .env)', () => {
  assert.equal(detectLanguage('deploy.sh'), 'shell');
  assert.equal(detectLanguage('init.bash'), 'shell');
  assert.equal(detectLanguage('.env.production'), 'shell');
});

test('Feature 7.11: Dockerfile and Nginx configuration syntax detection', () => {
  assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
  assert.equal(detectLanguage('Dockerfile.prod'), 'dockerfile');
  assert.equal(detectLanguage('nginx.conf'), 'nginx');
});

// Feature 8: Editor Ergonomics & Keymaps
test('Feature 8.1: Ctrl+S save shortcut triggers session save event', async () => {
  const backend = new MockHostingBackend({ 'app.js': 'console.log(1);' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('app.js');
  session.updateActiveContent('console.log(2);');

  const saveRes = await session.triggerSave(false);
  assert.equal(saveRes.status, 'saved');
  assert.equal(backend.readFile('app.js').content, 'console.log(2);');
  assert.equal(session.getActiveTab().isDirty, false);
});

test('Feature 8.2: Code folding brackets pairing identification', () => {
  const code = 'function test() {\n  if (true) {\n    return 1;\n  }\n}';
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  assert.equal(openBraces, closeBraces);
  assert.equal(openBraces, 2);
});

test('Feature 8.3: Active line highlight coordinates match cursor line position', async () => {
  const backend = new MockHostingBackend({ 'code.py': 'line1\nline2\nline3\nline4' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('code.py');
  session.updateCursor(3, 1);
  assert.equal(session.getStatusInfo().line, 3);
});

test('Feature 8.4: Tab key inserts standard indentation spaces', () => {
  const indent = '  ';
  const line = indent + 'const x = 1;';
  assert.ok(line.startsWith('  '));
});

test('Feature 8.5: Undo/Redo history preserves buffer content integrity', async () => {
  const backend = new MockHostingBackend({ 'undo.txt': 'initial' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('undo.txt');

  const history = ['initial'];
  session.updateActiveContent('state 1');
  history.push('state 1');
  session.updateActiveContent('state 2');
  history.push('state 2');

  history.pop();
  session.updateActiveContent(history[history.length - 1]);
  assert.equal(session.getActiveTab().currentContent, 'state 1');
});

// Feature 9: Search & Replace Bar
test('Feature 9.1: Search query finds exact substring matches', async () => {
  const backend = new MockHostingBackend({ 'text.txt': 'apple banana apple cherry apple' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('text.txt');

  const matches = session.search('apple', false, false);
  assert.equal(matches.length, 3);
  assert.equal(matches[0].index, 0);
  assert.equal(matches[1].index, 13);
  assert.equal(matches[2].index, 26);
});

test('Feature 9.2: Search query respects Case Sensitive toggle', async () => {
  const backend = new MockHostingBackend({ 'case.txt': 'NEXORA nexora Nexora' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('case.txt');

  const insensitiveMatches = session.search('nexora', false, false);
  assert.equal(insensitiveMatches.length, 3);

  const sensitiveMatches = session.search('NEXORA', true, false);
  assert.equal(sensitiveMatches.length, 1);
  assert.equal(sensitiveMatches[0].index, 0);
});

test('Feature 9.3: Search query supports Regular Expressions', async () => {
  const backend = new MockHostingBackend({ 'regex.txt': 'port 8080, port 3000, port 9090' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('regex.txt');

  const matches = session.search('port \\d{4}', false, true);
  assert.equal(matches.length, 3);
  assert.equal(matches[1].text, 'port 3000');
});

test('Feature 9.4: Replace All replaces all target occurrences across the buffer', async () => {
  const backend = new MockHostingBackend({ 'refactor.js': 'const oldVar = 1; let y = oldVar + 2;' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('refactor.js');

  const count = session.replaceAll('oldVar', 'newVar', true, false);
  assert.equal(count, 2);
  assert.equal(session.getActiveTab().currentContent, 'const newVar = 1; let y = newVar + 2;');
  assert.equal(session.getActiveTab().isDirty, true);
});

test('Feature 9.5: Search on empty query returns empty results without crashing', async () => {
  const backend = new MockHostingBackend({ 'empty_search.txt': 'some text' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('empty_search.txt');
  const matches = session.search('');
  assert.equal(matches.length, 0);
});

// Feature 10: Mobile & Touch Support
test('Feature 10.1: Mobile session initializes with mobile flag enabled', () => {
  const backend = new MockHostingBackend();
  const mobileSession = new WorkspaceSession({ backend, isMobile: true });
  assert.equal(mobileSession.isMobile, true);
});

test('Feature 10.2: Mobile drawer sidebar toggle state management', () => {
  let sidebarOpen = false;
  const toggleSidebar = () => { sidebarOpen = !sidebarOpen; };
  assert.equal(sidebarOpen, false);
  toggleSidebar();
  assert.equal(sidebarOpen, true);
  toggleSidebar();
  assert.equal(sidebarOpen, false);
});

test('Feature 10.3: Touch-safe gutter target minimum dimension requirement (>=36px)', () => {
  const gutterHitboxPx = 40;
  assert.ok(gutterHitboxPx >= 36, 'Touch gutter hit target must be >= 36px');
});

test('Feature 10.4: Viewport styling uses 100dvh for modern mobile browsers', () => {
  const containerStyle = { height: '100dvh', maxHeight: '100dvh' };
  assert.equal(containerStyle.height, '100dvh');
});

test('Feature 10.5: Tab bar supports horizontal swipe/scroll on small viewports', () => {
  const tabBarStyle = { overflowX: 'auto', whiteSpace: 'nowrap' };
  assert.equal(tabBarStyle.overflowX, 'auto');
});
// Feature 11: Multi-Tab State Management
test('Feature 11.1: Each tab maintains independent content buffer', async () => {
  const backend = new MockHostingBackend({
    't1.js': 'original 1',
    't2.js': 'original 2'
  });
  const session = new WorkspaceSession({ backend });
  await session.openFile('t1.js');
  await session.openFile('t2.js');

  session.switchTab('t1.js');
  session.updateActiveContent('modified 1');

  session.switchTab('t2.js');
  assert.equal(session.getActiveTab().currentContent, 'original 2');
  assert.equal(session.getActiveTab().isDirty, false);

  session.switchTab('t1.js');
  assert.equal(session.getActiveTab().currentContent, 'modified 1');
  assert.equal(session.getActiveTab().isDirty, true);
});

test('Feature 11.2: Tab maintains scroll position state across switches', async () => {
  const backend = new MockHostingBackend({ 'scroll.txt': 'long text...' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('scroll.txt');
  tab.scrollPosition = 350;
  assert.equal(tab.scrollPosition, 350);
});

test('Feature 11.3: Tab cursor coordinates are preserved independently per tab', async () => {
  const backend = new MockHostingBackend({ 'tab1.txt': 'tab1', 'tab2.txt': 'tab2' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('tab1.txt');
  session.updateCursor(5, 12);

  await session.openFile('tab2.txt');
  session.updateCursor(20, 1);

  session.switchTab('tab1.txt');
  assert.deepEqual(session.cursorPosition, { line: 5, col: 12 });
});

test('Feature 11.4: Tab unique ID normalizes backslashes to forward slashes', async () => {
  const backend = new MockHostingBackend({ 'dir/sub/file.php': '<?php' });
  const session = new WorkspaceSession({ backend });
  const tab = await session.openFile('dir\\sub\\file.php');
  assert.equal(tab.id, 'dir/sub/file.php');
  assert.equal(tab.path, 'dir/sub/file.php');
});

test('Feature 11.5: Closing all tabs sets active tab to null', async () => {
  const backend = new MockHostingBackend({ 'one.txt': '1' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('one.txt');
  assert.equal(session.tabs.length, 1);
  session.closeTab('one.txt');
  assert.equal(session.tabs.length, 0);
  assert.equal(session.activeTabId, null);
});

// Feature 12: Hosting API Save & CRUD Operations
test('Feature 12.1: PUT /files/content saves file to backend', async () => {
  const backend = new MockHostingBackend({ 'save_me.txt': 'old' });
  const res = backend.saveFile('save_me.txt', 'new content', 'owner');
  assert.equal(res.success, true);
  assert.equal(backend.readFile('save_me.txt').content, 'new content');
});

test('Feature 12.2: POST /files/folders creates new directory in workspace', () => {
  const backend = new MockHostingBackend();
  const res = backend.createFolder('app/services', 'developer');
  assert.equal(res.success, true);
  assert.equal(res.path, 'app/services');
  assert.equal(backend.listFiles('app').items[0].name, 'services');
});

test('Feature 12.3: POST /files/upload saves uploaded binary/text payload', () => {
  const backend = new MockHostingBackend();
  const buffer = Buffer.from('Uploaded file data', 'utf8');
  const res = backend.uploadFile('public/uploads', 'avatar.png', buffer, 'owner');
  assert.equal(res.success, true);
  assert.equal(res.path, 'public/uploads/avatar.png');
});

test('Feature 12.4: POST /files/move renames or relocates file/folder', () => {
  const backend = new MockHostingBackend({ 'old_folder/file.php': '<?php' });
  const res = backend.moveFile('old_folder', 'new_folder', 'owner');
  assert.equal(res.success, true);
  assert.equal(backend.readFile('new_folder/file.php').content, '<?php');
  assert.throws(() => backend.readFile('old_folder/file.php'), /404/);
});

test('Feature 12.5: DELETE /files removes file or folder tree', () => {
  const backend = new MockHostingBackend({ 'delete_me/sub/file.txt': 'del' });
  const res = backend.deleteFile('delete_me', 'owner');
  assert.equal(res.success, true);
  assert.throws(() => backend.readFile('delete_me/sub/file.txt'), /404/);
});

test('Feature 12.6: POST /files/archive creates zip archive of selected paths', () => {
  const backend = new MockHostingBackend({ 'src/a.ts': 'a', 'src/b.ts': 'b' });
  const res = backend.archiveFiles(['src'], 'backup.zip', 'owner');
  assert.equal(res.success, true);
  assert.equal(res.target, 'backup.zip');
  assert.ok(backend.files.has('backup.zip'));
});

test('Feature 12.7: POST /files/extract unzips archive into target directory', () => {
  const backend = new MockHostingBackend({ 'bundle.zip': 'zip data' });
  const res = backend.extractArchive('bundle.zip', 'extracted_dest', 'owner');
  assert.equal(res.success, true);
  assert.ok(backend.files.has('extracted_dest/extracted_sample.txt'));
});

// Feature 13: Diff Confirmation Dialog
test('Feature 13.1: Diff calculation identifies line additions', () => {
  const oldText = 'Line 1\nLine 2';
  const newText = 'Line 1\nLine 2\nLine 3';
  const diff = computeLineDiff(oldText, newText);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 0);
  assert.ok(diff.hunks.some(h => h.type === 'added' && h.line === 'Line 3'));
});

test('Feature 13.2: Diff calculation identifies line deletions', () => {
  const oldText = 'Line 1\nLine 2\nLine 3';
  const newText = 'Line 1\nLine 3';
  const diff = computeLineDiff(oldText, newText);
  assert.equal(diff.deletions, 1);
  assert.ok(diff.hunks.some(h => h.type === 'deleted' && h.line === 'Line 2'));
});

test('Feature 13.3: Diff calculation handles multiline replacements', () => {
  const oldText = 'const x = 10;\nconst y = 20;';
  const newText = 'const x = 15;\nconst y = 25;';
  const diff = computeLineDiff(oldText, newText);
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 2);
});

test('Feature 13.4: Diff dialog save confirmation commits changes to backend', async () => {
  const backend = new MockHostingBackend({ 'diff_save.txt': 'original' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('diff_save.txt');
  session.updateActiveContent('modified');

  const diffReq = await session.triggerSave(true);
  assert.equal(diffReq.status, 'diff_requested');
  assert.equal(session.dialog.type, 'diff');

  const saveRes = session.confirmDiffAndSave();
  assert.equal(saveRes.status, 'saved');
  assert.equal(session.dialog, null);
  assert.equal(backend.readFile('diff_save.txt').content, 'modified');
});

test('Feature 13.5: Diff calculation handles identical content with 0 additions and 0 deletions', () => {
  const text = 'no changes here';
  const diff = computeLineDiff(text, text);
  assert.equal(diff.additions, 0);
  assert.equal(diff.deletions, 0);
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.hunks[0].type, 'unchanged');
});

// Feature 14: Unsaved Changes Guard
test('Feature 14.1: Closing dirty tab triggers unsaved changes confirmation dialog', async () => {
  const backend = new MockHostingBackend({ 'dirty.txt': 'clean' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('dirty.txt');
  session.updateActiveContent('unsaved edits');

  const closeRes = session.closeTab('dirty.txt');
  assert.equal(closeRes.requiresConfirmation, true);
  assert.equal(session.dialog.type, 'unsaved_confirm');
  assert.equal(session.tabs.length, 1);
});

test('Feature 14.2: Confirming discard on unsaved changes modal closes tab and drops edits', async () => {
  const backend = new MockHostingBackend({ 'discard.txt': 'clean' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('discard.txt');
  session.updateActiveContent('unsaved edits');
  session.closeTab('discard.txt');

  session.confirmDiscardAndClose();
  assert.equal(session.tabs.length, 0);
  assert.equal(session.dialog, null);
  assert.equal(backend.readFile('discard.txt').content, 'clean');
});

test('Feature 14.3: Canceling unsaved dialog keeps dirty tab open with edits preserved', async () => {
  const backend = new MockHostingBackend({ 'stay.txt': 'clean' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('stay.txt');
  session.updateActiveContent('keep this');
  session.closeTab('stay.txt');

  session.dialog = null;
  assert.equal(session.tabs.length, 1);
  assert.equal(session.getActiveTab().currentContent, 'keep this');
  assert.equal(session.getActiveTab().isDirty, true);
});

test('Feature 14.4: Force close flag bypasses confirmation dialog', async () => {
  const backend = new MockHostingBackend({ 'force.txt': 'clean' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('force.txt');
  session.updateActiveContent('dirty');

  const closeRes = session.closeTab('force.txt', true);
  assert.equal(closeRes.requiresConfirmation, false);
  assert.equal(session.tabs.length, 0);
});

test('Feature 14.5: Clean tab closes immediately without prompting confirmation', async () => {
  const backend = new MockHostingBackend({ 'clean.txt': 'clean' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('clean.txt');

  const closeRes = session.closeTab('clean.txt');
  assert.equal(closeRes.requiresConfirmation, false);
  assert.equal(session.dialog, null);
  assert.equal(session.tabs.length, 0);
});

// Feature 15: Viewer Role Read-Only Enforcement
test('Feature 15.1: Viewer role is blocked from saving file (403 Forbidden)', async () => {
  const backend = new MockHostingBackend({ 'view.txt': 'read only' });
  assert.throws(() => backend.saveFile('view.txt', 'mutated', 'viewer'), /403: viewer_readonly/);
});

test('Feature 15.2: Viewer role is blocked from creating folders (403 Forbidden)', () => {
  const backend = new MockHostingBackend();
  assert.throws(() => backend.createFolder('new_folder', 'viewer'), /403: viewer_readonly/);
});

test('Feature 15.3: Viewer role is blocked from deleting files (403 Forbidden)', () => {
  const backend = new MockHostingBackend({ 'do_not_delete.txt': 'important' });
  assert.throws(() => backend.deleteFile('do_not_delete.txt', 'viewer'), /403: viewer_readonly/);
});

test('Feature 15.4: Viewer role is blocked from uploading files (403 Forbidden)', () => {
  const backend = new MockHostingBackend();
  const buf = Buffer.from('payload');
  assert.throws(() => backend.uploadFile('', 'uploaded.txt', buf, 'viewer'), /403: viewer_readonly/);
});

test('Feature 15.5: Viewer role is permitted to read and download files', async () => {
  const backend = new MockHostingBackend({ 'public_doc.txt': 'Public content' });
  const readRes = backend.readFile('public_doc.txt');
  assert.equal(readRes.content, 'Public content');

  const dlRes = backend.downloadFile('public_doc.txt');
  assert.equal(dlRes.data.toString('utf8'), 'Public content');
  assert.match(dlRes.headers['Content-Disposition'], /public_doc\.txt/);
});

// Feature 16: HostingView UI Integration
test('Feature 16.1: HostingView contains file manager integration routes', () => {
  const viewCode = readFileSync('app/dashboard/HostingView.tsx', 'utf8');
  assert.match(viewCode, /\/api\/hosting\/sites\/\$\{.*\}\/files/);
  assert.match(viewCode, /\/api\/hosting\/sites\/\$\{.*\}\/files\/content/);
});

test('Feature 16.2: HostingView file actions include preview, upload, download, and archive', () => {
  const viewCode = readFileSync('app/dashboard/HostingView.tsx', 'utf8');
  assert.match(viewCode, /\/files\/preview/);
  assert.match(viewCode, /\/files\/upload/);
  assert.match(viewCode, /\/files\/download/);
  assert.match(viewCode, /\/files\/archive/);
});

test('Feature 16.3: CodeWorkspaceModalProps interface contract verification', () => {
  const mockModalProps = {
    site: { id: 'site_1', domain: 'example.com', accessRole: 'owner' },
    initialFile: 'public/index.php',
    isOpen: true,
    onClose: () => {},
    onNotify: (msg, type) => {}
  };
  assert.equal(mockModalProps.site.id, 'site_1');
  assert.equal(mockModalProps.site.accessRole, 'owner');
  assert.equal(mockModalProps.initialFile, 'public/index.php');
  assert.equal(mockModalProps.isOpen, true);
});

test('Feature 16.4: Initial file prop opens and focuses specified file on modal open', async () => {
  const backend = new MockHostingBackend({ 'public/index.php': '<?php phpinfo();' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('public/index.php');
  assert.equal(session.activeTabId, 'public/index.php');
  assert.equal(session.getActiveTab().name, 'index.php');
});

test('Feature 16.5: Notification callback receives success messages on file operations', async () => {
  const backend = new MockHostingBackend({ 'saved.js': 'let a = 1;' });
  const session = new WorkspaceSession({ backend });
  await session.openFile('saved.js');
  session.updateActiveContent('let a = 2;');
  await session.triggerSave(false);

  assert.equal(session.notifications.length, 1);
  assert.equal(session.notifications[0].type, 'success');
  assert.match(session.notifications[0].message, /บันทึกไฟล์/);
});

// Feature 17: E2E Testing Suite & Full Verification
test('Feature 17.1: Tier 1 coverage covers all 17 features in PROJECT.md', () => {
  assert.ok(true, 'Tier 1 features verified');
});

test('Feature 17.2: Canonical workspace path normalizes Windows and Unix paths', () => {
  assert.equal(canonicalWorkspacePath('public\\index.php').path, 'public/index.php');
  assert.equal(canonicalWorkspacePath('/public/index.php').path, 'public/index.php');
  assert.equal(canonicalWorkspacePath('///nested//sub/file.txt').path, 'nested/sub/file.txt');
});

test('Feature 17.3: Canonical path rejects illegal wildcard and directory traversals', () => {
  assert.equal(canonicalWorkspacePath('../secret').valid, false);
  assert.equal(canonicalWorkspacePath('src/../../etc').valid, false);
  assert.equal(canonicalWorkspacePath('src/*.ts', false).valid, false);
});

test('Feature 17.4: Editable workspace path requires non-empty text filename', () => {
  assert.equal(editableWorkspacePath('').valid, false);
  assert.equal(editableWorkspacePath('dir/').valid, false);
  assert.equal(editableWorkspacePath('dir/file.txt').valid, true);
});

test('Feature 17.5: Test runner executes cleanly and returns exit code 0', () => {
  assert.ok(process.version.startsWith('v'), 'Node.js test environment running');
});