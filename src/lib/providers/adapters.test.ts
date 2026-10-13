import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProviderCompletion } from "./adapters";
import { parseProviderCatalog, type ProviderCall, type ProviderId } from "./contracts";

function model(provider: ProviderId) {
  return {
    id: `${provider}-test-model`,
    provider,
    modelId: "test-model",
    displayName: "Test model",
    capabilities: {
      inputModalities: ["text" as const],
      streaming: true,
      contextWindow: 10_000,
      maxOutputTokens: 1_000,
    },
  };
}

function sseResponse(events: string[], status = 200) {
  return new Response(events.join(""), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openAiEvents(finishReason = "stop") {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "A result." } }] })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

function request(provider: ProviderId): ProviderCall {
  return {
    model: model(provider),
    apiKey: "test-credential",
    messages: [
      { role: "system", content: "Answer carefully." },
      { role: "user", content: "A test question." },
    ],
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("provider catalog", () => {
  it("accepts configured model capabilities without hard-coding model IDs", () => {
    expect(parseProviderCatalog([model("openai")])).toEqual([model("openai")]);
  });

  it("rejects duplicate model IDs", () => {
    expect(() => parseProviderCatalog([model("openai"), model("anthropic")].map((entry) => ({
      ...entry,
      id: "duplicate",
    })))).toThrow("Duplicate provider model ID");
  });
});

describe("provider adapters", () => {
  it("normalizes OpenAI streaming responses and usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(openAiEvents()));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const result = await requestProviderCompletion({
      ...request("openai"),
      onDelta: (text) => deltas.push(text),
    });
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: "test-model",
      max_completion_tokens: 1_000,
      stream: true,
    });
    expect(result.text).toBe("A result.");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
    expect(deltas).toEqual(["A result."]);
  });

  it("maps Anthropic system prompts and message events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A result."}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestProviderCompletion(request("anthropic"));
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));

    expect(new Headers(options.headers).get("x-api-key")).toBe("test-credential");
    expect(body).toMatchObject({
      system: "Answer carefully.",
      max_tokens: 1_000,
      messages: [{ role: "user", content: "A test question." }],
    });
    expect(result.text).toBe("A result.");
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
  });

  it("maps Google Gemini streaming responses and usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "A result." }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            totalTokenCount: 6,
          },
        })}\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestProviderCompletion(request("google"));
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain("/models/test-model:streamGenerateContent?alt=sse");
    expect(new Headers(options.headers).get("x-goog-api-key")).toBe("test-credential");
    expect(JSON.parse(String(options.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "Answer carefully." }] },
      contents: [{ role: "user", parts: [{ text: "A test question." }] }],
    });
    expect(result.text).toBe("A result.");
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  });

  it("routes additional models through OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(openAiEvents()));
    vi.stubGlobal("fetch", fetchMock);

    await requestProviderCompletion(request("openrouter"));

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );
  });

  it("rejects truncated completions rather than returning partial answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(openAiEvents("length"))));

    await expect(
      requestProviderCompletion(request("openai")),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects Anthropic max-token stop events rather than returning partial answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Partial."}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]),
      ),
    );

    await expect(
      requestProviderCompletion(request("anthropic")),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("surfaces provider HTTP failures without exposing response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("sensitive provider response", { status: 401 }),
      ),
    );

    await expect(
      requestProviderCompletion(request("openai")),
    ).rejects.toThrow("openai rejected the configured credential");
  });

  it("turns provider timeouts into a retryable error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = requestProviderCompletion({
      ...request("openai"),
      timeoutMs: 10,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
