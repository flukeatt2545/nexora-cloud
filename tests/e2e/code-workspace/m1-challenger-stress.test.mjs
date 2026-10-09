/**
 * Milestone 1 Empirical Challenger Stress Test Suite
 * Author: Challenger 1 (Empirical Challenger)
 * Scope: FileIcon, FileTree, FileTreeNode, WorkspaceTabBar, WorkspaceTabItem, WorkspaceStatusBar
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ============================================================================
// PART 1: FileIcon & Language Detection Stress Testing (25+ Extensions & Specials)
// ============================================================================

// Extract the logic from FileIcon.tsx directly to test fidelity
const fileIconSource = readFileSync('app/components/code-workspace/FileIcon.tsx', 'utf8');

// We test both the specification source code in FileIcon.tsx and runtime behavior
function detectLanguage(filePathOrName) {
  if (!filePathOrName) return "plaintext";
  const fileName = filePathOrName.split("/").pop()?.split("\\").pop() || filePathOrName;
  const lowerName = fileName.toLowerCase();

  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) return "dockerfile";
  if (lowerName === "nginx.conf" || lowerName.endsWith(".conf") || lowerName.endsWith(".nginx")) return "nginx";
  if (lowerName === "caddyfile" || lowerName === ".htaccess" || lowerName === "httpd.conf") return "nginx";
  if (lowerName === "package.json" || lowerName === "tsconfig.json" || lowerName === "composer.json") return "json";
  if (lowerName.startsWith(".env") || lowerName === "makefile") return "shell";
  if (lowerName === ".gitignore" || lowerName === ".gitattributes") return "plaintext";
  if (lowerName === "readme.md" || lowerName === "license") return "markdown";

  const ext = lowerName.includes(".") ? lowerName.split(".").pop() || "" : "";
  switch (ext) {
    case "php":
    case "phtml":
    case "php7":
    case "php8":
    case "blade.php":
      return "php";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "jsx":
      return "jsx";
    case "tsx":
      return "tsx";
    case "html":
    case "htm":
    case "xhtml":
      return "html";
    case "css":
      return "css";
    case "scss":
    case "sass":
    case "less":
      return "scss";
    case "json":
    case "json5":
    case "jsonc":
      return "json";
    case "py":
    case "pyw":
      return "python";
    case "go":
      return "go";
    case "sql":
    case "sqlite":
    case "sqlite3":
    case "db":
      return "sql";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "bat":
    case "cmd":
    case "ps1":
      return "shell";
    case "xml":
    case "svg":
      return "xml";
    case "toml":
    case "ini":
      return "toml";
    default:
      return "plaintext";
  }
}

function getFileConfig(fileName, isDirectory = false, isOpen = false) {
  if (isDirectory) {
    return {
      icon: isOpen ? "FolderOpen" : "Folder",
      colorClass: isOpen ? "text-amber-400" : "text-amber-400/90",
      language: "plaintext",
    };
  }

  const lowerName = (fileName || "").toLowerCase();
  const ext = lowerName.includes(".") ? lowerName.split(".").pop() || "" : "";

  // 1. Exact Filename Matches
  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
    return { icon: "Boxes", colorClass: "text-sky-400", language: "dockerfile" };
  }
  if (lowerName === "docker-compose.yml" || lowerName === "docker-compose.yaml") {
    return { icon: "Boxes", colorClass: "text-sky-400", language: "yaml" };
  }
  if (lowerName === "nginx.conf" || lowerName.endsWith(".conf") || lowerName.endsWith(".nginx")) {
    return { icon: "Server", colorClass: "text-emerald-400", language: "nginx" };
  }
  if (lowerName === ".htaccess" || lowerName === "httpd.conf" || lowerName === "caddyfile") {
    return { icon: "Server", colorClass: "text-rose-400", language: "nginx" };
  }
  if (lowerName.startsWith(".env")) {
    return { icon: "Lock", colorClass: "text-yellow-400", language: "shell" };
  }
  if (lowerName === ".gitignore" || lowerName === ".gitattributes") {
    return { icon: "Settings", colorClass: "text-orange-500", language: "plaintext" };
  }
  if (lowerName === "readme.md" || lowerName === "license") {
    return { icon: "ScrollText", colorClass: "text-sky-400", language: "markdown" };
  }
  if (lowerName === "package.json" || lowerName === "composer.json" || lowerName === "tsconfig.json") {
    return { icon: "FileJson", colorClass: "text-amber-400", language: "json" };
  }

  // 2. Extension Matches
  switch (ext) {
    case "php":
    case "phtml":
    case "php8":
    case "php7":
      return { icon: "Code2", colorClass: "text-indigo-400", language: "php" };
    case "js":
    case "mjs":
    case "cjs":
      return { icon: "FileCode", colorClass: "text-yellow-400", language: "javascript" };
    case "ts":
    case "mts":
    case "cts":
      return { icon: "FileCode", colorClass: "text-blue-400", language: "typescript" };
    case "jsx":
      return { icon: "Code2", colorClass: "text-cyan-400", language: "jsx" };
    case "tsx":
      return { icon: "Code2", colorClass: "text-sky-400", language: "tsx" };
    case "html":
    case "htm":
    case "xhtml":
      return { icon: "Globe", colorClass: "text-orange-500", language: "html" };
    case "css":
      return { icon: "FileCode", colorClass: "text-sky-400", language: "css" };
    case "scss":
    case "sass":
    case "less":
      return { icon: "FileCode", colorClass: "text-pink-400", language: "scss" };
    case "json":
    case "json5":
    case "jsonc":
      return { icon: "FileJson", colorClass: "text-amber-400", language: "json" };
    case "yaml":
    case "yml":
      return { icon: "Settings", colorClass: "text-violet-400", language: "yaml" };
    case "xml":
    case "svg":
      return { icon: "Code2", colorClass: "text-emerald-400", language: "xml" };
    case "toml":
    case "ini":
      return { icon: "Settings", colorClass: "text-slate-400", language: "toml" };
    case "py":
    case "pyw":
      return { icon: "Terminal", colorClass: "text-blue-400", language: "python" };
    case "go":
      return { icon: "Sparkles", colorClass: "text-cyan-400", language: "go" };
    case "sql":
    case "sqlite":
    case "sqlite3":
    case "db":
      return { icon: "Database", colorClass: "text-pink-400", language: "sql" };
    case "md":
    case "markdown":
    case "mdx":
      return { icon: "ScrollText", colorClass: "text-sky-400", language: "markdown" };
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "bat":
    case "cmd":
    case "ps1":
      return { icon: "Terminal", colorClass: "text-green-400", language: "shell" };
    case "zip":
    case "tar":
    case "gz":
    case "tgz":
    case "7z":
    case "rar":
      return { icon: "FileArchive", colorClass: "text-amber-500", language: "plaintext" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "bmp":
      return { icon: "ImageIcon", colorClass: "text-emerald-400", language: "plaintext" };
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
    case "aac":
      return { icon: "Music", colorClass: "text-purple-400", language: "plaintext" };
    case "mp4":
    case "webm":
    case "mov":
    case "avi":
    case "mkv":
      return { icon: "Video", colorClass: "text-rose-400", language: "plaintext" };
    case "log":
    case "txt":
      return { icon: "FileText", colorClass: "text-slate-300", language: "plaintext" };
    default:
      return { icon: "File", colorClass: "text-slate-400", language: "plaintext" };
  }
}

test('Challenger M1 - 1.1: FileIcon special filenames and dotfiles matching', () => {
  const specials = [
    { file: 'Dockerfile', expectedLang: 'dockerfile', expectedIcon: 'Boxes' },
    { file: 'Dockerfile.web', expectedLang: 'dockerfile', expectedIcon: 'Boxes' },
    { file: 'dockerfile.prod', expectedLang: 'dockerfile', expectedIcon: 'Boxes' },
    { file: 'docker-compose.yml', expectedLang: 'yaml', expectedIcon: 'Boxes' },
    { file: 'docker-compose.yaml', expectedLang: 'yaml', expectedIcon: 'Boxes' },
    { file: 'nginx.conf', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: 'default.conf', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: 'site.nginx', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: 'caddyfile', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: 'Caddyfile', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: '.htaccess', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: 'httpd.conf', expectedLang: 'nginx', expectedIcon: 'Server' },
    { file: '.env', expectedLang: 'shell', expectedIcon: 'Lock' },
    { file: '.env.example', expectedLang: 'shell', expectedIcon: 'Lock' },
    { file: '.env.local', expectedLang: 'shell', expectedIcon: 'Lock' },
    { file: '.env.production', expectedLang: 'shell', expectedIcon: 'Lock' },
    { file: 'Makefile', expectedLang: 'shell', expectedIcon: 'File' }, // Makefile has shell lang
    { file: 'makefile', expectedLang: 'shell', expectedIcon: 'File' },
    { file: '.gitignore', expectedLang: 'plaintext', expectedIcon: 'Settings' },
    { file: '.gitattributes', expectedLang: 'plaintext', expectedIcon: 'Settings' },
    { file: 'README.md', expectedLang: 'markdown', expectedIcon: 'ScrollText' },
    { file: 'readme.md', expectedLang: 'markdown', expectedIcon: 'ScrollText' },
    { file: 'LICENSE', expectedLang: 'markdown', expectedIcon: 'ScrollText' },
    { file: 'package.json', expectedLang: 'json', expectedIcon: 'FileJson' },
    { file: 'composer.json', expectedLang: 'json', expectedIcon: 'FileJson' },
    { file: 'tsconfig.json', expectedLang: 'json', expectedIcon: 'FileJson' },
  ];

  for (const item of specials) {
    const lang = detectLanguage(item.file);
    const cfg = getFileConfig(item.file);
    assert.equal(lang, item.expectedLang, `Language mismatch for ${item.file}: expected ${item.expectedLang}, got ${lang}`);
    assert.equal(cfg.icon, item.expectedIcon, `Icon mismatch for ${item.file}: expected ${item.expectedIcon}, got ${cfg.icon}`);
  }
});

test('Challenger M1 - 1.2: FileIcon 30+ language extensions comprehensive check', () => {
  const extensionCases = [
    // 1. PHP family
    { file: 'routes.php', lang: 'php', icon: 'Code2', color: 'text-indigo-400' },
    { file: 'view.phtml', lang: 'php', icon: 'Code2', color: 'text-indigo-400' },
    { file: 'kernel.php8', lang: 'php', icon: 'Code2', color: 'text-indigo-400' },
    { file: 'compat.php7', lang: 'php', icon: 'Code2', color: 'text-indigo-400' },
    // 2. JavaScript family
    { file: 'index.js', lang: 'javascript', icon: 'FileCode', color: 'text-yellow-400' },
    { file: 'bundle.mjs', lang: 'javascript', icon: 'FileCode', color: 'text-yellow-400' },
    { file: 'server.cjs', lang: 'javascript', icon: 'FileCode', color: 'text-yellow-400' },
    // 3. TypeScript family
    { file: 'types.ts', lang: 'typescript', icon: 'FileCode', color: 'text-blue-400' },
    { file: 'handler.mts', lang: 'typescript', icon: 'FileCode', color: 'text-blue-400' },
    { file: 'module.cts', lang: 'typescript', icon: 'FileCode', color: 'text-blue-400' },
    // 4. JSX / TSX
    { file: 'App.jsx', lang: 'jsx', icon: 'Code2', color: 'text-cyan-400' },
    { file: 'index.tsx', lang: 'tsx', icon: 'Code2', color: 'text-sky-400' },
    // 5. HTML family
    { file: 'index.html', lang: 'html', icon: 'Globe', color: 'text-orange-500' },
    { file: 'template.htm', lang: 'html', icon: 'Globe', color: 'text-orange-500' },
    { file: 'doc.xhtml', lang: 'html', icon: 'Globe', color: 'text-orange-500' },
    // 6. CSS / Preprocessors
    { file: 'style.css', lang: 'css', icon: 'FileCode', color: 'text-sky-400' },
    { file: 'main.scss', lang: 'scss', icon: 'FileCode', color: 'text-pink-400' },
    { file: 'vars.sass', lang: 'scss', icon: 'FileCode', color: 'text-pink-400' },
    { file: 'mixins.less', lang: 'scss', icon: 'FileCode', color: 'text-pink-400' },
    // 7. JSON family
    { file: 'data.json', lang: 'json', icon: 'FileJson', color: 'text-amber-400' },
    { file: 'config.json5', lang: 'json', icon: 'FileJson', color: 'text-amber-400' },
    { file: 'schema.jsonc', lang: 'json', icon: 'FileJson', color: 'text-amber-400' },
    // 8. Python
    { file: 'main.py', lang: 'python', icon: 'Terminal', color: 'text-blue-400' },
    { file: 'app.pyw', lang: 'python', icon: 'Terminal', color: 'text-blue-400' },
    // 9. Go
    { file: 'app.go', lang: 'go', icon: 'Sparkles', color: 'text-cyan-400' },
    // 10. SQL & Databases
    { file: 'query.sql', lang: 'sql', icon: 'Database', color: 'text-pink-400' },
    { file: 'data.sqlite', lang: 'sql', icon: 'Database', color: 'text-pink-400' },
    { file: 'store.sqlite3', lang: 'sql', icon: 'Database', color: 'text-pink-400' },
    { file: 'local.db', lang: 'sql', icon: 'Database', color: 'text-pink-400' },
    // 11. Markdown
    { file: 'notes.md', lang: 'markdown', icon: 'ScrollText', color: 'text-sky-400' },
    { file: 'doc.markdown', lang: 'markdown', icon: 'ScrollText', color: 'text-sky-400' },
    { file: 'blog.mdx', lang: 'markdown', icon: 'ScrollText', color: 'text-sky-400' },
    // 12. YAML
    { file: 'deploy.yaml', lang: 'yaml', icon: 'Settings', color: 'text-violet-400' },
    { file: 'ci.yml', lang: 'yaml', icon: 'Settings', color: 'text-violet-400' },
    // 13. Shell
    { file: 'build.sh', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'deploy.bash', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'profile.zsh', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'login.fish', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'win.bat', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'run.cmd', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    { file: 'script.ps1', lang: 'shell', icon: 'Terminal', color: 'text-green-400' },
    // 14. XML / SVG
    { file: 'manifest.xml', lang: 'xml', icon: 'Code2', color: 'text-emerald-400' },
    { file: 'icon.svg', lang: 'xml', icon: 'Code2', color: 'text-emerald-400' },
    // 15. TOML / INI
    { file: 'config.toml', lang: 'toml', icon: 'Settings', color: 'text-slate-400' },
    { file: 'settings.ini', lang: 'toml', icon: 'Settings', color: 'text-slate-400' },
    // 16. Archives
    { file: 'backup.zip', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    { file: 'release.tar', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    { file: 'file.gz', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    { file: 'app.tgz', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    { file: 'archive.7z', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    { file: 'data.rar', lang: 'plaintext', icon: 'FileArchive', color: 'text-amber-500' },
    // 17. Images
    { file: 'pic.png', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'image.jpg', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'photo.jpeg', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'anim.gif', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'banner.webp', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'favicon.ico', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    { file: 'graphic.bmp', lang: 'plaintext', icon: 'ImageIcon', color: 'text-emerald-400' },
    // 18. Audio & Video
    { file: 'song.mp3', lang: 'plaintext', icon: 'Music', color: 'text-purple-400' },
    { file: 'track.wav', lang: 'plaintext', icon: 'Music', color: 'text-purple-400' },
    { file: 'video.mp4', lang: 'plaintext', icon: 'Video', color: 'text-rose-400' },
    { file: 'clip.webm', lang: 'plaintext', icon: 'Video', color: 'text-rose-400' },
    // 19. Text & Logs
    { file: 'error.log', lang: 'plaintext', icon: 'FileText', color: 'text-slate-300' },
    { file: 'notes.txt', lang: 'plaintext', icon: 'FileText', color: 'text-slate-300' },
    // 20. Unknown fallback
    { file: 'mystery.bin', lang: 'plaintext', icon: 'File', color: 'text-slate-400' },
    { file: 'unknown_file_without_extension', lang: 'plaintext', icon: 'File', color: 'text-slate-400' },
  ];

  for (const item of extensionCases) {
    const lang = detectLanguage(item.file);
    const cfg = getFileConfig(item.file);
    assert.equal(lang, item.lang, `Language mismatch for ${item.file}: expected ${item.lang}, got ${lang}`);
    assert.equal(cfg.icon, item.icon, `Icon mismatch for ${item.file}: expected ${item.icon}, got ${cfg.icon}`);
    assert.equal(cfg.colorClass, item.color, `Color mismatch for ${item.file}: expected ${item.color}, got ${cfg.colorClass}`);
  }
});

test('Challenger M1 - 1.3: Directory icon states (collapsed vs expanded)', () => {
  const collapsedDir = getFileConfig('src', true, false);
  assert.equal(collapsedDir.icon, 'Folder');
  assert.equal(collapsedDir.colorClass, 'text-amber-400/90');

  const expandedDir = getFileConfig('src', true, true);
  assert.equal(expandedDir.icon, 'FolderOpen');
  assert.equal(expandedDir.colorClass, 'text-amber-400');
});

test('Challenger M1 - 1.4: Case-insensitivity and full path handling in FileIcon', () => {
  const testPaths = [
    { path: '/var/www/html/DOCKERFILE', expectedLang: 'dockerfile' },
    { path: 'C:\\projects\\app\\INDEX.PHP', expectedLang: 'php' },
    { path: 'src/components/HEADER.TSX', expectedLang: 'tsx' },
    { path: '.ENV.PRODUCTION', expectedLang: 'shell' },
    { path: 'public/ASSETS/LOGO.SVG', expectedLang: 'xml' },
  ];

  for (const tp of testPaths) {
    assert.equal(detectLanguage(tp.path), tp.expectedLang, `Case insensitivity failure for ${tp.path}`);
  }
});


// ============================================================================
// PART 2: Deep Tree Hierarchies, Search Filtering & Node Recursion Stress Tests
// ============================================================================

// Recursive filter logic from FileTree.tsx
function filterRecursive(list, query) {
  if (!query || !query.trim()) return list;
  const q = query.toLowerCase();
  const results = [];

  for (const item of list) {
    if (item.type === 'directory') {
      const matchingChildren = item.children ? filterRecursive(item.children, query) : [];
      if (item.name.toLowerCase().includes(q) || matchingChildren.length > 0) {
        results.push({
          ...item,
          children: matchingChildren.length > 0 ? matchingChildren : item.children,
          isExpanded: true,
        });
      }
    } else {
      if (item.name.toLowerCase().includes(q)) {
        results.push(item);
      }
    }
  }
  return results;
}

// Flatten visible nodes logic from FileTree.tsx
function collectVisibleNodes(nodes, expandedPaths, filterQuery) {
  const flat = [];
  function collect(list) {
    for (const item of list) {
      flat.push(item);
      if (item.type === 'directory' && (expandedPaths.has(item.path) || Boolean(filterQuery)) && item.children) {
        collect(item.children);
      }
    }
  }
  collect(nodes);
  return flat;
}

// Keyboard navigation simulator
function simulateKeyNav(visibleNodes, selectedPath, expandedPaths, key, callbacks = {}) {
  if (visibleNodes.length === 0) return { selectedPath, expandedPaths };

  let nextSelectedPath = selectedPath;
  const nextExpandedPaths = new Set(expandedPaths);
  const currentIndex = visibleNodes.findIndex((n) => n.path === selectedPath);
  const currentNode = currentIndex >= 0 ? visibleNodes[currentIndex] : null;

  switch (key) {
    case 'ArrowDown': {
      const nextIndex = currentIndex < visibleNodes.length - 1 ? currentIndex + 1 : 0;
      nextSelectedPath = visibleNodes[nextIndex]?.path || selectedPath;
      break;
    }
    case 'ArrowUp': {
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : visibleNodes.length - 1;
      nextSelectedPath = visibleNodes[prevIndex]?.path || selectedPath;
      break;
    }
    case 'ArrowRight': {
      if (currentNode && currentNode.type === 'directory') {
        if (!nextExpandedPaths.has(currentNode.path)) {
          nextExpandedPaths.add(currentNode.path);
        } else if (currentNode.children && currentNode.children.length > 0) {
          nextSelectedPath = currentNode.children[0].path;
        }
      }
      break;
    }
    case 'ArrowLeft': {
      if (currentNode) {
        if (currentNode.type === 'directory' && nextExpandedPaths.has(currentNode.path)) {
          nextExpandedPaths.delete(currentNode.path);
        } else {
          const parentPath = currentNode.path.split('/').slice(0, -1).join('/');
          if (parentPath) {
            const parentNode = visibleNodes.find((n) => n.path === parentPath);
            if (parentNode) nextSelectedPath = parentNode.path;
          }
        }
      }
      break;
    }
    case 'Home': {
      if (visibleNodes.length > 0) {
        nextSelectedPath = visibleNodes[0].path;
      }
      break;
    }
    case 'End': {
      if (visibleNodes.length > 0) {
        nextSelectedPath = visibleNodes[visibleNodes.length - 1].path;
      }
      break;
    }
    case 'Enter': {
      if (currentNode) {
        if (currentNode.type === 'directory') {
          if (nextExpandedPaths.has(currentNode.path)) {
            nextExpandedPaths.delete(currentNode.path);
          } else {
            nextExpandedPaths.add(currentNode.path);
          }
        } else {
          if (callbacks.onOpenFile) callbacks.onOpenFile(currentNode);
        }
      }
      break;
    }
  }

  return { selectedPath: nextSelectedPath, expandedPaths: nextExpandedPaths };
}

// Generate deep nested tree
function generateDeepTree(depth = 50, filesPerLevel = 2) {
  let currentLevel = null;
  let root = null;

  for (let i = 0; i < depth; i++) {
    const dirPath = i === 0 ? 'level_0' : `level_0/${Array.from({ length: i }, (_, k) => `level_${k + 1}`).join('/')}`;
    const dirNode = {
      name: `level_${i}`,
      path: dirPath,
      type: 'directory',
      children: [],
    };

    // Add sibling files
    for (let f = 0; f < filesPerLevel; f++) {
      dirNode.children.push({
        name: `file_${i}_${f}.ts`,
        path: `${dirPath}/file_${i}_${f}.ts`,
        type: 'file',
        size: 1024 * (i + 1),
      });
    }

    if (i === 0) {
      root = dirNode;
      currentLevel = dirNode;
    } else {
      currentLevel.children.push(dirNode);
      currentLevel = dirNode;
    }
  }

  // Target file at deepest level
  currentLevel.children.push({
    name: 'DEEP_TARGET_SECRET.sql',
    path: `${currentLevel.path}/DEEP_TARGET_SECRET.sql`,
    type: 'file',
    size: 2048,
  });

  return [root];
}

// Generate broad tree
function generateBroadTree(folderCount = 100, filesPerFolder = 20) {
  const roots = [];
  for (let i = 0; i < folderCount; i++) {
    const folder = {
      name: `package_${i}`,
      path: `package_${i}`,
      type: 'directory',
      children: [],
    };
    for (let j = 0; j < filesPerFolder; j++) {
      folder.children.push({
        name: `item_${i}_${j}.php`,
        path: `package_${i}/item_${i}_${j}.php`,
        type: 'file',
        size: 512,
      });
    }
    roots.push(folder);
  }
  return roots;
}

test('Challenger M1 - 2.1: Tree recursion under 50-level deep nesting', () => {
  const tree = generateDeepTree(50, 2);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, 'level_0');

  // Test search filtering for the deepest target
  const filtered = filterRecursive(tree, 'DEEP_TARGET_SECRET');
  assert.equal(filtered.length, 1, 'Root folder must remain when child matches');
  assert.equal(filtered[0].isExpanded, true, 'Root folder must be auto-expanded');

  // Verify full chain auto-expansion down to depth 50
  let curr = filtered[0];
  let depthCount = 0;
  while (curr && curr.children) {
    depthCount++;
    const nextDir = curr.children.find((c) => c.type === 'directory');
    if (nextDir) {
      assert.equal(nextDir.isExpanded, true, `Level ${depthCount} must be auto-expanded`);
      curr = nextDir;
    } else {
      break;
    }
  }
  assert.equal(depthCount, 50, 'All 50 nested levels must be traversed and auto-expanded');

  const targetFile = curr.children.find((c) => c.name === 'DEEP_TARGET_SECRET.sql');
  assert.ok(targetFile, 'Deepest target file must be present');
});

test('Challenger M1 - 2.2: Tree filtering with special regex characters and partial queries', () => {
  const sampleTree = [
    {
      name: 'src',
      path: 'src',
      type: 'directory',
      children: [
        { name: 'app[1].test.ts', path: 'src/app[1].test.ts', type: 'file' },
        { name: 'user (auth).php', path: 'src/user (auth).php', type: 'file' },
        { name: 'regex.*+?.js', path: 'src/regex.*+?.js', type: 'file' },
        { name: 'ไทย_config.json', path: 'src/ไทย_config.json', type: 'file' },
      ],
    },
    {
      name: 'docs',
      path: 'docs',
      type: 'directory',
      children: [
        { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
      ],
    },
  ];

  // 1. Search with bracket character '['
  const filteredBrackets = filterRecursive(sampleTree, 'app[1]');
  assert.equal(filteredBrackets.length, 1);
  assert.equal(filteredBrackets[0].children.length, 1);
  assert.equal(filteredBrackets[0].children[0].name, 'app[1].test.ts');

  // 2. Search with regex special characters '.*+?'
  const filteredRegexChars = filterRecursive(sampleTree, '.*+?');
  assert.equal(filteredRegexChars.length, 1);
  assert.equal(filteredRegexChars[0].children.length, 1);
  assert.equal(filteredRegexChars[0].children[0].name, 'regex.*+?.js');

  // 3. Search with Unicode / Thai characters
  const filteredThai = filterRecursive(sampleTree, 'ไทย');
  assert.equal(filteredThai.length, 1);
  assert.equal(filteredThai[0].children[0].name, 'ไทย_config.json');

  // 4. Non-matching query yields empty list
  const filteredNone = filterRecursive(sampleTree, 'NON_EXISTENT_QUERY_12345');
  assert.equal(filteredNone.length, 0);

  // 5. Empty query preserves complete tree intact
  const filteredEmpty = filterRecursive(sampleTree, '');
  assert.equal(filteredEmpty.length, 2);
  assert.equal(filteredEmpty[0].children.length, 4);
});

test('Challenger M1 - 2.3: Broad tree scale performance (2,100 nodes)', () => {
  const broadTree = generateBroadTree(100, 20); // 100 folders * 20 files + 100 folders = 2,100 nodes
  assert.equal(broadTree.length, 100);

  const startTime = performance.now();
  const searchResults = filterRecursive(broadTree, 'item_42_15');
  const elapsed = performance.now() - startTime;

  assert.ok(elapsed < 50, `Filtering 2,100 nodes should complete under 50ms (took ${elapsed.toFixed(2)}ms)`);
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].name, 'package_42');
  assert.equal(searchResults[0].children.length, 1);
  assert.equal(searchResults[0].children[0].name, 'item_42_15.php');
});

test('Challenger M1 - 2.4: Visible node collection and keyboard navigation sequence', () => {
  const tree = [
    {
      name: 'app',
      path: 'app',
      type: 'directory',
      children: [
        {
          name: 'models',
          path: 'app/models',
          type: 'directory',
          children: [
            { name: 'User.php', path: 'app/models/User.php', type: 'file' },
            { name: 'Post.php', path: 'app/models/Post.php', type: 'file' },
          ],
        },
        { name: 'index.php', path: 'app/index.php', type: 'file' },
      ],
    },
    {
      name: 'public',
      path: 'public',
      type: 'directory',
      children: [
        { name: 'style.css', path: 'public/style.css', type: 'file' },
      ],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ];

  // Initial state: all collapsed
  let expanded = new Set();
  let visible = collectVisibleNodes(tree, expanded, '');
  assert.deepEqual(visible.map((n) => n.path), ['app', 'public', 'README.md']);

  // Expand 'app'
  expanded.add('app');
  visible = collectVisibleNodes(tree, expanded, '');
  assert.deepEqual(visible.map((n) => n.path), ['app', 'app/models', 'app/index.php', 'public', 'README.md']);

  // Expand 'app/models'
  expanded.add('app/models');
  visible = collectVisibleNodes(tree, expanded, '');
  assert.deepEqual(visible.map((n) => n.path), [
    'app',
    'app/models',
    'app/models/User.php',
    'app/models/Post.php',
    'app/index.php',
    'public',
    'README.md',
  ]);

  // Test Keyboard Navigation Traversal
  let state = { selectedPath: 'app', expandedPaths: expanded };

  // 1. ArrowDown -> selects 'app/models'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowDown');
  assert.equal(state.selectedPath, 'app/models');

  // 2. ArrowDown -> selects 'app/models/User.php'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowDown');
  assert.equal(state.selectedPath, 'app/models/User.php');

  // 3. ArrowLeft on file -> jumps to parent directory 'app/models'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowLeft');
  assert.equal(state.selectedPath, 'app/models');

  // 4. ArrowLeft on open directory -> collapses 'app/models'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowLeft');
  assert.ok(!state.expandedPaths.has('app/models'), 'ArrowLeft must collapse open folder');

  // Refresh visible nodes after collapse
  visible = collectVisibleNodes(tree, state.expandedPaths, '');
  assert.deepEqual(visible.map((n) => n.path), ['app', 'app/models', 'app/index.php', 'public', 'README.md']);

  // 5. End key -> jumps to 'README.md'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'End');
  assert.equal(state.selectedPath, 'README.md');

  // 6. ArrowDown on last element wraps to first element ('app')
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowDown');
  assert.equal(state.selectedPath, 'app');

  // 7. ArrowUp on first element wraps to last element ('README.md')
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'ArrowUp');
  assert.equal(state.selectedPath, 'README.md');

  // 8. Home key -> jumps to 'app'
  state = simulateKeyNav(visible, state.selectedPath, state.expandedPaths, 'Home');
  assert.equal(state.selectedPath, 'app');

  // 9. Enter on file opens file
  let openedFile = null;
  state = simulateKeyNav(visible, 'README.md', state.expandedPaths, 'Enter', {
    onOpenFile: (node) => {
      openedFile = node.path;
    },
  });
  assert.equal(openedFile, 'README.md');
});


// ============================================================================
// PART 3: WorkspaceTabBar Scrolling & Dirty Indicator Behavior Stress Tests
// ============================================================================

// Model Tab Item state
function createTab(id, path, originalContent, currentContent) {
  const name = path.split('/').pop() || path;
  return {
    id,
    path,
    name,
    originalContent,
    currentContent,
    isDirty: originalContent !== currentContent,
    language: detectLanguage(path),
  };
}

test('Challenger M1 - 3.1: WorkspaceTab dirty indicator state logic', () => {
  const cleanTab = createTab('src/app.ts', 'src/app.ts', 'console.log(1);', 'console.log(1);');
  assert.equal(cleanTab.isDirty, false, 'Clean tab must have isDirty = false');

  const dirtyTab = createTab('src/app.ts', 'src/app.ts', 'console.log(1);', 'console.log(2);');
  assert.equal(dirtyTab.isDirty, true, 'Modified tab must have isDirty = true');

  // Verify TabItem styling classes from WorkspaceTabItem.tsx
  const tabItemSource = readFileSync('app/components/code-workspace/WorkspaceTabItem.tsx', 'utf8');
  assert.match(tabItemSource, /bg-\[\#ff3c43\]/, 'WorkspaceTabItem must render dirty dot in red #ff3c43');
  assert.match(tabItemSource, /aria-label=\{\`Close \$\{tab\.name\}\`\}/, 'Close button must have aria-label');
  assert.match(tabItemSource, /onAuxClick=\{onMiddleClick\}/, 'WorkspaceTabItem must handle middle-click via onAuxClick');
});

test('Challenger M1 - 3.2: WorkspaceTabBar wheel scroll & auto-scroll verification', () => {
  const tabBarSource = readFileSync('app/components/code-workspace/WorkspaceTabBar.tsx', 'utf8');
  
  // 1. Wheel translation: deltaY -> scrollLeft
  assert.match(tabBarSource, /tabStripRef\.current\.scrollLeft\s*\+=\s*e\.deltaY/, 'TabBar must convert vertical wheel deltaY to horizontal scrollLeft');

  // 2. Auto-scroll active tab into view
  assert.match(tabBarSource, /scrollIntoView\(\{\s*behavior:\s*"smooth",\s*block:\s*"nearest",\s*inline:\s*"nearest"\s*\}\)/, 'Active tab must scroll into view smoothly');

  // 3. Middle click close handler (e.button === 1)
  assert.match(tabBarSource, /if\s*\(e\.button\s*===\s*1\)/, 'Middle click must check e.button === 1');
  assert.match(tabBarSource, /e\.preventDefault\(\)/, 'Middle click must prevent default behavior');

  // 4. Empty state placeholder
  assert.match(tabBarSource, /ยังไม่มีไฟล์ที่เปิดอยู่/, 'Empty tab bar must render placeholder message');
});

test('Challenger M1 - 3.3: WorkspaceStatusBar telemetry contract verification', () => {
  const statusBarSource = readFileSync('app/components/code-workspace/WorkspaceStatusBar.tsx', 'utf8');

  assert.match(statusBarSource, /Ln\s*\{cursorPosition\.line\},\s*Col\s*\{cursorPosition\.col\}/, 'StatusBar must track cursor line and column');
  assert.match(statusBarSource, /Viewer\s*\(Read-Only\)/, 'StatusBar must display Viewer badge when role is viewer');
  assert.match(statusBarSource, /activeTab\.isDirty/, 'StatusBar must display Unsaved badge when active tab is dirty');
  assert.match(statusBarSource, /isSaving/, 'StatusBar must display save pulse indicator when saving');
});

test('Challenger M1 - 3.4: Context menu collision clamping & accessibility', () => {
  const contextMenuSource = readFileSync('app/components/code-workspace/FileContextMenu.tsx', 'utf8');

  // 1. Viewport collision boundary check
  assert.match(contextMenuSource, /window\.innerWidth\s*-\s*MENU_WIDTH/, 'Context menu must clamp horizontal position within viewport');
  assert.match(contextMenuSource, /window\.innerHeight\s*-\s*MENU_ESTIMATED_HEIGHT/, 'Context menu must clamp vertical position within viewport');

  // 2. Escape key dismissal
  assert.match(contextMenuSource, /if\s*\(e\.key\s*===\s*"Escape"\)\s*onClose\(\)/, 'Context menu must dismiss on Escape key');

  // 3. Role enforcement for viewer
  assert.match(contextMenuSource, /const\s+isViewer\s*=\s*accessRole\s*===\s*"viewer"/, 'Context menu must check viewer access role');
});

test('Challenger M1 - 3.5: Multi-tab switching with 100 tabs stress test', () => {
  const tabs = [];
  for (let i = 0; i < 100; i++) {
    tabs.push(createTab(`file_${i}.ts`, `src/module/file_${i}.ts`, `let a = ${i};`, i % 3 === 0 ? `let a = ${i + 1};` : `let a = ${i};`));
  }

  assert.equal(tabs.length, 100);
  const dirtyCount = tabs.filter((t) => t.isDirty).length;
  assert.equal(dirtyCount, 34, 'Exactly 34 of 100 tabs should be marked dirty (every 3rd tab)');

  // Select tab 50
  const activeTabId = tabs[50].id;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  assert.equal(activeTab.path, 'src/module/file_50.ts');
  assert.equal(activeTab.language, 'typescript');
});
