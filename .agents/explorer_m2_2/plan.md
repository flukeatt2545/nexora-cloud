# Implementation Blueprint: NEXORA Theme & 11+ Language Highlighting Suite

**Target Files:**
1. `app/components/code-workspace/editor-theme.ts`
2. `app/components/code-workspace/language-loader.ts`

---

## 1. Architecture & Design Principles

The NEXORA Cloud code editor delivers a VS Code-grade code editing experience built on **CodeMirror 6 (CM6)**. The theme and language loader subsystems fulfill two core responsibilities:
1. **NEXORA Obsidian Dark Theme (`editor-theme.ts`)**: Harmonizes the CodeMirror 6 DOM elements, cursor, selection, active line, line numbers, code folding indicators, matching brackets, and embedded search/replace panels with the dark obsidian aesthetic (`#090a0f`, `#131622`, `#ff1018`, `#38bdf8`, `#34d399`, `#f43f5e`, `#fbbf24`, `#818cf8`, `#edf1f5`).
2. **Dynamic Language Resolver (`language-loader.ts`)**: Resolves file extensions, full file paths, dotfiles, or explicit language names into CodeMirror 6 AST-based language extensions (`LanguageSupport` or `StreamLanguage`), supporting 11+ primary web/cloud languages plus shell, dockerfile, nginx, toml, xml, and plaintext fallbacks.

---

## 2. Specification 1: `editor-theme.ts`

### 2.1 Design Palette & Token Mapping

| Element / Syntax Token | Hex / RGBA Code | Lezer Highlight Tag | Notes / Styling Details |
|---|---|---|---|
| **Editor Background** | `#090a0f` | N/A | Deep obsidian background |
| **Foreground Text** | `#edf1f5` | `t.variableName`, `t.propertyName` | High-contrast readable white |
| **Active Line** | `#131622` | N/A | Subtle dark slate highlight |
| **Active Line Gutter** | `#131622` + `#ff1018` | N/A | Background `#131622`, bold crimson number `#ff1018` |
| **Gutter Background** | `#090a0f` | N/A | Seamless blend with editor background |
| **Line Numbers Color** | `#475569` | N/A | Slate muted numbers, right-aligned |
| **Fold Markers** | `#64748b` | N/A | Hover crimson `#ff1018` |
| **Fold Placeholder** | `rgba(255, 16, 24, 0.15)` | N/A | Border `rgba(255, 16, 24, 0.3)`, text `#ff555b` |
| **Selection Background** | `rgba(255, 16, 24, 0.25)` | N/A | Crimson translucent highlight with `!important` |
| **Cursor / Caret** | `#ff1018` | N/A | 2px smooth blinking crimson caret |
| **Matching Bracket** | `#23283b` | N/A | Crimson outline `1px solid #ff1018`, radius 2px |
| **Non-Matching Bracket** | `rgba(244, 63, 94, 0.2)` | N/A | Rose outline `1px solid #f43f5e` |
| **Search Panel Container** | `#0e1017` / `#131622` | N/A | Obsidian toolbar with bottom border `rgba(255,255,255,0.1)` |
| **Search Text Inputs** | `#131622` | N/A | Border `rgba(255, 255, 255, 0.12)`, focus ring `#ff1018` |
| **Search Action Buttons** | `#1e2333` | N/A | Hover crimson tint `rgba(255, 16, 24, 0.2)` |
| **Search Query Matches** | `rgba(251, 191, 36, 0.25)` | N/A | Amber box highlight with outline `rgba(251, 191, 36, 0.6)` |
| **Active Search Match** | `rgba(251, 191, 36, 0.5)` | N/A | Solid amber outline `#fbbf24` |
| **Keywords / Control** | `#f43f5e` | `t.keyword`, `t.controlKeyword`, `t.moduleKeyword`, `t.definitionKeyword`, `t.modifier` | Rose primary keywords (`fontWeight: '600'`) |
| **HTML / XML Tags** | `#f43f5e` | `t.tagName` | Rose bold tag names |
| **Functions / Calls** | `#38bdf8` | `t.function(t.variableName)`, `t.function(t.propertyName)`, `t.standard(t.name)`, `t.macroName` | Sky blue |
| **Strings / Literals** | `#34d399` | `t.string`, `t.special(t.string)`, `t.character`, `t.attributeValue` | Emerald green |
| **Regex** | `#2dd4bf` | `t.regexp` | Teal green |
| **Numbers / Booleans** | `#fbbf24` | `t.number`, `t.integer`, `t.float`, `t.bool`, `t.null`, `t.atom`, `t.unit` | Amber |
| **Types / Classes** | `#818cf8` | `t.typeName`, `t.className`, `t.namespace`, `t.standard(t.typeName)` | Indigo (`fontWeight: '600'`) |
| **Comments** | `#64748b` | `t.comment`, `t.lineComment`, `t.blockComment`, `t.docComment`, `t.docString` | Slate muted, italic |
| **Variables / Properties** | `#edf1f5` | `t.variableName`, `t.propertyName` | Clean readable foreground |
| **Attributes** | `#38bdf8` | `t.attributeName` | Sky blue attributes |
| **Operators** | `#38bdf8` | `t.operator`, `t.arithmeticOperator`, `t.logicOperator`, `t.compareOperator`, `t.bitwiseOperator`, `t.updateOperator`, `t.typeOperator` | Sky blue math & logic operators |
| **Punctuation / Delimiters** | `#94a3b8` | `t.punctuation`, `t.separator`, `t.bracket` | Soft gray delimiters |
| **Headings (Markdown)** | `#f43f5e` | `t.heading`, `t.heading1`, `t.heading2`, `t.heading3` | Bold crimson/rose |
| **Links / URLs** | `#38bdf8` | `t.link`, `t.url` | Underlined sky blue |

### 2.2 Complete Implementation: `app/components/code-workspace/editor-theme.ts`

```typescript
/**
 * NEXORA Obsidian Dark Theme & Lezer Syntax Highlight Suite
 * File: app/components/code-workspace/editor-theme.ts
 */

import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * EditorView DOM Theme for NEXORA Cloud Obsidian Palette
 */
export const nexoraDarkTheme = EditorView.theme(
  {
    // Root Editor Container
    "&": {
      color: "#edf1f5",
      backgroundColor: "#090a0f",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: "13.5px",
      height: "100%",
      width: "100%",
    },

    // Content Editable Area
    ".cm-content": {
      padding: "12px 0",
      caretColor: "#ff1018",
      lineHeight: "1.65",
    },

    // Scroller container
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.65",
      overflow: "auto",
    },

    // Smooth Cursor & Drop Cursor
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#ff1018",
      borderLeftWidth: "2px",
      borderLeftStyle: "solid",
    },

    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#ff1018",
    },

    // Modern Translucent Selection Background
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(255, 16, 24, 0.25) !important",
      },

    // Active Line Highlighting in Editor Area
    ".cm-activeLine": {
      backgroundColor: "#131622",
    },

    // Gutters (Line numbers, fold indicators)
    ".cm-gutters": {
      backgroundColor: "#090a0f",
      color: "#475569",
      borderRight: "1px solid rgba(255, 255, 255, 0.06)",
      userSelect: "none",
      minWidth: "44px",
      paddingRight: "4px",
    },

    // Line Numbers
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 12px",
      minWidth: "28px",
      textAlign: "right",
    },

    // Active Line in Gutter
    ".cm-activeLineGutter": {
      backgroundColor: "#131622",
      color: "#ff1018",
      fontWeight: "bold",
    },

    // Fold Gutter & Chevrons
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 4px",
      cursor: "pointer",
    },
    ".cm-foldGutter span": {
      color: "#64748b",
      transition: "color 0.15s ease",
    },
    ".cm-foldGutter span:hover": {
      color: "#ff1018",
    },

    // Fold Placeholder (collapsed code badge)
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(255, 16, 24, 0.15)",
      border: "1px solid rgba(255, 16, 24, 0.3)",
      color: "#ff555b",
      borderRadius: "4px",
      padding: "0 6px",
      margin: "0 4px",
      fontSize: "12px",
      cursor: "pointer",
    },

    // Matching Bracket (Cursor adjacent)
    "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
      backgroundColor: "#23283b",
      outline: "1px solid #ff1018",
      borderRadius: "2px",
    },

    // Non-Matching / Unclosed Bracket
    "&.cm-focused .cm-nonmatchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(244, 63, 94, 0.2)",
      outline: "1px solid #f43f5e",
      borderRadius: "2px",
    },

    // Search & Replace Panels
    ".cm-panels": {
      backgroundColor: "#0e1017",
      color: "#edf1f5",
      borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
      zIndex: "10",
    },
    ".cm-panels-top": {
      borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    },
    ".cm-panels-bottom": {
      borderTop: "1px solid rgba(255, 255, 255, 0.1)",
    },

    // Embedded Search Bar
    ".cm-search": {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "6px",
      padding: "8px 12px",
      backgroundColor: "#0e1017",
    },
    ".cm-textfield": {
      backgroundColor: "#131622",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: "6px",
      color: "#edf1f5",
      padding: "4px 8px",
      fontSize: "12px",
      outline: "none",
      transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    },
    ".cm-textfield:focus": {
      borderColor: "#ff1018",
      boxShadow: "0 0 0 2px rgba(255, 16, 24, 0.2)",
    },
    ".cm-button": {
      backgroundColor: "#1e2333",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: "6px",
      color: "#edf1f5",
      padding: "4px 10px",
      fontSize: "12px",
      cursor: "pointer",
      transition: "all 0.15s ease",
    },
    ".cm-button:hover": {
      backgroundColor: "rgba(255, 16, 24, 0.2)",
      borderColor: "rgba(255, 16, 24, 0.4)",
      color: "#ffffff",
    },

    // Search Matches
    ".cm-searchMatch": {
      backgroundColor: "rgba(251, 191, 36, 0.25)",
      outline: "1px solid rgba(251, 191, 36, 0.6)",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(251, 191, 36, 0.5)",
      outline: "1px solid #fbbf24",
    },

    // Tooltips & Autocomplete
    ".cm-tooltip": {
      backgroundColor: "#12141f",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: "8px",
      color: "#edf1f5",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul": {
        fontFamily: "inherit",
        maxHeight: "220px",
      },
      "& > ul > li": {
        padding: "4px 8px",
        borderRadius: "4px",
      },
      "& > ul > li[aria-selected]": {
        backgroundColor: "rgba(255, 16, 24, 0.25)",
        color: "#ffffff",
      },
    },

    // Special & Invisible Characters
    ".cm-specialChar": {
      color: "#64748b",
    },
  },
  { dark: true }
);

/**
 * Lezer Syntax Highlighting Definition matching NEXORA Cloud Color Tokens
 */
export const nexoraHighlightStyle = HighlightStyle.define([
  // Keywords & Declarations (Rose / Crimson)
  { tag: t.keyword, color: "#f43f5e", fontWeight: "600" },
  {
    tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier],
    color: "#f43f5e",
    fontWeight: "600",
  },
  { tag: t.self, color: "#f43f5e", fontWeight: "600" },
  { tag: t.tagName, color: "#f43f5e", fontWeight: "600" },

  // Functions, Methods & Calls (Sky Blue)
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.standard(t.name),
      t.macroName,
      t.definition(t.function(t.variableName)),
    ],
    color: "#38bdf8",
  },

  // Strings & Character Literals (Emerald Green)
  {
    tag: [t.string, t.special(t.string), t.character, t.attributeValue],
    color: "#34d399",
  },
  { tag: t.regexp, color: "#2dd4bf" },

  // Numbers, Booleans, Units & Constants (Amber)
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit],
    color: "#fbbf24",
  },

  // Types, Classes, Namespaces & Interfaces (Indigo)
  {
    tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)],
    color: "#818cf8",
    fontWeight: "600",
  },

  // Comments & Documentation (Slate Muted, Italic)
  {
    tag: [
      t.comment,
      t.lineComment,
      t.blockComment,
      t.docComment,
      t.docString,
    ],
    color: "#64748b",
    fontStyle: "italic",
  },

  // Variables, Properties & Attributes
  { tag: t.variableName, color: "#edf1f5" },
  { tag: t.propertyName, color: "#edf1f5" },
  { tag: t.attributeName, color: "#38bdf8" },

  // Operators & Arithmetic (Sky Blue)
  {
    tag: [
      t.operator,
      t.arithmeticOperator,
      t.logicOperator,
      t.compareOperator,
      t.bitwiseOperator,
      t.updateOperator,
      t.typeOperator,
      t.definitionOperator,
    ],
    color: "#38bdf8",
  },

  // Punctuation, Delimiters & Brackets (Slate Gray)
  {
    tag: [t.punctuation, t.separator, t.bracket],
    color: "#94a3b8",
  },

  // Markdown & Markup Headings and Formatting
  {
    tag: [t.heading, t.heading1, t.heading2, t.heading3],
    color: "#f43f5e",
    fontWeight: "bold",
  },
  { tag: [t.link, t.url], color: "#38bdf8", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#ef4444" },
]);

/**
 * Combined Syntax Highlighting Extension
 */
export const nexoraSyntaxHighlighting = syntaxHighlighting(nexoraHighlightStyle);

/**
 * Composite Extension containing both DOM theme and syntax highlighting
 */
export const nexoraTheme: Extension = [nexoraDarkTheme, nexoraSyntaxHighlighting];
```

---

## 3. Specification 2: `language-loader.ts`

### 3.1 Language Matrix & Dependency Mapping

| Language | Engine / Package | Extensions / Filename Patterns | Config / Options |
|---|---|---|---|
| **PHP** | `@codemirror/lang-php` | `.php`, `.phtml`, `.php3`, `.php4`, `.php5`, `.php7`, `.php8`, `.phps`, `.inc` | `php()` |
| **JavaScript** | `@codemirror/lang-javascript` | `.js`, `.mjs`, `.cjs`, `.jsx`, `.es6`, `.pac` | `javascript({ jsx: true })` |
| **TypeScript** | `@codemirror/lang-javascript` | `.ts`, `.mts`, `.cts`, `.tsx` | `javascript({ jsx: true, typescript: true })` |
| **HTML** | `@codemirror/lang-html` | `.html`, `.htm`, `.xhtml`, `.shtml`, `.svg`, `.vue`, `.svelte` | `html()` |
| **CSS** | `@codemirror/lang-css` | `.css`, `.scss`, `.sass`, `.less`, `.postcss` | `css()` |
| **JSON** | `@codemirror/lang-json` | `.json`, `.jsonc`, `.json5`, `.lock`, `.webmanifest`, `.map` | `json()` |
| **Python** | `@codemirror/lang-python` | `.py`, `.pyw`, `.pyi`, `.wsgi`, `.rpy` | `python()` |
| **Go** | `@codemirror/lang-go` | `.go`, `go.mod`, `go.sum`, `go.work` | `go()` |
| **SQL** | `@codemirror/lang-sql` | `.sql`, `.ddl`, `.dml`, `.pgsql`, `.mysql`, `.sqlite`, `.cql` | `sql()` |
| **Markdown** | `@codemirror/lang-markdown` | `.md`, `.markdown`, `.mdown`, `.mdx`, `.mkd` | `markdown()` |
| **YAML** | `@codemirror/lang-yaml` | `.yaml`, `.yml` | `yaml()` |
| **Shell** | `@codemirror/legacy-modes/mode/shell` | `.sh`, `.bash`, `.zsh`, `.ksh`, `.csh`, `.tcsh`, `.fish`, `.env*`, `.bashrc`, `.zshrc`, `.profile` | `StreamLanguage.define(shell)` |
| **Dockerfile** | `@codemirror/legacy-modes/mode/dockerfile` | `Dockerfile`, `Dockerfile.*`, `dockerfile`, `.dockerignore` | `StreamLanguage.define(dockerFile)` *(Note capital F)* |
| **Nginx** | `@codemirror/legacy-modes/mode/nginx` | `nginx.conf`, `*.nginx.conf`, `*.conf`, `.htaccess` | `StreamLanguage.define(nginx)` |
| **TOML** | `@codemirror/legacy-modes/mode/toml` | `.toml`, `Cargo.lock` | `StreamLanguage.define(toml)` |
| **XML** | `@codemirror/legacy-modes/mode/xml` | `.xml`, `.rss`, `.atom`, `.plist`, `.xsd`, `.xsl`, `.wsdl` | `StreamLanguage.define(xml)` |
| **Plain Text** | Fallback | All unknown files, `.txt`, `.log`, `.csv`, `.tsv` | `[]` (Empty extension) |

### 3.2 Complete Implementation: `app/components/code-workspace/language-loader.ts`

```typescript
/**
 * Dynamic Language Resolver & Extension Loader for 11+ Languages
 * File: app/components/code-workspace/language-loader.ts
 */

import { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// Native CodeMirror 6 Language Packages
import { php } from "@codemirror/lang-php";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";

// Legacy Modes for Configuration & Scripting
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";

export interface LanguageDefinition {
  id: string;
  name: string;
  extensions: string[];
  filenames?: string[];
  getExtension: () => Extension;
}

/**
 * Pre-instantiated singleton language extensions for high performance
 */
const EXTENSION_INSTANCES = {
  php: php(),
  javascript: javascript({ jsx: true }),
  typescript: javascript({ jsx: true, typescript: true }),
  html: html(),
  css: css(),
  json: json(),
  python: python(),
  go: go(),
  sql: sql(),
  markdown: markdown(),
  yaml: yaml(),
  shell: StreamLanguage.define(shell),
  dockerfile: StreamLanguage.define(dockerFile),
  nginx: StreamLanguage.define(nginx),
  toml: StreamLanguage.define(toml),
  xml: StreamLanguage.define(xml),
};

/**
 * Extension-to-Language ID Lookup Map
 */
const EXTENSION_MAP: Record<string, keyof typeof EXTENSION_INSTANCES> = {
  // PHP
  php: "php",
  phtml: "php",
  php3: "php",
  php4: "php",
  php5: "php",
  php7: "php",
  php8: "php",
  phps: "php",
  inc: "php",

  // JavaScript
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  es6: "javascript",
  pac: "javascript",

  // TypeScript
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",

  // HTML & Templates
  html: "html",
  htm: "html",
  xhtml: "html",
  shtml: "html",
  svg: "html",
  vue: "html",
  svelte: "html",

  // CSS & Styles
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  postcss: "css",

  // JSON & Data
  json: "json",
  jsonc: "json",
  json5: "json",
  lock: "json",
  webmanifest: "json",
  map: "json",

  // Python
  py: "python",
  pyw: "python",
  pyi: "python",
  wsgi: "python",
  rpy: "python",

  // Go
  go: "go",

  // SQL
  sql: "sql",
  ddl: "sql",
  dml: "sql",
  mysql: "sql",
  pgsql: "sql",
  sqlite: "sql",
  cql: "sql",

  // Markdown
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mdx: "markdown",
  mkd: "markdown",

  // YAML
  yaml: "yaml",
  yml: "yaml",

  // Shell & Environment
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  csh: "shell",
  tcsh: "shell",
  fish: "shell",
  env: "shell",

  // Docker
  dockerfile: "dockerfile",

  // Nginx / Server configs
  nginx: "nginx",
  conf: "nginx",
  htaccess: "nginx",

  // TOML
  toml: "toml",

  // XML
  xml: "xml",
  rss: "xml",
  atom: "xml",
  plist: "xml",
  xsd: "xml",
  xsl: "xml",
  wsdl: "xml",
};

/**
 * Exact Filename-to-Language ID Lookup Map
 */
const EXACT_FILENAME_MAP: Record<string, keyof typeof EXTENSION_INSTANCES> = {
  dockerfile: "dockerfile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  "nginx.conf": "nginx",
  "go.mod": "go",
  "go.sum": "go",
  "go.work": "go",
  "cargo.toml": "toml",
  "cargo.lock": "toml",
  "composer.json": "json",
  "composer.lock": "json",
  "package.json": "json",
  "package-lock.json": "json",
  "tsconfig.json": "json",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
  ".bash_profile": "shell",
  ".gitignore": "shell",
  ".dockerignore": "shell",
};

/**
 * Display names for status bars and UI indicators
 */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  php: "PHP",
  javascript: "JavaScript",
  typescript: "TypeScript",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  python: "Python",
  go: "Go",
  sql: "SQL",
  markdown: "Markdown",
  yaml: "YAML",
  shell: "Shell Script",
  dockerfile: "Dockerfile",
  nginx: "Nginx Config",
  toml: "TOML",
  xml: "XML",
  plaintext: "Plain Text",
};

/**
 * Extract canonical language ID from a path, filename, or direct language name
 */
export function getLanguageFromPath(languageOrPath: string): string {
  if (!languageOrPath) return "plaintext";

  const cleaned = languageOrPath.trim().replace(/\\/g, "/");
  const fileName = (cleaned.split("/").pop() || cleaned).toLowerCase();

  // 1. Direct language key match (e.g. "typescript", "php", "json")
  if (fileName in EXTENSION_INSTANCES) {
    return fileName;
  }
  if (fileName === "js") return "javascript";
  if (fileName === "ts") return "typescript";
  if (fileName === "py") return "python";
  if (fileName === "md") return "markdown";
  if (fileName === "sh") return "shell";
  if (fileName === "yml") return "yaml";
  if (fileName === "docker") return "dockerfile";
  if (fileName === "golang") return "go";
  if (fileName === "text" || fileName === "txt" || fileName === "plaintext") return "plaintext";

  // 2. Exact filename match
  if (fileName in EXACT_FILENAME_MAP) {
    return EXACT_FILENAME_MAP[fileName];
  }

  // 3. Prefix matching for Dockerfile.* and .env.*
  if (fileName.startsWith("dockerfile.") || fileName.startsWith("dockerfile-")) {
    return "dockerfile";
  }
  if (fileName.startsWith(".env")) {
    return "shell";
  }

  // 4. Suffix matching for .nginx.conf
  if (fileName.endsWith(".nginx.conf")) {
    return "nginx";
  }

  // 5. File extension match
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = fileName.slice(dotIndex + 1);
    if (ext in EXTENSION_MAP) {
      return EXTENSION_MAP[ext];
    }
  }

  return "plaintext";
}

/**
 * Returns the CodeMirror 6 Extension corresponding to a language ID or file path.
 * Falls back to an empty array (plain text) if unrecognized.
 */
export function getLanguageExtension(languageOrPath: string): Extension {
  const langId = getLanguageFromPath(languageOrPath);
  if (langId in EXTENSION_INSTANCES) {
    return EXTENSION_INSTANCES[langId as keyof typeof EXTENSION_INSTANCES];
  }
  return [];
}

/**
 * Returns a human-friendly display name for the language mode
 */
export function getLanguageDisplayName(languageOrPath: string): string {
  const langId = getLanguageFromPath(languageOrPath);
  return LANGUAGE_DISPLAY_NAMES[langId] || "Plain Text";
}

/**
 * Checks whether a language is fully supported by the highlighter suite
 */
export function isLanguageSupported(languageOrPath: string): boolean {
  const langId = getLanguageFromPath(languageOrPath);
  return langId !== "plaintext" && langId in EXTENSION_INSTANCES;
}

/**
 * Returns the full catalog of supported language definitions
 */
export function getSupportedLanguages(): LanguageDefinition[] {
  return [
    {
      id: "php",
      name: "PHP",
      extensions: ["php", "phtml", "php8", "inc"],
      getExtension: () => EXTENSION_INSTANCES.php,
    },
    {
      id: "javascript",
      name: "JavaScript",
      extensions: ["js", "mjs", "cjs", "jsx"],
      getExtension: () => EXTENSION_INSTANCES.javascript,
    },
    {
      id: "typescript",
      name: "TypeScript",
      extensions: ["ts", "mts", "cts", "tsx"],
      getExtension: () => EXTENSION_INSTANCES.typescript,
    },
    {
      id: "html",
      name: "HTML",
      extensions: ["html", "htm", "shtml", "svg", "vue", "svelte"],
      getExtension: () => EXTENSION_INSTANCES.html,
    },
    {
      id: "css",
      name: "CSS",
      extensions: ["css", "scss", "sass", "less"],
      getExtension: () => EXTENSION_INSTANCES.css,
    },
    {
      id: "json",
      name: "JSON",
      extensions: ["json", "jsonc", "json5", "lock"],
      getExtension: () => EXTENSION_INSTANCES.json,
    },
    {
      id: "python",
      name: "Python",
      extensions: ["py", "pyw", "wsgi"],
      getExtension: () => EXTENSION_INSTANCES.python,
    },
    {
      id: "go",
      name: "Go",
      extensions: ["go"],
      filenames: ["go.mod", "go.sum"],
      getExtension: () => EXTENSION_INSTANCES.go,
    },
    {
      id: "sql",
      name: "SQL",
      extensions: ["sql", "ddl", "dml"],
      getExtension: () => EXTENSION_INSTANCES.sql,
    },
    {
      id: "markdown",
      name: "Markdown",
      extensions: ["md", "markdown", "mdx"],
      getExtension: () => EXTENSION_INSTANCES.markdown,
    },
    {
      id: "yaml",
      name: "YAML",
      extensions: ["yaml", "yml"],
      filenames: ["docker-compose.yml"],
      getExtension: () => EXTENSION_INSTANCES.yaml,
    },
    {
      id: "shell",
      name: "Shell Script",
      extensions: ["sh", "bash", "zsh", "fish", "env"],
      filenames: [".bashrc", ".zshrc", ".gitignore", ".env"],
      getExtension: () => EXTENSION_INSTANCES.shell,
    },
    {
      id: "dockerfile",
      name: "Dockerfile",
      extensions: ["dockerfile"],
      filenames: ["Dockerfile", ".dockerignore"],
      getExtension: () => EXTENSION_INSTANCES.dockerfile,
    },
    {
      id: "nginx",
      name: "Nginx Config",
      extensions: ["conf", "nginx"],
      filenames: ["nginx.conf"],
      getExtension: () => EXTENSION_INSTANCES.nginx,
    },
    {
      id: "toml",
      name: "TOML",
      extensions: ["toml"],
      filenames: ["Cargo.toml", "Cargo.lock"],
      getExtension: () => EXTENSION_INSTANCES.toml,
    },
    {
      id: "xml",
      name: "XML",
      extensions: ["xml", "rss", "atom", "xsd"],
      getExtension: () => EXTENSION_INSTANCES.xml,
    },
  ];
}
```

---

## 4. Integration Blueprint with `CodeEditor.tsx` & `WorkspaceStatusBar.tsx`

### 4.1 Compartment-Based Dynamic Reconfiguration

In `CodeEditor.tsx`, language swapping and theme applying are managed dynamically using CodeMirror 6 `Compartment` instances without destroying or recreating the `EditorView`:

```tsx
import { Compartment } from "@codemirror/state";
import { nexoraTheme } from "./editor-theme";
import { getLanguageExtension } from "./language-loader";

// Inside CodeEditor component:
const languageCompartment = useRef(new Compartment()).current;
const themeCompartment = useRef(new Compartment()).current;

// In EditorState.create:
const startState = EditorState.create({
  doc: content,
  extensions: [
    themeCompartment.of(nexoraTheme),
    languageCompartment.of(getLanguageExtension(language || filePath)),
    // ...other extensions (lineNumbers, search, history, keymaps)
  ],
});

// In useEffect on [language, filePath]:
useEffect(() => {
  if (!viewRef.current) return;
  viewRef.current.dispatch({
    effects: languageCompartment.reconfigure(
      getLanguageExtension(language || filePath)
    ),
  });
}, [language, filePath]);
```

### 4.2 Workspace Status Bar Integration

In `WorkspaceStatusBar.tsx`, the language mode badge displays the resolved human-readable name:

```tsx
import { getLanguageDisplayName } from "./language-loader";

// In WorkspaceStatusBar.tsx:
const displayLang = getLanguageDisplayName(activeTab?.language || activeTab?.path || "plaintext");

// Renders:
<span className="text-xs px-2 py-0.5 rounded bg-white/5 text-gray-300 font-mono">
  {displayLang}
</span>
```

---

## 5. Verification & Test Plan

1. **Syntax Highlight Rendering Verification**:
   - Create mock files for each of the 16 languages.
   - Verify that tokens (keywords, functions, strings, numbers, types, comments, operators) are correctly identified by `@lezer/highlight`.
2. **Theme CSS Class & Contrast Verification**:
   - Verify `.cm-content` caret color is `#ff1018`.
   - Verify `.cm-activeLine` and `.cm-activeLineGutter` background is `#131622`.
   - Verify matching bracket has `#23283b` background with `1px solid #ff1018` outline.
   - Verify `.cm-selectionBackground` has `rgba(255, 16, 24, 0.25)`.
3. **Edge Case Resolution**:
   - Test uppercase extensions (`.PHP`, `.JSON`, `.TSX`).
   - Test Windows vs POSIX path separators (`app\index.php` vs `app/index.php`).
   - Test dotfiles (`.env`, `.env.local`, `.gitignore`, `.bashrc`).
   - Test files without extension (`Dockerfile`, `Dockerfile.prod`, `nginx.conf`).
   - Test unknown extensions (`test.xyz`) gracefully falling back to plain text (`[]`).
