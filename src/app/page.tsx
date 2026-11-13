"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LogTradeDialog, type Loggable } from "@/components/LogTradeDialog";
import { Heatmap, MarketPulse } from "@/components/MarketPulse";
import { SignalsRail } from "@/components/SignalsRail";
import { TradeInstruction, useBudget } from "@/components/TradeInstruction";
import { Badge, Button, CatalystTag, Change, FlowBar, Meter, Page, PageError, PageHeader, PageSkeleton, Panel, Segmented, Tabs, ticketHref } from "@/components/ui";
import { compact, contractLabel, pct, usd } from "@/lib/format";
import type { ScanResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type Filter = "all" | "earnings" | "calls" | "puts";
type View = "symbols" | "unusual" | "map";

export default function ScannerPage() {
  const router = useRouter();
  const { data, error } = usePoll<ScanResult>("/api/scan", 5000);
  const { budget } = useBudget();
  const [view, setView] = useState<View>("symbols");
  const [filter, setFilter] = useState<Filter>("all");
  const [logging, setLogging] = useState<Loggable | null>(null);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (filter === "earnings") return all.filter((r) => r.catalyst?.kind === "earnings");
    if (filter === "calls") return all.filter((r) => r.flowBias > 0.15);
    if (filter === "puts") return all.filter((r) => r.flowBias < -0.15);
    return all;
  }, [data, filter]);

  if (!data) return error ? <PageError message={error} /> : <PageSkeleton label="Scanning the market…" />;

  const all = data.rows;
  const earnings = all.filter((r) => r.catalyst?.kind === "earnings").length;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <span className="pulse-dot size-1.5 rounded-full bg-up" /> Live · {new Date(data.asOf).toLocaleTimeString("en-US")} · {all.length} symbols, {earnings} with
            earnings inside two weeks
          </>
        }
        title="Scanner"
        subtitle="Every name with a catalyst, ranked by how unusual and how tradable today's option flow is. Signals turn the strongest into exact orders."
      />

      <MarketPulse rows={all} lead={data.top[0]} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel className="min-w-0">
          <div className="flex h-12 items-stretch justify-between gap-3 border-b border-line px-5">
            <Tabs
              value={view}
              onChange={setView}
              options={[
                { value: "symbols", label: "Symbols", count: all.length },
                { value: "unusual", label: "Unusual contracts", count: data.top.length },
                { value: "map", label: "Heatmap" },
              ]}
            />
            {view === "symbols" && (
              <div className="hidden items-center sm:flex">
                <Segmented
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "earnings", label: "Earnings" },
                    { value: "calls", label: "Call-heavy" },
                    { value: "puts", label: "Put-heavy" },
                  ]}
                />
              </div>
            )}
          </div>

          {view === "map" ? (
            <Heatmap rows={all} />
          ) : view === "symbols" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] whitespace-nowrap text-left">
                <thead>
                  <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-5 [&>th]:font-medium">
                    <th>Symbol</th>
                    <th className="text-right">Price</th>
                    <th>Catalyst</th>
                    <th>Call share</th>
                    <th className="text-right">Put/Call</th>
                    <th className="text-right">Implied move</th>
                    <th className="text-right">IV</th>
                    <th>Top contract</th>
                    <th>Flow score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.quote.symbol}
                      onClick={() => router.push(`/s/${r.quote.symbol}`)}
                      className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-hover [&>td]:h-[52px] [&>td]:px-5"
                    >
                      <td>
                        <div className="font-semibold">{r.quote.symbol}</div>
                        <div className="max-w-40 truncate text-[12px] text-faint">{r.quote.name}</div>
                      </td>
                      <td className="text-right">
                        <div className="num">{usd(r.quote.price)}</div>
                        <Change value={r.quote.changePct} className="text-[12px]" />
                      </td>
                      <td>
                        <CatalystTag c={r.catalyst} />
                      </td>
                      <td>
                        <FlowBar bias={r.flowBias} />
                      </td>
                      <td className="num text-right">{r.pcRatio.toFixed(2)}</td>
                      <td className="num text-right">±{pct(r.expectedMovePct)}</td>
                      <td className="num text-right">{pct(r.atmIv, 0)}</td>
                      <td>
                        {r.top[0] ? (
                          <>
                            <div className={r.top[0].type === "call" ? "text-up" : "text-down"}>{contractLabel(r.top[0])}</div>
                            <div className="num text-[12px] text-faint">
                              {compact(r.top[0].volume)} vol · {r.top[0].volOi.toFixed(1)}× OI
                            </div>
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td>
                        <Meter value={r.score} />
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={9} className="h-28 text-center text-muted">
                        Nothing matches this filter right now.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.top.map((c) => (
                <li key={c.occ} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link href={`/s/${c.underlying}`} className="w-44 text-[14px] font-semibold hover:underline">
                      {c.underlying} <span className={c.type === "call" ? "text-up" : "text-down"}>{contractLabel(c)}</span>
                    </Link>
                    <div className="num flex flex-1 flex-wrap gap-x-5 text-[12px] text-muted">
                      <span>
                        <span className="text-fg">{usd(c.ask)}</span> ask
                      </span>
                      <span>
                        <span className="text-fg">{compact(c.volume)}</span> vol
                      </span>
                      <span>
                        <span className={c.volOi >= 1 ? "text-warn" : "text-fg"}>{c.volOi.toFixed(1)}×</span> OI
                      </span>
                      <span>
                        <span className="text-fg">{pct(c.pop, 0)}</span> implied odds
                      </span>
                    </div>
                    <Meter value={c.score} />
                    <div className="flex gap-1.5">
                      <Link href={ticketHref(c)}>
                        <Button>Calculate</Button>
                      </Link>
                      <Button variant="ghost" onClick={() => setLogging(c)}>
                        Log
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3">
                    {c.dte < 1 ? (
                      <p className="text-[12.5px] text-warn">Same-day expiry: no order. Your history loses most on these.</p>
                    ) : c.lastPos <= 0.3 ? (
                      <p className="text-[12.5px] text-muted">Prints are at the bid, so this volume looks like selling. Not a buy signal.</p>
                    ) : (
                      <TradeInstruction c={c} budget={budget} compact className="rounded-xl bg-raised/60 px-3.5 py-2.5" />
                    )}
                  </div>
                  {(c.why || c.ai) && (
                    <div className="mt-3 max-w-[90ch] space-y-1.5 text-[12.5px] leading-relaxed">
                      {c.why && <p className="text-muted">{c.why}</p>}
                      {c.ai && (
                        <p>
                          <Badge tone="accent" className="mr-2" title={`Written by ${c.ai.model} from recent headlines`}>
                            News
                          </Badge>
                          {c.ai.line}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <SignalsRail />
      </div>

      {logging && <LogTradeDialog contract={logging} onClose={() => setLogging(null)} />}
    </Page>
  );
}
