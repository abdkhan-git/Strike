"use client";

import clsx from "clsx";
import { ArrowUp, Square, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string; tools?: string[]; error?: string; model?: string };

const KEY = "strike.chat";
const SUGGESTIONS = [
  "I have $2,000. Quick SPY play for the rest of today to make a couple hundred.",
  "What should I do with my open positions right now?",
  "Best high-risk, high-reward play this week?",
  "Is NVDA a buy or a sell for tomorrow?",
];

/** **bold**, bullet lines and paragraphs; everything else is plain text. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={blocks.length} className="space-y-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[8px] size-[3px] shrink-0 bg-muted" />
            <span>{inline(b)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) bullets.push(m[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

/** Slide-over chat with the trading assistant. History is kept in this browser only. */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved));
    } catch {}
    box.current?.focus();
  }, []);

  useEffect(() => {
    try {
      if (!busy) localStorage.setItem(KEY, JSON.stringify(turns.slice(-30)));
    } catch {}
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

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
          const e = JSON.parse(buf.slice(0, i));
          buf = buf.slice(i + 1);
          if (e.t === "text") patch((t) => ({ ...t, content: t.content + e.v }));
          else if (e.t === "tool") patch((t) => ({ ...t, tools: [...(t.tools ?? []), e.v] }));
          else if (e.t === "model") patch((t) => ({ ...t, model: e.v }));
          else if (e.t === "error") patch((t) => ({ ...t, error: e.v }));
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patch((t) => ({ ...t, error: e instanceof Error ? e.message : "Request failed" }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <aside className="rise flex h-full w-full max-w-[520px] flex-col border-l border-line-strong bg-panel shadow-2xl shadow-black/60">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <div>
            <div className="text-[13.5px] font-semibold">Ask Strike</div>
            <div className="text-[11px] text-faint">Live data from your account, quotes, chains, flow and news. It can&apos;t place orders.</div>
          </div>
          <div className="flex items-center gap-1">
            {turns.length > 0 && !busy && (
              <button aria-label="Clear conversation" onClick={() => setTurns([])} className="grid size-7 place-items-center text-muted hover:bg-raised hover:text-fg">
                <Trash2 size={14} />
              </button>
            )}
            <button aria-label="Close" onClick={onClose} className="grid size-7 place-items-center text-muted hover:bg-raised hover:text-fg">
              <X size={15} />
            </button>
          </div>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
          {!turns.length && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-muted">Ask for a play, a second opinion on a position, or what a stock is doing. Answers come as exact orders.</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="block w-full border border-line-strong px-3 py-2 text-left text-[12.5px] text-muted transition-colors hover:border-muted hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="ml-10 border border-line-strong bg-raised px-3 py-2 text-[13px]">
                {t.content}
              </div>
            ) : (
              <div key={i} className="text-[13px] leading-relaxed text-fg/90">
                {!!t.tools?.length && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {[...new Set(t.tools)].map((x) => (
                      <span key={x} className="cap border border-line px-1.5 py-0.5">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
                {t.content ? (
                  <Rich text={t.content} />
                ) : (
                  busy && i === turns.length - 1 && !t.error && <span className="pulse-dot text-muted">Working…</span>
                )}
                {t.error && <p className="mt-2 text-[12.5px] text-down">{t.error}</p>}
                {t.model && t.content && <p className="mt-2 text-[10.5px] text-faint">Answered by {t.model}</p>}
              </div>
            ),
          )}
        </div>

        <form
          className="shrink-0 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="flex items-end gap-2 border border-line-strong px-3 py-2 focus-within:border-muted">
            <textarea
              ref={box}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="e.g. I have $2,000 for SPY until tomorrow. Best call or put?"
              aria-label="Message"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent text-[13px] placeholder:text-faint focus:outline-none"
            />
            {busy ? (
              <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()} className="grid size-7 place-items-center border border-line-strong text-muted hover:text-fg">
                <Square size={12} />
              </button>
            ) : (
              <button type="submit" aria-label="Send" disabled={!input.trim()} className={clsx("grid size-7 place-items-center", input.trim() ? "bg-fg text-bg" : "border border-line-strong text-faint")}>
                <ArrowUp size={14} />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">Free Gemini models first, paid Gemini next, Claude only if none can answer · Enter to send, Shift+Enter for a new line</p>
        </form>
      </aside>
    </div>
  );
}
