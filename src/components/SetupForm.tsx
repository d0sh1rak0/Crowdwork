"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Chip,
  FieldInput,
  FieldLabel,
  FieldTextarea,
  Select,
} from "@/components/ui";
import { slidesForApi } from "@/lib/pdf";
import type {
  GenerateScriptResponse,
  PurposeOption,
  ScriptSlide,
  Tone,
} from "@/lib/types";
import { useDeckStore } from "@/store/deck-store";

const PURPOSES: PurposeOption[] = [
  "Investor pitch",
  "Startup competition",
  "Sales demo",
  "Conference talk",
  "University defense",
  "Other",
];

const DURATIONS = [3, 5, 7, 10, 15, 20];
const TONES: { id: Tone; label: string }[] = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

export function SetupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const slides = useDeckStore((s) => s.slides);
  const setup = useDeckStore((s) => s.setup);
  const deckTitle = useDeckStore((s) => s.deckTitle);
  const isProcessing = useDeckStore((s) => s.isProcessingPdf);
  const updateSetup = useDeckStore((s) => s.updateSetup);
  const setScriptSlides = useDeckStore((s) => s.setScriptSlides);
  const setGenerating = useDeckStore((s) => s.setGenerating);
  const getPurposeString = useDeckStore((s) => s.getPurposeString);
  const getResolvedLanguage = useDeckStore((s) => s.getResolvedLanguage);

  if (isProcessing || slides.length === 0) return null;

  const purposeOk =
    setup.purpose !== "" &&
    (setup.purpose !== "Other" || setup.purposeOther.trim().length > 0);

  async function generate() {
    if (!purposeOk || submitting) return;
    setSubmitting(true);
    setGenerating(true);

    const language = getResolvedLanguage();
    const payload = {
      deckTitle,
      purpose: getPurposeString(),
      audience: setup.audience.trim() || undefined,
      notes: setup.notes.trim() || undefined,
      tone: setup.tone,
      targetMinutes: setup.targetMinutes,
      language,
      slides: slidesForApi(slides),
    };

    // Navigate immediately to show skeleton loaders
    router.push("/script");

    try {
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Script generation failed.");
      }
      const response = data as GenerateScriptResponse;
      const scriptSlides: ScriptSlide[] = response.slides.map((s) => ({
        n: s.n,
        script: s.script,
        seconds: s.seconds,
        tip: s.tip,
        originalScript: s.script,
        originalSeconds: s.seconds,
        originalTip: s.tip,
      }));
      setScriptSlides(scriptSlides);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Script generation failed.";
      toast.error(message, {
        action: {
          label: "Retry",
          onClick: () => {
            void generate();
          },
        },
      });
    } finally {
      setGenerating(false);
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mt-10 w-full max-w-xl space-y-6 border-t border-border pt-8"
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
    >
      <div>
        <FieldLabel htmlFor="purpose">Purpose</FieldLabel>
        <Select
          id="purpose"
          value={setup.purpose}
          onChange={(e) =>
            updateSetup({ purpose: e.target.value as PurposeOption | "" })
          }
          required
        >
          <option value="" disabled>
            Select purpose
          </option>
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        {setup.purpose === "Other" ? (
          <FieldInput
            className="mt-2"
            placeholder="Describe the purpose"
            value={setup.purposeOther}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSetup({ purposeOther: e.target.value })}
            required
          />
        ) : null}
      </div>

      <div>
        <FieldLabel>Target duration</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((m) => (
            <Chip
              key={m}
              active={setup.targetMinutes === m}
              onClick={() => updateSetup({ targetMinutes: m })}
            >
              {m} min
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Tone</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <Chip
              key={t.id}
              active={setup.tone === t.id}
              onClick={() => updateSetup({ tone: t.id })}
            >
              {t.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel htmlFor="language">Script language</FieldLabel>
        <Select
          id="language"
          value={setup.language}
          onChange={(e) =>
            updateSetup({
              language: e.target.value as "en" | "ru" | "auto",
            })
          }
        >
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </Select>
      </div>

      <div>
        <FieldLabel htmlFor="audience">Audience (optional)</FieldLabel>
        <FieldInput
          id="audience"
          placeholder="3 judges, mixed technical background"
          value={setup.audience}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSetup({ audience: e.target.value })}
        />
      </div>

      <div>
        <FieldLabel htmlFor="notes">Notes for the AI (optional)</FieldLabel>
        <FieldTextarea
          id="notes"
          rows={3}
          placeholder="The ask is $200k for 10%. Emphasize traction on slide 6."
          value={setup.notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateSetup({ notes: e.target.value })}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        disabled={!purposeOk || submitting}
      >
        {submitting ? "Writing your script…" : "Write my script"}
      </Button>
    </form>
  );
}
