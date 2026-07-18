export function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function wordsPerSecond(lang) {
  return lang === "ru" ? 2.0 : 2.4;
}

export function estimateSeconds(script, lang) {
  const words = wordCount(script);
  if (!words) return 0;
  return Math.max(1, Math.round(words / wordsPerSecond(lang)));
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function detectLanguage(text) {
  const letters = String(text || "").replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (!letters) return "en";
  const cyrillic = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyrillic / letters.length > 0.3 ? "ru" : "en";
}

export function resolveLanguage(preference, deckText) {
  if (preference === "en" || preference === "ru") return preference;
  return detectLanguage(deckText);
}

const EN_FILLERS = [
  "um",
  "uh",
  "like",
  "you know",
  "kind of",
  "sort of",
  "basically",
  "actually",
  "right?",
];
const RU_FILLERS = [
  "э-э",
  "ну",
  "как бы",
  "типа",
  "вот",
  "значит",
  "короче",
  "это самое",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countPhrase(text, phrase) {
  const lower = text.toLowerCase();
  const p = phrase.toLowerCase();
  if (/[?!.,]$/.test(p)) {
    const bare = escapeRegex(p.slice(0, -1));
    const punct = escapeRegex(p.slice(-1));
    const re = new RegExp(`\\b${bare}\\s*${punct}`, "gi");
    return (lower.match(re) || []).length;
  }
  if (p.includes(" ") || p.includes("-")) {
    const pattern = escapeRegex(p).replace(/\\-/g, "[-\\s]?");
    const re = new RegExp(`(?:^|\\s)${pattern}(?=\\s|$|[.,!?])`, "gi");
    return (lower.match(re) || []).length;
  }
  const re = new RegExp(`\\b${escapeRegex(p)}\\b`, "gi");
  return (lower.match(re) || []).length;
}

export function detectFillers(transcript, lang) {
  const list = lang === "ru" ? RU_FILLERS : EN_FILLERS;
  const counts = {};
  for (const filler of list) {
    const n = countPhrase(transcript || "", filler);
    if (n > 0) counts[filler] = n;
  }
  return counts;
}

export function fillerTotal(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function toast(message, { action } = {}) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast";
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  if (action?.label && action.onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      el.remove();
      action.onClick();
    });
    el.appendChild(btn);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

export function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(120, textarea.scrollHeight)}px`;
}
