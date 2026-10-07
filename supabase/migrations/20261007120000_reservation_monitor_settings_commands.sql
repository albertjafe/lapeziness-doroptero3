-- Ajustes del monitor desde la app (07-10-2026): blindajes (franjas, aulas,
-- grupos), VIP, hora de inicio de hoy y absorbedor, que antes solo se
-- cambiaban en Telegram. Las tres capas deben coincidir: este CHECK,
-- allowedCommands de reservation-monitor-ingest y el dispatcher del monitor.

alter table public.reservation_monitor_commands
  drop constraint reservation_monitor_commands_command_check;

alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_command_check
  check (command in (
    'pause',
    'resume',
    'target_today',
    'target_tomorrow',
    'set_operating_mode',
    'set_migration',
    'set_mirror',
    'set_madrugada',
    'set_aachen',
    'set_emergency',
    'startup_select',
    'start_monitor',
    'cancel_start',
    'shutdown',
    'run_quota_lab',
    'reservation_modify',
    'reservation_cancel',
    'reservation_lock',
    'set_booking_type',
    'franja_add',
    'franja_remove',
    'franja_skip',
    'franja_resume',
    'set_blinds',
    'set_priority',
    'set_inicio',
    'set_absorbe'
  ));
