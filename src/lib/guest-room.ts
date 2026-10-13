export const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
export const MAX_QUESTION_LENGTH = 6000;
export const MAX_MODELS = 5;
export const FALLBACK_MODEL: GuestModel = {
  id: "z-ai/glm-5.3-flash",
  label: "GLM-5.3 Flash",
  vendor: "Z.ai",
};

export const DEFAULT_MODELS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", vendor: "Anthropic" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", vendor: "OpenAI" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", vendor: "OpenAI" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", vendor: "Google" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", vendor: "DeepSeek" },
] as const;

export type GuestModel = {
  id: string;
  label: string;
  vendor: string;
};

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

export type GuestTurn = {
  model: GuestModel;
  servedModel?: GuestModel;
  text: string;
  latency: number;
  usage: Usage | null;
};

export type LiveTurn = {
  model: GuestModel;
  status: "thinking" | "answering" | "complete" | "failed" | "stopped";
  text: string;
  error?: string;
};

export type GuestRound = {
  name: string;
  turns: GuestTurn[];
};

export type GuestRun = {
  question: string;
  createdAt: string;
  rounds: GuestRound[];
  synthesis: GuestTurn | null;
  errors: string[];
};

type CompletionMessage = {
  role: "system" | "user";
  content: string;
};

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: Usage;
  model?: string;
  error?: { message?: string };
};

export function buildIndependentPrompt(question: string): CompletionMessage[] {
  return [
    {
      role: "system",
      content:
        "Answer in your own voice as concise prose. You are answering independently: " +
        "you have not been told that other models are answering, and you have not seen " +
        "their responses. State uncertainty plainly. Do not use headings or bullet lists.",
    },
    { role: "user", content: question },
  ];
}

export function buildCritiquePrompt(
  question: string,
  model: GuestModel,
  others: GuestTurn[],
): CompletionMessage[] {
  const perspectives = others
    .map((turn) => {
      const responder = turn.servedModel ?? turn.model;
      return `--- ${responder.label} (${responder.vendor}) ---\n${turn.text}`;
    })
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        `You are ${model.label}, one participant in a thoughtful discussion. ` +
        "Respond directly to the other perspectives: identify what you agree with, " +
        "where you disagree, and what important point may be missing. Be candid and " +
        "concise. Do not invent agreement or disagreement.",
    },
    {
      role: "user",
      content:
        `The original question was:\n${question}\n\n` +
        `Other participants answered independently:\n\n${perspectives}`,
    },
  ];
}

export function buildSynthesisPrompt(run: GuestRun): CompletionMessage[] {
  const transcript = run.rounds
    .map(
      (round) =>
        `===== ${round.name} =====\n\n` +
        round.turns
          .map((turn) => `--- ${(turn.servedModel ?? turn.model).label} ---\n${turn.text}`)
          .join("\n\n"),
    )
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "Synthesize the strongest answer supported by this discussion. Preserve meaningful " +
        "disagreement rather than taking a majority vote. Explain what is shared, what " +
        "differs, and what remains uncertain. Do not invent facts or claim consensus where " +
        "there is none. Use concise prose without headings.",
    },
    {
      role: "user",
      content: `Question:\n${run.question}\n\nDiscussion:\n\n${transcript}`,
    },
  ];
}

export async function requestCompletion(
  apiKey: string,
  model: GuestModel,
  messages: CompletionMessage[],
  signal: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<GuestTurn> {
  const startedAt = performance.now();
  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      models:
        model.id === FALLBACK_MODEL.id
          ? [model.id]
          : [model.id, FALLBACK_MODEL.id],
      messages,
      max_tokens: 1600,
      provider: { zdr: true },
      stream: true,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as CompletionResponse | null;
    const message = payload?.error?.message;
    throw new Error(message || `OpenRouter returned HTTP ${response.status}.`);
  }

  if (!response.body) throw new Error("OpenRouter did not return a response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: Usage | null = null;
  let finishReason: string | null = null;
  let servedModel: string | null = null;
  let streamComplete = false;
  let providerError: string | null = null;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      streamComplete = true;
      return;
    }
    let payload: CompletionResponse & {
      choices?: Array<{
        delta?: { content?: string | null };
        finish_reason?: string | null;
      }>;
      model?: string;
    };
    try {
      payload = JSON.parse(data) as typeof payload;
    } catch {
      throw new Error("OpenRouter returned an invalid streaming response.");
    }
    if (payload.error?.message) {
      providerError = payload.error.message;
      return;
    }
    const choice = payload.choices?.[0];
    if (choice?.delta?.content) {
      text += choice.delta.content;
      onDelta?.(choice.delta.content);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (payload.usage) usage = payload.usage;
    if (payload.model) servedModel = payload.model;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      processLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);

  if (providerError) throw new Error(providerError);
  if (finishReason === "length") {
    throw new Error("The response was cut off at the token limit.");
  }
  if (!streamComplete) {
    throw new Error("The response stream ended before OpenRouter marked it complete.");
  }
  const cleanText = text.trim();
  if (!cleanText) throw new Error("The model returned no answer.");

  return {
    model,
    ...(servedModel === FALLBACK_MODEL.id ? { servedModel: FALLBACK_MODEL } : {}),
    text: cleanText,
    latency: Math.round((performance.now() - startedAt) / 100) / 10,
    usage,
  };
}
