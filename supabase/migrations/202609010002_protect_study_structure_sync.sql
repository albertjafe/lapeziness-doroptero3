create or replace function public.study_jsonb_array(value jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end;
$$;

create or replace function public.study_record_key(item jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(
    nullif(item->>'id',''),
    md5(concat_ws('|',
      coalesce(item->>'source',''),
      coalesce(item->>'startedAt',''),
      coalesce(item->>'endedAt',''),
      coalesce(item->>'mins', item->>'min', ''),
      coalesce(item->>'tag','')
    ))
  );
$$;

create or replace function public.study_record_mutation_at(item jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select greatest(
    coalesce(item->>'updatedAt',''),
    coalesce(item->>'correctedAt',''),
    coalesce(item->>'reassignedAt',''),
    coalesce(item->>'endedAt',''),
    coalesce(item->>'startedAt','')
  );
$$;

create or replace function public.merge_study_record_arrays(old_items jsonb, new_items jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  with candidates as (
    select value as item, 1 as current_cloud
    from jsonb_array_elements(public.study_jsonb_array(old_items))
    union all
    select value as item, 0 as current_cloud
    from jsonb_array_elements(public.study_jsonb_array(new_items))
  ), ranked as (
    select item,
           row_number() over (
             partition by public.study_record_key(item)
             order by public.study_record_mutation_at(item) desc, current_cloud desc
           ) as rn
    from candidates
    where jsonb_typeof(item) = 'object'
  )
  select coalesce(
    jsonb_agg(item order by coalesce(item->>'startedAt',''), coalesce(item->>'endedAt',''), public.study_record_key(item)),
    '[]'::jsonb
  )
  from ranked
  where rn = 1;
$$;

create or replace function public.study_history_key(item jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(
    nullif(item->>'id',''),
    nullif(item->>'paseId',''),
    md5(concat_ws('|',
      coalesce(item->>'date', item->>'at', ''),
      coalesce(item->>'context',''),
      coalesce(item->>'tipo', item->>'type', ''),
      coalesce(item->>'phase','')
    ))
  );
$$;

create or replace function public.study_history_mutation_at(item jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select greatest(
    coalesce(item->>'updatedAt',''),
    coalesce(item->>'correctedAt',''),
    coalesce(item->>'date', item->>'at', '')
  );
$$;

create or replace function public.merge_study_history_arrays(old_items jsonb, new_items jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  with candidates as (
    select value as item, 1 as current_cloud
    from jsonb_array_elements(public.study_jsonb_array(old_items))
    union all
    select value as item, 0 as current_cloud
    from jsonb_array_elements(public.study_jsonb_array(new_items))
  ), ranked as (
    select item,
           row_number() over (
             partition by public.study_history_key(item)
             order by public.study_history_mutation_at(item) desc, current_cloud desc
           ) as rn
    from candidates
    where jsonb_typeof(item) = 'object'
  )
  select coalesce(
    jsonb_agg(item order by coalesce(item->>'date', item->>'at', ''), public.study_history_key(item)),
    '[]'::jsonb
  )
  from ranked
  where rn = 1;
$$;

create or replace function public.study_movement_referenced(data jsonb, p_obra_id text, p_mov_id text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    exists (
      select 1
      from jsonb_array_elements(public.study_jsonb_array(data->'sessionPlants')) p
      where p->>'obraId' = p_obra_id and p->>'movId' = p_mov_id
    )
    or exists (
      select 1
      from jsonb_array_elements(public.study_jsonb_array(data->'forestPlants')) p
      where p->>'obraId' = p_obra_id and p->>'movId' = p_mov_id
    )
    or exists (
      select 1
      from jsonb_array_elements(public.study_jsonb_array(data->'sesiones')) s
      cross join lateral jsonb_array_elements(public.study_jsonb_array(s->'items')) item
      where item->>'obraId' = p_obra_id and item->>'movId' = p_mov_id
    );
$$;

create or replace function public.study_work_referenced(data jsonb, p_obra_id text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
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
    );
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
begin
  if old_movement is null then return new_movement; end if;
  if new_movement is null then return old_movement; end if;

  -- Incoming scalar edits are respected, while append-only histories are merged.
  merged := old_movement || new_movement;
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

create or replace function public.merge_study_movements(
  old_movements jsonb,
  new_movements jsonb,
  old_data jsonb,
  new_data jsonb,
  p_obra_id text,
  p_new_declared boolean
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  result jsonb := '[]'::jsonb;
  new_m jsonb;
  old_m jsonb;
  old_id text;
begin
  for new_m in select value from jsonb_array_elements(public.study_jsonb_array(new_movements)) loop
    select value into old_m
    from jsonb_array_elements(public.study_jsonb_array(old_movements))
    where value->>'id' = new_m->>'id'
    limit 1;

    result := result || jsonb_build_array(public.merge_study_movement(old_m, new_m));
    old_m := null;
  end loop;

  for old_m in select value from jsonb_array_elements(public.study_jsonb_array(old_movements)) loop
    old_id := old_m->>'id';
    if old_id is null or old_id = '' then continue; end if;

    if exists (
      select 1 from jsonb_array_elements(public.study_jsonb_array(new_movements)) n
      where n->>'id' = old_id
    ) then
      continue;
    end if;

    -- A legacy/stale work object often omits the movimientos key entirely.
    -- Also preserve any movement that already has real study/history attached.
    if not p_new_declared
       or public.study_movement_referenced(old_data, p_obra_id, old_id)
       or public.study_movement_referenced(new_data, p_obra_id, old_id)
       or jsonb_array_length(public.study_jsonb_array(old_m->'solHistory')) > 0
       or jsonb_array_length(public.study_jsonb_array(old_m->'paseHistory')) > 0
       or jsonb_array_length(public.study_jsonb_array(old_m->'zoneHistory')) > 0
       or jsonb_array_length(public.study_jsonb_array(old_m->'compasHistory')) > 0
    then
      result := result || jsonb_build_array(old_m);
    end if;
  end loop;

  return result;
end;
$$;

create or replace function public.study_forest_minutes(data jsonb, p_obra_id text)
returns numeric
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(sum(
    case
      when coalesce(p->>'mins', p->>'min', '') ~ '^[0-9]+([.][0-9]+)?$'
      then coalesce(p->>'mins', p->>'min')::numeric
      else 0
    end
  ), 0)
  from jsonb_array_elements(public.study_jsonb_array(data->'forestPlants')) p
  where p->>'obraId' = p_obra_id
    and lower(coalesce(p->>'failed','false')) <> 'true'
    and lower(coalesce(p->>'tipo','')) <> 'descanso';
$$;

create or replace function public.protect_study_work(old_work jsonb, new_work jsonb, old_data jsonb, new_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  merged jsonb;
  key text;
  obra_id text;
  forest_floor numeric;
  current_extra numeric;
  old_last text;
  new_last text;
begin
  if old_work is null then return new_work; end if;
  if new_work is null then return old_work; end if;

  merged := old_work || new_work;
  obra_id := coalesce(new_work->>'id', old_work->>'id');

  foreach key in array array['solHistory','paseHistory','zoneHistory','compasHistory'] loop
    merged := jsonb_set(
      merged,
      array[key],
      public.merge_study_history_arrays(old_work->key, new_work->key),
      true
    );
  end loop;

  merged := jsonb_set(
    merged,
    '{movimientos}',
    public.merge_study_movements(
      old_work->'movimientos',
      new_work->'movimientos',
      old_data,
      new_data,
      obra_id,
      new_work ? 'movimientos'
    ),
    true
  );

  old_last := coalesce(old_work->>'lastPase','');
  new_last := coalesce(new_work->>'lastPase','');
  if old_last > new_last then
    merged := jsonb_set(merged, '{lastPase}', to_jsonb(old_last), true);
  end if;

  -- Imported Forest minutes are derivable from the canonical Forest rows.
  -- An incoming stale snapshot can never reduce minutosExtra below that floor.
  forest_floor := public.study_forest_minutes(new_data, obra_id);
  current_extra := case
    when coalesce(merged->>'minutosExtra','') ~ '^[0-9]+([.][0-9]+)?$' then (merged->>'minutosExtra')::numeric
    else 0
  end;
  if forest_floor > current_extra then
    merged := jsonb_set(merged, '{minutosExtra}', to_jsonb(forest_floor), true);
  end if;

  return merged;
end;
$$;

create or replace function public.protect_study_works(old_data jsonb, new_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  result jsonb := '[]'::jsonb;
  new_work jsonb;
  old_work jsonb;
  old_id text;
begin
  for new_work in select value from jsonb_array_elements(public.study_jsonb_array(new_data->'obras')) loop
    select value into old_work
    from jsonb_array_elements(public.study_jsonb_array(old_data->'obras'))
    where value->>'id' = new_work->>'id'
    limit 1;

    if old_work is null then
      -- Even new works get the Forest floor applied.
      result := result || jsonb_build_array(public.protect_study_work('{}'::jsonb, new_work, old_data, new_data));
    else
      result := result || jsonb_build_array(public.protect_study_work(old_work, new_work, old_data, new_data));
    end if;
    old_work := null;
  end loop;

  -- Do not let a stale snapshot erase an entire work while its study records
  -- are still present. Truly unused works can still be deleted normally.
  for old_work in select value from jsonb_array_elements(public.study_jsonb_array(old_data->'obras')) loop
    old_id := old_work->>'id';
    if old_id is null or old_id = '' then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(public.study_jsonb_array(new_data->'obras')) n
      where n->>'id' = old_id
    ) then
      continue;
    end if;
    if public.study_work_referenced(old_data, old_id) or public.study_work_referenced(new_data, old_id) then
      result := result || jsonb_build_array(old_work);
    end if;
  end loop;

  return result;
end;
$$;

create or replace function public.preserve_study_structure_on_user_data_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.data := coalesce(new.data, '{}'::jsonb);

  -- Canonical append-only study records are unioned before repairing works.
  -- On an exact tie the already-committed cloud copy wins; an explicit later
  -- correctedAt/updatedAt from the client still wins legitimately.
  new.data := jsonb_set(
    new.data,
    '{sessionPlants}',
    public.merge_study_record_arrays(old.data->'sessionPlants', new.data->'sessionPlants'),
    true
  );
  new.data := jsonb_set(
    new.data,
    '{forestPlants}',
    public.merge_study_record_arrays(old.data->'forestPlants', new.data->'forestPlants'),
    true
  );
  new.data := jsonb_set(
    new.data,
    '{obras}',
    public.protect_study_works(old.data, new.data),
    true
  );

  return new;
end;
$$;

drop trigger if exists trg_01_preserve_study_structure on public.user_data;
create trigger trg_01_preserve_study_structure
before update of data on public.user_data
for each row execute function public.preserve_study_structure_on_user_data_update();

revoke all on function public.study_jsonb_array(jsonb) from public, anon, authenticated;
revoke all on function public.study_record_key(jsonb) from public, anon, authenticated;
revoke all on function public.study_record_mutation_at(jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_record_arrays(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.study_history_key(jsonb) from public, anon, authenticated;
revoke all on function public.study_history_mutation_at(jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_history_arrays(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.study_movement_referenced(jsonb,text,text) from public, anon, authenticated;
revoke all on function public.study_work_referenced(jsonb,text) from public, anon, authenticated;
revoke all on function public.merge_study_movement(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_movements(jsonb,jsonb,jsonb,jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.study_forest_minutes(jsonb,text) from public, anon, authenticated;
revoke all on function public.protect_study_work(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.protect_study_works(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.preserve_study_structure_on_user_data_update() from public, anon, authenticated;
