/**
 * Shared speaking-pace targets for rehearsal scoring + the pre-start tuner.
 *
 * Defaults sit higher than classic “broadcast” 120–150 so a brisk pitch
 * still lands in the healthy / steady band.
 */

export const DEFAULT_PACE_TARGET_WPM = 155;
export const PACE_TARGET_MIN = 120;
export const PACE_TARGET_MAX = 200;
/** Approximate natural rate of OpenAI / browser TTS for playbackRate mapping */
export const TTS_NATURAL_WPM = 150;

/**
 * @param {number} targetWpm
 * @returns {{ targetWpm: number, healthyMin: number, healthyMax: number, rushWpm: number, slowWpm: number }}
 */
export function derivePaceBands(targetWpm = DEFAULT_PACE_TARGET_WPM) {
  const target = clampPaceTarget(targetWpm);
  return {
    targetWpm: target,
    // Slightly wider on the fast side so “speak up” still counts as steady
    healthyMin: Math.max(100, target - 20),
    healthyMax: Math.min(210, target + 25),
    rushWpm: Math.min(230, target + 40),
    slowWpm: Math.max(90, target - 35),
  };
}

export function clampPaceTarget(wpm) {
  const n = Number(wpm);
  if (!Number.isFinite(n)) return DEFAULT_PACE_TARGET_WPM;
  return Math.round(Math.min(PACE_TARGET_MAX, Math.max(PACE_TARGET_MIN, n)));
}

/** Map target WPM → HTMLAudioElement / SpeechSynthesis rate */
export function playbackRateForWpm(targetWpm) {
  const rate = clampPaceTarget(targetWpm) / TTS_NATURAL_WPM;
  return Math.min(1.55, Math.max(0.7, Math.round(rate * 100) / 100));
}

/**
 * Local coach fallback when the LLM endpoint is unavailable.
 * @param {{ tone?: string, purpose?: string, language?: string, targetMinutes?: number }} ctx
 */
export function localPaceRecommendation(ctx = {}) {
  const tone = String(ctx.tone || "confident").toLowerCase();
  let target = DEFAULT_PACE_TARGET_WPM;
  if (tone === "energetic") target = 168;
  else if (tone === "friendly") target = 150;
  else if (tone === "formal") target = 142;
  else if (tone === "confident") target = 158;

  const purpose = String(ctx.purpose || "").toLowerCase();
  if (/demo|pitch|investor|sales/.test(purpose)) target += 4;
  if (/lecture|training|workshop/.test(purpose)) target -= 6;
  if (ctx.language === "ru") target -= 3;

  const minutes = Number(ctx.targetMinutes) || 10;
  if (minutes <= 5) target += 5;
  if (minutes >= 20) target -= 5;

  target = clampPaceTarget(target);
  const bands = derivePaceBands(target);
  return {
    recommendedWpm: target,
    rationale:
      tone === "energetic"
        ? "For an energetic delivery, aim brisk — keep clarity, don’t race."
        : tone === "formal"
          ? "Formal rooms reward measured pace with room to breathe."
          : "A slightly faster steady pace keeps attention without sounding rushed.",
    healthyMin: bands.healthyMin,
    healthyMax: bands.healthyMax,
    rushWpm: bands.rushWpm,
    slowWpm: bands.slowWpm,
  };
}

/**
 * @param {number} chosenWpm
 * @param {number} recommendedWpm
 */
export function localPaceVerdict(chosenWpm, recommendedWpm) {
  const chosen = clampPaceTarget(chosenWpm);
  const rec = clampPaceTarget(recommendedWpm);
  const delta = chosen - rec;
  if (Math.abs(delta) <= 8) {
    return {
      verdict: "similar",
      message: `Near the AI pick (${rec} wpm) — a solid steady target for this pitch.`,
    };
  }
  if (delta > 8 && delta <= 22) {
    return {
      verdict: "better",
      message: `A bit faster than ${rec} wpm can hold attention — stay clear on key numbers.`,
    };
  }
  if (delta < -8 && delta >= -22) {
    return {
      verdict: "worse",
      message: `Slower than the AI pick (${rec} wpm) may feel flat for this room — try nudging up.`,
    };
  }
  if (delta > 22) {
    return {
      verdict: "worse",
      message: `Much faster than ${rec} wpm risks sounding rushed — the crowd will punish unclear words.`,
    };
  }
  return {
    verdict: "worse",
    message: `Much slower than ${rec} wpm will drag energy — pick up the pace toward the recommendation.`,
  };
}
