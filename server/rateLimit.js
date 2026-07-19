/**
 * Detect upstream rate-limit / capacity errors from Gemini, Groq, etc.
 */

/** Transient overload — safe to auto-retry with backoff */
const TRANSIENT_LIMIT_RE =
  /429|rate.?limit|too many requests|overloaded|throttl|try again later|temporarily unavailable|high demand|resource.?exhausted/i;

/** Billing / plan / key faults — retrying forever will never unlock generation */
const HARD_FAULT_RE =
  /api.?key|invalid.?key|unauthorized|permission.?denied|authentication|forbidden|not configured|is not set|billing|plan and billing|exceeded your current quota|quota.*billing|consumer.?suspended/i;

/**
 * @param {unknown} err
 * @returns {{ isRateLimit: boolean, isHardFault: boolean, retryAfterSec: number, message: string }}
 */
export function inspectRateLimitError(err) {
  const status =
    Number(err?.status) ||
    Number(err?.statusCode) ||
    Number(err?.response?.status) ||
    0;
  const message = String(err?.message || err || "Upstream request failed.");
  const headerRetry =
    err?.headers?.get?.("retry-after") ||
    err?.headers?.["retry-after"] ||
    err?.response?.headers?.["retry-after"];
  const parsedHeader = Number(headerRetry);
  const fromMessage = message.match(/retry.+?(\d+)\s*s/i);
  const retryAfterSec = Math.min(
    45,
    Math.max(
      10,
      Number.isFinite(parsedHeader) && parsedHeader > 0
        ? Math.round(parsedHeader)
        : fromMessage
          ? Number(fromMessage[1])
          : 12 + Math.floor(Math.random() * 4) // 12–15s default window
    )
  );

  const isHardFault =
    status === 401 ||
    status === 403 ||
    HARD_FAULT_RE.test(message) ||
    HARD_FAULT_RE.test(String(err?.code || ""));

  // Quota / billing / key errors must NOT enter the predictive retry loop
  if (isHardFault) {
    return { isRateLimit: false, isHardFault: true, retryAfterSec, message };
  }

  const isRateLimit =
    status === 429 ||
    status === 503 ||
    TRANSIENT_LIMIT_RE.test(message) ||
    TRANSIENT_LIMIT_RE.test(String(err?.code || ""));

  return { isRateLimit, isHardFault: false, retryAfterSec, message };
}

/**
 * Express helper — send a structured 429 without treating it as a hard session failure.
 * @param {import('express').Response} res
 * @param {unknown} err
 */
export function sendRateLimitResponse(res, err) {
  const info = inspectRateLimitError(err);
  res.status(429).json({
    error:
      "The generation service is busy. Retrying automatically — hang tight.",
    code: "RATE_LIMIT",
    retryAfterSec: info.retryAfterSec,
    detail: info.message.slice(0, 240),
  });
}
