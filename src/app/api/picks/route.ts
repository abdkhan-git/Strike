import type { NextRequest } from "next/server";
import { contractOf, provider } from "@/lib/market";
import { latestBriefing, runBriefing } from "@/lib/picks";
import { trackView } from "@/lib/track";

export const dynamic = "force-dynamic";

/** The latest briefing with each pick's live price and return since it was picked, plus the track record. */
export async function GET() {
  try {
    const [briefing, track] = await Promise.all([latestBriefing(), trackView()]);
    let live: Record<string, { mark: number; ret: number; spot: number }> = {};
    if (briefing?.picks.length) {
      const symbols = briefing.picks.map((p) => p.symbol);
      const quotes = await provider().quotes(symbols).catch(() => ({}) as Record<string, { price: number }>);
      const rows = await Promise.all(
        briefing.picks.map(async (p) => {
          const spot = quotes[p.symbol]?.price;
          const c = spot ? await contractOf(p.symbol, p.contract.expiration, p.contract.occ, spot) : undefined;
          const entry = p.contract.ask || p.contract.mid;
          return c && c.mid > 0 && spot ? ([p.symbol, { mark: c.mid, ret: c.mid / entry - 1, spot }] as const) : undefined;
        }),
      );
      live = Object.fromEntries(rows.filter((r) => r !== undefined));
    }
    return Response.json({ briefing, live, track });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load picks" }, { status: 502 });
  }
}

/** `?action=run` builds today's picks now instead of waiting for 9:45 ET. */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("action") !== "run") return Response.json({ error: "Unknown action" }, { status: 400 });
  try {
    const { briefing } = await runBriefing();
    return Response.json({ briefing });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build picks" }, { status: 502 });
  }
}
