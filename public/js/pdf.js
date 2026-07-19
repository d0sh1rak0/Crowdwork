const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 40;
const DISPLAY_SCALE = 1.5;
const API_MAX_WIDTH = 512;
const THUMB_MAX_WIDTH = 180;

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function canvasToJpeg(source, quality, maxWidth) {
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

export function validatePdfFile(file) {
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return "Upload a PDF file. Export from PowerPoint via File → Export → PDF.";
  }
  if (file.size > MAX_BYTES) {
    return `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Keep it under 20 MB.`;
  }
  return null;
}

export async function processPdf(file, onProgress) {
  const err = validatePdfFile(file);
  if (err) throw new Error(err);

  const pdfjs = await import(
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
  );
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  if (doc.numPages > MAX_PAGES) {
    throw new Error(
      `This deck has ${doc.numPages} pages. Split it to 40 pages or fewer.`
    );
  }
  if (doc.numPages < 1) throw new Error("This PDF has no pages.");

  const title =
    file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() ||
    "Untitled deck";

  const slides = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: DISPLAY_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageDisplay = canvasToJpeg(canvas, 0.72);
    const imageApi = canvasToJpeg(canvas, 0.55, API_MAX_WIDTH);
    const imageThumb = canvasToJpeg(canvas, 0.55, THUMB_MAX_WIDTH);
    const textContent = await page.getTextContent();
    const text = collapseWhitespace(
      textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ")
    );

    const slide = { n: i, text, imageDisplay, imageApi, imageThumb };
    slides.push(slide);
    onProgress?.({ current: i, total: doc.numPages, slide });
  }

  return { slides, title };
}
