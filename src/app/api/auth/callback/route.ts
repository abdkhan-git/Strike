import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, appOrigin, authEnabled, safeNext, sessionCookie, signSession } from "@/lib/auth";
import { admitUser } from "@/lib/users";

export const dynamic = "force-dynamic";

type IdClaims = { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

/** Google sends the browser back here with a one-time code, which is exchanged for the account's identity. */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.url);
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return res;
  };
  if (!authEnabled()) return NextResponse.redirect(`${origin}/`);

  let saved: { state?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value ?? "{}");
  } catch {}
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return fail("Sign-in was cancelled.");
  const code = p.get("code");
  if (!code || !saved.state || !saved.verifier || p.get("state") !== saved.state) return fail("That sign-in link expired. Try again.");

  let claims: IdClaims;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${origin}/api/auth/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { id_token?: string };
    if (!res.ok || !json.id_token) return fail("Google did not confirm the sign-in.");
    // The token comes straight from Google over TLS in exchange for our client secret, so its
    // claims are trusted as received (OpenID Connect Core 3.1.3.7); they are still checked.
    claims = JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return fail("Could not reach Google. Try again.");
  }

  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || !(claims.exp && claims.exp > Date.now() / 1000) || !claims.sub || !claims.email)
    return fail("Google's reply could not be verified.");
  if (!claims.email_verified) return fail("That Google account's email is not verified.");

  const user = { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name || claims.email, picture: claims.picture };
  const admitted = await admitUser(user);
  if (!admitted) return fail(`${user.email} does not have access to this Strike.`);

  const res = NextResponse.redirect(`${origin}${safeNext(saved.next)}`);
  res.cookies.set(sessionCookie(await signSession(user), origin.startsWith("https://")));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  return res;
}
