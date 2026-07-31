/**
 * Boss / lesson criterion evaluator — multi-modal automated + legacy self-check.
 */

/**
 * @param {{
 *   criteria: object[],
 *   durationSec: number,
 *   fillerTotal?: number,
 *   deliberatePauses?: number,
 *   wpm?: number,
 *   selfChecks?: Record<string, boolean>,
 *   gaze?: object,
 *   pose?: object,
 *   pitch?: object,
 *   breath?: object,
 *   latencyResults?: number[],
 *   smileOpenSec?: number,
 *   heckle?: object,
 *   reframe?: object,
 *   visionAvailable?: boolean,
 * }} input
 */
export function evaluateBossChallenge(input) {
  const {
    criteria = [],
    durationSec = 0,
    fillerTotal = 0,
    deliberatePauses = 0,
    wpm = 0,
    selfChecks = {},
    gaze = {},
    pose = {},
    pitch = {},
    breath = {},
    latencyResults = [],
    smileOpenSec = 0,
    heckle = {},
    reframe = {},
    visionAvailable = false,
  } = input;

  const results = criteria.map((c) => {
    const id = c.id || c.type;
    let passed = false;
    let detail = "";
    let skipped = false;

    const visionRequired = [
      "gaze_steady_coverage",
      "gaze_no_down_breaks",
      "gaze_on_camera",
      "gaze_no_darts",
      "pose_open_streak",
      "pose_open_ratio",
      "pose_clean",
      "smile_open_combo",
      "heckle_gaze_stable",
    ].includes(c.type);

    // Soft-skip vision criteria when MediaPipe failed to load (still mark detail)
    if (visionRequired && gaze.available === false && pose.available === false) {
      skipped = true;
      detail = "Vision unavailable — confirm manually next take";
      // Don't fail hard if vision stack couldn't load; treat as not passed but note it
      passed = false;
    } else {
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
          detail = `${Math.round(durationSec)}s (need ${min}–${
            max === Infinity ? "∞" : max
          }s)`;
          break;
        }

        case "wpm_window": {
          const minW = Number(c.minWpm) || 0;
          const maxW = Number(c.maxWpm) || 999;
          // Allow cold start (no speech yet) to fail clearly
          passed = wpm > 0 && wpm >= minW && wpm <= maxW;
          detail = wpm > 0 ? `${wpm} WPM (need ${minW}–${maxW})` : "No WPM yet";
          break;
        }

        case "gaze_steady_coverage": {
          const ratio = Number(gaze.steadyCoverage) || 0;
          const need = Number(c.minRatio) || 0.9;
          passed = Boolean(gaze.available) && ratio >= need;
          detail = gaze.available
            ? `${Math.round(ratio * 100)}% steady blocks (need ≥${Math.round(
                need * 100
              )}%)`
            : "Gaze tracker offline";
          break;
        }

        case "gaze_no_down_breaks": {
          const events = Number(gaze.downBreakEvents) || 0;
          const maxE = Number(c.maxEvents) ?? 0;
          passed = Boolean(gaze.available) && events <= maxE;
          detail = gaze.available
            ? events === 0
              ? "No downward breaks"
              : `${events} downward break${events === 1 ? "" : "s"}`
            : "Gaze tracker offline";
          break;
        }

        case "gaze_on_camera": {
          const ratio = Number(gaze.onCameraRatio) || 0;
          const need = Number(c.minRatio) || 0.85;
          passed = Boolean(gaze.available) && ratio >= need;
          detail = gaze.available
            ? `${Math.round(ratio * 100)}% on camera (need ≥${Math.round(
                need * 100
              )}%)`
            : "Gaze tracker offline";
          break;
        }

        case "gaze_no_darts": {
          const events = Number(gaze.dartEvents) || 0;
          const maxE = Number(c.maxEvents) ?? 0;
          passed = Boolean(gaze.available) && events <= maxE;
          detail = gaze.available
            ? events === 0
              ? "No gaze darts"
              : `${events} dart event${events === 1 ? "" : "s"}`
            : "Gaze tracker offline";
          break;
        }

        case "pose_open_streak": {
          const sec = Number(pose.maxOpenStreakSec) || 0;
          const need = Number(c.minSec) || 60;
          passed = Boolean(pose.available) && sec >= need - 0.5;
          detail = pose.available
            ? `${sec.toFixed(1)}s open streak (need ${need}s)`
            : "Pose tracker offline";
          break;
        }

        case "pose_open_ratio": {
          const ratio = Number(pose.openRatio) || 0;
          const need = Number(c.minRatio) || 0.95;
          passed = Boolean(pose.available) && ratio >= need;
          detail = pose.available
            ? `${Math.round(ratio * 100)}% open (need ≥${Math.round(
                need * 100
              )}%)`
            : "Pose tracker offline";
          break;
        }

        case "pose_clean": {
          const crossed = Number(pose.crossedEvents) || 0;
          const slouch = Number(pose.slouchEvents) || 0;
          const maxC = Number(c.maxCrossed) ?? 3;
          const maxS = Number(c.maxSlouch) ?? 5;
          passed =
            Boolean(pose.available) && crossed <= maxC && slouch <= maxS;
          detail = pose.available
            ? `cross×${crossed} slouch×${slouch}`
            : "Pose tracker offline";
          break;
        }

        case "breath_cycle":
          passed = Boolean(breath.cycleComplete);
          detail = passed ? "4-7-8 cycle complete" : `Phase: ${breath.phase || "—"}`;
          break;

        case "breath_speak":
          passed = Boolean(breath.speakComplete);
          detail = passed
            ? `Phrase done · F0⌊ ${Math.round(breath.pitchFloorHz || 0)}Hz`
            : "Speak a resonant phrase after the exhale";
          break;

        case "downward_inflection_count": {
          const need = Number(c.minCount) || 3;
          const got = Number(pitch.downwardCount) || 0;
          passed = got >= need;
          detail = `${got}/${need} downward endings`;
          break;
        }

        case "downward_inflection_final":
          passed = Boolean(pitch.finalDownward);
          detail = passed
            ? "Final sentence pitched down"
            : "Final sentence missing downward slope";
          break;

        case "response_latency": {
          const minS = Number(c.minSec) || 1;
          const maxS = Number(c.maxSec) || 2;
          const need = Number(c.requiredCount) || 3;
          const ok = latencyResults.filter((dt) => dt >= minS && dt <= maxS);
          passed = ok.length >= need;
          detail = `${ok.length}/${need} in ${minS}–${maxS}s · raw [${latencyResults
            .map((d) => d.toFixed(1))
            .join(", ")}]`;
          break;
        }

        case "smile_open_combo": {
          const need = Number(c.minSec) || 5;
          passed =
            (Boolean(gaze.available) || Boolean(pose.available)) &&
            smileOpenSec >= need;
          detail = `${smileOpenSec.toFixed(1)}s smile+open (need ${need}s)`;
          break;
        }

        case "heckle_gaze_stable": {
          const ratio = Number(heckle.onCameraRatio) || 0;
          const need = Number(c.minOnCameraRatio) || 0.75;
          passed = Boolean(heckle.fired) && ratio >= need;
          detail = heckle.fired
            ? `Post-interrupt gaze ${Math.round(ratio * 100)}%`
            : "Heckle did not fire";
          break;
        }

        case "heckle_wpm_cap": {
          const maxW = Number(c.maxWpm) || 160;
          const peak = Number(heckle.postMaxWpm) || 0;
          passed = Boolean(heckle.fired) && peak > 0 && peak <= maxW;
          detail = heckle.fired
            ? `Peak ${peak} WPM (cap ${maxW})`
            : "Heckle did not fire";
          // If they stayed silent after heckle, peak may be 0 — still pass if fired + no spike
          if (heckle.fired && peak === 0) {
            passed = true;
            detail = "No panic spike (calm/silent)";
          }
          break;
        }

        case "reframe_energy": {
          const need = Number(c.minRms) || 0.04;
          const got = Number(reframe.maxRms) || 0;
          passed = got >= need;
          detail = `Peak energy ${(got * 100).toFixed(1)} (need ≥${(
            need * 100
          ).toFixed(0)})`;
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
    }

    return {
      id,
      label: c.label || id,
      type: c.type,
      required: c.required !== false,
      passed,
      skipped,
      detail,
      visionRequired,
      visionAvailable,
    };
  });

  const required = results.filter((r) => r.required);
  // Vision-skipped required items: if ALL vision failed to load, don't block XP
  // when every non-vision required criterion passed — but still show fails.
  const hardRequired = required.filter((r) => !(r.skipped && r.visionRequired));
  const allPassed =
    hardRequired.length > 0
      ? hardRequired.every((r) => r.passed)
      : required.every((r) => r.passed || r.skipped);

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
