"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Crosshair, Minus, Move, Plus, Trash2 } from "lucide-react";
import { DEFAULT_COVER_CROP, clampCoverCrop, coverCropStyle, type CoverCrop } from "../lib/coverCrop";
import NoCoverArt from "./NoCoverArt";

/**
 * Square preview of a product cover in the same frame the store card uses. Drag (or use the
 * arrow keys) to choose which part shows, zoom with the slider. Nothing is uploaded: the
 * focus point and zoom are saved with the product and applied when the cover is displayed.
 */
export default function CoverCropper({
  src,
  value,
  onChange,
  onRemove,
}: {
  src: string;
  value: CoverCrop | null | undefined;
  onChange: (crop: CoverCrop | null) => void;
  onRemove: () => void;
}) {
  const crop = clampCoverCrop(value || DEFAULT_COVER_CROP);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: CoverCrop } | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  function update(next: CoverCrop) {
    const clamped = clampCoverCrop(next);
    const isDefault = clamped.x === 50 && clamped.y === 50 && clamped.zoom === 1;
    onChange(isDefault ? null : clamped);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: crop };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const frame = frameRef.current;
    if (!state || state.pointerId !== event.pointerId || !frame) return;
    const size = frame.getBoundingClientRect();
    // Dragging the picture right reveals more of its left side, so the focus point moves left.
    const speed = 140 / state.origin.zoom;
    update({
      ...state.origin,
      x: state.origin.x - ((event.clientX - state.startX) / size.width) * speed,
      y: state.origin.y - ((event.clientY - state.startY) / size.height) * speed,
    });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setDragging(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      update({ ...crop, x: crop.x + moves[event.key][0], y: crop.y + moves[event.key][1] });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      update({ ...crop, zoom: crop.zoom + 0.1 });
    } else if (event.key === "-") {
      event.preventDefault();
      update({ ...crop, zoom: crop.zoom - 0.1 });
    }
  }

  return (
    <div className="cover-cropper">
      <div
        ref={frameRef}
        className={`cover-cropper-frame${dragging ? " is-dragging" : ""}`}
        tabIndex={0}
        role="group"
        aria-label="ลากหรือใช้ปุ่มลูกศรเพื่อเลือกส่วนของรูปปก ปุ่ม + และ - เพื่อซูม"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {failed ? (
          <NoCoverArt variant="error" label="โหลดรูปปกไม่ได้" />
        ) : (
           
          <img src={src} alt="" draggable={false} onError={() => setFailed(true)} onLoad={() => setFailed(false)} style={coverCropStyle(crop)} />
        )}
        <span className="cover-cropper-thirds" aria-hidden="true" />
        {!dragging && !failed && <span className="cover-cropper-hint" aria-hidden="true"><Move size={13} /> ลากเพื่อเลือก</span>}
      </div>

      <div className="cover-cropper-controls">
        <strong>ส่วนที่แสดงบนการ์ดสินค้า</strong>
        <label className="cover-cropper-zoom">
          <span>ซูม {crop.zoom.toFixed(1)}×</span>
          <span className="cover-cropper-zoom-row">
            <button type="button" onClick={() => update({ ...crop, zoom: crop.zoom - 0.25 })} disabled={crop.zoom <= 1} aria-label="ซูมออก"><Minus size={14} /></button>
            <input type="range" min={1} max={3} step={0.01} value={Math.min(crop.zoom, 3)} onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })} aria-label="ระดับการซูมรูปปก" />
            <button type="button" onClick={() => update({ ...crop, zoom: crop.zoom + 0.25 })} disabled={crop.zoom >= 3} aria-label="ซูมเข้า"><Plus size={14} /></button>
          </span>
        </label>
        <div className="cover-cropper-actions">
          <button type="button" onClick={() => onChange(null)} disabled={!value}><Crosshair size={14} /> จัดกึ่งกลาง</button>
          <button type="button" className="danger" onClick={onRemove}><Trash2 size={14} /> ลบรูปปก</button>
        </div>
        <small>รูปต้นฉบับไม่ถูกแก้ ปรับใหม่ได้ทุกเมื่อ</small>
      </div>
    </div>
  );
}
