import { describe, expect, it } from "vitest";
import { PROVIDER_CATALOG } from "./catalog";

describe("initial provider model catalog", () => {
  it("keeps the five selected discussion participants available", () => {
    expect(PROVIDER_CATALOG.map(({ displayName }) => displayName)).toEqual([
      "GPT-5.4",
      "Claude Sonnet 5.5",
      "Gemini 2.5 Pro",
      "Grok 4.6",
      "Muse Spark 1.3",
    ]);
    expect(PROVIDER_CATALOG.map(({ provider }) => provider)).toEqual([
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "openrouter",
    ]);
  });

  it("limits every model to text streaming and the Room's 8,000-token output cap", () => {
    for (const model of PROVIDER_CATALOG) {
      expect(model.capabilities).toMatchObject({
        inputModalities: ["text"],
        streaming: true,
        maxOutputTokens: 8_000,
      });
      expect(model.modelId).toBeTruthy();
      expect(model.capabilities.contextWindow).toBeGreaterThan(0);
    }
  });
});
