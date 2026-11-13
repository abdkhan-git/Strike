"use client";

import clsx from "clsx";
import { Calculator, Crosshair, FlaskConical, LogOut, Radar, Search, Sparkles, Target, Wallet } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { session } from "@/lib/session";
import type { ProviderInfo } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { AlertBell } from "./AlertBell";
import { ChatPanel } from "./ChatPanel";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { TickerTape } from "./TickerTape";
import { Toaster } from "./Toaster";

const NAV = [
  { href: "/", label: "Scanner", icon: Radar },
  { href: "/watch", label: "Watch", icon: Crosshair },
  { href: "/plan", label: "Plan", icon: Target },
  { href: "/positions", label: "Positions", icon: Wallet },
  { href: "/lab", label: "Lab", icon: FlaskConical },
  { href: "/calculator", label: "Calculator", icon: Calculator },
];

/** Market session and data feed in one quiet chip. */
function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);
  const { data: info } = usePoll<ProviderInfo>("/api/status", 60_000);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  const { state, time, holiday } = session(now);
  const open = state === "Market open";
  const feed = !info ? "" : info.simulated ? "Simulated data" : info.realtime ? "Real-time" : "Delayed 15 min";
  return (
    <div
      className="hidden h-8 items-center gap-2 rounded-full bg-raised px-3 text-[12px] xl:flex"
      title={`${holiday ? "Exchange holiday. " : ""}Regular session 9:30–16:00 ET.${info ? ` ${info.note}` : ""}`}
    >
      <span className={clsx("size-1.5 rounded-full", info?.simulated ? "bg-warn" : open ? "pulse-dot bg-up" : "bg-faint")} />
      <span className={clsx("font-medium", open ? "text-fg" : "text-muted")}>{holiday ? "Holiday" : state === "Market open" ? "Open" : state}</span>
      <span className="num text-faint">{time}</span>
      {feed && <span className={clsx("hidden border-l border-line-strong pl-2 2xl:block", info?.simulated ? "text-warn" : "text-faint")}>{feed}</span>}
    </div>
  );
}

type Me = { enabled: boolean; user: { name: string; email: string; picture?: string } | null };

/** Avatar with the account menu. Hidden while sign-in is not configured. */
function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me?.enabled || !me.user) return null;
  const u = me.user;
  const initials = u.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div ref={box} className="relative">
      <button
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center overflow-hidden !rounded-full bg-raised text-[11px] font-semibold text-muted transition-opacity hover:opacity-80"
      >
        {u.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u.picture} alt="" width={32} height={32} referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          initials
        )}
      </button>
      {open && (
        <div className="rise glass absolute right-0 top-11 z-40 w-64 rounded-2xl border border-line-strong p-1.5 shadow-2xl shadow-black/50">
          <div className="px-3 py-2.5">
            <div className="truncate text-[13px] font-semibold">{u.name}</div>
            <div className="truncate text-[12px] text-muted">{u.email}</div>
          </div>
          <button onClick={signOut} className="flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [palette, setPalette] = useState(false);
  const [chat, setChat] = useState(false);
  const bare = path === "/login";

  useEffect(() => {
    if (bare) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === "j" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setChat((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bare]);

  if (bare) return <main className="h-full overflow-auto">{children}</main>;

  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/s/") : path.startsWith(href));

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line bg-bg px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 justify-self-start" aria-label="Strike home">
          <Logo size={28} />
          <span className="hidden text-[16px] font-semibold tracking-[-0.03em] sm:block">Strike</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map(({ href, label }) => {
            const on = active(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={clsx("relative flex h-8 items-center rounded-full px-3.5 text-[13.5px] transition-colors", on ? "font-medium text-fg" : "text-muted hover:text-fg")}
              >
                {on && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-full bg-raised" transition={{ type: "spring", stiffness: 480, damping: 40 }} />}
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </nav>
        <span className="md:hidden" />

        <div className="flex items-center gap-1.5 justify-self-end">
          <button
            onClick={() => setPalette(true)}
            aria-label="Search tickers"
            className="flex h-8 items-center gap-2 !rounded-full bg-raised px-3 text-[12.5px] text-muted transition-colors hover:text-fg lg:w-48"
          >
            <Search size={14} />
            <span className="hidden lg:block">Search</span>
            <kbd className="ml-auto hidden font-sans text-[11px] text-faint lg:block">Ctrl K</kbd>
          </button>
          <button
            onClick={() => setChat(true)}
            className="flex h-8 items-center gap-1.5 !rounded-full bg-fg px-3.5 text-[12.5px] font-medium text-bg transition-opacity hover:opacity-85"
          >
            <Sparkles size={13} strokeWidth={2.2} />
            <span className="hidden sm:block">Ask</span>
          </button>
          <AlertBell />
          <ThemeToggle />
          <MarketStatus />
          <AccountMenu />
        </div>
      </header>

      <TickerTape />

      <main className="min-h-0 flex-1 overflow-auto">
        {children}
        <p className="mx-auto max-w-[1680px] px-4 pb-24 text-[11.5px] leading-relaxed text-faint md:px-8 md:pb-8">
          Flow, scores, calls and odds describe what the market is doing. They are not guarantees or financial advice, and options can lose their
          entire value.
        </p>
      </main>

      {/* phones: the four pages as a tab bar */}
      <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = active(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} className={clsx("flex h-14 flex-col items-center justify-center gap-1 text-[10px]", on ? "font-medium text-fg" : "text-faint")}>
              <Icon size={18} strokeWidth={on ? 2.2 : 1.7} />
              {label}
            </Link>
          );
        })}
      </nav>

      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {chat && <ChatPanel onClose={() => setChat(false)} />}
      <Toaster />
    </div>
  );
}
