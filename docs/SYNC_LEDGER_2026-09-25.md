# Historial maestro de estudio (`study_ledger`) — v434

## Por qué

Todo el historial vivía en un único documento `user_data.data` (~3,2 MB el
22-09: 833 bloques, ~7.400 registros Forest, alemán…). Cada subida lo relee,
fusiona, pasa 7 triggers y lo reescribe dentro de un límite de 8 s; su coste
crece con el historial total, no con lo estudiado. De ahí los `57014`. Las
optimizaciones de v431–v432 alivian pero no cambian esa curva.

## Qué cambia

- Tabla `public.study_ledger` (migración `20260925150000_study_ledger.sql`):
  una fila por registro de `sessionPlants`, `forestPlants` y `sesiones`,
  clave `(user_id, collection, record_key)` con `record_key =
  DocumentSyncCore.identity(record)`.
- Servidor (trigger `study_ledger_keep_newest`): gana el `edited_at` más
  reciente; un empate no resucita un borrado; reenviar lo mismo no mueve el
  cursor. `updated_at` y `seq` los asigna el servidor. Sin DELETE: los
  borrados son `deleted = true`. RLS por `auth.uid()`.
- Cliente `study-ledger-sync.js`:
  - Descarga solo filas con `updated_at` posterior al cursor (solape de 2 min
    para transacciones que confirman fuera de orden), paginadas por `seq`
    (único, sin saltos con empates ni escrituras concurrentes).
  - Sube solo registros cuya huella (hash del JSON canónico, estable frente al
    reordenado de JSONB) difiere de la última confirmada, en lotes de 200, y
    los borrados explícitos de `_deletedChildren`.
  - Nunca borra un registro por no tenerlo: solo con marca de borrado.
  - Fusión con `DocumentSyncCore.mergeRemote`: cambios locales sin confirmar
    ganan; si no, la nube. Las descargas se fijan como línea base guardada
    (`_rememberLocalDocument`) para no re-sellarlas como ediciones locales.
  - Estado por usuario (cursor + huellas) en IndexedDB `study-ledger-v1`.
  - Se ejecuta 3 s tras cargar, 4 s tras cada `saveData`, al volver a la app,
    al recuperar red y cada 90 s visible. Si la tabla no existe, espera 10 min
    en silencio.
- El documento `user_data` sigue sincronizándose igual (doble escritura). El
  estudio llega a todos los dispositivos aunque esa subida grande falle.

## Verificación

- `tests/unit/study-ledger.test.js`: PGlite con la migración real; dos
  dispositivos; 4 h del iPad en el móvil; reenvíos sin subidas; 3.000
  registros y luego 1 bloque nuevo = 1 fila; edición sin ping-pong; borrado
  sin resurrección; nada se borra por ausencia; el servidor conserva la
  edición más nueva; lote fallido que se reanuda; registros sin id; RLS y
  permisos exactos del rol `authenticated`.
- `tests/e2e/study-ledger.spec.js`: app real, iPad y móvil independientes, la
  subida del documento falla siempre con 57014 y aun así el móvil ve las 4 h
  (y 0 min con el módulo desactivado).

## Pendiente (fase 2)

Cuando el historial maestro esté probado en los dispositivos reales: sacar el
historial de estudio del documento `user_data` para que deje de crecer, y
añadir las sesiones de alemán al historial maestro.
