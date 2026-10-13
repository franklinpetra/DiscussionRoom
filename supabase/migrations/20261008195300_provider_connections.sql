create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'openrouter')),
  ciphertext text not null check (char_length(ciphertext) between 1 and 12000),
  nonce text not null check (char_length(nonce) = 16),
  auth_tag text not null check (char_length(auth_tag) = 24),
  key_version text not null check (char_length(key_version) between 1 and 32),
  remembered_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_connections_owner_scope_check
    check (
      (owner_user_id is not null and workspace_id is null)
      or (owner_user_id is null and workspace_id is not null)
    )
);

create unique index provider_connections_user_provider_idx
  on public.provider_connections (owner_user_id, provider)
  where owner_user_id is not null;
create unique index provider_connections_workspace_provider_idx
  on public.provider_connections (workspace_id, provider)
  where workspace_id is not null;
create trigger provider_connections_set_updated_at
  before update on public.provider_connections
  for each row execute function public.set_updated_at();

alter table public.provider_connections enable row level security;
revoke all on public.provider_connections from anon, authenticated;

create function public.store_provider_connection(
  target_provider text,
  target_workspace_id uuid,
  target_ciphertext text,
  target_nonce text,
  target_auth_tag text,
  target_key_version text,
  confirm_remember boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  connection_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if confirm_remember is distinct from true then
    raise exception 'Explicit key remembering consent is required' using errcode = '22023';
  end if;
  if target_provider is null
      or target_provider not in ('openai', 'anthropic', 'google', 'openrouter')
      or char_length(coalesce(target_ciphertext, '')) not between 1 and 12000
      or char_length(coalesce(target_nonce, '')) <> 16
      or char_length(coalesce(target_auth_tag, '')) <> 24
      or char_length(coalesce(target_key_version, '')) not between 1 and 32 then
    raise exception 'Provider credential envelope is invalid' using errcode = '22023';
  end if;

  if target_workspace_id is null then
    insert into public.provider_connections (
      owner_user_id, workspace_id, provider, ciphertext, nonce, auth_tag, key_version, created_by
    )
    values (
      actor_id, null, target_provider, target_ciphertext, target_nonce,
      target_auth_tag, target_key_version, actor_id
    )
    on conflict (owner_user_id, provider) where owner_user_id is not null
    do update set
      ciphertext = excluded.ciphertext,
      nonce = excluded.nonce,
      auth_tag = excluded.auth_tag,
      key_version = excluded.key_version,
      remembered_at = now()
    returning id into connection_id;
  else
    if not (select public.is_workspace_admin(target_workspace_id)) then
      raise exception 'Workspace administrator access required' using errcode = '42501';
    end if;
    insert into public.provider_connections (
      owner_user_id, workspace_id, provider, ciphertext, nonce, auth_tag, key_version, created_by
    )
    values (
      null, target_workspace_id, target_provider, target_ciphertext, target_nonce,
      target_auth_tag, target_key_version, actor_id
    )
    on conflict (workspace_id, provider) where workspace_id is not null
    do update set
      ciphertext = excluded.ciphertext,
      nonce = excluded.nonce,
      auth_tag = excluded.auth_tag,
      key_version = excluded.key_version,
      remembered_at = now()
    returning id into connection_id;
  end if;

  return connection_id;
end;
$$;

create function public.get_provider_connection(
  target_provider text,
  target_workspace_id uuid default null
)
returns table (
  connection_id uuid,
  credential_scope text,
  ciphertext text,
  nonce text,
  auth_tag text,
  key_version text,
  owner_id uuid
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
  if target_provider is null
      or target_provider not in ('openai', 'anthropic', 'google', 'openrouter') then
    raise exception 'Provider is invalid' using errcode = '22023';
  end if;
  if target_workspace_id is not null
      and not (select public.is_workspace_member(target_workspace_id)) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  return query
    select
      pc.id,
      case when pc.owner_user_id is not null then 'personal' else 'workspace' end,
      pc.ciphertext,
      pc.nonce,
      pc.auth_tag,
      pc.key_version,
      coalesce(pc.owner_user_id, pc.workspace_id)
    from public.provider_connections as pc
    where pc.provider = target_provider
      and (
        pc.owner_user_id = actor_id
        or (
          target_workspace_id is not null
          and pc.workspace_id = target_workspace_id
          and pc.owner_user_id is null
        )
      )
    order by (pc.owner_user_id is null)
    limit 1;
end;
$$;

create function public.list_provider_connections(
  target_workspace_id uuid default null
)
returns table (
  connection_id uuid,
  provider text,
  credential_scope text,
  remembered_at timestamptz
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
  if target_workspace_id is not null
      and not (select public.is_workspace_member(target_workspace_id)) then
    raise exception 'Workspace membership required' using errcode = '42501';
  end if;

  return query
    select
      pc.id,
      pc.provider,
      case when pc.owner_user_id is not null then 'personal' else 'workspace' end,
      pc.remembered_at
    from public.provider_connections as pc
    where pc.owner_user_id = actor_id
      or (
        target_workspace_id is not null
        and pc.workspace_id = target_workspace_id
        and pc.owner_user_id is null
      )
    order by pc.provider, (pc.owner_user_id is null);
end;
$$;

create function public.delete_provider_connection(
  target_provider text,
  target_workspace_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  deleted_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if target_provider is null
      or target_provider not in ('openai', 'anthropic', 'google', 'openrouter') then
    raise exception 'Provider is invalid' using errcode = '22023';
  end if;

  if target_workspace_id is null then
    delete from public.provider_connections
    where owner_user_id = actor_id
      and workspace_id is null
      and provider = target_provider;
  else
    if not (select public.is_workspace_admin(target_workspace_id)) then
      raise exception 'Workspace administrator access required' using errcode = '42501';
    end if;
    delete from public.provider_connections
    where workspace_id = target_workspace_id
      and owner_user_id is null
      and provider = target_provider;
  end if;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke all on function public.store_provider_connection(text, uuid, text, text, text, text, boolean) from public;
revoke all on function public.get_provider_connection(text, uuid) from public;
revoke all on function public.list_provider_connections(uuid) from public;
revoke all on function public.delete_provider_connection(text, uuid) from public;
grant execute on function public.store_provider_connection(text, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.get_provider_connection(text, uuid) to authenticated;
grant execute on function public.list_provider_connections(uuid) to authenticated;
grant execute on function public.delete_provider_connection(text, uuid) to authenticated;
