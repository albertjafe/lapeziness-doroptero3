create table if not exists public.professor_context_cache (
  user_id uuid primary key references auth.users(id) on delete cascade,
  context jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  data_updated_at timestamptz
);

alter table public.professor_context_cache enable row level security;

revoke all on table public.professor_context_cache from anon;
grant select, insert, update on table public.professor_context_cache to authenticated;

drop policy if exists professor_context_select_own on public.professor_context_cache;
create policy professor_context_select_own on public.professor_context_cache
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists professor_context_insert_own on public.professor_context_cache;
create policy professor_context_insert_own on public.professor_context_cache
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists professor_context_update_own on public.professor_context_cache;
create policy professor_context_update_own on public.professor_context_cache
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.professor_context_cache is 'Derived, disposable movement-level context for the virtual professor. Source of truth remains user_data/activity_events.';
