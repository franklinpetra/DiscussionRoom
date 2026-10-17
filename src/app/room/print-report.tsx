import { modelLabel, type GuestRun, type GuestTurn } from "@/lib/guest-room";
import { reportDate, reportId } from "@/lib/report";

function color(turn: GuestTurn) {
  return (turn.servedModel ?? turn.model).color ?? "#555";
}

/** Rendered only when printing; the browser's "Save as PDF" produces the shareable report. */
export default function PrintReport({ run }: { run: GuestRun }) {
  return (
    <article className="print-report" aria-hidden="true">
      <header>
        <p className="print-kicker">The Room · {reportDate(run.createdAt)}</p>
        <h1>{run.question}</h1>
        {!!run.attachments.length && (
          <p className="print-attached">
            Attached: {run.attachments.map((item) => item.name).join(", ")}
          </p>
        )}
      </header>

      {run.synthesis && (
        <section className="print-synthesis">
          <p>{run.synthesis.text}</p>
          <small>Synthesis by {modelLabel(run.synthesis)}</small>
        </section>
      )}

      {!!run.contributions.length && (
        <section className="print-contributions">
          <h2>Parting thoughts from inside the room</h2>
          <ol>
            {run.contributions.map((turn) => (
              <li key={turn.model.id} style={{ borderColor: color(turn) }}>
                <strong style={{ color: color(turn) }}>{modelLabel(turn)}</strong> {turn.text}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="print-transcript">
        <h2>The complete conversation</h2>
        <div className="print-columns">
          {run.rounds.map((round, index) => (
            <div key={`${round.name}-${index}`}>
              <h3>{round.name}</h3>
              {round.turns.map((turn) => (
                <div className="print-turn" key={turn.model.id} style={{ borderColor: color(turn) }}>
                  <strong style={{ color: color(turn) }}>{modelLabel(turn)}</strong>
                  <p>{turn.text}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <footer className="print-footer">{reportId(run.createdAt)} · theroom.click</footer>
    </article>
  );
}
