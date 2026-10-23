/**
 * "Sharpen my question": one quick model call that suggests a livelier version of the
 * person's question and explains, in a line or two, what made it better. The person keeps
 * or reverts it; either way they've had a small lesson in the art of asking.
 */
import type { CompletionMessage } from "@/lib/guest-room";

export type Sharpened = {
  question: string;
  /** Short lessons: what changed and why it makes a better conversation. */
  lessons: string[];
};

const PRINCIPLES =
  "What makes a question start a great conversation:\n" +
  "- A puzzle or tension inside it, something to chase (\"Why do we… even when…?\").\n" +
  "- Open, not yes/no or a fact lookup (\"Why\", \"What if\", \"How might\").\n" +
  "- Stakes: why it matters to the person, if they gave any hint of it.\n" +
  "- Room to disagree: two real possibilities to pull apart.\n" +
  "- Specific enough to grip, without narrowing it to one answer.";

export function buildSharpenPrompt(question: string): CompletionMessage[] {
  return [
    {
      role: "system",
      content:
        "You help people ask better questions for a lively discussion among several thinkers.\n\n" +
        `${PRINCIPLES}\n\n` +
        "Rewrite the person's question so it would spark a richer conversation. Keep their meaning, " +
        "their subject, their voice and their language; keep it one or two sentences; never add " +
        "facts, names or claims they didn't give. If it is already excellent, return it nearly unchanged.\n\n" +
        "Reply with exactly this format and nothing else:\n" +
        "QUESTION: the improved question\n" +
        "LESSON: one short sentence on a change you made and why it helps\n" +
        "LESSON: optionally, one more",
    },
    { role: "user", content: question },
  ];
}

/** Reads the model's reply; null if it didn't follow the format. */
export function parseSharpened(reply: string): Sharpened | null {
  let question = "";
  const lessons: string[] = [];
  for (const raw of reply.split("\n")) {
    const line = raw.replace(/[*`]/g, "").trim();
    const q = line.match(/^question\s*:\s*(.+)$/i);
    if (q) question = q[1].trim().replace(/^["“]|["”]$/g, "");
    const l = line.match(/^lesson\s*:\s*(.+)$/i);
    if (l && lessons.length < 2) lessons.push(l[1].trim());
  }
  return question ? { question, lessons } : null;
}
