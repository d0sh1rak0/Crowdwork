/**
 * Level & XP Progression Badge.
 *
 * Auto-mounts into `.site-header` (next to the auth HUD) on import, and
 * into `#course-progression-slot` on the course dashboard when present.
 * - Level pill (LVL 0, LVL 1, …)
 * - XP progress bar toward the next level (e.g. 45 / 100 XP)
 * - Click → stats modal (total XP, lessons, bosses, sessions)
 * - Global "LEVEL UP!" celebration toast on 100-XP threshold crossings.
 */

import progression, { XP_PER_LEVEL } from "../services/ProgressionService.js";

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const mounts = [];

function badgeHtml(snap) {
  const pct = Math.min(100, Math.round((snap.xpIntoLevel / XP_PER_LEVEL) * 100));
  return `
    <span class="lvl-pill font-utility">LVL ${snap.level}</span>
    <span class="lvl-meter" role="progressbar" aria-valuenow="${snap.xpIntoLevel}"
          aria-valuemin="0" aria-valuemax="${XP_PER_LEVEL}">
      <i style="width:${pct}%"></i>
    </span>
    <span class="lvl-xp font-utility">${snap.xpIntoLevel} / ${XP_PER_LEVEL} XP</span>`;
}

function renderBadges(snap) {
  for (const el of mounts) {
    el.innerHTML = badgeHtml(snap);
    el.title = `Total ${snap.xp} XP · Level ${snap.level}`;
  }
}

/* ---------- Stats modal ---------- */

let modalEl = null;

function openStatsModal() {
  const snap = progression.getSnapshot();
  const p = snap.profile;
  closeStatsModal();
  modalEl = h(`
    <div class="course-modal lvl-modal" role="dialog" aria-modal="true">
      <div class="course-modal-backdrop" data-lvl-close></div>
      <div class="course-modal-panel">
        <button type="button" class="course-modal-close" data-lvl-close aria-label="Close">×</button>
        <p class="course-kicker font-utility">Progression</p>
        <h2 class="course-modal-title">Level ${snap.level}</h2>
        <div class="lvl-modal-meter">
          <span class="lvl-meter big"><i style="width:${Math.min(
            100,
            Math.round((snap.xpIntoLevel / XP_PER_LEVEL) * 100)
          )}%"></i></span>
          <span class="font-utility">${snap.xpIntoLevel} / ${XP_PER_LEVEL} XP to LVL ${
            snap.level + 1
          }</span>
        </div>
        <div class="lvl-stats-grid">
          <div class="lvl-stat"><strong>${p.xp}</strong><span>Total XP earned</span></div>
          <div class="lvl-stat"><strong>${p.sessionCount}</strong><span>Rehearsal sessions</span></div>
          <div class="lvl-stat"><strong>${p.completedLessons.length}/12</strong><span>Lessons completed</span></div>
          <div class="lvl-stat"><strong>${p.completedBosses.length}/3</strong><span>Boss challenges</span></div>
        </div>
        ${
          p.completedLessons.length
            ? `<div class="course-modal-block"><p class="font-utility course-block-label">Completed lessons</p>
               <p class="lvl-lesson-list">${p.completedLessons
                 .map((id) => id.replace("lesson-", "L"))
                 .join(" · ")}</p></div>`
            : `<p class="course-modal-body">${
                snap.level === 0
                  ? "Complete your first AI speech rehearsal to reach Level 1 and unlock the course."
                  : "No lessons completed yet — head to the course."
              }</p>`
        }
        <div class="course-modal-actions">
          <a class="btn btn-primary" href="/course">Open course</a>
          <button type="button" class="btn btn-outline" data-lvl-close>Close</button>
        </div>
      </div>
    </div>`);
  modalEl.querySelectorAll("[data-lvl-close]").forEach((el) =>
    el.addEventListener("click", closeStatsModal)
  );
  document.body.appendChild(modalEl);
}

function closeStatsModal() {
  modalEl?.remove();
  modalEl = null;
}

/* ---------- Level-up celebration ---------- */

function celebrateLevelUp(level) {
  const overlay = h(`
    <div class="levelup-overlay" aria-live="assertive">
      <div class="levelup-card">
        <div class="levelup-burst" aria-hidden="true">${"✦".repeat(1)}</div>
        <p class="levelup-kicker font-utility">LEVEL UP!</p>
        <p class="levelup-title">You reached <strong>Level ${level}</strong>${
          level === 1 ? " — course unlocked!" : "!"
        }</p>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add("leaving"), 3200);
  setTimeout(() => overlay.remove(), 3800);
}

/* ---------- Mounting ---------- */

/**
 * @param {HTMLElement} container element to render the badge into
 */
export function mountLevelBadge(container) {
  if (!container || container.dataset.lvlMounted) return;
  container.dataset.lvlMounted = "1";
  container.classList.add("lvl-badge");
  container.setAttribute("role", "button");
  container.tabIndex = 0;
  container.addEventListener("click", openStatsModal);
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openStatsModal();
  });
  mounts.push(container);
  renderBadges(progression.getSnapshot());
}

function autoMount() {
  const header = document.querySelector(".site-header");
  if (header && !header.querySelector(".lvl-badge")) {
    const slot = h(`<div></div>`);
    const authHud = header.querySelector(".auth-hud");
    if (authHud) header.insertBefore(slot, authHud);
    else header.appendChild(slot);
    mountLevelBadge(slot);
  }
  const courseSlot = document.getElementById("course-progression-slot");
  if (courseSlot) mountLevelBadge(courseSlot);
}

progression.subscribe((snap) => renderBadges(snap));
progression.onLevelUp(({ level }) => celebrateLevelUp(level));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMount);
} else {
  autoMount();
}

export { celebrateLevelUp };
