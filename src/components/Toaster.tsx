"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

type Toast = { id: number; text: string; tone: "up" | "down" | "neutral" };

let next = 1;

/** Shows a short confirmation in the corner, e.g. toast("Trade logged"). */
export function toast(text: string, tone: Toast["tone"] = "neutral") {
  window.dispatchEvent(new CustomEvent("strike-toast", { detail: { id: next++, text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((all) => [...all.slice(-3), t]);
      setTimeout(() => setItems((all) => all.filter((x) => x.id !== t.id)), 3800);
    };
    window.addEventListener("strike-toast", on);
    return () => window.removeEventListener("strike-toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-80 max-w-[calc(100vw-32px)] flex-col gap-2 md:bottom-6">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className={clsx(
              "glass edge pointer-events-auto rounded-2xl border border-line-strong px-4 py-3 text-[13px] shadow-2xl shadow-black/40",
              t.tone === "up" ? "edge-up" : t.tone === "down" ? "edge-down" : "edge-accent",
            )}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
