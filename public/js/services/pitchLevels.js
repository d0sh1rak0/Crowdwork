/**
 * Pitch campaign levels — rising difficulty, Final Boss climax.
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
    pauseDecay: 0.18,
    rushPenalty: 5,
    fillerPenalty: 6,
    steadyBonus: 5,
  },
  {
    id: 2,
    key: "openmic",
    name: "Open Mic",
    badge: "LVL 2",
    blurb: "Real eyes on you. Keep the pace.",
    difficultyMult: 1,
    startAttention: 78,
    pauseDecay: 0.25,
    rushPenalty: 8,
    fillerPenalty: 9,
    steadyBonus: 4,
  },
  {
    id: 3,
    key: "arena",
    name: "Arena",
    badge: "LVL 3",
    blurb: "Judges lean in. Mistakes cost more.",
    difficultyMult: 1.35,
    startAttention: 70,
    pauseDecay: 0.35,
    rushPenalty: 11,
    fillerPenalty: 12,
    steadyBonus: 3,
  },
  {
    id: 4,
    key: "boss",
    name: "Final Boss",
    badge: "BOSS",
    blurb: "Spotlight max. Survive the room.",
    difficultyMult: 1.75,
    startAttention: 62,
    pauseDecay: 0.45,
    rushPenalty: 14,
    fillerPenalty: 15,
    steadyBonus: 3,
    isBoss: true,
  },
];

export function getPitchLevel(id) {
  const n = Number(id) || 2;
  return PITCH_LEVELS.find((l) => l.id === n) || PITCH_LEVELS[1];
}
