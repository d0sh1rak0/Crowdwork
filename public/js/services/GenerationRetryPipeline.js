/**
 * GenerationRetryPipeline — exponential backoff + predictive wait windows
 * for script generation when upstream APIs return rate-limit / capacity errors.
 */

import { generateScript } from "../api.js";
import { isRateLimitError } from "../utilities/ApiErrors.js";

const BASE_WAIT_MS = 12000;
const MAX_WAIT_MS = 45000;
const JITTER_MS = 3000;

/**
 * @param {number} attempt 1-based retry count after a failure
 * @param {number} [suggestedMs] from Retry-After / server hint
 */
export function computeBackoffMs(attempt, suggestedMs) {
  const n = Math.max(1, Number(attempt) || 1);
  if (suggestedMs && suggestedMs >= 8000 && n === 1) {
    return Math.min(MAX_WAIT_MS, Math.round(suggestedMs));
  }
  const exp = Math.min(MAX_WAIT_MS, BASE_WAIT_MS * Math.pow(1.45, n - 1));
  const jitter = Math.floor(Math.random() * JITTER_MS);
  const hinted = suggestedMs && suggestedMs > 0 ? suggestedMs : 0;
  return Math.min(MAX_WAIT_MS, Math.round(Math.max(exp, hinted) + jitter));
}

/**
 * Wait `waitMs` while reporting 0→1 progress that completes as the wait ends.
 * @param {number} waitMs
 * @param {(progress: number, remainingMs: number) => void} onProgress
 * @param {AbortSignal} [signal]
 */
export function waitWithPredictiveProgress(waitMs, onProgress, signal) {
  const duration = Math.max(1000, waitMs);
  const nowFn = () =>
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const started = nowFn();
  const hasRaf = typeof requestAnimationFrame === "function";

  return new Promise((resolve, reject) => {
    let raf = 0;
    let timer = 0;

    const cleanup = () => {
      if (raf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf);
      }
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      const AbortErr =
        typeof DOMException !== "undefined"
          ? new DOMException("Aborted", "AbortError")
          : Object.assign(new Error("Aborted"), { name: "AbortError" });
      reject(AbortErr);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const tick = () => {
      if (signal?.aborted) return;
      const elapsed = nowFn() - started;
      const progress = Math.min(1, elapsed / duration);
      onProgress?.(progress, Math.max(0, duration - elapsed));
      if (progress >= 1) {
        cleanup();
        resolve();
        return;
      }
      if (hasRaf) raf = requestAnimationFrame(tick);
      else timer = setTimeout(tick, 32);
    };

    onProgress?.(0, duration);
    if (hasRaf) raf = requestAnimationFrame(tick);
    else timer = setTimeout(tick, 32);
  });
}

/**
 * Run generateScript with automatic rate-limit recovery.
 *
 * @param {object} payload
 * @param {{
 *   signal?: AbortSignal,
 *   generateFn?: typeof generateScript,
 *   onEnterRecovery?: (info: { attempt: number, waitMs: number }) => void,
 *   onWaitProgress?: (info: { attempt: number, waitMs: number, progress: number, remainingMs: number }) => void,
 *   onRetryFire?: (info: { attempt: number }) => void,
 *   maxAttempts?: number,
 * }} [options]
 */
export async function generateScriptWithRecovery(payload, options = {}) {
  const generateFn = options.generateFn || generateScript;
  const signal = options.signal;
  const maxAttempts = options.maxAttempts ?? 24;
  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await generateFn(payload, { signal });
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") {
        throw new DOMException("Aborted", "AbortError");
      }
      if (!isRateLimitError(err)) throw err;

      attempt += 1;
      if (attempt > maxAttempts) throw err;

      const waitMs = computeBackoffMs(attempt, err.retryAfterMs);
      options.onEnterRecovery?.({ attempt, waitMs, error: err });

      await waitWithPredictiveProgress(
        waitMs,
        (progress, remainingMs) => {
          options.onWaitProgress?.({
            attempt,
            waitMs,
            progress,
            remainingMs,
          });
        },
        signal
      );

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      options.onRetryFire?.({ attempt });
    }
  }
}
