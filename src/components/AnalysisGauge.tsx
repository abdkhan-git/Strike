"use client";

import clsx from "clsx";
import { motion } from "motion/react";

/** The full analysis score (-100 bearish .. +100 bullish) as a centred bar. */
export function AnalysisGauge({ score, className }: { score: number; className?: string }) {
  const bull = score >= 15;
  const bear = score <= -15;
  const half = Math.min(50, Math.abs(score) / 2);
  return (
    <div className={clsx("flex items-center gap-3 rounded-xl bg-raised px-3.5 py-1.5", className)} title="Full analysis: trend, momentum, RSI, MACD, candles, intraday structure, options flow, market">
      <div className="leading-tight">
        <div className="cap">Analysis</div>
        <div className={clsx("num text-[13px] font-semibold", bull ? "text-up" : bear ? "text-down" : "text-muted")}>
          {bull ? "Bullish" : bear ? "Bearish" : "Neutral"} {score > 0 ? "+" : ""}
          {score}
        </div>
      </div>
      <div className="relative h-1.5 w-24 rounded-full bg-line-strong">
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-faint" />
        <motion.span
          className={clsx("absolute inset-y-0", score >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")}
          initial={{ width: 0 }}
          animate={{ width: `${half}%` }}
          transition={{ type: "spring", stiffness: 160, damping: 22 }}
        />
      </div>
    </div>
  );
}
