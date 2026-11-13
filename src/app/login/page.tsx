import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { authEnabled, safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const enabled = authEnabled();
  const href = `/api/auth/google?next=${encodeURIComponent(safeNext(next))}`;

  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <div className="rise w-full max-w-[380px] text-center">
        <Logo size={52} className="mx-auto" />
        <h1 className="mt-6 text-[28px] font-semibold tracking-[-0.035em]">Sign in to Strike</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">Your scanner, picks, plan and trade log, kept behind your Google account.</p>

        {error && (
          <p role="alert" className="mt-5 rounded-xl bg-down/10 px-4 py-3 text-[13px] text-down">
            {error.slice(0, 200)}
          </p>
        )}

        {enabled ? (
          <a
            href={href}
            className="mt-7 flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-fg text-[14px] font-medium text-bg transition-opacity hover:opacity-85"
          >
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </a>
        ) : (
          <div className="mt-7 rounded-xl border border-line bg-panel px-5 py-4 text-left text-[13px] leading-relaxed text-muted">
            <div className="font-medium text-fg">Sign-in is not set up yet</div>
            Add <code className="font-mono text-[12px] text-fg">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-[12px] text-fg">GOOGLE_CLIENT_SECRET</code> to <code className="font-mono text-[12px] text-fg">.env.local</code>, then
            restart. Until then Strike is open to anyone who can reach this machine.
            <a href="/" className="mt-3 block font-medium text-fg underline underline-offset-4">
              Open Strike
            </a>
          </div>
        )}

        <p className="mt-6 text-[12px] leading-relaxed text-faint">
          Strike only reads your name, email and photo from Google. It cannot place trades: the brokerage link is read-only.
        </p>
      </div>
    </div>
  );
}
