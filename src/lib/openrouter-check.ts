import { OPENROUTER_API, type GuestModel } from "@/lib/guest-room";
import { requestSpeech, SPEECH_MODEL } from "@/lib/speech-audio";

export type KeyInfo = {
  label?: string;
  limit?: number | null;
  limit_remaining?: number | null;
  limit_reset?: string | null;
  usage?: number;
  is_free_tier?: boolean;
  expires_at?: string | null;
};

export type CheckResult = { name: string; ok: boolean; detail: string; advice?: string };

type ErrorPayload = { error?: { code?: number; message?: string; metadata?: Record<string, unknown> } };

/** Turns an OpenRouter error into where to look in the OpenRouter dashboard. */
export function adviceFor(status: number, message: string): string | undefined {
  const text = message.toLowerCase();
  if (status === 401 || text.includes("user not found") || text.includes("no auth")) {
    return "The key isn't recognised. Check it was copied completely, hasn't been deleted or expired, and paste it again.";
  }
  if (text.includes("guardrail") || text.includes("data region")) {
    return "A guardrail is blocking this. In OpenRouter, open Settings → Guardrails (and your workspace's default guardrail) and allow this model or provider, or remove the guardrail from this key.";
  }
  if (text.includes("data policy") || text.includes("zdr") || text.includes("no endpoints found") || text.includes("privacy")) {
    return "Your privacy settings leave no provider for this model. In OpenRouter Settings → Privacy, keep zero-data-retention on, and check you haven't limited providers (Allowed / Ignored providers) so much that this model has none left.";
  }
  if (status === 402 || text.includes("credits") || text.includes("afford")) {
    return "This is money, but in one of two places: the account's credit balance (Settings → Credits) and the key's own spending limit (Keys → edit this key). Both must have room.";
  }
  if (status === 429 || text.includes("rate limit")) {
    return "Rate limited. Wait a minute and try again; free-tier accounts have much lower limits.";
  }
  if (status === 403) {
    return "OpenRouter refused this request. Check Settings → Guardrails and the key's allowed models.";
  }
  return undefined;
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
  const message = payload?.error?.message ?? `HTTP ${response.status}`;
  const raw = payload?.error?.metadata?.raw;
  return typeof raw === "string" && raw && !message.includes(raw) ? `${message} (${raw})` : message;
}

export async function fetchKeyInfo(apiKey: string): Promise<CheckResult & { info?: KeyInfo }> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const message = await readError(response);
      return { name: "Your key", ok: false, detail: message, advice: adviceFor(response.status, message) };
    }
    const info = ((await response.json()) as { data?: KeyInfo }).data ?? {};
    const parts = [
      info.limit == null
        ? "No spending limit on this key"
        : `Key limit $${info.limit.toFixed(2)}${info.limit_reset ? ` (resets ${info.limit_reset})` : ""}, $${(info.limit_remaining ?? 0).toFixed(2)} left`,
      `$${(info.usage ?? 0).toFixed(2)} used`,
      info.is_free_tier ? "free tier (low rate limits; add credits to lift them)" : null,
      info.expires_at ? `expires ${new Date(info.expires_at).toLocaleDateString()}` : null,
    ].filter(Boolean);
    const exhausted = info.limit != null && (info.limit_remaining ?? 0) < 0.05;
    return {
      name: "Your key",
      ok: !exhausted,
      detail: parts.join(" · "),
      advice: exhausted ? "This key has reached its own spending limit. Raise it under Keys → edit this key." : undefined,
      info,
    };
  } catch {
    return { name: "Your key", ok: false, detail: "Couldn't reach OpenRouter. Check your connection." };
  }
}

/** One tiny request per model, with exactly the room's privacy setting, to surface the real error. */
export async function testModel(apiKey: string, model: GuestModel): Promise<CheckResult> {
  try {
    const response = await fetch(OPENROUTER_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: 1000,
        reasoning: { effort: "low", exclude: true },
        provider: { zdr: true },
      }),
    });
    if (!response.ok) {
      const message = await readError(response);
      return { name: model.label, ok: false, detail: message, advice: adviceFor(response.status, message) };
    }
    const payload = (await response.json()) as ErrorPayload & { provider?: string };
    if (payload.error?.message) {
      const message = payload.error.message;
      return { name: model.label, ok: false, detail: message, advice: adviceFor(payload.error.code ?? 200, message) };
    }
    return { name: model.label, ok: true, detail: payload.provider ? `Answered via ${payload.provider}` : "Answered" };
  } catch {
    return { name: model.label, ok: false, detail: "Couldn't reach OpenRouter. Check your connection." };
  }
}

export async function testSpeech(apiKey: string): Promise<CheckResult> {
  try {
    const blob = await requestSpeech(apiKey, "Ready.", "en-US-Harper");
    return { name: "Natural voices", ok: true, detail: `${SPEECH_MODEL} answered (${Math.round(blob.size / 1024)} KB)` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech request failed.";
    return { name: "Natural voices", ok: false, detail: message, advice: adviceFor(0, message) };
  }
}

/** The key's total spend so far, in dollars, as OpenRouter records it; null if unavailable. */
export async function keyUsage(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const usage = ((await response.json()) as { data?: KeyInfo }).data?.usage;
    return typeof usage === "number" ? usage : null;
  } catch {
    return null;
  }
}
