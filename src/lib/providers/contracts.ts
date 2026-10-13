import { z } from "zod";

export const providerIds = ["openai", "anthropic", "google", "openrouter"] as const;

const modelSchema = z.object({
  id: z.string().trim().min(1).max(160),
  provider: z.enum(providerIds),
  modelId: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(80),
  capabilities: z.object({
    inputModalities: z.array(z.literal("text")).min(1),
    streaming: z.boolean(),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  }),
});

export type ProviderId = (typeof providerIds)[number];
export type ProviderModel = z.infer<typeof modelSchema>;
export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};
export type ProviderCompletion = {
  model: ProviderModel;
  text: string;
  usage: ProviderUsage | null;
  finishReason: string;
};
export type ProviderCall = {
  model: ProviderModel;
  apiKey: string;
  messages: ProviderMessage[];
  signal: AbortSignal;
  maxOutputTokens?: number;
  timeoutMs?: number;
  onDelta?: (text: string) => void;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_request"
      | "unauthorized"
      | "rate_limited"
      | "provider_unavailable"
      | "provider_rejected"
      | "timeout"
      | "cancelled"
      | "network_error"
      | "invalid_response",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function parseProviderCatalog(input: unknown): ProviderModel[] {
  const parsed = z.array(modelSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error("The provider model catalog is invalid.");
  }

  const ids = new Set<string>();
  for (const model of parsed.data) {
    if (ids.has(model.id)) {
      throw new Error(`Duplicate provider model ID: ${model.id}`);
    }
    ids.add(model.id);
  }
  return parsed.data;
}
