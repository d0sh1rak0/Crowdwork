/**
 * Typed API errors for generation recovery flows.
 */

const RATE_LIMIT_RE =
  /429|rate.?limit|too many requests|RESOURCE_EXHAUSTED|quota|overloaded|capacity|throttl|try again later|generation service is busy/i;

export class RateLimitError extends Error {
  /**
   * @param {string} message
   * @param {{ retryAfterMs?: number, detail?: string }} [meta]
   */
  constructor(message, meta = {}) {
    super(message || "Rate limited.");
    this.name = "RateLimitError";
    this.status = 429;
    this.code = "RATE_LIMIT";
    this.retryAfterMs = Math.max(8000, Number(meta.retryAfterMs) || 12000);
    this.detail = meta.detail || "";
  }
}

export function isRateLimitError(err) {
  if (!err) return false;
  if (err instanceof RateLimitError) return true;
  if (err.name === "RateLimitError" || err.code === "RATE_LIMIT") return true;
  if (err.status === 429) return true;
  return RATE_LIMIT_RE.test(String(err.message || ""));
}

/**
 * @param {Response} res
 * @returns {Promise<never>}
 */
export async function throwFromResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  const message =
    data.error || res.statusText || `Request failed (${res.status}).`;
  const retryAfterSec = Number(data.retryAfterSec);
  if (
    res.status === 429 ||
    data.code === "RATE_LIMIT" ||
    RATE_LIMIT_RE.test(message)
  ) {
    throw new RateLimitError(message, {
      retryAfterMs:
        (Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec
          : 12 + Math.floor(Math.random() * 4)) * 1000,
      detail: data.detail || "",
    });
  }
  const err = new Error(message);
  err.status = res.status;
  throw err;
}
