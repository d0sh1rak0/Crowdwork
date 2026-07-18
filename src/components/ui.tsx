"use client";

import { cn } from "@/lib/cls";

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-body font-medium ease-stage disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        variant === "primary" &&
          "bg-amber text-[#1a1208] hover:bg-amber-hi focus-visible:outline-amber",
        variant === "ghost" &&
          "bg-transparent text-muted hover:bg-surface hover:text-text",
        variant === "outline" &&
          "border border-border bg-transparent text-text hover:border-amber hover:text-amber",
        variant === "danger" &&
          "bg-over/15 text-over hover:bg-over/25",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm ease-stage",
        active
          ? "border-amber bg-amber/15 text-amber"
          : "border-border bg-surface text-muted hover:border-muted hover:text-text",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm text-muted"
    >
      {children}
    </label>
  );
}

export function FieldInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted/70 ease-stage focus:border-amber",
        props.className
      )}
    />
  );
}

export function FieldTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted/70 ease-stage focus:border-amber",
        props.className
      )}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>
) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text ease-stage focus:border-amber",
        props.className
      )}
    />
  );
}
