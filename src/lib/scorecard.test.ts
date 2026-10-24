import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndependentPrompt, buildSynthesisPrompt, PERSON, type GuestModel, type GuestTurn } from "@/lib/guest-room";
import { buildListenPrompt } from "@/lib/floor";
import {
  anonymizer,
  buildJudgePrompt,
  buildSoloPrompt,
  JUDGES,
  parseScorecard,
  pickJudge,
  readScoreHistory,
  recordScorecard,
  recordTap,
  summarize,
  type Scorecard,
} from "@/lib/scorecard";

const opus: GuestModel = { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", vendor: "Anthropic", nickname: "Opus" };
const haiku: GuestModel = { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", vendor: "Anthropic", nickname: "Haiku" };
const gemini: GuestModel = { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", vendor: "Google", nickname: "Gemini" };
const turn = (model: GuestModel, text: string, id?: string): GuestTurn => ({ model, text, latency: 1, usage: null, id });

const blind = [turn(opus, "Opus opening."), turn(gemini, "Gemini opening.")];
const conversation = [
  turn(opus, "Gemini, your point misses rural clinics.", "c1"),
  turn(PERSON, "What about towns?", "p1"),
  turn(gemini, "Opus is right, and Claude Opus 5.5 said it first.", "c2"),
];

describe("the judge", () => {
  it("prefers a strong judge from a company with no seat, else any unseated judge", () => {
    expect(pickJudge([haiku, gemini]).id).toBe("openai/gpt-6.1-sol");
    const allCompanies = [{ ...JUDGES[0] }, haiku, gemini];
    expect(pickJudge(allCompanies).id).toBe("anthropic/claude-opus-5.5");
  });

  it("never tells the judge who said what", () => {
    const content = buildJudgePrompt({
      question: "Q",
      seats: [opus, gemini],
      blind,
      conversation,
      roomAnswer: "The room says Opus was right.",
      soloAnswer: "Alone.",
      roomFirst: true,
    })[1].content;
    expect(content).not.toMatch(/Opus|Gemini|Claude/);
    expect(content).toContain("[T1] Voice A: Voice B, your point misses rural clinics.");
    expect(content).toContain("The person who asked: What about towns?");
    expect(content).toContain("[T2] Voice B: Voice A is right, and Voice A said it first.");
    expect(content).toContain("Answer 1:\nThe room says Voice A was right.");
    expect(content).toContain("The answer written after the discussion is Answer 1.");
  });

  it("leaves ordinary words alone when hiding names", () => {
    const { hide } = anonymizer([{ id: "m/large", label: "Mistral Large 4", vendor: "Mistral", nickname: "Mistral" }]);
    expect(hide("Large hospitals agree with Mistral.")).toBe("Large hospitals agree with Voice A.");
  });
});

describe("reading the scorecard", () => {
  const reply = [
    "BETTER: 2 | The room found the rural-clinic gap.",
    "DISCOVERY: T2 | Rural clinics are the real bottleneck.",
    "DISCOVERY: NONE",
    "SOUND: MOSTLY | One statistic is uncertain.",
    "CHECK: Denmark's 2007 reform cut hospitals by half.",
  ].join("\n");

  it("maps the answer order back to room or solo, and credits the seat that sparked a discovery", () => {
    const card = parseScorecard(reply, conversation, false)!;
    expect(card.better).toBe("room");
    expect(card.discoveries).toEqual([
      { point: "Rural clinics are the real bottleneck.", turnId: "c2", seatId: gemini.id },
    ]);
    expect(card.sound).toBe("mostly");
    expect(card.checks).toEqual(["Denmark's 2007 reform cut hospitals by half."]);
    expect(card.score).toBe(4 + 1 + 2);
    expect(parseScorecard(reply, conversation, true)!.better).toBe("solo");
  });

  it("gives up rather than guessing when the comparison or soundness is missing", () => {
    expect(parseScorecard("DISCOVERY: T1 | Something.", conversation, true)).toBeNull();
  });
});

describe("the record across discussions", () => {
  const store = new Map<string, string>();
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });
  const stubStorage = () =>
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  const card: Scorecard = {
    better: "room",
    betterWhy: "",
    discoveries: [{ point: "x", turnId: "c2", seatId: gemini.id }],
    sound: "solid",
    soundWhy: "",
    checks: [],
    score: 8,
  };

  it("keeps a tap given before the judge finishes, and counts each discussion once", () => {
    stubStorage();
    recordTap(readScoreHistory(), "run1", "learned");
    recordScorecard(readScoreHistory(), "run1", [opus, gemini], card);
    const history = recordScorecard(readScoreHistory(), "run1", [opus, gemini], card);
    expect(history.runs).toEqual([{ id: "run1", tap: "learned", score: 8, better: "room", discoveries: 1 }]);
    expect(history.sparks[gemini.id].count).toBe(1);
    recordTap(readScoreHistory(), "run2", "nothing");
    const summary = summarize(readScoreHistory());
    expect(summary).toMatchObject({ count: 1, averageScore: 8, roomWins: 1, discoveries: 1 });
    expect(summary.taps).toEqual({ changes: 0, learned: 1, nothing: 1 });
  });
});

describe("what the room is told", () => {
  it("tells the blind round, the synthesis and the solo answer who they are writing for", () => {
    for (const messages of [
      buildIndependentPrompt("Q"),
      buildSynthesisPrompt({ question: "Q", attachments: [], rounds: [] }),
      buildSoloPrompt("Q"),
    ]) {
      expect(messages[0].content).toContain("Your reader is earnest");
    }
  });

  it("tells the conversation to listen and build on one another", () => {
    const content = buildListenPrompt({ question: "Q", attachments: [], blind, conversation: [] }, opus, false)!.at(-1)!.content;
    expect(content).toContain("listen well and build on one another");
  });
});
