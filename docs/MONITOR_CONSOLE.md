# Consola de reservas

`scripts/monitor/console-reservations.ps1` es la presentación local de la consola
del monitor externo. Se copia junto al ejecutable y los lanzadores `.cmd` lo
invocan con `-Profile <perfil>` y `-LogPath <ruta de la ejecución>`.

Muestra acciones confirmadas de reservas, ampliaciones, rescates, cancelaciones,
migraciones y el motivo del traslado. Las decisiones teóricas, sondeos, HTTP,
JSON, estadísticas y trazas se quedan en disco. La atribución de una cancelación
solo se muestra si consta: detectar una desaparición no identifica al autor.
Una persona que libera un hueco tampoco es necesariamente quien canceló otra
reserva. Los subtipos conocidos de migración se traducen a un motivo breve.

La salida completa del ejecutable se guarda en `logs/monitor_<perfil>_<fecha>.log`;
stderr, en el archivo contiguo `.stderr.log`; las comprobaciones de arranque,
en `.inicio.log`. Los mensajes de actividad y decisiones continúan en
`data/telegram_log_<perfil>.txt`, con su rotación original. No se envía nada a
Telegram, Asimut ni la app desde esta capa. No cambia el motor de reservas.

Si Windows rechaza el ejecutable o falla su creación, el lanzador devuelve 1,
muestra un aviso breve y guarda la excepción en `.launcher.log`, incluso si el
monitor no llegó a escribir stdout/stderr. No reintenta con otro mecanismo ni
modifica las políticas de seguridad. El historial inicial se identifica como
tal: mostrar reservas anteriores no confirma que el proceso haya arrancado.

El lanzador conserva stdin para los comandos del monitor y su código de salida.
`-FollowOnly -MonitorProcessId <pid>` permite abrir la misma vista sobre una
ejecución existente, sin arrancar ni reiniciar el monitor. Esa vista es solo de
lectura; cerrarla no detiene el proceso existente. `-Once` permite verificar la
lectura sin iniciar procesos. La lectura incremental respeta UTF-8/UTF-16,
líneas parciales y truncado del log; los avisos fechados no se duplican al rotar.

Verificación en Windows PowerShell 5.1 (los `.ps1` llevan BOM UTF-8):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/monitor/test_console_reservations.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/monitor/test_console_launcher.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/monitor/test_console_startup_failure.ps1
```

La segunda prueba compila un ejecutable simulado temporal. Comprueba stdin,
la separación entre consola y logs y el código de salida; no importa ni arranca
el monitor real, no usa credenciales y no hace peticiones de red.
