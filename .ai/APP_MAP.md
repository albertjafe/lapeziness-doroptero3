# AI App Map — Piano Practice PWA

**Estado:** CANÓNICO · actualizado 2026-09-04 · caché runtime v347

Este es el **primer archivo que debe leer una IA** antes de investigar el repositorio. Su objetivo es evitar reabrir `app.js`, `styles.css` y decenas de módulos para reconstruir la arquitectura desde cero.

Regla de confianza: este mapa es navegación, no sustituto del código. Si una afirmación concreta entra en conflicto con el código actual, manda el código. Cuando un cambio modifica responsabilidades, flujo de datos, una función pública importante o una feature visible, actualiza este mapa en el mismo cambio.

---

## 1. Arquitectura en 30 segundos

- PWA de práctica pianística, **vanilla JS + CSS**, sin framework ni build de frontend.
- `index.html` contiene el shell DOM, navegación y carga del núcleo.
- `app.js` es el núcleo histórico grande (~1,2 MB). **Nunca leerlo entero**: buscar símbolo/ID exacto y abrir solo el rango necesario.
- `styles.css` es también histórico/grande. Para features nuevas, comprobar primero sus CSS modulares.
- `piano-rooms.js`, pese al nombre, funciona actualmente como **loader general de addons** posteriores a `app.js`.
- `data-core.js`, `sync-core.js`, `readiness-core.js` y módulos de resiliencia concentran lógica reutilizable y de sincronización.
- Supabase persiste principalmente el documento JSON de usuario; localStorage mantiene una copia local de trabajo.
- La app se sirve desde GitHub Pages y usa `sw.js` para PWA/offline/actualizaciones.
- Tests: Vitest (`tests/unit`) + Playwright (`tests/e2e`, `tests/visual`).

### Carga base visible en `index.html`

Orden aproximado relevante:

1. `timer-core.js`
2. `data-core.js`
3. `sync-core.js`
4. `document-sync-core.js`, `event-sync-core.js`, `task-sync-bootstrap.js` (antes del primer guardado)
5. `readiness-core.js`
6. `push-client.js`
7. `app.js`
8. `study-session-ux.js`
9. `crono-resume-layout.js`
10. `piano-rooms.js` → carga numerosos addons
11. `google-calendar.js`
12. `timer-objectives.js`
13. `metronome.js`

`mystery-house.js` y `planning-enhancements-v3-fix.js` ya no se cargan ni se precachean.

Para saber la carga exacta de una versión, mirar **`index.html` + `piano-rooms.js` + `sw.js`**.

---

## 2. Datos y persistencia

### Documento principal

- localStorage principal: `alberto_piano_v2`.
- objeto global histórico habitual: `db`.
- Supabase: el estado principal vive en `user_data.data` (JSON), con revisión local/remota y timestamps.
- Campos relevantes actuales incluyen, entre otros: `obras`, `eventos`, `cronoTasks`, sesiones/plantas de estudio, ajustes del Profesor y metadatos de revisión.

### Regla crítica de sincronización

**Nunca reemplazar a ciegas una copia completa de datos de un dispositivo por otra solo por haber abierto más tarde el dispositivo.**

Capas actuales:

- `data-core.js`: helpers/fusión de datos de estudio.
- `document-sync-core.js`: merge conservador de propiedades desconocidas, relojes `_fieldClock`, bajas `_deletedChildren` y tombstones de tareas/eventos. Ausencia de una propiedad no significa borrado; una limpieza explícita usa `null`/`[]`. `track()` marca cambios comparando con la última copia guardada; `assign()` conserva las referencias de los editores abiertos. `merge()` se reserva para copias locales del mismo dispositivo. `mergeRemote(servidor, cliente)` conserva cada escalar existente del servidor salvo que el cliente aporte un `_fieldClock` de ese campo estrictamente posterior (o explícito si el servidor carece de él). Ni `_localRevision`, ni `_savedAt`, ni `updatedAt` justifican ediciones remotas. Nuevos campos, propiedades anidadas y registros siguen fusionándose; el orden remoto conserva primero los registros del servidor. `sameContent()` ignora solo revisión/fecha de transporte en la raíz, no evidencia ni campos desconocidos.
- `sync-core.js`: metadatos de revisión, mezcla de historial y estructura/repertorio.
- `local-save-resilience.js`: copia principal localStorage y rescate completo serializado en IndexedDB; `flush()` espera a la escritura efectiva. La recuperación fusiona incluso revisiones menores que pueden contener cambios independientes. Único punto de carga: `crono-resume-layout.js`, ID `localSaveResilienceScript`; no cargar de nuevo desde `piano-rooms.js`.
- `instant-sync-resilience.js`: sincronización inmediata/segura de cambios relevantes.
- `crono-save-resilience.js`: protección específica del cronómetro/sesiones.
- `task-sync-bootstrap.js`: captura temprana del estado de tareas antes de reconciliar.
- `task-sync-resilience.js`: merge **por tarea**, timestamps, tombstones y rescates locales; evita que una lista vieja resucite tareas o borre tareas nuevas.
- `persistence-guard.js`: archivo legado **no cargado**. Las rutas activas usan `local-save-resilience.js` y `update-safety.js`; no reintroducir otro escritor.
- `update-safety.js`: exige una copia durable, guarda memoria solo cuando difiere semánticamente del disco, sincroniza y vuelve a verificar pendientes tras los `await` antes de promover la PWA. Así una comprobación limpia no incrementa la revisión ni fuerza otra subida completa.

`app.js`: `_prepareLocalDocument` reconcilia memoria/disco antes de guardar; `_mergeStudyHistory` combina el merge de dominio con `DocumentSyncCore`. **Un único escritor de `user_data`: `syncToCloud`** lee la fila y hace update condicional por `updated_at` (CAS), con relectura y merge si hay conflicto. Los addons de tareas/cronómetro llaman al guardado común; no hacen upserts completos independientes. La descarga, cada intento CAS y la aceptación de su respuesta usan `mergeRemote(servidor, cliente)`, igual que `document_merge(OLD, NEW)` en SQL. Los cambios locales explícitos durante la petición siguen pendientes.

`loadFromCloud` usa `maybeSingle`: un error no equivale a una cuenta vacía. Fusiona nube, memoria y disco; si no falta contenido en remoto reconoce la sincronización sin incrementar revisión ni encolar upload. La ausencia de fila fuerza dirty/primer upload de la base local aunque los metadatos se hayan perdido o indiquen clean.

Migraciones Supabase importantes para este tema:

- `202609010002_protect_study_structure_sync.sql`
- `202609010003_harden_study_movement_recency_merge.sql`
- `202609020002_preserve_planning_events.sql`
- `202609030003_task_sync_revision_guard.sql`
- `202609040004_reduce_user_data_sync_contention.sql`
- `20260904123621_conservative_document_sync.sql`: merge JSON recursivo, timestamp/revisión monotónicos y aplicación final de tombstones tras las guardas históricas. Aplicada en producción el 2026-09-04 con autorización explícita, backup previo y comprobación de cero cambios en `user_data`. Registro: `docs/DEPLOY_V344_2026-09-04.md`.

**Revisiones:** una revisión vieja no debe sobrescribir una más nueva. Si se cambia sincronización, revisar cliente **y** guardas SQL.

---

## 3. Repertorio, movimientos, solidez y readiness

### UI / biblioteca

- `obra-premium.js` / `obra-premium-polish.js`: tarjetas/detalle premium de obra.
- `obras-redesign.js` / `obras-redesign-polish.js`: rediseño de biblioteca.
- `obras-unified-library.js`: presentación unificada actual.
- `historical-repertoire.js`: repertorio/historial antiguo y compatibilidad.
- `work-catalog.js`: catálogo/normalización de obras conocidas.
- `work-structure-catalog.js`: estructura y movimientos conocidos.

### Dificultad

- `work-difficulty-model.js`: modelo de dificultad y `installReadiness`, ajuste compartido por UI/Worker. El loader lo instala tras los modelos de píldora/recuperación y los valores guardados; no depende de que se abra la ficha.
- `work-difficulty-stored-priority.js`: prioridad de valores guardados frente a inferidos.
- `work-difficulty-integration.js`: integración con la UI/datos existentes.

### Solidez / preparación

- `solidity-model.js`: modelo de solidez.
- `solidity-history-editor.js`: edición del historial de solidez.
- `readiness-core.js`: estimaciones de preparación/recuperación.
- `readiness-pill-model.js`: modelo de la píldora de estado/preparación.
- `readiness-recovery-context.js`: contexto histórico y recuperación; al cargarse refresca `cronoRenderReadinessEstimate`, igual que el modelo de píldora.
- `pase-liquid-direct-touch.js`: interacción táctil premium de la píldora/slider; contiene fix de Safari/iPad para no recalcular el valor en `pointerup`.

### Semántica musical importante

- **Cada movimiento es una unidad independiente** para planificación.
- Horas históricas de una obra = familiaridad y posible recuperación más rápida; **no prueban solidez actual** de cada movimiento.
- No repartir horas históricas no asignadas artificialmente entre movimientos.
- Cámara: al estudiar solo, la medición representa principalmente **la propia parte**; coordinación de conjunto añade evidencia cuando existe ensayo real, especialmente en preparación alta/final.
- Concierto con orquesta: misma lógica; la parte pianística es la base y la capa orquestal/director se valida cuando hay evidencia real.
- Repertorio recuperado: el pico histórico no infla la medición actual; sirve para estimar coste de recuperación.

---

## 4. Cronómetro, Hoy, pases, pasajes y tareas

### Cronómetro / sesión

- Núcleo histórico de UI y funciones: buscar en `app.js` por `cronoStart`, `cronoFinish`, `renderCronoTasks`, IDs `#view-cronometro`, etc.
- `timer-core.js`: helpers de temporización.
- `timer-objectives.js`: objetivos vinculados al timer.
- `study-session-ux.js`: mejoras de UX de sesión/Hoy.
- `crono-resume-layout.js`: layout de reanudación/estado.
- `crono-running-premium.js`: refinamiento de UI en marcha.
- `session-minutes-correction.js`: corrección de minutos/sesiones.

### Pases / pasajes

- Pases y su modal principal todavía tienen bastante lógica histórica en `app.js`.
- `passage-tracker.js/css`: tracker moderno de pasajes difíciles.
- El tracker es hijo directo de `.crono-wrap`, nunca de una pestaña oculta del calendario. Su normalizador conserva propiedades futuras y referencias; `commitDraft()` guarda las observaciones en la copia principal además del espejo.
- `pase-liquid-direct-touch.js`: gesto táctil de valoración/solidez.

### Tareas

- Datos: `db.cronoTasks`.
- UI/CRUD histórico: buscar `cronoTask`, `renderCronoTasks` y modal `modalCronoTaskEdit` en `app.js`/`index.html`.
- Prioridad dictada (`planning-enhancements-v4.js`):
  - `urgentísimo/urgentísima` → 3
  - `urgente` → 2
  - `normal` → 1
  - sin palabra → 0/blanco
  - la palabra de control se elimina del título.
- `planning-enhancements-v4-speech-fix.js`: en iPhone/iPad restaura Web Speech para que “Añadir tarea” pueda arrancar dictado; no volver a desactivar el micrófono para evitar prompts de permisos.
- Sync seguro: `task-sync-bootstrap.js` + `task-sync-resilience.js`.
- Existe copia local de rescate interna; la antigua UI manual de “Historial de tareas” fue retirada y **no debe reaparecer** salvo petición explícita.

---

## 5. Eventos, concursos y proyectos personales

### Modelo

Tipos y estados son conceptos separados.

Tipos habituales:
`Concierto · Concurso · Examen · Grabación · Clase · Audición · Otro`

Estados:
`Confirmado · Planificado · Standby · Descartado · Completado`

- Un evento puede tener obras enlazadas (`event.obras`) y opcionalmente objetivos por movimiento.
- Deadlines/milestones pertenecen al evento padre.
- Diferenciar deadline oficial, fecha objetivo de grabación y requisito real de vídeo.
- Un concurso en Standby pesa menos que un compromiso confirmado, pero **solo puede influir musicalmente si tiene repertorio enlazado**.
- Si un evento no tiene repertorio, la app/Profesor debe decir `NO_ENLAZADO`; nunca adivinar obras.

### Archivos

- `event-planning.js`: núcleo de planificación de eventos/concursos + seed detallado del dossier 2026–2027.
- `competition-planning-seed.js`: import/seed inicial de concursos.
- `event-planning-ui-v2.js/css`: interfaz móvil/modal de concurso.
- `event-planning-enhancements.js/css`: mejoras posteriores del modelo/UI.
- `event-repertoire-picker.js/css`: selector de repertorio de un evento.
- `event-sync-core.js`: fusión/sync de eventos.
- `event-data-protection.js`: protección de eventos frente a pérdidas/reemplazos.
- `historical-events.js` / `historical-events-details.js`: histórico y detalle.
- `planning-enhancements-v3.js`: mejoras previas, enlaces oficiales y guía de solidez.
- `planning-enhancements-v3-fix.js`: parche idempotente/observer del v3.
- `planning-enhancements-v4.js`: proyectos personales + prioridad dictada + semántica musical refinada.

### Proyectos personales

`planning-enhancements-v4.js` añade sección “Proyectos personales”. Puede usar:

- fecha exacta; o
- mes objetivo flexible (`fechaFlexibleTipo: 'mes'`, `fechaObjetivoMes: 'YYYY-MM'`, rango desde/hasta mes).

No presentar un día inventado como si el usuario lo hubiera elegido.

---

## 6. Profesor virtual

El Profesor es una feature central. **No sustituirlo por un ranking determinista sin chat:** su objetivo es construir un Superinforme y abrir ChatGPT con el contexto musical.

### Cadena de módulos

1. `professor-core.js` — construye el informe por movimiento: solidez/evidencia, dificultad, estudio reciente, última práctica, recuperación, eventos, etc.
2. `professor-report-normalizer.js` — compatibilidad con informes antiguos; schema 3 ya contiene los totales normalizados y no se recalcula.
3. `professor-context-enrichment.js` — estado diario fechado y actividad digital con evidencia de frescura; no escribe caché remota por render/guardado.
4. `professor-competition-deadline-bridge.js` — conecta deadlines/concursos.
5. `professor-event-gate.js` — **filtro duro de repertorio por eventos**.
6. `professor-duration-policy.js` — duración diaria + hora real + alternativas.
7. `professor-dashboard.js` — vista Profesor, botones y prompt maestro.
8. `professor-event-gate-ui.js` — UI auxiliar del filtro; su observer debe ser acotado para no crear bucles de MutationObserver.
9. `professor-handoff-resilience.js` — `buildReportAsync()`, codec reversible `PIANO_PROF_V3`, transporte completo y apertura segura.
10. `professor-temporary-chat.js` — apertura de chat temporal cuando está disponible.
11. `professor-report-worker.js` — ejecuta los mismos algoritmos musicales sobre una captura inmutable, fuera del hilo de interfaz. El fallback usa el mismo informe completo.

Schema 3 conserva `works`, todas las unidades/movimientos con `sourceMovement`, registros originales en `sourceContext` (historial, sesiones, eventos, concursos, tareas, pasajes, horarios y sesión en curso). Los tiempos de obra sin movimiento nunca se distribuyen. Dificultad desconocida y valor usado para estimar se distinguen. La solidez mantiene fecha original y confianza. Proyectos mensuales: `datePrecision: 'month'`, `day: 'YYYY-MM'`, `at: null`; `calculationRange` es solo auxiliar. Los IDs, nunca nombres parecidos, identifican entidades.

### Regla de ranking actual — CRÍTICA

`professor-event-gate.js` (`PROFESSOR_EVENT_GATE_V2`):

- El Profesor empieza por **eventos/proyectos futuros con repertorio explícitamente enlazado**.
- Obra/movimiento sin ningún evento/proyecto futuro enlazado → **prioridad musical 0 y fuera del plan diario**.
- Esa unidad sigue presente en el contexto completo. El filtro decide elegibilidad del plan, no descarta datos del informe.
- No mantener/reactivar una obra solo porque esté fría, tenga solidez baja, dificultad alta o muchas horas históricas.
- Evento sin repertorio = advertencia; no genera prioridad musical.
- Solo después del filtro: urgencia × riesgo × coste restante, solidez, dificultad, estudio reciente, velocidad, saturación, etc.

### Duración del día — CRÍTICA

`professor-duration-policy.js` (`PROFESSOR_DURATION_FALLBACK_V2`):

- 4 h totales es **referencia**, no techo ni obligación.
- El Profesor puede recomendar menos de 4 h o 5 / 5,5 / 6 h si la carga real lo justifica.
- Usa la **hora local real del instante de la consulta** y reconstruye el informe al pedir consejo.
- Al ampliar tiempo puede:
  - ampliar un bloque existente;
  - dar un segundo bloque a la misma unidad;
  - añadir otra unidad enlazada;
  - combinar las anteriores.
- Debe optimizar valor marginal, no variedad artificial ni “más de lo mismo” automáticamente.
- Aunque desaconseje ampliar, para planes de hoy debe dar un apartado **“Si aun así quieres ampliar”** con alternativas concretas a 5 h y 6 h (obra + movimiento + minutos + propósito), si el usuario lo pide/flujo lo requiere.

### Handoff a ChatGPT

- `PIANO_PROF_V3`: R metadatos, W campos idénticos de obra, E eventos idénticos, U todas las unidades con referencias W/E, P referencias de prioridades. `decodeContext(denseContext(report))` reproduce todos los campos JSON sin redondeos adicionales ni top-N.
- Evitar volver al patrón antiguo de construir un prompt completo enorme **y** otro URL-prompt separado: podía congelar iPad.
- Se reserva la pestaña dentro del clic y se calcula una única versión completa. Si supera 12.000 caracteres codificados, abre una URL corta y muestra copia/descarga del informe completo para pegarlo o adjuntarlo. No existe envío automático de archivos entre sitios.
- Informe nuevo con hora local real en cada consulta; sin caché temporal de informes. Si cambió la revisión durante el cálculo, se vuelve a capturar. Se comparte un solo recorrido de sesiones y un cálculo de recuperación por obra durante cada informe.
- La sesión activa se captura con notas, pausas y minutos efectivos; entra una sola vez en HOY, queda marcada como no guardada y no cuenta si es descanso o su runId ya está registrado.
- Botones/modes habituales: organizar hoy, lo que queda de hoy, qué estudiar ahora, próximos 7 días.
- `professorSettings.masterPrompt` permite prompt maestro personalizado.

---

## 7. Calendario, actividad y Piano Rooms

### Google Calendar

- `google-calendar.js`: integración/estado del calendario.
- El Profesor puede leer eventos Google, pero por defecto esos eventos no tienen repertorio musical enlazado salvo puente explícito.
- Migración: `202608170002_google_calendar.sql`.

### Actividad

- `activity-core.js`: helpers/modelo.
- `activity-dashboard.js`: dashboard.
- `activity-self-tracker.js`: registro automático/propio.
- `activity-tracker/`: recursos relacionados.

### Piano Rooms

- `piano-rooms-core.js`: lógica de disponibilidad/estado del monitor local.
- `piano-rooms.css`: UI.
- `piano-rooms.js`: **además** de Piano Rooms, hoy es el bootstrap general de muchos addons. No renombrarlo/refactorizarlo casualmente.

---

## 8. PWA y actualizaciones

- `manifest.json`: manifiesto.
- `sw.js`: caché, precache, push y política de actualización.
- En la revisión de este mapa, el cache es `estudio-v347`; **no asumir ese número en el futuro: mirar `sw.js`**. `update-safety.js` y `crono-save-resilience.js` usan `?v=347`; `app.js` y `document-sync-core.js` conservan `?v=344`; los demás assets mantienen su versión previa, con una única URL por asset en loaders/precache. Los archivos del Profesor no cambiaron.
- Cambios de runtime desplegados deben seguir la convención del repo de incrementar cache del SW y añadir nuevos assets al precache cuando corresponda.
- `update-safety.js` protege el estado antes de activar nueva versión.
- Solo acepta `SAFE_SKIP_WAITING` con `safe: true` y mantiene vivo el evento hasta que `skipWaiting()` se resuelve. Sin cronómetro activo ni cambios pendientes y con copia durable. `controllerchange` recarga una vez; la primera toma de control no recarga. `update.html` es una vía de recuperación servida por red: crea una copia durable, activa el worker en espera y reabre la app sin borrar cachés, almacenamiento ni registro del SW.
- Shell y assets versionados se sirven desde su caché para no mezclar A/B. Se retienen el caché actual y el anterior, respetando cachés ajenos. Un asset antiguo ausente devuelve 503 en lugar de código nuevo bajo una URL vieja.
- `scripts/check-runtime.mjs` recorre loaders e importaciones del worker y contrasta los 90 assets con precache, sintaxis y query versions. También detecta cargas DOM por helpers `id,src` e inyecciones literales con IDs distintos; permite un ID compartido y separa los imports del Worker. Playwright comprueba que la persistencia se ejecuta una sola vez.
- `push-client.js` + migraciones `202607230001/2_*`: notificaciones push.

Documentación pura (`.md`, instrucciones de IA) no necesita bump de SW porque no altera la PWA servida al usuario.

---

## 9. Código dormido / documentos históricos

- `mystery-house.js` y el markup Casa siguen presentes, pero `piano-rooms.js` retira/oculta la vista actual y redirige Casa hacia Profesor/sesión. Tratarlo como **dormido/retirado**, no como feature visible activa.
- **Pulso eliminado**: sin vista `view-pulse`, navegación, gráficos, barras fluidas, ajuste de visibilidad, listeners ni renderizadores. La navegación legacy `pulse` abre Hoy. Se conservan datos antiguos (`pulseDeletedIds`, colecciones de registros y preferencias locales) sin uso de esa interfaz. El pulso musical del metrónomo y las animaciones de guardado permanecen.
- `CLAUDE.md` contiene mucha historia útil pero también estados ya superados y contradicciones actuales. **No usarlo como mapa canónico.** Consultarlo solo si una tarea necesita contexto histórico concreto.
- `AUDITORIA_GRAFICA_Y_FRONTEND.md` y `AUDITORIA_Y_HOJA_DE_RUTA.md` son grandes; leer solo si la tarea trata de esas auditorías/roadmap.

---

## 10. Dónde mirar para X

| Quiero cambiar… | Mirar primero |
|---|---|
| navegación / shell | `index.html`, `app.js` (`showView`) |
| Cronómetro | `app.js` + `timer-core.js` + `crono-*` |
| tareas | `app.js` (`cronoTask*`) + `planning-enhancements-v4.js` + `task-sync-*` |
| sync/pérdida de datos | `document-sync-core.js`, `data-core.js`, `sync-core.js`, `*-resilience.js`, migraciones Supabase |
| biblioteca de obras | `obras-unified-library.js`, `obras-redesign.js`, `obra-premium.js` |
| movimientos/estructura | `work-structure-catalog.js`, `app.js`, modelo de obra |
| dificultad | `work-difficulty-model.js`, `work-difficulty-integration.js` |
| solidez/readiness | `solidity-model.js`, `readiness-core.js`, `readiness-pill-model.js` |
| slider/píldora táctil | `pase-liquid-direct-touch.js` |
| pases | buscar `Pase`/`paseHistory` en `app.js`; módulos `passage-*` si es pasaje difícil |
| eventos | `event-planning.js`, `event-repertoire-picker.js`, `event-sync-core.js` |
| concursos | `event-planning.js`, `competition-planning-seed.js`, `event-planning-ui-v2.js` |
| proyectos personales | `planning-enhancements-v4.js` |
| Profesor / ranking | `professor-core.js`, `professor-event-gate.js` |
| Profesor / horas y hora real | `professor-duration-policy.js` |
| Profesor / abrir ChatGPT | `professor-handoff-resilience.js`, `professor-temporary-chat.js`, `professor-dashboard.js` |
| Google Calendar | `google-calendar.js` |
| PWA/cache/update | `sw.js`, `update-safety.js`, `index.html` |
| Piano Rooms | `piano-rooms-core.js`; recordar que `piano-rooms.js` es loader general |
| histórico | `historical-repertoire.js`, `historical-events.js` |

---

## 11. Comprobaciones

`package.json` define:

- `npm run check` — sintaxis de todos los JS del runtime, existencia de assets, versiones y precache.
- `npm run test:unit` — Vitest, `tests/unit`.
- `npm run test:e2e` — Playwright, `tests/e2e`.
- `npm run test:visual` — Playwright visual, Chromium.
- `npm run test:all` — conjunto completo.

Ejecutar checks dirigidos durante implementación; al final, la batería más amplia razonable para el alcance. No afirmar CI verde sin comprobarla.

Tests representativos relevantes actualmente incluyen sincronización de datos/tareas, eventos, Profesor, historial, readiness, UI de concursos y gestos táctiles. Buscar por nombre de feature dentro de `tests/` antes de crear un test duplicado.

Auditoría 2026-09-04: `document-compatibility`, `document-postgres` (PGlite), `sync-protocol-audit`, `service-worker-audit`, `professor-audit`, `update-safety-v2`; E2E `professor-persistence-audit` y `pwa-offline-audit`. Métrica reproducible: `node scripts/measure-professor.mjs 75`. Informe y límites: `docs/AUDITORIA_PROFESOR_PERSISTENCIA_2026-09-04.md`.

---

## 12. Reglas para agentes para ahorrar contexto

1. Lee este archivo primero.
2. Lee `AGENTS.md`.
3. Si hay tarea planificada: `.ai/runtime/CURRENT_TASK.md` / `WORKPLAN.json` o el equivalente del puente.
4. Busca símbolos exactos con `rg`/code search antes de abrir archivos.
5. **Nunca** leas `app.js`, `styles.css`, `CLAUDE.md` o las auditorías completas por defecto.
6. Abre solo los módulos de la fila “Dónde mirar para X”.
7. Si el mapa resuelve la arquitectura, no la vuelvas a deducir desde cero.
8. Si el código contradice el mapa, corrige el código de la tarea y actualiza este mapa si la diferencia es arquitectónica/material.
9. Mantén este archivo compacto: navegación y contratos; no pegar cuerpos de funciones ni convertirlo en changelog.
