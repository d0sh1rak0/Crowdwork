/**
 * Typed API errors for generation recovery flows.
 */

/** Transient overload only — auto-retry is useful */
const RATE_LIMIT_RE =
  /429|rate.?limit|too many requests|overloaded|throttl|try again later|generation service is busy|temporarily unavailable|high demand|resource.?exhausted/i;

/** Auth / quota / billing / network — NEVER enter the predictive retry loop */
const HARD_FAULT_RE =
  /api.?key|invalid.?key|unauthorized|permission.?denied|authentication|forbidden|not configured|is not set|ENOTFOUND|ECONNREFUSED|network|failed to fetch|Load failed|Internal Server Error|billing|plan and billing|exceeded your current quota|PROVIDER_QUOTA|quota.*billing|consumer.?suspended/i;

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

export function isHardFaultError(err) {
  if (!err) return false;
  const status = Number(err.status) || 0;
  if (status === 401 || status === 402 || status === 403 || status === 500) {
    return true;
  }
  if (err.code === "PROVIDER_QUOTA") return true;
  return HARD_FAULT_RE.test(String(err.message || ""));
}

export function isRateLimitError(err) {
  if (!err) return false;
  // Quota / billing hard faults win even when status is 429
  if (isHardFaultError(err)) return false;
  if (err instanceof RateLimitError) return true;
  if (err.name === "RateLimitError" || err.code === "RATE_LIMIT") return true;
  if (err.status === 429) {
    const msg = String(err.message || "");
    if (HARD_FAULT_RE.test(msg)) return false;
    return true;
  }
  const msg = String(err.message || "");
  if (HARD_FAULT_RE.test(msg)) return false;
  return RATE_LIMIT_RE.test(msg);
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
  const detail = String(data.detail || "");
  const retryAfterSec = Number(data.retryAfterSec);
  const combined = `${message} ${detail}`;

  if (
    res.status === 402 ||
    data.code === "PROVIDER_QUOTA" ||
    HARD_FAULT_RE.test(combined)
  ) {
    const err = new Error(message);
    err.status = res.status || 402;
    err.code = data.code || "PROVIDER_QUOTA";
    err.detail = detail;
    throw err;
  }

  const looksRateLimited =
    (res.status === 429 || data.code === "RATE_LIMIT") &&
    !HARD_FAULT_RE.test(combined);

  if (looksRateLimited) {
    throw new RateLimitError(message, {
      retryAfterMs:
        (Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(45, retryAfterSec)
          : 12 + Math.floor(Math.random() * 4)) * 1000,
      detail: detail,
    });
  }
  const err = new Error(message);
  err.status = res.status;
  throw err;
}
