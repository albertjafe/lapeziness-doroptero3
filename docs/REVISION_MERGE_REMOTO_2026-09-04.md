# Corrección final del merge remoto

Alcance: exclusivamente la política de conflictos remotos, sus tres llamadas en `app.js`, la migración SQL pendiente y las regresiones correspondientes. Sin commit, push, migración en Supabase ni despliegue.

## Corrección

La revisión global de un cliente puede superar a la del servidor después de muchos guardados offline sin editar dificultad o solidez. Ya no se utiliza esa relación para resolver conflictos remotos.

- `DocumentSyncCore.mergeRemote(servidor, cliente)` conserva los escalares existentes del servidor salvo que el cliente tenga un `_fieldClock` de ese campo estrictamente posterior, o explícito cuando el servidor no tiene reloj. Un reloj igual tampoco permite reemplazar el valor.
- `_localRevision`, `_savedAt`, `updatedAt` y los relojes de objetos/colecciones padre no demuestran una edición de los campos internos de sus registros.
- Campos ausentes, propiedades futuras/anidadas y registros nuevos se conservan. Las colecciones de registros se fusionan por identidad y siguen aplicando bajas explícitas y tombstones. El orden remoto conserva primero los registros del servidor.
- `merge()` mantiene la semántica local de memoria/disco. La descarga `loadFromCloud`, cada intento de envío CAS y la aceptación de su respuesta usan la API remota con el servidor como primer argumento. Los cambios explícitos realizados durante una petición siguen pendientes y no se pierden al aceptar la respuesta.
- `document_merge(OLD, NEW)` aplica la misma política en PostgreSQL, incluso para clientes antiguos que no usan el merge JS. Se ha eliminado de su firma y recursión el fallback por revisión/fecha. Se modifica la migración aún no aplicada `20260904123621_conservative_document_sync.sql`.

## Regresiones

Se añaden 31 pruebas respecto al estado revisado anterior (280 → 311):

- Los casos compartidos de JS/PGlite cubren dificultad 9 frente a 5 con revisiones 20, 170 y 10.000; solidez 80 frente a 40 con revisión 500 y sesión nueva; clocks posteriores, anteriores, iguales y ausentes; campos futuros y relojes padre que no autorizan ediciones de sus hijos.
- PGlite compara el resultado completo de `document_merge` con `mergeRemote`, y ejecuta escrituras reales sobre `user_data` con los triggers de protección anteriores instalados.
- 200 llamadas reales a `saveLocalNow` elevan la revisión de 20 a 220 editando únicamente una tarea. Dificultad sigue sin reloj de edición. Al reconectar conserva el 9 del servidor y la tarea, tanto mediante descarga previa como mediante upload directo.
- El mismo flujo se ejecuta contra PostgreSQL con un conflicto CAS real: otro dispositivo cambia dificultad a 10 entre lectura y escritura. El primer update condicional no acepta ninguna fila; la app relee, conserva el 10 y sube la tarea una sola vez. Reabrir no genera otra escritura.
- Se conserva una edición explícita de dificultad realizada durante la espera del upload. Un escalar stale descartado por la descarga no provoca un upload de eco aunque el cliente tenga revisión 10.000.
- Se mantienen las pruebas anteriores: diez aperturas idénticas sin writes, cuenta vacía con metadatos perdidos/clean, errores de lectura y ausencia de duplicados.

## Validación final

| Comando | Resultado final |
| --- | --- |
| `npm run check` | OK: 90 assets; sintaxis, versiones, loaders únicos y precache coherentes |
| `npm run test:unit` | 311/311, 47 archivos, 12,49 s |
| `npm run test:e2e -- --workers=3` | 112/112, 3,7 min |
| `npm run test:visual -- --workers=2` | 3/3, 9,7 s |

Todos los comandos finales terminaron con código 0; ninguna prueba final fallida u omitida. También pasan 77 pruebas dirigidas de merge/compatibilidad/carga/CAS. La primera ejecución E2E se interrumpió para incorporar la regresión del reloj padre; después se repitió completa con el código definitivo. No se cambiaron snapshots visuales.

## Alcance conservado

Profesor V3, Worker, handoff, retirada de Pulso, `update-safety.js`, capas de guardado local y corrección de loaders permanecen sin cambios respecto al inicio de esta revisión. La caché pasa a `estudio-v344`; solo `app.js` y `document-sync-core.js` cambian a `?v=344`. El protocolo del service worker permanece intacto.

Limitación deliberada: un cliente antiguo sin relojes no puede justificar una edición conflictiva de un escalar existente; prevalece el servidor. Sí puede aportar campos y registros nuevos. La protección SQL para esos clientes seguirá pendiente hasta aplicar la migración antes del frontend. Las pruebas usan PostgreSQL local mediante PGlite y Chromium; no implican una prueba física en iOS ni cambios en producción.
