"use client";

import clsx from "clsx";
import Link from "next/link";
import { contractLabel, pct, signedPct, usd } from "@/lib/format";
import type { ChartResult, Enriched, SymbolSummary } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { Ring, Sparkline } from "./ui";

const card = "min-w-0 rounded-2xl border border-line bg-panel px-5 py-4";

/** One index with today's price path. */
function IndexCard({ row }: { row?: SymbolSummary }) {
  const symbol = row?.quote.symbol;
  const { data } = usePoll<ChartResult>(symbol ? `/api/chart?symbol=${symbol}` : null, 60_000);
  if (!row) return <div className={card} />;
  const q = row.quote;
  const up = q.changePct >= 0;
  // five-minute closes keep the line smooth and the SVG small
  const closes = (data?.bars ?? []).filter((_, i) => i % 5 === 0).map((b) => b.c);
  return (
    <Link href={`/s/${q.symbol}`} className={clsx(card, "block transition-colors hover:border-line-strong")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">{q.symbol}</span>
        <span className={clsx("num text-[12px] font-medium", up ? "text-up" : "text-down")}>{signedPct(q.changePct)}</span>
      </div>
      <div className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.035em]">{usd(q.price)}</div>
      <Sparkline values={[...closes, q.price]} base={q.prevClose} tone={up ? "up" : "down"} height={46} className="mt-3" />
      <div className="mt-2 flex justify-between text-[11.5px] text-faint">
        <span>Implied move ±{pct(row.expectedMovePct)}</span>
        <span>{pct((row.flowBias + 1) / 2, 0)} calls</span>
      </div>
    </Link>
  );
}

/** The market at a glance: the two indices, how many names are up, and which way option money leans. */
export function MarketPulse({ rows, lead }: { rows: SymbolSummary[]; lead?: Enriched }) {
  const by = (s: string) => rows.find((r) => r.quote.symbol === s);
  const adv = rows.filter((r) => r.quote.changePct > 0).length;
  const dec = rows.filter((r) => r.quote.changePct < 0).length;
  const avg = rows.length ? rows.reduce((s, r) => s + r.quote.changePct, 0) / rows.length : 0;
  const sorted = [...rows].sort((a, b) => b.quote.changePct - a.quote.changePct);
  const movers = [...sorted.slice(0, 2), ...sorted.slice(-2)];

  const callVol = rows.reduce((s, r) => s + r.callVol, 0);
  const putVol = rows.reduce((s, r) => s + r.putVol, 0);
  const callShare = callVol + putVol > 0 ? callVol / (callVol + putVol) : 0.5;
  const callHeavy = rows.filter((r) => r.flowBias > 0.15).length;
  const putHeavy = rows.filter((r) => r.flowBias < -0.15).length;
  const lean = callShare >= 0.55 ? "Leaning bullish" : callShare <= 0.45 ? "Leaning bearish" : "Balanced";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <IndexCard row={by("SPY")} />
      <IndexCard row={by("QQQ")} />

      <div className={card}>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-muted">Breadth</span>
          <span className={clsx("num text-[12px] font-medium", avg >= 0 ? "text-up" : "text-down")}>avg {signedPct(avg)}</span>
        </div>
        <div className="num mt-2 text-[24px] font-semibold leading-none tracking-[-0.035em]">
          <span className="text-up">{adv}</span>
          <span className="mx-1.5 text-[16px] font-normal text-faint">up</span>
          <span className="text-down">{dec}</span>
          <span className="ml-1.5 text-[16px] font-normal text-faint">down</span>
        </div>
        <div className="mt-3 flex h-1.5 gap-0.5">
          <span className="rounded-full bg-up" style={{ width: `${rows.length ? (adv / rows.length) * 100 : 50}%` }} />
          <span className="flex-1 rounded-full bg-down" />
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          {movers.map((r) => (
            <li key={r.quote.symbol}>
              <Link href={`/s/${r.quote.symbol}`} className="flex justify-between hover:opacity-70">
                <span className="font-medium">{r.quote.symbol}</span>
                <span className={clsx("num", r.quote.changePct >= 0 ? "text-up" : "text-down")}>{signedPct(r.quote.changePct, 1)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={clsx(card, "flex items-center gap-4")}>
        <Ring value={callShare} size={92} stroke={8} tone={callShare >= 0.5 ? "up" : "down"}>
          <div>
            <div className="num text-[18px] font-semibold leading-none tracking-[-0.03em]">{pct(callShare, 0)}</div>
            <div className="mt-0.5 text-[10.5px] text-faint">calls</div>
          </div>
        </Ring>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-muted">Option flow</div>
          <div className="mt-1 text-[16px] font-semibold tracking-[-0.02em]">{lean}</div>
          <div className="mt-1 text-[12px] text-faint">
            <span className="text-up">{callHeavy}</span> call-heavy · <span className="text-down">{putHeavy}</span> put-heavy
          </div>
          {lead && (
            <Link href={`/s/${lead.underlying}`} className="mt-2 block truncate text-[12px] text-muted hover:text-fg" title="Most unusual contract right now">
              Most unusual: <span className={lead.type === "call" ? "text-up" : "text-down"}>{lead.underlying} {contractLabel(lead)}</span> · {lead.volOi.toFixed(1)}× OI
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Every scanned name as a tile, coloured by today's move. */
export function Heatmap({ rows }: { rows: SymbolSummary[] }) {
  const sorted = [...rows].sort((a, b) => b.quote.changePct - a.quote.changePct);
  return (
    <div className="grid grid-cols-3 gap-1.5 p-4 sm:grid-cols-5 lg:grid-cols-7 2xl:grid-cols-9">
      {sorted.map((r) => {
        const c = r.quote.changePct;
        // full colour at a 4% move
        const strength = Math.round(Math.min(1, Math.abs(c) / 0.04) * 34 + 8);
        return (
          <Link
            key={r.quote.symbol}
            href={`/s/${r.quote.symbol}`}
            className="rounded-xl px-3 py-2.5 transition-opacity hover:opacity-75"
            style={{ background: `color-mix(in srgb, var(${c >= 0 ? "--c-up" : "--c-down"}) ${strength}%, transparent)` }}
            title={`${r.quote.name} · ${pct((r.flowBias + 1) / 2, 0)} of premium in calls`}
          >
            <div className="text-[13px] font-semibold">{r.quote.symbol}</div>
            <div className="num text-[12px]">{signedPct(c, 1)}</div>
          </Link>
        );
      })}
    </div>
  );
}
