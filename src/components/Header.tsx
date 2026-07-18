"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cls";

type HeaderProps = {
  right?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function Header({ right, className, compact }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur-sm sm:px-6",
        compact ? "h-12" : "h-14",
        className
      )}
    >
      <Link
        href="/"
        className="flex items-center gap-2.5 text-text no-underline ease-stage hover:opacity-90"
      >
        <Image src="/logo.svg" alt="Crowdwork" width={28} height={28} priority />
        <span className="font-display text-lg tracking-tight">Crowdwork</span>
      </Link>
      {right ? <div className="flex items-center gap-3">{right}</div> : null}
    </header>
  );
}
