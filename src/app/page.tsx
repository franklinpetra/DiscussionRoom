import Link from "next/link";
import { hasSupabasePublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const configured = hasSupabasePublicConfig();

  return (
    <main className="landing shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          The Room<span> by Tandem Works</span>
        </Link>
        <Link className="quiet-link" href="/login">
          Sign in
        </Link>
      </header>

      <section className="hero">
        <p className="eyebrow">A place for questions worth discussing</p>
        <h1>Some questions deserve a room.</h1>
        <p className="lead">
          Independent AI perspectives, a thoughtful exchange, and a takeaway
          that keeps the useful disagreement intact.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/room">
            Start a guest session
          </Link>
          <Link className="text-link" href="/login">Sign in</Link>
          <a
            className="text-link"
            href="https://roomofmodels.site"
            rel="noreferrer"
            target="_blank"
          >
            Try the private browser demo
          </a>
        </div>
      </section>

      <section className="principles" aria-label="How The Room works">
        <article>
          <span className="step">01</span>
          <h2>Start independently</h2>
          <p>Each participant forms an initial view without seeing the others.</p>
        </article>
        <article>
          <span className="step">02</span>
          <h2>Let the ideas meet</h2>
          <p>Useful challenge, evidence, and revision—not disagreement for show.</p>
        </article>
        <article>
          <span className="step">03</span>
          <h2>Keep what matters</h2>
          <p>A clear synthesis and a complete, inspectable conversation.</p>
        </article>
      </section>

      {!configured && (
        <section id="setup" className="setup-note" aria-labelledby="setup-title">
          <h2 id="setup-title">Hosted workspace foundation</h2>
          <p>
            Guest sessions are available now. Configure Supabase Auth to enable
            account access and workspace features. The browser demo remains
            separate and keeps its own BYOK privacy model.
          </p>
        </section>
      )}

      <footer className="site-footer">
        <span>Private workspaces. User-controlled conversation history.</span>
        <span>Built for discussions that add value.</span>
      </footer>
    </main>
  );
}
