import { describe, expect, it } from "vitest";
import { buildSketchPrompt, parseSketch } from "@/lib/sketch";
import type { GuestTurn } from "@/lib/guest-room";

const turn = (text: string): GuestTurn => ({ model: { id: "a", label: "Alice", vendor: "A", nickname: "Ali" }, text, latency: 1, usage: null, id: "c1" });

describe("the artist's sketches", () => {
  it("asks for a napkin sketch of the last turn, strokes only, or PASS", () => {
    const prompt = buildSketchPrompt("Q", [turn("Earlier.")], turn("Bridges carry trust."));
    expect(prompt[0].content).toMatch(/napkin sketches/);
    expect(prompt[0].content).toMatch(/Strokes only/);
    expect(prompt[0].content).toContain("PASS");
    expect(prompt[1].content).toContain("Draw what Ali just said:\nBridges carry trust.");
  });

  it("keeps simple shapes with valid coordinates", () => {
    const shapes = parseSketch(
      '```svg\n<svg viewBox="0 0 400 240"><path d="M10 20 C 40 10, 60 30, 90 20" stroke-width="2"/>' +
        '<circle cx="200" cy="120" r="30"/><text x="180" y="200">trust</text></svg>\n```',
    );
    expect(shapes).toEqual([
      { tag: "path", attrs: { d: "M10 20 C 40 10, 60 30, 90 20", "stroke-width": "2" } },
      { tag: "circle", attrs: { cx: "200", cy: "120", r: "30" } },
      { tag: "text", attrs: { x: "180", y: "200" }, text: "trust" },
    ]);
  });

  it("drops anything that could run code, link out or restyle the page", () => {
    const shapes = parseSketch(
      '<svg><script>alert(1)</script><path d="M0 0 L10 10" onclick="alert(1)" style="fill:red"/>' +
        '<image href="javascript:alert(1)"/><foreignObject><div>x</div></foreignObject>' +
        '<circle cx="javascript:1" cy="2" r="3"/><a href="https://x.example"><line x1="0" y1="0" x2="5" y2="5"/></a>' +
        '<path d="M0 0 url(evil)"/><rect x="1" y="1" width="5" height="5" transform="translate(5,5) rotate(10)"/></svg>',
    );
    expect(shapes).toEqual([
      { tag: "path", attrs: { d: "M0 0 L10 10" } },
      { tag: "line", attrs: { x1: "0", y1: "0", x2: "5", y2: "5" } },
      { tag: "rect", attrs: { x: "1", y: "1", width: "5", height: "5", transform: "translate(5,5) rotate(10)" } },
    ]);
  });

  it("treats a pass, or no usable drawing, as nothing to draw", () => {
    expect(parseSketch("PASS")).toBeNull();
    expect(parseSketch("Here is a sketch idea.")).toBeNull();
    expect(parseSketch('<svg><script>x</script></svg>')).toBeNull();
  });
});
