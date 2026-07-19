/**
 * SessionCoordinator — bridges mic MediaRecorder slices → Groq Whisper →
 * PacingTelemetry.registerSpeechActivity() so attention never decays while
 * valid STT text is flowing (waveform alone is not enough).
 *
 * Important: each slice is a complete MediaRecorder start→stop WebM file.
 * Timesliced chunks without a header are invalid and Whisper returns "".
 */

import audioTranscriptionService from "../services/AudioTranscriptionService.js";
import pacingTelemetry from "../services/PacingTelemetry.js";

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

class SessionCoordinator {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.mimeType = pickMimeType();
    this.ticker = null;
    this._sliceMs = 1200;
    this._busy = false;
    this._stopped = true;
    this._handlers = {
      onTranscript: null,
      onSeverePause: null,
      onSpeechResume: null,
      onError: null,
      getLanguage: () => "en",
      shouldRun: () => true,
    };
  }

  /**
   * @param {MediaStream} stream audio (or av) stream already granted
   * @param {object} handlers
   */
  start(stream, handlers = {}) {
    this.stop();
    this.stream = stream;
    Object.assign(this._handlers, handlers);
    this._stopped = false;
    this.mimeType = pickMimeType();

    // 1.5s precision drop loop — only fires without registerSpeechActivity
    pacingTelemetry.startTelemetryLoop(
      (pauseMs) => {
        if (!this._handlers.shouldRun()) return;
        this._handlers.onSeverePause?.(pauseMs);
      },
      (evt) => {
        if (evt.resumed) this._handlers.onSpeechResume?.(evt);
      }
    );

    // Seed activity so the meter doesn't tank before the first STT round-trip
    pacingTelemetry.registerSpeechActivity({ text: "" });

    this._armRecorder();
    this.ticker = setInterval(() => {
      void this._tickSlice();
    }, this._sliceMs);
  }

  stop() {
    this._stopped = true;
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    pacingTelemetry.stopTelemetryLoop();
    this._teardownRecorder();
    this.stream = null;
    this._busy = false;
  }

  _armRecorder() {
    this._teardownRecorder();
    if (!this.stream?.getAudioTracks?.().length) return;
    try {
      this.mediaRecorder = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch (err) {
      this._handlers.onError?.(err);
      this.mediaRecorder = null;
      return;
    }
    this._chunks = [];
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size) this._chunks.push(e.data);
    };
    try {
      this.mediaRecorder.start(); // complete file per slice — no timeslice headers loss
    } catch (err) {
      this._handlers.onError?.(err);
    }
  }

  _teardownRecorder() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.mediaRecorder = null;
    this._chunks = [];
  }

  async _stopToBlob() {
    const rec = this.mediaRecorder;
    if (!rec || rec.state !== "recording") return null;

    const blob = await new Promise((resolve) => {
      const chunks = this._chunks || [];
      const finish = () => {
        const type = this.mimeType || "audio/webm";
        resolve(chunks.length ? new Blob(chunks, { type }) : null);
      };
      rec.onstop = finish;
      try {
        rec.requestData();
      } catch {
        /* ignore */
      }
      try {
        rec.stop();
      } catch {
        finish();
      }
    });
    this.mediaRecorder = null;
    this._chunks = [];
    return blob;
  }

  async _tickSlice() {
    if (this._stopped || this._busy) return;
    if (!this._handlers.shouldRun()) return;
    this._busy = true;
    try {
      const blob = await this._stopToBlob();
      // Immediately re-arm so the next window captures live audio
      if (!this._stopped) this._armRecorder();

      if (!blob || blob.size < 400) return;

      const language =
        (typeof this._handlers.getLanguage === "function"
          ? this._handlers.getLanguage()
          : "en") || "en";

      const text = await audioTranscriptionService.transcribeAudio(
        blob,
        language
      );

      if (text && text.trim()) {
        // CRITICAL: halt attention decay — STT proves the user is speaking
        pacingTelemetry.registerSpeechActivity({ text });
        this._handlers.onTranscript?.(text.trim());
      }
    } catch (err) {
      console.error("[SessionCoordinator] STT slice failed", err);
      this._handlers.onError?.(err);
      if (!this._stopped && !this.mediaRecorder) this._armRecorder();
    } finally {
      this._busy = false;
    }
  }

  /** Force one final slice (e.g. slide change / finish). */
  async flushFinal() {
    if (this._stopped) return null;
    // Wait out an in-flight slice so we don't tear down mid-upload
    const waitStart = Date.now();
    while (this._busy && Date.now() - waitStart < 8000) {
      await new Promise((r) => setTimeout(r, 40));
    }
    this._busy = true;
    try {
      const blob = await this._stopToBlob();
      if (!this._stopped) this._armRecorder();
      if (!blob || blob.size < 200) return null;
      const language =
        (typeof this._handlers.getLanguage === "function"
          ? this._handlers.getLanguage()
          : "en") || "en";
      const text = await audioTranscriptionService.transcribeAudio(
        blob,
        language
      );
      if (text?.trim()) {
        pacingTelemetry.registerSpeechActivity({ text });
        this._handlers.onTranscript?.(text.trim());
      }
      return text || null;
    } catch (err) {
      this._handlers.onError?.(err);
      return null;
    } finally {
      this._busy = false;
    }
  }
}

export default SessionCoordinator;
export { SessionCoordinator };
