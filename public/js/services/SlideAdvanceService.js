/**
 * SlideAdvanceService — auto-advance when timing + script-tail match.
 * Manual Next / thumbnail clicks always override.
 */

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True if transcript ends with the last 3–5 words of the slide script.
 * @param {string} transcript
 * @param {string} script
 * @param {{ min?: number, max?: number }} [opts]
 */
export function scriptTailMatches(transcript, script, opts = {}) {
  const min = opts.min ?? 3;
  const max = opts.max ?? 5;
  const tWords = normalizeWords(transcript);
  const sWords = normalizeWords(script);
  if (sWords.length < min || tWords.length < min) return false;

  for (let n = Math.min(max, sWords.length); n >= min; n--) {
    const tail = sWords.slice(-n);
    // Search near the end of the live transcript
    const window = tWords.slice(-Math.max(n + 4, n));
    const hay = window.join(" ");
    const needle = tail.join(" ");
    if (hay.includes(needle)) return true;

    // Ordered subsequence near the end
    let ti = 0;
    for (const w of window) {
      if (w === tail[ti]) ti += 1;
      if (ti >= tail.length) return true;
    }
  }
  return false;
}

/**
 * @param {{ slideElapsed: number, targetSeconds: number, transcript: string, script: string }} args
 */
export function shouldAutoAdvanceSlide({
  slideElapsed,
  targetSeconds,
  transcript,
  script,
}) {
  const target = Number(targetSeconds) || 0;
  if (target <= 0) return false;
  if (slideElapsed < target * 0.75) return false;
  return scriptTailMatches(transcript, script, { min: 3, max: 5 });
}

const SlideAdvanceService = {
  scriptTailMatches,
  shouldAutoAdvanceSlide,
};

export default SlideAdvanceService;
