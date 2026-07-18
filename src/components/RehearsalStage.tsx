"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportScreen } from "@/components/ReportScreen";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cls";
import {
  detectFillers,
  fillerTotal,
  mergeFillerCounts,
} from "@/lib/fillers";
import { createSpeechRecognition, speechLang } from "@/lib/speech";
import { formatTime, wordCount } from "@/lib/timing";
import type { RehearsalReport, RehearsalSlideResult } from "@/lib/types";
import { useDeckStore } from "@/store/deck-store";

type Phase = "boot" | "countdown" | "running" | "report";

export function RehearsalStage() {
  const router = useRouter();
  const slides = useDeckStore((s) => s.slides);
  const scriptSlides = useDeckStore((s) => s.scriptSlides);
  const setup = useDeckStore((s) => s.setup);
  const resolvedLanguage = useDeckStore((s) => s.resolvedLanguage);
  const setRehearsalReport = useDeckStore((s) => s.setRehearsalReport);
  const rehearsalReport = useDeckStore((s) => s.rehearsalReport);

  const [phase, setPhase] = useState<Phase>(
    rehearsalReport ? "report" : "boot"
  );
  const [countdown, setCountdown] = useState(3);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [slideElapsed, setSlideElapsed] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [micDenied, setMicDenied] = useState(false);
  const [interim, setInterim] = useState("");

  const slideTimesRef = useRef<number[]>([]);
  const transcriptsRef = useRef<string[]>([]);
  const speakingMsRef = useRef(0);
  const finalWordsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const runActiveRef = useRef(false);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const indexRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const slideElapsedRef = useRef(0);

  useEffect(() => {
    if (!slides.length || !scriptSlides.length) {
      router.replace("/");
    }
  }, [slides.length, scriptSlides.length, router]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    slideElapsedRef.current = slideElapsed;
  }, [slideElapsed]);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 2000);
  }, []);

  const stopRecognition = useCallback(() => {
    runActiveRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onend = null;
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
  }, []);

  const startRecognition = useCallback(() => {
    const rec = createSpeechRecognition();
    if (!rec) {
      setMicDenied(true);
      return;
    }
    rec.lang = speechLang(resolvedLanguage);
    rec.continuous = true;
    rec.interimResults = true;
    runActiveRef.current = true;

    rec.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) {
          const idx = indexRef.current;
          const prev = transcriptsRef.current[idx] || "";
          transcriptsRef.current[idx] = (prev + " " + text).trim();
          finalWordsRef.current += wordCount(text);
          if (!pausedRef.current) {
            speakingMsRef.current += Math.min(
              4000,
              Math.max(400, wordCount(text) * 350)
            );
          }
          setInterim("");
        } else {
          interimText += text;
        }
      }
      if (interimText) setInterim(interimText);
    };

    rec.onerror = (event) => {
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        setMicDenied(true);
        stopRecognition();
      }
    };

    rec.onend = () => {
      if (runActiveRef.current && recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          /* restart race */
        }
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch {
      setMicDenied(true);
    }
  }, [resolvedLanguage, stopRecognition]);

  const finishRun = useCallback(() => {
    stopRecognition();
    const times = [...slideTimesRef.current];
    times[indexRef.current] = slideElapsedRef.current;
    while (times.length < scriptSlides.length) times.push(0);

    const slideResults: RehearsalSlideResult[] = scriptSlides.map((s, i) => ({
      n: s.n,
      actualSeconds: Math.round(times[i] || 0),
      transcript: transcriptsRef.current[i] || "",
    }));

    const perSlide = slideResults.map((s) =>
      detectFillers(s.transcript, resolvedLanguage)
    );
    const fillerCounts = mergeFillerCounts(...perSlide);

    const speakingSeconds = Math.max(
      1,
      Math.round(speakingMsRef.current / 1000)
    );
    const wpm =
      finalWordsRef.current > 0
        ? Math.round((finalWordsRef.current / speakingSeconds) * 60)
        : 0;

    const report: RehearsalReport = {
      totalSeconds: Math.round(elapsedRef.current),
      targetSeconds: setup.targetMinutes * 60,
      wpm,
      fillerCounts,
      fillerTotal: fillerTotal(fillerCounts),
      slidesOverBudget: slideResults.filter(
        (r, i) => r.actualSeconds > scriptSlides[i].seconds
      ).length,
      slides: slideResults,
      speakingSeconds,
      finalWordCount: finalWordsRef.current,
    };

    setRehearsalReport(report);
    setPhase("report");

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [
    resolvedLanguage,
    scriptSlides,
    setRehearsalReport,
    setup.targetMinutes,
    stopRecognition,
  ]);

  const goNext = useCallback(() => {
    if (indexRef.current >= scriptSlides.length - 1) {
      finishRun();
      return;
    }
    slideTimesRef.current[indexRef.current] = slideElapsedRef.current;
    setIndex((i) => i + 1);
    setSlideElapsed(0);
    setInterim("");
  }, [finishRun, scriptSlides.length]);

  const goPrev = useCallback(() => {
    if (indexRef.current <= 0) return;
    slideTimesRef.current[indexRef.current] = slideElapsedRef.current;
    const prev = indexRef.current - 1;
    setIndex(prev);
    setSlideElapsed(slideTimesRef.current[prev] || 0);
    setInterim("");
  }, []);

  const restartRun = useCallback(() => {
    stopRecognition();
    slideTimesRef.current = scriptSlides.map(() => 0);
    transcriptsRef.current = scriptSlides.map(() => "");
    speakingMsRef.current = 0;
    finalWordsRef.current = 0;
    setIndex(0);
    setElapsed(0);
    setSlideElapsed(0);
    setPaused(false);
    setInterim("");
    setRehearsalReport(null);
    setPhase("countdown");
    setCountdown(3);
  }, [scriptSlides, setRehearsalReport, stopRecognition]);

  // Boot: fullscreen + mic
  useEffect(() => {
    if (phase !== "boot") return;
    let cancelled = false;

    async function boot() {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        /* fullscreen optional */
      }

      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((t) => t.stop());
          if (!cancelled) setMicDenied(false);
        } catch {
          if (!cancelled) setMicDenied(true);
        }
      } else if (!cancelled) {
        setMicDenied(true);
      }

      if (!cancelled) {
        slideTimesRef.current = scriptSlides.map(() => 0);
        transcriptsRef.current = scriptSlides.map(() => "");
        setPhase("countdown");
        setCountdown(3);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [phase, scriptSlides]);

  // Countdown
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("running");
      bumpControls();
      if (!micDenied) startRecognition();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [phase, countdown, micDenied, startRecognition, bumpControls]);

  // Timers
  useEffect(() => {
    if (phase !== "running" || paused) {
      lastTickRef.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setElapsed((e) => e + delta);
      setSlideElapsed((e) => e + delta);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, paused]);

  // Keyboard
  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopRecognition();
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
        router.push("/script");
        return;
      }
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        bumpControls();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        bumpControls();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setPaused((p) => !p);
        bumpControls();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        restartRun();
        bumpControls();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    phase,
    goNext,
    goPrev,
    restartRun,
    stopRecognition,
    router,
    bumpControls,
  ]);

  useEffect(() => {
    if (phase !== "running") return;
    const onMove = () => bumpControls();
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [phase, bumpControls]);

  useEffect(() => {
    return () => {
      stopRecognition();
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [stopRecognition]);

  if (!scriptSlides.length || !slides.length) {
    return null;
  }

  if (phase === "report" && rehearsalReport) {
    return <ReportScreen />;
  }

  const current = scriptSlides[index];
  const deckSlide = slides.find((s) => s.n === current.n)!;
  const budget = current.seconds;
  const ratio = budget > 0 ? slideElapsed / budget : 0;
  const barColor =
    ratio > 1 ? "bg-over" : ratio >= 0.9 ? "bg-amber-hi" : "bg-amber";
  const targetSeconds = setup.targetMinutes * 60;
  const isLast = index >= scriptSlides.length - 1;

  if (phase === "boot" || phase === "countdown") {
    return (
      <div className="spotlight flex min-h-screen flex-col items-center justify-center">
        <div
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            background: `rgba(16,17,19,${
              phase === "countdown" ? 0.35 + (3 - countdown) * 0.12 : 0.55
            })`,
          }}
        />
        <p className="relative z-10 font-display text-4xl text-text sm:text-6xl">
          {phase === "boot"
            ? "Setting the stage…"
            : countdown > 0
              ? `You're on in ${countdown}`
              : "Go"}
        </p>
        {micDenied ? (
          <p className="relative z-10 mt-6 text-sm text-muted">
            Rehearsing without voice tracking
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="spotlight relative flex min-h-screen flex-col"
      onMouseMove={bumpControls}
    >
      {micDenied ? (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border border-border bg-surface/90 px-3 py-1.5 text-xs text-muted">
          Rehearsing without voice tracking
        </div>
      ) : null}

      <div
        className={cn(
          "absolute right-4 top-4 z-20 font-utility text-lg text-text ease-stage sm:right-8 sm:top-6 sm:text-xl",
          !controlsVisible && "pointer-events-none opacity-40"
        )}
      >
        {formatTime(elapsed)} / {formatTime(targetSeconds)}
        {paused ? <span className="ml-3 text-amber">Paused</span> : null}
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-8">
        <div
          key={current.n}
          className="anim-slide relative w-full max-w-[60vw] min-w-[280px]"
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-sm shadow-[0_0_80px_rgba(242,163,60,0.18)]">
            <Image
              src={deckSlide.imageDisplay}
              alt={`Slide ${current.n}`}
              fill
              unoptimized
              className="object-contain bg-black/40"
              priority
            />
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/80">
            <div
              className={cn("h-full ease-stage", barColor)}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-center font-utility text-xs text-muted">
            Slide {current.n} · {formatTime(slideElapsed)} /{" "}
            {formatTime(budget)}
          </p>
        </div>

        <p className="mt-8 max-w-3xl text-center text-[22px] leading-relaxed text-text sm:text-[24px]">
          {current.script}
        </p>
        {interim ? (
          <p className="mt-3 max-w-2xl text-center text-sm italic text-muted">
            {interim}
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 z-20 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-bg via-bg/80 to-transparent px-4 pb-6 pt-16 ease-stage",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <Button variant="ghost" size="sm" onClick={goPrev} disabled={index === 0}>
          ← Prev
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button variant="ghost" size="sm" onClick={restartRun}>
          Restart
        </Button>
        <Button size="sm" onClick={goNext}>
          {isLast ? "Finish run" : "Next →"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            stopRecognition();
            if (document.fullscreenElement) {
              void document.exitFullscreen().catch(() => undefined);
            }
            router.push("/script");
          }}
        >
          Exit
        </Button>
      </div>
    </div>
  );
}
