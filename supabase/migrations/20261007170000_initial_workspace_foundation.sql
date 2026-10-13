create type public.workspace_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, created_by)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint conversations_project_workspace_fkey
    foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id)
    on delete cascade
);

create index workspace_members_user_workspace_idx
  on public.workspace_members (user_id, workspace_id);
create index projects_workspace_created_idx
  on public.projects (workspace_id, created_at desc);
create index conversations_workspace_created_idx
  on public.conversations (workspace_id, created_at desc);
create index conversations_project_created_idx
  on public.conversations (project_id, created_at desc)
  where project_id is not null;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
  );
$$;

create function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from public;
revoke all on function public.set_updated_at() from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

create function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  clean_name text := btrim(workspace_name);
  new_workspace_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 80 then
    raise exception 'Workspace name must contain 2 to 80 characters' using errcode = '22023';
  end if;

  insert into public.workspaces (name, created_by)
  values (clean_name, actor_id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, actor_id, 'owner');

  return new_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  profile_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, profile_name);

  insert into public.workspaces (name, created_by)
  values ('Personal workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.projects from anon, authenticated;
revoke all on public.conversations from anon, authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Workspace members can read workspaces"
  on public.workspaces for select to authenticated
  using ((select public.is_workspace_member(id)));
create policy "Workspace admins can update workspaces"
  on public.workspaces for update to authenticated
  using ((select public.is_workspace_admin(id)))
  with check ((select public.is_workspace_admin(id)));

create policy "Workspace members can read memberships"
  on public.workspace_members for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy "Workspace members can read projects"
  on public.projects for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));
create policy "Members can create projects for themselves"
  on public.projects for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.is_workspace_member(workspace_id))
  );
create policy "Project owners and workspace admins can update projects"
  on public.projects for update to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  )
  with check (
    created_by = (select auth.uid())
    and (select public.is_workspace_member(workspace_id))
  );
create policy "Project owners and workspace admins can delete projects"
  on public.projects for delete to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  );

create policy "Workspace members can read conversations"
  on public.conversations for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));
create policy "Members can create conversations for themselves"
  on public.conversations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.is_workspace_member(workspace_id))
  );
create policy "Conversation owners and workspace admins can update conversations"
  on public.conversations for update to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  )
  with check (
    created_by = (select auth.uid())
    and (select public.is_workspace_member(workspace_id))
  );
create policy "Conversation owners and workspace admins can delete conversations"
  on public.conversations for delete to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  );

grant usage on schema public to authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select, update (name) on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
