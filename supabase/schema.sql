-- My Daily Journal: cloud schema. Run once in Supabase -> SQL Editor.
create table public.records(
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('note','task','habit','goal','refl','setting')),
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,                 -- tombstone: deletes never remove rows
  server_version bigint not null default 0);
create index records_owner_version on public.records(owner_id, server_version);

-- Server-assigned change counter: devices pull "everything after version N", immune to clock skew.
create sequence public.records_version;
create function public.records_bump() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.server_version := nextval('public.records_version');
  if tg_op = 'UPDATE' then new.owner_id := old.owner_id; end if;
  return new;
end $$;
create trigger records_bump before insert or update on public.records
  for each row execute function public.records_bump();

alter table public.records enable row level security;
create policy "own select" on public.records for select using (owner_id = auth.uid());
create policy "own insert" on public.records for insert with check (owner_id = auth.uid());
create policy "own update" on public.records for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- SQL privileges are required in addition to RLS policies. RLS still limits
-- each authenticated user to rows where owner_id = auth.uid().
grant select, insert, update on public.records to authenticated;
-- Intentionally no DELETE policy. Never put the service-role key in the frontend.
