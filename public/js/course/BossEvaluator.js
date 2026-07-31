/**
 * Boss Challenge evaluator — checks pass criteria from curriculum.json
 * against live vocal / pacing snapshots + self-check toggles.
 */

/**
 * @param {{
 *   criteria: object[],
 *   durationSec: number,
 *   fillerTotal?: number,
 *   deliberatePauses?: number,
 *   selfChecks?: Record<string, boolean>,
 * }} input
 */
export function evaluateBossChallenge(input) {
  const {
    criteria = [],
    durationSec = 0,
    fillerTotal = 0,
    deliberatePauses = 0,
    selfChecks = {},
  } = input;

  const results = criteria.map((c) => {
    const id = c.id || c.type;
    let passed = false;
    let detail = "";

    switch (c.type) {
      case "zero_fillers":
        passed = Number(fillerTotal) <= 0;
        detail = passed
          ? "Clean — no fillers detected"
          : `${fillerTotal} filler hit${fillerTotal === 1 ? "" : "s"}`;
        break;
      case "min_pauses": {
        const need = Number(c.minCount) || 1;
        passed = deliberatePauses >= need;
        detail = `${deliberatePauses}/${need} deliberate pauses`;
        break;
      }
      case "duration": {
        const min = Number(c.minSec) || 0;
        const max = Number(c.maxSec) || Infinity;
        passed = durationSec >= min && durationSec <= max;
        detail = `${Math.round(durationSec)}s (need ${min}–${max === Infinity ? "∞" : max}s)`;
        break;
      }
      case "self_check":
        passed = Boolean(selfChecks[id] || selfChecks[c.id]);
        detail = passed ? "Confirmed" : "Confirm to pass";
        break;
      default:
        passed = Boolean(selfChecks[id]);
        detail = passed ? "OK" : "Pending";
    }

    return {
      id,
      label: c.label || id,
      type: c.type,
      required: c.required !== false,
      passed,
      detail,
    };
  });

  const required = results.filter((r) => r.required);
  const allPassed = required.every((r) => r.passed);
  return {
    allPassed,
    results,
    passedCount: results.filter((r) => r.passed).length,
    totalCount: results.length,
  };
}

/**
 * Count deliberate pauses from a list of pause durations (seconds).
 * @param {number[]} pauseDurationsSec
 * @param {number} minPauseSec
 */
export function countDeliberatePauses(pauseDurationsSec, minPauseSec = 1.2) {
  return (pauseDurationsSec || []).filter((s) => s >= minPauseSec).length;
}
