"use client";

import clsx from "clsx";
import type { MarketContext } from "@/lib/desk";
import { pct, shortDate, signedPct, usd } from "@/lib/format";
import { Badge, Change, Panel, PanelHeader } from "./ui";

/** Regime, volatility, what is scheduled, and anything that should make you slow down today. */
export function ContextPanel({ ctx }: { ctx: MarketContext }) {
  const regimeTone = ctx.regime.label === "Uptrend" ? "up" : ctx.regime.label === "Downtrend" ? "down" : "mute";
  const volTone = ctx.vol.label === "Calm" || ctx.vol.label === "Normal" ? "mute" : ctx.vol.label === "Elevated" ? "warn" : "down";
  return (
    <Panel>
      <PanelHeader title="Market backdrop" sub={ctx.session} />
      <div className="grid grid-cols-2 gap-px bg-line">
        <div className="bg-panel px-5 py-4">
          <div className="text-[12px] text-muted">Index regime</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[17px] font-semibold tracking-[-0.02em]">{ctx.regime.label}</span>
            <Badge tone={regimeTone}>
              {ctx.regime.score > 0 ? "+" : ""}
              {ctx.regime.score}
            </Badge>
          </div>
          <div className="mt-1.5 text-[11.5px] leading-snug text-faint">{ctx.regime.note}</div>
        </div>
        <div className="bg-panel px-5 py-4">
          <div className="text-[12px] text-muted">Volatility</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[17px] font-semibold tracking-[-0.02em]">{ctx.vol.label}</span>
            <Badge tone={volTone}>{pct(ctx.vol.atmIv, 0)} IV</Badge>
          </div>
          <div className="mt-1.5 text-[11.5px] leading-snug text-faint">{ctx.vol.note}</div>
        </div>
      </div>
      {ctx.spy && (
        <div className="num flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-muted">
          <span>
            SPY <span className="text-fg">{usd(ctx.spy.price)}</span> <Change value={ctx.spy.changePct} />
          </span>
          <span>implied move ±{pct(ctx.spy.expectedMovePct)}</span>
          {ctx.spy.vsVwap !== undefined && <span>{signedPct(ctx.spy.vsVwap)} vs today&apos;s average</span>}
        </div>
      )}
      {ctx.cautions.length > 0 && (
        <ul className="space-y-2 border-t border-line px-5 py-3">
          {ctx.cautions.map((c) => (
            <li key={c} className="rounded-xl bg-warn/10 px-3.5 py-2.5 text-[12.5px] leading-snug text-warn">
              {c}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-5 py-3">
        <div className="mb-2 text-[12px] font-medium text-muted">On the calendar</div>
        {ctx.events.length ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {ctx.events.slice(0, 8).map((e) => (
              <li key={e.date + e.label} className="flex items-baseline gap-3">
                <span className={clsx("num w-16 shrink-0", e.inDays === 0 ? "font-semibold text-fg" : "text-faint")}>{e.inDays === 0 ? "Today" : e.inDays === 1 ? "Tomorrow" : shortDate(e.date)}</span>
                <span className={e.kind === "earnings" ? "text-muted" : "text-fg"}>{e.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-faint">Nothing scheduled in the next ten days.</p>
        )}
        <p className="mt-2.5 text-[11px] leading-snug text-faint">Fed days and earnings are dated; the jobs report and options expiry follow their usual Fridays. CPI is not listed.</p>
      </div>
    </Panel>
  );
}
