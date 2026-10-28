-- 28-10-2026: la comprobación de notificaciones push corría cada 30 s, día y
-- noche, con una petición pg_net por vez. Sus registros (cron.job_run_details,
-- 195 MB y 273.101 filas; net._http_response, 90 MB) llevaron la base de datos
-- a 367 de los 500 MB del plan gratuito y ayudaron a agotar el presupuesto de
-- disco (26-10). Se vaciaron a mano (truncate) ese día: 367 MB → 81 MB.
-- Ahora: cada 2 minutos (los avisos pueden llegar hasta 2 min tarde) y una
-- limpieza diaria de los registros de más de 2 días.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'study-push-dispatch'),
  schedule := '*/2 * * * *'
);

select cron.schedule(
  'limpiar-registros-cron',
  '15 3 * * *',
  $job$delete from cron.job_run_details where end_time < now() - interval '2 days'$job$
);
