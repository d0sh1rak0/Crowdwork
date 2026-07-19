import { generateScript, speakText, toastRetry } from "./api.js";
import {
  getPurposeString,
  getResolvedLanguage,
  getState,
  hasDeck,
  hasScript,
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

const TONES = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

let audioEl = null;

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

async function runPendingGenerate() {
  const raw = sessionStorage.getItem("crowdwork-pending-generate");
  // Orphaned flag from a refresh mid-request — don't spin forever
  if (!raw) {
    if (getState().isGenerating && !hasScript()) setGenerating(false);
    return false;
  }

  setGenerating(true);
  showLoading();
  try {
    const payload = JSON.parse(raw);
    const data = await generateScript(payload);
    // Only clear pending after a successful write
    sessionStorage.removeItem("crowdwork-pending-generate");
    setScriptSlides(mapScripts(data.slides));
    return true;
  } catch (err) {
    setGenerating(false);
    toastRetry(err instanceof Error ? err.message : "Script generation failed.", () => {
      runPendingGenerate().then(() => render());
    });
    return false;
  }
}

function showLoading() {
  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  studio.classList.add("hidden");
  headerMeta.classList.add("hidden");
}

function showEmpty() {
  loading.classList.add("hidden");
  empty.classList.remove("hidden");
  studio.classList.add("hidden");
}

function showStudio() {
  loading.classList.add("hidden");
  empty.classList.add("hidden");
  studio.classList.remove("hidden");
  headerMeta.classList.remove("hidden");
}

function render() {
  const state = getState();
  if (!hasDeck() && !state.isGenerating) {
    window.location.replace("/");
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
    const data = await generateScript({
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
    regenRow.classList.remove("open");
    regenInput.value = "";
    toast(`Slide ${current.n} rewritten.`);
    render();
  } catch (err) {
    toastRetry(err instanceof Error ? err.message : "Regeneration failed.", () =>
      document.getElementById("regen-apply").click()
    );
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

document.getElementById("btn-rehearse").addEventListener("click", () => {
  if (!hasScript()) return;
  window.location.href = "/rehearse";
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
  setGenerating(true);
  showLoading();
  try {
    const state = getState();
    const data = await generateScript({
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
    setGenerating(false);
    toastRetry(err instanceof Error ? err.message : "Regeneration failed.", () =>
      regenerateAll(tone)
    );
    render();
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
    window.location.replace("/");
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
