import "server-only";
import {
  parseProviderCatalog,
  ProviderError,
  type ProviderCall,
  type ProviderCompletion,
  type ProviderId,
  type ProviderMessage,
  type ProviderUsage,
} from "./contracts";

type Frame = {
  text?: string;
  usage?: ProviderUsage;
  finishReason?: string;
  done?: boolean;
};

type RequestConfig = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  decode: (payload: Record<string, unknown>, event?: string) => Frame;
};

type ProviderAdapter = {
  id: ProviderId;
  configure: (call: ProviderCall, maxOutputTokens: number) => RequestConfig;
};

const MAX_RESPONSE_CHARACTERS = 200_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_MESSAGES = 64;
const MAX_PROMPT_CHARACTERS = 120_000;

function messagesForChat(messages: ProviderMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOpenAiUsage(value: unknown): ProviderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = readNumber(usage.prompt_tokens);
  const outputTokens = readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function readGoogleUsage(value: unknown): ProviderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = readNumber(usage.promptTokenCount);
  const outputTokens = readNumber(usage.candidatesTokenCount);
  const totalTokens = readNumber(usage.totalTokenCount);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

const openAiCompatibleDecoder: RequestConfig["decode"] = (payload) => {
  const choices = payload.choices;
  const firstChoice =
    Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : undefined;
  const delta =
    firstChoice?.delta && typeof firstChoice.delta === "object"
      ? (firstChoice.delta as Record<string, unknown>)
      : undefined;
  return {
    text: readString(delta?.content),
    usage: readOpenAiUsage(payload.usage),
    finishReason: readString(firstChoice?.finish_reason),
    done: false,
  };
};

const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: {
    id: "openai",
    configure(call, maxOutputTokens) {
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${call.apiKey}`,
          "Content-Type": "application/json",
        },
        body: {
          model: call.model.modelId,
          messages: messagesForChat(call.messages),
          max_completion_tokens: maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
        decode: openAiCompatibleDecoder,
      };
    },
  },
  anthropic: {
    id: "anthropic",
    configure(call, maxOutputTokens) {
      const system = call.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const messages = call.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        }));
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": call.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: {
          model: call.model.modelId,
          max_tokens: maxOutputTokens,
          stream: true,
          ...(system ? { system } : {}),
          messages,
        },
        decode(payload, event) {
          const delta =
            payload.delta && typeof payload.delta === "object"
              ? (payload.delta as Record<string, unknown>)
              : undefined;
          const message =
            payload.message && typeof payload.message === "object"
              ? (payload.message as Record<string, unknown>)
              : undefined;
          const rawUsage = payload.usage ?? message?.usage;
          const usage =
            rawUsage && typeof rawUsage === "object"
              ? (rawUsage as Record<string, unknown>)
              : undefined;
          const inputTokens = readNumber(usage?.input_tokens);
          const outputTokens = readNumber(usage?.output_tokens);
          return {
            text:
              payload.type === "content_block_delta" && delta?.type === "text_delta"
                ? readString(delta.text)
                : undefined,
            usage: usage
              ? {
                  ...(inputTokens !== undefined ? { inputTokens } : {}),
                  ...(outputTokens !== undefined ? { outputTokens } : {}),
                }
              : undefined,
            finishReason:
              payload.type === "message_delta" && delta
                ? readString(delta.stop_reason)
                : undefined,
            done: event === "message_stop" || payload.type === "message_stop",
          };
        },
      };
    },
  },
  google: {
    id: "google",
    configure(call, maxOutputTokens) {
      const system = call.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const contents = call.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        }));
      return {
        url:
          `https://generativelanguage.googleapis.com/v1beta/models/` +
          `${encodeURIComponent(call.model.modelId)}:streamGenerateContent?alt=sse`,
        headers: {
          "x-goog-api-key": call.apiKey,
          "Content-Type": "application/json",
        },
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens },
        },
        decode(payload) {
          const candidates = payload.candidates;
          const candidate =
            Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object"
              ? (candidates[0] as Record<string, unknown>)
              : undefined;
          const content =
            candidate?.content && typeof candidate.content === "object"
              ? (candidate.content as Record<string, unknown>)
              : undefined;
          const parts = content?.parts;
          const text = Array.isArray(parts)
            ? parts
                .filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
                .map((part) => readString(part.text) ?? "")
                .join("")
            : undefined;
          return {
            text: text || undefined,
            usage: readGoogleUsage(payload.usageMetadata),
            finishReason: readString(candidate?.finishReason),
            done: !!candidate?.finishReason,
          };
        },
      };
    },
  },
  openrouter: {
    id: "openrouter",
    configure(call, maxOutputTokens) {
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${call.apiKey}`,
          "Content-Type": "application/json",
        },
        body: {
          model: call.model.modelId,
          messages: messagesForChat(call.messages),
          max_tokens: maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
        decode: openAiCompatibleDecoder,
      };
    },
  },
};

function validateCall(call: ProviderCall): number {
  parseProviderCatalog([call.model]);
  if (!call.apiKey.trim()) {
    throw new ProviderError("A provider credential is required.", "invalid_request");
  }
  if (!call.model.capabilities.streaming || !call.model.capabilities.inputModalities.includes("text")) {
    throw new ProviderError("The selected model does not support text streaming.", "invalid_request");
  }
  if (!call.messages.length || call.messages.length > MAX_MESSAGES) {
    throw new ProviderError("The request has an invalid number of messages.", "invalid_request");
  }
  const promptSize = call.messages.reduce((total, message) => {
    if (!message.content.trim()) {
      throw new ProviderError("Messages cannot be empty.", "invalid_request");
    }
    return total + message.content.length;
  }, 0);
  if (promptSize > MAX_PROMPT_CHARACTERS) {
    throw new ProviderError("The request exceeds the supported prompt size.", "invalid_request");
  }

  const requestedTokens = call.maxOutputTokens ?? call.model.capabilities.maxOutputTokens;
  const maxOutputTokens = Math.min(
    requestedTokens,
    call.model.capabilities.maxOutputTokens,
  );
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new ProviderError("The output token limit is invalid.", "invalid_request");
  }
  const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ProviderError("The provider timeout is invalid.", "invalid_request");
  }
  return maxOutputTokens;
}

function classifyHttpError(provider: ProviderId, status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(`${provider} rejected the configured credential.`, "unauthorized");
  }
  if (status === 429) {
    return new ProviderError(`${provider} rate limited the request.`, "rate_limited", true);
  }
  if (status >= 500) {
    return new ProviderError(`${provider} is temporarily unavailable.`, "provider_unavailable", true);
  }
  return new ProviderError(
    `${provider} rejected the request (HTTP ${status}).`,
    "provider_rejected",
  );
}

async function readStream(
  response: Response,
  provider: ProviderId,
  decode: RequestConfig["decode"],
  onDelta?: (text: string) => void,
): Promise<{ text: string; usage: ProviderUsage | null; finishReason: string }> {
  if (!response.body) {
    throw new ProviderError(`${provider} returned no response stream.`, "invalid_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let dataLines: string[] = [];
  let text = "";
  let usage: ProviderUsage | null = null;
  let finishReason: string | undefined;
  let streamDone = false;

  const processEvent = () => {
    if (!dataLines.length) {
      event = "";
      return;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") {
      streamDone = true;
      event = "";
      return;
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected an object.");
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new ProviderError(`${provider} returned an invalid event.`, "invalid_response");
    }
    if (payload.error) {
      throw new ProviderError(`${provider} returned an error event.`, "provider_rejected");
    }
    const frame = decode(payload, event);
    if (frame.text) {
      text += frame.text;
      if (text.length > MAX_RESPONSE_CHARACTERS) {
        throw new ProviderError(`${provider} exceeded the response size limit.`, "invalid_response");
      }
      onDelta?.(frame.text);
    }
    if (frame.usage) usage = { ...usage, ...frame.usage };
    if (frame.finishReason) finishReason = frame.finishReason;
    if (frame.done) streamDone = true;
    event = "";
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          processEvent();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
      else if (buffer.startsWith("event:")) event = buffer.slice(6).trim();
    }
    processEvent();
  } finally {
    reader.releaseLock();
  }

  const cleanText = text.trim();
  if (!streamDone || !finishReason || !cleanText) {
    throw new ProviderError(`${provider} ended the response before completion.`, "invalid_response");
  }
  if (["length", "max_tokens"].includes(finishReason.toLowerCase())) {
    throw new ProviderError(`${provider} truncated the response at its token limit.`, "invalid_response");
  }
  return { text: cleanText, usage, finishReason };
}

export async function requestProviderCompletion(
  call: ProviderCall,
): Promise<ProviderCompletion> {
  const maxOutputTokens = validateCall(call);
  const adapter = adapters[call.model.provider];
  const config = adapter.configure(call, maxOutputTokens);
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const signal = AbortSignal.any([call.signal, timeoutController.signal]);

  try {
    let response: Response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(config.body),
        signal,
      });
    } catch {
      if (timeoutController.signal.aborted) {
        throw new ProviderError(`${adapter.id} request timed out.`, "timeout", true);
      }
      if (call.signal.aborted) {
        throw new ProviderError(`${adapter.id} request was cancelled.`, "cancelled");
      }
      throw new ProviderError(`Unable to reach ${adapter.id}.`, "network_error", true);
    }
    if (!response.ok) throw classifyHttpError(adapter.id, response.status);

    let result: Awaited<ReturnType<typeof readStream>>;
    try {
      result = await readStream(response, adapter.id, config.decode, call.onDelta);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (timeoutController.signal.aborted) {
        throw new ProviderError(`${adapter.id} request timed out.`, "timeout", true);
      }
      if (call.signal.aborted) {
        throw new ProviderError(`${adapter.id} request was cancelled.`, "cancelled");
      }
      throw new ProviderError(
        `${adapter.id} response stream was interrupted.`,
        "network_error",
        true,
      );
    }
    return { model: call.model, ...result };
  } finally {
    clearTimeout(timeout);
  }
}
