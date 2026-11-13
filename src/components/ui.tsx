"use client";

import clsx from "clsx";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { shortDate, signedPct } from "@/lib/format";
import type { Catalyst, Enriched } from "@/lib/types";

export type Tone = "up" | "down" | "warn" | "accent" | "neutral";

const EDGE: Record<Tone, string> = { up: "edge-up", down: "edge-down", warn: "edge-warn", accent: "edge-accent", neutral: "edge-mute" };
const TEXT: Record<Tone, string> = { up: "text-up", down: "text-down", warn: "text-warn", accent: "text-accent", neutral: "text-fg" };

/** A quiet solid surface with soft corners. `tone` adds a short coloured bar on the left edge. */
export function Panel({ className, children, tone }: { className?: string; children: React.ReactNode; tone?: Tone }) {
  return (
    <section className={clsx("overflow-hidden rounded-2xl border border-line bg-panel", tone && "edge", tone && EDGE[tone], className)}>{children}</section>
  );
}

export function PanelHeader({ title, right, sub }: { title: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
        {sub && <div className="truncate text-[11.5px] text-faint">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Title block at the top of every page. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-medium text-faint">{eyebrow}</div>}
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[78ch] text-[14px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Wide page container used by every page. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-[1680px] space-y-5 px-4 pb-24 pt-6 md:px-8 md:pb-12 md:pt-9", className)}>{children}</div>;
}

/** Number that counts to its new value. */
export function NumberTicker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** A row of figure cards. */
export function StatStrip({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 }) {
  return <div className={clsx("grid grid-cols-2 gap-3", cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone,
  num,
  format,
  children,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "up" | "down";
  /** with `format`, the figure counts to each new value */
  num?: number;
  format?: (n: number) => string;
  /** a small graphic under the figure */
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel px-5 py-4">
      <div className="truncate text-[12px] font-medium text-muted">{label}</div>
      <div className={clsx("num mt-2 truncate text-[24px] font-semibold leading-none tracking-[-0.035em]", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {num !== undefined && format ? <NumberTicker value={num} format={format} /> : value}
      </div>
      {sub && <div className="mt-2 truncate text-[12px] text-faint">{sub}</div>}
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("shimmer", className)} />;
}

/** Placeholder shaped like a page: header, a row of cards and two panels. */
export function PageSkeleton({ label }: { label?: string }) {
  return (
    <Page>
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-line bg-panel px-5 py-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Skeleton className="h-[420px] !rounded-2xl" />
        <Skeleton className="h-[420px] !rounded-2xl" />
      </div>
      {label && <p className="text-center text-[12.5px] text-faint">{label}</p>}
    </Page>
  );
}

/** Shown in place of a page that failed to load. */
export function PageError({ message }: { message: string }) {
  return (
    <Page>
      <Panel className="px-6 py-10 text-center">
        <div className="text-[15px] font-semibold">This page could not load</div>
        <p className="mt-1 text-[13px] text-down">{message}</p>
        <p className="mt-1 text-[12.5px] text-faint">It retries on its own every few seconds.</p>
      </Panel>
    </Page>
  );
}

export function Change({ value, className }: { value: number; className?: string }) {
  return <span className={clsx("num", value >= 0 ? "text-up" : "text-down", className)}>{signedPct(value)}</span>;
}

/** Small rounded label. */
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone | "mute"; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium",
        tone === "up" && "bg-up/12 text-up",
        tone === "down" && "bg-down/12 text-down",
        tone === "warn" && "bg-warn/12 text-warn",
        tone === "accent" && "bg-accent/14 text-accent",
        tone === "neutral" && "bg-raised text-fg",
        tone === "mute" && "bg-raised text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CatalystTag({ c }: { c?: Catalyst }) {
  if (!c) return <span className="text-faint">—</span>;
  return (
    <Badge tone={c.kind === "earnings" ? "warn" : "accent"}>
      {c.kind === "earnings" ? "Earnings" : c.kind === "news" ? "News flow" : "Unusual activity"}
      {c.date && <span className="opacity-75">{shortDate(c.date)}</span>}
    </Badge>
  );
}

/** 0-100 value as a number and a slim bar. */
export function Meter({ value, tone }: { value: number; tone?: "up" | "down" }) {
  return (
    <span className="inline-flex items-center gap-2" title={`${value} / 100`}>
      <span className="num w-6 text-right font-semibold">{value}</span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line-strong">
        <span
          className={clsx("block h-full rounded-full transition-[width] duration-500", tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-fg")}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
    </span>
  );
}

/** Split of today's option premium between calls (green) and puts (red). */
export function FlowBar({ bias, wide }: { bias: number; wide?: boolean }) {
  const calls = Math.round(((bias + 1) / 2) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`${calls}% of premium in calls`}>
      <span className={clsx("flex h-1.5 gap-0.5", wide ? "w-full min-w-16" : "w-16")}>
        <span className="h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${calls}%` }} />
        <span className="h-full flex-1 rounded-full bg-down" />
      </span>
      <span className="num w-8 text-[12px] text-muted">{calls}%</span>
    </span>
  );
}

/** Progress ring. `value` is 0..1; `mark` draws a tick at another 0..1 position (e.g. where you should be). */
export function Ring({
  value,
  mark,
  size = 132,
  stroke = 9,
  tone = "up",
  children,
}: {
  value: number;
  mark?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = { up: "var(--c-up)", down: "var(--c-down)", warn: "var(--c-warn)", accent: "var(--c-accent)", neutral: "var(--c-fg)" }[tone];
  const angle = mark !== undefined ? Math.max(0, Math.min(1, mark)) * 2 * Math.PI - Math.PI / 2 : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-line-strong)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      {mark !== undefined && (
        <span
          className="absolute size-1.5 rounded-full bg-fg ring-2 ring-panel"
          style={{ left: size / 2 + r * Math.cos(angle) - 3, top: size / 2 + r * Math.sin(angle) - 3 }}
          title="Where a steady path would be today"
        />
      )}
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Tiny line chart with a soft fill. `base` draws a dashed reference (e.g. yesterday's close). */
export function Sparkline({ values, base, tone, height = 44, className }: { values: number[]; base?: number; tone?: "up" | "down"; height?: number; className?: string }) {
  const id = useId();
  if (values.length < 2) return <div style={{ height }} className={className} />;
  const w = 200;
  const all = base !== undefined ? [...values, base] : values;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (height - 6);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const t = tone ?? (values[values.length - 1] >= (base ?? values[0]) ? "up" : "down");
  const color = t === "up" ? "var(--c-up)" : "var(--c-down)";
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={clsx("block w-full", className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      {base !== undefined && <line x1="0" x2={w} y1={y(base)} y2={y(base)} stroke="var(--c-line-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Button({
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition-[background,color,opacity,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-fg text-bg hover:opacity-85",
        variant === "default" && "bg-raised text-fg hover:bg-line-strong",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-fg",
        className,
      )}
    />
  );
}

/** Text field styling shared by every input. */
export const fieldClass =
  "h-9 w-full rounded-lg border border-line-strong bg-transparent px-3 text-[13px] transition-colors placeholder:text-faint hover:border-faint focus:border-accent focus:outline-none";

/** Segmented control with a sliding thumb, like macOS. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const id = useId();
  return (
    <div className="inline-flex shrink-0 rounded-[9px] bg-raised p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx("relative h-[26px] rounded-md px-3 text-[12px] transition-colors", value === o.value ? "font-medium text-fg" : "text-muted hover:text-fg")}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="thumb absolute inset-0 rounded-md" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Tabs with a sliding underline. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  const id = useId();
  return (
    <div className="flex h-full items-stretch gap-6">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx("relative flex items-center gap-1.5 rounded-none text-[13px] transition-colors", value === o.value ? "font-semibold text-fg" : "text-muted hover:text-fg")}
        >
          {o.label}
          {o.count != null && <span className="num text-[11.5px] font-normal text-faint">{o.count}</span>}
          {value === o.value && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-fg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={clsx(
        "h-7 shrink-0 rounded-full px-3 text-[12px] transition-colors",
        active ? "bg-fg font-medium text-bg" : "bg-raised text-muted hover:bg-line-strong hover:text-fg",
        className,
      )}
    />
  );
}

/** A bullet list of short reasons. */
export function Bullets({ items, className, dot = "bg-faint" }: { items: string[]; className?: string; dot?: string }) {
  return (
    <ul className={clsx("space-y-1 text-[12.5px] leading-snug text-muted", className)}>
      {items.map((r) => (
        <li key={r} className="flex gap-2.5">
          <span className={clsx("mt-[7px] size-1 shrink-0 rounded-full", dot)} />
          <span className="min-w-0">{r}</span>
        </li>
      ))}
    </ul>
  );
}

export const toneText = (t: Tone) => TEXT[t];

/** Opens the order ticket with this contract already selected. */
export function ticketHref(c: Pick<Enriched, "underlying" | "type" | "strike" | "expiration">) {
  const p = new URLSearchParams({ sym: c.underlying, type: c.type, k: String(c.strike), exp: c.expiration });
  return `/calculator?${p}`;
}
