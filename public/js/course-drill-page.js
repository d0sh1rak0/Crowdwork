import {
  completeBoss,
  completeLesson,
  fetchCurriculum,
  findBoss,
  findLesson,
  loadCourseProgress,
  peekActiveDrill,
} from "./course/courseStore.js";
import {
  countDeliberatePauses,
  evaluateBossChallenge,
} from "./course/BossEvaluator.js";
import SessionCoordinator from "./coordination/SessionCoordinator.js";
import WaveformVisualizer from "./components/WaveformVisualizer.js";
import pacingTelemetry from "./services/PacingTelemetry.js";
import vocalMetricsService from "./services/VocalMetricsService.js";
import NetworkClient from "./utilities/NetworkClient.js";
import { navigateSafely } from "./store.js";
import { formatTime } from "./utils.js";

const active = peekActiveDrill();
if (!active) {
  navigateSafely("/course", { replace: true });
}

const titleEl = document.getElementById("drill-title");
const focusEl = document.getElementById("drill-focus");
const promptEl = document.getElementById("drill-prompt");
const badgeEl = document.getElementById("drill-badge");
const hintEl = document.getElementById("drill-hint");
const wpmEl = document.getElementById("drill-wpm");
const wpmBandEl = document.getElementById("drill-wpm-band");
const fillersEl = document.getElementById("drill-fillers");
const pausesEl = document.getElementById("drill-pauses");
const timeEl = document.getElementById("drill-time");
const stateEl = document.getElementById("drill-state");
const transcriptEl = document.getElementById("drill-transcript");
const bossChecks = document.getElementById("boss-checks");
const hud = document.getElementById("drill-hud");
const resultModal = document.getElementById("drill-result");

let curriculum = null;
let lesson = null;
let boss = null;
let unit = null;
let telemetry = null;
let mediaStream = null;
let audioStream = null;
let coordinator = null;
let waveform = null;
let running = false;
let elapsed = 0;
let raf = 0;
let lastTick = null;
let transcriptParts = [];
let selfChecks = {};

function showHud(text, xp) {
  if (!hud) return;
  const el = document.createElement("div");
  el.className = "drill-hud-pop";
  el.textContent = xp != null ? `+${xp} XP: ${text}` : text;
  hud.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function setStatePill(label, tone = "steady") {
  if (!stateEl) return;
  stateEl.textContent = label;
  stateEl.dataset.tone = tone;
}

function renderBossCheckboxes() {
  if (!boss || !bossChecks) return;
  bossChecks.classList.remove("hidden");
  bossChecks.innerHTML = `<p class="font-utility boss-checks-label">Self-check pass criteria</p>`;
  (boss.passCriteria || [])
    .filter((c) => c.type === "self_check")
    .forEach((c) => {
      const id = `check-${c.id}`;
      const label = document.createElement("label");
      label.className = "boss-check";
      label.innerHTML = `<input type="checkbox" id="${id}" /> <span>${c.label}</span>`;
      bossChecks.appendChild(label);
      label.querySelector("input").addEventListener("change", (e) => {
        selfChecks[c.id] = e.target.checked;
      });
    });
}

async function boot() {
  curriculum = await fetchCurriculum();
  if (active.kind === "lesson") {
    const found = findLesson(curriculum, active.lessonId);
    if (!found) return navigateSafely("/course", { replace: true });
    lesson = found.lesson;
    unit = found.unit;
    telemetry = lesson.telemetry || {};
    badgeEl.textContent = `LESSON ${lesson.n} · +${lesson.xp} XP`;
    titleEl.textContent = lesson.title;
    focusEl.textContent = lesson.focus;
    promptEl.textContent = lesson.drill;
    hintEl.textContent =
      lesson.mode === "voice_drill"
        ? "Voice drill — speak aloud. Telemetry is calibrated for this lesson."
        : "Guided lesson — follow the drill, then Stop to claim XP.";
  } else {
    const found = findBoss(curriculum, active.bossId);
    if (!found) return navigateSafely("/course", { replace: true });
    boss = found.boss;
    unit = found.unit;
    telemetry = {
      trackFillers: true,
      fillerWords: ["um", "uh", "ah", "like", "you know", "so"],
      idealWpm: { min: 100, max: 175 },
      pauseRewardSec: 1.2,
      pauseRewardWindowSec: { min: 1.0, max: 3.5 },
      pauseRewardXp: 5,
      pauseRewardLabel: "Deliberate pause",
    };
    badgeEl.textContent = `BOSS · ${unit.title}`;
    badgeEl.classList.add("is-boss");
    titleEl.textContent = boss.title;
    focusEl.textContent = boss.label;
    promptEl.textContent = boss.challenge;
    hintEl.textContent = `Target ~${boss.durationSec}s · pass every criterion in one take.`;
    renderBossCheckboxes();
  }

  pacingTelemetry.configureDrill(telemetry);
  vocalMetricsService.configureDrill(telemetry);
}

async function ensureMic() {
  const secureOk = NetworkClient.checkHardwareSecurity();
  if (!secureOk || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone needs the https:// link.");
  }
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  audioStream = new MediaStream(mediaStream.getAudioTracks());
}

function updateMeters() {
  const pace = pacingTelemetry.getSnapshot();
  const vocal = vocalMetricsService.getSnapshot();
  if (wpmEl) wpmEl.textContent = String(pace.wpm || vocal.wpm || 0);
  if (wpmBandEl) {
    const band = pace.pacingBand || "—";
    wpmBandEl.textContent = band;
    if (telemetry?.idealWpm) {
      wpmBandEl.title = `Ideal ${telemetry.idealWpm.min}–${telemetry.idealWpm.max} WPM`;
    }
  }
  if (fillersEl) fillersEl.textContent = String(vocal.fillerTotal || 0);
  if (pausesEl) {
    pausesEl.textContent = String(pace.deliberatePauses?.length || 0);
  }
  if (timeEl) timeEl.textContent = formatTime(elapsed);
}

function startClock() {
  cancelAnimationFrame(raf);
  lastTick = null;
  const loop = (now) => {
    if (!running) return;
    if (lastTick == null) lastTick = now;
    elapsed += (now - lastTick) / 1000;
    lastTick = now;
    updateMeters();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stopClock() {
  running = false;
  cancelAnimationFrame(raf);
}

async function startDrill() {
  try {
    await ensureMic();
  } catch (err) {
    hintEl.textContent = err instanceof Error ? err.message : "Mic blocked.";
    return;
  }

  elapsed = 0;
  transcriptParts = [];
  transcriptEl.textContent = "Listening…";
  transcriptEl.classList.remove("has-text");
  document.getElementById("drill-start").disabled = true;
  document.getElementById("drill-stop").disabled = false;
  setStatePill("Live", "steady");

  pacingTelemetry.configureDrill(telemetry);
  vocalMetricsService.configureDrill(telemetry);
  vocalMetricsService.start({
    onFiller: (word, total) => {
      fillersEl.textContent = String(total);
      setStatePill(`Filler · ${word}`, "warn");
      showHud(`Filler: ${word}`);
    },
    onMetrics: () => updateMeters(),
  });

  const canvas = document.getElementById("drill-wave-canvas");
  waveform = new WaveformVisualizer(canvas);
  waveform.init(audioStream || mediaStream);
  void waveform.resume?.();

  running = true;
  startClock();

  coordinator = new SessionCoordinator();
  coordinator.start(audioStream || mediaStream, {
    shouldRun: () => running,
    getLanguage: () => "en",
    getWhisperPrompt: () =>
      String(promptEl?.textContent || "").slice(0, 400),
    getSlideIndex: () => 0,
    hasMicSignal: () => Boolean(waveform?.hasSignal?.()),
    onTranscript: (text) => {
      const clean = String(text || "").trim();
      if (!clean) return;
      transcriptParts.push(clean);
      if (transcriptParts.length > 14) transcriptParts.shift();
      transcriptEl.textContent = transcriptParts.join(" ");
      transcriptEl.classList.add("has-text");
      vocalMetricsService.ingestTranscript(clean, "en");
      updateMeters();
    },
    onClearSpeech: () => setStatePill("Clear", "steady"),
    onUnclearSpeech: () => setStatePill("Unclear", "warn"),
    onSeverePause: () => setStatePill("Pause", "warn"),
    onSpeechResume: () => setStatePill("Speaking", "steady"),
    onError: (err) => console.warn("[drill STT]", err),
    pacingHandlers: {
      onWpm: (wpm, band) => {
        if (wpmEl) wpmEl.textContent = String(wpm || 0);
        if (wpmBandEl) wpmBandEl.textContent = band || "—";
      },
      onSteadyPacing: ({ wpm }) => {
        setStatePill(`Steady · ${wpm}`, "steady");
      },
      onRushing: ({ wpm }) => {
        setStatePill(`Too fast · ${wpm}`, "danger");
        showHud("Slow down — rush detected");
      },
      onTooSlow: ({ wpm }) => {
        // In slow-mo drills, "slow" is the goal — don't punish
        if (telemetry?.profile === "slow-mo") {
          setStatePill(`Slow-mo · ${wpm}`, "steady");
          return;
        }
        setStatePill(`Too slow · ${wpm}`, "warn");
      },
      onPauseReward: (evt) => {
        showHud(evt.label || "Great Pause!", evt.xp);
        setStatePill(`Pause ${evt.pauseSec}s`, "steady");
        updateMeters();
      },
    },
  });
}

async function stopDrill() {
  stopClock();
  document.getElementById("drill-start").disabled = false;
  document.getElementById("drill-stop").disabled = true;
  setStatePill("Stopped", "steady");

  if (coordinator) {
    await coordinator.flushFinal();
    coordinator.stop();
    coordinator = null;
  }
  waveform?.stop();
  waveform = null;
  vocalMetricsService.stop();

  const pace = pacingTelemetry.getSnapshot();
  const vocal = vocalMetricsService.getSnapshot();
  const deliberate = pace.deliberatePauses || [];

  if (boss) {
    const minPause =
      (boss.passCriteria || []).find((c) => c.type === "min_pauses")
        ?.minPauseSec || 1.2;
    const evaluation = evaluateBossChallenge({
      criteria: boss.passCriteria || [],
      durationSec: elapsed,
      fillerTotal: vocal.fillerTotal || 0,
      deliberatePauses: countDeliberatePauses(deliberate, minPause),
      selfChecks,
    });
    showResult({
      title: evaluation.allPassed ? "Boss cleared!" : "Not yet — try again",
      body: evaluation.allPassed
        ? `You passed ${evaluation.passedCount}/${evaluation.totalCount} checks.`
        : `Passed ${evaluation.passedCount}/${evaluation.totalCount}. Fix the failing checks and re-record.`,
      criteria: evaluation.results,
      success: evaluation.allPassed,
      onSuccess: () => {
        const { gained } = completeBoss(curriculum, boss.id);
        if (gained) showHud("Unit badge unlocked", gained);
      },
    });
  } else if (lesson) {
    const zeroGoal = telemetry?.zeroFillerGoal;
    const fillerOk = !zeroGoal || (vocal.fillerTotal || 0) === 0;
    const wpm = pace.wpm || 0;
    let paceOk = true;
    if (telemetry?.idealWpm) {
      paceOk =
        wpm === 0 ||
        (wpm >= telemetry.idealWpm.min - 5 && wpm <= telemetry.idealWpm.max + 10);
    }
    const pauseNeed = telemetry?.pauseRewardSec ? 1 : 0;
    const pauseOk =
      pauseNeed === 0 || deliberate.length >= pauseNeed || elapsed < 20;
    const success =
      lesson.mode !== "voice_drill" || (fillerOk && (paceOk || elapsed < 15));

    const lines = [];
    if (telemetry?.trackFillers) {
      lines.push({
        label: "Fillers",
        passed: fillerOk,
        detail: `${vocal.fillerTotal || 0} detected`,
      });
    }
    if (telemetry?.idealWpm) {
      lines.push({
        label: `Pace ${telemetry.idealWpm.min}–${telemetry.idealWpm.max} WPM`,
        passed: paceOk,
        detail: `${wpm} wpm`,
      });
    }
    if (pauseNeed) {
      lines.push({
        label: "Deliberate pauses",
        passed: pauseOk || deliberate.length > 0,
        detail: `${deliberate.length} recorded`,
      });
    }
    lines.push({
      label: "Time on drill",
      passed: elapsed >= 8,
      detail: formatTime(elapsed),
    });

    showResult({
      title: success ? "Lesson complete" : "Keep practicing",
      body: success
        ? `Nice work on ${lesson.title}. Claim your XP and continue the unit.`
        : "Telemetry didn't fully clear the drill goals — try another take.",
      criteria: lines,
      success,
      onSuccess: () => {
        const { gained } = completeLesson(curriculum, lesson.id, {
          quest: true,
        });
        if (gained) showHud("Lesson XP", gained);
      },
    });
  }

  pacingTelemetry.clearDrill();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  audioStream = null;
}

function showResult({ title, body, criteria, success, onSuccess }) {
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-body").textContent = body;
  const box = document.getElementById("result-criteria");
  box.innerHTML = (criteria || [])
    .map(
      (c) => `
      <div class="result-row ${c.passed ? "pass" : "fail"}">
        <strong>${c.passed ? "✓" : "✗"} ${c.label}</strong>
        <span>${c.detail || ""}</span>
      </div>`
    )
    .join("");
  resultModal.classList.remove("hidden");
  if (success) onSuccess?.();
}

document.getElementById("drill-start")?.addEventListener("click", () => {
  void startDrill();
});
document.getElementById("drill-stop")?.addEventListener("click", () => {
  void stopDrill();
});
document.getElementById("drill-exit")?.addEventListener("click", async () => {
  stopClock();
  if (coordinator) {
    try {
      coordinator.stop();
    } catch {
      /* ignore */
    }
  }
  pacingTelemetry.clearDrill();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  navigateSafely("/course");
});
document.getElementById("result-again")?.addEventListener("click", () => {
  resultModal.classList.add("hidden");
  selfChecks = {};
  renderBossCheckboxes();
});

boot().catch((err) => {
  hintEl.textContent = err instanceof Error ? err.message : "Failed to load drill.";
});
