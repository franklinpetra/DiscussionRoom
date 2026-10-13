import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/app/auth/actions";
import { revokeProviderCredential, saveProviderCredential } from "./actions";
import { hasSupabasePublicConfig } from "@/lib/env";
import { providerIds } from "@/lib/providers/contracts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const workspaceIdSchema = z.uuid();
const connectionStatusSchema = z.array(
  z.object({
    connection_id: z.uuid(),
    provider: z.enum(providerIds),
    credential_scope: z.enum(["personal", "workspace"]),
    remembered_at: z.string(),
  }),
);

const providerLabels = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
} satisfies Record<(typeof providerIds)[number], string>;

const errorMessages: Record<string, string> = {
  "invalid-input": "Check the provider key and try again.",
  "not-enabled": "Provider key connections are not enabled in this environment yet.",
  "encryption-not-configured": "Secure key storage is not configured in this environment.",
  "not-authorized": "You don't have permission to manage this provider connection.",
  "save-failed": "We couldn't save the provider connection. Please try again.",
  "revoke-failed": "We couldn't revoke the provider connection. Please try again.",
  "not-connected": "That provider connection was not found.",
};

export default async function ProviderConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspaceId?: string;
    error?: string;
    saved?: string;
    revoked?: string;
    status?: string;
  }>;
}) {
  if (!hasSupabasePublicConfig()) redirect("/login?error=not-configured");
  const params = await searchParams;
  if (params.workspaceId && !workspaceIdSchema.safeParse(params.workspaceId).success) {
    notFound();
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", auth.user.id);
  if (membershipError) throw new Error("Unable to load workspace memberships.");

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name")
        .in("id", workspaceIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (workspacesError) throw new Error("Unable to load workspaces.");

  const selectedWorkspace = params.workspaceId
    ? workspaces?.find((workspace) => workspace.id === params.workspaceId)
    : undefined;
  if (params.workspaceId && !selectedWorkspace) notFound();
  const selectedMembership = selectedWorkspace
    ? memberships?.find((membership) => membership.workspace_id === selectedWorkspace.id)
    : undefined;
  const canManageSelectedWorkspace =
    selectedMembership?.role === "owner" || selectedMembership?.role === "admin";

  const credentialsEnabled = process.env.PROVIDER_CREDENTIALS_ENABLED === "true";
  let connections: z.infer<typeof connectionStatusSchema> = [];
  if (credentialsEnabled) {
    const { data, error } = await supabase.rpc("list_provider_connections", {
      target_workspace_id: selectedWorkspace?.id ?? null,
    });
    if (error) throw new Error("Unable to load provider connection status.");
    const parsed = connectionStatusSchema.safeParse(data);
    if (!parsed.success) throw new Error("Provider connection status is invalid.");
    connections = parsed.data;
  }

  const selectedScope = selectedWorkspace ? "workspace" : "personal";
  const message =
    params.saved === "true"
      ? "Provider key saved securely. It has not been tested with the provider."
      : params.revoked === "true"
        ? "Provider connection revoked."
        : params.status === "not-saved"
          ? "The key was not saved. It was discarded; enter it again when needed."
          : params.error
            ? errorMessages[params.error]
            : undefined;

  return (
    <main className="shell page-shell">
      <header className="masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <form action={signOut}>
          <button className="quiet-link" type="submit">Sign out</button>
        </form>
      </header>

      <nav aria-label="Breadcrumb" className="form-links">
        <Link href="/app">Workspaces</Link>
        <span aria-current="page">Provider keys</span>
        {selectedWorkspace && <span>{selectedWorkspace.name}</span>}
      </nav>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Provider connections</p>
          <h1>{selectedWorkspace ? `${selectedWorkspace.name} keys` : "Personal keys"}</h1>
          <p className="muted">
            Provider account owners pay for model usage. At run time, a personal key
            is preferred; a workspace key is used only if your personal key for
            that provider is not connected. Remembered keys are encrypted before
            storage and used by the server for provider requests.
          </p>
        </div>
      </section>

      {message && (
        <p
          className={params.error ? "form-error" : "form-success"}
          role={params.error ? "alert" : "status"}
        >
          {message}
        </p>
      )}

      <section className="content-panel" aria-label="Key scope">
        <h2>Key scope</h2>
        <ul className="item-list">
          <li><Link href="/app/providers">Personal provider keys</Link></li>
          {(workspaces ?? []).map((workspace) => (
            <li key={workspace.id}>
              <Link href={`/app/providers?workspaceId=${workspace.id}`}>
                {workspace.name} workspace keys
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {!credentialsEnabled ? (
        <section className="setup-note" aria-labelledby="provider-setup-title">
          <h2 id="provider-setup-title">Key connections are not enabled</h2>
          <p>
            This environment is not configured to store provider keys. No key will
            be saved here. Use only synthetic or non-confidential information
            until the provider and retention setup is approved.
          </p>
        </section>
      ) : (
        <section className="workspace-list" aria-label="Provider connections">
          {providerIds.map((provider) => {
            const providerConnections = connections.filter(
              (connection) => connection.provider === provider,
            );
            const selectedConnection = providerConnections.find(
              (connection) => connection.credential_scope === selectedScope,
            );

            return (
              <article className="content-panel" key={provider}>
                <h2>{providerLabels[provider]}</h2>
                {providerConnections.length ? (
                  <ul className="item-list">
                    {providerConnections.map((connection) => {
                      const manageable =
                        connection.credential_scope === "personal" ||
                        canManageSelectedWorkspace;
                      return (
                        <li key={connection.connection_id}>
                          <div className="toolbar">
                            <span>
                              {connection.credential_scope === "personal"
                                ? "Personal key"
                                : "Workspace key"}{" "}
                              saved (not tested)
                            </span>
                            {manageable && (
                              <form action={revokeProviderCredential}>
                                <input name="provider" type="hidden" value={provider} />
                                <input
                                  name="workspaceId"
                                  type="hidden"
                                  value={
                                    connection.credential_scope === "workspace"
                                      ? selectedWorkspace?.id ?? ""
                                      : ""
                                  }
                                />
                                <button className="delete-button" type="submit">
                                  Revoke
                                </button>
                              </form>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">
                    No {selectedScope} key is saved for {providerLabels[provider]}.
                  </p>
                )}

                {selectedScope === "workspace" && !canManageSelectedWorkspace ? (
                  <p className="muted">
                    A workspace owner or admin must connect or revoke its key.
                  </p>
                ) : (
                  <form action={saveProviderCredential} className="form-stack">
                    <input name="provider" type="hidden" value={provider} />
                    <input
                      name="workspaceId"
                      type="hidden"
                      value={selectedWorkspace?.id ?? ""}
                    />
                    <label className="field">
                      Provider API key
                      <input
                        autoComplete="off"
                        maxLength={4096}
                        name="apiKey"
                        required
                        type="password"
                      />
                    </label>
                    <label>
                      <input name="remember" type="checkbox" />
                      {" "}Remember this key
                    </label>
                    <p className="muted">
                      Remembering is optional and off by default. If unchecked,
                      the key is discarded and must be entered again when needed.
                    </p>
                    <button className="button" type="submit">
                      Save {selectedScope} key
                    </button>
                  </form>
                )}
                {selectedConnection && (
                  <p className="muted">
                    This {selectedScope} key will be preferred for this provider.
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
