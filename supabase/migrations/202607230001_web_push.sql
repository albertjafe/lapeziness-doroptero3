create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users read their push subscriptions" on public.push_subscriptions;
drop policy if exists "Users create their push subscriptions" on public.push_subscriptions;
drop policy if exists "Users update their push subscriptions" on public.push_subscriptions;
drop policy if exists "Users delete their push subscriptions" on public.push_subscriptions;

create policy "Users read their push subscriptions"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);
create policy "Users create their push subscriptions"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);
create policy "Users update their push subscriptions"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users delete their push subscriptions"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

create table if not exists public.push_timer_runs (
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null,
  mode text not null check (mode in ('timer', 'stopwatch')),
  is_rest boolean not null default false,
  work_name text not null default 'Sesión de estudio',
  started_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  sent_countdown smallint[] not null default '{}',
  last_milestone_minutes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, run_id),
  check ((mode = 'timer' and ends_at is not null) or mode = 'stopwatch')
);

create index if not exists push_timer_runs_due_idx
  on public.push_timer_runs (status, ends_at, updated_at);

alter table public.push_timer_runs enable row level security;

drop policy if exists "Users read their push timer runs" on public.push_timer_runs;
drop policy if exists "Users create their push timer runs" on public.push_timer_runs;
drop policy if exists "Users update their push timer runs" on public.push_timer_runs;
drop policy if exists "Users delete their push timer runs" on public.push_timer_runs;

create policy "Users read their push timer runs"
  on public.push_timer_runs for select
  using (auth.uid() = user_id);
create policy "Users create their push timer runs"
  on public.push_timer_runs for insert
  with check (auth.uid() = user_id);
create policy "Users update their push timer runs"
  on public.push_timer_runs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users delete their push timer runs"
  on public.push_timer_runs for delete
  using (auth.uid() = user_id);

create or replace function public.claim_due_push_events(p_limit integer default 100)
returns table (
  event_id uuid,
  user_id uuid,
  run_id text,
  event_kind text,
  warning_minutes integer,
  milestone_minutes integer,
  work_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  timer_run public.push_timer_runs%rowtype;
  remaining_seconds numeric;
  current_warning integer;
  current_milestone integer;
begin
  for timer_run in
    select runs.*
    from public.push_timer_runs as runs
    where runs.status = 'active'
    order by runs.updated_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    if timer_run.mode = 'timer' then
      if timer_run.ends_at <= now() then
        update public.push_timer_runs
          set status = 'completed', updated_at = now()
          where push_timer_runs.user_id = timer_run.user_id
            and push_timer_runs.run_id = timer_run.run_id;
        continue;
      end if;

      remaining_seconds := extract(epoch from (timer_run.ends_at - now()));
      current_warning := ceil(remaining_seconds / 60.0)::integer;
      if current_warning between 1 and 5
         and not (current_warning = any(coalesce(timer_run.sent_countdown, '{}'))) then
        update public.push_timer_runs
          set sent_countdown = array_append(coalesce(sent_countdown, '{}'), current_warning::smallint),
              updated_at = now()
          where push_timer_runs.user_id = timer_run.user_id
            and push_timer_runs.run_id = timer_run.run_id;
        return query select
          gen_random_uuid(), timer_run.user_id, timer_run.run_id,
          'timer-countdown'::text, current_warning, null::integer, timer_run.work_name;
      end if;
    elsif not timer_run.is_rest then
      current_milestone := floor(extract(epoch from (now() - timer_run.started_at)) / 900.0)::integer * 15;
      if current_milestone >= 15 and current_milestone > timer_run.last_milestone_minutes then
        update public.push_timer_runs
          set last_milestone_minutes = current_milestone,
              updated_at = now()
          where push_timer_runs.user_id = timer_run.user_id
            and push_timer_runs.run_id = timer_run.run_id;
        return query select
          gen_random_uuid(), timer_run.user_id, timer_run.run_id,
          'stopwatch-milestone'::text, null::integer, current_milestone, timer_run.work_name;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_due_push_events(integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_events(integer) to service_role;
