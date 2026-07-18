import OpenAI from "openai";

export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it in your Vercel project environment."
    );
  }
  return new OpenAI({ apiKey: key });
}

export const SCRIPT_SYSTEM_PROMPT = `You are an expert speechwriter and pitch coach. You turn slide decks into scripts people actually say out loud.

Rules:
- Write in spoken language: short sentences, contractions, first person. Never read the slide's bullet text back to the audience.
- Slide 1 opens with a hook — a question, a sharp fact, or a one-line story. The final slide lands the ask or call to action explicitly.
- Signpost transitions so consecutive slides flow as one talk, not separate captions.
- Allocate \`seconds\` per slide so the total lands within ±10% of the target duration. Weight content-heavy slides more; section dividers get 5–10 seconds.
- Match the requested tone and write the script entirely in the requested language.
- \`tip\` is one short practical delivery note per slide: where to pause, what to emphasize, when to look up from the screen.
- Output STRICT JSON only, matching the provided schema. No markdown, no commentary.`;

export const FEEDBACK_SYSTEM_PROMPT = `You are an honest, specific, kind pitch coach. Ground every point in the transcript-vs-script and timing data provided — name slide numbers. Respond in the script's language. Output STRICT JSON only with keys: summary (one line), strengths (exactly 3 strings), improvements (exactly 3 strings). No markdown, no commentary.`;

export function stripDataUrl(image?: string): string | undefined {
  if (!image) return undefined;
  const idx = image.indexOf("base64,");
  if (idx >= 0) return image.slice(idx + 7);
  return image;
}

export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model response was not JSON.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
