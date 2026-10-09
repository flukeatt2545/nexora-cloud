# BRIEFING — 2026-08-30T05:12:30+07:00

## Mission
Produce the detailed implementation blueprint for `app/components/code-workspace/CodeEditor.tsx` covering React 19/Vinext lifecycle, CodeMirror 6 Compartments, extension stack, and event dispatching/callbacks.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis, architecture design
- Working directory: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1
- Original parent: 7b7890fa-6ed2-40af-abd5-bbae95a5cb2c
- Milestone: Milestone 2 (CodeMirror 6 Engine & Extensions Architecture)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement directly in app source code.
- Provide comprehensive, drop-in ready blueprint with full type definitions, compartment setup, event listeners, and lifecycle hooks.
- Follow Vinext / React 19 rules ("use client", clean unmount, ref stability).

## Current Parent
- Conversation ID: 7b7890fa-6ed2-40af-abd5-bbae95a5cb2c
- Updated: 2026-08-30T05:12:30+07:00

## Investigation State
- **Explored paths**:
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_codemirror\survey_report.md`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\package.json`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\app\components\code-workspace\types.ts`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\app\components\code-workspace\WorkspaceStatusBar.tsx`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\app\theme.css`
  - `c:\Users\nkn246\Desktop\nkn-v6-new-ui\app\themeColor.ts`
- **Key findings**:
  - CodeMirror packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/autocomplete`, `@codemirror/lint`, `@lezer/highlight`, and all 11+ language packages) are already present in `package.json`.
  - `CodeEditorProps` interface is defined in `app/components/code-workspace/types.ts` with `content`, `language`, `readOnly`, `onChange`, `onSave`, `onCursorChange`, `className`.
  - React 19 StrictMode and two-way sync loop prevention require `isInternalUpdateRef` and `latestCallbacksRef`.
  - Dynamic reconfiguration via `Compartment` allows instant language switching, read-only locking, and theme reconfiguration without DOM recreation.
- **Unexplored areas**: None. Scope fully completed.

## Key Decisions Made
- Designed `CodeEditor.tsx` as a `forwardRef` exposing `CodeEditorHandle` (`focus`, `getView`, `scrollToLine`, `insertText`).
- Established `isInternalUpdateRef` pattern to prevent cursor-jumping loops during two-way React state sync.
- Configured custom `Mod-s` interceptor with `Prec.highest` to reliably capture Ctrl+S / Cmd+S and invoke `onSave()`.
- Specified dynamic compartments for `language`, `readOnly`, `theme`, and `lineWrapping`.

## Artifact Index
- `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\plan.md` — Implementation plan & blueprint for CodeEditor.tsx
- `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\handoff.md` — 5-component handoff report
- `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\progress.md` — Liveness & progress tracker
