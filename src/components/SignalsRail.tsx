"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { shortDate, usd } from "@/lib/format";
import type { Horizon, SignalsResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { TradeInstruction, useBudget } from "./TradeInstruction";
import { Meter, Panel, ticketHref } from "./ui";

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
      <div className="flex h-10 items-center justify-between border-b border-line px-4">
        <h2 className="cap !text-muted">Signals</h2>
        <span className="text-[11px] text-faint">one-sided option flow, strongest first</span>
      </div>
      <div className="flex border-b border-line">
        {HORIZONS.map((h) => (
          <button
            key={h.value}
            onClick={() => setHorizon(h.value)}
            className={clsx(
              "relative h-8 flex-1 text-[12px] transition-colors",
              horizon === h.value ? "font-medium text-fg" : "text-muted hover:text-fg",
            )}
          >
            {h.label}
            {horizon === h.value && <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="px-4 py-8 text-center text-muted">{error ? <span className="text-down">{error}</span> : "Reading the tape…"}</div>
      ) : !list.length ? (
        <div className="px-4 py-8 text-center text-muted">
          No strongly one-sided flow {horizon === "eod" ? "in contracts expiring today" : "in this window"} right now.
        </div>
      ) : (
        <ul>
          {list.map((s) => {
            const up = s.direction === "bullish";
            const Arrow = up ? ArrowUpRight : ArrowDownRight;
            return (
              <li key={`${s.symbol}${s.horizon}`} className="border-b border-line/70 last:border-0">
                <Link
                  href={s.lead ? ticketHref(s.lead) : `/s/${s.symbol}`}
                  className={clsx(
                    "block border-l-2 px-4 py-3 transition-colors hover:bg-raised/70",
                    up ? "border-l-up" : "border-l-down",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold">{s.symbol}</span>
                    <span className={clsx("flex items-center gap-0.5 text-[12px] font-medium", up ? "text-up" : "text-down")}>
                      <Arrow size={13} strokeWidth={2} />
                      {up ? "Bullish" : "Bearish"}
                    </span>
                    {s.conviction >= STRONG && <span className="cap border border-line-strong px-1 !text-fg">Strong</span>}
                    <span className="ml-auto">
                      <Meter value={s.conviction} tone={up ? "up" : "down"} />
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                    <span className="text-fg">{HORIZON_LABEL[s.horizon]}</span>
                    <span className="text-faint">·</span>
                    <span>
                      exp {shortDate(s.exp)}
                      {s.dte >= 1 && `, ${Math.round(s.dte)}d`}
                    </span>
                    <span className="num ml-auto">{usd(s.price)}</span>
                  </div>
                  {s.lead && s.horizon !== "eod" && (
                    <TradeInstruction c={s.lead} horizon={s.horizon} budget={budget} compact className="mt-2 border-l border-line-strong pl-2.5" />
                  )}
                  {s.horizon === "eod" && (
                    <p className="mt-2 text-[11.5px] text-warn">Same-day expiry: your history loses most here. Watch, don't chase.</p>
                  )}
                  <ul className="mt-2 space-y-0.5 text-[11.5px] leading-snug text-faint">
                    {s.reasons.map((r) => (
                      <li key={r} className="flex gap-2">
                        <span className="mt-[7px] size-[3px] shrink-0 bg-faint" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-snug text-faint">
        {paused ? "Your plan has paused new trades today, so these are for watching or tomorrow. " : ""}Orders are sized to your plan's
        risk per trade. Conviction measures how lopsided, unusual and large the dominant side is; heavy put buying can also be a hedge.
      </p>
    </Panel>
  );
}
