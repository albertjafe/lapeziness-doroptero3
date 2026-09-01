create or replace function public.build_daily_report(p_user_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_data jsonb;
  v_updated_at timestamptz;
  v_report jsonb;
begin
  select data, updated_at
    into v_data, v_updated_at
  from public.user_data
  where id = p_user_id;

  if v_data is null then
    return jsonb_build_object(
      'schemaVersion', 1,
      'date', p_date,
      'generatedAt', now(),
      'error', 'user_data_not_found'
    );
  end if;

  with
  works as (
    select w->>'id' as id, w as obj
    from jsonb_array_elements(coalesce(v_data->'obras', '[]'::jsonb)) w
  ),
  sessions_all as (
    select
      s,
      nullif(s->>'startedAt','')::timestamptz as started_at,
      nullif(s->>'endedAt','')::timestamptz as ended_at,
      coalesce(nullif(s->>'mins','')::numeric, 0) as mins,
      lower(coalesce(s->>'failed','false')) = 'true' as failed,
      nullif(s->>'obraId','') as obra_id,
      nullif(s->>'movId','') as mov_id,
      nullif(s->>'source','') as source
    from jsonb_array_elements(coalesce(v_data->'sessionPlants', '[]'::jsonb)) s
    where nullif(s->>'startedAt','') is not null
  ),
  sessions_day as (
    select distinct on (
      started_at,
      ended_at,
      mins,
      coalesce(obra_id,''),
      coalesce(mov_id,'')
    )
      s, started_at, ended_at, mins, failed, obra_id, mov_id, source
    from sessions_all
    where (started_at at time zone 'Europe/Madrid')::date = p_date
    order by started_at, ended_at, mins, coalesce(obra_id,''), coalesce(mov_id,'')
  ),
  session_enriched as (
    select
      sd.*,
      coalesce(w.obj->>'name', 'Sin obra') as work_name,
      coalesce(w.obj->>'composer', '') as composer,
      mv.name as movement_name
    from sessions_day sd
    left join works w on w.id = sd.obra_id
    left join lateral (
      select m->>'name' as name
      from jsonb_array_elements(coalesce(w.obj->'movimientos', '[]'::jsonb)) m
      where m->>'id' = sd.mov_id
      limit 1
    ) mv on true
  ),
  study_by_work as (
    select
      obra_id,
      max(work_name) as work_name,
      max(composer) as composer,
      round(sum(mins) filter (where not failed and mins > 0), 1) as minutes,
      count(*) filter (where not failed and mins > 0) as sessions,
      count(*) filter (where failed) as failed_attempts,
      min(started_at) filter (where not failed and mins > 0) as first_at,
      max(ended_at) filter (where not failed and mins > 0) as last_at
    from session_enriched
    group by obra_id
  ),
  recent_by_work as (
    select
      obra_id,
      round(sum(mins) filter (where not failed and mins > 0), 1) as minutes_30d,
      max((started_at at time zone 'Europe/Madrid')::date) filter (where not failed and mins > 0) as last_study_date
    from sessions_all
    where (started_at at time zone 'Europe/Madrid')::date between (p_date - 29) and p_date
    group by obra_id
  ),
  solidity_events as (
    select
      w.id as obra_id,
      w.obj->>'name' as work_name,
      w.obj->>'composer' as composer,
      null::text as mov_id,
      null::text as movement_name,
      h
    from works w
    cross join lateral jsonb_array_elements(coalesce(w.obj->'solHistory', '[]'::jsonb)) h
    where nullif(h->>'date','') is not null
      and ((h->>'date')::timestamptz at time zone 'Europe/Madrid')::date = p_date

    union all

    select
      w.id,
      w.obj->>'name',
      w.obj->>'composer',
      m->>'id',
      m->>'name',
      h
    from works w
    cross join lateral jsonb_array_elements(coalesce(w.obj->'movimientos', '[]'::jsonb)) m
    cross join lateral jsonb_array_elements(coalesce(m->'solHistory', '[]'::jsonb)) h
    where nullif(h->>'date','') is not null
      and ((h->>'date')::timestamptz at time zone 'Europe/Madrid')::date = p_date
  ),
  pass_events as (
    select
      w.id as obra_id,
      w.obj->>'name' as work_name,
      w.obj->>'composer' as composer,
      null::text as mov_id,
      null::text as movement_name,
      h
    from works w
    cross join lateral jsonb_array_elements(coalesce(w.obj->'paseHistory', '[]'::jsonb)) h
    where nullif(h->>'date','') is not null
      and ((h->>'date')::timestamptz at time zone 'Europe/Madrid')::date = p_date

    union all

    select
      w.id,
      w.obj->>'name',
      w.obj->>'composer',
      m->>'id',
      m->>'name',
      h
    from works w
    cross join lateral jsonb_array_elements(coalesce(w.obj->'movimientos', '[]'::jsonb)) m
    cross join lateral jsonb_array_elements(coalesce(m->'paseHistory', '[]'::jsonb)) h
    where nullif(h->>'date','') is not null
      and ((h->>'date')::timestamptz at time zone 'Europe/Madrid')::date = p_date
  ),
  tasks as (
    select
      t,
      case when nullif(t->>'createdAt','') is not null then (t->>'createdAt')::timestamptz end as created_at,
      case when nullif(t->>'doneAt','') is not null then (t->>'doneAt')::timestamptz end as done_at
    from jsonb_array_elements(coalesce(v_data->'cronoTasks', '[]'::jsonb)) t
  ),
  digital_rows as (
    select
      ae.*,
      greatest(0, extract(epoch from (ae.ended_at - ae.started_at)))::bigint as seconds,
      coalesce(nullif(ae.domain,''), nullif(ae.app,''), nullif(ae.label,''), ae.category, 'activity') as context_key
    from public.activity_events ae
    where ae.user_id = p_user_id
      and ae.local_date = p_date
  ),
  digital_categories as (
    select category, sum(seconds)::bigint as seconds
    from digital_rows
    where not is_afk
    group by category
  ),
  digital_switch_rows as (
    select
      device_id,
      context_key,
      lag(context_key) over (partition by device_id order by started_at, id) as previous_key
    from digital_rows
    where not is_afk
  ),
  wellbeing_events as (
    select 'estado'::text as kind, e
    from jsonb_array_elements(coalesce(v_data->'estadoEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
    union all
    select 'sueno', e
    from jsonb_array_elements(coalesce(v_data->'suenoEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
    union all
    select 'deporte', e
    from jsonb_array_elements(coalesce(v_data->'deporteEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
    union all
    select 'tiempo_disponible', e
    from jsonb_array_elements(coalesce(v_data->'tiempoDisponibleEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
    union all
    select 'resistencia', e
    from jsonb_array_elements(coalesce(v_data->'resistenciaEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
    union all
    select 'malestar', e
    from jsonb_array_elements(coalesce(v_data->'malestarEventos', '[]'::jsonb)) e
    where nullif(e->>'at','') is not null
      and ((e->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
  ),
  journal_entries as (
    select j
    from jsonb_array_elements(coalesce(v_data->'dailyJournalEntries', '[]'::jsonb)) j
    where j->>'day' = p_date::text
       or (
         nullif(j->>'at','') is not null
         and ((j->>'at')::timestamptz at time zone 'Europe/Madrid')::date = p_date
       )
  ),
  upcoming_events as (
    select e
    from jsonb_array_elements(coalesce(v_data->'eventos', '[]'::jsonb)) e
    where coalesce(e->>'fecha','') ~ '^\d{4}-\d{2}-\d{2}$'
      and (e->>'fecha')::date between p_date and (p_date + 30)
    order by (e->>'fecha')::date
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'date', p_date,
    'generatedAt', now(),
    'dataUpdatedAt', v_updated_at,
    'localRevision', v_data->'_localRevision',

    'quick', jsonb_build_object(
      'studyMinutes', coalesce((select round(sum(minutes), 1) from study_by_work), 0),
      'studySessions', coalesce((select sum(sessions) from study_by_work), 0),
      'failedAttempts', coalesce((select sum(failed_attempts) from study_by_work), 0),
      'tasksCreated', (select count(*) from tasks where created_at is not null and (created_at at time zone 'Europe/Madrid')::date = p_date),
      'tasksCompleted', (select count(*) from tasks where done_at is not null and (done_at at time zone 'Europe/Madrid')::date = p_date),
      'tasksOpenAtEnd', (select count(*) from tasks where created_at is not null and (created_at at time zone 'Europe/Madrid')::date <= p_date and (done_at is null or (done_at at time zone 'Europe/Madrid')::date > p_date)),
      'digitalMinutes', coalesce((select round(sum(seconds)::numeric / 60.0, 1) from digital_rows where not is_afk), 0),
      'contextSwitches', coalesce((select count(*) from digital_switch_rows where previous_key is not null and previous_key is distinct from context_key), 0),
      'solidityEntries', (select count(*) from solidity_events),
      'passes', (select count(*) from pass_events),
      'wellbeingEntries', (select count(*) from wellbeing_events)
    ),

    'study', jsonb_build_object(
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'startedAt', started_at,
          'endedAt', ended_at,
          'minutes', mins,
          'failed', failed,
          'source', source,
          'obraId', obra_id,
          'work', work_name,
          'composer', composer,
          'movId', mov_id,
          'movement', movement_name
        ) order by started_at)
        from session_enriched
      ), '[]'::jsonb),
      'byWork', coalesce((
        select jsonb_agg(jsonb_build_object(
          'obraId', obra_id,
          'work', work_name,
          'composer', composer,
          'minutes', coalesce(minutes,0),
          'sessions', sessions,
          'failedAttempts', failed_attempts,
          'firstAt', first_at,
          'lastAt', last_at
        ) order by coalesce(minutes,0) desc, work_name)
        from study_by_work
      ), '[]'::jsonb),
      'solidityChanges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'at', h->>'date',
          'obraId', obra_id,
          'work', work_name,
          'composer', composer,
          'movId', mov_id,
          'movement', movement_name,
          'value', coalesce(h->'inputVal', h->'val'),
          'storedValue', h->'val',
          'context', h->>'context',
          'samples', h->'samples'
        ) order by (h->>'date')::timestamptz)
        from solidity_events
      ), '[]'::jsonb),
      'passes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'at', h->>'date',
          'obraId', obra_id,
          'work', work_name,
          'composer', composer,
          'movId', mov_id,
          'movement', movement_name,
          'type', coalesce(h->>'tipo', h->>'type'),
          'score', h->'score',
          'solidity', coalesce(h->'solidezPct', h->'solidityPct'),
          'quality', h->>'quality',
          'note', coalesce(h->>'note', h->>'nota')
        ) order by (h->>'date')::timestamptz)
        from pass_events
      ), '[]'::jsonb)
    ),

    'tasks', jsonb_build_object(
      'created', coalesce((
        select jsonb_agg(t order by created_at)
        from tasks
        where created_at is not null and (created_at at time zone 'Europe/Madrid')::date = p_date
      ), '[]'::jsonb),
      'completed', coalesce((
        select jsonb_agg(t order by done_at)
        from tasks
        where done_at is not null and (done_at at time zone 'Europe/Madrid')::date = p_date
      ), '[]'::jsonb),
      'openAtEndOfDay', coalesce((
        select jsonb_agg(t order by coalesce((t->>'priority')::int,0) desc, created_at)
        from tasks
        where created_at is not null
          and (created_at at time zone 'Europe/Madrid')::date <= p_date
          and (done_at is null or (done_at at time zone 'Europe/Madrid')::date > p_date)
      ), '[]'::jsonb)
    ),

    'digitalActivity', jsonb_build_object(
      'trackedSeconds', coalesce((select sum(seconds) from digital_rows where not is_afk), 0),
      'categories', coalesce((select jsonb_object_agg(category, seconds) from digital_categories), '{}'::jsonb),
      'topApps', coalesce((
        select jsonb_agg(jsonb_build_object('app', app, 'seconds', seconds) order by seconds desc)
        from (
          select app, sum(seconds)::bigint as seconds
          from digital_rows
          where not is_afk and nullif(app,'') is not null
          group by app
          order by seconds desc
          limit 10
        ) q
      ), '[]'::jsonb),
      'topDomains', coalesce((
        select jsonb_agg(jsonb_build_object('domain', domain, 'seconds', seconds) order by seconds desc)
        from (
          select domain, sum(seconds)::bigint as seconds
          from digital_rows
          where not is_afk and nullif(domain,'') is not null and category <> 'private'
          group by domain
          order by seconds desc
          limit 10
        ) q
      ), '[]'::jsonb),
      'contextSwitches', coalesce((select count(*) from digital_switch_rows where previous_key is not null and previous_key is distinct from context_key), 0),
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'deviceId', device_id,
          'deviceType', device_type,
          'source', source,
          'startedAt', started_at,
          'endedAt', ended_at,
          'seconds', seconds,
          'app', app,
          'domain', case when category = 'private' then null else domain end,
          'category', category,
          'label', label,
          'isAfk', is_afk
        ) order by started_at, id)
        from digital_rows
      ), '[]'::jsonb)
    ),

    'wellbeing', jsonb_build_object(
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('kind', kind, 'event', e) order by (e->>'at')::timestamptz)
        from wellbeing_events
      ), '[]'::jsonb)
    ),

    'journal', coalesce((select jsonb_agg(j order by coalesce(j->>'at','')) from journal_entries), '[]'::jsonb),

    'repertoireSnapshot', coalesce((
      select jsonb_agg(jsonb_build_object(
        'obraId', w.id,
        'composer', w.obj->>'composer',
        'work', w.obj->>'name',
        'minutes30d', coalesce(r.minutes_30d,0),
        'lastStudyDate', r.last_study_date,
        'solidity', w.obj->'sol',
        'learning', w.obj->'apr',
        'stage', coalesce(w.obj->>'learningStage', w.obj->>'estado'),
        'difficulty', w.obj->'dificultad',
        'movements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'movId', m->>'id',
            'movement', m->>'name',
            'solidity', m->'sol',
            'learning', m->'apr',
            'stage', coalesce(m->>'learningStage', m->>'estado'),
            'lastPass', m->>'lastPase'
          ))
          from jsonb_array_elements(coalesce(w.obj->'movimientos', '[]'::jsonb)) m
        ), '[]'::jsonb)
      ) order by r.minutes_30d desc, w.obj->>'composer', w.obj->>'name')
      from works w
      join recent_by_work r on r.obra_id = w.id
      where coalesce(r.minutes_30d,0) > 0
    ), '[]'::jsonb),

    'upcomingEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e->>'id',
        'date', e->>'fecha',
        'endDate', e->>'fechaFin',
        'type', e->>'tipo',
        'name', e->>'nombre',
        'works', coalesce((
          select jsonb_agg(jsonb_build_object('obraId', wid, 'work', w.obj->>'name', 'composer', w.obj->>'composer'))
          from jsonb_array_elements_text(coalesce(e->'obras', '[]'::jsonb)) wid
          left join works w on w.id = wid
        ), '[]'::jsonb)
      ) order by (e->>'fecha')::date)
      from upcoming_events
    ), '[]'::jsonb),

    'coverage', jsonb_build_object(
      'study', exists(select 1 from session_enriched where not failed and mins > 0),
      'digitalActivity', exists(select 1 from digital_rows),
      'wellbeing', exists(select 1 from wellbeing_events),
      'journal', exists(select 1 from journal_entries),
      'upcomingEvents', exists(select 1 from upcoming_events)
    )
  ) into v_report;

  return v_report;
end;
$$;

revoke all on function public.build_daily_report(uuid, date) from public;
revoke all on function public.build_daily_report(uuid, date) from anon;
revoke all on function public.build_daily_report(uuid, date) from authenticated;

create or replace function public.get_my_daily_report(p_date date default (now() at time zone 'Europe/Madrid')::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  return public.build_daily_report(v_user_id, p_date);
end;
$$;

revoke all on function public.get_my_daily_report(date) from public;
revoke all on function public.get_my_daily_report(date) from anon;
grant execute on function public.get_my_daily_report(date) to authenticated;
