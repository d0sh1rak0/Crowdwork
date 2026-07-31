/**
 * Detect 4-7-8 diaphragmatic breathing from mic volume phases,
 * then verify a subsequent resonant spoken phrase (lower pitch floor).
 *
 * Phases (volume heuristics):
 *  - inhale (4s): quiet / low noise through nose
 *  - hold (7s): near-silence
 *  - exhale (8s): audible sustained breath (elevated but sub-speech RMS)
 *  - speak: voiced speech after cycle
 */

export default class BreathCycleAnalyzer {
  /**
   * @param {import("./AudioEnergyMonitor.js").default} energy
   * @param {import("./PitchContourAnalyzer.js").default|null} pitch
   */
  constructor(energy, pitch = null) {
    this.energy = energy;
    this.pitch = pitch;
    this.phase = "waiting"; // waiting | inhale | hold | exhale | speak | done | fail
    this.phaseStartedAt = null;
    this.cycleComplete = false;
    this.speakComplete = false;
    this.handlers = {};
    this._tickId = null;
    this.tol = 0.55; // seconds tolerance
    this.inhaleSec = 4;
    this.holdSec = 7;
    this.exhaleSec = 8;
    this.pitchFloorAfter = null;
    this.logs = [];
  }

  start(handlers = {}) {
    this.stop();
    this.handlers = handlers;
    this.phase = "waiting";
    this.phaseStartedAt = performance.now();
    this.cycleComplete = false;
    this.speakComplete = false;
    this.pitchFloorAfter = null;
    this.logs = [];
    this._tickId = setInterval(() => this._tick(), 100);
    this.handlers.onPhase?.({ phase: this.phase, message: "Get ready — start inhale" });
  }

  _log(msg) {
    this.logs.push({ t: performance.now(), phase: this.phase, msg });
  }

  _elapsed() {
    return (performance.now() - this.phaseStartedAt) / 1000;
  }

  _advance(next, message) {
    this.phase = next;
    this.phaseStartedAt = performance.now();
    this._log(message);
    this.handlers.onPhase?.({ phase: next, message });
  }

  _tick() {
    if (!this.energy || this.phase === "done" || this.phase === "fail") return;
    const rms = this.energy.rms;
    const e = this._elapsed();
    const silent = rms < this.energy.silenceThreshold;
    const breathy =
      rms >= this.energy.breathThreshold && rms < this.energy.speechThreshold;
    const speaking = rms >= this.energy.speechThreshold;

    switch (this.phase) {
      case "waiting":
        // User starts: either quiet inhale or we auto-start on first calm window
        if (silent || breathy || e > 1.2) {
          this._advance("inhale", "Inhale — belly out (4s)");
        }
        break;
      case "inhale":
        if (speaking) {
          // Soft restart if they talk early
          this._advance("inhale", "Stay quiet — inhale through nose");
          break;
        }
        if (e >= this.inhaleSec - this.tol) {
          this._advance("hold", "Hold (7s)");
        }
        break;
      case "hold":
        if (speaking) {
          this.handlers.onAlert?.({
            type: "breath_break",
            message: "Hold broken — stay silent",
          });
          this._advance("hold", "Reset hold — silence");
          break;
        }
        if (e >= this.holdSec - this.tol) {
          this._advance("exhale", "Exhale slowly (8s)");
        }
        break;
      case "exhale":
        // Prefer audible exhale but allow quiet
        if (speaking && e < this.exhaleSec - 1.5) {
          this.handlers.onAlert?.({
            type: "breath_break",
            message: "Finish the exhale before speaking",
          });
        }
        if (e >= this.exhaleSec - this.tol) {
          this.cycleComplete = true;
          this._advance("speak", "Now speak a resonant phrase");
        }
        break;
      case "speak":
        if (speaking && e >= 1.5) {
          this.speakComplete = true;
          this.pitchFloorAfter = this.pitch?.getPitchFloorHz?.() || null;
          this._advance("done", "Breath cycle + phrase complete");
        } else if (e >= 20) {
          this._advance("fail", "No spoken phrase after breath cycle");
        }
        break;
      default:
        break;
    }
  }

  getSnapshot() {
    return {
      phase: this.phase,
      cycleComplete: this.cycleComplete,
      speakComplete: this.speakComplete,
      pitchFloorHz: this.pitchFloorAfter ?? this.pitch?.getPitchFloorHz?.() ?? 0,
      passed: this.cycleComplete && this.speakComplete,
      logs: this.logs.slice(-12),
    };
  }

  stop() {
    if (this._tickId) clearInterval(this._tickId);
    this._tickId = null;
  }
}
