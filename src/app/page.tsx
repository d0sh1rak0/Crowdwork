"use client";

import { Header } from "@/components/Header";
import { SetupForm } from "@/components/SetupForm";
import { ThumbnailGrid } from "@/components/ThumbnailGrid";
import { UploadZone } from "@/components/UploadZone";

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="relative flex flex-1 flex-col items-center px-4 py-12 sm:px-6 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 55% 70% at 50% 0%, rgba(242,163,60,0.14), transparent 70%)",
          }}
        />
        <div className="relative z-10 flex w-full max-w-3xl flex-col items-center">
          <h1 className="font-display text-4xl tracking-tight text-text sm:text-5xl">
            Crowdwork
          </h1>
          <p className="mt-3 max-w-md text-center text-base text-muted">
            Turn a deck into a spoken script. Rehearse it under the lights.
          </p>
          <div className="mt-10 flex w-full flex-col items-center">
            <UploadZone />
            <ThumbnailGrid />
            <SetupForm />
          </div>
        </div>
      </main>
    </div>
  );
}
