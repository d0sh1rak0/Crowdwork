"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cls";
import { processPdf, validatePdfFile } from "@/lib/pdf";
import { useDeckStore } from "@/store/deck-store";

export function UploadZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    setDeckTitle,
    setSlides,
    setProcessing,
    addProcessedSlide,
    clearScript,
    isProcessingPdf,
  } = useDeckStore();

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setError(null);
      const validation = validatePdfFile(file);
      if (validation) {
        setError(validation.message);
        return;
      }

      clearScript();
      setSlides([]);
      setProcessing(true, { current: 0, total: 0 });

      try {
        const { slides, title } = await processPdf(file, ({ current, total, slide }) => {
          addProcessedSlide(slide, total);
          setProcessing(true, { current, total });
        });
        setDeckTitle(title);
        setSlides(slides);
        setProcessing(false, null);
      } catch (err) {
        setSlides([]);
        setProcessing(false, null);
        setError(err instanceof Error ? err.message : "Could not read this PDF.");
      }
    },
    [
      addProcessedSlide,
      clearScript,
      setDeckTitle,
      setProcessing,
      setSlides,
    ]
  );

  return (
    <div className="w-full max-w-xl">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => !isProcessingPdf && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (isProcessingPdf) return;
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center ease-stage",
          dragOver
            ? "border-amber bg-amber/10"
            : "border-border bg-surface/60 hover:border-muted",
          isProcessingPdf && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={isProcessingPdf}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="font-display text-xl text-text">Drop your deck PDF</p>
        <p className="mt-2 text-sm text-muted">
          Or click to browse · one file · ≤ 20 MB · ≤ 40 pages
        </p>
        <p className="mt-6 max-w-sm text-sm text-muted/90">
          Have a .pptx? Export it as PDF first — File → Export → PDF.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm text-over"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
