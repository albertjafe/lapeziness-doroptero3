# Fluidez v511: cambios y guía de revisión

Solicitud: agilizar botones, menús, tareas y guardado de sesiones, trabajando sobre la última versión y dejando evidencia para que otra IA pueda evaluarla.

Base: `main`, commit `0643daf15529f343debaf491cb9b1c123a283936` (v510). Runtime nuevo: `2026-10-17-fluidez-v511`; caché `estudio-v511`. No hay cambio de dependencias.

## Causas verificadas y cambios

| Causa | Solución y propietario actual |
| --- | --- |
| Mostrar un reto eliminaba en memoria logs/finalizaciones anteriores a su inicio. La fusión conservadora los recuperaba al guardar, invalidando una y otra vez los cálculos de estudio. La reconciliación de lista/singleton también copiaba relojes al leer. | `app.js`: `habitNormalize` y `habitStoredChallenges` devuelven proyecciones sin modificar los datos durables. Los comandos siguen escribiendo mediante `habitPersistChallenges`. `habit-trophies.js` y `habit-maintenance.js` ignoran finalizaciones de un ciclo anterior sin borrarlas. |
| Un orden de claves distinto tras pasar por JSONB se interpretaba como edición. | `_prepareChangedSections` compara contenido si cambió el texto. Usa `sameContent({value:seccion},…)` para que los relojes/metadatos anidados sigan siendo significativos. |
| Cada bloque Forest buscaba su evidencia económica recorriendo todas las sesiones y volviendo a interpretar las fechas. Una proyección real hacía más de dos millones de `Date.parse`. | `DailyStudyMinutes.evidenceLookup` crea índices de identidad, pasaje y fecha una vez. `minutesByDay` y `PianoRewards.studyState` los utilizan. Conserva el primer match de la búsqueda antigua, incluso cuando coinciden identidad y fecha de registros diferentes. |
| Distintos paneles volvían a construir la misma proyección económica. La interfaz móvil la calculaba dos veces. | `cachedPianoStudyState` y `cachedPianoWalletSnapshot` comparten el resultado. `PianoRewards.walletSnapshot(db,state)` acepta la proyección existente; `mobile-v2.js` y `effort-incentives-ui.js` la reutilizan. La firma de urgentísimas terminadas incluye sus fechas: corregir una fecha invalida el premio aunque no cambie su cantidad. |
| El cálculo de preparación reconstruía las mismas líneas temporales para retención, velocidad, obra y movimiento. | `ReadinessCore.withContext` comparte índices y timelines durante una operación síncrona. Usa `try/finally`; una operación posterior vuelve a leer el historial mutable. No cambia las fórmulas ni los modelos que decoran la preparación. |
| Registrar minutos manuales etiquetaba planta/espejo después del primer guardado y volvía a guardar el documento. | `manual-study-activity.js` resuelve el tipo y delega. `persistManualStudyHistory` crea ambos registros completos, con factor, antes de un único `saveData`. El refresco se agrupa con el ya programado. |
| Finalizar el cronómetro guardaba la planta y después la evidencia de política económica en otra escritura. | `cronoFinish` registra la política antes de `finishStudyBlock`: el primer snapshot durable ya incluye ambas evidencias. Los guardados posteriores del formulario/plan siguen su flujo propio. |
| Guardar una tarea programaba la reconstrucción de pantallas ocultas. El retardo de guardado no se reiniciaba con cada pulsación. | `saveData` solo refresca/prepara vistas de estudio cuando cambia su versión. Las firmas de vistas vecinas usan esa versión y los campos económicos pertinentes. El calentamiento espera mientras hay un modal o un campo de entrada activo. `saveDataSoon` se reinicia y espera 900 ms de quietud; conserva el vaciado antes de sincronizar y al ocultar/cerrar. |
| Las transiciones de modales añadían 280–350 ms. | `styles.css`: transición de fondo 160 ms y de contenido 180 ms. Se conserva la composición visual. |
| Una subida pequeña materializaba otra vez todo el JSON en PostgreSQL y generaba archivos temporales. La poda y los tombstones reconstruían campos intactos. | Migración `20261017184302_optimize_partial_document_sync.sql`: enumera claves pequeñas, conserva una copia descomprimida, ensambla solo hijos diferentes y evita reconstrucciones sin bajas efectivas. Mantiene las mismas funciones públicas y semántica de fusión. |

`index.html`, `piano-rooms.js`, `professor-handoff-resilience.js`, `professor-report-worker.js` y `sw.js` actualizan la cadena de carga/precache de los módulos modificados. El Worker del Profesor importa las mismas versiones que la UI. El ciclo de actualización segura sigue activo.

## Mediciones

Las interacciones se comparan en Chromium headless, sin red externa ni cuenta conectada, con una copia local autorizada del documento de aproximadamente 4,2 MB compactos. El modo táctil usa geometría/UA de iPad; **no es una medición de Safari ni de un iPad físico**. Los tiempos absolutos dependen del equipo. Handler es trabajo síncrono; el salto máximo entre fotogramas incluye trabajo posterior al botón.

Una ejecución por escenario, sin suites de pruebas concurrentes. Se invocan las rutas de los botones y se observa también el trabajo diferido; no es una distribución estadística ni una medición de INP de campo. La base v510 se sirvió desde una copia del commit base, en otro puerto, con el mismo JSON de entrada.

| Escenario | Handler v510 → v511 | Mayor salto de fotograma v510 → v511 |
| --- | --- | --- |
| Táctil: entrar al cronómetro | 601 → 215 ms | 650 → 233 ms |
| Táctil: añadir tarea y esperar el guardado | 22 → 18 ms | 1.600 → 100 ms |
| Táctil: guardar 25 min manuales | 3.195 → 287 ms | 3.367 → 767 ms |
| Táctil: finalizar 25 min de cronómetro | 1.486 → 445 ms | 2.633 → 933 ms |
| Escritorio: entrar al cronómetro | 884 → 274 ms | 1.033 → 350 ms |
| Escritorio: añadir tarea y esperar el guardado | 27 → 17 ms | 867 → 83 ms |
| Escritorio: guardar 25 min manuales | 661 → 277 ms | 1.433 → 517 ms |

Las aperturas de menús ya tenían handlers cortos: tablero de tareas aproximadamente 8–10 ms en ambas versiones, selector de obra 24–31 ms. La mejora de menús incluye transiciones más breves y menos trabajo de fondo; estos resultados no demuestran una mejora uniforme de composición gráfica.

Métricas completas y costes por función, sin datos privados: [`performance-v511-metrics.json`](performance-v511-metrics.json). Las cifras se obtuvieron con perfilado detallado; el script público de interacciones ofrece las mismas rutas principales con instrumentación más ligera. Persisten pausas de varios cientos de milisegundos tras un guardado de estudio: no se presentan como 60 fps constantes.

PostgreSQL: el benchmark aislado usa dos documentos idénticos y la cadena de triggers de protección, antes y después de aplicar la migración. Compara hashes de la fusión y del `UPDATE` completo. En una ejecución con otras pruebas compartiendo CPU, la fusión pasó de 1.558 a 989 ms y el `UPDATE` de 5.723 a 4.997 ms; ambos documentos finales fueron iguales. Es PostgreSQL/WASM local, **no latencia del API remoto**. El script permite repetirlo sin datos privados mediante una muestra sintética.

En producción se verificó el despliegue de las tres funciones y se ejecutó una fusión parcial de solo lectura con `EXPLAIN (ANALYZE, BUFFERS)` y límite de 5 s: 237,7 ms y cero bloques temporales. El hash, tamaño y `updated_at` del documento fueron idénticos inmediatamente antes y después de la migración. No se escribieron tareas ni sesiones de prueba en producción.

## Persistencia y despliegue de base de datos

La migración local se generó con Supabase CLI 2.121.0. Se aplicó mediante `apply_migration` con nombre `optimize_partial_document_sync`; el registro remoto asignó la versión `20261017185736`. El archivo local conserva el identificador generado por CLI (`20261017184302`). Ambos nombres se documentan para evitar aplicar dos veces la misma optimización por una diferencia de timestamp.

Solo se reemplazaron los cuerpos de `document_merge`, `document_prune` y `enforce_document_tombstones_after_guards`. No cambian tablas, políticas RLS, permisos, orden/cantidad de triggers, copias de seguridad ni registros de usuario. Los advisors no señalan las funciones cambiadas; quedan recomendaciones anteriores sobre otras funciones y [políticas RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), que no explican por sí solas el bloqueo del hilo de UI.

Contratos conservados: campos desconocidos, relojes y lápidas; CAS y comprobación de confirmación; recuperación IndexedDB; minutos físicos frente a equivalentes; tiempo canónico contado una vez; pasajes como subdivisión del maestro; política histórica de recompensas. Las pruebas comparan documentos completos con el algoritmo anterior, no solo contadores.

## Verificación y reproducción

- `npm run check`: correcto, 153 assets, sintaxis, versiones, IDs de carga únicos y precache coherentes.
- Suite unitaria completa: **847/847 pruebas**, 102 archivos.
- Regresiones dirigidas de guardado/cierre: **12 comprobaciones verificadas**, incluyendo cuota normal, fallo de borrador, cuota local agotada, pasaje activo y primer snapshot con política económica. Las pruebas de edición de retos también pasaron durante la implementación.
- La ejecución local extendida de E2E quedó interrumpida por un reinicio del entorno. La comprobación completa de E2E y capturas se ejecuta en [Quality](https://github.com/albertjafe/lapeziness-doroptero3/actions/workflows/quality.yml), asociado al commit publicado. Consultar ese resultado para la versión que se revise.

Pruebas nuevas/ampliadas:

- `tests/unit/study-evidence-index.test.js`: equivalencia con el `find` anterior en casos ambiguos y generados; acotación lineal de interpretación de fechas; 9.000 bloques conservan los minutos.
- `tests/unit/readiness-context.test.js`: reutilización dentro de una operación, edición posterior del mismo objeto, contextos anidados y restauración tras excepción.
- `tests/unit/habit-trophies.test.js` y E2E `save-fast-path`: lectura de un reto antiguo sin mutación ni invalidación de estudio por editar una tarea.
- `tests/e2e/save-fast-path.spec.js`: equivalencia con el guardado completo, otra pestaña, alta manual con factor completo en una escritura, quietud real y vaciado explícito, corrección de recompensa urgente y primer snapshot del cronómetro con bloque/política.
- `tests/unit/document-postgres.test.js`: comparación v510/v511 de fusión/poda, campos desconocidos, registros anidados y comportamiento de colecciones ausentes, `null`, vacías o con tombstones; conserva las pruebas de triggers, historias grandes, CAS y dispositivos offline.
- Las comprobaciones estáticas de actividad manual apuntan ahora al escritor que posee la responsabilidad. Las del Service Worker verifican v511 y siguen exigiendo aislamiento de versiones, recuperación y promoción segura.

Comandos desde la raíz:

```sh
npm ci
npx playwright install chromium
npm run check
npm run test:unit
npm run test:e2e
npm run test:visual
node scripts/measure-document-sync.mjs
```

Para medir interacciones, mantener `node tests/server.mjs` en otra terminal:

```sh
node scripts/measure-interactions.mjs
node scripts/measure-interactions.mjs --desktop
node scripts/measure-interactions.mjs --finish
```

`--rate 4` permite simular CPU más lenta; `--output .ai/runtime/metrics.json` guarda solo métricas. Ambos benchmarks admiten opcionalmente una copia JSON autorizada (`--snapshot /ruta/archivo.json` en interacciones, argumento posicional en SQL). No incluir esa copia ni capturas/perfiles de datos reales en commits. El benchmark de interacción bloquea peticiones externas y Service Workers; el de SQL solo utiliza una base PGlite en memoria.

## Qué debe revisar otra IA y límites

1. Comparar con el commit base indicado, leer los archivos anteriores y ejecutar las regresiones de equivalencia. Comprobar que las lecturas no crean ediciones y que los comandos de edición de retos siguen persistiendo.
2. Revisar las reglas de primer match del índice, la invalidación por fechas de urgentísimas y el alcance síncrono del contexto de preparación. No convertirlo en una caché persistente basada solo en la identidad de `db`.
3. Revisar especialmente el resultado SQL cuando falta una colección: el trigger legado puede crear `[]`; se conserva aunque parezca simplificable. No eliminar triggers ni protecciones para ganar tiempo.
4. Medir Safari en un iPad real con ese historial y repetir añadir tareas, abrir/cerrar menús, guardar manualmente, finalizar con pasaje activo, cerrar/reabrir y sincronizar con otro dispositivo. WebKit no pudo ejecutarse en este entorno por faltar bibliotecas del sistema.

La arquitectura todavía guarda un documento grande en localStorage y la sincronización CAS lee/devuelve el documento completo aunque suba deltas. Por ello sigue habiendo coste de serialización, fusión y red; esta versión no demuestra que todos los guardados remotos sean instantáneos ni garantiza 60 fps en cualquier dispositivo. Un siguiente paso estructural sería persistencia incremental local y lecturas/confirmaciones remotas parciales, con migración y compatibilidad offline propias. No se introdujo un segundo escritor ni se cambió el formato para resolverlo apresuradamente.

Si se necesita revertir, publicar una nueva versión de PWA con los cuerpos anteriores y un número de caché posterior, conservando la actualización segura. Para SQL, crear otra migración que restaure las tres definiciones anteriores: merge de `20261008151000_document_merge_record_identity.sql`, prune de `20260918205809_optimize_document_tombstone_pruning.sql` y solo la función de enforcement de `20260904123621_conservative_document_sync.sql`. No restaurar datos ni ejecutar de nuevo migraciones antiguas completas.
