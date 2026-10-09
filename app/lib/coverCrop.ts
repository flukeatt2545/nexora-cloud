import type { CSSProperties } from "react";

/** Focus point (percent of the image) and zoom for a product cover. null = centred, no zoom. */
export type CoverCrop = { x: number; y: number; zoom: number };

export const DEFAULT_COVER_CROP: CoverCrop = { x: 50, y: 50, zoom: 1 };

export function clampCoverCrop(crop: CoverCrop): CoverCrop {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return { x: clamp(crop.x, 0, 100), y: clamp(crop.y, 0, 100), zoom: clamp(crop.zoom, 1, 3) };
}

/**
 * Style for an <img> that fills its frame with object-fit: cover. object-position lines the
 * image's focus point up with the same point of the frame, and scaling around that point keeps
 * it in place, so the crop looks the same in any frame size or shape.
 */
export function coverCropStyle(crop?: CoverCrop | null): CSSProperties | undefined {
  if (!crop) return undefined;
  const { x, y, zoom } = clampCoverCrop(crop);
  return {
    objectFit: "cover",
    objectPosition: `${x}% ${y}%`,
    transformOrigin: `${x}% ${y}%`,
    transform: zoom > 1 ? `scale(${zoom})` : undefined,
  };
}
