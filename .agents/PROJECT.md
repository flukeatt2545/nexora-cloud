# Project: VS Code-Style File Explorer & CodeMirror 6 Multi-Tab Workspace for NEXORA Cloud

## Product writing convention

- Do not use emoji in UI copy, notifications, activity logs, generated-site messages, or new product content. Use Lucide icons when a visual cue is needed.

## Architecture
The VS Code-style File Explorer and CodeMirror 6 Code Editor upgrades the file management in NEXORA Cloud Hosting (`app/dashboard/HostingView.tsx`), replacing the legacy single-file `<textarea>` editor with a modern, modular, IDE-class multi-tab code workspace.

```
+------------------------------------------------------------------------------------------------+
| CodeWorkspaceModal (Full-screen IDE modal / responsive container)                             |
| +-------------------------+------------------------------------------------------------------+ |
| | WorkspaceSidebar (260px)| WorkspaceTabBar (Multi-tab strip, active tab, dirty dot, close) | |
| | - WorkspaceHeader       +------------------------------------------------------------------+ |
| |   (Actions: new, upload,| CodeEditor (CodeMirror 6 core instance)                          | |
| |    folder, refresh, zip)| - Line numbers, active line, code folding, bracket matching       | |
| | - FileTree              | - Syntax highlighting (PHP, JS, TS, HTML, CSS, JSON, Python,     | |
| |   - FileTreeNode (lazy) |   Go, SQL, Markdown, YAML, Shell, Dockerfile, Nginx)             | |
| |   - FileIcon            | - NEXORA Dark Obsidian Theme                                     | |
| | - ContextMenu           | - Search / Replace bar & keymaps (Ctrl+F, Ctrl+H, Ctrl+S)        | |
| | - Storage / Quick stats | - Mobile touch-safe gutters & viewport scrolling                 | |
| |                         +------------------------------------------------------------------+ |
| |                         | WorkspaceStatusBar (File path, encoding, lang, line/col, role)   | |
| +-------------------------+------------------------------------------------------------------+ |
| Dialogs: DiffDialog (preview before save) | UnsavedConfirmDialog (warn before discard/close)   |
+------------------------------------------------------------------------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | CodeMirror 6 Packages Installation | Install `@codemirror/*`, `@lezer/highlight`, and all 11+ language packages in `package.json` | M1 | ORIGINAL_REQUEST §R2 |
| 2 | Hierarchical File Tree View | Collapsible / expandable multi-level folder tree with lazy loading on expand | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Extension-based File Icons | Accurate color-coded file icons based on extension using Lucide icons | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Multi-Tab Bar & State Tracking | Tab bar supporting multiple open files, tab switching, close tab, and dirty/unsaved indicator dot | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Workspace Status Bar | Footer displaying active file path, language mode, line/col count, cursor position, and access role | M1 | ORIGINAL_REQUEST §R1 |
| 6 | CodeMirror 6 Core Engine & Theme | Client-side React 19 integration, NEXORA obsidian dark theme, DOM lifecycle & `view.destroy()` | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Full Syntax Highlighting Suite | 11+ Languages: PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML (+ Shell/Docker/Nginx) | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Editor Ergonomics & Keymaps | Line numbers, active line highlight, AST code folding, bracket matching, Ctrl+S save shortcut | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Search & Replace Bar | Integrated search panel (Ctrl+F, Ctrl+H, regex, case-sensitive, match count) | M2 | ORIGINAL_REQUEST §R2 |
| 10 | Mobile & Touch Support | Responsive drawer sidebar, touch scrolling, touch-safe gutter hit targets, 100dvh layout | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Multi-Tab State Management | Independent tab state (`id, path, originalContent, currentContent, isDirty, language, scrollPosition`) | M3 | ORIGINAL_REQUEST §R3 |
| 12 | Hosting API Save & CRUD Operations | Save file (`PUT /files/content`), create file/folder, rename/move, delete, upload, download, zip/unzip | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Diff Confirmation Dialog | Visual hunk comparison between original and edited content before saving (`POST /files/preview`) | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Unsaved Changes Guard | Confirmation dialog on closing dirty tab or dismissing workspace with unsaved edits | M3 | ORIGINAL_REQUEST §R3 |
| 15 | Viewer Role Read-Only Enforcement | Read-only mode in CodeMirror (`EditorState.readOnly.of(true)`), mutation buttons disabled/hidden | M3 | ORIGINAL_REQUEST §R3 |
| 16 | HostingView UI Integration | Embed `CodeWorkspaceModal` into `app/dashboard/HostingView.tsx` replacing legacy `<textarea>` | M3 | ORIGINAL_REQUEST §R1, R3 |
| 17 | E2E Testing Suite & Full Verification | Comprehensive automated test suite (Tiers 1-4) & adversarial stress testing (Tier 5) | M4 | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Workspace UI Components & Dependencies | Package installation (`@codemirror/*`), UI layout, `FileTree`, `FileTreeNode`, `FileIcon`, `WorkspaceTabBar`, `WorkspaceSidebar`, `WorkspaceStatusBar` | none | DONE |
| M2 | CodeMirror 6 Editor & Language Suite | `CodeEditor.tsx`, NEXORA dark theme, 11+ language loaders, line numbers, folding, search/replace, mobile ergonomics, viewer read-only compartment | M1 | DONE |
| M3 | State Management, Hosting API & Diff Dialog | `useWorkspaceState.ts`, `CodeWorkspaceModal.tsx`, `DiffDialog.tsx`, `UnsavedConfirmDialog.tsx`, file operations (CRUD, upload, download, zip/unzip), `HostingView.tsx` integration | M1, M2 | DONE |
| M4 | E2E Verification & Adversarial Hardening | Run complete E2E test suite (Tiers 1-4) to 100% pass, run Tier 5 adversarial testing, final gate pass | M1, M2, M3 | DONE |

## Interface Contracts

### `WorkspaceTab` Model
```typescript
export interface WorkspaceTab {
  id: string; // unique tab ID (typically normalized file path)
  path: string; // full relative path, e.g. "public/index.php"
  name: string; // file name, e.g. "index.php"
  originalContent: string; // content at load time
  currentContent: string; // edited content
  isDirty: boolean; // originalContent !== currentContent
  language: string; // language identifier, e.g. "php", "typescript"
  scrollPosition?: number;
  cursorPosition?: { line: number; ch: number };
}
```

### `FileTreeNode` Model
```typescript
export interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  updatedAt?: string;
}

export interface TreeNodeData extends FileItem {
  children?: TreeNodeData[];
  isExpanded?: boolean;
  isLoading?: boolean;
  isLoaded?: boolean;
}
```

### `CodeEditorProps` Contract
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

### `CodeWorkspaceModalProps` Contract
```typescript
export interface CodeWorkspaceModalProps {
  site: {
    id: string;
    domain: string;
    accessRole: "owner" | "platform_admin" | "developer" | "viewer";
    status?: string;
  };
  initialFile?: string;
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (message: string, type: "success" | "error" | "info") => void;
}
```

## Code Layout
```
app/
  components/
    code-workspace/
      CodeWorkspaceModal.tsx    # Master container modal for IDE workspace
      WorkspaceSidebar.tsx      # Sidebar container (explorer header, tree, quick actions)
      FileTree.tsx              # Recursive tree manager with lazy loading & keyboard nav
      FileTreeNode.tsx          # Individual tree node item (folder/file with indentation)
      FileIcon.tsx              # Lucide-based color-coded icon mapping per extension
      FileContextMenu.tsx       # Right-click contextual actions menu
      WorkspaceTabBar.tsx       # Scrollable multi-tab strip with dirty dots & close buttons
      WorkspaceTabItem.tsx      # Individual tab button with unsaved indicator
      CodeEditor.tsx            # CodeMirror 6 engine wrapper component
      editor-theme.ts           # NEXORA Obsidian dark theme & Lezer highlight styles
      language-loader.ts        # Dynamic language loader for 11+ languages
      DiffDialog.tsx            # Visual line diff comparison modal before saving
      UnsavedConfirmDialog.tsx  # Confirmation modal when closing dirty tabs
      WorkspaceStatusBar.tsx    # Status footer (path, lang, line/col, role)
      useWorkspaceState.ts      # State management hook for tabs, tree, selection, dialogs
      types.ts                  # Shared TypeScript interfaces & types
  dashboard/
    HostingView.tsx             # Upgraded to render CodeWorkspaceModal
tests/
  e2e/
    code-workspace/
      tier1-feature-coverage.test.mjs    # Tier 1 tests
      tier2-boundary-corner.test.mjs     # Tier 2 tests
      tier3-cross-feature.test.mjs       # Tier 3 tests
      tier4-application-scenarios.test.mjs # Tier 4 tests
      tier5-adversarial.test.mjs         # Tier 5 tests
      runner.mjs                         # Standalone test runner
```
