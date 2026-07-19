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
   * @param {{ mimeType?: string, filename?: string }} [meta]
   * @returns {Promise<string>} trimmed transcript ("" if silence / failure)
   */
  async transcribeAudio(audioBlob, language = "en", meta = {}) {
    return this.transcribeAudioPayload(audioBlob, language, meta);
  }

  /**
   * Validated payload path — logs mime/size and refuses empty blobs.
   * @param {Blob|FormData} blobOrForm
   * @param {string} [language]
   * @param {{ mimeType?: string, filename?: string }} [meta]
   */
  async transcribeAudioPayload(blobOrForm, language = "en", meta = {}) {
    let blob = null;
    let filename = meta.filename || "recording.webm";
    let mimeType = meta.mimeType || "";

    if (blobOrForm instanceof FormData) {
      // Already packaged by caller — ship as-is through api helper path
      this._inFlight += 1;
      try {
        const { text } = await apiTranscribe(blobOrForm, language);
        return this._finalize(text, language);
      } catch (err) {
        console.error("[STT] Pipeline transmission failure:", err);
        throw err;
      } finally {
        this._inFlight = Math.max(0, this._inFlight - 1);
      }
    }

    blob = blobOrForm;
    if (!blob || typeof blob.size !== "number") return "";
    mimeType = mimeType || blob.type || "audio/webm";
    if (!meta.filename) {
      const ext = mimeType.includes("mp4") || mimeType.includes("aac")
        ? "m4a"
        : mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("wav")
            ? "wav"
            : "webm";
      filename = `recording.${ext}`;
    }

    console.log(
      `[STT] Payload check → mimeType=${mimeType} size=${blob.size}B file=${filename}`
    );

    if (blob.size === 0) {
      console.warn(
        "Telemetry Alert: Caught an empty audio blob block. Data transmission skipped."
      );
      return "";
    }
    if (blob.size < 200) {
      console.warn(
        `Telemetry Alert: Audio blob too small (${blob.size}B). Data transmission skipped.`
      );
      return "";
    }

    this._inFlight += 1;
    try {
      const { text } = await apiTranscribe(blob, language, {
        mimeType,
        filename,
      });
      return this._finalize(text, language);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Short-slice / empty-PCM is recoverable — don't crash the ticker
      if (/too short|no usable speech|empty audio/i.test(msg)) {
        console.warn("[STT] Skipped unusable slice:", msg);
        return "";
      }
      console.error("[STT] Pipeline transmission failure:", err);
      throw err;
    } finally {
      this._inFlight = Math.max(0, this._inFlight - 1);
    }
  }

  _finalize(text, language) {
    const clean = String(text || "").trim();
    if (!clean) return "";
    this.lastText = clean;
    this.lastAt = Date.now();
    this._emit(clean, language);
    console.log(
      `[STT] Transcript received (${clean.split(/\s+/).length} words):`,
      clean.slice(0, 120)
    );
    return clean;
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
