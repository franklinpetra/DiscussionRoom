"use server";

import { redirect } from "next/navigation";
import { hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import {
  conversationInputSchema,
  projectInputSchema,
  workspaceNameSchema,
} from "@/lib/validation";

function fail(path: string, code: string): never {
  redirect(`${path}?error=${encodeURIComponent(code)}`);
}

async function authenticatedClient(path: string) {
  if (!hasSupabasePublicConfig()) fail(path, "not-configured");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) fail("/login", "sign-in-failed");
  return { supabase, user: data.user };
}

export async function createWorkspace(formData: FormData) {
  const parsed = workspaceNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) fail("/app", "invalid-input");

  const { supabase } = await authenticatedClient("/app");
  const { data, error } = await supabase.rpc("create_workspace", {
    workspace_name: parsed.data,
  });
  if (error || !data) fail("/app", "save-failed");
  redirect(`/app/workspaces/${data}`);
}

export async function createProject(formData: FormData) {
  const parsed = projectInputSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) fail("/app", "invalid-input");

  const { supabase, user } = await authenticatedClient("/app");
  const { error } = await supabase.from("projects").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    created_by: user.id,
  });
  if (error) fail(`/app/workspaces/${parsed.data.workspaceId}`, "save-failed");
  redirect(`/app/workspaces/${parsed.data.workspaceId}?created=project`);
}

export async function createConversation(formData: FormData) {
  const parsed = conversationInputSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    projectId: formData.get("projectId") || undefined,
    title: formData.get("title"),
  });
  if (!parsed.success) fail("/app", "invalid-input");

  const { supabase, user } = await authenticatedClient("/app");
  const { error } = await supabase.from("conversations").insert({
    workspace_id: parsed.data.workspaceId,
    project_id: parsed.data.projectId ?? null,
    title: parsed.data.title,
    created_by: user.id,
  });
  if (error) {
    fail(
      parsed.data.projectId
        ? `/app/workspaces/${parsed.data.workspaceId}/projects/${parsed.data.projectId}`
        : `/app/workspaces/${parsed.data.workspaceId}`,
      "save-failed",
    );
  }
  const destination = parsed.data.projectId
    ? `/app/workspaces/${parsed.data.workspaceId}/projects/${parsed.data.projectId}`
    : `/app/workspaces/${parsed.data.workspaceId}`;
  redirect(`${destination}?created=conversation`);
}

export async function deleteConversation(formData: FormData) {
  const parsed = z
    .object({ workspaceId: z.uuid(), conversationId: z.uuid() })
    .safeParse({
      workspaceId: formData.get("workspaceId"),
      conversationId: formData.get("conversationId"),
    });
  if (!parsed.success) fail("/app", "invalid-input");

  const { supabase } = await authenticatedClient("/app");
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", parsed.data.conversationId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) fail(`/app/workspaces/${parsed.data.workspaceId}`, "delete-failed");
  redirect(`/app/workspaces/${parsed.data.workspaceId}?deleted=conversation`);
}
