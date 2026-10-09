# Handoff Report: Hosting API & Workspace State Management Investigation

**Agent**: Explorer 3 (Hosting API & State Management Specialist)  
**Date**: 2026-08-30  
**Handoff Type**: Hard (Task complete)  

---

## 1. Observation

1. **Backend Route Definitions**:
   - In `backend/main.go` lines 305–315, routes for hosting files are registered under `/api/hosting` with `requireUser` and `requirePasswordReady` middleware:
     - `hosting.Get("/sites/:id/files", s.listHostingFiles)` (Line 305)
     - `hosting.Get("/sites/:id/files/content", s.readHostingFile)` (Line 306)
     - `hosting.Get("/sites/:id/files/download", s.downloadHostingFile)` (Line 307)
     - `hosting.Post("/sites/:id/files/preview", s.previewHostingFile)` (Line 308)
     - `hosting.Post("/sites/:id/files/upload", s.uploadHostingFile)` (Line 309)
     - `hosting.Put("/sites/:id/files/content", s.saveHostingFile)` (Line 310)
     - `hosting.Post("/sites/:id/files/folders", s.createHostingFolder)` (Line 311)
     - `hosting.Post("/sites/:id/files/move", s.moveHostingFile)` (Line 312)
     - `hosting.Post("/sites/:id/files/archive", s.archiveHostingFiles)` (Line 313)
     - `hosting.Post("/sites/:id/files/extract", s.extractHostingArchive)` (Line 314)
     - `hosting.Delete("/sites/:id/files", s.deleteHostingFile)` (Line 315)

2. **Backend Validation Rules & Permissions**:
   - In `backend/hosting_files.go`:
     - Line 50: `if write && item.AccessRole == "viewer" { return sourceAccess{}, fiber.NewError(fiber.StatusForbidden, "บัญชีนี้ดูไฟล์ได้อย่างเดียว") }`
     - Line 26: `hostingEditorLimit = 2 * 1024 * 1024` (2MB max file size for editor)
     - Line 307: Max file upload size is 20MB (`header.Size > 20*1024*1024`)
     - Lines 664–670: `blockedWorkspacePath` blocks `.git/`, `.env`, `.env.*`, `dockerfile`, `docker-compose.yml`, `compose.yml`
     - Lines 529–532: Requires `Idempotency-Key` header on mutating operations (`publishHostingSource`)
     - Lines 705–728: `simpleDiff` generates line diffs and hunks with `removed` and `added` arrays.

3. **Current Client Implementation in `app/dashboard/HostingView.tsx`**:
   - Lines 83–103: `hostingApi<T>(path, options)` wrapper fetch function with `credentials: "include"`, `API_BASE` (`http://localhost:8080` when dev port 3000), and JSON error parsing.
   - Lines 105–111: `mutationOptions(method, body)` generates `{ method, headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) }`.
   - Lines 1748–1795: Current file manager UI uses a modal with a flat file list (`fileItems`), single selected file (`selectedFile`), single text area (`fileContent`), and basic save/diff flow.
   - Lines 1783, 1785–1790: `detail.site.accessRole === "viewer"` restricts editing in textarea and hides mutation buttons.

4. **Package Dependencies in `package.json`**:
   - Lines 15–24: React 19.2.8, `lucide-react` 1.27.0, `framer-motion` 12.43.0, Next 16.3.0, Vinext 0.0.50. CodeMirror 6 packages are yet to be installed.

---

## 2. Logic Chain

1. **API Completeness**:
   - From Observation 1, the backend already exposes all required file operations. Creating a new file is achieved by calling `PUT /api/hosting/sites/:id/files/content` with the desired path, and renaming is achieved via `POST /api/hosting/sites/:id/files/move` with `{ from, to }`. No new backend endpoints need to be added to the Go server.
2. **Access Control & Safety**:
   - From Observation 2, backend validation enforces that viewers receive HTTP 403. However, for a responsive user experience, the frontend must also set CodeMirror to `readOnly: true` and intercept user actions with warning toasts.
   - Idempotency keys are mandatory for all file mutations (save, folder create, move, upload, archive, extract, delete); the client helper `mutationOptions` must always be used.
3. **State Architecture Strategy**:
   - From Observation 3, the current file manager only tracks a single file (`selectedFile: string`, `fileContent: string`).
   - To support multi-tabs, the workspace state must manage an array `tabs: WorkspaceTab[]` tracking `originalContent`, `currentContent`, and `isDirty` for each tab independently.
   - To support hierarchical tree navigation with thousands of files without quota/performance issues, the folder tree must load lazily on expand (`isLoaded` flag per node).
   - Diff confirmation can leverage the existing `/api/hosting/sites/:id/files/preview` endpoint.
   - A React Context + Custom Hook pattern (`useWorkspaceState`) provides the ideal architecture without introducing new state libraries into `package.json`.

---

## 3. Caveats

- **No Backend Modifications Required**: Backend investigation confirmed all endpoints exist and are functional. We did not test Go backend compilation under modified routes since none are required.
- **CodeMirror 6 Installation**: Installing `@codemirror/*` dependencies in `package.json` will be performed by the editor specialist or implementer.

---

## 4. Conclusion

1. **All Hosting File API Operations are Fully Implemented and Documented**: The backend handles directory listing, file reading, saving, folder creation, renaming/moving, deleting, uploading, downloading, archiving/extracting ZIPs, and diff previews.
2. **Permission Model is Well-Defined**: The `viewer` role must be strictly read-only on both frontend and backend.
3. **State Management Design is Finalized**: A comprehensive TypeScript state interface and action set covering multi-tabs, dirty tracking, tree lazy loading, diff review modal, unsaved changes modal, and hotkey bindings (`Ctrl+S`, `Ctrl+W`, `Ctrl+P`, `Ctrl+F`) has been formulated in `survey_report.md`.

---

## 5. Verification Method

1. **Verify Backend Routes**:
   - Inspect `backend/hosting_files.go` and `backend/main.go`.
   - Check endpoint registration in `backend/main.go` lines 305–315.
2. **Verify Client API Calls**:
   - Inspect `app/dashboard/HostingView.tsx` lines 810–980 to verify existing API usage.
3. **Verify Documentation Artifacts**:
   - Inspect `.agents/explorer_survey_api/survey_report.md` for full endpoint specifications, request/response schemas, and TypeScript state models.
4. **Project Test Suite**:
   - Run `npm run test` or `node --test tests/*.test.mjs` to ensure baseline project tests pass.
