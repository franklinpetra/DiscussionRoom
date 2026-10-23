import Link from "next/link";

/**
 * The arrival: a taste of each room, with example questions that open the room ready to run.
 * The Discussion is a lively spoken conversation; Verity is a board of advisors that leaves
 * you with a decision brief.
 */

const DISCUSSION_EXAMPLES = [
  "Is the real purpose of story to carry life-saving knowledge in a form people will actually hear?",
  "As we lose privacy, what are we quietly gaining, and how do we tell watching that protects us from watching that preys on us?",
  "Why do we cry at movies about people who never existed?",
];

const VERITY_EXAMPLES = [
  "What in this lease should worry me before I sign it?",
  "Should we accept this term sheet, or keep growing on our own revenue for another year?",
  "What would it take for data centers in space to make economic sense, and when?",
];

const COMING = [
  { name: "Popcorn", line: "Fast and fun: one line each, every line sparked by the last, then the room picks the one nobody saw coming." },
  { name: "The Clock", line: "Thinkers of every kind, from visual to musical to business, improvising an idea into existence." },
  { name: "The Podcast", line: "Two hosts talk through your documents, and you can jump in." },
];

// A taste of The Discussion: who sits where, and how a few turns sound.
const CHAIRS = [
  { chair: "b", angle: 90, color: "#b0592a" },
  { chair: "a", angle: 90, color: "#1f7a64" },
  { chair: "d", angle: 0, color: "#6b7f1f" },
  { chair: "g", angle: 270, color: "#3a5fb0" },
  { chair: "e", angle: 270, color: "#6a4fb3" },
];

const TASTE = [
  { who: "Mini", color: "#6b7f1f", line: "A story is a warning that people will actually sit still for." },
  { who: "Gemini", color: "#3a5fb0", line: "…and remember forty years later, when the river rises." },
  { who: "Claude", color: "#b0592a", line: "Here's the strange part: the most useful stories are rarely true." },
];

export default function Arrival() {
  return (
    <main className="shell arrival">
      <header className="masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <nav className="header-nav" aria-label="Rooms">
          <Link className="header-link" href="/room">The Discussion</Link>
          <a className="header-link" href="/verity">Verity</a>
        </nav>
      </header>

      <section className="arrival-hero">
        <h1>Pull up a chair.</h1>
        <p>
          AI models from different companies think together, out loud or around your documents, so you
          leave with more than you came with.
        </p>
      </section>

      <div className="arrival-rooms">
        <article className="room-door" aria-labelledby="door-discussion">
          <div className="room-door-taste" aria-hidden="true">
            <div className="taste-chairs">
              {CHAIRS.map(({ chair, angle, color }, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  key={i}
                  src={`/chairs/chair-${chair}-${angle}.webp`}
                  style={{ ["--seat-color" as string]: color }}
                />
              ))}
            </div>
            <ul className="taste-lines">
              {TASTE.map(({ who, color, line }) => (
                <li key={who} style={{ ["--seat-color" as string]: color }}>
                  <strong>{who}</strong> {line}
                </li>
              ))}
            </ul>
            <p className="taste-note">An example of how it sounds</p>
          </div>
          <div className="room-door-body">
            <p className="eyebrow">A conversation, out loud</p>
            <h2 id="door-discussion">The Discussion</h2>
            <p>
              Five models answer on their own, then talk it through in short turns: hands go up, someone
              breaks in, and you can join. For questions worth exploring. About five minutes, with voices.
            </p>
            <p className="door-try">Try one:</p>
            <ul className="door-examples">
              {DISCUSSION_EXAMPLES.map((question) => (
                <li key={question}>
                  <Link href={{ pathname: "/room", query: { q: question } }}>{question}</Link>
                </li>
              ))}
            </ul>
            <Link className="button" href="/room">Enter The Discussion</Link>
          </div>
        </article>

        <article className="room-door" aria-labelledby="door-verity">
          <div className="room-door-taste" aria-hidden="true">
            <div className="taste-brief">
              <p className="brief-kicker">Decision brief · example</p>
              <p className="brief-rec">
                <strong>Recommendation</strong> Negotiate before signing: cap the annual increase and drop the
                personal guarantee. <span className="brief-count">4 of 5 advisors</span>
              </p>
              <p>
                <strong>Where the board splits</strong> Whether the renewal option is worth paying for.
              </p>
              <p className="brief-quote">
                <span className="check" title="Found on the cited page">✓</span> &ldquo;Tenant shall be personally
                liable…&rdquo; <small>lease.pdf, p. 7</small>
              </p>
              <p>
                <strong>Before you decide</strong> Ask who pays for roof repairs; the lease doesn&apos;t say.
              </p>
            </div>
          </div>
          <div className="room-door-body">
            <p className="eyebrow">A board of advisors, quietly</p>
            <h2 id="door-verity">Verity</h2>
            <p>
              Drop in a contract, a report or a big decision. Five advisors from five companies read it, answer
              alone, debate once, and hand you a brief you can act on, with every quote checked against your
              documents. No audio, fewer rounds.
            </p>
            <p className="door-try">Try one:</p>
            <ul className="door-examples">
              {VERITY_EXAMPLES.map((question) => (
                <li key={question}>
                  <a href={`/verity?q=${encodeURIComponent(question)}`}>{question}</a>
                </li>
              ))}
            </ul>
            <a className="button" href="/verity">Enter Verity</a>
          </div>
        </article>
      </div>

      <section className="arrival-coming" aria-labelledby="coming-title">
        <h2 id="coming-title">More rooms on the way</h2>
        <ul>
          {COMING.map(({ name, line }) => (
            <li key={name}>
              <strong>{name}</strong> {line}
            </li>
          ))}
        </ul>
      </section>

      <footer className="arrival-footer">
        <p>
          Every room runs on your own OpenRouter key, held in your browser. Documents are read in your browser,
          and only the requests to the models leave it. Made by Tandem Works.
        </p>
      </footer>
    </main>
  );
}
