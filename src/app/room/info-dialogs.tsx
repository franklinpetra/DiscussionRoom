"use client";

import { useRef } from "react";

/** "How it works" and "Where your data goes", for the room they sit in. */
export default function InfoDialogs({ room }: { room: "discussion" | "clock" }) {
  const howRef = useRef<HTMLDialogElement>(null);
  const dataRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="header-link" onClick={() => howRef.current?.showModal()} type="button">
        How it works
      </button>
      <button className="header-link" onClick={() => dataRef.current?.showModal()} type="button">
        Where your data goes
      </button>

      {room === "discussion" ? (
        <dialog aria-labelledby="how-title" className="room-dialog room-dialog-wide" ref={howRef}>
          <h2 id="how-title">How the room works</h2>
          <p>
            One question goes to the models you seat. They answer alone, talk once, and then one
            of them writes the takeaway. Every step below is one request per seated model, made
            from this browser tab.
          </p>
          <h3>1 · Independent. Round one is blind.</h3>
          <p>
            No model is told that anyone else is answering, or who. Nobody postures, defers to
            whoever seems stronger on the topic, or leaves a gap for someone else to fill. Each
            looks for the most consequential insight it can defend, in about three sentences.
          </p>
          <h3>2 · The conversation.</h3>
          <p>
            The room is introduced here, together with the other answers. Each model challenges,
            connects, or revises in one short, substantive exchange. If it has nothing to add, it
            says so instead of repeating itself.
          </p>
          <h3>3 · Synthesis, then parting thoughts.</h3>
          <p>
            The synthesis job rotates so every seat takes a turn, unless a model asks for it. The
            synthesizer gets fresh context and the whole record. It leads with what the room
            discovered, not a recap, and does not average anyone into blandness. If the
            conclusion isn&apos;t ready, it can ask for one more exchange. Then each of the other
            models may add one parting line, like a footnote, or pass.
          </p>
          <h3>Each model keeps its own conversation.</h3>
          <p>
            A seat&apos;s memory is its own turns plus what it was shown. It never sees its own
            answer played back as if someone else had said it, and never sees a round it missed.
          </p>
          <h3>A cut-off answer is a failure, not a short answer.</h3>
          <p>
            It is marked failed and never passed to the others as a position. If a model drops
            out, the room says who is missing and carries on with the rest.
          </p>
          <p className="dialog-note">
            With five seated, a run is about fifteen requests (three per model), billed to you by
            OpenRouter. Attached documents are read by every model in each of its turns, so large
            files raise the cost. Unseat anyone you don&apos;t want in the room.
          </p>
          <div className="dialog-actions">
            <span />
            <button className="button" onClick={() => howRef.current?.close()} type="button">Close</button>
          </div>
        </dialog>
      ) : (
        <dialog aria-labelledby="how-title" className="room-dialog room-dialog-wide" ref={howRef}>
          <h2 id="how-title">How the Clock works</h2>
          <p>
            You describe a project and seat the makers it needs. Each seat is a model with one job, and
            every step is a request made from this browser tab.
          </p>
          <h3>1 · Once around the face, in stages.</h3>
          <p>
            Thinkers go first (the real need, what already exists, the people, play). Then the
            shapers: the steps, the data, the look, and then the interface, built from all of them.
            Makers and change-makers follow, and testers try what was made. Seats in a stage work at
            once; every later seat reads what the earlier ones made.
          </p>
          <h3>2 · Some seats make things you can use.</h3>
          <p>
            Interface builds a prototype you can click through and Data builds a page that shows the
            facts in their most meaningful form. Both run in a sealed frame that can&apos;t reach this
            page or your key. Look paints an image with a palette, and Sound composes a short theme.
          </p>
          <h3>3 · Then you steer.</h3>
          <p>
            Write to any seat by name, such as &ldquo;Interface, make it one screen&rdquo;, and it
            redoes its part with everything the room has made so far.
          </p>
          <p className="dialog-note">
            A run is one request per seated maker, billed to you by OpenRouter. The prototype and data
            pages use a stronger model and cost the most; a typical run is well under a dollar.
          </p>
          <div className="dialog-actions">
            <span />
            <button className="button" onClick={() => howRef.current?.close()} type="button">Close</button>
          </div>
        </dialog>
      )}

      <dialog aria-labelledby="data-title" className="room-dialog room-dialog-wide" ref={dataRef}>
        <h2 id="data-title">Where your data goes</h2>
        <p>Four claims, and what makes each one true rather than promised.</p>
        <h3>Your question goes straight to OpenRouter.</h3>
        <p>
          The Room&apos;s server delivers this page and handles optional sign-in. A guest
          discussion never passes through it. Your browser sends the question, the answers and
          your key directly to <code>openrouter.ai</code>. The page&apos;s security policy only
          allows connections to OpenRouter and our sign-in service.
        </p>
        <h3>Files are read in your browser.</h3>
        <p>
          When you attach a document, this tab extracts its text. That text goes to OpenRouter
          with your question; the file itself is never uploaded to The Room.
        </p>
        <h3>Your key stays with you.</h3>
        <p>
          It lives in this tab&apos;s memory, or in this browser&apos;s storage if you tick the
          box. It is attached only to requests to <code>openrouter.ai</code>. Downloads and
          reports are built here in the page and saved straight to your disk.
        </p>
        <h3>Requests require zero-data-retention routes.</h3>
        <p>
          Each request asks OpenRouter for providers that keep no copy of it. If a seated model
          is unavailable, OpenRouter may answer with GLM-5.3 Flash under the same rule, and the
          transcript names the model that actually answered.
          {room === "clock" &&
            " One exception in the Clock: the music model that writes Sound's theme has no such route, so it is sent only the project's description and your slant."}
        </p>
        <p className="dialog-note">
          What OpenRouter and the model vendors do with a request is between you and them. It
          is an ordinary API call, and their policies apply.
        </p>
        <div className="dialog-actions">
          <span />
          <button className="button" onClick={() => dataRef.current?.close()} type="button">Close</button>
        </div>
      </dialog>
    </>
  );
}
