import { toast } from "./utils.js";

async function parseError(res) {
  try {
    const data = await res.json();
    return data.error || res.statusText || "Request failed.";
  } catch {
    return res.statusText || "Request failed.";
  }
}

export async function generateScript(payload) {
  const res = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchFeedback(payload) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchObjections(payload) {
  const res = await fetch("/api/objections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function transcribeAudio(blob, language) {
  const form = new FormData();
  form.append("audio", blob, "chunk.webm");
  form.append("language", language);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function speakText(text, language) {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.blob();
}

export function toastRetry(message, retryFn) {
  toast(message, {
    action: {
      label: "Retry",
      onClick: () => retryFn(),
    },
  });
}
