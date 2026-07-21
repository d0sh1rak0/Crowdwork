/**
 * Pitch campaign levels — rising difficulty, Final Boss climax.
 * Balanced: recoverable attention, still reacts to dead air / rush / fillers.
 */

export const PITCH_LEVELS = [
  {
    id: 1,
    key: "warmup",
    name: "Warm-up",
    badge: "LVL 1",
    blurb: "Friendly room. Build the habit.",
    difficultyMult: 0.75,
    startAttention: 88,
    pauseDecay: 0.5,
    rushPenalty: 4,
    fillerPenalty: 4,
    steadyBonus: 4.5,
  },
  {
    id: 2,
    key: "openmic",
    name: "Open Mic",
    badge: "LVL 2",
    blurb: "Real eyes on you. Keep the pace.",
    difficultyMult: 1,
    startAttention: 84,
    pauseDecay: 0.65,
    rushPenalty: 5,
    fillerPenalty: 5,
    steadyBonus: 4,
  },
  {
    id: 3,
    key: "arena",
    name: "Arena",
    badge: "LVL 3",
    blurb: "Judges lean in. Mistakes cost more.",
    difficultyMult: 1.25,
    startAttention: 78,
    pauseDecay: 0.8,
    rushPenalty: 6,
    fillerPenalty: 6,
    steadyBonus: 3.5,
  },
  {
    id: 4,
    key: "boss",
    name: "Final Boss",
    badge: "BOSS",
    blurb: "Spotlight max. Survive the room.",
    difficultyMult: 1.45,
    startAttention: 74,
    pauseDecay: 0.95,
    rushPenalty: 8,
    fillerPenalty: 8,
    steadyBonus: 3.5,
    isBoss: true,
  },
];

export function getPitchLevel(id) {
  const n = Number(id) || 2;
  return PITCH_LEVELS.find((l) => l.id === n) || PITCH_LEVELS[1];
}
