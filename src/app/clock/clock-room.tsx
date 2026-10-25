"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import KeyControl, { type KeyControlHandle } from "@/app/room/key-control";
import type { GuestModel } from "@/lib/guest-room";
import { sourceHref, sourceLabel } from "@/lib/report";
import {
  addressee,
  askSeat,
  buildMusicPrompt,
  buildSeatPrompt,
  GROUPS,
  KITS,
  MAX_SEATED,
  SEATS,
  seatById,
  stagesOf,
  type ClockSeat,
  type Making,
  type Slant,
} from "@/lib/clock";

const FEELS = ["crisp", "balanced", "warm"];
const SPIRITS = ["calm", "curious", "playful"];

type Entry = { from: "person"; text: string } | { from: "seat"; making: Making };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The request failed.";
}

/** A seat's line drawing, by seat. */
function SeatIcon({ id }: { id: string }) {
  const paths: Record<string, ReactNode> = {
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />,
    scout: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.5c2.8.3 5 2.6 5 5.5" /></>,
    play: <><path d="M6 12h4M8 10v4" /><circle cx="15" cy="11" r="1" /><circle cx="17" cy="13" r="1" /><path d="M7 6h10a4 4 0 0 1 4 4v3a4 4 0 0 1-7 2.6L13 14h-2l-1 1.6A4 4 0 0 1 3 13v-3a4 4 0 0 1 4-4z" /></>,
    flow: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M6 8l5 8M18 8l-5 8" /></>,
    look: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8.5-9-8.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7" r="1" /></>,
    data: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    interface: <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 8h16M9 13h6M9 16h4" />,
    voice: <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
    sound: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
    film: <path d="M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 11l5-3v8l-5-3" />,
    economist: <path d="M12 3v18M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5s2.2 2.9 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3" />,
    reach: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
    measure: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    ethics: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" />,
    testers: <path d="M5 4l6 15 2.5-6.5L20 10z" />,
  };
  return (
    <svg aria-hidden="true" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="24">
      {paths[id]}
    </svg>
  );
}

function Sources({ sources }: { sources: string[] }) {
  return (
    <p className="clock-sources">
      Sources:{" "}
      {sources.map((address, i) => (
        <span key={address}>
          {i > 0 && " · "}
          <a href={sourceHref(address)} rel="noreferrer" target="_blank">{sourceLabel(address)}</a>
        </span>
      ))}
    </p>
  );
}

/** A page a seat built, in a sealed frame: its scripts run, but it can't reach this page or your key. */
function PageFrame({ html, title }: { html: string; title: string }) {
  function openFull() {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return (
    <div className="clock-page">
      <iframe sandbox="allow-scripts" srcDoc={html} title={title} />
      <button className="quiet-link" onClick={openFull} type="button">Open full size</button>
    </div>
  );
}

export default function ClockRoom() {
  const [apiKey, setApiKey] = useState("");
  const [seated, setSeated] = useState<string[]>([...KITS[0].seats]);
  const [brief, setBrief] = useState("");
  const [slant, setSlant] = useState<Slant>({ feel: "balanced", spirit: "curious", forWhom: "" });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [working, setWorking] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const keyRef = useRef<KeyControlHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, working]);

  const onFace = SEATS.filter((seat) => seated.includes(seat.id));
  const bench = SEATS.filter((seat) => !seated.includes(seat.id));
  const makings = entries.flatMap((entry) => (entry.from === "seat" ? [entry.making] : []));
  // The latest page, picture or theme from each seat, for the gallery.
  const made = useMemo(() => {
    const latest = new Map<string, Making>();
    for (const making of makings) if (making.html || making.image || making.audio) latest.set(making.seatId, making);
    return [...latest.values()];
  }, [makings]);
  const cost = makings.reduce((sum, making) => sum + (making.usage?.cost ?? 0), 0);
  // The key check tests the models that write; the painter and composer are checked when they work.
  const keyModels: GuestModel[] = [...new Map(onFace.filter((seat) => seat.kind === "text" || seat.kind === "page").map((seat) => [seat.model, { id: seat.model, label: seat.name, vendor: seat.model.split("/")[0] }])).values()];
  const pointing = onFace.findIndex((seat) => working.includes(seat.id));
  // Straight up before the clock starts; to each working seat in turn; a full lap once it's done.
  const handAngle = 180 + (pointing >= 0 ? (360 / Math.max(onFace.length, 1)) * pointing : started && !running ? 360 : 0);

  function toggle(id: string) {
    if (running) return;
    setSeated((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX_SEATED ? current : [...current, id],
    );
  }

  async function runSeat(seat: ClockSeat, sofar: Making[], signal: AbortSignal, note?: string): Promise<Making> {
    try {
      const messages =
        seat.kind === "music"
          ? [{ role: "user" as const, content: buildMusicPrompt(brief, slant) }]
          : buildSeatPrompt(seat, brief, slant, sofar, note);
      const result = await askSeat(apiKey, seat, messages, signal);
      return { seatId: seat.id, ...result, ...(note ? { note } : {}) };
    } catch (seatError) {
      return { seatId: seat.id, text: "", error: errorText(seatError), ...(note ? { note } : {}) };
    }
  }

  async function start() {
    if (!apiKey.trim()) {
      setError("Add your OpenRouter key first (top right). It stays in this browser.");
      keyRef.current?.open();
      return;
    }
    if (brief.trim().length < 5 || !seated.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setStarted(true);
    setRunning(true);
    setEntries([{ from: "person", text: brief.trim() }]);
    const sofar: Making[] = [];
    try {
      for (const stage of stagesOf(seated)) {
        if (controller.signal.aborted) break;
        setWorking(stage.map((seat) => seat.id));
        const results = await Promise.all(stage.map((seat) => runSeat(seat, sofar, controller.signal)));
        if (controller.signal.aborted) break;
        sofar.push(...results);
        setEntries((current) => [...current, ...results.map((making) => ({ from: "seat" as const, making }))]);
      }
    } finally {
      setWorking([]);
      setRunning(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || running) return;
    const seat = addressee(text, seated);
    setDraft("");
    setEntries((current) => [...current, { from: "person", text }]);
    if (!seat) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setWorking([seat.id]);
    const answer = await runSeat(seat, makings, controller.signal, text);
    setWorking([]);
    setRunning(false);
    if (!controller.signal.aborted) setEntries((current) => [...current, { from: "seat", making: answer }]);
  }

  function reset() {
    controllerRef.current?.abort();
    setEntries([]);
    setStarted(false);
    setWorking([]);
    setRunning(false);
  }

  return (
    <div className="clock-room">
      <header className="masthead room-masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <nav className="header-nav" aria-label="Rooms and key">
          <Link className="header-link" href="/room">The Discussion</Link>
          <a className="header-link" href="/verity">Verity</a>
          <KeyControl apiKey={apiKey} models={keyModels} onChange={setApiKey} ref={keyRef} />
        </nav>
      </header>

      <section className="clock-intro">
        <p className="eyebrow">The Clock · new and experimental</p>
        <h1>What shall we make?</h1>
        <p>
          Tell the clock about your project, then seat the makers you need. The hand goes once around the face:
          thinkers first, then shapers, makers and testers, each building on the last, until it&apos;s something you
          can try.
        </p>
      </section>

      <div className="clock-kits" role="group" aria-label="Start from a kit">
        <span>Start from a kit:</span>
        {KITS.map((kit) => (
          <button
            aria-pressed={kit.seats.length === seated.length && kit.seats.every((id) => seated.includes(id))}
            className="clock-pill"
            disabled={running}
            key={kit.id}
            onClick={() => setSeated([...kit.seats])}
            type="button"
          >
            {kit.name}
          </button>
        ))}
      </div>

      <div className="clock-face">
        <div aria-hidden="true" className="clock-dial" />
        <div aria-hidden="true" className="clock-dial inner" />
        <div aria-hidden="true" className="clock-hand" style={{ transform: `rotate(${handAngle}deg)` }} />

        <ul aria-label="Seated makers" className="clock-ring">
          {onFace.map((seat, i) => {
            const angle = (2 * Math.PI * i) / onFace.length;
            const color = GROUPS[seat.group].color;
            return (
              <li
                className="clock-seat"
                data-working={working.includes(seat.id) || undefined}
                key={seat.id}
                style={{ left: `${50 + 44 * Math.sin(angle)}%`, top: `${50 - 44 * Math.cos(angle)}%` }}
              >
                <button
                  aria-label={`${seat.name}: ${seat.job}. Unseat`}
                  disabled={running}
                  onClick={() => toggle(seat.id)}
                  title={seat.privacyNote ?? `${seat.job} · ${seat.model}`}
                  type="button"
                >
                  <span className="clock-disc" style={{ background: color }}>
                    <SeatIcon id={seat.id} />
                  </span>
                  <span className="clock-seat-name">{seat.name}</span>
                  <span className="clock-seat-job">{seat.job}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="clock-center">
          {!started ? (
            <div className="clock-brief">
              <label htmlFor="clock-brief">The project</label>
              <textarea
                id="clock-brief"
                onChange={(event) => setBrief(event.target.value)}
                placeholder="An app, a product, a campaign, a party, a way to show the facts… What is it, and who is it for?"
                value={brief}
              />
              <p>
                {seated.length} of {MAX_SEATED} seats filled. Tap a seat on the clock to unseat it, or add one from the
                bench below.
              </p>
              {error && <p className="clock-error">{error}</p>}
              <button className="button" disabled={brief.trim().length < 5 || !seated.length} onClick={start} type="button">
                Start the clock
              </button>
            </div>
          ) : (
            <div className="clock-chat">
              <div className="clock-chat-bar">
                <p className="eyebrow">
                  {working.length
                    ? `${working.map((id) => seatById(id)?.name).join(", ")} ${working.length === 1 && working[0] !== "testers" ? "is" : "are"} working…`
                    : "Once around the clock"}
                </p>
                {running ? (
                  <button className="quiet-link" onClick={() => controllerRef.current?.abort()} type="button">Stop</button>
                ) : (
                  <button className="quiet-link" onClick={reset} type="button">New project</button>
                )}
              </div>
              <div aria-live="polite" className="clock-log" ref={logRef}>
                {entries.map((entry, i) =>
                  entry.from === "person" ? (
                    <div className="clock-msg mine" key={i}>
                      <strong>You</strong>
                      <p>{entry.text}</p>
                    </div>
                  ) : (
                    <SeatMessage key={i} making={entry.making} />
                  ),
                )}
              </div>
              <form
                className="clock-send"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="visually-hidden" htmlFor="clock-draft">Ask or steer a seat</label>
                <input
                  disabled={running}
                  id="clock-draft"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Steer a seat by name: “Interface, make it one screen”"
                  value={draft}
                />
                <button className="button" disabled={running || !draft.trim()} type="submit">Send</button>
              </form>
            </div>
          )}
        </div>
      </div>

      {!!bench.length && (
        <section aria-labelledby="bench-title" className="clock-bench">
          <h2 id="bench-title">The bench</h2>
          <ul>
            {bench.map((seat) => (
              <li key={seat.id}>
                <button
                  disabled={running || seated.length >= MAX_SEATED}
                  onClick={() => toggle(seat.id)}
                  title={seat.privacyNote ?? seat.model}
                  type="button"
                >
                  <span className="clock-chip-dot" style={{ background: GROUPS[seat.group].color }} />
                  {seat.name} <small>{seat.job}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!made.length && (
        <section aria-labelledby="made-title" className="clock-made">
          <h2 id="made-title">What the room made</h2>
          <div className="clock-made-grid">
            {made.map((making) => {
              const seat = seatById(making.seatId)!;
              return (
                <article className="clock-tile" data-kind={seat.kind} key={making.seatId}>
                  <h3 style={{ color: GROUPS[seat.group].color }}>{seat.name}</h3>
                  {making.html && <PageFrame html={making.html} title={`${seat.name}: what it built`} />}
                  {making.image && (
                    // A generated data URL, so the image optimizer has nothing to do.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={`${seat.name}'s image for the project`} src={making.image} />
                  )}
                  {!!making.palette?.length && (
                    <ul aria-label="Palette" className="clock-palette">
                      {making.palette.map((hex) => (
                        <li key={hex} style={{ background: hex }} title={hex}><span className="visually-hidden">{hex}</span></li>
                      ))}
                    </ul>
                  )}
                  {making.audio && <audio controls src={making.audio} />}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="slant-title" className="clock-slant">
        <h2 id="slant-title">The human slant</h2>
        <p>Every seat works to this.</p>
        <div className="clock-slant-grid">
          <div role="group" aria-label="Feel">
            <span>Feel</span>
            {FEELS.map((feel) => (
              <button aria-pressed={slant.feel === feel} className="clock-pill" disabled={running} key={feel} onClick={() => setSlant({ ...slant, feel })} type="button">
                {feel}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Spirit">
            <span>Spirit</span>
            {SPIRITS.map((spirit) => (
              <button aria-pressed={slant.spirit === spirit} className="clock-pill" disabled={running} key={spirit} onClick={() => setSlant({ ...slant, spirit })} type="button">
                {spirit}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="clock-for">Made for</label>
            <input
              disabled={running}
              id="clock-for"
              onChange={(event) => setSlant({ ...slant, forWhom: event.target.value })}
              placeholder="A tired nurse on a night shift…"
              value={slant.forWhom}
            />
          </div>
        </div>
      </section>

      <ul aria-label="Kinds of seat" className="clock-legend">
        {Object.values(GROUPS).map((group) => (
          <li key={group.name}>
            <span style={{ background: group.color }} />
            <strong>{group.name}</strong> · {group.about}
          </li>
        ))}
      </ul>

      {started && (
        <p className="clock-cost">
          About ${cost.toFixed(3)} so far on your key{makings.some((m) => m.seatId === "sound") ? ", plus about $0.04 for the theme" : ""}.
          Pages built by the room run sealed off from this page and your key.
        </p>
      )}
    </div>
  );
}

function SeatMessage({ making }: { making: Making }) {
  const seat = seatById(making.seatId)!;
  const color = GROUPS[seat.group].color;
  return (
    <div className="clock-msg" data-error={making.error ? true : undefined}>
      <strong style={{ color }}>{seat.name}</strong>
      {making.error ? (
        <p>Couldn&apos;t finish this time: {making.error}</p>
      ) : (
        <>
          {making.text && <p>{making.text}</p>}
          {(making.html || making.image || making.audio) && (
            <p className="clock-made-note">
              {making.html ? "Built a page you can click" : making.image ? "Made an image" : "Composed a theme"}: see What the room made, below.
            </p>
          )}
          {!!making.sources?.length && <Sources sources={making.sources} />}
        </>
      )}
    </div>
  );
}
