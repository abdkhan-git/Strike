"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usd } from "@/lib/format";
import type { ScanResult } from "@/lib/types";
import { Change } from "./ui";

type Item = { symbol: string; name: string; price?: number; changePct?: number };

/** Ticker search. Enter opens the symbol, Shift+Enter opens it in the order ticket. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [known, setKnown] = useState<Item[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/scan")
      .then((r) => r.json())
      .then((d: ScanResult) => {
        if (alive && d.rows)
          setKnown(d.rows.map((r) => ({ symbol: r.quote.symbol, name: r.quote.name, price: r.quote.price, changePct: r.quote.changePct })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return known.slice(0, 8);
    const hits = known
      .filter((k) => k.symbol.startsWith(s) || k.name.toUpperCase().includes(s))
      .sort((a, b) => Number(b.symbol.startsWith(s)) - Number(a.symbol.startsWith(s)))
      .slice(0, 7);
    // any listed ticker works, not only the ones in the scan
    if (/^[A-Z.]{1,6}$/.test(s) && !hits.some((h) => h.symbol === s)) hits.unshift({ symbol: s, name: "Look up this ticker" });
    return hits;
  }, [q, known]);

  const go = (item: Item | undefined, ticket: boolean) => {
    if (!item) return;
    router.push(ticket ? `/calculator?sym=${encodeURIComponent(item.symbol)}` : `/s/${encodeURIComponent(item.symbol)}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label="Search tickers" className="rise w-full max-w-lg border border-line-strong bg-panel shadow-2xl shadow-black/60">
        <div className="flex h-12 items-center gap-3 border-b border-line px-4">
          <Search size={15} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") go(items[at], e.shiftKey);
            }}
            placeholder="Ticker or company"
            aria-label="Ticker or company"
            className="h-full flex-1 bg-transparent text-[14px] placeholder:text-faint focus:outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-auto py-1">
          {items.map((item, i) => (
            <li key={item.symbol}>
              <button
                onMouseEnter={() => setAt(i)}
                onClick={(e) => go(item, e.shiftKey)}
                className={clsx("flex h-10 w-full items-center gap-3 px-4 text-left", i === at && "bg-raised")}
              >
                <span className="w-14 font-semibold">{item.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{item.name}</span>
                {item.price != null && <span className="num">{usd(item.price)}</span>}
                {item.changePct != null && <Change value={item.changePct} className="w-16 text-right text-[12px]" />}
              </button>
            </li>
          ))}
          {!items.length && <li className="px-4 py-6 text-center text-muted">Type a ticker symbol, for example NVDA.</li>}
        </ul>
        <div className="flex h-8 items-center gap-4 border-t border-line px-4 text-[11px] text-faint">
          <span>
            <kbd className="num text-muted">Enter</kbd> open chain
          </span>
          <span>
            <kbd className="num text-muted">Shift Enter</kbd> open in calculator
          </span>
          <span className="ml-auto">
            <kbd className="num text-muted">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
