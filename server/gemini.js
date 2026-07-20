import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseJsonLoose } from "./prompts.js";

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  // gemini-2.5-flash returns 404 for many new API keys — skip it
  "gemini-2.5-flash-lite",
].filter(Boolean);

const UNIQUE_MODELS = [...new Set(MODEL_CANDIDATES)];

export function getGeminiModel(systemInstruction, modelName) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: modelName || UNIQUE_MODELS[0] || "gemini-flash-latest",
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  });
}

function stripDataUrl(image) {
  if (!image) return null;
  const idx = image.indexOf("base64,");
  return idx >= 0 ? image.slice(idx + 7) : image;
}

export function slideParts(slide) {
  const parts = [
    {
      text: `Slide ${slide.n}\nExtracted text: ${slide.text || "(none — image-heavy slide)"}`,
    },
  ];
  if (slide.image) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: stripDataUrl(slide.image),
      },
    });
  }
  return parts;
}

function withTimeout(promise, ms, label = "Gemini request") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)
        ),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function generateOnce(model, parts, config, timeoutMs) {
  const result = await withTimeout(
    model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: config,
    }),
    timeoutMs,
    "Script generation"
  );
  const text = result.response.text();
  try {
    return parseJsonLoose(text);
  } catch {
    const retry = await withTimeout(
      model.generateContent({
        contents: [
          { role: "user", parts },
          {
            role: "user",
            parts: [
              {
                text: "Your previous output was not valid JSON. Return only the JSON object matching the schema. Keep each slide script short (spoken length only).",
              },
            ],
          },
        ],
        generationConfig: config,
      }),
      timeoutMs,
      "Script generation retry"
    );
    return parseJsonLoose(retry.response.text());
  }
}

/**
 * @param {ReturnType<typeof getGeminiModel>} _model unused — kept for call-site compat
 * @param {object[]} parts
 * @param {{ temperature?: number, maxOutputTokens?: number, timeoutMs?: number, systemInstruction?: string }} [opts]
 */
export async function generateJson(_model, parts, opts = {}) {
  const config = {
    temperature: opts.temperature ?? 0.55,
    maxOutputTokens: opts.maxOutputTokens ?? 8000,
    responseMimeType: "application/json",
  };
  const timeoutMs = opts.timeoutMs ?? 75000;
  const systemInstruction = opts.systemInstruction;

  let lastErr = null;
  let quotaErr = null;
  for (const modelName of UNIQUE_MODELS) {
    try {
      const model = getGeminiModel(systemInstruction, modelName);
      console.log(`[gemini] generateJson via ${modelName}`);
      return await generateOnce(model, parts, config, timeoutMs);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(`[gemini] model ${modelName} failed:`, lastErr.message);
      const msg = lastErr.message || "";
      if (/quota|billing|plan and billing/i.test(msg)) {
        quotaErr = lastErr;
        // Free-tier / billing blocks usually apply project-wide — fail fast to allow Groq fallback
        break;
      }
      if (/api.?key|is not set|unauthorized|forbidden/i.test(msg)) break;
      // Skip missing model ids quickly
      if (/404|not found|not supported/i.test(msg)) continue;
    }
  }
  // Prefer quota/billing signal over a trailing 404 from a bad model id
  throw quotaErr || lastErr || new Error("Script generation failed.");
}
