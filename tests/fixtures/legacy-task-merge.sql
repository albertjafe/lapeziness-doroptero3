-- Legacy helper read from the deployed schema on 2026-09-04 (no user rows).
-- Its original migration is absent from this checkout. Keep this fixture so
-- integration tests exercise the actual helper alongside the versioned guards.
CREATE OR REPLACE FUNCTION public.merge_crono_task_arrays(old_tasks jsonb, new_tasks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with candidates as (
    select value as task, 0 as source_rank
    from jsonb_array_elements(case when jsonb_typeof(old_tasks) = 'array' then old_tasks else '[]'::jsonb end)
    union all
    select value as task, 1 as source_rank
    from jsonb_array_elements(case when jsonb_typeof(new_tasks) = 'array' then new_tasks else '[]'::jsonb end)
  ), ranked as (
    select task,
           row_number() over (
             partition by coalesce(nullif(task->>'id',''), md5(task::text))
             order by greatest(
               coalesce(task->>'updatedAt',''),
               coalesce(task->>'priorityChangedAt',''),
               coalesce(task->>'doneAt',''),
               coalesce(task->>'createdAt','')
             ) desc,
             source_rank desc
           ) as rn
    from candidates
    where jsonb_typeof(task) = 'object'
  )
  select coalesce(
    jsonb_agg(task order by coalesce(task->>'createdAt',''), coalesce(task->>'id','')),
    '[]'::jsonb
  )
  from ranked
  where rn = 1;
$function$;
