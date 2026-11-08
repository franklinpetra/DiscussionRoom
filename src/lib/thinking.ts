/**
 * Thinking aloud on the blind cards. While the blind round is written, each model marks its own
 * text with a light hand: **the idea it lands on**, *an aside*, ((a hedge or half-formed
 * thought)), and now and then ~~a word~~ struck out and replaced. The marks exist only on
 * screen: everything the other models read, and the written record, gets the plain text.
 */

export type ThoughtKind = "plain" | "bold" | "aside" | "hedge" | "struck";
export type Thought = { kind: ThoughtKind; text: string };

/** The instruction added to the blind round. */
export const THINKING_MARKS =
  "Your answer appears on screen as you write it, as if you were thinking aloud. Mark it with " +
  "a light hand, a few marks in all: **double asterisks** around the idea you land on, " +
  "*single asterisks* around an aside or second thought, ((double parentheses)) around a hedge " +
  "or a half-formed thought, and, at most once, ~~a word~~ struck out and followed by the " +
  "better one, as if you changed your mind. The marks are for the screen only; no one else " +
  "will see them.";

const OPENERS: Array<[string, ThoughtKind]> = [
  ["**", "bold"],
  ["~~", "struck"],
  ["((", "hedge"],
  ["*", "aside"],
];
const CLOSERS: Record<Exclude<ThoughtKind, "plain">, string> = {
  bold: "**",
  struck: "~~",
  hedge: "))",
  aside: "*",
};

/**
 * Splits marked text into runs. A mark still open at the end (text still streaming in) runs to
 * the end in its own style, so the effect shows as the words arrive.
 */
export function thoughts(text: string): Thought[] {
  const out: Thought[] = [];
  let kind: ThoughtKind = "plain";
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind, text: buffer });
    buffer = "";
  };
  for (let i = 0; i < text.length; ) {
    if (kind === "plain") {
      const opener = OPENERS.find(([mark]) => text.startsWith(mark, i));
      if (opener) {
        flush();
        kind = opener[1];
        i += opener[0].length;
        continue;
      }
    } else {
      const closer = CLOSERS[kind];
      if (text.startsWith(closer, i)) {
        flush();
        kind = "plain";
        i += closer.length;
        continue;
      }
    }
    buffer += text[i];
    i++;
  }
  flush();
  return out;
}

export function hasThinkingMarks(text: string) {
  return thoughts(text).some((thought) => thought.kind !== "plain");
}

/** The plain text: marks removed, struck-out words gone, spacing tidied. */
export function stripThinking(text: string) {
  return thoughts(text)
    .filter((thought) => thought.kind !== "struck")
    .map((thought) => thought.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/\( +/g, "(")
    .trim();
}

/**
 * How long to wait before showing the next word: an unhurried thinking pace, a beat at commas
 * and a longer one at sentence ends, catching up when the model has written far ahead.
 */
export function revealDelay(word: string, backlog: number) {
  if (backlog > 240) return 12;
  const base = 70 + Math.min(word.length, 12) * 6;
  if (/\n\s*$/.test(word)) return base + 260;
  if (/[.!?]["”')*]*\s*$/.test(word)) return base + 200;
  if (/[,;:]["”')*]*\s*$/.test(word)) return base + 110;
  return base;
}

/** The next word boundary after `from`: where a reveal step ends. */
export function nextWordEnd(text: string, from: number) {
  const rest = text.slice(from);
  const match = rest.match(/^\s*\S+\s*/);
  return from + (match ? match[0].length : rest.length);
}
