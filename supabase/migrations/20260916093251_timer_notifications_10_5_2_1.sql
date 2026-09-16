-- Align server-side timer warnings with the client schedule: 10, 5, 2 and 1 minutes.
alter table public.push_timer_runs add column if not exists pause_until timestamptz;

-- Late registration/resume requests must not resurrect completed/cancelled runs.
create or replace function public.protect_terminal_push_run()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status in ('cancelled','completed') then return old; end if;
  new.sent_countdown := array(
    select distinct value from unnest(coalesce(old.sent_countdown,'{}'::smallint[]) ||
      coalesce(new.sent_countdown,'{}'::smallint[])) as warning(value) order by value desc
  );
  new.last_milestone_minutes := greatest(old.last_milestone_minutes,new.last_milestone_minutes);
  return new;
end;
$$;
revoke all on function public.protect_terminal_push_run() from public, anon, authenticated;
create trigger protect_terminal_push_run before update on public.push_timer_runs
for each row execute function public.protect_terminal_push_run();

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
    where runs.status = 'active' or (runs.status = 'paused' and runs.pause_until <= now())
    order by runs.updated_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    if timer_run.status = 'paused' then
      update public.push_timer_runs set status = 'active', pause_until = null, updated_at = now()
        where push_timer_runs.user_id = timer_run.user_id and push_timer_runs.run_id = timer_run.run_id;
    end if;
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
      if current_warning = any(array[10, 5, 2, 1])
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
    else
      if coalesce(timer_run.ends_at, timer_run.started_at + interval '120 minutes') <= now() then
        if not timer_run.is_rest and timer_run.last_milestone_minutes < 120
           and now() - coalesce(timer_run.ends_at, timer_run.started_at + interval '120 minutes') < interval '1 minute' then
          return query select gen_random_uuid(), timer_run.user_id, timer_run.run_id,
            'stopwatch-milestone'::text, null::integer, 120, timer_run.work_name;
        end if;
        update public.push_timer_runs
          set status = 'completed', updated_at = now()
          where push_timer_runs.user_id = timer_run.user_id
            and push_timer_runs.run_id = timer_run.run_id;
        continue;
      end if;

      if not timer_run.is_rest then
        current_milestone := floor(extract(epoch from (now() - timer_run.started_at)) / 900.0)::integer * 15;
        if current_milestone between 15 and 105
           and current_milestone > timer_run.last_milestone_minutes then
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
    end if;
  end loop;
end;
$$;

revoke all on function public.claim_due_push_events(integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_events(integer) to service_role;
