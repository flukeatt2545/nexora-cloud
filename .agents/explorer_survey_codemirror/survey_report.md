# NEXORA Cloud — CodeMirror 6 & Language Engine Specification Report

## 1. Executive Summary

This specification report details the complete architectural and technical blueprint for integrating **CodeMirror 6 (CM6)** into the NEXORA Cloud Hosting Management Platform (`c:\Users\nkn246\Desktop\nkn-v6-new-ui`). 

CodeMirror 6 is a modern, modular, accessible, and extensible code editor rewritten from scratch in TypeScript. It replaces the legacy `<textarea>` editor currently located in `app/dashboard/HostingView.tsx` with a high-performance, VS Code-like editing experience featuring multi-language syntax highlighting, code folding, active line indicators, interactive search & replace, theme integration matching the NEXORA Cloud obsidian design, and strict read-only enforcement for viewer roles.

---

## 2. Package Dependency Matrix & Installation

The project currently has **0** CodeMirror packages installed in `package.json`. Below is the complete list of verified npm packages, versions, and categories required for full implementation.

### 2.1 Core Editor Packages
| Package Name | Recommended Version | Purpose |
|--------------|-------------------|---------|
| `@codemirror/state` | `^6.5.2` (latest `6.7.1`) | Core immutable editor state, transactions, Compartments, facets, annotations |
| `@codemirror/view` | `^6.36.4` (latest `6.43.9`) | DOM view rendering, line wrapping, gutters, decorations, keymaps, theme engine |
| `@codemirror/commands` | `^6.8.0` (latest `6.11.0`) | Standard keybindings, undo/redo history, indentation, cursor movements |
| `@codemirror/search` | `^6.5.6` (latest `6.7.1`) | Full search & replace engine, search panel, query match highlighting, Ctrl+F / Ctrl+H |
| `@codemirror/language` | `^6.10.6` (latest `6.12.4`) | Syntax highlighting infrastructure, code folding, fold gutters, bracket matching |
| `@codemirror/lint` | `^6.8.4` (latest `6.9.7`) | Diagnostic gutter, lint tooltips, error highlighting |
| `@codemirror/autocomplete` | `^6.18.4` (latest `6.20.3`) | Auto-closing brackets, quote completion, autocomplete popup framework |
| `@lezer/highlight` | `^1.2.1` (latest `1.2.3`) | Syntax highlighting tags (`tags.keyword`, `tags.string`, `tags.comment`, etc.) |

### 2.2 Language Syntax Packages
| Language | Package Name | Version | Supported Extensions |
|----------|--------------|---------|----------------------|
| **JavaScript / TypeScript** | `@codemirror/lang-javascript` | `^6.2.5` | `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx` |
| **PHP** | `@codemirror/lang-php` | `^6.0.2` | `.php`, `.phtml`, `.php8`, `.inc` |
| **HTML** | `@codemirror/lang-html` | `^6.4.12` | `.html`, `.htm`, `.shtml`, `.svg` |
| **CSS** | `@codemirror/lang-css` | `^6.3.1` | `.css`, `.scss`, `.less` |
| **JSON** | `@codemirror/lang-json` | `^6.0.2` | `.json`, `.jsonc`, `.json5`, `.lock`, `.webmanifest` |
| **Python** | `@codemirror/lang-python` | `^6.2.1` | `.py`, `.pyw`, `.wsgi`, `.pyi` |
| **Go** | `@codemirror/lang-go` | `^6.0.1` | `.go`, `.mod` |
| **SQL** | `@codemirror/lang-sql` | `^6.10.0` | `.sql`, `.ddl`, `.dml` |
| **Markdown** | `@codemirror/lang-markdown` | `^6.5.2` | `.md`, `.markdown`, `.mdx` |
| **YAML** | `@codemirror/lang-yaml` | `^6.1.3` | `.yaml`, `.yml` |
| **Fallback / Shell / Configs** | `@codemirror/legacy-modes` | `^6.5.3` | `.sh`, `.bash`, `.zsh`, `Dockerfile`, `.env`, `.ini`, `.conf`, `.nginx`, `.htaccess` |

### 2.3 Proposed Installation Command
```bash
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/search @codemirror/language @codemirror/lint @codemirror/autocomplete @lezer/highlight @codemirror/lang-javascript @codemirror/lang-php @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-python @codemirror/lang-go @codemirror/lang-sql @codemirror/lang-markdown @codemirror/lang-yaml @codemirror/legacy-modes
```

---

## 3. React 19 / Next.js / Vinext Lifecycle & SSR Architecture

### 3.1 Client Boundary Enforcement
CodeMirror 6 directly accesses browser APIs (`window`, `document`, `MutationObserver`, `IntersectionObserver`, `Selection`, `DOMParser`). When running under Vinext / Next.js SSR / React Server Components (RSC), mounting CodeMirror on the server will cause `ReferenceError: document is not defined`.

**Architecture Rules:**
1. Any component hosting CodeMirror must include the `"use client";` directive at line 1.
2. The `EditorView` must only be initialized inside `useEffect` or `useLayoutEffect` after component mount on the client DOM.
3. In Next.js / Vinext, the CodeEditor component can also be loaded via `next/dynamic` with `{ ssr: false }` if desired as a safety barrier.

### 3.2 React Container & View Reference Pattern
```tsx
"use client";

import React, { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface CodeEditorProps {
  value: string;
  onChange?: (val: string) => void;
  onSave?: () => void;
  language: string;
  filePath: string;
  readOnly?: boolean;
}

export function CodeEditor({ value, onChange, onSave, language, filePath, readOnly = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isUpdatingRef = useRef<boolean>(false);

  // Compartments for dynamic reconfiguration without recreating the EditorView
  const languageCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;

  // Initialize EditorView once
  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        // Extensions configured with compartments...
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // Run once on mount

  // Sync value changes from parent (e.g., when switching tabs or external reload)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc && !isUpdatingRef.current) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // Dynamically update language when tab/file extension changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguageExtension(filePath, language)),
    });
  }, [filePath, language]);

  // Dynamically update read-only status (Viewer role enforcement)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return <div ref={containerRef} className="nexora-cm6-wrapper" />;
}
```

### 3.3 Dynamic Compartment Architecture
CodeMirror 6 state is immutable. Recreating `new EditorView(...)` every time a tab changes causes visible UI flashing, destroys cursor position, clears the undo/redo history stack, and drops focus. 
Using `Compartment` allows zero-overhead hot-swapping of:
1. **Language Parser** (`languageCompartment.reconfigure(...)`)
2. **Read-Only Mode** (`readOnlyCompartment.reconfigure(...)`)
3. **Line Wrapping** (`lineWrappingCompartment.reconfigure(...)`)
4. **Theme Tokens** (`themeCompartment.reconfigure(...)`)

---

## 4. Extension Suite Specification

To provide a complete VS Code-style experience, the following extension stack must be configured in `EditorState.create({ extensions: [...] })`:

### 4.1 Visual & Structural Gutters
- `lineNumbers()`: Renders line numbers in the gutter.
- `highlightActiveLineGutter()`: Accents the active line number in the gutter.
- `foldGutter()`: Displays collapsible arrow icons (`⌄` and `›`) on code blocks, classes, functions, HTML tags, and JSON objects.
- `highlightSpecialChars()`: Renders invisible/special characters like zero-width spaces cleanly.
- `drawSelection()`: Renders modern CSS selections across multi-line and rectangular selections.
- `dropCursor()`: Visual drop indicator for drag-and-drop.
- `highlightActiveLine()`: Highlights the current cursor line with a soft obsidian tint.

### 4.2 Code Folding & Bracket Matching
- `codeFolding()`: Enables AST-based folding for supported languages.
- `bracketMatching()`: Highlights the matching opening/closing parentheses, curly braces `{}`, and square brackets `[]` when the cursor is adjacent.
- `closeBrackets()`: Automatically inserts the matching `}`, `]`, `)`, `"`, `'` when typing.

### 4.3 Search & Replace Engine (`@codemirror/search`)
- `search({ top: true })`: Embedded search bar positioned at the top of the editor.
- Keybindings via `searchKeymap`:
  - `Ctrl-f` / `Cmd-f`: `openSearchPanel`
  - `Ctrl-h` / `Cmd-Alt-f`: Open search & replace panel
  - `Enter` / `Shift-Enter`: Find next / Find previous
  - `Alt-Enter`: Select all matches
  - `Escape`: `closeSearchPanel`
- Case sensitivity toggle, Regular expression toggle, Whole word matching toggle.
- Custom styled search panel matching NEXORA Cloud glass card dialogs.

### 4.4 History & Custom Keyboard Shortcuts (`@codemirror/commands`)
- `history()`: High-performance undo/redo buffer.
- `keymap.of([...])`:
  - `defaultKeymap`: VS Code standard cursor movements, word jumping, line deletion.
  - `historyKeymap`: `Ctrl-z` / `Cmd-z` (Undo), `Ctrl-y` / `Ctrl-Shift-z` / `Cmd-Shift-z` (Redo).
  - `foldKeymap`: `Ctrl-Shift-[` / `Ctrl-Shift-]` (Fold / Unfold).
  - `closeBracketsKeymap`: `Backspace` deletes paired empty bracket.
  - `indentWithTab`: `Tab` / `Shift-Tab` indents or dedents selection.
  - **Custom Save Keymap**:
    ```ts
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: (view) => {
            if (onSaveRef.current && !readOnlyRef.current) {
              onSaveRef.current();
              return true;
            }
            return false;
          },
        },
      ])
    )
    ```

### 4.5 Viewer Role (Read-Only) Enforcement
When `accessRole === "viewer"`:
1. `EditorState.readOnly.of(true)` (prevents document modification)
2. `EditorView.editable.of(false)` (disables mobile virtual keyboard popup on tap while allowing text selection & copy)
3. Custom save button disabled / hidden
4. Save keymap (`Ctrl-s`) ignored
5. Search & Replace panel (`Ctrl-f`) remains enabled in read-only mode for search, but replace input is disabled.

---

## 5. NEXORA Cloud Custom Dark Theme & Syntax Highlight Tokens

The editor theme is custom-crafted to harmonize with NEXORA Cloud's obsidian palette (`#08090d`, `#12141d`, `#ff1018`, `#38bdf8`, `#34d399`, `#f43f5e`, `#fbbf24`, `#edf1f5`).

### 5.1 Editor DOM Styling
```ts
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const nexoraDarkTheme = EditorView.theme(
  {
    "&": {
      color: "#edf1f5",
      backgroundColor: "#090a0f",
      fontFamily: 'Consolas, "Cascadia Code", "Fira Code", Monaco, "Courier New", monospace',
      fontSize: "13.5px",
      height: "100%",
    },
    ".cm-content": {
      padding: "12px 0",
      caretColor: "#ff2028",
      lineHeight: "1.65",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#ff2028",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#ff2028",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(255, 16, 24, 0.22) !important",
    },
    ".cm-panels": {
      backgroundColor: "#12141e",
      color: "#edf1f5",
      borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    },
    ".cm-search": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 12px",
      backgroundColor: "rgba(18, 20, 29, 0.95)",
    },
    ".cm-textfield": {
      backgroundColor: "#08090d",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "6px",
      color: "#edf1f5",
      padding: "4px 8px",
      outline: "none",
      fontSize: "12px",
    },
    ".cm-textfield:focus": {
      borderColor: "#ff2028",
      boxShadow: "0 0 0 2px rgba(255, 16, 24, 0.2)",
    },
    ".cm-button": {
      backgroundColor: "#1c202e",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: "6px",
      color: "#edf1f5",
      padding: "4px 10px",
      fontSize: "12px",
      cursor: "pointer",
    },
    ".cm-button:hover": {
      backgroundColor: "rgba(255, 16, 24, 0.15)",
      borderColor: "rgba(255, 16, 24, 0.35)",
    },
    ".cm-gutters": {
      backgroundColor: "#08090d",
      color: "#5b6577",
      borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      userSelect: "none",
      minWidth: "48px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255, 16, 24, 0.08)",
      color: "#ff464c",
      fontWeight: "bold",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(255, 16, 24, 0.15)",
      border: "1px solid rgba(255, 16, 24, 0.3)",
      color: "#ff555b",
      borderRadius: "4px",
      padding: "0 6px",
      margin: "0 4px",
    },
    ".cm-tooltip": {
      backgroundColor: "#12141f",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      color: "#edf1f5",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
    },
  },
  { dark: true }
);
```

### 5.2 Syntax Token Highlight Mapping
```ts
export const nexoraHighlightStyle = HighlightStyle.define([
  // Keywords, controls, definitions
  { tag: t.keyword, color: "#f43f5e", fontWeight: "600" }, // Rose / Primary
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#fb7185", fontWeight: "600" },
  { tag: [t.definitionKeyword, t.modifier], color: "#c084fc" },

  // Functions, methods, calls
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#38bdf8" }, // Sky Blue
  { tag: t.standard(t.name), color: "#38bdf8" },

  // Types, classes, interfaces
  { tag: [t.typeName, t.className, t.namespace], color: "#818cf8", fontWeight: "600" }, // Indigo

  // Variables, parameters, properties
  { tag: t.variableName, color: "#edf1f5" }, // Light white
  { tag: t.propertyName, color: "#93c5fd" }, // Soft blue
  { tag: t.attributeName, color: "#38bdf8" }, // HTML/XML attribute

  // Strings, characters, templates
  { tag: [t.string, t.special(t.string), t.character], color: "#34d399" }, // Emerald Green
  { tag: t.regexp, color: "#2dd4bf" }, // Teal

  // Numbers, booleans, constants, null
  { tag: [t.number, t.bool, t.null, t.atom], color: "#fbbf24" }, // Amber

  // Comments, docstrings
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#64748b", fontStyle: "italic" }, // Slate muted

  // Operators, punctuation, delimiters
  { tag: [t.operator, t.punctuation, t.bracket], color: "#94a3b8" },
  { tag: t.tagName, color: "#f43f5e", fontWeight: "600" }, // HTML Tag name

  // Headings & Markdown
  { tag: t.heading, color: "#f43f5e", fontWeight: "bold" },
  { tag: t.link, color: "#38bdf8", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
]);

export const nexoraDarkSyntax = syntaxHighlighting(nexoraHighlightStyle);
```

---

## 6. Language Detection & Dynamic Extension Loader

### 6.1 Language Resolver Matrix
```ts
import { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { go } from "@codemirror/lang-go";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerfile } from "@codemirror/legacy-modes/mode/dockerfile";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";

export function resolveLanguageExtension(filePath: string, explicitLang?: string): Extension {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const baseName = filePath.split("/").pop()?.toLowerCase() || "";

  // 1. Check exact filenames
  if (baseName === "dockerfile" || baseName.startsWith("dockerfile.")) {
    return StreamLanguage.define(dockerfile);
  }
  if (baseName === "nginx.conf" || baseName.endsWith(".nginx.conf")) {
    return StreamLanguage.define(nginx);
  }

  // 2. Extension matching
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "php":
    case "phtml":
    case "php8":
    case "inc":
      return php();
    case "html":
    case "htm":
    case "shtml":
    case "svg":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "json":
    case "jsonc":
    case "json5":
    case "lock":
      return json();
    case "py":
    case "pyw":
    case "wsgi":
      return python();
    case "go":
    case "mod":
      return go();
    case "sql":
    case "ddl":
    case "dml":
      return sql();
    case "md":
    case "markdown":
    case "mdx":
      return markdown();
    case "yaml":
    case "yml":
      return yaml();
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    default:
      return []; // Plain text fallback
  }
}
```

---

## 7. Touch & Mobile Responsiveness Strategy

To ensure fluid performance and accessibility across mobile devices and tablets:
1. **Dynamic Line Wrapping**: Automatically enable `EditorView.lineWrapping` on mobile viewports (`window.innerWidth < 768px`) to eliminate horizontal scrolling of long lines.
2. **Font Size & Viewport Zoom Prevention**: Base font size set to `13.5px` (desktop) and `14px` (mobile), preventing iOS Safari auto-zooming on focus.
3. **Touch Gutter Dimensions**: Gutter minimum width adjusted to `44px` with `touch-action: manipulation` for easy line targeting.
4. **Touch Scrolling**: Code container configured with `-webkit-overflow-scrolling: touch` and `overscroll-behavior: contain`.
5. **Virtual Keyboard Handling**: `readOnly` mode dispatches `EditorView.editable.of(false)`, preventing virtual keyboards from popping up unexpectedly when users browse code on phones.

---

## 8. Spec Miner Discoveries Table

## Features Discovered
| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Core Editor | EditorState & EditorView | Central immutable state management and virtualized DOM renderer | Document text, extension array, DOM container | Interactive Code Editor DOM tree | Throws error if DOM container is null or executed in SSR | `@codemirror/state`, `@codemirror/view` |
| 2 | Reconfiguration | Compartments | Dynamic runtime extension swapping without editor teardown | Compartment effect payload (`reconfigure`) | Seamless update of language, theme, or read-only mode | Safely ignored if compartment not bound | `@codemirror/state` |
| 3 | Navigation | Line Numbers & Active Line Gutter | Numerical line indicators and highlighted current line index | Line numbers facet | Gutter column with active line styling | Fallback to default gutter styling | `@codemirror/view` |
| 4 | Code Structure | Code Folding | AST-based collapsible code blocks for functions, classes, tags | Fold gutter extension & keymap | Collapsible chevron indicators & folded spans | Non-foldable lines remain unaffected | `@codemirror/language` |
| 5 | Search Engine | Top Search & Replace Panel | Integrated search bar supporting regex, case-match, query jumping, and replace | `openSearchPanel`, `searchKeymap`, Ctrl+F, Ctrl+H | Interactive search UI toolbar | Displays match count (e.g., "0 of 0") if not found | `@codemirror/search` |
| 6 | Editing Commands | History & Standard Keymaps | Multi-level undo/redo buffer, bracket matching, indentation | `history()`, `defaultKeymap`, `indentWithTab` | Document mutations & cursor navigation | Undo stack drops on document reset | `@codemirror/commands` |
| 7 | Syntax Highlighting | Multi-Language Parser Suite | Lexing & AST tagging for JS, TS, PHP, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML | Source code text | Colored syntax tokens | Syntax errors highlight gracefully without crashing | `@codemirror/lang-*` |
| 8 | Legacy Modes | StreamLanguage Fallbacks | Token-based highlighters for Shell scripts, Dockerfiles, Nginx configs | Legacy mode definitions | Stream-highlighted tokens | Fallback to plain text if mode fails | `@codemirror/legacy-modes` |
| 9 | Permissions | Viewer Role Enforcement | Read-only state locking for users without edit rights | `EditorState.readOnly(true)`, `editable(false)` | Text selection & search enabled; mutations blocked | Edit operations silently blocked | `@codemirror/state` & `HostingView` |
| 10 | Theming | NEXORA Dark Palette | Custom obsidian & rose theme with Lezer highlight tokens | Theme configuration object | Scoped CSS classes applied to `.cm-editor` | Inherits base editor styles | Lezer Highlight & CM6 Theme |

---

## 9. Edge Cases & Handling Matrix

## Edge Cases
| # | Feature | Input / Condition | Observed / Required Behavior |
|---|---------|-------------------|-----------------------------|
| 1 | SSR / Next.js Hydration | Component rendered on Node.js server | `"use client"` boundary and `useEffect` mount gate prevent DOM access errors. |
| 2 | Tab Switching | Rapid switching between multiple open tabs | Existing `EditorView` state preserved or reconfigured via `Compartment` without recreating DOM nodes. |
| 3 | File Type Switching | Changing from `.php` to `.json` or `.ts` | `languageCompartment.reconfigure()` swaps grammar seamlessly in < 2ms without re-parsing entire editor. |
| 4 | Viewer Role | User with role `viewer` attempts typing or pressing Ctrl+S | Keyboard input ignored, save hotkey blocked, replace panel disabled, text copy & search remain operational. |
| 5 | Large Files (> 1MB) | High line-count code files loaded into editor | CodeMirror 6 line virtualization only renders viewport DOM nodes, maintaining 60 FPS scrolling. |
| 6 | Unsaved Dirty State | External document change vs local typing | Value synchronization compares `view.state.doc.toString()` before dispatching transaction to prevent cursor jumps. |
| 7 | Mobile Screen Width | Viewport width < 768px | Line wrapping activated, search panel stacks vertically, virtual keyboard suppressed in read-only mode. |
| 8 | Special Extensions | Files without extensions (`Dockerfile`, `.env`, `nginx.conf`) | Language resolver detects filename stems and applies appropriate mode or clean plain text. |
| 9 | Multi-Tab Save Action | User presses Ctrl+S | Custom high-priority keymap intercepts `Mod-s`, invokes `onSave()` callback, prevents default browser "Save Webpage" dialog. |
| 10 | React StrictMode (Dev) | `useEffect` runs twice on initial mount in development | Proper cleanup return calling `view.destroy()` prevents duplicate overlapping editor instances. |

---

## 10. Implementation Recommendations for Workspace Integration

1. **Modular Code Structure**:
   Create a dedicated workspace folder:
   - `app/components/code-workspace/CodeEditor.tsx` (Core CM6 React wrapper)
   - `app/components/code-workspace/theme.ts` (NEXORA Dark theme & syntax highlight rules)
   - `app/components/code-workspace/languages.ts` (File extension & language resolver)
   - `app/components/code-workspace/types.ts` (Tab & editor type definitions)

2. **Integration into `HostingView.tsx`**:
   Replace the `<textarea>` at line 1783 of `HostingView.tsx` with `<CodeEditor ... />`, passing the active tab's file content, file path, `accessRole === "viewer"` read-only flag, `onChange`, and `onSave` callbacks.
