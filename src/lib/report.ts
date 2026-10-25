import { modelLabel, type GuestRun, type GuestTurn } from "@/lib/guest-room";

/** A cited address as a link, and as people read it: no scheme, no "www.", no trailing slash. */
export const sourceHref = (address: string) => (/^https?:/i.test(address) ? address : `https://${address}`);
export const sourceLabel = (address: string) => address.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

/**
 * The report's endnotes: every cited address numbered once, in reading order (synthesis,
 * parting thoughts, then the conversation), so a turn carries small numbers instead of addresses.
 */
export function endnotes(run: GuestRun) {
  const notes: string[] = [];
  const turns: GuestTurn[] = [
    ...(run.synthesis ? [run.synthesis] : []),
    ...run.contributions,
    ...run.rounds.flatMap((round) => round.turns),
  ];
  for (const turn of turns) {
    for (const address of turn.sources ?? []) if (!notes.includes(address)) notes.push(address);
  }
  return { notes, numbers: (turn: GuestTurn) => (turn.sources ?? []).map((address) => notes.indexOf(address) + 1) };
}

export function reportDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function reportId(iso: string) {
  return `ROOM-${iso.replace(/\D/g, "").slice(0, 12)}`;
}

/** Markdown export in the report's order: prompt, synthesis, contributions, full conversation. */
export function buildMarkdown(run: GuestRun) {
  const { notes, numbers } = endnotes(run);
  const marks = (turn: GuestTurn) => numbers(turn).map((n) => `[^${n}]`).join("");
  const lines: string[] = [
    "# Discussion",
    "",
    `*${reportDate(run.createdAt)} · ${reportId(run.createdAt)}*`,
    "",
    "## The prompt",
    "",
    run.question,
    "",
  ];
  if (run.attachments.length) {
    lines.push(`Attached: ${run.attachments.map((item) => item.name).join(", ")}`, "");
  }
  if (run.synthesis) {
    lines.push("## The synthesis", "", `${run.synthesis.text}${marks(run.synthesis)}`, "");
    lines.push(`— ${modelLabel(run.synthesis)}`, "");
  }
  if (run.contributions.length) {
    lines.push("## Parting thoughts from inside the room", "");
    for (const turn of run.contributions) lines.push(`- **${modelLabel(turn)}:** ${turn.text}${marks(turn)}`);
    lines.push("");
  }
  lines.push("## The complete conversation", "");
  for (const round of run.rounds) {
    lines.push(`### ${round.name}`, "");
    for (const turn of round.turns) {
      lines.push(`**${modelLabel(turn)}**`, "", `${turn.text}${marks(turn)}`, "");
    }
  }
  if (notes.length) {
    lines.push("## Notes", "");
    notes.forEach((address, i) => lines.push(`[^${i + 1}]: <${sourceHref(address)}>`));
    lines.push("");
  }
  return lines.join("\n");
}
