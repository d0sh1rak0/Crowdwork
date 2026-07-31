/**
 * Groq LLM fallback for script generation when Gemini is quota/billing blocked.
 * Text-only (uses extracted slide text) — good enough to keep the product usable.
 */

import Groq from "groq-sdk";
import { SCRIPT_SYSTEM_PROMPT, parseJsonLoose } from "./prompts.js";

function getGroq() {
  const key = process.env.GROQ_LLM_API_KEY;
  if (!key) throw new Error("GROQ_LLM_API_KEY is not set.");
  return new Groq({ apiKey: key });
}

function modelName() {
  return process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile";
}

function slideTextBlock(slide) {
  const text = String(slide.text || "").trim();
  return `Slide ${slide.n}\nExtracted text: ${text || "(none — image-heavy slide; invent a short spoken bridge from context)"}`;
}

/**
 * @param {object} body generate-script request body
 * @param {object[]} batchSlides
 * @param {string} batchLabel
 * @param {string} globalContextStr
 * @param {string} outline
 */
export async function generateBatchViaGroq(
  body,
  batchSlides,
  batchLabel,
  globalContextStr,
  outline
) {
  const groq = getGroq();
  const avgSec = Math.max(
    1,
    Math.round((body.targetMinutes * 60) / Math.max(1, body.slides.length))
  );
  const userContent = `${globalContextStr}

${batchLabel}

Full deck outline (for coherent time allocation):
${outline}

Budget: ~${avgSec}s avg/slide.
Each script: 2–4 spoken sentences max. Stop after this batch.

Slides in this batch:
${batchSlides.map(slideTextBlock).join("\n\n")}

Return compact JSON only:
{"slides":[{"n":1,"script":"...","seconds":45,"tip":"..."}]}
Batch slides only. No extra keys.`;

  console.log(`[groq] generateBatch via ${modelName()} (${batchSlides.length} slides)`);
  const completion = await groq.chat.completions.create({
    model: modelName(),
    temperature: 0.55,
    max_tokens: Math.min(4000, 600 + batchSlides.length * 220),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCRIPT_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  const parsed = parseJsonLoose(raw);
  if (!parsed.slides || !Array.isArray(parsed.slides)) {
    throw new Error("Missing slides array (Groq)");
  }
  return parsed.slides;
}

/**
 * @param {object} body
 * @param {string} globalContextStr
 */
export async function regenerateOneViaGroq(body, globalContextStr) {
  const target = body.regenerate;
  const slide = body.slides.find((s) => s.n === target.n);
  if (!slide) throw new Error(`Slide ${target.n} not found`);
  const neighbors =
    body.neighborContext
      ?.map((n) => `Slide ${n.n} script: ${n.script}`)
      .join("\n\n") || "(none)";

  const groq = getGroq();
  const userContent = `${globalContextStr}

Regenerate ONLY slide ${target.n}.
Instruction: ${target.instruction}

Surrounding slide scripts for context:
${neighbors}

${slideTextBlock(slide)}

Return JSON with a slides array containing exactly one object for slide ${target.n}.`;

  console.log(`[groq] regenerateOne via ${modelName()} (slide ${target.n})`);
  const completion = await groq.chat.completions.create({
    model: modelName(),
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCRIPT_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  const parsed = parseJsonLoose(raw);
  return parsed.slides || [];
}

export function hasGroqLlm() {
  return Boolean(process.env.GROQ_LLM_API_KEY);
}
