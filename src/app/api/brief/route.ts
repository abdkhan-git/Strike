import { buildBrief } from "@/lib/brief";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await buildBrief());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build the brief" }, { status: 502 });
  }
}
