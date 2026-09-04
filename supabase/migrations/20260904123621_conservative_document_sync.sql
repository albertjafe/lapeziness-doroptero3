-- Preserve independent edits and fields unknown to old clients. This is additive
-- to the existing backup, repertoire, planning and revision guard triggers.
create or replace function public.document_record_key(value jsonb)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when value->>'id' is not null then 'id:' || (value->>'id')
    when value->>'runId' is not null then 'run:' || (value->>'runId')
    when coalesce(value->>'at',value->>'date',value->>'startedAt') is not null then
      '[' || coalesce(to_jsonb(coalesce(value->>'at',value->>'date',value->>'startedAt'))::text,'null') || ',' ||
      coalesce((value->'obraId')::text,'null') || ',' || coalesce((value->'movId')::text,'null') || ',' ||
      coalesce(to_jsonb(coalesce(value->>'tipo',value->>'type',value->>'kind'))::text,'null') || ',' ||
      coalesce((value->'context')::text,'null') || ',' || coalesce((value->'momento')::text,'null') || ']'
    when value->>'obraId' is not null then '["item",' || (value->'obraId')::text || ',' || coalesce((coalesce(nullif(value->'movId','null'),value->'movimientoId'))::text,'null') || ',' ||
      coalesce((coalesce(nullif(value->'uso','null'),value->'purpose'))::text,'null') || ',' || coalesce((coalesce(nullif(value->'ronda','null'),value->'round'))::text,'null') || ']'
    else value::text end
$$;

-- a = OLD/server, b = NEW/client. Global revisions never authorize field edits.
create or replace function public.document_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  result jsonb := '{}'; value jsonb; k text; ac text; bc text;
  clocks jsonb := '{}'; deleted jsonb := '{}'; group_key text; record_key text;
  indexed jsonb := '{}'; order_keys text[] := '{}'; item jsonb; record_array boolean;
  additive text[] := array['sessionPlants','forestPlants','sesiones','items','registro','solHistory','paseHistory','zoneHistory','compasHistory','workHistory','historicalRepertoire','historicalEvents','cronoTaskTombstones','planningEventTombstones','competitionPlanTombstones'];
begin
  if a is null then return b; end if;
  if b is null or a = b then return a; end if;
  if jsonb_typeof(a) = 'array' and jsonb_typeof(b) = 'array' then
    for item in select v from jsonb_array_elements(a || b) as e(v) loop
      record_key := public.document_record_key(item);
      if indexed ? record_key then
        indexed := jsonb_set(indexed,array[record_key],public.document_merge(indexed->record_key,item));
      else
        order_keys := array_append(order_keys,record_key);
        indexed := jsonb_set(indexed,array[record_key],item);
      end if;
    end loop;
    select coalesce(jsonb_agg(indexed->v order by ord),'[]') into result from unnest(order_keys) with ordinality as e(v,ord);
    return result;
  end if;
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then
    return a; -- No later field clock: keep the existing server scalar.
  end if;
  for k in select jsonb_object_keys(coalesce(a->'_fieldClock','{}') || coalesce(b->'_fieldClock','{}')) loop
    clocks := jsonb_set(clocks,array[k],to_jsonb(greatest(a#>>array['_fieldClock',k],b#>>array['_fieldClock',k])));
  end loop;
  for group_key in select jsonb_object_keys(coalesce(a->'_deletedChildren','{}') || coalesce(b->'_deletedChildren','{}')) loop
    value := '{}';
    for k in select jsonb_object_keys(coalesce(a#>array['_deletedChildren',group_key],'{}') || coalesce(b#>array['_deletedChildren',group_key],'{}')) loop
      value := jsonb_set(value,array[k],to_jsonb(greatest(a#>>array['_deletedChildren',group_key,k],b#>>array['_deletedChildren',group_key,k])));
    end loop;
    deleted := jsonb_set(deleted,array[group_key],value);
  end loop;
  for k in select jsonb_object_keys(a || b) loop
    if k in ('_fieldClock','_deletedChildren') then continue; end if;
    ac := coalesce(a#>>array['_fieldClock',k],''); bc := coalesce(b#>>array['_fieldClock',k],'');
    record_array := false;
    if jsonb_typeof(a->k) = 'array' and jsonb_typeof(b->k) = 'array' then
      select not exists(select 1 from jsonb_array_elements((a->k) || (b->k)) as e(v)
        where jsonb_typeof(v) <> 'object') into record_array;
    end if;
    if not a ? k or not b ? k then value := coalesce(a->k,b->k);
    -- Parent collection clocks cannot authorize edits of unclocked children.
    elsif record_array then value := public.document_merge(a->k,b->k);
    elsif ac <> bc and not k = any(additive) and not (jsonb_typeof(a->k) = 'object' and jsonb_typeof(b->k) = 'object') then
      value := case when ac > bc then a->k else b->k end;
    else value := public.document_merge(a->k,b->k);
    end if;
    if jsonb_typeof(value) = 'array' and deleted ? k then
      select coalesce(jsonb_agg(v order by ord),'[]') into value from jsonb_array_elements(value) with ordinality as e(v,ord)
        where not (deleted->k) ? public.document_record_key(v);
    end if;
    result := jsonb_set(result,array[k],value);
  end loop;
  if clocks <> '{}' then result := result || jsonb_build_object('_fieldClock',clocks); end if;
  if deleted <> '{}' then result := result || jsonb_build_object('_deletedChildren',deleted); end if;
  if a ? '_localRevision' or b ? '_localRevision' then
    result := jsonb_set(result,'{_localRevision}',to_jsonb(greatest(coalesce(nullif(a->>'_localRevision',''),'0')::bigint,coalesce(nullif(b->>'_localRevision',''),'0')::bigint)));
  end if;
  return result;
end
$$;

create or replace function public.preserve_document_fields_before_update()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  new.data := public.document_merge(old.data,new.data);
  new.data := jsonb_set(new.data,'{_localRevision}',to_jsonb(greatest(
    coalesce(nullif(old.data->>'_localRevision',''),'0')::bigint + 1,
    coalesce(nullif(new.data->>'_localRevision',''),'0')::bigint)));
  new.updated_at := greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
  return new;
end
$$;

create or replace function public.document_prune(value jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare result jsonb := '{}'; k text; child jsonb;
begin
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.document_prune(v) order by ord),'[]') into result from jsonb_array_elements(value) with ordinality as e(v,ord);
    return result;
  end if;
  if jsonb_typeof(value) <> 'object' then return value; end if;
  for k in select jsonb_object_keys(value) loop
    child := public.document_prune(value->k);
    if jsonb_typeof(child) = 'array' and value#>array['_deletedChildren',k] is not null then
      select coalesce(jsonb_agg(v order by ord),'[]') into child from jsonb_array_elements(child) with ordinality as e(v,ord)
        where not (value#>array['_deletedChildren',k]) ? public.document_record_key(v);
    end if;
    result := jsonb_set(result,array[k],child);
  end loop;
  return result;
end
$$;

create or replace function public.enforce_document_tombstones_after_guards()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare field_name text; tombstone_name text; filtered jsonb;
begin
  -- Reapply explicit removals after legacy guards that used array union.
  new.data := public.document_prune(new.data);
  foreach field_name in array array['eventos','competitionPlans','cronoTasks'] loop
    tombstone_name := case field_name when 'eventos' then 'planningEventTombstones' when 'competitionPlans' then 'competitionPlanTombstones' else 'cronoTaskTombstones' end;
    if jsonb_typeof(new.data->field_name) <> 'array' then continue; end if;
    select coalesce(jsonb_agg(v order by ord),'[]') into filtered
    from jsonb_array_elements(new.data->field_name) with ordinality as e(v,ord)
    where not exists (select 1 from jsonb_array_elements(coalesce(new.data->tombstone_name,'[]')) as t(x)
      where coalesce(x->>'id',x->>'eventId',x->>'planId',x->>'taskId',x#>>'{}') = v->>'id');
    new.data := jsonb_set(new.data,array[field_name],filtered);
  end loop;
  return new;
end
$$;

-- Alphabetical trigger order: merge BEFORE legacy guards, filter AFTER them.
drop trigger if exists aa_preserve_document_fields on public.user_data;
create trigger aa_preserve_document_fields before update of data on public.user_data
  for each row execute function public.preserve_document_fields_before_update();
drop trigger if exists zz_enforce_document_tombstones on public.user_data;
create trigger zz_enforce_document_tombstones before update of data on public.user_data
  for each row execute function public.enforce_document_tombstones_after_guards();
revoke all on function public.document_record_key(jsonb), public.document_merge(jsonb,jsonb), public.document_prune(jsonb), public.preserve_document_fields_before_update(), public.enforce_document_tombstones_after_guards() from public, anon, authenticated;
