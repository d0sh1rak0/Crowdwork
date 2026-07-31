/**
 * Google Sign-In button + user profile HUD for the main navigation bar.
 *
 * Auto-mounts into `.site-header` on import (after AuthContext). Renders:
 *  - loading  -> fixed-size skeleton (no layout shift)
 *  - signed out -> "Sign in with Google" button (spinner while authenticating)
 *  - signed in  -> avatar + display name chip with a logout dropdown
 */

import { useAuth } from "../context/AuthContext.js";

const GOOGLE_ICON = `
<svg class="auth-gicon" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

const state = {
  authBusy: false,
  menuOpen: false,
};

let hudEl = null;
let ctx = null;

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function initials(name, email) {
  const src = String(name || email || "?").trim();
  return src.charAt(0).toUpperCase() || "?";
}

function render(snapshot) {
  if (!hudEl) return;
  const { user, loading } = snapshot;
  hudEl.innerHTML = "";
  hudEl.classList.toggle("is-loading", loading);

  if (loading) {
    hudEl.appendChild(
      h(`<div class="auth-skeleton" aria-hidden="true">
           <span class="auth-skeleton-dot"></span>
           <span class="auth-skeleton-bar"></span>
         </div>`)
    );
    return;
  }

  if (!user) {
    const btn = h(
      `<button type="button" class="btn-google" ${
        state.authBusy ? "disabled" : ""
      } aria-label="Sign in with Google">
         ${state.authBusy ? `<span class="auth-spinner" aria-hidden="true"></span>` : GOOGLE_ICON}
         <span>${state.authBusy ? "Signing in…" : "Sign in with Google"}</span>
       </button>`
    );
    btn.addEventListener("click", async () => {
      if (state.authBusy) return;
      state.authBusy = true;
      render({ user: null, loading: false });
      try {
        await ctx.signInWithGoogle();
        // onAuthStateChanged re-renders via subscribe
      } catch (err) {
        console.warn("[AuthButton] sign-in cancelled/failed", err?.code);
        state.authBusy = false;
        render({ user: ctx.user, loading: false });
      }
    });
    hudEl.appendChild(btn);
    return;
  }

  state.authBusy = false;
  const name = user.displayName || user.email || "Signed in";
  const chip = h(
    `<button type="button" class="auth-chip" aria-haspopup="menu" aria-expanded="${state.menuOpen}">
       ${
         user.photoURL
           ? `<img class="auth-avatar" src="${user.photoURL}" alt="" referrerpolicy="no-referrer" />`
           : `<span class="auth-avatar auth-avatar-fallback">${initials(
               user.displayName,
               user.email
             )}</span>`
       }
       <span class="auth-name">${name}</span>
       <svg class="auth-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
         <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
       </svg>
     </button>`
  );
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    state.menuOpen = !state.menuOpen;
    render({ user, loading: false });
  });
  hudEl.appendChild(chip);

  if (state.menuOpen) {
    const menu = h(
      `<div class="auth-menu" role="menu">
         <p class="auth-menu-email">${user.email || ""}</p>
         <button type="button" class="auth-menu-item" role="menuitem">Sign out</button>
       </div>`
    );
    menu.querySelector(".auth-menu-item").addEventListener("click", async (e) => {
      e.stopPropagation();
      state.menuOpen = false;
      try {
        await ctx.logout();
      } catch (err) {
        console.warn("[AuthButton] logout failed", err?.code);
        render({ user: ctx.user, loading: false });
      }
    });
    hudEl.appendChild(menu);
  }
}

function closeMenuOnOutside(e) {
  if (!state.menuOpen || !hudEl) return;
  if (!hudEl.contains(e.target)) {
    state.menuOpen = false;
    render({ user: ctx.user, loading: ctx.loading });
  }
}

function closeMenuOnEscape(e) {
  if (e.key === "Escape" && state.menuOpen) {
    state.menuOpen = false;
    render({ user: ctx.user, loading: ctx.loading });
  }
}

/**
 * Mount the auth HUD into a header element (defaults to `.site-header`).
 * @param {HTMLElement} [container]
 */
export function mountAuthButton(container) {
  const header = container || document.querySelector(".site-header");
  if (!header || header.querySelector(".auth-hud")) return;
  hudEl = h(`<div class="auth-hud"></div>`);
  header.appendChild(hudEl);

  ctx = useAuth();
  ctx.subscribe((snap) => {
    if (!snap.loading) state.menuOpen = state.menuOpen && Boolean(snap.user);
    render(snap);
  });

  document.addEventListener("click", closeMenuOnOutside);
  document.addEventListener("keydown", closeMenuOnEscape);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mountAuthButton());
} else {
  mountAuthButton();
}
