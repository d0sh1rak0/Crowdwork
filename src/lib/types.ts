export type Tone = "confident" | "friendly" | "formal" | "energetic";

export type ScriptLanguage = "en" | "ru" | "auto";

export type PurposeOption =
  | "Investor pitch"
  | "Startup competition"
  | "Sales demo"
  | "Conference talk"
  | "University defense"
  | "Other";

export type DeckSlide = {
  n: number;
  text: string;
  /** Full-res JPEG dataURL for display */
  imageDisplay: string;
  /** Downscaled JPEG dataURL (~800px) for API */
  imageApi: string;
};

export type ScriptSlide = {
  n: number;
  script: string;
  seconds: number;
  tip: string;
  /** Original AI version kept for reset */
  originalScript: string;
  originalSeconds: number;
  originalTip: string;
};

export type SetupForm = {
  purpose: PurposeOption | "";
  purposeOther: string;
  targetMinutes: number;
  tone: Tone;
  language: ScriptLanguage;
  audience: string;
  notes: string;
};

export type GenerateScriptRequest = {
  deckTitle: string;
  purpose: string;
  audience?: string;
  notes?: string;
  tone: Tone;
  targetMinutes: number;
  language: "en" | "ru";
  slides: { n: number; text: string; image?: string }[];
  regenerate?: { n: number; instruction: string };
  neighborContext?: { n: number; script: string }[];
};

export type GenerateScriptResponse = {
  slides: { n: number; script: string; seconds: number; tip: string }[];
};

export type FeedbackRequest = {
  targetMinutes: number;
  language: "en" | "ru";
  slides: {
    n: number;
    script: string;
    transcript: string;
    actualSeconds: number;
    targetSeconds: number;
  }[];
};

export type FeedbackResponse = {
  summary: string;
  strengths: string[];
  improvements: string[];
};

export type RehearsalSlideResult = {
  n: number;
  actualSeconds: number;
  transcript: string;
};

export type RehearsalReport = {
  totalSeconds: number;
  targetSeconds: number;
  wpm: number;
  fillerCounts: Record<string, number>;
  fillerTotal: number;
  slidesOverBudget: number;
  slides: RehearsalSlideResult[];
  speakingSeconds: number;
  finalWordCount: number;
};
