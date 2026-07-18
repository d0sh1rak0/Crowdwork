import type { ScriptLanguage } from "./types";

/** Words per second for live speaking-time estimate */
export function wordsPerSecond(lang: "en" | "ru"): number {
  return lang === "ru" ? 2.0 : 2.4;
}

export function estimateSecondsFromScript(
  script: string,
  lang: "en" | "ru"
): number {
  const words = wordCount(script);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / wordsPerSecond(lang)));
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function formatTimeVerbose(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function resolveLanguage(
  preference: ScriptLanguage,
  deckText: string
): "en" | "ru" {
  if (preference === "en" || preference === "ru") return preference;
  return detectLanguage(deckText);
}

export function detectLanguage(text: string): "en" | "ru" {
  const letters = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (!letters) return "en";
  const cyrillic = (letters.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyrillic / letters.length > 0.3 ? "ru" : "en";
}
