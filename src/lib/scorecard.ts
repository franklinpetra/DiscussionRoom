/**
 * How the room did. After the discussion, a strong model from outside the room answers three
 * questions about it, without being told which model said what:
 *
 * 1. Did the room beat one model alone? The synthesizer's model also answers the question on
 *    its own; the judge compares that with the room's final answer, in random order.
 * 2. What did the room find together? Points that matter, appear in no opening answer, and
 *    emerged from the conversation.
 * 3. Does it hold up? How sound the final answer is, and which claims are worth checking.
 *
 * The fourth question belongs to the person who asked: one tap, "did it change your mind?".
 */
import {
  AUDIENCE,
  KEY_PHRASE_INSTRUCTION,
  PERSON,
  VOICE,
  buildQuestionContent,
  speakerName,
  type Attachment,
  type CompletionMessage,
  type GuestModel,
  type GuestTurn,
} from "@/lib/guest-room";

/** Strong judges, in order of preference. One from a company with no seat at the table is preferred. */
export const JUDGES: readonly GuestModel[] = [
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", vendor: "OpenAI" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", vendor: "Anthropic" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", vendor: "Google" },
];

export function pickJudge(seats: GuestModel[]): GuestModel {
  const seated = new Set(seats.map((seat) => seat.id));
  const vendors = new Set(seats.map((seat) => seat.vendor.toLowerCase()));
  return (
    JUDGES.find((judge) => !seated.has(judge.id) && !vendors.has(judge.vendor.toLowerCase())) ??
    JUDGES.find((judge) => !seated.has(judge.id)) ??
    JUDGES[0]
  );
}

/** The same brief the synthesizer works to, minus the room: the fair "one model alone" answer. */
export function buildSoloPrompt(question: string, attachments: Attachment[] = []): CompletionMessage[] {
  return [
    {
      role: "system",
      content:
        `${VOICE}\n\n${AUDIENCE}\n\n` +
        "Answer this question on your own. Before writing, examine it from several perspectives " +
        "and apply the discovery test: which insight most substantially delivers wisdom? It may " +
        "reveal an invisible opportunity, overturn an underlying assumption, make an unexpected " +
        "connection, expose a consequential second-order effect, or reframe the question. Never " +
        "make anything seem more significant than it is.\n\n" +
        "Aim for three or fewer exceptionally clear, consequential sentences. Lead with the " +
        "discovery.\n\n" +
        KEY_PHRASE_INSTRUCTION,
    },
    { role: "user", content: buildQuestionContent(question, attachments) },
  ];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Hides who is who: each seat becomes "Voice A", "Voice B"…, in its own turns and wherever
 * another speaker names it by its full label or its table name. Longer names are replaced
 * first, so "Claude Opus 5.5" goes before "Opus".
 */
export function anonymizer(seats: GuestModel[]) {
  const voices = new Map(seats.map((seat, i) => [seat.id, `Voice ${LETTERS[i] ?? i + 1}`]));
  const names = seats
    .flatMap((seat) =>
      [seat.label, seat.nickname]
        .filter((name): name is string => !!name)
        .map((name) => ({ name, voice: voices.get(seat.id)! })),
    )
    .sort((a, b) => b.name.length - a.name.length);
  const hide = (text: string) =>
    names.reduce(
      (current, { name, voice }) => current.replace(new RegExp(`\\b${escape(name)}\\b`, "g"), voice),
      text,
    );
  const who = (turn: GuestTurn) =>
    turn.model.id === PERSON.id ? speakerName(turn) : (voices.get(turn.model.id) ?? "Another voice");
  return { hide, who };
}

/** The turns the judge can credit: everything the models said aloud. */
export function creditableTurns(conversation: GuestTurn[]) {
  return conversation.filter((turn) => turn.model.id !== PERSON.id && turn.id);
}

export type JudgeInput = {
  question: string;
  seats: GuestModel[];
  blind: GuestTurn[];
  conversation: GuestTurn[];
  roomAnswer: string;
  soloAnswer: string;
  /** Which answer is shown first; random in the room, so the judge can't learn a position. */
  roomFirst: boolean;
};

export function buildJudgePrompt(input: JudgeInput): CompletionMessage[] {
  const { hide, who } = anonymizer(input.seats);
  const numbered = new Map(creditableTurns(input.conversation).map((turn, i) => [turn.id, `T${i + 1}`]));
  const opening = input.blind.map((turn) => `${who(turn)}: ${hide(turn.text)}`).join("\n\n");
  const transcript = input.conversation
    .map((turn) => {
      const tag = numbered.get(turn.id);
      return `${tag ? `[${tag}] ` : ""}${who(turn)}: ${hide(turn.text)}`;
    })
    .join("\n\n");
  const [first, second] = input.roomFirst
    ? [input.roomAnswer, input.soloAnswer]
    : [input.soloAnswer, input.roomAnswer];
  return [
    {
      role: "system",
      content:
        "You are an impartial, demanding reviewer. The person who asked is earnest and wants to " +
        "understand what is deeply relevant and valuable, including truths that are less obvious " +
        "or not yet widely understood. Several AI models, shown only as Voice A, Voice B and so " +
        "on, answered independently and then discussed. Don't guess who they are.\n\n" +
        "Answer three questions.\n\n" +
        "1. Two final answers follow, in random order: one written after the discussion, one " +
        "written by a single model alone. Which gives this person more: a relevant, valuable, " +
        "perhaps less obvious truth that holds up? Don't reward length, polish or confidence.\n\n" +
        "2. What did the discussion discover? List up to three points that matter for the " +
        "question, appear in none of the opening answers, and emerged in the conversation. For " +
        "each, name the numbered turn where it first appeared. List only points that hold up; " +
        "none is a fair answer.\n\n" +
        "3. Does Answer 1 or 2, whichever came from the discussion, hold up? You cannot browse, " +
        "so judge from what you know: are its claims accurate and supported, and is its reasoning " +
        "sound? Name up to three specific claims worth checking.\n\n" +
        "Reply in exactly this format and nothing else:\n" +
        "BETTER: 1, 2 or TIE | why, in twenty words or fewer\n" +
        "DISCOVERY: T# | the point, in fifteen words or fewer\n" +
        "(one DISCOVERY line per point, or the single line DISCOVERY: NONE)\n" +
        "SOUND: SOLID, MOSTLY or SHAKY | why, in twenty words or fewer\n" +
        "CHECK: a claim worth checking, in fifteen words or fewer\n" +
        "(zero to three CHECK lines)",
    },
    {
      role: "user",
      content:
        `Question:\n${input.question}\n\n` +
        `Opening answers (written independently):\n\n${opening}\n\n` +
        `The conversation:\n\n${transcript || "(no conversation)"}\n\n` +
        `Answer 1:\n${hide(first)}\n\nAnswer 2:\n${hide(second)}\n\n` +
        `The answer written after the discussion is Answer ${input.roomFirst ? 1 : 2}.`,
    },
  ];
}

export type Discovery = { point: string; turnId?: string; seatId?: string };

export type Scorecard = {
  better: "room" | "solo" | "tie";
  betterWhy: string;
  discoveries: Discovery[];
  sound: "solid" | "mostly" | "shaky";
  soundWhy: string;
  checks: string[];
  /** Out of 10: beat one model alone (4), discoveries (3), holds up (3). */
  score: number;
};

export const SCORE_PARTS = { better: 4, discoveries: 3, sound: 3 } as const;

export function scoreParts(card: Pick<Scorecard, "better" | "discoveries" | "sound">) {
  return {
    better: card.better === "room" ? 4 : card.better === "tie" ? 2 : 0,
    discoveries: Math.min(card.discoveries.length, 3),
    sound: card.sound === "solid" ? 3 : card.sound === "mostly" ? 2 : 0,
  };
}

/** Reads the judge's reply. Returns null unless both the comparison and the soundness line are readable. */
export function parseScorecard(
  reply: string,
  conversation: GuestTurn[],
  roomFirst: boolean,
): Scorecard | null {
  const turns = creditableTurns(conversation);
  let better: Scorecard["better"] | null = null;
  let betterWhy = "";
  let sound: Scorecard["sound"] | null = null;
  let soundWhy = "";
  const discoveries: Discovery[] = [];
  const checks: string[] = [];
  for (const raw of reply.split("\n")) {
    const line = raw.replace(/[*`]/g, "").trim();
    const match = line.match(/^(BETTER|DISCOVERY|SOUND|CHECK)\s*:\s*(.*)$/i);
    if (!match) continue;
    const [first, ...rest] = match[2].split("|");
    const head = first.trim();
    const tail = rest.join("|").trim();
    switch (match[1].toUpperCase()) {
      case "BETTER": {
        const pick = head.toUpperCase().replace(/^ANSWER\s*/, "");
        if (pick.startsWith("TIE")) better = "tie";
        else if (pick.startsWith("1")) better = roomFirst ? "room" : "solo";
        else if (pick.startsWith("2")) better = roomFirst ? "solo" : "room";
        betterWhy = tail;
        break;
      }
      case "DISCOVERY": {
        if (/^none\b/i.test(head) || discoveries.length >= 3) break;
        const tagged = head.match(/^\[?T(\d+)\]?$/i);
        const turn = tagged ? turns[Number(tagged[1]) - 1] : undefined;
        const point = (tagged ? tail : tail || head).trim();
        if (point) discoveries.push({ point, ...(turn ? { turnId: turn.id, seatId: turn.model.id } : {}) });
        break;
      }
      case "SOUND": {
        const level = head.toLowerCase();
        if (level.startsWith("solid")) sound = "solid";
        else if (level.startsWith("mostly")) sound = "mostly";
        else if (level.startsWith("shaky")) sound = "shaky";
        soundWhy = tail;
        break;
      }
      case "CHECK":
        if (head && checks.length < 3) checks.push([head, tail].filter(Boolean).join(" | "));
        break;
    }
  }
  if (!better || !sound) return null;
  const parts = scoreParts({ better, discoveries, sound });
  return {
    better,
    betterWhy,
    discoveries,
    sound,
    soundWhy,
    checks,
    score: parts.better + parts.discoveries + parts.sound,
  };
}

/** The person's own answer to "did it change your mind?". */
export const TAPS = [
  { id: "changes", label: "This changes what I'll do" },
  { id: "learned", label: "I learned something new" },
  { id: "nothing", label: "Nothing new for me" },
] as const;
export type TapId = (typeof TAPS)[number]["id"];

/** One discussion: its scorecard (when the judge scored it) and the person's tap (when given). */
export type HistoryEntry = {
  id: string;
  score?: number;
  better?: Scorecard["better"];
  discoveries?: number;
  tap?: TapId;
};
export type ScoreHistory = {
  runs: HistoryEntry[];
  /** Discoveries each voice sparked, across discussions. */
  sparks: Record<string, { label: string; count: number }>;
};

const HISTORY_KEY = "theroom.scorecards.v1";

export function readScoreHistory(): ScoreHistory {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "null") as ScoreHistory | null;
    if (Array.isArray(parsed?.runs) && parsed.sparks) return parsed;
  } catch {
    // No storage, or something unreadable in it: start a fresh record.
  }
  return { runs: [], sparks: {} };
}

function save(history: ScoreHistory) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Without storage the record lasts for this visit only.
  }
  return history;
}

/** Adds one discussion's scorecard to the running record, once per discussion, keeping any tap already given. */
export function recordScorecard(history: ScoreHistory, runId: string, seats: GuestModel[], card: Scorecard) {
  const existing = history.runs.find((run) => run.id === runId);
  if (existing?.score != null) return history;
  const sparks = { ...history.sparks };
  for (const discovery of card.discoveries) {
    const seat = seats.find((item) => item.id === discovery.seatId);
    if (!seat) continue;
    sparks[seat.id] = { label: seat.label, count: (sparks[seat.id]?.count ?? 0) + 1 };
  }
  const entry: HistoryEntry = {
    ...existing,
    id: runId,
    score: card.score,
    better: card.better,
    discoveries: card.discoveries.length,
  };
  const runs = existing ? history.runs.map((run) => (run.id === runId ? entry : run)) : [...history.runs, entry];
  return save({ runs: runs.slice(-200), sparks });
}

/** Records the person's tap, whether or not the judge has scored (or could score) the discussion. */
export function recordTap(history: ScoreHistory, runId: string, tap: TapId) {
  const known = history.runs.some((run) => run.id === runId);
  const runs = known
    ? history.runs.map((run) => (run.id === runId ? { ...run, tap } : run))
    : [...history.runs, { id: runId, tap }];
  return save({ ...history, runs: runs.slice(-200) });
}

export function summarize(history: ScoreHistory) {
  const scored = history.runs.filter((run) => run.score != null);
  const taps = Object.fromEntries(TAPS.map((tap) => [tap.id, history.runs.filter((run) => run.tap === tap.id).length])) as Record<
    TapId,
    number
  >;
  return {
    count: scored.length,
    averageScore: scored.length ? scored.reduce((sum, run) => sum + (run.score ?? 0), 0) / scored.length : 0,
    roomWins: scored.filter((run) => run.better === "room").length,
    ties: scored.filter((run) => run.better === "tie").length,
    discoveries: scored.reduce((sum, run) => sum + (run.discoveries ?? 0), 0),
    taps,
  };
}
