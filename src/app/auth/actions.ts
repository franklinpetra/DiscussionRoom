"use server";

import { redirect } from "next/navigation";
import { getSiteOrigin, hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validation";

function authError(code: string): never {
  redirect(`/login?error=${encodeURIComponent(code)}`);
}

export async function signIn(formData: FormData) {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) authError("invalid-input");
  if (!hasSupabasePublicConfig()) authError("not-configured");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) authError("sign-in-failed");
  redirect("/app");
}

export async function signUp(formData: FormData) {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) authError("invalid-input");
  if (!hasSupabasePublicConfig()) authError("not-configured");

  const supabase = await createClient();
  const origin = getSiteOrigin();
  if (!origin) authError("not-configured");

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${origin}/auth/callback?next=/app`,
    },
  });

  if (error) authError("sign-up-failed");
  if (data.session) redirect("/app");
  redirect("/login?message=check-email");
}

export async function signOut() {
  if (!hasSupabasePublicConfig()) authError("not-configured");
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) authError("sign-out-failed");
  redirect("/");
}
