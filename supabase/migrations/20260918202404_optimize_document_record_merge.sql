-- Performance-only replacement: no data update, trigger removal or grants.
-- A growing jsonb index made one session upload approach the API's 8s timeout.
create or replace function public.document_merge_record_group(records jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare result jsonb; item jsonb;
begin
  for item in select v from jsonb_array_elements(records) with ordinality as e(v,ord) order by ord loop
    if result is null then result := item;
    else result := public.document_merge(result,item); end if;
  end loop;
  return result;
end
$$;

create or replace function public.document_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  result jsonb := '{}'; value jsonb; k text; ac text; bc text;
  clocks jsonb := '{}'; deleted jsonb := '{}'; group_key text; record_key text;
  record_array boolean;
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

revoke all on function public.document_merge_record_group(jsonb) from public, anon, authenticated;
