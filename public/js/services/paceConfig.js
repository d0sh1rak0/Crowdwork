/**
 * Shared speaking-pace targets for rehearsal scoring + the pre-start tuner.
 *
 * Bands are intentionally wide: STT arrives in uneven chunks, so a narrow
 * “coach” corridor reads as always-too-slow / always-too-fast. Only extreme
 * drag or sprint should leave the healthy / steady zone.
 */

export const DEFAULT_PACE_TARGET_WPM = 150;
export const PACE_TARGET_MIN = 110;
export const PACE_TARGET_MAX = 195;
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
    // Broad coachable corridor — conversational pitch lives here
    healthyMin: Math.max(95, target - 45),
    healthyMax: Math.min(210, target + 50),
    // Extreme edges only (leave a soft buffer outside healthy)
    rushWpm: Math.min(245, target + 75),
    slowWpm: Math.max(75, target - 60),
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
  if (tone === "energetic") target = 162;
  else if (tone === "friendly") target = 145;
  else if (tone === "formal") target = 138;
  else if (tone === "confident") target = 152;

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
          : "A steady conversational pace keeps attention without sounding rushed.",
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
  if (Math.abs(delta) <= 12) {
    return {
      verdict: "similar",
      message: `Near the AI pick (${rec} wpm) — a solid steady target for this pitch.`,
    };
  }
  if (delta > 12 && delta <= 28) {
    return {
      verdict: "better",
      message: `A bit faster than ${rec} wpm can hold attention — stay clear on key numbers.`,
    };
  }
  if (delta < -12 && delta >= -28) {
    return {
      verdict: "worse",
      message: `Slower than the AI pick (${rec} wpm) may feel flat for this room — try nudging up.`,
    };
  }
  if (delta > 28) {
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
