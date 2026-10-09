## 2026-08-29T22:10:55Z
You are Explorer 1 for Milestone 2 (CodeMirror 6 Engine & Extensions Architecture).

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Master Project Architecture: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md
- CodeMirror Survey: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_codemirror\survey_report.md

YOUR MISSION:
Produce the detailed implementation blueprint for `app/components/code-workspace/CodeEditor.tsx`:
1. React 19 / Vinext lifecycle: `"use client"`, DOM ref, `useEffect` initialization, `viewRef.current.destroy()` on unmount.
2. CodeMirror Compartments for dynamic updates:
   - `languageCompartment`: dynamic switching of language syntax without re-instantiating the editor.
   - `readOnlyCompartment`: dynamic switching between editable and read-only mode (`EditorState.readOnly.of(readOnly)`, `EditorView.editable.of(!readOnly)`).
   - `themeCompartment`: dynamic theme configuration.
3. Extension stack:
   - `lineNumbers()`, `highlightActiveLineGutter()`, `highlightSpecialChars()`, `history()`
   - `foldGutter()`, `drawSelection()`, `dropCursor()`, `EditorState.allowMultipleSelections.of(true)`
   - `indentOnInput()`, `syntaxHighlighting(...)`, `bracketMatching()`, `closeBrackets()`
   - `autocompletion()`, `rectangularSelection()`, `crosshairCursor()`, `highlightActiveLine()`
   - `highlightSelectionMatches()`, `search({ top: true })`
   - Keymap bindings: `defaultKeymap`, `searchKeymap`, `historyKeymap`, `foldKeymap`, `completionKeymap`, `lintKeymap`, plus custom `Mod-s` (Ctrl+S / Cmd+S) interceptor calling `onSave`.
4. Event dispatching & callbacks:
   - `EditorView.updateListener.of(...)` detecting `update.docChanged` -> calling `onChange(update.state.doc.toString())`.
   - Cursor position listener -> calling `onCursorChange(line, col)`.
   - Scroll position tracking.

OUTPUT REQUIREMENTS:
- Working directory: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\`
- Maintain `progress.md` with liveness updates.
- Write implementation plan to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\plan.md`
- Write handoff report to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\handoff.md`
- Send a message when finished.
