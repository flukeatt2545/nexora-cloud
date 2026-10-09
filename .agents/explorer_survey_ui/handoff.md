# Handoff Report: UI & Workspace Architecture Survey (Explorer 1)

## 1. Observation
- **Original Requirement**: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md` specifies a VS Code-style File Explorer & Code Editor in NEXORA Cloud Hosting with hierarchical collapsible/expandable Tree View, multi-tab workspace with unsaved indicators, CodeMirror 6 syntax highlighting, mobile-responsive layout, and Hosting API integration.
- **Current File Manager**: Located in `app/dashboard/HostingView.tsx`:
  - Lines 416–425: State hooks `fileManagerOpen`, `filePath`, `fileItems`, `fileLoading`, `selectedFile`, `fileContent`, `originalFileContent`, `renameFileName`, `newFolderName`.
  - Lines 810–980: File operations handlers (`loadHostingFiles`, `openHostingFile`, `saveSelectedFile`, `createFolder`, `uploadManagerFile`, `deleteSelectedFile`, `renameSelectedFile`, `archiveSelectedFile`, `extractSelectedArchive`).
  - Lines 1748–1795: Markup for modal `.file-manager-backdrop` and `.file-manager-dialog` using a single-level flat list in `aside` and a raw HTML `<textarea>` in `main`.
- **Backend API Endpoints**: Verified in `backend/hosting_files.go` (lines 139–582) and `backend/main.go` (lines 305–315):
  - `GET /api/hosting/sites/:id/files?path=...` -> Directory contents `{ path, items: [{name, path, type, size}] }`
  - `GET /api/hosting/sites/:id/files/content?path=...` -> File text `{ path, content, size }`
  - `POST /api/hosting/sites/:id/files/preview` -> Line diff calculation `{ changed, oldLines, newLines, hunks }`
  - `PUT /api/hosting/sites/:id/files/content` -> Save file content & trigger deployment
  - `POST /api/hosting/sites/:id/files/folders` -> Create directory
  - `POST /api/hosting/sites/:id/files/upload` -> Multipart upload
  - `POST /api/hosting/sites/:id/files/move` -> Rename/move
  - `POST /api/hosting/sites/:id/files/archive` -> Compress to `.zip`
  - `POST /api/hosting/sites/:id/files/extract` -> Unzip archive
  - `DELETE /api/hosting/sites/:id/files?path=...` -> Delete file/folder
- **Design System Tokens**: Observed in `app/globals.css` (lines 96–127) and `app/dashboard/dashboard.css` (lines 1–16):
  - `--primary: #ff1018`, `--primary-hover: #e00008`, `--primary-rgb: 255 16 24`
  - `--dash-bg: #090a0e`, `--dash-card: #13151f`, `--theme-elevated: #151723`, `--theme-input: rgba(18, 20, 28, .88)`
  - Fonts: `--font-kanit`, `--font-gaming`, code monospace stack.
  - Icons: `lucide-react` (v1.27.0).
- **Pages**: `app/(user)/hosting/page.tsx` (line 4) and `app/admin/hosting/page.tsx` (line 4) both render `HostingView.tsx`.

## 2. Logic Chain
1. *From observations in `HostingView.tsx`*: The current file manager mixes UI rendering and state management directly inside an already massive file (1,799 lines). The raw `<textarea>` cannot provide multi-tab state, syntax highlighting, line numbers, or code folding.
2. *From backend API analysis*: All required file CRUD and diff capabilities are already supported and verified in `backend/hosting_files.go`. `PUT /api/hosting/sites/:id/files/content` seamlessly supports both creating new files and saving existing ones.
3. *From design system inspection*: The application's dark obsidian/crimson theme matches standard modern code editors. A cohesive VS Code dark theme can be achieved by utilizing existing CSS tokens and standard CodeMirror 6 extension APIs.
4. *From workspace layout requirements*: A modular architecture placed in `app/components/code-workspace/` will cleanly decouple state (`useWorkspaceState.ts`), tree rendering (`FileTree.tsx`, `FileTreeNode.tsx`, `FileIcon.tsx`), tab management (`WorkspaceTabBar.tsx`, `WorkspaceTabItem.tsx`), editor hosting (`CodeEditor.tsx`), and dialogs (`DiffDialog.tsx`, `UnsavedConfirmDialog.tsx`).
5. *From consumer page analysis*: Refactoring `HostingView.tsx` to render `<CodeWorkspaceModal />` will instantly upgrade both User and Admin hosting interfaces without modifying route handlers.

## 3. Caveats
- **CodeMirror 6 package installations**: Node packages `@codemirror/*` (e.g. `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, and language extensions) must be installed during implementation. Explorer 2 (`explorer_survey_codemirror`) is surveying these package dependencies.
- **Tree Depth & Lazy Loading**: For repositories with hundreds of nested directories, lazy-loading subdirectories on expand via `GET /files?path=...` is recommended rather than recursive pre-fetching.
- **Binary/Large Files**: Files over 2MB or containing binary data are rejected by the backend (`hostingEditorLimit = 2MB`, `StatusUnsupportedMediaType`); the UI must show an informative fallback message with a download button.

## 4. Conclusion
- The frontend codebase is in an ideal state to replace the legacy `<textarea>` file manager with a full-fledged, VS Code-style workspace.
- The component architecture should be structured under `app/components/code-workspace/` with 15 focused files.
- `HostingView.tsx` will be simplified by delegating all file management to `<CodeWorkspaceModal site={detail.site} ... />`.
- Complete survey report and detailed technical specifications are written to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_ui\survey_report.md`.

## 5. Verification Method
1. **Inspection**:
   - Verify `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_ui\survey_report.md` exists and contains the full component breakdown, design tokens, and layout schemas.
   - Inspect `app/dashboard/HostingView.tsx` lines 1748–1795 to verify the legacy file manager modal markup.
   - Inspect `backend/hosting_files.go` to confirm endpoint signatures.
2. **Build and Test Verification Command**:
   ```bash
   npm run build
   ```
   (No production source code changes were made during this read-only exploration phase.)
