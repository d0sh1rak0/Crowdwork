/**
 * RMS volume monitor — shared by breath cycles, response latency, energy checks.
 */

export default class AudioEnergyMonitor {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this._buf = null;
    this._tickId = null;
    this.running = false;
    this.handlers = {};
    this.rms = 0;
    this.peak = 0;
    this.history = []; // { t, rms }
    this.speechThreshold = 0.02;
    this.breathThreshold = 0.012;
    this.silenceThreshold = 0.008;
    this.firstSpeechAt = null;
    this.maxRms = 0;
  }

  /**
   * @param {MediaStream} stream
   * @param {{ onEnergy?: Function, onSpeechStart?: Function }} handlers
   */
  async start(stream, handlers = {}) {
    this.stop();
    this.handlers = handlers;
    this.history = [];
    this.firstSpeechAt = null;
    this.maxRms = 0;
    this.rms = 0;
    this.peak = 0;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this._buf = new Float32Array(this.analyser.fftSize);
    this.running = true;
    this._tickId = setInterval(() => this._sample(), 40);
    return true;
  }

  _sample() {
    if (!this.running || !this.analyser) return;
    this.analyser.getFloatTimeDomainData(this._buf);
    let s = 0;
    let peak = 0;
    for (let i = 0; i < this._buf.length; i++) {
      const v = Math.abs(this._buf[i]);
      s += v * v;
      if (v > peak) peak = v;
    }
    this.rms = Math.sqrt(s / this._buf.length);
    this.peak = peak;
    this.maxRms = Math.max(this.maxRms, this.rms);
    const t = performance.now();
    this.history.push({ t, rms: this.rms });
    if (this.history.length > 2500) this.history.shift();

    if (
      this.firstSpeechAt == null &&
      this.rms >= this.speechThreshold
    ) {
      this.firstSpeechAt = t;
      this.handlers.onSpeechStart?.({ t, rms: this.rms });
    }
    this.handlers.onEnergy?.({ t, rms: this.rms, peak });
  }

  isSpeaking() {
    return this.rms >= this.speechThreshold;
  }

  isSilent() {
    return this.rms < this.silenceThreshold;
  }

  /**
   * Mean RMS in a time window (performance.now timestamps).
   */
  meanRmsBetween(t0, t1) {
    const pts = this.history.filter((h) => h.t >= t0 && h.t <= t1);
    if (!pts.length) return 0;
    return pts.reduce((a, p) => a + p.rms, 0) / pts.length;
  }

  getSnapshot() {
    return {
      rms: this.rms,
      maxRms: this.maxRms,
      firstSpeechAt: this.firstSpeechAt,
      historyLen: this.history.length,
    };
  }

  stop() {
    this.running = false;
    if (this._tickId) clearInterval(this._tickId);
    this._tickId = null;
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
