"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseConfig } from "@/lib/env";

export function createClient() {
  const config = requirePublicSupabaseConfig();
  return createBrowserClient(config.url, config.publishableKey);
}
