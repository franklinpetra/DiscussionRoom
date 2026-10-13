import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "20000000-0000-4000-8000-000000000002";
const projectA = "30000000-0000-4000-8000-000000000003";
const migrations = [
  "20261007170000_initial_workspace_foundation.sql",
  "20261008195300_provider_connections.sql",
  "20261009193000_owner_funded_run_allowances.sql",
].map((filename) =>
  readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), "utf8"),
);

describe("workspace database isolation policies", () => {
  let db: PGlite;
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function auth.role()
      returns text
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.role', true), '')
      $$;
    `);
    for (const migration of migrations) await db.exec(migration);
    await db.exec(`
      insert into auth.users (id, raw_user_meta_data) values
        ('${ownerA}', '{"display_name":"Owner A"}'),
        ('${ownerB}', '{"display_name":"Owner B"}');
    `);

    const workspaces = await db.query<{ id: string; created_by: string }>(
      "select id, created_by from public.workspaces order by created_by",
    );
    workspaceA = workspaces.rows.find((row) => row.created_by === ownerA)!.id;
    workspaceB = workspaces.rows.find((row) => row.created_by === ownerB)!.id;
    await db.query(
      `insert into public.projects (id, workspace_id, name, created_by)
       values ($1, $2, 'Private project A', $3)`,
      [projectA, workspaceA, ownerA],
    );
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerB}', false);`);
  });

  afterEach(async () => {
    await db.close();
  });

  it("hides another tenant's workspace, projects, and memberships", async () => {
    const result = await db.query<{ count: string }>(
      `select count(*)::text as count from public.workspaces where id = $1`,
      [workspaceA],
    );
    expect(result.rows[0].count).toBe("0");

    const projectResult = await db.query<{ count: string }>(
      `select count(*)::text as count from public.projects where id = $1`,
      [projectA],
    );
    expect(projectResult.rows[0].count).toBe("0");

    const membershipResult = await db.query<{ count: string }>(
      `select count(*)::text as count from public.workspace_members where workspace_id = $1`,
      [workspaceA],
    );
    expect(membershipResult.rows[0].count).toBe("0");
  });

  it("rejects cross-tenant project writes", async () => {
    await expect(
      db.query(
        `insert into public.projects (workspace_id, name, created_by)
         values ($1, 'Cross-tenant project', $2)`,
        [workspaceA, ownerB],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("allows a member to create a workspace and write within it", async () => {
    const created = await db.query<{ id: string }>(
      "select public.create_workspace('Company workspace') as id",
    );
    const createdWorkspace = created.rows[0].id;
    expect(createdWorkspace).toBeTruthy();

    await db.query(
      `insert into public.projects (workspace_id, name, created_by)
       values ($1, 'Project B', $2)`,
      [createdWorkspace, ownerB],
    );
    const ownProject = await db.query<{ count: string }>(
      `select count(*)::text as count from public.projects
       where workspace_id = $1 and name = 'Project B'`,
      [createdWorkspace],
    );
    expect(ownProject.rows[0].count).toBe("1");
  });

  it("prevents a conversation from attaching to another workspace's project", async () => {
    await expect(
      db.query(
        `insert into public.conversations (workspace_id, project_id, title, created_by)
         values ($1, $2, 'Cross-workspace reference', $3)`,
        [workspaceB, projectA, ownerB],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("allows a member to read their own workspace and hides it from another tenant", async () => {
    const ownWorkspace = await db.query<{ count: string }>(
      `select count(*)::text as count from public.workspaces where id = $1`,
      [workspaceB],
    );
    expect(ownWorkspace.rows[0].count).toBe("1");

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    const otherWorkspace = await db.query<{ count: string }>(
      `select count(*)::text as count from public.workspaces where id = $1`,
      [workspaceB],
    );
    expect(otherWorkspace.rows[0].count).toBe("0");
  });

  it("uses a personal provider key before the workspace fallback", async () => {
    await db.query(
      `select public.store_provider_connection(
        'openai', null, 'personal-ciphertext', 'AAAAAAAAAAAAAAAA',
        'AAAAAAAAAAAAAAAAAAAAAAAA', 'v1', true
      )`,
    );
    await db.query(
      `select public.store_provider_connection(
        'openai', $1, 'workspace-ciphertext', 'BBBBBBBBBBBBBBBB',
        'BBBBBBBBBBBBBBBBBBBBBBBB', 'v1', true
      )`,
      [workspaceB],
    );

    const selected = await db.query<{ credential_scope: string; ciphertext: string }>(
      `select credential_scope, ciphertext
       from public.get_provider_connection('openai', $1)`,
      [workspaceB],
    );
    expect(selected.rows).toEqual([
      { credential_scope: "personal", ciphertext: "personal-ciphertext" },
    ]);
  });

  it("falls back to the workspace key only when the personal key is absent", async () => {
    await db.query(
      `select public.store_provider_connection(
        'google', $1, 'workspace-ciphertext', 'BBBBBBBBBBBBBBBB',
        'BBBBBBBBBBBBBBBBBBBBBBBB', 'v1', true
      )`,
      [workspaceB],
    );

    const selected = await db.query<{ credential_scope: string; ciphertext: string }>(
      `select credential_scope, ciphertext
       from public.get_provider_connection('google', $1)`,
      [workspaceB],
    );
    expect(selected.rows).toEqual([
      { credential_scope: "workspace", ciphertext: "workspace-ciphertext" },
    ]);
  });

  it("lists connection status without returning encrypted credential data", async () => {
    await db.query(
      `select public.store_provider_connection(
        'openai', null, 'personal-ciphertext', 'AAAAAAAAAAAAAAAA',
        'AAAAAAAAAAAAAAAAAAAAAAAA', 'v1', true
      )`,
    );

    const selected = await db.query<{
      provider: string;
      credential_scope: string;
      remembered_at: string;
    }>(
      `select * from public.list_provider_connections($1)`,
      [workspaceB],
    );
    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0]).toMatchObject({
      provider: "openai",
      credential_scope: "personal",
    });
    expect(selected.rows[0]).not.toHaveProperty("ciphertext");
  });

  it("keeps credential ciphertext inaccessible through direct table access", async () => {
    await expect(
      db.query("select ciphertext from public.provider_connections"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("requires workspace administrator access to replace an organization key", async () => {
    await expect(
      db.query(
        `select public.store_provider_connection(
          'openai', $1, 'attacker-ciphertext', 'CCCCCCCCCCCCCCCC',
          'CCCCCCCCCCCCCCCCCCCCCCCC', 'v1', true
        )`,
        [workspaceA],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("requires explicit consent before a key can be stored", async () => {
    await expect(
      db.query(
        `select public.store_provider_connection(
          'openai', null, 'unremembered-ciphertext', 'EEEEEEEEEEEEEEEE',
          'EEEEEEEEEEEEEEEEEEEEEEEE', 'v1', false
        )`,
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("does not expose a workspace credential to an unrelated user", async () => {
    await db.query(
      `select public.store_provider_connection(
        'google', $1, 'workspace-ciphertext', 'BBBBBBBBBBBBBBBB',
        'BBBBBBBBBBBBBBBBBBBBBBBB', 'v1', true
      )`,
      [workspaceB],
    );

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    await expect(
      db.query(
        `select * from public.get_provider_connection('google', $1)`,
        [workspaceB],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("allows only the workspace owner to grant an eligible five-use allowance", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    const grant = await db.query<{ id: string }>(
      "select public.grant_owner_funded_runs($1, $2) as id",
      [workspaceA, ownerA],
    );
    const allowance = await db.query<{
      used_uses: number;
      remaining_uses: number;
    }>(
      "select * from public.get_owner_funded_run_allowance($1)",
      [workspaceA],
    );
    expect(allowance.rows[0]).toMatchObject({
      allowance_id: grant.rows[0].id,
      used_uses: 0,
      remaining_uses: 5,
    });

    await db.exec("reset role;");
    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'member')`,
      [workspaceB, ownerA],
    );
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerB}', false);`);
    await expect(
      db.query("select public.grant_owner_funded_runs($1, $2)", [workspaceB, ownerA]),
    ).rejects.toMatchObject({ code: "23505" });

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    const secondWorkspaceStatus = await db.query<{ count: string }>(
      "select count(*)::text as count from public.get_owner_funded_run_allowance($1)",
      [workspaceB],
    );
    expect(secondWorkspaceStatus.rows[0].count).toBe("0");

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerB}', false);`);
    await expect(
      db.query("select public.grant_owner_funded_runs($1, $2)", [workspaceA, ownerB]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("enforces five owner-funded uses and makes retries idempotent", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    const grant = await db.query<{ id: string }>(
      "select public.grant_owner_funded_runs($1, $2) as id",
      [workspaceA, ownerA],
    );

    await db.exec(`
      reset role;
      set role service_role;
      select set_config('request.jwt.claim.role', 'service_role', false);
    `);
    for (let useNumber = 1; useNumber <= 5; useNumber++) {
      const reservation = await db.query<{
        used_uses: number;
        remaining_uses: number;
      }>(
        "select * from public.reserve_owner_funded_run_use($1, $2, $3)",
        [
          grant.rows[0].id,
          `40000000-0000-4000-8000-${String(useNumber).padStart(12, "0")}`,
          ownerA,
        ],
      );
      expect(reservation.rows[0]).toEqual({
        used_uses: useNumber,
        remaining_uses: 5 - useNumber,
      });
    }

    const retried = await db.query<{
      used_uses: number;
      remaining_uses: number;
    }>(
      "select * from public.reserve_owner_funded_run_use($1, $2, $3)",
      [grant.rows[0].id, "40000000-0000-4000-8000-000000000001", ownerA],
    );
    expect(retried.rows[0]).toEqual({
      used_uses: 5,
      remaining_uses: 0,
    });

    await expect(
      db.query(
        "select * from public.reserve_owner_funded_run_use($1, $2, $3)",
        [grant.rows[0].id, "40000000-0000-4000-8000-000000000006", ownerA],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("does not let another user inspect or consume a friend's allowance", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerA}', false);`);
    const grant = await db.query<{ id: string }>(
      "select public.grant_owner_funded_runs($1, $2) as id",
      [workspaceA, ownerA],
    );

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerB}', false);`);
    const status = await db.query<{ count: string }>(
      "select count(*)::text as count from public.get_owner_funded_run_allowance($1)",
      [workspaceA],
    );
    expect(status.rows[0].count).toBe("0");
    await expect(
      db.query(
        "select * from public.reserve_owner_funded_run_use($1, $2, $3)",
        [
          grant.rows[0].id,
          "50000000-0000-4000-8000-000000000001",
          ownerA,
        ],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
