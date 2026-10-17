-- v511: avoid materializing multi-megabyte JSON values and rewriting the
-- unchanged root during partial sync. No DML or permission/trigger changes.
-- Different ids = different records: never merge them field by field (08-10-2026).
create or replace function public.document_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  result jsonb := '{}'; value jsonb; k text; ac text; bc text;
  clocks jsonb := '{}'; deleted jsonb := '{}'; group_key text; record_key text;
  record_array boolean;
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
  -- 08-10-2026: two objects with different ids are different records (e.g. a
  -- new habit challenge replacing the old one). Merging them field by field
  -- resurrected the old record's fields (completedAt, logs…). Keep the newer
  -- record whole; on a tie keep the server's.
  if a ? 'id' and b ? 'id' and (a->>'id') is distinct from (b->>'id') then
    return case when coalesce(b->>'correctedAt',b->>'manualSavedAt',b->>'updatedAt',b->>'_savedAt',b->>'createdAt','')
                   > coalesce(a->>'correctedAt',a->>'manualSavedAt',a->>'updatedAt',a->>'_savedAt',a->>'createdAt','')
                then b else a end;
  end if;
  -- Retain a detoasted value once; repeated field access to a toasted argument
  -- would otherwise decompress the full root for every key.
  a := a || '{}'::jsonb; b := b || '{}'::jsonb;
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
  -- Enumerate only small keys. A FULL JOIN of jsonb_each materialized the
  -- whole history (and spilled it to disk) even for a one-task upload.
  for k in select jsonb_object_keys(a) union select jsonb_object_keys(b)
  loop
    av := a->k; bv := b->k;
    if k in ('_fieldClock','_deletedChildren','_localRevision') then continue; end if;
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
    if value is distinct from av then
      result_keys := array_append(result_keys,k);
      result_values := array_append(result_values,value);
    end if;
  end loop;
  -- Assemble only changed children. Materializing the unchanged history again
  -- would spill at the default work_mem even for a tiny task delta.
  result := a;
  if clocks is null or clocks = '{}' then
    if result ? '_fieldClock' then result := result - '_fieldClock'; end if;
  elsif clocks is distinct from a->'_fieldClock' then
    result_keys := array_append(result_keys,'_fieldClock');
    result_values := array_append(result_values,clocks);
  end if;
  if deleted is null or deleted = '{}' then
    if result ? '_deletedChildren' then result := result - '_deletedChildren'; end if;
  elsif deleted is distinct from a->'_deletedChildren' then
    result_keys := array_append(result_keys,'_deletedChildren');
    result_values := array_append(result_values,deleted);
  end if;
  if a ? '_localRevision' or b ? '_localRevision' then
    value := to_jsonb(greatest(coalesce(nullif(a->>'_localRevision',''),'0')::bigint,coalesce(nullif(b->>'_localRevision',''),'0')::bigint));
    if value is distinct from a->'_localRevision' then
      result_keys := array_append(result_keys,'_localRevision');
      result_values := array_append(result_values,value);
    end if;
  end if;
  if cardinality(result_keys) > 0 then
    select coalesce(jsonb_object_agg(key,val),'{}') into value
      from unnest(result_keys,result_values) as e(key,val);
    result := result || value;
  end if;
  return result;
end
$$;

create or replace function public.document_prune(value jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  result jsonb; original_child jsonb; child jsonb; removed jsonb; k text;
  keys text[] := '{}'; children jsonb[] := '{}';
begin
  if value is null then return '{}'::jsonb; end if;
  if jsonb_typeof(value) not in ('array','object') then return value; end if;
  if not (jsonb_typeof(value) = 'object' and value ? '_deletedChildren') and
     not jsonb_path_exists(value,'$.**."_deletedChildren"') then return value; end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.document_prune(v) order by ord),'[]') into result
      from jsonb_array_elements(value) with ordinality as e(v,ord);
    return result;
  end if;
  value := value || '{}'::jsonb;
  for k in select jsonb_object_keys(value) loop
    original_child := value->k;
    child := public.document_prune(original_child);
    removed := value#>array['_deletedChildren',k];
    if jsonb_typeof(child) = 'array' and removed is not null then
      if exists (select 1 from jsonb_array_elements(child) as e(v)
                 where removed ? public.document_record_key(v)) then
        select coalesce(jsonb_agg(v order by ord),'[]') into child
        from jsonb_array_elements(child) with ordinality as e(v,ord)
        where not removed ? public.document_record_key(v);
      end if;
    end if;
    if child is distinct from original_child then
      keys := array_append(keys,k);
      children := array_append(children,child);
    end if;
  end loop;
  -- Most syncs do not introduce a new deletion. Preserve those subtrees rather
  -- than rebuilding every clean array and the entire multi-megabyte root.
  if cardinality(keys) = 0 then return value; end if;
  select coalesce(jsonb_object_agg(e.name,e.child),'{}') into result
    from unnest(keys,children) as e(name,child);
  return value || result;
end
$$;

create or replace function public.enforce_document_tombstones_after_guards()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare field_name text; tombstone_name text; filtered jsonb; tombstones jsonb;
begin
  new.data := public.document_prune(new.data);
  foreach field_name in array array['eventos','competitionPlans','cronoTasks'] loop
    tombstone_name := case field_name when 'eventos' then 'planningEventTombstones'
      when 'competitionPlans' then 'competitionPlanTombstones' else 'cronoTaskTombstones' end;
    if jsonb_typeof(new.data->field_name) <> 'array' then continue; end if;
    tombstones := new.data->tombstone_name;
    if jsonb_typeof(new.data->field_name) = 'array' then
      if tombstones is null then continue; end if;
      if jsonb_typeof(tombstones) = 'array' and jsonb_array_length(tombstones) = 0 then continue; end if;
    end if;
    select coalesce(jsonb_agg(v order by ord),'[]') into filtered
    from jsonb_array_elements(new.data->field_name) with ordinality as e(v,ord)
    where not exists (select 1 from jsonb_array_elements(tombstones) as t(x)
      where coalesce(x->>'id',x->>'eventId',x->>'planId',x->>'taskId',x#>>'{}') = v->>'id');
    -- Keep all filtering semantics; avoid three copies of the full document
    -- when the legacy root tombstones have nothing new to remove.
    if filtered is distinct from new.data->field_name then
      new.data := jsonb_set(new.data,array[field_name],filtered);
    end if;
  end loop;
  return new;
end
$$;
