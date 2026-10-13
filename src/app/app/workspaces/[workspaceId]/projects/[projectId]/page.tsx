import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createConversation, deleteConversation } from "@/app/app/actions";
import { signOut } from "@/app/auth/actions";
import { hasSupabasePublicConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const idSchema = z.uuid();

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
  searchParams: Promise<{ created?: string; deleted?: string; error?: string }>;
}) {
  if (!hasSupabasePublicConfig()) redirect("/login?error=not-configured");
  const { workspaceId, projectId } = await params;
  if (!idSchema.safeParse(workspaceId).success || !idSchema.safeParse(projectId).success) {
    notFound();
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, description, workspace_id")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (projectError) throw new Error("Unable to load project.");
  if (!project) notFound();

  const [{ data: workspace, error: workspaceError }, conversationsResult] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select("id, title, created_at")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);
  if (workspaceError) throw new Error("Unable to load workspace.");
  if (!workspace) notFound();
  if (conversationsResult.error) throw new Error("Unable to load conversations.");

  const query = await searchParams;
  const message =
    query.error === "save-failed"
      ? "We couldn't save that conversation."
      : query.error === "delete-failed"
        ? "We couldn't delete that conversation."
        : query.error === "invalid-input"
          ? "Check the form fields and try again."
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
        <Link href={`/app/workspaces/${workspaceId}`}>{workspace.name}</Link>
        <span aria-current="page">{project.name}</span>
      </nav>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Project notebook</p>
          <h1>{project.name}</h1>
          {project.description && <p className="muted">{project.description}</p>}
        </div>
      </section>
      {message && <p className="form-error" role="alert">{message}</p>}
      {query.created === "conversation" && (
        <p className="form-success" role="status">Conversation created.</p>
      )}
      {query.deleted === "conversation" && (
        <p className="form-success" role="status">Conversation deleted.</p>
      )}
      <section className="content-panel">
        <h2>Conversations</h2>
        {conversationsResult.data.length ? (
          <ul className="item-list">
            {conversationsResult.data.map((conversation) => (
              <li key={conversation.id}>
                <div className="toolbar">
                  <span>{conversation.title}</span>
                  <form action={deleteConversation}>
                    <input name="workspaceId" type="hidden" value={workspaceId} />
                    <input name="conversationId" type="hidden" value={conversation.id} />
                    <button className="delete-button" type="submit">Delete</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">This project is ready for its first conversation.</p>
        )}
        <form action={createConversation} className="inline-form">
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <input name="projectId" type="hidden" value={projectId} />
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
