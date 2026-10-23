"use client";

import { useState } from "react";
import { KINDS, emptyCounts, type Counts, type History } from "@/lib/contributions";
import type { GuestModel } from "@/lib/guest-room";

type Row = { id: string; name: string; full: string; color?: string; counts: Counts };

const back = KINDS.filter((kind) => !kind.forward);
const forward = KINDS.filter((kind) => kind.forward);
const total = (counts: Counts, kinds: readonly (typeof KINDS)[number][]) =>
  kinds.reduce((sum, kind) => sum + counts[kind.id], 0);

/**
 * A diverging bar per voice: turns that held the room back (repeats, the obvious) grow left of
 * the centre line, turns that moved it forward (new ideas, clarifications, added value) grow
 * right. Counts sit on the bars and a table view carries the same numbers.
 */
export default function ContributionMap({
  seats,
  counts,
  history,
  judge,
}: {
  seats: GuestModel[];
  counts: Map<string, Counts>;
  history: History;
  judge: GuestModel;
}) {
  const [scope, setScope] = useState<"this" | "all">("this");
  const rows: Row[] =
    scope === "this"
      ? seats.map((seat) => ({
          id: seat.id,
          name: seat.nickname ?? seat.label,
          full: seat.label,
          color: seat.color,
          counts: counts.get(seat.id) ?? emptyCounts(),
        }))
      : Object.entries(history.models).map(([id, model]) => ({
          id,
          name: seats.find((seat) => seat.id === id)?.nickname ?? model.label,
          full: model.label,
          color: seats.find((seat) => seat.id === id)?.color,
          counts: model.counts,
        }));
  const reach = Math.max(1, ...rows.flatMap((row) => [total(row.counts, back), total(row.counts, forward)]));
  const width = (n: number) => `${(n / reach) * 100}%`;

  return (
    <section className="contribution-map" aria-labelledby="contribution-title">
      <div className="contribution-head">
        <h3 id="contribution-title">How each voice moved the room</h3>
        <div className="contribution-scope" role="group" aria-label="Which discussions">
          <button aria-pressed={scope === "this"} onClick={() => setScope("this")} type="button">
            This discussion
          </button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")} type="button">
            All your discussions ({history.runs.length})
          </button>
        </div>
      </div>

      <ul className="contribution-legend" aria-label="Legend">
        {KINDS.map((kind) => (
          <li key={kind.id}>
            <span className="swatch" style={{ background: kind.color }} aria-hidden="true" />
            {kind.label}
          </li>
        ))}
      </ul>

      <div className="contribution-axis" aria-hidden="true">
        <span>← held the room back</span>
        <span>moved it forward →</span>
      </div>

      <ul className="contribution-rows">
        {rows.map((row) => (
          <li key={row.id} className="contribution-row">
            <span className="contribution-name" title={row.full}>
              <span className="dot" style={{ background: row.color ?? "var(--muted)" }} aria-hidden="true" />
              {row.name}
            </span>
            <span className="contribution-bar">
              <span className="half back">
                {[...back].reverse().map((kind) =>
                  row.counts[kind.id] ? (
                    <span
                      className="segment"
                      key={kind.id}
                      style={{ width: width(row.counts[kind.id]), background: kind.color, color: kind.ink }}
                      title={`${row.name}: ${row.counts[kind.id]} × ${kind.label}`}
                    >
                      {row.counts[kind.id]}
                    </span>
                  ) : null,
                )}
              </span>
              <span className="half forward">
                {forward.map((kind) =>
                  row.counts[kind.id] ? (
                    <span
                      className="segment"
                      key={kind.id}
                      style={{ width: width(row.counts[kind.id]), background: kind.color, color: kind.ink }}
                      title={`${row.name}: ${row.counts[kind.id]} × ${kind.label}`}
                    >
                      {row.counts[kind.id]}
                    </span>
                  ) : null,
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <details className="contribution-table">
        <summary>See as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Voice</th>
              {KINDS.map((kind) => (
                <th key={kind.id} scope="col">
                  {kind.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                {KINDS.map((kind) => (
                  <td key={kind.id}>{row.counts[kind.id]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="contribution-note">
        Judged by {judge.label}, which wasn&apos;t in the room, so no one grades their own turns. A judge can be
        wrong; read the turns themselves for the full picture.
      </p>
    </section>
  );
}
