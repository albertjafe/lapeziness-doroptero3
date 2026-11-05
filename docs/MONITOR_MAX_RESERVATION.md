# Duración máxima por reserva desde Aulas

Aulas → Ajustes → Duración máxima por reserva ofrece un selector y Aplicar en
móvil, iPad y escritorio. La cifra actual procede del monitor, por perfil; elegir
una opción no envía una orden hasta pulsar Aplicar. Tras enviarla se indica que
falta confirmación. El siguiente estado publicado muestra el máximo aplicado.

La orden `set_max_reservation` lleva `{ "minutes": 300 }` para cinco horas.
Es absoluta e idempotente: repetirla no suma horas. Se aceptan 30–1440 minutos
en pasos de 30 min. La cola SQL valida su payload sin modificar las validaciones
ni los permisos de las órdenes anteriores. El ingest conserva el campo numérico
opcional `monitor.max_reservation_minutes`. Si falta, la app no supone tres horas:
deshabilita el control y pide actualizar/reiniciar el monitor.

## Monitor externo

El monitor Python no se almacena completo en este repositorio. El parche
[`monitor-max-reservation.patch`](monitor-max-reservation.patch) registra únicamente
los cambios necesarios sobre la versión del 04-11-2026:

- Publicar el máximo actual en la instantánea de ejecución.
- Recibir la nueva orden mediante el dispatcher existente, en el hilo principal.
- Guardar en el mismo `max_reserva.json` de Alberto o `max_reserva_<perfil>.json`
  usado por Telegram. No confirmar si falla el guardado; recuperar el valor previo.

Las reservas, ampliaciones y planes siguen usando `MAX_RESERVA_HORAS`. No se
cambian ni omiten disponibilidad, RF, SZ, horario, blindajes o ventanas de reserva.
El ajuste no modifica de inmediato las reservas ya hechas ni impone cinco horas
a todos los perfiles. Telegram y la app comparten la misma configuración.

Para actualizar otra copia, guardar una copia del Python y aplicar el parche a
`monitor_huecos_alberto.py`; después compilar mediante la receta existente con
Python 3.12 y `requirements.txt`. Probar el ejecutable con `ASIMUT_SMOKE_TEST=1`
antes de publicarlo. No sustituir ejecutables abiertos: publicar con el flujo
`monitor-release` existente y actualizar al siguiente arranque limpio. La función
`reservation-monitor-ingest` mantiene su autenticación por token local; no recibe
credenciales de Asimut.

## Verificación

- `npm run check`
- `npx vitest run tests/unit/reservation-dashboard-static.test.js tests/unit/reservation-max-duration.test.js`
- `npx playwright test tests/e2e/reservation-dashboard.spec.js`
- `python tests/monitor/test_max_reservation.py ruta/monitor_huecos_alberto.py`

La prueba Python extrae funciones por AST sin importar el monitor: no inicia
Selenium, no contacta con Asimut ni Telegram y usa únicamente archivos temporales.
Comprueba persistencia, reinicio, aislamiento de perfiles, repetición de la orden,
recorte de una reserva a cinco horas y recuperación ante fallo de guardado.
