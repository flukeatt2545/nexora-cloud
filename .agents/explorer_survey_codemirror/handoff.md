# CodeMirror 6 Specification Mining Handoff Report

## 1. Observation
- **Authoritative Request**: Checked `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md` lines 18–23 (R2 requirements for CodeMirror 6 with line numbers, active line highlight, code folding, search/replace, dark theme, touch/mobile, and syntax highlighting for PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML).
- **Existing Dependencies**: Checked `package.json` lines 15–41. No `@codemirror/*` packages are currently installed in `dependencies` or `devDependencies`.
- **Existing Editor Implementation**: Checked `app/dashboard/HostingView.tsx` line 1783: `<textarea value={fileContent} readOnly={detail.site.accessRole === "viewer"} spellCheck={false} onChange={(event) => setFileContent(event.target.value)} aria-label={`แก้ไข ${selectedFile}`} />`.
- **Hosting Theme & Palette**: Checked `app/theme.css` lines 5–49. Dark theme uses obsidian background `--background: #08090d`, surface `--surface: #12141d`, `--surface-strong: #1a1d29`, primary accent `--primary: #ff1018`, text `--text: #edf1f5`, muted `--muted: #b7c0cb`, line `--border: rgba(255, 255, 255, .15)`.
- **NPM Package Verification**: Verified latest package availability on npm:
  - `@codemirror/state` (6.7.1)
  - `@codemirror/view` (6.43.9)
  - `@codemirror/commands` (6.11.0)
  - `@codemirror/search` (6.7.1)
  - `@codemirror/language` (6.12.4)
  - `@codemirror/lint` (6.9.7)
  - `@codemirror/autocomplete` (6.20.3)
  - `@lezer/highlight` (1.2.3)
  - `@codemirror/lang-javascript` (6.2.5)
  - `@codemirror/lang-html` (6.4.12)
  - `@codemirror/lang-css` (6.3.1)
  - `@codemirror/lang-json` (6.0.2)
  - `@codemirror/lang-python` (6.2.1)
  - `@codemirror/lang-php` (6.0.2)
  - `@codemirror/lang-sql` (6.10.0)
  - `@codemirror/lang-markdown` (6.5.2)
  - `@codemirror/lang-yaml` (6.1.3)
  - `@codemirror/lang-go` (6.0.1)
  - `@codemirror/legacy-modes` (6.5.3)

## 2. Logic Chain
1. *From Observation 1 & 2*: CodeMirror 6 must be installed as modular packages rather than monolithic or deprecated packages to ensure Tree-Shaking, TypeScript support, and low bundle overhead.
2. *From Observation 3*: Replacing the raw `<textarea>` with an isolated, modular `CodeEditor` component (`app/components/code-workspace/CodeEditor.tsx`) isolates DOM lifecycle from React render loops.
3. *From React 19 / Vinext RSC Environment*: CodeMirror requires DOM APIs not present in server contexts. Therefore, the editor component must be strictly marked `"use client"`, instantiated inside `useEffect`, and safely torn down with `view.destroy()`.
4. *From Multi-Tab & File Switching Workflow*: Rebuilding the entire `EditorView` on tab change would destroy undo history and scroll position. Utilizing `Compartment` (`languageCompartment`, `readOnlyCompartment`, `themeCompartment`) provides zero-overhead reconfiguration.
5. *From Observation 4*: Custom `EditorView.theme` and `HighlightStyle.define` with `@lezer/highlight` tags maps NEXORA's obsidian palette to syntax tokens (e.g., `#f43f5e` keywords, `#38bdf8` functions, `#34d399` strings, `#fbbf24` numbers, `#64748b` comments).
6. *From Observation 1 & 5*: All 11 requested languages (PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML) plus legacy fallbacks (Shell, Dockerfile, Nginx) are directly satisfiable using official `@codemirror/lang-*` packages and `@codemirror/legacy-modes`.

## 3. Caveats
- Legacy modes (Shell, Dockerfile, Nginx) use `@codemirror/legacy-modes` and `StreamLanguage.define()` rather than Lezer AST parsers. They provide fast token highlighting but lack AST-driven code folding.
- Large files (> 5MB) should display a warning or truncation prompt in the file manager before opening to avoid memory spikes in mobile browser engines.
- No other caveats.

## 4. Conclusion
The CodeMirror 6 specification is complete, verified against npm registry versions, and architecturally mapped to the NEXORA Cloud platform. All required extensions, keymaps, themes, compartments, and language mappings are fully documented in `survey_report.md`. The orchestrator and implementer agents can immediately proceed with package installation and component creation.

## 5. Verification Method
- Inspect `.agents/explorer_survey_codemirror/survey_report.md` for full architectural blueprints, code examples, and feature/edge-case tables.
- Verify npm package installation with:
  ```bash
  npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/search @codemirror/language @codemirror/lint @codemirror/autocomplete @lezer/highlight @codemirror/lang-javascript @codemirror/lang-php @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-python @codemirror/lang-go @codemirror/lang-sql @codemirror/lang-markdown @codemirror/lang-yaml @codemirror/legacy-modes
  ```
- Run `npm run build` or `npm run dev` to verify compatibility with Vite/Vinext and React 19.
