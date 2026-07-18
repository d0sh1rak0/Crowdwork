/**
 * Real-time mic waveform — Electric Yellow on jet black (Apple performance aesthetic).
 */
class WaveformVisualizer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext("2d");
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    this.animationFrameId = null;
    this._running = false;
    this._resizeObs = null;
  }

  init(stream) {
    this.stop();
    if (!stream?.getAudioTracks?.().length || !this.canvas) return;

    this._fitCanvas();
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    const bufferLength = this.analyser.fftSize;
    this.dataArray = new Uint8Array(bufferLength);
    this.source.connect(this.analyser);

    this._running = true;
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    if (typeof ResizeObserver !== "undefined") {
      this._resizeObs = new ResizeObserver(() => this._fitCanvas());
      this._resizeObs.observe(this.canvas.parentElement || this.canvas);
    }

    this.draw();
  }

  _fitCanvas() {
    const parent = this.canvas.parentElement || this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = parent.clientWidth || 280;
    const cssH = parent.clientHeight || 64;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = cssW;
    this._cssH = cssH;
  }

  draw() {
    if (!this._running || !this.analyser) return;
    this.animationFrameId = requestAnimationFrame(() => this.draw());
    this.analyser.getByteTimeDomainData(this.dataArray);

    const w = this._cssW || this.canvas.clientWidth;
    const h = this._cssH || this.canvas.clientHeight;

    // Jet black
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, w, h);

    // Soft center guide
    this.ctx.strokeStyle = "rgba(255, 214, 10, 0.08)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, h / 2);
    this.ctx.lineTo(w, h / 2);
    this.ctx.stroke();

    // Electric Yellow waveform
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = "#FFD60A";
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    this.ctx.beginPath();

    const sliceWidth = w / this.dataArray.length;
    let x = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
      x += sliceWidth;
    }
    this.ctx.lineTo(w, h / 2);
    this.ctx.stroke();
  }

  async resume() {
    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  stop() {
    this._running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.audioContext?.close();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.analyser = null;
    this.audioContext = null;
  }
}

export default WaveformVisualizer;
export { WaveformVisualizer };
