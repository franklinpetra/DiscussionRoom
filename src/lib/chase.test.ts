import { describe, expect, it } from "vitest";
import {
  buildChasePrompt,
  buildIndependentPrompt,
  CHASE,
  parseChase,
  parseTurnMarkers,
  type GuestModel,
  type GuestRun,
  type GuestTurn,
} from "@/lib/guest-room";
import { buildListenPrompt } from "@/lib/floor";
import { buildJudgePrompt, creditableTurns } from "@/lib/scorecard";
import { buildMarkdown, endnotes } from "@/lib/report";
import { accentVoice, pickVoices } from "@/lib/room-scene";
import { CHASE_VOICE, seatVoice } from "@/lib/speech-audio";

const luna: GuestModel = { id: "openai/gpt-6-luna", label: "GPT-6 Luna", vendor: "OpenAI", nickname: "Luna" };
const gemini: GuestModel = { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", vendor: "Google", nickname: "Gemini" };
const turn = (model: GuestModel, text: string, extra: Partial<GuestTurn> = {}): GuestTurn => ({
  model,
  text,
  latency: 1,
  usage: null,
  ...extra,
});

const blind = [turn(luna, "A long answer about triage."), turn(gemini, "A long answer about records.")];
const quip = turn(CHASE, "Same doors, different landlords.", {
  kind: "quip",
  id: "chase-1",
  brief: "Whether a hospital-owned app can ever be neutral.",
});

describe("Chase", () => {
  it("reads every answer and asks for one line plus what the room needs to settle", () => {
    const [system, user] = buildChasePrompt("Q", blind);
    expect(system.content).toContain("eight words or fewer");
    expect(user.content).toContain("--- Luna ---\nA long answer about triage.");
  });

  it("keeps a short line and its brief, and refuses a speech", () => {
    expect(parseChase("**LINE:** \"Same doors, different landlords.\"\nNEEDS: Whether it can be neutral.")).toEqual({
      line: "Same doors, different landlords.",
      brief: "Whether it can be neutral.",
    });
    expect(parseChase(`LINE: ${"word ".repeat(20)}`)).toBeNull();
    expect(parseChase("No format at all.")).toBeNull();
  });

  it("lets the room hear the brief, but the judge never credits Chase with a discovery", () => {
    const listen = buildListenPrompt({ question: "Q", attachments: [], blind, conversation: [quip] }, luna, false)!
      .map((message) => message.content)
      .join("\n");
    expect(listen).toContain("Chase: Same doors, different landlords.");
    expect(listen).toContain("What the room most needs to settle: Whether a hospital-owned app");
    expect(creditableTurns([quip])).toEqual([]);
    const judged = buildJudgePrompt({
      question: "Q",
      seats: [luna, gemini],
      blind,
      conversation: [quip],
      roomAnswer: "R",
      soloAnswer: "S",
      roomFirst: true,
    })[1].content;
    expect(judged).toContain("The room's one-line summary: Same doors, different landlords.");
    expect(judged).not.toContain("[T1]");
  });

  it("speaks with the room's only Australian voice", () => {
    expect(CHASE_VOICE).toBe("en-AU-Isla");
    expect([0, 1, 2, 3, 4, 5].map(seatVoice)).not.toContain(CHASE_VOICE);
    const voices = [
      { name: "Karen", lang: "en-AU" },
      { name: "Samantha", lang: "en-US" },
    ];
    expect(accentVoice(voices)?.name).toBe("Karen");
    expect(pickVoices(voices, 2).map((voice) => voice?.name)).toEqual(["Samantha", "Samantha"]);
  });
});

describe("clearer answers", () => {
  it("asks for the main point first and essentials only", () => {
    const system = buildIndependentPrompt("Q")[0].content;
    expect(system).toContain("Put your main point first");
    expect(system).toContain("give each its essentials in a sentence or two");
  });
});

describe("sources as notes", () => {
  it("takes a SOURCES line out of the spoken text and into the record", () => {
    const parsed = parseTurnMarkers(
      "Continuity saves lives.\nKEY: continuity\nSOURCES: https://doi.org/10.1136/bmjopen-2017-021161; www.sundhed.dk",
    );
    expect(parsed.text).toBe("Continuity saves lives.");
    expect(parsed.keyPhrase).toBe("continuity");
    expect(parsed.sources).toEqual(["https://doi.org/10.1136/bmjopen-2017-021161", "www.sundhed.dk"]);
  });

  it("numbers each source once, in reading order, as endnotes with links", () => {
    const run: GuestRun = {
      question: "Q",
      attachments: [],
      createdAt: "2026-10-24T12:00:00.000Z",
      rounds: [
        { name: "Independent", turns: [turn(luna, "One.", { sources: ["a.org", "b.org"] })] },
        { name: "The conversation", turns: [quip, turn(gemini, "Two.", { id: "c1", sources: ["b.org"] })] },
      ],
      synthesis: turn(luna, "Answer.", { sources: ["b.org"] }),
      contributions: [],
      errors: [],
    };
    const { notes, numbers } = endnotes(run);
    expect(notes).toEqual(["b.org", "a.org"]);
    expect(numbers(run.rounds[0].turns[0])).toEqual([2, 1]);
    const markdown = buildMarkdown(run);
    expect(markdown).toContain("Answer.[^1]");
    expect(markdown).toContain("One.[^2][^1]");
    expect(markdown).toContain("[^1]: <https://b.org>");
    expect(markdown).toContain("[^2]: <https://a.org>");
    expect(markdown).not.toContain("Sources:");
  });
});
