"use client";

import Image from "next/image";
import { useDeckStore } from "@/store/deck-store";

export function ThumbnailGrid() {
  const slides = useDeckStore((s) => s.slides);
  const progress = useDeckStore((s) => s.processingProgress);
  const isProcessing = useDeckStore((s) => s.isProcessingPdf);

  if (!isProcessing && slides.length === 0) return null;

  const total = progress?.total || slides.length;
  const current = progress?.current || slides.length;

  return (
    <div className="mt-10 w-full max-w-3xl">
      {isProcessing ? (
        <p className="mb-4 font-utility text-sm text-amber">
          Reading slide {current} of {total}
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          {slides.length} slides ready
        </p>
      )}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {slides.map((slide) => (
          <div
            key={slide.n}
            className="anim-slide overflow-hidden rounded-md border border-border bg-surface"
          >
            <div className="relative aspect-video">
              <Image
                src={slide.imageDisplay}
                alt={`Slide ${slide.n}`}
                fill
                unoptimized
                className="object-cover"
              />
            </div>
            <p className="px-2 py-1 font-utility text-[11px] text-muted">
              {slide.n}
            </p>
          </div>
        ))}
        {isProcessing && total > slides.length
          ? Array.from({ length: Math.min(3, total - slides.length) }).map(
              (_, i) => (
                <div
                  key={`ph-${i}`}
                  className="aspect-video animate-pulse rounded-md border border-border bg-surface"
                />
              )
            )
          : null}
      </div>
    </div>
  );
}
