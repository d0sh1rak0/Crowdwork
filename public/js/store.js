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
  paceTargetWpm: DEFAULT_PACE_TARGET_WPM,
  /** Last AI recommendation shown in the pace tuner */
  paceRecommendedWpm: null,
  /** True once the user confirms a pace in the tuner */
  paceConfirmed: false,
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

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return blank();
    return { ...blank(), ...JSON.parse(raw) };
  } catch {
    return blank();
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(partial) {
  state = { ...state, ...partial };
  persist();
  listeners.forEach((fn) => fn(state));
}

export function resetAll() {
  state = blank();
  persist();
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

export function setGenerating(v) {
  set({ isGenerating: v });
}

export function setScriptSlides(slides) {
  const lang = getResolvedLanguage();
  set({
    scriptSlides: slides,
    resolvedLanguage: lang,
    currentSlideIndex: 0,
    rehearsalReport: null,
    feedback: null,
    objections: null,
    isGenerating: false,
  });
}

export function setCurrentSlideIndex(i) {
  set({ currentSlideIndex: i });
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

export function totalEstimatedSeconds() {
  return state.scriptSlides.reduce((sum, s) => sum + s.seconds, 0);
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

export function slidesForApi() {
  // Cap image attachments — full-deck JPEGs make Gemini hang / appear to "write forever"
  const MAX_IMAGES = 8;
  let imagesAttached = 0;
  return state.slides.map((s) => {
    const words = String(s.text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const payload = { n: s.n, text: s.text };
    if (words < 15 && s.imageApi && imagesAttached < MAX_IMAGES) {
      payload.image = s.imageApi;
      imagesAttached += 1;
    }
    return payload;
  });
}

window.addEventListener("beforeunload", (e) => {
  if (!hasDeck()) return;
  e.preventDefault();
  e.returnValue = "";
});
