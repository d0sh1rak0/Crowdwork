"use client";

import { create } from "zustand";
import type {
  DeckSlide,
  FeedbackResponse,
  RehearsalReport,
  ScriptSlide,
  SetupForm,
  Tone,
} from "@/lib/types";
import { estimateSecondsFromScript, resolveLanguage } from "@/lib/timing";

const DEFAULT_SETUP: SetupForm = {
  purpose: "",
  purposeOther: "",
  targetMinutes: 10,
  tone: "confident",
  language: "auto",
  audience: "",
  notes: "",
};

type DeckState = {
  deckTitle: string;
  slides: DeckSlide[];
  setup: SetupForm;
  resolvedLanguage: "en" | "ru";
  scriptSlides: ScriptSlide[];
  currentSlideIndex: number;
  isGenerating: boolean;
  isProcessingPdf: boolean;
  processingProgress: { current: number; total: number } | null;
  rehearsalReport: RehearsalReport | null;
  feedback: FeedbackResponse | null;

  setDeckTitle: (title: string) => void;
  setSlides: (slides: DeckSlide[]) => void;
  setProcessing: (
    isProcessing: boolean,
    progress?: { current: number; total: number } | null
  ) => void;
  addProcessedSlide: (slide: DeckSlide, total: number) => void;
  updateSetup: (partial: Partial<SetupForm>) => void;
  setScriptSlides: (slides: ScriptSlide[]) => void;
  setGenerating: (v: boolean) => void;
  setCurrentSlideIndex: (i: number) => void;
  updateSlideScript: (n: number, script: string) => void;
  updateSlideFromRegen: (
    n: number,
    data: { script: string; seconds: number; tip: string }
  ) => void;
  resetSlideToOriginal: (n: number) => void;
  setTone: (tone: Tone) => void;
  setRehearsalReport: (report: RehearsalReport | null) => void;
  setFeedback: (feedback: FeedbackResponse | null) => void;
  getPurposeString: () => string;
  getResolvedLanguage: () => "en" | "ru";
  totalEstimatedSeconds: () => number;
  hasDeck: () => boolean;
  hasScript: () => boolean;
  resetAll: () => void;
  clearScript: () => void;
};

function recomputeSeconds(
  script: string,
  lang: "en" | "ru",
  fallback: number
): number {
  const est = estimateSecondsFromScript(script, lang);
  return est > 0 ? est : fallback;
}

export const useDeckStore = create<DeckState>((set, get) => ({
  deckTitle: "",
  slides: [],
  setup: { ...DEFAULT_SETUP },
  resolvedLanguage: "en",
  scriptSlides: [],
  currentSlideIndex: 0,
  isGenerating: false,
  isProcessingPdf: false,
  processingProgress: null,
  rehearsalReport: null,
  feedback: null,

  setDeckTitle: (title) => set({ deckTitle: title }),

  setSlides: (slides) => set({ slides }),

  setProcessing: (isProcessingPdf, progress = null) =>
    set({ isProcessingPdf, processingProgress: progress }),

  addProcessedSlide: (slide, total) =>
    set((state) => ({
      slides: [...state.slides, slide].sort((a, b) => a.n - b.n),
      processingProgress: { current: slide.n, total },
    })),

  updateSetup: (partial) =>
    set((state) => ({ setup: { ...state.setup, ...partial } })),

  setScriptSlides: (slides) => {
    const lang = get().getResolvedLanguage();
    set({
      scriptSlides: slides,
      resolvedLanguage: lang,
      currentSlideIndex: 0,
      rehearsalReport: null,
      feedback: null,
    });
  },

  setGenerating: (isGenerating) => set({ isGenerating }),

  setCurrentSlideIndex: (i) => set({ currentSlideIndex: i }),

  updateSlideScript: (n, script) => {
    const lang = get().resolvedLanguage;
    set((state) => ({
      scriptSlides: state.scriptSlides.map((s) =>
        s.n === n
          ? {
              ...s,
              script,
              seconds: recomputeSeconds(script, lang, s.seconds),
            }
          : s
      ),
    }));
  },

  updateSlideFromRegen: (n, data) => {
    set((state) => ({
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
    }));
  },

  resetSlideToOriginal: (n) => {
    set((state) => ({
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
    }));
  },

  setTone: (tone) =>
    set((state) => ({ setup: { ...state.setup, tone } })),

  setRehearsalReport: (rehearsalReport) => set({ rehearsalReport }),

  setFeedback: (feedback) => set({ feedback }),

  getPurposeString: () => {
    const { purpose, purposeOther } = get().setup;
    if (purpose === "Other") return purposeOther.trim() || "Other";
    return purpose;
  },

  getResolvedLanguage: () => {
    const { setup, slides, resolvedLanguage, scriptSlides } = get();
    if (scriptSlides.length > 0 && setup.language !== "auto") {
      return setup.language === "ru" ? "ru" : "en";
    }
    if (scriptSlides.length > 0 && setup.language === "auto") {
      return resolvedLanguage;
    }
    const deckText = slides.map((s) => s.text).join(" ");
    return resolveLanguage(setup.language, deckText);
  },

  totalEstimatedSeconds: () =>
    get().scriptSlides.reduce((sum, s) => sum + s.seconds, 0),

  hasDeck: () => get().slides.length > 0,

  hasScript: () => get().scriptSlides.length > 0,

  resetAll: () =>
    set({
      deckTitle: "",
      slides: [],
      setup: { ...DEFAULT_SETUP },
      resolvedLanguage: "en",
      scriptSlides: [],
      currentSlideIndex: 0,
      isGenerating: false,
      isProcessingPdf: false,
      processingProgress: null,
      rehearsalReport: null,
      feedback: null,
    }),

  clearScript: () =>
    set({
      scriptSlides: [],
      currentSlideIndex: 0,
      rehearsalReport: null,
      feedback: null,
    }),
}));
