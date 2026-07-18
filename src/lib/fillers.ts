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
] as const;

const RU_FILLERS = [
  "э-э",
  "ну",
  "как бы",
  "типа",
  "вот",
  "значит",
  "короче",
  "это самое",
] as const;

export type FillerLang = "en" | "ru";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countPhrase(text: string, phrase: string): number {
  const lower = text.toLowerCase();
  const p = phrase.toLowerCase();

  // Punctuation-ending fillers (e.g. "right?")
  if (/[?!.,]$/.test(p)) {
    const bare = escapeRegex(p.slice(0, -1));
    const punct = escapeRegex(p.slice(-1));
    const re = new RegExp(`\\b${bare}\\s*${punct}`, "gi");
    return (lower.match(re) || []).length;
  }

  // Multi-word phrases
  if (p.includes(" ") || p.includes("-")) {
    const pattern = escapeRegex(p).replace(/\\-/g, "[-\\s]?");
    const re = new RegExp(`(?:^|\\s)${pattern}(?=\\s|$|[.,!?])`, "gi");
    return (lower.match(re) || []).length;
  }

  // Single words — word boundary
  const re = new RegExp(`\\b${escapeRegex(p)}\\b`, "gi");
  return (lower.match(re) || []).length;
}

export function detectFillers(
  transcript: string,
  lang: FillerLang
): Record<string, number> {
  const list = lang === "ru" ? RU_FILLERS : EN_FILLERS;
  const counts: Record<string, number> = {};
  for (const filler of list) {
    const n = countPhrase(transcript, filler);
    if (n > 0) counts[filler] = n;
  }
  return counts;
}

export function mergeFillerCounts(
  ...maps: Record<string, number>[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of maps) {
    for (const [k, v] of Object.entries(map)) {
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

export function fillerTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function fillerList(lang: FillerLang): readonly string[] {
  return lang === "ru" ? RU_FILLERS : EN_FILLERS;
}
