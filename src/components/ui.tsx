import clsx from "clsx";
import { shortDate, signedPct } from "@/lib/format";
import type { Catalyst, Enriched } from "@/lib/types";

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx("border border-line bg-panel", className)}>{children}</section>;
}

export function PanelHeader({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
      <h2 className="cap !text-muted">{title}</h2>
      {right}
    </div>
  );
}

/** A row of figures in one frame, separated by hairlines. */
export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="cap">{label}</div>
      <div
        className={clsx(
          "num mt-1.5 text-[19px] font-medium",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Change({ value, className }: { value: number; className?: string }) {
  return <span className={clsx("num", value >= 0 ? "text-up" : "text-down", className)}>{signedPct(value)}</span>;
}

export function CatalystTag({ c }: { c?: Catalyst }) {
  if (!c) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg">
      <span className={clsx("size-1.5", c.kind === "earnings" ? "bg-warn" : "bg-accent")} />
      {c.kind === "earnings" ? "Earnings" : c.kind === "news" ? "News flow" : "Unusual activity"}
      {c.date && <span className="text-muted">{shortDate(c.date)}</span>}
    </span>
  );
}

/** 0-100 value as a number plus five square segments. */
export function Meter({ value, tone }: { value: number; tone?: "up" | "down" }) {
  const lit = Math.round(value / 20);
  return (
    <span className="inline-flex items-center gap-2" title={`${value} / 100`}>
      <span className="num w-6 text-right font-medium">{value}</span>
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={clsx(
              "h-2.5 w-1",
              i > lit ? "bg-line-strong" : tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-fg",
            )}
          />
        ))}
      </span>
    </span>
  );
}

/** Split of today's option premium between calls (green) and puts (red). */
export function FlowBar({ bias }: { bias: number }) {
  const calls = Math.round(((bias + 1) / 2) * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`${calls}% of premium in calls`}>
      <span className="flex h-1.5 w-16 gap-px">
        <span className="h-full bg-up" style={{ width: `${calls}%` }} />
        <span className="h-full flex-1 bg-down" />
      </span>
      <span className="num w-8 text-[12px] text-muted">{calls}%</span>
    </span>
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
        "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40",
        variant === "primary" && "bg-fg text-bg hover:bg-white",
        variant === "default" && "border border-line-strong text-fg hover:border-muted hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-raised hover:text-fg",
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex border border-line-strong">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-6 border-r border-line-strong px-2.5 text-[12px] transition-colors last:border-r-0",
            value === o.value ? "bg-fg font-medium text-bg" : "text-muted hover:bg-raised hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underlined tabs for switching views inside a panel header. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex h-full items-stretch gap-5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative flex items-center gap-1.5 text-[12.5px] transition-colors",
            value === o.value ? "font-medium text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.count != null && <span className="num text-[11px] text-faint">{o.count}</span>}
          {value === o.value && <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />}
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
        "h-7 shrink-0 border px-2.5 text-[12px] transition-colors",
        active ? "border-fg bg-fg font-medium text-bg" : "border-line-strong text-muted hover:border-muted hover:text-fg",
        className,
      )}
    />
  );
}

/** Opens the order ticket with this contract already selected. */
export function ticketHref(c: Pick<Enriched, "underlying" | "type" | "strike" | "expiration">) {
  const p = new URLSearchParams({ sym: c.underlying, type: c.type, k: String(c.strike), exp: c.expiration });
  return `/calculator?${p}`;
}
