import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptProviderCredential,
  encryptProviderCredential,
} from "./credentials";

const ownerId = "10000000-0000-4000-8000-000000000001";
const secret = "synthetic-provider-key";
const keyV1 = Buffer.alloc(32, 1).toString("base64");
const keyV2 = Buffer.alloc(32, 2).toString("base64");

function configureKeys(keys: Record<string, string>, activeKeyId: string) {
  vi.stubEnv("PROVIDER_CREDENTIAL_ENCRYPTION_KEYS", JSON.stringify(keys));
  vi.stubEnv("PROVIDER_CREDENTIAL_ENCRYPTION_ACTIVE_KEY_ID", activeKeyId);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider credential encryption", () => {
  it("encrypts keys and binds ciphertext to provider and owner", () => {
    configureKeys({ v1: keyV1 }, "v1");
    const envelope = encryptProviderCredential(secret, "openai", ownerId);

    expect(envelope.ciphertext).not.toContain(secret);
    expect(decryptProviderCredential(envelope, "openai", ownerId)).toBe(secret);
    expect(() =>
      decryptProviderCredential(envelope, "anthropic", ownerId),
    ).toThrow("failed authentication");
    expect(() =>
      decryptProviderCredential(
        envelope,
        "openai",
        "20000000-0000-4000-8000-000000000002",
      ),
    ).toThrow("failed authentication");
  });

  it("detects tampering with the encrypted credential", () => {
    configureKeys({ v1: keyV1 }, "v1");
    const envelope = encryptProviderCredential(secret, "openai", ownerId);

    expect(() =>
      decryptProviderCredential(
        { ...envelope, ciphertext: Buffer.from("changed").toString("base64") },
        "openai",
        ownerId,
      ),
    ).toThrow("failed authentication");
  });

  it("can decrypt old credentials during a key rotation window", () => {
    configureKeys({ v1: keyV1 }, "v1");
    const envelope = encryptProviderCredential(secret, "openai", ownerId);

    configureKeys({ v1: keyV1, v2: keyV2 }, "v2");
    expect(decryptProviderCredential(envelope, "openai", ownerId)).toBe(secret);
    expect(
      encryptProviderCredential(secret, "openai", ownerId).keyVersion,
    ).toBe("v2");
  });

  it("fails explicitly when encryption is not configured", () => {
    expect(() =>
      encryptProviderCredential(secret, "openai", ownerId),
    ).toThrow("Provider credential encryption is not configured");
  });
});
