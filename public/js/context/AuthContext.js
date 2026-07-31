/**
 * Global auth context for CrowdWork AI (vanilla-JS equivalent of a React
 * AuthContext provider).
 *
 * Importing this module on a page acts like wrapping that page in
 * `<AuthProvider>`: a single onAuthStateChanged listener starts on first
 * import and keeps `user` / `loading` state for the whole app.
 *
 * Usage in any page script:
 *
 *   import { useAuth } from "/js/context/AuthContext.js";
 *
 *   const { user, loading, signInWithGoogle, logout, subscribe } = useAuth();
 *   const unsubscribe = subscribe(({ user, loading }) => {
 *     // re-render your auth-dependent UI here
 *   });
 */

import {
  auth,
  onAuthChanged,
  signInWithGoogle,
  logout,
} from "../lib/firebase.js";

const state = {
  /** @type {import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js").User|null} */
  user: null,
  loading: true,
};

/** @type {Set<(snapshot: { user: object|null, loading: boolean }) => void>} */
const listeners = new Set();
let started = false;

function snapshot() {
  return { user: state.user, loading: state.loading };
}

function notify() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error("[AuthContext] listener failed", err);
    }
  }
}

/**
 * Start the global auth listener. Idempotent — safe to call from every
 * page; only the first call attaches onAuthStateChanged.
 */
export function initAuthProvider() {
  if (started) return;
  started = true;
  onAuthChanged((user) => {
    state.user = user || null;
    state.loading = false;
    notify();
  });
}

/**
 * Subscribe to auth state changes. Fires immediately with the current
 * snapshot, then again on every change.
 * @param {(snapshot: { user: object|null, loading: boolean }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

/**
 * Hook-style accessor mirroring the React `useAuth()` contract.
 * @returns {{
 *   user: object|null,
 *   loading: boolean,
 *   signInWithGoogle: typeof signInWithGoogle,
 *   logout: typeof logout,
 *   subscribe: typeof subscribe,
 * }}
 */
export function useAuth() {
  return {
    get user() {
      return state.user;
    },
    get loading() {
      return state.loading;
    },
    signInWithGoogle,
    logout,
    subscribe,
  };
}

export { auth, signInWithGoogle, logout };

// Auto-start on import — the "provider mounted at the root" behaviour.
initAuthProvider();
