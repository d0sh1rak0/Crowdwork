/**
 * Text-driven vocal metrics from Groq Whisper chunks.
 * - Parasite/filler word scan
 * - Rushed pacing (>160 WPM / 10s window)
 * - Monotone / flat delivery from chunk structure
 *
 * Pause / attention decay is owned by PacingTelemetry.registerSpeechActivity().
 * This service still tracks lastTextAt for WPM windows and optional pause hooks.
 */

import pacingTelemetry from "./PacingTelemetry.js";
import {
  DEFAULT_PACE_TARGET_WPM,
  derivePaceBands,
} from "./paceConfig.js";

const DEFAULT_FILLERS = [
  "uh",
  "um",
  "like",
  "so",
  "basically",
  "you know",
  "right",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countPhrase(text, phrase) {
  const lower = text.toLowerCase();
  const p = phrase.toLowerCase();
  if (p.includes(" ")) {
    const pattern = escapeRegex(p);
    const re = new RegExp(`(?:^|\\s)${pattern}(?=\\s|$|[.,!?])`, "gi");
    return (lower.match(re) || []).length;
  }
  const re = new RegExp(`\\b${escapeRegex(p)}\\b`, "gi");
  return (lower.match(re) || []).length;
}

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

class VocalMetricsService {
  constructor() {
    this.pauseThresholdMs = 1500;
    this.rushedWpm = derivePaceBands(DEFAULT_PACE_TARGET_WPM).rushWpm;
    this.windowMs = 10000;
    this.fillers = DEFAULT_FILLERS;

    this.lastTextAt = null;
    this.startedAt = null;
    this.wordEvents = []; // { t, n }
    this.chunkMeta = []; // { t, words, chars, sentences }
    this.fillerTotal = 0;
    this.fillerCounts = {};
    this.pauseActive = false;
    this.state = "STEADY"; // STEADY | PAUSING | RUSHED | MONOTONE
    this._tickId = null;
    this._lastRushedAt = 0;
    this._lastMonotoneAt = 0;
    this._handlers = {
      onPauseStart: null,
      onPauseTick: null,
      onPauseEnd: null,
      onFiller: null,
      onRushed: null,
      onMonotone: null,
      onMetrics: null,
    };
  }

  /**
   * Keep rush threshold aligned with PacingTelemetry / pace tuner.
   * @param {number|{ rushWpm?: number, targetWpm?: number }} config
   */
  configureFromTarget(config = DEFAULT_PACE_TARGET_WPM) {
    if (typeof config === "number") {
      this.rushedWpm = derivePaceBands(config).rushWpm;
    } else if (config?.rushWpm != null) {
      this.rushedWpm = Number(config.rushWpm) || this.rushedWpm;
    } else {
      this.rushedWpm = derivePaceBands(
        config?.targetWpm ?? DEFAULT_PACE_TARGET_WPM
      ).rushWpm;
    }
    return this.rushedWpm;
  }

  start(handlers = {}) {
    this.stop();
    Object.assign(this._handlers, handlers);
    this.lastTextAt = performance.now();
    this.startedAt = performance.now();
    this.wordEvents = [];
    this.chunkMeta = [];
    this.fillerTotal = 0;
    this.fillerCounts = {};
    this.pauseActive = false;
    this.state = "STEADY";
    this._lastRushedAt = 0;
    this._lastMonotoneAt = 0;
    this._tickId = setInterval(() => this._evaluatePause(), 100);
  }

  stop() {
    if (this._tickId) {
      clearInterval(this._tickId);
      this._tickId = null;
    }
  }

  /** Call when a non-empty Whisper transcript chunk arrives. */
  ingestTranscript(text, lang = "en") {
    const clean = String(text || "").trim();
    if (!clean) return null;

    // Pause clock only — SessionCoordinator already registered the delta
    // via registerClearSpeech(). Re-counting here doubled WPM (~300+ spikes).
    pacingTelemetry.touchSpeechClock();

    const now = performance.now();
    const wasPaused = this.pauseActive;
    this.lastTextAt = now;
    if (this.pauseActive) {
      this.pauseActive = false;
      this._handlers.onPauseEnd?.(now);
    }

    const words = wordCount(clean);
    if (words > 0) {
      this.wordEvents.push({ t: now, n: words });
      this._pruneWords(now);
    }

    const sentences = (clean.match(/[.!?]+/g) || []).length || (words > 0 ? 1 : 0);
    this.chunkMeta.push({
      t: now,
      words,
      chars: clean.length,
      sentences,
      avgWordLen: words ? clean.replace(/\s+/g, "").length / words : 0,
    });
    if (this.chunkMeta.length > 40) this.chunkMeta.shift();

    const found = this._scanFillers(clean, lang);
    const wpm = this.getWindowWpm();
    let deliveryState = "STEADY";

    if (wpm >= this.rushedWpm) {
      deliveryState = "RUSHED";
      if (now - this._lastRushedAt > 4000) {
        this._lastRushedAt = now;
        this._handlers.onRushed?.({ wpm });
      }
    } else if (this._isMonotone()) {
      deliveryState = "MONOTONE";
      if (now - this._lastMonotoneAt > 5000) {
        this._lastMonotoneAt = now;
        this._handlers.onMonotone?.({});
      }
    }

    this.state = deliveryState;
    if (wasPaused && deliveryState === "STEADY") {
      /* recovered from pause into speech */
    }

    const metrics = {
      wpm,
      fillerTotal: this.fillerTotal,
      fillerCounts: { ...this.fillerCounts },
      state: this.state,
      pauseMs: 0,
      foundFillers: found,
    };
    this._handlers.onMetrics?.(metrics);
    return metrics;
  }

  _scanFillers(text) {
    const found = [];
    for (const word of this.fillers) {
      const n = countPhrase(text, word);
      if (n > 0) {
        this.fillerCounts[word] = (this.fillerCounts[word] || 0) + n;
        this.fillerTotal += n;
        for (let i = 0; i < n; i++) {
          found.push(word);
          this._handlers.onFiller?.(word, this.fillerTotal);
        }
      }
    }
    return found;
  }

  _pruneWords(now) {
    const cutoff = now - this.windowMs;
    this.wordEvents = this.wordEvents.filter((e) => e.t >= cutoff);
  }

  getWindowWpm() {
    const now = performance.now();
    this._pruneWords(now);
    if (!this.wordEvents.length) return 0;
    const words = this.wordEvents.reduce((a, e) => a + e.n, 0);
    // Stable rolling window denominator (never divide by sub-second spans)
    const windowSeconds = Math.max(1, this.windowMs / 1000);
    return Math.round((words / windowSeconds) * 60);
  }

  _isMonotone() {
    // Need several recent chunks with similar length + regular spacing
    if (this.chunkMeta.length < 4) return false;
    const recent = this.chunkMeta.slice(-6);
    const wordLens = recent.map((c) => c.words);
    const mean =
      wordLens.reduce((a, b) => a + b, 0) / Math.max(1, wordLens.length);
    if (mean < 3) return false;
    const variance =
      wordLens.reduce((a, w) => a + (w - mean) ** 2, 0) / wordLens.length;
    const std = Math.sqrt(variance);

    // Interval regularity
    const intervals = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i].t - recent[i - 1].t);
    }
    const iMean =
      intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
    const iVar =
      intervals.reduce((a, v) => a + (v - iMean) ** 2, 0) /
      Math.max(1, intervals.length);
    const iStd = Math.sqrt(iVar);

    // Flat vocabulary: similar avg word length
    const aw = recent.map((c) => c.avgWordLen);
    const awMean = aw.reduce((a, b) => a + b, 0) / aw.length;
    const awStd = Math.sqrt(
      aw.reduce((a, v) => a + (v - awMean) ** 2, 0) / aw.length
    );

    const flatLength = std / mean < 0.22;
    const regularPace = iMean > 0 && iStd / iMean < 0.28;
    const flatLexicon = awStd < 0.55;
    return flatLength && regularPace && flatLexicon;
  }

  _evaluatePause() {
    if (this.lastTextAt == null) return;
    const pauseMs = performance.now() - this.lastTextAt;
    if (pauseMs >= this.pauseThresholdMs) {
      if (!this.pauseActive) {
        this.pauseActive = true;
        this.state = this.state === "RUSHED" ? "RUSHED" : "PAUSING";
        this._handlers.onPauseStart?.(pauseMs);
      }
      this._handlers.onPauseTick?.(pauseMs);
      this._handlers.onMetrics?.({
        wpm: this.getWindowWpm(),
        fillerTotal: this.fillerTotal,
        fillerCounts: { ...this.fillerCounts },
        state: this.state,
        pauseMs,
        foundFillers: [],
      });
    }
  }

  getSnapshot() {
    return {
      wpm: this.getWindowWpm(),
      fillerTotal: this.fillerTotal,
      fillerCounts: { ...this.fillerCounts },
      state: this.state,
      pauseMs:
        this.lastTextAt == null
          ? 0
          : Math.max(0, performance.now() - this.lastTextAt),
    };
  }
}

const vocalMetricsService = new VocalMetricsService();
export default vocalMetricsService;
export { VocalMetricsService, DEFAULT_FILLERS };
