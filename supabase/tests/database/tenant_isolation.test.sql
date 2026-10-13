begin;

select plan(26);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'room-owner-a@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Owner A"}',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'room-owner-b@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Owner B"}',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'room-outsider@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Outsider"}',
    now(),
    now()
  )
on conflict (id) do nothing;

select set_config(
  'test.workspace_a',
  (select id::text from public.workspaces where created_by = '10000000-0000-4000-8000-000000000001'),
  true
);
select set_config(
  'test.workspace_b',
  (select id::text from public.workspaces where created_by = '20000000-0000-4000-8000-000000000002'),
  true
);
insert into public.workspace_members (workspace_id, user_id, role)
values (
  current_setting('test.workspace_b')::uuid,
  '10000000-0000-4000-8000-000000000001',
  'member'
);
insert into public.projects (id, workspace_id, name, created_by)
values (
  '30000000-0000-4000-8000-000000000003',
  current_setting('test.workspace_a')::uuid,
  'Private project A',
  '10000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.workspaces where id = current_setting('test.workspace_a')::uuid),
  0::bigint,
  'a workspace is invisible to a different tenant'
);
select is(
  (select count(*) from public.projects where id = '30000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a project is invisible to a different tenant'
);
select throws_ok(
  $$insert into public.projects (workspace_id, name, created_by)
    values (current_setting('test.workspace_a')::uuid, 'Cross-tenant write', '20000000-0000-4000-8000-000000000002')$$,
  '42501',
  null,
  'a member cannot write into another workspace'
);

select set_config('test.workspace_b_created', public.create_workspace('Company workspace')::text, true);
select is(
  (select count(*) from public.workspaces where id = current_setting('test.workspace_b_created')::uuid),
  1::bigint,
  'workspace creation grants its creator membership'
);
select lives_ok(
  $$insert into public.projects (workspace_id, name, created_by)
    values (current_setting('test.workspace_b_created')::uuid, 'Project B', '20000000-0000-4000-8000-000000000002')$$,
  'a workspace member can create a project in their workspace'
);
select is(
  (select count(*) from public.projects
    where workspace_id = current_setting('test.workspace_b_created')::uuid
      and name = 'Project B'),
  1::bigint,
  'the creator can read their workspace project'
);
select is(
  (select count(*) from public.workspace_members
    where workspace_id = current_setting('test.workspace_a')::uuid),
  0::bigint,
  'workspace membership details are hidden from another tenant'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.projects where id = '30000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the owning tenant can read its project'
);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.store_provider_connection(
    'openai', null, 'personal-ciphertext', 'AAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAA', 'v1', true
  )$$,
  'a user can save an encrypted personal provider key'
);
select lives_ok(
  $$select public.store_provider_connection(
    'openai', current_setting('test.workspace_b')::uuid, 'workspace-ciphertext',
    'BBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBBBBBBBBB', 'v1', true
  )$$,
  'a workspace owner can save an organization provider key'
);
select lives_ok(
  $$select public.store_provider_connection(
    'google', current_setting('test.workspace_b')::uuid, 'google-ciphertext',
    'CCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCCCCCCCC', 'v1', true
  )$$,
  'a workspace can save one key per provider'
);
select is(
  (select credential_scope from public.get_provider_connection(
    'openai', current_setting('test.workspace_b')::uuid
  )),
  'personal',
  'the personal provider key takes precedence over the workspace key'
);
select is(
  (select credential_scope from public.get_provider_connection(
    'google', current_setting('test.workspace_b')::uuid
  )),
  'workspace',
  'the workspace key is used when the personal key is absent'
);
select is(
  (select count(*) from public.list_provider_connections(
    current_setting('test.workspace_b')::uuid
  )),
  3::bigint,
  'connection status lists personal and workspace scopes without a credential value'
);
select throws_ok(
  $$select ciphertext from public.provider_connections$$,
  '42501',
  null,
  'authenticated clients cannot read the credential table directly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select credential_scope from public.get_provider_connection(
    'google', current_setting('test.workspace_b')::uuid
  )),
  'workspace',
  'an authorized workspace member can use the workspace fallback'
);
select throws_ok(
  $$select public.store_provider_connection(
    'openai', current_setting('test.workspace_b')::uuid, 'replaced-ciphertext',
    'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDDDDDDDDDD', 'v1', true
  )$$,
  '42501',
  null,
  'a non-admin workspace member cannot replace an organization key'
);
select throws_ok(
  $$select public.delete_provider_connection(
    'google', current_setting('test.workspace_b')::uuid
  )$$,
  '42501',
  null,
  'a non-admin workspace member cannot revoke an organization key'
);

select throws_ok(
  $$select public.store_provider_connection(
    'openai', null, 'unremembered-ciphertext', 'EEEEEEEEEEEEEEEE',
    'EEEEEEEEEEEEEEEEEEEEEEEE', 'v1', false
  )$$,
  '22023',
  null,
  'saving a provider key requires explicit remember consent'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  public.grant_owner_funded_runs(
    current_setting('test.workspace_a')::uuid,
    '10000000-0000-4000-8000-000000000001'
  ) is not null,
  'a workspace owner can grant a five-run allowance to a member'
);
select is(
  (select remaining_uses from public.get_owner_funded_run_allowance(
    current_setting('test.workspace_a')::uuid
  )),
  5,
  'the owner-funded allowance starts with five uses'
);
select set_config(
  'test.allowance_id',
  (select allowance_id::text from public.get_owner_funded_run_allowance(
    current_setting('test.workspace_a')::uuid
  )),
  true
);
select throws_ok(
  $$select * from public.reserve_owner_funded_run_use(
    current_setting('test.allowance_id')::uuid,
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'authenticated clients cannot reserve owner-funded uses directly'
);
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select used_uses from public.reserve_owner_funded_run_use(
    current_setting('test.allowance_id')::uuid,
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  )),
  1,
  'an owner-funded run reserves one use'
);
select is(
  (select used_uses from public.reserve_owner_funded_run_use(
    current_setting('test.allowance_id')::uuid,
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  )),
  1,
  'retrying the same run reservation does not consume another use'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.grant_owner_funded_runs(
    current_setting('test.workspace_b')::uuid,
    '10000000-0000-4000-8000-000000000001'
  )$$,
  '23505',
  null,
  'the same user cannot receive a second workspace allowance'
);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.get_provider_connection(
    'google', current_setting('test.workspace_b')::uuid
  )$$,
  '42501',
  null,
  'an unrelated user cannot retrieve a workspace credential'
);
select * from finish();
rollback;
