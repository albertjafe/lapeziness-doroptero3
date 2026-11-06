-- «Permitir» huecos bloqueados desde Aulas; no altera datos ni RLS.
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
    'room_grid', 'set_max_reservation', 'allow_rebook'
  ));

-- Validación específica: todos los huecos o uno concreto, sin tocar el resto de órdenes.
alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_allow_rebook_check
  check (command <> 'allow_rebook' or (
    coalesce(payload->'all' = 'true'::jsonb, false)
    or coalesce(payload->>'key', '') ~ '^(\*|[0-9]{1,6}):[0-9]{8}:[0-9]{4}:[0-9]{4}$'
  ));
