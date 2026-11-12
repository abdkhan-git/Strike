"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct, signedPct, usd } from "@/lib/format";
import type { ChartResult, Outlook } from "@/lib/types";
import { Panel, Segmented } from "./ui";

const etTime = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etDate = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Price for the latest session (with the running average price) or the last six months. */
export function PriceChart({ data, price, className }: { data?: ChartResult; price: number; className?: string }) {
  const [range, setRange] = useState<"1D" | "6M">("1D");

  const rows = useMemo(() => {
    if (!data) return [];
    if (range === "6M") return data.daily.map((b) => ({ t: b.t, c: b.c, vwap: undefined as number | undefined }));
    let pv = 0,
      vol = 0;
    return data.bars.map((b) => {
      pv += ((b.h + b.l + b.c) / 3) * b.v;
      vol += b.v;
      return { t: b.t, c: b.c, vwap: vol > 0 ? pv / vol : undefined };
    });
  }, [data, range]);

  const base = range === "1D" ? (data?.prevClose ?? 0) : (rows[0]?.c ?? 0);
  const up = price >= base;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const tick = { fill: "var(--color-muted)", fontSize: 11, fontFamily: "var(--font-mono)" };
  const fmt = range === "1D" ? etTime : etDate;

  return (
    <Panel className={clsx("min-w-0", className)}>
      <div className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex items-center gap-4">
          <h2 className="cap !text-muted">Price</h2>
          {base > 0 && (
            <span className={clsx("num text-[12px]", up ? "text-up" : "text-down")}>
              {signedPct(price / base - 1)} {range === "1D" ? "today" : "in 6 months"}
            </span>
          )}
          {range === "1D" && (
            <span className="hidden items-center gap-1.5 text-[12px] text-muted sm:flex">
              <span className="h-px w-3 border-t border-dashed border-accent" /> Average price (VWAP)
            </span>
          )}
        </div>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: "1D", label: "1D" },
            { value: "6M", label: "6M" },
          ]}
        />
      </div>
      <div className="h-[340px] px-2 pb-2 pt-3">
        {!rows.length ? (
          <div className="grid h-full place-items-center text-muted">{data ? "No price bars for this session yet." : "Loading price…"}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tick={tick} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} minTickGap={48} />
              <YAxis orientation="right" width={62} domain={["auto", "auto"]} tickFormatter={(v) => usd(v, v < 20 ? 2 : 0)} tick={tick} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", borderRadius: 0, fontSize: 12 }}
                labelStyle={{ color: "var(--color-muted)" }}
                labelFormatter={(l) => (range === "1D" ? `${etTime(Number(l))} ET` : etDate(Number(l)))}
                formatter={(v, name) => [usd(Number(v)), name === "c" ? "Price" : "Average price"]}
              />
              {range === "1D" && base > 0 && (
                <ReferenceLine y={base} stroke="var(--color-faint)" strokeDasharray="2 4" label={{ value: "prev close", position: "insideBottomLeft", fill: "var(--color-faint)", fontSize: 10.5 }} />
              )}
              <Area dataKey="c" stroke={color} strokeWidth={1.5} fill="url(#priceFill)" dot={false} isAnimationActive={false} />
              {range === "1D" && <Line dataKey="vwap" stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

function Factor({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="cap">{label}</div>
      <div className={clsx("num mt-0.5 text-[13px]", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
    </div>
  );
}

const sign = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : undefined);

/** The near-term read as one sentence, with the inputs it was built from. */
export function OutlookBand({ outlook, loading }: { outlook?: Outlook; loading: boolean }) {
  if (!outlook)
    return (
      <Panel className="px-4 py-3 text-muted">
        {loading ? "Reading the last few minutes of trading…" : "Not enough trading in this session yet for a near-term read."}
      </Panel>
    );
  const Arrow = outlook.lean === "up" ? ArrowUpRight : outlook.lean === "down" ? ArrowDownRight : ArrowRight;
  const tone = outlook.lean === "up" ? "text-up" : outlook.lean === "down" ? "text-down" : "text-muted";
  return (
    <Panel className={clsx("border-l-2", outlook.lean === "up" ? "border-l-up" : outlook.lean === "down" ? "border-l-down" : "border-l-line-strong")}>
      <div className="grid items-stretch lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex gap-3 px-4 py-3">
          <Arrow size={20} className={clsx("mt-0.5 shrink-0", tone)} strokeWidth={2} />
          <div>
            <p className="text-[14px] leading-relaxed">{outlook.sentence}</p>
            <p className="mt-1 text-[11.5px] text-faint">
              A momentum read from one-minute bars, refreshed every few seconds. Direction over a few minutes is close to a coin
              flip; the range is the dependable part.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-px border-t border-line bg-line lg:w-[440px] lg:border-l lg:border-t-0">
          <Factor label="vs avg price" value={signedPct(outlook.vsVwap)} tone={sign(outlook.vsVwap)} />
          <Factor label="Last 5 min" value={signedPct(outlook.ret5)} tone={sign(outlook.ret5)} />
          <Factor label="Last 15 min" value={signedPct(outlook.ret15)} tone={sign(outlook.ret15)} />
          <Factor label="RSI (1 min)" value={outlook.rsi.toFixed(0)} tone={outlook.rsi > 70 ? "down" : outlook.rsi < 30 ? "up" : undefined} />
          <div className="col-span-4 bg-panel px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="cap">Position in today&apos;s range</span>
              <span className="num text-[12px] text-muted">{pct(outlook.dayPos, 0)}</span>
            </div>
            <div className="relative mt-1.5 h-1 bg-line-strong">
              <span className="absolute top-[-3px] h-[10px] w-[3px] bg-fg" style={{ left: `calc(${Math.round(outlook.dayPos * 100)}% - 1px)` }} />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
