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
        <div className="font-medium">
          <span className={up ? "text-up" : "text-down"}>{ins.headline}</span>
        </div>
        <div className="num mt-0.5 text-[11.5px] text-muted">
          limit {money(ins.limit)} · {whole(ins.cost)} · {ins.when} · sell at {money(ins.targetPrice)} (+{Math.round(ins.targetPct * 100)}%) or by{" "}
          {ins.sellBy.text} · cut {money(ins.stopPrice)}
        </div>
        {ins.overBudget && <div className="mt-0.5 text-[11px] text-warn">One contract is over twice your risk per trade; size down or skip.</div>}
      </div>
    );

  const cells: [string, string, string?][] = [
    ["Limit price", money(ins.limit), `${whole(ins.cost)} total`],
    ["When", ins.when === "now" ? "Now" : ins.when.replace(/^at the open/, "At the open"), ins.when === "now" ? "market is open" : "9:30 am ET"],
    ["Take profit", money(ins.targetPrice), `+${Math.round(ins.targetPct * 100)}% · +${whole(ins.targetGain)}`],
    ["Sell by", ins.sellBy.text.replace(/, (\d)/, " · $1"), "at the latest"],
    ["Stop", money(ins.stopPrice), `−${whole(ins.maxLoss)} max loss`],
  ];

  return (
    <div className={clsx("border border-line-strong", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-[15px] font-semibold tracking-tight">
          <span className={up ? "text-up" : "text-down"}>{ins.headline}</span>
        </span>
        {paused ? (
          <span className="text-[11.5px] text-warn">Plan paused today: for tomorrow or watching only</span>
        ) : ins.overBudget ? (
          <span className="text-[11.5px] text-warn">One contract is more than twice your risk per trade</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
        {cells.map(([label, value, sub]) => (
          <div key={label} className="bg-panel px-3 py-2">
            <div className="cap">{label}</div>
            <div className="num mt-0.5 text-[13.5px] font-medium">{value}</div>
            {sub && <div className="num text-[11px] text-muted">{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
