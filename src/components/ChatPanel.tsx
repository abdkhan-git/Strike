"use client";

import clsx from "clsx";
import { ArrowUp, Check, Copy, Crosshair, Flame, LineChart, SquarePen, Square, Wallet, X } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { signedUsd, usd } from "@/lib/format";
import type { PlanView } from "@/lib/types";
import { usePoll } from "@/lib/usePoll";
import { Logo } from "./Logo";

type Turn = { role: "user" | "assistant"; content: string; tools?: string[]; error?: string; model?: string };

const KEY = "strike.chat";
const SUGGESTIONS = [
  { icon: Crosshair, title: "Best trade right now", text: "What is the single best trade for my account right now, sized to my plan?" },
  { icon: Wallet, title: "Review my positions", text: "What should I do with my open positions right now?" },
  { icon: Flame, title: "High risk, high reward", text: "Best high-risk, high-reward play this week? Give me the odds and the most I can lose." },
  { icon: LineChart, title: "Read a stock", text: "Is NVDA a buy or a sell for tomorrow?" },
];

/** A line that is part of the order itself, which gets set apart from the reasoning. */
const ORDER_LINE = /^\*\*(buy|sell|take profit|stop|odds|sell by)\b/i;

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-raised px-1 py-0.5 font-mono text-[12px]">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Renders the assistant's text: the order lines as a card, then bold, bullets and paragraphs. Text only, never HTML. */
function Rich({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let order: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={blocks.length} className="space-y-1.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" />
            <span className="min-w-0">{inline(b)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  const flushOrder = () => {
    if (!order.length) return;
    const put = /\bput\b/i.test(order[0]);
    blocks.push(
      <div key={blocks.length} className={clsx("edge space-y-1.5 rounded-2xl bg-raised px-4 py-3.5 text-[13.5px] leading-relaxed", put ? "edge-down" : "edge-up")}>
        {order.map((l, i) => (
          <p key={i} className={i === 0 ? "text-[14px]" : "text-muted"}>
            {inline(l)}
          </p>
        ))}
      </div>,
    );
    order = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (ORDER_LINE.test(line)) {
      flushBullets();
      order.push(line);
    } else if (bullet) {
      flushOrder();
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      flushOrder();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flushBullets();
  flushOrder();
  return <div className="space-y-3">{blocks}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      aria-label="Copy answer"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*/g, ""));
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className="flex h-6 items-center gap-1 px-1.5 text-[11.5px] text-faint transition-colors hover:text-fg"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Chat with the trading assistant, in a sheet on the right. History is kept in this browser only. */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { data: plan } = usePoll<PlanView>("/api/plan", 60_000);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved));
    } catch {}
    box.current?.focus();
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    try {
      if (!busy) localStorage.setItem(KEY, JSON.stringify(turns.slice(-30)));
    } catch {}
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // the box grows with what is typed, up to a few lines
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Turn[] = [...turns, { role: "user", content: q }];
    setTurns([...history, { role: "assistant", content: "", tools: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patch = (f: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), f(all[all.length - 1])]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((t) => t.content).map(({ role, content }) => ({ role, content })) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let e: { t: string; v: string };
          try {
            e = JSON.parse(line);
          } catch {
            continue; // a malformed line must not end the whole answer
          }
          if (e.t === "text") patch((t) => ({ ...t, content: t.content + e.v }));
          else if (e.t === "tool") patch((t) => ({ ...t, tools: [...(t.tools ?? []), e.v] }));
          else if (e.t === "model") patch((t) => ({ ...t, model: e.v }));
          else if (e.t === "error") patch((t) => ({ ...t, error: e.v }));
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patch((t) => ({ ...t, error: e instanceof Error ? e.message : "Request failed" }));
      else patch((t) => (t.content ? t : { ...t, error: "Stopped." }));
    } finally {
      setBusy(false);
      abort.current = null;
      box.current?.focus();
    }
  }

  const context = plan
    ? [
        ["Account", usd(plan.equity, 0)],
        ["Per trade", plan.budget > 0 ? usd(plan.budget, 0) : "paused"],
        ["Today", signedUsd(plan.todayPnl, 0)],
      ]
    : [];

  return (
    <motion.div
      className="fixed inset-0 z-40 bg-black/50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <motion.aside
        role="dialog"
        aria-label="Ask Strike"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="fixed inset-y-0 right-0 flex w-full flex-col border-line-strong bg-panel shadow-2xl shadow-black/70 sm:inset-y-3 sm:right-3 sm:w-[540px] sm:rounded-3xl sm:border"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 px-5">
          <div className="flex items-center gap-3">
            <Logo size={30} />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-[-0.02em]">Ask Strike</div>
              <div className="text-[11.5px] text-faint">Reads your account and the live market. Cannot place orders.</div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {turns.length > 0 && !busy && (
              <button aria-label="New conversation" title="New conversation" onClick={() => setTurns([])} className="grid size-8 place-items-center !rounded-full text-muted transition-colors hover:bg-hover hover:text-fg">
                <SquarePen size={15} />
              </button>
            )}
            <button aria-label="Close" onClick={onClose} className="grid size-8 place-items-center !rounded-full text-muted transition-colors hover:bg-hover hover:text-fg">
              <X size={16} />
            </button>
          </div>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-5 pb-4">
          {!turns.length ? (
            <div className="flex min-h-full flex-col justify-center py-6">
              <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.035em]">What do you want to trade?</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                Ask for a play, a second opinion on a position, or a read on any stock. Answers come as one exact order with the odds and the most you
                can lose.
              </p>
              {context.length > 0 && (
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {context.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-raised px-3 py-2.5">
                      <div className="text-[11px] text-faint">{label}</div>
                      <div className="num mt-0.5 text-[14px] font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(({ icon: Icon, title, text }) => (
                  <button key={title} onClick={() => send(text)} className="group !rounded-2xl border border-line p-3.5 text-left transition-colors hover:border-line-strong hover:bg-hover">
                    <Icon size={15} className="text-muted transition-colors group-hover:text-fg" />
                    <div className="mt-2.5 text-[13px] font-medium">{title}</div>
                    <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-faint">{text}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pt-2">
              {turns.map((t, i) => {
                if (t.role === "user")
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-raised px-4 py-2.5 text-[13.5px] leading-relaxed">{t.content}</div>
                    </div>
                  );
                const live = busy && i === turns.length - 1;
                const tools = [...new Set(t.tools ?? [])];
                return (
                  <div key={i} className="text-[13.5px] leading-relaxed text-fg/90">
                    {tools.length > 0 &&
                      (t.content ? (
                        <div className="mb-2.5 text-[11.5px] text-faint">Checked: {tools.map((x) => x.replace(/^(Reading|Checking|Running|Scanning|Sizing) /, "")).join(" · ")}</div>
                      ) : (
                        <ul className="mb-2.5 space-y-1.5 text-[12.5px]">
                          {tools.map((x, n) => {
                            const current = live && n === tools.length - 1;
                            return (
                              <li key={x} className={clsx("flex items-center gap-2", current ? "text-fg" : "text-faint")}>
                                {current ? <span className="pulse-dot size-1.5 rounded-full bg-accent" /> : <Check size={12} className="text-up" />}
                                {x}
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                    {t.content ? (
                      <Rich text={t.content} />
                    ) : (
                      live &&
                      !t.error && (
                        <span className="typing" aria-label="Working">
                          <span />
                          <span />
                          <span />
                        </span>
                      )
                    )}
                    {t.error && <p className="mt-2 rounded-xl bg-down/10 px-3 py-2 text-[12.5px] text-down">{t.error}</p>}
                    {t.content && !live && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                        {t.model && <span>{t.model}</span>}
                        <CopyButton text={t.content} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form
          className="shrink-0 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-3xl border border-line-strong bg-raised/60 py-2 pl-4 pr-2 transition-colors focus-within:border-faint">
            <textarea
              ref={box}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about a trade, a ticker or your positions"
              aria-label="Message"
              className="max-h-40 min-h-[28px] flex-1 resize-none !rounded-none bg-transparent py-1 text-[14px] leading-relaxed placeholder:text-faint focus:outline-none"
            />
            {busy ? (
              <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()} className="grid size-8 shrink-0 place-items-center !rounded-full bg-fg text-bg">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim()}
                className={clsx("grid size-8 shrink-0 place-items-center !rounded-full transition-colors", input.trim() ? "bg-fg text-bg" : "bg-line-strong text-faint")}
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-faint">Enter to send · Shift+Enter for a new line · Not financial advice</p>
        </form>
      </motion.aside>
    </motion.div>
  );
}
