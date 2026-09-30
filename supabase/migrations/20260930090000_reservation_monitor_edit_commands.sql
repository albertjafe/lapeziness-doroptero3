-- Tus reservas desde la app (30-09-2026): ajustar inicio/fin, cancelar y
-- candado. El monitor usa las mismas funciones que los botones de Telegram.
-- Las tres capas deben coincidir: este CHECK, allowedCommands de
-- reservation-monitor-ingest y el dispatcher Python del monitor.

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
    'reservation_lock'
  ));
