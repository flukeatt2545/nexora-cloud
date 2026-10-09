# Handoff Report: Responsive Workspace Shell, Theming & Skeletons (Milestone 1)

**Agent**: Explorer 3 (Responsive Layout, Theming & Workspace Shell Specialist)  
**Target**: Orchestrator / Milestone 1 Implementation Team  
**Date**: 2026-08-30  
**Working Directory**: `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_3\`  

---

## 1. Observation

1. **Legacy File Manager Structure**:
   - In `app/dashboard/HostingView.tsx` (lines 1748–1795), the current file manager is rendered inside `.system-dialog-backdrop.file-manager-backdrop` with a rigid 2-column modal (`.file-manager-dialog`, lines 5028–5046 of `dashboard.css`) that switches to a stacked vertical layout on mobile (`@media(max-width:760px)`), squeezing both the file list and textarea into fixed percentages (`grid-template-rows: minmax(170px, 35vh) minmax(0, 1fr)`).
2. **CSS Variables & Design System Alignment**:
   - `app/globals.css` (lines 96–127) and `app/theme.css` (lines 6–49) specify master dark theme variables:
     - `--primary: #ff1018`
     - `--primary-rgb: 255 16 24`
     - `--background: #08090d`
     - `--dash-bg: #090a0e`
     - `--dash-card: #13151f`
     - `--theme-elevated: #151723`
     - `--theme-input: rgba(18, 20, 28, .88)`
     - `--theme-text-strong: #edf1f5`
     - `--theme-text-soft: #9ba7b5`
   - `globals.css` line 133–146 locks scrolling on `html:has(.system-dialog-backdrop), body:has(.system-dialog-backdrop), html.modal-open, body.modal-open`.
3. **Responsive Requirements & Mobile Viewport**:
   - `PROJECT.md` §Architecture and §Feature 10 require a 100dvh modal layout, off-canvas sliding drawer for file explorer on mobile/tablet, horizontal touch scrolling tab strip, and a 2-column collapsible layout on desktop.
4. **Empty State & Skeleton Expectations**:
   - When no files are open or when loading files over the network, `ORIGINAL_REQUEST.md` and `PROJECT.md` require responsive feedback with loading skeletons and an empty state guiding the user to open files or use shortcuts.

---

## 2. Logic Chain

1. *From Observation 1*: The legacy file manager in `HostingView.tsx` uses a constrained modal structure that collapses poorly on mobile and lacks IDE-level ergonomics. Refactoring to a unified `CodeWorkspaceModal.tsx` container with dedicated CSS (`workspace.css`) provides complete control over viewport scaling, tab scrolling, and drawer navigation.
2. *From Observation 2*: By anchoring the Obsidian dark theme palette to the existing CSS variables (`#ff1018`, `#090b10`, `#0c0e15`, `#0e1017`, `#141722`), the new workspace will seamlessly match the rest of NEXORA Cloud while providing high contrast, low glare readability for extended coding sessions.
3. *From Observation 3*: Utilizing `100dvh` (Dynamic Viewport Height) prevents iOS Safari and Android Chrome viewport jitter and virtual keyboard clipping. On viewports `< 1024px`, transitioning the sidebar into an off-canvas drawer (`fixed inset-y-0 left-0 w-[82vw] max-w-[320px]`) ensures maximum horizontal screen real estate for editing code.
4. *From Observation 4*: Introducing `WorkspaceEmptyState` (with hero icon, clear Thai/English guidance, and a keyboard shortcuts cheat sheet), `CodeEditorSkeleton`, and `FileTreeSkeleton` prevents layout shifts (CLS) and provides immediate, polished visual feedback during asynchronous API requests.

---

## 3. Caveats

- **Z-Index Coordination**: The modal uses `z-[99999]` and `system-dialog-backdrop` to ensure it renders above all dashboard topbars (`z-30`) and navigation sidebars (`z-60`). Any future child dialogs (`DiffDialog`, `UnsavedConfirmDialog`) must render above `z-[99999]` (e.g. `z-[100000]`).
- **Touch Gutter Dimensions**: On mobile touch screens, CodeMirror line number gutters are configured with a minimum touch hit target (`36px`) and horizontal touch panning is preserved.

---

## 4. Conclusion

The layout, Obsidian dark theming, responsive drawer mechanics, loading skeletons, and empty state architecture for Milestone 1 are fully designed and documented in `plan.md`. The design is 100% compatible with existing CSS variables in `globals.css` and `dashboard.css`, cleanly isolates styling into `app/components/code-workspace/workspace.css`, and provides a best-in-class mobile and desktop IDE experience.

---

## 5. Verification Method

1. **Inspect Plan Artifact**:
   - View `c:\Users\nkn246\Desktop\nkn-v6-new-ui\.agents\explorer_m1_3\plan.md` to verify complete component designs for `CodeWorkspaceModal.tsx`, `WorkspaceEmptyState.tsx`, `CodeEditorSkeleton.tsx`, `FileTreeSkeleton.tsx`, and `workspace.css`.
2. **CSS Class Verification**:
   - Check that all CSS classes and variables match the tokens in `app/globals.css` and `app/theme.css`.
3. **Build & Syntax Test**:
   - Run `npm run build` or `vinext build` once components are implemented to confirm zero compilation or stylesheet bundling errors.
