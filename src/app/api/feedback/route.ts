import { NextResponse } from "next/server";
import {
  FEEDBACK_SYSTEM_PROMPT,
  getOpenAI,
  parseJsonLoose,
} from "@/lib/openai";
import type { FeedbackRequest, FeedbackResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

async function callFeedback(
  body: FeedbackRequest,
  retry = false
): Promise<FeedbackResponse> {
  const openai = getOpenAI();
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

  const messages = [
    { role: "system" as const, content: FEEDBACK_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Target talk length: ${body.targetMinutes} minutes.
Respond in ${langLabel}.

Rehearsal data:
${slideBlocks}

Return JSON:
{
  "summary": "one line verdict",
  "strengths": ["...", "...", "..."],
  "improvements": ["...", "...", "..."]
}`,
    },
  ];

  if (retry) {
    messages.push({
      role: "user",
      content:
        "Your previous output was not valid JSON. Return only the JSON object matching the schema.",
    });
  }

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    max_tokens: 2000,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages,
  });

  const raw = completion.choices[0]?.message?.content || "";
  try {
    const parsed = parseJsonLoose<FeedbackResponse>(raw);
    const strengths = (parsed.strengths || []).slice(0, 3);
    const improvements = (parsed.improvements || []).slice(0, 3);
    while (strengths.length < 3) strengths.push("Solid pacing on quieter slides.");
    while (improvements.length < 3)
      improvements.push("Tighten transitions between dense slides.");
    return {
      summary: parsed.summary || "Solid run — review the notes below.",
      strengths,
      improvements,
    };
  } catch (err) {
    if (!retry) return callFeedback(body, true);
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FeedbackRequest;
    if (!body?.slides?.length || !body.targetMinutes) {
      return NextResponse.json(
        { error: "Missing required fields: slides, targetMinutes." },
        { status: 400 }
      );
    }
    const result = await callFeedback(body);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Feedback generation failed.";
    console.error("[feedback]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
