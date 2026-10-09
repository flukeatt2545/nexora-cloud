# Layout, Theming & Workspace Shell Implementation Plan (Milestone 1)

**Role**: Explorer 3 (Responsive Layout, Theming & Workspace Shell Specialist)  
**Target Milestone**: Milestone 1  
**Working Directory**: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_3\`  
**Date**: 2026-08-30  

---

## 1. Overview & Architectural Blueprint

This plan establishes the layout architecture, responsive mechanics, Obsidian dark styling tokens, loading skeletons, and empty state ergonomics for the VS Code-style workspace modal (`CodeWorkspaceModal.tsx`) and its child components under `app/components/code-workspace/`.

### 1.1 Visual Shell Topology

```
+===================================================================================================+
| CodeWorkspaceModal (Fixed overlay / 100dvh / 98vw desktop modal or 100vw fullscreen mobile)       |
| +-----------------------------------------------------------------------------------------------+ |
| | WorkspaceHeader (Height: 48px / #0c0e15)                                                      | |
| | [Site Badge + Domain] [Breadcrumb]                   [Save Ctrl+S] [Diff] [Full] [Close X]    | |
| +----------------------------------+------------------------------------------------------------+ |
| | WorkspaceSidebar                 | WorkspaceTabBar (Height: 38px / #0c0e15 / Scrollable)      | |
| | (Desktop: 260px / #0e1017)       | [ tab1.php • ] [ tab2.css ] [ tab3.js ] [+]                | |
| | (Mobile: Off-canvas drawer)      +------------------------------------------------------------+ |
| | - Action Toolbar (New, Up, Rf)   | BreadcrumbBar (Height: 28px / #090b10)                     | |
| | - Search Filter input            | nkn-site > public > index.php                              | |
| | - FileTree / TreeSkeleton        +------------------------------------------------------------+ |
| |   (Hierarchical multi-level)     | Editor Body Canvas (#090b10)                               | |
| |                                  | - CodeMirror 6 Editor Instance OR                          | |
| |                                  | - WorkspaceEmptyState ("No files open" + Shortcuts) OR     | |
| |                                  | - CodeEditorSkeleton (Gutter + Shimmer code lines)         | |
| |                                  +------------------------------------------------------------+ |
| |                                  | WorkspaceStatusBar (Height: 26px / #0c0e15)                | |
| |                                  | Ln 12, Col 8 | Spaces: 4 | UTF-8 | PHP | [Viewer Badge]   | |
| +----------------------------------+------------------------------------------------------------+ |
+===================================================================================================+
```

---

## 2. Layout Structure & Responsive Design

### 2.1 `CodeWorkspaceModal.tsx` Shell Structure

The modal serves as the root container, handling viewport anchoring, theme context, escape keyboard triggers, backdrop click dismissals, and fullscreen expansion.

#### Layout Modes
1. **Desktop Windowed Mode (Default for screens >= 1024px)**:
   - Width: `w-[98vw] max-w-[1720px]`
   - Height: `h-[94vh] max-h-[1080px]`
   - Border radius: `rounded-2xl`
   - Border: `border border-white/10`
   - Shadow: `shadow-[0_25px_80px_rgba(0,0,0,0.85)]`
2. **Desktop Fullscreen Mode (User toggled via Header button / F11)**:
   - Width: `w-screen`
   - Height: `h-[100dvh]`
   - Border radius: `rounded-none`
   - Border: `border-none`
   - Inset: `fixed inset-0`
3. **Mobile & Tablet Mode (Screens < 1024px)**:
   - Width: `w-screen`
   - Height: `h-[100dvh]` (Dynamic Viewport Height to prevent iOS/Android address bar and software keyboard clipping)
   - Fixed full viewport: `fixed inset-0 z-[99999] rounded-none border-none`

#### Component Implementation Blueprint (`CodeWorkspaceModal.tsx`):
```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { X, Maximize2, Minimize2, PanelLeft, Save, GitCompare, ShieldAlert } from "lucide-react";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { CodeEditor } from "./CodeEditor";
import { WorkspaceStatusBar } from "./WorkspaceStatusBar";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { CodeEditorSkeleton } from "./CodeEditorSkeleton";
import { DiffDialog } from "./DiffDialog";
import { UnsavedConfirmDialog } from "./UnsavedConfirmDialog";
import { useWorkspaceState } from "./useWorkspaceState";
import { CodeWorkspaceModalProps } from "./types";
import "./workspace.css";

export function CodeWorkspaceModal({
  site,
  initialFile,
  isOpen,
  onClose,
  onNotify,
}: CodeWorkspaceModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const {
    tabs,
    activeTabId,
    activeTab,
    treeData,
    treeLoading,
    activeFileLoading,
    dirtyCount,
    diffDialogOpen,
    unsavedDialogOpen,
    pendingCloseTab,
    openFile,
    closeTab,
    saveActiveFile,
    saveAllFiles,
    setActiveTabId,
    updateActiveContent,
    confirmCloseTab,
    cancelCloseTab,
    discardAndCloseTab,
    setDiffDialogOpen,
    refreshTree,
  } = useWorkspaceState({ site, initialFile, onNotify });

  // Escape key and Global Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes mobile drawer first if open, else handles modal closure
      if (e.key === "Escape") {
        if (mobileDrawerOpen) {
          setMobileDrawerOpen(false);
          return;
        }
        if (diffDialogOpen || unsavedDialogOpen) return; // let dialogs handle ESC
        if (dirtyCount > 0) {
          // Trigger unsaved prompt on modal close attempt
          return;
        }
        onClose();
      }

      // Ctrl+S / Cmd+S: Save active file
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      }

      // Ctrl+B / Cmd+B: Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }

      // Ctrl+W / Cmd+W: Close active tab (intercept if within workspace)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w" && activeTabId) {
        e.preventDefault();
        closeTab(activeTabId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, mobileDrawerOpen, diffDialogOpen, unsavedDialogOpen, dirtyCount, activeTabId, saveActiveFile, closeTab, onClose]);

  // Lock background body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
      return () => {
        document.body.classList.remove("modal-open");
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isReadOnly = site.accessRole === "viewer";

  return (
    <div
      className="system-dialog-backdrop code-workspace-backdrop fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md p-0 md:p-3 select-none"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dirtyCount === 0) {
          onClose();
        }
      }}
    >
      <section
        className={`code-workspace-container flex flex-col bg-[#090b10] text-[#edf1f5] overflow-hidden transition-all duration-150 ${
          isFullscreen
            ? "w-screen h-[100dvh] fixed inset-0 rounded-none border-0"
            : "w-screen h-[100dvh] lg:w-[98vw] lg:max-w-[1720px] lg:h-[94vh] lg:max-h-[1080px] lg:rounded-2xl lg:border lg:border-white/10 lg:shadow-[0_25px_80px_rgba(0,0,0,0.85)]"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={`Code Workspace - ${site.domain}`}
      >
        {/* TOP HEADER */}
        <header className="workspace-header h-12 flex-shrink-0 bg-[#0c0e15] border-b border-white/[0.08] px-3 flex items-center justify-between text-xs select-none">
          {/* Left: Brand / Site Details & Drawer Toggle */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              className="lg:hidden p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] transition-colors"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="เปิดเมนูสำรวจไฟล์"
            >
              <PanelLeft size={18} />
            </button>

            <button
              type="button"
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "แสดงแถบข้าง (Ctrl+B)" : "ซ่อนแถบข้าง (Ctrl+B)"}
              aria-label="Toggle Sidebar"
            >
              <PanelLeft size={16} />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] flex-shrink-0" />
              <strong className="font-semibold text-slate-100 truncate text-sm">
                {site.domain}
              </strong>
              {isReadOnly && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <ShieldAlert size={12} />
                  โหมดดูอย่างเดียว
                </span>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {!isReadOnly && activeTab && (
              <>
                <button
                  type="button"
                  disabled={!activeTab.isDirty}
                  onClick={() => setDiffDialogOpen(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  title="ตรวจสอบความเปลี่ยนแปลง (Diff)"
                >
                  <GitCompare size={14} />
                  <span>ดู Diff</span>
                </button>

                <button
                  type="button"
                  disabled={!activeTab.isDirty}
                  onClick={saveActiveFile}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#ff1018] hover:bg-[#e00008] shadow-[0_0_12px_rgba(255,16,24,0.3)] disabled:opacity-40 disabled:pointer-events-none transition-all"
                  title="บันทึกไฟล์ (Ctrl+S)"
                >
                  <Save size={14} />
                  <span className="hidden xs:inline">บันทึก</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              title={isFullscreen ? "ย่อหน้าต่าง" : "เต็มจอ"}
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="ปิด Workspace (Esc)"
              aria-label="ปิด Workspace"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* WORKSPACE MAIN BODY (2 Columns on Desktop, Off-canvas on Mobile) */}
        <div className="workspace-body flex-1 flex min-h-0 relative overflow-hidden">
          {/* MOBILE BACKDROP OVERLAY */}
          {mobileDrawerOpen && (
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 lg:hidden transition-opacity"
              onClick={() => setMobileDrawerOpen(false)}
            />
          )}

          {/* SIDEBAR (Desktop column or Mobile Off-Canvas Drawer) */}
          <aside
            className={`workspace-sidebar bg-[#0e1017] border-r border-white/[0.08] flex flex-col flex-shrink-0 z-50 transition-all duration-200 ease-in-out ${
              mobileDrawerOpen
                ? "fixed inset-y-0 left-0 w-[82vw] max-w-[320px] shadow-2xl translate-x-0 lg:static lg:translate-x-0"
                : "-translate-x-full lg:translate-x-0 fixed inset-y-0 left-0 lg:static"
            } ${sidebarCollapsed ? "lg:w-0 lg:overflow-hidden lg:border-r-0" : "lg:w-[260px] xl:w-[280px]"}`}
          >
            <WorkspaceSidebar
              site={site}
              treeData={treeData}
              treeLoading={treeLoading}
              onSelectFile={(path) => {
                openFile(path);
                setMobileDrawerOpen(false); // auto-close drawer on mobile upon selection
              }}
              onRefresh={refreshTree}
              onCloseMobileDrawer={() => setMobileDrawerOpen(false)}
            />
          </aside>

          {/* MAIN EDITOR AREA */}
          <main className="workspace-main flex-1 flex flex-col min-w-0 min-h-0 bg-[#090b10] relative">
            {/* TAB STRIP */}
            <WorkspaceTabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={(id) => setActiveTabId(id)}
              onCloseTab={(id) => closeTab(id)}
              onNewFilePrompt={() => {
                // Open new file creation inside active folder or root
              }}
            />

            {/* BREADCRUMB BAR (Active File Path) */}
            {activeTab && (
              <div className="workspace-breadcrumbs h-7 px-3 bg-[#090b10] border-b border-white/[0.04] flex items-center text-[11px] text-slate-400 font-mono select-none overflow-x-auto no-scrollbar">
                <span className="text-slate-500">{site.domain}</span>
                {activeTab.path.split("/").map((part, idx, arr) => (
                  <React.Fragment key={idx}>
                    <span className="mx-1 text-slate-600">/</span>
                    <span className={idx === arr.length - 1 ? "text-slate-200 font-medium" : "text-slate-400"}>
                      {part}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* EDITOR CANVAS / EMPTY STATE / SKELETON */}
            <div className="workspace-editor-viewport flex-1 min-h-0 relative overflow-hidden bg-[#090b10]">
              {activeFileLoading ? (
                <CodeEditorSkeleton />
              ) : activeTab ? (
                <CodeEditor
                  content={activeTab.currentContent}
                  language={activeTab.language}
                  readOnly={isReadOnly}
                  onChange={(newContent) => updateActiveContent(activeTab.id, newContent)}
                  onSave={saveActiveFile}
                  className="h-full w-full"
                />
              ) : (
                <WorkspaceEmptyState
                  onOpenExplorer={() => setMobileDrawerOpen(true)}
                  onNewFile={() => {}}
                />
              )}
            </div>

            {/* STATUS BAR FOOTER */}
            <WorkspaceStatusBar
              activeTab={activeTab}
              accessRole={site.accessRole}
            />
          </main>
        </div>

        {/* DIALOGS */}
        {diffDialogOpen && activeTab && (
          <DiffDialog
            originalContent={activeTab.originalContent}
            currentContent={activeTab.currentContent}
            filename={activeTab.name}
            isOpen={diffDialogOpen}
            onClose={() => setDiffDialogOpen(false)}
            onConfirmSave={() => {
              setDiffDialogOpen(false);
              saveActiveFile();
            }}
          />
        )}

        {unsavedDialogOpen && pendingCloseTab && (
          <UnsavedConfirmDialog
            filename={pendingCloseTab.name}
            isOpen={unsavedDialogOpen}
            onSaveAndClose={() => {
              saveActiveFile();
              confirmCloseTab(pendingCloseTab.id);
            }}
            onDiscardAndClose={() => discardAndCloseTab(pendingCloseTab.id)}
            onCancel={cancelCloseTab}
          />
        )}
      </section>
    </div>
  );
}
```

---

## 3. Theming & Obsidian Dark Palette Specification

### 3.1 Color Tokens & Compatibility

The design harmonizes with `app/globals.css` (`--primary: #ff1018`, `--background: #08090d`), `app/dashboard/dashboard.css` and `app/theme.css`.

| Token Name | Hex / RGBA Value | Role / Usage |
|---|---|---|
| `--ws-bg-root` | `#090b10` | Master viewport canvas background |
| `--ws-bg-sidebar` | `#0e1017` | Tree view & sidebar surface |
| `--ws-bg-header` | `#0c0e15` | Top header & tab bar background track |
| `--ws-bg-tab-active` | `#141722` | Active open file tab background |
| `--ws-bg-tab-inactive` | `#0c0e15` | Inactive tab background |
| `--ws-bg-tab-hover` | `#11141e` | Tab hover state |
| `--ws-bg-editor` | `#090b10` | CodeMirror 6 canvas background |
| `--ws-bg-gutter` | `#0c0e15` | Line number gutter background |
| `--ws-border` | `rgba(255, 255, 255, 0.08)` | Primary layout divider borders |
| `--ws-border-subtle` | `rgba(255, 255, 255, 0.04)` | Inner item dividers & breadcrumbs |
| `--ws-primary` | `#ff1018` | NEXORA crimson accent (buttons, active tab accent line) |
| `--ws-primary-glow` | `rgba(255, 16, 24, 0.25)` | Focus and glow effects |
| `--ws-text-main` | `#f1f5f9` | Primary editor & UI typography |
| `--ws-text-muted` | `#94a3b8` | Filenames, breadcrumbs, status labels |
| `--ws-text-dim` | `#64748b` | Gutter numbers, keyboard shortcut badges |
| `--ws-dirty-dot` | `#ff3c43` | Unsaved indicator dot on tabs |
| `--ws-selection` | `rgba(255, 16, 24, 0.18)` | Text selection background |
| `--ws-active-line` | `rgba(255, 255, 255, 0.03)` | Active line cursor highlight |

### 3.2 CSS Ruleset (`app/components/code-workspace/workspace.css`)

```css
/* ==========================================================================
   NEXORA VS Code-Style Workspace Theme & Responsive Layout Styles
   ========================================================================== */

:root {
  --ws-bg-root: #090b10;
  --ws-bg-sidebar: #0e1017;
  --ws-bg-header: #0c0e15;
  --ws-bg-tab-active: #141722;
  --ws-bg-tab-inactive: #0c0e15;
  --ws-bg-tab-hover: #11141e;
  --ws-bg-editor: #090b10;
  --ws-bg-gutter: #0c0e15;
  --ws-border: rgba(255, 255, 255, 0.08);
  --ws-border-subtle: rgba(255, 255, 255, 0.04);
  --ws-primary: #ff1018;
  --ws-primary-soft: rgba(255, 16, 24, 0.12);
  --ws-text-main: #f1f5f9;
  --ws-text-muted: #94a3b8;
  --ws-text-dim: #64748b;
  --ws-dirty-dot: #ff3c43;
}

/* Custom Obsidian Scrollbar */
.workspace-sidebar ::-webkit-scrollbar,
.workspace-editor-viewport ::-webkit-scrollbar,
.workspace-tabs-track ::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.workspace-sidebar ::-webkit-scrollbar-track,
.workspace-editor-viewport ::-webkit-scrollbar-track,
.workspace-tabs-track ::-webkit-scrollbar-track {
  background: transparent;
}

.workspace-sidebar ::-webkit-scrollbar-thumb,
.workspace-editor-viewport ::-webkit-scrollbar-thumb,
.workspace-tabs-track ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
}

.workspace-sidebar ::-webkit-scrollbar-thumb:hover,
.workspace-editor-viewport ::-webkit-scrollbar-thumb:hover,
.workspace-tabs-track ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.22);
}

/* Tab Bar Styling */
.workspace-tabs-track {
  display: flex;
  align-items: stretch;
  height: 38px;
  background: var(--ws-bg-header);
  border-bottom: 1px solid var(--ws-border);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}

.workspace-tab-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 100%;
  font-size: 12px;
  color: var(--ws-text-muted);
  background: var(--ws-bg-tab-inactive);
  border-right: 1px solid var(--ws-border-subtle);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  position: relative;
  transition: background 0.15s ease, color 0.15s ease;
}

.workspace-tab-item:hover {
  background: var(--ws-bg-tab-hover);
  color: var(--ws-text-main);
}

.workspace-tab-item.active {
  background: var(--ws-bg-tab-active);
  color: #ffffff;
  font-weight: 500;
}

.workspace-tab-item.active::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--ws-primary);
  box-shadow: 0 1px 6px var(--ws-primary);
}

.workspace-tab-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ws-dirty-dot);
  display: inline-block;
  box-shadow: 0 0 6px rgba(255, 60, 67, 0.6);
}

/* CodeMirror 6 View Integration Styles */
.cm-editor {
  height: 100% !important;
  font-family: ui-monospace, "SF Mono", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace !important;
  font-size: 13px !important;
  background-color: var(--ws-bg-editor) !important;
  color: var(--ws-text-main) !important;
}

.cm-editor .cm-scroller {
  font-family: inherit !important;
  line-height: 1.65 !important;
  overflow: auto !important;
}

.cm-editor .cm-gutters {
  background-color: var(--ws-bg-gutter) !important;
  border-right: 1px solid var(--ws-border) !important;
  color: var(--ws-text-dim) !important;
  min-width: 44px;
}

.cm-editor .cm-activeLineGutter {
  background-color: rgba(255, 255, 255, 0.05) !important;
  color: var(--ws-text-main) !important;
}

.cm-editor .cm-activeLine {
  background-color: rgba(255, 255, 255, 0.03) !important;
}

.cm-editor .cm-cursor {
  border-left-color: #ff3c43 !important;
  border-left-width: 2px !important;
}

.cm-editor .cm-selectionBackground,
.cm-editor.cm-focused .cm-selectionBackground {
  background: rgba(255, 16, 24, 0.22) !important;
}

/* Responsive Touch Optimizations */
@media (max-width: 768px) {
  .cm-editor {
    font-size: 12px !important;
  }
  .cm-editor .cm-gutters {
    min-width: 36px;
    padding-right: 4px;
  }
  .workspace-tab-item {
    padding: 0 10px;
    min-height: 40px; /* touch friendly */
  }
}
```

---

## 4. Loading Skeletons & Empty States Design

### 4.1 `WorkspaceEmptyState.tsx` (Hero & Keyboard Shortcuts Hint)

When no files are currently open in the workspace, this component provides a clean visual backdrop with clear cues and keyboard shortcut hints.

```tsx
"use client";

import React from "react";
import { Code2, FolderOpen, Plus, Sparkles, Command } from "lucide-react";

interface WorkspaceEmptyStateProps {
  onOpenExplorer?: () => void;
  onNewFile?: () => void;
}

export function WorkspaceEmptyState({
  onOpenExplorer,
  onNewFile,
}: WorkspaceEmptyStateProps) {
  const shortcuts = [
    { key: "Ctrl + S", label: "บันทึกไฟล์ (Save)" },
    { key: "Ctrl + F", label: "ค้นหาข้อความ (Find)" },
    { key: "Ctrl + H", label: "แทนที่ข้อความ (Replace)" },
    { key: "Ctrl + B", label: "เปิด/ปิดแถบไฟล์ (Toggle Sidebar)" },
    { key: "Ctrl + W", label: "ปิดแท็บปัจจุบัน (Close Tab)" },
    { key: "Esc", label: "ปิดเมนู / หน้าต่าง (Close Dialog)" },
  ];

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center select-none overflow-y-auto">
      <div className="max-w-md w-full flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
        {/* Glowing Icon Badge */}
        <div className="relative mb-5 group">
          <div className="absolute -inset-2 bg-gradient-to-r from-red-600 to-rose-600 rounded-2xl blur-lg opacity-25 group-hover:opacity-40 transition-opacity" />
          <div className="relative w-16 h-16 rounded-2xl bg-[#12151f] border border-white/10 flex items-center justify-center text-[#ff3c43] shadow-xl">
            <Code2 size={32} />
          </div>
        </div>

        {/* Headlines */}
        <h3 className="text-lg font-bold text-slate-100 mb-1 tracking-tight">
          ไม่มีไฟล์ที่เปิดอยู่
        </h3>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed max-w-sm">
          เลือกไฟล์จากแถบสำรวจโฟลเดอร์ด้านซ้ายมือเพื่อเริ่มต้นดูหรือแก้ไขโค้ด หรือสร้างไฟล์ใหม่
        </p>

        {/* Quick Mobile / Desktop Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {onOpenExplorer && (
            <button
              type="button"
              onClick={onOpenExplorer}
              className="lg:hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-[#ff1018] hover:bg-[#e00008] shadow-[0_4px_16px_rgba(255,16,24,0.3)] transition-all"
            >
              <FolderOpen size={14} />
              <span>เปิด File Explorer</span>
            </button>
          )}

          {onNewFile && (
            <button
              type="button"
              onClick={onNewFile}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <Plus size={14} />
              <span>สร้างไฟล์ใหม่</span>
            </button>
          )}
        </div>

        {/* Keyboard Shortcuts Cheat Sheet */}
        <div className="w-full bg-[#0c0e15]/80 border border-white/[0.06] rounded-xl p-4 text-left">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-3 uppercase tracking-wider">
            <Command size={13} className="text-[#ff3c43]" />
            <span>คีย์ลัดที่ใช้บ่อย (Shortcuts)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {shortcuts.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white/[0.02]">
                <span className="text-[11px] text-slate-400 truncate">{item.label}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] font-mono text-slate-300 shadow-xs">
                  {item.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### 4.2 `CodeEditorSkeleton.tsx` (Editor Loading Shimmer)

Displayed while a newly selected file's raw content is fetched over the network from the backend.

```tsx
"use client";

import React from "react";

export function CodeEditorSkeleton() {
  // Generate mock line numbers & code lines of varying widths
  const mockLines = [
    { width: "w-[45%]", tint: "bg-purple-500/20" },
    { width: "w-[70%]", tint: "bg-blue-500/20" },
    { width: "w-[30%]", tint: "bg-emerald-500/20" },
    { width: "w-[85%]", tint: "bg-slate-500/20" },
    { width: "w-[55%]", tint: "bg-amber-500/20" },
    { width: "w-[40%]", tint: "bg-red-500/20" },
    { width: "w-[90%]", tint: "bg-slate-500/20" },
    { width: "w-[60%]", tint: "bg-cyan-500/20" },
    { width: "w-[35%]", tint: "bg-purple-500/20" },
    { width: "w-[75%]", tint: "bg-blue-500/20" },
    { width: "w-[50%]", tint: "bg-emerald-500/20" },
    { width: "w-[20%]", tint: "bg-slate-500/20" },
  ];

  return (
    <div className="h-full w-full flex bg-[#090b10] overflow-hidden select-none animate-pulse">
      {/* Line Numbers Gutter */}
      <div className="w-12 bg-[#0c0e15] border-r border-white/[0.08] py-3 flex flex-col items-center gap-2 flex-shrink-0">
        {Array.from({ length: 14 }).map((_, idx) => (
          <div key={idx} className="h-4 w-4 bg-white/[0.04] rounded text-[10px] text-transparent" />
        ))}
      </div>

      {/* Code Area Placeholder Lines */}
      <div className="flex-1 p-3 flex flex-col gap-2.5 overflow-hidden">
        {mockLines.map((line, idx) => (
          <div
            key={idx}
            className={`h-4 rounded ${line.width} ${line.tint} bg-white/[0.06]`}
          />
        ))}
      </div>
    </div>
  );
}
```

---

### 4.3 `FileTreeSkeleton.tsx` (Tree View Loading Shimmer)

Displayed during initial directory tree load or full tree refresh.

```tsx
"use client";

import React from "react";

export function FileTreeSkeleton() {
  const skeletonNodes = [
    { indent: "pl-2", width: "w-32", isFolder: true },
    { indent: "pl-6", width: "w-24", isFolder: false },
    { indent: "pl-6", width: "w-28", isFolder: false },
    { indent: "pl-2", width: "w-36", isFolder: true },
    { indent: "pl-6", width: "w-40", isFolder: false },
    { indent: "pl-10", width: "w-20", isFolder: false },
    { indent: "pl-2", width: "w-28", isFolder: false },
    { indent: "pl-2", width: "w-32", isFolder: false },
  ];

  return (
    <div className="p-2 space-y-1.5 animate-pulse select-none">
      {skeletonNodes.map((node, idx) => (
        <div key={idx} className={`flex items-center gap-2 py-1 ${node.indent}`}>
          <div className="w-4 h-4 rounded bg-white/[0.08] flex-shrink-0" />
          <div className={`h-3.5 rounded bg-white/[0.06] ${node.width}`} />
        </div>
      ))}
    </div>
  );
}
```

---

## 5. Mobile & Tablet Touch Ergonomics

### 5.1 Dynamic Viewport Height (`100dvh`)
On iOS WebKit and Android Chrome, standard `100vh` causes bottom controls to be pushed beneath the viewport when browser navigation bars or virtual keyboards are active.
- `CodeWorkspaceModal` uses `h-[100dvh]` to guarantee that the header, tab bar, editor canvas, and status bar fit strictly inside the visible interactive viewport.

### 5.2 Touch-Friendly Tab Scrolling
- The Tab Bar (`WorkspaceTabBar.tsx`) incorporates `overflow-x-auto`, `-webkit-overflow-scrolling: touch`, `touch-pan-x`, and `scroll-smooth`.
- When an inactive tab is clicked or tapped, it automatically calls `tabElement.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })` to ensure the active tab remains in full view.
- Tab close hit targets on mobile are padded (`min-w-[28px] min-h-[28px]`) to avoid accidental mis-taps.

### 5.3 Off-Canvas Sliding Drawer Mechanics
- Mobile drawer triggers via the hamburger icon (`PanelLeft`) in `WorkspaceHeader`.
- Overlay backdrop (`bg-black/70 backdrop-blur-xs`) captures outside clicks to dismiss.
- Selecting any file automatically closes the mobile drawer and focuses the editor view for uninterrupted coding.

---

## 6. Verification & Test Plan

1. **Responsive Viewport Verification**:
   - Test at standard resolutions:
     - Desktop: `1920x1080`, `1440x900`, `1280x800`
     - Tablet: `768x1024` (iPad portrait), `1024x768` (iPad landscape)
     - Mobile: `390x844` (iPhone 14/15), `412x915` (Samsung Galaxy S20/S24)
2. **CSS Token & Dark Theme Conformance**:
   - Verify no styling collisions with existing `.system-dialog-backdrop`, `.file-manager-dialog`, or `.modal-backdrop` classes.
   - Verify that `--primary: #ff1018` is respected across tab indicators, save buttons, and selection glows.
3. **Empty States & Skeletons**:
   - Verify `WorkspaceEmptyState` displays when `tabs.length === 0`.
   - Verify `CodeEditorSkeleton` renders smoothly during `activeFileLoading`.
   - Verify `FileTreeSkeleton` renders while `treeLoading === true`.
4. **Keyboard & Touch Accessibility**:
   - Verify `Ctrl+S`, `Ctrl+B`, `Ctrl+W`, and `Esc` function as specified.
