import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createConversation, createProject, deleteConversation } from "@/app/app/actions";
import { signOut } from "@/app/auth/actions";
import { hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const workspaceIdSchema = z.uuid();

const messages: Record<string, string> = {
  "save-failed": "We couldn't save that item. Check your workspace access and try again.",
  "delete-failed": "We couldn't delete that conversation. Check your access and try again.",
  "invalid-input": "Check the form fields and try again.",
};

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ error?: string; created?: string; deleted?: string }>;
}) {
  if (!hasSupabasePublicConfig()) redirect("/login?error=not-configured");
  const { workspaceId } = await params;
  if (!workspaceIdSchema.safeParse(workspaceId).success) notFound();

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) throw new Error("Unable to load workspace.");
  if (!workspace) notFound();

  const [membershipResult, projectsResult, conversationsResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, description, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversations")
      .select("id, title, project_id, created_at, created_by")
      .eq("workspace_id", workspaceId)
      .is("project_id", null)
      .order("created_at", { ascending: false }),
  ]);
  if (membershipResult.error || !membershipResult.data) {
    throw new Error("Unable to load workspace membership.");
  }
  if (projectsResult.error) throw new Error("Unable to load projects.");
  if (conversationsResult.error) throw new Error("Unable to load conversations.");

  const canManageWorkspace =
    membershipResult.data.role === "owner" || membershipResult.data.role === "admin";
  const query = await searchParams;
  const successMessage =
    query.created === "project"
      ? "Project created."
      : query.created === "conversation"
        ? "Conversation created."
        : query.deleted === "conversation"
          ? "Conversation deleted."
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
        <span aria-current="page">{workspace.name}</span>
      </nav>

      <section className="page-heading">
        <div>
          <p className="eyebrow">Workspace notebook</p>
          <h1>{workspace.name}</h1>
          <p className="muted">
            Conversations and reports remain here until you delete them.
          </p>
        </div>
      </section>

      {query.error && messages[query.error] && (
        <p className="form-error" role="alert">{messages[query.error]}</p>
      )}
      {successMessage && <p className="form-success" role="status">{successMessage}</p>}

      <section className="content-panel">
        <h2>Projects</h2>
        {projectsResult.data.length ? (
          <ul className="item-list">
            {projectsResult.data.map((project) => (
              <li key={project.id}>
                <Link href={`/app/workspaces/${workspaceId}/projects/${project.id}`}>
                  {project.name}
                </Link>
                {project.description && <p className="muted">{project.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No projects yet.</p>
        )}
        <form action={createProject} className="form-stack">
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <label className="field">
            New project
            <input maxLength={120} minLength={2} name="name" required />
          </label>
          <label className="field">
            Description (optional)
            <textarea maxLength={2000} name="description" rows={2} />
          </label>
          <button className="button" type="submit">Create project</button>
        </form>
      </section>

      <section className="content-panel" style={{ marginTop: 20 }}>
        <h2>Unfiled conversations</h2>
        {conversationsResult.data.length ? (
          <ul className="item-list">
            {conversationsResult.data.map((conversation) => (
              <li key={conversation.id}>
                <div className="toolbar">
                  <span>{conversation.title}</span>
                  {(canManageWorkspace || conversation.created_by === auth.user.id) && (
                    <form action={deleteConversation}>
                      <input name="workspaceId" type="hidden" value={workspaceId} />
                      <input name="conversationId" type="hidden" value={conversation.id} />
                      <button className="delete-button" type="submit">Delete</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No unfiled conversations.</p>
        )}
        <form action={createConversation} className="inline-form">
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <label className="field">
            New conversation
            <input maxLength={160} minLength={2} name="title" required />
          </label>
          <button className="button" type="submit">Create conversation</button>
        </form>
      </section>
    </main>
  );
}
