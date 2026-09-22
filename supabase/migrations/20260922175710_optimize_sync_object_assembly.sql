-- Performance only: preserve clocks, tombstones, record order and all triggers.
-- Assemble object children once instead of repeatedly copying the entire root.
-- No row writes, new public API, timeout changes or grants.
create or replace function public.document_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  result jsonb := '{}'; value jsonb; k text; ac text; bc text;
  clocks jsonb := '{}'; deleted jsonb := '{}'; group_key text; record_key text;
  record_array boolean; field record;
  result_keys text[] := '{}'; result_values jsonb[] := '{}';
  av jsonb; bv jsonb; a_clocks jsonb; b_clocks jsonb; a_deleted jsonb; b_deleted jsonb;
  additive text[] := array['sessionPlants','forestPlants','sesiones','items','registro','solHistory','paseHistory','zoneHistory','compasHistory','workHistory','historicalRepertoire','historicalEvents','cronoTaskTombstones','planningEventTombstones','competitionPlanTombstones'];
begin
  if a is null then return b; end if;
  if b is null or a = b then return a; end if;
  if jsonb_typeof(a) = 'array' and jsonb_typeof(b) = 'array' then
    -- Group once rather than rewriting an ever-growing JSON object per record.
    -- Within a key, fold in the original server-then-client order; this keeps
    -- duplicate handling, field clocks, unknown fields and first-seen order.
    select coalesce(jsonb_agg(public.document_merge_record_group(records) order by first_ord),'[]')
      into result
    from (
      select public.document_record_key(v) as record_key,
             jsonb_agg(v order by ord) as records, min(ord) as first_ord
      from jsonb_array_elements(a || b) with ordinality as e(v,ord)
      group by public.document_record_key(v)
    ) grouped;
    return result;
  end if;
  if jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then
    return a; -- No later field clock: keep the existing server scalar.
  end if;
  a_clocks := a->'_fieldClock'; b_clocks := b->'_fieldClock';
  a_deleted := a->'_deletedChildren'; b_deleted := b->'_deletedChildren';
  for k in select jsonb_object_keys(coalesce(a_clocks,'{}') || coalesce(b_clocks,'{}')) loop
    clocks := jsonb_set(clocks,array[k],to_jsonb(greatest(a_clocks->>k,b_clocks->>k)));
  end loop;
  for group_key in select jsonb_object_keys(coalesce(a_deleted,'{}') || coalesce(b_deleted,'{}')) loop
    value := '{}';
    for k in select jsonb_object_keys(coalesce(a_deleted->group_key,'{}') || coalesce(b_deleted->group_key,'{}')) loop
      value := jsonb_set(value,array[k],to_jsonb(greatest(a_deleted#>>array[group_key,k],b_deleted#>>array[group_key,k])));
    end loop;
    deleted := jsonb_set(deleted,array[group_key],value);
  end loop;
  -- Extract each child once; never rebuild a multi-megabyte root per field.
  for field in
    select coalesce(l.key,r.key) as key,l.value as av,r.value as bv
    from jsonb_each(a) l full join jsonb_each(b) r on l.key=r.key
  loop
    k := field.key; av := field.av; bv := field.bv;
    if k in ('_fieldClock','_deletedChildren') then continue; end if;
    ac := coalesce(a_clocks->>k,''); bc := coalesce(b_clocks->>k,'');
    record_array := false;
    if jsonb_typeof(av) = 'array' and jsonb_typeof(bv) = 'array' then
      select not exists(select 1 from jsonb_array_elements((av) || (bv)) as e(v)
        where jsonb_typeof(v) <> 'object') into record_array;
    end if;
    if av is null or bv is null then value := coalesce(av,bv);
    -- Parent collection clocks cannot authorize edits of unclocked children.
    elsif record_array then value := public.document_merge(av,bv);
    elsif ac <> bc and not k = any(additive) and not (jsonb_typeof(av) = 'object' and jsonb_typeof(bv) = 'object') then
      value := case when ac > bc then av else bv end;
    else value := public.document_merge(av,bv);
    end if;
    if jsonb_typeof(value) = 'array' and deleted ? k then
      select coalesce(jsonb_agg(v order by ord),'[]') into value from jsonb_array_elements(value) with ordinality as e(v,ord)
        where not (deleted->k) ? public.document_record_key(v);
    end if;
    result_keys := array_append(result_keys,k);
    result_values := array_append(result_values,value);
  end loop;
  select coalesce(jsonb_object_agg(key,val),'{}') into result
    from unnest(result_keys,result_values) as e(key,val);
  if clocks <> '{}' then result := result || jsonb_build_object('_fieldClock',clocks); end if;
  if deleted <> '{}' then result := result || jsonb_build_object('_deletedChildren',deleted); end if;
  if a ? '_localRevision' or b ? '_localRevision' then
    result := jsonb_set(result,'{_localRevision}',to_jsonb(greatest(coalesce(nullif(a->>'_localRevision',''),'0')::bigint,coalesce(nullif(b->>'_localRevision',''),'0')::bigint)));
  end if;
  return result;
end
$$;

