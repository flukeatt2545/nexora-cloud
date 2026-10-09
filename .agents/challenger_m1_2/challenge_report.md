# Empirical Challenge Report — Milestone 1: Workspace Context Menu, Status Bar & Tab State

## Challenge Summary

- **Target Milestone**: Milestone 1 (Workspace UI Components & Dependencies)
- **Review Role**: Challenger 2 (Empirical Challenger / Adversarial Tester)
- **Overall Risk Assessment**: LOW
- **Verdict**: **APPROVE**

---

## 1. Executive Summary

Milestone 1 establishes the VS Code-style Code Workspace UI architecture for NEXORA Cloud Hosting, including context menu positioning, viewer access role enforcement, and multi-tab state tracking. As Challenger 2, an empirical stress harness was constructed to independently challenge and verify the implementation across edge cases, boundary collisions, permission filtering, and event handling.

A dedicated test suite `tests/e2e/code-workspace/m1-challenger-stress.test.mjs` (22 test cases) was created and run alongside `tests/e2e/code-workspace/tier1-feature-coverage.test.mjs` (93 test cases). All 115 tests passed with 0 errors or regressions.

---

## 2. Challenge Findings by Dimension

### Dimension 1: Context Menu Positioning & Boundary Clamping Logic
- **Scope**: `FileContextMenu.tsx` viewport collision calculation, coordinate clamping, dynamic height estimation, divider filtering.
- **Assumptions Tested**:
  1. *Safe viewport positioning*: Menu renders at exact cursor position `(x, y)` when unobstructed.
  2. *Right overflow*: Clamps `x` to `window.innerWidth - MENU_WIDTH - EDGE_PADDING` (e.g. `1920 - 220 - 8 = 1692px`).
  3. *Bottom overflow*: Dynamically calculates height based on item count (`Math.min(items.length * 32 + 20, 360)`) and clamps `y` cleanly.
  4. *Simultaneous corner collisions*: Both X and Y axes clamp independently and correctly.
  5. *Narrow / sub-menu viewports (<220px / 320px)*: `Math.max(EDGE_PADDING, ...)` prevents negative coordinates.
  6. *Divider cleanup*: Consecutive, leading, and trailing dividers are eliminated during dynamic item filtering.
- **Results**:
  - `Challenge 1.1`: Safe viewport bounds -> `PASS`
  - `Challenge 1.2`: Right boundary overflow clamp -> `PASS`
  - `Challenge 1.3`: Bottom boundary overflow clamp -> `PASS`
  - `Challenge 1.4`: Corner collision clamp -> `PASS`
  - `Challenge 1.5`: Mobile viewport (320px) clamp -> `PASS`
  - `Challenge 1.6`: Sub-menu viewport (200px) clamp to `EDGE_PADDING (8px)` -> `PASS`
  - `Challenge 1.7`: Dynamic height capping at 360px -> `PASS`
  - `Challenge 1.8`: Divider normalization -> `PASS`

### Dimension 2: Viewer Role Restriction Logic in Status Bar & Context Menu
- **Scope**: `FileContextMenu.tsx` and `WorkspaceStatusBar.tsx` role propagation and permission gates.
- **Assumptions Tested**:
  1. *Context Menu Viewer restriction*: When `accessRole === "viewer"`, mutating actions (`new_file`, `new_folder`, `rename`, `delete`, `archive_zip`, `extract_zip`) are excluded. Non-mutating actions (`open_editor`, `download`, `copy_path`, `copy_name`, `refresh`) remain available.
  2. *Owner / Developer permissions*: Mutating actions are available when appropriate callbacks are supplied.
  3. *ZIP extraction role gate*: `extract_zip` only appears for non-viewer roles.
  4. *Status Bar role badge*: `role === "viewer"` renders `<ShieldAlert />` with `Viewer (Read-Only)` styling; non-viewers render `<Check />` with capitalized role.
  5. *Status Bar telemetry*: Renders `/path`, `Unsaved` badge, `กำลังบันทึก...` pulse, line/col tracking, `UTF-8`, `Spaces: 4`, and uppercase language identifier.
- **Results**:
  - `Challenge 2.1`: Context menu viewer file restrictions -> `PASS`
  - `Challenge 2.2`: Context menu owner file actions -> `PASS`
  - `Challenge 2.3`: ZIP extract action role filtering -> `PASS`
  - `Challenge 2.4`: Status bar role badge contract -> `PASS`
  - `Challenge 2.5`: Status bar telemetry formatting -> `PASS`

### Dimension 3: Tab Closing, Middle Click & Active Tab Switching Logic
- **Scope**: `WorkspaceTabBar.tsx`, `WorkspaceTabItem.tsx`, buffer switching, mouse event handling.
- **Assumptions Tested**:
  1. *Independent buffer isolation*: Edits on one tab do not leak or mark other tabs dirty.
  2. *Closing non-active tab*: Retains currently active tab ID without jump.
  3. *Closing active tab*: Automatically shifts selection to adjacent tab (previous if closing last, next if closing first).
  4. *Closing sole tab*: Safely clears `tabs` array and sets `activeTabId = null`.
  5. *Middle-click closing*: Uses `onAuxClick` with `e.button === 1`, calling `e.preventDefault()`, `e.stopPropagation()`, and `onCloseTab(tab.id, e)`.
  6. *Dirty indicator dot vs Close button*: Shows `#ff3c43` red dot by default on dirty tabs; swaps to close `X` button on group hover.
  7. *Mouse wheel horizontal translation*: Converts vertical `e.deltaY` to `scrollLeft += e.deltaY`.
- **Results**:
  - `Challenge 3.1`: Tab buffer isolation & switching -> `PASS`
  - `Challenge 3.2`: Non-active tab closure -> `PASS`
  - `Challenge 3.3`: Rightmost active tab closure fallback -> `PASS`
  - `Challenge 3.4`: Leftmost active tab closure fallback -> `PASS`
  - `Challenge 3.5`: Sole tab closure reset -> `PASS`
  - `Challenge 3.6`: Middle click `e.button === 1` validation -> `PASS`
  - `Challenge 3.7`: TabItem dirty dot & hover reveal contract -> `PASS`
  - `Challenge 3.8`: Tab bar horizontal wheel translation -> `PASS`
  - `Challenge 3.9`: Module export integrity -> `PASS`

---

## 3. Stress Test Results Summary

| Test Suite | Total Tests | Passed | Failed | Execution Time |
|---|---|---|---|---|
| `tier1-feature-coverage.test.mjs` | 93 | 93 | 0 | ~1.3s |
| `m1-challenger-stress.test.mjs` | 22 | 22 | 0 | ~0.2s |
| **Total** | **115** | **115** | **0** | **~1.5s** |

---

## 4. Unchallenged Areas
- **Milestone 2 Scope**: CodeMirror 6 engine instantiation (`CodeEditor.tsx`), syntax highlighting parsers, AST folding, search/replace bar integration.
- **Milestone 3 Scope**: Hosting backend API sync (`/api/hosting/sites/:id/files/...`), Diff confirmation modal dialog, and full `HostingView.tsx` replacement.

---

## 5. Final Verdict

**Verdict**: `APPROVE`  
The Milestone 1 implementation is robust, adheres strictly to specifications, safely handles boundary clamping and edge cases, strictly enforces viewer read-only security constraints, and provides comprehensive VS Code-style tab and context menu ergonomics.
