"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { shortDate, usd } from "@/lib/format";
import type { Horizon, SignalsResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { TradeInstruction, useBudget } from "./TradeInstruction";
import { Badge, Bullets, Meter, Panel, PanelHeader, Segmented, ticketHref } from "./ui";

const HORIZONS: { value: Horizon | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "eod", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "1 mo" },
  { value: "quarter", label: "2 mo" },
];

const HORIZON_LABEL: Record<Horizon, string> = { eod: "End of day", week: "This week", month: "1 month", quarter: "2 months" };

/** Below this the positioning is too mixed to call one-sided. */
const MIN_CONVICTION = 50;
const STRONG = 70;

export function SignalsRail() {
  const { data, error } = usePoll<SignalsResult>("/api/signals", 10_000);
  const { budget, paused } = useBudget();
  const [horizon, setHorizon] = useState<Horizon | "all">("all");

  const list = (data?.signals ?? [])
    .filter((s) => s.conviction >= MIN_CONVICTION && (horizon === "all" || s.horizon === horizon))
    .slice(0, 12);

  return (
    <Panel className="self-start xl:sticky xl:top-6">
      <PanelHeader title="Signals" sub="One-sided option flow, strongest first" />
      <div className="border-b border-line px-4 py-2.5">
        <Segmented value={horizon} onChange={setHorizon} options={HORIZONS} />
      </div>

      {!data ? (
        <div className="px-5 py-10 text-center text-muted">{error ? <span className="text-down">{error}</span> : "Reading the tape…"}</div>
      ) : !list.length ? (
        <div className="px-5 py-10 text-center text-muted">
          No strongly one-sided flow {horizon === "eod" ? "in contracts expiring today" : "in this window"} right now.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((s) => {
            const up = s.direction === "bullish";
            const Arrow = up ? ArrowUpRight : ArrowDownRight;
            return (
              <li key={`${s.symbol}${s.horizon}`}>
                <Link href={s.lead ? ticketHref(s.lead) : `/s/${s.symbol}`} className={clsx("edge block px-5 py-4 transition-colors hover:bg-hover", up ? "edge-up" : "edge-down")}>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold tracking-[-0.01em]">{s.symbol}</span>
                    <span className={clsx("flex items-center gap-0.5 text-[12.5px] font-medium", up ? "text-up" : "text-down")}>
                      <Arrow size={14} strokeWidth={2.2} />
                      {up ? "Bullish" : "Bearish"}
                    </span>
                    {s.conviction >= STRONG && <Badge>Strong</Badge>}
                    <span className="ml-auto">
                      <Meter value={s.conviction} tone={up ? "up" : "down"} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                    <span>{HORIZON_LABEL[s.horizon]}</span>
                    <span className="text-faint">·</span>
                    <span>
                      exp {shortDate(s.exp)}
                      {s.dte >= 1 && `, ${Math.round(s.dte)}d`}
                    </span>
                    <span className="num ml-auto text-fg">{usd(s.price)}</span>
                  </div>
                  {s.lead && s.horizon !== "eod" && <TradeInstruction c={s.lead} horizon={s.horizon} budget={budget} compact className="mt-3 rounded-xl bg-raised/60 px-3 py-2.5" />}
                  {s.horizon === "eod" && (
                    <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-[12px] text-warn">Same-day expiry: your history loses most here. Watch, don&apos;t chase.</p>
                  )}
                  <Bullets items={s.reasons} className="mt-3 !text-[12px] !text-faint" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-faint">
        {paused ? "Your plan has paused new trades today, so these are for watching or tomorrow. " : ""}Orders are sized to your plan&apos;s risk per
        trade. Conviction measures how lopsided, unusual and large the dominant side is; heavy put buying can also be a hedge.
      </p>
    </Panel>
  );
}
