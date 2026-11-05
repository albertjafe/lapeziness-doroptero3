-- Máximo individual configurable desde Aulas; no altera cuotas, datos ni RLS.
alter table public.reservation_monitor_commands
  drop constraint reservation_monitor_commands_command_check;

alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_command_check
  check (command in (
    'pause', 'resume', 'target_today', 'target_tomorrow', 'set_operating_mode',
    'set_migration', 'set_mirror', 'set_madrugada', 'set_aachen', 'set_wuppertal',
    'set_emergency', 'startup_select', 'start_monitor', 'cancel_start', 'shutdown',
    'run_quota_lab', 'reservation_modify', 'reservation_cancel', 'reservation_lock',
    'set_booking_type', 'franja_add', 'franja_remove', 'franja_skip', 'franja_resume',
    'set_blinds', 'set_priority', 'set_inicio', 'set_absorbe', 'set_pecera',
    'room_grid', 'set_max_reservation'
  ));

-- Validación específica: minutos absolutos, sin tocar el resto de órdenes.
alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_max_duration_check
  check (command <> 'set_max_reservation' or (
    jsonb_typeof(payload->'minutes') = 'number'
    and case when jsonb_typeof(payload->'minutes') = 'number' then
      (payload->>'minutes')::numeric between 30 and 1440
      and mod((payload->>'minutes')::numeric, 30) = 0
    else false end
  ));
