create table public.owner_funded_run_allowances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null references auth.users (id) on delete restrict,
  max_uses integer not null default 5 check (max_uses = 5),
  created_at timestamptz not null default now(),
  unique (recipient_user_id)
);

create table public.owner_funded_run_uses (
  id uuid primary key default gen_random_uuid(),
  allowance_id uuid not null
    references public.owner_funded_run_allowances (id) on delete cascade,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (allowance_id, idempotency_key)
);

create index owner_funded_run_uses_allowance_idx
  on public.owner_funded_run_uses (allowance_id, created_at);

alter table public.owner_funded_run_allowances enable row level security;
alter table public.owner_funded_run_uses enable row level security;
revoke all on public.owner_funded_run_allowances from anon, authenticated;
revoke all on public.owner_funded_run_uses from anon, authenticated;

create function public.grant_owner_funded_runs(
  target_workspace_id uuid,
  target_recipient_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  allowance_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if target_workspace_id is null or target_recipient_user_id is null then
    raise exception 'Workspace and recipient are required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.workspaces as w
    join public.workspace_members as recipient
      on recipient.workspace_id = w.id
     and recipient.user_id = target_recipient_user_id
    where w.id = target_workspace_id
      and w.created_by = actor_id
      and recipient.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Only the workspace owner can fund an existing member'
      using errcode = '42501';
  end if;

  insert into public.owner_funded_run_allowances (
    workspace_id, recipient_user_id, granted_by
  )
  values (target_workspace_id, target_recipient_user_id, actor_id)
  on conflict (recipient_user_id) do nothing
  returning id into allowance_id;

  if allowance_id is null then
    select a.id into allowance_id
    from public.owner_funded_run_allowances as a
    where a.recipient_user_id = target_recipient_user_id;
    if exists (
      select 1
      from public.owner_funded_run_allowances as a
      where a.id = allowance_id
        and a.workspace_id <> target_workspace_id
    ) then
      raise exception 'Recipient already has an owner-funded allowance'
        using errcode = '23505';
    end if;
  end if;
  return allowance_id;
end;
$$;

create function public.reserve_owner_funded_run_use(
  target_allowance_id uuid,
  target_idempotency_key uuid,
  target_user_id uuid
)
returns table (used_uses integer, remaining_uses integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance public.owner_funded_run_allowances%rowtype;
  already_reserved boolean;
  current_uses integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Owner-funded uses can only be reserved by the trusted run service'
      using errcode = '42501';
  end if;
  if target_allowance_id is null
      or target_idempotency_key is null
      or target_user_id is null then
    raise exception 'Allowance, run idempotency key, and user are required'
      using errcode = '22023';
  end if;

  select a.* into allowance
  from public.owner_funded_run_allowances as a
  where a.id = target_allowance_id;
  if not found
      or allowance.recipient_user_id <> target_user_id
      or not exists (
        select 1
        from public.workspace_members as m
        where m.workspace_id = allowance.workspace_id
          and m.user_id = target_user_id
      ) then
    raise exception 'Owner-funded allowance is unavailable' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_allowance_id::text, 0));

  select exists (
    select 1
    from public.owner_funded_run_uses as u
    where u.allowance_id = target_allowance_id
      and u.idempotency_key = target_idempotency_key
  ) into already_reserved;

  select count(*)::integer into current_uses
  from public.owner_funded_run_uses as u
  where u.allowance_id = target_allowance_id;

  if not already_reserved then
    if current_uses >= allowance.max_uses then
      raise exception 'Owner-funded run allowance exhausted' using errcode = 'P0001';
    end if;

    insert into public.owner_funded_run_uses (allowance_id, idempotency_key)
    values (target_allowance_id, target_idempotency_key);
    current_uses := current_uses + 1;
  end if;

  return query select current_uses, allowance.max_uses - current_uses;
end;
$$;

create function public.get_owner_funded_run_allowance(
  target_workspace_id uuid
)
returns table (
  allowance_id uuid,
  used_uses integer,
  remaining_uses integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
    select
      a.id,
      count(u.id)::integer,
      a.max_uses - count(u.id)::integer
    from public.owner_funded_run_allowances as a
    left join public.owner_funded_run_uses as u on u.allowance_id = a.id
    where a.workspace_id = target_workspace_id
      and a.recipient_user_id = actor_id
      and (select public.is_workspace_member(a.workspace_id))
    group by a.id, a.max_uses;
end;
$$;

revoke all on function public.grant_owner_funded_runs(uuid, uuid) from public;
revoke all on function public.reserve_owner_funded_run_use(uuid, uuid, uuid) from public;
revoke all on function public.get_owner_funded_run_allowance(uuid) from public;
revoke all on function public.reserve_owner_funded_run_use(uuid, uuid, uuid)
  from anon, authenticated;
grant execute on function public.grant_owner_funded_runs(uuid, uuid) to authenticated;
grant execute on function public.reserve_owner_funded_run_use(uuid, uuid, uuid) to service_role;
grant execute on function public.get_owner_funded_run_allowance(uuid) to authenticated;
