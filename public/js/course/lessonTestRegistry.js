/**
 * Per-lesson / boss automated test definitions for Charisma & Speech Mastery.
 * Criteria are evaluated by LessonTestEngine + BossEvaluator against live analyzers.
 */

/** @typedef {'gaze'|'pose'|'pitch'|'breath'|'fillers'|'pace'|'latency'|'heckle'|'reframe'|'smile'} ModuleId */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   durationSec: number,
 *   needsCamera?: boolean,
 *   needsMic?: boolean,
 *   modules: ModuleId[],
 *   prompts?: string[],
 *   heckleLine?: string,
 *   heckleAtSec?: number,
 *   reframePhrase?: string,
 *   criteria: object[],
 * }} LessonTestDef
 */

/** @type {Record<string, LessonTestDef>} */
export const LESSON_TESTS = {
  "lesson-1": {
    id: "lesson-1",
    title: "The 3-Second Rule",
    durationSec: 30,
    needsCamera: true,
    needsMic: true,
    modules: ["gaze"],
    criteria: [
      {
        id: "steady-gaze-coverage",
        label: "3s gaze blocks ≥ 90% of 30s run",
        type: "gaze_steady_coverage",
        minRatio: 0.9,
        blockSec: 3,
        required: true,
      },
      {
        id: "no-down-breaks",
        label: "No downward eye-breaks > 0.5s",
        type: "gaze_no_down_breaks",
        maxEvents: 0,
        required: true,
      },
    ],
  },

  "lesson-2": {
    id: "lesson-2",
    title: "Space & Posture Reset",
    durationSec: 60,
    needsCamera: true,
    needsMic: false,
    modules: ["pose"],
    criteria: [
      {
        id: "open-60s",
        label: "Open posture for 60 continuous seconds",
        type: "pose_open_streak",
        minSec: 60,
        required: true,
      },
      {
        id: "no-cross-slouch",
        label: "No arm-crossing or slouching",
        type: "pose_clean",
        maxCrossed: 3,
        maxSlouch: 5,
        required: true,
      },
    ],
  },

  "lesson-3": {
    id: "lesson-3",
    title: "The Presence Anchor",
    durationSec: 45,
    needsCamera: true,
    needsMic: true,
    modules: ["gaze", "fillers", "pace"],
    criteria: [
      {
        id: "duration-45",
        label: "Speak ~45 seconds",
        type: "duration",
        minSec: 35,
        maxSec: 70,
        required: true,
      },
      {
        id: "no-gaze-darts",
        label: "Zero rapid side-to-side gaze darts in pauses",
        type: "gaze_no_darts",
        maxEvents: 0,
        required: true,
      },
      {
        id: "forward-gaze",
        label: "Gaze stays forward / neutral-horizontal",
        type: "gaze_on_camera",
        minRatio: 0.7,
        required: true,
      },
    ],
  },

  "boss-1": {
    id: "boss-1",
    title: "Unit 1 Boss — Master Checkpoint",
    durationSec: 60,
    needsCamera: true,
    needsMic: true,
    modules: ["gaze", "pose", "fillers", "pace"],
    criteria: [
      {
        id: "no-downward-eye-breaks",
        label: "Zero downward eye-breaks",
        type: "gaze_no_down_breaks",
        maxEvents: 0,
        required: true,
      },
      {
        id: "open-shoulders",
        label: "Open shoulders 100% of run",
        type: "pose_open_ratio",
        minRatio: 0.95,
        required: true,
      },
      {
        id: "duration-ok",
        label: "About 60 seconds on camera",
        type: "duration",
        minSec: 45,
        maxSec: 90,
        required: true,
      },
    ],
  },

  "lesson-4": {
    id: "lesson-4",
    title: "Diaphragmatic Reset",
    durationSec: 45,
    needsCamera: false,
    needsMic: true,
    modules: ["breath", "pitch"],
    criteria: [
      {
        id: "breath-cycle",
        label: "Complete full 4-7-8 breathing cycle",
        type: "breath_cycle",
        required: true,
      },
      {
        id: "resonant-phrase",
        label: "Resonant spoken phrase after breath",
        type: "breath_speak",
        required: true,
      },
    ],
  },

  "lesson-5": {
    id: "lesson-5",
    title: "The Filler Word Purge",
    durationSec: 45,
    needsCamera: false,
    needsMic: true,
    modules: ["fillers", "pace"],
    criteria: [
      {
        id: "zero-fillers",
        label: "0 filler words across 45 seconds",
        type: "zero_fillers",
        required: true,
      },
      {
        id: "duration-45",
        label: "Speak ~45 seconds",
        type: "duration",
        minSec: 35,
        maxSec: 70,
        required: true,
      },
    ],
  },

  "lesson-6": {
    id: "lesson-6",
    title: "The Slow-Mo Speech Drill",
    durationSec: 60,
    needsCamera: false,
    needsMic: true,
    modules: ["pace", "fillers"],
    criteria: [
      {
        id: "wpm-60-80",
        label: "WPM strictly between 60–80",
        type: "wpm_window",
        minWpm: 60,
        maxWpm: 80,
        required: true,
      },
      {
        id: "punct-pauses",
        label: "≥1.5s silence at punctuation pauses",
        type: "min_pauses",
        minCount: 2,
        minPauseSec: 1.5,
        required: true,
      },
    ],
  },

  "lesson-7": {
    id: "lesson-7",
    title: "Downward Inflection",
    durationSec: 40,
    needsCamera: false,
    needsMic: true,
    modules: ["pitch"],
    criteria: [
      {
        id: "three-downward",
        label: "Downward pitch slope on all 3 sentence endings",
        type: "downward_inflection_count",
        minCount: 3,
        required: true,
      },
    ],
  },

  "boss-2": {
    id: "boss-2",
    title: "Unit 2 Boss — Master Checkpoint",
    durationSec: 60,
    needsCamera: false,
    needsMic: true,
    modules: ["fillers", "pace", "pitch"],
    criteria: [
      {
        id: "zero-fillers",
        label: "Exactly 0 filler words",
        type: "zero_fillers",
        required: true,
      },
      {
        id: "two-pauses",
        label: "At least two 1.5s+ deliberate pauses",
        type: "min_pauses",
        minCount: 2,
        minPauseSec: 1.5,
        required: true,
      },
      {
        id: "downward-inflection",
        label: "Downward pitch slope on final sentence",
        type: "downward_inflection_final",
        required: true,
      },
      {
        id: "duration-ok",
        label: "About 60 seconds",
        type: "duration",
        minSec: 45,
        maxSec: 90,
        required: true,
      },
    ],
  },

  "lesson-8": {
    id: "lesson-8",
    title: "The 1-Beat Pause",
    durationSec: 90,
    needsCamera: false,
    needsMic: true,
    modules: ["latency", "pace"],
    prompts: [
      "What is one thing you are proud of this week?",
      "Describe a challenge you recently overcame.",
      "What advice would you give your younger self?",
    ],
    criteria: [
      {
        id: "three-beat-pauses",
        label: "Δt 1.0–2.0s after all 3 AI prompts",
        type: "response_latency",
        minSec: 1.0,
        maxSec: 2.0,
        requiredCount: 3,
        required: true,
      },
    ],
  },

  "lesson-9": {
    id: "lesson-9",
    title: "The Warmth Balance",
    durationSec: 15,
    needsCamera: true,
    needsMic: true,
    modules: ["smile", "pose", "gaze"],
    criteria: [
      {
        id: "smile-open-5s",
        label: "Genuine smile + open posture for ≥ 5 seconds",
        type: "smile_open_combo",
        minSec: 5,
        minSmile: 0.35,
        required: true,
      },
    ],
  },

  "lesson-10": {
    id: "lesson-10",
    title: "Comfort Zone Expansion",
    durationSec: 45,
    needsCamera: true,
    needsMic: true,
    modules: ["heckle", "gaze", "pace"],
    heckleLine: "Wait — that doesn't make any sense. Are you even sure?",
    heckleAtSec: 12,
    criteria: [
      {
        id: "gaze-hold",
        label: "Steady camera gaze through interruption",
        type: "heckle_gaze_stable",
        minOnCameraRatio: 0.75,
        required: true,
      },
      {
        id: "no-panic-wpm",
        label: "WPM stays under 160 during/after heckle",
        type: "heckle_wpm_cap",
        maxWpm: 160,
        required: true,
      },
    ],
  },

  "lesson-11": {
    id: "lesson-11",
    title: "The Reframe Engine",
    durationSec: 45,
    needsCamera: true,
    needsMic: true,
    modules: ["reframe", "pose", "pace", "pitch"],
    reframePhrase: "I am excited",
    criteria: [
      {
        id: "reframe-energy",
        label: "High-energy vocal reframe phrase",
        type: "reframe_energy",
        minRms: 0.04,
        required: true,
      },
      {
        id: "pitch-pace",
        label: "Steady pacing in the subsequent pitch",
        type: "wpm_window",
        minWpm: 100,
        maxWpm: 170,
        required: true,
      },
    ],
  },

  "lesson-12": {
    id: "lesson-12",
    title: "The Grand Synthesis",
    durationSec: 120,
    needsCamera: true,
    needsMic: true,
    modules: ["gaze", "pose", "fillers", "pace", "pitch"],
    criteria: [
      {
        id: "gaze-85",
        label: "Gaze on camera ≥ 85%",
        type: "gaze_on_camera",
        minRatio: 0.85,
        required: true,
      },
      {
        id: "zero-fillers",
        label: "0 filler words",
        type: "zero_fillers",
        required: true,
      },
      {
        id: "wpm-band",
        label: "Average WPM 110–170",
        type: "wpm_window",
        minWpm: 110,
        maxWpm: 170,
        required: true,
      },
      {
        id: "pauses",
        label: "At least three 1-beat pauses",
        type: "min_pauses",
        minCount: 3,
        minPauseSec: 0.7,
        required: true,
      },
      {
        id: "duration",
        label: "About 2 minutes",
        type: "duration",
        minSec: 90,
        maxSec: 150,
        required: true,
      },
    ],
  },

  "boss-3": {
    id: "boss-3",
    title: "Final Boss — Grand Synthesis",
    durationSec: 120,
    needsCamera: true,
    needsMic: true,
    modules: ["gaze", "pose", "fillers", "pace", "pitch"],
    criteria: [
      {
        id: "gaze-85",
        label: "Gaze on camera ≥ 85% of total time",
        type: "gaze_on_camera",
        minRatio: 0.85,
        required: true,
      },
      {
        id: "zero-fillers",
        label: "0 filler words detected",
        type: "zero_fillers",
        required: true,
      },
      {
        id: "wpm-120-150",
        label: "Average WPM within 120–150",
        type: "wpm_window",
        minWpm: 120,
        maxWpm: 150,
        required: true,
      },
      {
        id: "three-pauses",
        label: "At least three 1-beat pauses",
        type: "min_pauses",
        minCount: 3,
        minPauseSec: 0.7,
        required: true,
      },
      {
        id: "downward-close",
        label: "Downward inflection on closing sentence",
        type: "downward_inflection_final",
        required: true,
      },
      {
        id: "open-posture",
        label: "Open posture maintained",
        type: "pose_open_ratio",
        minRatio: 0.8,
        required: true,
      },
      {
        id: "duration-ok",
        label: "About 2 minutes",
        type: "duration",
        minSec: 90,
        maxSec: 150,
        required: true,
      },
    ],
  },
};

/**
 * @param {string} id lesson or boss id
 * @returns {LessonTestDef|null}
 */
export function getLessonTest(id) {
  return LESSON_TESTS[id] || null;
}
