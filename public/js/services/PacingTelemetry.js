/**
 * PacingTelemetry — Vocal Attention Matrix engine.
 *
 * - Pause clock (≥1.5s without STT words)
 * - 5s moving WPM window (stable rolling average — never divides by tiny spans)
 * - Clear / unclear speech classification
 * - Live pacing overlay events (RUSHING / TOO SLOW)
 *
 * Word tracking uses UNIQUE delta packets only — never re-counts cumulative
 * transcript history or double-ingested chunks from parallel code paths.
 */

import audioTranscriptionService from "./AudioTranscriptionService.js";
import {
  DEFAULT_PACE_TARGET_WPM,
  derivePaceBands,
} from "./paceConfig.js";

const PAUSE_THRESHOLD_MS = 4000;
/** Stable rolling buffer used as the WPM denominator */
const WPM_WINDOW_MS = 5000;
/** Hard floor so (words / seconds) never explodes on sub-second snaps */
const MIN_WINDOW_SEC = 1;
const DEFAULT_BANDS = derivePaceBands(DEFAULT_PACE_TARGET_WPM);
const HEALTHY_MIN = DEFAULT_BANDS.healthyMin;
const HEALTHY_MAX = DEFAULT_BANDS.healthyMax;
const RUSH_WPM = DEFAULT_BANDS.rushWpm;
const SLOW_WPM = DEFAULT_BANDS.slowWpm;
/** Don't hammer rush/slow penalties — room should feel coachable */
const RUSH_COOLDOWN_MS = 6500;
const SLOW_COOLDOWN_MS = 7000;
const STEADY_COOLDOWN_MS = 4500;

/** Placeholder / non-lexical Whisper junk */
const UNCLEAR_RE =
  /^[\s.…·•\-–—_/\\|,.!?0-9]*$|^(uh+|um+|hmm+|mhm+|ah+|oh+)$/i;

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function normalizeText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Extract only newly arrived words vs the previous packet.
 * Handles both isolated slice transcripts and cumulative STT strings.
 */
export function extractDeltaWords(previousText, incomingText) {
  const prev = normalizeText(previousText);
  const next = normalizeText(incomingText);
  if (!next) return { deltaText: "", newWords: 0 };
  if (!prev) {
    return { deltaText: next, newWords: wordCount(next) };
  }
  if (next === prev) {
    return { deltaText: "", newWords: 0 };
  }
  // Cumulative transcript grew by appending
  if (next.startsWith(prev)) {
    const deltaText = next.slice(prev.length).trim();
    return { deltaText, newWords: wordCount(deltaText) };
  }
  // Isolated chunk (typical Whisper slice) — count whole packet once
  return { deltaText: next, newWords: wordCount(next) };
}

function isUnclearText(text) {
  const clean = String(text || "").trim();
  if (!clean) return true;
  if (UNCLEAR_RE.test(clean)) return true;
  // Single opaque token with no vowels (often noise) — keep lenient
  if (clean.length <= 2 && !/[aeiouаеёиоуыэюя]/i.test(clean)) return true;
  return false;
}

class PacingTelemetry {
  constructor() {
    this.lastWordTimestamp = Date.now();
    this.pauseThresholdMs = PAUSE_THRESHOLD_MS;
    this.wordEvents = []; // { t, n } — delta word counts only
    this.wpm = 0;
    this.pacingBand = "idle"; // idle | slow | healthy | rush
    this.clarity = "unknown"; // clear | unclear | unknown
    this.targetWpm = DEFAULT_PACE_TARGET_WPM;
    this.healthyMin = HEALTHY_MIN;
    this.healthyMax = HEALTHY_MAX;
    this.rushWpm = RUSH_WPM;
    this.slowWpm = SLOW_WPM;
    this._loopId = null;
    this._pauseLatched = false;
    this._onSeverePause = null;
    this._onSpeech = null;
    this._handlers = {
      onSteadyPacing: null,
      onRushing: null,
      onTooSlow: null,
      onClearSpeech: null,
      onUnclearSpeech: null,
      onWpm: null,
    };
    this._listeners = new Set();
    this._holdDecay = null;
    this._lastSteadyAt = 0;
    this._lastRushAt = 0;
    this._lastSlowAt = 0;
    this._healthySince = null;
    /** Last ingested transcript packet (for cumulative-delta subtraction) */
    this._lastPacketText = "";
    /** Dedup guard — ignore identical packet re-registered within a short window */
    this._lastPacketAt = 0;
    this._windowStartedAt = null;
  }

  /**
   * Apply user / AI pace target before a rehearsal starts.
   * @param {number|{ targetWpm?: number, healthyMin?: number, healthyMax?: number, rushWpm?: number, slowWpm?: number }} config
   */
  configureFromTarget(config = DEFAULT_PACE_TARGET_WPM) {
    const bands =
      typeof config === "number"
        ? derivePaceBands(config)
        : {
            ...derivePaceBands(config.targetWpm ?? DEFAULT_PACE_TARGET_WPM),
            ...config,
          };
    this.targetWpm = bands.targetWpm;
    this.healthyMin = bands.healthyMin;
    this.healthyMax = bands.healthyMax;
    this.rushWpm = bands.rushWpm;
    this.slowWpm = bands.slowWpm;
    return bands;
  }

  /**
   * Refresh the pause clock WITHOUT adding words.
   * Use when another path already registered the delta packet.
   */
  touchSpeechClock() {
    this.lastWordTimestamp = Date.now();
    const wasPaused = this._pauseLatched;
    this._pauseLatched = false;
    if (wasPaused) {
      const evt = {
        type: "speech",
        at: this.lastWordTimestamp,
        text: "",
        words: 0,
        wpm: this.wpm,
        resumed: true,
      };
      this._onSpeech?.(evt);
      this._emit(evt);
    }
  }

  /**
   * CRITICAL: call on every non-empty Whisper transcript delta.
   * Halts attention decay by refreshing lastWordTimestamp.
   * Only UNIQUE new words are added to the rolling WPM buffer.
   */
  registerSpeechActivity(meta = {}) {
    this.lastWordTimestamp = Date.now();
    const wasPaused = this._pauseLatched;
    this._pauseLatched = false;
    const text = meta.text || "";

    // Explicit empty touch (session arm) — no word accounting
    if (!String(text).trim()) {
      const evt = {
        type: "speech",
        at: this.lastWordTimestamp,
        text: "",
        words: 0,
        wpm: this.wpm,
        resumed: wasPaused,
      };
      this._onSpeech?.(evt);
      this._emit(evt);
      this._handlers.onWpm?.(this.wpm, this.pacingBand);
      return evt;
    }

    const { deltaText, newWords } = extractDeltaWords(
      this._lastPacketText,
      text
    );

    // Identical re-ingest within 750ms (coordinator + metrics dual path) → ignore words
    const now = this.lastWordTimestamp;
    const isDupPacket =
      normalizeText(text) === this._lastPacketText &&
      now - this._lastPacketAt < 750;

    let counted = 0;
    if (!isDupPacket && newWords > 0) {
      counted = newWords;
      if (this._windowStartedAt == null) this._windowStartedAt = now;
      this.wordEvents.push({ t: now, n: counted, delta: deltaText });
      this._pruneWords(now);
    }

    this._lastPacketText = normalizeText(text) || this._lastPacketText;
    this._lastPacketAt = now;

    this.wpm = this.getWindowWpm({ log: counted > 0 });
    const evt = {
      type: "speech",
      at: now,
      text,
      words: counted,
      wpm: this.wpm,
      resumed: wasPaused,
    };
    this._onSpeech?.(evt);
    this._emit(evt);
    this._handlers.onWpm?.(this.wpm, this.pacingBand);
    return evt;
  }

  /** Mic energy + confident STT text → CLEAR SPEECH */
  registerClearSpeech(text) {
    const clean = String(text || "").trim();
    if (!clean || isUnclearText(clean)) {
      return this.registerUnclearSpeech({ reason: "weak-text", text: clean });
    }
    this.registerSpeechActivity({ text: clean });
    this.clarity = "clear";
    const evt = {
      type: "clear",
      text: clean,
      wpm: this.wpm,
      at: Date.now(),
    };
    this._handlers.onClearSpeech?.(evt);
    this._emit(evt);
    this._evaluatePacingBand(true);
    return evt;
  }

  /**
   * Physical audio present but Whisper empty / junk → UNCLEAR SPEECH
   * @param {{ reason?: string, text?: string, audioBytes?: number }} meta
   */
  registerUnclearSpeech(meta = {}) {
    this.clarity = "unclear";
    const evt = {
      type: "unclear",
      reason: meta.reason || "empty-stt",
      text: meta.text || "",
      audioBytes: meta.audioBytes || 0,
      at: Date.now(),
    };
    this._handlers.onUnclearSpeech?.(evt);
    this._emit(evt);
    return evt;
  }

  msSinceSpeech() {
    return Math.max(0, Date.now() - this.lastWordTimestamp);
  }

  isPaused() {
    if (this._shouldHoldDecay()) return false;
    return this.msSinceSpeech() >= this.pauseThresholdMs;
  }

  _shouldHoldDecay() {
    if (typeof this._holdDecay === "function" && this._holdDecay()) return true;
    try {
      if (audioTranscriptionService.inFlight) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  _pruneWords(now = Date.now()) {
    const cutoff = now - WPM_WINDOW_MS;
    this.wordEvents = this.wordEvents.filter((e) => e.t >= cutoff);
    if (!this.wordEvents.length) {
      this._windowStartedAt = null;
    } else if (
      this._windowStartedAt == null ||
      this._windowStartedAt < this.wordEvents[0].t
    ) {
      this._windowStartedAt = this.wordEvents[0].t;
    }
  }

  /**
   * Stable 5-second rolling WPM.
   * Always divides by the full window (floored at MIN_WINDOW_SEC) so
   * sub-second speech bursts cannot spike to 300+.
   * @param {{ log?: boolean }} [opts]
   */
  getWindowWpm(opts = {}) {
    const now = Date.now();
    this._pruneWords(now);
    if (!this.wordEvents.length) return 0;

    const newWords = this.wordEvents.reduce((a, e) => a + e.n, 0);
    // Fixed 5s rolling buffer denominator — never use a tiny fractional span
    const windowSeconds = Math.max(MIN_WINDOW_SEC, WPM_WINDOW_MS / 1000);
    const finalWPM = Math.round((newWords / windowSeconds) * 60);

    if (opts.log) {
      console.log(
        "[WPM Calibration Check] Raw Delta Count:",
        newWords,
        "| Time Windows:",
        windowSeconds,
        "| Calculated Result WPM:",
        finalWPM
      );
    }

    return finalWPM;
  }

  _evaluatePacingBand(fromSpeech = false) {
    const wpm = this.getWindowWpm();
    this.wpm = wpm;
    const now = Date.now();
    const wordsInWindow = this.wordEvents.reduce((a, e) => a + e.n, 0);

    const rushWpm = this.rushWpm;
    const slowWpm = this.slowWpm;
    const healthyMin = this.healthyMin;
    const healthyMax = this.healthyMax;

    // Need enough lexical mass before judging slow/rush
    if (wordsInWindow < 6 && wpm < rushWpm) {
      this.pacingBand = "idle";
      this._healthySince = null;
      return;
    }

    if (wpm >= rushWpm) {
      this.pacingBand = "rush";
      this._healthySince = null;
      if (now - this._lastRushAt > RUSH_COOLDOWN_MS) {
        this._lastRushAt = now;
        this._handlers.onRushing?.({ wpm });
        this._emit({ type: "rushing", wpm, at: now });
      }
      return;
    }

    if (wpm > 0 && wpm < slowWpm && wordsInWindow >= 10) {
      this.pacingBand = "slow";
      this._healthySince = null;
      if (now - this._lastSlowAt > SLOW_COOLDOWN_MS) {
        this._lastSlowAt = now;
        this._handlers.onTooSlow?.({ wpm });
        this._emit({ type: "too-slow", wpm, at: now });
      }
      return;
    }

    if (wpm >= healthyMin && wpm <= healthyMax) {
      this.pacingBand = "healthy";
      if (this._healthySince == null) this._healthySince = now;
      // Sustained healthy band — reward more often than we punish
      if (
        now - this._healthySince >= 3000 &&
        now - this._lastSteadyAt > STEADY_COOLDOWN_MS
      ) {
        this._lastSteadyAt = now;
        this._handlers.onSteadyPacing?.({ wpm });
        this._emit({ type: "steady", wpm, at: now });
      }
      return;
    }

    this.pacingBand = fromSpeech ? "idle" : this.pacingBand;
    if (wpm < healthyMin || wpm > healthyMax) {
      this._healthySince = null;
    }
  }

  startTelemetryLoop(onSeverePause, onSpeech, options = {}) {
    this.stopTelemetryLoop();
    this.lastWordTimestamp = Date.now();
    this._pauseLatched = false;
    this.wordEvents = [];
    this.wpm = 0;
    this.pacingBand = "idle";
    this.clarity = "unknown";
    this._healthySince = null;
    this._lastPacketText = "";
    this._lastPacketAt = 0;
    this._windowStartedAt = null;
    this._lastPauseEmitAt = 0;
    this._onSeverePause = onSeverePause || null;
    this._onSpeech = onSpeech || null;
    this._holdDecay = options.holdDecay || null;
    Object.assign(this._handlers, options.handlers || {});

    this._loopId = setInterval(() => {
      this._evaluatePacingBand(false);

      if (this._shouldHoldDecay()) return;
      const pauseMs = this.msSinceSpeech();
      if (pauseMs < this.pauseThresholdMs) return;

      if (!this._pauseLatched) {
        this._pauseLatched = true;
      }
      // Throttle pause callbacks to ~1/sec so attention doesn't bleed every 100ms
      // during normal Whisper latency between slices.
      if (!this._lastPauseEmitAt || Date.now() - this._lastPauseEmitAt >= 1000) {
        this._lastPauseEmitAt = Date.now();
        this._onSeverePause?.(pauseMs);
        this._emit({ type: "pause", pauseMs, at: Date.now() });
      }
    }, 100);
  }

  stopTelemetryLoop() {
    if (this._loopId) {
      clearInterval(this._loopId);
      this._loopId = null;
    }
    this._onSeverePause = null;
    this._onSpeech = null;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(evt) {
    this._listeners.forEach((fn) => {
      try {
        fn(evt);
      } catch (err) {
        console.warn("[PacingTelemetry] listener error", err);
      }
    });
    try {
      window.dispatchEvent(
        new CustomEvent("crowdwork:pacing", { detail: evt })
      );
    } catch {
      /* non-browser */
    }
  }

  getSnapshot() {
    return {
      lastWordTimestamp: this.lastWordTimestamp,
      pauseMs: this.msSinceSpeech(),
      pausing: this.isPaused(),
      wpm: this.getWindowWpm(),
      pacingBand: this.pacingBand,
      clarity: this.clarity,
      targetWpm: this.targetWpm,
      healthyMin: this.healthyMin,
      healthyMax: this.healthyMax,
      rushWpm: this.rushWpm,
      slowWpm: this.slowWpm,
    };
  }
}

const pacingTelemetry = new PacingTelemetry();
export default pacingTelemetry;
export {
  PacingTelemetry,
  PAUSE_THRESHOLD_MS,
  WPM_WINDOW_MS,
  MIN_WINDOW_SEC,
  HEALTHY_MIN,
  HEALTHY_MAX,
  RUSH_WPM,
  SLOW_WPM,
  isUnclearText,
  wordCount,
};
