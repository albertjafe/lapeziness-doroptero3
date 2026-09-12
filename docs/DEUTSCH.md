# Deutsch · primera versión

Entrada: **Hoy → Deutsch**, tarjeta compacta entre el resumen diario y Aulas. La barra inferior y los datos pianísticos conservan sus funciones. Deutsch tiene Resumen, Materiales y una sesión de estudio propia.

## Uso

1. Crea un objetivo con nombre e importe. La hucha es virtual: no se mueve dinero.
2. En **Materiales → Crear material con IA**, copia el prompt y entrégalo a una IA junto con el PDF de tu profesora. No se llama a ninguna API desde Deutsch.
3. Importa el JSON obtenido. **Descargar JSON de ejemplo** proporciona un paquete válido que también puedes importar para probar el flujo.
4. Pulsa **Empezar estudio**. La cola prioriza tarjetas vencidas, hasta 10 nuevas y ejercicios pendientes; si no hay pendientes, ofrece repaso adicional. **Elegir modo** permite Tarjetas, Ejercicios o Material concreto.
5. Revela las tarjetas y valora Again / Hard / Good / Easy. En ejercicios cerrados se comparan respuestas literales normalizadas, sin evaluación semántica; el resultado se guarda al comprobar, aunque termines antes de pulsar Siguiente. `free_write` muestra un modelo y permite Correcto / Parcial / Incorrecto.

El cronómetro cuenta únicamente intervalos observados en primer plano dentro de la sesión de Deutsch. Pausa al salir, ocultar la página, tras cinco minutos sin interacción o ante un salto del reloj de más de cinco segundos. Cada interacción renueva la ventana de actividad. Recargar recupera el último checkpoint **en pausa**, incluida la tarjeta/ejercicio y su borrador. Se guarda cada diez segundos, al cualificar el día y en cada acción relevante. Un cierre abrupto del proceso puede perder hasta diez segundos; no añade las horas transcurridas con la app cerrada. Web Locks impide estudiar o finalizar desde dos pestañas simultáneas; navegadores antiguos usan un lease local renovable.

## Recompensas

Política central e inmutable `GermanRewards.CONFIG`, versión 1. Cada objetivo conserva una copia de esa política para futuras modificaciones.

`base(t)` interpola linealmente los puntos `(segundos, euros)`:

| Tiempo diario | Base |
|---|---:|
| 0 min | 0,00 € |
| 15 min | 1,00 € |
| 30 min | 1,25 € |
| 45 min | 1,55 € |
| 60 min o más | 2,00 € |

`scale = clamp((importe / 150)^0.45, 0.5, 15)`

`multiplier = 1 + min(0.25, floor(racha / 4) × 0.05)`

Con un único objetivo, la recompensa del día es `base(segundosDiarios) × scale × multiplier`. Menos de 900 segundos deja el importe pendiente y no mantiene la racha. A los 900 segundos se consolida todo el día. **El mínimo es diario**: dos sesiones de ocho minutos cualifican conjuntamente. La racha del propio día cualificado determina su bonus; una interrupción la reinicia.

Para repartir entre sesiones u objetivos se usa la diferencia `base(tDespués) − base(tAntes)` del tiempo **total diario**, con la escala del objetivo de cada sesión. Así terminar/reiniciar o cambiar de objetivo no reinicia el límite. El redondeo se hace por diferencia de acumulados en microeuros enteros, nunca añadiendo céntimos por frame. La hucha se limita al importe del objetivo: no se traslada sobrante a otro objetivo. Tiempo sin objetivo queda registrado, pero no se paga retroactivamente al crear uno.

Las fechas son días locales `YYYY-MM-DD`; los intervalos se dividen en medianoches calculadas con constructores de calendario. Los días ya registrados no se reinterpretan al viajar a otra zona horaria. SRS utiliza instantes absolutos para vencimientos, una semántica distinta de la racha.

Al completar, el dashboard muestra **Objetivo conseguido**, fecha y tiempo invertido. Termina la sesión, archiva y crea el siguiente objetivo. Materiales, revisiones y estudio permanecen. Dos creaciones offline concurrentes se ordenan por fecha/ID: solo la primera sin archivar se presenta como activa; la siguiente aparece cuando se archiva aquella.

## German Study Pack v1

Esquema formal: [`german-study-pack.v1.schema.json`](german-study-pack.v1.schema.json). El validador de runtime añade el límite combinado de 2.000 elementos, 2 MB de archivo, IDs originales únicos por colección y verificación de fechas reales. No hay inserciones parciales. El hash SHA-256 del contenido normalizado detecta reimportaciones con distinto espaciado u orden de propiedades. Modificar contenido o metadatos produce un paquete diferente; V1 no fusiona versiones editadas de una clase.

```json
{
  "schema": "german-study-pack.v1",
  "metadata": { "title": "Clase de septiembre", "teacher": "Regine" },
  "cards": [
    { "type": "de_es", "front": "der Bahnhof", "back": "la estación de tren", "tags": ["viajes"] },
    { "type": "cloze", "front": "Ich ___ am Bahnhof. (warten)", "back": "warte" }
  ],
  "exercises": [
    { "type": "conjugation", "prompt": "Conjuga warten con du.", "answer": "du wartest", "acceptedAnswers": ["wartest"] }
  ]
}
```

- `metadata`: `title` obligatorio; `date` (fecha real YYYY-MM-DD), `teacher`, `source`, `notes` opcionales.
- Tarjetas: `type` es `de_es`, `es_de`, `expression`, `grammar`, `question_answer` o `cloze`. `front` y `back` obligatorios; `hint`, `explanation`, `examples` (textos), `tags` (textos) opcionales. Cloze representa el hueco mediante `___` en `front`.
- Ejercicios: `type` es `fill_blank`, `translation`, `conjugation`, `short_answer` o `free_write`. `prompt` obligatorio; `answer` (texto) y/o `acceptedAnswers` (textos) obligatorios. En escritura libre constituyen el modelo. `hint`, `explanation`, `tags` opcionales.
- Cada elemento admite `id` original opcional. Se conserva como `sourceId`; los IDs internos se derivan del hash del paquete y posición.
- Listas opcionales: máximo 100 textos; cada texto hasta 10.000 caracteres. Siempre se incluyen `cards` y `exercises`, aunque una esté vacía. Campos de entrada desconocidos se ignoran en esta versión. El contenido se muestra como texto, nunca como HTML.

CSV admite UTF-8/BOM, coma o punto y coma, comillas escapadas y saltos de línea dentro de campos. Cabeceras mínimas `front,back`; opcionales `type,hint,explanation,tags,examples,id`. Tipo por defecto `de_es`; `tags` y `examples` se separan con `|`. Los CSV solo generan tarjetas.

## Arquitectura y persistencia

| Módulo | Responsabilidad |
|---|---|
| `german-rewards.js` | Política, días locales, rachas, ledger y progreso de objetivos; puro, CommonJS/browser |
| `german-session.js` | Estado propio y evidencia temporal por día; cierre idempotente |
| `german-srs.js` | SRS determinista, comparación literal y selección de cola |
| `german-import.js` | Validación atómica, CSV, normalización/hash, ejemplo y prompt |
| `german-study.js` | Navegación interna, UI, locks, checkpoints y guardado común |
| `german-study.css` | Estilos acotados a Deutsch, responsive y reducción de movimiento |

`db.germanStudy` vive dentro del documento existente `user_data.data`, con copia local `alberto_piano_v2`. No hay escritor adicional ni tablas nuevas. **No requiere migración de Supabase**: el merge recursivo actual conserva este campo y sus registros con ID. La prueba PostgreSQL ejecuta las migraciones de protección existentes en PGlite y verifica nuevas sesiones concurrentes y escrituras de clientes antiguos.

Colecciones: `materials` (tarjetas/ejercicios anidados e inmutables), `reviews` (observaciones con ID, tarjeta/ejercicio, sesión, respuesta/resultado y fecha), `sessions` (ID, dispositivo, objetivo, inicio/fin, estado, segmentos diarios, cola y cursor/borrador), `goals` (nombre, importe, política, creación/archivo), `ledger` (proyección persistida reconstruible).

Cada fila del ledger identifica `sessionId:day` y conserva `date`, `sessionId`, `goalId`, `duration`, `baseReward`, `goalScale`, `streakMultiplier`, `policyVersion`, `qualified`, `microEuros`, `finalReward`. **Las sesiones son la evidencia canónica**; la UI y los guardados reconstruyen el ledger después de cualquier merge para no sumar proyecciones antiguas calculadas offline. El saldo nunca se guarda como única fuente de verdad. Los registros se ordenan por día, inicio e ID, independientemente del orden del merge. Una sesión con `endedAt` no vuelve a aceptar tiempo.

La programación SRS se deriva de las revisiones ordenadas por instante e ID: contador de revisiones, última/próxima revisión, intervalo, ease y resultado. Again: 1 minuto y ease −0,2 (mínimo 1,3); Hard: mínimo 1 día o intervalo ×1,2 y ease −0,15; Good: 1 día inicial, luego intervalo ×ease redondeado; Easy: 4 días iniciales, luego intervalo ×ease ×1,3 y ease +0,15.

## PWA y verificación

Runtime v378: scripts y CSS de Deutsch cargados desde `index.html` y precacheados; `update-safety.js` bloquea promociones mientras haya sesión local abierta, incluso antes de cargar el addon. `update.html` también protege esa recuperación. Mantiene el lifecycle seguro y las versiones anteriores de assets no modificados.

Pruebas: `tests/unit/german-study.test.js`, nuevas regresiones en `document-postgres`, `update-safety-v2` y `service-worker-audit`; `tests/e2e/german-study.spec.js` cubre UI completa, importar/duplicados/XSS, umbral, recarga/borrador, locks, objetivos, móvil y PWA offline. Ejecutar `npm run check`, `npm run test:unit`, `npm run test:e2e` y `npm run test:visual`. El repositorio conserva una lista explícita de fallos E2E anteriores en `scripts/check-e2e-known-baseline.cjs`; no se deben confundir con regresiones de Deutsch.

Validación local del 2026-09-12: runtime **107 assets**; unit **431/431**; Deutsch E2E **8/8**; visual **4/4**. Batería E2E general: **129/144**, con 14 fallos incluidos en el baseline existente y un fallo de temporización en `professor-file-transfer` que pasó al repetir su spec aisladamente (**1/1**). No se han eliminado pruebas ni ampliado el baseline para ocultarlos. Tras el último ajuste del guardado de respuestas se repitieron las 80 unit de Deutsch/PostgreSQL/UpdateSafety y los 8 E2E de Deutsch, todos aprobados. La sincronización real de producción no se modificó ni se escribieron datos reales para estas pruebas.
