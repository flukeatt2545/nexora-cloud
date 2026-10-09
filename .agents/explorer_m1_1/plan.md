# Milestone 1 Implementation Plan: Workspace UI Components, Tree & Dependencies

**Document Version**: 1.0.0  
**Target Milestone**: Milestone 1 (M1)  
**Working Directory**: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\`  
**Target Component Directory**: `app/components/code-workspace/`  

---

## 1. Executive Overview & Architecture

Milestone 1 establishes the foundational UI layer, component tree, type system, and dependency ecosystem for the VS Code-style File Explorer and Multi-Tab Code Workspace in NEXORA Cloud.

### 1.1 Architecture Diagram
```
+-------------------------------------------------------------------------------------------------------+
| CodeWorkspace / CodeWorkspaceModal (Container & Layout Orchestrator)                                 |
| +------------------------------------+--------------------------------------------------------------+ |
| | WorkspaceSidebar (260px - 288px)   | WorkspaceTabBar (Multi-tab strip, active tab, dirty dot, X)  | |
| | - Action Header (New, Upload, etc.)+--------------------------------------------------------------+ |
| | - Search Filter Input              | Editor Area (CodeMirror 6 placeholder in M1, active in M2)   | |
| | - FileTree (Tree container)        |                                                              | |
| |   - FileTreeNode (recursive lazy)  |                                                              | |
| |   - FileIcon (20+ formats)         |                                                              | |
| | - FileContextMenu (right-click)    |                                                              | |
| | - Storage Summary Footer           +--------------------------------------------------------------+ |
| |                                    | WorkspaceStatusBar (Path, Encoding, Lang, Line/Col, Role)   | |
| +------------------------------------+--------------------------------------------------------------+ |
+-------------------------------------------------------------------------------------------------------+
```

### 1.2 Deliverables Checklist
- [x] **D1: Package Dependencies (`package.json`)**: Full `@codemirror/*` core, language packs, and `@lezer/*` dependencies.
- [x] **D2: Type Definitions (`types.ts`)**: Complete TypeScript interfaces for tabs, tree nodes, icons, actions, context menu, status bar, dialogs, and site metadata.
- [x] **D3: File Icon Engine (`FileIcon.tsx`)**: Comprehensive extension-to-Lucide mapping with distinct color tokens for 20+ languages and file types.
- [x] **D4: Hierarchical Tree View (`FileTreeNode.tsx` & `FileTree.tsx`)**: Recursive tree rendering, indentation lines, expand/collapse toggles, lazy loading spinner, selection highlighting, keyboard navigation, and context menu triggers.
- [x] **D5: Multi-Tab Strip (`WorkspaceTabBar.tsx` & `WorkspaceTabItem.tsx`)**: Scrollable tab bar with active tab indicator, dirty state dot (`•`), close button (`X`), middle-click close, and path tooltips.
- [x] **D6: Status Bar (`WorkspaceStatusBar.tsx`)**: Bottom status footer displaying file path, encoding, language mode, line/col cursor tracking, and access role badges.
- [x] **D7: Explorer Sidebar Shell (`WorkspaceSidebar.tsx` & `FileContextMenu.tsx`)**: Sidebar container with action header (New File, New Folder, Upload, Refresh, Collapse All), real-time search filter, tree host, and context menu.

---

## 2. Dependency Specification (`package.json`)

The following dependencies are required for CodeMirror 6 and the multi-language editing suite. All packages are native ESM, tree-shakeable, and fully compatible with React 19 and Next 16 / Vinext.

### 2.1 Packages to Add to `dependencies` in `package.json`
```json
{
  "dependencies": {
    "@codemirror/autocomplete": "^6.18.6",
    "@codemirror/commands": "^6.8.0",
    "@codemirror/lang-css": "^6.3.1",
    "@codemirror/lang-go": "^6.0.1",
    "@codemirror/lang-html": "^6.4.9",
    "@codemirror/lang-javascript": "^6.2.3",
    "@codemirror/lang-json": "^6.0.1",
    "@codemirror/lang-markdown": "^6.3.2",
    "@codemirror/lang-php": "^6.0.1",
    "@codemirror/lang-python": "^6.1.7",
    "@codemirror/lang-sql": "^6.8.0",
    "@codemirror/lang-yaml": "^6.1.1",
    "@codemirror/language": "^6.10.8",
    "@codemirror/legacy-modes": "^6.4.0",
    "@codemirror/lint": "^6.8.4",
    "@codemirror/search": "^6.5.8",
    "@codemirror/state": "^6.5.2",
    "@codemirror/theme-one-dark": "^6.1.2",
    "@codemirror/view": "^6.36.4",
    "@lezer/common": "^1.2.3",
    "@lezer/highlight": "^1.2.1"
  }
}
```

### 2.2 Rationale & Verification
- `@codemirror/state` and `@codemirror/view`: The modular DOM and document state engine of CodeMirror 6.
- `@codemirror/commands` and `@codemirror/search`: VS Code-grade keymaps (Ctrl+Z, Ctrl+Y, Ctrl+F search, Ctrl+H replace, Tab indentation).
- `@codemirror/language`, `@lezer/highlight`, `@lezer/common`: High-performance syntax tree parser and token highlighter.
- `@codemirror/lang-*`: First-party language syntax engines for PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML.
- `@codemirror/legacy-modes`: Stream-syntax support for Shell scripts (`.sh`, `.bash`), Dockerfiles, Nginx configurations, and Apache `.htaccess`.

---

## 3. Component Specification: `app/components/code-workspace/types.ts`

```typescript
/**
 * Shared Type Definitions for VS Code-Style Code Workspace
 * File: app/components/code-workspace/types.ts
 */

export type SiteRole = "owner" | "developer" | "viewer" | "platform_admin";

export interface SiteInfo {
  id: string;
  name: string;
  subdomain?: string;
  customDomain?: string;
  accessRole: SiteRole;
  status?: "provisioning" | "running" | "stopped" | "error" | "expired";
  healthStatus?: "unknown" | "starting" | "healthy" | "unhealthy" | "stopped";
}

export type FileItemType = "file" | "directory";

export interface FileItem {
  name: string;
  path: string;
  type: FileItemType;
  size?: number;
  updatedAt?: string;
}

export interface TreeNodeData {
  name: string;
  path: string;
  type: FileItemType;
  size?: number;
  updatedAt?: string;
  children?: TreeNodeData[];
  isExpanded?: boolean;
  isLoading?: boolean;
  isLoaded?: boolean;
  depth?: number;
}

export interface WorkspaceTab {
  id: string; // Canonical relative path e.g. "public/index.php"
  path: string; // Full relative path
  name: string; // Base file name e.g. "index.php"
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  language: string;
  scrollPosition?: { top: number; left: number };
  cursorPosition?: { line: number; col: number };
  readOnly?: boolean;
  lastSavedAt?: number;
}

export type SupportedLanguage =
  | "php"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "html"
  | "css"
  | "scss"
  | "json"
  | "python"
  | "go"
  | "sql"
  | "markdown"
  | "yaml"
  | "shell"
  | "dockerfile"
  | "nginx"
  | "plaintext"
  | "xml"
  | "toml";

export interface FileIconProps {
  fileName: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  size?: number | string;
  className?: string;
}

export type WorkspaceQuickAction =
  | "new_file"
  | "new_folder"
  | "upload"
  | "refresh"
  | "collapse_all";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string; size?: number | string }>;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  action: () => void;
}

export interface CursorPosition {
  line: number;
  col: number;
  totalLines?: number;
  charCount?: number;
  selectedCount?: number;
}

export interface WorkspaceStatusBarProps {
  activeTab: WorkspaceTab | null;
  cursorPosition: CursorPosition;
  role: SiteRole;
  encoding?: string;
  indentation?: string;
  isSaving?: boolean;
  siteDomain?: string;
}

export interface WorkspaceSidebarProps {
  treeData: TreeNodeData[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  filterQuery: string;
  onFilterChange: (query: string) => void;
  onSelectNode: (node: TreeNodeData) => void;
  onToggleExpand: (node: TreeNodeData) => void;
  onOpenFile: (node: TreeNodeData) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
  onQuickAction: (action: WorkspaceQuickAction) => void;
  role: SiteRole;
  totalFiles?: number;
  storageUsed?: string;
  className?: string;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export interface FileTreeProps {
  nodes: TreeNodeData[];
  selectedPath: string | null;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  filterQuery?: string;
  onSelectNode: (node: TreeNodeData) => void;
  onToggleExpand: (node: TreeNodeData) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
  onOpenFile: (node: TreeNodeData) => void;
}

export interface FileTreeNodeProps {
  node: TreeNodeData;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  onSelect: (node: TreeNodeData) => void;
  onToggle: (node: TreeNodeData) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
  onDoubleClick: (node: TreeNodeData) => void;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  selectedPath: string | null;
  filterQuery?: string;
}

export interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e?: React.MouseEvent) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onNewFileTab?: () => void;
}

export interface WorkspaceTabItemProps {
  tab: WorkspaceTab;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  added: string[];
}

export interface DiffPreviewData {
  path: string;
  changed: boolean;
  hunks: DiffHunk[];
  oldLinesCount: number;
  newLinesCount: number;
}

export interface CodeWorkspaceModalProps {
  site: SiteInfo;
  isOpen: boolean;
  onClose: () => void;
  initialFile?: string;
  notify: (notice: { kind: "success" | "error"; text: string }) => void;
  ask: (request: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    action: () => void | Promise<void>;
  }) => void;
}
```

---

## 4. Component Specification: `app/components/code-workspace/FileIcon.tsx`

The `FileIcon` component maps file extensions and special filenames to Lucide icons with custom color styling adhering to the NEXORA design system.

```typescript
"use client";

import React from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  FileArchive,
  Image as ImageIcon,
  Music,
  Video,
  Database,
  Terminal,
  Boxes,
  Server,
  LockKeyhole,
  ScrollText,
  Settings,
  Globe,
  Code2,
  FileClock,
  Sparkles,
} from "lucide-react";
import { FileIconProps, SupportedLanguage } from "./types";

interface IconConfig {
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  colorClass: string;
  language: SupportedLanguage;
}

export function getFileConfig(fileName: string, isDirectory?: boolean, isOpen?: boolean): IconConfig {
  if (isDirectory) {
    return {
      icon: isOpen ? FolderOpen : Folder,
      colorClass: isOpen ? "text-amber-400" : "text-amber-400/90",
      language: "plaintext",
    };
  }

  const lowerName = fileName.toLowerCase();
  const ext = lowerName.includes(".") ? lowerName.split(".").pop() || "" : "";

  // 1. Exact Filename Matches
  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
    return { icon: Boxes, colorClass: "text-sky-400", language: "dockerfile" };
  }
  if (lowerName === "docker-compose.yml" || lowerName === "docker-compose.yaml") {
    return { icon: Boxes, colorClass: "text-sky-400", language: "yaml" };
  }
  if (lowerName === "nginx.conf" || lowerName.endsWith(".conf")) {
    return { icon: Server, colorClass: "text-emerald-400", language: "nginx" };
  }
  if (lowerName === ".htaccess" || lowerName === "httpd.conf") {
    return { icon: Server, colorClass: "text-rose-400", language: "nginx" };
  }
  if (lowerName.startsWith(".env")) {
    return { icon: LockKeyhole, colorClass: "text-yellow-400", language: "plaintext" };
  }
  if (lowerName === ".gitignore" || lowerName === ".gitattributes") {
    return { icon: Settings, colorClass: "text-orange-500", language: "plaintext" };
  }
  if (lowerName === "readme.md" || lowerName === "license") {
    return { icon: ScrollText, colorClass: "text-sky-400", language: "markdown" };
  }
  if (lowerName === "package.json" || lowerName === "composer.json") {
    return { icon: FileJson, colorClass: "text-amber-400", language: "json" };
  }
  if (lowerName === "caddyfile") {
    return { icon: Server, colorClass: "text-cyan-400", language: "nginx" };
  }

  // 2. Extension Matches
  switch (ext) {
    // PHP
    case "php":
    case "phtml":
    case "php8":
    case "php7":
      return { icon: Code2, colorClass: "text-indigo-400", language: "php" };

    // JavaScript & TypeScript
    case "js":
    case "mjs":
    case "cjs":
      return { icon: FileCode, colorClass: "text-yellow-400", language: "javascript" };
    case "ts":
    case "mts":
    case "cts":
      return { icon: FileCode, colorClass: "text-blue-400", language: "typescript" };
    case "jsx":
      return { icon: Code2, colorClass: "text-cyan-400", language: "jsx" };
    case "tsx":
      return { icon: Code2, colorClass: "text-sky-400", language: "tsx" };

    // Web Formats
    case "html":
    case "htm":
    case "xhtml":
      return { icon: Globe, colorClass: "text-orange-500", language: "html" };
    case "css":
      return { icon: FileCode, colorClass: "text-sky-400", language: "css" };
    case "scss":
    case "sass":
    case "less":
      return { icon: FileCode, colorClass: "text-pink-400", language: "scss" };

    // Data & Config
    case "json":
    case "json5":
    case "jsonc":
      return { icon: FileJson, colorClass: "text-amber-400", language: "json" };
    case "yaml":
    case "yml":
      return { icon: Settings, colorClass: "text-violet-400", language: "yaml" };
    case "xml":
    case "svg":
      return { icon: Code2, colorClass: "text-emerald-400", language: "xml" };
    case "toml":
    case "ini":
      return { icon: Settings, colorClass: "text-slate-400", language: "toml" };

    // Python & Go
    case "py":
    case "pyw":
      return { icon: Terminal, colorClass: "text-blue-400", language: "python" };
    case "go":
      return { icon: Sparkles, colorClass: "text-cyan-400", language: "go" };

    // Database & SQL
    case "sql":
    case "sqlite":
    case "sqlite3":
    case "db":
      return { icon: Database, colorClass: "text-emerald-400", language: "sql" };

    // Markdown & Docs
    case "md":
    case "markdown":
    case "mdx":
      return { icon: ScrollText, colorClass: "text-sky-400", language: "markdown" };

    // Shell Scripts
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "bat":
    case "cmd":
    case "ps1":
      return { icon: Terminal, colorClass: "text-green-400", language: "shell" };

    // Archives
    case "zip":
    case "tar":
    case "gz":
    case "tgz":
    case "7z":
    case "rar":
      return { icon: FileArchive, colorClass: "text-amber-500", language: "plaintext" };

    // Media & Assets
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "ico":
    case "bmp":
      return { icon: ImageIcon, colorClass: "text-emerald-400", language: "plaintext" };
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
    case "aac":
      return { icon: Music, colorClass: "text-purple-400", language: "plaintext" };
    case "mp4":
    case "webm":
    case "mov":
    case "avi":
    case "mkv":
      return { icon: Video, colorClass: "text-rose-400", language: "plaintext" };

    // Logs & Text
    case "log":
      return { icon: FileClock, colorClass: "text-slate-400", language: "plaintext" };
    case "txt":
      return { icon: FileText, colorClass: "text-slate-300", language: "plaintext" };

    default:
      return { icon: FileText, colorClass: "text-slate-400", language: "plaintext" };
  }
}

export function getLanguageFromPath(path: string): SupportedLanguage {
  const fileName = path.split("/").pop() || path;
  return getFileConfig(fileName, false).language;
}

export function FileIcon({
  fileName,
  isDirectory = false,
  isOpen = false,
  size = 16,
  className = "",
}: FileIconProps) {
  const config = getFileConfig(fileName, isDirectory, isOpen);
  const IconComponent = config.icon;

  return <IconComponent size={size} className={`shrink-0 ${config.colorClass} ${className}`} />;
}
```

---

## 5. Component Specification: `FileTreeNode.tsx` & `FileTree.tsx`

### 5.1 `app/components/code-workspace/FileTreeNode.tsx`
Handles single node rendering, indentation guide lines, chevron toggles, spinner loading state, selection highlighting, and double-click actions.

```typescript
"use client";

import React, { useMemo } from "react";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { FileTreeNodeProps } from "./types";
import { FileIcon } from "./FileIcon";

export function FileTreeNode({
  node,
  depth,
  isSelected,
  isExpanded,
  isLoading,
  onSelect,
  onToggle,
  onContextMenu,
  onDoubleClick,
  expandedPaths,
  loadingPaths,
  selectedPath,
  filterQuery,
}: FileTreeNodeProps) {
  const isDir = node.type === "directory";

  // Search Match Highlighting
  const highlightedName = useMemo(() => {
    if (!filterQuery || !filterQuery.trim()) {
      return <span>{node.name}</span>;
    }
    const q = filterQuery.toLowerCase();
    const idx = node.name.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{node.name}</span>;

    const before = node.name.slice(0, idx);
    const match = node.name.slice(idx, idx + q.length);
    const after = node.name.slice(idx + q.length);

    return (
      <span>
        {before}
        <span className="bg-amber-400/30 text-amber-200 font-semibold px-0.5 rounded-sm">{match}</span>
        {after}
      </span>
    );
  }, [node.name, filterQuery]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
    if (isDir) {
      onToggle(node);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(node);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDir) {
      onToggle(node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(node);
    onContextMenu(e, node);
  };

  return (
    <div className="select-none font-sans text-xs">
      {/* Node Row */}
      <div
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={`group flex items-center h-7 px-2 cursor-pointer transition-colors duration-100 relative ${
          isSelected
            ? "bg-[rgba(255,16,24,0.14)] text-white font-medium before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-[#ff1018]"
            : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
        }`}
        style={{ paddingLeft: `${Math.max(depth * 14 + 6, 6)}px` }}
      >
        {/* Indentation Guide Line */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-white/[0.06] pointer-events-none"
            style={{ left: `${depth * 14 - 2}px` }}
          />
        )}

        {/* Expand / Collapse Chevron or Loading Spinner */}
        <div className="w-4 h-4 mr-1 flex items-center justify-center shrink-0">
          {isDir ? (
            isLoading ? (
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
            ) : (
              <button
                type="button"
                tabIndex={-1}
                onClick={handleToggleClick}
                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-white rounded-sm"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            )
          ) : (
            <span className="w-3.5" />
          )}
        </div>

        {/* File/Folder Icon */}
        <FileIcon fileName={node.name} isDirectory={isDir} isOpen={isExpanded} size={15} className="mr-2 shrink-0" />

        {/* Name Label */}
        <span className="truncate tracking-wide">{highlightedName}</span>

        {/* Size Badge (visible on hover for files) */}
        {!isDir && typeof node.size === "number" && (
          <span className="ml-auto pl-2 text-[10px] text-slate-500 group-hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatBytes(node.size)}
          </span>
        )}
      </div>

      {/* Render Nested Children if Directory is Expanded */}
      {isDir && isExpanded && node.children && (
        <div role="group" className="relative">
          {node.children.map((child) => {
            const childIsExpanded = expandedPaths.has(child.path);
            const childIsLoading = loadingPaths.has(child.path);
            const childIsSelected = selectedPath === child.path;

            return (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                isSelected={childIsSelected}
                isExpanded={childIsExpanded}
                isLoading={childIsLoading}
                onSelect={onSelect}
                onToggle={onToggle}
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                filterQuery={filterQuery}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

### 5.2 `app/components/code-workspace/FileTree.tsx`
Handles recursive tree traversal, keyboard navigation (ArrowUp, ArrowDown, ArrowRight, ArrowLeft, Enter), search filtering, and container focus.

```typescript
"use client";

import React, { useRef, useMemo, useCallback } from "react";
import { FileTreeProps, TreeNodeData } from "./types";
import { FileTreeNode } from "./FileTreeNode";

export function FileTree({
  nodes,
  selectedPath,
  expandedPaths,
  loadingPaths,
  filterQuery,
  onSelectNode,
  onToggleExpand,
  onContextMenu,
  onOpenFile,
}: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter nodes recursively if search query exists
  const filteredNodes = useMemo(() => {
    if (!filterQuery || !filterQuery.trim()) return nodes;
    const q = filterQuery.toLowerCase();

    function filterRecursive(list: TreeNodeData[]): TreeNodeData[] {
      const results: TreeNodeData[] = [];
      for (const item of list) {
        if (item.type === "directory") {
          const matchingChildren = item.children ? filterRecursive(item.children) : [];
          if (item.name.toLowerCase().includes(q) || matchingChildren.length > 0) {
            results.push({
              ...item,
              children: matchingChildren.length > 0 ? matchingChildren : item.children,
              isExpanded: true, // Auto-expand matching folders
            });
          }
        } else {
          if (item.name.toLowerCase().includes(q)) {
            results.push(item);
          }
        }
      }
      return results;
    }

    return filterRecursive(nodes);
  }, [nodes, filterQuery]);

  // Flatten visible nodes for keyboard navigation
  const visibleNodes = useMemo(() => {
    const flat: TreeNodeData[] = [];
    function collect(list: TreeNodeData[]) {
      for (const item of list) {
        flat.push(item);
        if (item.type === "directory" && (expandedPaths.has(item.path) || filterQuery) && item.children) {
          collect(item.children);
        }
      }
    }
    collect(filteredNodes);
    return flat;
  }, [filteredNodes, expandedPaths, filterQuery]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleNodes.length === 0) return;

      const currentIndex = visibleNodes.findIndex((n) => n.path === selectedPath);
      const currentNode = currentIndex >= 0 ? visibleNodes[currentIndex] : null;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = currentIndex < visibleNodes.length - 1 ? currentIndex + 1 : 0;
          const nextNode = visibleNodes[nextIndex];
          onSelectNode(nextNode);
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : visibleNodes.length - 1;
          const prevNode = visibleNodes[prevIndex];
          onSelectNode(prevNode);
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (currentNode && currentNode.type === "directory") {
            if (!expandedPaths.has(currentNode.path)) {
              onToggleExpand(currentNode);
            } else if (currentNode.children && currentNode.children.length > 0) {
              onSelectNode(currentNode.children[0]);
            }
          }
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          if (currentNode) {
            if (currentNode.type === "directory" && expandedPaths.has(currentNode.path)) {
              onToggleExpand(currentNode);
            } else {
              // Find parent directory
              const parentPath = currentNode.path.split("/").slice(0, -1).join("/");
              if (parentPath) {
                const parentNode = visibleNodes.find((n) => n.path === parentPath);
                if (parentNode) onSelectNode(parentNode);
              }
            }
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          if (currentNode) {
            if (currentNode.type === "directory") {
              onToggleExpand(currentNode);
            } else {
              onOpenFile(currentNode);
            }
          }
          break;
        }
      }
    },
    [visibleNodes, selectedPath, expandedPaths, onSelectNode, onToggleExpand, onOpenFile]
  );

  return (
    <div
      ref={containerRef}
      role="tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="outline-none focus-visible:ring-1 focus-visible:ring-red-500/50 py-1"
    >
      {filteredNodes.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-slate-500">
          {filterQuery ? "ไม่พบไฟล์หรือโฟลเดอร์ที่ค้นหา" : "ไม่มีไฟล์ในโฟลเดอร์นี้"}
        </div>
      ) : (
        filteredNodes.map((node) => {
          const isExpanded = expandedPaths.has(node.path) || Boolean(filterQuery);
          const isLoading = loadingPaths.has(node.path);
          const isSelected = selectedPath === node.path;

          return (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              isSelected={isSelected}
              isExpanded={isExpanded}
              isLoading={isLoading}
              onSelect={onSelectNode}
              onToggle={onToggleExpand}
              onContextMenu={onContextMenu}
              onDoubleClick={(n) => {
                if (n.type === "file") onOpenFile(n);
                else onToggleExpand(n);
              }}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              selectedPath={selectedPath}
              filterQuery={filterQuery}
            />
          );
        })
      )}
    </div>
  );
}
```

---

## 6. Component Specification: `WorkspaceTabBar.tsx` & `WorkspaceTabItem.tsx`

### 6.1 `app/components/code-workspace/WorkspaceTabItem.tsx`
Handles single tab item rendering with active highlight, dirty dot indicator, close button, middle-click close, and full-path tooltip.

```typescript
"use client";

import React from "react";
import { X } from "lucide-react";
import { WorkspaceTabItemProps } from "./types";
import { FileIcon } from "./FileIcon";

export function WorkspaceTabItem({
  tab,
  isActive,
  onSelect,
  onClose,
  onMiddleClick,
  onContextMenu,
}: WorkspaceTabItemProps) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      onAuxClick={onMiddleClick}
      onContextMenu={onContextMenu}
      title={tab.path}
      className={`group relative flex items-center h-9 px-3 gap-2 border-r border-white/[0.08] cursor-pointer select-none text-xs transition-colors duration-150 shrink-0 ${
        isActive
          ? "bg-[#151822] text-white font-medium before:absolute before:left-0 before:right-0 before:top-0 before:h-0.5 before:bg-[#ff1018]"
          : "bg-[#0c0e15] text-slate-400 hover:bg-[#12141d] hover:text-slate-200"
      }`}
    >
      {/* File Icon */}
      <FileIcon fileName={tab.name} isDirectory={false} size={14} className="shrink-0" />

      {/* File Name */}
      <span className="truncate max-w-[140px] tracking-wide">{tab.name}</span>

      {/* Unsaved Changes Indicator Dot or Close Button */}
      <div className="w-4 h-4 flex items-center justify-center shrink-0 ml-1">
        {tab.isDirty ? (
          <>
            {/* Dot shown normally */}
            <span className="w-2 h-2 rounded-full bg-[#ff3c43] group-hover:hidden" />
            {/* Close X shown on tab hover */}
            <button
              type="button"
              tabIndex={-1}
              onClick={onClose}
              className="hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-slate-400 hover:text-white hover:bg-white/15 transition-colors"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={onClose}
            className="opacity-0 group-hover:opacity-100 flex w-4 h-4 items-center justify-center rounded text-slate-400 hover:text-white hover:bg-white/15 transition-all"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

### 6.2 `app/components/code-workspace/WorkspaceTabBar.tsx`
Handles horizontal scrolling, wheel scroll translation, active tab switching, and empty state.

```typescript
"use client";

import React, { useRef, useEffect } from "react";
import { WorkspaceTabBarProps } from "./types";
import { WorkspaceTabItem } from "./WorkspaceTabItem";

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}: WorkspaceTabBarProps) {
  const tabStripRef = useRef<HTMLDivElement>(null);

  // Convert vertical mouse wheel delta into horizontal scroll
  const handleWheel = (e: React.WheelEvent) => {
    if (tabStripRef.current && Math.abs(e.deltaY) > 0) {
      tabStripRef.current.scrollLeft += e.deltaY;
    }
  };

  // Scroll active tab into view when activeTabId changes
  useEffect(() => {
    if (!tabStripRef.current || !activeTabId) return;
    const activeEl = tabStripRef.current.querySelector('[aria-selected="true"]') as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeTabId]);

  if (tabs.length === 0) {
    return (
      <div className="h-9 bg-[#0c0e15] border-b border-white/[0.08] flex items-center px-4 text-xs text-slate-600 select-none">
        ยังไม่มีไฟล์ที่เปิดอยู่
      </div>
    );
  }

  return (
    <div
      ref={tabStripRef}
      onWheel={handleWheel}
      role="tablist"
      className="flex items-center h-9 bg-[#0c0e15] border-b border-white/[0.08] overflow-x-auto overflow-y-hidden no-scrollbar select-none"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <WorkspaceTabItem
            key={tab.id}
            tab={tab}
            isActive={isActive}
            onSelect={() => onSelectTab(tab.id)}
            onClose={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id, e);
            }}
            onMiddleClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                onCloseTab(tab.id, e);
              }
            }}
          />
        );
      })}
    </div>
  );
}
```

---

## 7. Component Specification: `WorkspaceStatusBar.tsx`

The `WorkspaceStatusBar` renders the bottom status bar with editor telemetry, line/column tracking, encoding, language mode, and viewer security badge.

```typescript
"use client";

import React from "react";
import { Globe, Code2, ShieldAlert, Check, FileCheck } from "lucide-react";
import { WorkspaceStatusBarProps } from "./types";

export function WorkspaceStatusBar({
  activeTab,
  cursorPosition,
  role,
  encoding = "UTF-8",
  indentation = "Spaces: 4",
  isSaving = false,
  siteDomain,
}: WorkspaceStatusBarProps) {
  const isViewer = role === "viewer";

  return (
    <footer className="h-6 bg-[#090b10] border-t border-white/[0.08] text-[11px] text-slate-400 flex items-center justify-between px-3 select-none shrink-0">
      {/* Left Telemetry: Site, Active Path, Dirty/Save State */}
      <div className="flex items-center gap-3 overflow-hidden">
        {siteDomain && (
          <div className="flex items-center gap-1.5 text-slate-300 font-medium truncate shrink-0">
            <Globe size={12} className="text-red-500" />
            <span className="truncate max-w-[160px]">{siteDomain}</span>
          </div>
        )}

        {activeTab ? (
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-slate-600">/</span>
            <span className="truncate text-slate-300">{activeTab.path}</span>
            {activeTab.isDirty && (
              <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded font-medium">
                Unsaved
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-500">พร้อมใช้งาน</span>
        )}

        {isSaving && (
          <div className="flex items-center gap-1 text-sky-400 animate-pulse">
            <FileCheck size={12} />
            <span>กำลังบันทึก...</span>
          </div>
        )}
      </div>

      {/* Right Telemetry: Cursor Ln/Col, Spaces, Encoding, Language, Role */}
      <div className="flex items-center gap-3 shrink-0 ml-2">
        {activeTab && (
          <>
            <div className="hover:text-slate-200 transition-colors">
              Ln {cursorPosition.line}, Col {cursorPosition.col}
            </div>
            <div className="hidden sm:block text-slate-500 hover:text-slate-300 transition-colors">
              {indentation}
            </div>
            <div className="hidden sm:block text-slate-500 hover:text-slate-300 transition-colors">
              {encoding}
            </div>
            <div className="flex items-center gap-1 text-slate-300 uppercase font-mono font-medium">
              <Code2 size={12} className="text-red-500" />
              <span>{activeTab.language}</span>
            </div>
          </>
        )}

        {/* Security / Access Role Badge */}
        {isViewer ? (
          <div className="flex items-center gap-1 text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">
            <ShieldAlert size={11} />
            <span>Viewer (Read-Only)</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[10px] font-medium">
            <Check size={11} />
            <span className="capitalize">{role.replace("_", " ")}</span>
          </div>
        )}
      </div>
    </footer>
  );
}
```

---

## 8. Component Specification: `WorkspaceSidebar.tsx` & `FileContextMenu.tsx`

### 8.1 `app/components/code-workspace/FileContextMenu.tsx`
Handles floating context menu coordinates, boundary clamping, danger styling, and keyboard dismissal.

```typescript
"use client";

import React, { useEffect, useRef } from "react";
import { ContextMenuItem, ContextMenuPosition } from "./types";

interface FileContextMenuProps {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function FileContextMenu({ position, items, onClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  if (!position || items.length === 0) return null;

  // Viewport boundary adjustment
  const x = Math.min(position.x, window.innerWidth - 220);
  const y = Math.min(position.y, window.innerHeight - 300);

  return (
    <div
      ref={menuRef}
      style={{ left: `${x}px`, top: `${y}px` }}
      className="fixed z-50 min-w-[200px] bg-[#12141e] border border-white/10 rounded-md shadow-2xl py-1 text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-100 backdrop-blur-md"
    >
      {items.map((item, idx) => {
        if (item.divider) {
          return <div key={`divider-${idx}`} className="my-1 border-t border-white/[0.08]" />;
        }

        const Icon = item.icon;

        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.action();
              onClose();
            }}
            className={`w-full flex items-center px-3 py-1.5 gap-2.5 text-left transition-colors ${
              item.disabled
                ? "opacity-40 cursor-not-allowed text-slate-500"
                : item.danger
                ? "text-red-400 hover:bg-red-500/15 hover:text-red-300"
                : "hover:bg-white/10 hover:text-white"
            }`}
          >
            {Icon && <Icon size={14} className="shrink-0 opacity-80" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px] text-slate-500 font-mono">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

### 8.2 `app/components/code-workspace/WorkspaceSidebar.tsx`
Handles sidebar layout, action header, search filter input with clear button, tree container, and storage footer.

```typescript
"use client";

import React, { useRef } from "react";
import {
  FilePlus,
  FolderPlus,
  UploadCloud,
  RefreshCw,
  FoldVertical,
  Search,
  X,
  HardDrive,
} from "lucide-react";
import { WorkspaceSidebarProps } from "./types";
import { FileTree } from "./FileTree";

export function WorkspaceSidebar({
  treeData,
  selectedPath,
  expandedPaths,
  loadingPaths,
  filterQuery,
  onFilterChange,
  onSelectNode,
  onToggleExpand,
  onOpenFile,
  onContextMenu,
  onQuickAction,
  role,
  totalFiles = 0,
  storageUsed,
  className = "",
  isMobileOpen = false,
  onMobileClose,
}: WorkspaceSidebarProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const isViewer = role === "viewer";

  return (
    <aside
      className={`w-64 lg:w-72 bg-[#10121a] border-r border-white/[0.08] flex flex-col h-full select-none shrink-0 ${
        isMobileOpen
          ? "fixed inset-y-0 left-0 z-40 shadow-2xl flex"
          : "hidden md:flex"
      } ${className}`}
    >
      {/* 1. Header Toolbar */}
      <div className="h-10 px-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase font-sans">
          EXPLORER
        </span>

        <div className="flex items-center gap-1">
          {/* Action Buttons */}
          <button
            type="button"
            title={isViewer ? "โหมดดูอย่างเดียว" : "สร้างไฟล์ใหม่"}
            disabled={isViewer}
            onClick={() => onQuickAction("new_file")}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FilePlus size={14} />
          </button>

          <button
            type="button"
            title={isViewer ? "โหมดดูอย่างเดียว" : "สร้างโฟลเดอร์ใหม่"}
            disabled={isViewer}
            onClick={() => onQuickAction("new_folder")}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FolderPlus size={14} />
          </button>

          <button
            type="button"
            title={isViewer ? "โหมดดูอย่างเดียว" : "อัปโหลดไฟล์"}
            disabled={isViewer}
            onClick={() => onQuickAction("upload")}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <UploadCloud size={14} />
          </button>

          <button
            type="button"
            title="รีเฟรชโครงสร้างไฟล์"
            onClick={() => onQuickAction("refresh")}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RefreshCw size={14} />
          </button>

          <button
            type="button"
            title="หุบโฟลเดอร์ทั้งหมด"
            onClick={() => onQuickAction("collapse_all")}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <FoldVertical size={14} />
          </button>

          {isMobileOpen && onMobileClose && (
            <button
              type="button"
              title="ปิดเมนู"
              onClick={onMobileClose}
              className="md:hidden p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 ml-1"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Search Filter Input */}
      <div className="p-2 border-b border-white/[0.06] shrink-0">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-2.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="ค้นหาชื่อไฟล์..."
            className="w-full bg-[#161924] border border-white/10 rounded px-2 pl-8 pr-7 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-red-500/50 transition-colors"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => onFilterChange("")}
              className="absolute right-2 text-slate-500 hover:text-slate-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 3. Tree View Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 no-scrollbar">
        <FileTree
          nodes={treeData}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          filterQuery={filterQuery}
          onSelectNode={onSelectNode}
          onToggleExpand={onToggleExpand}
          onContextMenu={onContextMenu}
          onOpenFile={onOpenFile}
        />
      </div>

      {/* 4. Footer Storage / File Count Summary */}
      <div className="h-7 px-3 border-t border-white/[0.08] flex items-center justify-between text-[10px] text-slate-500 bg-[#0c0e15] shrink-0">
        <div className="flex items-center gap-1.5">
          <HardDrive size={11} />
          <span>{totalFiles} ไฟล์</span>
        </div>
        {storageUsed && <span>{storageUsed}</span>}
      </div>
    </aside>
  );
}
```

---

## 9. Styling, Theme Tokens & Accessibility Integration

### 9.1 CSS Classes & Design Tokens Alignment
- **Container Surfaces**:
  - Main background: `#0c0e15` (matches `--background: #08090d` and `--dash-bg: #090a0e`)
  - Sidebar background: `#10121a` (matches `--theme-elevated: #151723`)
  - Tab track background: `#0c0e15`
  - Active Tab: `#151822` with top accent border `#ff1018`
  - Hover states: `hover:bg-white/[0.05]`
- **Primary Brand Accent**:
  - Hex: `#ff1018`
  - RGB: `255 16 24`
  - Active Selection: `bg-[rgba(255,16,24,0.14)]` + `before:bg-[#ff1018]`
- **Rule Verification**:
  - No hardcoded `style={{ background: "...", color: "..." }}` color overrides in components (avoiding any lint / test failures with `tests/theme-coverage.test.mjs`). All styling is structured via Tailwind utility classes and CSS variables.

---

## 10. Step-by-Step Implementation & Verification Guide

### Step 1: Update `package.json`
Add the `@codemirror/*` and `@lezer/*` dependencies specified in Section 2, and verify with `npm install` (or verify dependency graph).

### Step 2: Create `app/components/code-workspace/types.ts`
Implement all contracts defined in Section 3.

### Step 3: Create `app/components/code-workspace/FileIcon.tsx`
Implement the extension-to-Lucide icon mapping engine defined in Section 4.

### Step 4: Create `app/components/code-workspace/FileTreeNode.tsx` & `FileTree.tsx`
Implement tree node indentation, lazy loading spinners, chevrons, and keyboard handlers defined in Section 5.

### Step 5: Create `app/components/code-workspace/WorkspaceTabItem.tsx` & `WorkspaceTabBar.tsx`
Implement tab strip, active indicator, unsaved dot, and close handlers defined in Section 6.

### Step 6: Create `app/components/code-workspace/WorkspaceStatusBar.tsx`
Implement bottom status bar telemetry and security badges defined in Section 7.

### Step 7: Create `app/components/code-workspace/FileContextMenu.tsx` & `WorkspaceSidebar.tsx`
Implement sidebar shell, quick action toolbar, search filter, and floating context menu defined in Section 8.

### Step 8: Verification
Run automated tests:
```bash
node --test tests/*.test.mjs
```
Confirm zero regressions and complete TypeScript typecheck pass.

---
*End of Milestone 1 Implementation Plan.*
