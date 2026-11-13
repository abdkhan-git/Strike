"use client";

import clsx from "clsx";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ago } from "@/lib/format";
import type { Alert, AlertSettings, AlertsView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { Button } from "./ui";

const TONE: Record<Alert["tone"], string> = {
  up: "edge-up",
  down: "edge-down",
  warn: "edge-warn",
  neutral: "edge-mute",
};

/** Bell in the top bar: unread count, alert feed, desktop notifications and alert settings. */
export function AlertBell() {
  const router = useRouter();
  const { data, reload } = usePoll<AlertsView>("/api/alerts", 15_000);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  // desktop notification for alerts that arrived since the last poll (not for the backlog on page load)
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.alerts.map((a) => a.id));
    if (seen.current && perm === "granted") {
      for (const a of data.alerts) {
        if (seen.current.has(a.id) || a.read) continue;
        const n = new Notification(a.title, { body: a.body, tag: a.id });
        n.onclick = () => {
          window.focus();
          if (a.href) router.push(a.href);
          n.close();
        };
      }
    }
    seen.current = ids;
  }, [data, perm, router]);

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

  async function post(action: "read" | "test" | "check") {
    await fetch(`/api/alerts?action=${action}`, { method: "POST" });
    reload();
  }

  async function save(patch: Partial<AlertSettings>) {
    await fetch("/api/alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    reload();
  }

  const unread = data?.unread ?? 0;

  return (
    <div ref={box} className="relative flex items-center">
      <button
        aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) void post("read");
        }}
        className={clsx(
          "relative grid size-8 place-items-center !rounded-full transition-colors",
          open ? "bg-raised text-fg" : "text-muted hover:bg-hover hover:text-fg",
        )}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="num absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-down px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && data && (
        <div className="rise glass absolute right-0 top-11 z-40 w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line-strong shadow-2xl shadow-black/60">
          <div className="flex h-10 items-center justify-between border-b border-line px-4">
            <span className="text-[13px] font-semibold">Alerts</span>
            <span className="text-[11px] text-faint">
              {data.watching ? `checked ${data.checkedAt ? ago(data.checkedAt) : "soon"} · every minute in market hours` : "watcher not running"}
            </span>
          </div>

          <ul className="max-h-[360px] overflow-auto">
            {data.alerts.map((a) => (
              <li key={a.id} className="border-b border-line last:border-0">
                <button
                  onClick={() => {
                    if (a.href) router.push(a.href);
                    setOpen(false);
                  }}
                  className={clsx("edge block w-full !rounded-none px-5 py-3 text-left transition-colors hover:bg-hover", TONE[a.tone])}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-medium">{a.title}</span>
                    <span className="shrink-0 text-[11px] text-faint">{ago(a.at)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted">{a.body}</p>
                </button>
              </li>
            ))}
            {!data.alerts.length && (
              <li className="px-4 py-8 text-center text-[12.5px] text-muted">
                Nothing yet. You&apos;ll be alerted when a position needs action or a strong signal appears.
              </li>
            )}
          </ul>

          <div className="space-y-2.5 border-t border-line px-4 py-3 text-[12.5px]">
            <Toggle label="Position calls that need action (sell, trim, cut)" on={data.settings.verdicts} set={(v) => save({ verdicts: v })} />
            <Toggle label="Morning picks at 9:45 ET" on={data.settings.picks} set={(v) => save({ picks: v })} />
            <Toggle label="Daily loss limit reached" on={data.settings.risk} set={(v) => save({ risk: v })} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">New signals at conviction</span>
              <select
                value={data.settings.signalMin}
                onChange={(e) => save({ signalMin: Number(e.target.value) })}
                className="num h-7 border border-line-strong bg-raised px-2 text-[12px] focus:outline-none"
              >
                <option value={0}>off</option>
                {[70, 75, 80, 85, 90].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </select>
            </div>
            <Toggle
              label={data.phoneReady ? "Push to phone (ntfy)" : "Push to phone: add NTFY_TOPIC to .env.local"}
              on={data.phoneReady && data.settings.phone}
              disabled={!data.phoneReady}
              set={(v) => save({ phone: v })}
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              {perm === "granted" ? (
                <span className="text-[11.5px] text-up">Desktop notifications on</span>
              ) : perm === "unsupported" ? (
                <span className="text-[11.5px] text-faint">This browser has no desktop notifications</span>
              ) : perm === "denied" ? (
                <span className="text-[11.5px] text-faint">Desktop notifications are blocked in browser settings</span>
              ) : (
                <Button onClick={async () => setPerm(await Notification.requestPermission())}>Turn on desktop notifications</Button>
              )}
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => post("check")}>
                  Check now
                </Button>
                <Button variant="ghost" onClick={() => post("test")}>
                  Send test
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, set, disabled }: { label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={clsx("flex items-center justify-between gap-3", disabled ? "cursor-default" : "cursor-pointer")}>
      <span className={disabled ? "text-faint" : "text-muted"}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => set(!on)}
        className={clsx("relative h-5 w-9 shrink-0 !rounded-full transition-colors", on ? "bg-up" : "bg-line-strong")}
      >
        <span className={clsx("absolute top-[2px] size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-[2px]")} />
      </button>
    </label>
  );
}
