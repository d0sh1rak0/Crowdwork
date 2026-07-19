/**
 * PacingTelemetry — Vocal Attention Matrix engine.
 *
 * - Pause clock (≥1.5s without STT words)
 * - 5s moving WPM window with 120–150 healthy band
 * - Clear / unclear speech classification
 * - Live pacing overlay events (RUSHING / TOO SLOW)
 */

import audioTranscriptionService from "./AudioTranscriptionService.js";

const PAUSE_THRESHOLD_MS = 1500;
const WPM_WINDOW_MS = 5000;
const HEALTHY_MIN = 120;
const HEALTHY_MAX = 150;
const RUSH_WPM = 160;
const SLOW_WPM = 110;

/** Placeholder / non-lexical Whisper junk */
const UNCLEAR_RE =
  /^[\s.…·•\-–—_/\\|,.!?0-9]*$|^(uh+|um+|hmm+|mhm+|ah+|oh+)$/i;

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
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
    this.wordEvents = []; // { t, n }
    this.wpm = 0;
    this.pacingBand = "idle"; // idle | slow | healthy | rush
    this.clarity = "unknown"; // clear | unclear | unknown
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
  }

  /**
   * CRITICAL: call on every non-empty Whisper transcript.
   * Halts attention decay by refreshing lastWordTimestamp.
   */
  registerSpeechActivity(meta = {}) {
    this.lastWordTimestamp = Date.now();
    const wasPaused = this._pauseLatched;
    this._pauseLatched = false;
    const text = meta.text || "";
    const n = wordCount(text);
    if (n > 0) {
      this.wordEvents.push({ t: this.lastWordTimestamp, n });
      this._pruneWords(this.lastWordTimestamp);
    }
    this.wpm = this.getWindowWpm();
    const evt = {
      type: "speech",
      at: this.lastWordTimestamp,
      text,
      words: n,
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
  }

  /** Moving 5-second words-per-minute */
  getWindowWpm() {
    const now = Date.now();
    this._pruneWords(now);
    if (!this.wordEvents.length) return 0;
    const words = this.wordEvents.reduce((a, e) => a + e.n, 0);
    const spanMs = Math.max(
      1000,
      now - (this.wordEvents[0]?.t || now)
    );
    const windowUsed = Math.min(WPM_WINDOW_MS, Math.max(spanMs, 2000));
    return Math.round((words / windowUsed) * 60000);
  }

  _evaluatePacingBand(fromSpeech = false) {
    const wpm = this.getWindowWpm();
    this.wpm = wpm;
    const now = Date.now();
    const wordsInWindow = this.wordEvents.reduce((a, e) => a + e.n, 0);

    // Need enough lexical mass before judging slow/rush
    if (wordsInWindow < 4 && wpm < RUSH_WPM) {
      this.pacingBand = "idle";
      this._healthySince = null;
      return;
    }

    if (wpm >= RUSH_WPM) {
      this.pacingBand = "rush";
      this._healthySince = null;
      if (now - this._lastRushAt > 3500) {
        this._lastRushAt = now;
        this._handlers.onRushing?.({ wpm });
        this._emit({ type: "rushing", wpm, at: now });
      }
      return;
    }

    if (wpm > 0 && wpm < SLOW_WPM && wordsInWindow >= 6) {
      this.pacingBand = "slow";
      this._healthySince = null;
      if (now - this._lastSlowAt > 4000) {
        this._lastSlowAt = now;
        this._handlers.onTooSlow?.({ wpm });
        this._emit({ type: "too-slow", wpm, at: now });
      }
      return;
    }

    if (wpm >= HEALTHY_MIN && wpm <= HEALTHY_MAX) {
      this.pacingBand = "healthy";
      if (this._healthySince == null) this._healthySince = now;
      // Sustained healthy band across a full 5s sampling block
      if (
        now - this._healthySince >= WPM_WINDOW_MS &&
        now - this._lastSteadyAt > WPM_WINDOW_MS
      ) {
        this._lastSteadyAt = now;
        this._handlers.onSteadyPacing?.({ wpm });
        this._emit({ type: "steady", wpm, at: now });
      }
      return;
    }

    this.pacingBand = fromSpeech ? "idle" : this.pacingBand;
    if (wpm < HEALTHY_MIN || wpm > HEALTHY_MAX) {
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
      this._onSeverePause?.(pauseMs);
      this._emit({ type: "pause", pauseMs, at: Date.now() });
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
    };
  }
}

const pacingTelemetry = new PacingTelemetry();
export default pacingTelemetry;
export {
  PacingTelemetry,
  PAUSE_THRESHOLD_MS,
  WPM_WINDOW_MS,
  HEALTHY_MIN,
  HEALTHY_MAX,
  RUSH_WPM,
  SLOW_WPM,
  isUnclearText,
};
