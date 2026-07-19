/**
 * PacingTelemetry — text-driven pause clock.
 * Attention decay is gated solely on registerSpeechActivity() from STT text,
 * never on ambient mic volume / waveform energy.
 */

import audioTranscriptionService from "./AudioTranscriptionService.js";

const PAUSE_THRESHOLD_MS = 1500;

class PacingTelemetry {
  constructor() {
    this.lastWordTimestamp = Date.now();
    this.pauseThresholdMs = PAUSE_THRESHOLD_MS;
    this._loopId = null;
    this._pauseLatched = false;
    this._onSeverePause = null;
    this._onSpeech = null;
    this._listeners = new Set();
    /** Optional gate: () => boolean — when true, decay ticks are skipped */
    this._holdDecay = null;
  }

  /**
   * CRITICAL: call on every non-empty Whisper transcript.
   * Halts attention decay by refreshing lastWordTimestamp.
   */
  registerSpeechActivity(meta = {}) {
    this.lastWordTimestamp = Date.now();
    const wasPaused = this._pauseLatched;
    this._pauseLatched = false;
    const evt = {
      type: "speech",
      at: this.lastWordTimestamp,
      text: meta.text || "",
      resumed: wasPaused,
    };
    this._onSpeech?.(evt);
    this._emit(evt);
    return evt;
  }

  /** ms since last registered spoken words */
  msSinceSpeech() {
    return Math.max(0, Date.now() - this.lastWordTimestamp);
  }

  isPaused() {
    if (this._shouldHoldDecay()) return false;
    return this.msSinceSpeech() >= this.pauseThresholdMs;
  }

  _shouldHoldDecay() {
    if (typeof this._holdDecay === "function" && this._holdDecay()) return true;
    // While Whisper is in-flight, do not treat STT latency as silence
    try {
      if (audioTranscriptionService.inFlight) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * 100ms precision loop. Callback fires only while speech has been
   * absent longer than pauseThresholdMs (default 1.5s).
   */
  startTelemetryLoop(onSeverePause, onSpeech, options = {}) {
    this.stopTelemetryLoop();
    this.lastWordTimestamp = Date.now();
    this._pauseLatched = false;
    this._onSeverePause = onSeverePause || null;
    this._onSpeech = onSpeech || null;
    this._holdDecay = options.holdDecay || null;

    this._loopId = setInterval(() => {
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
    };
  }
}

const pacingTelemetry = new PacingTelemetry();
export default pacingTelemetry;
export { PacingTelemetry, PAUSE_THRESHOLD_MS };
