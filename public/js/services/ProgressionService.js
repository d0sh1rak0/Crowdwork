/**
 * User Level & XP Progression System.
 *
 * Single source of truth for xp / level / completions / session stats.
 * - Signed out: profile lives in localStorage.
 * - Signed in:  profile lives in Firestore `users/{uid}` with realtime
 *   onSnapshot sync; localStorage doubles as an offline mirror. On first
 *   sign-in the doc is initialized with defaults, seeded from any local
 *   (anonymous) progress so XP earned before signing in is kept.
 *
 * Level formula: Level = Math.floor(xp / 100). New users start at
 * Level 0 (0–99 XP) and unlock Level 1 at 100 XP.
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  increment,
  arrayUnion,
  serverTimestamp,
} from "../lib/firebase.js";
import { useAuth } from "../context/AuthContext.js";

const LOCAL_KEY = "crowdwork-progression-v1";
const LEGACY_COURSE_KEY = "crowdwork-course-progress-v1";

export const XP_PER_LEVEL = 100;

/** XP awards for rehearsal sessions */
export const SESSION_XP = {
  first: 100, // first-ever completed rehearsal — jumps user to Level 1
  complete: 20, // every completed session
  wpmBonus: 10, // WPM stayed in the 120–150 target band
  wpmBand: { min: 120, max: 150 },
};

/** @typedef {{
 *   xp: number,
 *   level: number,
 *   completedLessons: string[],
 *   completedBosses: string[],
 *   sessionCount: number,
 *   questDone: string[],
 *   unitBadges: string[],
 * }} ProgressionProfile */

export function levelForXp(xp) {
  return Math.floor(Math.max(0, Number(xp) || 0) / XP_PER_LEVEL);
}

export function xpIntoLevel(xp) {
  return Math.max(0, Number(xp) || 0) % XP_PER_LEVEL;
}

function blankProfile() {
  return {
    xp: 0,
    level: 0,
    completedLessons: [],
    completedBosses: [],
    sessionCount: 0,
    questDone: [],
    unitBadges: [],
  };
}

function normalizeProfile(raw) {
  const p = { ...blankProfile(), ...(raw || {}) };
  p.xp = Math.max(0, Number(p.xp) || 0);
  p.level = levelForXp(p.xp);
  p.sessionCount = Math.max(0, Number(p.sessionCount) || 0);
  for (const k of ["completedLessons", "completedBosses", "questDone", "unitBadges"]) {
    p[k] = Array.isArray(p[k]) ? [...new Set(p[k].map(String))] : [];
  }
  return p;
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return normalizeProfile(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  // Migrate legacy course-only progress (pre-progression builds)
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_COURSE_KEY) || "null");
    if (legacy) {
      return normalizeProfile({
        xp: Number(legacy.totalXp) || 0,
        completedLessons: legacy.completedLessons,
        completedBosses: legacy.completedBosses,
        questDone: legacy.questDone,
        unitBadges: legacy.unitBadges,
      });
    }
  } catch {
    /* ignore */
  }
  return blankProfile();
}

function writeLocal(profile) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(profile));
  } catch {
    /* storage full/blocked — in-memory state still works */
  }
}

class ProgressionService {
  constructor() {
    /** @type {ProgressionProfile} */
    this.profile = readLocal();
    this.loading = false;
    this.uid = null;
    this._unsubDoc = null;
    /** @type {Set<Function>} */
    this._listeners = new Set();
    /** @type {Set<Function>} */
    this._levelUpListeners = new Set();
    this._authWired = false;
  }

  /** Attach to AuthContext — call once from any page (idempotent). */
  init() {
    if (this._authWired) return;
    this._authWired = true;
    const { subscribe } = useAuth();
    subscribe(({ user, loading }) => {
      if (loading) return;
      const uid = user?.uid || null;
      if (uid === this.uid) return;
      this._switchUser(uid);
    });
  }

  async _switchUser(uid) {
    if (this._unsubDoc) {
      this._unsubDoc();
      this._unsubDoc = null;
    }
    this.uid = uid;
    if (!uid) {
      // Back to anonymous local profile
      this.profile = readLocal();
      this._notify();
      return;
    }

    this.loading = true;
    this._notify();
    const ref = doc(db, "users", uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // First sign-in: initialize the user document with defaults,
        // seeded from local anonymous progress so nothing is lost.
        const seed = normalizeProfile(this.profile);
        await setDoc(ref, {
          ...seed,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error("[progression] profile init failed", err?.code, err?.message);
      this.loading = false;
      this._notify();
      return;
    }

    this._unsubDoc = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const prevLevel = this.profile.level;
        this.profile = normalizeProfile(snap.data());
        writeLocal(this.profile);
        this.loading = false;
        this._notify();
        if (this.profile.level > prevLevel && prevLevel != null) {
          this._emitLevelUp(this.profile.level);
        }
      },
      (err) => {
        console.error("[progression] snapshot failed", err?.code, err?.message);
        this.loading = false;
        this._notify();
      }
    );
  }

  getSnapshot() {
    const { xp, level } = this.profile;
    return {
      profile: { ...this.profile },
      xp,
      level,
      xpIntoLevel: xpIntoLevel(xp),
      xpForNext: XP_PER_LEVEL,
      loading: this.loading,
      signedIn: Boolean(this.uid),
    };
  }

  /** @param {(snap: ReturnType<ProgressionService['getSnapshot']>) => void} fn */
  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.getSnapshot());
    return () => this._listeners.delete(fn);
  }

  /** @param {(evt: { level: number }) => void} fn */
  onLevelUp(fn) {
    this._levelUpListeners.add(fn);
    return () => this._levelUpListeners.delete(fn);
  }

  _notify() {
    const snap = this.getSnapshot();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (err) {
        console.error("[progression] listener failed", err);
      }
    }
  }

  _emitLevelUp(level) {
    for (const fn of this._levelUpListeners) {
      try {
        fn({ level });
      } catch (err) {
        console.error("[progression] levelup listener failed", err);
      }
    }
  }

  /**
   * Apply a local mutation + persist. Detects level crossings.
   * @param {(p: ProgressionProfile) => void} mutate in-place mutation
   * @param {object} [remotePatch] Firestore update payload (uses increment/arrayUnion)
   */
  _commit(mutate, remotePatch = null) {
    const prevLevel = this.profile.level;
    mutate(this.profile);
    this.profile = normalizeProfile(this.profile);
    writeLocal(this.profile);
    this._notify();
    const leveledUp = this.profile.level > prevLevel;
    if (leveledUp && !this.uid) {
      // Signed-in level-ups are emitted from the snapshot listener;
      // anonymous ones emit here.
      this._emitLevelUp(this.profile.level);
    }
    if (this.uid && remotePatch) {
      const ref = doc(db, "users", this.uid);
      updateDoc(ref, { ...remotePatch, updatedAt: serverTimestamp() }).catch(
        (err) => {
          console.error("[progression] sync failed", err?.code, err?.message);
        }
      );
    }
    return { leveledUp, level: this.profile.level };
  }

  /**
   * Award XP. Core reward engine.
   * @param {number} amount
   * @param {string} source e.g. "lesson:lesson-5", "session", "first_session"
   */
  awardXp(amount, source = "misc") {
    const add = Math.max(0, Math.round(Number(amount) || 0));
    if (!add) return { gained: 0, leveledUp: false, level: this.profile.level };
    const { leveledUp, level } = this._commit(
      (p) => {
        p.xp += add;
      },
      { xp: increment(add) }
    );
    console.info(`[progression] +${add} XP (${source}) → ${this.profile.xp} XP, LVL ${level}`);
    return { gained: add, leveledUp, level };
  }

  /**
   * Record a completed CrowdWork AI rehearsal session.
   * First-ever session: +100 XP (unlocks Level 1 + the course).
   * Every session: +20 XP; +10 bonus when avg WPM stayed in 120–150.
   * @param {{ wpm?: number }} stats
   */
  recordSessionComplete(stats = {}) {
    const isFirst = this.profile.sessionCount === 0;
    const wpm = Number(stats.wpm) || 0;
    const wpmBonus =
      wpm >= SESSION_XP.wpmBand.min && wpm <= SESSION_XP.wpmBand.max
        ? SESSION_XP.wpmBonus
        : 0;
    const base = isFirst ? SESSION_XP.first : SESSION_XP.complete;
    const total = base + wpmBonus;

    const { leveledUp, level } = this._commit(
      (p) => {
        p.sessionCount += 1;
        p.xp += total;
      },
      { sessionCount: increment(1), xp: increment(total) }
    );
    console.info(
      `[progression] session #${this.profile.sessionCount} complete: +${total} XP` +
        (isFirst ? " (first session!)" : "") +
        (wpmBonus ? " (+WPM bonus)" : "")
    );
    return {
      gained: total,
      base,
      wpmBonus,
      isFirst,
      leveledUp,
      level,
      sessionCount: this.profile.sessionCount,
    };
  }

  /**
   * Mark a course lesson complete and award its XP (idempotent).
   * @param {string} lessonId
   * @param {number} xp
   * @param {{ quest?: boolean }} [opts]
   */
  completeLesson(lessonId, xp, { quest = false } = {}) {
    if (this.profile.completedLessons.includes(lessonId)) {
      if (quest && !this.profile.questDone.includes(lessonId)) {
        this._commit(
          (p) => p.questDone.push(lessonId),
          { questDone: arrayUnion(lessonId) }
        );
      }
      return { gained: 0, leveledUp: false, level: this.profile.level };
    }
    const add = Math.max(0, Number(xp) || 0);
    const { leveledUp, level } = this._commit(
      (p) => {
        p.completedLessons.push(lessonId);
        if (quest) p.questDone.push(lessonId);
        p.xp += add;
      },
      {
        completedLessons: arrayUnion(lessonId),
        ...(quest ? { questDone: arrayUnion(lessonId) } : {}),
        xp: increment(add),
      }
    );
    return { gained: add, leveledUp, level };
  }

  /**
   * Mark a boss challenge complete and award its XP (idempotent).
   * @param {string} bossId
   * @param {number} xp
   * @param {string} [unitId] unit badge to grant
   */
  completeBoss(bossId, xp, unitId = null) {
    if (this.profile.completedBosses.includes(bossId)) {
      return { gained: 0, leveledUp: false, level: this.profile.level };
    }
    const add = Math.max(0, Number(xp) || 0);
    const { leveledUp, level } = this._commit(
      (p) => {
        p.completedBosses.push(bossId);
        if (unitId && !p.unitBadges.includes(unitId)) p.unitBadges.push(unitId);
        p.xp += add;
      },
      {
        completedBosses: arrayUnion(bossId),
        ...(unitId ? { unitBadges: arrayUnion(unitId) } : {}),
        xp: increment(add),
      }
    );
    return { gained: add, leveledUp, level };
  }

  /** Course access: unlocked at Level 1+ or after the first session. */
  isCourseUnlocked() {
    return this.profile.level >= 1 || this.profile.sessionCount >= 1;
  }
}

/** Singleton, auto-wired to auth on import. */
const progression = new ProgressionService();
progression.init();
export default progression;

/**
 * Spec-compatible helper: `awardXP(userId, amount, source)`.
 * The service already tracks the signed-in user; `userId` is validated
 * against it when provided.
 */
export function awardXP(userId, amount, source = "misc") {
  if (userId && progression.uid && userId !== progression.uid) {
    console.warn("[progression] awardXP: userId mismatch, ignoring award");
    return { gained: 0, leveledUp: false, level: progression.profile.level };
  }
  return progression.awardXp(amount, source);
}
