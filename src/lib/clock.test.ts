import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressee,
  askSeat,
  buildMusicPrompt,
  buildSeatPrompt,
  findMedia,
  KITS,
  MAX_SEATED,
  parsePalette,
  SEATS,
  seatById,
  splitPage,
  splitSources,
  stagesOf,
} from "@/lib/clock";

const slant = { feel: "warm", spirit: "playful", forWhom: "a tired nurse" };

afterEach(() => vi.unstubAllGlobals());

describe("the clock's seats", () => {
  it("every kit fits on the face and names real seats", () => {
    for (const kit of KITS) {
      expect(kit.seats.length).toBeLessThanOrEqual(MAX_SEATED);
      for (const id of kit.seats) expect(seatById(id)).toBeDefined();
    }
    expect(new Set(SEATS.map((seat) => seat.id)).size).toBe(SEATS.length);
  });

  it("works in stages: thinkers, then shapers, then the interface, then makers, then testers", () => {
    const stages = stagesOf(["testers", "interface", "spark", "look", "voice", "people"]);
    expect(stages.map((stage) => stage.map((seat) => seat.id))).toEqual([
      ["spark", "people"],
      ["look"],
      ["interface"],
      ["voice"],
      ["testers"],
    ]);
  });

  it("answers a message from the seat it names, else Spark", () => {
    expect(addressee("Interface, make it one screen", ["spark", "interface"])?.id).toBe("interface");
    expect(addressee("what about cost?", ["spark", "interface"])?.id).toBe("spark");
    expect(addressee("what about cost?", ["interface", "voice"])?.id).toBe("voice");
  });
});

describe("prompts", () => {
  it("gives each seat the brief, the slant, the room so far and the person's request", () => {
    const interface_ = seatById("interface")!;
    const [system, user] = buildSeatPrompt(
      interface_,
      "A shift-handover app",
      slant,
      [
        { seatId: "flow", text: "1. Open. 2. Tap." },
        { seatId: "look", text: "Soft.", palette: ["#112233"] },
        { seatId: "scout", text: "", error: "down" },
      ],
      "make it one screen",
    );
    expect(system.content).toContain("You are Interface at the Clock");
    expect(system.content).toContain("feel warm; spirit playful; made for a tired nurse.");
    expect(user.content).toContain("--- Flow ---\n1. Open. 2. Tap.");
    expect(user.content).toContain("Palette: #112233");
    expect(user.content).not.toContain("Scout");
    expect(user.content).toContain("The person now asks you: make it one screen");
  });

  it("shows testers the prototype's code, and tells other writers only that it exists", () => {
    const making = { seatId: "interface", text: "Two screens.", html: "<html>PROTOTYPE</html>" };
    expect(buildSeatPrompt(seatById("testers")!, "B", slant, [making])[1].content).toContain("PROTOTYPE");
    const voice = buildSeatPrompt(seatById("voice")!, "B", slant, [making])[1].content;
    expect(voice).not.toContain("PROTOTYPE");
    expect(voice).toContain("Interface built a page you can click.");
  });

  it("sends the music model only the project and the slant", () => {
    expect(buildMusicPrompt("A  shift\nhandover app", slant)).toBe(
      "A 30-second instrumental theme, no vocals, for this project: A shift handover app. Feel: warm. Spirit: playful. Made for a tired nurse.",
    );
  });
});

describe("reading what seats make", () => {
  it("separates a page from the words around it", () => {
    expect(splitPage("Two screens.\n```html\n<!doctype html><p>hi</p>\n```")).toEqual({
      text: "Two screens.",
      html: "<!doctype html><p>hi</p>",
    });
    expect(splitPage("Just words.")).toEqual({ text: "Just words." });
  });

  it("keeps sources as notes and a palette as colours", () => {
    expect(splitSources("Fact.\nSOURCES: https://a.org/x; b.gov")).toEqual({ text: "Fact.", sources: ["https://a.org/x", "b.gov"] });
    expect(parsePalette("PALETTE: #AABBCC, #123, teal\nCalm and warm.")).toEqual({ text: "Calm and warm.", palette: ["#AABBCC", "#123"] });
  });

  it("finds a picture or a theme wherever the model puts it", () => {
    expect(findMedia({ images: [{ image_url: { url: "data:image/png;base64,AAA" } }] }, "image")).toBe("data:image/png;base64,AAA");
    const data = "Q".repeat(300);
    expect(findMedia({ audio: { data, format: "mp3" } }, "audio")).toBe(`data:audio/mpeg;base64,${data}`);
    expect(findMedia({ content: "no media" }, "audio")).toBeUndefined();
  });

  it("asks a writing seat privately, with a fallback, and keeps search citations as sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Closest is X [1]." } }], citations: ["https://patents.google.com/patent/US1"] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await askSeat("k", seatById("scout")!, [{ role: "user", content: "Q" }], new AbortController().signal);
    expect(result.text).toBe("Closest is X.");
    expect(result.sources).toEqual(["https://patents.google.com/patent/US1"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.models).toEqual(["perplexity/sonar-pro", "z-ai/glm-5.3-flash"]);
    expect(body.provider).toEqual({ zdr: true });
  });

  it("says so when a page or a theme doesn't come back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Sorry." } }] }), { status: 200 })));
    await expect(askSeat("k", seatById("interface")!, [], new AbortController().signal)).rejects.toThrow("didn't come back complete");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Lyrics." } }] }), { status: 200 })));
    await expect(askSeat("k", seatById("sound")!, [], new AbortController().signal)).rejects.toThrow("without any audio");
  });
});
