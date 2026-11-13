import { paperView } from "@/lib/paper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await paperView());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load the paper lab" }, { status: 502 });
  }
}
