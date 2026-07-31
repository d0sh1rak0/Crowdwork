/**
 * Fundamental frequency (F0) estimator via autocorrelation on mic PCM.
 * Used for downward-inflection detection and pitch-floor baselines.
 */

export default class PitchContourAnalyzer {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this._buf = null;
    this._tickId = null;
    this.running = false;
    this.handlers = {};

    /** @type {{ t: number, hz: number }[]} */
    this.contour = [];
    this.speechSegments = [];
    this._speechActive = false;
    this._segStart = null;
    this._segPitch = [];

    this.minHz = 70;
    this.maxHz = 320;
    this.voicedRms = 0.018;
    this.sampleIntervalMs = 50;
  }

  /**
   * @param {MediaStream} stream
   * @param {{ onPitch?: Function, onSegmentEnd?: Function }} handlers
   */
  async start(stream, handlers = {}) {
    this.stop();
    this.handlers = handlers;
    this.contour = [];
    this.speechSegments = [];
    this._speechActive = false;
    this._segStart = null;
    this._segPitch = [];

    this.stream = stream;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    this.source.connect(this.analyser);
    this._buf = new Float32Array(this.analyser.fftSize);
    this.running = true;

    this._tickId = setInterval(() => this._sample(), this.sampleIntervalMs);
    return true;
  }

  _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /**
   * Autocorrelation pitch estimate (Hz) or 0 if unvoiced.
   */
  _estimateF0(buf, sampleRate) {
    const rms = this._rms(buf);
    if (rms < this.voicedRms) return 0;

    const minLag = Math.floor(sampleRate / this.maxHz);
    const maxLag = Math.floor(sampleRate / this.minHz);
    let bestLag = -1;
    let bestCorr = 0;
    // Normalize by energy at lag 0
    let energy = 0;
    for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
    if (energy < 1e-8) return 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < buf.length - lag; i++) {
        corr += buf[i] * buf[i + lag];
      }
      corr /= energy;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (bestLag < 0 || bestCorr < 0.35) return 0;
    return sampleRate / bestLag;
  }

  _sample() {
    if (!this.running || !this.analyser) return;
    this.analyser.getFloatTimeDomainData(this._buf);
    const hz = this._estimateF0(this._buf, this.ctx.sampleRate);
    const t = performance.now();
    if (hz > 0) {
      this.contour.push({ t, hz });
      this.handlers.onPitch?.({ t, hz });
      if (!this._speechActive) {
        this._speechActive = true;
        this._segStart = t;
        this._segPitch = [];
      }
      this._segPitch.push({ t, hz });
    } else if (this._speechActive) {
      // End segment after brief unvoiced gap — finalize on next quiet stretch
      this._maybeEndSegment(t);
    }
  }

  _maybeEndSegment(t) {
    // Require ~180ms silence before closing a sentence-like segment
    const last = this._segPitch[this._segPitch.length - 1];
    if (!last || t - last.t < 180) return;
    this._finalizeSegment();
  }

  _finalizeSegment() {
    if (!this._segPitch.length) {
      this._speechActive = false;
      return;
    }
    const pts = this._segPitch;
    const slope = this._endSlope(pts);
    const meanHz =
      pts.reduce((a, p) => a + p.hz, 0) / Math.max(1, pts.length);
    const seg = {
      startT: this._segStart,
      endT: pts[pts.length - 1].t,
      meanHz,
      endSlope: slope,
      downward: slope < -8, // Hz per final window (negative = drop)
      upward: slope > 8,
      samples: pts.length,
    };
    this.speechSegments.push(seg);
    this.handlers.onSegmentEnd?.(seg);
    this._speechActive = false;
    this._segPitch = [];
    this._segStart = null;
  }

  /**
   * Slope of F0 over the final ~30% of the segment (Hz change).
   * Negative => downward inflection.
   */
  _endSlope(pts) {
    if (pts.length < 4) return 0;
    const n = Math.max(4, Math.floor(pts.length * 0.35));
    const tail = pts.slice(-n);
    const mid = Math.floor(tail.length / 2);
    const a =
      tail.slice(0, mid).reduce((s, p) => s + p.hz, 0) / Math.max(1, mid);
    const b =
      tail.slice(mid).reduce((s, p) => s + p.hz, 0) /
      Math.max(1, tail.length - mid);
    return b - a;
  }

  /** Mean F0 across all voiced samples. */
  getMeanPitchHz() {
    if (!this.contour.length) return 0;
    return this.contour.reduce((s, p) => s + p.hz, 0) / this.contour.length;
  }

  /** Pitch floor ≈ 20th percentile (relaxed / resonant baseline). */
  getPitchFloorHz() {
    if (!this.contour.length) return 0;
    const sorted = this.contour.map((p) => p.hz).sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.2);
    return sorted[idx] || sorted[0];
  }

  getLastNDownward(n = 3) {
    return this.speechSegments.filter((s) => s.downward).slice(-n);
  }

  getFinalSegmentDownward() {
    const last = this.speechSegments[this.speechSegments.length - 1];
    return last ? Boolean(last.downward) : false;
  }

  getSnapshot() {
    if (this._speechActive && this._segPitch.length) {
      // Snapshot mid-segment without mutating
    }
    return {
      meanHz: this.getMeanPitchHz(),
      pitchFloorHz: this.getPitchFloorHz(),
      segmentCount: this.speechSegments.length,
      downwardCount: this.speechSegments.filter((s) => s.downward).length,
      finalDownward: this.getFinalSegmentDownward(),
      segments: this.speechSegments.map((s) => ({
        meanHz: Math.round(s.meanHz),
        endSlope: Math.round(s.endSlope * 10) / 10,
        downward: s.downward,
      })),
      sampleCount: this.contour.length,
    };
  }

  stop() {
    this.running = false;
    if (this._tickId) clearInterval(this._tickId);
    this._tickId = null;
    if (this._speechActive) this._finalizeSegment();
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.analyser = null;
    this.ctx = null;
  }
}
