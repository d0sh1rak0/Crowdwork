/**
 * Cross-page context banners (e.g. generation failures routed back to upload).
 */

const KEY = "crowdwork-upload-banner";

/**
 * @param {{ message: string, tone?: 'error' | 'info' }} banner
 */
export function setUploadBanner(banner) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        message: String(banner?.message || "Something went wrong."),
        tone: banner?.tone === "info" ? "info" : "error",
        at: Date.now(),
      })
    );
  } catch {
    /* private mode */
  }
}

/** @returns {{ message: string, tone: string } | null} */
export function consumeUploadBanner() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const data = JSON.parse(raw);
    if (!data?.message) return null;
    return {
      message: String(data.message),
      tone: data.tone === "info" ? "info" : "error",
    };
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}
