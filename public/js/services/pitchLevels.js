/**
 * Pitch campaign levels — rising difficulty, Final Boss climax.
 * Tuned so attention is coachable (not a constant drain).
 */

export const PITCH_LEVELS = [
  {
    id: 1,
    key: "warmup",
    name: "Warm-up",
    badge: "LVL 1",
    blurb: "Friendly room. Build the habit.",
    difficultyMult: 0.75,
    startAttention: 92,
    pauseDecay: 0.35,
    rushPenalty: 3,
    fillerPenalty: 3,
    steadyBonus: 6,
  },
  {
    id: 2,
    key: "openmic",
    name: "Open Mic",
    badge: "LVL 2",
    blurb: "Real eyes on you. Keep the pace.",
    difficultyMult: 1,
    startAttention: 88,
    pauseDecay: 0.45,
    rushPenalty: 4,
    fillerPenalty: 4,
    steadyBonus: 5,
  },
  {
    id: 3,
    key: "arena",
    name: "Arena",
    badge: "LVL 3",
    blurb: "Judges lean in. Mistakes cost more.",
    difficultyMult: 1.25,
    startAttention: 82,
    pauseDecay: 0.55,
    rushPenalty: 6,
    fillerPenalty: 6,
    steadyBonus: 4,
  },
  {
    id: 4,
    key: "boss",
    name: "Final Boss",
    badge: "BOSS",
    blurb: "Spotlight max. Survive the room.",
    difficultyMult: 1.5,
    startAttention: 78,
    pauseDecay: 0.7,
    rushPenalty: 8,
    fillerPenalty: 8,
    steadyBonus: 4,
    isBoss: true,
  },
];

export function getPitchLevel(id) {
  const n = Number(id) || 2;
  return PITCH_LEVELS.find((l) => l.id === n) || PITCH_LEVELS[1];
}
