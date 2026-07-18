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

async function generateBatch(body, batchSlides, batchLabel) {
  const model = getGeminiModel(SCRIPT_SYSTEM_PROMPT);
  const parts = [
    {
      text: `${globalContext(body)}

${batchLabel}

Full deck outline (for coherent time allocation):
${buildOutline(body.slides)}

Return JSON:
{
  "slides": [
    { "n": 1, "script": "spoken text", "seconds": 45, "tip": "delivery note" }
  ]
}
Only include slides in this batch.`,
    },
  ];
  for (const slide of batchSlides) parts.push(...slideParts(slide));
  const parsed = await generateJson(model, parts, {
    temperature: 0.7,
    maxOutputTokens: 8000,
  });
  if (!parsed.slides || !Array.isArray(parsed.slides)) {
    throw new Error("Missing slides array");
  }
  return parsed.slides;
}

async function regenerateOne(body) {
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
    temperature: 0.7,
    maxOutputTokens: 2000,
  });
  return parsed.slides || [];
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
      } else if (body.slides.length <= 18) {
        all = await generateBatch(
          body,
          body.slides,
          `Write the full script for all ${body.slides.length} slides.`
        );
      } else {
        all = [];
        const BATCH = 12;
        for (let i = 0; i < body.slides.length; i += BATCH) {
          const batch = body.slides.slice(i, i + BATCH);
          const result = await generateBatch(
            body,
            batch,
            `Write scripts for slides ${batch[0].n}–${batch[batch.length - 1].n}. Keep total time coherent with the ${body.targetMinutes}-minute target across the whole deck.`
          );
          all = all.concat(result);
        }
      }

      all = all
        .map((s) => ({
          n: Number(s.n),
          script: String(s.script || ""),
          seconds: Math.max(1, Math.round(Number(s.seconds) || 30)),
          tip: String(s.tip || ""),
        }))
        .sort((a, b) => a.n - b.n);

      res.json({ slides: all });
    } catch (err) {
      console.error("[generate-script]", err);
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

      const model = getGeminiModel(FEEDBACK_SYSTEM_PROMPT);
      const parsed = await generateJson(
        model,
        [
          {
            text: `Target talk length: ${body.targetMinutes} minutes.
Respond in ${langLabel}.
${attentionBlock}

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
        { temperature: 0.4, maxOutputTokens: 2000 }
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

  router.post("/transcribe", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Missing audio file." });
      }
      const key = process.env.GROQ_WHISPER_API_KEY;
      if (!key) throw new Error("GROQ_WHISPER_API_KEY is not set.");

      const groq = new Groq({ apiKey: key });
      const lang = req.body.language === "ru" ? "ru" : "en";
      const file = new File(
        [req.file.buffer],
        req.file.originalname || "audio.webm",
        { type: req.file.mimetype || "audio/webm" }
      );

      const result = await groq.audio.transcriptions.create({
        file,
        model: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3",
        language: lang,
        response_format: "json",
      });

      res.json({ text: result.text || "" });
    } catch (err) {
      console.error("[transcribe]", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Transcription failed.",
      });
    }
  });

  router.post("/speak", async (req, res) => {
    try {
      const { text, language } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: "Missing text." });
      }
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set.");

      const openai = new OpenAI({ apiKey: key });
      const voice = language === "ru" ? "nova" : "alloy";
      const speech = await openai.audio.speech.create({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice,
        input: String(text).slice(0, 4096),
        response_format: "mp3",
      });

      const buf = Buffer.from(await speech.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (err) {
      console.error("[speak]", err);
      // fallback model name if mini-tts unavailable
      try {
        if (String(err?.message || "").includes("model")) {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const speech = await openai.audio.speech.create({
            model: "tts-1",
            voice: req.body?.language === "ru" ? "nova" : "alloy",
            input: String(req.body.text).slice(0, 4096),
            response_format: "mp3",
          });
          const buf = Buffer.from(await speech.arrayBuffer());
          res.setHeader("Content-Type", "audio/mpeg");
          return res.send(buf);
        }
      } catch (err2) {
        console.error("[speak fallback]", err2);
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : "TTS failed.",
      });
    }
  });

  /**
   * Silence Sentinel critical path — Gemini forces a crowd-state override
   * and optionally an investor heckle line for TTS.
   */
  router.post("/heckle", async (req, res) => {
    try {
      const body = req.body || {};
      const silenceSeconds = Number(body.silenceSeconds) || 5;
      const language = body.language === "ru" ? "ru" : "en";
      const langLabel = language === "ru" ? "Russian" : "English";
      const slideScript = body.slideScript || "";
      const transcript = body.transcript || "";

      const model = getGeminiModel(
        `You simulate a live pitch room. Output a single JSON object. No markdown fences.`
      );

      const parsed = await generateJson(
        model,
        [
          {
            text: `The presenter went silent for ${silenceSeconds} seconds during a ${langLabel} pitch.
Slide script: ${slideScript || "(none)"}
Transcript so far: ${transcript || "(nothing)"}

Return ONLY this JSON shape:
{"CROWD_STATE":"HECKLE","heckleLine":"short investor interruption max 16 words","stageDirection":"crowd sighs"}
Use CROWD_STATE HECKLE if silence>=5 else RESTLESS. heckleLine in ${langLabel}.`,
          },
        ],
        { temperature: 0.5, maxOutputTokens: 300 }
      );

      const state = String(parsed.CROWD_STATE || parsed.crowd_state || "RESTLESS")
        .toUpperCase()
        .trim();
      const allowed = new Set(["RESTLESS", "HECKLE", "CONFUSED", "EXPECTANT"]);
      const crowdState = allowed.has(state) ? state : "RESTLESS";
      const heckleLine = String(parsed.heckleLine || parsed.heckle_line || "").trim();
      const stageDirection = String(
        parsed.stageDirection || parsed.stage_direction || ""
      ).trim();

      let audioBase64 = null;
      if (heckleLine && process.env.OPENAI_API_KEY) {
        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          let speech;
          try {
            speech = await openai.audio.speech.create({
              model: process.env.OPENAI_TTS_MODEL || "tts-1",
              voice: language === "ru" ? "nova" : "onyx",
              input: heckleLine.slice(0, 200),
              response_format: "mp3",
            });
          } catch {
            speech = await openai.audio.speech.create({
              model: "tts-1",
              voice: "onyx",
              input: heckleLine.slice(0, 200),
              response_format: "mp3",
            });
          }
          const buf = Buffer.from(await speech.arrayBuffer());
          audioBase64 = buf.toString("base64");
        } catch (ttsErr) {
          console.warn("[heckle tts]", ttsErr.message || ttsErr);
        }
      }

      res.json({
        CROWD_STATE: crowdState,
        heckleLine,
        stageDirection,
        audioBase64,
      });
    } catch (err) {
      console.error("[heckle]", err);
      // Deterministic fallback so silence never freezes the room
      const ru = req.body?.language === "ru";
      const lines = ru
        ? [
            "Мы вас слушаем — продолжайте.",
            "Есть вопрос по цифрам — вы с нами?",
            "Тишина в зале. Что дальше?",
          ]
        : [
            "We're waiting — take us somewhere.",
            "Quick check — what's the ask?",
            "Still with us? Hit the next beat.",
            "Dead air. Where does this go?",
          ];
      const heckleLine = lines[Math.floor(Math.random() * lines.length)];
      let audioBase64 = null;
      if (process.env.OPENAI_API_KEY) {
        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const speech = await openai.audio.speech.create({
            model: "tts-1",
            voice: ru ? "nova" : "onyx",
            input: heckleLine,
            response_format: "mp3",
          });
          audioBase64 = Buffer.from(await speech.arrayBuffer()).toString(
            "base64"
          );
        } catch {
          /* optional */
        }
      }
      res.json({
        CROWD_STATE: Number(req.body?.silenceSeconds) >= 5 ? "HECKLE" : "RESTLESS",
        heckleLine,
        stageDirection: "crowd sighs and checks watches",
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
