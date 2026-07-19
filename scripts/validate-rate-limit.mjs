/**
 * Local validation for rate-limit helpers (no network).
 */
import assert from "node:assert/strict";
import { inspectRateLimitError } from "../server/rateLimit.js";
import {
  computeBackoffMs,
  waitWithPredictiveProgress,
} from "../public/js/services/GenerationRetryPipeline.js";
import {
  RateLimitError,
  isHardFaultError,
  isRateLimitError,
} from "../public/js/utilities/ApiErrors.js";

// Server inspector
{
  const a = inspectRateLimitError({ status: 429, message: "Too Many Requests" });
  assert.equal(a.isRateLimit, true);
  assert.ok(a.retryAfterSec >= 10 && a.retryAfterSec <= 90);

  const b = inspectRateLimitError(new Error("RESOURCE_EXHAUSTED: quota exceeded"));
  assert.equal(b.isRateLimit, true);

  const c = inspectRateLimitError(new Error("slide parse failed"));
  assert.equal(c.isRateLimit, false);

  const d = inspectRateLimitError(new Error("GEMINI_API_KEY is not set."));
  assert.equal(d.isRateLimit, false);
}

// Client typed error
{
  const err = new RateLimitError("busy", { retryAfterMs: 14000 });
  assert.equal(isRateLimitError(err), true);
  assert.equal(isRateLimitError(new Error("boom")), false);
  assert.equal(
    isRateLimitError(new Error("429 Too Many Requests from upstream")),
    true
  );
  assert.equal(isRateLimitError(new Error("Invalid API key")), false);
  assert.equal(isHardFaultError(new Error("Invalid API key")), true);
  const serverErr = Object.assign(new Error("Internal Server Error"), {
    status: 500,
  });
  assert.equal(isRateLimitError(serverErr), false);
  assert.equal(isHardFaultError(serverErr), true);
}

// Backoff window lands in predictive 10–45s band
{
  const w1 = computeBackoffMs(1, 12000);
  assert.ok(w1 >= 12000 && w1 <= 45000, `w1=${w1}`);
  const w3 = computeBackoffMs(3, 0);
  assert.ok(w3 > w1 || w3 >= 12000, `w3=${w3}`);
}

// Progress completes at end of wait
{
  let last = 0;
  const ac = new AbortController();
  await waitWithPredictiveProgress(
    120,
    (p) => {
      last = p;
    },
    ac.signal
  );
  assert.ok(last >= 0.99, `progress=${last}`);
}

console.log("validate-rate-limit: ok");
