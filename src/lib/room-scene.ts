import { modelLabel, type GuestModel, type GuestRun, type GuestTurn } from "@/lib/guest-room";

/** A point on the room's floor: x runs left to right, z from the back (-1) toward the viewer (+1). */
export type FloorPoint = { x: number; z: number };

export const CENTER: FloorPoint = { x: 0, z: 0 };

/**
 * Seats around an open oval, like friends in a living room: the arc wraps the back and both
 * sides, and leaves the near side open for the viewer.
 */
export function seatPositions(count: number): FloorPoint[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, z: -1 }];
  const arc = count === 2 ? 110 : count === 3 ? 160 : count === 4 ? 200 : 220;
  return Array.from({ length: count }, (_, index) => {
    const degrees = -arc / 2 + (arc * index) / (count - 1);
    const radians = (degrees * Math.PI) / 180;
    return { x: Math.sin(radians), z: -Math.cos(radians) };
  });
}

/**
 * Which of the eight drawn angles shows a chair at `from` facing `toward`.
 * 0 faces the viewer, 90 faces right (its left side shows), 180 faces away, 270 faces left.
 */
export function facingAngle(from: FloorPoint, toward: FloorPoint) {
  const degrees = (Math.atan2(toward.x - from.x, toward.z - from.z) * 180) / Math.PI;
  return ((Math.round(degrees / 45) * 45) % 360 + 360) % 360;
}

/** Listeners turn partway toward whoever is speaking; the speaker addresses the room. */
export function attentionPoint(seat: FloorPoint, speaker: FloorPoint | null, isSpeaker: boolean) {
  if (!speaker || isSpeaker) return CENTER;
  if (speaker.x === seat.x && speaker.z === seat.z) return CENTER;
  return { x: speaker.x * 0.7, z: speaker.z * 0.7 };
}

export type PlayStage = "Independent" | "The conversation" | "One more exchange" | "Synthesis" | "Parting thoughts";

export type PlayItem = {
  key: string;
  seat: GuestModel;
  speaker: string;
  stage: PlayStage;
  text: string;
  phrase: string;
  kind?: GuestTurn["kind"];
  /** Playback stops after this sentence: someone broke in. */
  cutAt?: number;
};

function fallbackPhrase(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 10 ? text : `${words.slice(0, 10).join(" ")}…`;
}

function item(turn: GuestTurn, stage: PlayStage, key: string): PlayItem {
  return {
    key,
    seat: turn.model,
    speaker: turn.model.nickname ?? modelLabel(turn),
    stage,
    text: turn.text,
    phrase: turn.keyPhrase || fallbackPhrase(turn.text),
    kind: turn.kind,
    cutAt: turn.cutAt,
  };
}

/** The order in which the room speaks: the blind round, the conversation as it happened, then synthesis and parting lines. */
export function buildPlaylist(run: GuestRun): PlayItem[] {
  const items: PlayItem[] = [];
  run.rounds.forEach((round, index) => {
    for (const turn of round.turns) {
      items.push(item(turn, round.name as PlayStage, turn.id ?? `${index}-${turn.model.id}`));
    }
  });
  if (run.synthesis) items.push(item(run.synthesis, "Synthesis", "synthesis"));
  for (const turn of run.contributions) items.push(item(turn, "Parting thoughts", `parting-${turn.model.id}`));
  return items;
}

export function splitSentences(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences?.length ? sentences : [text.trim()];
}

/** How long captions stay up when voices are off: a relaxed speaking pace. */
export function readingMilliseconds(text: string, rate: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(((words / 2.7) * 1000) / rate + 500);
}

/**
 * How long a caption drifts across the rug: its share of the recording when this turn's natural
 * voice has loaded, otherwise an unhurried reading estimate. Before anyone speaks there is no
 * turn and no recording, which must fall back to the estimate rather than fail.
 */
export function captionMilliseconds(
  caption: string,
  turnText: string,
  rate: number,
  recording: { key: string; seconds: number } | null,
  turnKey: string | undefined,
) {
  if (turnKey && recording?.key === turnKey) {
    return Math.round(Math.max(1800, ((recording.seconds * 1000) / rate) * (caption.length / Math.max(1, turnText.length))));
  }
  return Math.round(Math.max(2600, readingMilliseconds(caption, rate) * 1.4));
}

const NOVELTY_VOICES =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed/i;

/** Picks distinct, natural-sounding English voices, one per seat where possible. */
export function pickVoices<V extends { name: string; lang: string; localService?: boolean }>(
  voices: V[],
  count: number,
): (V | null)[] {
  const english = voices
    .filter((voice) => voice.lang.toLowerCase().startsWith("en") && !NOVELTY_VOICES.test(voice.name))
    .map((voice) => ({
      voice,
      score:
        (/premium|enhanced|natural|neural/i.test(voice.name) ? 4 : 0) +
        (/google|microsoft/i.test(voice.name) ? 2 : 0) +
        (/en[-_](us|gb)/i.test(voice.lang) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ voice }) => voice);
  if (!english.length) return Array.from({ length: count }, () => null);
  // The Australian voice belongs to Chase; seats use the others while there are enough.
  const accent = accentVoice(voices);
  const others = english.filter((voice) => voice !== accent);
  const ordered = others.length ? others : english;
  return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]);
}

/** Chase's browser voice, like the natural one: Australian, or else British, when the browser has one. */
export function accentVoice<V extends { name: string; lang: string }>(voices: V[]): V | null {
  const english = voices.filter((voice) => !NOVELTY_VOICES.test(voice.name));
  return (
    english.find((voice) => /en[-_]au/i.test(voice.lang)) ?? english.find((voice) => /en[-_]gb/i.test(voice.lang)) ?? null
  );
}

export const SEAT_PITCH = [1, 0.88, 1.1, 0.95, 1.05, 0.82];
