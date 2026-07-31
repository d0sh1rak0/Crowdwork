/**
 * Modular Firebase initialization for CrowdWork AI.
 *
 * This is a static (no-bundler) app, so we import the Firebase ESM builds
 * from the gstatic CDN, pinned to the same version as the npm `firebase`
 * dependency in package.json (12.17.0). If a bundler is added later, swap
 * the CDN URLs for bare imports ("firebase/app", "firebase/auth") — the
 * rest of this file is identical to a Next.js `lib/firebase.js`.
 *
 * Note: the Firebase web config below is public by design (it identifies
 * the project, it is not a secret). Access control lives in Firebase
 * Auth + Security Rules.
 */

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  increment,
  arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA_Ldq5_FbuMax6N5-JP3kiRvtpYIWaK44",
  authDomain: "crowdwork-492a3.firebaseapp.com",
  projectId: "crowdwork-492a3",
  storageBucket: "crowdwork-492a3.firebasestorage.app",
  messagingSenderId: "652211982395",
  appId: "1:652211982395:web:aed79309d7c9125b3e8c1e",
  measurementId: "G-EJVK6NBGRC",
};

// Initialize exactly once, even if this module is evaluated again
// (e.g. hot reloads, multiple entry points importing it).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/** Shared Auth instance. */
export const auth = getAuth(app);

/** Shared Firestore instance. */
export const db = getFirestore(app);

// Re-export Firestore primitives so app code imports everything from here.
export {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  increment,
  arrayUnion,
  serverTimestamp,
};

/**
 * Sign in with Google via popup.
 *
 * @returns {Promise<{ displayName: string|null, email: string|null, photoURL: string|null, uid: string }>}
 * @throws Re-throws the Firebase error after logging details, so callers
 *         can surface a UI message.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const result = await signInWithPopup(auth, provider);
    const { displayName, email, photoURL, uid } = result.user;
    return { displayName, email, photoURL, uid };
  } catch (err) {
    // Robust error logging: Firebase auth errors carry code + customData.
    const code = err?.code || "auth/unknown";
    const message = err?.message || String(err);
    const emailInvolved = err?.customData?.email || null;
    const credential = GoogleAuthProvider.credentialFromError?.(err) || null;
    console.error("[firebase] Google sign-in failed", {
      code,
      message,
      email: emailInvolved,
      credential,
    });
    throw err;
  }
}

/**
 * Sign the current user out.
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[firebase] Sign-out failed", {
      code: err?.code || "auth/unknown",
      message: err?.message || String(err),
    });
    throw err;
  }
}

/**
 * Subscribe to auth state changes.
 * @param {(user: import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js").User|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export default app;
