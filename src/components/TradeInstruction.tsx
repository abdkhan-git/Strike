"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { buyInstruction } from "@/lib/instruction";
import type { Horizon, OptType, PlanView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type Contract = {
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  dte: number;
};

/** Dollars to risk per trade from the plan (base size when the plan has paused trading). */
export function useBudget() {
  const { data } = usePoll<PlanView>("/api/plan", 60_000);
  if (!data) return { budget: undefined, paused: false };
  return {
    budget: data.budget > 0 ? data.budget : data.equity * data.settings.riskPerTrade,
    paused: data.budget <= 0,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The exact order for a contract: what to buy, how many, the limit, when, and the exits.
 * `compact` is a two-line version for cards and lists.
 */
export function TradeInstruction({
  c,
  horizon,
  budget,
  paused,
  compact,
  className,
}: {
  c: Contract;
  horizon?: Horizon;
  budget?: number;
  paused?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const ins = useMemo(() => buyInstruction(c, { budget, horizon }), [c, budget, horizon]);
  const up = c.type === "call";

  if (compact)
    return (
      <div className={clsx("text-[12.5px] leading-snug", className)}>
        <div className={clsx("font-medium", up ? "text-up" : "text-down")}>{ins.headline}</div>
        <div className="num mt-1 text-[11.5px] leading-relaxed text-muted">
          Limit {money(ins.limit)} · {whole(ins.cost)} · {ins.when} · sell at {money(ins.targetPrice)} (+{Math.round(ins.targetPct * 100)}%) or by{" "}
          {ins.sellBy.text} · cut {money(ins.stopPrice)}
        </div>
        {ins.overBudget && <div className="mt-1 text-[11.5px] text-warn">One contract is over twice your risk per trade; size down or skip.</div>}
      </div>
    );

  const cells: [string, string, string?, string?][] = [
    ["Limit price", money(ins.limit), `${whole(ins.cost)} total`],
    ["When", ins.when === "now" ? "Now" : ins.when.replace(/^at the open/, "At the open"), ins.when === "now" ? "market is open" : "9:30 am ET"],
    ["Take profit", money(ins.targetPrice), `+${Math.round(ins.targetPct * 100)}% · +${whole(ins.targetGain)}`, "text-up"],
    ["Stop", money(ins.stopPrice), `−${whole(ins.maxLoss)} max loss`, "text-down"],
    ["Sell by", ins.sellBy.text.replace(/, (\d)/, " · $1"), "at the latest"],
  ];

  return (
    <div className={clsx("overflow-hidden rounded-xl border border-line bg-raised/40", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2.5 pt-3">
        <span className={clsx("text-[15px] font-semibold tracking-[-0.02em]", up ? "text-up" : "text-down")}>{ins.headline}</span>
        {paused ? (
          <span className="text-[12px] text-warn">Plan paused today: for tomorrow or watching only</span>
        ) : ins.overBudget ? (
          <span className="text-[12px] text-warn">One contract is more than twice your risk per trade</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-5">
        {cells.map(([label, value, sub, tone]) => (
          <div key={label} className="min-w-0">
            <div className="text-[11.5px] text-faint">{label}</div>
            <div className={clsx("num mt-0.5 truncate text-[14px] font-semibold", tone)}>{value}</div>
            {sub && <div className="num truncate text-[11.5px] text-muted">{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
