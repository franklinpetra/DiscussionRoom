import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { providerIds, type ProviderId } from "./contracts";

const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const credentialEnvelopeSchema = z.object({
  ciphertext: z.string().min(1).max(12_000),
  nonce: z.string().length(16),
  authTag: z.string().length(24),
  keyVersion: z.string().regex(keyIdPattern),
});

export type ProviderCredentialEnvelope = z.infer<typeof credentialEnvelopeSchema>;

export class ProviderEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEncryptionConfigurationError";
  }
}

function configuredKeyring() {
  const rawKeys = process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS;
  const activeKeyId = process.env.PROVIDER_CREDENTIAL_ENCRYPTION_ACTIVE_KEY_ID;
  if (!rawKeys || !activeKeyId || !keyIdPattern.test(activeKeyId)) {
    throw new ProviderEncryptionConfigurationError(
      "Provider credential encryption is not configured.",
    );
  }

  let parsedKeys: unknown;
  try {
    parsedKeys = JSON.parse(rawKeys);
  } catch {
    throw new ProviderEncryptionConfigurationError(
      "Provider credential encryption keys must be valid JSON.",
    );
  }
  if (!parsedKeys || typeof parsedKeys !== "object" || Array.isArray(parsedKeys)) {
    throw new ProviderEncryptionConfigurationError(
      "Provider credential encryption keys must be a JSON object.",
    );
  }

  const keyValues = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(parsedKeys)) {
    if (!keyIdPattern.test(keyId) || typeof value !== "string") {
      throw new ProviderEncryptionConfigurationError(
        "Provider credential encryption keyring is invalid.",
      );
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== 32 || key.toString("base64") !== value) {
      throw new ProviderEncryptionConfigurationError(
        `Provider credential encryption key ${keyId} must be 32 bytes in base64.`,
      );
    }
    keyValues.set(keyId, key);
  }

  const activeKey = keyValues.get(activeKeyId);
  if (!activeKey) {
    throw new ProviderEncryptionConfigurationError(
      "The active provider credential encryption key is missing.",
    );
  }
  return { activeKeyId, keyValues, activeKey };
}

function associatedData(provider: ProviderId, ownerId: string, keyVersion: string) {
  return Buffer.from(`the-room:provider-credential:${provider}:${ownerId}:${keyVersion}`);
}

export function encryptProviderCredential(
  plaintext: string,
  provider: ProviderId,
  ownerId: string,
): ProviderCredentialEnvelope {
  if (!providerIds.includes(provider) || !z.uuid().safeParse(ownerId).success) {
    throw new Error("Provider credential ownership metadata is invalid.");
  }
  if (!plaintext || plaintext.length > 4_096 || plaintext !== plaintext.trim()) {
    throw new Error("Provider credential is empty, too long, or has surrounding whitespace.");
  }

  const { activeKeyId, activeKey } = configuredKeyring();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", activeKey, nonce);
  cipher.setAAD(associatedData(provider, ownerId, activeKeyId));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: activeKeyId,
  };
}

export function decryptProviderCredential(
  envelopeInput: ProviderCredentialEnvelope,
  provider: ProviderId,
  ownerId: string,
): string {
  const parsed = credentialEnvelopeSchema.safeParse(envelopeInput);
  if (
    !parsed.success ||
    !providerIds.includes(provider) ||
    !z.uuid().safeParse(ownerId).success
  ) {
    throw new Error("Stored provider credential envelope is invalid.");
  }

  const { keyValues } = configuredKeyring();
  const key = keyValues.get(parsed.data.keyVersion);
  if (!key) {
    throw new Error(
      `Provider credential encryption key ${parsed.data.keyVersion} is not configured.`,
    );
  }
  const nonce = Buffer.from(parsed.data.nonce, "base64");
  const authTag = Buffer.from(parsed.data.authTag, "base64");
  const ciphertext = Buffer.from(parsed.data.ciphertext, "base64");
  if (
    nonce.length !== 12 ||
    authTag.length !== 16 ||
    ciphertext.length === 0 ||
    ciphertext.toString("base64") !== parsed.data.ciphertext
  ) {
    throw new Error("Stored provider credential envelope is invalid.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(associatedData(provider, ownerId, parsed.data.keyVersion));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Stored provider credential failed authentication.");
  }
}
