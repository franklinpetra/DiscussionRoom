"use client";

import { useState } from "react";
import { modelLabel, type GuestModel, type GuestTurn } from "@/lib/guest-room";
import {
  SCORE_PARTS,
  TAPS,
  scoreParts,
  summarize,
  type ScoreHistory,
  type Scorecard,
  type TapId,
} from "@/lib/scorecard";

const SOUND_LABEL = { solid: "Holds up", mostly: "Mostly holds up", shaky: "Shaky in places" } as const;

/**
 * How the room did, in four questions: did it beat one model alone, what did it find together,
 * does it hold up (all from a judge outside the room), and did it change the person's mind
 * (their own tap). The first three make a score out of 10; the tap is the person's own record.
 */
export default function RoomScorecard({
  seats,
  judge,
  judging,
  scorecard,
  solo,
  tap,
  onTap,
  history,
}: {
  seats: GuestModel[];
  judge: GuestModel;
  judging: "pending" | "done" | "failed";
  scorecard?: Scorecard;
  solo?: GuestTurn;
  tap: TapId | null;
  onTap: (tap: TapId) => void;
  history: ScoreHistory;
}) {
  const [scope, setScope] = useState<"this" | "all">("this");
  const nameOf = (id?: string) => {
    const seat = seats.find((item) => item.id === id);
    return seat ? (seat.nickname ?? seat.label) : (history.sparks[id ?? ""]?.label ?? "");
  };
  const soloName = solo ? modelLabel(solo) : "one model";
  const parts = scorecard ? scoreParts(scorecard) : null;
  const all = summarize(history);

  return (
    <section className="scorecard" aria-labelledby="scorecard-title">
      <div className="contribution-head">
        <h3 id="scorecard-title">How the room did</h3>
        {!!history.runs.length && (
          <div className="contribution-scope" role="group" aria-label="Which discussions">
            <button aria-pressed={scope === "this"} onClick={() => setScope("this")} type="button">
              This discussion
            </button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")} type="button">
              All your discussions ({history.runs.length})
            </button>
          </div>
        )}
      </div>

      {scope === "all" ? (
        <div className="scorecard-all">
          <p className="scorecard-score">
            <strong>{all.count ? all.averageScore.toFixed(1) : "–"}</strong>
            <span> / 10 on average, over {all.count} scored {all.count === 1 ? "discussion" : "discussions"}</span>
          </p>
          <ul className="scorecard-facts">
            <li>
              The room beat one model alone in <strong>{all.roomWins}</strong> of {all.count}
              {all.ties ? `, and tied in ${all.ties}` : ""}.
            </li>
            <li>
              It found <strong>{all.discoveries}</strong> {all.discoveries === 1 ? "thing" : "things"} together
              that no opening answer had.
            </li>
            <li>
              Your answers:{" "}
              {TAPS.map((item, i) => (
                <span key={item.id}>
                  {i ? " · " : ""}
                  {item.label.toLowerCase()} <strong>{all.taps[item.id]}</strong>
                </span>
              ))}
            </li>
          </ul>
          {!!Object.keys(history.sparks).length && (
            <p className="scorecard-sparks">
              Who sparked the discoveries:{" "}
              {Object.entries(history.sparks)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([id, item]) => `${nameOf(id) || item.label} ${item.count}`)
                .join(" · ")}
            </p>
          )}
        </div>
      ) : (
        <>
          {judging === "pending" && <p className="scorecard-wait">The judge is reading the discussion…</p>}
          {judging === "failed" && (
            <p className="scorecard-wait">
              The judge couldn&apos;t score this discussion this time. Your own answer below still counts.
            </p>
          )}
          {scorecard && parts && (
            <>
              <p className="scorecard-score">
                <strong>{scorecard.score}</strong>
                <span> / 10</span>
              </p>
              <ol className="scorecard-questions">
                <li>
                  <h4>
                    Did the room beat one model alone?
                    <span className="scorecard-points">
                      {parts.better} of {SCORE_PARTS.better}
                    </span>
                  </h4>
                  <p>
                    {scorecard.better === "room"
                      ? `Yes. The room's answer was stronger than ${soloName} answering on its own.`
                      : scorecard.better === "tie"
                        ? `A tie. ${soloName} on its own did about as well as the room.`
                        : `No. ${soloName} on its own gave the stronger answer this time.`}{" "}
                    {scorecard.betterWhy && <span className="scorecard-why">{scorecard.betterWhy}</span>}
                  </p>
                  {solo && (
                    <details>
                      <summary>Read what {soloName} said alone</summary>
                      <p>{solo.text}</p>
                    </details>
                  )}
                </li>
                <li>
                  <h4>
                    What did the room find together?
                    <span className="scorecard-points">
                      {parts.discoveries} of {SCORE_PARTS.discoveries}
                    </span>
                  </h4>
                  {scorecard.discoveries.length ? (
                    <ul>
                      {scorecard.discoveries.map((item, i) => (
                        <li key={i}>
                          {item.point}
                          {item.seatId && <span className="scorecard-why"> Sparked by {nameOf(item.seatId)}.</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nothing that wasn&apos;t already in the opening answers.</p>
                  )}
                </li>
                <li>
                  <h4>
                    Does it hold up?
                    <span className="scorecard-points">
                      {parts.sound} of {SCORE_PARTS.sound}
                    </span>
                  </h4>
                  <p>
                    {SOUND_LABEL[scorecard.sound]}.{" "}
                    {scorecard.soundWhy && <span className="scorecard-why">{scorecard.soundWhy}</span>}
                  </p>
                  {!!scorecard.checks.length && (
                    <>
                      <p className="scorecard-why">Worth checking:</p>
                      <ul>
                        {scorecard.checks.map((check, i) => (
                          <li key={i}>{check}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              </ol>
            </>
          )}

          <div className="scorecard-tap">
            <h4>Did it change your mind?</h4>
            <div className="scorecard-tap-buttons" role="group" aria-label="Did it change your mind?">
              {TAPS.map((item) => (
                <button aria-pressed={tap === item.id} key={item.id} onClick={() => onTap(item.id)} type="button">
                  {item.label}
                </button>
              ))}
            </div>
            {tap && <p className="scorecard-why">Thank you. Your answer is kept in this browser with your other discussions.</p>}
          </div>
        </>
      )}

      <p className="contribution-note">
        Judged by {judge.label} from outside the room, without being told which model said what. It compared the
        room&apos;s final answer with {soloName} answering alone, in random order. It can&apos;t browse, and a judge can
        be wrong: your answer is the one that matters most.
      </p>
    </section>
  );
}
