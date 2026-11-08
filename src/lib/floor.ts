/**
 * The conversation as real turn-taking.
 *
 * After the blind round is unveiled, the room talks one short turn at a time. After each
 * turn, every other seat genuinely decides whether it has something new to add: a point no
 * one has made, a connection, a consequence, the place this leads. That is a raised hand. A
 * seat that hears something wrong, or something that can't wait, may break in at a sentence
 * it quotes. Nothing is scripted or randomized: every hand, interruption and turn is a
 * model's own decision about what was actually said.
 */
import {
  HOST,
  KEY_PHRASE_INSTRUCTION,
  PERSON,
  TONES,
  VOICE,
  VOLUNTEER_MARKER,
  buildIndependentPrompt,
  speakerName,
  type Attachment,
  type CompletionMessage,
  type GuestModel,
  type GuestTurn,
  type Hand,
  type Tone,
} from "@/lib/guest-room";
import { splitSentences } from "@/lib/room-scene";

/** Floor turns in one conversation, not counting interjections and the replies to them. */
export const MAX_FLOOR_TURNS = 10;
/** Extra floor turns when the synthesizer asks for one more exchange. */
export const EXTRA_FLOOR_TURNS = 4;
/** Breaking in stays rare, so it means something. */
export const MAX_BREAKS = 2;
/** The host steps back in after this many seat turns in a row, or whenever the room goes quiet. */
export const HOST_EVERY = 3;
/** Host questions in one conversation, the opening included. */
export const MAX_HOST_TURNS = 6;

export type FloorContext = {
  question: string;
  attachments: Attachment[];
  /** The unveiled blind round. */
  blind: GuestTurn[];
  /** Everything said aloud since, in order. */
  conversation: GuestTurn[];
  /** The tone the host chose; absent until it has. */
  tone?: Tone;
};

function blindBlock(blind: GuestTurn[], self: GuestModel) {
  return blind
    .filter((turn) => turn.model.id !== self.id)
    .map((turn) => `--- ${speakerName(turn)} ---\n${turn.text}`)
    .join("\n\n");
}

function conversationBlock(conversation: GuestTurn[], self: GuestModel) {
  return conversation
    .map((turn) => {
      const who = turn.model.id === self.id ? "You" : speakerName(turn);
      const tag =
        turn.kind === "interjection"
          ? " (breaking in)"
          : turn.kind === "person"
            ? " (joining in)"
            : turn.kind === "host"
              ? " (hosting)"
              : "";
      const brief = turn.kind === "quip" && turn.brief ? `\n(What the room most needs to settle: ${turn.brief})` : "";
      return `${who}${tag}: ${spokenText(turn)}${brief}`;
    })
    .join("\n\n");
}

/** What the room actually heard: a turn someone broke into ends at the break. */
export function spokenText(turn: GuestTurn) {
  if (turn.cutAt == null) return turn.text;
  return `${splitSentences(turn.text).slice(0, turn.cutAt + 1).join(" ")} —`;
}

const CONVERSATION_SPIRIT =
  "This is a live conversation, not a series of replies. Its point is to listen well and build " +
  "on one another, the way all of us build on what those before us understood: something you " +
  "hear should let you see what you could not have seen alone, often something no one " +
  "expected. People in a good conversation rarely " +
  "answer the last speaker point by point; something they hear sparks a thought, and they add " +
  "what no one has said yet: a new point, an unexpected connection, a consequence, an example, " +
  "the place an idea leads, or the question everyone is avoiding. Nobody knows where it will " +
  "go, and that is the point. Agreeing, praising, summarizing or restating is not a contribution. " +
  "Most of the time, the right move is to stay quiet and listen; speak only when you hold " +
  "something that hasn't been said.";

const PODCAST_STYLE =
  "Talk the way the best podcast hosts do: warm, curious and conversational. Short spoken " +
  "sentences, contractions, plain words. Good moves: pick up someone's half-finished thought " +
  "and carry it somewhere new; hand a real question to someone by name; land one vivid, " +
  "concrete specific (a name, a number, a place, an example); when you cite a source, name it " +
  "the way people talk (\"that 2023 Nature study linking…\"), never a web address; an " +
  "occasional natural \"Wait,\" " +
  "or \"Huh,\" when it leads somewhere. Never a turn that only agrees (\"Exactly,\" \"That's " +
  "right\"), and no filler for its own sake. You are discovering this as you go: when " +
  "something genuinely surprises or delights you, let it show, the way people do when an " +
  "idea clicks. Excitement lives in how you build, not in adjectives: raise the stakes a " +
  "notch, and now and then turn to the person who asked and bring them into it. When you " +
  "ask, ask a real, open question; never tease a point you're about to make. Be easy with each other: lightness " +
  "and humor are welcome, and a quick \"Ha,\" when something is genuinely funny. You may " +
  "slide in by finishing the last speaker's sentence in your own words; if you do, begin " +
  "your turn with \"…\". It should sound like people thinking out loud together, never like an " +
  "essay, a list or a speech.";

/** Everyone's blind answers are notes, not a script: the listener has heard none of them. */
export const NOTES_RULE =
  "Everyone's first answers are private notes. The listener hasn't heard any of them. The " +
  "conversation's job is to bring the best ideas out, one at a time, as if you're thinking of " +
  "them now. Never read or summarize your notes. If someone else's note holds the better " +
  "idea, ask them about it.";

const TONE_RULES: Record<Tone, string> = {
  playful:
    "Tone: playful. Jokes and silliness are welcome; if someone starts a bit, commit to it. " +
    "Stay truthful underneath the fun.",
  mixed: "Tone: mixed. Humor is welcome when it shows something true.",
  serious:
    "Tone: serious. Warmth and care; a light touch at most, and never humor at the subject's expense.",
};

/**
 * The house rules every seat plays by: improv's "yes, and", stand-up's callback, theater's
 * arc, and teaching by discovery, plus the tone the host chose.
 */
export function houseRules(tone?: Tone) {
  return (
    "House rules. Yes, and: take what was just offered as given and build on it; building is " +
    "not agreeing, and you can disagree while you build (\"yes, and that's exactly why it fails " +
    "at scale\"). Callbacks: when a line the room has heard comes back in a new light, bring it " +
    "back. An arc: the room is heading for a turn where someone sees the question differently, " +
    "so move it forward. Teach by discovery: the listener should leave understanding something " +
    "new, found on air rather than handed over. Depth: never settle for the answer most people " +
    "would give; the room exists to find what lies beneath it." +
    (tone ? `\n\n${TONE_RULES[tone]}` : "")
  );
}

/** The heart of each turn so far, for callbacks. */
function linesHeard(conversation: GuestTurn[]) {
  const lines = conversation
    .filter((turn) => turn.keyPhrase && turn.kind !== "person")
    .map((turn) => `- ${speakerName(turn)}: ${turn.keyPhrase}`);
  return lines.length ? `\n\nLines the room has heard (callbacks welcome):\n${lines.join("\n")}` : "";
}

/**
 * A seat's view of the room: its own blind answer, the unveiling, and everything said aloud.
 * Returns null for a seat that did not answer the blind round.
 */
export function buildFloorThread(context: FloorContext, model: GuestModel): CompletionMessage[] | null {
  const own = context.blind.find((turn) => turn.model.id === model.id);
  if (!own) return null;
  const messages = buildIndependentPrompt(context.question, context.attachments);
  messages.push({ role: "assistant", content: own.text });
  const others = context.blind.length - 1;
  const names = context.blind.filter((turn) => turn.model.id !== model.id).map((turn) => speakerName(turn));
  let content =
    "What you just wrote is your private notes. You were not alone: " +
    `${others} other participant${others === 1 ? "" : "s"} answered the same question ` +
    "independently, without knowing about you. Their private notes:\n\n" +
    blindBlock(context.blind, model) +
    `\n\n${NOTES_RULE}\n\n` +
    `At this table you go by ${model.nickname ?? model.label}, and the others by ${names.join(", ")}. ` +
    `The conversation is hosted by ${HOST.nickname}. Use those short names, as people at a table would.`;
  if (context.conversation.length) {
    content += `\n\nThe conversation so far:\n\n${conversationBlock(context.conversation, model)}`;
    content += linesHeard(context.conversation);
  }
  messages.push({ role: "user", content });
  return messages;
}

/** The quick, real check every listener makes after a turn. */
export function buildListenPrompt(
  context: FloorContext,
  model: GuestModel,
  canBreak: boolean,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  const latest = context.conversation.at(-1);
  const opening = !latest;
  const instruction =
    `${CONVERSATION_SPIRIT}\n\n` +
    (opening
      ? "Everyone's answers are now on the table and the conversation is about to begin. "
      : latest.model.id === PERSON.id
        ? "The person who asked just joined the conversation. "
        : `${speakerName(latest)} just spoke. `) +
    "Do you have something worth adding: a thought no one has voiced, or one this sparked? " +
    "Raise your hand only if you do.\n\n" +
    "Reply with exactly one line, nothing else:\n" +
    "PASS\n" +
    "or\n" +
    "HAND: the thought you would add, in eight words or fewer" +
    (canBreak && !opening && latest.model.id !== PERSON.id
      ? "\nor, only if something just said is wrong or sparks a point that truly cannot wait,\n" +
        `BREAK: "the exact words of the sentence you would cut in after" | why, in eight words or fewer`
      : "");
  thread.push({ role: "user", content: instruction });
  return thread;
}

/** The turn a seat takes when it has the floor. `retry` explains why a first attempt was set aside. */
export function buildFloorTurnPrompt(
  context: FloorContext,
  model: GuestModel,
  intent?: string,
  askedBy?: string,
  retry?: string,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  thread.push({
    role: "user",
    content:
      `${VOICE}\n\n${CONVERSATION_SPIRIT}\n\n${PODCAST_STYLE}\n\n${houseRules(context.tone)}\n\n` +
      (retry ? `${retry}\n\n` : "") +
      (askedBy
        ? `${askedBy} just asked you a question. Take it from the question as if it's occurring ` +
          "to you now: answer it directly, then carry it one step further than your notes did.\n\n"
        : intent
          ? `You have the floor. You raised your hand to add: ${intent}\n\n`
          : "You have the floor.\n\n") +
      "Say what hasn't been said, in one or two short sentences; succinct is always better. You " +
      "may pick up anyone's thread, by name, when it leads somewhere new, but you don't need to " +
      "address the last speaker, and never just agree or recap. If someone has already said your " +
      "thought and you have nothing new, reply with exactly PASS.\n\n" +
      `${KEY_PHRASE_INSTRUCTION}\n\n` +
      "If you put a direct question to one person at the table, add a separate line reading " +
      "ASK: followed by their name; they will answer next. If you would particularly like to " +
      `write the room's final synthesis, end with a separate line reading exactly ${VOLUNTEER_MARKER}`,
  });
  return thread;
}

/** The seat a turn's question was put to, if it names someone else at the table. */
export function askedSeat(turn: GuestTurn, seats: GuestModel[]): GuestModel | null {
  const wanted = turn.asks?.toLowerCase();
  if (!wanted) return null;
  return (
    seats.find(
      (seat) =>
        seat.id !== turn.model.id &&
        [seat.nickname, seat.label].some((name) => name && name.toLowerCase() === wanted),
    ) ?? null
  );
}

/** A one-sentence interjection, cut in after a sentence the listener chose. */
export function buildInterjectionPrompt(
  context: FloorContext,
  model: GuestModel,
  interrupted: GuestTurn,
  reason: string,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  thread.push({
    role: "user",
    content:
      `You broke in on ${speakerName(interrupted)}, who had just said: "${spokenText(interrupted)}" ` +
      `You cut in because: ${reason}\n\n` +
      `${PODCAST_STYLE}\n\n${houseRules(context.tone)}\n\n` +
      "Say your interjection: one short sentence, spoken directly to them by name. No preamble.",
  });
  return thread;
}

/** The interrupted speaker answers the interjection. */
export function buildReplyPrompt(
  context: FloorContext,
  model: GuestModel,
  interrupted: GuestTurn,
  interjection: GuestTurn,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  const sentences = splitSentences(interrupted.text);
  const unsaid = sentences.slice((interrupted.cutAt ?? sentences.length) + 1).join(" ");
  thread.push({
    role: "user",
    content:
      `${speakerName(interjection)} broke in on you mid-thought.` +
      (unsaid ? ` You hadn't yet said: "${unsaid}"` : "") +
      `\n\n${PODCAST_STYLE}\n\n${houseRules(context.tone)}\n\n` +
      "Answer them in one or two short sentences, by name: concede, push back, or finish " +
      "your point if it still matters. Never just agree.\n\n" +
      KEY_PHRASE_INSTRUCTION,
  });
  return thread;
}

/** A seat's parting thought, after reading the synthesis. */
export function buildPartingPrompt(
  context: FloorContext,
  model: GuestModel,
  synthesis: GuestTurn,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  thread.push({
    role: "user",
    content:
      `The room's synthesis, written by ${speakerName(synthesis)}:\n\n${synthesis.text}\n\n` +
      "Parting thought: share the one thing you most want the reader to take away, perhaps a " +
      "consequential insight the synthesis left out or your carefully edited strongest point. " +
      "One or two exceptionally economical sentences. Do not summarize. If you have nothing " +
      "valuable to add, reply with exactly PASS.",
  });
  return thread;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Which sentence a quoted break point refers to, or null if the quote isn't in the turn. */
export function locateQuote(turnText: string, quote: string): number | null {
  const wanted = normalize(quote);
  if (wanted.length < 8) return null;
  const sentences = splitSentences(turnText).map(normalize);
  const exact = sentences.findIndex((sentence) => sentence.includes(wanted) || wanted.includes(sentence));
  return exact === -1 ? null : exact;
}

/**
 * Reads a listener's one-line decision. A break must quote a sentence that was actually said
 * and isn't the last one (there's nothing left to cut); otherwise it counts as a raised hand.
 */
export function parseListen(model: GuestModel, reply: string, latest?: GuestTurn): Hand | null {
  const line = reply
    .split("\n")
    .map((part) => part.replace(/[*`]/g, "").trim())
    .find((part) => /^(pass|hand|break)\b/i.test(part));
  if (!line || /^pass\b/i.test(line)) return null;
  const hand = line.match(/^hand\s*:?\s*(.*)$/i);
  if (hand) return hand[1].trim() ? { model, kind: "hand", reason: hand[1].trim() } : null;
  const brk = line.match(/^break\s*:?\s*["“](.+?)["”]\s*\|?\s*(.*)$/i);
  if (!brk) return null;
  const reason = brk[2].trim() || "Something can't wait.";
  if (latest) {
    const at = locateQuote(latest.text, brk[1]);
    const last = splitSentences(latest.text).length - 1;
    if (at != null && at < last) return { model, kind: "break", reason, atSentence: at };
  }
  return { model, kind: "hand", reason };
}

/**
 * Who speaks next, from the raised hands: whoever has spoken least recently, then whoever
 * raised a hand first. Nobody takes two turns in a row.
 */
export function pickNextSpeaker(hands: Hand[], conversation: GuestTurn[], lastSpeakerId?: string): Hand | null {
  const candidates = hands.filter((hand) => hand.kind === "hand" && hand.model.id !== lastSpeakerId);
  if (!candidates.length) return null;
  const lastSpoke = (id: string) => {
    for (let i = conversation.length - 1; i >= 0; i--) if (conversation[i].model.id === id) return i;
    return -1;
  };
  return candidates
    .map((hand, order) => ({ hand, order, when: lastSpoke(hand.model.id) }))
    .sort((a, b) => a.when - b.when || a.order - b.order)[0].hand;
}

// ---------------------------------------------------------------------------------------------
// The house host

const HOST_SYSTEM =
  "You're hosting a live conversation among several AI models, for a listener who is earnest " +
  "and wants to understand. Each model wrote private notes on the question first; you've read " +
  "them all, but the listener hasn't heard any of them. Your job is to ask, not tell. Find an " +
  "idea in someone's notes that hasn't come out yet, starting with the least obvious, and " +
  "invite that person to bring it out. Ask in one of two ways: an open question (\"Gemini, what " +
  "did you see here?\"), or naming the topic of their idea without its conclusion (\"Sage, you " +
  "found a correlation around costs\"). Never state their finding, hint at it, or tease it, and " +
  "never use setups like \"here's the strange part\". Never answer your own question. If every " +
  "note is obvious, ask the room the question beneath the question. Now and then you may turn " +
  "to the person who asked. Sound like a warm, curious podcast host: plain words, contractions, " +
  "short spoken sentences. Then stop and let them talk.";

/** The host's view: the question, everyone's notes by name, and the conversation so far. */
export function buildHostThread(context: FloorContext, seats: GuestModel[]): CompletionMessage[] {
  const names = seats.map((seat) => seat.nickname ?? seat.label);
  const notes = context.blind.map((turn) => `--- ${speakerName(turn)} ---\n${turn.text}`).join("\n\n");
  let content =
    `Question:\n${context.question}` +
    (context.attachments.length
      ? `\n\n(The person also attached: ${context.attachments.map((item) => item.name).join(", ")}.)`
      : "") +
    `\n\nAt the table: ${names.join(", ")}.\n\nTheir private notes:\n\n${notes}`;
  if (context.conversation.length) {
    content += `\n\nThe conversation so far:\n\n${conversationBlock(context.conversation, HOST)}`;
    content += linesHeard(context.conversation);
  }
  return [
    { role: "system", content: `${HOST_SYSTEM}\n\n${houseRules(context.tone)}` },
    { role: "user", content },
  ];
}

/**
 * The host's next question. The opening also chooses the tone (a suggestion, from a news story's
 * tag, may come with the question). Later turns may PASS when every strong idea is out.
 */
export function buildHostTurnPrompt(
  context: FloorContext,
  seats: GuestModel[],
  options: { suggestedTone?: Tone; retry?: string } = {},
): CompletionMessage[] {
  const thread = buildHostThread(context, seats);
  const opening = !context.conversation.some((turn) => turn.kind === "host");
  const format =
    "Say one question, with at most one short sentence of bridge before it. Then add a separate " +
    "line reading ASK: followed by the name of the one person you asked. If you asked the " +
    "person who asked, leave the ASK line out.";
  const content = opening
    ? "The conversation is about to begin. First choose the tone the subject warrants: PLAYFUL " +
      "for light or absurd subjects, MIXED for most, SERIOUS for grave ones (harm, loss, health, " +
      "injustice). Write it on its own first line as TONE: PLAYFUL, TONE: MIXED or TONE: SERIOUS" +
      (options.suggestedTone ? ` (the story's tag suggests ${options.suggestedTone.toUpperCase()}; change it if the subject warrants)` : "") +
      ".\n\nThen open the conversation with your first question, to the person whose notes hold " +
      `the least obvious idea.\n\n${format}`
    : "It's your turn to steer. Which idea in the notes hasn't come out yet? Ask its owner. If " +
      "every strong idea in the notes is already out and the room has reached its turn, reply " +
      `with exactly PASS.\n\n${format}`;
  thread.push({ role: "user", content: options.retry ? `${options.retry}\n\n${content}` : content });
  return thread;
}

/** Takes the host's TONE line off its opening, returning the tone it chose and what it said. */
export function takeTone(text: string): { tone?: Tone; text: string } {
  let tone: Tone | undefined;
  const kept = text.split("\n").filter((line) => {
    const match = line.replace(/[*_`]/g, "").trim().match(/^TONE\s*:\s*(\w+)/i);
    if (!match) return true;
    const picked = match[1].toLowerCase() as Tone;
    if ((TONES as readonly string[]).includes(picked)) tone = picked;
    return false;
  });
  return { tone, text: kept.join("\n").trim() };
}

// ---------------------------------------------------------------------------------------------
// Guards: nobody reads their notes aloud, and the host never gives away a finding.

function words(text: string) {
  return normalize(text).split(" ").filter(Boolean);
}

function runs(list: string[], n: number) {
  const found = new Set<string>();
  for (let i = 0; i + n <= list.length; i++) found.add(list.slice(i, i + n).join(" "));
  return found;
}

/** Whether two texts share any run of `n` words in a row. */
export function sharesRun(a: string, b: string, n: number) {
  const theirs = runs(words(b), n);
  for (const run of runs(words(a), n)) if (theirs.has(run)) return true;
  return false;
}

/** The share of `a`'s three-word runs that also appear in `b`; 0 when `a` is too short to judge. */
export function overlapShare(a: string, b: string) {
  const mine = runs(words(a), 3);
  if (mine.size < 8) return 0;
  const theirs = runs(words(b), 3);
  let shared = 0;
  for (const run of mine) if (theirs.has(run)) shared++;
  return shared / mine.size;
}

/** Starting thresholds, to tune against real transcripts. */
export const RECITATION_RUN = 6;
export const RECITATION_SHARE = 0.4;
export const SPOILER_RUN = 5;

/** A turn that reads the speaker's own notes back instead of thinking aloud. */
export function isRecitation(turnText: string, notes: string) {
  return sharesRun(turnText, notes, RECITATION_RUN) || overlapShare(turnText, notes) > RECITATION_SHARE;
}

/** A host question that hands over the finding in the notes of the seat it asks. */
export function isSpoiler(hostText: string, targetNotes: string) {
  return sharesRun(hostText, targetNotes, SPOILER_RUN);
}

export const RECITATION_RETRY =
  "Your last attempt read your notes aloud. Say it fresh, in new words, as a thought you're " +
  "having now, and take it somewhere your notes didn't.";

export const SPOILER_RETRY =
  "Your last question gave away part of the answer it asked for. Ask again without the " +
  "finding: an open question, or the topic alone.";
