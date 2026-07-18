"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Button, Chip, FieldInput } from "@/components/ui";
import { cn } from "@/lib/cls";
import { slidesForApi } from "@/lib/pdf";
import { formatTime } from "@/lib/timing";
import type { GenerateScriptResponse, ScriptSlide, Tone } from "@/lib/types";
import { useDeckStore } from "@/store/deck-store";

const TONES: { id: Tone; label: string }[] = [
  { id: "confident", label: "Confident" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "energetic", label: "Energetic" },
];

function AutoTextarea({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(120, el.scrollHeight)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-md border border-border bg-surface px-4 py-3 text-[18px] leading-relaxed text-text placeholder:text-muted/60 ease-stage focus:border-amber disabled:opacity-50"
      rows={4}
      spellCheck
    />
  );
}

function SkeletonSlide() {
  return (
    <div className="flex flex-1 gap-0">
      <aside className="hidden w-52 shrink-0 border-r border-border bg-bg p-3 md:block">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mb-2 h-16 shimmer rounded-md" />
        ))}
      </aside>
      <div className="flex flex-1 flex-col items-center px-4 py-8 sm:px-8">
        <div className="aspect-video w-full max-w-3xl shimmer rounded-md" />
        <div className="mt-6 h-40 w-full max-w-3xl shimmer rounded-md" />
        <p className="mt-6 font-utility text-sm text-amber">
          Writing your script…
        </p>
      </div>
    </div>
  );
}

export function ScriptStudio() {
  const router = useRouter();
  const slides = useDeckStore((s) => s.slides);
  const scriptSlides = useDeckStore((s) => s.scriptSlides);
  const currentSlideIndex = useDeckStore((s) => s.currentSlideIndex);
  const setCurrentSlideIndex = useDeckStore((s) => s.setCurrentSlideIndex);
  const updateSlideScript = useDeckStore((s) => s.updateSlideScript);
  const updateSlideFromRegen = useDeckStore((s) => s.updateSlideFromRegen);
  const resetSlideToOriginal = useDeckStore((s) => s.resetSlideToOriginal);
  const isGenerating = useDeckStore((s) => s.isGenerating);
  const setGenerating = useDeckStore((s) => s.setGenerating);
  const deckTitle = useDeckStore((s) => s.deckTitle);
  const setup = useDeckStore((s) => s.setup);
  const totalEstimatedSeconds = useDeckStore((s) => s.totalEstimatedSeconds);
  const getPurposeString = useDeckStore((s) => s.getPurposeString);
  const getResolvedLanguage = useDeckStore((s) => s.getResolvedLanguage);
  const setScriptSlides = useDeckStore((s) => s.setScriptSlides);
  const setTone = useDeckStore((s) => s.setTone);

  const [regenOpen, setRegenOpen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const [toneLoading, setToneLoading] = useState(false);

  useEffect(() => {
    if (!slides.length && !isGenerating) {
      router.replace("/");
    }
  }, [slides.length, isGenerating, router]);

  const current = scriptSlides[currentSlideIndex];
  const deckSlide = current
    ? slides.find((s) => s.n === current.n)
    : slides[currentSlideIndex];
  const targetSeconds = setup.targetMinutes * 60;
  const estimated = totalEstimatedSeconds();

  async function regenerateSlide() {
    if (!current || !regenInstruction.trim()) return;
    setRegenLoading(true);
    try {
      const language = getResolvedLanguage();
      const neighbors = scriptSlides
        .filter((s) => Math.abs(s.n - current.n) === 1)
        .map((s) => ({ n: s.n, script: s.script }));

      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckTitle,
          purpose: getPurposeString(),
          audience: setup.audience || undefined,
          notes: setup.notes || undefined,
          tone: setup.tone,
          targetMinutes: setup.targetMinutes,
          language,
          slides: slidesForApi(slides.filter((s) => s.n === current.n)),
          regenerate: { n: current.n, instruction: regenInstruction.trim() },
          neighborContext: neighbors,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed.");
      const result = data as GenerateScriptResponse;
      const updated = result.slides.find((s) => s.n === current.n) || result.slides[0];
      if (!updated) throw new Error("No slide returned.");
      updateSlideFromRegen(current.n, updated);
      setRegenOpen(false);
      setRegenInstruction("");
      toast.success(`Slide ${current.n} rewritten.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed.", {
        action: {
          label: "Retry",
          onClick: () => void regenerateSlide(),
        },
      });
    } finally {
      setRegenLoading(false);
    }
  }

  async function regenerateAllWithTone(tone: Tone) {
    setToneLoading(true);
    setGenerating(true);
    setTone(tone);
    try {
      const language = getResolvedLanguage();
      const res = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckTitle,
          purpose: getPurposeString(),
          audience: setup.audience || undefined,
          notes: setup.notes || undefined,
          tone,
          targetMinutes: setup.targetMinutes,
          language,
          slides: slidesForApi(slides),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed.");
      const response = data as GenerateScriptResponse;
      const next: ScriptSlide[] = response.slides.map((s) => ({
        n: s.n,
        script: s.script,
        seconds: s.seconds,
        tip: s.tip,
        originalScript: s.script,
        originalSeconds: s.seconds,
        originalTip: s.tip,
      }));
      setScriptSlides(next);
      setToneOpen(false);
      toast.success("Full script rewritten.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed.", {
        action: {
          label: "Retry",
          onClick: () => void regenerateAllWithTone(tone),
        },
      });
    } finally {
      setToneLoading(false);
      setGenerating(false);
    }
  }

  async function copyFullScript() {
    const text = scriptSlides
      .map((s) => `— Slide ${s.n} (${s.seconds}s) —\n${s.script}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Full script copied.");
    } catch {
      toast.error("Clipboard blocked. Select the text and copy manually.");
    }
  }

  if (isGenerating && scriptSlides.length === 0) {
    return (
      <div className="flex min-h-full flex-col">
        <Header
          right={
            <span className="font-utility text-sm text-muted">
              Setting the stage…
            </span>
          }
        />
        <SkeletonSlide />
      </div>
    );
  }

  if (!current || !deckSlide) {
    return (
      <div className="flex min-h-full flex-col">
        <Header />
        <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <p className="font-display text-xl text-text">Script not ready</p>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Generation may have failed. Go back to retry, or upload a new deck.
          </p>
          <Link href="/" className="mt-6 text-amber hover:text-amber-hi">
            Back to upload
          </Link>
        </main>
      </div>
    );
  }

  const dirty =
    current.script !== current.originalScript ||
    current.tip !== current.originalTip;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        right={
          <>
            <div className="hidden text-right sm:block">
              <p className="truncate font-display text-sm text-text max-w-[200px]">
                {deckTitle}
              </p>
              <p className="font-utility text-xs text-muted">
                ≈ {formatTime(estimated)} / {formatTime(targetSeconds)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setToneOpen((v) => !v)}>
              Regenerate all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void copyFullScript()}>
              Copy full script
            </Button>
            <Button size="sm" onClick={() => router.push("/rehearse")}>
              Start rehearsal
            </Button>
          </>
        }
      />

      {toneOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-3 sm:px-6">
          <span className="text-sm text-muted">Rewrite with tone:</span>
          {TONES.map((t) => (
            <Chip
              key={t.id}
              active={setup.tone === t.id}
              disabled={toneLoading}
              onClick={() => void regenerateAllWithTone(t.id)}
            >
              {t.label}
            </Chip>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setToneOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-bg p-3 md:block">
          <ul className="space-y-2">
            {scriptSlides.map((s, i) => {
              const thumb = slides.find((d) => d.n === s.n);
              const active = i === currentSlideIndex;
              return (
                <li key={s.n}>
                  <button
                    type="button"
                    onClick={() => setCurrentSlideIndex(i)}
                    className={cn(
                      "flex w-full gap-2 rounded-md border p-1.5 text-left ease-stage",
                      active
                        ? "border-amber bg-amber/10"
                        : "border-transparent hover:border-border hover:bg-surface"
                    )}
                  >
                    <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-sm bg-surface">
                      {thumb ? (
                        <Image
                          src={thumb.imageDisplay}
                          alt=""
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 py-0.5">
                      <p className="font-utility text-xs text-text">
                        {s.n}
                      </p>
                      <p className="font-utility text-[11px] text-muted">
                        {s.seconds}s
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-3 flex items-center justify-between md:hidden">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentSlideIndex === 0}
                onClick={() => setCurrentSlideIndex(currentSlideIndex - 1)}
              >
                ← Prev
              </Button>
              <span className="font-utility text-sm text-muted">
                Slide {current.n} · {current.seconds}s
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={currentSlideIndex >= scriptSlides.length - 1}
                onClick={() => setCurrentSlideIndex(currentSlideIndex + 1)}
              >
                Next →
              </Button>
            </div>

            <div
              key={current.n}
              className="anim-slide relative aspect-video w-full overflow-hidden rounded-md border border-border bg-surface"
            >
              <Image
                src={deckSlide.imageDisplay}
                alt={`Slide ${current.n}`}
                fill
                unoptimized
                className="object-contain"
                priority
              />
            </div>

            <div className="mt-5">
              <AutoTextarea
                value={current.script}
                onChange={(v) => updateSlideScript(current.n, v)}
                disabled={regenLoading || toneLoading}
              />
              <p className="mt-2 text-sm text-muted">{current.tip}</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRegenOpen((v) => !v)}
              >
                Regenerate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty}
                onClick={() => resetSlideToOriginal(current.n)}
              >
                Reset to AI version
              </Button>
            </div>

            {regenOpen ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <FieldInput
                  placeholder='How should it change? e.g. "shorter", "punchier"'
                  value={regenInstruction}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegenInstruction(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") void regenerateSlide();
                  }}
                  disabled={regenLoading}
                />
                <Button
                  size="md"
                  disabled={!regenInstruction.trim() || regenLoading}
                  onClick={() => void regenerateSlide()}
                >
                  {regenLoading ? "Rewriting…" : "Apply"}
                </Button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
