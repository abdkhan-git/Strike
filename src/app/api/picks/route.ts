import type { NextRequest } from "next/server";
import { contractOf, provider } from "@/lib/market";
import { readTheses } from "@/lib/store";
import { analyze } from "@/lib/thesis";
import { latestBriefing, runBriefing } from "@/lib/picks";
import { trackView } from "@/lib/track";
import type { Enriched, Verdict } from "@/lib/types";
import { verdictOf } from "@/lib/verdict";

export const dynamic = "force-dynamic";

export type PickLive = { mark: number; ret: number; spot: number; verdict?: Verdict; contract: Enriched };

/**
 * The latest picks with each one's live price, return since it was picked, and the call
 * the position engine would make right now if you had bought it at the pick price.
 */
export async function GET() {
  try {
    const [briefing, track] = await Promise.all([latestBriefing(), trackView()]);
    let live: Record<string, PickLive> = {};
    if (briefing?.picks.length) {
      const symbols = briefing.picks.map((p) => p.symbol);
      const p = provider();
      const [quotes, universe, theses] = await Promise.all([
        p.quotes(symbols).catch(() => ({}) as Record<string, { price: number }>),
        p.universe().catch(() => []),
        readTheses(),
      ]);
      const rows = await Promise.all(
        briefing.picks.map(async (pick) => {
          const spot = quotes[pick.symbol]?.price;
          const c = spot ? await contractOf(pick.symbol, pick.contract.expiration, pick.contract.occ, spot) : undefined;
          if (!c || !(c.mid > 0) || !spot) return undefined;
          const entry = pick.contract.ask || pick.contract.mid;
          const analysis = await analyze(pick.symbol).catch(() => undefined);
          const verdict = verdictOf(
            {
              id: `pick:${pick.symbol}`,
              occ: pick.contract.occ,
              underlying: pick.symbol,
              type: pick.contract.type,
              strike: pick.contract.strike,
              expiration: pick.contract.expiration,
              qty: pick.qty,
              entryPrice: entry,
              entryAt: briefing.at,
              status: "open",
            },
            c,
            spot,
            {
              analysis,
              thesis: theses.find((t) => t.occ === pick.contract.occ),
              catalyst: universe.find((u) => u.symbol === pick.symbol)?.catalyst,
            },
          );
          return [pick.symbol, { mark: c.mid, ret: c.mid / entry - 1, spot, verdict, contract: c }] as const;
        }),
      );
      live = Object.fromEntries(rows.filter((r) => r !== undefined));
    }
    return Response.json({ briefing, live, track });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load picks" }, { status: 502 });
  }
}

/** `?action=run` re-ranks today's picks now. */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("action") !== "run") return Response.json({ error: "Unknown action" }, { status: 400 });
  try {
    const { briefing } = await runBriefing();
    return Response.json({ briefing });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build picks" }, { status: 502 });
  }
}
