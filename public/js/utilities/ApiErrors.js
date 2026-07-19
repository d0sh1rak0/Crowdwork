/**
 * Typed API errors for generation recovery flows.
 */

const RATE_LIMIT_RE =
  /429|rate.?limit|too many requests|RESOURCE_EXHAUSTED|quota.?exceeded|exceeded.+quota|overloaded|capacity|throttl|try again later|generation service is busy|resource has been exhausted/i;

/** Auth / config / hard faults must NEVER enter the predictive retry loop */
const HARD_FAULT_RE =
  /api.?key|invalid.?key|unauthorized|permission.?denied|authentication|forbidden|not configured|is not set|ENOTFOUND|ECONNREFUSED|network|failed to fetch|Load failed|500|Internal Server Error/i;

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
  if (status === 401 || status === 403 || status === 500) return true;
  return HARD_FAULT_RE.test(String(err.message || ""));
}

export function isRateLimitError(err) {
  if (!err) return false;
  if (isHardFaultError(err) && err.status !== 429) return false;
  if (err instanceof RateLimitError) return true;
  if (err.name === "RateLimitError" || err.code === "RATE_LIMIT") return true;
  if (err.status === 429) return true;
  const msg = String(err.message || "");
  if (HARD_FAULT_RE.test(msg) && !/429|rate.?limit|too many requests/i.test(msg)) {
    return false;
  }
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
  const retryAfterSec = Number(data.retryAfterSec);
  const looksRateLimited =
    res.status === 429 ||
    data.code === "RATE_LIMIT" ||
    (RATE_LIMIT_RE.test(message) && !HARD_FAULT_RE.test(message));

  if (looksRateLimited && res.status !== 401 && res.status !== 403) {
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
