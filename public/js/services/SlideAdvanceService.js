/**
 * SlideAdvanceService — auto-advance when timing + spoken progress match.
 * Manual Next / thumbnail clicks always override.
 */

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Light stem so "markets" ≈ "market", "running" ≈ "run" */
function stemWord(w) {
  const s = String(w || "").toLowerCase();
  if (s.length <= 3) return s;
  return s
    .replace(/(?:ing|ed|es|ly|ers|er|s)$/u, "")
    .replace(/(.)\1$/u, "$1");
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/** Fuzzy word equality for STT typos / plurals */
export function wordsClose(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = stemWord(a);
  const sb = stemWord(b);
  if (sa === sb) return true;
  if (sa.length >= 4 && sb.length >= 4 && (sa.startsWith(sb) || sb.startsWith(sa))) {
    return true;
  }
  const maxLen = Math.max(a.length, b.length);
  const allowed = maxLen <= 4 ? 1 : 2;
  return editDistance(a, b) <= allowed || editDistance(sa, sb) <= allowed;
}

/**
 * How far through the script the speaker has gotten (0–1), via greedy fuzzy alignment.
 */
export function scriptProgressRatio(transcript, script) {
  const tWords = normalizeWords(transcript);
  const sWords = normalizeWords(script);
  if (!sWords.length || !tWords.length) return 0;

  let si = 0;
  for (const tw of tWords) {
    if (si >= sWords.length) break;
    // Look ahead a few script words for STT reorder / skips
    let matched = false;
    for (let look = 0; look < 3 && si + look < sWords.length; look++) {
      if (wordsClose(tw, sWords[si + look])) {
        si += look + 1;
        matched = true;
        break;
      }
    }
    if (!matched && si > 0) {
      // tolerate filler / misheard token without resetting progress
      continue;
    }
  }
  return Math.min(1, si / sWords.length);
}

/**
 * True if transcript covers the last 3–5 script words (fuzzy) or high progress.
 * @param {string} transcript
 * @param {string} script
 * @param {{ min?: number, max?: number, progressThreshold?: number }} [opts]
 */
export function scriptTailMatches(transcript, script, opts = {}) {
  const min = opts.min ?? 3;
  const max = opts.max ?? 5;
  const progressThreshold = opts.progressThreshold ?? 0.82;
  const tWords = normalizeWords(transcript);
  const sWords = normalizeWords(script);
  if (sWords.length < min || tWords.length < min) return false;

  if (scriptProgressRatio(transcript, script) >= progressThreshold) {
    return true;
  }

  for (let n = Math.min(max, sWords.length); n >= min; n--) {
    const tail = sWords.slice(-n);
    const window = tWords.slice(-Math.max(n + 6, n));

    // Contiguous fuzzy match in the end window
    for (let start = 0; start <= window.length - n; start++) {
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!wordsClose(window[start + i], tail[i])) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }

    // Ordered fuzzy subsequence near the end
    let ti = 0;
    for (const w of window) {
      if (wordsClose(w, tail[ti])) ti += 1;
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
  if (slideElapsed < target * 0.7) return false;
  return scriptTailMatches(transcript, script, {
    min: 3,
    max: 5,
    progressThreshold: 0.8,
  });
}

const SlideAdvanceService = {
  normalizeWords,
  wordsClose,
  scriptProgressRatio,
  scriptTailMatches,
  shouldAutoAdvanceSlide,
};

export default SlideAdvanceService;
