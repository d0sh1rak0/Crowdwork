/**
 * LessonTestEngine — multi-modal automated drill evaluator.
 * Spins up gaze/pose/pitch/breath/latency/heckle modules per lesson registry.
 */

import GazeTracker from "./analyzers/GazeTracker.js";
import PoseTracker from "./analyzers/PoseTracker.js";
import PitchContourAnalyzer from "./analyzers/PitchContourAnalyzer.js";
import AudioEnergyMonitor from "./analyzers/AudioEnergyMonitor.js";
import BreathCycleAnalyzer from "./analyzers/BreathCycleAnalyzer.js";
import { getLessonTest } from "./lessonTestRegistry.js";
import { evaluateBossChallenge, countDeliberatePauses } from "./BossEvaluator.js";

export default class LessonTestEngine {
  constructor() {
    this.testDef = null;
    this.gaze = null;
    this.pose = null;
    this.pitch = null;
    this.energy = null;
    this.breath = null;
    this.videoEl = null;
    this.mediaStream = null;
    this.audioStream = null;
    this.handlers = {};
    this.startedAt = 0;
    this.elapsedSec = 0;

    // Lesson 8 latency
    this.latencyResults = [];
    this._promptEndAt = null;
    this._awaitingResponse = false;
    this._promptIndex = 0;

    // Lesson 9 smile+open combo
    this._comboSince = null;
    this.comboMaxSec = 0;

    // Lesson 10 heckle
    this._heckleFired = false;
    this._heckleAt = null;
    this._postHeckleMaxWpm = 0;
    this._heckleTimer = null;

    // Lesson 11 reframe
    this.reframeMaxRms = 0;
    this._reframeWindowUntil = null;

    this.visionReady = false;
    this.statusMessage = "";
  }

  /**
   * @param {string} lessonOrBossId
   */
  resolve(lessonOrBossId) {
    this.testDef = getLessonTest(lessonOrBossId);
    return this.testDef;
  }

  /**
   * @param {{
   *   videoEl: HTMLVideoElement,
   *   mediaStream: MediaStream,
   *   audioStream?: MediaStream,
   *   onAlert?: Function,
   *   onPhase?: Function,
   *   onHud?: Function,
   *   onPrompt?: Function,
   *   getWpm?: () => number,
   *   isSttSilent?: () => boolean,
   * }} opts
   */
  async start(opts) {
    await this.stop();
    if (!this.testDef) throw new Error("No test definition resolved");

    this.handlers = opts;
    this.videoEl = opts.videoEl;
    this.mediaStream = opts.mediaStream;
    this.audioStream =
      opts.audioStream ||
      new MediaStream(opts.mediaStream.getAudioTracks());
    this.startedAt = performance.now();
    this.elapsedSec = 0;
    this.latencyResults = [];
    this._promptEndAt = null;
    this._awaitingResponse = false;
    this._promptIndex = 0;
    this._comboSince = null;
    this.comboMaxSec = 0;
    this._heckleFired = false;
    this._heckleAt = null;
    this._postHeckleMaxWpm = 0;
    this.reframeMaxRms = 0;
    this._reframeWindowUntil = null;

    const mods = new Set(this.testDef.modules || []);
    const alert = (evt) => this.handlers.onAlert?.(evt);

    if (mods.has("gaze") || mods.has("smile") || mods.has("heckle")) {
      this.gaze = new GazeTracker();
      const ok = await this.gaze.start(this.videoEl, {
        onAlert: alert,
        onSteadyBlock: ({ blocks }) => {
          this.handlers.onHud?.({
            text: `3s gaze lock ×${blocks}`,
            xp: 5,
          });
        },
        onFrame: (frame) => this._onGazeFrame(frame),
      });
      this.visionReady = this.visionReady || ok;
      if (!ok) {
        this.statusMessage = "Gaze tracking unavailable — check camera permissions";
      }
    }

    if (mods.has("pose") || mods.has("smile") || mods.has("reframe")) {
      this.pose = new PoseTracker();
      const ok = await this.pose.start(this.videoEl, { onAlert: alert });
      this.visionReady = this.visionReady || ok;
    }

    const needAudio =
      mods.has("pitch") ||
      mods.has("breath") ||
      mods.has("latency") ||
      mods.has("heckle") ||
      mods.has("reframe") ||
      mods.has("smile");

    if (needAudio && this.audioStream?.getAudioTracks()?.length) {
      this.energy = new AudioEnergyMonitor();
      await this.energy.start(this.audioStream, {
        onSpeechStart: ({ t }) => this._onFirstSpeech(t),
        onEnergy: ({ rms }) => this._onEnergy(rms),
      });
    }

    if (mods.has("pitch") || mods.has("breath") || mods.has("reframe")) {
      this.pitch = new PitchContourAnalyzer();
      await this.pitch.start(this.audioStream, {
        onSegmentEnd: (seg) => {
          if (seg.downward) {
            this.handlers.onHud?.({
              text: "Downward inflection ✓",
              xp: 5,
            });
          } else if (seg.upward) {
            alert({
              type: "upspeak",
              message: "Upspeak detected — pitch down at the end",
            });
          }
        },
      });
    }

    if (mods.has("breath")) {
      this.breath = new BreathCycleAnalyzer(this.energy, this.pitch);
      this.breath.start({
        onPhase: (p) => {
          this.handlers.onPhase?.(p);
          this.handlers.onHud?.({ text: p.message });
        },
        onAlert: alert,
      });
    }

    if (mods.has("latency") && this.testDef.prompts?.length) {
      // Kick off first AI prompt after a short beat
      setTimeout(() => void this._playNextPrompt(), 800);
    }

    if (mods.has("heckle")) {
      const at = (this.testDef.heckleAtSec || 12) * 1000;
      this._heckleTimer = setTimeout(() => void this._fireHeckle(), at);
    }

    if (mods.has("reframe")) {
      // First ~8s are the reframe window
      this._reframeWindowUntil = performance.now() + 8000;
      this.handlers.onPhase?.({
        phase: "reframe",
        message: `Say loudly: "${this.testDef.reframePhrase || "I am excited!"}"`,
      });
    }

    return {
      visionReady: this.visionReady,
      modules: [...mods],
      durationSec: this.testDef.durationSec,
    };
  }

  _onGazeFrame(frame) {
    if (!frame?.facePresent) return;
    // Smile + open posture combo (Lesson 9)
    const mods = this.testDef?.modules || [];
    if (mods.includes("smile")) {
      const open = this.pose?.last?.open ?? this.pose?.getSnapshot()?.last?.open;
      const smileOk = (frame.smileScore || 0) >= 0.35;
      const now = performance.now();
      if (smileOk && open) {
        if (this._comboSince == null) this._comboSince = now;
        this.comboMaxSec = Math.max(
          this.comboMaxSec,
          (now - this._comboSince) / 1000
        );
      } else {
        this._comboSince = null;
      }
    }

    // Presence anchor: only count darts during STT silence
    if (
      mods.includes("gaze") &&
      this.handlers.isSttSilent?.() &&
      frame.lookingDown === false
    ) {
      // dart events already counted inside GazeTracker; silence gate softens alerts
    }
  }

  _onFirstSpeech(t) {
    if (this._awaitingResponse && this._promptEndAt != null) {
      const dt = (t - this._promptEndAt) / 1000;
      this.latencyResults.push(dt);
      this._awaitingResponse = false;
      if (dt < 0.5) {
        this.handlers.onAlert?.({
          type: "rushed_response",
          message: "Rushed Response — wait one beat",
        });
      } else if (dt >= 1 && dt <= 2) {
        this.handlers.onHud?.({
          text: `+10 XP: Great Pause! (${dt.toFixed(1)}s)`,
          xp: 10,
        });
      } else {
        this.handlers.onAlert?.({
          type: "latency_out",
          message: `Pause was ${dt.toFixed(1)}s — aim for 1–2s`,
        });
      }
      // Next prompt after user has spoken a bit
      setTimeout(() => void this._playNextPrompt(), 4500);
    }
  }

  _onEnergy(rms) {
    if (
      this._reframeWindowUntil &&
      performance.now() < this._reframeWindowUntil
    ) {
      this.reframeMaxRms = Math.max(this.reframeMaxRms, rms);
    }
  }

  async _playNextPrompt() {
    const prompts = this.testDef?.prompts || [];
    if (this._promptIndex >= prompts.length) {
      this.handlers.onPhase?.({
        phase: "done_prompts",
        message: "All prompts done — tap Stop when ready",
      });
      return;
    }
    const text = prompts[this._promptIndex++];
    this.handlers.onPrompt?.({
      index: this._promptIndex,
      total: prompts.length,
      text,
    });
    this.handlers.onPhase?.({
      phase: "ai_prompt",
      message: `Prompt ${this._promptIndex}/${prompts.length}: listen…`,
    });

    // Prefer /api/speak, fall back to speechSynthesis
    let played = false;
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "en" }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = reject;
          audio.play().catch(reject);
        });
        URL.revokeObjectURL(url);
        played = true;
      }
    } catch {
      /* fall through */
    }
    if (!played && "speechSynthesis" in window) {
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.speak(u);
      });
      played = true;
    }

    this._promptEndAt = performance.now();
    this._awaitingResponse = true;
    // Reset energy first-speech latch for this prompt
    if (this.energy) this.energy.firstSpeechAt = null;
    this.handlers.onPhase?.({
      phase: "await_response",
      message: "Wait one beat, then answer…",
    });
  }

  async _fireHeckle() {
    if (this._heckleFired) return;
    this._heckleFired = true;
    this._heckleAt = performance.now();
    const line =
      this.testDef?.heckleLine ||
      "Hold on — that sounds rehearsed. Be real with me.";
    this.handlers.onAlert?.({
      type: "heckle",
      message: "HECKLER INTERRUPT",
    });
    this.handlers.onPhase?.({ phase: "heckle", message: line });

    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line, language: "en" }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = 0.95;
        await audio.play();
        audio.onended = () => URL.revokeObjectURL(url);
      } else if ("speechSynthesis" in window) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(line));
      }
    } catch {
      if ("speechSynthesis" in window) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(line));
      }
    }
  }

  /** Call each frame / meter tick from the drill page. */
  tick(elapsedSec, { wpm = 0 } = {}) {
    this.elapsedSec = elapsedSec;
    if (this._heckleAt && performance.now() >= this._heckleAt) {
      this._postHeckleMaxWpm = Math.max(this._postHeckleMaxWpm, wpm || 0);
    }
  }

  /**
   * Build evaluation input snapshot for BossEvaluator.
   * @param {{ fillerTotal?: number, deliberatePauses?: number[], wpm?: number }} vocal
   */
  evaluate(vocal = {}) {
    const def = this.testDef;
    if (!def) {
      return { allPassed: false, results: [], passedCount: 0, totalCount: 0 };
    }

    const gazeSnap = this.gaze?.getSnapshot?.() || {};
    if (gazeSnap.available) {
      gazeSnap.steadyCoverage = this.gaze.getSteadyCoverage(this.elapsedSec);
    }
    const poseSnap = this.pose?.getSnapshot?.() || {};
    // Refresh pose last open from live
    if (this.pose) poseSnap.last = this.pose._last || poseSnap.last;

    const pitchSnap = this.pitch?.getSnapshot?.() || {};
    const breathSnap = this.breath?.getSnapshot?.() || {};

    const minPauseCrit = (def.criteria || []).find((c) => c.type === "min_pauses");
    const minPauseSec = minPauseCrit?.minPauseSec ?? 1.2;
    const deliberateCount = countDeliberatePauses(
      vocal.deliberatePauses || [],
      minPauseSec
    );

    return evaluateBossChallenge({
      criteria: def.criteria,
      durationSec: this.elapsedSec,
      fillerTotal: vocal.fillerTotal || 0,
      deliberatePauses: deliberateCount,
      wpm: vocal.wpm || 0,
      gaze: gazeSnap,
      pose: poseSnap,
      pitch: pitchSnap,
      breath: breathSnap,
      latencyResults: this.latencyResults,
      smileOpenSec: this.comboMaxSec,
      heckle: {
        fired: this._heckleFired,
        postMaxWpm: this._postHeckleMaxWpm,
        onCameraRatio: gazeSnap.onCameraRatio || 0,
      },
      reframe: {
        maxRms: this.reframeMaxRms,
      },
      visionAvailable: Boolean(
        gazeSnap.available || poseSnap.available
      ),
    });
  }

  getLiveStatus() {
    const parts = [];
    if (this.gaze?.available) {
      const r = Math.round((this.gaze.getOnCameraRatio() || 0) * 100);
      parts.push(`Gaze ${r}%`);
      if (this.gaze.downBreakEvents) {
        parts.push(`↓breaks ${this.gaze.downBreakEvents}`);
      }
    }
    if (this.pose?.available) {
      const r = Math.round((this.pose.getOpenRatio() || 0) * 100);
      parts.push(`Open ${r}%`);
    }
    if (this.breath) {
      parts.push(`Breath: ${this.breath.phase}`);
    }
    if (this.latencyResults.length) {
      parts.push(`Beats ${this.latencyResults.length}`);
    }
    if (this.pitch) {
      const floor = Math.round(this.pitch.getPitchFloorHz() || 0);
      if (floor) parts.push(`F0⌊ ${floor}Hz`);
    }
    return parts.join(" · ") || this.statusMessage || "Test armed";
  }

  async stop() {
    if (this._heckleTimer) {
      clearTimeout(this._heckleTimer);
      this._heckleTimer = null;
    }
    this.gaze?.stop();
    this.pose?.stop();
    this.pitch?.stop();
    this.energy?.stop();
    this.breath?.stop();
    this.gaze = null;
    this.pose = null;
    this.pitch = null;
    this.energy = null;
    this.breath = null;
  }
}
