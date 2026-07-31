/**
 * Open-posture tracking via MediaPipe Pose Landmarker.
 * Monitors shoulder width/level, torso yaw proxy, and arm crossing.
 */

import { createPoseLandmarker } from "./MediaPipeLoader.js";

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;
const NOSE = 0;

function vis(lm, i) {
  return (lm[i]?.visibility ?? 1) > 0.45;
}

export default class PoseTracker {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.raf = 0;
    this.running = false;
    this.lastTs = -1;
    this.handlers = {};
    this.available = false;
    this.error = null;

    this.samples = 0;
    this.openSamples = 0;
    this.crossedEvents = 0;
    this.slouchEvents = 0;
    this.fidgetEvents = 0;
    this._openSince = null;
    this.openStreakMs = 0;
    this.maxOpenStreakMs = 0;
    this._prevShoulders = null;
    this._last = null;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {{ onAlert?: Function, onFrame?: Function }} handlers
   */
  async start(video, handlers = {}) {
    this.stop();
    this.video = video;
    this.handlers = handlers;
    this._reset();
    try {
      this.landmarker = await createPoseLandmarker();
      this.available = true;
    } catch (err) {
      this.available = false;
      this.error = err instanceof Error ? err.message : String(err);
      console.warn("[PoseTracker] unavailable:", this.error);
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

  _reset() {
    this.samples = 0;
    this.openSamples = 0;
    this.crossedEvents = 0;
    this.slouchEvents = 0;
    this.fidgetEvents = 0;
    this._openSince = null;
    this.openStreakMs = 0;
    this.maxOpenStreakMs = 0;
    this._prevShoulders = null;
    this._last = null;
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

    const lm = result?.landmarks?.[0];
    if (!lm || !vis(lm, L_SHOULDER) || !vis(lm, R_SHOULDER)) {
      this._markClosed(now);
      this._last = { open: false, present: false };
      this.handlers.onFrame?.(this._last);
      return;
    }

    const ls = lm[L_SHOULDER];
    const rs = lm[R_SHOULDER];
    const shoulderWidth = Math.abs(rs.x - ls.x);
    const shoulderTilt = Math.abs(rs.y - ls.y);
    const midShoulderY = (ls.y + rs.y) / 2;
    const midHipY =
      vis(lm, L_HIP) && vis(lm, R_HIP)
        ? (lm[L_HIP].y + lm[R_HIP].y) / 2
        : midShoulderY + 0.35;
    const torsoLen = Math.max(1e-3, midHipY - midShoulderY);
    // Slouch: nose much closer to shoulder line vertically (collapsed chest)
    let slouch = false;
    if (vis(lm, NOSE)) {
      const noseDrop = (lm[NOSE].y - midShoulderY) / torsoLen;
      slouch = noseDrop > 0.15 && shoulderTilt > 0.06;
    }

    // Arm cross: wrists swap across body midline
    let crossed = false;
    if (vis(lm, L_WRIST) && vis(lm, R_WRIST)) {
      const midX = (ls.x + rs.x) / 2;
      const lw = lm[L_WRIST];
      const rw = lm[R_WRIST];
      // In mirrored selfie, left landmark is on viewer's right — still works:
      // crossed if both wrists near opposite sides of midline.
      const leftCrossed = lw.x > midX + shoulderWidth * 0.12;
      const rightCrossed = rw.x < midX - shoulderWidth * 0.12;
      crossed = leftCrossed && rightCrossed;
      // Also elbows tucked tightly with wrists overlapping
      if (!crossed && vis(lm, L_ELBOW) && vis(lm, R_ELBOW)) {
        const wristDist = Math.hypot(lw.x - rw.x, lw.y - rw.y);
        crossed = wristDist < shoulderWidth * 0.35 && lw.y > midShoulderY;
      }
    }

    // Fidget: rapid shoulder midpoint jitter
    const mid = { x: (ls.x + rs.x) / 2, y: midShoulderY };
    if (this._prevShoulders) {
      const dx = Math.abs(mid.x - this._prevShoulders.x);
      const dy = Math.abs(mid.y - this._prevShoulders.y);
      if (dx + dy > 0.045) {
        this.fidgetEvents += 1;
        if (this.fidgetEvents % 8 === 0) {
          this.handlers.onAlert?.({
            type: "fidget",
            message: "Hold still — excessive torso movement",
          });
        }
      }
    }
    this._prevShoulders = mid;

    const open =
      !crossed &&
      !slouch &&
      shoulderWidth > 0.12 &&
      shoulderTilt < 0.09;

    this.samples += 1;
    if (open) this.openSamples += 1;
    if (crossed) {
      this.crossedEvents += 1;
      if (this.crossedEvents === 1 || this.crossedEvents % 15 === 0) {
        this.handlers.onAlert?.({
          type: "arms_crossed",
          message: "Arms crossed — open posture",
        });
      }
    }
    if (slouch) {
      this.slouchEvents += 1;
      if (this.slouchEvents === 1 || this.slouchEvents % 20 === 0) {
        this.handlers.onAlert?.({
          type: "slouch",
          message: "Shoulders rounding — stand tall",
        });
      }
    }

    if (open) {
      if (this._openSince == null) this._openSince = now;
      const streak = now - this._openSince;
      this.openStreakMs = streak;
      this.maxOpenStreakMs = Math.max(this.maxOpenStreakMs, streak);
    } else {
      this._markClosed(now);
    }

    this._last = {
      open,
      present: true,
      crossed,
      slouch,
      shoulderWidth,
      shoulderTilt,
    };
    this.handlers.onFrame?.(this._last);
  }

  _markClosed(now) {
    if (this._openSince != null) {
      const streak = now - this._openSince;
      this.maxOpenStreakMs = Math.max(this.maxOpenStreakMs, streak);
      this._openSince = null;
      this.openStreakMs = 0;
    }
  }

  getOpenRatio() {
    if (!this.samples) return 0;
    return this.openSamples / this.samples;
  }

  getMaxOpenStreakSec() {
    return this.maxOpenStreakMs / 1000;
  }

  get last() {
    return this._last;
  }

  getSnapshot() {
    return {
      available: this.available,
      error: this.error,
      samples: this.samples,
      openRatio: this.getOpenRatio(),
      maxOpenStreakSec: this.getMaxOpenStreakSec(),
      crossedEvents: this.crossedEvents,
      slouchEvents: this.slouchEvents,
      fidgetEvents: this.fidgetEvents,
      last: this._last,
    };
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this._markClosed(performance.now());
  }
}
