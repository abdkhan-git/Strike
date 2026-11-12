"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LogTradeDialog, type Loggable } from "@/components/LogTradeDialog";
import { SignalsRail } from "@/components/SignalsRail";
import { Button, CatalystTag, Change, FlowBar, Meter, Panel, Segmented, Stat, StatStrip, Tabs, ticketHref } from "@/components/ui";
import { compact, contractLabel, pct, usd } from "@/lib/format";
import type { ScanResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type Filter = "all" | "earnings" | "calls" | "puts";
type View = "symbols" | "unusual";

export default function ScannerPage() {
  const router = useRouter();
  const { data, error } = usePoll<ScanResult>("/api/scan", 5000);
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

  if (!data)
    return <div className="p-6 text-muted">{error ? <span className="text-down">{error}</span> : "Scanning the market…"}</div>;

  const all = data.rows;
  const callHeavy = all.filter((r) => r.flowBias > 0.15).length;
  const putHeavy = all.filter((r) => r.flowBias < -0.15).length;
  const earnings = all.filter((r) => r.catalyst?.kind === "earnings").length;
  const lead = data.top[0];

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Scanner</h1>
          <p className="mt-0.5 text-muted">Names with a catalyst, ranked by how unusual and how tradable today&apos;s option flow is.</p>
        </div>
        <div className="num text-[11.5px] text-faint">
          {new Date(data.asOf).toLocaleTimeString("en-US")} · refreshes every 5s
        </div>
      </div>

      <StatStrip>
        <Stat label="Symbols scanned" value={String(all.length)} sub={`${earnings} with earnings inside 2 weeks`} />
        <Stat label="Call-heavy flow" value={String(callHeavy)} sub="over 57% of premium in calls" tone="up" />
        <Stat label="Put-heavy flow" value={String(putHeavy)} sub="over 57% of premium in puts" tone="down" />
        <Stat
          label="Most unusual contract"
          value={lead ? `${lead.underlying} ${contractLabel(lead)}` : "—"}
          sub={lead ? `${lead.volOi.toFixed(1)}× open interest traded today` : undefined}
        />
      </StatStrip>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="min-w-0">
          <div className="flex h-10 items-stretch justify-between gap-3 border-b border-line px-4">
            <Tabs
              value={view}
              onChange={setView}
              options={[
                { value: "symbols", label: "Symbols", count: all.length },
                { value: "unusual", label: "Unusual contracts", count: data.top.length },
              ]}
            />
            {view === "symbols" && (
              <div className="flex items-center">
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

          {view === "symbols" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] whitespace-nowrap text-left">
                <thead>
                  <tr className="cap [&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:font-medium">
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
                      className="cursor-pointer border-b border-line/70 transition-colors last:border-0 hover:bg-raised/70 [&>td]:h-11 [&>td]:px-4"
                    >
                      <td>
                        <div className="font-semibold">{r.quote.symbol}</div>
                        <div className="max-w-36 truncate text-[12px] text-muted">{r.quote.name}</div>
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
                            <div className="num text-[12px] text-muted">
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
                      <td colSpan={9} className="h-24 text-center text-muted">
                        Nothing matches this filter right now.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <ul>
              {data.top.map((c) => (
                <li key={c.occ} className="border-b border-line/70 px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link href={`/s/${c.underlying}`} className="w-44 text-[13.5px] font-semibold hover:underline">
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
                  {(c.why || c.ai) && (
                    <div className="mt-2 max-w-[90ch] space-y-1 border-l border-line-strong pl-3 text-[12.5px] leading-snug">
                      {c.why && <p className="text-muted">{c.why}</p>}
                      {c.ai && (
                        <p>
                          <span className="cap mr-2 border border-line-strong px-1 !text-accent" title={`Written by ${c.ai.model} from recent headlines`}>
                            News · {c.ai.model}
                          </span>
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
    </div>
  );
}
