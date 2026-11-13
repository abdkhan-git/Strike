import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, appOrigin, authEnabled, randomToken, safeNext, sha256 } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Starts Google sign-in: authorization-code flow with PKCE and a one-time state value. */
export async function GET(req: NextRequest) {
  if (!authEnabled()) return NextResponse.redirect(new URL("/", req.url));
  const origin = appOrigin(req.url);
  const state = randomToken(16);
  const verifier = randomToken(32);
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: OAUTH_COOKIE,
    value: JSON.stringify({ state, verifier, next }),
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
