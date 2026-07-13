# Auditoría integral y hoja de ruta de Lapeziness Doroptero 3

Fecha de auditoría: 13 de julio de 2026
Commit auditado: c73daf3, Unificar cronómetro para iPad y escritorio
Rama: main
Estado del repositorio al comenzar: limpio y sincronizado con origin/main

## 1. Objeto de este documento

Este archivo convierte la auditoría en propuestas independientes que una persona puede aprobar, rechazar o posponer por ID. Cada propuesta contiene el problema, la evidencia, el cambio exacto, los criterios de aceptación y las pruebas mínimas.

No se ha implementado ninguna propuesta al redactar este documento. El único cambio de este commit debe ser esta auditoría.

### Cómo responder

La respuesta puede tener esta forma:

    APROBAR: CRN-01, CRN-03, NAV-01
    RECHAZAR: UI-03
    POSPONER: SYN-01
    MODIFICAR CRN-06: mantener Hasta sin límite máximo

Una IA que reciba una aprobación debe:

1. Implementar únicamente los IDs aprobados y sus dependencias expresamente aceptadas.
2. No aprovechar el trabajo para hacer refactorizaciones no aprobadas.
3. Ejecutar los criterios y pruebas descritos en cada ID.
4. Actualizar el estado de cada ID en este archivo a APROBADO, IMPLEMENTADO, RECHAZADO o POSPUESTO.
5. Hacer fetch antes de editar y comprobar que main no haya avanzado.
6. Hacer un commit coherente por lote aprobado y push directo a origin/main, según la política solicitada por el propietario.
7. Si cambia index.html, app.js, styles.css, manifest.json u otro recurso servido, actualizar también la versión de aplicación y la caché del service worker de forma coordinada.

## 2. Alcance y exclusiones

Se ha revisado:

- Cronómetro, temporizador, pausa, cierre, cambio de obra y registro final.
- Persistencia local, sincronización con Supabase, cambios entre dispositivos y autenticación.
- Obras, solidez, historial, estadísticas, calendario, estado diario, diario, tareas y ajustes.
- Adaptación visual a iPad vertical, iPad horizontal y móvil.
- Navegación, modales, formularios, teclado y accesibilidad básica.
- PWA, service worker, manifiesto, actualización y capacidad de prueba.
- Riesgo técnico del HTML, CSS y JavaScript actuales.

Por petición del propietario, no se propone mejorar el organizador automático de sesiones ni las sugerencias de estudio. La única propuesta relacionada con esas funciones es retirarlas de forma segura, porque siguen ocultas pero conectadas al registro real de estudio.

## 3. Método y evidencia

La auditoría combinó lectura estática, búsquedas estructurales y ejecución real de la app.

- Resoluciones probadas: 390 x 844, 834 x 1194, 1024 x 768 y 1024 x 1366.
- Flujos probados: sesión, obras, solidez, calendario, estadísticas, ajustes, cronómetro en reposo, en marcha y en pausa.
- Consola durante el recorrido principal: sin errores ni advertencias.
- Comprobación sintáctica de app.js con Node: correcta.
- IDs duplicados en ejecución: ninguno.
- Manejadores inline sin función global resoluble: no se detectaron casos propios de la app.
- No existe package.json ni una suite automatizada.
- Tamaño aproximado de app.js: 931 KB y más de 20.000 líneas.
- Funciones declaradas en app.js: aproximadamente 903.
- Manejadores de evento inline en HTML generado o estático: aproximadamente 242.
- Asignaciones directas a innerHTML: aproximadamente 156.
- Estilos inline: aproximadamente 314.
- Reglas important en styles.css: aproximadamente 370.

La pantalla de cronómetro rediseñada funciona visualmente bien en general. Los problemas enumerados a continuación se concentran en fiabilidad, estados límite, navegación, accesibilidad y algunas composiciones secundarias.

## 4. Resumen de decisiones

| ID | Prioridad | Tamaño | Propuesta | Estado |
|---|---:|---:|---|---|
| QUA-01 | P0 | L | Crear pruebas automáticas y CI mínimos | PENDIENTE |
| ARC-01 | P0 | XL | Retirar organizador y sugerencias sin romper el registro | PENDIENTE |
| CRN-01 | P0 | M | Impedir minutos de más en temporizadores | PENDIENTE |
| CRN-02 | P1 | M | Unificar el mínimo de sesión y borrar fallos de verdad | PENDIENTE |
| CRN-03 | P0 | M | Guardar una sesión de forma atómica antes de confirmarla | PENDIENTE |
| CRN-04 | P1 | M | Mostrar y recuperar siempre el cronómetro activo | PENDIENTE |
| CRN-05 | P1 | M | Dividir el tiempo al cambiar de obra en marcha | PENDIENTE |
| CRN-06 | P1 | M | Hacer fiable y accesible la duración y el modo Hasta | PENDIENTE |
| SYN-01 | P0 | XL | Sustituir la sincronización global por mezcla por entidad | PENDIENTE |
| SYN-02 | P0 | M | Escritura local inmediata, cola de nube y estado visible | PENDIENTE |
| SEC-01 | P0 | M | Eliminar la contraseña en texto plano y crear logout real | PENDIENTE |
| SEC-02 | P0 | L | Eliminar las vías de inyección HTML | PENDIENTE |
| DAT-01 | P1 | L | Usar fechas civiles estables entre zonas horarias | PENDIENTE |
| NAV-01 | P1 | S | Corregir la posición de scroll al cambiar de pantalla | PENDIENTE |
| NAV-02 | P1 | S | Eliminar el desbordamiento de la barra móvil | PENDIENTE |
| UI-01 | P1 | M | Llevar los controles táctiles a un mínimo cómodo | PENDIENTE |
| UI-02 | P2 | M | Reorganizar Sesión para iPad | PENDIENTE |
| UI-03 | P2 | M | Reorganizar Ajustes para iPad | PENDIENTE |
| UI-04 | P2 | M | Mejorar Calendario y Obras en iPad | PENDIENTE |
| ACC-01 | P1 | L | Unificar modales con foco y teclado correctos | PENDIENTE |
| ACC-02 | P1 | M | Aislar pausa y vistas inactivas del foco | PENDIENTE |
| ACC-03 | P1 | L | Etiquetar formularios y completar el teclado | PENDIENTE |
| STA-01 | P1 | M | Retirar estadísticas de compases y aclarar Solidez | PENDIENTE |
| TXT-01 | P1 | S | Corregir textos con codificación rota | PENDIENTE |
| PWA-01 | P2 | M | Alinear manifiesto, caché y funcionamiento sin conexión | PENDIENTE |
| TSK-01 | P2 | S | Completar el ciclo de vida de las tareas | PENDIENTE |
| ARC-02 | P2 | XL | Modularizar y retirar código muerto después de cubrirlo | PENDIENTE |

P0 significa riesgo de pérdida de datos, seguridad o registro incorrecto. P1 significa fallo reproducible o fricción importante. P2 significa mejora de calidad, mantenimiento o acabado.

## 5. Propuestas detalladas

### QUA-01. Crear pruebas automáticas y CI mínimos

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** L
**Tipo:** Calidad y red de seguridad
**Dependencias:** Ninguna. Debe preceder a ARC-01, SYN-01 y ARC-02.

**Evidencia**

El repositorio no contiene package.json, pruebas unitarias, pruebas de navegador ni CI. El comportamiento depende de un único archivo JavaScript muy grande, almacenamiento local, tiempo real y sincronización remota. Una comprobación manual no cubre regresiones de reloj, segundo plano, cierre inmediato o dos dispositivos.

**Instrucción exacta**

1. Añadir una configuración mínima de Node sin introducir un proceso de compilación para producción.
2. Usar Playwright para pruebas de navegador y capturas responsive.
3. Usar Vitest o el runner nativo de Node para lógica pura extraída del reloj, fechas y mezcla de datos.
4. Crear fixtures deterministas de localStorage y bloquear Supabase en las pruebas que no sean específicamente de integración.
5. Añadir scripts para test, test:unit, test:e2e y test:visual.
6. Añadir una acción de GitHub que ejecute comprobación sintáctica, unitarias y smoke tests en cada push a main.
7. Probar como mínimo las resoluciones 390 x 844, 834 x 1194, 1024 x 768 y 1280 x 720.
8. Guardar capturas sólo para pantallas estables; para el reloj, congelar el tiempo.

**Criterios de aceptación**

- Un comando instala dependencias y otro ejecuta toda la suite desde un clon limpio.
- Las pruebas no escriben datos en la cuenta Supabase real.
- Existe un smoke test para abrir cada vista principal sin excepción de consola.
- Existe un fixture que permite arrancar con una obra y sesiones conocidas.
- Un fallo de test bloquea el workflow de GitHub.

**Pruebas mínimas**

- Abrir la app vacía y con fixture.
- Iniciar, pausar, reanudar y finalizar un cronómetro.
- Cambiar de pestaña con scroll.
- Abrir y cerrar un modal por botón y Escape.
- Recargar sin conexión después de una primera carga.
- Comprobar que no hay overflow horizontal a los cuatro anchos objetivo.

---

### ARC-01. Retirar organizador y sugerencias sin romper el registro

**Estado:** PENDIENTE
**Prioridad:** P0 por ser una decisión de producto ya tomada
**Tamaño:** XL
**Tipo:** Simplificación funcional
**Dependencias:** QUA-01 en su versión smoke.

**Evidencia**

La interfaz esconde sessionPlan y tarjetas de ritmo mediante CSS, pero el código sigue generando planes, puntuando obras y renderizando sugerencias. Más importante: cronoFinish, autoSaveTodayPlan, Hecho y otros flujos usan el DOM oculto de sessionPlan como almacenamiento intermedio. Borrar sólo el HTML rompería el guardado real.

También existe confirmChangePlanObra, que recorre entradas históricas de db.sessionPlants y puede reasignar más sesiones de las pretendidas al cambiar una obra del plan.

**Instrucción exacta**

1. Definir primero una API de datos pequeña para el estudio real: appendStudyBlock, updateStudyBlock, deleteStudyBlock, getStudyBlocksForDate y getStudyMinutesForDate.
2. Mantener db.sessionPlants como fuente de verdad de bloques realmente estudiados. No confundirla con un plan futuro.
3. Refactorizar cronoFinish, closeHechoDatos, el registro manual, el historial y las estadísticas para usar esa API sin leer ni escribir nodos de sessionPlan.
4. Hacer que Registrar estudio guarde directamente en el historial. Eliminar la opción A la sesión.
5. Eliminar del HTML sessionPlan y cualquier contenedor dedicado exclusivamente al plan o a sugerencias.
6. Eliminar generateSession, scoreEntity, SCORE_W, renderSessionInsights y sus ayudantes, listeners y estado global.
7. Eliminar confirmChangePlanObra y la migración histórica asociada.
8. Inventariar y retirar también recomendaciones automáticas del tipo qué estudiar, prioridad de estudio o sesión sugerida. Conservar filtros neutrales, mediciones de solidez y datos descriptivos.
9. Eliminar CSS que sólo sostenía el plan oculto, incluidas las reglas important usadas para esconderlo.
10. Migrar datos sin borrar sessionPlants, forestPlants, sesiones reales, diario, estados ni solHistory.

**Criterios de aceptación**

- No existe UI, texto ni llamada de código que genere u organice una sesión futura.
- No existe una sugerencia automática de qué obra estudiar.
- Un cronómetro finalizado aparece inmediatamente en Historial y Estadísticas.
- Registrar estudio manualmente produce exactamente un bloque.
- Recargar no duplica ni pierde bloques.
- Cambiar el nombre o movimiento de una obra no reescribe bloques históricos no seleccionados.
- La app arranca correctamente con datos antiguos que contengan campos del plan.

**Pruebas mínimas**

- Fixture antiguo con plan oculto y diez sessionPlants.
- Cronómetro válido, cronómetro fallido, registro manual y edición de datos Hecho.
- Recarga inmediata después de finalizar.
- Importación de una copia antigua y comparación de minutos antes y después.
- Búsqueda final en HTML, CSS y JS de sessionPlan, generateSession, scoreEntity y renderSessionInsights.

**No incluido**

No se rediseñará el organizador ni se sustituirá por otro sistema de recomendaciones.

---

### CRN-01. Impedir minutos de más en temporizadores

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** M
**Tipo:** Error funcional y de datos
**Dependencias:** QUA-01 recomendado.

**Evidencia confirmada**

cronoStartTick detecta el final mediante un intervalo. En iPad y navegadores en segundo plano los intervalos pueden retrasarse mucho. cronoFinish usa el tiempo bruto de cronoCurrentMs incluso en modo temporizador. Un temporizador de 25 minutos que despierte dos horas tarde puede registrar cerca de dos horas, aunque un comentario afirma que el objetivo limita la duración.

**Instrucción exacta**

1. Dar a cada ejecución un runId estable.
2. Guardar targetDurationMs para Temporizador y Hasta. Cronómetro libre no tendrá objetivo.
3. Calcular siempre effectiveElapsedMs como el menor entre el tiempo activo y targetDurationMs cuando exista objetivo.
4. Al pausar, conservar el tiempo activo; al reanudar, recalcular el instante final desde el tiempo restante.
5. Escuchar visibilitychange y pageshow. Si el objetivo venció mientras la app estaba oculta, finalizar una sola vez con la duración exacta.
6. Hacer finalize idempotente por runId para que el intervalo y el retorno a primer plano no creen dos bloques.
7. Usar effectiveElapsedMs tanto en la pantalla como en db.sessionPlants, sesiones, estadísticas y modal Hecho.

**Criterios de aceptación**

- Un temporizador de 25:00 nunca guarda 25:01 ni más.
- Volver dos horas tarde guarda exactamente 25 minutos.
- Cronómetro libre sigue contando sin límite.
- Pausar cinco minutos no suma esos cinco minutos.
- Dos eventos de finalización simultáneos crean un solo bloque.

**Pruebas mínimas**

- Reloj falso: avanzar 24:59, 25:00 y 2:00:00.
- Pausa a los 10 minutos, espera de una hora y reanudación.
- visibilitychange y tick ejecutados en el mismo instante.
- Recarga un segundo antes y un segundo después del objetivo.

---

### CRN-02. Unificar el mínimo de sesión y borrar fallos de verdad

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Incoherencia funcional
**Dependencias:** CRN-03 aconsejada.

**Evidencia confirmada**

El selector permite TIMER_MIN_MINUTES igual a 5, pero CRONO_MIN_MIN vale 10. Una sesión elegida intencionadamente de cinco minutos termina clasificada como fallida. Además, Borrar el registro en el flujo fallido reduce un contador visual, pero no elimina con fiabilidad la entrada failed de db.sessionPlants ni fuerza el guardado.

**Decisión de producto recomendada**

Aceptar cinco minutos como sesión válida, porque la interfaz ya los ofrece de forma explícita. Definir una única constante MIN_STUDY_MINUTES igual a 5. Si se prefiere mantener diez, el selector no debe permitir menos de diez.

**Instrucción exacta**

1. Sustituir TIMER_MIN_MINUTES y CRONO_MIN_MIN por una única regla.
2. Aplicar la misma regla al selector, validación, textos, finalización, estadísticas y registro manual.
3. Asignar ID estable a cada entrada fallida.
4. Hacer que Borrar el registro elimine por ID la entrada real, actualice cualquier agregado y persista antes de cerrar.
5. Hacer que Mantener registro conserve failed igual a true y no sume minutos válidos.

**Criterios de aceptación**

- Con la recomendación, 4:59 es fallida y 5:00 es válida.
- No aparece un temporizador seleccionable que vaya a fallar por su duración objetivo.
- Borrar y recargar no hace reaparecer la sesión fallida.
- Mantener y recargar conserva una sola entrada fallida.

**Pruebas mínimas**

- Casos límite un segundo antes, exactamente en el mínimo y un segundo después.
- Borrar, recargar y sincronizar.
- Mantener, recargar y comprobar que no altera minutos válidos.

---

### CRN-03. Guardar una sesión de forma atómica antes de confirmarla

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** M
**Tipo:** Riesgo de pérdida de datos
**Dependencias:** SYN-02 comparte la infraestructura de guardado.

**Evidencia confirmada**

recordSessionPlant modifica memoria y el guardado definitivo puede depender del autoSaveTodayPlan programado. La interfaz puede anunciar que la sesión está guardada antes de que localStorage haya quedado actualizado. Cerrar la app inmediatamente abre una ventana de pérdida. El botón Cancelar del modal Hecho sólo descarta metadatos, no el tiempo ya registrado, pero su texto sugiere que cancela todo.

**Instrucción exacta**

1. Crear una transacción finishStudyBlock que construya el bloque, lo inserte y escriba localStorage sin debounce.
2. Devolver el ID persistido y abrir Hecho sólo después de que la escritura local termine.
3. Encolar la subida a nube por separado; no bloquear la confirmación local por la red.
4. Hacer que Hecho actualice el mismo bloque por ID y vuelva a persistir.
5. Cambiar Cancelar por Ahora no.
6. Añadir un texto breve: El tiempo ya está guardado; aquí puedes añadir detalles.
7. Mostrar error real y conservar los datos en memoria si falla la escritura local.

**Criterios de aceptación**

- Cerrar o recargar inmediatamente después de finalizar conserva el bloque.
- El modal nunca afirma Guardado antes de la escritura local.
- Ahora no conserva el tiempo y descarta únicamente campos opcionales.
- Guardar Hecho no crea un segundo bloque.

**Pruebas mínimas**

- Recargar en el primer frame después de la confirmación.
- Simular fallo de localStorage por cuota.
- Guardar Hecho dos veces y comprobar idempotencia.
- Ejecutar sin conexión y sincronizar al recuperarla.

---

### CRN-04. Mostrar y recuperar siempre el cronómetro activo

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Continuidad de uso
**Dependencias:** CRN-01 y CRN-03 recomendadas.

**Evidencia confirmada**

cronoCloseFocus vuelve a Sesión y deja el reloj en marcha. Fuera de la vista Cronómetro no aparece un indicador visible con tiempo, obra o acceso de retorno. Es fácil olvidar un reloj y acumular tiempo fantasma. La recuperación tras una pausa o ausencia larga aplica decisiones implícitas que el usuario no ve.

**Instrucción exacta**

1. Añadir una actividad persistente y compacta en la cabecera o encima de la navegación de todas las vistas cuando haya reloj activo.
2. Mostrar estado, tiempo, obra y movimiento. Pulsarla debe volver al cronómetro.
3. Usar aria-live con actualización moderada, sin anunciar cada segundo a lectores de pantalla.
4. Persistir el estado en cada transición: inicio, pausa, reanudación, cambio de obra, final y descarte.
5. Al recargar, reconstruir el reloj desde timestamps y estado persistido.
6. Tras una ausencia larga no cubierta por un objetivo, mostrar una reconciliación: continuar, guardar hasta un instante o descartar.
7. No reanudar silenciosamente una pausa larga.

**Criterios de aceptación**

- Un reloj activo es visible desde Sesión, Obras, Calendario, Estadísticas y Ajustes.
- Un toque vuelve al mismo estado sin reiniciar el tiempo.
- Recargar conserva ejecución o pausa correctamente.
- Una ausencia larga nunca añade horas sin una decisión explícita o un objetivo temporizado.

**Pruebas mínimas**

- Cerrar foco en marcha y en pausa.
- Recargar en otra vista.
- Cambiar de pestaña, bloquear y volver.
- Simular ocho horas de ausencia en cronómetro libre.

---

### CRN-05. Dividir el tiempo al cambiar de obra en marcha

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Integridad histórica
**Dependencias:** CRN-03.

**Evidencia confirmada**

cronoConfirmChangeObra sustituye obraId y movimiento durante una ejecución. Al finalizar, todo el tiempo transcurrido puede quedar atribuido a la última obra seleccionada.

**Instrucción exacta**

1. Si han transcurrido menos de 60 segundos, tratar el cambio como corrección del destino actual.
2. A partir de 60 segundos, cerrar y persistir un bloque para la obra anterior con la duración exacta acumulada.
3. Iniciar un nuevo segmento enlazado por un commonRunId para la nueva obra sin abandonar la pantalla.
4. Mostrar una confirmación clara: se guardará el tramo anterior y el reloj continuará.
5. Mantener notas y pasajes ligados al segmento en el que se crearon.
6. No reutilizar confirmChangePlanObra ni modificar registros históricos por coincidencia de nombres.

**Criterios de aceptación**

- Diez minutos en A y cinco en B generan dos bloques de 10 y 5.
- La suma coincide con el tiempo activo total.
- Una corrección durante los primeros 59 segundos no crea un bloque residual.
- Ninguna sesión de días anteriores cambia.

**Pruebas mínimas**

- Cambio en 0:30, 1:00 y 10:00.
- Dos cambios en una misma ejecución.
- Cambio mientras está pausado.
- Recarga después del primer segmento.

---

### CRN-06. Hacer fiable y accesible la duración y el modo Hasta

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Interfaz y accesibilidad
**Dependencias:** CRN-01.

**Evidencia confirmada**

El control radial del temporizador no se expone como slider ni ofrece una alternativa de teclado. En modo Hasta puede calcular más de 120 minutos, pero la previsualización limita gráficamente el aro a TIMER_MAX_MINUTES igual a 120. Un objetivo de 512 minutos muestra el mismo aro lleno que uno de 120.

**Instrucción exacta**

1. Añadir un control semántico sincronizado con el aro: input numérico con botones menos y más, presets o slider nativo.
2. Exponer valor actual, mínimo, máximo y unidad en el nombre accesible.
3. Admitir flechas de teclado y cambios de cinco minutos.
4. En Hasta, mostrar siempre hora final, día si no es hoy y duración total calculada.
5. Al arrancar, representar el progreso respecto a la duración elegida, no respecto a un máximo fijo de 120 minutos.
6. Antes de arrancar, usar una representación neutral de duración si el total supera 120; no fingir que el aro es una escala de dos horas.
7. Pedir confirmación para duraciones inusualmente largas, por ejemplo más de cuatro horas, sin truncarlas silenciosamente.
8. Anunciar errores si la hora no es válida.

**Criterios de aceptación**

- El tiempo puede ajustarse sin gesto radial.
- VoiceOver identifica el control, el valor y cómo cambiarlo.
- 90, 120 y 512 minutos producen información visual y textual no ambigua.
- El progreso en marcha llega a cero exactamente en el objetivo.

**Pruebas mínimas**

- Sólo teclado.
- VoiceOver o snapshot de accesibilidad.
- Hasta dentro de 30 minutos, 3 horas y al día siguiente si se admite.
- Texto grande al 200 por ciento.

---

### SYN-01. Sustituir la sincronización global por mezcla por entidad

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** XL
**Tipo:** Integridad de datos entre dispositivos
**Dependencias:** QUA-01 y SYN-02.

**Evidencia confirmada**

loadFromCloud acepta nube si cloudDate es hasta 60 segundos anterior al local. Una edición local 30 segundos más reciente puede perderse. La mezcla actual sólo protege bien algunas colecciones históricas; obras, eventos, solidez y otros campos anidados pueden ser sustituidos en bloque.

hasCloudData considera que la nube tiene datos sólo si existen obras o sesiones. Una cuenta legítimamente vacía, o con únicamente diario y estados, puede interpretarse como vacía y recibir datos locales antiguos. Esto puede resucitar obras borradas.

_mergeSesiones elige una sesión diaria completa por el mayor número de minutos, en vez de mezclar sus elementos. No hay tombstones para eliminaciones ni control de revisión atómico. Dos dispositivos pueden sobrescribirse por última escritura de toda la base.

**Instrucción exacta**

1. Introducir syncSchemaVersion y una migración compatible con datos actuales.
2. Dar ID estable, updatedAt y opcionalmente createdAt a cada entidad mutable: obras, movimientos, bloques, eventos, estados, solHistory, tareas, diario y sesiones.
3. Representar eliminaciones con tombstones que contengan ID y deletedAt. Purgarlas sólo después de un periodo y de confirmar sincronización.
4. Mezclar por ID y elegir la versión con updatedAt más reciente. No elegir una base completa por una tolerancia global de 60 segundos.
5. Mezclar los componentes de una sesión diaria, no escoger toda la sesión por sus minutos.
6. Considerar que existe nube cuando la fila existe, aunque todas las colecciones estén vacías.
7. Añadir una revisión creciente en la fila remota. Leer, mezclar y escribir con control de revisión; ante conflicto, volver a leer, mezclar y reintentar con límite.
8. Mantener una copia local previa a cada migración para recuperación.
9. Registrar de forma diagnóstica los conflictos sin incluir contenido sensible.
10. Documentar cualquier cambio de esquema Supabase como migración versionada.

**Criterios de aceptación**

- Dos dispositivos pueden editar obras distintas sin perder ninguna.
- Dos dispositivos pueden registrar bloques el mismo día y ambos sobreviven.
- Borrar la última obra en A no permite que B la resucite.
- Una nube con sólo diario o estado se reconoce como válida.
- Una edición local 30 segundos más nueva no es sustituida por la nube.
- La misma sincronización repetida es idempotente.

**Pruebas mínimas**

- Matriz A y B: crear, editar y borrar la misma y distintas entidades.
- Cuenta completamente vacía.
- Relojes de dispositivos separados varios minutos.
- Conflicto de revisión forzado y reintento.
- Datos de una versión antigua sin IDs ni updatedAt.

**Riesgo de implementación**

No desplegar este punto como una reescritura sin fixtures de datos reales anonimizados y copia de seguridad. Debe tener migración reversible.

---

### SYN-02. Escritura local inmediata, cola de nube y estado visible

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** M
**Tipo:** Persistencia
**Dependencias:** Ninguna; SYN-01 debe reutilizarla.

**Evidencia confirmada**

La subida está diferida aproximadamente 1,5 segundos y no existe un flush fiable al ocultar o cerrar. Algunas ramas llaman a upsert sin await. Si la app se cierra tras una edición, la nube puede quedar antigua y la carga siguiente puede elegir la versión equivocada.

**Instrucción exacta**

1. Separar saveLocalNow de enqueueCloudSync.
2. Hacer saveLocalNow síncrono y obligatorio al final de cada operación lógica.
3. Mantener dirtyRevision y lastSyncedRevision en almacenamiento local.
4. Procesar la nube en una cola de una sola escritura activa, agrupando cambios pero sin perder revisiones.
5. Al pasar a hidden, intentar sincronización no diferida y dejar dirtyRevision si no termina.
6. En el siguiente arranque, sincronizar cualquier revisión pendiente antes de declarar Todo guardado.
7. Esperar todos los upserts iniciados desde cargas o mezclas.
8. Mostrar un estado discreto: Guardado en este dispositivo, Sincronizando, Sin conexión o Error al sincronizar.
9. Ofrecer Reintentar sin bloquear el uso local.

**Criterios de aceptación**

- Cerrar 100 ms después de una edición no pierde el cambio en el mismo dispositivo.
- Una subida fallida queda pendiente y se reintenta.
- La UI no dice sincronizado mientras dirtyRevision sea mayor.
- Nunca se ejecutan dos escrituras remotas fuera de orden.

**Pruebas mínimas**

- Red lenta, offline, error 500 y recuperación.
- Diez cambios rápidos y comprobación de la última revisión.
- Cierre inmediato y reapertura.
- Carga que requiere mezcla y nueva subida.

---

### SEC-01. Eliminar la contraseña en texto plano y crear logout real

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** M
**Tipo:** Seguridad y cuentas
**Dependencias:** SYN-02 aconsejada para advertir de cambios pendientes.

**Evidencia confirmada**

_saveStoredCredentials guarda email y contraseña sin cifrar en localStorage bajo piano_auto_creds. Supabase ya persiste su sesión. doLogout está vacío y Cuenta diferente no establece una separación clara de datos.

**Instrucción exacta**

1. Eliminar _saveStoredCredentials y toda lectura de contraseña desde localStorage.
2. En el primer arranque de la nueva versión, borrar piano_auto_creds aunque el usuario no cierre sesión.
3. Confiar en la sesión persistida y el refresh token administrados por Supabase.
4. Implementar doLogout con supabase.auth.signOut.
5. Antes de salir, advertir si existe dirtyRevision pendiente y ofrecer reintentar o continuar conservando la copia local.
6. Separar almacenamiento local por userId o vaciar de memoria los datos de la cuenta al cambiar de usuario.
7. Asegurar que una segunda cuenta nunca ve datos locales de la anterior.
8. Cambiar Cuenta diferente para ejecutar el cierre real antes de mostrar el acceso.

**Criterios de aceptación**

- Ninguna contraseña aparece en localStorage, IndexedDB, logs o exportaciones.
- Una instalación antigua elimina piano_auto_creds al actualizar.
- Logout invalida la sesión y vuelve a la pantalla correcta.
- Cambiar de cuenta no mezcla ni muestra datos.
- Reiniciar mantiene la sesión mediante Supabase sin pedir contraseña cuando corresponde.

**Pruebas mínimas**

- Migración con piano_auto_creds preexistente.
- Logout online y offline.
- Cuenta A, logout, cuenta B.
- Inspección de todos los almacenamientos del navegador.

---

### SEC-02. Eliminar las vías de inyección HTML

**Estado:** PENDIENTE
**Prioridad:** P0
**Tamaño:** L
**Tipo:** Seguridad e integridad visual
**Dependencias:** QUA-01.

**Evidencia confirmada**

Hay numerosas interpolaciones de nombres de obras, movimientos, eventos y datos importados dentro de innerHTML. Algunas rutas usan escapeHtmlSafe y otras no. Los manejadores onclick construidos como texto amplían el riesgo. Un nombre con comillas o HTML puede romper la tarjeta; un CSV manipulado puede intentar ejecutar código.

**Instrucción exacta**

1. Prohibir que valores de usuario entren directamente en innerHTML, atributos HTML o código de eventos.
2. Preferir createElement, textContent, setAttribute y event delegation con IDs opacos.
3. Si una plantilla debe mantenerse temporalmente, usar escapes distintos y correctos para texto y atributo.
4. Auditar obras, movimientos, pasajes, eventos, diario, tareas, notas, importaciones CSV, datos Forest y mensajes de nube.
5. Sustituir onclick inline que incluya datos por data-id y listeners registrados.
6. Validar importaciones por esquema y longitud, no por confianza en el archivo.
7. Añadir una política CSP cuando hayan desaparecido los scripts y eventos inline incompatibles.
8. No guardar contenido sensible en mensajes de error.

**Criterios de aceptación**

- Texto como una etiqueta img con onerror se muestra literalmente.
- Comillas, ampersand y signos menor que no rompen la interfaz.
- Ningún valor de usuario se concatena en un manejador.
- La importación rechaza estructuras inválidas con un mensaje útil.

**Pruebas mínimas**

- Nombres con comillas simples, dobles, ampersand y HTML.
- Payloads en obra, movimiento, evento, tarea, nota y CSV.
- Contador global que confirme que ningún handler inyectado se ejecutó.
- Búsqueda estática de interpolaciones directas en innerHTML.

---

### DAT-01. Usar fechas civiles estables entre zonas horarias

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** L
**Tipo:** Modelo de datos
**Dependencias:** Conviene coordinarla con SYN-01.

**Evidencia**

La app usa new Date(...).toDateString como clave persistente de día en decenas de lugares. La misma marca temporal puede pertenecer a días diferentes al viajar, cambiar zona horaria o abrir datos en otro dispositivo. El horario de verano también complica agrupaciones.

**Instrucción exacta**

1. Guardar en cada evento la marca temporal absoluta y una localDate YYYY-MM-DD capturada al registrarlo.
2. Guardar también timezoneOffset o zona IANA si se necesita reconstruir el contexto.
3. Crear una única utilidad localDateKey y eliminar comparaciones persistentes con toDateString.
4. Agrupar por localDate guardada, no por la zona horaria del dispositivo que consulta.
5. Migrar registros antiguos de forma perezosa y conservar el valor original.
6. Definir cómo se muestran sesiones que atraviesan medianoche; la recomendación es dividir el bloque visualmente sin duplicar sus minutos.

**Criterios de aceptación**

- Una sesión registrada en Madrid el 1 de agosto sigue en ese día al abrirla en Nueva York.
- El total histórico no cambia al cambiar de zona.
- Fechas de calendario y estadísticas usan la misma clave.
- La migración no cambia los minutos totales.

**Pruebas mínimas**

- Europe/Madrid, America/New_York y Asia/Tokyo.
- Días de cambio horario.
- Bloque que cruza medianoche.
- Datos antiguos con date en distintos formatos.

---

### NAV-01. Corregir la posición de scroll al cambiar de pantalla

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** S
**Tipo:** Navegación
**Dependencias:** Ninguna.

**Evidencia confirmada**

showView cambia la vista sin gestionar scroll. openSettings pone app-content.scrollTop a cero, pero el contenedor que realmente desplaza es document.scrollingElement. Se reprodujo Ajustes abriendo con window.scrollY igual a 442 y la cabecera fuera de pantalla. Volver a Sesión mantuvo un desplazamiento heredado.

**Instrucción exacta**

1. Centralizar el cambio de vista en showView.
2. Guardar la posición de la vista saliente por nombre.
3. Tras activar la nueva vista y en el siguiente frame, restaurar su posición previa o usar cero si nunca se abrió.
4. Abrir Ajustes y cualquier flujo modal de nivel superior siempre desde cero.
5. Al pulsar la pestaña ya activa, desplazar suavemente al inicio.
6. Usar document.scrollingElement o window, no un contenedor que no desplaza.
7. Evitar que el cambio de altura de la barra inferior altere la restauración.

**Criterios de aceptación**

- Abrir Ajustes desde el final de Estadísticas muestra su cabecera.
- Cada pestaña recupera su propio scroll al volver.
- Una pestaña nunca hereda por primera vez el scroll de otra.
- Funciona con teclado, barra inferior y accesos programáticos.

**Pruebas mínimas**

- Ir al final de cada vista y recorrer todas las pestañas.
- Abrir Ajustes desde scroll 0 y desde scroll profundo.
- Pulsar dos veces la pestaña activa.
- iPad vertical y móvil.

---

### NAV-02. Eliminar el desbordamiento de la barra móvil

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** S
**Tipo:** Responsive
**Dependencias:** Ninguna.

**Evidencia confirmada**

En 390 x 844 el contenido útil medido era 375 px, la zona navegable tenía clientWidth de 307 y scrollWidth de 340. Las cinco pestañas de 78 px se salían, aparecía scrollbar horizontal y las etiquetas Calendario y Estadísticas se solapaban o cortaban.

**Instrucción exacta**

1. Convertir la barra en una cuadrícula de cinco columnas repeat(5, minmax(0, 1fr)).
2. Aplicar min-width: 0 a botones y etiquetas.
3. Eliminar overflow-x auto y cualquier ancho mínimo acumulativo.
4. Mantener icono y etiqueta centrados con una altura estable y safe-area inferior.
5. Permitir que una etiqueta se ajuste de forma controlada si el texto al 200 por ciento no cabe.
6. No ocultar una pestaña ni exigir scroll horizontal.

**Criterios de aceptación**

- document.scrollWidth no supera clientWidth.
- Las cinco pestañas son visibles y pulsables a 320, 375, 390 y 430 px.
- No hay scrollbar horizontal.
- La pestaña activa sigue siendo inequívoca.

**Pruebas mínimas**

- Los cuatro anchos y orientación horizontal.
- Texto del sistema al 100, 150 y 200 por ciento.
- Safe area simulada.

---

### UI-01. Llevar los controles táctiles a un mínimo cómodo

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Ergonomía táctil
**Dependencias:** Puede combinarse con ACC-01 y ACC-03.

**Evidencia confirmada**

Se midieron controles por debajo de 44 x 44 px: información de 27 a 33 px, cerrar cronómetro de 36 px, pestañas de modo de 30 px de alto, añadir pasaje de 24 a 28 px, pestañas del cajón de 30 px y varios botones rápidos de 42 px. El aspecto es limpio, pero en iPad resulta fácil fallar el toque. En marcha, el botón final aparece gris y con el texto Hecho, por lo que puede parecer deshabilitado, mientras su nombre accesible dice Parar.

**Instrucción exacta**

1. Crear el token CSS --tap-target con 44px.
2. Aplicar un área interactiva mínima de 44 x 44 sin aumentar necesariamente el icono visual.
3. Usar padding o pseudoelemento sólo si no se solapa con otro objetivo.
4. Priorizar cerrar, información, modos, pasajes, pausa, terminar, navegación de mes, limpiar diario y controles de solidez.
5. Mantener separación mínima entre objetivos adyacentes.
6. Añadir estados hover, focus-visible, active y disabled coherentes.
7. Dar al final de sesión una apariencia activa y una etiqueta visible y accesible idéntica, preferiblemente Terminar y guardar.

**Criterios de aceptación**

- Ningún control primario táctil queda por debajo de 44 x 44.
- Las áreas no se solapan.
- El diseño sigue cabiendo sin overflow a 320 px.
- El foco visible no queda cortado.

**Pruebas mínimas**

- Medición automática de bounding boxes de botones visibles.
- iPad con toque y navegación sólo con teclado.
- 320 px y texto grande.

---

### UI-02. Reorganizar Sesión para iPad

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** M
**Tipo:** Composición visual
**Dependencias:** ARC-01 debe definir antes qué bloques desaparecen.

**Evidencia**

En iPad vertical, Sesión apila diario y cuatro grupos de estado en una página de aproximadamente 1.730 px. Hay bastante desplazamiento y poca utilización del ancho. No es un error funcional, pero se siente más como una versión móvil ampliada que como una pantalla de iPad.

**Instrucción exacta**

1. Mantener el diario a ancho completo en la parte superior.
2. A partir de 768 px, organizar bienestar, sueño, deporte y gatillos en una cuadrícula de dos columnas.
3. Mantener una sola columna en móvil.
4. Usar un ancho máximo contenido cercano a 960 px y padding de 24 a 32 px en iPad.
5. Alinear títulos, valores y acciones con una escala de espaciado común.
6. No añadir tarjetas anidadas ni texto instructivo.
7. Preservar exactamente diario, estado y registro; no reintroducir planes ni sugerencias.

**Criterios de aceptación**

- El primer viewport de iPad muestra Diario y el inicio claro del estado diario.
- La página reduce su longitud sin comprimir controles.
- No hay saltos al seleccionar una respuesta.
- Móvil conserva lectura cómoda en una columna.

**Pruebas mínimas**

- 768 x 1024, 834 x 1194, 1024 x 1366 y 390 x 844.
- Estados vacíos, textos largos y todos los grupos completados.

---

### UI-03. Reorganizar Ajustes para iPad

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** M
**Tipo:** Composición visual
**Dependencias:** NAV-01.

**Evidencia**

Ajustes supera aproximadamente 2.400 px en iPad y agrupa todas las secciones en una sola columna. Primero debe corregirse el bug de scroll; después se puede aprovechar mejor el ancho.

**Instrucción exacta**

1. En iPad horizontal y anchos de 900 px o más, usar dos columnas estables.
2. Colocar Apariencia y Sonido en una columna; Datos, Sincronización y Cuenta en la otra.
3. Mantener acciones destructivas separadas al final y con confirmación explícita.
4. En iPad vertical estrecho y móvil, volver a una columna.
5. Mantener títulos y controles alineados sin convertir toda la pantalla en tarjetas flotantes.
6. Evitar que un selector o texto largo cambie el ancho de columna.

**Criterios de aceptación**

- Ajustes abre siempre en su cabecera.
- En 1024 x 768 se ven dos grupos útiles sin scroll inicial.
- En 834 px no hay columnas demasiado estrechas.
- Acciones de exportar, importar, cuenta y borrado siguen completas.

**Pruebas mínimas**

- iPad vertical y horizontal.
- Usuario conectado, desconectado y con error de sync.
- Textos al 200 por ciento.

---

### UI-04. Mejorar Calendario y Obras en iPad

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** M
**Tipo:** Acabado visual
**Dependencias:** UI-01; ACC-03 para semántica del calendario.

**Evidencia**

Calendario utiliza contraste muy tenue y deja grandes zonas vacías; sus celdas no exponen estructura de calendario. En Obras, la base visual es correcta, pero filtros y acciones secundarias tienen poca jerarquía y algunos objetivos táctiles son pequeños.

**Instrucción exacta**

1. Aumentar contraste de números, bordes, eventos y día actual hasta cumplir AA.
2. Dar a las celdas una altura estable y mostrar eventos como chips legibles, con truncado y detalle al abrir.
3. Diferenciar hoy, día seleccionado y días fuera de mes sin depender sólo del color.
4. En Obras, agrupar búsqueda, filtro y orden en una toolbar que se adapte sin huecos grandes.
5. Hacer que Pase y acciones de tarjeta tengan 44 px de objetivo y un estado de foco visible.
6. Mantener densidad sobria: no añadir decoraciones ni tarjetas dentro de tarjetas.

**Criterios de aceptación**

- Calendario se entiende con contraste alto y sin color.
- Los eventos largos no rompen la cuadrícula.
- La toolbar de Obras cabe en iPad y se apila de forma ordenada en móvil.
- No hay controles flotando sin alineación.

**Pruebas mínimas**

- Mes vacío, mes con un evento diario y día con varios eventos.
- Nombres de obra y evento largos.
- Contraste automatizado y teclado.

---

### ACC-01. Unificar modales con foco y teclado correctos

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** L
**Tipo:** Accesibilidad y consistencia
**Dependencias:** QUA-01.

**Evidencia confirmada**

Los modales caben visualmente, incluido Solidez en iPad, pero los overlays no tienen de forma consistente role dialog, aria-modal, título asociado, focus trap, cierre por Escape ni restauración de foco. Los controles de fondo pueden seguir siendo alcanzables.

**Instrucción exacta**

1. Crear un único controlador openModal y closeModal.
2. Al abrir, asignar role dialog, aria-modal true y aria-labelledby a un título visible.
3. Marcar el fondo inert y bloquear scroll sin mover la página.
4. Mover el foco al título, primer campo o acción principal según el caso.
5. Encerrar Tab y Shift+Tab dentro del modal.
6. Cerrar por Escape salvo durante una operación irreversible en curso.
7. Restaurar foco al control que abrió el modal.
8. Mantener confirmaciones destructivas con acción principal explícita y cancelar disponible.
9. Migrar todos los modales y eliminar cierres a IDs inexistentes como modalSettings.

**Criterios de aceptación**

- El lector anuncia nombre y tipo de cada modal.
- El foco nunca alcanza contenido trasero.
- Escape, botón cerrar y cancelar dejan el foco en el origen.
- Abrir y cerrar no cambia el scroll de la vista.

**Pruebas mínimas**

- Solidez, Hecho, sesión fallida, evento, importación, login y confirmaciones.
- Tab y Shift+Tab.
- Apertura de un modal desde una vista con scroll profundo.

---

### ACC-02. Aislar pausa y vistas inactivas del foco

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Accesibilidad y estado
**Dependencias:** ACC-01 puede aportar el patrón.

**Evidencia confirmada**

La pausa es visualmente correcta, pero su overlay no vuelve inert el reloj que queda detrás. Botones de cerrar, modos, selector, notas, pestañas y terminar siguen en el orden de tabulación. Cuando no está pausado, el overlay invisible mantiene contenido en el árbol accesible. Algunas vistas inactivas también dejan texto residual detectable.

**Instrucción exacta**

1. Cuando no haya pausa, usar hidden o visibility hidden y aria-hidden true en el overlay.
2. Cuando haya pausa, hacer inert el contenido del cronómetro trasero.
3. Dar al overlay un rol apropiado y mover foco a Reanudar.
4. Restaurar foco al control de pausa al reanudar.
5. Aplicar hidden, aria-hidden e inert de forma sincronizada a todas las vistas no activas.
6. No confiar únicamente en opacity o pointer-events.

**Criterios de aceptación**

- En pausa sólo se alcanzan los controles de la pausa.
- Fuera de pausa el overlay no aparece en el árbol accesible.
- Una vista inactiva no aporta encabezados ni controles al lector.
- Reanudar devuelve el foco de manera predecible.

**Pruebas mínimas**

- Snapshot accesible en reposo, marcha y pausa.
- Recorrer Tab en cada estado.
- Cambiar de vista con un control enfocado.

---

### ACC-03. Etiquetar formularios y completar el teclado

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** L
**Tipo:** Accesibilidad
**Dependencias:** Puede ejecutarse por lotes.

**Evidencia confirmada**

Se detectaron inputs sin label asociado en hora Hasta, fechas y horas de eventos, rangos de dificultad y solidez, volumen, fecha de IA, registro manual y minutos de Hecho. Los grupos de estado usan role radio, pero todos los botones son tabulables y no responden a flechas como un radiogroup completo. El calendario son divs sin semántica de grid.

**Instrucción exacta**

1. Asociar cada input, select y range a un label visible mediante for e id.
2. Añadir texto accesible de valor a los rangos.
3. Implementar radiogroups con un único tabindex 0 y flechas, Home y End.
4. Usar main, nav, header y jerarquía real de headings.
5. Convertir el mes en role grid y cada fecha en gridcell; si es interactiva, usar button y navegación por flechas.
6. Anunciar fecha completa, hoy, selección y número de eventos.
7. Añadir nombre accesible coherente a iconos; evitar que el texto visible diga Hecho y el nombre accesible diga Parar.
8. Usar aria-describedby para ayuda y errores, no sólo placeholders.

**Criterios de aceptación**

- Una auditoría accesible no detecta campos sin nombre.
- Cada grupo de radio consume una sola parada de Tab.
- Todo flujo principal se completa sólo con teclado.
- Texto visible y nombre accesible de acciones coinciden.

**Pruebas mínimas**

- axe-core en todas las vistas y modales.
- Snapshot de accesibilidad.
- Teclado en estado diario, calendario, temporizador, Solidez y registro manual.

---

### STA-01. Retirar estadísticas de compases y aclarar Solidez

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** M
**Tipo:** Coherencia de producto
**Dependencias:** ARC-01 debe definir qué sugerencias se eliminan.

**Evidencia confirmada**

Estadísticas todavía muestra Aprendizaje, Eficiencia por obra y mensajes sobre obras completadas con compases. CLAUDE.md señala que computeEficienciaObras y renderRangoWidget dependen de compases retirados y no aplican a obras nuevas. renderEficienciaSection sigue llamándose.

En Solidez una sola obra puede aparecer a la vez en Prioridad y Reciente. Además, una tarjeta puede mostrar 48 por ciento actual estimado mientras Estadísticas muestra 65 por ciento de media medida sin explicar que son conceptos distintos.

**Instrucción exacta**

1. Eliminar renderEficienciaSection, computeEficienciaObras, renderRangoWidget, sus llamadas y CSS exclusivo.
2. Eliminar textos y estados vacíos que hablen de compases.
3. Revisar el estado diario: no afirmar que los sliders aparecen al iniciar cada sesión si ya se registran con tarjetas.
4. Si ARC-01 elimina sugerencias, quitar Prioridad por completo.
5. Si se conserva alguna agrupación descriptiva, impedir que la misma obra se repita en dos secciones contiguas.
6. Separar con nombres explícitos Solidez actual estimada y Media de últimas mediciones.
7. Mostrar fecha de última medición y efecto de decaimiento cuando sea relevante.

**Criterios de aceptación**

- No aparece la palabra compases en la UI activa.
- Ningún widget depende de compasHistory para obras nuevas.
- Una obra no se duplica en el mismo panel.
- Un 48 actual y un 65 histórico se explican sin parecer una contradicción.

**Pruebas mínimas**

- Cero obras, una obra y muchas obras.
- Obras nuevas sin compasHistory y antiguas con ese campo.
- Una y varias mediciones de solidez.
- Búsqueda final de llamadas a las funciones retiradas.

---

### TXT-01. Corregir textos con codificación rota

**Estado:** PENDIENTE
**Prioridad:** P1
**Tamaño:** S
**Tipo:** Texto y accesibilidad
**Dependencias:** Ninguna.

**Evidencia confirmada**

El código contiene al menos cinco textos españoles dañados: el título y placeholder de Diario, las opciones 3 días y Sólo datos, y dos guiones tipográficos en app.js. Parte se sobrescribe en ejecución, pero otras cadenas llegan al nombre accesible.

**Instrucción exacta**

1. Corregir todas las cadenas a UTF-8 válido.
2. Guardar HTML, CSS, JS y JSON como UTF-8.
3. Añadir una comprobación automatizada que falle ante los marcadores típicos U+00C3, U+00C2, U+00E2, U+00F0 o U+FFFD cuando aparezcan en una cadena destinada a la interfaz.
4. Revisar exportaciones e importaciones para conservar acentos.

**Criterios de aceptación**

- No existe mojibake en pantalla, árbol accesible, exportación ni código fuente.
- La búsqueda automatizada no produce falsos positivos conocidos.

**Pruebas mínimas**

- Diario, Ajustes y exportación.
- Importar y exportar nombres con tildes, ñ y símbolos musicales.

---

### PWA-01. Alinear manifiesto, caché y funcionamiento sin conexión

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** M
**Tipo:** PWA
**Dependencias:** QUA-01.

**Evidencia**

El tema por defecto es Mármol claro con fondo aproximado #f2f2f7, pero manifest.json declara theme_color y background_color oscuros. Esto puede producir un destello oscuro al iniciar e incoherencia en la barra del sistema. La misma imagen de 512 se marca any y maskable sin una variante diseñada con zona segura. APP_VERSION y la versión de caché del service worker se actualizan manualmente y pueden divergir.

**Instrucción exacta**

1. Alinear colores del manifiesto y meta theme-color con el tema inicial real.
2. Actualizar theme-color en ejecución al cambiar tema si el sistema lo admite.
3. Crear un icono maskable específico con zona segura; no etiquetar como maskable un icono que pueda recortarse.
4. Crear una comprobación que obligue a coordinar versión de app y nombre de caché cuando cambien recursos servidos.
5. Añadir smoke test offline: primera carga online, recarga offline y uso local.
6. Verificar update.html como ruta de recuperación.
7. Mantener Supabase como mejora de sincronización, no como requisito para abrir y registrar localmente.

**Criterios de aceptación**

- No hay destello de tema contrario al arrancar instalada.
- Iconos no se recortan en máscara circular o redondeada.
- Una versión nueva invalida recursos antiguos de forma predecible.
- La app abre, cronometra y guarda localmente sin red después de la primera carga.

**Pruebas mínimas**

- Instalación en Safari de iPad y navegador Chromium.
- Modo offline, actualización de versión y caché antigua.
- Tema claro y oscuro.

---

### TSK-01. Completar el ciclo de vida de las tareas

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** S
**Tipo:** Funcionalidad secundaria
**Dependencias:** ARC-01 debe confirmar que Tareas se conserva.

**Evidencia**

cronoTasks conserva tareas completadas indefinidamente, sólo representa las últimas cinco y no ofrece edición, borrado ni archivo. El aria-label sigue diciendo Marcar tarea cuando la tarea ya está completada.

**Instrucción exacta**

1. Añadir acciones para editar, borrar y reabrir.
2. Cambiar el nombre accesible entre Marcar como hecha y Reabrir.
3. Archivar completadas o purgarlas según una política explícita, sin crecimiento ilimitado.
4. Mostrar un acceso a completadas si se conservan.
5. Persistir cada acción inmediatamente.

**Criterios de aceptación**

- Una tarea puede corregirse y borrarse.
- El nombre accesible refleja el estado.
- La lista no crece sin límite ni oculta silenciosamente tareas activas.

**Pruebas mínimas**

- Más de cinco tareas activas y completadas.
- Editar, reabrir, borrar y recargar.

---

### ARC-02. Modularizar y retirar código muerto después de cubrirlo

**Estado:** PENDIENTE
**Prioridad:** P2
**Tamaño:** XL
**Tipo:** Mantenibilidad
**Dependencias:** QUA-01, ARC-01 y STA-01.

**Evidencia**

app.js reúne aproximadamente 903 funciones y 931 KB. Existen ramas y funciones legacy como renderObraCard_LEGACY, renderPases, renderPasajesGlobal, renderRangoWidget, cronoStartRest, cronoForcedFinish y cierres a modalSettings inexistente. El CSS acumula alrededor de 370 important. Esto eleva el riesgo de que una mejora visual afecte un flujo lejano.

**Instrucción exacta**

1. No hacer una reescritura total.
2. Retirar primero código muerto demostrado mediante búsquedas, cobertura y pruebas de navegador.
3. Separar progresivamente módulos por responsabilidad: storage y sync, timer state, study log, obras y solidez, calendario y vistas, modales y accesibilidad.
4. Mantener una API pequeña entre módulos y evitar nuevos globales.
5. Sustituir listeners inline por event delegation durante la extracción.
6. Consolidar tokens y media queries; eliminar important sólo cuando se entienda qué cascada sustituye.
7. Mantener compatibilidad con datos existentes en cada commit.
8. Hacer commits pequeños que dejen la app desplegable.

**Criterios de aceptación**

- Cada módulo tiene responsabilidad clara y pruebas de su lógica crítica.
- No quedan referencias a funciones retiradas.
- El arranque no depende del orden accidental de cientos de globales.
- Se reduce la necesidad de important y handlers inline sin alterar el diseño.
- Cada commit pasa smoke, unitarias y pruebas responsive.

**Pruebas mínimas**

- Suite completa de QUA-01 en cada extracción.
- Comparación de datos exportados antes y después.
- Snapshot de pantallas principales en las cuatro resoluciones.

## 6. Orden recomendado de ejecución

### Lote 1. Red de seguridad y pérdidas inmediatas

QUA-01 en versión mínima, CRN-01, CRN-03, SYN-02 y SEC-01.

Motivo: evita tiempos falsos, cierre con pérdida y contraseña expuesta antes de tocar estructuras grandes.

### Lote 2. Simplificación decidida

ARC-01 y STA-01.

Motivo: elimina una función que ya no se desea y reduce dependencias ocultas antes de seguir refinando la UI.

### Lote 3. Seguridad de contenido y sincronización

SEC-02, SYN-01 y DAT-01.

Motivo: requiere fixtures y migraciones; conviene ejecutarlo sobre un modelo ya simplificado.

### Lote 4. Cronómetro completo

CRN-02, CRN-04, CRN-05 y CRN-06.

Motivo: completa reglas, continuidad, cambios de obra y accesibilidad sobre la persistencia corregida.

### Lote 5. Navegación, iPad y accesibilidad

NAV-01, NAV-02, UI-01, ACC-01, ACC-02, ACC-03, UI-02, UI-03 y UI-04.

Motivo: primero corrige fallos reproducibles y después mejora la composición.

### Lote 6. Acabado y mantenimiento

TXT-01, PWA-01, TSK-01 y ARC-02.

## 7. Definición de terminado para cualquier lote

Un lote no está terminado hasta que:

- Los IDs implementados constan como IMPLEMENTADO en este archivo.
- Se han ejecutado sus pruebas mínimas.
- node --check app.js pasa si app.js sigue siendo un script único.
- No hay errores de consola en los recorridos modificados.
- No hay overflow horizontal a 390, 834, 1024 y 1280 px.
- Se ha probado al menos una vez con datos antiguos.
- La versión y caché se han actualizado si cambió la app servida.
- El diff no contiene cambios ajenos al lote.
- El commit está en main y el push a origin/main ha terminado correctamente.

## 8. Aspectos que ya están bien y deben preservarse

- La nueva composición del cronómetro se adapta razonablemente bien a iPad horizontal, iPad vertical y móvil.
- El estado de pausa es visualmente claro.
- El modal de Solidez cabe y mantiene buena jerarquía visual en iPad.
- La app abre sin errores de consola en el recorrido principal.
- El modo local permite usar gran parte de la app sin autenticación.
- No se detectaron IDs duplicados en ejecución.
- El tono visual sobrio, los tiempos grandes y la separación entre escenario y cajón del cronómetro son una base válida.

La implementación futura debe corregir los riesgos sin desmontar esos aciertos.
