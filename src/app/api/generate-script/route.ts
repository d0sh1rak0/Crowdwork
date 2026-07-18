import { NextResponse } from "next/server";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  SCRIPT_SYSTEM_PROMPT,
  getOpenAI,
  parseJsonLoose,
  stripDataUrl,
} from "@/lib/openai";
import type {
  GenerateScriptRequest,
  GenerateScriptResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCHEMA_HINT = `{
  "slides": [
    { "n": 1, "script": "spoken text", "seconds": 45, "tip": "delivery note" }
  ]
}`;

function buildOutline(slides: GenerateScriptRequest["slides"]): string {
  return slides
    .map((s) => `${s.n}. ${(s.text || "(image)").slice(0, 80)}`)
    .join("\n");
}

function slideUserContent(
  slide: GenerateScriptRequest["slides"][number]
): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Slide ${slide.n}\nExtracted text: ${slide.text || "(none — image-heavy slide)"}`,
    },
  ];
  if (slide.image) {
    const b64 = stripDataUrl(slide.image)!;
    parts.push({
      type: "image_url",
      image_url: {
        url: slide.image.startsWith("data:")
          ? slide.image
          : `data:image/jpeg;base64,${b64}`,
        detail: "low",
      },
    });
  }
  return parts;
}

function globalContext(body: GenerateScriptRequest): string {
  return [
    `Deck title: ${body.deckTitle}`,
    `Purpose: ${body.purpose}`,
    body.audience ? `Audience: ${body.audience}` : null,
    body.notes ? `Notes: ${body.notes}` : null,
    `Tone: ${body.tone}`,
    `Target duration: ${body.targetMinutes} minutes`,
    `Language: ${body.language === "ru" ? "Russian" : "English"}`,
    `Total slides in deck: ${body.slides.length}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callModel(
  messages: ChatCompletionMessageParam[],
  retry = false
): Promise<GenerateScriptResponse> {
  const openai = getOpenAI();
  const finalMessages = retry
    ? [
        ...messages,
        {
          role: "user" as const,
          content:
            "Your previous output was not valid JSON. Return only the JSON object matching the schema.",
        },
      ]
    : messages;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    max_tokens: 8000,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: finalMessages,
  });

  const raw = completion.choices[0]?.message?.content || "";
  try {
    const parsed = parseJsonLoose<GenerateScriptResponse>(raw);
    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error("Missing slides array");
    }
    return parsed;
  } catch (err) {
    if (!retry) return callModel(messages, true);
    throw err;
  }
}

async function generateBatch(
  body: GenerateScriptRequest,
  batchSlides: GenerateScriptRequest["slides"],
  batchLabel: string
): Promise<GenerateScriptResponse> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SCRIPT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${globalContext(body)}

${batchLabel}

Full deck outline (for coherent time allocation):
${buildOutline(body.slides)}

Return JSON matching this schema for ONLY the slides in this batch:
${SCHEMA_HINT}`,
        },
      ],
    },
  ];

  // Append each slide as its own multimodal user message block via a combined content array
  const slideParts: ChatCompletionContentPart[] = [];
  for (const slide of batchSlides) {
    slideParts.push(...slideUserContent(slide));
  }
  messages.push({ role: "user", content: slideParts });

  return callModel(messages);
}

async function regenerateOne(
  body: GenerateScriptRequest
): Promise<GenerateScriptResponse> {
  const target = body.regenerate!;
  const slide = body.slides.find((s) => s.n === target.n);
  if (!slide) {
    throw new Error(`Slide ${target.n} not found`);
  }

  const neighbors =
    body.neighborContext
      ?.map((n) => `Slide ${n.n} script: ${n.script}`)
      .join("\n\n") || "(none)";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SCRIPT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${globalContext(body)}

Regenerate ONLY slide ${target.n}.
Instruction: ${target.instruction}

Surrounding slide scripts for context:
${neighbors}

Return JSON with a slides array containing exactly one object for slide ${target.n}.
${SCHEMA_HINT}`,
        },
        ...slideUserContent(slide),
      ],
    },
  ];

  return callModel(messages);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateScriptRequest;

    if (!body?.slides?.length || !body.tone || !body.targetMinutes) {
      return NextResponse.json(
        { error: "Missing required fields: slides, tone, targetMinutes." },
        { status: 400 }
      );
    }

    if (body.regenerate) {
      const result = await regenerateOne(body);
      return NextResponse.json(result);
    }

    const slides = body.slides;
    let all: GenerateScriptResponse["slides"] = [];

    if (slides.length <= 18) {
      const result = await generateBatch(
        body,
        slides,
        `Write the full script for all ${slides.length} slides.`
      );
      all = result.slides;
    } else {
      const BATCH = 12;
      for (let i = 0; i < slides.length; i += BATCH) {
        const batch = slides.slice(i, i + BATCH);
        const result = await generateBatch(
          body,
          batch,
          `Write scripts for slides ${batch[0].n}–${batch[batch.length - 1].n} (batch ${Math.floor(i / BATCH) + 1}). Keep total time coherent with the ${body.targetMinutes}-minute target across the whole deck.`
        );
        all = all.concat(result.slides);
      }
    }

    // Normalize / sort
    all = all
      .map((s) => ({
        n: Number(s.n),
        script: String(s.script || ""),
        seconds: Math.max(1, Math.round(Number(s.seconds) || 30)),
        tip: String(s.tip || ""),
      }))
      .sort((a, b) => a.n - b.n);

    return NextResponse.json({ slides: all } satisfies GenerateScriptResponse);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Script generation failed.";
    console.error("[generate-script]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
