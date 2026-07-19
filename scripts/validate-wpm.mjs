/**
 * Local validation for WPM delta extraction + stable window math.
 */
import assert from "node:assert/strict";
import {
  PacingTelemetry,
  extractDeltaWords,
  WPM_WINDOW_MS,
} from "../public/js/services/PacingTelemetry.js";

// Delta extraction — cumulative history must not re-count
{
  const a = extractDeltaWords("", "hello there friend");
  assert.equal(a.newWords, 3);

  const b = extractDeltaWords(
    "hello there friend",
    "hello there friend how are you"
  );
  assert.equal(b.newWords, 3);
  assert.equal(b.deltaText, "how are you");

  const c = extractDeltaWords("hello there friend", "hello there friend");
  assert.equal(c.newWords, 0);

  // Isolated slice packets count fully once
  const d = extractDeltaWords("previous slice words", "brand new slice here");
  assert.equal(d.newWords, 4);
}

// Stable 5s window — 10 words ⇒ 120 WPM (not 300+)
{
  const t = new PacingTelemetry();
  const now = Date.now();
  t.wordEvents = [{ t: now - 100, n: 10 }];
  const wpm = t.getWindowWpm();
  assert.equal(wpm, Math.round((10 / (WPM_WINDOW_MS / 1000)) * 60)); // 120
  assert.ok(wpm < 200, `expected calm WPM, got ${wpm}`);
}

// Dup packet within 750ms must not double-count
{
  const t = new PacingTelemetry();
  t.startTelemetryLoop(null, null);
  t.registerSpeechActivity({ text: "one two three four five" });
  const first = t.wpm;
  t.registerSpeechActivity({ text: "one two three four five" });
  assert.equal(t.wpm, first);
  const words = t.wordEvents.reduce((a, e) => a + e.n, 0);
  assert.equal(words, 5);
  t.stopTelemetryLoop();
}

console.log("validate-wpm: ok");
