"use client";

import clsx from "clsx";
import Link from "next/link";
import { signedPct, usd } from "@/lib/format";
import type { ScanResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

const FIRST = ["SPY", "QQQ", "IWM", "DIA"];

/** Scrolling strip of live quotes for every scanned symbol, indices first. Pauses on hover. */
export function TickerTape() {
  const { data } = usePoll<ScanResult>("/api/scan", 10_000);
  const quotes = (data?.rows ?? [])
    .map((r) => r.quote)
    .sort((a, b) => {
      const ia = FIRST.indexOf(a.symbol);
      const ib = FIRST.indexOf(b.symbol);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || Math.abs(b.changePct) - Math.abs(a.changePct);
    });
  if (!quotes.length) return <div className="h-8 shrink-0 border-b border-line" />;

  const items = quotes.map((q) => (
    <Link key={q.symbol} href={`/s/${q.symbol}`} className="flex shrink-0 items-center gap-2 px-4 text-[12px] hover:bg-raised">
      <span className="font-semibold">{q.symbol}</span>
      <span className="num text-muted">{usd(q.price)}</span>
      <span className={clsx("num", q.changePct >= 0 ? "text-up" : "text-down")}>{signedPct(q.changePct)}</span>
    </Link>
  ));

  return (
    <div className="relative h-8 shrink-0 overflow-hidden border-b border-line bg-panel">
      {/* two copies so the strip loops without a gap */}
      <div className="tape flex h-full w-max items-stretch">
        <div className="flex items-stretch divide-x divide-line">{items}</div>
        <div className="flex items-stretch divide-x divide-line" aria-hidden>
          {items}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-panel to-transparent" />
    </div>
  );
}
