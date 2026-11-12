import { withNotes } from "@/lib/insights";
import { scan } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(withNotes(await scan()));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Scan failed" }, { status: 502 });
  }
}
