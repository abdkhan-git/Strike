"use client";

import { useEffect, useState } from "react";
import { contractLabel, usd } from "@/lib/format";
import type { OptType } from "@/lib/types";
import { Button } from "./ui";

export interface Loggable {
  occ: string;
  underlying: string;
  type: OptType;
  strike: number;
  expiration: string;
  ask: number;
  mid: number;
}

export function LogTradeDialog({ contract, onClose }: { contract: Loggable; onClose: (saved: boolean) => void }) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState((contract.ask || contract.mid).toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cost = Number(qty) * Number(price) * 100;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...contract, qty: Number(qty), entryPrice: Number(price), note }),
    });
    setBusy(false);
    if (res.ok) onClose(true);
    else setError((await res.json()).error ?? "Could not save the trade");
  }

  const field =
    "h-8 w-full border border-line bg-bg px-2.5 text-[13px] focus:border-line-strong focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <form
        onSubmit={save}
        role="dialog"
        aria-label="Log purchase"
        className="w-full max-w-sm border border-line-strong bg-panel shadow-2xl"
      >
        <div className="border-b border-line px-4 py-3">
          <div className="text-[12px] text-muted">Log purchase</div>
          <div className="mt-0.5 text-[15px] font-semibold tracking-tight">
            {contract.underlying} {contractLabel(contract)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <label className="text-[12px] text-muted">
            Contracts
            <input autoFocus type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} className={`${field} mt-1 text-fg`} />
          </label>
          <label className="text-[12px] text-muted">
            Fill price
            <input type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={`${field} mt-1 text-fg`} />
          </label>
          <label className="col-span-2 text-[12px] text-muted">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this trade (optional)" className={`${field} mt-1 text-fg placeholder:text-faint`} />
          </label>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <div className="text-[12px] text-muted">
            {error ? <span className="text-down">{error}</span> : <>Total cost {isFinite(cost) ? usd(cost) : "—"}</>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Log trade
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
