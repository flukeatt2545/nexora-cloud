# Hosting API & Workspace State Management Survey Report
**Project**: NEXORA Cloud (nkn-v6-new-ui)  
**Target Feature**: VS Code-Style File Explorer & CodeMirror 6 Multi-Tab Workspace  
**Author**: Explorer 3 (Hosting API & State Management Specialist)  
**Date**: 2026-08-30  

---

## 1. Executive Summary

This report provides a comprehensive investigation of the **Hosting Files API backend**, **client fetch patterns**, **access control/role enforcement**, and **multi-tab workspace state management architecture** in the NEXORA Cloud platform.

### Key Discoveries:
1. **Complete Backend Endpoints Already Exist**: The Go Fiber backend (`backend/hosting_files.go`, `backend/main.go`) already implements robust, production-grade endpoints for all required file operations: listing directory contents, reading file content, saving/creating files, creating folders, moving/renaming, deleting, uploading (multipart), downloading binary streams, archiving into ZIP, extracting archives, and diff previewing.
2. **Idempotency & Deployment Pipeline**: All mutating file operations (`PUT`, `POST`, `DELETE`) require an `Idempotency-Key` header and automatically trigger the deployment pipeline (`runtime.redeploy`), generating a new zip archive in object storage (S3/MinIO) and transitioning site status to `provisioning`.
3. **Strict Path & Media Validations**: The backend enforces canonical workspace paths, file count limits (10,000 files), editor file size limits (2MB), upload size limits (20MB), archive extraction limits (2,000 files / 50MB uncompressed), and blocks sensitive paths (`.git/`, `.env*`, `dockerfile`, `docker-compose.yml`, `compose.yml`).
4. **Role Enforcement**: The backend strictly guards write operations via `hostingSourceAccess(c, write=true)` returning HTTP `403 Forbidden` (`"บัญชีนี้ดูไฟล์ได้อย่างเดียว"`) for users with the `viewer` role.
5. **State Management Transformation**: Currently, `app/dashboard/HostingView.tsx` uses a single-file, flat-list dialog. Upgrading to a VS Code-style workspace requires transforming the state model into a modular multi-tab architecture with hierarchical tree state, lazy loading, dirty tracking, diff confirmation modals, quick open (Ctrl+P), and hotkey management.

---

## 2. Current Architecture & Codebase Map

### 2.1 Backend Route Map (`backend/main.go` lines 305–315)
All hosting endpoints are grouped under `/api/hosting` with middleware `sensitiveResponseHeaders`, `requireUser`, and `requirePasswordReady`:

```go
hosting := app.Group("/api/hosting", sensitiveResponseHeaders, s.requireUser, requirePasswordReady)
hosting.Get("/sites/:id/files", s.listHostingFiles)
hosting.Get("/sites/:id/files/content", s.readHostingFile)
hosting.Get("/sites/:id/files/download", s.downloadHostingFile)
hosting.Post("/sites/:id/files/preview", s.previewHostingFile)
hosting.Post("/sites/:id/files/upload", s.uploadHostingFile)
hosting.Put("/sites/:id/files/content", s.saveHostingFile)
hosting.Post("/sites/:id/files/folders", s.createHostingFolder)
hosting.Post("/sites/:id/files/move", s.moveHostingFile)
hosting.Post("/sites/:id/files/archive", s.archiveHostingFiles)
hosting.Post("/sites/:id/files/extract", s.extractHostingArchive)
hosting.Delete("/sites/:id/files", s.deleteHostingFile)
```

### 2.2 Client-Side API Helper Patterns (`app/dashboard/HostingView.tsx` lines 60, 83–111)

```typescript
const API_BASE = typeof window !== "undefined" && window.location.port === "3000" ? "http://localhost:8080" : "";

async function hostingApi<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const isFormData = options?.body instanceof FormData;
    const headers: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
    Object.assign(headers, options?.headers);
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "ไม่สามารถดำเนินการได้");
    return payload as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend (http://localhost:8080) ได้...");
    }
    throw error;
  }
}

function mutationOptions(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
```

---

## 3. Comprehensive Hosting File API Specification

### 3.1 List Files / Directory Tree
- **Method & Path**: `GET /api/hosting/sites/:id/files`
- **Query Parameters**:
  - `path` *(optional, string)*: Directory path relative to workspace root (e.g. `""` or `"src/components"`). Default is `""`.
- **Headers**: Standard session cookies (`credentials: "include"`).
- **Backend Handler**: `s.listHostingFiles` (`backend/hosting_files.go`: 139–196)
- **Response Status**: `200 OK`
- **Response Payload**:
  ```json
  {
    "path": "src",
    "items": [
      {
        "name": "components",
        "path": "src/components",
        "type": "directory",
        "size": 0
      },
      {
        "name": "index.js",
        "path": "src/index.js",
        "type": "file",
        "size": 1420
      }
    ]
  }
  ```
- **Sorting**: Handled by server (directories first, followed by alphabetical order case-insensitive).
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_path"`): Path traverses outside root or blocked.
  - `404 Not Found` (`"ไม่พบเว็บไซต์"`): Invalid site ID or deleted site.
  - `409 Conflict` (`code: "source_missing"`): Site has no source archive deployed yet.

---

### 3.2 Read File Content
- **Method & Path**: `GET /api/hosting/sites/:id/files/content`
- **Query Parameters**:
  - `path` *(required, string)*: File path relative to workspace root (e.g. `"index.php"`).
- **Backend Handler**: `s.readHostingFile` (`backend/hosting_files.go`: 198–219)
- **Response Status**: `200 OK`
- **Response Payload**:
  ```json
  {
    "path": "index.php",
    "content": "<?php\necho 'Hello NEXORA';\n",
    "size": 31
  }
  ```
- **Validation Rules**:
  - File size must be `<= 2MB` (`hostingEditorLimit = 2 * 1024 * 1024`).
  - Content must be valid UTF-8 string with no null bytes (`\x00`).
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_path"`): Invalid path.
  - `404 Not Found` (`code: "file_not_found"`): File does not exist or is a directory.
  - `415 Unsupported Media Type` (`code: "not_editable"`): File is binary or exceeds 2MB limit.

---

### 3.3 Save File Content / Create New File
- **Method & Path**: `PUT /api/hosting/sites/:id/files/content`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID v4>`
- **Request Body**:
  ```json
  {
    "path": "src/app.js",
    "content": "console.log('updated content');\n"
  }
  ```
- **Backend Handler**: `s.saveHostingFile` (`backend/hosting_files.go`: 273–298)
- **Response Status**: `202 Accepted`
- **Response Payload**:
  ```json
  {
    "queued": true
  }
  ```
- **Behavior**:
  - If `path` exists, updates the content.
  - If `path` does not exist, creates the file in the workspace.
  - Packs the updated workspace into a new deployment ZIP, uploads to MinIO/S3, and enqueues a redeployment task.
- **Error Codes**:
  - `400 Bad Request` (`code: "file_too_large"`): Content exceeds 2MB limit.
  - `400 Bad Request` (`code: "invalid_path"`): Target is a blocked or invalid path.
  - `403 Forbidden` (`"บัญชีนี้ดูไฟล์ได้อย่างเดียว"`): User has `viewer` role.
  - `409 Conflict` (`code: "source_missing"`): No initial source archive.

---

### 3.4 Create Folder
- **Method & Path**: `POST /api/hosting/sites/:id/files/folders`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID v4>`
- **Request Body**:
  ```json
  {
    "path": "src/utils"
  }
  ```
- **Backend Handler**: `s.createHostingFolder` (`backend/hosting_files.go`: 332–356)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Error Codes**:
  - `400 Bad Request`: Invalid or blocked path.
  - `403 Forbidden`: `viewer` role.
  - `409 Conflict` (`code: "path_exists"`): Folder or file with that path already exists.

---

### 3.5 Rename / Move File or Folder
- **Method & Path**: `POST /api/hosting/sites/:id/files/move`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID v4>`
- **Request Body**:
  ```json
  {
    "from": "src/old_name.js",
    "to": "src/new_name.js"
  }
  ```
- **Backend Handler**: `s.moveHostingFile` (`backend/hosting_files.go`: 358–397)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Behavior**:
  - Moves/renames a single file or a directory with all its subtrees.
  - Validates that `to` is not a subdirectory of `from`.
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_path"`): Invalid paths or moving parent into its own child.
  - `403 Forbidden`: `viewer` role.
  - `404 Not Found`: Source `from` does not exist.
  - `409 Conflict` (`code: "path_exists"`): Target `to` already exists.

---

### 3.6 Delete File or Folder
- **Method & Path**: `DELETE /api/hosting/sites/:id/files?path=<encoded_path>`
- **Headers**:
  - `Idempotency-Key: <UUID v4>`
- **Query Parameters**:
  - `path` *(required, string)*: File or folder path to delete (e.g. `src/temp.js` or `build`).
- **Backend Handler**: `s.deleteHostingFile` (`backend/hosting_files.go`: 501–525)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Behavior**: Deletes the specified file or recursively deletes the folder and all its child files.
- **Error Codes**:
  - `400 Bad Request`: Path is empty, root, or blocked.
  - `403 Forbidden`: `viewer` role.
  - `404 Not Found`: File or folder does not exist.

---

### 3.7 Upload File
- **Method & Path**: `POST /api/hosting/sites/:id/files/upload`
- **Headers**:
  - `Idempotency-Key: <UUID v4>`
  - `Content-Type: multipart/form-data`
- **FormData Fields**:
  - `file`: File binary (max 20MB).
  - `path`: Target directory path (e.g. `""` for root, or `"public/images"`).
- **Backend Handler**: `s.uploadHostingFile` (`backend/hosting_files.go`: 300–330)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Validation Rules**:
  - File size must be `<= 20MB`.
  - Destination file name is sanitized: `path.Base(header.Filename)`.
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_file"`): File empty or > 20MB.
  - `400 Bad Request` (`code: "invalid_path"`): Invalid or blocked destination path.
  - `403 Forbidden`: `viewer` role.

---

### 3.8 Download File
- **Method & Path**: `GET /api/hosting/sites/:id/files/download?path=<encoded_path>`
- **Query Parameters**:
  - `path` *(required, string)*: File path to download.
- **Backend Handler**: `s.downloadHostingFile` (`backend/hosting_files.go`: 221–241)
- **Response**:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename*=UTF-8''<encoded_filename>`
  - Body: Binary file data.
- **Frontend Usage**: `window.open(`${API_BASE}/api/hosting/sites/${siteId}/files/download?path=${encodeURIComponent(path)}`, '_blank')`
- **Error Codes**: `400 Bad Request`, `404 Not Found`.

---

### 3.9 Archive / Compress to ZIP
- **Method & Path**: `POST /api/hosting/sites/:id/files/archive`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID v4>`
- **Request Body**:
  ```json
  {
    "paths": ["src", "package.json"],
    "target": "backup.zip"
  }
  ```
- **Backend Handler**: `s.archiveHostingFiles` (`backend/hosting_files.go`: 399–440)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Validation Rules**:
  - `paths` array length between 1 and 500 items.
  - `target` must end with `.zip`.
  - Generated archive size limit: 20MB.
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_path"`): Target does not end with `.zip` or invalid paths.
  - `400 Bad Request` (`code: "archive_failed"`): Archive creation exceeded size limits.
  - `403 Forbidden`: `viewer` role.

---

### 3.10 Extract / Unzip Archive
- **Method & Path**: `POST /api/hosting/sites/:id/files/extract`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: <UUID v4>`
- **Request Body**:
  ```json
  {
    "path": "release.zip",
    "target": "dist"
  }
  ```
- **Backend Handler**: `s.extractHostingArchive` (`backend/hosting_files.go`: 442–499)
- **Response Status**: `202 Accepted` (`{ "queued": true }`)
- **Validation Rules**:
  - `path` must end with `.zip`.
  - Max 2,000 files in ZIP.
  - Total extracted uncompressed size <= 50MB.
  - Individual entry content <= 20MB.
  - Security check against zip-slip directory traversal (`canonicalWorkspacePath`).
- **Error Codes**:
  - `400 Bad Request` (`code: "invalid_archive"` / `"unsafe_archive"` / `"archive_too_large"`).
  - `403 Forbidden`: `viewer` role.
  - `404 Not Found`: Archive file does not exist.

---

### 3.11 Diff Preview
- **Method & Path**: `POST /api/hosting/sites/:id/files/preview`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "path": "index.php",
    "content": "<?php\necho 'Hello World Updated';\n"
  }
  ```
- **Backend Handler**: `s.previewHostingFile` (`backend/hosting_files.go`: 243–271, 705–728)
- **Response Status**: `200 OK`
- **Response Payload**:
  ```json
  {
    "changed": true,
    "oldLines": 3,
    "newLines": 3,
    "hunks": [
      {
        "oldStart": 2,
        "newStart": 2,
        "removed": ["echo 'Hello NEXORA';"],
        "added": ["echo 'Hello World Updated';"]
      }
    ]
  }
  ```

---

### 3.12 Backend Validation & Limits Summary Table

| Category | Parameter / Rule | Limit / Behavior | Backend Source Reference |
|---|---|---|---|
| **Max Files in Source** | `hostingFileCountLimit` | 10,000 files | `hosting_files.go:27` |
| **Max Editor File Size** | `hostingEditorLimit` | 2 MB (2,097,152 bytes) | `hosting_files.go:26` |
| **Max Single Upload** | Upload Form Header | 20 MB | `hosting_files.go:307` |
| **Max Archive Extraction** | Zip entries / Total Uncompressed | 2,000 files / 50 MB | `hosting_files.go:469, 485` |
| **Total Source Quota** | Compressed / Uncompressed | 256 MB / 1,024 MB | `hosting_files.go:24, 25` |
| **Blocked Paths** | `blockedWorkspacePath()` | `.git/`, `.env`, `.env.*`, `dockerfile`, `docker-compose.yml`, `compose.yml` | `hosting_files.go:664-670` |
| **Path Traversal Protection** | `canonicalWorkspacePath()` | Resolves `..`, cleans `\`, forbids leading `/`, max 512 chars | `hosting_files.go:635-654` |
| **Idempotency Requirement** | Header `Idempotency-Key` | Required for PUT/POST/DELETE (UUID recommended) | `hosting_files.go:529-532` |

---

## 4. Role & Permission Model (Access Control Matrix)

NEXORA Cloud enforces role-based access at both the **Backend API level** and the **Frontend UI level**:

### 4.1 Role Hierarchy in Hosting
- **`owner`**: Full control over site settings, database, members, files, and deployment.
- **`platform_admin`**: Superuser with complete administrative privileges across all sites.
- **`developer`**: Full code/file editing, upload, deletion, deployment, and database access. Cannot manage members or delete site.
- **`viewer`**: Read-only access. Can inspect file tree, view file contents in editor, and download files.

### 4.2 Permission Matrix

| Operation | `owner` | `platform_admin` | `developer` | `viewer` |
|---|:---:|:---:|:---:|:---:|
| **List Directory Tree** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Read File Content** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Download File** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **View Diff Preview** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Edit in CodeMirror** | ✅ Editable | ✅ Editable | ✅ Editable | 🔒 Read-Only |
| **Save File (`PUT /files/content`)** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |
| **Create Folder / File** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |
| **Rename / Move File** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |
| **Delete File / Folder** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |
| **Upload File** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |
| **Archive / Extract ZIP** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ 403 Forbidden |

### 4.3 Frontend Enforcement Strategy
1. **CodeMirror 6 Read-Only Configuration**:
   - Pass `EditorState.readOnly.of(isReadOnly)` and `EditorView.editable.of(!isReadOnly)` to CodeMirror extensions when `accessRole === 'viewer'`.
2. **UI Action Guarding**:
   - Hide or disable toolbar creation buttons (`+ File`, `+ Folder`, `Upload`, `Save`, `Delete`, `Rename`, `Archive`, `Extract`) when `accessRole === 'viewer'`.
   - Provide a persistent banner/badge in the status bar:  
     `<span className="viewer-readonly-badge"><Lock size={12} /> Read-Only Mode (Viewer)</span>`.
3. **Safe Interception**:
   - If a viewer presses `Ctrl+S`, intercept and notify with an informative toast: `"คุณมีสิทธิ์เข้าชมเท่านั้น ไม่สามารถบันทึกไฟล์ได้"` without making a failing network request.

---

## 5. State Management Architecture for Multi-Tab Workspace

To support VS Code-like multi-tab editing, hierarchical folder tree navigation, diff confirmation before saving, and keyboard shortcuts, the workspace state must be structured cleanly.

### 5.1 Workspace State Model (TypeScript Definitions)

```typescript
export type FileType = "file" | "directory";

export type FileTreeNode = {
  id: string;             // Canonical path (e.g. "src/components/Header.tsx")
  name: string;           // Base filename (e.g. "Header.tsx")
  path: string;           // Full relative path (e.g. "src/components/Header.tsx")
  type: FileType;         // "file" | "directory"
  size?: number;          // Size in bytes (for files)
  children?: FileTreeNode[]; // Subtree items (if directory and loaded)
  isExpanded?: boolean;   // Folder expanded state
  isLoaded?: boolean;     // True if children have been fetched from backend
  isLoading?: boolean;    // Loading indicator for async folder fetch
};

export type WorkspaceTab = {
  id: string;             // Unique identifier (matches canonical file path)
  path: string;           // File path (e.g. "public/index.html")
  name: string;           // Display title (e.g. "index.html")
  originalContent: string;// Pristine content loaded from server
  currentContent: string; // Current user edit state in memory
  isDirty: boolean;       // True when currentContent !== originalContent
  language: string;       // Detected language mode for CodeMirror
  scrollPosition?: { top: number; left: number };
  cursorPosition?: { line: number; ch: number };
  isLoading?: boolean;    // Loading state while fetching content
  error?: string | null;  // Error message if file failed to load
};

export type DiffHunk = {
  oldStart: number;
  newStart: number;
  removed: string[];
  added: string[];
};

export type DiffPreviewData = {
  path: string;
  originalContent: string;
  newContent: string;
  oldLines: number;
  newLines: number;
  hunks: DiffHunk[];
  tabId: string;
};

export type WorkspaceState = {
  siteId: string;
  accessRole: "owner" | "developer" | "viewer" | "platform_admin";
  tree: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  isSaving: boolean;
  quickOpenOpen: boolean;
  diffPreview: DiffPreviewData | null;
  pendingCloseTab: WorkspaceTab | null; // For unsaved confirmation modal
};
```

---

### 5.2 Tree View Hierarchical State & Lazy Loading Engine

Because hosting sites can contain thousands of files across deep folder structures, fetching all files recursively up front can cause latency. Instead, we use a **Hierarchical Lazy-Loading Tree**:

1. **Initial Load**: Fetch `GET /api/hosting/sites/:id/files?path=""`. Populate top-level `tree: FileTreeNode[]`.
2. **Expanding Folder (`onToggleFolder(path)`)**:
   - If folder node `isLoaded` is `true`: Toggle `isExpanded` in `expandedPaths` Set.
   - If `isLoaded` is `false`:
     1. Mark node `isLoading = true`.
     2. Fetch `GET /api/hosting/sites/:id/files?path=${encodeURIComponent(path)}`.
     3. Map returned items into `FileTreeNode[]` children.
     4. Set `node.children = items`, `node.isLoaded = true`, `node.isLoading = false`, `node.isExpanded = true`.
3. **Mutations & Cache Invalidation**:
   - Creating a file/folder inside `parentPath`: Re-fetch `parentPath` children to synchronize node list.
   - Deleting/Moving: Re-fetch parent directory of source and destination.

---

### 5.3 Tab Lifecycle & State Machine

```
               [Click File in Tree / Ctrl+P]
                             |
                   +---------+---------+
                   |                   |
            [Tab already open?]   [Tab not open]
                   |                   |
            Switch activeTabId     Append new tab to tabs[]
                                  (isLoading: true)
                                       |
                                  Fetch content from API
                                       |
                                  Populate original & current content
                                  (isLoading: false)
                                       |
                   +-------------------+
                   |
           [User Edits Code]
                   |
        Update currentContent
        Set isDirty = (current !== original)
                   |
         +---------+---------+
         |                   |
     [Press Save]      [Press Close Tab (X)]
         |                   |
   Open Diff Dialog     +----+----+
   (or Direct Save)     |         |
         |         [isDirty?]  [not isDirty]
    Save via API        |         |
   Set original=current |     Close Tab immediately
   Set isDirty=false    |
                        v
              Show Unsaved Dialog:
              - "Save & Close" -> Save then remove tab
              - "Don't Save"   -> Discard & remove tab
              - "Cancel"       -> Keep tab open
```

---

### 5.4 Diff Dialog & Save Confirmation Design

Before publishing file changes and triggering a backend redeployment, users can review differences via the **Diff Dialog**:

#### Flow:
1. User clicks **"ดู Diff และบันทึก"** (or presses `Ctrl+S`).
2. If `tab.currentContent === tab.originalContent`: Toast `"ไม่มีการเปลี่ยนแปลง"`.
3. If dirty:
   - Call `POST /api/hosting/sites/:id/files/preview` with `{ path: tab.path, content: tab.currentContent }`.
   - Backend returns line counts and hunks with removed/added lines.
   - Render `DiffDialog` modal showing:
     - Side-by-side or unified colored diff lines (Red for `- removed`, Green for `+ added`).
     - Line counts: `+X added, -Y removed`.
     - Deploy warning: `"การบันทึกจะทำให้ระบบทำการ Deploy เวอร์ชันใหม่"`.
     - Actions:
       - **"ยืนยันและ Deploy (Save)"** (Primary Green) -> Executes `PUT /api/hosting/sites/:id/files/content`.
       - **"แก้ไขต่อ (Back to Editor)"** (Secondary) -> Closes Diff Dialog.
       - **"ยกเลิกการแก้ไข (Revert)"** (Danger) -> Resets `currentContent` to `originalContent`.

---

### 5.5 Unsaved Changes Confirmation Dialog Flow

When a user tries to close a tab that has unsaved changes:
1. Intercept tab close action (`closeTab(tabId)`).
2. Find tab. If `!tab.isDirty`: Remove tab from `tabs[]` immediately.
3. If `tab.isDirty`:
   - Set `pendingCloseTab = tab`.
   - Render `UnsavedChangesModal`:
     - **Title**: `"บันทึกการเปลี่ยนแปลงใน ${tab.name} หรือไม่?"`
     - **Description**: `"หากปิดโดยไม่บันทึก การเปลี่ยนแปลงล่าสุดของคุณจะสูญหาย"`
     - **Button 1 (Save)**: Save file to backend -> On success, remove tab.
     - **Button 2 (Don't Save)**: Discard changes -> Remove tab immediately.
     - **Button 3 (Cancel)**: Set `pendingCloseTab = null` -> Keep tab active.

---

### 5.6 Keyboard Shortcuts & Hotkey Handler Architecture

A global keyboard listener attached to the workspace container intercepts standard editor hotkeys with `event.preventDefault()`:

| Hotkey | Action | Behavior & Edge Cases |
|---|---|---|
| **Ctrl + S** / **Cmd + S** | Save Active File | Intercept browser save page. If viewer: show read-only toast. If dirty: open Diff dialog or execute save. |
| **Ctrl + W** / **Cmd + W** | Close Active Tab | Intercept browser tab close. Check dirty state. If dirty: trigger Unsaved Modal. |
| **Ctrl + P** / **Cmd + P** | Quick Open Modal | Intercept browser print page. Open fuzzy search palette across all known project files. |
| **Ctrl + F** / **Cmd + F** | Find & Replace | Triggers CodeMirror 6 standard search panel (`openSearchPanel(editorView)`). |
| **Ctrl + Shift + S** | Save All | Iterate over all open dirty tabs and sequentially/batch save. |
| **Ctrl + Tab** | Next Tab | Switch focus to next tab index in `tabs[]`. |
| **Ctrl + Shift + Tab** | Previous Tab | Switch focus to previous tab index in `tabs[]`. |
| **Escape** | Dismiss Modals | Closes Quick Open, Diff Dialog, or Unsaved Dialog without affecting open editor. |

---

### 5.7 Quick Open (Ctrl+P) Architecture

1. **Trigger**: `Ctrl+P` opens `QuickOpenModal`.
2. **File Indexing**:
   - Collects all file paths from the loaded tree + flat search list.
   - Real-time search filter as user types query (matching fuzzy characters, case-insensitive).
3. **Keyboard Navigation**:
   - `ArrowDown` / `ArrowUp` to navigate list items.
   - `Enter` to open selected file into a tab and close Quick Open modal.
   - `Escape` to close Quick Open.

---

### 5.8 Recommended State Architecture: Context + Custom Hook vs Zustand

We evaluated two architectural patterns for state management:

#### Option A: React Context + Custom Hook (`useWorkspaceState`) (Recommended)
- **Why**: Zero additional dependencies (React 19 built-in `useReducer` / `useState` + `useContext`). Seamlessly integrates with Next.js/Vinext client components without bundle overhead.
- **Encapsulation**:
  - `WorkspaceContext.tsx` provides state and dispatch methods.
  - Sub-components (`FileTreeSidebar`, `TabBar`, `CodeEditorPanel`, `DiffDialog`, `QuickOpenModal`) consume specific selectors to avoid unnecessary re-renders.

#### Option B: Zustand Store
- Lightweight, but requires adding `zustand` to `package.json`.
- Not strictly necessary given the scope of the workspace component tree.

---

## 6. Proposed Modular Code Structure

To maintain clean code separation and maintainability, the workspace should be organized under `app/components/code-workspace/`:

```
app/components/code-workspace/
├── types.ts                   # All TypeScript interfaces (WorkspaceTab, FileTreeNode, DiffHunk, etc.)
├── fileService.ts             # Typed API client wrapper for all /api/hosting/sites/:id/files endpoints
├── useWorkspaceState.ts       # Central state management hook (tabs, tree, dirty checks, operations)
├── WorkspaceContext.tsx       # React Context Provider for the workspace
├── CodeWorkspaceModal.tsx     # Top-level full-screen modal container
├── FileTreeSidebar.tsx        # Left sidebar with hierarchical folder tree, search & quick actions
├── FileTreeItem.tsx           # Recursive folder/file tree node component with file icons
├── TabBar.tsx                 # VS Code style top tab bar with active tab & dirty dot indicators
├── CodeEditorPanel.tsx        # CodeMirror 6 editor wrapper with syntax highlighting & search panel
├── DiffDialog.tsx             # Diff review & confirm deployment modal
├── QuickOpenModal.tsx         # Ctrl+P quick file search palette
├── UnsavedChangesModal.tsx    # Dirty tab close confirmation dialog
├── WorkspaceStatusBar.tsx     # Bottom status bar (Line, Col, Encoding, Language, Viewer badge)
└── languageDetector.ts        # Maps file extensions (.php, .js, .ts, .json, .html, .css, etc.) to CodeMirror language packages
```

---

## 7. Actionable Implementation Plan for Engineers

1. **Step 1: Create `types.ts` & `fileService.ts`**:
   - Define exact API request/response types.
   - Implement typed wrapper functions utilizing `API_BASE` and `Idempotency-Key` headers.
2. **Step 2: Implement `useWorkspaceState.ts` & `WorkspaceContext.tsx`**:
   - Implement tab management (open, close, dirty tracking, active switch).
   - Implement hierarchical file tree with recursive toggle and lazy loading.
   - Implement hotkey listeners (`Ctrl+S`, `Ctrl+W`, `Ctrl+P`, `Ctrl+F`).
3. **Step 3: Implement CodeMirror 6 Editor (`CodeEditorPanel.tsx`)**:
   - Integrate CodeMirror 6 with dynamic language extensions for PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML.
   - Configure line numbers, active line highlight, search panel (`@codemirror/search`), and read-only mode for viewers.
4. **Step 4: Implement Sidebar & Tree (`FileTreeSidebar.tsx`, `FileTreeItem.tsx`)**:
   - Recursive rendering with collapsible folders.
   - Action toolbar: New File, New Folder, Upload, Refresh.
   - Item actions: Rename, Delete, Download, ZIP.
5. **Step 5: Implement Dialogs (`DiffDialog.tsx`, `UnsavedChangesModal.tsx`, `QuickOpenModal.tsx`)**:
   - Diff preview integration with backend `/api/hosting/sites/:id/files/preview`.
   - Prompt on close dirty tab.
   - Ctrl+P quick open modal.
6. **Step 6: Integrate into `app/dashboard/HostingView.tsx`**:
   - Replace the legacy single-file textarea modal with `<CodeWorkspaceModal site={detail.site} onClose={...} />`.
   - Verify viewer permissions, hotkeys, and deployment reloading.

---

## 8. Conclusion

The existing backend in `backend/hosting_files.go` is fully equipped to support the VS Code-style File Explorer & Code Editor. The proposed state management and API integration architecture provides a robust, responsive, and secure implementation that respects role permissions and delivers a modern IDE experience in NEXORA Cloud.
