import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCritiquePrompt,
  buildIndependentPrompt,
  buildSynthesisPrompt,
  DEFAULT_MODELS,
  FALLBACK_MODEL,
  requestCompletion,
  type GuestModel,
  type GuestRun,
  type GuestTurn,
} from "@/lib/guest-room";

const alice: GuestModel = { id: "vendor/alice", label: "Alice", vendor: "Vendor A" };
const bob: GuestModel = { id: "vendor/bob", label: "Bob", vendor: "Vendor B" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guest discussion prompts", () => {
  it("keeps the first answer independent of other participants", () => {
    const prompt = buildIndependentPrompt("What should we do?");
    expect(prompt).toHaveLength(2);
    expect(prompt[1].content).toBe("What should we do?");
    expect(prompt[0].content).not.toContain("Alice");
    expect(prompt[0].content).not.toContain("Bob");
  });

  it("shows each participant only the other participant's answer during critique", () => {
    const aliceTurn: GuestTurn = {
      model: alice,
      text: "Alice's view",
      latency: 1,
      usage: null,
    };
    const bobTurn: GuestTurn = {
      model: bob,
      text: "Bob's view",
      latency: 1,
      usage: null,
    };
    const prompt = buildCritiquePrompt("The question", alice, [bobTurn]);
    expect(prompt[1].content).toContain("Bob's view");
    expect(prompt[1].content).not.toContain("Alice's view");
    expect(buildCritiquePrompt("The question", bob, [aliceTurn])[1].content).toContain(
      "Alice's view",
    );
  });

  it("synthesizes from the visible discussion transcript", () => {
    const run: GuestRun = {
      question: "The question",
      createdAt: "2026-01-01T00:00:00.000Z",
      rounds: [
        {
          name: "Independent answers",
          turns: [
            { model: alice, text: "First view", latency: 1, usage: null },
            { model: bob, text: "Second view", latency: 1, usage: null },
          ],
        },
      ],
      synthesis: null,
      errors: [],
    };
    const prompt = buildSynthesisPrompt(run);
    expect(prompt[1].content).toContain("First view");
    expect(prompt[1].content).toContain("Second view");
    expect(prompt[1].content).toContain("The question");
  });
});

describe("OpenRouter guest request", () => {
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
    expect(result.servedModel).toEqual(FALLBACK_MODEL);
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
