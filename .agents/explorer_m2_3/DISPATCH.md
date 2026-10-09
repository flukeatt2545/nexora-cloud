## 2026-08-29T22:10:55Z
You are Explorer 3 for Milestone 2 (Mobile, Touch & Search Ergonomics).

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Master Project Architecture: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md
- UI Survey Report: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_ui\survey_report.md

YOUR MISSION:
Produce the detailed ergonomics and mobile blueprint for Milestone 2:
1. Touch & Mobile responsiveness:
   - Line wrapping extension `EditorView.lineWrapping` configuration.
   - Touch scrolling within `.cm-scroller` without horizontal overflow on mobile viewports.
   - Touch-safe gutter hit targets (fold chevrons and line numbers) preventing inadvertent zoom or mis-clicks.
   - Virtual keyboard adaptation (viewport height recalculation on mobile keyboards).
2. Search & Replace panel customization:
   - Floating / docked search & replace bar with NEXORA dark theme.
   - Quick action shortcuts (Ctrl+F open search, Ctrl+H open replace, Esc close search panel).
   - Match count indicator and regex/case-sensitive toggles.
3. Read-only viewer enforcement in CodeMirror:
   - `EditorState.readOnly.of(true)`
   - `EditorView.editable.of(false)`
   - Visual watermark or status bar tag indicating "VIEWER — READ ONLY".

OUTPUT REQUIREMENTS:
- Working directory: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_3\`
- Maintain `progress.md` with liveness updates.
- Write implementation plan to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_3\plan.md`
- Write handoff report to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_3\handoff.md`
- Send a message when finished.
