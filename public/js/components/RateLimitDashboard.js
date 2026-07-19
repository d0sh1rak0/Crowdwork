/**
 * Generation / rate-limit loading dashboard — Jet Black / Electric Yellow.
 * Used while the real Gemini generate-script request is in flight, and again
 * if upstream returns 429 (predictive backoff window).
 */

const GENERATE_STATUSES = [
  "Calling Gemini with your deck…",
  "Drafting spoken lines per slide…",
  "Allocating time budgets…",
  "Tightening delivery tips…",
  "Compacting JSON response…",
  "Syncing slide order…",
];

const RECOVERY_STATUSES = [
  "Queueing server instance…",
  "Optimizing token headers…",
  "Allocating sandbox memory channels…",
  "Re-establishing neural pipeline connection…",
  "Warming inference workers…",
  "Rebalancing request capacity…",
  "Syncing model context windows…",
  "Verifying upstream handshake…",
  "Recycling rate-limit tokens…",
];

export default class RateLimitDashboard {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this._reelTimer = null;
    this._progressTimer = null;
    this._statusIdx = 0;
    this._onBack = null;
    this._mode = "generate"; // generate | recovery
    this._statuses = GENERATE_STATUSES;

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

  /**
   * Show while the real generate-script API call is running.
   * Progress eases toward ~90% over an estimated duration, then snaps on complete().
   * @param {{ slideCount?: number, estimatedMs?: number }} [opts]
   */
  showGenerating(opts = {}) {
    this._mode = "generate";
    this._statuses = GENERATE_STATUSES;
    this._showShell("Writing your script…");
    const slides = Math.max(1, Number(opts.slideCount) || 8);
    const estimatedMs =
      Number(opts.estimatedMs) ||
      Math.min(90000, Math.max(12000, 8000 + slides * 2500));
    this._startPredictiveProgress(estimatedMs, 0.9);
    if (this.meta) {
      this.meta.textContent = `Generating ${slides} slide${slides === 1 ? "" : "s"} via API`;
    }
  }

  /**
   * Show during 429 / capacity backoff (bar fills across the wait window).
   * @param {{ attempt?: number, waitMs?: number }} [opts]
   */
  showRecovery(opts = {}) {
    this._mode = "recovery";
    this._statuses = RECOVERY_STATUSES;
    this._stopProgress();
    this._showShell("This is taking a little longer than usual…");
    const waitMs = Math.max(1000, Number(opts.waitMs) || 12000);
    this.setProgress(0, {
      attempt: opts.attempt || 1,
      waitMs,
      remainingMs: waitMs,
    });
  }

  _showShell(headline) {
    this.root.hidden = false;
    this.root.classList.add("is-visible");
    this.root.setAttribute("aria-hidden", "false");
    if (this.headline) this.headline.textContent = headline;
    this.setProgress(0);
    this._startReel();
  }

  /**
   * Ease progress 0 → maxPct over durationMs (does not complete on its own).
   */
  _startPredictiveProgress(durationMs, maxPct = 0.9) {
    this._stopProgress();
    const duration = Math.max(2000, durationMs);
    const started = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / duration);
      // Ease-out so early movement feels responsive
      const eased = 1 - (1 - t) * (1 - t);
      this.setProgress(eased * maxPct, {
        attempt: 0,
        remainingMs: Math.max(0, duration - (performance.now() - started)),
        waitMs: duration,
      });
      if (t < 1 && this.visible) {
        this._progressTimer = requestAnimationFrame(tick);
      }
    };
    this._progressTimer = requestAnimationFrame(tick);
  }

  _stopProgress() {
    if (this._progressTimer) {
      cancelAnimationFrame(this._progressTimer);
      this._progressTimer = null;
    }
  }

  /** Snap bar to 100% then hide — call when API payload is ready */
  completeAndHide() {
    this._stopProgress();
    this.setProgress(1, { attempt: 0, remainingMs: 0, waitMs: 0 });
    if (this.meta) this.meta.textContent = "Script ready — opening studio…";
    this.hide();
  }

  hide() {
    this._stopProgress();
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
      this.bar.parentElement?.setAttribute(
        "aria-valuenow",
        String(Math.round(pct))
      );
    }
    if (this.meta && this._mode === "recovery") {
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
    } else if (this.meta && this._mode === "generate" && meta.remainingMs != null) {
      const secs = Math.ceil((meta.remainingMs || 0) / 1000);
      if (secs > 0 && progress < 0.95) {
        this.meta.textContent = `API generating… ~${secs}s remaining`;
      }
    }
  }

  setReelText(text) {
    if (!this.reel) return;
    this.reel.classList.remove("is-tick");
    void this.reel.offsetWidth;
    this.reel.textContent = text;
    this.reel.classList.add("is-tick");
  }

  _startReel() {
    this._stopReel();
    this._statusIdx = Math.floor(Math.random() * this._statuses.length);
    this.setReelText(this._statuses[this._statusIdx]);
    this._reelTimer = setInterval(() => {
      this._statusIdx = (this._statusIdx + 1) % this._statuses.length;
      this.setReelText(this._statuses[this._statusIdx]);
    }, 900);
  }

  _stopReel() {
    if (this._reelTimer) {
      clearInterval(this._reelTimer);
      this._reelTimer = null;
    }
  }

  destroy() {
    this._stopProgress();
    this._stopReel();
    this._onBack = null;
  }
}

export { GENERATE_STATUSES, RECOVERY_STATUSES };
