import {
  fetchFeedback,
  fetchObjections,
  requestHeckle,
  toastRetry,
  transcribeAudio,
} from "./api.js";
import { createAudienceEngine } from "./audience.js";
import WaveformVisualizer from "./components/WaveformVisualizer.js";
import sessionTimerService from "./services/SessionTimerService.js";
import vocalMetricsService from "./services/VocalMetricsService.js";
import {
  getPurposeString,
  getState,
  hasScript,
  resetAll,
  setFeedback,
  setObjections,
  setRehearsalReport,
} from "./store.js";
import { detectFillers, fillerTotal, formatTime, wordCount } from "./utils.js";

const stageRoot = document.getElementById("stage-root");
const countdownView = document.getElementById("countdown-view");
const runView = document.getElementById("run-view");
const reportRoot = document.getElementById("report-root");
const countdownText = document.getElementById("countdown-text");
const dim = document.getElementById("dim");
const micNote = document.getElementById("mic-note");
const micBanner = document.getElementById("mic-banner");
const timerTotal = document.getElementById("timer-total");
const stageImg = document.getElementById("stage-img");
const stageScript = document.getElementById("stage-script");
const budgetFill = document.getElementById("budget-fill");
const budgetLabel = document.getElementById("budget-label");
const controls = document.getElementById("controls");
const camVideo = document.getElementById("cam-video");
const camFallback = document.getElementById("cam-fallback");

let phase = "boot";
let index = 0;
let paused = false;
let elapsed = 0;
let slideElapsed = 0;
let micDenied = false;
let camDenied = false;
let countdown = 3;
let hideTimer = null;
let raf = 0;
let lastTick = null;

const slideTimes = [];
const transcripts = [];
let speakingMs = 0;
let finalWords = 0;

let mediaStream = null;
let audioStream = null;
let mediaRecorder = null;
let chunks = [];
let recordTimer = null;
let waveform = null;
let audience = null;
let attentionSnapshot = null;
let heckleAudio = null;
let heckleInFlight = false;
let hesitationApplied = false;
let pauseDriftTimer = null;

function state() {
  return getState();
}

function showControls() {
  controls.classList.remove("hidden");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.add("hidden"), 2000);
}

function initAudience() {
  audience = createAudienceEngine({
    attentionFill: document.getElementById("attention-fill"),
    attentionValue: document.getElementById("attention-value"),
    attentionLabel: document.getElementById("attention-label"),
    audienceRow: document.getElementById("audience-row"),
    reactionHost: document.getElementById("reaction-host"),
    houseEl: document.getElementById("house"),
    memberCount: 12,
  });
}

/* Filler hits are handled by VocalMetricsService → audience.onFillerHit */

async function boot() {
  const s = state();
  if (!hasScript() || !s.slides.length) {
    window.location.replace("/");
    return;
  }

  if (s.rehearsalReport) {
    showReport(s.rehearsalReport);
    return;
  }

  initAudience();

  try {
    await document.documentElement.requestFullscreen();
  } catch {
    /* optional */
  }

  // Request mic + webcam
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      micDenied = mediaStream.getAudioTracks().length === 0;
      camDenied = mediaStream.getVideoTracks().length === 0;
    } catch {
      // Try audio-only fallback
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micDenied = false;
        camDenied = true;
      } catch {
        mediaStream = null;
        micDenied = true;
        camDenied = true;
      }
    }
  } else {
    micDenied = true;
    camDenied = true;
  }

  if (mediaStream && !camDenied) {
    camVideo.srcObject = mediaStream;
    camFallback.classList.add("hidden");
    try {
      await camVideo.play();
    } catch {
      /* autoplay quirks */
    }
  } else {
    camFallback.classList.remove("hidden");
  }

  if (mediaStream && !micDenied) {
    audioStream = new MediaStream(mediaStream.getAudioTracks());
  }

  for (let i = 0; i < s.scriptSlides.length; i++) {
    slideTimes[i] = 0;
    transcripts[i] = "";
  }

  if (micDenied || camDenied) {
    micNote.classList.remove("hidden");
    const parts = [];
    if (micDenied) parts.push("mic");
    if (camDenied) parts.push("camera");
    micNote.textContent = `Pitching without ${parts.join(" / ")} — timers still run`;
  }

  phase = "countdown";
  countdown = 3;
  tickCountdown();
}

function tickCountdown() {
  if (phase !== "countdown") return;
  dim.style.background = `rgba(16,17,19,${0.35 + (3 - countdown) * 0.12})`;
  if (countdown > 0) {
    countdownText.textContent = `You're on in ${countdown}`;
    setTimeout(() => {
      countdown -= 1;
      tickCountdown();
    }, 1000);
    return;
  }
  startRun();
}

function startRun() {
  phase = "running";
  countdownView.classList.add("hidden");
  runView.classList.remove("hidden");
  runView.classList.add("visible");
  if (micDenied || camDenied) micBanner.classList.remove("hidden");
  showControls();
  renderSlide();
  startTimers();
  audience?.start();
  startSilenceSentinel();
  startVocalMetrics();
  renderScriptStack();

  if (!micDenied) {
    startRecording();
    const waveCanvas = document.getElementById("wave-canvas");
    if (waveCanvas) {
      waveform = new WaveformVisualizer(waveCanvas);
      waveform.init(audioStream || mediaStream);
      void waveform.resume?.();
    }
  } else {
    const wrap = document.querySelector(".wave-panel");
    if (wrap) wrap.classList.add("wave-offline");
  }
}

function startVocalMetrics() {
  vocalMetricsService.start({
    onPauseStart: (pauseMs) => {
      if (phase !== "running" || paused) return;
      audience?.onTextPause(pauseMs);
    },
    onPauseTick: (pauseMs) => {
      if (phase !== "running" || paused) return;
      // Continuous drift only after the 1.5s precision threshold
      audience?.onTextPause(pauseMs);
    },
    onPauseEnd: () => {
      if (phase !== "running") return;
      audience?.onSpeechResume();
      hesitationApplied = false;
    },
    onFiller: (word, total) => {
      if (phase !== "running" || paused) return;
      flashFillerWarning(word, total);
      audience?.onFillerHit(word);
    },
    onRushed: ({ wpm }) => {
      if (phase !== "running" || paused) return;
      audience?.onRushed(wpm);
      setMetricState("Rushed", "danger");
    },
    onMonotone: () => {
      if (phase !== "running" || paused) return;
      audience?.onMonotone();
      setMetricState("Monotone", "warn");
    },
    onMetrics: (m) => {
      updateMetricHud(m);
    },
  });
}

function flashFillerWarning(word, total) {
  const el = document.getElementById("filler-flash");
  if (!el) return;
  el.textContent = `Parasite · ${word}`;
  el.classList.add("show");
  const fillersEl = document.getElementById("metric-fillers");
  if (fillersEl) fillersEl.textContent = `Fillers ${total}`;
  clearTimeout(flashFillerWarning._t);
  flashFillerWarning._t = setTimeout(() => el.classList.remove("show"), 900);
}

function setMetricState(label, tone) {
  const el = document.getElementById("metric-state");
  if (!el) return;
  el.textContent = label;
  el.dataset.tone = tone || "steady";
}

function updateMetricHud(m) {
  const wpmEl = document.getElementById("metric-wpm");
  if (wpmEl) wpmEl.textContent = `${m.wpm || 0} wpm`;
  const fillersEl = document.getElementById("metric-fillers");
  if (fillersEl) fillersEl.textContent = `Fillers ${m.fillerTotal || 0}`;
  if (m.state === "RUSHED") setMetricState("Rushed", "danger");
  else if (m.state === "MONOTONE") setMetricState("Monotone", "warn");
  else if (m.state === "PAUSING" || (m.pauseMs || 0) >= 1500)
    setMetricState("Pause", "warn");
  else setMetricState("Steady", "steady");
}

/** Silence Sentinel — independent of MediaRecorder chunk delivery */
function startSilenceSentinel() {
  hesitationApplied = false;
  sessionTimerService.startTracking(
    (seconds) => {
      if (phase !== "running" || paused) return;
      void fireHeckleStrike(seconds);
    },
    (seconds, flags) => {
      if (phase !== "running" || paused) return;
      if (flags.hesitation && !hesitationApplied) {
        hesitationApplied = true;
        audience?.onHesitationWarning();
      }
    }
  );
}

async function fireHeckleStrike(silenceSeconds) {
  if (heckleInFlight || phase !== "running") return;
  heckleInFlight = true;
  const s = state();
  const current = s.scriptSlides[index];
  try {
    const live = vocalMetricsService.getSnapshot();
    const payload = await requestHeckle({
      silenceSeconds,
      language: s.resolvedLanguage,
      slideScript: current?.script || "",
      transcript: transcripts[index] || "",
      deckTitle: s.deckTitle,
      fillerTotal: live.fillerTotal || 0,
      deliveryState: live.state || "STEADY",
      wpm: live.wpm || 0,
    });

    audience?.applyCrowdState(payload.CROWD_STATE || "RESTLESS", {
      heckleLine: payload.heckleLine,
      stageDirection: payload.stageDirection,
    });

    // Aggressive mid-sentence investor interruption via TTS
    if (payload.audioBase64) {
      try {
        if (heckleAudio) {
          heckleAudio.pause();
          heckleAudio = null;
        }
        const bytes = Uint8Array.from(atob(payload.audioBase64), (c) =>
          c.charCodeAt(0)
        );
        const url = URL.createObjectURL(
          new Blob([bytes], { type: "audio/mpeg" })
        );
        heckleAudio = new Audio(url);
        heckleAudio.volume = 0.9;
        await heckleAudio.play();
        heckleAudio.onended = () => URL.revokeObjectURL(url);
      } catch (err) {
        console.warn("heckle audio", err);
      }
    } else if (payload.heckleLine && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(payload.heckleLine);
      u.lang = s.resolvedLanguage === "ru" ? "ru-RU" : "en-US";
      u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  } catch (err) {
    console.warn("heckle strike", err);
    audience?.applyCrowdState("RESTLESS", {
      stageDirection: "crowd sighs and checks watches",
    });
  } finally {
    heckleInFlight = false;
  }
}

function renderScriptStack() {
  const stack = document.getElementById("script-stack");
  if (!stack) return;
  const s = state();
  stack.innerHTML = "";
  s.scriptSlides.forEach((slide, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `script-card${i === index ? " active" : ""}${
      i < index ? " done" : ""
    }`;
    card.dataset.n = String(slide.n);
    card.innerHTML = `
      <span class="script-card-n font-utility">Slide ${slide.n}</span>
      <span class="script-card-body">${escapeHtml(slide.script)}</span>
      <span class="script-card-meta font-utility">${slide.seconds}s</span>`;
    card.addEventListener("click", () => {
      // Allow jumping only to current/previous for review feel
      if (i <= index) {
        index = i;
        slideElapsed = slideTimes[i] || 0;
        renderSlide();
      }
    });
    stack.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startTimers() {
  cancelAnimationFrame(raf);
  lastTick = null;
  const loop = (now) => {
    if (phase !== "running") return;
    if (!paused) {
      if (lastTick == null) lastTick = now;
      const delta = (now - lastTick) / 1000;
      lastTick = now;
      elapsed += delta;
      slideElapsed += delta;
      updateTimers();
    } else {
      lastTick = null;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function updateTimers() {
  const s = state();
  const target = s.setup.targetMinutes * 60;
  const current = s.scriptSlides[index];
  timerTotal.textContent = `${formatTime(elapsed)} / ${formatTime(target)}${
    paused ? "  Paused" : ""
  }`;
  const ratio = current.seconds > 0 ? slideElapsed / current.seconds : 0;
  budgetFill.style.width = `${Math.min(100, ratio * 100)}%`;
  budgetFill.classList.toggle("warn", ratio >= 0.9 && ratio <= 1);
  budgetFill.classList.toggle("over", ratio > 1);
  budgetLabel.textContent = `Slide ${current.n} · ${formatTime(slideElapsed)} / ${formatTime(current.seconds)}`;
}

function renderSlide() {
  const s = state();
  const current = s.scriptSlides[index];
  const deck = s.slides.find((d) => d.n === current.n);
  stageImg.src = deck?.imageDisplay || "";
  stageScript.textContent = current.script;
  document.getElementById("btn-prev").disabled = index === 0;
  document.getElementById("btn-next").textContent =
    index >= s.scriptSlides.length - 1 ? "Finish pitch" : "Next →";
  updateTimers();
  renderScriptStack();
}

function startRecording() {
  const stream = audioStream || mediaStream;
  if (!stream) return;
  chunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
  } catch {
    micDenied = true;
    micBanner.classList.remove("hidden");
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  mediaRecorder.start(1000);
  // Faster STT cadence so 1.5s text-pause detection stays accurate
  recordTimer = setInterval(() => flushTranscript(false), 2000);
}

async function flushTranscript(finalFlush) {
  if (!mediaRecorder || micDenied || paused) return;
  if (mediaRecorder.state === "recording") {
    mediaRecorder.requestData();
  }
  await new Promise((r) => setTimeout(r, 120));
  if (!chunks.length) return;

  const blob = new Blob(chunks, { type: "audio/webm" });
  chunks = [];
  if (blob.size < 1200 && !finalFlush) return;

  const slideIndex = index;
  try {
    const { text } = await transcribeAudio(blob, state().resolvedLanguage);
    if (!text?.trim()) return;

    // Exact moment valid speech returns — reset Silence Sentinel + text pause clock
    sessionTimerService.resetSilenceCounter();
    hesitationApplied = false;

    const prev = transcripts[slideIndex] || "";
    transcripts[slideIndex] = (prev + " " + text).trim();
    const words = wordCount(text);
    finalWords += words;
    speakingMs += Math.min(8000, Math.max(400, words * 350));

    // Text-driven metrics (fillers / WPM / monotone) — not waveform volume
    const metrics = vocalMetricsService.ingestTranscript(
      text,
      state().resolvedLanguage
    );
    if (words >= 6 && metrics?.state === "STEADY") {
      audience?.onGoodStretch();
    }
  } catch (err) {
    console.warn("transcribe", err);
  }
}

async function stopRecording() {
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
  waveform?.stop();
  waveform = null;
  audience?.stop();
  sessionTimerService.stopTracking();
  vocalMetricsService.stop();
  if (pauseDriftTimer) {
    clearInterval(pauseDriftTimer);
    pauseDriftTimer = null;
  }
  if (heckleAudio) {
    try {
      heckleAudio.pause();
    } catch {
      /* ignore */
    }
    heckleAudio = null;
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      try {
        mediaRecorder.stop();
      } catch {
        resolve();
      }
    });
    await flushTranscript(true);
  }
  mediaRecorder = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  audioStream = null;
  camVideo.srcObject = null;
}

async function goNext() {
  const s = state();
  await flushTranscript(true);
  slideTimes[index] = slideElapsed;
  if (index >= s.scriptSlides.length - 1) {
    finishRun();
    return;
  }
  index += 1;
  slideElapsed = 0;
  renderSlide();
}

async function goPrev() {
  if (index <= 0) return;
  await flushTranscript(true);
  slideTimes[index] = slideElapsed;
  index -= 1;
  slideElapsed = slideTimes[index] || 0;
  renderSlide();
}

async function finishRun() {
  phase = "report";
  cancelAnimationFrame(raf);
  attentionSnapshot = audience?.getSnapshot() || null;
  await stopRecording();
  slideTimes[index] = slideElapsed;

  const s = state();
  const slides = s.scriptSlides.map((slide, i) => ({
    n: slide.n,
    actualSeconds: Math.round(slideTimes[i] || 0),
    transcript: transcripts[i] || "",
  }));

  const fillerCounts = {};
  slides.forEach((r) => {
    const c = detectFillers(r.transcript, s.resolvedLanguage);
    Object.entries(c).forEach(([k, v]) => {
      fillerCounts[k] = (fillerCounts[k] || 0) + v;
    });
  });

  const speakingSeconds = Math.max(1, Math.round(speakingMs / 1000));
  const live = vocalMetricsService.getSnapshot();
  const mergedFillers = { ...fillerCounts };
  Object.entries(live.fillerCounts || {}).forEach(([k, v]) => {
    mergedFillers[k] = Math.max(mergedFillers[k] || 0, v);
  });
  const report = {
    totalSeconds: Math.round(elapsed),
    targetSeconds: s.setup.targetMinutes * 60,
    wpm:
      live.wpm ||
      (finalWords > 0 ? Math.round((finalWords / speakingSeconds) * 60) : 0),
    fillerCounts: mergedFillers,
    fillerTotal: fillerTotal(mergedFillers),
    slidesOverBudget: slides.filter(
      (r, i) => r.actualSeconds > s.scriptSlides[i].seconds
    ).length,
    slides,
    speakingSeconds,
    finalWordCount: finalWords,
    attention: attentionSnapshot,
    deliveryState: live.state,
  };

  setRehearsalReport(report);
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }
  showReport(report);
}

function verdictLine(total, target) {
  const diff = total - target;
  if (Math.abs(diff) <= target * 0.1) {
    return { text: `${formatTime(total)} / ${formatTime(target)} — on time`, over: false };
  }
  if (diff > 0) {
    return {
      text: `${formatTime(total)} / ${formatTime(target)} — ${formatTime(diff)} over`,
      over: true,
    };
  }
  return {
    text: `${formatTime(total)} / ${formatTime(target)} — ${formatTime(-diff)} under`,
    over: false,
  };
}

function showReport(report) {
  stageRoot.classList.add("hidden");
  reportRoot.classList.remove("hidden");

  const s = state();
  const verdict = verdictLine(report.totalSeconds, report.targetSeconds);
  const verdictEl = document.getElementById("verdict");
  verdictEl.textContent = verdict.text;
  verdictEl.classList.toggle("over", verdict.over);

  const att = report.attention;
  document.getElementById("stat-attention").textContent = att
    ? `${att.averageAttention}`
    : "—";
  document.getElementById("stat-pauses").textContent = String(att?.pauses || 0);
  const laughsEl = document.getElementById("stat-laughs");
  if (laughsEl) laughsEl.textContent = String(att?.laughs || 0);

  const maxBar = Math.max(
    ...report.slides.map((r, i) =>
      Math.max(r.actualSeconds, s.scriptSlides[i]?.seconds || 0)
    ),
    1
  );

  const bars = document.getElementById("timing-bars");
  bars.innerHTML = "";
  report.slides.forEach((r, i) => {
    const target = s.scriptSlides[i]?.seconds || 0;
    const over = r.actualSeconds > target;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bar-btn";
    btn.innerHTML = `
      <span class="font-utility" style="width:2rem;font-size:0.75rem;color:var(--muted)">${r.n}</span>
      <div class="bar-track">
        <div class="bar-alloc" style="width:${(target / maxBar) * 100}%"></div>
        <div class="bar-actual ${over ? "over" : ""}" style="width:${(r.actualSeconds / maxBar) * 100}%"></div>
      </div>
      <span class="font-utility" style="width:6rem;text-align:right;font-size:0.75rem;color:var(--muted)">
        ${formatTime(r.actualSeconds)} / ${formatTime(target)}
      </span>`;
    btn.addEventListener("click", () => showSlideDetail(r.n));
    bars.appendChild(btn);
  });

  document.getElementById("stat-wpm").textContent = report.wpm || "—";
  document.getElementById("stat-over").textContent = String(report.slidesOverBudget);
  const fillers = document.getElementById("stat-fillers");
  fillers.innerHTML = `<p class="label" style="margin-bottom:0.35rem">Fillers · ${report.fillerTotal}</p>`;
  if (!Object.keys(report.fillerCounts).length) {
    fillers.innerHTML += `<span style="font-size:0.875rem">None detected</span>`;
  } else {
    Object.entries(report.fillerCounts).forEach(([word, count]) => {
      fillers.innerHTML += `<span class="filler-chip">${word} ×${count}</span>`;
    });
  }

  loadCoach(report);
  loadObjections(report);
}

function showSlideDetail(n) {
  const s = state();
  const report = s.rehearsalReport;
  const result = report.slides.find((x) => x.n === n);
  const script = s.scriptSlides.find((x) => x.n === n);
  const deck = s.slides.find((x) => x.n === n);
  const el = document.getElementById("slide-detail");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div style="display:grid;gap:1rem;">
      ${deck ? `<img src="${deck.imageDisplay}" alt="" style="width:100%;border-radius:4px" />` : ""}
      <div>
        <p style="color:var(--muted);font-size:0.875rem;margin:0 0 0.35rem">Script</p>
        <p style="margin:0 0 1rem">${script?.script || ""}</p>
        <p style="color:var(--muted);font-size:0.875rem;margin:0 0 0.35rem">Transcript</p>
        <p style="margin:0">${result?.transcript || "(no speech captured)"}</p>
      </div>
    </div>`;
}

async function loadCoach(report) {
  const body = document.getElementById("coach-body");
  const existing = state().feedback;
  if (existing) {
    renderCoach(existing);
    return;
  }
  body.innerHTML = `
    <div class="skeleton" style="height:20px;width:75%;margin-bottom:0.75rem"></div>
    <div class="skeleton" style="height:16px;width:100%;margin-bottom:0.5rem"></div>
    <div class="skeleton" style="height:16px;width:85%"></div>`;

  const s = state();
  const att = report.attention;
  try {
    const data = await fetchFeedback({
      targetMinutes: s.setup.targetMinutes,
      language: s.resolvedLanguage,
      slides: report.slides.map((r, i) => ({
        n: r.n,
        script: s.scriptSlides[i]?.script || "",
        transcript: r.transcript,
        actualSeconds: r.actualSeconds,
        targetSeconds: s.scriptSlides[i]?.seconds || 0,
      })),
      attention: att || undefined,
      wpm: report.wpm,
      vocalMetrics: {
        wpm: report.wpm,
        fillerTotal: report.fillerTotal,
        fillerCounts: report.fillerCounts,
        deliveryState: report.deliveryState || "STEADY",
      },
    });
    setFeedback(data);
    renderCoach(data);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--muted);font-size:0.875rem">Coach notes unavailable.</p>`;
    toastRetry(err instanceof Error ? err.message : "Feedback failed.", () => {
      setFeedback(null);
      loadCoach(report);
    });
  }
}

function renderCoach(feedback) {
  document.getElementById("coach-body").innerHTML = `
    <p style="margin:0 0 1rem">${feedback.summary}</p>
    <p style="color:var(--muted);font-size:0.875rem;margin:0 0 0.5rem">Strengths</p>
    <ul>${feedback.strengths.map((x) => `<li>${x}</li>`).join("")}</ul>
    <p style="color:var(--muted);font-size:0.875rem;margin:1rem 0 0.5rem">Improvements</p>
    <ul>${feedback.improvements.map((x) => `<li>${x}</li>`).join("")}</ul>`;
}

async function loadObjections(report) {
  const body = document.getElementById("objections-body");
  const existing = state().objections;
  if (existing?.questions?.length) {
    renderObjections(existing.questions);
    return;
  }
  const s = state();
  try {
    const data = await fetchObjections({
      purpose: getPurposeString(),
      audience: s.setup.audience,
      language: s.resolvedLanguage,
      slides: report.slides.map((r, i) => ({
        n: r.n,
        script: s.scriptSlides[i]?.script || "",
        transcript: r.transcript,
      })),
    });
    setObjections(data);
    renderObjections(data.questions || []);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--muted);font-size:0.875rem">Questions unavailable.</p>`;
    toastRetry(err instanceof Error ? err.message : "Objections failed.", () => {
      setObjections(null);
      loadObjections(report);
    });
  }
}

function renderObjections(questions) {
  const body = document.getElementById("objections-body");
  if (!questions.length) {
    body.innerHTML = `<p style="color:var(--muted);font-size:0.875rem">No questions returned.</p>`;
    return;
  }
  body.innerHTML = questions
    .map(
      (q) => `
      <div class="objection-item">
        <strong>${q.question}</strong>
        <p>${q.whyItMatters || ""}${
          q.slideHint ? ` · Slide ${q.slideHint}` : ""
        }</p>
      </div>`
    )
    .join("");
}

function restartRun() {
  stopRecording().finally(() => {
    setRehearsalReport(null);
    setFeedback(null);
    setObjections(null);
    window.location.reload();
  });
}

document.getElementById("btn-prev").addEventListener("click", () => {
  showControls();
  goPrev();
});
document.getElementById("btn-next").addEventListener("click", () => {
  showControls();
  goNext();
});
document.getElementById("btn-pause").addEventListener("click", () => {
  paused = !paused;
  document.getElementById("btn-pause").textContent = paused ? "Resume" : "Pause";
  showControls();
});
document.getElementById("btn-restart").addEventListener("click", restartRun);
document.getElementById("btn-exit").addEventListener("click", async () => {
  await stopRecording();
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }
  window.location.href = "/script";
});

document.getElementById("btn-again").addEventListener("click", () => {
  setRehearsalReport(null);
  setFeedback(null);
  setObjections(null);
  window.location.href = "/rehearse";
});
document.getElementById("btn-back-script").addEventListener("click", () => {
  window.location.href = "/script";
});
document.getElementById("btn-new").addEventListener("click", () => {
  resetAll();
  window.location.href = "/";
});

window.addEventListener("mousemove", () => {
  if (phase === "running") showControls();
});

window.addEventListener("keydown", (e) => {
  if (phase !== "running") return;
  if (e.key === "Escape") {
    e.preventDefault();
    document.getElementById("btn-exit").click();
  } else if (e.key === " " || e.key === "ArrowRight") {
    e.preventDefault();
    goNext();
    showControls();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    goPrev();
    showControls();
  } else if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    document.getElementById("btn-pause").click();
  } else if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    restartRun();
  }
});

boot();
