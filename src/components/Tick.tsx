"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

/** Wraps a live figure and flashes it green or red for a moment when `value` moves. */
export function Tick({ value, className, children }: { value: number; className?: string; children: React.ReactNode }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; n: number } | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    const dir = value > prev.current ? "up" : "down";
    prev.current = value;
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
  }, [value]);

  return (
    // the key restarts the animation on every change
    <span key={flash?.n ?? 0} className={clsx(className, flash && (flash.dir === "up" ? "tick-up" : "tick-down"))}>
      {children}
    </span>
  );
}
