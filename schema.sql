-- Run in the Supabase SQL Editor. Use a new Supabase project for this dashboard.
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  join_code text not null unique default encode(gen_random_bytes(18), 'hex'),
  document jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  version integer not null default 0,
  owner_id uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (project_id, user_id)
);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- SECURITY DEFINER avoids recursive row-level policy lookups.
create or replace function public.is_project_member(p_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists(select 1 from public.project_members
    where project_id = p_id and user_id = (select auth.uid()));
$$;
revoke all on function public.is_project_member(uuid) from public;
grant execute on function public.is_project_member(uuid) to authenticated;

create policy "Members can read projects" on public.projects for select to authenticated
  using (public.is_project_member(id));
create policy "Users can create their projects" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Members can view their memberships" on public.project_members for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.add_project_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members(project_id, user_id) values (new.id, new.owner_id);
  return new;
end;
$$;
drop trigger if exists trg_project_owner on public.projects;
create trigger trg_project_owner after insert on public.projects
  for each row execute function public.add_project_owner();

create or replace function public.join_shared_project(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  select id into v_id from public.projects where join_code = trim(p_code);
  if v_id is null then raise exception 'Unknown invitation code'; end if;
  insert into public.project_members(project_id, user_id)
    values (v_id, (select auth.uid())) on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.join_shared_project(text) from public;
grant execute on function public.join_shared_project(text) to authenticated;

-- Optimistic concurrency: prevents silently overwriting a teammate's work.
create or replace function public.save_workflow(p_project_id uuid, p_document jsonb, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  if not public.is_project_member(p_project_id) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_document->'nodes') is distinct from 'array'
     or jsonb_typeof(p_document->'edges') is distinct from 'array' then
    raise exception 'Invalid workflow document';
  end if;
  update public.projects
     set document = p_document, version = version + 1, updated_at = now()
   where id = p_project_id and version = p_expected_version
   returning version into v_version;
  if v_version is null then raise exception 'VERSION_CONFLICT: reload before saving'; end if;
  return v_version;
end;
$$;
revoke all on function public.save_workflow(uuid,jsonb,integer) from public;
grant execute on function public.save_workflow(uuid,jsonb,integer) to authenticated;

-- Realtime must be enabled for the projects table in Supabase > Database > Replication.
-- Or run this once if permissions allow:
-- alter publication supabase_realtime add table public.projects;
