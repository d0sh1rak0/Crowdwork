/**
 * AudioTranscriptionService — Groq Whisper STT via server proxy.
 * On every non-empty transcript, emits a global event and notifies subscribers
 * so PacingTelemetry.registerSpeechActivity() can halt attention decay.
 */

import { transcribeAudio as apiTranscribe } from "../api.js";

const EVENT_NAME = "crowdwork:stt-transcript";

/** Known empty-slice / YouTube-outro hallucinations from Whisper */
const HALLUCINATION_RE =
  /^(?:thanks?\s+for\s+watching|thank\s+you\s+for\s+watching|please\s+subscribe|продолжение\s+следует|субтитры\s+создал|субтитры\s+сделал|подписывайтесь|thanks\s+for\s+listening|you$|bye\.?|ам+|uhm+|mm+$|\.+|♪+|\[(?:music|silence|blank_audio)\])\.?$/iu;

function isWhisperHallucination(text, language) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (HALLUCINATION_RE.test(t)) return true;
  // Ultra-short non-lexical junk
  if (t.length <= 2) return true;
  // Repeated single token spam ("you you you")
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 4 && new Set(words).size === 1) return true;
  // Language mismatch: Cyrillic-only when expecting English (and vice versa) on short lines
  const cyr = (t.match(/[\u0400-\u04FF]/g) || []).length;
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  if (language === "en" && cyr > lat && cyr >= 6 && words.length <= 5) return true;
  if (language === "ru" && lat > cyr * 2 && lat >= 10 && words.length <= 4) return true;
  return false;
}

function stripPromptEcho(text) {
  return String(text || "")
    .replace(/^(?:the following is|transcript:|slide\s*\d+:)\s*/i, "")
    .trim();
}

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
   * @param {{ mimeType?: string, filename?: string, prompt?: string }} [meta]
   * @returns {Promise<string>} trimmed transcript ("" if silence / failure)
   */
  async transcribeAudio(audioBlob, language = "en", meta = {}) {
    return this.transcribeAudioPayload(audioBlob, language, meta);
  }

  /**
   * Validated payload path — logs mime/size and refuses empty blobs.
   * @param {Blob|FormData} blobOrForm
   * @param {string} [language]
   * @param {{ mimeType?: string, filename?: string, prompt?: string }} [meta]
   */
  async transcribeAudioPayload(blobOrForm, language = "en", meta = {}) {
    let blob = null;
    let filename = meta.filename || "recording.webm";
    let mimeType = meta.mimeType || "";
    const prompt = String(meta.prompt || "").trim();

    if (blobOrForm instanceof FormData) {
      // Already packaged by caller — ship as-is through api helper path
      this._inFlight += 1;
      try {
        const { text } = await apiTranscribe(blobOrForm, language, { prompt });
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
        prompt,
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
    let clean = String(text || "").trim();
    if (!clean) return "";
    if (isWhisperHallucination(clean, language)) {
      console.warn("[STT] Dropped Whisper hallucination:", clean.slice(0, 80));
      return "";
    }
    // Strip leading prompt echo (Whisper sometimes repeats the bias prompt)
    clean = stripPromptEcho(clean);
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
