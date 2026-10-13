import { parseProviderCatalog } from "./contracts";

export const PROVIDER_CATALOG = parseProviderCatalog([
  {
    id: "openai:gpt-5.4",
    provider: "openai",
    modelId: "gpt-5.4",
    displayName: "GPT-5.4",
    capabilities: {
      inputModalities: ["text"],
      streaming: true,
      contextWindow: 1_050_000,
      maxOutputTokens: 8_000,
    },
  },
  {
    id: "anthropic:claude-sonnet-5-5",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    capabilities: {
      inputModalities: ["text"],
      streaming: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 8_000,
    },
  },
  {
    id: "google:gemini-2.5-pro",
    provider: "google",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    capabilities: {
      inputModalities: ["text"],
      streaming: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 8_000,
    },
  },
  {
    id: "openrouter:x-ai/grok-4.6",
    provider: "openrouter",
    modelId: "x-ai/grok-4.6",
    displayName: "Grok 4.6",
    capabilities: {
      inputModalities: ["text"],
      streaming: true,
      contextWindow: 500_000,
      maxOutputTokens: 8_000,
    },
  },
  {
    id: "openrouter:meta/muse-spark-1.3",
    provider: "openrouter",
    modelId: "meta/muse-spark-1.3",
    displayName: "Muse Spark 1.3",
    capabilities: {
      inputModalities: ["text"],
      streaming: true,
      contextWindow: 1_048_576,
      maxOutputTokens: 8_000,
    },
  },
]);
