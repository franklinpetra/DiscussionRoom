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
  KEY_PHRASE_INSTRUCTION,
  PERSON,
  VOICE,
  VOLUNTEER_MARKER,
  buildIndependentPrompt,
  speakerName,
  type Attachment,
  type CompletionMessage,
  type GuestModel,
  type GuestTurn,
  type Hand,
} from "@/lib/guest-room";
import { splitSentences } from "@/lib/room-scene";

/** Floor turns in one conversation, not counting interjections and the replies to them. */
export const MAX_FLOOR_TURNS = 10;
/** Extra floor turns when the synthesizer asks for one more exchange. */
export const EXTRA_FLOOR_TURNS = 4;
/** Breaking in stays rare, so it means something. */
export const MAX_BREAKS = 2;

export type FloorContext = {
  question: string;
  attachments: Attachment[];
  /** The unveiled blind round. */
  blind: GuestTurn[];
  /** Everything said aloud since, in order. */
  conversation: GuestTurn[];
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
        turn.kind === "interjection" ? " (breaking in)" : turn.kind === "person" ? " (joining in)" : "";
      return `${who}${tag}: ${spokenText(turn)}`;
    })
    .join("\n\n");
}

/** What the room actually heard: a turn someone broke into ends at the break. */
export function spokenText(turn: GuestTurn) {
  if (turn.cutAt == null) return turn.text;
  return `${splitSentences(turn.text).slice(0, turn.cutAt + 1).join(" ")} —`;
}

const CONVERSATION_SPIRIT =
  "This is a live conversation, not a series of replies. People in a good conversation rarely " +
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
  "notch, name the puzzle before the answer (\"here's the strange part\"), and now and then " +
  "turn to the person who asked and bring them into it. Be easy with each other: lightness " +
  "and humor are welcome, and a quick \"Ha,\" when something is genuinely funny. You may " +
  "slide in by finishing the last speaker's sentence in your own words; if you do, begin " +
  "your turn with \"…\". It should sound like people thinking out loud together, never like an " +
  "essay, a list or a speech.";

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
    `You were not alone. ${others} other participant${others === 1 ? "" : "s"} answered the same ` +
    "question independently, without knowing about you. Their answers:\n\n" +
    blindBlock(context.blind, model) +
    `\n\nAt this table you go by ${model.nickname ?? model.label}, and the others by ${names.join(", ")}. ` +
    "Use those short names, as people at a table would.";
  if (context.conversation.length) {
    content += `\n\nThe conversation so far:\n\n${conversationBlock(context.conversation, model)}`;
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

/** The turn a seat takes when it has the floor. */
export function buildFloorTurnPrompt(
  context: FloorContext,
  model: GuestModel,
  intent?: string,
  askedBy?: string,
): CompletionMessage[] | null {
  const thread = buildFloorThread(context, model);
  if (!thread) return null;
  thread.push({
    role: "user",
    content:
      `${VOICE}\n\n${CONVERSATION_SPIRIT}\n\n${PODCAST_STYLE}\n\n` +
      (askedBy
        ? `${askedBy} just asked you a question. Answer it directly first, then add what hasn't been said if you can.\n\n`
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
      `${PODCAST_STYLE}\n\n` +
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
      `\n\n${PODCAST_STYLE}\n\n` +
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
