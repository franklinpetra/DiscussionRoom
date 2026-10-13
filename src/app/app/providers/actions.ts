"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  encryptProviderCredential,
  ProviderEncryptionConfigurationError,
  type ProviderCredentialEnvelope,
} from "@/lib/providers/credentials";
import { providerIds } from "@/lib/providers/contracts";

const saveInputSchema = z.object({
  provider: z.enum(providerIds),
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value === value.trim()),
  workspaceId: z.uuid().nullable(),
  remember: z.boolean(),
});

const revokeInputSchema = z.object({
  provider: z.enum(providerIds),
  workspaceId: z.uuid().nullable(),
});

function settingsPath(workspaceId: string | null, state?: Record<string, string>) {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  for (const [key, value] of Object.entries(state ?? {})) params.set(key, value);
  const query = params.toString();
  return query ? `/app/providers?${query}` : "/app/providers";
}

function fail(workspaceId: string | null, error: string): never {
  redirect(settingsPath(workspaceId, { error }));
}

async function authenticatedClient() {
  if (!hasSupabasePublicConfig()) redirect("/login?error=not-configured");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
}

export async function saveProviderCredential(formData: FormData) {
  const workspaceValue = formData.get("workspaceId");
  const workspaceId =
    typeof workspaceValue === "string" && workspaceValue ? workspaceValue : null;
  const { supabase, user } = await authenticatedClient();
  const parsed = saveInputSchema.safeParse({
    provider: formData.get("provider"),
    apiKey: formData.get("apiKey"),
    workspaceId,
    remember: formData.get("remember") === "on",
  });
  if (!parsed.success) fail(workspaceId, "invalid-input");
  if (!parsed.data.remember) {
    redirect(settingsPath(workspaceId, { status: "not-saved" }));
  }
  if (process.env.PROVIDER_CREDENTIALS_ENABLED !== "true") {
    fail(workspaceId, "not-enabled");
  }

  const ownerId = parsed.data.workspaceId ?? user.id;
  let envelope: ProviderCredentialEnvelope;
  try {
    envelope = encryptProviderCredential(
      parsed.data.apiKey,
      parsed.data.provider,
      ownerId,
    );
  } catch (error) {
    if (error instanceof ProviderEncryptionConfigurationError) {
      fail(workspaceId, "encryption-not-configured");
    }
    throw error;
  }

  const { error } = await supabase.rpc("store_provider_connection", {
    target_provider: parsed.data.provider,
    target_workspace_id: parsed.data.workspaceId,
    target_ciphertext: envelope.ciphertext,
    target_nonce: envelope.nonce,
    target_auth_tag: envelope.authTag,
    target_key_version: envelope.keyVersion,
    confirm_remember: true,
  });
  if (error) {
    fail(workspaceId, error.code === "42501" ? "not-authorized" : "save-failed");
  }
  redirect(settingsPath(workspaceId, { saved: "true" }));
}

export async function revokeProviderCredential(formData: FormData) {
  const workspaceValue = formData.get("workspaceId");
  const workspaceId =
    typeof workspaceValue === "string" && workspaceValue ? workspaceValue : null;
  const { supabase } = await authenticatedClient();
  const parsed = revokeInputSchema.safeParse({
    provider: formData.get("provider"),
    workspaceId,
  });
  if (!parsed.success) fail(workspaceId, "invalid-input");
  if (process.env.PROVIDER_CREDENTIALS_ENABLED !== "true") {
    fail(workspaceId, "not-enabled");
  }

  const { data, error } = await supabase.rpc("delete_provider_connection", {
    target_provider: parsed.data.provider,
    target_workspace_id: parsed.data.workspaceId,
  });
  if (error) {
    fail(workspaceId, error.code === "42501" ? "not-authorized" : "revoke-failed");
  }
  if (!data) fail(workspaceId, "not-connected");
  redirect(settingsPath(workspaceId, { revoked: "true" }));
}
