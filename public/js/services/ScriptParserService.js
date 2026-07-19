/**
 * ScriptParserService — chunk a pasted full script into slide-sized blocks.
 *
 * Rules:
 * 1. Explicit: --- | [Slide] / [Slide N] | 3+ consecutive newlines
 * 2. Implicit: every 100–150 words when no delimiters exist
 */

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function normalizeBlock(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitExplicit(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");

  // Prefer --- / [Slide] markers; also treat \n\n\n+ as breaks
  const markerSplit = text.split(
    /(?:^|\n)\s*(?:---+|\[Slide(?:\s+\d+)?\])\s*(?:\n|$)/i
  );

  let parts = markerSplit.map(normalizeBlock).filter(Boolean);

  // If only one part, try triple-newline breaks
  if (parts.length <= 1) {
    parts = text
      .split(/\n{3,}/)
      .map(normalizeBlock)
      .filter(Boolean);
  }

  return parts;
}

function splitByWordBudget(text, minWords = 100, maxWords = 150) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const target = Math.round((minWords + maxWords) / 2);
  const blocks = [];
  let i = 0;

  while (i < words.length) {
    let end = Math.min(i + target, words.length);

    // Prefer breaking at sentence end within the window
    if (end < words.length) {
      const window = words.slice(i, Math.min(i + maxWords, words.length));
      let best = -1;
      for (let j = minWords; j < window.length; j++) {
        if (/[.!?]"?$/.test(window[j])) best = j + 1;
      }
      if (best >= minWords) end = i + best;
      else end = Math.min(i + maxWords, words.length);
    }

    blocks.push(words.slice(i, end).join(" "));
    i = end;
  }

  return blocks.map(normalizeBlock).filter(Boolean);
}

/**
 * @param {string} rawScript
 * @returns {{ n: number, title: string, text: string, wordCount: number }[]}
 */
export function parseScriptToSlides(rawScript) {
  const cleaned = normalizeBlock(rawScript);
  if (!cleaned) return [];

  let blocks = splitExplicit(cleaned);

  // If still a single giant block, use semantic length breaks
  if (blocks.length <= 1 && wordCount(cleaned) > 160) {
    blocks = splitByWordBudget(cleaned, 100, 150);
  }

  if (!blocks.length) blocks = [cleaned];

  return blocks.map((text, i) => ({
    n: i + 1,
    title: `Slide ${i + 1}`,
    text,
    wordCount: wordCount(text),
  }));
}

/**
 * Build deck slides compatible with the Crowdwork store (no PDF images).
 * Uses a dark placeholder dataURL so the stage still has a visual plane.
 */
export function slidesFromParsedScript(parsed, deckTitle = "Pasted script") {
  return parsed.map((block) => {
    const image = makePlaceholderSlide(block.title, block.text);
    return {
      n: block.n,
      text: block.text,
      imageDisplay: image,
      imageApi: image,
      fromScript: true,
    };
  });
}

function makePlaceholderSlide(title, body) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Dark stage card
  const grad = ctx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#14161a");
  grad.addColorStop(1, "#0c0d10");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1280, 720);

  // Electric yellow accent rule
  ctx.fillStyle = "#FFD60A";
  ctx.fillRect(64, 72, 80, 4);

  ctx.fillStyle = "#F2EDE3";
  ctx.font = "600 48px Instrument Sans, system-ui, sans-serif";
  ctx.fillText(title, 64, 140);

  ctx.fillStyle = "#96938B";
  ctx.font = "28px Instrument Sans, system-ui, sans-serif";
  const lines = wrapText(ctx, body.replace(/\s+/g, " ").trim(), 1150, 12);
  let y = 210;
  for (const line of lines) {
    ctx.fillText(line, 64, y);
    y += 40;
  }

  return canvas.toDataURL("image/jpeg", 0.85);
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length > 0 && lines.length >= maxLines) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length > 3 ? `${last.slice(0, -3)}…` : `${last}…`;
  }
  return lines;
}

const ScriptParserService = {
  parseScriptToSlides,
  slidesFromParsedScript,
  wordCount,
};

export default ScriptParserService;
