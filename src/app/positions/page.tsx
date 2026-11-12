"use client";

import clsx from "clsx";
import { Link2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tick } from "@/components/Tick";
import { Button, Panel, PanelHeader, Stat, StatStrip, Tabs, ticketHref } from "@/components/ui";
import { contractLabel, pct, shortDate, signedPct, signedUsd, usd } from "@/lib/format";
import type { BrokerView, TradeView, Verdict } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA");
const tick = { fill: "var(--color-muted)", fontSize: 11, fontFamily: "var(--font-mono)" };
const tip = { background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", borderRadius: 0, fontSize: 12 };

const ACTION_STYLE: Record<Verdict["tone"], string> = {
  up: "border-up text-up",
  down: "border-down text-down",
  warn: "border-warn text-warn",
  neutral: "border-line-strong text-fg",
};

export default function PositionsPage() {
  const { data, error, reload } = usePoll<TradeView[]>("/api/trades", 5000);
  const [closing, setClosing] = useState<{ id: string; price: string } | null>(null);
  const [view, setView] = useState<"open" | "history">("open");

  const stats = useMemo(() => {
    const all = data ?? [];
    const open = all.filter((t) => t.status === "open");
    const closed = all.filter((t) => t.status === "closed").sort((a, b) => (a.exitAt ?? 0) - (b.exitAt ?? 0));
    const wins = closed.filter((t) => t.pnl > 0);
    const losses = closed.filter((t) => t.pnl <= 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const byDay = new Map<string, number>();
    for (const t of closed) byDay.set(day(t.exitAt ?? 0), (byDay.get(day(t.exitAt ?? 0)) ?? 0) + t.pnl);
    let run = 0;
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, pnl]) => ({ d, pnl, cum: (run += pnl) }));
    return {
      open,
      closed,
      openPnl: open.reduce((s, t) => s + t.pnl, 0),
      openCost: open.reduce((s, t) => s + t.entryPrice * 100 * t.qty, 0),
      openValue: open.reduce((s, t) => s + (t.mark ?? t.entryPrice) * 100 * t.qty, 0),
      realized: closed.reduce((s, t) => s + t.pnl, 0),
      wins: wins.length,
      winRate: closed.length ? wins.length / closed.length : 0,
      avgWin,
      avgLoss,
      expectancy: closed.length ? closed.reduce((s, t) => s + t.pnl, 0) / closed.length : 0,
      days,
      decay: open.reduce((s, t) => s + (t.verdict?.decayPerDay ?? 0), 0),
    };
  }, [data]);

  if (!data)
    return <div className="p-6 text-muted">{error ? <span className="text-down">{error}</span> : "Loading positions…"}</div>;

  async function close() {
    if (!closing) return;
    await fetch("/api/trades", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: closing.id, exitPrice: Number(closing.price) }),
    });
    setClosing(null);
    reload();
  }

  async function remove(id: string) {
    if (!confirm("Delete this trade from the log? This cannot be undone.")) return;
    await fetch(`/api/trades?id=${id}`, { method: "DELETE" });
    reload();
  }

  const s = stats;

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Positions</h1>
          <p className="mt-0.5 text-muted">
            Every logged contract, marked at the live mid price, with a verdict that updates every few seconds.
          </p>
        </div>
      </div>

      <StatStrip>
        <Stat label="Open value" value={usd(s.openValue)} sub={`${s.open.length} position${s.open.length === 1 ? "" : "s"} · ${usd(s.openCost)} at cost`} />
        <Stat
          label="Open P/L"
          value={signedUsd(s.openPnl)}
          sub={s.openCost > 0 ? `${signedPct(s.openPnl / s.openCost, 1)} · decay ${usd(s.decay)}/day` : undefined}
          tone={s.openPnl > 0 ? "up" : s.openPnl < 0 ? "down" : undefined}
        />
        <Stat
          label="Realized P/L"
          value={signedUsd(s.realized)}
          sub={`${s.closed.length} closed · ${s.closed.length ? pct(s.winRate, 0) : "—"} win rate`}
          tone={s.realized > 0 ? "up" : s.realized < 0 ? "down" : undefined}
        />
        <Stat
          label="Per closed trade"
          value={s.closed.length ? signedUsd(s.expectancy) : "—"}
          sub={s.closed.length ? `avg win ${usd(s.avgWin, 0)} · avg loss ${usd(Math.abs(s.avgLoss), 0)}` : "no closed trades yet"}
          tone={s.expectancy > 0 ? "up" : s.expectancy < 0 ? "down" : undefined}
        />
      </StatStrip>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel className="min-w-0">
          <div className="flex h-10 items-stretch justify-between border-b border-line px-4">
            <Tabs
              value={view}
              onChange={setView}
              options={[
                { value: "open", label: "Open", count: s.open.length },
                { value: "history", label: "History", count: s.closed.length },
              ]}
            />
          </div>

          {view === "open" ? (
            s.open.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted">
                No open positions. Import them from your brokerage on the right, or use{" "}
                <span className="text-fg">Log this purchase</span> in the{" "}
                <Link href="/calculator" className="text-fg underline underline-offset-2">
                  calculator
                </Link>
                .
              </div>
            ) : (
              <ul>
                {s.open.map((t) => (
                  <PositionRow
                    key={t.id}
                    t={t}
                    closing={closing?.id === t.id ? closing.price : null}
                    onCloseStart={() => setClosing({ id: t.id, price: (t.mark ?? t.entryPrice).toFixed(2) })}
                    onCloseChange={(price) => setClosing({ id: t.id, price })}
                    onCloseCancel={() => setClosing(null)}
                    onCloseConfirm={close}
                    onDelete={() => remove(t.id)}
                  />
                ))}
              </ul>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[640px] whitespace-nowrap text-right text-[12.5px]">
                <thead>
                  <tr className="cap [&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:font-medium">
                    <th className="text-left">Contract</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P/L</th>
                    <th className="text-left">Closed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...s.closed].reverse().map((t) => (
                    <tr key={t.id} className="border-b border-line/70 last:border-0 [&>td]:h-10 [&>td]:px-4">
                      <td className="text-left font-sans font-semibold">
                        {t.underlying} <span className="font-normal text-muted">{contractLabel(t)}</span>
                      </td>
                      <td>{t.qty}</td>
                      <td>{t.entryPrice.toFixed(2)}</td>
                      <td>{(t.exitPrice ?? 0).toFixed(2)}</td>
                      <td className={clsx("font-medium", tone(t.pnl))}>
                        {signedUsd(t.pnl)} <span className="font-normal">({signedPct(t.pnlPct, 0)})</span>
                      </td>
                      <td className="text-left text-muted">{t.exitAt ? shortDate(day(t.exitAt)) : "—"}</td>
                      <td>
                        <Button variant="ghost" onClick={() => remove(t.id)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!s.closed.length && (
                    <tr>
                      <td colSpan={7} className="h-24 text-center font-sans text-muted">
                        Closed and expired trades appear here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <BrokerPanel onImported={reload} />
          <Panel>
            <PanelHeader title="Realized P/L by day" />
            <div className="h-44 px-2 pb-2 pt-3">
              {s.days.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={s.days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="d" tickFormatter={(d) => shortDate(d)} tick={tick} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
                    <YAxis width={56} tickFormatter={(v) => usd(v, 0)} tick={tick} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tip} labelFormatter={(d) => shortDate(String(d))} formatter={(v) => [signedUsd(Number(v)), "Realized"]} cursor={{ fill: "rgb(255 255 255 / 0.04)" }} />
                    <ReferenceLine y={0} stroke="var(--color-line-strong)" />
                    <Bar dataKey="pnl" isAnimationActive={false}>
                      {s.days.map((d) => (
                        <Cell key={d.d} fill={d.pnl >= 0 ? "var(--color-up)" : "var(--color-down)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid h-full place-items-center text-[12px] text-muted">Daily results appear once trades close.</div>
              )}
            </div>
          </Panel>
          {s.days.length > 1 && (
            <Panel>
              <PanelHeader title="Cumulative realized P/L" />
              <div className="h-40 px-2 pb-2 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={s.days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="d" tickFormatter={(d) => shortDate(d)} tick={tick} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
                    <YAxis width={56} tickFormatter={(v) => usd(v, 0)} tick={tick} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tip} labelFormatter={(d) => shortDate(String(d))} formatter={(v) => [signedUsd(Number(v)), "Cumulative"]} />
                    <ReferenceLine y={0} stroke="var(--color-line-strong)" />
                    <Area dataKey="cum" stroke="var(--color-fg)" strokeWidth={1.5} fill="var(--color-fg)" fillOpacity={0.06} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PositionRow({
  t,
  closing,
  onCloseStart,
  onCloseChange,
  onCloseCancel,
  onCloseConfirm,
  onDelete,
}: {
  t: TradeView;
  closing: string | null;
  onCloseStart: () => void;
  onCloseChange: (price: string) => void;
  onCloseCancel: () => void;
  onCloseConfirm: () => void;
  onDelete: () => void;
}) {
  const v = t.verdict;
  // progress of the premium from the stop (-50%) to the target (+100%)
  const span = v ? v.target - v.stop : 0;
  const at = v && t.mark != null && span > 0 ? Math.min(1, Math.max(0, (t.mark - v.stop) / span)) : undefined;
  const entryAt = v && span > 0 ? (t.entryPrice - v.stop) / span : 0;

  return (
    <li className="grid gap-4 border-b border-line/70 px-4 py-4 last:border-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/s/${t.underlying}`} className="text-[15px] font-semibold hover:underline">
            {t.underlying} <span className={t.type === "call" ? "text-up" : "text-down"}>{contractLabel(t)}</span>
          </Link>
          <span className="num text-[12px] text-muted">×{t.qty}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <Tick value={t.pnl} className={clsx("num text-[22px] font-medium leading-none", tone(t.pnl))}>
            {t.mark != null ? signedUsd(t.pnl) : "—"}
          </Tick>
          {t.mark != null && <span className={clsx("num text-[13px]", tone(t.pnl))}>{signedPct(t.pnlPct, 0)}</span>}
        </div>
        <div className="num mt-1 text-[12px] text-muted">
          {t.entryPrice.toFixed(2)} → {t.mark != null ? t.mark.toFixed(2) : "no quote"}
        </div>
        {at !== undefined && v && (
          <div className="mt-3">
            <div className="relative h-1.5 bg-line-strong">
              <span className="absolute inset-y-0 left-0 bg-down/40" style={{ width: `${entryAt * 100}%` }} />
              <span className="absolute inset-y-0 bg-up/40" style={{ left: `${entryAt * 100}%`, right: 0 }} />
              <span className="absolute top-[-4px] h-[14px] w-[3px] bg-fg" style={{ left: `calc(${at * 100}% - 1px)` }} />
            </div>
            <div className="num mt-1 flex justify-between text-[10.5px] text-faint">
              <span>stop {v.stop.toFixed(2)}</span>
              <span>target {v.target.toFixed(2)}</span>
            </div>
          </div>
        )}
        {t.note && <div className="mt-2 truncate text-[11.5px] text-faint">{t.note}</div>}
      </div>

      <div className="min-w-0">
        {v ? (
          <div className={clsx("border-l-2 pl-4", ACTION_STYLE[v.tone].split(" ")[0])}>
            <div className="flex flex-wrap items-center gap-3">
              <span className={clsx("cap border px-1.5 py-0.5 !text-[11px]", ACTION_STYLE[v.tone])}>{v.action}</span>
              <span className="num text-[11.5px] text-muted">
                {Math.max(0, Math.round(v.dte))}d left · {pct(v.odds, 0)} implied odds · decay {usd(v.decayPerDay)}/day
              </span>
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed">{v.headline}</p>
            <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-[12px] leading-snug text-muted md:grid-cols-2">
              {v.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="mt-[7px] size-[3px] shrink-0 bg-faint" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted">No live quote for this contract, so no verdict right now.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {closing !== null ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onCloseConfirm();
              }}
            >
              <span className="text-[12px] text-muted">Sold at</span>
              <input
                autoFocus
                type="number"
                step="0.01"
                min="0"
                aria-label="Exit price"
                value={closing}
                onChange={(e) => onCloseChange(e.target.value)}
                className="num h-7 w-20 border border-line-strong bg-transparent px-2 text-right text-[12px] focus:border-muted focus:outline-none"
              />
              <Button type="submit" variant="primary">
                Record sale
              </Button>
              <Button type="button" variant="ghost" onClick={onCloseCancel}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <Button onClick={onCloseStart}>Record sale</Button>
              <Link href={ticketHref(t)}>
                <Button variant="ghost">Scenarios</Button>
              </Link>
              <Button variant="ghost" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function BrokerPanel({ onImported }: { onImported: () => void }) {
  const { data, reload } = usePoll<BrokerView>("/api/broker", 60_000);
  const [busy, setBusy] = useState<"" | "import" | "connect">("");
  const [msg, setMsg] = useState("");

  async function act(action: "import" | "connect") {
    setBusy(action);
    setMsg("");
    const res = await fetch(`/api/broker?action=${action}`, { method: "POST" });
    const json = await res.json();
    setBusy("");
    if (!res.ok) return setMsg(json.error ?? "Request failed");
    if (action === "connect") window.open(json.url, "_blank", "noopener");
    else {
      setMsg(json.added ? `Added ${json.added} position${json.added === 1 ? "" : "s"} to the log.` : "Everything is already in the log.");
      onImported();
      reload();
    }
  }

  const total = data?.accounts.reduce((s, a) => s + (a.total ?? 0), 0) ?? 0;
  const cash = data?.accounts.reduce((s, a) => s + (a.cash ?? 0), 0) ?? 0;

  return (
    <Panel>
      <PanelHeader
        title="Brokerage"
        right={
          data?.configured && (
            <button onClick={() => act("connect")} className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-fg" disabled={!!busy}>
              <Link2 size={12} /> Connect another
            </button>
          )
        }
      />
      {!data ? (
        <div className="px-4 py-6 text-muted">Checking the brokerage link…</div>
      ) : !data.configured ? (
        <div className="px-4 py-4 text-[12.5px] text-muted">Add your SnapTrade keys to .env.local to read balances and positions.</div>
      ) : !data.linked ? (
        <div className="space-y-3 px-4 py-4">
          <p className="text-[12.5px] text-muted">{data.error ?? "No brokerage connected yet. The link is read-only: Strike cannot place orders."}</p>
          <Button variant="primary" onClick={() => act("connect")} disabled={!!busy}>
            Connect a brokerage
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
            <div className="bg-panel px-4 py-3">
              <div className="cap">Account value</div>
              <div className="num mt-1 text-[17px] font-medium">{usd(total)}</div>
            </div>
            <div className="bg-panel px-4 py-3">
              <div className="cap">Cash</div>
              <div className="num mt-1 text-[17px] font-medium">{usd(cash)}</div>
            </div>
          </div>
          <ul className="border-b border-line">
            {data.accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-b border-line/70 px-4 py-2 text-[12.5px] last:border-0">
                <span className="truncate text-muted">{a.name}</span>
                <span className="num">{a.total != null ? usd(a.total) : "—"}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-muted">
                {data.options.length} option position{data.options.length === 1 ? "" : "s"} at the broker
              </span>
              <Button onClick={() => act("import")} disabled={!!busy || !data.options.length}>
                <RefreshCw size={12} className={busy === "import" ? "animate-spin" : undefined} /> Import to log
              </Button>
            </div>
            {msg && <p className="text-[12px] text-muted">{msg}</p>}
            {data.error && <p className="text-[12px] text-down">{data.error}</p>}
            <p className="text-[11px] text-faint">Read-only through SnapTrade, refreshed every minute. Strike never places orders.</p>
          </div>
        </>
      )}
    </Panel>
  );
}
