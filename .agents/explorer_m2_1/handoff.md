# Handoff Report — Milestone 2 Explorer 1: CodeMirror 6 Engine & Extensions Architecture

**Agent**: Explorer 1 (Milestone 2)  
**Task**: Implementation blueprint for `app/components/code-workspace/CodeEditor.tsx`  
**Date**: 2026-08-30  
**Handoff Type**: Hard (Task complete)

---

## 1. Observation

1. **Package Inventory (`package.json`)**:
   CodeMirror 6 packages are verified installed in `package.json`:
   - `@codemirror/state`: `^6.7.1` (lines 32)
   - `@codemirror/view`: `^6.43.9` (lines 34)
   - `@codemirror/commands`: `^6.11.0` (lines 17)
   - `@codemirror/search`: `^6.7.1` (lines 31)
   - `@codemirror/language`: `^6.12.4` (lines 28)
   - `@codemirror/autocomplete`: `^6.20.3` (lines 16)
   - `@codemirror/lint`: `^6.9.7` (lines 30)
   - `@lezer/highlight`: `^1.2.3` (lines 37)
   - Language packages: `@codemirror/lang-javascript`, `@codemirror/lang-php`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json`, `@codemirror/lang-python`, `@codemirror/lang-go`, `@codemirror/lang-sql`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `@codemirror/legacy-modes`.

2. **Existing Type Definitions (`app/components/code-workspace/types.ts:219-227`)**:
   ```typescript
   export interface CodeEditorProps {
     content: string;
     language: string;
     readOnly?: boolean;
     onChange?: (newContent: string) => void;
     onSave?: () => void;
     onCursorChange?: (line: number, col: number) => void;
     className?: string;
   }
   ```

3. **Survey Report & Master Architecture**:
   - `ORIGINAL_REQUEST.md`: R2 mandates CodeMirror 6 with multi-language syntax highlighting, line numbers, active line indicators, code folding, top search bar (Ctrl+F / Ctrl+H), dark theme matching NEXORA Cloud obsidian design, and viewer read-only protection.
   - `PROJECT.md`: Specifies `CodeEditor.tsx`, `editor-theme.ts`, `language-loader.ts` under `app/components/code-workspace/`.

4. **Framework Environment**:
   Next.js 16 / Vinext / React 19.2.8 with React Server Components (RSC) architecture.

---

## 2. Logic Chain

1. **Client Boundary & Lifecycle**:
   - CodeMirror 6 touches `document`, `window`, and DOM mutation observers.
   - Therefore, `CodeEditor.tsx` must begin with `"use client";`.
   - `EditorView` must be created within `useEffect` on client DOM mount and destroyed on unmount (`view.destroy()`) to prevent memory leaks and handle React 19 StrictMode double-mounting gracefully.

2. **Dynamic Reconfiguration vs Editor Re-creation**:
   - Recreating `new EditorView(...)` when switching open tabs or language types causes visible UI flicker, clears undo/redo history, drops focus, and resets scroll positions.
   - Using CodeMirror `Compartment` allows zero-overhead reconfiguration of `languageCompartment`, `readOnlyCompartment`, `themeCompartment`, and `lineWrappingCompartment` via `view.dispatch({ effects: compartment.reconfigure(...) })`.

3. **Feedback Loop & Cursor Stability**:
   - When a user types, `EditorView.updateListener` fires `onChange(newDoc)`.
   - React updates state and passes `content={newDoc}` back to `CodeEditor`.
   - Without an update guard, a doc-sync `useEffect` would attempt to dispatch a change transaction, resetting cursor position or causing infinite loops.
   - Implementing `isInternalUpdateRef.current = true` during `update.docChanged` and clearing it during prop sync ensures seamless typing without feedback cycles.

4. **Keyboard Shortcuts & Stale Closures**:
   - Custom `Mod-s` shortcut must intercept Ctrl+S / Cmd+S before browser save dialogs trigger.
   - Using `Prec.highest` ensures priority over default browser and editor shortcuts.
   - Binding to `latestCallbacksRef.current` guarantees that `onSave()` and `readOnly` always reflect the latest React render without re-instantiating keymap extensions.

5. **Telemetry & Ergonomics**:
   - `onCursorChange` computes 1-indexed line and column numbers using `view.state.doc.lineAt(selection.main.head)` whenever `update.selectionSet` or `update.docChanged` triggers.
   - `onScrollChange` listens to `view.scrollDOM` to support tab scroll preservation.

---

## 3. Caveats

- **CSS Height Requirement**: The outer container wrapping `CodeEditor` must have a defined height (e.g., `h-full` or explicit pixel/flex height); otherwise, CodeMirror's virtual scroller will expand to fit full document length rather than scrolling within a fixed viewport.
- **Legacy StreamLanguage Performance**: Legacy modes (`shell`, `dockerfile`, `nginx`) use StreamLanguage tokenization rather than full Lezer AST parsers. While lightweight and efficient, they do not support AST-based code folding. AST languages (JS, TS, PHP, Python, HTML, CSS, JSON, Go, SQL, Markdown, YAML) support full structural code folding.
- No caveats regarding architectural soundness or specification completeness.

---

## 4. Conclusion

The blueprint in `plan.md` provides a complete, production-ready specification for `app/components/code-workspace/CodeEditor.tsx` conforming to all Milestone 2 requirements:
- React 19 / Vinext `"use client"` lifecycle with clean DOM cleanup (`view.destroy()`).
- 4 CodeMirror Compartments (`language`, `readOnly`, `theme`, `lineWrapping`).
- 18+ extensions stack covering gutters, folding, bracket matching, autocomplete, search engine, and standard/custom keymaps.
- High-priority `Mod-s` save interceptor and real-time cursor/doc event dispatchers.
- Complete drop-in code ready for implementers.

---

## 5. Verification Method

1. **Inspect Blueprint Artifact**:
   Read `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m2_1\plan.md` to review the architectural breakdown, component interface, and complete code listing.

2. **Verify Code Implementation**:
   Once implemented in Milestone 2:
   ```bash
   npm run build
   ```
   Ensures zero TypeScript compiler errors and correct RSC client-component bundling.

3. **Verify Interactive Behavior**:
   - Mount `<CodeEditor content="..." language="php" />` in browser.
   - Test typing, undo/redo (Ctrl+Z / Ctrl+Y), code folding chevrons, Ctrl+F search bar, and Ctrl+S save event.
   - Toggle `readOnly={true}` and verify typing is blocked and Ctrl+S is suppressed.
   - Change `language="json"` and verify syntax highlighting switches instantly without DOM flicker.
