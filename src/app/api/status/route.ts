import { provider } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(provider().info);
}
