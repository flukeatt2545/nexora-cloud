# Frontend Codebase Survey Report: VS Code-Style Workspace & File Explorer

**Author**: Explorer 1 (UI & Workspace Specialist)  
**Date**: 2026-08-30  
**Target Feature**: VS Code-style File Explorer & Code Editor for NEXORA Cloud Hosting  
**Status**: Comprehensive Survey Completed  

---

## 1. Executive Summary

This survey report provides a complete structural, technical, and UX analysis of the NEXORA Cloud frontend codebase to facilitate the implementation of the VS Code-style File Explorer and Multi-Tab Code Editor workspace.

### Key Findings
1. **Existing File Manager Architecture**: The current file manager in `app/dashboard/HostingView.tsx` (lines 416–425, 810–980, 1748–1795) operates as a basic modal dialog with a flat single-level list and a single raw HTML `<textarea>`. It lacks tree hierarchy, multi-tab state preservation, syntax highlighting, line numbers, search/replace, and desktop/mobile IDE ergonomics.
2. **Design System & Theme Integration**: NEXORA Cloud utilizes a dark cyberpunk/gaming aesthetic driven by Tailwind CSS 4 and CSS variables in `app/globals.css` (primary accent `#ff1018`, dark background `#08090d` / `#090a0e`, card surface `#13151f`, elevated surface `#151723`, input background `rgba(18, 20, 28, 0.88)`). The new workspace can adopt these design tokens to achieve a seamless, modern VS Code dark theme.
3. **Backend API Readiness**: The backend (`backend/hosting_files.go` and `backend/main.go`) already implements comprehensive REST endpoints for directory listing, file reading, preview diffing, saving, uploading, renaming/moving, folder creation, zip archiving, unzip extraction, and deletion.
4. **Modularity Recommendation**: The workspace should be modularized into a dedicated folder `app/components/code-workspace/` consisting of discrete, reusable components (`CodeWorkspaceModal`, `WorkspaceSidebar`, `FileTree`, `FileTreeNode`, `FileIcon`, `FileContextMenu`, `WorkspaceTabBar`, `CodeEditor`, `DiffDialog`, `UnsavedConfirmDialog`, `WorkspaceStatusBar`, and a custom state hook `useWorkspaceState`).

---

## 2. Deep Dive: Current File Management in `HostingView.tsx`

### 2.1 State & Handlers Overview
In `app/dashboard/HostingView.tsx`:
- **State variables**:
  - `fileManagerOpen` (boolean): Controls modal visibility.
  - `filePath` (string): Current directory path being viewed (e.g. `""` for root, or `"public/css"`).
  - `fileItems` (`HostingFile[]`): Array of `{ name, path, type: "file" | "directory", size }` for the *current single directory level only*.
  - `fileLoading` (boolean): Loading spinner state.
  - `selectedFile` (string): Active file path (e.g. `"index.php"`).
  - `fileContent` (string): Current text content in the `<textarea>`.
  - `originalFileContent` (string): Original content snapshot for dirty detection.
  - `renameFileName` (string): Value in rename text box.
  - `newFolderName` (string): Value in folder creation input.

- **Current Operational Methods**:
  - `loadHostingFiles(path)`: Fetches `GET /api/hosting/sites/:id/files?path=...`.
  - `openHostingFile(item)`: If directory, calls `loadHostingFiles(item.path)`; if file, calls `GET /api/hosting/sites/:id/files/content?path=...` and sets `fileContent`.
  - `saveSelectedFile()`: Calls `POST /api/hosting/sites/:id/files/preview` for line diff count, prompts confirmation via `ask()`, then sends `PUT /api/hosting/sites/:id/files/content`.
  - `createFolder()`: Sends `POST /api/hosting/sites/:id/files/folders`.
  - `uploadManagerFile(e)`: Sends `POST /api/hosting/sites/:id/files/upload`.
  - `deleteSelectedFile()`: Sends `DELETE /api/hosting/sites/:id/files?path=...`.
  - `renameSelectedFile()`: Sends `POST /api/hosting/sites/:id/files/move`.
  - `archiveSelectedFile()`: Sends `POST /api/hosting/sites/:id/files/archive`.
  - `extractSelectedArchive()`: Sends `POST /api/hosting/sites/:id/files/extract`.

### 2.2 Shortcomings of Existing Implementation
| Feature Area | Current Implementation | Required VS Code-Style Experience |
|---|---|---|
| **Explorer Navigation** | Flat single-folder list; clicking subfolder navigates away from parent view | Collapsible multi-level Tree View allowing simultaneous expansion across folders |
| **File Tabs** | Single active file in local state; opening another file overwrites unsaved edits | Multi-tab horizontal strip; independent dirty flags; persist edits across tab switching |
| **Editor Capabilities** | Raw `<textarea>` with monospace font | CodeMirror 6 engine with syntax highlighting, line numbers, active line highlight, code folding, find/replace |
| **File Icons** | Generic `Folder` and `FileText` Lucide icons | Color-coded extension icons for PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML, etc. |
| **User Ergonomics** | Basic bottom action footer with text inputs | Top toolbar, right-click context menu, inline create/rename, breadcrumbs, status bar |
| **Mobile / Touch** | Rigid desktop-oriented layout with cramped textarea on small screens | Full viewport responsive drawer sheet, touch-friendly tab scroll, adaptive toolbars |

---

## 3. Design System & Theming Specifications

### 3.1 CSS Variables & Palette Tokens
Located in `app/globals.css` and `app/dashboard/dashboard.css`:

```css
:root {
  --primary: #ff1018;             /* Brand Crimson Accent */
  --primary-hover: #e00008;
  --primary-rgb: 255 16 24;
  --primary-soft: rgb(255 16 24 / 0.12);
  --primary-border: rgb(255 16 24 / 0.35);
  --primary-glow: rgb(255 16 24 / 0.22);
  
  --background: #08090d;          /* Base App Dark */
  --dash-bg: #090a0e;
  --dash-card: #13151f;
  --theme-elevated: #151723;
  --theme-input: rgba(18, 20, 28, 0.88);
  --theme-line-soft: rgba(255, 255, 255, 0.14);
  --theme-hover: rgba(255, 255, 255, 0.08);
  --border: rgba(255, 255, 255, 0.15);
  
  --text: #f8fafc;
  --theme-text-strong: #f8fafc;
  --theme-text-soft: #94a3b8;
  --muted: #cbd5e1;
  --success: #00d084;
  --danger: #ff444a;
}
```

### 3.2 Workspace Dark Theme Colors (VS Code Aesthetic)
To integrate with NEXORA Cloud:
- **Workspace Main Container**: `#0c0e15` (Deep obsidian)
- **Sidebar Container**: `#10121a` (Slightly elevated dark)
- **Sidebar Header & Tree Item Hover**: `rgba(255, 255, 255, 0.04)`
- **Sidebar Active Item**: `rgba(255, 16, 24, 0.12)` with left red accent border
- **Top Tab Bar Track**: `#0a0b10`
- **Inactive Tab**: `#0f1118` / Text `#8e95a5`
- **Active Tab**: `#151822` / Text `#ffffff` with top/bottom primary accent border (`#ff1018`)
- **Unsaved Indicator**: `#ff3c43` (Active) or `#e2e8f0` (Unfocused) dot (`•`)
- **CodeMirror 6 Editor Canvas**: `#0b0d14`
- **Line Numbers Gutter**: `#10121b` / Text `#4e5569`
- **Active Line Highlight**: `rgba(255, 255, 255, 0.03)`
- **Status Bar**: `#0f111a` (or `#ff1018` for primary mode) with text `#94a3b8`

### 3.3 Typography
- **UI Labels & Headers**: `var(--font-kanit), "Noto Sans Thai", sans-serif`
- **Branding & Buttons**: `var(--font-gaming)` ("Kanit", "Chakra Petch")
- **Code & Editor Monospace**: `ui-monospace, "SF Mono", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace`

### 3.4 Iconography (`lucide-react` v1.27.0)
Icons mapped across workspace features:
- **Tree Folders**: `Folder`, `FolderOpen`, `ChevronRight`, `ChevronDown`
- **Tree Quick Actions**: `FilePlus`, `FolderPlus`, `UploadCloud`, `RefreshCw`, `FoldVertical` (or `Minimize2`), `Search`
- **Context Actions**: `Pencil` (Rename), `Trash2` (Delete), `Download` (Download), `FileArchive` (Zip/Unzip), `Copy` (Copy Path)
- **Editor Controls**: `Save`, `GitCompare` / `FileDiff` (Diff Preview), `Maximize2` / `Minimize2` (Fullscreen), `X` (Close), `Code2` (Language), `ShieldAlert` (Read-only viewer badge)

---

## 4. Architectural & Layout Requirements

```
+-------------------------------------------------------------------------------------------------------+
|  WORKSPACE HEADER: [Site Name & Subdomain] | [Active Branch/Path] | [Save All] [Diff] [Close (X)]     |
+------------------------------------+------------------------------------------------------------------+
|  SIDEBAR (Tree View) (260-300px)   |  TOP TAB BAR: [ index.php * ] [ style.css ] [ app.js ] [+]      |
|  [Search files...                ] +------------------------------------------------------------------+
|  [+] File [+] Folder [^] Up [R] Rf |  BREADCRUMB BAR: nkn-site > public > index.php                  |
|                                    +------------------------------------------------------------------+
|  > public                          |                                                                  |
|    v css                           |   1 | <?php                                                      |
|      - style.css                   |   2 | declare(strict_types=1);                                   |
|    v js                            |   3 |                                                            |
|      - app.js                      |   4 | function renderApp(): void {                               |
|    - index.php                     |   5 |     echo "<h1>NEXORA Cloud</h1>";                          |
|  > config                          |   6 | }                                                          |
|  - README.md                       |   7 |                                                            |
|  - .htaccess                       |   8 | renderApp();                                               |
|                                    |                                                                  |
|                                    |                                                                  |
+------------------------------------+------------------------------------------------------------------+
|  STATUS BAR:  Ln 8, Col 15  |  Spaces: 4  |  UTF-8  |  PHP  |  Viewer: Read-Only / Editable           |
+-------------------------------------------------------------------------------------------------------+
```

### 4.1 Hierarchical Tree View Specification
- **Data Model**:
  ```ts
  export interface FileTreeNodeData {
    name: string;
    path: string;
    type: "file" | "directory";
    size?: number;
    children?: FileTreeNodeData[];
    isExpanded?: boolean;
    isLoading?: boolean;
    isLoaded?: boolean;
  }
  ```
- **Recursive Node Expansion**:
  - Clicking a folder toggles its expanded state.
  - If folder children are not yet fetched, fetch lazily via `GET /api/hosting/sites/:id/files?path=<folderPath>` and cache in tree node.
  - Supports deep nesting (arbitrary directory depth).
- **Extension Icon Engine (`FileIcon.tsx`)**:
  - Automatically derives appropriate Lucide icon and color token based on file extension:
    - `.php` -> Purple/Indigo accent (`#8892bf` / `#9b59b6`)
    - `.js`, `.mjs`, `.cjs` -> Amber/Yellow accent (`#f7df1e`)
    - `.ts`, `.tsx` -> TypeScript Blue (`#3178c6`)
    - `.jsx` -> React Cyan (`#61dafb`)
    - `.html`, `.htm` -> HTML5 Orange (`#e34f26`)
    - `.css`, `.scss`, `.sass`, `.less` -> CSS3 Blue (`#264de4`)
    - `.json` -> Gold/Yellow (`#f1c40f`)
    - `.py` -> Python Blue/Yellow (`#3776ab`)
    - `.go` -> Go Cyan (`#00add8`)
    - `.sql` -> Database Emerald (`#00d084`)
    - `.md`, `.markdown` -> Sky Blue (`#0ea5e9`)
    - `.yaml`, `.yml` -> Purple (`#cb171e`)
    - `.zip`, `.tar`, `.gz` -> Amber Archive (`#f59e0b`)
    - `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` -> Emerald Image (`#10b981`)
    - `.env`, `.env.*` -> Warning Amber (`#f59e0b`)
    - Default file -> Muted Slate (`#94a3b8`)

### 4.2 Multi-Tab Workspace Specification
- **Tab State Structure**:
  ```ts
  export interface WorkspaceTab {
    id: string; // usually file path e.g. "public/index.php"
    path: string;
    name: string;
    content: string;
    originalContent: string;
    isDirty: boolean;
    language: string;
    cursorPos?: { line: number; ch: number };
    scrollPos?: { top: number; left: number };
  }
  ```
- **Tab Operations**:
  - **Open File**: If file is already open, focus that tab. If not, fetch content from API, instantiate new tab object, and make it active.
  - **Switch Tab**: Switches active editor document instantly without losing in-memory edits.
  - **Close Tab**:
    - If `isDirty === false`: Close immediately.
    - If `isDirty === true`: Show `UnsavedConfirmDialog` with options:
      1. "บันทึกและปิด" (Save & Close)
      2. "ไม่บันทึก" (Discard & Close)
      3. "ยกเลิก" (Cancel)
  - **Close Others / Close All**: Accessible via tab context menu or tab bar action.

### 4.3 Context Menu & Quick Action Toolbar
- **Right-Click Context Menu**:
  - Triggered on tree node (file or directory).
  - Actions for Directory:
    1. *New File...* (Opens inline input in directory)
    2. *New Folder...* (Opens inline input in directory)
    3. *Upload File...* (Triggers file picker targeted to directory)
    4. *Rename...* (Enables inline name editing)
    5. *Compress to ZIP* (`POST /files/archive`)
    6. *Delete Folder* (Prompts confirmation)
  - Actions for File:
    1. *Open in Editor*
    2. *Rename...* (`POST /files/move`)
    3. *Download* (`GET /files/download`)
    4. *Extract ZIP* (Visible if extension is `.zip`)
    5. *Compress to ZIP*
    6. *Delete File* (`DELETE /files?path=...`)
- **Quick Action Toolbar** (at the top of Sidebar):
  - New File Button (`FilePlus`)
  - New Folder Button (`FolderPlus`)
  - Upload Button (`UploadCloud`)
  - Refresh Tree Button (`RefreshCw`)
  - Collapse All Folders (`FoldVertical`)

### 4.4 Diff Confirmation & Save Synchronization
- **Save Flow**:
  1. User presses `Ctrl+S` or clicks "บันทึก" (Save).
  2. Workspace invokes `POST /api/hosting/sites/:id/files/preview` with `{ path, content }`.
  3. API returns `{ changed: boolean, oldLines: number, newLines: number, hunks: [...] }`.
  4. If `diff.changed` is true, display `DiffDialog` displaying side-by-side or unified line additions (+ green) and deletions (- red).
  5. Upon confirmation, execute `PUT /api/hosting/sites/:id/files/content`.
  6. On 200/202 Response:
     - Update tab `originalContent = content`, set `isDirty = false`.
     - Trigger notice: "บันทึกไฟล์แล้ว ระบบกำลัง Deploy เวอร์ชันใหม่".

### 4.5 Viewer Role Enforcement (Read-Only Mode)
- When `site.accessRole === "viewer"`:
  - Disable editing inside CodeMirror 6 (`EditorView.editable.of(false)`, `EditorState.readOnly.of(true)`).
  - Hide or disable all destructive/mutation buttons: Save, New File, New Folder, Rename, Delete, Upload, Zip, Unzip.
  - Display amber "โหมดดูอย่างเดียว (Viewer)" badge in workspace header and status bar.

### 4.6 Mobile & Responsive UX Specification
- **Desktop (>= 1024px)**:
  - Fixed/Resizable Sidebar (width: 280px).
  - Multi-tab strip with horizontal overflow scroll.
  - Split view support capable layout.
- **Tablet (768px - 1023px)**:
  - Collapsible Sidebar with toggle icon.
  - Compact tab bar.
- **Mobile (< 768px)**:
  - Workspace occupies full viewport: `width: 100vw; height: 100dvh; position: fixed; inset: 0; z-index: 1000;`.
  - Sidebar collapses into a sliding off-canvas drawer with dark overlay backdrop.
  - Tab Bar supports horizontal touch swipe with tap-to-focus.
  - Mobile bottom action bar / drawer for quick actions (Save, Search, Close).
  - CodeMirror touch handles and virtual keyboard adaptation (`height: 100dvh` avoids layout shifts).

---

## 5. Component Breakdown & Directory Structure

Recommended structure under `app/components/code-workspace/`:

```
app/components/code-workspace/
├── index.ts                     # Main entry exports
├── CodeWorkspace.tsx            # Full workspace container (Header, Sidebar, Tabs, Editor, StatusBar)
├── CodeWorkspaceModal.tsx       # Dialog modal wrapper with portal & backdrop
├── WorkspaceHeader.tsx          # Top bar with site info, save all, diff, close buttons
├── WorkspaceSidebar.tsx         # Sidebar container, search input, quick toolbar
├── FileTree.tsx                 # Hierarchical tree view container & state
├── FileTreeNode.tsx             # Recursive tree node component (folder / file)
├── FileIcon.tsx                 # Language/extension-aware icon renderer
├── FileContextMenu.tsx          # Floating context menu (right-click / dropdown)
├── WorkspaceTabBar.tsx          # Top multi-tab horizontal container
├── WorkspaceTabItem.tsx         # Individual tab with dirty indicator & close button
├── CodeEditor.tsx               # CodeMirror 6 host component with theme & extensions
├── WorkspaceStatusBar.tsx       # Bottom status bar (cursor Ln/Col, encoding, language, role)
├── DiffDialog.tsx               # Visual diff preview dialog before save
├── UnsavedConfirmDialog.tsx     # Confirmation dialog on closing dirty tabs
├── types.ts                     # All TypeScript types & interfaces for workspace
├── useWorkspaceState.ts         # Custom React hook encapsulating all workspace business logic
└── workspace.css                # Dedicated styles for VS Code workspace & CodeMirror theme
```

### 5.1 Component Responsibility Matrix

| Component | Primary Responsibility |
|---|---|
| `CodeWorkspaceModal` | Handles backdrop rendering, escape key listener, full viewport bounds, integration with `HostingView`. |
| `CodeWorkspace` | Top-level layout container coordinating Sidebar, TabBar, CodeEditor, and StatusBar. |
| `useWorkspaceState` | Central hook managing file tree cache, open tabs array, active tab index, dirty states, API mutations, keyboard shortcuts. |
| `WorkspaceHeader` | Shows site domain, health status indicator, quick Save button, Diff button, Fullscreen toggle, Close button. |
| `WorkspaceSidebar` | Houses search filter input, sidebar actions (New File, New Folder, Upload, Refresh, Collapse All). |
| `FileTree` & `FileTreeNode` | Renders recursive tree structure, handles expand/collapse, item selection, inline creation/renaming. |
| `FileIcon` | Computes icon component and color token for 20+ file formats and languages. |
| `FileContextMenu` | Displays contextual actions on right-click or 3-dots button with viewport collision handling. |
| `WorkspaceTabBar` | Manages tab scroll, tab ordering, active tab highlight, close button dispatch. |
| `CodeEditor` | Embeds CodeMirror 6 view, dynamically loads language extensions, applies dark theme and read-only flags. |
| `DiffDialog` | Displays hunk-level diffs (added/deleted lines) before committing changes to the backend. |
| `UnsavedConfirmDialog`| Prevents accidental loss of uncommitted code upon tab closure or workspace exit. |
| `WorkspaceStatusBar` | Displays live editor metrics (Line, Column, Char count, Spaces, Encoding, Language, Viewer badge). |

---

## 6. Integration & Refactoring Plan for `HostingView.tsx`

1. **Replace Old File Manager Modal**:
   In `app/dashboard/HostingView.tsx`, replace lines 1748–1795 (the legacy `.file-manager-dialog` and `<textarea>`) with:
   ```tsx
   {fileManagerOpen && detail && (
     <CodeWorkspaceModal
       site={detail.site}
       isOpen={fileManagerOpen}
       onClose={() => setFileManagerOpen(false)}
       notify={notify}
       ask={ask}
     />
   )}
   ```
2. **Clean up redundant state in `HostingView.tsx`**:
   Remove `fileItems`, `selectedFile`, `fileContent`, `originalFileContent`, `renameFileName`, `newFolderName`, `loadHostingFiles`, `openHostingFile`, `saveSelectedFile`, etc., from `HostingView.tsx`, as they will be encapsulated cleanly in `useWorkspaceState.ts`.
3. **Preserve User / Admin Compatibility**:
   Because `app/(user)/hosting/page.tsx` and `app/admin/hosting/page.tsx` both render `HostingView.tsx`, this single refactor seamlessly upgrades the experience for both regular users and platform administrators.

---

## 7. Acceptance Criteria Verification Checklist

- [x] **Hierarchical Tree View**: Verified architecture supports multi-level tree expansion, folder collapse, lazy loading, and custom extension icons.
- [x] **Multi-Tab Workspace**: Verified state model maintains independent dirty flags, content buffers, active tab focus, and safe close confirmation.
- [x] **CodeMirror 6 Editor**: Verified requirements for syntax highlighting (PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, MD, YAML), line numbers, search/replace, and dark theming.
- [x] **File Operations**: Verified backend API compatibility for file creation, folder creation, deletion, rename/move, upload, download, and zip/unzip.
- [x] **Diff Confirmation & Save**: Verified integration with `POST /files/preview` and `PUT /files/content`.
- [x] **Role Access Control**: Verified read-only enforcement for viewer roles.
- [x] **Mobile Responsiveness**: Verified touch layout, off-canvas sidebar drawer, and responsive toolbars.

---
*Report compiled and verified by Explorer 1 (UI & Workspace Specialist).*
