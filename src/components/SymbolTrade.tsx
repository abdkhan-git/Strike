"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Horizon, Outlook, SignalsResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { TradeInstruction, useBudget } from "./TradeInstruction";
import { Meter, Panel } from "./ui";

const HORIZON: Record<Horizon, string> = { eod: "today", week: "this week", month: "the next month", quarter: "the next two months" };

/** The one trade to make in this symbol right now, or a plain "no trade" when there is no edge. */
export function SymbolTrade({ symbol, callShare, outlook }: { symbol: string; callShare: number; outlook?: Outlook }) {
  const { data } = usePoll<SignalsResult>("/api/signals", 15_000);
  const { data: analysis } = usePoll<{ score: number; reversal: { signs: string[]; risk: number } }>(
    `/api/analysis?symbol=${encodeURIComponent(symbol)}`,
    30_000,
  );
  const { budget, paused } = useBudget();
  if (!data) return null;

  const best = data.signals
    .filter((s) => s.symbol === symbol && s.horizon !== "eod" && s.lead && s.conviction >= 60)
    .sort((a, b) => b.conviction - a.conviction)[0];

  const score = analysis?.score;
  const agrees = best && score !== undefined && (best.direction === "bullish" ? score >= 30 : score <= -30) && analysis!.reversal.risk < 0.5;

  if (best && score !== undefined && !agrees)
    return (
      <Panel tone="warn" className="px-5 py-4">
        <div className="text-[15px] font-semibold tracking-tight">No trade in {symbol} right now: the evidence is split.</div>
        <p className="mt-1 text-[13px] text-muted">
          Options flow leans {best.direction} (conviction {best.conviction}), but the full analysis is {score > 0 ? "+" : ""}
          {score}/100{analysis!.reversal.signs.length ? ` with a reversal warning: ${analysis!.reversal.signs[0]}` : ""}. Strike only
          recommends a trade when both point the same way.
        </p>
      </Panel>
    );

  if (!best)
    return (
      <Panel tone="neutral" className="px-5 py-4">
        <div className="text-[15px] font-semibold tracking-tight">No trade in {symbol} right now.</div>
        <p className="mt-1 text-[13px] text-muted">
          Options money is not lined up on one side ({Math.round(callShare * 100)}% of premium in calls), so there is no edge to buy into.
          Skip it, or check the Signals rail and Picks for names that do have one.
        </p>
      </Panel>
    );

  const up = best.direction === "bullish";
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const fighting = outlook && ((up && outlook.lean === "down") || (!up && outlook.lean === "up"));

  return (
    <Panel tone={up ? "up" : "down"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <span className="text-[13px] font-semibold">The trade</span>
        <span className={clsx("flex items-center gap-0.5 text-[13px] font-semibold", up ? "text-up" : "text-down")}>
          <Arrow size={15} strokeWidth={2} />
          {up ? "Bullish" : "Bearish"} {symbol} for {HORIZON[best.horizon]}
        </span>
        <Meter value={best.conviction} tone={up ? "up" : "down"} />
        <span className="text-[11.5px] text-faint">flow conviction</span>
        {score !== undefined && (
          <span className="num text-[11.5px] text-muted">
            analysis {score > 0 ? "+" : ""}
            {score}/100
          </span>
        )}
      </div>
      <div className="p-4 pt-2.5">
        <TradeInstruction c={best.lead!} horizon={best.horizon} budget={budget} paused={paused} />
        {fighting && (
          <p className="mt-2 text-[12.5px] text-warn">
            Short-term momentum is moving against this right now. Place the limit order and let price come to you rather than chasing.
          </p>
        )}
        <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-[12px] leading-snug text-muted md:grid-cols-2">
          {best.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
              {r}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
