"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { modelLabel, type GuestRun, type GuestTurn } from "@/lib/guest-room";
import { reportDate, reportId } from "@/lib/report";

function color(turn: GuestTurn) {
  return (turn.servedModel ?? turn.model).color ?? "#555";
}

const noop = () => () => {};

/**
 * Rendered only when printing; the browser's "Save as PDF" produces the shareable report.
 * It lives directly under <body> so printing can hide the page and let the report flow
 * across as many pages as it needs.
 */
export default function PrintReport({ run }: { run: GuestRun }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
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
          {!!run.synthesis.sources?.length && <p className="print-sources">Sources: {run.synthesis.sources.join(" · ")}</p>}
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
              {round.turns.map((turn, turnIndex) => (
                <div className="print-turn" key={turn.id ?? `${turn.model.id}-${turnIndex}`} style={{ borderColor: color(turn) }}>
                  <strong style={{ color: color(turn) }}>
                    {modelLabel(turn)}
                    {turn.kind === "interjection" ? " (breaks in)" : turn.kind === "person" ? " (joins in)" : ""}
                  </strong>
                  <p>{turn.text}</p>
                  {!!turn.sources?.length && <p className="print-sources">Sources: {turn.sources.join(" · ")}</p>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <footer className="print-footer">{reportId(run.createdAt)} · thediscussion.app</footer>
    </article>,
    document.body,
  );
}
