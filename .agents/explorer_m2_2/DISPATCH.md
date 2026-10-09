## 2026-08-29T22:10:55Z
You are Explorer 2 for Milestone 2 (NEXORA Theme & 11+ Language Highlighting Suite).

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Master Project Architecture: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md
- CodeMirror Survey: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_codemirror\survey_report.md

YOUR MISSION:
Produce the detailed implementation blueprint for:
1. `app/components/code-workspace/editor-theme.ts`:
   - Custom `EditorView.theme(...)` matching NEXORA Obsidian dark theme:
     - Editor background: `#090a0f`, active line: `#131622`, selection: `rgba(255, 16, 24, 0.25)`, matching bracket: `#23283b` with crimson outline `#ff1018`.
     - Gutters background: `#090a0f`, line numbers color: `#475569`, active line number: `#ff1018`, fold marker: `#64748b`.
     - Search panel styling: dark obsidian container, dark inputs `#131622`, accent buttons, match highlights `#fbbf24`.
     - Cursor color: `#ff1018` with smooth blinking.
   - `syntaxHighlighting(HighlightStyle.define([...]))` with `@lezer/highlight` tags:
     - Keywords: `#f43f5e`, Functions: `#38bdf8`, Strings: `#34d399`, Numbers/Booleans: `#fbbf24`, Types/Classes: `#818cf8`, Comments: `#64748b` (italic), Variables/Properties: `#edf1f5`, Operators: `#38bdf8`.
2. `app/components/code-workspace/language-loader.ts`:
   - Language resolver function `getLanguageExtension(languageOrPath: string): Extension`:
     - PHP (`@codemirror/lang-php`)
     - JavaScript (`@codemirror/lang-javascript({ jsx: true })`)
     - TypeScript (`@codemirror/lang-javascript({ jsx: true, typescript: true })`)
     - HTML (`@codemirror/lang-html`)
     - CSS (`@codemirror/lang-css`)
     - JSON (`@codemirror/lang-json`)
     - Python (`@codemirror/lang-python`)
     - Go (`@codemirror/lang-go` or legacy Go mode)
     - SQL (`@codemirror/lang-sql`)
     - Markdown (`@codemirror/lang-markdown`)
     - YAML (`@codemirror/lang-yaml`)
     - Shell, Dockerfile, Nginx (`@codemirror/legacy-modes` with `StreamLanguage.define(...)`)
     - Default plain text fallback.

OUTPUT REQUIREMENTS:
- Working directory: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_2\`
- Maintain `progress.md` with liveness updates.
- Write implementation plan to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_2\plan.md`
- Write handoff report to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_2\handoff.md`
- Send a message when finished.
