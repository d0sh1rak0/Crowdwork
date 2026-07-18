import type { DeckSlide } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 40;
const DISPLAY_SCALE = 1.75;
const API_MAX_WIDTH = 800;

export type PdfProgress = {
  current: number;
  total: number;
  slide: DeckSlide;
};

export type PdfValidationError = {
  message: string;
};

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function canvasToJpeg(
  source: HTMLCanvasElement,
  quality: number,
  maxWidth?: number
): string {
  if (!maxWidth || source.width <= maxWidth) {
    return source.toDataURL("image/jpeg", quality);
  }
  const scale = maxWidth / source.width;
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) return source.toDataURL("image/jpeg", quality);
  ctx.drawImage(source, 0, 0, w, h);
  return off.toDataURL("image/jpeg", quality);
}

export function validatePdfFile(file: File): PdfValidationError | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { message: "Upload a PDF file. Export from PowerPoint via File → Export → PDF." };
  }
  if (file.size > MAX_BYTES) {
    return {
      message: `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Keep it under 20 MB.`,
    };
  }
  return null;
}

export async function processPdf(
  file: File,
  onProgress: (progress: PdfProgress) => void
): Promise<{ slides: DeckSlide[]; title: string }> {
  const validation = validatePdfFile(file);
  if (validation) throw new Error(validation.message);

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  if (doc.numPages > MAX_PAGES) {
    throw new Error(
      `This deck has ${doc.numPages} pages. Split it to 40 pages or fewer.`
    );
  }
  if (doc.numPages < 1) {
    throw new Error("This PDF has no pages.");
  }

  const title =
    file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled deck";

  const slides: DeckSlide[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: DISPLAY_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const imageDisplay = canvasToJpeg(canvas, 0.8);
    const imageApi = canvasToJpeg(canvas, 0.7, API_MAX_WIDTH);

    const textContent = await page.getTextContent();
    const text = collapseWhitespace(
      textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
    );

    const slide: DeckSlide = {
      n: i,
      text,
      imageDisplay,
      imageApi,
    };
    slides.push(slide);
    onProgress({ current: i, total: doc.numPages, slide });
  }

  return { slides, title };
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Attach API image only when extracted text is thin (< 15 words). */
export function slidesForApi(slides: DeckSlide[]): {
  n: number;
  text: string;
  image?: string;
}[] {
  return slides.map((s) => {
    const words = countWords(s.text);
    const payload: { n: number; text: string; image?: string } = {
      n: s.n,
      text: s.text,
    };
    if (words < 15) {
      // Strip dataURL prefix for smaller payload; server accepts both
      payload.image = s.imageApi;
    }
    return payload;
  });
}
