create index if not exists user_data_backups_user_time_idx
on public.user_data_backups (user_id, backed_up_at desc, backup_id desc);

create or replace function public.study_work_referenced(data jsonb, p_obra_id text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select
    exists (
      select 1 from jsonb_array_elements(public.study_jsonb_array(data->'sessionPlants')) p
      where p->>'obraId' = p_obra_id
    )
    or exists (
      select 1 from jsonb_array_elements(public.study_jsonb_array(data->'forestPlants')) p
      where p->>'obraId' = p_obra_id
    )
    or exists (
      select 1
      from jsonb_array_elements(public.study_jsonb_array(data->'sesiones')) s
      cross join lateral jsonb_array_elements(public.study_jsonb_array(s->'items')) item
      where item->>'obraId' = p_obra_id
    )
    or exists (
      select 1
      from jsonb_array_elements(public.study_jsonb_array(data->'eventos')) event
      cross join lateral jsonb_array_elements_text(public.study_jsonb_array(event->'obras')) obra_id
      where obra_id = p_obra_id
    );
$function$;

create or replace function public.preserve_crono_tasks_on_user_data_update()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  new.data := coalesce(new.data, '{}'::jsonb);
  if old.data->'cronoTasks' is distinct from new.data->'cronoTasks' then
    new.data := jsonb_set(
      new.data,
      '{cronoTasks}',
      public.merge_crono_task_arrays(old.data->'cronoTasks', new.data->'cronoTasks'),
      true
    );
  end if;
  return new;
end;
$function$;

create or replace function public.preserve_study_structure_on_user_data_update()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  new.data := coalesce(new.data, '{}'::jsonb);

  if old.data->'sessionPlants' is distinct from new.data->'sessionPlants' then
    new.data := jsonb_set(
      new.data,
      '{sessionPlants}',
      public.merge_study_record_arrays(old.data->'sessionPlants', new.data->'sessionPlants'),
      true
    );
  end if;

  if old.data->'forestPlants' is distinct from new.data->'forestPlants' then
    new.data := jsonb_set(
      new.data,
      '{forestPlants}',
      public.merge_study_record_arrays(old.data->'forestPlants', new.data->'forestPlants'),
      true
    );
  end if;

  if old.data->'obras' is distinct from new.data->'obras' then
    new.data := jsonb_set(
      new.data,
      '{obras}',
      public.protect_study_works(old.data, new.data),
      true
    );
  end if;

  return new;
end;
$function$;

create or replace function public.preserve_planning_on_user_data_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  event_tombstones jsonb;
  plan_tombstones jsonb;
  event_tombstones_changed boolean;
  plan_tombstones_changed boolean;
begin
  if new.data is null then
    return new;
  end if;

  event_tombstones_changed := old.data->'planningEventTombstones' is distinct from new.data->'planningEventTombstones';
  plan_tombstones_changed := old.data->'competitionPlanTombstones' is distinct from new.data->'competitionPlanTombstones';

  if event_tombstones_changed then
    event_tombstones := public.planning_string_array_union(
      old.data->'planningEventTombstones',
      new.data->'planningEventTombstones'
    );
    new.data := jsonb_set(new.data, '{planningEventTombstones}', event_tombstones, true);
  else
    event_tombstones := case when jsonb_typeof(new.data->'planningEventTombstones') = 'array'
      then new.data->'planningEventTombstones' else '[]'::jsonb end;
  end if;

  if plan_tombstones_changed then
    plan_tombstones := public.planning_string_array_union(
      old.data->'competitionPlanTombstones',
      new.data->'competitionPlanTombstones'
    );
    new.data := jsonb_set(new.data, '{competitionPlanTombstones}', plan_tombstones, true);
  else
    plan_tombstones := case when jsonb_typeof(new.data->'competitionPlanTombstones') = 'array'
      then new.data->'competitionPlanTombstones' else '[]'::jsonb end;
  end if;

  if old.data->'eventos' is distinct from new.data->'eventos' or event_tombstones_changed then
    new.data := jsonb_set(
      new.data,
      '{eventos}',
      public.merge_planning_json_arrays(
        old.data->'eventos',
        new.data->'eventos',
        event_tombstones,
        false
      ),
      true
    );
  end if;

  if old.data->'competitionPlans' is distinct from new.data->'competitionPlans' or plan_tombstones_changed then
    new.data := jsonb_set(
      new.data,
      '{competitionPlans}',
      public.merge_planning_json_arrays(
        old.data->'competitionPlans',
        new.data->'competitionPlans',
        plan_tombstones,
        false
      ),
      true
    );
  end if;

  return new;
end;
$function$;

create or replace function public.backup_user_data_before_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  inserted_backup boolean := false;
begin
  if old.data is distinct from new.data
     and not exists (
       select 1
       from public.user_data_backups b
       where b.user_id = old.id
         and b.backed_up_at >= now() - interval '30 seconds'
     ) then
    insert into public.user_data_backups(user_id, data, source_updated_at, backed_up_at)
    values (old.id, old.data, old.updated_at, now());
    inserted_backup := true;
  end if;

  if inserted_backup then
    delete from public.user_data_backups b
    where b.user_id = old.id
      and b.backup_id in (
        select backup_id
        from public.user_data_backups
        where user_id = old.id
        order by backed_up_at desc, backup_id desc
        offset 50
      );
  end if;

  return new;
end;
$function$;
