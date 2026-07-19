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

export async function transcribeAudio(blob, language) {
  const form = new FormData();
  form.append("audio", blob, "chunk.webm");
  form.append("language", language);
  const res = await NetworkClient.fetch("/api/transcribe", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function speakText(text, language) {
  const res = await NetworkClient.fetch("/api/speak", {
    method: "POST",
    headers: NetworkClient.getJsonHeaders(),
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.blob();
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
