"use client";

import { useEffect } from "react";
import { useDeckStore } from "@/store/deck-store";

export function BeforeUnloadGuard() {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!useDeckStore.getState().hasDeck()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return null;
}
