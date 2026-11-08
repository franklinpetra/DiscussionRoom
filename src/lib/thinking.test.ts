import { describe, expect, it } from "vitest";
import { buildIndependentPrompt, parseTurnMarkers } from "@/lib/guest-room";
import { hasThinkingMarks, nextWordEnd, revealDelay, stripThinking, thoughts } from "@/lib/thinking";

const marked =
  "Rent caps look like a gift to tenants. *Or are they?* **The real winner is the landlord who never has a vacancy.** " +
  "((I may be overstating it.)) Turnover is ~~cheap~~ ruinous.";

describe("thinking aloud", () => {
  it("splits marked text into styled runs", () => {
    expect(thoughts(marked).map((thought) => thought.kind)).toEqual([
      "plain", "aside", "plain", "bold", "plain", "hedge", "plain", "struck", "plain",
    ]);
    expect(thoughts(marked)[3].text).toBe("The real winner is the landlord who never has a vacancy.");
  });

  it("styles a mark still open while the text streams in", () => {
    expect(thoughts("Plain then **landing on")).toEqual([
      { kind: "plain", text: "Plain then " },
      { kind: "bold", text: "landing on" },
    ]);
  });

  it("gives everyone else the plain text, without the struck-out words", () => {
    expect(stripThinking(marked)).toBe(
      "Rent caps look like a gift to tenants. Or are they? The real winner is the landlord who never has a vacancy. " +
        "I may be overstating it. Turnover is ruinous.",
    );
    expect(stripThinking("No marks at all.")).toBe("No marks at all.");
    expect(hasThinkingMarks("No marks at all.")).toBe(false);
    expect(hasThinkingMarks(marked)).toBe(true);
  });

  it("keeps the KEY line out, and asks the blind round for a light hand", () => {
    const parsed = parseTurnMarkers(`${marked}\nKEY: vacancies are the cost`);
    expect(parsed.keyPhrase).toBe("vacancies are the cost");
    expect(stripThinking(parsed.text)).not.toContain("**");
    expect(buildIndependentPrompt("Q")[0].content).toContain("a few marks in all");
  });

  it("paces words like thinking, and catches up when far behind", () => {
    expect(revealDelay("word, ", 0)).toBeGreaterThan(revealDelay("word ", 0));
    expect(revealDelay("end. ", 0)).toBeGreaterThan(revealDelay("word, ", 0));
    expect(revealDelay("end. ", 500)).toBe(12);
    expect(nextWordEnd("one two three", 0)).toBe(4);
    expect(nextWordEnd("one two", 4)).toBe(7);
  });
});
