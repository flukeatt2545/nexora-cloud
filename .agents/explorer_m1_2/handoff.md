# Handoff Report: Milestone 1 File Tree Interactions, Context Menu & Accessibility

**Agent**: Explorer 2 (Milestone 1 - File Tree Navigation, Accessibility & Context Menu Specialist)  
**Date**: 2026-08-30  
**Status**: COMPLETE (Hard Handoff)  
**Target Files**:
- `app/components/code-workspace/FileContextMenu.tsx`
- `app/components/code-workspace/FileTree.tsx` & `FileTreeNode.tsx` interaction & keyboard logic
- `app/components/code-workspace/useWorkspaceState.ts` tree state transitions & inline editing

---

## 1. Observation

1. **Current File Management Implementation in `HostingView.tsx`**:
   - `app/dashboard/HostingView.tsx` lines 810–856 & 1748–1795: File manager utilizes a flat single-level list (`fileItems: HostingFile[]`) without recursive tree hierarchy, without multi-tab support, and without right-click contextual actions.
   - Line 1770–1774: Files and folders are rendered as simple `<button>` elements in an `<aside>` list:
     ```tsx
     {!fileLoading && fileItems.map((item) => <button key={item.path} className={selectedFile === item.path ? "active" : ""} onClick={() => openHostingFile(item)}>
       {item.type === "directory" ? <Folder size={17} /> : <FileText size={17} />}
       <span><strong>{item.name}</strong><small>{item.type === "directory" ? "โฟลเดอร์" : `${Math.max(1, Math.ceil(item.size / 1024))} KB`}</small></span>
     ```
   - No `role="tree"`, `role="treeitem"`, `aria-expanded`, or keyboard navigation (arrow keys, roving tabindex) exists in the legacy implementation.

2. **Backend API Endpoints in `backend/hosting_files.go`**:
   - Lines 139–196 (`GET /api/hosting/sites/:id/files?path=`): Directory listings return sorted `{ path, items: [{ name, path, type, size }] }`.
   - Lines 198–219 (`GET /api/hosting/sites/:id/files/content?path=`): Reads file text content.
   - Lines 273–298 (`PUT /api/hosting/sites/:id/files/content`): Creates new file or updates existing file content.
   - Lines 332–356 (`POST /api/hosting/sites/:id/files/folders`): Creates directory.
   - Lines 358–397 (`POST /api/hosting/sites/:id/files/move`): Renames/moves file or directory subtree.
   - Lines 399–440 (`POST /api/hosting/sites/:id/files/archive`): Archives file/folder into ZIP.
   - Lines 442–499 (`POST /api/hosting/sites/:id/files/extract`): Extracts ZIP archive.
   - Lines 501–525 (`DELETE /api/hosting/sites/:id/files?path=`): Deletes file or directory recursively.
   - Lines 55–60: `hostingSourceAccess(c, write=true)` rejects write mutations with `403 Forbidden` (`"บัญชีนี้ดูไฟล์ได้อย่างเดียว"`) for users with the `viewer` role.

3. **Master Architecture & Sibling Scopes (`.agents/PROJECT.md` & `explorer_m1_1/DISPATCH.md`)**:
   - `PROJECT.md` lines 120–140: Defines file layout under `app/components/code-workspace/`.
   - `FileContextMenu.tsx` is designated as the right-click contextual actions menu component.
   - Multi-tab and tree data models require strict separation of loaded vs expanded paths.

---

## 2. Logic Chain

1. **Context Menu Architecture & Positioning**:
   - *From Observation 1 & 2*: Context menu requires 10 distinct actions (New File, New Folder, Open, Download, Rename, Copy Relative Path, Copy File Name, Extract ZIP, Compress ZIP, Delete).
   - *From Observation 2*: When `accessRole === "viewer"`, mutating actions must be disabled or omitted, while read actions (Open, Download, Copy Path) remain functional.
   - *Deduction*: Render `FileContextMenu` into a DOM portal (`document.body`) using `createPortal` with `position: fixed; z-index: 99999;` to eliminate any clipping from container `overflow: hidden`.
   - Apply boundary clamping: if `x + 220px > window.innerWidth`, clamp leftward; if `y + 280px > window.innerHeight`, clamp upward.

2. **Hierarchical Tree State Transitions & Lazy Loading**:
   - *From Observation 2*: The backend lists one directory level at a time. Sites can contain thousands of files across deep subtrees.
   - *Deduction*: State must track 3 sets:
     - `expandedPaths: Set<string>`: Folders currently unfolded.
     - `loadedPaths: Set<string>`: Folders whose children have already been fetched and cached.
     - `loadingPaths: Set<string>`: In-flight fetch requests.
   - State transition: Expanding an already-loaded path is an instant client-side state update (`expandedPaths.add(path)`), avoiding redundant API requests. Expanding an unloaded path triggers `loadingPaths.add(path)`, fetches children, updates tree immutably, and adds to both `loadedPaths` and `expandedPaths`.
   - Invalidation: Mutating operations (create, rename, delete, extract) invalidate the parent directory in `loadedPaths` and trigger a silent re-fetch.

3. **In-line File/Folder Creation & Renaming UX**:
   - *From Observation 1*: The old UI required clumsy bottom textboxes for folder creation and renaming.
   - *Deduction*: Implement a VS Code-style inline input directly inside the tree node:
     - For creation: Inject a draft node at the target directory's child list, auto-expand parent directory, auto-focus `<input>`.
     - For renaming: Replace label with `<input>`. Use `useLayoutEffect` to automatically select only the filename stem (e.g. `App` in `App.tsx`), excluding extension.
     - Keymap: `Enter` validates and commits; `Escape` cancels and discards draft/restores label; `Blur` commits if valid.
     - Sanitization: Rejects illegal characters `\ / : * ? " < > |`, blocked paths (`.git`, `.env*`), and sibling duplicates.

4. **WAI-ARIA Tree View Pattern & Keyboard Accessibility**:
   - *From Observation 1*: Legacy UI had zero ARIA roles.
   - *Deduction*: Comply with WAI-ARIA 1.2 Tree View:
     - Container: `role="tree"`, `aria-label="File Explorer"`.
     - Folders/Files: `role="treeitem"`, `aria-expanded={isExpanded}`, `aria-selected={isSelected}`, `aria-level={depth}`, `aria-posinset`, `aria-setsize`.
     - Groups: `role="group"`.
   - Linearize visible nodes via `getFlattenedVisibleNodes(tree, expandedPaths)` to enable intuitive keyboard controls:
     - `ArrowDown` / `ArrowUp`: Next/previous visible node.
     - `ArrowRight`: Expand closed folder / enter first child of open folder.
     - `ArrowLeft`: Collapse open folder / jump to parent folder.
     - `Enter`: Open file / toggle folder.
     - `F2`: Trigger inline rename.
     - `Delete`: Trigger delete modal.
     - `Shift + F10`: Open context menu at node coordinates.
     - Type-ahead: Jump to next node starting with pressed character key.
     - Roving `tabindex`: Active node has `tabIndex={0}`, all others have `tabIndex={-1}`.

---

## 3. Caveats

- **No Caveats**: The investigation has covered all four target mission areas comprehensively.
- *Assumptions*: Backend server URL is resolved via `API_BASE` (matching `app/dashboard/HostingView.tsx` lines 60 & 83).
- *Cross-Milestone Notes*: Mutation operations triggered from context menu or inline edits rely on `fileService.ts` / `useWorkspaceState.ts` implemented in Milestone 3, but the component interfaces, event contracts, and keyboard listeners are fully specified and ready for implementation.

---

## 4. Conclusion

1. `FileContextMenu.tsx` is completely specified with full TypeScript contracts, role awareness (`viewer` vs `developer`/`owner`), action divider groupings, viewport collision detection, portal mounting, and keyboard trapping.
2. The tree hierarchy state engine utilizes `expandedPaths`, `loadedPaths`, and `loadingPaths` sets with immutable tree updater helpers to guarantee optimal performance, instant cached expansions, and proper cache invalidation.
3. Inline creation and renaming provide a true VS Code-level UX with smart stem text selection, `Enter`/`Escape` handling, and character sanitization.
4. ARIA 1.2 Tree View accessibility and keyboard navigation standard (roving tabindex, flattened visible traversal, type-ahead) are fully defined and ready for immediate engineering in Milestone 1.

---

## 5. Verification Method

To independently verify these specifications:
1. Inspect the detailed implementation plan in `.agents/explorer_m1_2/plan.md`.
2. Inspect the component interface contracts and helper algorithms in `plan.md` sections 2, 3, 4, 5, and 6.
3. Validate keyboard shortcuts and ARIA role mappings against the W3C WAI-ARIA Authoring Practices Guide (APG) for Tree View.
4. Execute the upcoming test runner when components are built:
   - `node tests/e2e/code-workspace/tier1-feature-coverage.test.mjs`
   - `npm run test`
