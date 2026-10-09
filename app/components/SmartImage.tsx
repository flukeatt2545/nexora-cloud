"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes, ReactNode } from "react";
import NoCoverArt from "./NoCoverArt";

type ImageStatus = "loading" | "loaded" | "error";

type SmartImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "onLoad" | "src"> & {
  src?: string | null;
  /** Fixed ratio for the container, e.g. "16 / 9". Prevents layout shift when the parent has no height. */
  aspectRatio?: string;
  /** Short label shown under the icon in the error state. Pass "" to show the icon only.
   *  The error state uses the same drawn art as "ยังไม่มีรูปปก" so every missing picture looks alike. */
  errorLabel?: string;
  /** Replaces the default broken-image placeholder (e.g. initials for avatars). */
  fallback?: ReactNode;
  /** Class for the wrapper element. `className` still goes to the <img> so existing CSS keeps working. */
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
  /** Hide the label and shrink the icon for small thumbnails and avatars. */
  compact?: boolean;
  onLoad?: () => void;
  onError?: () => void;
};

/**
 * <img> replacement with a shimmer while loading, a decoded fade-in and a custom
 * placeholder on failure. State is tracked per instance and resets when `src` changes.
 * A failed source is never retried automatically.
 */
export default function SmartImage({
  src,
  alt = "",
  className,
  style,
  aspectRatio,
  errorLabel = "โหลดรูปไม่ได้",
  fallback,
  wrapperClassName,
  wrapperStyle,
  compact = false,
  loading = "lazy",
  decoding = "async",
  onLoad,
  onError,
  ...rest
}: SmartImageProps) {
  const [state, setState] = useState<{ src: string | null | undefined; status: ImageStatus }>({
    src,
    status: src ? "loading" : "error",
  });
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset when the source changes (render-phase update avoids a flash of the old status).
  if (state.src !== src) setState({ src, status: src ? "loading" : "error" });
  const status = state.src === src ? state.status : src ? "loading" : "error";

  const settle = useCallback((next: ImageStatus) => {
    setState((current) => (current.src === src && current.status === next ? current : { src, status: next }));
  }, [src]);

  const handleLoaded = useCallback((image: HTMLImageElement) => {
    // decode() rejects for images the browser cannot decode (corrupt files, wrong content type).
    const decode = typeof image.decode === "function" ? image.decode() : Promise.resolve();
    decode.then(() => {
      if (imgRef.current !== image) return;
      settle("loaded");
      onLoad?.();
    }).catch(() => {
      if (imgRef.current !== image) return;
      settle("error");
      onError?.();
    });
  }, [onError, onLoad, settle]);

  // Images served from cache (or finished before hydration) never fire onLoad/onError.
  const checkFinished = useEffectEvent((image: HTMLImageElement) => {
    if (image.naturalWidth > 0) handleLoaded(image);
    else {
      settle("error");
      onError?.();
    }
  });
  useEffect(() => {
    const image = imgRef.current;
    if (!image || !src || !image.complete) return;
    checkFinished(image);
  }, [src]);

  const wrapperClasses = ["smart-img", `is-${status}`, compact ? "is-compact" : "", wrapperClassName || ""].filter(Boolean).join(" ");
  const wrapperStyles: CSSProperties = { ...(aspectRatio ? { aspectRatio, height: "auto" } : null), ...wrapperStyle };

  return (
    <span className={wrapperClasses} style={wrapperStyles} data-status={status} aria-busy={status === "loading" || undefined}>
      {status !== "error" && src && (
         
        <img
          {...rest}
          ref={imgRef}
          src={src}
          alt={alt}
          className={className}
          style={style}
          loading={loading}
          decoding={decoding}
          onLoad={(event) => handleLoaded(event.currentTarget)}
          onError={() => {
            settle("error");
            onError?.();
          }}
        />
      )}
      {status === "loading" && <span className="smart-img-skeleton" aria-hidden="true" />}
      {status === "error" && (
        fallback ?? (
          <NoCoverArt
            variant="error"
            compact={compact}
            label={errorLabel}
            ariaLabel={alt ? `${alt} (โหลดรูปไม่สำเร็จ)` : "โหลดรูปไม่สำเร็จ"}
          />
        )
      )}
    </span>
  );
}
