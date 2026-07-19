/**
 * AudioTranscriptionService — Groq Whisper STT via server proxy.
 * On every non-empty transcript, emits a global event and notifies subscribers
 * so PacingTelemetry.registerSpeechActivity() can halt attention decay.
 */

import { transcribeAudio as apiTranscribe } from "../api.js";

const EVENT_NAME = "crowdwork:stt-transcript";

class AudioTranscriptionService {
  constructor() {
    this._subscribers = new Set();
    this._inFlight = 0;
    this.lastText = "";
    this.lastAt = 0;
  }

  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /**
   * @param {Blob} audioBlob
   * @param {string} [language]
   * @returns {Promise<string>} trimmed transcript ("" if silence / failure)
   */
  async transcribeAudio(audioBlob, language = "en") {
    if (!audioBlob || audioBlob.size < 200) return "";

    this._inFlight += 1;
    try {
      const { text } = await apiTranscribe(audioBlob, language);
      const clean = String(text || "").trim();
      if (!clean) return "";

      this.lastText = clean;
      this.lastAt = Date.now();
      this._emit(clean, language);
      return clean;
    } catch (err) {
      console.error("[STT] Pipeline transmission failure:", err);
      throw err;
    } finally {
      this._inFlight = Math.max(0, this._inFlight - 1);
    }
  }

  get inFlight() {
    return this._inFlight > 0;
  }

  _emit(text, language) {
    const detail = { text, language, at: Date.now() };
    this._subscribers.forEach((fn) => {
      try {
        fn(detail);
      } catch (err) {
        console.warn("[STT] subscriber error", err);
      }
    });
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    } catch {
      /* non-browser */
    }
  }
}

const audioTranscriptionService = new AudioTranscriptionService();
export default audioTranscriptionService;
export { AudioTranscriptionService, EVENT_NAME };
