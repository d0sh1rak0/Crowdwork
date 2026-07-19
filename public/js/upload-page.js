import { toastRetry } from "./api.js";
import { processPdf, validatePdfFile } from "./pdf.js";
import ScriptParserService, {
  parseScriptToSlides,
  slidesFromParsedScript,
} from "./services/ScriptParserService.js";
import {
  getPurposeString,
  getResolvedLanguage,
  getState,
  navigateSafely,
  setDeck,
  setGenerating,
  setScriptSlides,
  updateSetup,
} from "./store.js";
import { consumeUploadBanner } from "./utilities/navigationBanner.js";
import { estimateSeconds } from "./utils.js";

const zone = document.getElementById("upload-zone");
const input = document.getElementById("file-input");
const errorEl = document.getElementById("upload-error");
const contextBanner = document.getElementById("context-banner");
const uploadIdle = zone?.querySelector("[data-upload-idle]");
const uploadSuccess = zone?.querySelector("[data-upload-success]");
const thumbSection = document.getElementById("thumb-section");
const thumbs = document.getElementById("thumbs");
const progress = document.getElementById("progress");
const form = document.getElementById("setup-form");
const purpose = document.getElementById("purpose");
const purposeOther = document.getElementById("purpose-other");
const language = document.getElementById("language");
const audience = document.getElementById("audience");
const notes = document.getElementById("notes");
const writeBtn = document.getElementById("write-btn");
const durationsEl = document.getElementById("durations");
const tonesEl = document.getElementById("tones");
const scriptPaste = document.getElementById("script-paste");
const parseBtn = document.getElementById("parse-script-btn");
const parseMeta = document.getElementById("parse-meta");
const parsedStack = document.getElementById("parsed-stack");

const DURATIONS = [3, 5, 7, 10, 15, 20];
const TONES = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

let setup = { ...getState().setup };
/** @type {null | 'pdf' | 'script'} */
let materialMode = getState().slides?.some((s) => s.fromScript)
  ? "script"
  : getState().slides?.length
    ? "pdf"
    : null;

function showError(msg) {
  if (!msg) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
}

function setUploadSuccessState(success) {
  if (!zone) return;
  zone.classList.toggle("is-success", success);
  if (uploadIdle) uploadIdle.hidden = success;
  if (uploadSuccess) uploadSuccess.hidden = !success;
  zone.setAttribute(
    "aria-label",
    success ? "Successful upload" : "Upload PDF deck"
  );
}

function showContextBanner(message, tone = "error") {
  if (!contextBanner || !message) return;
  contextBanner.textContent = message;
  contextBanner.dataset.tone = tone;
  contextBanner.hidden = false;
  contextBanner.classList.remove("hidden");
}

function hydrateContextBanner() {
  const banner = consumeUploadBanner();
  if (banner) showContextBanner(banner.message, banner.tone);
}

function renderChips() {
  durationsEl.innerHTML = "";
  DURATIONS.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${setup.targetMinutes === m ? " active" : ""}`;
    btn.textContent = `${m} min`;
    btn.addEventListener("click", () => {
      setup.targetMinutes = m;
      updateSetup({ targetMinutes: m });
      renderChips();
    });
    durationsEl.appendChild(btn);
  });

  tonesEl.innerHTML = "";
  TONES.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${setup.tone === t.id ? " active" : ""}`;
    btn.textContent = t.label;
    btn.addEventListener("click", () => {
      setup.tone = t.id;
      updateSetup({ tone: t.id });
      renderChips();
    });
    tonesEl.appendChild(btn);
  });
}

purpose.addEventListener("change", () => {
  setup.purpose = purpose.value;
  updateSetup({ purpose: purpose.value });
  purposeOther.classList.toggle("hidden", purpose.value !== "Other");
});
purposeOther.addEventListener("input", () => {
  setup.purposeOther = purposeOther.value;
  updateSetup({ purposeOther: purposeOther.value });
});
language.addEventListener("change", () => {
  setup.language = language.value;
  updateSetup({ language: language.value });
});
audience.addEventListener("input", () => updateSetup({ audience: audience.value }));
notes.addEventListener("input", () => updateSetup({ notes: notes.value }));

async function handleFile(file) {
  if (!file) return;
  showError(null);
  const validation = validatePdfFile(file);
  if (validation) {
    setUploadSuccessState(false);
    showError(validation);
    return;
  }

  // Immediate success confirmation before PDF parsing / any later transition
  setUploadSuccessState(true);

  thumbs.innerHTML = "";
  thumbSection.classList.remove("hidden");
  form.classList.remove("visible");
  progress.textContent = "Reading slide 0…";
  zone.style.pointerEvents = "none";

  try {
    const { slides, title } = await processPdf(file, ({ current, total, slide }) => {
      progress.textContent = `Reading slide ${current} of ${total}`;
      const el = document.createElement("div");
      el.className = "thumb";
      el.innerHTML = `<img src="${slide.imageDisplay}" alt="Slide ${slide.n}" /><span>${slide.n}</span>`;
      thumbs.appendChild(el);
    });
    setDeck({ title, slides });
    materialMode = "pdf";
    writeBtn.textContent = "Write my script";
    parsedStack.classList.add("hidden");
    progress.textContent = `${slides.length} slides ready`;
    form.classList.add("visible");
    setUploadSuccessState(true);
  } catch (err) {
    setUploadSuccessState(false);
    showError(err instanceof Error ? err.message : "Could not read this PDF.");
    thumbSection.classList.add("hidden");
  } finally {
    zone.style.pointerEvents = "";
  }
}

zone.addEventListener("click", () => input.click());
zone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    input.click();
  }
});
input.addEventListener("change", () => {
  handleFile(input.files?.[0]);
  input.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  zone.addEventListener(ev, (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  zone.addEventListener(ev, (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
  })
);
zone.addEventListener("drop", (e) => {
  handleFile(e.dataTransfer?.files?.[0]);
});

function renderParsedCards(parsed) {
  parsedStack.innerHTML = "";
  if (!parsed.length) {
    parsedStack.classList.add("hidden");
    parseMeta.textContent = "";
    return;
  }
  parsedStack.classList.remove("hidden");
  parseMeta.textContent = `${parsed.length} slides · ${parsed.reduce((a, b) => a + b.wordCount, 0)} words`;
  parsed.forEach((block) => {
    const card = document.createElement("article");
    card.className = "parsed-card";
    card.innerHTML = `
      <header>
        <span class="font-utility">${block.title}</span>
        <span class="font-utility muted">${block.wordCount} words</span>
      </header>
      <p>${block.text.replace(/</g, "&lt;")}</p>`;
    parsedStack.appendChild(card);
  });
}

function applyParsedScript() {
  const raw = scriptPaste.value;
  const parsed = parseScriptToSlides(raw);
  if (!parsed.length) {
    showError("Paste a script first — or add --- between slides.");
    return null;
  }
  showError(null);
  const slides = slidesFromParsedScript(parsed, "Pasted script");
  setDeck({ title: "Pasted script", slides });
  materialMode = "script";

  // Seed script studio with the pasted words (spoken as-is)
  const lang = getResolvedLanguage();
  setScriptSlides(
    parsed.map((b) => {
      const seconds = estimateSeconds(b.text, lang) || 30;
      return {
        n: b.n,
        script: b.text,
        seconds,
        tip: "Keep it conversational — look up between beats.",
        originalScript: b.text,
        originalSeconds: seconds,
        originalTip: "Keep it conversational — look up between beats.",
      };
    })
  );

  renderParsedCards(parsed);
  thumbSection.classList.add("hidden");
  form.classList.add("visible");
  writeBtn.textContent = "Start pitch with this script";
  return parsed;
}

parseBtn.addEventListener("click", () => {
  applyParsedScript();
});

let parseTimer = null;
scriptPaste.addEventListener("input", () => {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(() => {
    const parsed = parseScriptToSlides(scriptPaste.value);
    if (parsed.length >= 1 && scriptPaste.value.trim().length > 40) {
      renderParsedCards(parsed);
    }
  }, 400);
});

async function writeScript() {
  const state = getState();

  const purposeOk =
    setup.purpose &&
    (setup.purpose !== "Other" || setup.purposeOther.trim().length > 0);
  if (!purposeOk) {
    showError("Choose a purpose before continuing.");
    return;
  }

  updateSetup({
    purpose: purpose.value,
    purposeOther: purposeOther.value,
    language: language.value,
    audience: audience.value,
    notes: notes.value,
    targetMinutes: setup.targetMinutes,
    tone: setup.tone,
  });

  // Pasted-script path: already have spoken lines — go pitch (via script studio)
  if (materialMode === "script" || state.slides.some((s) => s.fromScript)) {
    if (!state.scriptSlides?.length) {
      if (!applyParsedScript()) return;
    }
    writeBtn.disabled = true;
    navigateSafely("/script");
    return;
  }

  if (!state.slides.length) {
    showError("Upload a PDF or paste a script first.");
    return;
  }

  // Lean handoff — rebuild slides from the live store on the script page
  // (avoids multi-MB base64 stringify into sessionStorage)
  const payload = {
    useStoreSlides: true,
    deckTitle: state.deckTitle,
    purpose: getPurposeString(),
    audience: audience.value.trim() || undefined,
    notes: notes.value.trim() || undefined,
    tone: setup.tone,
    targetMinutes: setup.targetMinutes,
    language: getResolvedLanguage(),
  };

  try {
    sessionStorage.setItem(
      "crowdwork-pending-generate",
      JSON.stringify(payload)
    );
    setGenerating(true);
    writeBtn.disabled = true;
    writeBtn.textContent = "Writing your script…";
    navigateSafely("/script");
  } catch (err) {
    setGenerating(false);
    toastRetry(
      err instanceof Error ? err.message : "Could not start generation.",
      writeScript
    );
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  writeScript();
});

// silence unused import warning path
void ScriptParserService;

// hydrate if deck already in session
const existing = getState();
if (existing.slides.length) {
  const fromScript = existing.slides.some((s) => s.fromScript);
  materialMode = fromScript ? "script" : "pdf";
  if (fromScript) {
    writeBtn.textContent = "Start pitch with this script";
    thumbSection.classList.add("hidden");
  } else {
    thumbSection.classList.remove("hidden");
    progress.textContent = `${existing.slides.length} slides ready`;
    existing.slides.forEach((slide) => {
      const el = document.createElement("div");
      el.className = "thumb";
      el.innerHTML = `<img src="${slide.imageDisplay}" alt="Slide ${slide.n}" /><span>${slide.n}</span>`;
      thumbs.appendChild(el);
    });
    setUploadSuccessState(true);
  }
  form.classList.add("visible");
  purpose.value = existing.setup.purpose || "";
  purposeOther.value = existing.setup.purposeOther || "";
  purposeOther.classList.toggle("hidden", purpose.value !== "Other");
  language.value = existing.setup.language || "auto";
  audience.value = existing.setup.audience || "";
  notes.value = existing.setup.notes || "";
  setup = { ...existing.setup };
}

hydrateContextBanner();
renderChips();
