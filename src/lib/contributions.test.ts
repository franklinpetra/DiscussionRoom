import { describe, expect, it } from "vitest";
import {
  buildJudgePrompt,
  emptyCounts,
  judgedTurns,
  parseVerdicts,
  pickJudge,
  recordHistory,
  tally,
} from "@/lib/contributions";
import { DEFAULT_MODELS, FALLBACK_MODEL, PERSON, type GuestModel, type GuestTurn } from "@/lib/guest-room";

const alice: GuestModel = { id: "vendor/alice", label: "Alice", vendor: "A", nickname: "Ali" };
const bob: GuestModel = { id: "vendor/bob", label: "Bob", vendor: "B" };
const turn = (model: GuestModel, text: string, id?: string): GuestTurn => ({ model, text, latency: 1, usage: null, id });

const conversation = [
  turn(alice, "A new angle.", "c1"),
  turn(PERSON, "What about towns?", "p1"),
  turn(bob, "Same as Alice said.", "c2"),
  turn(alice, "Let me clarify.", "c3"),
];

describe("contributions", () => {
  it("picks a judge with no seat at the table", () => {
    expect(pickJudge([...DEFAULT_MODELS]).id).toBe(FALLBACK_MODEL.id);
    expect(pickJudge([DEFAULT_MODELS[1]]).id).toBe(DEFAULT_MODELS[0].id);
  });

  it("numbers only the models' turns and shows the person as context", () => {
    expect(judgedTurns(conversation).map((t) => t.id)).toEqual(["c1", "c2", "c3"]);
    const content = buildJudgePrompt("Q", [turn(alice, "Blind A"), turn(bob, "Blind B")], conversation)[1].content;
    expect(content).toContain("[T1] Ali: A new angle.");
    expect(content).toContain("The person who asked: What about towns?");
    expect(content).toContain("[T3] Ali: Let me clarify.");
    expect(content).toContain("Blind B");
  });

  it("reads verdicts, skipping unreadable lines and unknown kinds", () => {
    const verdicts = parseVerdicts(
      "**T1: new | first to raise towns**\nT2: repeat | echoes Ali\nT3 - brilliant | ?\nnoise",
      conversation,
    );
    expect(verdicts).toEqual({
      c1: { kind: "new", reason: "first to raise towns" },
      c2: { kind: "repeat", reason: "echoes Ali" },
    });
  });

  it("tallies by seat and records each discussion once", () => {
    const counts = tally([alice, bob], conversation, {
      c1: { kind: "new", reason: "" },
      c2: { kind: "repeat", reason: "" },
      c3: { kind: "clarify", reason: "" },
    });
    expect(counts.get(alice.id)).toEqual({ ...emptyCounts(), new: 1, clarify: 1 });
    expect(counts.get(bob.id)).toEqual({ ...emptyCounts(), repeat: 1 });
    const once = recordHistory({ runs: [], models: {} }, "run-1", [alice, bob], counts);
    const twice = recordHistory(once, "run-1", [alice, bob], counts);
    expect(twice).toBe(once);
    expect(recordHistory(once, "run-2", [alice, bob], counts).models[alice.id].counts.new).toBe(2);
  });
});
