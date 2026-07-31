import {
  completeLesson,
  fetchCurriculum,
  findBoss,
  findLesson,
  isBossUnlocked,
  isLessonUnlocked,
  loadCourseProgress,
  setActiveDrill,
  unitProgress,
} from "./course/courseStore.js";
import { navigateSafely } from "./store.js";

let curriculum = null;
let progress = loadCourseProgress();
let activeUnitId = null;
let modalTarget = null; // { kind: 'lesson'|'boss', id }

const unitTabs = document.getElementById("unit-tabs");
const unitDetail = document.getElementById("unit-detail");
const xpEl = document.getElementById("course-xp");
const badgesEl = document.getElementById("course-badges");
const modal = document.getElementById("lesson-modal");

function renderXp() {
  if (xpEl) xpEl.textContent = String(progress.totalXp || 0);
  if (!badgesEl || !curriculum) return;
  badgesEl.innerHTML = (curriculum.units || [])
    .map((u) => {
      const earned = progress.unitBadges.includes(u.id);
      return `<span class="unit-badge ${earned ? "earned" : ""}" style="--unit:${u.color}" title="${u.title}">${
        earned ? "✓" : "·"
      } U${u.order}</span>`;
    })
    .join("");
}

function renderTabs() {
  if (!unitTabs || !curriculum) return;
  unitTabs.innerHTML = "";
  for (const unit of curriculum.units) {
    const up = unitProgress(unit, progress);
    const priorBossOk =
      unit.order === 1 ||
      progress.completedBosses.includes(
        curriculum.units[unit.order - 2]?.boss?.id
      );
    const locked = !priorBossOk;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `unit-tab ${unit.id === activeUnitId ? "active" : ""} ${
      locked ? "locked" : ""
    }`;
    btn.style.setProperty("--unit", unit.color);
    btn.disabled = locked;
    btn.innerHTML = `
      <span class="unit-tab-order font-utility">Unit ${unit.order}</span>
      <span class="unit-tab-title">${unit.title}</span>
      <span class="unit-tab-sub">${unit.subtitle}</span>
      <span class="unit-tab-progress">
        <span class="unit-tab-bar"><i style="width:${up.pct}%"></i></span>
        <span class="font-utility">${up.pct}%</span>
      </span>
      ${locked ? `<span class="lock-pill">Locked</span>` : ""}
    `;
    btn.addEventListener("click", () => {
      activeUnitId = unit.id;
      renderTabs();
      renderUnit();
    });
    unitTabs.appendChild(btn);
  }
}

function renderUnit() {
  const unit = curriculum.units.find((u) => u.id === activeUnitId);
  if (!unit || !unitDetail) return;
  const up = unitProgress(unit, progress);

  const lessonsHtml = unit.lessons
    .map((lesson) => {
      const unlocked = isLessonUnlocked(curriculum, progress, lesson.id);
      const done = progress.completedLessons.includes(lesson.id);
      return `
        <button type="button" class="lesson-row ${done ? "done" : ""} ${
          unlocked ? "" : "locked"
        }" data-lesson="${lesson.id}" ${unlocked ? "" : "disabled"}>
          <span class="lesson-n font-utility">L${lesson.n}</span>
          <span class="lesson-copy">
            <strong>${lesson.title}</strong>
            <span>${lesson.focus} · ${lesson.durationMin} min</span>
          </span>
          <span class="xp-chip">+${lesson.xp} XP</span>
          ${done ? `<span class="done-pill">Done</span>` : ""}
          ${!unlocked ? `<span class="lock-pill">Locked</span>` : ""}
        </button>`;
    })
    .join("");

  const boss = unit.boss;
  const bossUnlocked = isBossUnlocked(curriculum, progress, boss.id);
  const bossDone = progress.completedBosses.includes(boss.id);

  unitDetail.innerHTML = `
    <div class="unit-hero" style="--unit:${unit.color}">
      <p class="font-utility unit-hero-kicker">Unit ${unit.order}</p>
      <h2>${unit.title}</h2>
      <p>${unit.focus}</p>
      <div class="unit-hero-meta">
        <span class="font-utility">${up.done}/${up.total} lessons</span>
        <span class="unit-tab-bar wide"><i style="width:${up.pct}%"></i></span>
      </div>
    </div>
    <div class="lesson-list">${lessonsHtml}</div>
    <button type="button" class="boss-row ${bossDone ? "done" : ""} ${
      bossUnlocked ? "" : "locked"
    }" data-boss="${boss.id}" ${bossUnlocked ? "" : "disabled"}>
      <span class="boss-flame" aria-hidden="true">⚑</span>
      <span class="lesson-copy">
        <strong>${boss.title}</strong>
        <span>${boss.label} · +${boss.xp} XP</span>
      </span>
      ${bossDone ? `<span class="done-pill">Cleared</span>` : `<span class="xp-chip boss">Boss</span>`}
      ${!bossUnlocked ? `<span class="lock-pill">Complete lessons first</span>` : ""}
    </button>
  `;

  unitDetail.querySelectorAll("[data-lesson]").forEach((el) => {
    el.addEventListener("click", () => openLessonModal(el.dataset.lesson));
  });
  unitDetail.querySelectorAll("[data-boss]").forEach((el) => {
    el.addEventListener("click", () => openBossModal(el.dataset.boss));
  });
}

function openLessonModal(lessonId) {
  const found = findLesson(curriculum, lessonId);
  if (!found) return;
  const { lesson, unit } = found;
  modalTarget = { kind: "lesson", id: lessonId };
  document.getElementById("modal-kicker").textContent = `${unit.title} · Lesson ${lesson.n}`;
  document.getElementById("modal-title").textContent = lesson.title;
  document.getElementById("modal-focus").textContent = `${lesson.focus} · ${lesson.durationMin} min`;
  document.getElementById("modal-concept").textContent = lesson.concept;
  document.getElementById("modal-drill").textContent = lesson.drill;
  document.getElementById("modal-quest").textContent = lesson.quest;
  document.getElementById("modal-xp").textContent = `+${lesson.xp} XP`;
  const startBtn = document.getElementById("modal-start");
  startBtn.textContent =
    lesson.mode === "voice_drill" ? "Launch voice drill" : "Start guided lesson";
  modal.classList.remove("hidden");
}

function openBossModal(bossId) {
  const found = findBoss(curriculum, bossId);
  if (!found) return;
  const { boss, unit } = found;
  modalTarget = { kind: "boss", id: bossId };
  document.getElementById("modal-kicker").textContent = `${unit.title} · Boss Checkpoint`;
  document.getElementById("modal-title").textContent = boss.title;
  document.getElementById("modal-focus").textContent = boss.label;
  document.getElementById("modal-concept").textContent = boss.challenge;
  document.getElementById("modal-drill").textContent = (boss.passCriteria || [])
    .map((c) => `• ${c.label}`)
    .join("\n");
  document.getElementById("modal-quest").textContent =
    "Pass every criterion in one take to unlock the unit badge.";
  document.getElementById("modal-xp").textContent = `+${boss.xp} XP`;
  document.getElementById("modal-start").textContent = "Enter Boss Challenge";
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalTarget = null;
}

function launchTarget() {
  if (!modalTarget) return;
  if (modalTarget.kind === "lesson") {
    const found = findLesson(curriculum, modalTarget.id);
    if (!found) return;
    const { lesson, unit } = found;
    if (lesson.mode === "voice_drill" || lesson.mode === "guided") {
      // Guided lessons still open drill shell for timer + completion; voice drills calibrate telemetry
      setActiveDrill({
        kind: "lesson",
        lessonId: lesson.id,
        unitId: unit.id,
      });
      navigateSafely("/course/drill");
      return;
    }
  }
  if (modalTarget.kind === "boss") {
    const found = findBoss(curriculum, modalTarget.id);
    if (!found) return;
    setActiveDrill({
      kind: "boss",
      bossId: found.boss.id,
      unitId: found.unit.id,
    });
    navigateSafely("/course/drill");
  }
}

function markCompleteFromModal() {
  if (!modalTarget || modalTarget.kind !== "lesson") {
    launchTarget();
    return;
  }
  const { progress: next, gained } = completeLesson(
    curriculum,
    modalTarget.id,
    { quest: true }
  );
  progress = next;
  renderXp();
  renderTabs();
  renderUnit();
  closeModal();
  if (gained) flashToast(`+${gained} XP · Lesson complete`);
}

function flashToast(msg) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

modal?.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeModal);
});
document.getElementById("modal-start")?.addEventListener("click", launchTarget);
document.getElementById("modal-complete")?.addEventListener("click", markCompleteFromModal);

async function boot() {
  try {
    curriculum = await fetchCurriculum();
    progress = loadCourseProgress();
    activeUnitId = curriculum.units[0]?.id;
    renderXp();
    renderTabs();
    renderUnit();
  } catch (err) {
    if (unitDetail) {
      unitDetail.innerHTML = `<p class="page-sub">${
        err instanceof Error ? err.message : "Failed to load course."
      }</p>`;
    }
  }
}

boot();
