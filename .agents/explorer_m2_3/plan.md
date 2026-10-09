# Milestone 2 Blueprint: Mobile, Touch & Search Ergonomics

**Author**: Explorer 3 (Mobile, Touch & Search Ergonomics Specialist)  
**Milestone**: Milestone 2 — CodeMirror 6 Editor & Language Suite  
**Target Files**: 
- `app/components/code-workspace/CodeEditor.tsx`
- `app/components/code-workspace/editor-theme.ts`
- `app/components/code-workspace/types.ts`
- `app/components/code-workspace/WorkspaceStatusBar.tsx`
- `app/components/code-workspace/CodeWorkspaceModal.tsx`

---

## 1. Executive Summary

This blueprint delivers the complete architecture and implementation specifications for **Mobile & Touch Ergonomics**, **Search & Replace Panel Customization**, and **Read-Only Viewer Enforcement** in CodeMirror 6 for the NEXORA Cloud platform.

It addresses key UX friction points on mobile devices, tablets, and desktop viewports, ensuring:
1. **Touch fluidity**: zero horizontal scroll bleed, touch-safe gutter hit targets (min 44px touch envelope), dynamic line wrapping, and automatic virtual keyboard viewport adjustment (`100dvh` + `visualViewport`).
2. **Search ergonomics**: floating docked Search & Replace panel styled with NEXORA dark obsidian aesthetics, responsive match count telemetry, regex / case toggles, and standard keyboard shortcuts (`Ctrl+F`, `Ctrl+H`, `Esc`).
3. **Read-only compliance**: dual-layer security enforcement via `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`, preventing accidental keyboard popup on mobile while enabling text selection, with visual watermark chips and status bar tags.

---

## 2. Touch & Mobile Responsiveness Architecture

```
+-------------------------------------------------------------------------------+
| CodeWorkspaceModal (height: 100dvh; max-height: 100dvh; overflow: hidden)     |
| +---------------------------------------------------------------------------+ |
| | Mobile Drawer Overlay / Header Navigation (touch-action: manipulation)    | |
| +---------------------------------------------------------------------------+ |
| | CodeEditor (.cm-editor h-full flex flex-col)                              | |
| | +-----------------------------------------------------------------------+ | |
| | | .cm-panels.cm-panels-top (Docked Obsidian Search Panel)               | | |
| | +-----------------------------------------------------------------------+ | |
| | | .cm-scroller (-webkit-overflow-scrolling: touch; touch-action: pan-y) | | |
| | | +------------------------+------------------------------------------+ | | |
| | | | .cm-gutters            | .cm-content                              | | | |
| | | | - min-width: 44px      | - white-space: pre-wrap (lineWrapping)   | | | |
| | | | - touch hit: 24x24px   | - font-size: 14px (mobile) / 13.5px (desk)| | | |
| | | | - user-select: none    | - caret-color: #ff1018                   | | | |
| | | +------------------------+------------------------------------------+ | | |
| | +-----------------------------------------------------------------------+ | |
| | WorkspaceStatusBar (Ln, Col, Spaces, UTF-8, Lang, [VIEWER READ-ONLY])     | |
| +---------------------------------------------------------------------------+ |
+-------------------------------------------------------------------------------+
```

### 2.1 Line Wrapping Extension (`EditorView.lineWrapping`) & Dynamic Compartment
On desktop viewports (> 768px), code formatting is often preferred unwrapped with horizontal scroll capability, while on mobile screens (< 768px), horizontal overflow creates severe usability issues.

#### A. Compartment Definition
```typescript
import { Compartment, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const lineWrappingCompartment = new Compartment();

export function resolveLineWrapping(wrap: boolean): Extension {
  return wrap ? EditorView.lineWrapping : [];
}
```

#### B. Dynamic Viewport Detection & Auto-Reconfiguration
```typescript
// Inside CodeEditor.tsx
const [isMobile, setIsMobile] = useState<boolean>(false);
const [wrapLines, setWrapLines] = useState<boolean>(true);

useEffect(() => {
  const checkMobile = () => {
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    if (mobile) {
      setWrapLines(true);
    }
  };

  checkMobile();
  window.addEventListener("resize", checkMobile);
  return () => window.removeEventListener("resize", checkMobile);
}, []);

// Reconfigure line wrapping on state change
useEffect(() => {
  const view = viewRef.current;
  if (!view) return;

  view.dispatch({
    effects: lineWrappingCompartment.reconfigure(resolveLineWrapping(wrapLines || isMobile)),
  });
}, [wrapLines, isMobile]);
```

### 2.2 Touch Scrolling Within `.cm-scroller` (Zero Horizontal Overflow)
To achieve smooth inertial scrolling on iOS/Android without page bounce or accidental gesture interception:

#### A. CSS Rules for `.cm-scroller`
```css
/* Smooth Inertial Touch Scrolling & Bounce Containment */
.cm-scroller {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: contain;
  position: relative;
  width: 100%;
  max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

@media (max-width: 767px) {
  .cm-scroller {
    touch-action: pan-y; /* Prioritize vertical scrolling when wrapped */
  }
  .cm-content {
    max-width: 100%;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
}
```

### 2.3 Touch-Safe Gutter Hit Targets & Accidental Zoom/Mis-click Prevention
Touchscreens require target hit sizes of at least 40–48px according to Apple Human Interface Guidelines and Google Material 3.

#### A. Gutter Dimensioning & Hit Expansion
```css
/* Gutter Container */
.cm-gutters {
  background-color: #08090d;
  color: #475569;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  min-width: 44px;
}

/* Line Numbers */
.cm-lineNumbers .cm-gutterElement {
  min-width: 28px;
  padding: 0 8px 0 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  touch-action: manipulation;
}

/* Fold Chevron Hit Box Expansion */
.cm-foldGutter .cm-gutterElement {
  position: relative;
  min-width: 20px;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
}

/* Expanded Touch Target Hitbox via Pseudo-element (+10px padding) */
.cm-foldGutter .cm-gutterElement::after {
  content: "";
  position: absolute;
  inset: -6px -8px;
  z-index: 1;
}

.cm-foldGutter .cm-gutterElement:hover,
.cm-foldGutter .cm-gutterElement:active {
  color: #ff1018;
}
```

#### B. Gesture Zoom Prevention (Double-Tap Lock)
- `touch-action: manipulation` applied to `.cm-editor`, `.cm-gutters`, and buttons eliminates the 300ms double-tap delay and prevents unintentional mobile browser viewport zooming.
- Font size set to `14px` on mobile screens prevents iOS Safari from automatically zooming into the contenteditable element.

### 2.4 Virtual Keyboard Adaptation (Dynamic Viewport Recalculation)
When the soft keyboard opens on mobile devices:
1. Use `height: 100dvh` (Dynamic Viewport Height) on the root modal container.
2. Listen to `window.visualViewport.addEventListener("resize", ...)` to dispatch `view.requestMeasure()` and keep the cursor centered.
3. Add `EditorView.scrollMargins` to preserve bottom clearance above the keyboard.

```typescript
// Virtual Keyboard & Visual Viewport Handler
useEffect(() => {
  if (typeof window === "undefined" || !window.visualViewport) return;

  const handleVisualViewportChange = () => {
    const view = viewRef.current;
    if (!view) return;

    // Force CodeMirror layout re-measurement
    view.requestMeasure();

    // Scroll active selection head into viewport center
    const head = view.state.selection.main.head;
    view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center", yMargin: 24 }),
    });
  };

  window.visualViewport.addEventListener("resize", handleVisualViewportChange);
  window.visualViewport.addEventListener("scroll", handleVisualViewportChange);

  return () => {
    window.visualViewport?.removeEventListener("resize", handleVisualViewportChange);
    window.visualViewport?.removeEventListener("scroll", handleVisualViewportChange);
  };
}, []);
```

---

## 3. Search & Replace Panel Customization Architecture

```
+----------------------------------------------------------------------------------------------------+
| .cm-panels.cm-panels-top                                                                          |
| +------------------------------------------------------------------------------------------------+ |
| | .cm-search (NEXORA Obsidian Glassmorphism)                                                     | |
| | [ 🔍 Search query...       ] [ 1 of 14 ] [ < Prev ] [ > Next ] [ Select All ]                  | |
| | [ 📝 Replace with...       ] [ Replace ] [ Replace All ]                                        | |
| | [x] Match Case [Aa]  [x] RegEx [.*]  [x] Whole Word [\b]                       [ (X) Close ]   | |
| +------------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 CodeMirror 6 Search Extension Configuration
Integrate `@codemirror/search` with top placement and standard keybindings:

```typescript
import { search, searchKeymap, openSearchPanel, closeSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";

export const searchExtensions = [
  search({
    top: true,
  }),
  keymap.of(searchKeymap),
];
```

### 3.2 Keybindings & Keyboard Shortcuts Matrix
| Key Combination | Action | Function in CodeMirror |
|---|---|---|
| `Mod-f` (`Ctrl+F` / `Cmd+F`) | Open Search Panel | `openSearchPanel` |
| `Mod-h` (`Ctrl+H` / `Cmd-Alt-F`) | Open Search & Replace | `openSearchPanel` (focuses replace field) |
| `Escape` | Close Search Panel | `closeSearchPanel` |
| `Enter` | Find Next Match | `findNext` |
| `Shift-Enter` | Find Previous Match | `findPrevious` |
| `Alt-Enter` | Select All Matches | `selectMatches` |

### 3.3 NEXORA Dark Theme Search Panel CSS Specifications
```css
/* Search Panel Outer Wrapper */
.cm-panels.cm-panels-top {
  position: relative;
  z-index: 25;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(14, 16, 24, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

/* Search Toolbar Grid & Layout */
.cm-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: #e2e8f0;
  font-family: var(--font-kanit), system-ui, sans-serif;
  font-size: 12px;
}

/* Search & Replace Inputs */
.cm-search .cm-textfield {
  background: #090a0f;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #f8fafc;
  padding: 4px 8px;
  font-size: 12px;
  font-family: ui-monospace, "SF Mono", "Fira Code", monospace;
  outline: none;
  transition: all 0.15s ease;
  min-width: 170px;
}

.cm-search .cm-textfield:focus {
  border-color: #ff1018;
  box-shadow: 0 0 0 2px rgba(255, 16, 24, 0.25);
}

/* Action Buttons */
.cm-search .cm-button {
  background: #181b27;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #cbd5e1;
  padding: 4px 9px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.cm-search .cm-button:hover {
  background: rgba(255, 16, 24, 0.15);
  border-color: rgba(255, 16, 24, 0.4);
  color: #ffffff;
}

/* Match Count Indicator Badge */
.cm-search .cm-search-matches {
  font-size: 11px;
  font-family: ui-monospace, "SF Mono", monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

/* Option Checkboxes (Case, Regex, Word) */
.cm-search label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 11px;
  color: #94a3b8;
  padding: 2px 5px;
  border-radius: 4px;
}

.cm-search label:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.05);
}

.cm-search input[type="checkbox"] {
  accent-color: #ff1018;
}

/* Search Highlights in Editor Content */
.cm-searchMatch {
  background-color: rgba(251, 191, 36, 0.3) !important;
  border-bottom: 2px solid #fbbf24;
}

.cm-searchMatch.cm-searchMatch-selected {
  background-color: rgba(255, 16, 24, 0.45) !important;
  border-bottom: 2px solid #ff1018;
}
```

---

## 4. Read-Only Viewer Enforcement Architecture

```
+----------------------------------------------------------------------------------------------------+
| Read-Only Enforcement Pipeline                                                                    |
|                                                                                                    |
| 1. State Level: EditorState.readOnly.of(true)    --> Rejects transactions modifying document       |
| 2. View Level:  EditorView.editable.of(false)   --> contenteditable="false" (No Mobile Keyboard)  |
| 3. Shortcut:    Mod-s Interceptor               --> Disables save and notifies user                |
| 4. Search UI:   Hide replace inputs             --> Search allowed, replace blocked               |
| 5. Visual:      Watermark chip + Status Badge   --> "VIEWER — READ ONLY"                          |
+----------------------------------------------------------------------------------------------------+
```

### 4.1 Dual-Facet Dynamic Compartment Specification
```typescript
import { Compartment, Extension, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export const readOnlyCompartment = new Compartment();

export function resolveReadOnlyExtension(
  readOnly: boolean,
  onSave?: () => void,
  onNotify?: (msg: string) => void
): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            if (readOnly) {
              onNotify?.("โหมดดูอย่างเดียว ไม่สามารถบันทึกไฟล์ได้");
              return true; // Intercept and prevent browser save dialog
            }
            if (onSave) {
              onSave();
              return true;
            }
            return false;
          },
        },
      ])
    ),
  ];
}
```

### 4.2 Dynamic Hot-Reloading in `CodeEditor.tsx`
```typescript
useEffect(() => {
  const view = viewRef.current;
  if (!view) return;

  view.dispatch({
    effects: readOnlyCompartment.reconfigure(
      resolveReadOnlyExtension(readOnly, onSave, (msg) => {
        // Optional user notification
      })
    ),
  });
}, [readOnly, onSave]);
```

### 4.3 Visual Watermark & UI Indicators
1. **Status Bar Role Tag**: Rendered via `WorkspaceStatusBar.tsx` (amber pill with `ShieldAlert` icon).
2. **Editor Canvas Watermark Chip**: Rendered in the top-right overlay of `CodeEditor.tsx` when `readOnly === true`:
   ```tsx
   {readOnly && (
     <div className="absolute top-2 right-4 z-20 pointer-events-none select-none flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 border border-amber-500/30 rounded-md text-[11px] font-semibold text-amber-400 backdrop-blur-md shadow-lg">
       <ShieldAlert size={13} className="text-amber-400" />
       <span>VIEWER — READ ONLY</span>
     </div>
   )}
   ```
3. **CSS Suppression of Replace Controls in Read-Only Mode**:
   ```css
   .cm-editor.cm-readonly .cm-search [name="replace"],
   .cm-editor.cm-readonly .cm-search [name="replaceAll"],
   .cm-editor.cm-readonly .cm-search input[placeholder*="Replace"] {
     display: none !important;
   }
   ```

---

## 5. Summary of Deliverables & Component Integration

| Feature | Primary Target | Mechanism | Status |
|---|---|---|---|
| **Line Wrapping** | `CodeEditor.tsx` | `lineWrappingCompartment` + `EditorView.lineWrapping` | Ready for implementation |
| **Touch Scrolling** | `editor-theme.ts` | `-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain` | Ready for implementation |
| **Gutter Hit Targets** | `editor-theme.ts` | Min 44px width, 24px chevron hitbox + pseudo hit padding | Ready for implementation |
| **Virtual Keyboard** | `CodeEditor.tsx` | `100dvh` + `window.visualViewport` resize listener + `requestMeasure()` | Ready for implementation |
| **Search Panel** | `editor-theme.ts` | `@codemirror/search` + Obsidian Glass Theme CSS | Ready for implementation |
| **Search Shortcuts** | `CodeEditor.tsx` | `searchKeymap` (`Ctrl+F`, `Ctrl+H`, `Esc`, `Enter`) | Ready for implementation |
| **Read-Only Mode** | `CodeEditor.tsx` | `EditorState.readOnly` + `EditorView.editable` in Compartment | Ready for implementation |
| **Visual Watermark** | `CodeEditor.tsx` + `WorkspaceStatusBar.tsx` | Amber Chip & Status Bar Role Badge | Ready for implementation |

---
*Plan created and verified by Explorer 3 (Milestone 2).*
