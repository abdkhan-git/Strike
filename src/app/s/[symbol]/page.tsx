"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LogTradeDialog, type Loggable } from "@/components/LogTradeDialog";
import { NewsPanel } from "@/components/NewsPanel";
import { AnalysisGauge } from "@/components/AnalysisGauge";
import { OutlookBand, PriceChart, type ChartLine } from "@/components/PriceChart";
import { SymbolTrade } from "@/components/SymbolTrade";
import { Tick } from "@/components/Tick";
import { Button, CatalystTag, Change, Chip, Meter, NumberTicker, Page, PageError, PageHeader, PageSkeleton, Panel, PanelHeader, Segmented, Stat, StatStrip, ticketHref } from "@/components/ui";
import { compact, pct, shortDate, signedPct, signedUsd, strikeLabel, usd } from "@/lib/format";
import type { Analysis } from "@/lib/thesis";
import type { ChartResult, OptType, SymbolView, TradeView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function SymbolPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  return <SymbolDetail key={sym} symbol={sym} />;
}

function SymbolDetail({ symbol }: { symbol: string }) {
  const [exp, setExp] = useState<string | undefined>();
  const [side, setSide] = useState<OptType>("call");
  const [logging, setLogging] = useState<Loggable | null>(null);
  const { data, error } = usePoll<SymbolView>(
    `/api/symbol?symbol=${encodeURIComponent(symbol)}${exp ? `&exp=${exp}` : ""}`,
    5000,
  );

  const { data: chart } = usePoll<ChartResult>(`/api/chart?symbol=${encodeURIComponent(symbol)}`, 10_000);
  const { data: analysis } = usePoll<Analysis>(`/api/analysis?symbol=${encodeURIComponent(symbol)}`, 30_000);
  const { data: trades } = usePoll<TradeView[]>("/api/trades", 15_000);
  const trend = chart?.trend;

  const spot = data?.summary.quote.price ?? 0;

  const { rows, bars, atm, walls } = useMemo(() => {
    const cs = data?.contracts ?? [];
    const strikes = [...new Set(cs.map((c) => c.strike))].sort((a, b) => a - b);
    const atm = strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0] ?? 0);
    const i = strikes.indexOf(atm);
    const near = new Set(strikes.slice(Math.max(0, i - 12), i + 13));
    const bars = [...near].map((k) => ({
      strike: strikeLabel(k),
      Calls: cs.find((c) => c.strike === k && c.type === "call")?.volume ?? 0,
      Puts: cs.find((c) => c.strike === k && c.type === "put")?.volume ?? 0,
    }));
    const most = (type: OptType) => cs.filter((c) => c.type === type).sort((a, b) => b.openInterest - a.openInterest)[0]?.strike;
    const call = most("call");
    const put = most("put");
    const walls = call !== undefined && put !== undefined ? { call, put } : undefined;
    return { rows: cs.filter((c) => c.type === side && near.has(c.strike)), bars, atm, walls };
  }, [data, side, spot]);

  const lines = useMemo<ChartLine[]>(() => {
    const out: ChartLine[] = [];
    if (analysis) {
      out.push({ price: analysis.levels.support, label: "support", tone: "muted" });
      out.push({ price: analysis.levels.resistance, label: "resistance", tone: "muted" });
    }
    for (const t of trades ?? []) {
      if (t.status !== "open" || t.underlying !== symbol || !t.verdict?.thesis) continue;
      out.push({ price: t.verdict.thesis.invalidation, label: `${t.type} invalidation`, tone: "down" });
    }
    return out;
  }, [analysis, trades, symbol]);

  if (!data)
    return error ? <PageError message={error} /> : <PageSkeleton label={`Loading ${symbol}…`} />;

  const s = data.summary;
  const q = s.quote;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <Link href="/" className="hover:text-fg">
              Scanner
            </Link>
            <span>/</span>
            <span className="normal-case tracking-normal text-muted">{q.name}</span>
            <CatalystTag c={s.catalyst} />
          </>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>{q.symbol}</span>
            <Tick value={q.price} className="num font-medium">
              <NumberTicker value={q.price} format={(n) => usd(n)} />
            </Tick>
            <Change value={q.changePct} className="text-[15px]" />
            <span className={clsx("num text-[14px]", q.change >= 0 ? "text-up" : "text-down")}>{signedUsd(q.change)}</span>
          </span>
        }
        right={
          <>
            {error && <span className="text-[12px] text-down">{error}</span>}
            {analysis && <AnalysisGauge score={analysis.score} />}
            <Link href={`/calculator?sym=${symbol}`}>
              <Button variant="primary">Trade {symbol}</Button>
            </Link>
          </>
        }
      />

      <SymbolTrade symbol={symbol} callShare={(s.flowBias + 1) / 2} outlook={chart?.outlook} />

      <OutlookBand outlook={chart?.outlook} loading={!chart} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          <PriceChart data={chart} price={q.price} lines={lines} />
          <StatStrip>
            <Stat
              label={`Implied move by ${shortDate(s.exp)}`}
              value={`±${pct(s.expectedMovePct)}`}
              sub={`${usd(q.price * (1 - s.expectedMovePct))} – ${usd(q.price * (1 + s.expectedMovePct))}`}
            />
            <Stat label="At-the-money IV" value={pct(s.atmIv, 0)} sub="annualised, this expiration" />
            <Stat
              label="Realized vol, 20 days"
              value={trend ? pct(trend.rv20, 0) : "—"}
              sub={
                trend && trend.rv20 > 0
                  ? `options price in ${(s.atmIv / trend.rv20).toFixed(1)}× the recent movement`
                  : "how much the stock has actually moved"
              }
            />
            <Stat
              label="vs 20-day average"
              value={trend ? signedPct(trend.vsSma20, 1) : "—"}
              sub={trend ? `average ${usd(trend.sma20)}` : undefined}
              tone={trend ? (trend.vsSma20 >= 0 ? "up" : "down") : undefined}
            />
            <Stat label="Put / call volume" value={s.pcRatio.toFixed(2)} sub={`${compact(s.callVol)} calls · ${compact(s.putVol)} puts`} />
            <Stat
              label="Premium in calls"
              value={pct((s.flowBias + 1) / 2, 0)}
              sub={s.flowBias > 0.15 ? "call-heavy" : s.flowBias < -0.15 ? "put-heavy" : "balanced"}
              tone={s.flowBias > 0.15 ? "up" : s.flowBias < -0.15 ? "down" : undefined}
            />
            <Stat
              label="Open-interest walls"
              value={walls ? `${strikeLabel(walls.put)}P · ${strikeLabel(walls.call)}C` : "—"}
              sub="strikes holding the most open puts and calls"
            />
            <Stat
              label="20-day range"
              value={trend ? `${usd(trend.low20, 0)} – ${usd(trend.high20, 0)}` : "—"}
              sub={trend ? `now ${pct((q.price - trend.low20) / Math.max(trend.high20 - trend.low20, 0.01), 0)} of the way up` : undefined}
            />
          </StatStrip>
        </div>
        <NewsPanel symbol={symbol} />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {data.expirations.slice(0, 18).map((e) => (
          <Chip key={e} active={e === s.exp} onClick={() => setExp(e)}>
            {shortDate(e)}
          </Chip>
        ))}
      </div>

      <Panel className="min-w-0">
        <PanelHeader
          title={`Volume by strike today · ${shortDate(s.exp)}`}
          right={
            <div className="flex items-center gap-4 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-up" /> Calls
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-down" /> Puts
              </span>
            </div>
          }
        />
        <div className="h-[240px] px-2 pb-2 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} barGap={1} barCategoryGap="22%" margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="strike" tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
              <YAxis width={44} tickFormatter={compact} tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--c-hover)" }}
                contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "var(--color-muted)" }}
                labelFormatter={(l) => `Strike ${l}`}
                formatter={(v) => Number(v).toLocaleString("en-US")}
              />
              <ReferenceLine x={strikeLabel(atm)} stroke="var(--color-faint)" strokeDasharray="3 3" label={{ value: "spot", position: "top", fill: "var(--color-muted)", fontSize: 11 }} />
              <Bar dataKey="Calls" fill="var(--color-up)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Puts" fill="var(--color-down)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader
          title={`Chain · ${shortDate(s.exp)} · ${Math.max(1, Math.round(rows[0]?.dte ?? 0))}d to expiry`}
          right={
            <Segmented
              value={side}
              onChange={setSide}
              options={[
                { value: "call", label: "Calls" },
                { value: "put", label: "Puts" },
              ]}
            />
          }
        />
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[960px] whitespace-nowrap text-right text-[12.5px]">
            <thead>
              <tr className="cap [&>th]:h-9 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:font-medium">
                <th className="text-left">Strike</th>
                <th>Bid</th>
                <th>Ask</th>
                <th>Volume</th>
                <th>Open int.</th>
                <th>Vol / OI</th>
                <th>IV</th>
                <th>Delta</th>
                <th title="Market-implied probability of profit at expiry">Implied odds</th>
                <th>Break-even</th>
                <th className="text-left">Flow score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const itm = c.type === "call" ? c.strike < spot : c.strike > spot;
                return (
                  <tr
                    key={c.occ}
                    className={clsx(
                      "border-b border-line last:border-0 hover:bg-hover [&>td]:h-9 [&>td]:px-3",
                      itm && "bg-raised/30",
                    )}
                  >
                    <td className="text-left font-semibold">
                      {strikeLabel(c.strike)}
                      {c.strike === atm && <span className="ml-2 text-[11px] font-normal text-muted">ATM</span>}
                    </td>
                    <td>{c.bid.toFixed(2)}</td>
                    <td>{c.ask.toFixed(2)}</td>
                    <td>{c.volume.toLocaleString("en-US")}</td>
                    <td className="text-muted">{c.openInterest.toLocaleString("en-US")}</td>
                    <td className={c.volOi >= 1 ? "font-medium text-warn" : "text-muted"}>{c.volOi.toFixed(2)}×</td>
                    <td>{pct(c.iv, 0)}</td>
                    <td className="text-muted">{c.delta.toFixed(2)}</td>
                    <td>{pct(c.pop, 0)}</td>
                    <td className="text-muted">{usd(c.breakeven)}</td>
                    <td className="text-left">
                      <Meter value={c.score} />
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link href={ticketHref(c)}>
                          <Button variant="ghost">Calculate</Button>
                        </Link>
                        <Button onClick={() => setLogging(c)}>Log</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {logging && <LogTradeDialog contract={logging} onClose={() => setLogging(null)} />}
    </Page>
  );
}
