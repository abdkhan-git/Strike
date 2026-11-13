"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import type { IdeaCheck } from "@/lib/desk";
import type { Enriched } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { toast } from "./Toaster";
import { Badge, Button } from "./ui";

const VERDICT = {
  go: { label: "Go", tone: "up" },
  wait: { label: "Wait", tone: "warn" },
  skip: { label: "Skip", tone: "down" },
  closed: { label: "Market closed", tone: "mute" },
  unknown: { label: "No read", tone: "mute" },
} as const;
const DOT = { pass: "bg-up", warn: "bg-warn", fail: "bg-down" };

/**
 * The trade check for the contract in the order ticket, at the size being entered: the
 * same verdict the Watch page gives, with a button to keep watching it.
 */
export function CheckStrip({ c, dollars }: { c: Enriched; dollars: number }) {
  const ok = dollars >= 1;
  // rounded to $25 so typing a quantity does not ask the server for a new verdict on every keystroke
  const size = Math.max(1, Math.round(dollars / 25) * 25);
  const { data } = usePoll<IdeaCheck & { error?: string }>(
    ok ? `/api/check?symbol=${c.underlying}&type=${c.type}&strike=${c.strike}&exp=${c.expiration}&dollars=${size}` : null,
    8000,
  );
  const [added, setAdded] = useState(false);
  if (!ok || !data || data.error) return null;
  const v = VERDICT[data.verdict];
  const flagged = data.items.filter((i) => i.status !== "pass");

  async function watch() {
    const res = await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: c.underlying, type: c.type, strike: c.strike, expiration: c.expiration, dollars: Math.round(dollars) }),
    });
    if (res.ok) {
      setAdded(true);
      toast("Added to Watch: you'll be alerted if it turns Go", "up");
    } else toast((await res.json().catch(() => ({}))).error ?? "Could not add to Watch", "down");
  }

  return (
    <div className="border-t border-line px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="cap">Strike&apos;s read</span>
          <Badge tone={v.tone}>{v.label}</Badge>
          <span className="num text-[12px] text-muted">{data.score}/100</span>
        </span>
        {added ? (
          <Link href="/watch" className="text-[12px] font-medium text-fg underline underline-offset-4">
            Open Watch
          </Link>
        ) : (
          <Button variant="ghost" className="!h-7" onClick={watch}>
            Add to Watch
          </Button>
        )}
      </div>
      <div className="mt-2 text-[13px] font-medium leading-snug">{data.headline}</div>
      <p className="mt-0.5 text-[12px] leading-snug text-muted">{data.action}</p>
      <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {data.items.map((i) => (
          <li key={i.key} title={i.detail} className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className={clsx("size-1.5 rounded-full", DOT[i.status])} />
            {i.label}
          </li>
        ))}
      </ul>
      {flagged.length > 0 && data.verdict !== "go" && <p className="mt-2 text-[11.5px] leading-snug text-faint">{flagged[0].detail}</p>}
    </div>
  );
}
