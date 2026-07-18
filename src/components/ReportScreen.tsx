"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cls";
import { formatTime } from "@/lib/timing";
import type { FeedbackResponse } from "@/lib/types";
import { useDeckStore } from "@/store/deck-store";

function verdictLine(
  total: number,
  target: number
): { text: string; over: boolean; onTime: boolean } {
  const diff = total - target;
  if (Math.abs(diff) <= target * 0.1) {
    return {
      text: `${formatTime(total)} / ${formatTime(target)} — on time`,
      over: false,
      onTime: true,
    };
  }
  if (diff > 0) {
    return {
      text: `${formatTime(total)} / ${formatTime(target)} — ${formatTime(diff)} over`,
      over: true,
      onTime: false,
    };
  }
  return {
    text: `${formatTime(total)} / ${formatTime(target)} — ${formatTime(-diff)} under`,
    over: false,
    onTime: false,
  };
}

export function ReportScreen() {
  const router = useRouter();
  const report = useDeckStore((s) => s.rehearsalReport);
  const scriptSlides = useDeckStore((s) => s.scriptSlides);
  const slides = useDeckStore((s) => s.slides);
  const setup = useDeckStore((s) => s.setup);
  const resolvedLanguage = useDeckStore((s) => s.resolvedLanguage);
  const feedback = useDeckStore((s) => s.feedback);
  const setFeedback = useDeckStore((s) => s.setFeedback);
  const resetAll = useDeckStore((s) => s.resetAll);
  const setRehearsalReport = useDeckStore((s) => s.setRehearsalReport);

  const [selected, setSelected] = useState<number | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!report || feedback) return;
    let cancelled = false;

    async function load() {
      setLoadingFeedback(true);
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetMinutes: setup.targetMinutes,
            language: resolvedLanguage,
            slides: report!.slides.map((r, i) => ({
              n: r.n,
              script: scriptSlides[i]?.script || "",
              transcript: r.transcript,
              actualSeconds: r.actualSeconds,
              targetSeconds: scriptSlides[i]?.seconds || 0,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Feedback failed.");
        if (!cancelled) setFeedback(data as FeedbackResponse);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Feedback failed.",
            {
              action: {
                label: "Retry",
                onClick: () => {
                  setFeedback(null);
                  setRetryNonce((n) => n + 1);
                },
              },
            }
          );
        }
      } finally {
        if (!cancelled) setLoadingFeedback(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    report,
    feedback,
    retryNonce,
    setup.targetMinutes,
    resolvedLanguage,
    scriptSlides,
    setFeedback,
  ]);

  if (!report) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center">
        <p className="text-muted">No rehearsal report yet.</p>
        <Button className="mt-4" onClick={() => router.push("/script")}>
          Back to script
        </Button>
      </div>
    );
  }

  const verdict = verdictLine(report.totalSeconds, report.targetSeconds);
  const selectedResult =
    selected != null ? report.slides.find((s) => s.n === selected) : null;
  const selectedScript =
    selected != null ? scriptSlides.find((s) => s.n === selected) : null;
  const selectedDeck =
    selected != null ? slides.find((s) => s.n === selected) : null;
  const maxBar = Math.max(
    ...report.slides.map((r, i) =>
      Math.max(r.actualSeconds, scriptSlides[i]?.seconds || 0)
    ),
    1
  );

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1
          className={cn(
            "font-display text-3xl tracking-tight sm:text-4xl",
            verdict.over ? "text-over" : "text-text"
          )}
        >
          {verdict.text}
        </h1>

        <section className="mt-10">
          <h2 className="mb-4 text-sm text-muted">Per-slide timing</h2>
          <div className="space-y-2">
            {report.slides.map((r, i) => {
              const target = scriptSlides[i]?.seconds || 0;
              const over = r.actualSeconds > target;
              return (
                <button
                  key={r.n}
                  type="button"
                  onClick={() =>
                    setSelected((s) => (s === r.n ? null : r.n))
                  }
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ease-stage",
                    selected === r.n
                      ? "border-amber bg-amber/10"
                      : "border-border bg-surface hover:border-muted"
                  )}
                >
                  <span className="w-8 font-utility text-xs text-muted">
                    {r.n}
                  </span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-border/60">
                    <div
                      className="absolute inset-y-0 left-0 bg-border"
                      style={{ width: `${(target / maxBar) * 100}%` }}
                      title={`Budget ${formatTime(target)}`}
                    />
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0",
                        over ? "bg-over" : "bg-amber"
                      )}
                      style={{
                        width: `${(r.actualSeconds / maxBar) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-24 text-right font-utility text-xs text-muted">
                    {formatTime(r.actualSeconds)} / {formatTime(target)}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedResult && selectedScript ? (
            <div className="mt-4 grid gap-4 border border-border bg-surface p-4 sm:grid-cols-2">
              {selectedDeck ? (
                <div className="relative aspect-video overflow-hidden rounded-sm">
                  <Image
                    src={selectedDeck.imageDisplay}
                    alt=""
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
              ) : null}
              <div className="space-y-3 text-sm">
                <div>
                  <p className="mb-1 text-muted">Script</p>
                  <p className="text-text">{selectedScript.script}</p>
                </div>
                <div>
                  <p className="mb-1 text-muted">Transcript</p>
                  <p className="text-text">
                    {selectedResult.transcript || "(no speech captured)"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="border border-border bg-surface p-4">
            <p className="text-sm text-muted">WPM</p>
            <p className="mt-1 font-utility text-2xl text-text">
              {report.wpm || "—"}
            </p>
          </div>
          <div className="border border-border bg-surface p-4 sm:col-span-2">
            <p className="text-sm text-muted">
              Fillers · {report.fillerTotal}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.keys(report.fillerCounts).length === 0 ? (
                <span className="text-sm text-text">None detected</span>
              ) : (
                Object.entries(report.fillerCounts).map(([word, count]) => (
                  <span
                    key={word}
                    className="rounded-md border border-border px-2 py-0.5 font-utility text-xs text-muted"
                  >
                    {word} ×{count}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="border border-border bg-surface p-4 sm:col-span-3">
            <p className="text-sm text-muted">Slides over budget</p>
            <p className="mt-1 font-utility text-2xl text-text">
              {report.slidesOverBudget}
            </p>
          </div>
        </section>

        <section className="mt-10 border border-border bg-surface p-5">
          <h2 className="font-display text-lg text-text">AI coach</h2>
          {loadingFeedback && !feedback ? (
            <div className="mt-4 space-y-3">
              <div className="h-5 w-3/4 shimmer rounded" />
              <div className="h-4 w-full shimmer rounded" />
              <div className="h-4 w-5/6 shimmer rounded" />
              <div className="h-4 w-2/3 shimmer rounded" />
            </div>
          ) : feedback ? (
            <div className="mt-4 space-y-5">
              <p className="text-text">{feedback.summary}</p>
              <div>
                <p className="mb-2 text-sm text-muted">Strengths</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                  {feedback.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-sm text-muted">Improvements</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                  {feedback.improvements.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Coach notes unavailable. Use Retry in the toast.
            </p>
          )}
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setRehearsalReport(null);
              setFeedback(null);
              router.push("/rehearse");
            }}
          >
            Rehearse again
          </Button>
          <Button variant="outline" onClick={() => router.push("/script")}>
            Back to script
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              resetAll();
              router.push("/");
            }}
          >
            New deck
          </Button>
        </div>
      </main>
    </div>
  );
}
