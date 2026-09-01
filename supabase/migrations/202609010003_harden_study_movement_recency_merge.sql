create or replace function public.study_movement_mutation_at(item jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  with stamps as (
    select coalesce(item->>'updatedAt','') as stamp
    union all select coalesce(item->>'lastPase','')
    union all select coalesce(item->'currentZone'->>'date','')
    union all
      select coalesce(h->>'correctedAt', h->>'updatedAt', h->>'date', h->>'at', '')
      from jsonb_array_elements(public.study_jsonb_array(item->'solHistory')) h
    union all
      select coalesce(h->>'correctedAt', h->>'updatedAt', h->>'date', h->>'at', '')
      from jsonb_array_elements(public.study_jsonb_array(item->'paseHistory')) h
    union all
      select coalesce(h->>'updatedAt', h->>'date', h->>'at', '')
      from jsonb_array_elements(public.study_jsonb_array(item->'zoneHistory')) h
    union all
      select coalesce(h->>'updatedAt', h->>'date', h->>'at', '')
      from jsonb_array_elements(public.study_jsonb_array(item->'compasHistory')) h
  )
  select coalesce(max(stamp), '') from stamps;
$$;

create or replace function public.merge_study_movement(old_movement jsonb, new_movement jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  merged jsonb;
  key text;
  old_last text;
  new_last text;
  old_mutation text;
  new_mutation text;
begin
  if old_movement is null then return new_movement; end if;
  if new_movement is null then return old_movement; end if;

  old_mutation := public.study_movement_mutation_at(old_movement);
  new_mutation := public.study_movement_mutation_at(new_movement);

  -- The version with the freshest real movement activity wins scalar fields.
  -- On an exact tie, the already-committed cloud object wins.
  if old_mutation >= new_mutation then
    merged := new_movement || old_movement;
  else
    merged := old_movement || new_movement;
  end if;

  foreach key in array array['solHistory','paseHistory','zoneHistory','compasHistory'] loop
    merged := jsonb_set(
      merged,
      array[key],
      public.merge_study_history_arrays(old_movement->key, new_movement->key),
      true
    );
  end loop;

  old_last := coalesce(old_movement->>'lastPase','');
  new_last := coalesce(new_movement->>'lastPase','');
  if old_last > new_last then
    merged := jsonb_set(merged, '{lastPase}', to_jsonb(old_last), true);
  end if;

  return merged;
end;
$$;

revoke all on function public.study_movement_mutation_at(jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_movement(jsonb,jsonb) from public, anon, authenticated;
