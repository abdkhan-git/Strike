"use client";

import clsx from "clsx";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NewsPanel } from "@/components/NewsPanel";
import { Button, CatalystTag, Change, Chip, Panel, PanelHeader, Segmented } from "@/components/ui";
import { breakeven, bsPrice, popLong } from "@/lib/bs";
import { compact, pct, shortDate, signedPct, signedUsd, strikeLabel, usd } from "@/lib/format";
import type { Enriched, OptType, ScanResult, SymbolView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";

export default function CalculatorPage() {
  return (
    <Suspense>
      <Entry />
    </Suspense>
  );
}

function Entry() {
  const sp = useSearchParams();
  const sym = (sp.get("sym") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(sym)) return <Picker />;
  const k = Number(sp.get("k"));
  return (
    <Ticket
      key={`${sym}|${sp.get("type")}|${sp.get("k")}|${sp.get("exp")}`}
      symbol={sym}
      init={{ type: sp.get("type") === "put" ? "put" : "call", strike: k > 0 ? k : undefined, exp: sp.get("exp") ?? undefined }}
    />
  );
}

function TickerBox({ initial = "", autoFocus }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const s = v.trim().toUpperCase();
        if (s) router.push(`/calculator?sym=${encodeURIComponent(s)}`);
      }}
    >
      <input
        autoFocus={autoFocus}
        value={v}
        onChange={(e) => setV(e.target.value.toUpperCase())}
        placeholder="Ticker"
        aria-label="Ticker"
        className="h-9 w-28 border border-line-strong bg-transparent px-3 text-[15px] font-semibold tracking-tight placeholder:font-normal placeholder:text-faint focus:border-muted focus:outline-none"
      />
    </form>
  );
}

function Picker() {
  const { data } = usePoll<ScanResult>("/api/scan", 15_000);
  return (
    <div className="mx-auto max-w-[900px] space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">Profit calculator</h1>
        <p className="mt-0.5 text-muted">
          Pick a stock, tap a contract in its chain, and see what the position is worth at any price and date. Prices fill in live.
        </p>
      </div>
      <TickerBox autoFocus />
      {data && (
        <div>
          <div className="cap mb-2">Most active flow right now</div>
          <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            {data.rows.slice(0, 12).map((r) => (
              <Link
                key={r.quote.symbol}
                href={`/calculator?sym=${r.quote.symbol}`}
                className="bg-panel px-4 py-3 transition-colors hover:bg-raised"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{r.quote.symbol}</span>
                  <Change value={r.quote.changePct} className="text-[12px]" />
                </div>
                <div className="num mt-0.5 text-muted">{usd(r.quote.price)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const th = "sticky top-0 z-10 h-8 bg-panel px-3 font-medium shadow-[inset_0_-1px_0_var(--color-line)]";

function Ticket({ symbol, init }: { symbol: string; init: { type: OptType; strike?: number; exp?: string } }) {
  const [exp, setExp] = useState(init.exp);
  const [side, setSide] = useState<OptType>(init.type);
  const [pick, setPick] = useState(init.strike);
  const [qty, setQty] = useState(1);
  /** null follows the live ask */
  const [limit, setLimit] = useState<string | null>(null);
  /** null follows the implied move */
  const [target, setTarget] = useState<number | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [logged, setLogged] = useState<"idle" | "saving" | "done" | string>("idle");

  const { data, error } = usePoll<SymbolView>(
    `/api/symbol?symbol=${encodeURIComponent(symbol)}${exp ? `&exp=${exp}` : ""}`,
    5000,
  );

  const S = data?.summary.quote.price ?? 0;

  const { rows, sel } = useMemo(() => {
    const cs = (data?.contracts ?? []).filter((c) => c.type === side);
    const strikes = cs.map((c) => c.strike).sort((a, b) => a - b);
    const atm = strikes.reduce((b, k) => (Math.abs(k - S) < Math.abs(b - S) ? k : b), strikes[0] ?? 0);
    const i = strikes.indexOf(atm);
    const near = new Set(strikes.slice(Math.max(0, i - 12), i + 13));
    const rows = cs.filter((c) => near.has(c.strike)).sort((a, b) => b.strike - a.strike);
    // default: the first strike out of the money
    const otm = side === "call" ? [...rows].reverse().find((c) => c.strike >= S) : rows.find((c) => c.strike <= S);
    return { rows, sel: rows.find((c) => c.strike === pick) ?? otm ?? rows.find((c) => c.strike === atm) };
  }, [data, side, S, pick]);

  // keep the first default selection fixed while the stock price ticks
  useEffect(() => {
    if (pick === undefined && sel) setPick(sel.strike);
  }, [pick, sel]);

  // bring the selected strike into view when a chain first loads
  const scroller = useRef<HTMLDivElement>(null);
  const loadedKey = data ? `${data.summary.exp}|${side}` : "";
  useEffect(() => {
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>("[data-selected=true]");
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  if (!data)
    return (
      <div className="mx-auto max-w-[1760px] space-y-4 p-4 md:p-6">
        <TickerBox initial={symbol} />
        <div className="text-muted">{error ? <span className="text-down">{error}</span> : `Loading ${symbol}…`}</div>
      </div>
    );

  const s = data.summary;
  const q = s.quote;
  const choose = (c: Enriched) => {
    setPick(c.strike);
    setLimit(null);
    setLogged("idle");
  };

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <TickerBox initial={symbol} />
        <div className="flex items-baseline gap-3">
          <span className="num text-[22px] font-medium">{usd(q.price)}</span>
          <Change value={q.changePct} className="text-[13px]" />
        </div>
        <span className="text-muted">{q.name}</span>
        <CatalystTag c={s.catalyst} />
        <Link href={`/s/${symbol}`} className="ml-auto text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline">
          Flow detail for {symbol}
        </Link>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel className="min-w-0">
            <div className="flex items-center gap-3 border-b border-line px-3 py-2">
              <Segmented
                value={side}
                onChange={(v) => {
                  setSide(v);
                  setLimit(null);
                  setTarget(null);
                  setLogged("idle");
                }}
                options={[
                  { value: "call", label: "Buy call" },
                  { value: "put", label: "Buy put" },
                ]}
              />
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {data.expirations.slice(0, 16).map((e) => (
                  <Chip
                    key={e}
                    active={e === s.exp}
                    onClick={() => {
                      setExp(e);
                      setLimit(null);
                      setDays(null);
                      setLogged("idle");
                    }}
                    className="!h-6"
                  >
                    {shortDate(e)}
                  </Chip>
                ))}
              </div>
            </div>
            <div ref={scroller} className="relative max-h-[404px] overflow-auto">
              <table className="num w-full min-w-[720px] whitespace-nowrap text-right text-[12.5px]">
                <thead>
                  <tr className="cap">
                    <th className={clsx(th, "text-left")}>Strike</th>
                    <th className={th}>Break-even</th>
                    <th className={th}>To break-even</th>
                    <th className={th} title="Market-implied probability of profit at expiry">
                      Implied odds
                    </th>
                    <th className={th}>Volume</th>
                    <th className={th}>Open int.</th>
                    <th className={th}>IV</th>
                    <th className={th}>Bid</th>
                    <th className={th}>Ask</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => {
                    const on = c.occ === sel?.occ;
                    const marker = i > 0 && rows[i - 1].strike >= S && c.strike < S;
                    return (
                      <FragmentRow key={c.occ} marker={marker} spot={S}>
                        <tr
                          data-selected={on}
                          onClick={() => choose(c)}
                          className={clsx(
                            "cursor-pointer border-b border-line/70 transition-colors [&>td]:h-9 [&>td]:px-3",
                            on ? "bg-raised" : "hover:bg-raised/60",
                          )}
                        >
                          <td className={clsx("border-l-2 text-left font-medium", on ? "border-l-fg" : "border-l-transparent")}>
                            ${strikeLabel(c.strike)}
                          </td>
                          <td className="text-muted">{usd(c.breakeven)}</td>
                          <td className="text-muted">{signedPct(c.breakeven / S - 1, 1)}</td>
                          <td>{pct(c.pop, 0)}</td>
                          <td className={c.volOi >= 1 ? "text-warn" : undefined}>{compact(c.volume)}</td>
                          <td className="text-muted">{compact(c.openInterest)}</td>
                          <td className="text-muted">{pct(c.iv, 0)}</td>
                          <td className="text-muted">{c.bid.toFixed(2)}</td>
                          <td>
                            <span
                              className={clsx(
                                "inline-block min-w-[58px] border px-2 py-0.5 text-center font-medium",
                                on
                                  ? "border-fg bg-fg text-bg"
                                  : side === "call"
                                    ? "border-up/40 text-up"
                                    : "border-down/40 text-down",
                              )}
                            >
                              {c.ask.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {sel && (
            <Analysis
              c={sel}
              spot={S}
              symbol={symbol}
              qty={qty}
              limit={limit}
              target={target}
              days={days}
              expectedMove={s.expectedMovePct}
            />
          )}
          <NewsPanel symbol={symbol} />
        </div>

        {sel ? (
          <OrderTicket
            c={sel}
            spot={S}
            expectedMove={s.expectedMovePct}
            qty={qty}
            setQty={setQty}
            limit={limit}
            setLimit={setLimit}
            target={target}
            setTarget={setTarget}
            days={days}
            setDays={setDays}
            logged={logged}
            setLogged={setLogged}
          />
        ) : (
          <Panel className="p-6 text-muted">No contracts listed for this expiration.</Panel>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ marker, spot, children }: { marker: boolean; spot: number; children: React.ReactNode }) {
  return (
    <>
      {marker && (
        <tr>
          <td colSpan={9} className="h-6 border-b border-line/70 bg-bg px-3 text-center text-[11px] text-muted">
            Share price <span className="text-fg">{usd(spot)}</span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

/** Everything the ticket and the charts derive from one contract and the scenario inputs. */
function scenario(c: Enriched, S: number, qty: number, limit: string | null, target: number | null, days: number | null, expectedMove: number) {
  const P = limit !== null ? Number(limit) || 0 : c.ask || c.mid;
  const dteDays = Math.max(1, Math.ceil(c.dte));
  const dir = c.type === "call" ? 1 : -1;
  const tgt = target ?? +(S * (1 + dir * Math.max(expectedMove, 0.03))).toFixed(2);
  const held = Math.min(Math.max(days ?? Math.round(dteDays / 2), 0), dteDays);
  const range = Math.max(0.12, Math.min(0.6, c.iv * Math.sqrt(Math.max(c.dte, 1) / 365) * 2.5));
  // at the last day the option is worth exactly its intrinsic value
  const valueAt = (price: number, d: number) => bsPrice(c.type, price, c.strike, d >= dteDays ? 0 : Math.max(c.dte - d, 0) / 365, c.iv);
  const plAt = (price: number, d: number) => (valueAt(price, d) - P) * 100 * qty;
  return { P, dteDays, tgt, held, range, valueAt, plAt, cost: P * 100 * qty };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num">{children}</span>
    </div>
  );
}

function OrderTicket({
  c,
  spot: S,
  expectedMove,
  qty,
  setQty,
  limit,
  setLimit,
  target,
  setTarget,
  days,
  setDays,
  logged,
  setLogged,
}: {
  c: Enriched;
  spot: number;
  expectedMove: number;
  qty: number;
  setQty: (n: number) => void;
  limit: string | null;
  setLimit: (v: string | null) => void;
  target: number | null;
  setTarget: (n: number | null) => void;
  days: number | null;
  setDays: (n: number | null) => void;
  logged: string;
  setLogged: (v: string) => void;
}) {
  const { P, dteDays, tgt, held, range, valueAt, plAt, cost } = scenario(c, S, qty, limit, target, days, expectedMove);
  const pl = plAt(tgt, held);
  const be = breakeven(c.type, c.strike, P);
  const pop = c.iv > 0 && P > 0 ? popLong(c.type, S, c.strike, P, c.dte / 365, c.iv) : 0;
  const when = held >= dteDays ? "at expiry" : held === 0 ? "today" : `in ${held} day${held === 1 ? "" : "s"}`;
  const date = new Date(Date.now() + held * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  async function log() {
    setLogged("saving");
    const res = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...c, qty, entryPrice: P }),
    });
    setLogged(res.ok ? "done" : ((await res.json()).error ?? "Could not save the trade"));
  }

  const quick = [
    { label: "Bid", v: c.bid },
    { label: "Mid", v: c.mid },
    { label: "Ask", v: c.ask },
  ];

  return (
    <Panel className="self-start lg:sticky lg:top-6">
      <div className="border-b border-line px-4 py-3">
        <div className="cap">Buy to open</div>
        <div className="mt-1 text-[15px] font-semibold tracking-tight">
          {c.underlying} ${strikeLabel(c.strike)} <span className={c.type === "call" ? "text-up" : "text-down"}>{c.type === "call" ? "Call" : "Put"}</span>
        </div>
        <div className="text-[12px] text-muted">
          Expires {shortDate(c.expiration)} · {dteDays}d · IV <span className="num">{pct(c.iv, 0)}</span> · Δ <span className="num">{c.delta.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
        {quick.map((x) => (
          <button
            key={x.label}
            onClick={() => setLimit(x.label === "Ask" ? null : x.v.toFixed(2))}
            title={`Use the ${x.label.toLowerCase()} as your price`}
            className="bg-panel py-2 text-center transition-colors hover:bg-raised"
          >
            <div className="cap">{x.label}</div>
            <div className="num mt-0.5 text-[13px]">{x.v.toFixed(2)}</div>
          </button>
        ))}
      </div>

      <div className="px-4 py-2">
        <Row label="Contracts">
          <span className="flex items-center border border-line-strong">
            <button aria-label="Fewer contracts" onClick={() => setQty(Math.max(1, qty - 1))} className="grid size-7 place-items-center text-muted hover:bg-raised hover:text-fg">
              <Minus size={13} />
            </button>
            <input
              type="number"
              min={1}
              aria-label="Contracts"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
              className="h-7 w-12 border-x border-line-strong bg-transparent text-center focus:outline-none"
            />
            <button aria-label="More contracts" onClick={() => setQty(qty + 1)} className="grid size-7 place-items-center text-muted hover:bg-raised hover:text-fg">
              <Plus size={13} />
            </button>
          </span>
        </Row>
        <Row label="Price per contract">
          <span className="flex items-center gap-2">
            {limit === null ? (
              <span className="cap flex items-center gap-1.5 !text-up">
                <span className="pulse-dot size-1.5 bg-up" />
                Live ask
              </span>
            ) : (
              <button onClick={() => setLimit(null)} className="cap underline-offset-2 hover:!text-fg hover:underline">
                Follow ask
              </button>
            )}
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="Price per contract"
              value={limit ?? (c.ask || c.mid).toFixed(2)}
              onChange={(e) => setLimit(e.target.value)}
              className="h-7 w-20 border border-line-strong bg-transparent px-2 text-right focus:border-muted focus:outline-none"
            />
          </span>
        </Row>
        <Row label="Estimated cost">
          <span className="text-[14px] font-medium">{usd(cost)}</span>
        </Row>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">If {c.underlying} reaches</span>
          <span className="num">
            {usd(tgt)} <span className={tgt >= S ? "text-up" : "text-down"}>{signedPct(tgt / S - 1, 1)}</span>
          </span>
        </div>
        <input
          type="range"
          aria-label="Target stock price"
          min={+(S * (1 - range)).toFixed(2)}
          max={+(S * (1 + range)).toFixed(2)}
          step={Math.max(0.01, +(S * 0.0025).toFixed(2))}
          value={tgt}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="mt-1"
        />
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-muted">By</span>
          <span className="num">
            {date} <span className="text-muted">{when}</span>
          </span>
        </div>
        <input
          type="range"
          aria-label="Days held"
          min={0}
          max={dteDays}
          value={held}
          onChange={(e) => setDays(Number(e.target.value))}
          className="mt-1"
        />
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="cap">Estimated profit</div>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span className={clsx("num text-[28px] font-medium leading-none", pl >= 0 ? "text-up" : "text-down")}>{signedUsd(pl)}</span>
          <span className={clsx("num text-[14px]", pl >= 0 ? "text-up" : "text-down")}>{signedPct(cost > 0 ? pl / cost : 0, 0)}</span>
        </div>
        <div className="num mt-1 text-[12px] text-muted">
          worth {usd(valueAt(tgt, held) * 100 * qty)} on {usd(cost)} paid
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-line bg-line">
        {[
          ["Break-even at expiry", `${usd(be)}`, `${signedPct(be / S - 1, 1)} from here`],
          ["Implied odds of profit", pct(pop, 0), "at expiry, from implied vol"],
          ["Max loss", usd(cost), "the premium paid"],
          ["Time decay", `${signedUsd(c.theta * 100 * qty)}`, "per day right now"],
        ].map(([label, value, sub]) => (
          <div key={label} className="bg-panel px-4 py-2.5">
            <div className="cap">{label}</div>
            <div className="num mt-1 text-[14px]">{value}</div>
            <div className="text-[11.5px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      <div className="p-4">
        {logged === "done" ? (
          <div className="flex items-center justify-between border border-up/40 px-3 py-2 text-[12.5px]">
            <span>
              Logged {qty} × {usd(P)}
            </span>
            <Link href="/positions" className="font-medium text-up underline-offset-2 hover:underline">
              View positions
            </Link>
          </div>
        ) : (
          <>
            <Button variant="primary" className="!h-9 w-full !text-[13px]" disabled={logged === "saving" || !(P > 0)} onClick={log}>
              Log this purchase
            </Button>
            <p className={clsx("mt-2 text-[11.5px] leading-snug", logged === "idle" || logged === "saving" ? "text-faint" : "text-down")}>
              {logged === "idle" || logged === "saving"
                ? "Records the trade in Positions at this price. It does not place an order with a broker."
                : logged}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function Analysis({
  c,
  spot: S,
  symbol,
  qty,
  limit,
  target,
  days,
  expectedMove,
}: {
  c: Enriched;
  spot: number;
  symbol: string;
  qty: number;
  limit: string | null;
  target: number | null;
  days: number | null;
  expectedMove: number;
}) {
  const { P, dteDays, tgt, held, range, plAt } = scenario(c, S, qty, limit, target, days, expectedMove);
  const be = breakeven(c.type, c.strike, P);

  const curve = Array.from({ length: 61 }, (_, i) => {
    const price = S * (1 - range + (2 * range * i) / 60);
    return { price, expiry: plAt(price, dteDays), scenario: plAt(price, held) };
  });

  const cols = [...new Set([0, Math.round(dteDays / 3), Math.round((2 * dteDays) / 3), dteDays])];
  const moves = [0.2, 0.1, 0.05, 0, -0.05, -0.1, -0.2];
  const tick = { fill: "var(--color-muted)", fontSize: 11, fontFamily: "var(--font-mono)" };

  return (
    <>
      <Panel>
        <PanelHeader
          title="Profit and loss by stock price"
          right={
            <div className="flex items-center gap-4 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-px w-3 bg-accent" /> {held >= dteDays ? "Selected date" : `In ${held}d`}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-px w-3 bg-fg" /> At expiry
              </span>
            </div>
          }
        />
        <div className="h-64 px-2 pb-2 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => usd(v, 0)} tick={tick} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
              <YAxis width={64} tickFormatter={(v) => usd(v, 0)} tick={tick} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", borderRadius: 0, fontSize: 12 }}
                labelStyle={{ color: "var(--color-muted)" }}
                labelFormatter={(l) => `${symbol} at ${usd(Number(l))}`}
                formatter={(v, name) => [signedUsd(Number(v)), name === "scenario" ? `In ${held}d` : "At expiry"]}
              />
              <ReferenceLine y={0} stroke="var(--color-line-strong)" />
              <ReferenceLine x={S} stroke="var(--color-faint)" strokeDasharray="3 3" label={{ value: "now", position: "top", fill: "var(--color-muted)", fontSize: 11 }} />
              <ReferenceLine x={be} stroke="var(--color-faint)" strokeDasharray="1 4" label={{ value: "break-even", position: "insideBottomRight", fill: "var(--color-faint)", fontSize: 11 }} />
              <ReferenceLine x={tgt} stroke="var(--color-accent)" strokeOpacity={0.6} label={{ value: "target", position: "top", fill: "var(--color-accent)", fontSize: 11 }} />
              <Line dataKey="scenario" stroke="var(--color-accent)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="expiry" stroke="var(--color-fg)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader title="Outcome grid" />
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[520px] whitespace-nowrap text-right text-[12.5px]">
            <thead>
              <tr className="cap [&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-4 [&>th]:font-medium">
                <th className="text-left">Stock move</th>
                {cols.map((d) => (
                  <th key={d}>{d === 0 ? "Today" : d === dteDays ? "At expiry" : `In ${d}d`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m} className="border-b border-line/70 last:border-0 [&>td]:h-8 [&>td]:px-4">
                  <td className="text-left">
                    {signedPct(m, 0)} <span className="text-muted">{usd(S * (1 + m))}</span>
                  </td>
                  {cols.map((d) => {
                    const v = plAt(S * (1 + m), d);
                    return (
                      <td key={d} className={v >= 0 ? "text-up" : "text-down"}>
                        {signedUsd(v, 0)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
          Black-Scholes values with implied vol held at {pct(c.iv, 0)}. After earnings, implied vol usually drops sharply, which
          lowers every value before expiry.
        </p>
      </Panel>
    </>
  );
}
