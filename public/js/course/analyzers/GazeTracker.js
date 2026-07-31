/**
 * Gaze tracking via MediaPipe Face Landmarker.
 * Estimates iris offset within each eye to detect camera-directed gaze
 * vs downward breaks and rapid side-to-side darting.
 */

import { createFaceLandmarker } from "./MediaPipeLoader.js";

// MediaPipe Face Landmarker iris / eye indices (refined face mesh)
const LEFT_IRIS = [474, 475, 476, 477];
const RIGHT_IRIS = [469, 470, 471, 472];
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;

function avgPoint(landmarks, idxs) {
  let x = 0;
  let y = 0;
  for (const i of idxs) {
    x += landmarks[i].x;
    y += landmarks[i].y;
  }
  return { x: x / idxs.length, y: y / idxs.length };
}

function eyeGaze(landmarks, irisIdx, outer, inner, top, bottom) {
  const iris = avgPoint(landmarks, irisIdx);
  const ox = landmarks[outer].x;
  const ix = landmarks[inner].x;
  const ty = landmarks[top].y;
  const by = landmarks[bottom].y;
  const eyeW = Math.max(1e-4, Math.abs(ix - ox));
  const eyeH = Math.max(1e-4, Math.abs(by - ty));
  // Normalize: 0.5 = center. Y > 0.5 = looking down in image space.
  const nx = (iris.x - Math.min(ox, ix)) / eyeW;
  const ny = (iris.y - Math.min(ty, by)) / eyeH;
  return { nx, ny, iris };
}

/**
 * @typedef {{
 *   lookingAtCamera: boolean,
 *   lookingDown: boolean,
 *   horizontal: number,
 *   vertical: number,
 *   smileScore: number,
 *   facePresent: boolean,
 * }} GazeFrame
 */

export default class GazeTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.raf = 0;
    this.running = false;
    this.lastTs = -1;
    this.handlers = {};
    /** @type {GazeFrame|null} */
    this.last = null;

    // Accumulators
    this.samples = 0;
    this.onCameraSamples = 0;
    this.downBreakEvents = 0;
    this.downBreakMs = 0;
    this._downSince = null;
    this.steadyBlockMs = 0;
    this._steadySince = null;
    this.completedSteadyBlocks = 0;
    this.dartEvents = 0;
    this._horizHist = [];
    this.available = false;
    this.error = null;

    // Tunables
    this.cameraNxMax = 0.22; // |nx-0.5|
    this.cameraNyMax = 0.18;
    this.downNyThresh = 0.62;
    this.downBreakSec = 0.5;
    this.steadyBlockSec = 3;
    this.dartWindowMs = 450;
    this.dartAmp = 0.28;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {{ onAlert?: Function, onFrame?: Function, onSteadyBlock?: Function }} handlers
   */
  async start(video, handlers = {}) {
    this.stop();
    this.video = video;
    this.handlers = handlers;
    this._resetStats();
    try {
      this.landmarker = await createFaceLandmarker();
      this.available = true;
    } catch (err) {
      this.available = false;
      this.error = err instanceof Error ? err.message : String(err);
      console.warn("[GazeTracker] unavailable:", this.error);
      return false;
    }
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return true;
  }

  _resetStats() {
    this.samples = 0;
    this.onCameraSamples = 0;
    this.downBreakEvents = 0;
    this.downBreakMs = 0;
    this._downSince = null;
    this.steadyBlockMs = 0;
    this._steadySince = null;
    this.completedSteadyBlocks = 0;
    this.dartEvents = 0;
    this._horizHist = [];
    this.last = null;
    this.lastTs = -1;
  }

  _tick() {
    const video = this.video;
    if (!video || video.readyState < 2 || !this.landmarker) return;
    const now = performance.now();
    if (now === this.lastTs) return;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, now);
    } catch {
      return;
    }
    this.lastTs = now;

    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks || landmarks.length < 478) {
      this.last = {
        lookingAtCamera: false,
        lookingDown: false,
        horizontal: 0.5,
        vertical: 0.5,
        smileScore: 0,
        facePresent: false,
      };
      this._updateDown(false, now);
      this._updateSteady(false, now);
      this.handlers.onFrame?.(this.last);
      return;
    }

    const L = eyeGaze(
      landmarks,
      LEFT_IRIS,
      LEFT_EYE_OUTER,
      LEFT_EYE_INNER,
      LEFT_EYE_TOP,
      LEFT_EYE_BOTTOM
    );
    const R = eyeGaze(
      landmarks,
      RIGHT_IRIS,
      RIGHT_EYE_OUTER,
      RIGHT_EYE_INNER,
      RIGHT_EYE_TOP,
      RIGHT_EYE_BOTTOM
    );
    const nx = (L.nx + R.nx) / 2;
    const ny = (L.ny + R.ny) / 2;
    const lookingDown = ny >= this.downNyThresh;
    const lookingAtCamera =
      Math.abs(nx - 0.5) <= this.cameraNxMax &&
      Math.abs(ny - 0.5) <= this.cameraNyMax &&
      !lookingDown;

    const smileScore = this._smileFromBlendshapes(result.faceBlendshapes?.[0]);

    this.samples += 1;
    if (lookingAtCamera) this.onCameraSamples += 1;

    this._trackDart(nx, now);
    this._updateDown(lookingDown, now);
    this._updateSteady(lookingAtCamera, now);

    this.last = {
      lookingAtCamera,
      lookingDown,
      horizontal: nx,
      vertical: ny,
      smileScore,
      facePresent: true,
    };
    this.handlers.onFrame?.(this.last);
  }

  _smileFromBlendshapes(pack) {
    if (!pack?.categories) return 0;
    const map = Object.fromEntries(
      pack.categories.map((c) => [c.categoryName, c.score])
    );
    const mouth = map.mouthSmileLeft ?? 0;
    const mouthR = map.mouthSmileRight ?? 0;
    const cheek = map.cheekSquintLeft ?? 0;
    return Math.min(1, (mouth + mouthR) / 2 + cheek * 0.35);
  }

  _updateDown(lookingDown, now) {
    if (lookingDown) {
      if (this._downSince == null) this._downSince = now;
      const dur = (now - this._downSince) / 1000;
      if (dur >= this.downBreakSec && !this._downAlerted) {
        this._downAlerted = true;
        this.downBreakEvents += 1;
        this.handlers.onAlert?.({
          type: "downward_break",
          message: "Break Detected: Looked Down",
        });
      }
    } else {
      if (this._downSince != null) {
        this.downBreakMs += now - this._downSince;
      }
      this._downSince = null;
      this._downAlerted = false;
    }
  }

  _updateSteady(onCamera, now) {
    if (onCamera) {
      if (this._steadySince == null) this._steadySince = now;
      const dur = (now - this._steadySince) / 1000;
      if (dur >= this.steadyBlockSec) {
        this.completedSteadyBlocks += 1;
        this.steadyBlockMs += this.steadyBlockSec * 1000;
        this._steadySince = now; // chain next block
        this.handlers.onSteadyBlock?.({
          blocks: this.completedSteadyBlocks,
          sec: this.steadyBlockSec,
        });
      }
    } else {
      if (this._steadySince != null) {
        this.steadyBlockMs += now - this._steadySince;
      }
      this._steadySince = null;
    }
  }

  _trackDart(nx, now) {
    this._horizHist.push({ nx, t: now });
    const cut = now - this.dartWindowMs;
    this._horizHist = this._horizHist.filter((h) => h.t >= cut);
    if (this._horizHist.length < 4) return;
    const xs = this._horizHist.map((h) => h.nx);
    const amp = Math.max(...xs) - Math.min(...xs);
    if (amp >= this.dartAmp) {
      const lastDart = this._lastDartAt || 0;
      if (now - lastDart > 800) {
        this.dartEvents += 1;
        this._lastDartAt = now;
        this.handlers.onAlert?.({
          type: "gaze_dart",
          message: "Gaze dart detected — stay forward",
        });
      }
    }
  }

  /** Fraction of samples looking at camera (0–1). */
  getOnCameraRatio() {
    if (!this.samples) return 0;
    return this.onCameraSamples / this.samples;
  }

  /**
   * For Lesson 1: % of run covered by completed 3s steady blocks.
   * @param {number} runSec
   */
  getSteadyCoverage(runSec) {
    const covered = this.completedSteadyBlocks * this.steadyBlockSec;
    return runSec > 0 ? covered / runSec : 0;
  }

  getSnapshot() {
    return {
      available: this.available,
      error: this.error,
      samples: this.samples,
      onCameraRatio: this.getOnCameraRatio(),
      downBreakEvents: this.downBreakEvents,
      downBreakMs: this.downBreakMs,
      completedSteadyBlocks: this.completedSteadyBlocks,
      steadyCoverage: null, // filled by engine with run duration
      dartEvents: this.dartEvents,
      smileScore: this.last?.smileScore || 0,
      last: this.last,
    };
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this._downSince != null) {
      this.downBreakMs += performance.now() - this._downSince;
      this._downSince = null;
    }
    if (this._steadySince != null) {
      this.steadyBlockMs += performance.now() - this._steadySince;
      this._steadySince = null;
    }
  }
}
