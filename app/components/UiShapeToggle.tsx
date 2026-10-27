"use client";

import { Circle, Diamond } from "lucide-react";
import { useEffect, useState } from "react";
import { currentUiShape, setUiShape, UI_SHAPE_EVENT, UI_SHAPE_KEY, type UiShape } from "../uiShape";

/** Switches the site between the rounded UI and the square one (app/uiShape.ts). */
export default function UiShapeToggle({ className = "" }: { className?: string }) {
  const [shape, setShape] = useState<UiShape>("round");

  useEffect(() => {
    const sync = () => setShape(currentUiShape());
    // Another tab changed it: follow along.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== UI_SHAPE_KEY) return;
      setUiShape(event.newValue === "square" ? "square" : "round");
    };
    sync();
    window.addEventListener(UI_SHAPE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(UI_SHAPE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const square = shape === "square";
  const label = square ? "เปลี่ยนเป็น UI แบบมน" : "เปลี่ยนเป็น UI แบบเหลี่ยม";
  return (
    <button
      type="button"
      className={`ui-shape-toggle ${className}`.trim()}
      aria-label={label}
      title={label}
      aria-pressed={square}
      onClick={() => setUiShape(square ? "round" : "square")}
    >
      {square ? <Circle size={17} aria-hidden="true" /> : <Diamond size={17} aria-hidden="true" />}
    </button>
  );
}
