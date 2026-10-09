# Dispatch Assignment

## 2026-08-29T21:45:24Z

Investigate the codebase in c:\Users\nkn246\Desktop\nkn-v6-new-ui regarding CodeMirror 6:
1. Check `package.json` and installed node_modules for `@codemirror/*` (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/lint`, etc.) and language packages (`@codemirror/lang-javascript`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json`, `@codemirror/lang-python`, `@codemirror/lang-php`, `@codemirror/lang-sql`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, or `@codemirror/legacy-modes` for Go/others).
2. Check if any packages are missing and document exact package names and versions needed.
3. Investigate how CodeMirror 6 should be initialized in React/Next.js/Vinext environment (client-side rendering / SSR considerations, React ref/container, Compartment for dynamic reconfigurations like theme, language extension swapping, read-only mode).
4. Survey exact extensions required:
   - Line numbers & gutter
   - Active line highlight & line wrapping
   - Code folding & fold gutter
   - Search & replace keymap / panel (`openSearchPanel`, Ctrl+F / Ctrl+H / Cmd+F)
   - Dark theme matching NEXORA Cloud palette (e.g., `#0f172a`, `#1e293b`, `#334155`, `#38bdf8`, `#818cf8`, `#34d399`, `#f43f5e`, `#fbbf24`)
   - Syntax highlighting loader for: PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML
   - Read-only / disabled state enforcement for Viewer role
   - Touch / mobile support (viewport margin, responsive scrolling, touch selection)

OUTPUT REQUIREMENTS:
- `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_codemirror\survey_report.md`
- `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_codemirror\handoff.md`
