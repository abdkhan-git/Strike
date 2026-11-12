"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { session } from "@/lib/session";
import type { ProviderInfo } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { AlertBell } from "./AlertBell";
import { CommandPalette } from "./CommandPalette";
import { TickerTape } from "./TickerTape";

const NAV = [
  { href: "/", label: "Scanner" },
  { href: "/calculator", label: "Calculator" },
  { href: "/positions", label: "Positions" },
  { href: "/plan", label: "Plan" },
];

function MarketClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  const { state, time } = session(now);
  const open = state === "Market open";
  return (
    <div className="hidden items-center gap-2 text-[12px] lg:flex" title="Regular session 9:30–16:00 ET. Holidays not accounted for.">
      <span className={clsx("size-1.5", open ? "pulse-dot bg-up" : "bg-faint")} />
      <span className={open ? "text-fg" : "text-muted"}>{state}</span>
      <span className="num text-faint">{time}</span>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [palette, setPalette] = useState(false);
  const { data: info } = usePoll<ProviderInfo>("/api/status", 60_000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex h-12 shrink-0 items-stretch gap-6 border-b border-line bg-bg px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="currentColor" />
            <path d="M4 12 L12 4 M7 4 H12 V9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="text-[13px] font-semibold tracking-[0.14em]">STRIKE</span>
        </Link>

        <nav className="flex items-stretch gap-5">
          {NAV.map(({ href, label }) => {
            const active = href === "/" ? path === "/" || path.startsWith("/s/") : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "relative flex items-center text-[13px] transition-colors",
                  active ? "font-medium text-fg" : "text-muted hover:text-fg",
                )}
              >
                {label}
                {active && <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5">
          <button
            onClick={() => setPalette(true)}
            className="flex h-7 items-center gap-2 border border-line-strong px-2.5 text-[12px] text-muted transition-colors hover:border-muted hover:text-fg sm:w-56"
          >
            <Search size={13} />
            <span className="hidden sm:block">Search any ticker</span>
            <kbd className="num ml-auto hidden text-[10.5px] text-faint sm:block">Ctrl K</kbd>
          </button>
          <AlertBell />
          <MarketClock />
          {info && (
            <div className="hidden items-center gap-2 text-[12px] md:flex" title={info.note}>
              <span className={clsx("size-1.5", info.simulated ? "bg-warn" : info.realtime ? "bg-up" : "bg-accent")} />
              <span className={info.simulated ? "text-warn" : "text-muted"}>
                {info.simulated ? "Simulated data" : info.realtime ? `${info.name} · real-time` : `${info.name} · delayed`}
              </span>
            </div>
          )}
        </div>
      </header>

      <TickerTape />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>

      <footer className="hidden h-7 shrink-0 items-center border-t border-line px-6 text-[11px] text-faint md:flex">
        Flow, conviction and implied odds describe what the options market is doing. They are not predictions or advice.
      </footer>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
