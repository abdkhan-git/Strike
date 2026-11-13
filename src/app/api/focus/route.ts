import { focusList } from "@/lib/focus";

export const dynamic = "force-dynamic";

/** Ones to watch on its own: the live list the Brief shows, with any error reported rather than hidden. */
export async function GET() {
  try {
    return Response.json(await focusList());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build the list" }, { status: 502 });
  }
}
