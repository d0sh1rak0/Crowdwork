/**
 * SessionCoordinator — mic MediaRecorder → Groq Whisper → PacingTelemetry.
 *
 * Whole-file slice architecture (fixes Whisper "silence" while waveform dances):
 * - Adaptive MimeType negotiation (Safari often rejects audio/webm)
 * - Every interval: MediaRecorder.start() → wait 1s → stop()
 * - That yields a mathematically whole container WITH native headers
 * - Deep-copy chunk snapshot before clearing the live buffer
 * - Never use timeslice start(1000) (headerless orphan blobs)
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

// 2.5s whole-file slices — 1s MediaRecorder WebMs often have ~0s duration for Whisper
const SLICE_MS = 2500;

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

/** Basic container magic-byte check so we never ship headerless fragments. */
async function looksLikeWholeContainer(blob, mimeType) {
  if (!blob || blob.size < 32) return false;
  const buf = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const mime = String(mimeType || blob.type || "").toLowerCase();

  // EBML / WebM / Matroska: 1A 45 DF A3
  const isEbml =
    buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  // ISO BMFF (mp4/m4a): bytes 4..7 === 'ftyp'
  const isFtyp =
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  // OggS
  const isOgg =
    buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53;
  // RIFF....WAVE
  const isWav =
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46;

  if (mime.includes("webm") || mime.includes("matroska")) return isEbml;
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) {
    return isFtyp;
  }
  if (mime.includes("ogg")) return isOgg;
  if (mime.includes("wav")) return isWav;
  // Unknown negotiated type — accept any recognized magic
  return isEbml || isFtyp || isOgg || isWav;
}

class SessionCoordinator {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.mimeType = "";
    this.ticker = null;
    this._sliceMs = SLICE_MS;
    this._busy = false;
    this._stopped = true;
    this._handlers = {
      onTranscript: null,
      onClearSpeech: null,
      onUnclearSpeech: null,
      onSeverePause: null,
      onSpeechResume: null,
      onError: null,
      getLanguage: () => "en",
      shouldRun: () => true,
      /** Optional: () => boolean — mic visualizer sees energy */
      hasMicSignal: () => false,
      /** Forwarded into PacingTelemetry.startTelemetryLoop({ handlers }) */
      pacingHandlers: null,
    };
  }

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
        /* ignore */
      }
    }
    console.warn(
      "CrowdWork AI: No preferred MimeType matched — using browser default."
    );
    return "";
  }

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
      },
      { handlers: this._handlers.pacingHandlers || {} }
    );

    pacingTelemetry.registerSpeechActivity({ text: "" });

    // Sequential loop: each iteration records a full 1s container, then ships it.
    // (setInterval would overlap with the 1s capture and skip every other slice)
    this._loopActive = true;
    void this._runSliceLoop();

    console.log("[SessionCoordinator] Live STT pipeline armed", {
      mimeType: this.mimeType || "(browser default)",
      sliceMs: this._sliceMs,
      mode: "whole-file start→stop (no timeslice)",
      audioTracks: stream?.getAudioTracks?.().length || 0,
    });
  }

  async _runSliceLoop() {
    while (!this._stopped && this._loopActive) {
      if (!this._handlers.shouldRun()) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      await this._tickSlice();
    }
  }

  stop() {
    this._stopped = true;
    this._loopActive = false;
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

    const attempts = [];
    if (this.mimeType) attempts.push(this.mimeType);
    for (const type of MIME_CANDIDATES) {
      if (!attempts.includes(type)) attempts.push(type);
    }
    attempts.push("");

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

  _teardownRecorder() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onerror = null;
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  /**
   * Record exactly one whole container file for `durationMs`, then stop.
   * NEVER uses MediaRecorder.start(timeslice) — that drops headers.
   */
  async _captureWholeSlice(durationMs = SLICE_MS) {
    if (!this.stream?.getAudioTracks?.().length) return null;

    const rec = this._createRecorder();
    this.mediaRecorder = rec;
    this.audioChunks = [];

    const blobPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;

        // Deep-copy snapshot BEFORE clearing the live buffer
        const chunksToProcess = [...this.audioChunks];
        this.audioChunks = [];

        const currentMimeType = rec.mimeType || this.mimeType || "audio/webm";
        if (!chunksToProcess.length) {
          console.warn(
            "Telemetry Alert: empty chunk buffer after stop — skipped.",
            { mimeType: currentMimeType }
          );
          resolve(null);
          return;
        }

        const audioBlob = new Blob(chunksToProcess, { type: currentMimeType });
        console.log(
          `[SessionCoordinator] Whole audio blob compiled → mimeType=${currentMimeType} size=${audioBlob.size}B chunks=${chunksToProcess.length}`
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

      rec.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      rec.onerror = (ev) => {
        console.error("[SessionCoordinator] MediaRecorder error", ev?.error || ev);
        finish();
      };
      rec.onstop = finish;

      try {
        // CRITICAL: no timeslice argument — one complete file with headers
        rec.start();
      } catch (err) {
        console.error("Critical failure starting MediaRecorder:", err);
        resolve(null);
        return;
      }

      setTimeout(() => {
        if (rec.state === "recording") {
          // Do NOT call requestData() first — mid-stream flushes break WebM
          // duration metadata and Groq returns "Audio file is too short".
          try {
            rec.stop();
          } catch {
            finish();
          }
        } else {
          finish();
        }
      }, durationMs);
    });

    const blob = await blobPromise;
    this.mediaRecorder = null;
    return blob;
  }

  async _shipBlob(blob) {
    if (!blob || blob.size === 0) return null;

    // Strip codec params for uploads (audio/webm;codecs=opus → audio/webm)
    const mimeType = String(blob.type || this.mimeType || "audio/webm")
      .split(";")[0]
      .trim();
    const ext = extensionForMime(mimeType);

    const whole = await looksLikeWholeContainer(blob, mimeType);
    if (!whole) {
      console.warn(
        `[CrowdWork Debug] Rejecting orphan/headerless blob: size = ${blob.size} bytes, type = ${mimeType}`
      );
      return null;
    }

    // Explicit user-facing debug line (required)
    console.log(
      `[CrowdWork Debug] Audio payload sent: size = ${blob.size} bytes, type = ${mimeType}`
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

    const clean = text && text.trim() ? text.trim() : "";
    const micHot =
      typeof this._handlers.hasMicSignal === "function"
        ? this._handlers.hasMicSignal()
        : false;
    // Substantial blob ≈ physical audio was present in the slice
    const audioPresent = micHot || blob.size >= 3500;

    if (clean) {
      pacingTelemetry.registerClearSpeech(clean);
      this._handlers.onClearSpeech?.({ text: clean, bytes: blob.size });
      this._handlers.onTranscript?.(clean);
    } else if (audioPresent) {
      console.warn(
        `[SessionCoordinator] UNCLEAR SPEECH — audio bytes=${blob.size} but empty STT`
      );
      pacingTelemetry.registerUnclearSpeech({
        reason: "empty-stt",
        audioBytes: blob.size,
      });
      this._handlers.onUnclearSpeech?.({
        bytes: blob.size,
        micHot,
      });
    } else {
      console.warn(
        `[SessionCoordinator] Whisper empty for quiet ${blob.size}B ${mimeType} slice`
      );
    }
    return clean || null;
  }

  async _tickSlice() {
    if (this._stopped || this._busy) return;
    if (!this._handlers.shouldRun()) return;
    this._busy = true;
    try {
      const blob = await this._captureWholeSlice(this._sliceMs);
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
      console.error("Transcription pipeline execution crash:", err);
      this._handlers.onError?.(err);
    } finally {
      this._busy = false;
    }
  }

  async flushFinal() {
    if (this._stopped) return null;
    const waitStart = Date.now();
    while (this._busy && Date.now() - waitStart < 8000) {
      await new Promise((r) => setTimeout(r, 40));
    }
    this._busy = true;
    try {
      // Final flush still needs enough audio for Whisper duration checks
      const blob = await this._captureWholeSlice(
        Math.min(2000, this._sliceMs)
      );
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
export { SessionCoordinator, MIME_CANDIDATES, extensionForMime, SLICE_MS };
