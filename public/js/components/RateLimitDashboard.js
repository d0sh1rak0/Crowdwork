/**
 * RateLimitDashboard — Jet Black / Electric Yellow predictive loading UI
 * shown while the generation pipeline recovers from upstream 429s.
 */

const PIPELINE_STATUSES = [
  "Queueing server instance…",
  "Optimizing token headers…",
  "Allocating sandbox memory channels…",
  "Re-establishing neural pipeline connection…",
  "Warming inference workers…",
  "Rebalancing request capacity…",
  "Syncing model context windows…",
  "Compacting slide payload frames…",
  "Verifying upstream handshake…",
  "Recycling rate-limit tokens…",
  "Priming generation sandbox…",
  "Calibrating output token budget…",
];

export default class RateLimitDashboard {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this._reelTimer = null;
    this._statusIdx = 0;
    this._onBack = null;

    this.headline = root.querySelector("[data-rl-headline]");
    this.reel = root.querySelector("[data-rl-reel]");
    this.bar = root.querySelector("[data-rl-bar]");
    this.meta = root.querySelector("[data-rl-meta]");
    this.backBtn = root.querySelector("[data-rl-back]");

    this.backBtn?.addEventListener("click", () => {
      this._onBack?.();
    });
  }

  /**
   * @param {() => void} fn
   */
  onBack(fn) {
    this._onBack = fn;
  }

  show() {
    this.root.hidden = false;
    this.root.classList.add("is-visible");
    this.root.setAttribute("aria-hidden", "false");
    if (this.headline) {
      this.headline.textContent = "This is taking a little longer than usual…";
    }
    this.setProgress(0);
    this._startReel();
  }

  hide() {
    this._stopReel();
    this.root.hidden = true;
    this.root.classList.remove("is-visible");
    this.root.setAttribute("aria-hidden", "true");
    this.setProgress(0);
  }

  get visible() {
    return !this.root.hidden;
  }

  /**
   * @param {number} progress 0–1
   * @param {{ attempt?: number, remainingMs?: number, waitMs?: number }} [meta]
   */
  setProgress(progress, meta = {}) {
    const pct = Math.max(0, Math.min(100, progress * 100));
    if (this.bar) {
      this.bar.style.width = `${pct}%`;
      this.bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
    if (this.meta) {
      const attempt = meta.attempt || 0;
      const secs = Math.ceil((meta.remainingMs || 0) / 1000);
      if (attempt > 0) {
        this.meta.textContent =
          secs > 0
            ? `Retry ${attempt} · reconnecting in ${secs}s`
            : `Retry ${attempt} · shipping request…`;
      } else {
        this.meta.textContent = "Holding your deck in the queue";
      }
    }
  }

  setReelText(text) {
    if (!this.reel) return;
    this.reel.classList.remove("is-tick");
    // Force reflow for CSS tick animation
    void this.reel.offsetWidth;
    this.reel.textContent = text;
    this.reel.classList.add("is-tick");
  }

  _startReel() {
    this._stopReel();
    this._statusIdx = Math.floor(Math.random() * PIPELINE_STATUSES.length);
    this.setReelText(PIPELINE_STATUSES[this._statusIdx]);
    this._reelTimer = setInterval(() => {
      this._statusIdx = (this._statusIdx + 1) % PIPELINE_STATUSES.length;
      this.setReelText(PIPELINE_STATUSES[this._statusIdx]);
    }, 900);
  }

  _stopReel() {
    if (this._reelTimer) {
      clearInterval(this._reelTimer);
      this._reelTimer = null;
    }
  }

  destroy() {
    this._stopReel();
    this._onBack = null;
  }
}

export { PIPELINE_STATUSES };
