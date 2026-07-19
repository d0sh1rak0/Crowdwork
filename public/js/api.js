import NetworkClient from "./utilities/NetworkClient.js";
import { toast } from "./utils.js";

async function parseError(res) {
  try {
    const data = await res.json();
    return data.error || res.statusText || "Request failed.";
  } catch {
    return res.statusText || "Request failed.";
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await NetworkClient.fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Script generation timed out. Try fewer slides or retry.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateScript(payload) {
  // Large decks + slide images can take a while; hard-cap so UI never spins forever
  const slideCount = payload?.slides?.length || 1;
  const timeoutMs = Math.min(180000, 45000 + slideCount * 8000);
  const res = await fetchWithTimeout(
    "/api/generate-script",
    {
      method: "POST",
      headers: NetworkClient.getJsonHeaders(),
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchFeedback(payload) {
  const res = await NetworkClient.fetch("/api/feedback", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchObjections(payload) {
  const res = await NetworkClient.fetch("/api/objections", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/**
 * @param {Blob|FormData} blobOrForm
 * @param {string} [language]
 * @param {{ mimeType?: string, filename?: string }} [meta]
 */
export async function transcribeAudio(blobOrForm, language, meta = {}) {
  let form;
  if (blobOrForm instanceof FormData) {
    form = blobOrForm;
    if (!form.has("language") && language) form.append("language", language);
  } else {
    const mimeType = meta.mimeType || blobOrForm?.type || "audio/webm";
    const filename = meta.filename || "recording.webm";
    console.log(
      `[API] POST /api/transcribe → mimeType=${mimeType} size=${blobOrForm?.size ?? 0}B file=${filename}`
    );
    form = new FormData();
    // Single field only — duplicate file+audio confused some proxies/multer paths
    form.append("file", blobOrForm, filename);
    form.append("language", language || "en");
    form.append("mimeType", mimeType.split(";")[0].trim());
  }

  const res = await NetworkClient.fetch("/api/transcribe", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function speakText(text, language, options = {}) {
  const body = { text, language };
  if (options.speed != null) body.speed = options.speed;
  const res = await NetworkClient.fetch("/api/speak", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.blob();
}

/** AI pace recommendation / better-worse verdict for the pre-start tuner */
export async function fetchPaceAdvice(payload) {
  const res = await NetworkClient.fetch("/api/pace-advice", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/** Silence Sentinel → Gemini crowd override (+ optional heckle TTS). */
export async function requestHeckle(payload) {
  const res = await NetworkClient.fetch("/api/heckle", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function toastRetry(message, retryFn) {
  toast(message, {
    action: {
      label: "Retry",
      onClick: () => retryFn(),
    },
  });
}
