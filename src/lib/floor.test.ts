import { describe, expect, it } from "vitest";
import {
  buildFloorThread,
  buildFloorTurnPrompt,
  buildInterjectionPrompt,
  buildListenPrompt,
  buildPartingPrompt,
  buildReplyPrompt,
  locateQuote,
  parseListen,
  pickNextSpeaker,
  spokenText,
  type FloorContext,
} from "@/lib/floor";
import { PERSON, VOLUNTEER_MARKER, type GuestModel, type GuestTurn, type Hand } from "@/lib/guest-room";
import { buildPlaylist } from "@/lib/room-scene";

const alice: GuestModel = { id: "vendor/alice", label: "Alice", vendor: "Vendor A" };
const bob: GuestModel = { id: "vendor/bob", label: "Bob", vendor: "Vendor B" };
const carol: GuestModel = { id: "vendor/carol", label: "Carol", vendor: "Vendor C" };

const turn = (model: GuestModel, text: string, extra: Partial<GuestTurn> = {}): GuestTurn => ({
  model,
  text,
  latency: 1,
  usage: null,
  ...extra,
});

const blind = [turn(alice, "Alice's blind view."), turn(bob, "Bob's blind view."), turn(carol, "Carol's blind view.")];
const context = (conversation: GuestTurn[] = []): FloorContext => ({
  question: "The question",
  attachments: [],
  blind,
  conversation,
});

const lastContent = (messages: { content: string }[] | null) => messages!.at(-1)!.content;

describe("the unveiling", () => {
  it("keeps a seat's own blind answer as its memory and unveils only the others", () => {
    const thread = buildFloorThread(context(), alice)!;
    expect(thread.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(thread[2].content).toBe("Alice's blind view.");
    expect(thread[3].content).toContain("Bob's blind view.");
    expect(thread[3].content).toContain("Carol's blind view.");
    expect(thread[3].content).not.toContain("Alice's blind view.");
    expect(thread[3].content).toContain("2 other participants");
  });

  it("never brings in a seat that missed the blind round", () => {
    const dan: GuestModel = { id: "vendor/dan", label: "Dan", vendor: "Vendor D" };
    expect(buildFloorThread(context(), dan)).toBeNull();
    expect(buildListenPrompt(context(), dan, true)).toBeNull();
  });

  it("shows the conversation so far, naming the seat's own lines as You", () => {
    const thread = buildFloorThread(context([turn(bob, "Bob speaks."), turn(alice, "Alice adds.")]), alice)!;
    expect(lastContent(thread)).toContain("Bob: Bob speaks.");
    expect(lastContent(thread)).toContain("You: Alice adds.");
  });
});

describe("listening", () => {
  it("asks for something new, not a reply, and offers a break only when allowed", () => {
    const heard = context([turn(bob, "Costs will fall. Cities will change.")]);
    const withBreak = lastContent(buildListenPrompt(heard, alice, true));
    expect(withBreak).toContain("Bob just spoke");
    expect(withBreak).toMatch(/no one has voiced/);
    expect(withBreak).toMatch(/not a contribution/);
    expect(withBreak).toContain("BREAK:");
    expect(lastContent(buildListenPrompt(heard, alice, false))).not.toContain("BREAK:");
  });

  it("never offers a break at the opening or on the person who asked", () => {
    expect(lastContent(buildListenPrompt(context(), alice, true))).not.toContain("BREAK:");
    const person = context([turn(PERSON, "What about rural towns?", { kind: "person" })]);
    const prompt = lastContent(buildListenPrompt(person, alice, true));
    expect(prompt).toContain("The person who asked just joined");
    expect(prompt).not.toContain("BREAK:");
  });

  it("reads pass, hand and break replies", () => {
    const latest = turn(bob, "Costs will fall fast. Cities will empty out. Nobody will notice.");
    expect(parseListen(alice, "PASS", latest)).toBeNull();
    expect(parseListen(alice, "**HAND:** The grid can't carry it", latest)).toEqual({
      model: alice,
      kind: "hand",
      reason: "The grid can't carry it",
    });
    expect(parseListen(alice, 'BREAK: "Cities will empty out" | Wrong: they densify', latest)).toEqual({
      model: alice,
      kind: "break",
      reason: "Wrong: they densify",
      atSentence: 1,
    });
  });

  it("treats a break that quotes nothing real, or the last sentence, as a raised hand", () => {
    const latest = turn(bob, "Costs will fall fast. Cities will empty out.");
    expect(parseListen(alice, 'BREAK: "something Bob never said" | no', latest)?.kind).toBe("hand");
    expect(parseListen(alice, 'BREAK: "Cities will empty out" | too late', latest)?.kind).toBe("hand");
    expect(locateQuote(latest.text, "costs will FALL fast")).toBe(0);
    expect(locateQuote(latest.text, "fall")).toBeNull();
  });
});

describe("taking the floor", () => {
  it("passes the floor to whoever spoke least recently, never twice in a row", () => {
    const conversation = [turn(alice, "a"), turn(bob, "b")];
    const hands: Hand[] = [
      { model: bob, kind: "hand", reason: "more" },
      { model: alice, kind: "hand", reason: "again" },
      { model: carol, kind: "hand", reason: "new" },
    ];
    expect(pickNextSpeaker(hands, conversation, bob.id)?.model).toEqual(carol);
    expect(pickNextSpeaker(hands.slice(0, 2), conversation, bob.id)?.model).toEqual(alice);
    expect(pickNextSpeaker([{ model: bob, kind: "hand", reason: "x" }], conversation, bob.id)).toBeNull();
    expect(pickNextSpeaker([], conversation)).toBeNull();
  });

  it("asks for a short turn that adds what no one said, carrying the hand's intent", () => {
    const prompt = lastContent(buildFloorTurnPrompt(context([turn(bob, "b")]), alice, "the grid can't carry it"));
    expect(prompt).toContain("You raised your hand to add: the grid can't carry it");
    expect(prompt).toMatch(/Say what hasn't been said, in one or two short sentences/);
    expect(prompt).toMatch(/podcast hosts/);
    expect(prompt).toMatch(/reply with exactly PASS/);
    expect(prompt).toMatch(/don't need to address the last speaker/);
    expect(prompt).toContain(VOLUNTEER_MARKER);
  });
});

describe("breaking in", () => {
  const interrupted = turn(bob, "Costs will fall fast. Cities will empty out. Nobody will notice.", { cutAt: 1 });

  it("hears a broken-into turn only up to the break", () => {
    expect(spokenText(interrupted)).toBe("Costs will fall fast. Cities will empty out. —");
    expect(spokenText(turn(bob, "Whole turn."))).toBe("Whole turn.");
  });

  it("gives the interrupter what was said, and the speaker what went unsaid", () => {
    const heard = context([interrupted]);
    const interjection = lastContent(buildInterjectionPrompt(heard, alice, interrupted, "they densify"));
    expect(interjection).toContain("You broke in on Bob");
    expect(interjection).not.toContain("Nobody will notice");
    const reply = lastContent(
      buildReplyPrompt(context([interrupted, turn(alice, "Bob, they densify.")]), bob, interrupted, turn(alice, "Bob, they densify.")),
    );
    expect(reply).toContain("Alice broke in on you");
    expect(reply).toContain('You hadn\'t yet said: "Nobody will notice."');
    expect(buildFloorThread(heard, carol)!.at(-1)!.content).not.toContain("Nobody will notice");
  });
});

describe("the record", () => {
  it("plays a seat's several turns in order, with the break point", () => {
    const run = {
      question: "Q",
      attachments: [],
      createdAt: "2026-10-22T00:00:00Z",
      rounds: [
        { name: "Independent", turns: blind },
        {
          name: "The conversation",
          turns: [
            turn(bob, "One. Two.", { id: "c1", kind: "turn" as const, cutAt: 0 }),
            turn(alice, "Bob, no.", { id: "c2", kind: "interjection" as const }),
            turn(bob, "Fair.", { id: "c3", kind: "reply" as const }),
            turn(PERSON, "And rural towns?", { id: "p1", kind: "person" as const }),
          ],
        },
      ],
      synthesis: null,
      contributions: [],
      errors: [],
    };
    const items = buildPlaylist(run).slice(3);
    expect(items.map((item) => item.key)).toEqual(["c1", "c2", "c3", "p1"]);
    expect(items[0].cutAt).toBe(0);
    expect(items[1].kind).toBe("interjection");
    expect(items[3].seat).toEqual(PERSON);
  });

  it("asks for a parting thought from the whole conversation", () => {
    const prompt = lastContent(buildPartingPrompt(context([turn(bob, "b1"), turn(bob, "b2")]), alice, turn(carol, "The synthesis")));
    expect(prompt).toContain("The synthesis");
    expect(prompt).toContain("PASS");
  });
});

describe("nicknames", () => {
  it("uses family names, and the telling word when two of a family sit together", async () => {
    const { assignNicknames, DEFAULT_MODELS } = await import("@/lib/guest-room");
    expect(assignNicknames([...DEFAULT_MODELS]).map((model) => model.nickname)).toEqual([
      "Claude",
      "Luna",
      "Mini",
      "Gemini",
      "DeepSeek",
    ]);
    const claudes: GuestModel[] = [
      { id: "a", label: "Claude Haiku 5.5", vendor: "Anthropic" },
      { id: "b", label: "Claude Sonnet 5.5", vendor: "Anthropic" },
    ];
    const twoClaudes = assignNicknames(claudes);
    expect(twoClaudes.map((model) => model.nickname)).toEqual(["Haiku", "Sonnet"]);
  });

  it("tells each seat its own name and the others' at the table", () => {
    const named = { ...alice, nickname: "Ali" };
    const thread = buildFloorThread({ ...context(), blind: [turn(named, "A."), ...blind.slice(1)] }, named)!;
    expect(lastContent(thread)).toContain("At this table you go by Ali, and the others by Bob, Carol");
  });
});

describe("sharpen my question", () => {
  it("asks to keep the person's meaning and voice, and to teach what changed", async () => {
    const { buildSharpenPrompt } = await import("@/lib/sharpen");
    const prompt = buildSharpenPrompt("What is the purpose of story?");
    expect(prompt[0].content).toMatch(/Keep their meaning, their subject, their voice/);
    expect(prompt[0].content).toMatch(/never add facts/);
    expect(prompt[0].content).toContain("LESSON:");
    expect(prompt[1].content).toBe("What is the purpose of story?");
  });

  it("reads the suggestion and up to two lessons, and refuses a malformed reply", async () => {
    const { parseSharpened } = await import("@/lib/sharpen");
    expect(
      parseSharpened(
        '**QUESTION:** "Why do we spend so much time on stories that aren\'t true?"\nLESSON: Added a puzzle to chase.\nLESSON: Made it open.\nLESSON: extra',
      ),
    ).toEqual({
      question: "Why do we spend so much time on stories that aren't true?",
      lessons: ["Added a puzzle to chase.", "Made it open."],
    });
    expect(parseSharpened("Sure! Here's a better question.")).toBeNull();
  });
});
