"use client";

import clsx from "clsx";
import { ago } from "@/lib/format";
import type { NewsResult } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { Panel, PanelHeader } from "./ui";

const TONE = {
  positive: { label: "Positive coverage", className: "text-up" },
  negative: { label: "Negative coverage", className: "text-down" },
  mixed: { label: "Mixed coverage", className: "text-warn" },
  quiet: { label: "Quiet", className: "text-muted" },
} as const;

/** Recent headlines for one symbol with a model-written digest on top. */
export function NewsPanel({ symbol, className }: { symbol: string; className?: string }) {
  const { data } = usePoll<NewsResult>(`/api/news?symbol=${encodeURIComponent(symbol)}`, 20_000);
  const brief = data?.brief;

  return (
    <Panel className={clsx("min-w-0", className)}>
      <PanelHeader
        title="News"
        right={
          brief && (
            <span className="text-[11px] text-faint">
              digest by {brief.model} · {ago(brief.at)}
            </span>
          )
        }
      />
      {!data ? (
        <div className="px-4 py-8 text-center text-muted">Loading headlines…</div>
      ) : !data.headlines.length ? (
        <div className="px-4 py-8 text-center text-muted">No headlines for {symbol} in the last three days.</div>
      ) : (
        <>
          {brief ? (
            <div className="border-b border-line px-4 py-3">
              <div className={clsx("cap", TONE[brief.tone].className)}>{TONE[brief.tone].label}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed">{brief.summary}</p>
              {brief.drivers.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12px] leading-snug text-muted">
                  {brief.drivers.map((d) => (
                    <li key={d} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            data.pending && <div className="border-b border-line px-4 py-3 text-[12px] text-muted">Writing a digest of these headlines…</div>
          )}
          <ul className="max-h-[330px] overflow-auto">
            {data.headlines.map((h) => (
              <li key={h.id} className="border-b border-line last:border-0">
                <a href={h.url} target="_blank" rel="noreferrer" className="block px-4 py-2.5 transition-colors hover:bg-hover">
                  <div className="text-[12.5px] leading-snug">{h.headline}</div>
                  <div className="mt-0.5 text-[11.5px] text-faint">
                    {h.source} · {ago(h.at)}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
