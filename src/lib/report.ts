import { modelLabel, type GuestRun } from "@/lib/guest-room";

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
  const lines: string[] = [
    "# The Room",
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
    lines.push("## The synthesis", "", run.synthesis.text, "");
    if (run.synthesis.sources?.length) lines.push(`Sources: ${run.synthesis.sources.join(" · ")}`, "");
    lines.push(`— ${modelLabel(run.synthesis)}`, "");
  }
  if (run.contributions.length) {
    lines.push("## Parting thoughts from inside the room", "");
    for (const turn of run.contributions) lines.push(`- **${modelLabel(turn)}:** ${turn.text}`);
    lines.push("");
  }
  lines.push("## The complete conversation", "");
  for (const round of run.rounds) {
    lines.push(`### ${round.name}`, "");
    for (const turn of round.turns) {
      lines.push(`**${modelLabel(turn)}**`, "", turn.text, "");
      if (turn.sources?.length) lines.push(`Sources: ${turn.sources.join(" · ")}`, "");
    }
  }
  return lines.join("\n");
}
