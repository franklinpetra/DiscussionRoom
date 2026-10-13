import Link from "next/link";
import { redirect } from "next/navigation";
import { createWorkspace } from "@/app/app/actions";
import { signOut } from "@/app/auth/actions";
import { hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  "invalid-input": "Check the workspace name and try again.",
  "save-failed": "We couldn't save that workspace. Please try again.",
};

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!hasSupabasePublicConfig()) redirect("/login?error=not-configured");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", auth.user.id);
  if (membershipError) throw new Error("Unable to load workspace memberships.");

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const { data: workspaces, error: workspaceError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, created_at")
        .in("id", workspaceIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (workspaceError) throw new Error("Unable to load workspaces.");

  const params = await searchParams;
  const message = params.error ? errorMessages[params.error] : undefined;
  const roleByWorkspace = new Map(
    (memberships ?? []).map((membership) => [membership.workspace_id, membership.role]),
  );

  return (
    <main className="shell page-shell">
      <header className="masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <Link className="quiet-link" href="/app/providers">Provider keys</Link>
        <form action={signOut}>
          <button className="quiet-link" type="submit">Sign out</button>
        </form>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Your notebook</p>
          <h1>Workspaces</h1>
          <p className="muted">A private home for projects and discussions.</p>
          <p className="workspace-start">
            <Link className="button" href="/room">Start a guest session</Link>
          </p>
        </div>
      </section>

      {message && <p className="form-error" role="alert">{message}</p>}

      <section className="workspace-list" aria-label="Your workspaces">
        {(workspaces ?? []).map((workspace) => (
          <article className="workspace-card" key={workspace.id}>
            <div className="toolbar">
              <h2><Link href={`/app/workspaces/${workspace.id}`}>{workspace.name}</Link></h2>
              <span className="workspace-meta">
                {roleByWorkspace.get(workspace.id) ?? "member"}
              </span>
            </div>
            <p className="workspace-meta">
              Created {new Date(workspace.created_at).toLocaleDateString()}
            </p>
          </article>
        ))}
        {!workspaces?.length && (
          <p className="empty-state">
            No workspace is available yet. Create one to start organizing work.
          </p>
        )}
      </section>

      <details className="content-panel optional-workspace">
        <summary>Create another workspace (optional)</summary>
        <p className="muted">
          Your personal workspace is ready. Create another workspace only if
          you need a separate space to share with others.
        </p>
        <form action={createWorkspace} className="inline-form">
          <label className="field">
            Workspace name
            <input autoComplete="organization" maxLength={80} minLength={2} name="name" required />
          </label>
          <button className="button" type="submit">Create workspace</button>
        </form>
      </details>
    </main>
  );
}
