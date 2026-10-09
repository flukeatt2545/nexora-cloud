# E2E Test Infrastructure Specification & Architecture
**Project**: VS Code-style File Explorer & CodeMirror 6 Code Editor for NEXORA Cloud Hosting

---

## 1. Test Architecture Overview

The E2E test suite provides opaque-box and contract-level verification for the IDE-class code workspace upgrade in NEXORA Cloud Hosting. The test infrastructure runs natively on Node.js using `node:test` and `node:assert/strict` with zero external test framework dependencies.

```
+-----------------------------------------------------------------------------------------------+
|                                    E2E Test Runner (runner.mjs)                               |
+-------------------------------+-------------------------------+-------------------------------+
|  Tier 1: Feature Coverage     |  Tier 2: Boundary & Corner    |  Tier 3: Cross-Feature        |
|  - 17 Features in PROJECT.md  |  - 8 Boundary Categories      |  - 10 Pairwise & Complex      |
|  - 93 Test Cases              |  - 40 Test Cases              |    Multi-Step Scenarios       |
+-------------------------------+-------------------------------+-------------------------------+
|  Tier 4: Workload Scenarios   |  Shared Test Harness (harness.mjs)                            |
|  - 5 Real-World Framework     |  - MockHostingBackend (Go backend emulator & API validator)  |
|    Editing Lifecycles         |  - WorkspaceSession (UI state machine & tab manager)          |
|  - 5 End-to-End Scenarios     |  - Language & Icon resolvers, Diff Engine                     |
+-------------------------------+---------------------------------------------------------------+
```

---

## 2. Directory Layout

```
tests/e2e/code-workspace/
├── harness.mjs                        # Shared test harness, mock backend & session emulator
├── runner.mjs                         # Automated multi-tier test runner & summary reporter
├── tier1-feature-coverage.test.mjs    # Tier 1: 17 Features x >=5 tests (93 tests)
├── tier2-boundary-corner.test.mjs     # Tier 2: 8 Boundary categories x >=5 tests (40 tests)
├── tier3-cross-feature.test.mjs       # Tier 3: 10 Cross-feature lifecycle workflows
└── tier4-application-scenarios.test.mjs # Tier 4: 5 Real-world project editing scenarios
```

---

## 3. Tier Matrix & Feature Coverage Breakdown

### Tier 1: Feature Coverage (93 Test Cases)
| # | Feature | Test Count | Key Verifications |
|---|---------|------------|-------------------|
| F1 | CodeMirror 6 Dependencies | 5 | Package presence, 11+ language mappings, special configs (Dockerfile/Nginx), fallback to plaintext, PROJECT.md layout. |
| F2 | Hierarchical File Tree View | 5 | Alphabetical + directory-first sorting, lazy folder expand, collapse toggle, 4+ nesting levels, traversal attack rejection (`../`). |
| F3 | Extension-based File Icons | 5 | Yellow folder, web icons (PHP/JS/TS/HTML/CSS), data/backend icons (JSON/Python/Go/SQL/YAML), DevOps icons, fallback slate file icon. |
| F4 | Multi-Tab Bar & State Tracking | 5 | Multi-tab opening with unique IDs, deduplicated open, active tab switching + cursor sync, dirty indicator dot toggling, adjacent tab selection on close. |
| F5 | Workspace Status Bar | 5 | File path display, language mode, line/col coordinates, user role display & read-only tag, empty workspace placeholder. |
| F6 | CodeMirror 6 Engine & Theme | 5 | Obsidian dark theme tokens (`#0d1117`), content update dispatch, viewer mode mutation prevention, line numbers/folding contracts, buffer unmount cleanup. |
| F7 | Syntax Highlighting Suite | 11 | PHP (`.php`, `.phtml`, `.blade.php`), JS/TS (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`), HTML/XML (`.html`, `.htm`, `.svg`), CSS/SCSS (`.css`, `.scss`, `.less`), JSON/YAML (`.json`, `.yaml`, `.yml`), Python (`.py`, `.pyw`), Go (`.go`), SQL (`.sql`), Markdown (`.md`), Shell (`.sh`, `.bash`, `.env`), Dockerfile & Nginx. |
| F8 | Editor Ergonomics & Keymaps | 5 | Ctrl+S save shortcut trigger, code folding bracket balance, active line highlight sync, tab indentation, undo/redo buffer history. |
| F9 | Search & Replace Bar | 5 | Substring matching, case-sensitive toggle, regex matching, replace all across buffer, empty query safety. |
| F10 | Mobile & Touch Support | 5 | Mobile session flag initialization, drawer sidebar toggle, touch gutter target size (>=36px), 100dvh viewport container, horizontal tab bar scroll. |
| F11 | Multi-Tab State Management | 5 | Independent tab buffer isolation, scroll position state retention, cursor coordinates retention per tab, tab ID path normalization, clean empty state on closing all tabs. |
| F12 | Hosting API Save & CRUD Operations | 7 | PUT `/files/content`, POST `/files/folders`, POST `/files/upload`, POST `/files/move`, DELETE `/files`, POST `/files/archive`, POST `/files/extract`. |
| F13 | Diff Confirmation Dialog | 5 | Line additions calculation, line deletions calculation, multiline replacement hunks, commit on diff confirmation, 0-addition/0-deletion identical diff. |
| F14 | Unsaved Changes Guard | 5 | Confirmation modal on closing dirty tab, discard changes closes tab, cancel keeps dirty tab open, force close bypass, clean tab closes without modal. |
| F15 | Viewer Role Read-Only Enforcement | 5 | Save blocked (403), create folder blocked (403), delete blocked (403), upload blocked (403), read and download permitted. |
| F16 | HostingView UI Integration | 5 | HostingView route bindings, file actions route coverage, CodeWorkspaceModalProps interface contract, initialFile prop auto-focus, save notification dispatch. |
| F17 | E2E Testing Suite Verification | 5 | All 17 features covered, Windows & Unix canonical path normalization, traversal rejection, non-empty editable path validation, runner execution. |

### Tier 2: Boundary & Corner Cases (40 Test Cases)
| # | Boundary Category | Test Count | Key Verifications |
|---|-------------------|------------|-------------------|
| B1 | Empty Files (0-byte) | 5 | 0-byte file load as empty string, saving empty string, 0-to-N additions diff, N-to-0 deletions diff, syntax detection on empty file. |
| B2 | Massive Files (approaching 2MB limit) | 5 | 1.95MB file loading, >2MB file rejection (415 error), 10k line diff performance (<3s), search & replace on 5,000 occurrences without memory leak, 1.95MB save within limit. |
| B3 | Deep Folder Structures (10+ levels) | 5 | 12-level nested path canonicalization, listing at level 10 returning level 11, moving deep folder tree preserving structure, recursive deletion of 10+ levels, deep path basename extraction in tabs. |
| B4 | Special Characters & Unicode / Thai | 5 | Thai directory & filename (`ภาษาไทย/ระบบจัดการผู้ใช้.php`) load/edit/save, spaces in filenames & download headers, symbols (`@`, `_`, `-`, `.`, `[]`, `()`, `!`), mixed slash canonicalization, Thai UTF-8 diff integrity. |
| B5 | Binary & Unsupported Media | 5 | Null bytes (`\x00`) rejected with 415 `not_editable`, image files (.png, .jpg) rejected in editor, zip archive non-editable but downloadable, non-UTF-8 octet-stream download, preview on binary returning 415. |
| B6 | Rapid Tab Switching | 5 | Rapid switching across 10 tabs maintaining dirty states, cursor position retention across 10 tabs, 100x rapid tab switch without memory leak, no-op active tab switch, alternating rapid edits on 2 tabs. |
| B7 | Rapid Typing & Auto-Dirty | 5 | Successive keystrokes appending cleanly, dirty flag set on first keystroke, auto-revert to original resetting dirty flag to false, save updating originalContent and clearing dirty, viewer role throwing error on every keystroke. |
| B8 | Closing Active vs Inactive Tabs | 5 | Closing active tab activates next tab, closing active tab at end activates previous tab, closing clean inactive tab leaves active tab untouched, closing dirty inactive tab prompts confirmation for that tab, closing all tabs empties workspace. |

### Tier 3: Cross-Feature Interactions (10 Complex Workflows)
1. **Scenario 3.1**: Edit file -> switch tab -> create new file -> switch back -> diff dialog -> save -> verify state.
2. **Scenario 3.2**: Viewer role attempting mutations while switching tabs & navigating tree.
3. **Scenario 3.3**: Rename file while open in active tab -> verify tab updates and saves at new path.
4. **Scenario 3.4**: Extract ZIP archive -> refresh file tree -> open extracted file in new tab.
5. **Scenario 3.5**: Delete open file -> tab remains with unsaved edits and saves as recreation.
6. **Scenario 3.6**: Multi-tab search and replace refactoring across multiple open buffers.
7. **Scenario 3.7**: Upload file overwriting existing path updates file on disk.
8. **Scenario 3.8**: Mobile viewport toggle during active multi-tab edit session.
9. **Scenario 3.9**: Bulk archive selected files -> verify zip creation & tree node update.
10. **Scenario 3.10**: Unsaved changes prompt cancel vs discard vs save workflow when closing workspace modal.

### Tier 4: Real-World Workload Scenarios (5 Scenarios)
1. **Scenario 4.1**: Laravel / WordPress Full Project Editing (.env, routes/web.php, HomeController.php, welcome.blade.php, diff preview, save, permissions).
2. **Scenario 4.2**: Node.js / TypeScript Microservice Refactoring (package.json, src/index.ts, src/config.ts, tsconfig.json, regex search/replace, diff and save).
3. **Scenario 4.3**: Python FastAPI / Flask Web API Service (main.py, requirements.txt, config.yaml, models.py, adding route, dirty tracking, saving).
4. **Scenario 4.4**: WordPress Theme & Plugin Customization with Viewer Lockout (wp-config.php, functions.php, style.css, header.php, viewer lock test, save).
5. **Scenario 4.5**: Fullstack Go + Docker Cloud Native App (main.go, Dockerfile, docker-compose.yml, nginx.conf, schema.sql, diff verification, save).

---

## 4. Test Execution Commands

```bash
# Run entire test suite via dedicated runner:
node tests/e2e/code-workspace/runner.mjs

# Or run via Node.js built-in test runner:
node --test tests/e2e/code-workspace/*.test.mjs

# Or run individual tiers:
node --test tests/e2e/code-workspace/tier1-feature-coverage.test.mjs
node --test tests/e2e/code-workspace/tier2-boundary-corner.test.mjs
node --test tests/e2e/code-workspace/tier3-cross-feature.test.mjs
node --test tests/e2e/code-workspace/tier4-application-scenarios.test.mjs
```

---

## 5. Test Results Summary

- **Total Test Suites**: 4 suites
- **Total Test Cases**: 148 automated tests
- **Pass Rate**: 100% (148 passed, 0 failed, 0 skipped)
- **Execution Time**: ~1.5 seconds