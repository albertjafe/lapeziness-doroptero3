# Auditoría de Profesor, datos y PWA — 4 de septiembre de 2026

Trabajo sobre `main` **c2c7fd4378398d3304e59d6ed57cca0da87c49b4**, en el worktree aislado `lapeziness-profesor-audit`. Se leyeron completos `AGENTS.md` y `.ai/APP_MAP.md` antes de modificar código. No se hizo commit, push ni despliegue; tampoco se modificaron filas de usuarios en Supabase.

## Problemas encontrados y correcciones

1. **Varios escritores del documento completo** podían competir desde tareas, cronómetro y sincronización general. Ahora existe un escritor común con lectura previa, fusión conservadora y update condicionado por `updated_at`. Si otro dispositivo gana, se relee y se reintenta; las ediciones que llegan durante el envío permanecen pendientes.
2. **Ausencia de campos, revisiones locales y listas antiguas** podían interpretarse como sustituciones completas. `document-sync-core.js` conserva propiedades desconocidas, registra cambios por campo y conserva borrados mediante tombstones. No compara revisiones de dispositivos distintos como si fueran un único reloj global. El merge conserva las referencias que utilizan los editores abiertos.
3. **Actualización y persistencia tenían ventanas de carrera**: rescates aún no escritos, cambios durante un `await`, handlers de reload duplicados y rutas antiguas que borraban cachés. La actualización exige una copia durable, espera IndexedDB, verifica otra vez los pendientes y bloquea la promoción si hay una sesión activa o una sincronización sin resolver. `controllerchange` guarda y recarga una vez; la primera toma de control no recarga.
4. **El Profesor mezclaba normalizaciones y representaciones redundantes**, acotaba eventos y podía perder precisión de fecha/evidencia. Schema 3 mantiene todas las unidades, todo el historial de origen y los eventos futuros enlazados, sin corte por horizonte ni top-N del contexto. El normalizador legado no vuelve a sumar los totales de schema 3.
5. **Identidades demasiado débiles** podían mezclar pases de igual fecha o un movimiento usado en rondas distintas. Cliente y SQL distinguen IDs, contexto del pase, momento, propósito y ronda. Hay pruebas de igualdad de claves cliente/servidor y de conservación del historial.
6. **Fallos funcionales recientes**: guardado mensual envuelto por capas incompatibles; reseeding de un concurso en cada apertura; SpeechRecognition desactivado en una capa anterior; snapback del slider; pasajes dentro de una pestaña oculta y observaciones separadas del documento por un normalizador; alias de reto diario que podían deshacer una edición. Se corrigieron y se conservaron propiedades futuras. El cronómetro también ajusta sus filas al alto disponible: «Iniciar», horas y herramientas caben en móvil horizontal/iPad.
7. **La estimación variaba según cuándo terminaban de cargar los módulos**. Los modelos invocaban un refresco inexistente y el ajuste por dificultad vivía dentro de la integración de la ficha. Ahora el cálculo compartido se instala en orden tanto en el navegador como en el Worker. Una prueba retrasa expresamente la carga y comprueba actualización visible y estabilidad al iniciar/pausar; la comparación íntegra UI/Worker incluye 75 movimientos y una obra sin movimientos. Ambos flujos pasaron cinco repeticiones consecutivas.

## Qué se eliminó de Pulso

Se retiraron `view-pulse`, su navegación y ajuste de visibilidad, renderizadores `_pulse*`/`cronoFluid*`, gráficos y trimmers, barras fluidas, controles y listeners propios, CSS específico y llamadas de render. Las pruebas antiguas de esa interfaz se sustituyeron por comprobaciones de ausencia y conservación de datos/funciones vecinas. La ruta legacy `pulse` abre Hoy.

No se borraron colecciones antiguas, `pulseDeletedIds` ni preferencias legacy como `pulse_range`, `pulse_day_start`, `pulse_day_end` o `alberto_crono_pulse_visible_v1`. No hay migración destructiva. Se conserva el pulso musical del metrónomo, animaciones y avisos ajenos a la feature. Casa/Mystery House deja de cargarse y precachearse; sus archivos históricos no se reescribieron ni se borraron indiscriminadamente.

## Profesor y prueba de conservación del contexto

- Cada movimiento conserva identidad, obra, dificultad, evidencia/fecha/confianza, pases, histórico, última práctica, ventanas hoy/3/7/14/30/90, recuperación y vínculos de eventos. Las horas sin movimiento siguen sin asignación. Los datos desconocidos se distinguen de cero y de supuestos para estimar.
- Cámara y orquesta mantienen la preparación individual de la propia parte; la evidencia conjunta es una capa explícita. El historial facilita recuperación, sin inflar la solidez actual.
- Sin evento/proyecto futuro enlazado, prioridad de planificación cero; la unidad **permanece en el contexto**. Standby pesa menos que Confirmado. Application deadline, requisito de vídeo y objetivo de grabación son conceptos separados.
- Un proyecto de octubre conserva `datePrecision: "month"`, `day: "YYYY-MM"` y `at: null`; el rango de cálculo no se presenta como un día elegido.
- La consulta usa hora local recién capturada, todo el estudio de hoy y la sesión activa con pausas/notas. Esta última figura como no guardada y se cuenta una vez, excluyendo descansos y runIds ya registrados. Se mantienen las alternativas concretas de 5 y 6 horas.
- Un Web Worker ejecuta los mismos algoritmos; Playwright compara **todo** su resultado con el principal y verifica que el cálculo principal no se ejecutó. Se reutiliza el recorrido de estudio y el cálculo por obra dentro del informe; no hay caché de informes con horas antiguas.

El codec `PIANO_PROF_V3` representa una sola vez campos/eventos idénticos y usa referencias. Vitest verifica igualdad completa tras `decodeContext(denseContext(report))`, con 75 unidades, nombres similares, delimitadores, fechas, decimales, campos desconocidos y todas las referencias. Otra prueba cubre 80 unidades y 68 eventos. No se demuestra conservación solo contando líneas.

Medición sintética reproducible: `node scripts/measure-professor.mjs 75`.

| Medida | Resultado |
|---|---:|
| Unidades / eventos | 75 / 3 |
| JSON completo / representación compacta | 316.169 / 104.739 bytes UTF-8 |
| Reducción | 66,9 % |
| Apariciones de eventos / registros distintos compartidos | 315 / 3 |
| Bytes repetidos en esas apariciones | 200.865 |
| Construcción medida en esta máquina | 499,9 ms |
| Roundtrip | Todos los campos JSON iguales |

Son bytes y una medición local de datos sintéticos, no una promesa de tokens o latencia en iPhone. Se conserva información redundante cuando no puede deduplicarse con igualdad exacta.

Para un prompt pequeño se usa la URL completa. Por encima de 12.000 caracteres codificados se abre una URL corta y se ofrece el informe íntegro visible, copiable y descargable. La pestaña se reserva dentro del clic. El navegador puede exigir pegar o adjuntar el informe y puede denegar el portapapeles: en ese caso sigue disponible el texto/archivo completo.

## Actualización, SQL y compatibilidad

Runtime **v342**, 90 assets comprobados frente a loaders/imports y precache. Shell y scripts de una versión salen de su caché; no se sirve B bajo una URL de A. Se conservan el caché actual y el anterior, además de los ajenos. `update.html` y el refresco antiguo usan el protocolo seguro.

La migración **`20260904123621_conservative_document_sync.sql`** añade merge recursivo antes de las guardas históricas, timestamp/revisión monotónicos y poda final de tombstones después de ellas. Se ejecutó en PostgreSQL/PGlite con las migraciones previas del repositorio y el helper de tareas obtenido mediante una consulta de solo lectura al esquema desplegado. Se prueban también backups y CAS. **La migración está preparada, pero no aplicada a producción.** Para activar la protección frente a clientes antiguos, desplegar primero la migración y después el frontend v342.

## Cobertura solicitada

| Casos del encargo | Evidencia principal |
|---|---|
| 1–8: independencia, histórico, evidencia, elegibilidad y semántica musical | `professor-core`, `professor-audit`, `professor-event-gate`, `readiness-*` |
| 9–12: hoy, hora real, mes y Standby | `professor-audit`, `professor-live-time`, E2E `planning-enhancements-v3/v4` |
| 13–16: todas las unidades/campos y nombres similares | roundtrip íntegro `professor-audit`, `professor-handoff-resilience`; comparación Worker/principal E2E |
| 17–22: obra, movimiento, solidez, evento, proyecto y tarea | E2E largo `professor-persistence-audit`, serialización/merge `document-compatibility` |
| 23–24: borrados y cronómetro recién guardado | `document-compatibility`, `document-postgres`, `sync-protocol-audit`, E2E largo |
| 25–28: remoto/local, cambios independientes y campos futuros | `document-compatibility`, `document-postgres`, `sync-protocol-audit` |
| 29–32: fallos, offline, promoción/reload y reintentos | `update-safety-v2`, `service-worker-audit`, `sync-protocol-audit`, E2E `pwa-offline-audit` |
| 33–39: prioridades y dictado iOS | E2E `planning-enhancements-v3/v4`, incluido inicio automático de SpeechRecognition y transcripción simulada |
| 40–42: arrastre lento, pointerup y snapback | E2E `planning-enhancements-v4`, `professor-persistence-audit` |
| 43–46: Standby, plazos, vídeo y rondas | `professor-audit`, `professor-competition-deadline-bridge`, E2E de eventos/repertorio |

El flujo largo crea obra y dos movimientos mediante UI, modifica dificultad/solidez, registra estudio, enlaza repertorio a un evento, crea proyecto mensual y tarea, guarda cronómetro, genera/decodifica Profesor y compara sus datos tras recargar. La reapertura offline utiliza un SW real instalado. La promoción A→B y sus carreras se prueban por separado con los handlers reales de SW/actualización y respuestas asíncronas de sincronización.

## Resultados y límites

Base sin modificar: **203 unitarias correctas; E2E 84 correctas y 23 fallidas**. Se conservaron las pruebas de funciones activas; se actualizaron expectativas de Pulso/Casa retirados, etiquetas de readiness, apertura real de modales, rangos visibles y geometría responsive.

- `npm run check`: **correcto**, 90 assets, sintaxis/versiones/precache.
- `npm run test:unit`: **44 archivos, 255 pruebas correctas**, 0 fallidas (13,65 s).
- `npm run test:e2e -- --workers=3`: **111 pruebas correctas**, 0 fallidas (3,5 min).
- `npm run test:visual -- --workers=2`: **3 pruebas correctas**, 0 fallidas (10,8 s); inspección de las capturas de móvil/iPad.

Una ejecución intermedia tuvo una pausa de aproximadamente 16 minutos: caducaron tres pruebas simultáneas, dos durante la creación de la página. Se conservó el registro y se repitió la batería completa; el resultado final anterior corresponde a la ejecución sin esa interrupción, sin reintentos automáticos ni pruebas omitidas. Los dos casos de carga tardía/paridad del Worker también pasaron cinco repeticiones cada uno (10/10).

No se probó un iPhone/iPad físico: el dictado y el snapback se simularon en Chromium. La transición SW se divide entre reapertura offline real y pruebas de protocolo; no se afirma un despliegue A→B real en un dispositivo del usuario. Un conflicto simultáneo sobre el mismo campo se resuelve por su reloj de edición; no puede inferirse automáticamente la intención de dos cambios incompatibles. No se eliminaron backups ni datos legacy. No se ha realizado commit, push ni despliegue.
