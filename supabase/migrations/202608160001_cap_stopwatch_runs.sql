-- Stop orphaned stopwatches from producing indefinitely growing milestones.
update public.push_timer_runs
set status = 'completed', updated_at = now()
where mode = 'stopwatch'
  and status in ('active', 'paused')
  and coalesce(ends_at, started_at + interval '120 minutes') <= now();

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
    else
      if coalesce(timer_run.ends_at, timer_run.started_at + interval '120 minutes') <= now() then
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
