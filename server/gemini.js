import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseJsonLoose } from "./prompts.js";

export function getGeminiModel(systemInstruction) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    // gemini-2.5-flash is blocked for many new keys; flash-latest tracks current Flash.
    model: process.env.GEMINI_MODEL || "gemini-flash-latest",
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
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function generateJson(
  model,
  parts,
  { temperature, maxOutputTokens, timeoutMs = 75000 } = {}
) {
  const config = {
    temperature: temperature ?? 0.7,
    maxOutputTokens: maxOutputTokens ?? 8000,
    responseMimeType: "application/json",
  };

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
