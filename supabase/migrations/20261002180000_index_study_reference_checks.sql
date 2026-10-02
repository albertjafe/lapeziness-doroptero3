-- 02-10-2026 · La protección de obras/movimientos superaba los 8 s (57014).
--
-- protect_study_works() preguntaba, por cada movimiento u obra que faltaba en
-- la copia nueva, si alguna sesión lo usaba: study_movement_referenced() y
-- study_work_referenced() recorren sessionPlants, forestPlants y sesiones de
-- los DOS documentos completos (≈3,4 MB) en cada llamada, y
-- study_forest_minutes() recorría forestPlants una vez por obra. Con unos
-- pocos movimientos borrados la subida («Subiendo un lote del historial»)
-- se cancelaba siempre y el iPad no podía sincronizar.
--
-- Ahora el historial se recorre UNA vez por guardado para construir los
-- índices (movimientos y obras usados en cualquiera de los dos documentos y
-- minutos Forest por obra) y las reglas son exactamente las mismas:
--   · un movimiento que falta se conserva si la obra nueva no declara
--     «movimientos», si está referenciado en la copia antigua o en la nueva o
--     si tiene historial propio;
--   · una obra que falta se conserva si está referenciada;
--   · minutosExtra nunca baja del total Forest de la obra.
-- Las funciones antiguas siguen existiendo (mismas firmas) por compatibilidad.

create or replace function public.study_reference_index(old_data jsonb, new_data jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  with docs(d) as (values (old_data), (new_data)),
  uses(obra_id, mov_id) as (
    select p->>'obraId', p->>'movId'
    from docs, jsonb_array_elements(public.study_jsonb_array(d->'sessionPlants')) p
    union all
    select p->>'obraId', p->>'movId'
    from docs, jsonb_array_elements(public.study_jsonb_array(d->'forestPlants')) p
    union all
    select item->>'obraId', item->>'movId'
    from docs, jsonb_array_elements(public.study_jsonb_array(d->'sesiones')) s
    cross join lateral jsonb_array_elements(public.study_jsonb_array(s->'items')) item
  ),
  event_works(obra_id) as (
    select obra_id
    from docs, jsonb_array_elements(public.study_jsonb_array(d->'eventos')) event
    cross join lateral jsonb_array_elements_text(public.study_jsonb_array(event->'obras')) obra_id
  ),
  forest as (
    select p->>'obraId' as obra_id,
           sum(case
             when coalesce(p->>'mins', p->>'min', '') ~ '^[0-9]+([.][0-9]+)?$'
             then coalesce(p->>'mins', p->>'min')::numeric
             else 0
           end) as minutes
    from jsonb_array_elements(public.study_jsonb_array(new_data->'forestPlants')) p
    where p->>'obraId' is not null
      and lower(coalesce(p->>'failed','false')) <> 'true'
      and lower(coalesce(p->>'tipo','')) <> 'descanso'
    group by 1
  )
  select jsonb_build_object(
    'movements', coalesce((
      select jsonb_object_agg(k, true)
      from (select distinct obra_id || chr(31) || mov_id as k from uses
            where obra_id is not null and mov_id is not null) x), '{}'::jsonb),
    'works', coalesce((
      select jsonb_object_agg(obra_id, true)
      from (select obra_id from uses where obra_id is not null
            union select obra_id from event_works where obra_id is not null) y), '{}'::jsonb),
    'forest', coalesce((select jsonb_object_agg(obra_id, minutes) from forest), '{}'::jsonb)
  );
$$;

create or replace function public.merge_study_movements_indexed(
  old_movements jsonb,
  new_movements jsonb,
  p_index jsonb,
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

    if not p_new_declared
       or coalesce(p_index->'movements' ? (p_obra_id || chr(31) || old_id), false)
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

create or replace function public.protect_study_work_indexed(old_work jsonb, new_work jsonb, p_index jsonb)
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
    public.merge_study_movements_indexed(
      old_work->'movimientos',
      new_work->'movimientos',
      p_index,
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

  forest_floor := coalesce((p_index->'forest'->>obra_id)::numeric, 0);
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
  idx jsonb := public.study_reference_index(old_data, new_data);
begin
  for new_work in select value from jsonb_array_elements(public.study_jsonb_array(new_data->'obras')) loop
    select value into old_work
    from jsonb_array_elements(public.study_jsonb_array(old_data->'obras'))
    where value->>'id' = new_work->>'id'
    limit 1;

    if old_work is null then
      -- Even new works get the Forest floor applied.
      result := result || jsonb_build_array(public.protect_study_work_indexed('{}'::jsonb, new_work, idx));
    else
      result := result || jsonb_build_array(public.protect_study_work_indexed(old_work, new_work, idx));
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
    if coalesce(idx->'works' ? old_id, false) then
      result := result || jsonb_build_array(old_work);
    end if;
  end loop;

  return result;
end;
$$;

revoke all on function public.study_reference_index(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_movements_indexed(jsonb,jsonb,jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.protect_study_work_indexed(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.protect_study_works(jsonb,jsonb) from public, anon, authenticated;
