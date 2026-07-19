/**
 * SessionCoordinator — mic MediaRecorder → Groq Whisper → PacingTelemetry.
 *
 * Guards against "waveform dances but Whisper hears silence":
 * 1. Adaptive MimeType negotiation (Safari often rejects audio/webm)
 * 2. Deep-copy chunk snapshots before clearing the live buffer
 * 3. Complete start→stop slices so containers keep valid headers
 * 4. Console telemetry: every blob logs mimeType + byte size
 */

import audioTranscriptionService from "../services/AudioTranscriptionService.js";
import pacingTelemetry from "../services/PacingTelemetry.js";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
];

function extensionForMime(mimeType) {
  const base = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (base.includes("mp4") || base.includes("aac") || base.includes("m4a")) {
    return "m4a";
  }
  if (base.includes("ogg")) return "ogg";
  if (base.includes("wav")) return "wav";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  return "webm";
}

class SessionCoordinator {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.mimeType = "";
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

  /** Dynamically negotiate the best supported container for this browser/OS. */
  getSupportedMimeType() {
    if (typeof MediaRecorder === "undefined") {
      console.warn(
        "CrowdWork AI: MediaRecorder unavailable — cannot negotiate audio encoding."
      );
      return "";
    }
    for (const type of MIME_CANDIDATES) {
      try {
        if (MediaRecorder.isTypeSupported(type)) {
          console.log(
            `CrowdWork AI: Enforcing validated audio encoding format -> ${type}`
          );
          return type;
        }
      } catch {
        /* ignore unsupported probe errors */
      }
    }
    console.warn(
      "CrowdWork AI: No preferred MimeType matched — using browser default MediaRecorder options."
    );
    return "";
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
    this.audioChunks = [];
    this.mimeType = this.getSupportedMimeType();

    pacingTelemetry.startTelemetryLoop(
      (pauseMs) => {
        if (!this._handlers.shouldRun()) return;
        this._handlers.onSeverePause?.(pauseMs);
      },
      (evt) => {
        if (evt.resumed) this._handlers.onSpeechResume?.(evt);
      }
    );

    // Seed so the meter doesn't tank before the first STT round-trip
    pacingTelemetry.registerSpeechActivity({ text: "" });

    this._armRecorder();
    this.ticker = setInterval(() => {
      void this._tickSlice();
    }, this._sliceMs);

    console.log(
      "[SessionCoordinator] Live STT pipeline armed",
      {
        mimeType: this.mimeType || "(browser default)",
        sliceMs: this._sliceMs,
        audioTracks: stream?.getAudioTracks?.().length || 0,
      }
    );
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
    this.audioChunks = [];
    this._busy = false;
  }

  _createRecorder() {
    if (!this.stream?.getAudioTracks?.().length) {
      throw new Error("No audio tracks on media stream.");
    }

    // Try negotiated type, then fall through candidates, then bare default
    const attempts = [];
    if (this.mimeType) attempts.push(this.mimeType);
    for (const type of MIME_CANDIDATES) {
      if (!attempts.includes(type)) attempts.push(type);
    }
    attempts.push(""); // browser default

    let lastErr = null;
    for (const type of attempts) {
      try {
        if (type && !MediaRecorder.isTypeSupported(type)) continue;
        const rec = type
          ? new MediaRecorder(this.stream, { mimeType: type })
          : new MediaRecorder(this.stream);
        this.mimeType = rec.mimeType || type || this.mimeType || "audio/webm";
        console.log(
          `CrowdWork AI: MediaRecorder opened with mimeType=${this.mimeType}`
        );
        return rec;
      } catch (err) {
        lastErr = err;
        console.warn(
          `CrowdWork AI: MediaRecorder rejected mimeType=${type || "(default)"}`,
          err
        );
      }
    }
    throw lastErr || new Error("Unable to construct MediaRecorder.");
  }

  _armRecorder() {
    this._teardownRecorder(false);
    if (!this.stream?.getAudioTracks?.().length) return;
    try {
      this.mediaRecorder = this._createRecorder();
    } catch (err) {
      this._handlers.onError?.(err);
      this.mediaRecorder = null;
      return;
    }

    this.audioChunks = [];
    this.mediaRecorder.ondataavailable = (event) => {
      // Only store valid, non-empty packets
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };
    this.mediaRecorder.onerror = (ev) => {
      console.error("[SessionCoordinator] MediaRecorder error", ev?.error || ev);
      this._handlers.onError?.(ev?.error || ev);
    };

    try {
      // Complete file per slice — avoids headerless timeslice WebM (Whisper silence)
      this.mediaRecorder.start();
    } catch (err) {
      this._handlers.onError?.(err);
    }
  }

  _teardownRecorder(clearChunks = true) {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onerror = null;
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.mediaRecorder = null;
    if (clearChunks) this.audioChunks = [];
  }

  /**
   * Stop the active recorder into a validated Blob.
   * Deep-copies chunk buffers before clearing the live array.
   */
  async _stopToBlob() {
    const rec = this.mediaRecorder;
    if (!rec || rec.state !== "recording") return null;

    const blob = await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;

        // FIX: clean snapshot copy, then reset the live track buffer
        const chunksToProcess = [...this.audioChunks];
        this.audioChunks = [];

        const currentMimeType =
          rec.mimeType || this.mimeType || "audio/webm";
        if (!chunksToProcess.length) {
          console.warn(
            "Telemetry Alert: Caught an empty audio chunk buffer. Data transmission skipped.",
            { mimeType: currentMimeType }
          );
          resolve(null);
          return;
        }

        const audioBlob = new Blob(chunksToProcess, { type: currentMimeType });
        console.log(
          `[SessionCoordinator] Audio blob compiled → mimeType=${currentMimeType} size=${audioBlob.size}B chunks=${chunksToProcess.length}`
        );

        if (audioBlob.size === 0) {
          console.warn(
            "Telemetry Alert: Caught an empty audio blob block. Data transmission skipped."
          );
          resolve(null);
          return;
        }

        resolve(audioBlob);
      };

      // Keep a single ondataavailable handler (no duplicate listeners)
      rec.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
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

      // Safety net if stop never fires
      setTimeout(finish, 1500);
    });

    this.mediaRecorder = null;
    return blob;
  }

  async _shipBlob(blob) {
    if (!blob || blob.size === 0) return null;

    const mimeType = blob.type || this.mimeType || "audio/webm";
    const ext = extensionForMime(mimeType);
    console.log(
      `[SessionCoordinator] Shipping STT payload → mimeType=${mimeType} size=${blob.size}B filename=recording.${ext}`
    );

    const language =
      (typeof this._handlers.getLanguage === "function"
        ? this._handlers.getLanguage()
        : "en") || "en";

    const text = await audioTranscriptionService.transcribeAudioPayload(
      blob,
      language,
      { mimeType, filename: `recording.${ext}` }
    );

    if (text && text.trim()) {
      pacingTelemetry.registerSpeechActivity({ text });
      this._handlers.onTranscript?.(text.trim());
    } else {
      console.warn(
        `[SessionCoordinator] Whisper returned empty text for ${blob.size}B ${mimeType} payload`
      );
    }
    return text || null;
  }

  async _tickSlice() {
    if (this._stopped || this._busy) return;
    if (!this._handlers.shouldRun()) return;
    this._busy = true;
    try {
      const blob = await this._stopToBlob();
      // Re-arm immediately so the next window keeps capturing
      if (!this._stopped) this._armRecorder();

      // Tiny blobs are usually container headers with no PCM — skip API waste
      if (!blob || blob.size < 256) {
        if (blob) {
          console.warn(
            `Telemetry Alert: Audio blob too small (${blob.size}B) — skipped.`
          );
        }
        return;
      }

      await this._shipBlob(blob);
    } catch (err) {
      console.error(
        "Transcription pipeline execution crash:",
        err
      );
      this._handlers.onError?.(err);
      if (!this._stopped && !this.mediaRecorder) this._armRecorder();
    } finally {
      this._busy = false;
    }
  }

  /** Force one final slice (e.g. slide change / finish). */
  async flushFinal() {
    if (this._stopped) return null;
    const waitStart = Date.now();
    while (this._busy && Date.now() - waitStart < 8000) {
      await new Promise((r) => setTimeout(r, 40));
    }
    this._busy = true;
    try {
      const blob = await this._stopToBlob();
      if (!this._stopped) this._armRecorder();
      if (!blob || blob.size < 200) return null;
      return await this._shipBlob(blob);
    } catch (err) {
      console.error("Transcription pipeline execution crash:", err);
      this._handlers.onError?.(err);
      return null;
    } finally {
      this._busy = false;
    }
  }
}

export default SessionCoordinator;
export { SessionCoordinator, MIME_CANDIDATES, extensionForMime };
