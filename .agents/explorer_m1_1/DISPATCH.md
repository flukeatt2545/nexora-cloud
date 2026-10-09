## 2026-08-29T21:48:00Z
You are Explorer 1 for Milestone 1 (Workspace UI Components, Tree & Dependencies).

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Master Project Architecture: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md
- UI Survey Report: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_survey_ui\survey_report.md

YOUR MISSION:
Produce the detailed implementation blueprint for Milestone 1:
1. `package.json` dependency updates: All required `@codemirror/*` packages and language packs.
2. `app/components/code-workspace/types.ts`: Define all TypeScript interfaces for tabs, tree nodes, icons, actions, context menu items, status bar items.
3. `app/components/code-workspace/FileIcon.tsx`: Comprehensive extension-to-Lucide icon mapping with distinct colors for PHP, JS, TS, HTML, CSS, JSON, Python, Go, SQL, Markdown, YAML, Shell, Docker, Nginx, Images, Archives, Audio/Video, etc.
4. `app/components/code-workspace/FileTreeNode.tsx` & `FileTree.tsx`: Hierarchical tree rendering, indentation guides, expand/collapse chevron toggles, lazy load spinner on folder expand, selection highlighting, keyboard navigation (ArrowUp, ArrowDown, ArrowRight, ArrowLeft, Enter), right-click context menu trigger.
5. `app/components/code-workspace/WorkspaceTabBar.tsx` & `WorkspaceTabItem.tsx`: Scrollable tab bar with active tab indicator, dirty state dot (`•`), close button (`X`), middle-click to close, click to switch tab.
6. `app/components/code-workspace/WorkspaceStatusBar.tsx`: Bottom status bar showing file path, encoding, language mode, line/col, role tag.
7. `app/components/code-workspace/WorkspaceSidebar.tsx`: Sidebar shell with action header (New File, New Folder, Upload, Refresh, Collapse All), search filter for tree, and storage summary.

OUTPUT REQUIREMENTS:
- Working directory: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_1\`
- Maintain `progress.md` with liveness updates.
- Write implementation plan to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_1\plan.md`
- Write handoff report to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_1\handoff.md`
- Send a message when finished.
