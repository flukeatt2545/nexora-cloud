import { ImageOff, Unlink } from "lucide-react";

/**
 * Drawn-in-code stand-in for a missing picture (no cover yet, or one that failed to load):
 * neon icon, HUD corners and a perspective grid, all in the theme colour. Fills its
 * (positioned) parent and scales with it via container units; `compact` drops the label
 * for small thumbnails, and an empty `label` shows the icon only. `variant="error"` swaps
 * the icon so a picture that failed to load is never mistaken for one that was never set.
 */
export default function NoCoverArt({
  compact = false,
  label = "ยังไม่มีรูปปก",
  ariaLabel,
  variant = "empty",
}: {
  compact?: boolean;
  label?: string;
  ariaLabel?: string;
  variant?: "empty" | "error";
}) {
  const Icon = variant === "error" ? Unlink : ImageOff;
  return (
    <span className={`no-cover${compact ? " is-compact" : ""}${variant === "error" ? " is-error" : ""}`} role="img" aria-label={ariaLabel || label || "ไม่มีรูป"}>
      <span className="no-cover-grid" aria-hidden="true" />
      <span className="no-cover-corners" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="no-cover-mark" aria-hidden="true">
        <Icon strokeWidth={1.6} />
      </span>
      {!compact && label && <span className="no-cover-label" aria-hidden="true">{label}</span>}
    </span>
  );
}
