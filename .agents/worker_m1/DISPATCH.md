## 2026-08-29T21:49:38Z
You are the Implementation Worker for Milestone 1: VS Code-Style Workspace UI Components & CodeMirror Dependencies.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY INPUTS:
- Authoritative User Request: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\ORIGINAL_REQUEST.md
- Master Project Architecture: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\PROJECT.md
- Explorer 1 Plan: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_1\plan.md
- Explorer 2 Plan: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_2\plan.md
- Explorer 3 Plan: c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_3\plan.md

WRITE OWNERSHIP (Exclusively owned files for Milestone 1):
1. `package.json` (install `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/autocomplete`, `@lezer/highlight`, `@codemirror/lang-javascript`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json`, `@codemirror/lang-python`, `@codemirror/lang-php`, `@codemirror/lang-sql`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `@codemirror/lang-go`, `@codemirror/legacy-modes` using `npm install`)
2. `app/components/code-workspace/types.ts`
3. `app/components/code-workspace/FileIcon.tsx`
4. `app/components/code-workspace/FileTreeNode.tsx`
5. `app/components/code-workspace/FileTree.tsx`
6. `app/components/code-workspace/FileContextMenu.tsx`
7. `app/components/code-workspace/WorkspaceTabItem.tsx`
8. `app/components/code-workspace/WorkspaceTabBar.tsx`
9. `app/components/code-workspace/WorkspaceStatusBar.tsx`
10. `app/components/code-workspace/WorkspaceSidebar.tsx`

YOUR TASK:
1. Update `package.json` and install all CodeMirror 6 packages.
2. Implement all Milestone 1 components in `app/components/code-workspace/` according to the blueprints in `plan.md`.
3. Verify that the components compile cleanly without TypeScript errors and adhere to the project's styling and ARIA accessibility standards.
4. Run build verification (e.g. `npm run build` or typecheck) to ensure no syntax/import breakage.

OUTPUT REQUIREMENTS:
- Working directory: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\worker_m1\`
- Maintain `progress.md` with liveness updates.
- Write handoff report with verification commands and output to `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\worker_m1\handoff.md`.
- Send a message when finished.
