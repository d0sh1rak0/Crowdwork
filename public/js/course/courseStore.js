/**
 * Durable course progress (XP, unlocks, completions) for Charisma & Speech Mastery.
 * Uses localStorage so progress survives tab close — separate from deck sessionStorage.
 */

const STORAGE_KEY = "crowdwork-course-progress-v1";

/** @typedef {{ completedLessons: string[], completedBosses: string[], questDone: string[], totalXp: number, unitBadges: string[] }} CourseProgress */

function blankProgress() {
  return {
    completedLessons: [],
    completedBosses: [],
    questDone: [],
    totalXp: 0,
    unitBadges: [],
  };
}

/** @returns {CourseProgress} */
export function loadCourseProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankProgress();
    const parsed = JSON.parse(raw);
    return {
      ...blankProgress(),
      ...parsed,
      completedLessons: Array.isArray(parsed.completedLessons)
        ? parsed.completedLessons
        : [],
      completedBosses: Array.isArray(parsed.completedBosses)
        ? parsed.completedBosses
        : [],
      questDone: Array.isArray(parsed.questDone) ? parsed.questDone : [],
      unitBadges: Array.isArray(parsed.unitBadges) ? parsed.unitBadges : [],
      totalXp: Number(parsed.totalXp) || 0,
    };
  } catch {
    return blankProgress();
  }
}

/** @param {CourseProgress} progress */
export function saveCourseProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export async function fetchCurriculum() {
  const res = await fetch("/data/curriculum.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load curriculum.");
  return res.json();
}

export function flattenLessons(curriculum) {
  const out = [];
  for (const unit of curriculum.units || []) {
    for (const lesson of unit.lessons || []) {
      out.push({ ...lesson, unitId: unit.id, unitTitle: unit.title });
    }
  }
  return out;
}

export function findLesson(curriculum, lessonId) {
  for (const unit of curriculum.units || []) {
    const hit = (unit.lessons || []).find((l) => l.id === lessonId);
    if (hit) return { lesson: hit, unit };
  }
  return null;
}

export function findBoss(curriculum, bossId) {
  for (const unit of curriculum.units || []) {
    if (unit.boss?.id === bossId) return { boss: unit.boss, unit };
  }
  return null;
}

/** Lessons unlock in order within a unit; unit 2+ locks until prior boss beaten. */
export function isLessonUnlocked(curriculum, progress, lessonId) {
  const all = flattenLessons(curriculum);
  const idx = all.findIndex((l) => l.id === lessonId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prev = all[idx - 1];
  // Crossing a unit boundary requires prior unit boss
  const curr = all[idx];
  if (prev.unitId !== curr.unitId) {
    const unit = (curriculum.units || []).find((u) => u.id === prev.unitId);
    if (unit?.boss && !progress.completedBosses.includes(unit.boss.id)) {
      return false;
    }
  }
  return progress.completedLessons.includes(prev.id);
}

export function isBossUnlocked(curriculum, progress, bossId) {
  const found = findBoss(curriculum, bossId);
  if (!found) return false;
  const { unit } = found;
  const lessons = unit.lessons || [];
  if (!lessons.length) return false;
  return lessons.every((l) => progress.completedLessons.includes(l.id));
}

export function completeLesson(curriculum, lessonId, { quest = false } = {}) {
  const progress = loadCourseProgress();
  const found = findLesson(curriculum, lessonId);
  if (!found) return progress;
  const { lesson } = found;
  let gained = 0;
  if (!progress.completedLessons.includes(lessonId)) {
    progress.completedLessons.push(lessonId);
    gained += Number(lesson.xp) || 0;
  }
  if (quest && !progress.questDone.includes(lessonId)) {
    progress.questDone.push(lessonId);
  }
  progress.totalXp += gained;
  saveCourseProgress(progress);
  return { progress, gained };
}

export function completeBoss(curriculum, bossId) {
  const progress = loadCourseProgress();
  const found = findBoss(curriculum, bossId);
  if (!found) return { progress, gained: 0 };
  const { boss, unit } = found;
  let gained = 0;
  if (!progress.completedBosses.includes(bossId)) {
    progress.completedBosses.push(bossId);
    gained += Number(boss.xp) || 0;
    if (!progress.unitBadges.includes(unit.id)) {
      progress.unitBadges.push(unit.id);
    }
  }
  progress.totalXp += gained;
  saveCourseProgress(progress);
  return { progress, gained };
}

export function unitProgress(unit, progress) {
  const lessons = unit.lessons || [];
  const done = lessons.filter((l) =>
    progress.completedLessons.includes(l.id)
  ).length;
  const bossDone = unit.boss
    ? progress.completedBosses.includes(unit.boss.id)
    : false;
  const total = lessons.length + (unit.boss ? 1 : 0);
  const completed = done + (bossDone ? 1 : 0);
  return {
    done,
    total: lessons.length,
    bossDone,
    pct: total ? Math.round((completed / total) * 100) : 0,
  };
}

/** Active drill handoff between dashboard → drill page */
const ACTIVE_KEY = "crowdwork-active-drill";

export function setActiveDrill(payload) {
  sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(payload));
}

export function consumeActiveDrill() {
  const raw = sessionStorage.getItem(ACTIVE_KEY);
  sessionStorage.removeItem(ACTIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function peekActiveDrill() {
  try {
    return JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || "null");
  } catch {
    return null;
  }
}
