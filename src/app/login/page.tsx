import Link from "next/link";
import { signIn, signUp } from "@/app/auth/actions";
import { getSiteOrigin, hasSupabasePublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  "invalid-input": "Check the form fields and password length, then try again.",
  "sign-in-failed": "We couldn't sign you in with those details.",
  "sign-up-failed": "We couldn't create the account. The address may already be registered.",
  "sign-out-failed": "We couldn't end the session. Please try again.",
  "callback-failed": "That sign-in link is invalid or expired. Please request a new one.",
  "not-configured": "Hosted sign-in is not available until Supabase is configured.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;
  const configured = hasSupabasePublicConfig();
  const signupConfigured = configured && getSiteOrigin() !== null;
  const error = params.error ? errors[params.error] : undefined;

  return (
    <main className="auth-shell">
      <Link className="wordmark" href="/">
        The Room
      </Link>
      <section className="auth-panel" aria-labelledby="login-title">
        <p className="eyebrow">Your private workspace</p>
        <h1 id="login-title">Come into the room.</h1>
        <p className="muted">
          Sign in or create an account to start a workspace. Conversations are
          private to workspace members.
        </p>

        {!configured && (
          <p className="note" role="status">
            Supabase is not configured yet. Set the hosted app&apos;s public
            Supabase URL and publishable key to enable account access.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {params.message === "check-email" && (
          <section className="form-success email-confirmation" role="status" aria-live="polite">
            <h2>Almost there — check your email</h2>
            <p>
              We sent you a confirmation link. Open it to verify your address
              and enter The Room. If it isn&apos;t in your inbox, check your
              spam or promotions folder.
            </p>
          </section>
        )}

        <form action={signIn} className="form-stack">
          <label className="field">
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label className="field">
            Password
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </label>
          <button className="button" disabled={!configured} type="submit">
            Sign in
          </button>
        </form>

        <details className="signup-details">
          <summary>Create a new account</summary>
          <p className="muted">
            After creating your account, check your email and open the
            confirmation link to enter The Room.
          </p>
          <form action={signUp} className="form-stack">
            <label className="field">
              Name
              <input autoComplete="name" maxLength={80} name="displayName" required />
            </label>
            <label className="field">
              Email
              <input autoComplete="email" name="email" required type="email" />
            </label>
            <label className="field">
              Password (at least 12 characters)
              <input
                autoComplete="new-password"
                minLength={12}
                name="password"
                required
                type="password"
              />
            </label>
            <button className="button" disabled={!signupConfigured} type="submit">
              Create account
            </button>
          </form>
        </details>

        <p className="form-links">
          <Link href="/">Back to The Room</Link>
          <span>Existing private demo remains separate.</span>
        </p>
      </section>
    </main>
  );
}
