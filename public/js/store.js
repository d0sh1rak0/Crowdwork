import { estimateSeconds, resolveLanguage } from "./utils.js";
import { DEFAULT_PACE_TARGET_WPM } from "./services/paceConfig.js";

const KEY = "crowdwork-deck-v1";

const defaultSetup = () => ({
  purpose: "",
  purposeOther: "",
  targetMinutes: 10,
  tone: "confident",
  language: "auto",
  audience: "",
  notes: "",
  /** Center of the healthy / steady WPM band (set in pre-pitch tuner) */
  /** Pitch campaign level (1–3 + Final Boss) */
  pitchLevel: 2,
  paceTargetWpm: DEFAULT_PACE_TARGET_WPM,
  /** Last AI recommendation shown in the pace tuner */
  paceRecommendedWpm: null,
  /** True once the user confirms a pace in the tuner */
  paceConfirmed: false,
  /** Investor heckles on dead air — optional for calmer practice */
  hecklersEnabled: true,
  /** Hide on-stage script so the speaker presents from memory */
  memorizeMode: false,
});

function blank() {
  return {
    deckTitle: "",
    slides: [],
    setup: defaultSetup(),
    resolvedLanguage: "en",
    scriptSlides: [],
    currentSlideIndex: 0,
    isGenerating: false,
    rehearsalReport: null,
    feedback: null,
    objections: null,
  };
}

/**
 * Persist a slim snapshot — drop multi‑MB JPEG data URLs from the critical path.
 * Full-res images stay in the live in-memory state for the session.
 */
function toPersistable(s) {
  return {
    ...s,
    isGenerating: false,
    slides: (s.slides || []).map((slide) => ({
      n: slide.n,
      text: slide.text || "",
      fromScript: Boolean(slide.fromScript),
      // Small rail thumb only (keeps refresh usable without blocking stringify)
      imageThumb: slide.imageThumb || null,
    })),
  };
}

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    const merged = { ...blank(), ...parsed };
    // Rehydrate display fields from thumbs when full images aren't in storage
    merged.slides = (merged.slides || []).map((slide) => ({
      ...slide,
      imageDisplay: slide.imageDisplay || slide.imageThumb || "",
      imageApi: slide.imageApi || null,
      imageThumb: slide.imageThumb || slide.imageDisplay || "",
    }));
    return merged;
  } catch {
    return blank();
  }
}

let state = load();
const listeners = new Set();
/** @type {ReturnType<typeof setTimeout> | null} */
let persistTimer = null;

function persistNow() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(toPersistable(state)));
  } catch {
    /* quota / private mode */
  }
}

/** Debounced / idle persist so generation paint is never blocked by stringify */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  const run = () => {
    persistTimer = null;
    persistNow();
  };
  if (typeof requestIdleCallback === "function") {
    persistTimer = setTimeout(() => {
      requestIdleCallback(run, { timeout: 800 });
    }, 0);
  } else {
    persistTimer = setTimeout(run, 0);
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {object} partial
 * @param {{ persist?: boolean | 'defer' }} [opts]
 *   - true (default): schedule deferred persist
 *   - 'defer': same as true
 *   - false: memory only (no sessionStorage write)
 */
function set(partial, opts = {}) {
  state = { ...state, ...partial };
  const mode = opts.persist === false ? false : "defer";
  if (mode === "defer") schedulePersist();
  listeners.forEach((fn) => fn(state));
}

export function resetAll() {
  state = blank();
  persistNow();
  listeners.forEach((fn) => fn(state));
}

export function setDeck({ title, slides }) {
  set({
    deckTitle: title,
    slides,
    scriptSlides: [],
    currentSlideIndex: 0,
    rehearsalReport: null,
    feedback: null,
    objections: null,
  });
  // Critical: deck must be durable before any navigate-to-generate
  flushPersist();
}

export function updateSetup(partial) {
  set({ setup: { ...state.setup, ...partial } });
}

export function getPurposeString() {
  const { purpose, purposeOther } = state.setup;
  if (purpose === "Other") return purposeOther.trim() || "Other";
  return purpose;
}

export function getResolvedLanguage() {
  const deckText = state.slides.map((s) => s.text).join(" ");
  return resolveLanguage(state.setup.language, deckText);
}

/** Ephemeral UI flag — never blocks on sessionStorage */
export function setGenerating(v) {
  set({ isGenerating: v }, { persist: false });
}

/**
 * Apply generated scripts to live state.
 * @param {object[]} slides
 * @param {{ persist?: boolean | 'defer' }} [opts]
 */
export function setScriptSlides(slides, opts = {}) {
  const lang = getResolvedLanguage();
  set(
    {
      scriptSlides: slides,
      resolvedLanguage: lang,
      currentSlideIndex: 0,
      rehearsalReport: null,
      feedback: null,
      objections: null,
      isGenerating: false,
    },
    { persist: opts.persist === false ? false : "defer" }
  );
}

export function setCurrentSlideIndex(i) {
  set({ currentSlideIndex: i }, { persist: false });
  schedulePersist();
}

export function updateSlideScript(n, script) {
  const lang = state.resolvedLanguage;
  set({
    scriptSlides: state.scriptSlides.map((s) =>
      s.n === n
        ? {
            ...s,
            script,
            seconds: estimateSeconds(script, lang) || s.seconds,
          }
        : s
    ),
  });
}

export function updateSlideFromRegen(n, data) {
  set({
    scriptSlides: state.scriptSlides.map((s) =>
      s.n === n
        ? {
            ...s,
            script: data.script,
            seconds: data.seconds,
            tip: data.tip,
            originalScript: data.script,
            originalSeconds: data.seconds,
            originalTip: data.tip,
          }
        : s
    ),
  });
}

export function resetSlideToOriginal(n) {
  set({
    scriptSlides: state.scriptSlides.map((s) =>
      s.n === n
        ? {
            ...s,
            script: s.originalScript,
            seconds: s.originalSeconds,
            tip: s.originalTip,
          }
        : s
    ),
  });
}

/** Slides that will actually run in rehearsal (not soft-excluded). */
export function activeScriptSlides() {
  return state.scriptSlides.filter((s) => !s.excluded);
}

/**
 * Soft-exclude a slide from the pitch without deleting its script.
 * Refuses if it would leave zero active slides.
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSlideExcluded(n, excluded) {
  const wantOut = Boolean(excluded);
  const target = state.scriptSlides.find((s) => s.n === n);
  if (!target) return { ok: false, error: "Slide not found." };
  if (wantOut && !target.excluded) {
    const activeCount = state.scriptSlides.filter((s) => !s.excluded).length;
    if (activeCount <= 1) {
      return { ok: false, error: "Keep at least one slide in the pitch." };
    }
  }
  set({
    scriptSlides: state.scriptSlides.map((s) =>
      s.n === n ? { ...s, excluded: wantOut } : s
    ),
  });
  return { ok: true };
}

export function totalEstimatedSeconds() {
  return state.scriptSlides.reduce(
    (sum, s) => sum + (s.excluded ? 0 : Number(s.seconds) || 0),
    0
  );
}

export function setTone(tone) {
  set({ setup: { ...state.setup, tone } });
}

export function setRehearsalReport(report) {
  set({ rehearsalReport: report });
}

export function setFeedback(feedback) {
  set({ feedback });
}

export function setObjections(objections) {
  set({ objections });
}

export function hasDeck() {
  return state.slides.length > 0;
}

export function hasScript() {
  return state.scriptSlides.length > 0;
}

/** Prefer compact visual for rail; fall back to display / api */
export function slideThumbSrc(slide) {
  if (!slide) return "";
  return slide.imageThumb || slide.imageApi || slide.imageDisplay || "";
}

export function slideDisplaySrc(slide) {
  if (!slide) return "";
  return slide.imageDisplay || slide.imageThumb || slide.imageApi || "";
}

export function slidesForApi() {
  // Lean vision attachments — fewer / smaller images = faster Gemini turnaround
  const MAX_IMAGES = 4;
  let imagesAttached = 0;
  return state.slides.map((s) => {
    const words = String(s.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const payload = { n: s.n, text: String(s.text || "").slice(0, 1200) };
    if (words < 8 && s.imageApi && imagesAttached < MAX_IMAGES) {
      payload.image = s.imageApi;
      imagesAttached += 1;
    }
    return payload;
  });
}

/** When true, internal app navigations skip the native "Leave site?" prompt */
let safeNavigation = false;

/**
 * Call immediately before intentional in-app transitions
 * (upload → script, back to upload, script → rehearse, etc.).
 */
export function markSafeNavigation() {
  safeNavigation = true;
}

export function clearSafeNavigation() {
  safeNavigation = false;
}

export function isSafeNavigation() {
  return safeNavigation;
}

function onBeforeUnload(e) {
  if (safeNavigation) return;
  if (!hasDeck()) return;
  e.preventDefault();
  e.returnValue = "";
}

window.addEventListener("beforeunload", onBeforeUnload);

/** Navigate without triggering the leave-site dialog */
export function navigateSafely(url, { replace = false } = {}) {
  markSafeNavigation();
  if (replace) window.location.replace(url);
  else window.location.href = url;
}

/** Force a slim persist now (e.g. before leaving the page intentionally) */
export function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}
