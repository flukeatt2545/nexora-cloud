# Milestone 1: File Tree Interactions, Context Menu & Accessibility Plan

**Author**: Explorer 2 (File Tree Navigation, Accessibility & Context Menu Specialist)  
**Milestone**: M1 (Workspace UI Components, Tree & Dependencies)  
**Date**: 2026-08-30  
**Target Scope**:
1. `app/components/code-workspace/FileContextMenu.tsx` (Floating Context Menu)
2. Hierarchical Tree State Transitions & Lazy Loading Engine
3. In-line File/Folder Creation & Renaming UX State Machine
4. WAI-ARIA Tree View Pattern & Keyboard Navigation Standard

---

## 1. Executive Summary & Design Principles

This document specifies the interaction architecture, state machine models, event flow, accessibility conformance, and component interfaces for the VS Code-style File Tree Explorer in NEXORA Cloud.

### Core Architecture Highlights:
- **Zero Layout Shifts & Clipping Immunity**: The context menu renders into a DOM portal (`document.body`) with intelligent 2D boundary clamping to prevent viewport overflow.
- **Hierarchical Lazy-Loading State Machine**: Distinct sets for `expandedPaths`, `loadedPaths`, and `loadingPaths` enable instant cached re-expansions without redundant network roundtrips.
- **Inline Editing State Machine**: Provides a fluid VS Code-like inline input for file/folder creation and renaming with automatic stem-selection (excluding file extension) and validation.
- **Strict WAI-ARIA 1.2 Tree Compliance**: Employs roving `tabindex`, flattened visible-node indexing for seamless `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Home`/`End` navigation, type-ahead character jumping, and full screen reader accessibility.

---

## 2. Component Specification: `FileContextMenu.tsx`

### 2.1 Interface Contract & Props

```typescript
import { TreeNodeData } from "./types";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface FileContextMenuProps {
  /** Target node clicked. If null, represents the workspace root / empty sidebar space */
  item: TreeNodeData | null;
  /** Viewport coordinates (clientX, clientY) */
  position: ContextMenuPosition;
  /** Visibility flag */
  isOpen: boolean;
  /** Dismiss callback */
  onClose: () => void;
  /** User access role for authorization filtering */
  accessRole: "owner" | "developer" | "viewer" | "platform_admin";
  /** Action handlers */
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onOpenInEditor?: (item: TreeNodeData) => void;
  onRename?: (item: TreeNodeData) => void;
  onDelete?: (item: TreeNodeData) => void;
  onDownload?: (item: TreeNodeData) => void;
  onCopyPath?: (path: string) => void;
  onCopyRelativePath?: (path: string) => void;
  onArchive?: (item: TreeNodeData) => void;
  onExtract?: (item: TreeNodeData) => void;
  onRefresh?: (folderPath?: string) => void;
}
```

### 2.2 Action Groups, Icons & Role Matrix

The context menu is partitioned into 5 logical groups separated by horizontal dividers (`hr` or border lines):

| Group | Action Item | Icon (`lucide-react`) | Shortcut Hint | Target Availability | Viewer Role (`read-only`) |
|---|---|---|---|---|---|
| **Group 1: Create** | New File... | `FilePlus` (`15px`) | — | Folders & Root | 🔒 Disabled / Hidden |
| | New Folder... | `FolderPlus` (`15px`) | — | Folders & Root | 🔒 Disabled / Hidden |
| **Group 2: Primary** | Open in Editor | `FileCode` (`15px`) | `Enter` | Files only | ✅ Enabled |
| | Download | `Download` (`15px`) | — | Files only | ✅ Enabled |
| **Group 3: Edit/Copy** | Rename... | `Pencil` (`15px`) | `F2` | Files & Folders | 🔒 Disabled / Hidden |
| | Copy Relative Path | `Copy` (`15px`) | `Alt+Shift+C` | Files & Folders | ✅ Enabled |
| | Copy File Name | `FileText` (`15px`) | — | Files & Folders | ✅ Enabled |
| **Group 4: Archive** | Extract ZIP | `FileArchive` (`15px`) | — | `.zip` Files only | 🔒 Disabled / Hidden |
| | Compress to ZIP | `FileArchive` (`15px`) | — | Files & Folders | 🔒 Disabled / Hidden |
| **Group 5: Delete** | Delete | `Trash2` (`15px`, Red) | `Del` | Files & Folders | 🔒 Disabled / Hidden |

### 2.3 Viewport Collision Clamping Algorithm

To ensure the context menu is never rendered off-screen (e.g. when right-clicking near bottom or right screen edges):

```typescript
// Calculation inside FileContextMenu.tsx
const MENU_WIDTH = 220;
const MENU_ESTIMATED_HEIGHT = 280;
const EDGE_PADDING = 8;

const calculatePosition = (pos: ContextMenuPosition): { top: number; left: number } => {
  if (typeof window === "undefined") return { top: pos.y, left: pos.x };

  let left = pos.x;
  let top = pos.y;

  // Horizontal collision check
  if (left + MENU_WIDTH > window.innerWidth - EDGE_PADDING) {
    left = Math.max(EDGE_PADDING, window.innerWidth - MENU_WIDTH - EDGE_PADDING);
  }

  // Vertical collision check
  if (top + MENU_ESTIMATED_HEIGHT > window.innerHeight - EDGE_PADDING) {
    top = Math.max(EDGE_PADDING, window.innerHeight - MENU_ESTIMATED_HEIGHT - EDGE_PADDING);
  }

  return { top, left };
};
```

### 2.4 Portal Rendering & Dismissal Handlers

1. **Portal Mounting**: Context menu is rendered using `createPortal(<div className="workspace-context-menu">...</div>, document.body)` with `position: fixed; z-index: 99999;`.
2. **Click-Outside Detection**: Attaches a `mousedown` listener to `window`:
   ```typescript
   useEffect(() => {
     if (!isOpen) return;
     const handleMouseDown = (e: MouseEvent) => {
       if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
         onClose();
       }
     };
     const handleKeyDown = (e: KeyboardEvent) => {
       if (e.key === "Escape") onClose();
     };
     window.addEventListener("mousedown", handleMouseDown, { capture: true });
     window.addEventListener("keydown", handleKeyDown);
     return () => {
       window.removeEventListener("mousedown", handleMouseDown, { capture: true });
       window.removeEventListener("keydown", handleKeyDown);
     };
   }, [isOpen, onClose]);
   ```
3. **Keyboard Roving in Menu**:
   - `ArrowDown` / `ArrowUp`: Cycles focus between active menu item buttons.
   - `Enter` / `Space`: Triggers focused menu action and closes menu.
   - `Escape`: Closes menu and returns focus to the tree node.

---

## 3. Tree Hierarchy State Transitions & Lazy Loading

### 3.1 State Tracking Architecture

The file tree state is governed by three primary Sets in `useWorkspaceState.ts`:

```typescript
export interface TreeHierarchyState {
  /** Complete nested hierarchy */
  tree: TreeNodeData[];
  /** Paths of directories currently unfolded */
  expandedPaths: Set<string>;
  /** Paths of directories whose children have been fetched from the server */
  loadedPaths: Set<string>;
  /** Paths of directories with an in-flight API request */
  loadingPaths: Set<string>;
  /** Selected node path (highlighted) */
  selectedPath: string | null;
  /** Active roving keyboard focus node path */
  focusedPath: string | null;
}
```

### 3.2 State Transition Matrix for Folder Expansion

```
+-----------------------------------------------------------------------------------------------+
| User clicks Folder Node (or presses ArrowRight / Enter)                                      |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
                              +-----------------------------------+
                              | Is path in `expandedPaths`?       |
                              +-----------------------------------+
                                     /                     \
                             [YES]  /                       \ [NO]
                                   /                         \
                                  v                           v
              +----------------------------+    +----------------------------+
              | User wants to COLLAPSE     |    | User wants to EXPAND       |
              | 1. Remove from `expanded`  |    +----------------------------+
              | 2. Keep `loaded` intact    |                  |
              | 3. Instant collapse!       |                  v
              +----------------------------+    +----------------------------+
                                                | Is path in `loadedPaths`?  |
                                                +----------------------------+
                                                       /              \
                                               [YES]  /                \ [NO]
                                                     /                  \
                                                    v                    v
                                   +-----------------------+   +-----------------------+
                                   | CACHED SUBTREE        |   | LAZY FETCH REQUIRED   |
                                   | 1. Add to `expanded`  |   | 1. Add to `loading`   |
                                   | 2. Instant render!    |   | 2. Call API           |
                                   +-----------------------+   +-----------------------+
                                                                           |
                                                                           v
                                                         +-----------------------------------+
                                                         | GET /api/hosting/sites/:id/files  |
                                                         |      ?path=${encodedPath}         |
                                                         +-----------------------------------+
                                                                   /               \
                                                       [SUCCESS]  /                 \ [ERROR]
                                                                 /                   \
                                                                v                     v
                                            +---------------------------+   +--------------------+
                                            | 1. Insert children nodes  |   | 1. Remove from     |
                                            | 2. Add to `loadedPaths`   |   |    `loadingPaths`  |
                                            | 3. Add to `expandedPaths` |   | 2. Notify error    |
                                            | 4. Remove from `loading`  |   | 3. Keep collapsed  |
                                            +---------------------------+   +--------------------+
```

### 3.3 Tree Invariant & Immutability Utilities

To maintain tree sorting and immutability across deep nesting:

```typescript
/** Invariant: Directories first, then alphabetical (case-insensitive) */
export function sortTreeNodes(items: TreeNodeData[]): TreeNodeData[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/** Recursively update a specific node in immutable tree */
export function updateNodeInTree(
  nodes: TreeNodeData[],
  targetPath: string,
  updater: (node: TreeNodeData) => TreeNodeData
): TreeNodeData[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (node.children && targetPath.startsWith(node.path + "/")) {
      return {
        ...node,
        children: updateNodeInTree(node.children, targetPath, updater),
      };
    }
    return node;
  });
}

/** Recursively insert children into a parent directory */
export function insertChildrenIntoTree(
  nodes: TreeNodeData[],
  parentPath: string,
  children: TreeNodeData[]
): TreeNodeData[] {
  if (parentPath === "") {
    return sortTreeNodes(children);
  }
  return nodes.map((node) => {
    if (node.path === parentPath) {
      return {
        ...node,
        children: sortTreeNodes(children),
        isLoaded: true,
        isLoading: false,
      };
    }
    if (node.children && parentPath.startsWith(node.path + "/")) {
      return {
        ...node,
        children: insertChildrenIntoTree(node.children, parentPath, children),
      };
    }
    return node;
  });
}
```

### 3.4 Mutation Cache Invalidation

When mutations occur (create, rename, delete, unzip):
1. **Targeted Directory Invalidation**:
   - Extract `parentPath = path.split('/').slice(0, -1).join('/')`.
   - Remove `parentPath` from `loadedPaths`.
   - Re-fetch `GET /api/hosting/sites/:id/files?path=${encodeURIComponent(parentPath)}` and update tree.
2. **Subtree Path Re-indexing on Rename**:
   - When folder `oldPath` is renamed to `newPath`:
     - Update all open tabs whose `tab.path.startsWith(oldPath + "/")` to use `newPath`.
     - Update `expandedPaths` and `loadedPaths` entries matching `oldPath`.

---

## 4. In-line File/Folder Creation & Renaming UX

### 4.1 Inline Edit State Machine

```typescript
export type InlineEditMode =
  | { type: "idle" }
  | {
      type: "create-file";
      parentPath: string; // Directory where file will be created ("" for root)
      depth: number;
    }
  | {
      type: "create-folder";
      parentPath: string;
      depth: number;
    }
  | {
      type: "rename";
      target: TreeNodeData;
      depth: number;
    };
```

### 4.2 Inline Creation Flow

1. **Trigger**: User clicks "+ File" / "+ Folder" in sidebar or right-clicks a folder and chooses "New File...".
2. **Parent Resolution**:
   - If right-clicked a folder `src/components`: `parentPath = "src/components"`.
   - If toolbar clicked with a folder selected: `parentPath = selectedFolder.path`.
   - If toolbar clicked with a file selected: `parentPath = file.parentPath`.
   - If nothing selected: `parentPath = ""`.
3. **Auto-Expand Parent**:
   - If `parentPath` is not in `expandedPaths`, add it to `expandedPaths`.
   - If `parentPath` is not in `loadedPaths`, lazy-fetch children first.
4. **Draft Node Injection**:
   - Render a temporary row with indentation `(depth + 1) * 16px`.
   - Render icon (`FilePlus` or `FolderPlus`).
   - Render `<input>` with auto-focus and placeholder:
     - For file: `"e.g. index.ts"`
     - For folder: `"e.g. components"`

### 4.3 Inline Renaming & Smart Stem-Selection

1. **Trigger**: User presses `F2`, clicks "Rename" in context menu, or double-clicks filename (with delay).
2. **Smart Stem-Selection (`useLayoutEffect`)**:
   - When the `<input>` mounts for renaming:
     ```typescript
     const inputRef = useRef<HTMLInputElement>(null);
     useLayoutEffect(() => {
       if (!inputRef.current) return;
       inputRef.current.focus();
       const filename = target.name;
       const lastDot = filename.lastIndexOf(".");
       // If file has an extension and is not a hidden file like .htaccess or .env
       if (target.type === "file" && lastDot > 0) {
         inputRef.current.setSelectionRange(0, lastDot);
       } else {
         inputRef.current.select();
       }
     }, [target]);
     ```
3. **Key Handlers**:
   - `Enter`: Validates input name.
     - If empty or unchanged: exit edit mode.
     - If invalid characters: display inline tooltip `"ชื่อไฟล์มีอักขระที่ไม่ถูกต้อง: \\ / : * ? \" < > |"`.
     - If sibling duplicate: display inline tooltip `"มีไฟล์หรือโฟลเดอร์ชื่อนี้อยู่แล้ว"`.
     - If valid: call `saveHostingFile` (new file), `createHostingFolder` (new folder), or `moveHostingFile` (rename).
   - `Escape`: Cancel edit mode immediately, discard draft node, restore original name.
   - `Blur`: Execute commit if non-empty and valid; cancel if empty.

### 4.4 Name Sanitization Rules
- Reject illegal characters: `/[\\/:*?"<>|]/`
- Reject path traversal: `..`
- Reject blocked filenames: `.git`, `.env*`, `dockerfile`, `docker-compose.yml`
- Max length: 80 characters.

---

## 5. Accessibility (ARIA 1.2) & Keyboard Navigation Standard

### 5.1 WAI-ARIA Tree View Structure

```html
<!-- Tree Container -->
<div
  role="tree"
  aria-label="File Explorer"
  aria-multiselectable="false"
  tabindex="0"
  class="workspace-file-tree"
>
  <!-- Root Level Node (Folder) -->
  <div
    role="treeitem"
    aria-expanded="true"
    aria-selected="false"
    aria-level="1"
    aria-setsize="3"
    aria-posinset="1"
    tabindex="0" <!-- Roving tabindex -->
    class="tree-node-item is-expanded"
  >
    <button class="tree-chevron"><ChevronDown size={14} /></button>
    <span class="tree-icon"><FolderOpen size={16} /></span>
    <span class="tree-label">src</span>
  </div>

  <!-- Subtree Group -->
  <div role="group" aria-label="src" class="tree-node-group">
    <!-- Level 2 Node (File) -->
    <div
      role="treeitem"
      aria-selected="true"
      aria-level="2"
      aria-setsize="2"
      aria-posinset="1"
      tabindex="-1"
      class="tree-node-item is-selected"
    >
      <span class="tree-indent" style="width: 16px" />
      <span class="tree-icon"><FileCode size={16} /></span>
      <span class="tree-label">app.ts</span>
    </div>
  </div>
</div>
```

### 5.2 Flattened Visible Node Indexing for Linear Keyboard Navigation

To allow smooth `ArrowUp` and `ArrowDown` navigation across multi-level nested trees:

```typescript
export interface FlatVisibleNode {
  node: TreeNodeData;
  depth: number;
  parentPath: string;
  indexInParent: number;
  siblingCount: number;
}

export function getFlattenedVisibleNodes(
  tree: TreeNodeData[],
  expandedPaths: Set<string>,
  depth = 0,
  parentPath = ""
): FlatVisibleNode[] {
  const result: FlatVisibleNode[] = [];
  const count = tree.length;

  for (let i = 0; i < count; i++) {
    const node = tree[i];
    result.push({
      node,
      depth,
      parentPath,
      indexInParent: i + 1,
      siblingCount: count,
    });

    if (node.type === "directory" && expandedPaths.has(node.path) && node.children) {
      const childFlat = getFlattenedVisibleNodes(
        node.children,
        expandedPaths,
        depth + 1,
        node.path
      );
      result.push(...childFlat);
    }
  }

  return result;
}
```

### 5.3 Comprehensive Keyboard Navigation Matrix

| Key | Context | Action & State Transition |
|---|---|---|
| **ArrowDown** | On node at index `i` | Move focus to `visibleNodes[i + 1]`. If at end, stay at end. |
| **ArrowUp** | On node at index `i` | Move focus to `visibleNodes[i - 1]`. If at start, stay at start. |
| **ArrowRight** | On collapsed folder | Expand folder (trigger lazy load if needed). Focus stays on folder. |
| | On expanded folder | Move focus to first child (`visibleNodes[i + 1]`). |
| | On file | No-op. |
| **ArrowLeft** | On expanded folder | Collapse folder. |
| | On collapsed folder | Move focus to parent folder. |
| | On file | Move focus to parent folder. |
| **Enter** | On folder | Toggle expand/collapse. |
| | On file | Open file into active editor tab. |
| **Space** | On folder | Toggle expand/collapse. |
| | On file | Select file / open file. |
| **Home** | Any node | Jump focus to `visibleNodes[0]` (first root node). |
| **End** | Any node | Jump focus to `visibleNodes[visibleNodes.length - 1]`. |
| **F2** | Any node | Enter inline rename mode for focused node. |
| **Delete** | Any node | Trigger delete confirmation dialog. |
| **Shift + F10** / **Apps** | Any node | Open context menu anchored to focused node position. |
| **Alphanumeric (a-z, 0-9)** | Any node | **Type-ahead**: search next visible node whose name starts with typed character (case-insensitive) and move focus. |

### 5.4 Roving TabIndex Discipline

- The tree container maintains `focusedPath: string | null`.
- Only the currently focused node has `tabIndex={0}`.
- All other nodes have `tabIndex={-1}`.
- When keyboard navigation changes `focusedPath`, the component programmatically calls `element.focus()`.
- When the user presses `Tab`, focus moves completely out of the tree to the TabBar/Editor, bypassing all other tree items in a single keystroke.

---

## 6. Full Code Implementation Blueprints

### 6.1 `app/components/code-workspace/FileContextMenu.tsx`

```tsx
"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FilePlus,
  FolderPlus,
  FileCode,
  Download,
  Pencil,
  Copy,
  FileText,
  FileArchive,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { TreeNodeData } from "./types";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface FileContextMenuProps {
  item: TreeNodeData | null;
  position: ContextMenuPosition;
  isOpen: boolean;
  onClose: () => void;
  accessRole: "owner" | "developer" | "viewer" | "platform_admin";
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onOpenInEditor?: (item: TreeNodeData) => void;
  onRename?: (item: TreeNodeData) => void;
  onDelete?: (item: TreeNodeData) => void;
  onDownload?: (item: TreeNodeData) => void;
  onCopyPath?: (path: string) => void;
  onArchive?: (item: TreeNodeData) => void;
  onExtract?: (item: TreeNodeData) => void;
  onRefresh?: (folderPath?: string) => void;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  item,
  position,
  isOpen,
  onClose,
  accessRole,
  onNewFile,
  onNewFolder,
  onOpenInEditor,
  onRename,
  onDelete,
  onDownload,
  onCopyPath,
  onArchive,
  onExtract,
  onRefresh,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: position.y, left: position.x });

  const isReadOnly = accessRole === "viewer";
  const isDirectory = item?.type === "directory" || item === null;
  const isZip = item?.type === "file" && item.name.toLowerCase().endsWith(".zip");
  const parentPath = item ? (item.type === "directory" ? item.path : item.path.split("/").slice(0, -1).join("/")) : "";

  // Viewport clamping
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 8;
    let left = position.x;
    let top = position.y;

    if (left + rect.width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - rect.width - padding);
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = Math.max(padding, window.innerHeight - rect.height - padding);
    }
    setCoords({ top, left });
    menuRef.current.focus();
  }, [isOpen, position]);

  // Click outside & Escape dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleMouseDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="File contextual actions"
      className="workspace-context-menu"
      style={{
        position: "fixed",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 99999,
      }}
    >
      {/* Group 1: Creation */}
      {isDirectory && !isReadOnly && (
        <>
          <button
            role="menuitem"
            onClick={() => {
              onNewFile?.(parentPath);
              onClose();
            }}
          >
            <FilePlus size={15} />
            <span>สร้างไฟล์ใหม่</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              onNewFolder?.(parentPath);
              onClose();
            }}
          >
            <FolderPlus size={15} />
            <span>สร้างโฟลเดอร์ใหม่</span>
          </button>
          <div className="menu-divider" />
        </>
      )}

      {/* Group 2: File Actions */}
      {item && item.type === "file" && (
        <>
          <button
            role="menuitem"
            onClick={() => {
              onOpenInEditor?.(item);
              onClose();
            }}
          >
            <FileCode size={15} />
            <span>เปิดใน Editor</span>
            <kbd>Enter</kbd>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              onDownload?.(item);
              onClose();
            }}
          >
            <Download size={15} />
            <span>ดาวน์โหลด</span>
          </button>
          <div className="menu-divider" />
        </>
      )}

      {/* Group 3: Modifications */}
      {item && (
        <>
          {!isReadOnly && (
            <button
              role="menuitem"
              onClick={() => {
                onRename?.(item);
                onClose();
              }}
            >
              <Pencil size={15} />
              <span>เปลี่ยนชื่อ</span>
              <kbd>F2</kbd>
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              onCopyPath?.(item.path);
              onClose();
            }}
          >
            <Copy size={15} />
            <span>คัดลอก Path</span>
          </button>
          <div className="menu-divider" />
        </>
      )}

      {/* Group 4: Archives */}
      {!isReadOnly && (
        <>
          {isZip && (
            <button
              role="menuitem"
              onClick={() => {
                item && onExtract?.(item);
                onClose();
              }}
            >
              <FileArchive size={15} />
              <span>แตกไฟล์ ZIP</span>
            </button>
          )}
          {item && !isZip && (
            <button
              role="menuitem"
              onClick={() => {
                onArchive?.(item);
                onClose();
              }}
            >
              <FileArchive size={15} />
              <span>บีบอัดเป็น ZIP</span>
            </button>
          )}
          <div className="menu-divider" />
        </>
      )}

      {/* Group 5: Refresh */}
      <button
        role="menuitem"
        onClick={() => {
          onRefresh?.(isDirectory ? parentPath : undefined);
          onClose();
        }}
      >
        <RefreshCw size={15} />
        <span>รีเฟรชโฟลเดอร์</span>
      </button>

      {/* Group 6: Deletion */}
      {item && !isReadOnly && (
        <>
          <div className="menu-divider" />
          <button
            role="menuitem"
            className="text-danger"
            onClick={() => {
              onDelete?.(item);
              onClose();
            }}
          >
            <Trash2 size={15} />
            <span>ลบ{item.type === "directory" ? "โฟลเดอร์" : "ไฟล์"}</span>
            <kbd>Del</kbd>
          </button>
        </>
      )}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : null;
};
```

---

## 7. Verification Method

To verify the tree interactions, accessibility, and context menu:
1. **Keyboard Accessibility Test**:
   - Focus tree container using `Tab`.
   - Traverse up and down with `ArrowUp` / `ArrowDown`. Verify selection moves across visible nodes and skips collapsed folders.
   - Press `ArrowRight` on closed folder: verify folder expands and children load lazily.
   - Press `ArrowLeft` on open folder: verify folder collapses.
   - Press `Enter` on file: verify file opens in tab bar.
   - Press `F2` on node: verify inline input activates with filename stem pre-selected.
   - Press `Shift+F10` on node: verify context menu opens adjacent to node.
2. **Context Menu Viewport Boundary Test**:
   - Right-click bottom-right corner of tree sidebar: verify context menu flips upwards and leftwards without extending beyond viewport.
3. **Role Enforcement Test**:
   - Initialize workspace with `accessRole = "viewer"`.
   - Right-click file/folder: verify mutating actions (New File, New Folder, Rename, Delete, Zip, Unzip) are excluded or disabled.
4. **Automated Testing Suite**:
   - Run `node tests/e2e/code-workspace/tier1-feature-coverage.test.mjs`
   - Run `node tests/e2e/code-workspace/tier2-boundary-corner.test.mjs`

---
*Plan created and verified by Explorer 2.*
