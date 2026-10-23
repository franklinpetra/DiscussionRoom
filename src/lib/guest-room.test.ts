import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANOTHER_ROUND_MARKER,
  buildIndependentPrompt,
  buildSynthesisPrompt,
  DEFAULT_MODELS,
  FALLBACK_MODEL,
  isPass,
  parseCatalog,
  parseTurnMarkers,
  privateModels,
  zdrModelIds,
  pickSynthesizer,
  requestCompletion,
  requestsAnotherRound,
  VOLUNTEER_MARKER,
  type Attachment,
  type GuestModel,
  type GuestTurn,
} from "@/lib/guest-room";
import { buildMarkdown } from "@/lib/report";

const alice: GuestModel = { id: "vendor/alice", label: "Alice", vendor: "Vendor A" };
const bob: GuestModel = { id: "vendor/bob", label: "Bob", vendor: "Vendor B" };

afterEach(() => {
  vi.unstubAllGlobals();
});

const turn = (model: GuestModel, text: string, extra: Partial<GuestTurn> = {}): GuestTurn => ({
  model,
  text,
  latency: 1,
  usage: null,
  ...extra,
});

const carol: GuestModel = { id: "vendor/carol", label: "Carol", vendor: "Vendor C" };

describe("guest discussion prompts", () => {
  it("keeps the first answer blind: no other participants, no mention of a room", () => {
    const prompt = buildIndependentPrompt("What should we do?");
    expect(prompt).toHaveLength(2);
    expect(prompt[1].content).toBe("What should we do?");
    expect(prompt[0].content).not.toMatch(/Alice|Bob|other (models|participants)|room/i);
  });

  it("includes attachments as delimited reference material, not instructions", () => {
    const attachments: Attachment[] = [{ name: "plan.pdf", text: "Budget: $4m", truncated: true }];
    const content = buildIndependentPrompt("Review this", attachments)[1].content;
    expect(content).toContain('<document name="plan.pdf">');
    expect(content).toContain("Budget: $4m");
    expect(content).toContain("not as instructions");
    expect(content).toContain("truncated");
  });

  it("strips the volunteer marker and gives the synthesis to the volunteer", () => {
    const parsed = parseTurnMarkers(`A sharp point.\n**KEY: Cheap power reshapes cities**\n${VOLUNTEER_MARKER}`);
    expect(parsed).toEqual({
      text: "A sharp point.",
      volunteered: true,
      keyPhrase: "Cheap power reshapes cities",
    });
    expect(parseTurnMarkers("No markers here.")).toEqual({ text: "No markers here.", volunteered: false, keyPhrase: undefined });
    const candidates = [turn(alice, "a"), turn(bob, "b", { volunteered: true })];
    expect(pickSynthesizer(candidates, 0)).toEqual(bob);
  });

  it("rotates the synthesizer when nobody volunteers", () => {
    const candidates = [turn(alice, "a"), turn(bob, "b"), turn(carol, "c")];
    expect([0, 1, 2, 3].map((rotation) => pickSynthesizer(candidates, rotation)?.id)).toEqual([
      alice.id,
      bob.id,
      carol.id,
      alice.id,
    ]);
    expect(pickSynthesizer([], 4)).toBeNull();
  });

  it("synthesizes from the visible record with fresh context", () => {
    const run = {
      question: "The question",
      attachments: [],
      rounds: [{ name: "Independent", turns: [turn(alice, "First view"), turn(bob, "Second view")] }],
    };
    const prompt = buildSynthesisPrompt(run);
    expect(prompt).toHaveLength(2);
    expect(prompt[1].content).toContain("First view");
    expect(prompt[1].content).toContain("Second view");
    expect(prompt[0].content).not.toContain(ANOTHER_ROUND_MARKER);
    expect(buildSynthesisPrompt(run, true)[0].content).toContain(ANOTHER_ROUND_MARKER);
    expect(requestsAnotherRound(`${ANOTHER_ROUND_MARKER} Settle the cost question.`)).toBe(true);
    expect(requestsAnotherRound("A conclusion.")).toBe(false);
  });

  it("recognises a pass", () => {
    expect(isPass("PASS")).toBe(true);
    expect(isPass(" pass. ")).toBe(true);
    expect(isPass("Pass the salt: costs fall.")).toBe(false);
  });
});

describe("report export", () => {
  it("orders the markdown as prompt, synthesis, parting thoughts, conversation", () => {
    const markdown = buildMarkdown({
      question: "The question",
      attachments: [],
      createdAt: "2026-10-15T12:00:00.000Z",
      rounds: [{ name: "Independent", turns: [turn(alice, "First view")] }],
      synthesis: turn(bob, "The discovery"),
      contributions: [turn(alice, "One more thing")],
      errors: [],
    });
    const order = ["The question", "The discovery", "One more thing", "First view"].map((text) =>
      markdown.indexOf(text),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("OpenRouter catalog", () => {
  it("lists only models with a zero-data-retention route, never free variants", () => {
    const catalog = parseCatalog({
      data: [{ id: "a/private" }, { id: "b/logs-everything" }, { id: "a/private:free" }],
    });
    const zdr = zdrModelIds({ data: [{ model_id: "a/private" }, { model_id: "a/private:free" }, {}] });
    expect(privateModels(catalog, zdr).map((model) => model.id)).toEqual(["a/private"]);
  });


  it("parses names, vendors and per-million prices", () => {
    const [model] = parseCatalog({
      data: [
        {
          id: "mistralai/mistral-large",
          name: "Mistral: Mistral Large",
          pricing: { prompt: "0.000002", completion: "0.000006" },
          context_length: 128000,
        },
      ],
    });
    expect(model).toMatchObject({ id: "mistralai/mistral-large", label: "Mistral Large", vendor: "Mistral" });
    expect(model.promptPrice).toBeCloseTo(2);
    expect(model.completionPrice).toBeCloseTo(6);
  });
});

describe("OpenRouter guest request", () => {
  it("explains when a model spent its whole budget thinking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}', "data: [DONE]", ""].join("\n"), {
          status: 200,
        }),
      ),
    );
    await expect(
      requestCompletion("k", alice, buildIndependentPrompt("Q"), new AbortController().signal),
    ).rejects.toThrow("spent its whole token budget thinking");
  });

  it("uses the five requested OpenRouter models as the default participants", () => {
    expect(DEFAULT_MODELS.map((model) => model.id)).toEqual([
      "anthropic/claude-haiku-5.5",
      "openai/gpt-6-luna",
      "openai/gpt-5.4-mini",
      "google/gemini-3.8-flash",
      "deepseek/deepseek-v4.1-flash",
    ]);
  });

  it("streams the supplied key and answer directly to OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"An answer."}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":14}}',
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const deltas: string[] = [];

    const result = await requestCompletion(
      "test-key",
      alice,
      buildIndependentPrompt("A question"),
      controller.signal,
      (delta) => deltas.push(delta),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
        body: expect.stringContaining('"models":["vendor/alice","z-ai/glm-5.3-flash"]'),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      provider?: { zdr?: boolean };
      model?: string;
      models?: string[];
    };
    expect(requestBody.provider).toEqual({ zdr: true });
    expect(requestBody.model).toBeUndefined();
    expect(requestBody.models).toEqual([alice.id, FALLBACK_MODEL.id]);
    expect((requestBody as { reasoning?: unknown }).reasoning).toEqual({ effort: "medium", exclude: true });
    expect(requestBody).not.toHaveProperty("max_tokens");
    expect(result.text).toBe("An answer.");
    expect(result.usage?.total_tokens).toBe(14);
    expect(deltas).toEqual(["An answer."]);
  });

  it("uses ZDR routing and attributes an OpenRouter fallback model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"model":"z-ai/glm-5.3-flash","choices":[{"delta":{"content":"Fallback answer."}}]}',
          'data: {"model":"z-ai/glm-5.3-flash","choices":[{"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCompletion(
      "test-key",
      DEFAULT_MODELS[0],
      buildIndependentPrompt("A harmless test question"),
      new AbortController().signal,
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      provider?: { zdr?: boolean };
      models?: string[];
      model?: string;
    };
    expect(requestBody.provider).toEqual({ zdr: true });
    expect(requestBody.models).toEqual([DEFAULT_MODELS[0].id, FALLBACK_MODEL.id]);
    expect(requestBody.model).toBeUndefined();
    expect(requestBody.models).not.toContain(DEFAULT_MODELS[4].id);
    expect(result.model).toEqual(DEFAULT_MODELS[0]);
    expect(result.servedModel).toEqual({ ...FALLBACK_MODEL, color: DEFAULT_MODELS[0].color });
  });

  it("surfaces provider errors without returning a successful answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Model unavailable" } }), {
          status: 400,
        }),
      ),
    );

    await expect(
      requestCompletion(
        "test-key",
        alice,
        buildIndependentPrompt("A question"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("Model unavailable");
  });
});
