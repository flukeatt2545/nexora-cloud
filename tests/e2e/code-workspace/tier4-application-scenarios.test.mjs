import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockHostingBackend,
  WorkspaceSession
} from './harness.mjs';

// ============================================================================
// TIER 4: REAL-WORLD WORKLOAD SCENARIOS
// ============================================================================

test('Scenario 4.1: Laravel / WordPress Full Project Editing Scenario', async () => {
  const backend = new MockHostingBackend({
    '.env': 'APP_NAME=Laravel\nAPP_ENV=production\nDB_HOST=127.0.0.1\nDB_DATABASE=app_db',
    'routes/web.php': '<?php\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get("/", function () {\n    return view("welcome");\n});',
    'app/Http/Controllers/HomeController.php': '<?php\nnamespace App\\Http\\Controllers;\n\nclass HomeController extends Controller {\n    public function index() {\n        return response()->json(["status" => "ok"]);\n    }\n}',
    'resources/views/welcome.blade.php': '<!DOCTYPE html>\n<html>\n<head><title>NEXORA</title></head>\n<body><h1>Welcome</h1></body>\n</html>'
  });
  const session = new WorkspaceSession({ backend });

  // 1. Open .env and change database name
  await session.openFile('.env');
  assert.equal(session.getActiveTab().language, 'shell');
  session.updateActiveContent('APP_NAME=Laravel\nAPP_ENV=production\nDB_HOST=127.0.0.1\nDB_DATABASE=nexora_production_db');
  await session.triggerSave(false);
  assert.equal(session.getActiveTab().isDirty, false);

  // 2. Open routes/web.php and add new API route
  await session.openFile('routes/web.php');
  assert.equal(session.getActiveTab().language, 'php');
  const originalRoutes = session.getActiveTab().originalContent;
  const newRoutes = originalRoutes + '\nRoute::get("/api/health", [HomeController::class, "index"]);';
  session.updateActiveContent(newRoutes);

  // 3. Review diff preview before saving routes/web.php
  const diffRes = await session.triggerSave(true);
  assert.equal(diffRes.status, 'diff_requested');
  assert.equal(session.dialog.diff.additions, 1);
  assert.equal(session.dialog.diff.deletions, 0);
  session.confirmDiffAndSave();

  // 4. Open Blade template and update title
  await session.openFile('resources/views/welcome.blade.php');
  assert.equal(session.getActiveTab().language, 'php');
  session.updateActiveContent('<!DOCTYPE html>\n<html>\n<head><title>NEXORA Cloud Hosting</title></head>\n<body><h1>Welcome to NEXORA</h1></body>\n</html>');
  await session.triggerSave(false);

  // 5. Verify all saved files on backend
  assert.match(backend.readFile('.env').content, /nexora_production_db/);
  assert.match(backend.readFile('routes/web.php').content, /api\/health/);
  assert.match(backend.readFile('resources/views/welcome.blade.php').content, /NEXORA Cloud Hosting/);
});

test('Scenario 4.2: Node.js / TypeScript Microservice Refactoring Scenario', async () => {
  const backend = new MockHostingBackend({
    'package.json': '{\n  "name": "microservice",\n  "version": "1.0.0",\n  "main": "dist/index.js"\n}',
    'tsconfig.json': '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext"\n  }\n}',
    'src/index.ts': 'import http from "node:http";\nconst PORT = process.env.PORT || 8080;\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { "Content-Type": "application/json" });\n  res.end(JSON.stringify({ status: "ok" }));\n});\nserver.listen(PORT);',
    'src/config.ts': 'export const DEFAULT_PORT = 8080;'
  });
  const session = new WorkspaceSession({ backend });

  // 1. Open package.json and update version
  await session.openFile('package.json');
  assert.equal(session.getActiveTab().language, 'json');
  session.replaceAll('"version": "1.0.0"', '"version": "1.1.0"', true, false);
  await session.triggerSave(false);

  // 2. Open src/index.ts and perform refactor from 8080 to config constant
  await session.openFile('src/index.ts');
  assert.equal(session.getActiveTab().language, 'typescript');
  session.replaceAll('const PORT = process.env.PORT || 8080;', 'import { DEFAULT_PORT } from "./config";\nconst PORT = process.env.PORT || DEFAULT_PORT;');
  
  // 3. Diff check and save
  const diffRes = await session.triggerSave(true);
  assert.equal(diffRes.status, 'diff_requested');
  session.confirmDiffAndSave();

  // 4. Verify saved state
  assert.match(backend.readFile('package.json').content, /"version": "1\.1\.0"/);
  assert.match(backend.readFile('src/index.ts').content, /DEFAULT_PORT/);
});

test('Scenario 4.3: Python FastAPI / Flask Web API Service Editing Scenario', async () => {
  const backend = new MockHostingBackend({
    'requirements.txt': 'fastapi>=0.110.0\nuvicorn>=0.28.0\npydantic>=2.6.0',
    'main.py': 'from fastapi import FastAPI\napp = FastAPI(title="NEXORA API")\n\n@app.get("/api/v1/status")\ndef status():\n    return {"online": True}\n',
    'config.yaml': 'server:\n  host: 0.0.0.0\n  port: 8000\n  workers: 4\n'
  });
  const session = new WorkspaceSession({ backend });

  // 1. Open requirements.txt and add sqlalchemy
  await session.openFile('requirements.txt');
  session.updateActiveContent(session.getActiveTab().originalContent + '\nsqlalchemy>=2.0.0');
  await session.triggerSave(false);

  // 2. Open main.py and add new endpoint
  await session.openFile('main.py');
  assert.equal(session.getActiveTab().language, 'python');
  const newMain = session.getActiveTab().originalContent + '\n@app.get("/api/v1/version")\ndef get_version():\n    return {"version": "2.0.0"}\n';
  session.updateActiveContent(newMain);
  await session.triggerSave(false);

  // 3. Open config.yaml and adjust port to 8080
  await session.openFile('config.yaml');
  assert.equal(session.getActiveTab().language, 'yaml');
  session.replaceAll('port: 8000', 'port: 8080', true, false);
  await session.triggerSave(false);

  // 4. Verify backend integrity
  assert.match(backend.readFile('requirements.txt').content, /sqlalchemy/);
  assert.match(backend.readFile('main.py').content, /get_version/);
  assert.match(backend.readFile('config.yaml').content, /port: 8080/);
});

test('Scenario 4.4: WordPress Theme & Plugin Customization with Viewer Lockout', async () => {
  const backend = new MockHostingBackend({
    'wp-config.php': '<?php\ndefine("DB_NAME", "wp_db");\ndefine("WP_DEBUG", false);',
    'wp-content/themes/nexora/functions.php': '<?php\nfunction nexora_theme_setup() {\n    add_theme_support("title-tag");\n}',
    'wp-content/themes/nexora/style.css': '/*\nTheme Name: NEXORA Theme\nVersion: 1.0\n*/\nbody { font-family: sans-serif; }'
  });

  // Owner edits theme CSS
  const ownerSession = new WorkspaceSession({ backend, role: 'owner' });
  await ownerSession.openFile('wp-content/themes/nexora/style.css');
  assert.equal(ownerSession.getActiveTab().language, 'css');
  ownerSession.updateActiveContent('/*\nTheme Name: NEXORA Theme\nVersion: 1.1\n*/\nbody { font-family: sans-serif; background: #0d1117; }');
  await ownerSession.triggerSave(false);

  // Viewer attempts to modify wp-config.php
  const viewerSession = new WorkspaceSession({ backend, role: 'viewer' });
  await viewerSession.openFile('wp-config.php');
  assert.throws(() => viewerSession.updateActiveContent('define("WP_DEBUG", true);'), /read-only/);

  // Verify stylesheet was updated and config remains untouched
  assert.match(backend.readFile('wp-content/themes/nexora/style.css').content, /background: #0d1117/);
  assert.match(backend.readFile('wp-config.php').content, /"WP_DEBUG", false/);
});

test('Scenario 4.5: Fullstack Go + Docker Cloud Native App Scenario', async () => {
  const backend = new MockHostingBackend({
    'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Starting Server")\n}',
    'Dockerfile': 'FROM golang:1.22-alpine AS builder\nWORKDIR /app\nCOPY . .\nRUN go build -o server main.go\nCMD ["./server"]',
    'docker-compose.yml': 'version: "3.8"\nservices:\n  api:\n    build: .\n    ports:\n      - "8080:8080"',
    'nginx.conf': 'server {\n    listen 80;\n    location / {\n        proxy_pass http://api:8080;\n    }\n}',
    'schema.sql': 'CREATE TABLE IF NOT EXISTS users (\n    id SERIAL PRIMARY KEY,\n    email VARCHAR(255) NOT NULL UNIQUE\n);'
  });
  const session = new WorkspaceSession({ backend });

  // 1. Verify language mappings
  const files = ['main.go', 'Dockerfile', 'docker-compose.yml', 'nginx.conf', 'schema.sql'];
  const expectedLangs = ['go', 'dockerfile', 'yaml', 'nginx', 'sql'];
  for (let i = 0; i < files.length; i++) {
    const tab = await session.openFile(files[i]);
    assert.equal(tab.language, expectedLangs[i]);
  }

  // 2. Edit main.go
  session.switchTab('main.go');
  session.updateActiveContent('package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("NEXORA Cloud Engine v6 Ready")\n}');
  await session.triggerSave(false);

  // 3. Edit Dockerfile
  session.switchTab('Dockerfile');
  session.replaceAll('golang:1.22-alpine', 'golang:1.23-alpine', true, false);
  await session.triggerSave(false);

  // 4. Verify backend state
  assert.match(backend.readFile('main.go').content, /NEXORA Cloud Engine v6 Ready/);
  assert.match(backend.readFile('Dockerfile').content, /golang:1\.23-alpine/);
});