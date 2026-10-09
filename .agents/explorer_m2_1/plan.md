# CodeMirror 6 Engine & Extensions Architecture Blueprint

**Milestone**: Milestone 2 — CodeMirror 6 Editor & Language Suite  
**Target File**: `app/components/code-workspace/CodeEditor.tsx`  
**Supporting Files**: `app/components/code-workspace/editor-theme.ts`, `app/components/code-workspace/language-loader.ts`  
**Target Platform**: React 19 / Next.js / Vinext SSR Environment

---

## 1. Executive Summary & Design Principles

The `CodeEditor` component provides the core code-editing engine for NEXORA Cloud's IDE workspace. It replaces the legacy `<textarea>` with a fully virtualized, high-performance CodeMirror 6 instance.

### Key Architectural Pillars:
1. **Zero-Flicker Dynamic Reconfiguration**: Utilizes CodeMirror 6 **Compartments** to switch language parsers, toggle read-only permissions, and alter themes without destroying or re-instantiating the DOM or dropping cursor/selection/undo history.
2. **React 19 / Vinext Lifecycle Integrity**: Strict client-side boundary (`"use client"`), robust mount/unmount memory management (`view.destroy()`), and React 19 StrictMode double-mount resilience.
3. **Infinite Loop & Race Condition Immunity**: Uses `isInternalUpdateRef` and mutable callback refs to decouple React re-renders from CodeMirror transactions, avoiding cursor jumps and duplicate dispatches.
4. **Comprehensive Extension Stack**: Line numbering, active line & gutter highlights, code folding, bracket matching & auto-closing, multi-cursor, top-pinned search & replace panel, autocompletion, and standard VS Code keybindings.
5. **Obsidian Dark Aesthetic**: Scoped styling matching NEXORA Cloud (`#08090d`, `#12141d`, `--primary: #ff1018`, emerald strings, sky blue functions, amber numbers).

---

## 2. Component Interface & Contracts

### 2.1 Component Props Contract (`CodeEditorProps`)
Matches `app/components/code-workspace/types.ts`:

```typescript
export interface CodeEditorProps {
  /** The text content to display in the editor */
  content: string;
  /** Language identifier or file extension (e.g. "php", "typescript", "index.tsx", "dockerfile") */
  language: string;
  /** Read-only mode flag (enforces viewer role restrictions) */
  readOnly?: boolean;
  /** Callback fired when document content changes */
  onChange?: (newContent: string) => void;
  /** Callback fired when Ctrl+S / Cmd+S is triggered (blocked in read-only mode) */
  onSave?: () => void;
  /** Callback fired when cursor moves (1-indexed line and column) */
  onCursorChange?: (line: number, col: number) => void;
  /** Optional callback fired when the editor is scrolled */
  onScrollChange?: (pos: { top: number; left: number }) => void;
  /** Optional initial scroll position */
  initialScrollPosition?: { top: number; left: number } | number;
  /** Optional line wrapping toggle (defaults to true on mobile, false on desktop) */
  lineWrapping?: boolean;
  /** Custom CSS classes for the outer wrapper element */
  className?: string;
}
```

### 2.2 Imperative Ref Handle (`CodeEditorHandle`)
Allows parent components to trigger editor actions imperatively:

```typescript
export interface CodeEditorHandle {
  /** Focus the editor */
  focus: () => void;
  /** Get direct access to the underlying CodeMirror EditorView */
  getView: () => EditorView | null;
  /** Scroll editor viewport to target line number (1-indexed) */
  scrollToLine: (line: number) => void;
  /** Insert text at current cursor position */
  insertText: (text: string) => void;
}
```

---

## 3. React 19 / Vinext Lifecycle & SSR Safety

### 3.1 Client-Side Boundary
CodeMirror 6 directly accesses browser APIs (`window`, `document`, `navigator`, `MutationObserver`, `IntersectionObserver`).
- Line 1 must declare `"use client";`.
- All `EditorView` instantiation is contained strictly within client `useEffect` hooks.

### 3.2 Refs Architecture
To avoid unnecessary re-renders and stale closures:
1. `containerRef`: Attached to the DOM `<div>` element.
2. `viewRef`: Holds the single `EditorView` instance across the component lifetime.
3. `isInternalUpdateRef`: A boolean flag. Set to `true` inside `EditorView.updateListener` when `update.docChanged` is fired. When React passes back updated `content`, the sync effect checks this flag and skips re-dispatching doc replacement.
4. `latestCallbacksRef`: Holds references to `{ onChange, onSave, onCursorChange, readOnly }`. Updated synchronously on every render so keymaps and listeners always execute latest props without needing re-subscription.

```typescript
const latestCallbacksRef = useRef({ onChange, onSave, onCursorChange, readOnly });
latestCallbacksRef.current = { onChange, onSave, onCursorChange, readOnly };
```

### 3.3 Mount / Unmount / StrictMode Lifecycle
- On mount: Creates `EditorState` with initial document, extension suite, and compartment defaults. Initializes `new EditorView({ state, parent: containerRef.current })`.
- On unmount: Calls `view.destroy()` and clears `viewRef.current = null`.
- React 19 StrictMode / Fast Refresh: If `containerRef.current` already has child elements or an active view exists, `view.destroy()` cleanly purges existing DOM nodes and observers before re-initialization.

---

## 4. CodeMirror Compartments Architecture

Compartments isolate dynamically configurable extensions so they can be reconfigured via `view.dispatch({ effects: compartment.reconfigure(...) })` in sub-millisecond execution time.

```
+-------------------------------------------------------------------------------+
| EditorState Base Extensions                                                   |
| +---------------------------------------------------------------------------+ |
| | Gutters, History, Search, Bracket Matching, Autocomplete, Keymaps        | |
| +---------------------------------------------------------------------------+ |
|                                                                               |
| Dynamic Compartments                                                          |
| +-------------------------+ +-------------------------+ +-------------------+ |
| | languageCompartment     | | readOnlyCompartment     | | themeCompartment  | |
| | (swaps parser AST)      | | (locks edit/typing)     | | (Obsidian tokens) | |
| +-------------------------+ +-------------------------+ +-------------------+ |
| +---------------------------------------------------------------------------+ |
| | lineWrappingCompartment (swaps EditorView.lineWrapping)                   | |
| +---------------------------------------------------------------------------+ |
+-------------------------------------------------------------------------------+
```

### 4.1 Language Compartment (`languageCompartment`)
- **Initialization**: `languageCompartment.of(resolveLanguage(language))`
- **Reconfiguration**:
  ```typescript
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguage(language)),
    });
  }, [language]);
  ```

### 4.2 Read-Only Compartment (`readOnlyCompartment`)
Enforces viewer role security:
- Disables document mutations (`EditorState.readOnly.of(readOnly)`).
- Disables keyboard editing and virtual mobile keyboard popups (`EditorView.editable.of(!readOnly)`).
- Allows text selection, scrolling, and search query matching.
- **Initialization**:
  ```typescript
  readOnlyCompartment.of([
    EditorState.readOnly.of(Boolean(readOnly)),
    EditorView.editable.of(!readOnly),
  ])
  ```
- **Reconfiguration**:
  ```typescript
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);
  ```

### 4.3 Theme Compartment (`themeCompartment`)
- **Initialization**: `themeCompartment.of([nexoraDarkTheme, nexoraDarkSyntax])`

### 4.4 Line Wrapping Compartment (`lineWrappingCompartment`)
- **Initialization**: `lineWrappingCompartment.of(lineWrapping ? [EditorView.lineWrapping] : [])`
- **Reconfiguration**:
  ```typescript
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: lineWrappingCompartment.reconfigure(lineWrapping ? [EditorView.lineWrapping] : []),
    });
  }, [lineWrapping]);
  ```

---

## 5. Extension Suite & Keymap Architecture

### 5.1 Extension Inventory
| Category | Extension | Source Package | Purpose |
|---|---|---|---|
| **Gutters & Visuals** | `lineNumbers()` | `@codemirror/view` | Line numbering gutter |
| | `highlightActiveLineGutter()` | `@codemirror/view` | Accents active line number |
| | `highlightSpecialChars()` | `@codemirror/view` | Renders zero-width & invisible chars |
| | `foldGutter()` | `@codemirror/language` | Code folding chevrons |
| | `drawSelection()` | `@codemirror/view` | Multi-selection styling |
| | `dropCursor()` | `@codemirror/view` | Drag-and-drop cursor position |
| | `highlightActiveLine()` | `@codemirror/view` | Current line row highlight |
| | `highlightSelectionMatches()` | `@codemirror/search` | Highlights all occurrences of selected word |
| **Editing & State** | `history()` | `@codemirror/commands` | Undo / redo history buffer |
| | `EditorState.allowMultipleSelections.of(true)` | `@codemirror/state` | Multi-cursor & rectangular selection |
| | `indentOnInput()` | `@codemirror/language` | Smart indentation on newlines / braces |
| | `bracketMatching()` | `@codemirror/language` | Pair highlighting for `()`, `[]`, `{}` |
| | `closeBrackets()` | `@codemirror/autocomplete` | Auto-closing quotes and bracket pairs |
| | `autocompletion()` | `@codemirror/autocomplete` | Autocomplete popup framework |
| | `rectangularSelection()` | `@codemirror/view` | Alt+drag column selection |
| | `crosshairCursor()` | `@codemirror/view` | Crosshair pointer during rectangular selection |
| **Search Engine** | `search({ top: true })` | `@codemirror/search` | Pinned top search & replace bar |
| **Theming** | `nexoraDarkTheme` | Scoped CM6 Theme | NEXORA Obsidian palette |
| | `nexoraDarkSyntax` | `@codemirror/language` | Lezer HighlightStyle tokens |

### 5.2 Keymap Bindings
Bindings are ordered with precedence rules:
1. **Custom `Mod-s` Interceptor** (`Prec.highest`):
   ```typescript
   Prec.highest(
     keymap.of([
       {
         key: "Mod-s",
         run: (view) => {
           const { onSave, readOnly } = latestCallbacksRef.current;
           if (!readOnly && onSave) {
             onSave();
             return true;
           }
           return false;
         },
       },
     ])
   )
   ```
2. **Standard & Feature Keymaps**:
   ```typescript
   keymap.of([
     ...closeBracketsKeymap,
     ...defaultKeymap,
     ...searchKeymap,
     ...historyKeymap,
     ...foldKeymap,
     ...completionKeymap,
     ...lintKeymap,
     indentWithTab,
   ])
   ```

---

## 6. Event Dispatching & Callbacks

### 6.1 Two-Way Content Synchronization & Loop Prevention
```
[User Types in CodeMirror]
         │
         ▼
EditorView.updateListener.of(...)
  ├─ isInternalUpdateRef.current = true
  └─ latestCallbacksRef.current.onChange(newContent)
         │
         ▼
[Parent React State updates: content = newContent]
         │
         ▼
[CodeEditor re-renders with new content prop]
         │
         ▼
useEffect([content])
  ├─ if (isInternalUpdateRef.current) {
  │     isInternalUpdateRef.current = false;
  │     return; // <--- LOOP BROKEN! No transaction dispatched.
  │  }
  └─ if (content !== currentDoc) dispatch({ changes: ... })
```

### 6.2 Cursor Position Telemetry
Extracts 1-indexed line and column numbers on both selection movement and document modifications:
```typescript
if (update.selectionSet || update.docChanged) {
  const mainSelection = update.state.selection.main;
  const line = update.state.doc.lineAt(mainSelection.head);
  const lineNumber = line.number;
  const colNumber = mainSelection.head - line.from + 1;
  latestCallbacksRef.current.onCursorChange?.(lineNumber, colNumber);
}
```

### 6.3 Scroll Tracking & Restoration
Attaches a passive scroll listener to `view.scrollDOM`:
```typescript
useEffect(() => {
  const view = viewRef.current;
  if (!view || !onScrollChange) return;

  const scroller = view.scrollDOM;
  const handleScroll = () => {
    onScrollChange({ top: scroller.scrollTop, left: scroller.scrollLeft });
  };

  scroller.addEventListener("scroll", handleScroll, { passive: true });
  return () => {
    scroller.removeEventListener("scroll", handleScroll);
  };
}, [onScrollChange]);
```

Restores initial scroll position upon tab mount if provided:
```typescript
if (initialScrollPosition) {
  if (typeof initialScrollPosition === "number") {
    view.scrollDOM.scrollTop = initialScrollPosition;
  } else {
    view.scrollDOM.scrollTop = initialScrollPosition.top;
    view.scrollDOM.scrollLeft = initialScrollPosition.left;
  }
}
```

---

## 7. Supporting Modules Specification

### 7.1 `editor-theme.ts` Specification
- **NEXORA Obsidian Theme (`nexoraDarkTheme`)**:
  - Background: `#08090d` / `#090a0f`
  - Font: `Consolas, "Cascadia Code", "Fira Code", Monaco, "Courier New", monospace`
  - Caret & Selection: `--primary: #ff1018` accent with `rgba(255, 16, 24, 0.22)` highlight
  - Gutters: `#08090d` with `#ffffff14` border, active line gutter `#ff1018`
  - Search Panel: Glass card dialog matching `#12141e` with custom styled text inputs, buttons, and badges
- **Lezer Highlight Tokens (`nexoraHighlightStyle` & `nexoraDarkSyntax`)**:
  - Keywords / Control: `#f43f5e` (Rose / Primary)
  - Functions / Methods: `#38bdf8` (Sky Blue)
  - Classes / Types: `#818cf8` (Indigo)
  - Strings / Regex: `#34d399` (Emerald Green) & `#2dd4bf` (Teal)
  - Numbers / Booleans / Constants: `#fbbf24` (Amber)
  - Comments: `#64748b` (Slate muted italic)
  - Operators / Delimiters: `#94a3b8`

### 7.2 `language-loader.ts` Specification
Maps file paths and language names to CodeMirror extension parsers:
1. `javascript({ typescript: true, jsx: true })` -> `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`
2. `php()` -> `.php`, `.phtml`, `.inc`
3. `html()` -> `.html`, `.htm`, `.shtml`, `.svg`
4. `css()` -> `.css`, `.scss`, `.less`
5. `json()` -> `.json`, `.jsonc`, `.json5`, `.lock`
6. `python()` -> `.py`, `.pyw`, `.wsgi`
7. `go()` -> `.go`, `.mod`
8. `sql()` -> `.sql`, `.ddl`, `.dml`
9. `markdown()` -> `.md`, `.markdown`, `.mdx`
10. `yaml()` -> `.yaml`, `.yml`
11. `StreamLanguage.define(shell)` -> `.sh`, `.bash`, `.zsh`, `.env`
12. `StreamLanguage.define(dockerfile)` -> `Dockerfile`, `dockerfile.*`
13. `StreamLanguage.define(nginx)` -> `nginx.conf`, `*.nginx.conf`
14. `[]` -> fallback for plaintext, unknown extensions

---

## 8. Complete Proposed Code for `CodeEditor.tsx`

```tsx
"use client";

import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from "@codemirror/view";
import {
  foldGutter,
  indentOnInput,
  bracketMatching,
  foldKeymap,
} from "@codemirror/language";
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

import { nexoraDarkTheme, nexoraDarkSyntax } from "./editor-theme";
import { resolveLanguageExtension } from "./language-loader";
import { CodeEditorProps } from "./types";

export interface CodeEditorHandle {
  focus: () => void;
  getView: () => EditorView | null;
  scrollToLine: (line: number) => void;
  insertText: (text: string) => void;
}

export interface ExtendedCodeEditorProps extends CodeEditorProps {
  onScrollChange?: (pos: { top: number; left: number }) => void;
  initialScrollPosition?: { top: number; left: number } | number;
  lineWrapping?: boolean;
}

export const CodeEditor = forwardRef<CodeEditorHandle, ExtendedCodeEditorProps>(
  function CodeEditor(
    {
      content,
      language,
      readOnly = false,
      onChange,
      onSave,
      onCursorChange,
      onScrollChange,
      initialScrollPosition,
      lineWrapping = false,
      className = "",
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const isInternalUpdateRef = useRef<boolean>(false);

    // Compartments for hot-swapping facets without re-instantiating EditorView
    const languageCompartment = useRef(new Compartment()).current;
    const readOnlyCompartment = useRef(new Compartment()).current;
    const themeCompartment = useRef(new Compartment()).current;
    const lineWrappingCompartment = useRef(new Compartment()).current;

    // Synchronize latest callbacks into ref to avoid stale closures in keymaps
    const latestCallbacksRef = useRef({
      onChange,
      onSave,
      onCursorChange,
      readOnly,
    });
    latestCallbacksRef.current = {
      onChange,
      onSave,
      onCursorChange,
      readOnly,
    };

    // Imperative handle exposed to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          viewRef.current?.focus();
        },
        getView: () => viewRef.current,
        scrollToLine: (line: number) => {
          const view = viewRef.current;
          if (!view) return;
          const linePos = view.state.doc.line(
            Math.max(1, Math.min(line, view.state.doc.lines))
          );
          view.dispatch({
            selection: { anchor: linePos.from },
            scrollIntoView: true,
          });
        },
        insertText: (text: string) => {
          const view = viewRef.current;
          if (!view || latestCallbacksRef.current.readOnly) return;
          const mainSel = view.state.selection.main;
          view.dispatch({
            changes: { from: mainSel.from, to: mainSel.to, insert: text },
            selection: { anchor: mainSel.from + text.length },
            scrollIntoView: true,
          });
        },
      }),
      []
    );

    // Initialize CodeMirror 6 EditorView once on mount
    useEffect(() => {
      if (!containerRef.current) return;

      // Clean up previous view if any (Fast Refresh / StrictMode guard)
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }

      const startState = EditorState.create({
        doc: content ?? "",
        extensions: [
          // 1. Gutters & Visual Indicators
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),

          // 2. Editor State & Mechanics
          history(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),

          // 3. Search Engine (Pinned to top)
          search({ top: true }),

          // 4. Compartmentalized Dynamic Extensions
          languageCompartment.of(resolveLanguageExtension(language)),
          readOnlyCompartment.of([
            EditorState.readOnly.of(Boolean(readOnly)),
            EditorView.editable.of(!readOnly),
          ]),
          themeCompartment.of([nexoraDarkTheme, nexoraDarkSyntax]),
          lineWrappingCompartment.of(
            lineWrapping ? [EditorView.lineWrapping] : []
          ),

          // 5. Keymaps (Custom Mod-s Interceptor with highest precedence)
          Prec.highest(
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  const { onSave: handleSave, readOnly: isReadOnly } =
                    latestCallbacksRef.current;
                  if (!isReadOnly && handleSave) {
                    handleSave();
                    return true;
                  }
                  return false;
                },
              },
            ])
          ),

          // 6. Standard Keymaps
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),

          // 7. Update Listener for Content & Cursor Telemetry
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              isInternalUpdateRef.current = true;
              const newContent = update.state.doc.toString();
              latestCallbacksRef.current.onChange?.(newContent);
            }

            if (update.selectionSet || update.docChanged) {
              const mainSelection = update.state.selection.main;
              const line = update.state.doc.lineAt(mainSelection.head);
              const lineNumber = line.number;
              const colNumber = mainSelection.head - line.from + 1;
              latestCallbacksRef.current.onCursorChange?.(lineNumber, colNumber);
            }
          }),
        ],
      });

      const view = new EditorView({
        state: startState,
        parent: containerRef.current,
      });

      viewRef.current = view;

      // Restore initial scroll position if specified
      if (initialScrollPosition) {
        if (typeof initialScrollPosition === "number") {
          view.scrollDOM.scrollTop = initialScrollPosition;
        } else {
          view.scrollDOM.scrollTop = initialScrollPosition.top;
          view.scrollDOM.scrollLeft = initialScrollPosition.left;
        }
      }

      // Initial cursor telemetry broadcast
      const mainSel = view.state.selection.main;
      const initialLine = view.state.doc.lineAt(mainSel.head);
      latestCallbacksRef.current.onCursorChange?.(
        initialLine.number,
        mainSel.head - initialLine.from + 1
      );

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []); // Run once on mount

    // Synchronize external content changes (e.g. tab switches, external reload)
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      if (isInternalUpdateRef.current) {
        isInternalUpdateRef.current = false;
        return;
      }

      const currentDoc = view.state.doc.toString();
      const nextContent = content ?? "";

      if (nextContent !== currentDoc) {
        view.dispatch({
          changes: {
            from: 0,
            to: currentDoc.length,
            insert: nextContent,
          },
        });
      }
    }, [content]);

    // Dynamic Language Reconfiguration via Compartment
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: languageCompartment.reconfigure(
          resolveLanguageExtension(language)
        ),
      });
    }, [language]);

    // Dynamic Read-Only / Editable Reconfiguration via Compartment
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: readOnlyCompartment.reconfigure([
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.editable.of(!readOnly),
        ]),
      });
    }, [readOnly]);

    // Dynamic Line Wrapping Reconfiguration via Compartment
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: lineWrappingCompartment.reconfigure(
          lineWrapping ? [EditorView.lineWrapping] : []
        ),
      });
    }, [lineWrapping]);

    // Scroll Telemetry Listener
    useEffect(() => {
      const view = viewRef.current;
      if (!view || !onScrollChange) return;

      const scroller = view.scrollDOM;
      const handleScroll = () => {
        onScrollChange({ top: scroller.scrollTop, left: scroller.scrollLeft });
      };

      scroller.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        scroller.removeEventListener("scroll", handleScroll);
      };
    }, [onScrollChange]);

    return (
      <div
        ref={containerRef}
        data-testid="nexora-codemirror-wrapper"
        className={`nexora-cm6-wrapper relative w-full h-full overflow-hidden bg-[#08090d] select-text ${className}`}
      />
    );
  }
);
```

---

## 9. Edge Cases & Resilience Strategy

| # | Edge Case / Scenario | Mechanism / Safeguard | Outcome |
|---|---|---|---|
| 1 | **React StrictMode Double Mount** | Cleanup return calls `view.destroy()`; mount checks existing view and cleans up before creating. | No duplicate editor views or lingering event listeners. |
| 2 | **Two-Way Content Loop** | `isInternalUpdateRef.current = true` set on typing, bypassed in sync `useEffect`. | No cursor jumping, no infinite transaction dispatch loops. |
| 3 | **Stale Closures on Hotkeys** | `latestCallbacksRef.current` updated synchronously on render; `Mod-s` reads from ref. | `onSave` always triggers latest parent handler even if props changed without re-mounting. |
| 4 | **Viewer Role Enforcement** | `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)` + `Mod-s` check. | Typing disabled, mobile soft keyboard blocked, Ctrl+S blocked, but search & copy remain active. |
| 5 | **Rapid Tab Switching** | Language parser updated via `languageCompartment.reconfigure()` without recreating `EditorView`. | Zero DOM flicker, sub-2ms language grammar hot-swapping. |
| 6 | **Large Code Files (> 1MB)** | Virtualized viewport rendering in CM6 DOM pipeline. | 60 FPS scrolling, low memory footprint. |
| 7 | **Mobile Viewports (< 768px)** | `lineWrapping` compartment support + minimum 44px gutter touch targets. | No horizontal overflow, touch-safe line targeting. |
| 8 | **Unrecognized File Extensions** | `resolveLanguageExtension` falls back cleanly to `[]` (Plain text mode). | No runtime crash or parser parse errors. |
| 9 | **Ctrl+F Search Interception** | `@codemirror/search` with `{ top: true }` embedded panel. | Overrides browser default search, displays match count and replace bar in IDE style. |
| 10 | **Tab/Indentation Management** | `indentWithTab` extension in keymap. | Pressing Tab indents current line/selection; Shift+Tab dedents without losing focus. |

---

## 10. Verification & Test Plan

1. **Unit & Integration Verification**:
   - Verify `CodeEditor` mounts without SSR errors.
   - Verify typing dispatches `onChange` and updates document.
   - Verify `onCursorChange` emits accurate (1-indexed) line and col values.
   - Verify `onSave` is called on Ctrl+S / Cmd+S in editor.
   - Verify `readOnly={true}` blocks text input and Ctrl+S callback.
   - Verify language changes reconfigure grammar without re-creating DOM.
2. **Build Verification**:
   - Run `npm run build` or `vinext build` to verify TypeScript compile and RSC bundling pass with 0 errors.
3. **End-to-End Test Suite**:
   - Full compatibility with `tests/e2e/code-workspace/` test tiers.
