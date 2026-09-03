create or replace function public.planning_string_array_union(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  from (
    select distinct value
    from (
      select jsonb_array_elements_text(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) as value
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) as value
    ) s
    where nullif(value, '') is not null
  ) q;
$$;

create or replace function public.planning_item_mutation_at(item jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select greatest(
    coalesce(item->>'updatedAt',''),
    coalesce(item->>'completedDate',''),
    coalesce(item->>'correctedAt',''),
    coalesce(item->>'createdAt','')
  );
$$;

create or replace function public.merge_planning_json_arrays(
  old_items jsonb,
  new_items jsonb,
  tombstones jsonb default '[]'::jsonb,
  protected_only boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  result jsonb := '[]'::jsonb;
  item jsonb;
  existing jsonb;
  item_id text;
  idx integer;
  n integer;
  is_tombstoned boolean;
  old_is_protected boolean;
begin
  old_items := case when jsonb_typeof(old_items) = 'array' then old_items else '[]'::jsonb end;
  new_items := case when jsonb_typeof(new_items) = 'array' then new_items else '[]'::jsonb end;
  tombstones := case when jsonb_typeof(tombstones) = 'array' then tombstones else '[]'::jsonb end;

  for item in select value from jsonb_array_elements(new_items)
  loop
    item_id := nullif(item->>'id','');
    is_tombstoned := item_id is not null and tombstones ? item_id;
    if not is_tombstoned then
      result := result || jsonb_build_array(item);
    end if;
  end loop;

  for item in select value from jsonb_array_elements(old_items)
  loop
    item_id := nullif(item->>'id','');
    if item_id is null then
      continue;
    end if;
    if tombstones ? item_id then
      continue;
    end if;
    old_is_protected := lower(coalesce(item->>'planningProtected','false')) = 'true';
    if protected_only and not old_is_protected then
      continue;
    end if;

    existing := null;
    idx := null;
    n := jsonb_array_length(result);
    if n > 0 then
      for i in 0..n-1 loop
        if result->i->>'id' = item_id then
          existing := result->i;
          idx := i;
          exit;
        end if;
      end loop;
    end if;

    if existing is null then
      result := result || jsonb_build_array(item);
      continue;
    end if;

    if protected_only and old_is_protected
       and lower(coalesce(existing->>'planningProtected','false')) <> 'true' then
      result := jsonb_set(result, array[idx::text], existing || item, false);
    elsif public.planning_item_mutation_at(item) > public.planning_item_mutation_at(existing) then
      result := jsonb_set(result, array[idx::text], existing || item, false);
    else
      result := jsonb_set(result, array[idx::text], item || existing, false);
    end if;
  end loop;

  return result;
end;
$$;

create or replace function public.preserve_planning_on_user_data_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_tombstones jsonb;
  plan_tombstones jsonb;
begin
  if new.data is null then
    return new;
  end if;

  event_tombstones := public.planning_string_array_union(
    old.data->'planningEventTombstones',
    new.data->'planningEventTombstones'
  );
  plan_tombstones := public.planning_string_array_union(
    old.data->'competitionPlanTombstones',
    new.data->'competitionPlanTombstones'
  );

  new.data := jsonb_set(new.data, '{planningEventTombstones}', event_tombstones, true);
  new.data := jsonb_set(new.data, '{competitionPlanTombstones}', plan_tombstones, true);
  new.data := jsonb_set(
    new.data,
    '{eventos}',
    public.merge_planning_json_arrays(old.data->'eventos', new.data->'eventos', event_tombstones, true),
    true
  );
  new.data := jsonb_set(
    new.data,
    '{competitionPlans}',
    public.merge_planning_json_arrays(old.data->'competitionPlans', new.data->'competitionPlans', plan_tombstones, false),
    true
  );

  return new;
end;
$$;

drop trigger if exists trg_02_preserve_planning on public.user_data;
create trigger trg_02_preserve_planning
before update of data on public.user_data
for each row
execute function public.preserve_planning_on_user_data_update();
