/**
 * NetworkClient — ngrok-safe fetch helpers + hardware secure-context gate.
 * All API traffic must include ngrok-skip-browser-warning so the interstitial
 * page cannot intercept background Whisper / Gemini / Groq calls.
 */

class NetworkClient {
  /** Current public origin (works for localhost, ngrok https, Cloudflare, etc.). */
  static getOrigin() {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return "";
  }

  /** Resolve an app-root path against the active host (never hardcode localhost). */
  static apiUrl(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${NetworkClient.getOrigin()}${p}`;
  }

  static getSecureHeaders(customHeaders = {}) {
    return {
      // CRITICAL NGROK FIX: Prevents the ngrok warning screen from intercepting
      // and blocking background API fetch calls to Groq/Gemini pipelines.
      "ngrok-skip-browser-warning": "true",
      ...customHeaders,
    };
  }

  static getJsonHeaders(customHeaders = {}) {
    return NetworkClient.getSecureHeaders({
      "Content-Type": "application/json",
      ...customHeaders,
    });
  }

  /**
   * fetch wrapper that always attaches ngrok skip header and uses the
   * active window origin for root-relative API paths.
   */
  static async fetch(pathOrUrl, options = {}) {
    const url =
      /^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith("blob:")
        ? pathOrUrl
        : NetworkClient.apiUrl(pathOrUrl);

    const headers = NetworkClient.getSecureHeaders(
      options.headers ? { ...options.headers } : {}
    );
    // FormData must not force Content-Type (boundary is set by the browser)
    if (options.body instanceof FormData && headers["Content-Type"]) {
      delete headers["Content-Type"];
    }

    return fetch(url, { ...options, headers });
  }

  static checkHardwareSecurity() {
    if (typeof window === "undefined") return true;
    if (window.isSecureContext) return true;

    console.error(
      "CrowdWork AI Error: Insecure origin context detected!",
      window.location.href
    );
    NetworkClient.showHardwareSecurityBanner(
      "Hardware access blocked. Open this app via the secure HTTPS ngrok link (https://…), not http://."
    );
    return false;
  }

  static showHardwareSecurityBanner(message) {
    let el = document.getElementById("secure-context-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "secure-context-banner";
      el.className = "secure-context-banner";
      el.setAttribute("role", "alert");
      document.body.prepend(el);
    }
    el.hidden = false;
    el.innerHTML = `<strong>Secure connection required</strong><span>${message}</span>`;
    el.classList.add("show");
  }

  static isNgrokHost() {
    const host = window.location?.hostname || "";
    return /ngrok/i.test(host);
  }
}

export default NetworkClient;
export { NetworkClient };
