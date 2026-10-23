"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { parseTurnMarkers, PERSON, type GuestModel, type Hand, type LiveTurn } from "@/lib/guest-room";
import {
  attentionPoint,
  facingAngle,
  pickVoices,
  readingMilliseconds,
  SEAT_PITCH,
  seatPositions,
  splitSentences,
  type PlayItem,
} from "@/lib/room-scene";
import { requestSpeech, seatVoice, sentenceAt, SPEECH_PRICE_PER_CHARACTER } from "@/lib/speech-audio";

type VoiceMode = "natural" | "browser" | "captions";

/** idle: chairs around the question box · writing: the blind round · interlude: a breath · speaking: the room talks. */
export type ScenePhase = "idle" | "writing" | "interlude" | "speaking";

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
// Petra's hands: every chair gets its own. Three-quarter and tilted views face in from the
// right side of the room; palms forward sit on the left. Pointing fingers are for breaking in.
const RIGHT_HANDS = ["f-three-quarter-right", "m-three-quarter-right", "f-palm-slight-tilt", "m-palm-tilt"];
const LEFT_HANDS = ["f-palm-forward", "m-palm-forward", "m-palm-curved", "f-palm-tilt"];
const POINTING_HANDS = ["f-point", "m-point"];
const handSrc = (name: string) => `/hands/set/${name}.webp`;

/** A breath between speakers, the way a real table pauses before the next voice. */
const PAUSE_BETWEEN_SPEAKERS_MS = 1000;
/** A speaker finishing someone else's sentence slides straight in. */
const SLIDE_IN_MS = 150;
const slidesIn = (text?: string) => /^\s*(…|\.\.\.|—)/.test(text ?? "");
const RATES = [0.8, 1, 1.25, 1.5, 2];

type RoomSceneProps = {
  apiKey: string;
  seats: GuestModel[];
  items: PlayItem[];
  live: LiveTurn[];
  finished: boolean;
  phase: ScenePhase;
  question?: string;
  /** What sits in the middle of the room before a question is asked: the question box. */
  children?: ReactNode;
  stageRef?: Ref<HTMLDivElement>;
  /** Hands raised after each conversation turn, keyed by playlist key. */
  hands?: Record<string, Hand[]>;
  /** The "Join in" box, shown under the controls while the room is talking. */
  join?: ReactNode;
  /** Called with the characters sent for natural speech, so the cost line can include voices. */
  onSpeech?: (characters: number) => void;
};

function synth() {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export default function RoomScene({
  apiKey,
  seats,
  items,
  live,
  finished,
  phase,
  question,
  children,
  stageRef,
  hands,
  join,
  onSpeech,
}: RoomSceneProps) {
  const [index, setIndex] = useState(0);
  const [sentence, setSentence] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<VoiceMode>(apiKey ? "natural" : "browser");
  const [naturalError, setNaturalError] = useState("");
  const [notice, setNotice] = useState("");
  const [rate, setRate] = useState(1);
  // How long the current turn's natural-voice recording lasts, so captions can match it exactly.
  const [audioSeconds, setAudioSeconds] = useState<{ key: string; seconds: number } | null>(null);
  const [pausing, setPausing] = useState(false);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rateRef = useRef(rate);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef(new Map<string, Promise<string>>());
  const roomMode: VoiceMode = mode === "natural" && (naturalError || !apiKey) ? "browser" : mode;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);

  const positions = useMemo(() => seatPositions(seats.length), [seats.length]);
  // Each seat's own raised hand and pointing hand, so no two chairs share a raised hand.
  const seatHands = useMemo(() => {
    let left = 0;
    let right = 0;
    return positions.map((position, i) => ({
      raise: position.x > 0 ? RIGHT_HANDS[right++ % RIGHT_HANDS.length] : LEFT_HANDS[left++ % LEFT_HANDS.length],
      point: POINTING_HANDS[i % POINTING_HANDS.length],
    }));
  }, [positions]);
  const seatIndex = useMemo(() => new Map(seats.map((seat, i) => [seat.id, i])), [seats]);
  const seatVoices = useMemo(() => pickVoices(voices, seats.length), [voices, seats.length]);
  const current = items[index] ?? null;
  const currentKey = current?.key;
  const currentText = current?.text ?? "";
  // The person's own words are shown, not spoken back to them.
  const effectiveMode: VoiceMode = current?.seat.id === PERSON.id ? "captions" : roomMode;
  const sentences = useMemo(() => (currentText ? splitSentences(currentText) : []), [currentText]);
  // Someone broke in: the speaker stops after this many sentences.
  const spokenCount = current?.cutAt != null ? Math.min(current.cutAt + 1, sentences.length) : sentences.length;
  const spokenCountRef = useRef(spokenCount);
  const caption = sentences[sentence] ?? "";
  const speakerSeat = current ? seatIndex.get(current.seat.id) ?? -1 : -1;
  const done = finished && index >= items.length;
  const active = playing && phase === "speaking" && !pausing;

  /** Moves to the next speaker after a one-second pause, or at once when they slide in. */
  const nextText = items[index + 1]?.text;
  const nextSpeaker = useCallback(() => {
    clearTimeout(pauseTimer.current);
    setPausing(true);
    pauseTimer.current = setTimeout(
      () => {
        setPausing(false);
        setIndex((value) => value + 1);
        setSentence(0);
      },
      slidesIn(nextText) ? SLIDE_IN_MS : PAUSE_BETWEEN_SPEAKERS_MS,
    );
  }, [nextText]);

  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  useEffect(() => {
    const engine = synth();
    if (!engine) return;
    const update = () => setVoices(engine.getVoices());
    engine.addEventListener("voiceschanged", update);
    return () => engine.removeEventListener("voiceschanged", update);
  }, []);

  useEffect(() => {
    for (const seat of seats) {
      for (const angle of ANGLES) new Image().src = `/chairs/chair-${seat.chair ?? "a"}-${angle}.webp`;
    }
    for (const hand of [...RIGHT_HANDS, ...LEFT_HANDS, ...POINTING_HANDS]) new Image().src = handSrc(hand);
  }, [seats]);

  const getAudio = useCallback(
    (key: string, text: string, seat: number) => {
      let pending = audioCache.current.get(key);
      if (!pending) {
        onSpeech?.(text.length);
        pending = requestSpeech(apiKey, text, seatVoice(seat)).then((blob) => URL.createObjectURL(blob));
        audioCache.current.set(key, pending);
        pending.catch(() => audioCache.current.delete(key));
      }
      return pending;
    },
    [apiKey, onSpeech],
  );

  useEffect(() => {
    rateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // Fetch the current and next turn's audio ahead, so speakers follow each other without gaps.
  useEffect(() => {
    if (roomMode !== "natural" || phase === "idle" || phase === "writing") return;
    for (const upcoming of items.slice(index, index + 2)) {
      if (upcoming.seat.id === PERSON.id) continue;
      getAudio(upcoming.key, upcoming.text, seatIndex.get(upcoming.seat.id) ?? 0).catch(() => {});
    }
  }, [roomMode, items, index, getAudio, seatIndex, phase]);

  useEffect(() => {
    spokenCountRef.current = spokenCount;
  }, [spokenCount]);

  useEffect(() => {
    if (!active || !currentKey || effectiveMode !== "natural") return;
    let cancelled = false;
    getAudio(currentKey, currentText, Math.max(speakerSeat, 0))
      .then((url) => {
        if (cancelled) return;
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          if (!cancelled && Number.isFinite(audio.duration)) setAudioSeconds({ key: currentKey, seconds: audio.duration });
        };
        audioRef.current = audio;
        audio.playbackRate = rateRef.current;
        audio.ontimeupdate = () => {
          if (!audio.duration) return;
          const at = sentenceAt(sentences, audio.currentTime / audio.duration);
          // Someone broke in: the voice stops at the end of the sentence they cut in after.
          if (at >= spokenCountRef.current) {
            audio.pause();
            audio.ontimeupdate = null;
            if (!cancelled) nextSpeaker();
            return;
          }
          setSentence(at);
        };
        audio.onended = () => {
          if (cancelled) return;
          nextSpeaker();
        };
        audio.play().then(
          () => setNotice(""),
          (error: unknown) => {
            if (cancelled) return;
            if (error instanceof DOMException && error.name === "NotAllowedError") {
              setPlaying(false);
              setNotice("Your browser paused the audio. Press Play to hear the room.");
            } else {
              setNaturalError("This browser couldn't play the audio.");
            }
          },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setNaturalError(error instanceof Error ? error.message : "Speech request failed.");
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [active, currentKey, currentText, speakerSeat, effectiveMode, sentences, getAudio, nextSpeaker]);

  useEffect(() => {
    const cache = audioCache.current;
    return () => {
      for (const pending of cache.values()) pending.then((url) => URL.revokeObjectURL(url), () => {});
    };
  }, []);

  useEffect(() => {
    if (!active || !currentKey || effectiveMode === "natural") return;
    let cancelled = false;
    const advance = () => {
      if (cancelled) return;
      if (sentence + 1 < spokenCount) setSentence(sentence + 1);
      else nextSpeaker();
    };
    const engine = synth();
    const readingTime = readingMilliseconds(caption, rate);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (effectiveMode === "browser" && engine && voices.length) {
      const startedAt = performance.now();
      // If speech fails or ends implausibly fast (blocked audio, missing voice), keep the
      // caption up for a normal reading time instead of racing through the conversation.
      const finish = () => {
        if (cancelled) return;
        const remaining = readingTime * 0.4 - (performance.now() - startedAt);
        if (remaining > 0) timer = setTimeout(advance, remaining);
        else advance();
      };
      const utterance = new SpeechSynthesisUtterance(caption);
      const voice = seatVoices[speakerSeat] ?? null;
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.pitch = SEAT_PITCH[speakerSeat % SEAT_PITCH.length] ?? 1;
      utterance.onend = finish;
      utterance.onerror = () => {
        if (cancelled) return;
        timer = setTimeout(advance, readingTime);
      };
      engine.speak(utterance);
      return () => {
        cancelled = true;
        clearTimeout(timer);
        engine.cancel();
      };
    }
    timer = setTimeout(advance, readingTime);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, currentKey, sentence, spokenCount, caption, effectiveMode, rate, seatVoices, speakerSeat, voices.length, nextSpeaker]);

  useEffect(() => () => synth()?.cancel(), []);

  function jump(to: number) {
    clearTimeout(pauseTimer.current);
    setPausing(false);
    setIndex(Math.max(0, Math.min(to, items.length)));
    setSentence(0);
  }

  const spokenCharacters = items.reduce((total, item) => total + item.text.length, 0);
  const learned = items.slice(0, index).filter((item) => item.stage !== "Parting thoughts").slice(-6);
  const liveStatus = new Map(live.map((turn) => [turn.model.id, turn.status]));

  const speaking = phase === "speaking";
  const shownSpeaker = speaking ? speakerSeat : -1;
  // Each sentence drifts across the rug for as long as it takes to say: the recording's own
  // length for natural voices (its share of the turn), or an unhurried estimate otherwise.
  const voiced = effectiveMode === "natural" && audioSeconds?.key === currentKey;
  const captionMs = Math.round(
    voiced
      ? Math.max(1800, ((audioSeconds!.seconds * 1000) / rate) * (caption.length / Math.max(1, currentText.length)))
      : Math.max(2600, readingMilliseconds(caption, rate) * 1.4),
  );
  // Hands go up while the speaker is still talking: listeners decided after hearing this turn.
  // At most two show at once, the way a real table looks: an interruption first, then the
  // earliest hands.
  const heard = speaking && current && (sentence >= 1 || spokenCount <= 1) ? (hands?.[current.key] ?? []) : [];
  const raisedHands = [...heard.filter((hand) => hand.kind === "break"), ...heard.filter((hand) => hand.kind === "hand")].slice(0, 2);
  const handOf = new Map(raisedHands.map((hand) => [hand.model.id, hand]));
  const stageLabel = (item: NonNullable<typeof current>) =>
    item.kind === "interjection"
      ? "breaking in"
      : item.kind === "reply"
        ? "answering"
        : item.kind === "person"
          ? "joining in"
          : item.stage;
  // The blind round, readable as it arrives: live text while writing, finished answers during the pause.
  const blindCards: LiveTurn[] =
    phase === "writing"
      ? live
      : phase === "interlude"
        ? items
            .filter((item) => item.stage === "Independent")
            .map((item) => ({ model: item.seat, text: item.text, status: "complete" as const }))
        : [];

  return (
    <section className="room-scene" data-phase={phase} aria-label="The room">
      <div className="room-stage" ref={stageRef}>
        <div className="scene-rug" aria-hidden="true" />
        {seats.map((seat, i) => {
          const position = positions[i];
          const isSpeaker = i === shownSpeaker;
          const speaker = shownSpeaker >= 0 ? positions[shownSpeaker] : null;
          const angle = facingAngle(position, attentionPoint(position, speaker, isSpeaker));
          const depth = (position.z + 1) / 2;
          const status = liveStatus.get(seat.id);
          // Listeners lean a little toward whoever is speaking.
          const lean = speaker && !isSpeaker ? Math.sign(speaker.x - position.x) * 5 : 0;
          return (
            <div
              className="scene-seat"
              data-row={position.z < -0.4 ? "back" : "front"}
              data-speaking={isSpeaker}
              data-state={status ?? "idle"}
              key={seat.id}
              style={{
                ["--oval-left" as string]: `calc(50% + ${position.x.toFixed(3)} * var(--seat-spread))`,
                ["--oval-top" as string]: `calc(var(--seat-top) + ${position.z.toFixed(3)} * var(--seat-depth))`,
                // Narrow screens: an even row across the top instead of the oval.
                ["--row-left" as string]: `${((i + 0.5) / seats.length) * 100}%`,
                ["--row-top" as string]: `${88 + Math.abs(i - (seats.length - 1) / 2) * 6}px`,
                zIndex: Math.round(depth * 10) + 1,
                ["--seat-scale" as string]: 0.82 + depth * 0.24,
                ["--seat-color" as string]: seat.color ?? "#777",
              }}
            >
              <span className="seat-glow" aria-hidden="true" />
              {/* All eight views are stacked; the one facing the right way fades in, so chairs turn smoothly. */}
              <span className="seat-chair-stack" style={{ ["--lean" as string]: `${lean}px` }}>
                {ANGLES.map((view) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="seat-chair"
                    data-visible={view === angle}
                    draggable={false}
                    key={view}
                    src={`/chairs/chair-${seat.chair ?? "a"}-${view}.webp`}
                  />
                ))}
              </span>
              <span className="seat-name" title={seat.label}>{seat.nickname ?? seat.label}</span>
              {handOf.has(seat.id) && (
                <span className="seat-hand" data-kind={handOf.get(seat.id)!.kind} title={handOf.get(seat.id)!.reason}>
                  {/* Petra's hands: this seat's own raised hand, or its pointing finger for breaking in. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={handOf.get(seat.id)!.kind === "break" ? "Breaking in" : "Hand raised"}
                    className="seat-hand-img"
                    draggable={false}
                    src={handSrc(handOf.get(seat.id)!.kind === "break" ? seatHands[i].point : seatHands[i].raise)}
                  />
                  <small>{handOf.get(seat.id)!.reason}</small>
                </span>
              )}
            </div>
          );
        })}

        {phase !== "idle" && question && <p className="stage-question">{question}</p>}

        <div className="stage-center">
          {phase === "idle" && children}
          {phase === "writing" && (
            <div className="stage-message stage-message-compact">
              <strong>Round one is blind.</strong>
              <span>Each model is answering on its own. None of them knows anyone else is in the room.</span>
            </div>
          )}
          {phase === "interlude" && (
            <div className="stage-message stage-message-compact">
              <strong>Everyone has answered.</strong>
              <span>Now they&apos;re reading one another and getting ready to talk it through.</span>
            </div>
          )}
          {!!blindCards.length && (
            <div className="blind-cards" data-phase={phase}>
              {blindCards.map((card) => {
                const text = parseTurnMarkers(card.text).text;
                return (
                  <article
                    className="blind-card"
                    data-state={card.status}
                    key={card.model.id}
                    style={{ ["--seat-color" as string]: card.model.color ?? "#777" }}
                  >
                    <header>
                      <strong title={card.model.label}>{card.model.nickname ?? card.model.label}</strong>
                      <span>
                        {card.status === "thinking"
                          ? "Thinking…"
                          : card.status === "answering"
                            ? "Writing"
                            : card.status === "complete"
                              ? "Done"
                              : card.status === "stopped"
                                ? "Stopped"
                                : "Couldn't answer"}
                      </span>
                    </header>
                    <div className="blind-card-body">
                      <p>{text || (card.status === "thinking" ? "" : card.error ?? "")}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {speaking && current && (
            <p className="scene-phrase" key={current.key} style={{ color: current.seat.color }}>
              {current.phrase}
            </p>
          )}
          {speaking && current && caption && (
            // The words drift across the rug as they're spoken, a few at a time.
            <p
              aria-hidden="true"
              className="rug-caption"
              key={`${current.key}-${sentence}`}
              style={{
                // A touch slower than reading pace, so the words never run ahead of the voice.
                ["--scroll-ms" as string]: `${captionMs}ms`,
                ["--seat-color" as string]: current.seat.color ?? "var(--ink)",
              }}
            >
              <span>{caption}</span>
            </p>
          )}
          {speaking && !current && (
            <p className="scene-phrase scene-waiting">
              {done ? "That's the whole conversation." : "The room is gathering its thoughts…"}
            </p>
          )}
        </div>
      </div>

      {speaking && (
        <>
          <div className="scene-caption" aria-live="polite">
            {current ? (
              <>
                <strong style={{ color: current.seat.color }}>
                  {current.speaker}
                  <small> · {stageLabel(current)}</small>
                </strong>
                <p className="visually-hidden">{caption}</p>
              </>
            ) : (
              <p className="muted">{done ? "Replay it, or read the written record below." : "Waiting for the next voice…"}</p>
            )}
          </div>

          <div className="scene-controls">
            <button aria-label="Previous speaker" className="pill-button" onClick={() => jump(index - 1)} type="button">
              ⏮
            </button>
            {done ? (
              <button className="button" onClick={() => { jump(0); setPlaying(true); }} type="button">
                Replay
              </button>
            ) : (
              <button className="button" onClick={() => setPlaying(!playing)} type="button">
                {playing ? "Pause" : "Play"}
              </button>
            )}
            <button aria-label="Next speaker" className="pill-button" onClick={() => jump(index + 1)} type="button">
              ⏭
            </button>
            <label className="scene-rate">
              Speed
              <select onChange={(event) => setRate(Number(event.target.value))} value={rate}>
                {RATES.map((value) => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <label className="scene-rate">
              Voices
              <select onChange={(event) => setMode(event.target.value as VoiceMode)} value={mode}>
                <option disabled={!apiKey} value="natural">
                  Natural (about ${(spokenCharacters * SPEECH_PRICE_PER_CHARACTER).toFixed(2)})
                </option>
                <option value="browser">Browser (free)</option>
                <option value="captions">Captions only</option>
              </select>
            </label>
            <span className="scene-progress">
              {Math.min(index + (current ? 1 : 0), items.length)} / {items.length} turns
            </span>
          </div>

          {join}

          {(notice || (mode === "natural" && naturalError)) && (
            <p className="scene-notice">
              {notice || `Natural voices aren't available right now, so the browser's voices are speaking. (${naturalError})`}
            </p>
          )}

          {!!learned.length && (
            <div className="scene-board">
              <p>What the room is finding</p>
              <ul>
                {learned.map((item) => (
                  <li key={item.key} style={{ borderColor: item.seat.color }}>
                    {item.phrase}
                    <small>{item.speaker}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
