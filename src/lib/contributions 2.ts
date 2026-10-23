/**
 * How each voice moved the room. After the conversation, a model that was NOT in the room
 * labels every turn: a new idea, a clarification, added value, a repeat, or the obvious.
 * Nobody grades their own turns. The tallies feed a chart at the end of each discussion and
 * a running record across discussions in this browser.
 */
import {
  DEFAULT_MODELS,
  FALLBACK_MODEL,
  PERSON,
  speakerName,
  type CompletionMessage,
  type GuestModel,
  type GuestTurn,
} from "@/lib/guest-room";

/** Ordered for a diverging chart: what holds the room back on the left, what moves it forward on the right. */
export const KINDS = [
  { id: "obvious", label: "States the obvious", short: "Obvious", color: "#eda100", forward: false },
  { id: "repeat", label: "Repeats others", short: "Repeats", color: "#e34948", forward: false },
  { id: "new", label: "New idea", short: "New idea", color: "#2a78d6", forward: true },
  { id: "clarify", label: "Clarifies", short: "Clarifies", color: "#1baf7a", forward: true },
  { id: "value", label: "Adds value", short: "Adds value", color: "#6250d6", forward: true },
] as const;

export type KindId = (typeof KINDS)[number]["id"];
export type Verdict = { kind: KindId; reason: string };
export type Counts = Record<KindId, number>;

const IDS = KINDS.map((kind) => kind.id) as KindId[];
export const kindOf = (id: KindId) => KINDS.find((kind) => kind.id === id)!;
export const emptyCounts = (): Counts => ({ obvious: 0, repeat: 0, new: 0, clarify: 0, value: 0 });

/** A judge from outside the room: the first default or fallback model with no seat at the table. */
export function pickJudge(seats: GuestModel[]): GuestModel {
  const seated = new Set(seats.map((seat) => seat.id));
  return [...DEFAULT_MODELS, FALLBACK_MODEL].find((model) => !seated.has(model.id)) ?? FALLBACK_MODEL;
}

/** The turns a judge labels: everything the models said aloud in the conversation. */
export function judgedTurns(conversation: GuestTurn[]) {
  return conversation.filter((turn) => turn.model.id !== PERSON.id && turn.id);
}

export function buildJudgePrompt(question: string, blind: GuestTurn[], conversation: GuestTurn[]): CompletionMessage[] {
  const numbered = new Map(judgedTurns(conversation).map((turn, i) => [turn.id, `T${i + 1}`]));
  const transcript = conversation
    .map((turn) => {
      const tag = numbered.get(turn.id);
      return `${tag ? `[${tag}] ` : ""}${speakerName(turn)}: ${turn.text}`;
    })
    .join("\n\n");
  const opening = blind.map((turn) => `${speakerName(turn)}: ${turn.text}`).join("\n\n");
  return [
    {
      role: "system",
      content:
        "You are an impartial observer of a discussion among AI models. You were not part of it. " +
        "For each numbered turn, judge what it did for the conversation, given everything said before it " +
        "(including the opening answers):\n" +
        "new = a point, connection or consequence no one had raised\n" +
        "clarify = made something confusing or vague clearer\n" +
        "value = built on an earlier point and took it somewhere useful\n" +
        "repeat = mostly restated what someone had already said\n" +
        "obvious = true but adds nothing a thoughtful listener didn't already assume\n\n" +
        "Be strict and fair; don't reward eloquence over substance. Reply with exactly one line per " +
        "numbered turn, in order, and nothing else:\n" +
        "T1: kind | why, in twelve words or fewer",
    },
    {
      role: "user",
      content: `Question:\n${question}\n\nOpening answers (written independently):\n\n${opening}\n\nThe conversation:\n\n${transcript}`,
    },
  ];
}

/** Reads the judge's lines into verdicts keyed by turn id; lines it can't read are skipped. */
export function parseVerdicts(reply: string, conversation: GuestTurn[]): Record<string, Verdict> {
  const turns = judgedTurns(conversation);
  const verdicts: Record<string, Verdict> = {};
  for (const raw of reply.split("\n")) {
    const line = raw.replace(/[*`]/g, "").trim();
    const match = line.match(/^\[?T(\d+)\]?\s*[:.-]\s*([a-z]+)\s*(?:\|\s*(.*))?$/i);
    if (!match) continue;
    const turn = turns[Number(match[1]) - 1];
    const kind = match[2].toLowerCase() as KindId;
    if (turn?.id && IDS.includes(kind)) verdicts[turn.id] = { kind, reason: (match[3] ?? "").trim() };
  }
  return verdicts;
}

/** Each seat's counts for this discussion. */
export function tally(seats: GuestModel[], conversation: GuestTurn[], verdicts: Record<string, Verdict>) {
  const counts = new Map(seats.map((seat) => [seat.id, emptyCounts()]));
  for (const turn of judgedTurns(conversation)) {
    const verdict = verdicts[turn.id!];
    const row = counts.get(turn.model.id);
    if (verdict && row) row[verdict.kind]++;
  }
  return counts;
}

export type History = { runs: string[]; models: Record<string, { label: string; counts: Counts }> };
const HISTORY_KEY = "theroom.contributions.v1";

export function readHistory(): History {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "null") as History | null;
    if (parsed?.runs && parsed.models) return parsed;
  } catch {
    // No storage, or something unreadable in it: start a fresh record.
  }
  return { runs: [], models: {} };
}

/** Adds one discussion's tallies to the running record, once per discussion. */
export function recordHistory(
  history: History,
  runId: string,
  seats: GuestModel[],
  counts: Map<string, Counts>,
): History {
  if (history.runs.includes(runId)) return history;
  const models = { ...history.models };
  for (const seat of seats) {
    const add = counts.get(seat.id);
    if (!add) continue;
    const current = models[seat.id]?.counts ?? emptyCounts();
    models[seat.id] = {
      label: seat.label,
      counts: Object.fromEntries(IDS.map((id) => [id, current[id] + add[id]])) as Counts,
    };
  }
  const next = { runs: [...history.runs, runId].slice(-200), models };
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Without storage the record lasts for this visit only.
  }
  return next;
}
