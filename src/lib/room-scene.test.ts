import { describe, expect, it } from "vitest";
import type { GuestModel, GuestRun } from "@/lib/guest-room";
import {
  attentionPoint,
  buildPlaylist,
  captionMilliseconds,
  CENTER,
  facingAngle,
  pickVoices,
  seatPositions,
  splitSentences,
} from "@/lib/room-scene";

describe("room layout", () => {
  it("seats the room in an open oval, symmetric, with the near side left open", () => {
    const seats = seatPositions(5);
    expect(seats[2].x).toBeCloseTo(0);
    expect(seats[2].z).toBeCloseTo(-1);
    expect(seats[0].x).toBeCloseTo(-seats[4].x);
    expect(Math.max(...seats.map((seat) => seat.z))).toBeLessThan(0.5);
  });

  it("turns each chair to face the centre, using the drawn angles", () => {
    const [left, , back, , right] = seatPositions(5);
    expect(facingAngle(back, CENTER)).toBe(0);
    expect(facingAngle(left, CENTER)).toBe(90);
    expect(facingAngle(right, CENTER)).toBe(270);
  });

  it("turns listeners toward the speaker while the speaker addresses the room", () => {
    const [left, , back, , right] = seatPositions(5);
    expect(attentionPoint(back, right, true)).toEqual(CENTER);
    expect(facingAngle(left, attentionPoint(left, right, false))).toBe(90);
    expect(facingAngle(back, attentionPoint(back, right, false))).not.toBe(facingAngle(back, CENTER));
  });
});

describe("playback", () => {
  const a: GuestModel = { id: "x/a", label: "A", vendor: "X", chair: "a" };
  const b: GuestModel = { id: "x/b", label: "B", vendor: "X", chair: "b" };
  const turn = (model: GuestModel, text: string, keyPhrase?: string) => ({
    model, text, latency: 1, usage: null, keyPhrase,
  });

  it("speaks rounds in order, then synthesis, then parting thoughts", () => {
    const run: GuestRun = {
      question: "Q",
      attachments: [],
      createdAt: "2026-10-15T00:00:00.000Z",
      rounds: [
        { name: "Independent", turns: [turn(a, "A one."), turn(b, "B one.")] },
        { name: "The conversation", turns: [turn(a, "A two.", "Key A")] },
      ],
      synthesis: turn(b, "The discovery."),
      contributions: [turn(a, "Parting.")],
      errors: [],
    };
    const items = buildPlaylist(run);
    expect(items.map((item) => item.stage)).toEqual([
      "Independent", "Independent", "The conversation", "Synthesis", "Parting thoughts",
    ]);
    expect(items[2].phrase).toBe("Key A");
    expect(items[0].phrase).toBe("A one.");
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("splits speech into sentences", () => {
    expect(splitSentences("One idea. Another? Yes! Trailing")).toEqual(["One idea.", "Another?", "Yes!", "Trailing"]);
  });

  it("prefers natural English voices and skips novelty ones", () => {
    const voices = [
      { name: "Zarvox", lang: "en-US" },
      { name: "Samantha", lang: "en-US" },
      { name: "Ava (Premium)", lang: "en-US" },
      { name: "Thomas", lang: "fr-FR" },
    ];
    expect(pickVoices(voices, 3).map((voice) => voice?.name)).toEqual(["Ava (Premium)", "Samantha", "Ava (Premium)"]);
    expect(pickVoices([], 2)).toEqual([null, null]);
  });
});

describe("natural voices and key checks", async () => {
  const { sentenceAt, seatVoice } = await import("@/lib/speech-audio");
  const { adviceFor } = await import("@/lib/openrouter-check");

  it("follows the audio sentence by sentence and gives each seat its own voice", () => {
    const sentences = ["Short.", "A much longer second sentence here."];
    expect(sentenceAt(sentences, 0.1)).toBe(0);
    expect(sentenceAt(sentences, 0.6)).toBe(1);
    expect(sentenceAt(sentences, 1)).toBe(1);
    expect(new Set([0, 1, 2, 3, 4].map(seatVoice)).size).toBe(5);
  });

  it("points each OpenRouter failure at the setting that causes it", () => {
    expect(adviceFor(401, "User not found.")).toContain("isn't recognised");
    expect(adviceFor(402, "This request requires more credits")).toContain("Credits");
    expect(adviceFor(404, "No endpoints found matching your data policy")).toContain("Privacy");
    expect(adviceFor(403, "Blocked by guardrail")).toContain("Guardrails");
    expect(adviceFor(429, "Rate limit exceeded")).toContain("Rate limited");
  });
});

describe("caption timing", () => {
  it("uses a reading estimate before anyone has spoken, instead of crashing", () => {
    // The room's opening moment: no current turn and no recording yet (this took the page down).
    expect(captionMilliseconds("", "", 1, null, undefined)).toBe(2600);
  });

  it("follows the recording's length once this turn's voice has loaded", () => {
    const text = "One. Two.";
    expect(captionMilliseconds("One.", text, 1, { key: "t1", seconds: 10 }, "t1")).toBe(4444);
  });

  it("ignores a recording that belongs to another turn", () => {
    const estimate = captionMilliseconds("One.", "One. Two.", 1, null, "t2");
    expect(captionMilliseconds("One.", "One. Two.", 1, { key: "t1", seconds: 10 }, "t2")).toBe(estimate);
  });
});
