import { Router } from "express";
import multer from "multer";
import Groq from "groq-sdk";
import OpenAI from "openai";
import {
  FEEDBACK_SYSTEM_PROMPT,
  OBJECTIONS_SYSTEM_PROMPT,
  SCRIPT_SYSTEM_PROMPT,
  parseJsonLoose,
} from "./prompts.js";
import { generateJson, getGeminiModel, slideParts } from "./gemini.js";
import {
  generateBatchViaGroq,
  hasGroqLlm,
  regenerateOneViaGroq,
} from "./groqScript.js";
import { buildMockHeckle } from "./heckleFallback.js";
import { toWhisperWav } from "./audioConvert.js";
import {
  inspectRateLimitError,
  sendRateLimitResponse,
} from "./rateLimit.js";

/** Extract last N spoken words for heckle mocking */
function recentSpokenPhrase(text, maxWords = 8) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  return words.slice(-Math.min(maxWords, words.length)).join(" ");
}

/**
 * OpenAI TTS for heckles — prefer expressive gpt-4o-mini-tts over robotic tts-1.
 */
async function synthesizeHeckleAudio(heckleLine, language) {
  if (!heckleLine || !process.env.OPENAI_API_KEY) return null;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const voice =
      language === "ru"
        ? process.env.OPENAI_HECKLE_VOICE_RU || "nova"
        : process.env.OPENAI_HECKLE_VOICE || "echo";
    const input = heckleLine.slice(0, 220);
    const primary = {
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice,
      input,
      response_format: "mp3",
      // Style cue — supported on gpt-4o-mini-tts
      instructions:
        "Speak like a skeptical live investor interrupting from the audience. Natural, slightly sarcastic, conversational — not a calm announcer. Short punchy delivery.",
    };
    let speech;
    try {
      speech = await openai.audio.speech.create(primary);
    } catch {
      speech = await openai.audio.speech.create({
        model: "tts-1-hd",
        voice: language === "ru" ? "nova" : "echo",
        input,
        response_format: "mp3",
        speed: 1.08,
      });
    }
    const buf = Buffer.from(await speech.arrayBuffer());
    return buf.toString("base64");
  } catch (ttsErr) {
    console.warn("[heckle tts]", ttsErr.message || ttsErr);
    return null;
  }
}

async function generateHeckleViaGroq({
  silenceSeconds,
  langLabel,
  language,
  slideScript,
  transcript,
  recentWords,
  fillerTotal,
  deliveryState,
  wpm,
}) {
  const key = process.env.GROQ_LLM_API_KEY;
  if (!key) throw new Error("GROQ_LLM_API_KEY is not set.");
  const groq = new Groq({ apiKey: key });
  const echo = recentWords || recentSpokenPhrase(transcript, 8);
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile",
    temperature: 0.75,
    max_tokens: 220,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a rude-but-fair investor heckling from the audience. Output JSON only. Mock by echoing the speaker's recent words in a bad/sarcastic tone. Never be supportive.",
      },
      {
        role: "user",
        content: `Presenter silent ${silenceSeconds}s. Language: ${langLabel}.
Their recent spoken words (MUST twist/echo these): "${echo || "(none)"}"
Full transcript so far: ${transcript || "(nothing)"}
Slide script: ${slideScript || "(none)"}
Fillers=${fillerTotal}, delivery=${deliveryState}, WPM=${wpm || "n/a"}.

Rules for heckleLine:
- Max 16 words, spoken aloud in ${langLabel}.
- MUST quote or parody 2–6 of their recent words (or closest idea) in a mocking tone.
- Example vibe: "Oh, 'scale globally' — with what money?" / "«масштабируемся» — на чьи деньги?"
- Do NOT invent a generic investor question that ignores what they said.

Return ONLY:
{"CROWD_STATE":"HECKLE","heckleLine":"...","stageDirection":"crowd snickers"}
CROWD_STATE HECKLE if silence>=5 else RESTLESS.`,
      },
    ],
  });
  return parseJsonLoose(completion.choices[0]?.message?.content || "{}");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function buildOutline(slides) {
  return slides
    .map((s) => `${s.n}. ${(s.text || "(image)").slice(0, 80)}`)
    .join("\n");
}

function globalContext(body) {
  return [
    `Deck title: ${body.deckTitle}`,
    `Purpose: ${body.purpose}`,
    body.audience ? `Audience: ${body.audience}` : null,
    body.notes ? `Notes: ${body.notes}` : null,
    `Tone: ${body.tone}`,
    `Target duration: ${body.targetMinutes} minutes`,
    `Language: ${body.language === "ru" ? "Russian" : "English"}`,
    `Total slides in deck: ${body.slides?.length || 0}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateBatchGemini(body, batchSlides, batchLabel) {
  const model = getGeminiModel(SCRIPT_SYSTEM_PROMPT);
  const parts = [
    {
      text: `${globalContext(body)}

${batchLabel}

Full deck outline (for coherent time allocation):
${buildOutline(body.slides)}

Budget: ~${Math.max(1, Math.round((body.targetMinutes * 60) / Math.max(1, body.slides.length)))}s avg/slide.
Each script: 2–4 spoken sentences max. Stop after this batch.

Return compact JSON only:
{"slides":[{"n":1,"script":"...","seconds":45,"tip":"..."}]}
Batch slides only. No extra keys.`,
    },
  ];
  for (const slide of batchSlides) parts.push(...slideParts(slide));
  const parsed = await generateJson(model, parts, {
    systemInstruction: SCRIPT_SYSTEM_PROMPT,
    temperature: 0.55,
    // Tight token budget — short spoken lines, faster streams
    maxOutputTokens: Math.min(4000, 600 + batchSlides.length * 220),
    timeoutMs: Math.min(75000, 25000 + batchSlides.length * 3000),
  });
  if (!parsed.slides || !Array.isArray(parsed.slides)) {
    throw new Error("Missing slides array");
  }
  return parsed.slides;
}

async function generateBatch(body, batchSlides, batchLabel) {
  try {
    return await generateBatchGemini(body, batchSlides, batchLabel);
  } catch (err) {
    const rate = inspectRateLimitError(err);
    if (!hasGroqLlm() || !(rate.isHardFault || rate.isRateLimit)) throw err;
    console.warn(
      "[generate-script] Gemini unavailable — falling back to Groq LLM:",
      rate.message.slice(0, 160)
    );
    return generateBatchViaGroq(
      body,
      batchSlides,
      batchLabel,
      globalContext(body),
      buildOutline(body.slides)
    );
  }
}

/** Keep spoken scripts pitch-length, not essay-length. */
function clampSpokenScript(script, seconds) {
  const text = String(script || "").trim();
  if (!text) return "";
  const maxWords = Math.max(40, Math.round((Number(seconds) || 30) * 2.7));
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  // Prefer cutting at a sentence boundary near the budget
  const sliced = words.slice(0, maxWords).join(" ");
  const sentenceCut = sliced.match(/^[\s\S]+?[.!?](?=\s|$)/);
  return (sentenceCut ? sentenceCut[0] : sliced).trim();
}

async function regenerateOneGemini(body) {
  const target = body.regenerate;
  const slide = body.slides.find((s) => s.n === target.n);
  if (!slide) throw new Error(`Slide ${target.n} not found`);
  const neighbors =
    body.neighborContext
      ?.map((n) => `Slide ${n.n} script: ${n.script}`)
      .join("\n\n") || "(none)";

  const model = getGeminiModel(SCRIPT_SYSTEM_PROMPT);
  const parts = [
    {
      text: `${globalContext(body)}

Regenerate ONLY slide ${target.n}.
Instruction: ${target.instruction}

Surrounding slide scripts for context:
${neighbors}

Return JSON with a slides array containing exactly one object for slide ${target.n}.`,
    },
    ...slideParts(slide),
  ];
  const parsed = await generateJson(model, parts, {
    systemInstruction: SCRIPT_SYSTEM_PROMPT,
    temperature: 0.7,
    maxOutputTokens: 2000,
  });
  return parsed.slides || [];
}

async function regenerateOne(body) {
  try {
    return await regenerateOneGemini(body);
  } catch (err) {
    const rate = inspectRateLimitError(err);
    if (!hasGroqLlm() || !(rate.isHardFault || rate.isRateLimit)) throw err;
    console.warn(
      "[generate-script] Gemini regenerate unavailable — falling back to Groq LLM:",
      rate.message.slice(0, 160)
    );
    return regenerateOneViaGroq(body, globalContext(body));
  }
}

export function createApiRouter() {
  const router = Router();

  router.post("/generate-script", async (req, res) => {
    try {
      const body = req.body;
      if (!body?.slides?.length || !body.tone || !body.targetMinutes) {
        return res.status(400).json({
          error: "Missing required fields: slides, tone, targetMinutes.",
        });
      }

      let all;
      if (body.regenerate) {
        all = await regenerateOne(body);
      } else if (body.slides.length <= 14) {
        all = await generateBatch(
          body,
          body.slides,
          `Write the full script for all ${body.slides.length} slides.`
        );
      } else {
        // Parallel batches (concurrency 2) — large decks no longer wait serially
        const BATCH = 10;
        const jobs = [];
        for (let i = 0; i < body.slides.length; i += BATCH) {
          const batch = body.slides.slice(i, i + BATCH);
          jobs.push(
            generateBatch(
              body,
              batch,
              `Write scripts for slides ${batch[0].n}–${batch[batch.length - 1].n}. Keep total time coherent with the ${body.targetMinutes}-minute target across the whole deck.`
            )
          );
        }
        const CONCURRENCY = 2;
        all = [];
        for (let i = 0; i < jobs.length; i += CONCURRENCY) {
          const chunk = await Promise.all(jobs.slice(i, i + CONCURRENCY));
          for (const part of chunk) all = all.concat(part);
        }
      }

      all = all
        .map((s) => {
          const seconds = Math.max(1, Math.round(Number(s.seconds) || 30));
          const script = clampSpokenScript(s.script, seconds);
          return {
            n: Number(s.n),
            script,
            seconds,
            tip: String(s.tip || "").slice(0, 180),
          };
        })
        .sort((a, b) => a.n - b.n);

      // Drop hallucinated extras outside the requested slide set
      if (!body.regenerate) {
        const allowed = new Set(body.slides.map((s) => Number(s.n)));
        all = all.filter((s) => allowed.has(s.n));
      }

      res.json({ slides: all });
    } catch (err) {
      console.error("[generate-script]", err);
      const rate = inspectRateLimitError(err);
      if (rate.isHardFault) {
        // Quota / billing / API key — surface clearly, do not spin the loading bar
        return res.status(402).json({
          error:
            "Script generation is blocked by the AI provider (API key, quota, or billing). Check GEMINI_API_KEY and your plan, then try again.",
          code: "PROVIDER_QUOTA",
          detail: rate.message.slice(0, 280),
        });
      }
      if (rate.isRateLimit) {
        return sendRateLimitResponse(res, err);
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : "Script generation failed.",
      });
    }
  });

  router.post("/feedback", async (req, res) => {
    try {
      const body = req.body;
      if (!body?.slides?.length || !body.targetMinutes) {
        return res
          .status(400)
          .json({ error: "Missing required fields: slides, targetMinutes." });
      }
      const langLabel = body.language === "ru" ? "Russian" : "English";
      const slideBlocks = body.slides
        .map(
          (s) =>
            `Slide ${s.n}
Target: ${s.targetSeconds}s | Actual: ${s.actualSeconds}s
Script: ${s.script}
Transcript: ${s.transcript || "(silent / no speech captured)"}`
        )
        .join("\n\n");

      const att = body.attention;
      const attentionBlock = att
        ? `\nAudience attention: avg ${att.averageAttention}/100 (final ${att.attention}, low ${att.lowAttention}). Long pauses: ${att.pauses}. Filler hits during pitch: ${att.fillerHits}.`
        : "";

      const vocal = body.vocalMetrics || {};
      const fillerBreakdown = vocal.fillerCounts
        ? Object.entries(vocal.fillerCounts)
            .map(([w, n]) => `${w}×${n}`)
            .join(", ")
        : "";
      const vocalBlock = `\nVocal metrics (text-driven from Whisper): WPM ${
        vocal.wpm ?? body.wpm ?? "n/a"
      }; delivery state ${vocal.deliveryState || "STEADY"}; parasite/filler total ${
        vocal.fillerTotal ?? att?.fillerHits ?? 0
      }${fillerBreakdown ? ` (${fillerBreakdown})` : ""}. Flag rushed (>160 WPM), monotone, and filler habits in improvements when present.`;

      const model = getGeminiModel(FEEDBACK_SYSTEM_PROMPT);
      const parsed = await generateJson(
        model,
        [
          {
            text: `Target talk length: ${body.targetMinutes} minutes.
Respond in ${langLabel}.
${attentionBlock}
${vocalBlock}

Rehearsal data:
${slideBlocks}

Return JSON:
{
  "summary": "one line verdict",
  "strengths": ["...", "...", "..."],
  "improvements": ["...", "...", "..."]
}`,
          },
        ],
        {
          systemInstruction: FEEDBACK_SYSTEM_PROMPT,
          temperature: 0.4,
          maxOutputTokens: 2000,
        }
      );

      const strengths = (parsed.strengths || []).slice(0, 3);
      const improvements = (parsed.improvements || []).slice(0, 3);
      while (strengths.length < 3) strengths.push("Solid pacing on quieter slides.");
      while (improvements.length < 3)
        improvements.push("Tighten transitions between dense slides.");

      res.json({
        summary: parsed.summary || "Solid run — review the notes below.",
        strengths,
        improvements,
      });
    } catch (err) {
      console.error("[feedback]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Feedback generation failed.",
      });
    }
  });

  router.post("/objections", async (req, res) => {
    try {
      const body = req.body;
      if (!body?.slides?.length) {
        return res.status(400).json({ error: "Missing slides." });
      }
      const key = process.env.GROQ_LLM_API_KEY;
      if (!key) throw new Error("GROQ_LLM_API_KEY is not set.");

      const groq = new Groq({ apiKey: key });
      const langLabel = body.language === "ru" ? "Russian" : "English";
      const deck = body.slides
        .map(
          (s) =>
            `Slide ${s.n}: ${s.script}${
              s.transcript ? `\nSaid: ${s.transcript}` : ""
            }`
        )
        .join("\n\n");

      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.6,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OBJECTIONS_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Purpose: ${body.purpose || "pitch"}
Language: ${langLabel}
Audience: ${body.audience || "general"}

Pitch:
${deck}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const parsed = parseJsonLoose(raw);
      const questions = (parsed.questions || []).slice(0, 5);
      res.json({ questions });
    } catch (err) {
      console.error("[objections]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Objections failed.",
      });
    }
  });

  router.post(
    "/transcribe",
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const uploaded =
          req.files?.file?.[0] || req.files?.audio?.[0] || req.file;
        if (!uploaded) {
          return res.status(400).json({ error: "Missing audio file." });
        }
        if (!uploaded.size) {
          return res.status(400).json({ error: "Empty audio payload." });
        }

        const key = process.env.GROQ_WHISPER_API_KEY;
        if (!key) throw new Error("GROQ_WHISPER_API_KEY is not set.");

        const groq = new Groq({ apiKey: key });
        const lang = req.body.language === "ru" ? "ru" : "en";
        const rawMime = String(
          req.body.mimeType || uploaded.mimetype || "audio/webm"
        );
        const mimeType = rawMime.split(";")[0].trim() || "audio/webm";
        const filename = uploaded.originalname || "recording.webm";
        const ext =
          (filename.split(".").pop() || mimeType.split("/")[1] || "webm")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "webm";

        console.log(
          `[transcribe] received mimeType=${mimeType} size=${uploaded.size}B file=${filename} lang=${lang}`
        );

        // Browser MediaRecorder WebM often has broken duration → Groq "too short".
        // Normalize to 16kHz mono WAV before Whisper.
        let whisperBuf = uploaded.buffer;
        let whisperMime = mimeType;
        let whisperName = filename;
        try {
          const wav = await toWhisperWav(uploaded.buffer, ext);
          whisperBuf = wav.buffer;
          whisperMime = wav.mimeType;
          whisperName = wav.filename;
          console.log(
            `[transcribe] normalized → wav size=${wav.buffer.length}B duration≈${wav.durationSec.toFixed(2)}s`
          );
          if (wav.durationSec < 0.05 && wav.buffer.length < 2000) {
            return res.status(400).json({
              error:
                "Audio slice had no usable speech frames (duration ~0s). Keep speaking for a full second.",
              text: "",
            });
          }
        } catch (convErr) {
          console.warn(
            "[transcribe] wav convert failed, trying raw upload:",
            convErr.message || convErr
          );
        }

        const file = new File([whisperBuf], whisperName, {
          type: whisperMime,
        });

        // Seed Whisper with slide vocabulary so product names / script words stick
        const promptRaw = String(req.body.prompt || req.body.whisperPrompt || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 800);

        const whisperOpts = {
          file,
          model: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3",
          language: lang,
          response_format: "json",
          temperature: 0,
        };
        if (promptRaw) whisperOpts.prompt = promptRaw;

        const result = await groq.audio.transcriptions.create(whisperOpts);

        const text = result.text || "";
        const trimmed = String(text).trim();
        // Drop classic empty-slice hallucinations before they poison live matching
        const hallucination =
          /^(?:thanks?\s+for\s+watching|thank\s+you\s+for\s+watching|продолжение\s+следует|субтитры\s+создал|please\s+subscribe|♪+|\[(?:music|silence|blank_audio)\])\.?$/iu.test(
            trimmed
          );
        if (hallucination) {
          console.warn(`[transcribe] dropped hallucination: ${JSON.stringify(trimmed)}`);
          return res.json({ text: "" });
        }
        console.log(
          `[transcribe] whisper words=${trimmed ? trimmed.split(/\s+/).length : 0} prompt=${promptRaw ? "yes" : "no"} text=${JSON.stringify(trimmed.slice(0, 80))}`
        );
        res.json({ text: trimmed });
      } catch (err) {
        console.error("[transcribe]", err);
        const msg = err instanceof Error ? err.message : "Transcription failed.";
        const tooShort = /too short/i.test(msg);
        res.status(tooShort ? 400 : 500).json({
          error: tooShort
            ? "Whisper rejected the audio slice as too short. Try speaking continuously for 2+ seconds."
            : msg,
          text: "",
        });
      }
    }
  );

  router.post("/speak", async (req, res) => {
    try {
      const { text, language, speed } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Missing text." });
      }
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set.");

      const openai = new OpenAI({ apiKey: key });
      const voice = language === "ru" ? "nova" : "alloy";
      const pace =
        speed != null
          ? Math.min(1.5, Math.max(0.7, Number(speed) || 1))
          : undefined;
      const speechOpts = {
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice,
        input: String(text).slice(0, 4096),
        response_format: "mp3",
      };
      // speed is supported on tts-1 / tts-1-hd; ignore if model rejects it
      if (pace != null) speechOpts.speed = pace;

      let speech;
      try {
        speech = await openai.audio.speech.create(speechOpts);
      } catch (modelErr) {
        const fallback = {
          model: "tts-1",
          voice,
          input: String(text).slice(0, 4096),
          response_format: "mp3",
        };
        if (pace != null) fallback.speed = pace;
        speech = await openai.audio.speech.create(fallback);
        if (!String(modelErr?.message || "").includes("model")) {
          console.warn("[speak] primary TTS failed, used tts-1", modelErr.message);
        }
      }

      const buf = Buffer.from(await speech.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (err) {
      console.error("[speak]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "TTS failed.",
      });
    }
  });

  /**
   * Pre-pitch pace tuner — recommend a target WPM, or judge a chosen pace
   * as better / worse / similar vs that recommendation.
   */
  router.post("/pace-advice", async (req, res) => {
    try {
      const body = req.body || {};
      const mode = body.mode === "evaluate" ? "evaluate" : "recommend";
      const tone = body.tone || "confident";
      const purpose = body.purpose || "pitch";
      const audience = body.audience || "general";
      const language = body.language === "ru" ? "ru" : "en";
      const langLabel = language === "ru" ? "Russian" : "English";
      const targetMinutes = Number(body.targetMinutes) || 10;
      const chosenWpm = Number(body.chosenWpm) || 0;
      const recommendedWpm = Number(body.recommendedWpm) || 0;

      const key = process.env.GROQ_LLM_API_KEY;
      if (!key) {
        return res.status(503).json({ error: "GROQ_LLM_API_KEY is not set." });
      }

      const groq = new Groq({ apiKey: key });
      let userContent;
      if (mode === "evaluate") {
        userContent = `Mode: evaluate
Language: ${langLabel}
Tone: ${tone}
Purpose: ${purpose}
Audience: ${audience}
Duration: ${targetMinutes} minutes
AI recommended WPM: ${recommendedWpm || "unknown"}
User chose WPM: ${chosenWpm}

Return ONLY JSON:
{"verdict":"better"|"worse"|"similar","message":"1 short coaching sentence about whether this pace helps or hurts for THIS pitch"}
Verdict guide: within ~8 of recommended → similar; slightly faster (up to ~22) for energetic/sales rooms → better; much faster or much slower → worse. Be specific.`;
      } else {
        userContent = `Mode: recommend
Language: ${langLabel}
Tone: ${tone}
Purpose: ${purpose}
Audience: ${audience}
Duration: ${targetMinutes} minutes
Deck title: ${body.deckTitle || ""}
Script sample: ${String(body.scriptSample || "").slice(0, 500)}

Recommend a speaking pace (words per minute) for a live pitch rehearsal.
Prefer a brisk-but-clear steady band — modern pitches often sit ~145–170 WPM, not sluggish 120.
Energetic/sales/investor → higher; formal/training → lower. Clamp 120–200.

Return ONLY JSON:
{"recommendedWpm":number,"rationale":"1–2 short sentences why this pace fits"}`;
      }

      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.45,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a concise pitch coach for speaking pace. Output JSON only. No markdown.",
          },
          { role: "user", content: userContent },
        ],
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const parsed = parseJsonLoose(raw);

      if (mode === "evaluate") {
        const verdict = String(parsed.verdict || "similar")
          .toLowerCase()
          .trim();
        const allowed = new Set(["better", "worse", "similar"]);
        return res.json({
          mode: "evaluate",
          verdict: allowed.has(verdict) ? verdict : "similar",
          message: String(parsed.message || "").trim() ||
            "Hold near the recommended pace for steady attention.",
        });
      }

      let wpm = Math.round(Number(parsed.recommendedWpm) || 155);
      wpm = Math.min(200, Math.max(120, wpm));
      return res.json({
        mode: "recommend",
        recommendedWpm: wpm,
        rationale:
          String(parsed.rationale || "").trim() ||
          "Aim for a brisk, clear steady pace that keeps the room with you.",
      });
    } catch (err) {
      console.error("[pace-advice]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Pace advice failed.",
      });
    }
  });

  /**
   * Silence Sentinel — mock the speaker's recent words in a bad tone (+ TTS).
   * Gemini first, Groq on quota, local mimic as last resort.
   */
  router.post("/heckle", async (req, res) => {
    try {
      const body = req.body || {};
      const silenceSeconds = Number(body.silenceSeconds) || 5;
      const language = body.language === "ru" ? "ru" : "en";
      const langLabel = language === "ru" ? "Russian" : "English";
      const slideScript = body.slideScript || "";
      const transcript = body.transcript || "";
      const recentWords =
        String(body.recentWords || "").trim() ||
        recentSpokenPhrase(transcript, 8);
      const fillerTotal = Number(body.fillerTotal) || 0;
      const deliveryState = String(body.deliveryState || "STEADY").toUpperCase();
      const wpm = Number(body.wpm) || 0;

      let parsed = null;
      try {
        const model = getGeminiModel(
          `You are a rude-but-fair investor heckling from the audience. Output a single JSON object. No markdown fences. Mock by echoing the speaker's recent words.`
        );
        parsed = await generateJson(
          model,
          [
            {
              text: `Presenter silent ${silenceSeconds}s during a ${langLabel} pitch.
Their recent spoken words (MUST twist/echo these): "${recentWords || "(none)"}"
Transcript so far: ${transcript || "(nothing)"}
Slide script: ${slideScript || "(none)"}
Fillers=${fillerTotal}, delivery=${deliveryState}, WPM=${wpm || "n/a"}.

Rules for heckleLine:
- Max 16 words, in ${langLabel}.
- MUST quote or parody 2–6 of their recent words in a mocking / bad tone.
- Example: "Oh, 'scale globally' — with what money?"
- Do NOT invent a generic question that ignores what they said.

Return ONLY:
{"CROWD_STATE":"HECKLE","heckleLine":"...","stageDirection":"crowd snickers"}
CROWD_STATE HECKLE if silence>=5 else RESTLESS.`,
            },
          ],
          {
            systemInstruction: `You are a rude-but-fair investor heckling from the audience. Output JSON only. Mock by echoing their words.`,
            temperature: 0.7,
            maxOutputTokens: 300,
          }
        );
      } catch (geminiErr) {
        const rate = inspectRateLimitError(geminiErr);
        console.warn(
          "[heckle] Gemini failed — trying Groq:",
          rate.message.slice(0, 140)
        );
        if (hasGroqLlm()) {
          parsed = await generateHeckleViaGroq({
            silenceSeconds,
            langLabel,
            language,
            slideScript,
            transcript,
            recentWords,
            fillerTotal,
            deliveryState,
            wpm,
          });
        } else {
          throw geminiErr;
        }
      }

      const state = String(parsed.CROWD_STATE || parsed.crowd_state || "RESTLESS")
        .toUpperCase()
        .trim();
      const allowed = new Set(["RESTLESS", "HECKLE", "CONFUSED", "EXPECTANT"]);
      let crowdState = allowed.has(state) ? state : "RESTLESS";
      if (silenceSeconds >= 5 && crowdState === "RESTLESS") crowdState = "HECKLE";

      let heckleLine = String(parsed.heckleLine || parsed.heckle_line || "").trim();
      // If the model ignored the speaker, force a local mimic line
      const echoNeedle = recentWords
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 4);
      const lineLower = heckleLine.toLowerCase();
      const echoes =
        !recentWords ||
        echoNeedle.some((w) => lineLower.includes(w)) ||
        /["«].+["»]/.test(heckleLine);
      if (!heckleLine || (recentWords && !echoes)) {
        heckleLine = buildMockHeckle({
          transcript: recentWords || transcript,
          language,
          slideScript,
        });
      }

      const stageDirection = String(
        parsed.stageDirection || parsed.stage_direction || "crowd snickers"
      ).trim();

      const audioBase64 = await synthesizeHeckleAudio(heckleLine, language);

      res.json({
        CROWD_STATE: crowdState,
        heckleLine,
        stageDirection,
        audioBase64,
      });
    } catch (err) {
      console.error("[heckle]", err);
      const language = req.body?.language === "ru" ? "ru" : "en";
      const heckleLine = buildMockHeckle({
        transcript: req.body?.recentWords || req.body?.transcript,
        language,
        slideScript: req.body?.slideScript,
      });
      const audioBase64 = await synthesizeHeckleAudio(heckleLine, language);
      res.json({
        CROWD_STATE: Number(req.body?.silenceSeconds) >= 5 ? "HECKLE" : "RESTLESS",
        heckleLine,
        stageDirection: "crowd snickers and leans in",
        audioBase64,
        fallback: true,
      });
    }
  });

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      gemini: Boolean(process.env.GEMINI_API_KEY),
      groqWhisper: Boolean(process.env.GROQ_WHISPER_API_KEY),
      groqLlm: Boolean(process.env.GROQ_LLM_API_KEY),
      openaiTts: Boolean(process.env.OPENAI_API_KEY),
    });
  });

  return router;
}
