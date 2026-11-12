"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tick } from "@/components/Tick";
import { TradeInstruction } from "@/components/TradeInstruction";
import { Button, Meter, Panel, PanelHeader, ticketHref } from "@/components/ui";
import { contractLabel, dateLabel, pct, shortDate, signedPct, usd } from "@/lib/format";
import type { Briefing, Checkpoint, Enriched, Horizon, TrackBucket, TrackView, Verdict } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

type PicksData = {
  briefing?: Briefing;
  live: Record<string, { mark: number; ret: number; spot: number; verdict?: Verdict; contract?: Enriched }>;
  track: TrackView;
};

const HORIZON: Record<Horizon, string> = { eod: "Today", week: "This week", month: "1 month", quarter: "2 months" };
const CP: { key: Checkpoint; label: string }[] = [
  { key: "h1", label: "1 hour" },
  { key: "close", label: "Same-day close" },
  { key: "d1", label: "Next day" },
  { key: "expiry", label: "Expiry" },
];
const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");

/** Today's picks (with live calls), the re-rank button and the track record. Rendered on the Plan page. */
export function PicksSection({ paused }: { paused?: boolean }) {
  const { data, error, reload } = usePoll<PicksData>("/api/picks", 10_000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/picks?action=run", { method: "POST" });
    setBusy(false);
    if (!res.ok) setErr((await res.json()).error ?? "Could not build picks");
    reload();
  }

  if (!data) return <div className="p-6 text-muted">{error ? <span className="text-down">{error}</span> : "Loading picks…"}</div>;

  const b = data.briefing;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const isToday = b?.day === today;
  const total = b?.picks.reduce((s, p) => s + p.cost, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Today&apos;s picks</h2>
        <div className="flex items-center gap-3">
          {err && <span className="text-[12px] text-down">{err}</span>}
          <Button variant={isToday ? "default" : "primary"} onClick={run} disabled={busy}>
            {busy ? "Ranking setups…" : isToday ? "Re-rank now" : "Build today's picks now"}
          </Button>
        </div>
      </div>

      {!b ? (
        <Panel className="px-4 py-10 text-center text-muted">
          No picks yet. They are built automatically at 9:45 ET on weekdays, or press the button to build them now.
        </Panel>
      ) : (
        <Panel>
          <PanelHeader
            title={`${isToday ? "Today" : dateLabel(b.day)} · built ${new Date(b.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            right={
              <span className="num text-[11.5px] text-muted">
                {usd(b.budget, 0)} risk each · {usd(total, 0)} for all {b.picks.length}
                {b.cash !== undefined && ` · ${usd(b.cash, 0)} cash`}
              </span>
            }
          />
          {b.paused && (
            <div className="border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn">
              Plan paused today: your daily loss limit or position slots say no new trades. These are listed for watching and for
              tomorrow.
            </div>
          )}
          {b.picks.length === 0 && <div className="px-4 py-8 text-center text-muted">No setup passed the filters.</div>}
          <ul>
            {b.picks.map((p) => {
              const up = p.direction === "bullish";
              const Arrow = up ? ArrowUpRight : ArrowDownRight;
              const live = data.live[p.symbol];
              const entry = p.contract.ask || p.contract.mid;
              return (
                <li key={p.symbol} className={clsx("border-b border-l-2 border-b-line/70 px-4 py-4 last:border-b-0", up ? "border-l-up" : "border-l-down")}>
                  {live?.verdict && (
                    <div
                      className={clsx(
                        "mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 pl-3",
                        live.verdict.tone === "up" ? "border-l-up" : live.verdict.tone === "down" ? "border-l-down" : live.verdict.tone === "warn" ? "border-l-warn" : "border-l-line-strong",
                      )}
                    >
                      <span className="cap">Right now</span>
                      <span className="text-[13.5px] font-semibold">
                        {live.verdict.move === "keep"
                          ? live.verdict.quality === "bad"
                            ? "Still weak: skip it if you haven't bought"
                            : "Still valid: OK to buy at the limit below"
                          : live.verdict.quality === "bad"
                            ? "Broken: don't buy; sell if you hold it"
                            : "Already moved: if you hold it, take the gain"}
                      </span>
                      <span className="text-[12px] text-muted">{live.verdict.headline}</span>
                    </div>
                  )}
                  <TradeInstruction c={live?.contract ?? p.contract} horizon={p.horizon} budget={b.budget} paused={b.paused || paused} className="mb-3" />
                  {p.thesis && (
                    <div className="mb-3 grid gap-3 border border-line px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                      <div>
                        <div className="cap mb-1">
                          The case{p.decidedBy ? ` · chosen by ${p.decidedBy}` : ""}
                          {p.analysisScore !== undefined && ` · analysis ${p.analysisScore > 0 ? "+" : ""}${p.analysisScore}/100`}
                        </div>
                        <p className="text-[13px] leading-relaxed">{p.thesis}</p>
                        {p.invalidation !== undefined && (
                          <p className="mt-2 text-[12.5px]">
                            <span className="font-semibold text-down">
                              Wrong if {p.symbol} {p.direction === "bullish" ? "falls below" : "rises above"} {usd(p.invalidation)}
                            </span>
                            {p.invalidationReason && <span className="text-muted">: {p.invalidationReason}</span>}
                          </p>
                        )}
                      </div>
                      {!!p.risks?.length && (
                        <div>
                          <div className="cap mb-1">What could break it</div>
                          <ul className="space-y-1 text-[12px] leading-snug text-muted">
                            {p.risks.map((r) => (
                              <li key={r} className="flex gap-2">
                                <span className="mt-[7px] size-[3px] shrink-0 bg-warn" />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_220px]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="num w-5 text-[13px] text-faint">{p.rank}</span>
                      <Link href={`/s/${p.symbol}`} className="text-[16px] font-semibold hover:underline">
                        {p.symbol}
                      </Link>
                      <span className={clsx("flex items-center gap-0.5 text-[12.5px] font-medium", up ? "text-up" : "text-down")}>
                        <Arrow size={14} strokeWidth={2} />
                        {up ? "Bullish" : "Bearish"}
                      </span>
                      <span className="text-[12px] text-muted">{HORIZON[p.horizon]}</span>
                    </div>
                    <div className="num mt-1 pl-7 text-[12px] text-muted">
                      {contractLabel(p.contract)} · expires {dateLabel(p.contract.expiration)}
                    </div>
                    <div className="mt-2 flex items-center gap-3 pl-7">
                      <Meter value={p.score} tone={up ? "up" : "down"} />
                      <span className="text-[11px] text-faint">score</span>
                    </div>
                  </div>

                  <ul className="space-y-0.5 text-[12.5px] leading-snug text-muted">
                    {p.reasons.map((r) => (
                      <li key={r} className="flex gap-2">
                        <span className="mt-[7px] size-[3px] shrink-0 bg-faint" />
                        {r}
                      </li>
                    ))}
                    <li className="flex gap-2 pt-1 text-fg">
                      <span className="mt-[7px] size-[3px] shrink-0 bg-fg" />
                      {pct(p.contract.pop, 0)} odds the stock is past break-even at expiry.
                    </li>
                  </ul>

                  <div className="flex flex-col justify-between gap-3 xl:items-end">
                    {live ? (
                      <div className="xl:text-right">
                        <div className="cap">Since picked</div>
                        <Tick value={live.mark} className={clsx("num text-[20px] font-medium", tone(live.ret))}>
                          {signedPct(live.ret, 0)}
                        </Tick>
                        <div className="num text-[12px] text-muted">
                          {usd(entry)} → {usd(live.mark)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[12px] text-faint">No live quote</span>
                    )}
                    <Link href={ticketHref(p.contract)}>
                      <Button>Open ticket</Button>
                    </Link>
                  </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {b.passed && (
            <p className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-muted">
              <span className="cap mr-2">{b.picks.length ? "Passed over" : "No trade"}</span>
              {b.passed}
            </p>
          )}
          {b.notes.length > 0 && (
            <ul className="space-y-1 border-t border-line px-4 py-3 text-[12px] text-muted">
              {b.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <TrackTable title="Track record: picks" buckets={data.track.picks} empty="Picks are scored 1 hour after they are made, at the close, the next day and at expiry." />
        <TrackTable
          title="Track record: signals 70+"
          buckets={data.track.signals}
          empty="Every signal at conviction 70 or higher is recorded and scored the same way, so you can see which levels pay."
        />
      </div>

      {data.track.recent.length > 0 && (
        <Panel className="min-w-0">
          <PanelHeader title="Past picks" />
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[900px] whitespace-nowrap text-right text-[12.5px]">
              <thead>
                <tr className="cap [&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:font-medium">
                  <th className="text-left">Day</th>
                  <th className="text-left">Pick</th>
                  <th>Score</th>
                  <th>Entry</th>
                  {CP.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>Best</th>
                </tr>
              </thead>
              <tbody>
                {data.track.recent.map((r) => (
                  <tr key={r.id} className="border-b border-line/70 last:border-0 [&>td]:h-9 [&>td]:px-4">
                    <td className="text-left text-muted">{shortDate(r.day)}</td>
                    <td className="text-left font-sans">
                      <span className="font-semibold">{r.symbol}</span>{" "}
                      <span className={r.type === "call" ? "text-up" : "text-down"}>{contractLabel(r)}</span>
                    </td>
                    <td className="text-muted">{r.score ?? "—"}</td>
                    <td>{usd(r.entry)}</td>
                    {CP.map((c) => {
                      const m = r.marks[c.key];
                      return (
                        <td key={c.key} className={m ? tone(m.ret) : "text-faint"}>
                          {m ? signedPct(m.ret, 0) : "pending"}
                        </td>
                      );
                    })}
                    <td className={r.peak ? tone(r.peak.ret) : "text-faint"}>{r.peak ? signedPct(r.peak.ret, 0) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function TrackTable({ title, buckets, empty }: { title: string; buckets: TrackBucket[]; empty: string }) {
  return (
    <Panel className="min-w-0">
      <PanelHeader title={title} />
      {!buckets.length ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] whitespace-nowrap text-right text-[12px]">
            <thead>
              <tr className="cap [&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:font-medium">
                <th className="text-left">Group</th>
                <th>N</th>
                {CP.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th title="Share that reached +100% at some point">Hit +100%</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.label} className="border-b border-line/70 last:border-0 [&>td]:h-9 [&>td]:px-3">
                  <td className="text-left font-sans text-muted">{b.label}</td>
                  <td className="text-faint">{b.n}</td>
                  {CP.map((c) => {
                    const x = b.at[c.key];
                    return (
                      <td key={c.key} title={x ? `${x.n} scored, ${pct(x.win, 0)} in profit` : undefined}>
                        {x ? (
                          <>
                            <span className={tone(x.avg)}>{signedPct(x.avg, 0)}</span>{" "}
                            <span className="text-faint">{pct(x.win, 0)}</span>
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td>{pct(b.hit100, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-faint">
            Each cell: average return, then share in profit. Returns are on the contract&apos;s price from the ask when recorded.
          </p>
        </div>
      )}
    </Panel>
  );
}
