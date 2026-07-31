import {
  completeBoss,
  completeLesson,
  fetchCurriculum,
  findBoss,
  findLesson,
  peekActiveDrill,
} from "./course/courseStore.js";
import LessonTestEngine from "./course/LessonTestEngine.js";
import { getLessonTest } from "./course/lessonTestRegistry.js";
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
const testBriefEl = document.getElementById("drill-test-brief");
const wpmEl = document.getElementById("drill-wpm");
const wpmBandEl = document.getElementById("drill-wpm-band");
const fillersEl = document.getElementById("drill-fillers");
const pausesEl = document.getElementById("drill-pauses");
const timeEl = document.getElementById("drill-time");
const stateEl = document.getElementById("drill-state");
const transcriptEl = document.getElementById("drill-transcript");
const bossChecks = document.getElementById("boss-checks");
const visionPanel = document.getElementById("drill-vision-panel");
const camEl = document.getElementById("drill-cam");
const visionStatusEl = document.getElementById("drill-vision-status");
const liveCriteriaEl = document.getElementById("drill-live-criteria");
const hud = document.getElementById("drill-hud");
const resultModal = document.getElementById("drill-result");

let curriculum = null;
let lesson = null;
let boss = null;
let unit = null;
let telemetry = null;
let testDef = null;
let testId = null;
let mediaStream = null;
let audioStream = null;
let coordinator = null;
let waveform = null;
let testEngine = new LessonTestEngine();
let running = false;
let elapsed = 0;
let raf = 0;
let lastTick = null;
let transcriptParts = [];
let lastSpeechAt = 0;
let autoStopArmed = false;

function showHud(text, xp) {
  if (!hud) return;
  const el = document.createElement("div");
  el.className = "drill-hud-pop";
  if (String(text).includes("FILLER") || String(text).includes("Break Detected")) {
    el.classList.add("is-alert");
  }
  el.textContent = xp != null ? `+${xp} XP: ${text}` : text;
  hud.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function setStatePill(label, tone = "steady") {
  if (!stateEl) return;
  stateEl.textContent = label;
  stateEl.dataset.tone = tone;
}

function renderLiveCriteria() {
  if (!liveCriteriaEl || !testDef) return;
  liveCriteriaEl.innerHTML = (testDef.criteria || [])
    .map(
      (c) =>
        `<div class="live-crit" data-id="${c.id}"><span>${c.label}</span><em>—</em></div>`
    )
    .join("");
}

function paintLiveCriteria(evaluation) {
  if (!liveCriteriaEl || !evaluation?.results) return;
  for (const r of evaluation.results) {
    const row = liveCriteriaEl.querySelector(`[data-id="${r.id}"]`);
    if (!row) continue;
    row.classList.toggle("pass", r.passed);
    row.classList.toggle("fail", !r.passed && running);
    const em = row.querySelector("em");
    if (em) em.textContent = r.detail || (r.passed ? "OK" : "…");
  }
}

function renderBossCheckboxes() {
  // Automated tests replace self-check UI; keep container for legacy notes
  if (!bossChecks) return;
  if (!testDef) {
    bossChecks.classList.add("hidden");
    return;
  }
  bossChecks.classList.remove("hidden");
  bossChecks.innerHTML = `
    <p class="font-utility boss-checks-label">Automated pass criteria</p>
    <ul class="boss-auto-list">
      ${(testDef.criteria || [])
        .map((c) => `<li>${c.label}</li>`)
        .join("")}
    </ul>`;
}

function briefForTest(def) {
  if (!def) return "";
  const mods = (def.modules || []).join(", ");
  return `Auto-test · ${def.durationSec}s · modules: ${mods}`;
}

async function boot() {
  curriculum = await fetchCurriculum();
  if (active.kind === "lesson") {
    const found = findLesson(curriculum, active.lessonId);
    if (!found) return navigateSafely("/course", { replace: true });
    lesson = found.lesson;
    unit = found.unit;
    telemetry = lesson.telemetry || {};
    testId = lesson.id;
    badgeEl.textContent = `LESSON ${lesson.n} · +${lesson.xp} XP`;
    titleEl.textContent = lesson.title;
    focusEl.textContent = lesson.focus;
    promptEl.textContent = lesson.drill;
  } else {
    const found = findBoss(curriculum, active.bossId);
    if (!found) return navigateSafely("/course", { replace: true });
    boss = found.boss;
    unit = found.unit;
    testId = boss.id;
    telemetry = {
      trackFillers: true,
      fillerWords: ["um", "uh", "ah", "like", "you know", "so"],
      idealWpm: { min: 100, max: 175 },
      pauseRewardSec: 1.2,
      pauseRewardWindowSec: { min: 1.0, max: 3.5 },
      pauseRewardXp: 5,
      pauseRewardLabel: "Deliberate pause",
    };
    // Align boss telemetry with test registry when present
    const reg = getLessonTest(boss.id);
    if (reg?.criteria?.some((c) => c.type === "wpm_window")) {
      const w = reg.criteria.find((c) => c.type === "wpm_window");
      telemetry.idealWpm = { min: w.minWpm, max: w.maxWpm };
    }
    badgeEl.textContent = `BOSS · ${unit.title}`;
    badgeEl.classList.add("is-boss");
    titleEl.textContent = boss.title;
    focusEl.textContent = boss.label;
    promptEl.textContent = boss.challenge;
  }

  testDef = testEngine.resolve(testId);
  if (testDef) {
    // Merge registry duration into hint
    if (testBriefEl) {
      testBriefEl.textContent = briefForTest(testDef);
      testBriefEl.classList.remove("hidden");
    }
    if (testDef.needsCamera) {
      visionPanel?.classList.remove("hidden");
    }
    renderLiveCriteria();
    renderBossCheckboxes();
    hintEl.textContent = testDef.needsCamera
      ? "Camera + mic auto-test armed. Face the lens, then Start."
      : "Mic auto-test armed. Tap Start when ready.";
  } else {
    hintEl.textContent =
      lesson?.mode === "voice_drill"
        ? "Voice drill — speak aloud. Telemetry is calibrated for this lesson."
        : "Guided lesson — follow the drill, then Stop to claim XP.";
  }

  // Lesson-specific telemetry overrides from registry profiles already in curriculum
  if (testId === "lesson-5") {
    telemetry = {
      ...telemetry,
      trackFillers: true,
      zeroFillerGoal: true,
      fillerWords: ["um", "uh", "ah", "like", "you know", "so", "basically", "right"],
    };
  }
  if (testId === "lesson-6") {
    telemetry = {
      ...telemetry,
      profile: "slow-mo",
      idealWpm: { min: 60, max: 80 },
      targetWpm: 70,
      pauseRewardSec: 2,
      pauseRewardWindowSec: { min: 1.5, max: 3.2 },
      pauseRewardXp: 10,
    };
  }
  if (testId === "lesson-8") {
    telemetry = {
      ...telemetry,
      profile: "one-beat-pause",
      pauseRewardSec: 1,
      pauseRewardWindowSec: { min: 1.0, max: 2.0 },
      pauseRewardXp: 10,
      pauseRewardLabel: "Great Pause!",
    };
  }

  pacingTelemetry.configureDrill(telemetry);
  vocalMetricsService.configureDrill(telemetry);
}

async function ensureMedia() {
  const secureOk = NetworkClient.checkHardwareSecurity();
  if (!secureOk || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera/mic need the https:// link.");
  }
  const needCam = Boolean(testDef?.needsCamera);
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: needCam
      ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
      : false,
  });
  audioStream = new MediaStream(mediaStream.getAudioTracks());
  if (needCam && camEl) {
    camEl.srcObject = mediaStream;
    await camEl.play().catch(() => {});
  }
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
  if (visionStatusEl && testEngine) {
    visionStatusEl.textContent = testEngine.getLiveStatus();
  }
}

function startClock() {
  cancelAnimationFrame(raf);
  lastTick = null;
  const loop = (now) => {
    if (!running) return;
    if (lastTick == null) lastTick = now;
    elapsed += (now - lastTick) / 1000;
    lastTick = now;
    const pace = pacingTelemetry.getSnapshot();
    testEngine.tick(elapsed, { wpm: pace.wpm || 0 });
    updateMeters();

    // Soft live preview of criteria every ~1s
    if (Math.floor(elapsed * 2) !== Math.floor((elapsed - 0.016) * 2)) {
      const vocal = vocalMetricsService.getSnapshot();
      const preview = testEngine.evaluate({
        fillerTotal: vocal.fillerTotal || 0,
        deliberatePauses: pace.deliberatePauses || [],
        wpm: pace.wpm || 0,
      });
      paintLiveCriteria(preview);
    }

    // Auto-stop when target duration reached (+ small grace)
    const target = testDef?.durationSec;
    if (target && !autoStopArmed && elapsed >= target + 0.4) {
      autoStopArmed = true;
      showHud("Time target reached — evaluating…");
      void stopDrill();
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function stopClock() {
  running = false;
  cancelAnimationFrame(raf);
}

async function startDrill() {
  stopping = false;
  try {
    await ensureMedia();
  } catch (err) {
    hintEl.textContent = err instanceof Error ? err.message : "Media blocked.";
    return;
  }

  elapsed = 0;
  autoStopArmed = false;
  transcriptParts = [];
  lastSpeechAt = Date.now();
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
      showHud("FILLER DETECTED");
      showHud(`Filler: ${word}`);
    },
    onMetrics: () => updateMeters(),
  });

  if (testDef) {
    try {
      const meta = await testEngine.start({
        videoEl: camEl,
        mediaStream,
        audioStream,
        getWpm: () => pacingTelemetry.getSnapshot().wpm || 0,
        isSttSilent: () => Date.now() - lastSpeechAt > 700,
        onAlert: (evt) => {
          showHud(evt.message || evt.type);
          if (evt.type === "downward_break" || evt.type === "rushed_response") {
            setStatePill(evt.message, "danger");
          } else {
            setStatePill(evt.message || "Alert", "warn");
          }
        },
        onHud: ({ text, xp }) => showHud(text, xp),
        onPhase: (p) => {
          hintEl.textContent = p.message || "";
          setStatePill(p.phase || "Phase", "steady");
        },
        onPrompt: ({ index, total, text }) => {
          promptEl.textContent = `AI Prompt ${index}/${total}: ${text}`;
        },
      });
      if (visionStatusEl) {
        visionStatusEl.textContent = meta.visionReady
          ? testEngine.getLiveStatus()
          : "Vision offline — audio criteria still active";
      }
    } catch (err) {
      console.warn("[LessonTestEngine]", err);
      hintEl.textContent =
        err instanceof Error ? err.message : "Test engine failed to start.";
    }
  }

  const canvas = document.getElementById("drill-wave-canvas");
  waveform = new WaveformVisualizer(canvas);
  waveform.init(audioStream || mediaStream);
  void waveform.resume?.();

  running = true;
  startClock();

  const useStt =
    !testDef ||
    testDef.modules?.some((m) =>
      ["fillers", "pace", "latency", "heckle", "reframe", "gaze"].includes(m)
    );

  if (useStt) {
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
        lastSpeechAt = Date.now();
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
}

let stopping = false;

async function stopDrill() {
  if (stopping) return;
  stopping = true;
  stopClock();
  document.getElementById("drill-start").disabled = false;
  document.getElementById("drill-stop").disabled = true;
  setStatePill("Evaluating…", "steady");

  if (coordinator) {
    try {
      await coordinator.flushFinal();
      coordinator.stop();
    } catch {
      /* ignore */
    }
    coordinator = null;
  }
  waveform?.stop();
  waveform = null;
  vocalMetricsService.stop();

  const pace = pacingTelemetry.getSnapshot();
  const vocal = vocalMetricsService.getSnapshot();
  const deliberate = pace.deliberatePauses || [];

  let evaluation = null;
  if (testDef) {
    evaluation = testEngine.evaluate({
      fillerTotal: vocal.fillerTotal || 0,
      deliberatePauses: deliberate,
      wpm: pace.wpm || 0,
    });
    await testEngine.stop();
  }

  const success = evaluation
    ? evaluation.allPassed
    : elapsed >= 8;

  const lines = evaluation
    ? evaluation.results
    : [
        {
          label: "Time on drill",
          passed: elapsed >= 8,
          detail: formatTime(elapsed),
        },
      ];

  paintLiveCriteria(evaluation || { results: lines });

  showResult({
    title: success
      ? boss
        ? "Boss cleared!"
        : "Lesson complete"
      : boss
        ? "Not yet — try again"
        : "Keep practicing",
    body: success
      ? evaluation
        ? `Passed ${evaluation.passedCount}/${evaluation.totalCount} automated checks.`
        : `Nice work on ${lesson?.title || "this drill"}.`
      : evaluation
        ? `Passed ${evaluation.passedCount}/${evaluation.totalCount}. Fix failing checks and re-record.`
        : "Telemetry didn't fully clear the drill goals — try another take.",
    criteria: lines,
    success,
    onSuccess: () => {
      if (boss) {
        const { gained } = completeBoss(curriculum, boss.id);
        if (gained) showHud("Unit badge unlocked", gained);
      } else if (lesson) {
        const { gained } = completeLesson(curriculum, lesson.id, {
          quest: true,
        });
        if (gained) showHud("Lesson XP", gained);
      }
    },
  });

  pacingTelemetry.clearDrill();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  audioStream = null;
  if (camEl) camEl.srcObject = null;
  setStatePill("Stopped", "steady");
  stopping = false;
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
  await testEngine.stop();
  pacingTelemetry.clearDrill();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  navigateSafely("/course");
});
document.getElementById("result-again")?.addEventListener("click", () => {
  resultModal.classList.add("hidden");
  renderBossCheckboxes();
  renderLiveCriteria();
});

boot().catch((err) => {
  hintEl.textContent =
    err instanceof Error ? err.message : "Failed to load drill.";
});
