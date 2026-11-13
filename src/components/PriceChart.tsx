"use client";

import clsx from "clsx";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pct, signedPct } from "@/lib/format";
import type { Bar, ChartResult, Outlook } from "@/lib/types";
import { Panel, Segmented } from "./ui";

export type ChartLine = { price: number; label: string; tone: "up" | "down" | "warn" | "accent" | "muted" };

/** Seconds offset that makes the chart's clock read New York time. */
function etOffset(ms: number) {
  const d = new Date(ms);
  const ny = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((ny.getTime() - utc.getTime()) / 1000);
}

function fiveMinute(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / 300_000) * 300_000;
    const last = out.at(-1);
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** "#30d158" + 0.35 -> "rgba(48, 209, 88, 0.35)" (the chart canvas needs plain colours). */
function alpha(color: string, a: number) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Reads the theme's colours as concrete values (the chart canvas can't use CSS variables). */
function palette() {
  return {
    fg: css("--c-fg"),
    muted: css("--c-muted"),
    faint: css("--c-faint"),
    line: css("--c-line"),
    up: css("--c-up"),
    down: css("--c-down"),
    warn: css("--c-warn"),
    accent: css("--c-accent"),
  };
}

/**
 * Candlestick chart (TradingView Lightweight Charts): five-minute candles for the latest
 * session with the running average price (VWAP), or six months of daily candles with the
 * 20-day average. Volume sits underneath. `lines` draws levels such as support, resistance
 * and a trade's entry, target, stop and invalidation.
 */
export function PriceChart({ data, price, lines = [], className }: { data?: ChartResult; price: number; lines?: ChartLine[]; className?: string }) {
  const [range, setRange] = useState<"1D" | "6M">("1D");
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; avg: ISeriesApi<"Line"> } | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const fitted = useRef("");

  const rows = useMemo(() => {
    if (!data) return [];
    return range === "1D" ? fiveMinute(data.bars) : data.daily;
  }, [data, range]);

  // create the chart once, recolour it when the theme changes
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "var(--font-geist-mono), ui-monospace", fontSize: 11, attributionLogo: false },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      grid: { horzLines: { style: LineStyle.Solid }, vertLines: { visible: false } },
    });
    const candles = c.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: true, lastValueVisible: true });
    const volume = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const avg = c.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chart.current = c;
    series.current = { candles, volume, avg };

    const paint = () => {
      const p = palette();
      c.applyOptions({
        layout: { textColor: p.muted, fontFamily: getComputedStyle(document.body).fontFamily },
        grid: { horzLines: { color: p.line } },
        crosshair: { vertLine: { color: p.faint, labelBackgroundColor: p.fg }, horzLine: { color: p.faint, labelBackgroundColor: p.fg } },
      });
      candles.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
      avg.applyOptions({ color: p.accent });
    };
    paint();
    window.addEventListener("strike-theme", paint);
    return () => {
      window.removeEventListener("strike-theme", paint);
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  // data
  useEffect(() => {
    const s = series.current;
    if (!s || !rows.length) return;
    const p = palette();
    const off = etOffset(rows.at(-1)!.t);
    const t = (ms: number) => (Math.floor(ms / 1000) + off) as UTCTimestamp;
    s.candles.setData(rows.map((b) => ({ time: t(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    s.volume.setData(rows.map((b) => ({ time: t(b.t), value: b.v, color: alpha(b.c >= b.o ? p.up : p.down, 0.35) })));
    if (range === "1D") {
      let pv = 0,
        vol = 0;
      s.avg.setData(
        rows.map((b) => {
          pv += ((b.h + b.l + b.c) / 3) * b.v;
          vol += b.v;
          return { time: t(b.t), value: vol > 0 ? pv / vol : b.c };
        }),
      );
    } else {
      s.avg.setData(rows.flatMap((b, i) => (i >= 19 ? [{ time: t(b.t), value: rows.slice(i - 19, i + 1).reduce((x, r) => x + r.c, 0) / 20 }] : [])));
    }
    s.candles.applyOptions({ priceFormat: { type: "price", precision: price < 20 ? 3 : 2, minMove: price < 20 ? 0.001 : 0.01 } });
    chart.current?.timeScale().applyOptions({ timeVisible: range === "1D" });
    const key = `${range}|${data?.symbol}`;
    if (fitted.current !== key) {
      fitted.current = key;
      // fit again once the container has its final size (autoSize measures after layout)
      const fit = () => chart.current?.timeScale().fitContent();
      fit();
      requestAnimationFrame(fit);
      setTimeout(fit, 250);
    }
  }, [rows, range, price, data?.symbol]);

  // levels
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const draw = () => {
      for (const l of priceLines.current) s.candles.removePriceLine(l);
      const p = palette();
      priceLines.current = lines
        .filter((l) => Number.isFinite(l.price) && l.price > 0)
        .map((l) =>
          s.candles.createPriceLine({
            price: l.price,
            title: l.label,
            color: { up: p.up, down: p.down, warn: p.warn, accent: p.accent, muted: p.faint }[l.tone],
            lineWidth: 1,
            lineStyle: l.tone === "muted" ? LineStyle.Dotted : LineStyle.Dashed,
            axisLabelVisible: true,
          }),
        );
    };
    draw();
    window.addEventListener("strike-theme", draw);
    return () => window.removeEventListener("strike-theme", draw);
  }, [lines]);

  const base = range === "1D" ? (data?.prevClose ?? 0) : (rows[0]?.c ?? 0);
  const up = price >= base;

  return (
    <Panel className={clsx("min-w-0", className)}>
      <div className="flex h-12 items-center justify-between gap-3 border-b border-line px-5">
        <div className="flex items-center gap-4">
          <h2 className="text-[13px] font-semibold">Price</h2>
          {base > 0 && (
            <span className={clsx("num text-[12px]", up ? "text-up" : "text-down")}>
              {signedPct(price / base - 1)} {range === "1D" ? "today" : "in 6 months"}
            </span>
          )}
          <span className="hidden items-center gap-1.5 text-[12px] text-muted sm:flex">
            <span className="h-px w-3 border-t border-dashed border-accent" /> {range === "1D" ? "VWAP · 5-minute candles" : "20-day average · daily candles"}
          </span>
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
      <div className="relative h-[400px]">
        <div ref={box} className="absolute inset-0" />
        {!rows.length && (
          <div className="absolute inset-0 grid place-items-center text-muted">{data ? "No price bars for this session yet." : "Loading price…"}</div>
        )}
      </div>
    </Panel>
  );
}

function Factor({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-panel-solid px-3 py-2">
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
    <Panel className={clsx("edge", outlook.lean === "up" ? "edge-up" : outlook.lean === "down" ? "edge-down" : "edge-mute")}>
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
          <div className="col-span-4 bg-panel-solid px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="cap">Position in today&apos;s range</span>
              <span className="num text-[12px] text-muted">{pct(outlook.dayPos, 0)}</span>
            </div>
            <div className="relative mt-1.5 h-1 rounded-full bg-line-strong">
              <span className="absolute top-[-3px] h-[10px] w-[3px] rounded-full bg-fg" style={{ left: `calc(${Math.round(outlook.dayPos * 100)}% - 1px)` }} />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
