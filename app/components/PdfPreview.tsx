"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a PDF page by page with pdf.js into canvases that fit the container width.
 * Used instead of an <iframe>: phone browsers often show nothing (or only page one) for a
 * PDF in a frame. Styles live in app/dashboard/file-library-122.css (.fl-preview-pdf-*).
 */
export default function PdfPreview({ url, title }: { url: string; title: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Typed copy so the async render below keeps the non-null type.
    const found = pagesRef.current;
    if (!found) return;
    const pagesElement: HTMLDivElement = found;

    let active = true;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    const renderTasks: Array<{ cancel: () => void }> = [];

    async function renderPdf() {
      try {
        setLoading(true);
        setError("");
        pagesElement.replaceChildren();

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const task = pdfjs.getDocument({ url });
        loadingTask = task as any;
        const document = await task.promise;
        if (!active) {
          await (document as any).destroy?.();
          return;
        }

        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          if (!active) break;

          const page = await document.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(280, pagesElement.clientWidth - 16);
          const cssScale = Math.min(1.75, availableWidth / baseViewport.width);
          const viewport = page.getViewport({ scale: cssScale });
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);

          const pageWrap = window.document.createElement("div");
          pageWrap.className = "fl-preview-pdf-page";
          pageWrap.setAttribute("aria-label", `หน้า ${pageNumber} จาก ${document.numPages}`);

          const canvas = window.document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          pageWrap.appendChild(canvas);
          pagesElement.appendChild(pageWrap);

          const renderTask = page.render({
            canvas,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          renderTasks.push(renderTask);
          await renderTask.promise;
          page.cleanup();
        }

        if (active) setLoading(false);
      } catch (renderError) {
        if (!active || (renderError instanceof Error && renderError.name === "RenderingCancelledException")) return;
        setLoading(false);
        setError("แสดงตัวอย่าง PDF ไม่สำเร็จ กรุณาเปิดในแท็บใหม่");
      }
    }

    void renderPdf();

    return () => {
      active = false;
      renderTasks.forEach((task) => {
        try {
          task.cancel();
        } catch {
          /* ignore */
        }
      });
      try {
        void loadingTask?.destroy();
      } catch {
        /* ignore */
      }
      try {
        pagesElement.replaceChildren();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  return (
    <div className="fl-preview-pdf-stage" role="document" aria-label={title}>
      {loading && !error && <div className="fl-preview-pdf-status">กำลังโหลด PDF...</div>}
      {error && <div className="fl-preview-pdf-status is-error">{error}</div>}
      <div ref={pagesRef} className="fl-preview-pdf-pages" />
    </div>
  );
}
