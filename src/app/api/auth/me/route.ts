import { cookies } from "next/headers";
import { SESSION_COOKIE, authEnabled, readSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Who is signed in, and whether sign-in is switched on at all. */
export async function GET() {
  const enabled = authEnabled();
  const user = enabled ? await readSession((await cookies()).get(SESSION_COOKIE)?.value) : undefined;
  return Response.json({ enabled, user: user ?? null });
}
