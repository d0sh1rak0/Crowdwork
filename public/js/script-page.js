import { fetchPaceAdvice, speakText, toastRetry } from "./api.js";
import RateLimitDashboard from "./components/RateLimitDashboard.js";
import { generateScriptWithRecovery } from "./services/GenerationRetryPipeline.js";
import {
  getPurposeString,
  getResolvedLanguage,
  getState,
  hasDeck,
  hasScript,
  navigateSafely,
  resetSlideToOriginal,
  setCurrentSlideIndex,
  setGenerating,
  setScriptSlides,
  setTone,
  slidesForApi,
  totalEstimatedSeconds,
  updateSlideFromRegen,
  updateSlideScript,
  updateSetup,
} from "./store.js";
import { setUploadBanner } from "./utilities/navigationBanner.js";
import {
  DEFAULT_PACE_TARGET_WPM,
  PACE_TARGET_MAX,
  PACE_TARGET_MIN,
  clampPaceTarget,
  derivePaceBands,
  localPaceRecommendation,
  localPaceVerdict,
  playbackRateForWpm,
} from "./services/paceConfig.js";
import { autoGrow, formatTime, toast } from "./utils.js";

const loading = document.getElementById("loading");
const empty = document.getElementById("empty");
const studio = document.getElementById("studio");
const rail = document.getElementById("rail");
const slideImg = document.getElementById("slide-img");
const scriptArea = document.getElementById("script-area");
const tip = document.getElementById("tip");
const headerMeta = document.getElementById("header-meta");
const deckTitle = document.getElementById("deck-title");
const timeEstimate = document.getElementById("time-estimate");
const toneBar = document.getElementById("tone-bar");
const toneChips = document.getElementById("tone-chips");
const regenRow = document.getElementById("regen-row");
const regenInput = document.getElementById("regen-input");
const mobileMeta = document.getElementById("mobile-meta");
const btnReset = document.getElementById("btn-reset");
const rateLimitRoot = document.getElementById("rate-limit-dash");
const rateLimitDash = rateLimitRoot
  ? new RateLimitDashboard(rateLimitRoot)
  : null;
const genErrorTitle = document.getElementById("gen-error-title");
const genErrorDetail = document.getElementById("gen-error-detail");
const genErrorRetry = document.getElementById("gen-error-retry");
const genErrorBack = document.getElementById("gen-error-back");

/** @type {null | (() => void)} */
let genErrorRetryFn = null;

const TONES = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

let audioEl = null;
/** @type {AbortController | null} */
let generationAbort = null;

function mapScripts(slides) {
  return slides.map((s) => ({
    n: s.n,
    script: s.script,
    seconds: s.seconds,
    tip: s.tip,
    originalScript: s.script,
    originalSeconds: s.seconds,
    originalTip: s.tip,
  }));
}

function abortGenerationPipeline() {
  if (generationAbort) {
    try {
      generationAbort.abort();
    } catch {
      /* ignore */
    }
    generationAbort = null;
  }
  rateLimitDash?.hide();
}

/** Escape hatch — cancel retries and return to upload canvas */
function escapeToUpload(bannerMessage) {
  abortGenerationPipeline();
  sessionStorage.removeItem("crowdwork-pending-generate");
  setGenerating(false);
  if (bannerMessage) {
    setUploadBanner({ message: bannerMessage, tone: "error" });
  }
  navigateSafely("/");
}

rateLimitDash?.onBack(() => escapeToUpload());

genErrorBack?.addEventListener("click", () => escapeToUpload());
genErrorRetry?.addEventListener("click", () => {
  const fn = genErrorRetryFn;
  if (fn) fn();
});

/**
 * Non-rate-limit failures: never enter the predictive bar loop.
 * - No script yet → return to upload with a clear context banner
 * - Mid-session regen → dedicated error panel on this page
 */
function routeHardGenerationFailure(err, { retryFn = null } = {}) {
  abortGenerationPipeline();
  rateLimitDash?.hide();
  setGenerating(false);
  sessionStorage.removeItem("crowdwork-pending-generate");

  const message =
    err instanceof Error
      ? err.message
      : "Something went wrong generating your script.";

  if (!hasScript()) {
    escapeToUpload(message);
    return;
  }

  showGenerationErrorPanel(message, retryFn);
}

function showGenerationErrorPanel(message, retryFn = null) {
  genErrorRetryFn = typeof retryFn === "function" ? retryFn : null;
  if (genErrorTitle) genErrorTitle.textContent = "Couldn’t finish that request";
  if (genErrorDetail) {
    genErrorDetail.textContent = message;
  }
  if (genErrorRetry) {
    genErrorRetry.hidden = !genErrorRetryFn;
  }
  showEmpty();
}

/**
 * Generate with silent 429 recovery + predictive dashboard.
 * Non-rate-limit failures still surface via the caller.
 */
async function runGenerateWithRecovery(payload) {
  abortGenerationPipeline();
  generationAbort = new AbortController();
  const { signal } = generationAbort;

  setGenerating(true);
  showLoading();

  try {
    const data = await generateScriptWithRecovery(payload, {
      signal,
      onEnterRecovery: ({ attempt, waitMs }) => {
        // Rate limits are not session failures — keep the generating shell
        setGenerating(true);
        showLoading();
        rateLimitDash?.show();
        rateLimitDash?.setProgress(0, {
          attempt,
          waitMs,
          remainingMs: waitMs,
        });
      },
      onWaitProgress: ({ attempt, waitMs, progress, remainingMs }) => {
        if (!rateLimitDash?.visible) rateLimitDash?.show();
        rateLimitDash?.setProgress(progress, {
          attempt,
          waitMs,
          remainingMs,
        });
      },
      onRetryFire: ({ attempt }) => {
        rateLimitDash?.setProgress(1, {
          attempt,
          remainingMs: 0,
          waitMs: 0,
        });
      },
    });
    rateLimitDash?.hide();
    return data;
  } catch (err) {
    if (err?.name !== "AbortError") {
      rateLimitDash?.hide();
    }
    throw err;
  } finally {
    if (generationAbort && generationAbort.signal.aborted) {
      generationAbort = null;
    } else {
      generationAbort = null;
    }
  }
}

async function runPendingGenerate() {
  const raw = sessionStorage.getItem("crowdwork-pending-generate");
  // Orphaned flag from a refresh mid-request — don't spin forever
  if (!raw) {
    if (getState().isGenerating && !hasScript()) setGenerating(false);
    return false;
  }

  try {
    const payload = JSON.parse(raw);
    const data = await runGenerateWithRecovery(payload);
    // Only clear pending after a successful write
    sessionStorage.removeItem("crowdwork-pending-generate");
    setScriptSlides(mapScripts(data.slides));
    return true;
  } catch (err) {
    if (err?.name === "AbortError") {
      setGenerating(false);
      return false;
    }
    // Hard faults / network / 500 → upload banner (not rate-limit dashboard)
    routeHardGenerationFailure(err, {
      retryFn: () => {
        runPendingGenerate().then(() => render());
      },
    });
    return false;
  }
}

function showLoading() {
  empty.classList.add("hidden");
  loading.classList.remove("hidden");
  studio.classList.add("hidden");
  headerMeta.classList.add("hidden");
}

function showEmpty() {
  if (rateLimitDash?.visible) return;
  loading.classList.add("hidden");
  empty.classList.remove("hidden");
  studio.classList.add("hidden");
  headerMeta.classList.add("hidden");
}

function showStudio() {
  rateLimitDash?.hide();
  loading.classList.add("hidden");
  empty.classList.add("hidden");
  studio.classList.remove("hidden");
  headerMeta.classList.remove("hidden");
}

function render() {
  const state = getState();
  if (!hasDeck() && !state.isGenerating) {
    navigateSafely("/", { replace: true });
    return;
  }
  if (state.isGenerating && !hasScript()) {
    showLoading();
    return;
  }
  if (!hasScript()) {
    showEmpty();
    return;
  }

  showStudio();
  const current = state.scriptSlides[state.currentSlideIndex];
  const deckSlide = state.slides.find((s) => s.n === current.n);
  deckTitle.textContent = state.deckTitle;
  timeEstimate.textContent = `≈ ${formatTime(totalEstimatedSeconds())} / ${formatTime(state.setup.targetMinutes * 60)}`;

  rail.innerHTML = "";
  state.scriptSlides.forEach((s, i) => {
    const thumb = state.slides.find((d) => d.n === s.n);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rail-item${i === state.currentSlideIndex ? " active" : ""}`;
    btn.innerHTML = `
      <img src="${thumb?.imageDisplay || ""}" alt="" />
      <div class="rail-meta">
        <div>${s.n}</div>
        <div class="muted">${s.seconds}s</div>
      </div>`;
    btn.addEventListener("click", () => {
      setCurrentSlideIndex(i);
      render();
    });
    rail.appendChild(btn);
  });

  slideImg.src = deckSlide?.imageDisplay || "";
  slideImg.alt = `Slide ${current.n}`;
  scriptArea.value = current.script;
  tip.textContent = current.tip || "";
  mobileMeta.textContent = `Slide ${current.n} · ${current.seconds}s`;
  btnReset.disabled =
    current.script === current.originalScript && current.tip === current.originalTip;
  autoGrow(scriptArea);

  document.getElementById("prev-slide").disabled = state.currentSlideIndex === 0;
  document.getElementById("next-slide").disabled =
    state.currentSlideIndex >= state.scriptSlides.length - 1;
}

scriptArea.addEventListener("input", () => {
  const state = getState();
  const current = state.scriptSlides[state.currentSlideIndex];
  if (!current) return;
  updateSlideScript(current.n, scriptArea.value);
  autoGrow(scriptArea);
  timeEstimate.textContent = `≈ ${formatTime(totalEstimatedSeconds())} / ${formatTime(state.setup.targetMinutes * 60)}`;
  btnReset.disabled = false;
});

document.getElementById("prev-slide").addEventListener("click", () => {
  const state = getState();
  if (state.currentSlideIndex > 0) {
    setCurrentSlideIndex(state.currentSlideIndex - 1);
    render();
  }
});
document.getElementById("next-slide").addEventListener("click", () => {
  const state = getState();
  if (state.currentSlideIndex < state.scriptSlides.length - 1) {
    setCurrentSlideIndex(state.currentSlideIndex + 1);
    render();
  }
});

document.getElementById("btn-regen").addEventListener("click", () => {
  regenRow.classList.toggle("open");
});

document.getElementById("regen-apply").addEventListener("click", async () => {
  const instruction = regenInput.value.trim();
  if (!instruction) return;
  const state = getState();
  const current = state.scriptSlides[state.currentSlideIndex];
  const applyBtn = document.getElementById("regen-apply");
  applyBtn.disabled = true;
  applyBtn.textContent = "Rewriting…";
  try {
    const neighbors = state.scriptSlides
      .filter((s) => Math.abs(s.n - current.n) === 1)
      .map((s) => ({ n: s.n, script: s.script }));
    const data = await runGenerateWithRecovery({
      deckTitle: state.deckTitle,
      purpose: getPurposeString(),
      audience: state.setup.audience || undefined,
      notes: state.setup.notes || undefined,
      tone: state.setup.tone,
      targetMinutes: state.setup.targetMinutes,
      language: getResolvedLanguage(),
      slides: slidesForApi().filter((s) => s.n === current.n),
      regenerate: { n: current.n, instruction },
      neighborContext: neighbors,
    });
    const updated = data.slides.find((s) => s.n === current.n) || data.slides[0];
    updateSlideFromRegen(current.n, updated);
    setGenerating(false);
    regenRow.classList.remove("open");
    regenInput.value = "";
    toast(`Slide ${current.n} rewritten.`);
    render();
  } catch (err) {
    if (err?.name === "AbortError") return;
    routeHardGenerationFailure(err, {
      retryFn: () => document.getElementById("regen-apply").click(),
    });
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = "Apply";
  }
});

regenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("regen-apply").click();
});

btnReset.addEventListener("click", () => {
  const state = getState();
  const current = state.scriptSlides[state.currentSlideIndex];
  resetSlideToOriginal(current.n);
  render();
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  const text = getState()
    .scriptSlides.map((s) => `— Slide ${s.n} (${s.seconds}s) —\n${s.script}`)
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Full script copied.");
  } catch {
    toast("Clipboard blocked. Select the text and copy manually.");
  }
});

const paceTuner = document.getElementById("pace-tuner");
const paceSlider = document.getElementById("pace-slider");
const paceWpmLabel = document.getElementById("pace-wpm-label");
const paceBandRange = document.getElementById("pace-band-range");
const paceAiRec = document.getElementById("pace-ai-rec");
const paceVerdict = document.getElementById("pace-verdict");
const pacePreviewBtn = document.getElementById("pace-preview");
const paceStartBtn = document.getElementById("pace-start");
const paceCancelBtn = document.getElementById("pace-cancel");

let paceRecommendedWpm = DEFAULT_PACE_TARGET_WPM;
let pacePreviewAudio = null;
let paceVerdictTimer = null;
let paceAdviceSeq = 0;

function previewSnippetFromScript() {
  const state = getState();
  const current = state.scriptSlides[state.currentSlideIndex];
  const words = String(current?.script || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 28);
  if (words.length >= 6) return words.join(" ");
  return state.resolvedLanguage === "ru"
    ? "Сегодня я расскажу, почему это важно для вашей аудитории прямо сейчас."
    : "Today I'll show why this matters for your audience — and what to do next.";
}

function syncPaceSliderUi(wpm) {
  const target = clampPaceTarget(wpm);
  const bands = derivePaceBands(target);
  paceSlider.min = String(PACE_TARGET_MIN);
  paceSlider.max = String(PACE_TARGET_MAX);
  paceSlider.value = String(target);
  paceWpmLabel.textContent = `${target} wpm`;
  paceBandRange.textContent = `${bands.healthyMin}–${bands.healthyMax}`;
  return bands;
}

function setPaceVerdict(verdict, message) {
  paceVerdict.dataset.verdict = verdict || "similar";
  paceVerdict.textContent = message || "";
}

async function refreshPaceVerdict(chosenWpm) {
  const seq = ++paceAdviceSeq;
  const local = localPaceVerdict(chosenWpm, paceRecommendedWpm);
  setPaceVerdict(local.verdict, local.message);
  try {
    const data = await fetchPaceAdvice({
      mode: "evaluate",
      chosenWpm,
      recommendedWpm: paceRecommendedWpm,
      purpose: getPurposeString(),
      audience: getState().setup.audience || undefined,
      tone: getState().setup.tone,
      targetMinutes: getState().setup.targetMinutes,
      language: getResolvedLanguage(),
    });
    if (seq !== paceAdviceSeq) return;
    setPaceVerdict(data.verdict, data.message);
  } catch {
    /* keep local verdict */
  }
}

function stopPacePreview() {
  if (pacePreviewAudio) {
    try {
      pacePreviewAudio.pause();
    } catch {
      /* ignore */
    }
    pacePreviewAudio = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

async function playPacePreview(wpm) {
  const text = previewSnippetFromScript();
  const rate = playbackRateForWpm(wpm);
  const language = getResolvedLanguage();
  stopPacePreview();
  pacePreviewBtn.disabled = true;
  pacePreviewBtn.textContent = "Playing…";
  try {
    try {
      const blob = await speakText(text, language, { speed: rate });
      const url = URL.createObjectURL(blob);
      pacePreviewAudio = new Audio(url);
      // Double-apply rate so preview still shifts if TTS ignored speed
      pacePreviewAudio.playbackRate = Math.min(1.35, Math.max(0.85, rate));
      await pacePreviewAudio.play();
      pacePreviewAudio.onended = () => {
        URL.revokeObjectURL(url);
        pacePreviewAudio = null;
      };
    } catch {
      await new Promise((resolve, reject) => {
        if (!window.speechSynthesis) {
          reject(new Error("Speech synthesis unavailable."));
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = language === "ru" ? "ru-RU" : "en-US";
        u.rate = rate;
        u.onend = () => resolve();
        u.onerror = () => reject(new Error("Browser voice failed."));
        window.speechSynthesis.speak(u);
      });
    }
  } finally {
    pacePreviewBtn.disabled = false;
    pacePreviewBtn.textContent = "Hear this pace";
  }
}

async function openPaceTuner() {
  const state = getState();
  const fallback = localPaceRecommendation({
    tone: state.setup.tone,
    purpose: getPurposeString(),
    language: getResolvedLanguage(),
    targetMinutes: state.setup.targetMinutes,
  });
  paceRecommendedWpm = fallback.recommendedWpm;
  // Resume last confirmed target, otherwise land on the local AI fallback
  const initial = clampPaceTarget(
    state.setup.paceConfirmed
      ? state.setup.paceTargetWpm
      : paceRecommendedWpm
  );
  syncPaceSliderUi(initial);
  paceAiRec.innerHTML =
    "Asking AI for a steady pace that fits this pitch…";
  setPaceVerdict(
    "similar",
    "Move the slider to hear the pace and get a coaching note."
  );
  paceTuner.hidden = false;

  try {
    const data = await fetchPaceAdvice({
      mode: "recommend",
      purpose: getPurposeString(),
      audience: state.setup.audience || undefined,
      tone: state.setup.tone,
      targetMinutes: state.setup.targetMinutes,
      language: getResolvedLanguage(),
      deckTitle: state.deckTitle,
      scriptSample: previewSnippetFromScript(),
    });
    paceRecommendedWpm = clampPaceTarget(data.recommendedWpm);
    updateSetup({ paceRecommendedWpm });
    paceAiRec.innerHTML = `AI recommends <strong>${paceRecommendedWpm} wpm</strong>. ${
      data.rationale || fallback.rationale
    }`;
    if (!state.setup.paceConfirmed) {
      syncPaceSliderUi(paceRecommendedWpm);
    }
    void refreshPaceVerdict(Number(paceSlider.value));
    void playPacePreview(Number(paceSlider.value));
  } catch {
    paceRecommendedWpm = fallback.recommendedWpm;
    updateSetup({ paceRecommendedWpm });
    paceAiRec.innerHTML = `AI recommends <strong>${paceRecommendedWpm} wpm</strong>. ${fallback.rationale}`;
    if (!state.setup.paceConfirmed) syncPaceSliderUi(paceRecommendedWpm);
    const v = localPaceVerdict(Number(paceSlider.value), paceRecommendedWpm);
    setPaceVerdict(v.verdict, v.message);
    void playPacePreview(Number(paceSlider.value));
  }
}

function closePaceTuner() {
  stopPacePreview();
  paceTuner.hidden = true;
  if (paceVerdictTimer) {
    clearTimeout(paceVerdictTimer);
    paceVerdictTimer = null;
  }
}

document.getElementById("btn-rehearse").addEventListener("click", () => {
  if (!hasScript()) return;
  openPaceTuner();
});

paceCancelBtn?.addEventListener("click", () => closePaceTuner());

paceStartBtn?.addEventListener("click", () => {
  const target = clampPaceTarget(Number(paceSlider.value));
  updateSetup({
    paceTargetWpm: target,
    paceRecommendedWpm,
    paceConfirmed: true,
  });
  closePaceTuner();
  navigateSafely("/rehearse");
});

paceSlider?.addEventListener("input", () => {
  const wpm = Number(paceSlider.value);
  syncPaceSliderUi(wpm);
  if (paceVerdictTimer) clearTimeout(paceVerdictTimer);
  paceVerdictTimer = setTimeout(() => {
    void refreshPaceVerdict(wpm);
    void playPacePreview(wpm);
  }, 320);
});

pacePreviewBtn?.addEventListener("click", () => {
  void playPacePreview(Number(paceSlider.value));
});

paceTuner?.addEventListener("click", (e) => {
  if (e.target === paceTuner) closePaceTuner();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && paceTuner && !paceTuner.hidden) closePaceTuner();
});

document.getElementById("btn-regen-all").addEventListener("click", () => {
  toneBar.classList.toggle("open");
  toneChips.innerHTML = "";
  const state = getState();
  TONES.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.setup.tone === t.id ? " active" : ""}`;
    btn.textContent = t.label;
    btn.addEventListener("click", () => regenerateAll(t.id));
    toneChips.appendChild(btn);
  });
});
document.getElementById("tone-cancel").addEventListener("click", () => {
  toneBar.classList.remove("open");
});

async function regenerateAll(tone) {
  setTone(tone);
  updateSetup({ tone });
  try {
    const state = getState();
    const data = await runGenerateWithRecovery({
      deckTitle: state.deckTitle,
      purpose: getPurposeString(),
      audience: state.setup.audience || undefined,
      notes: state.setup.notes || undefined,
      tone,
      targetMinutes: state.setup.targetMinutes,
      language: getResolvedLanguage(),
      slides: slidesForApi(),
    });
    setScriptSlides(mapScripts(data.slides));
    toneBar.classList.remove("open");
    toast("Full script rewritten.");
    render();
  } catch (err) {
    if (err?.name === "AbortError") return;
    routeHardGenerationFailure(err, {
      retryFn: () => regenerateAll(tone),
    });
    if (hasScript()) render();
  }
}

function speakBrowser(text, language) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error("Speech synthesis unavailable."));
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = language === "ru" ? "ru-RU" : "en-US";
    u.onend = () => resolve();
    u.onerror = () => reject(new Error("Browser voice failed."));
    window.speechSynthesis.speak(u);
  });
}

document.getElementById("btn-speak").addEventListener("click", async () => {
  const state = getState();
  const current = state.scriptSlides[state.currentSlideIndex];
  const btn = document.getElementById("btn-speak");
  btn.disabled = true;
  btn.textContent = "Loading voice…";
  try {
    if (audioEl) {
      audioEl.pause();
      audioEl = null;
    }
    try {
      const blob = await speakText(current.script, state.resolvedLanguage);
      const url = URL.createObjectURL(blob);
      audioEl = new Audio(url);
      await audioEl.play();
      audioEl.onended = () => URL.revokeObjectURL(url);
      toast("Playing slide voice.");
    } catch {
      await speakBrowser(current.script, state.resolvedLanguage);
      toast("Playing with browser voice (OpenAI TTS unavailable).");
    }
  } catch (err) {
    toastRetry(err instanceof Error ? err.message : "Voice playback failed.", () =>
      document.getElementById("btn-speak").click()
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Play voice";
  }
});

(async function init() {
  if (!hasDeck() && !sessionStorage.getItem("crowdwork-pending-generate")) {
    navigateSafely("/", { replace: true });
    return;
  }

  // Clear stuck "Writing…" if a previous tab closed mid-flight
  if (
    getState().isGenerating &&
    !sessionStorage.getItem("crowdwork-pending-generate") &&
    !hasScript()
  ) {
    setGenerating(false);
  }

  if (sessionStorage.getItem("crowdwork-pending-generate")) {
    showLoading();
    await runPendingGenerate();
  }
  render();
})();
