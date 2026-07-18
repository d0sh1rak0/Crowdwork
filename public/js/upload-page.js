import { toastRetry } from "./api.js";
import { processPdf, validatePdfFile } from "./pdf.js";
import {
  getPurposeString,
  getResolvedLanguage,
  getState,
  setDeck,
  setGenerating,
  setScriptSlides,
  slidesForApi,
  updateSetup,
} from "./store.js";

const zone = document.getElementById("upload-zone");
const input = document.getElementById("file-input");
const errorEl = document.getElementById("upload-error");
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

const DURATIONS = [3, 5, 7, 10, 15, 20];
const TONES = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

let setup = { ...getState().setup };

function showError(msg) {
  if (!msg) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
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
    showError(validation);
    return;
  }

  thumbs.innerHTML = "";
  thumbSection.classList.remove("hidden");
  form.classList.remove("visible");
  progress.textContent = "Reading slide 0…";
  zone.style.pointerEvents = "none";
  zone.style.opacity = "0.6";

  try {
    const { slides, title } = await processPdf(file, ({ current, total, slide }) => {
      progress.textContent = `Reading slide ${current} of ${total}`;
      const el = document.createElement("div");
      el.className = "thumb";
      el.innerHTML = `<img src="${slide.imageDisplay}" alt="Slide ${slide.n}" /><span>${slide.n}</span>`;
      thumbs.appendChild(el);
    });
    setDeck({ title, slides });
    progress.textContent = `${slides.length} slides ready`;
    form.classList.add("visible");
  } catch (err) {
    showError(err instanceof Error ? err.message : "Could not read this PDF.");
    thumbSection.classList.add("hidden");
  } finally {
    zone.style.pointerEvents = "";
    zone.style.opacity = "";
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

async function writeScript() {
  const state = getState();
  if (!state.slides.length) return;

  const purposeOk =
    setup.purpose &&
    (setup.purpose !== "Other" || setup.purposeOther.trim().length > 0);
  if (!purposeOk) {
    showError("Choose a purpose before writing the script.");
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

  const payload = {
    deckTitle: state.deckTitle,
    purpose: getPurposeString(),
    audience: audience.value.trim() || undefined,
    notes: notes.value.trim() || undefined,
    tone: setup.tone,
    targetMinutes: setup.targetMinutes,
    language: getResolvedLanguage(),
    slides: slidesForApi(),
  };

  try {
    sessionStorage.setItem("crowdwork-pending-generate", JSON.stringify(payload));
    setGenerating(true);
    writeBtn.disabled = true;
    writeBtn.textContent = "Writing your script…";
    window.location.href = "/script";
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

// hydrate if deck already in session
const existing = getState();
if (existing.slides.length) {
  thumbSection.classList.remove("hidden");
  progress.textContent = `${existing.slides.length} slides ready`;
  existing.slides.forEach((slide) => {
    const el = document.createElement("div");
    el.className = "thumb";
    el.innerHTML = `<img src="${slide.imageDisplay}" alt="Slide ${slide.n}" /><span>${slide.n}</span>`;
    thumbs.appendChild(el);
  });
  form.classList.add("visible");
  purpose.value = existing.setup.purpose || "";
  purposeOther.value = existing.setup.purposeOther || "";
  purposeOther.classList.toggle("hidden", purpose.value !== "Other");
  language.value = existing.setup.language || "auto";
  audience.value = existing.setup.audience || "";
  notes.value = existing.setup.notes || "";
  setup = { ...existing.setup };
}

renderChips();
