# Deutsch · tarjetas y estudio libre

Entrada: **Hoy → Deutsch**, tarjeta compacta entre el resumen diario y Aulas. La portada de Deutsch está centrada en clases importadas y dos formas de estudiar: tarjetas con repaso espaciado y estudio libre. Los objetivos económicos y la hucha permanecen dentro de Deutsch; los hábitos diarios y sus trofeos pertenecen al cronómetro.

## Uso

1. Importa un JSON generado a partir del material de una clase o un CSV. Cada archivo se presenta como una clase o tema independiente. El prompt integrado pide tarjetas de vocabulario, expresiones, estructuras, preguntas y gramática; no se llama a ninguna API desde Deutsch.
2. Pulsa **Estudiar tarjetas** para combinar todas las clases o **Estudiar esta clase** para limitar la cola. Se muestran vencidas, hasta 10 nuevas y, cuando no queda ninguna pendiente, una tanda de repaso.
3. Da la vuelta a la tarjeta y elige **Otra vez**, **Difícil**, **Bien** o **Fácil**. La interfaz muestra el próximo intervalo. Espacio revela; las teclas 1–4 califican y P pausa o continúa.
4. Pulsa **Estudio libre** cuando trabajes con una ficha, una escucha, conversación o material externo. No crea tarjetas ni exige una cola, pero registra el tiempo y alimenta el mismo taxímetro.
5. Crea un objetivo con nombre e importe para que la hucha virtual asigne recompensa. Sin objetivo se conserva el tiempo, pero no se abona dinero retroactivamente.

Los ejercicios de paquetes anteriores siguen persistidos y una sesión antigua puede terminarse sin perder su cursor o borrador. La portada y las sesiones nuevas no los muestran ni los mezclan con las tarjetas.

En tarjetas, el cronómetro cuenta intervalos observados dentro de Deutsch y pausa al salir, ocultar la página, tras cinco minutos sin interacción o ante un salto del reloj de más de cinco segundos. En estudio libre, una vez iniciado explícitamente, sigue contando al trabajar en otra pestaña y no aplica la pausa por inactividad; sí se pausa al cambiar de sección dentro de la app, al cerrar la página, al pulsar Pausar o al terminar. Recargar recupera el último checkpoint **en pausa** y nunca añade el tiempo durante el que la app estuvo cerrada. Se guarda cada diez segundos, al cualificar el día y en cada acción relevante. Web Locks impide ejecutar dos sesiones simultáneas; navegadores antiguos usan un lease local renovable.

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

Con un único objetivo, la recompensa de alemán del día es `base(segundosDiarios) × scale × multiplier`. Menos de 900 segundos deja el importe pendiente y no mantiene la racha. A los 900 segundos se consolida todo el día. **El mínimo es diario**: dos sesiones de ocho minutos cualifican conjuntamente. La racha del propio día cualificado determina su bonus; una interrupción la reinicia.

El cronómetro de piano aporta al mismo objetivo con una curva separada y más conservadora. Solo se guarda al terminar una sesión válida de al menos 10 minutos; descansos y sesiones fallidas no generan saldo. La política v2 interpola linealmente dentro de cada tramo y aumenta su valor marginal cada media hora: 0,035 € a 0,5 h; 0,08 € a 1 h; 0,13 € a 1,5 h; 0,20 € a 2 h; 0,29 € a 2,5 h; 0,40 € a 3 h; 0,55 € a 3,5 h; 0,75 € a 4 h; 1,00 € a 4,5 h; 1,35 € a 5 h; 1,85 € a 5,5 h; 2,60 € a 6 h; 3,75 € a 6,5 h y 5,50 € a 7 h. Se aplica la misma escala sublineal del importe, sin bonus de racha, y 7 h es el máximo diario. Dividir el estudio en varias sesiones no reinicia la curva. Las sesiones guardan su versión de política: las creadas antes de v384 mantienen la curva anterior de 6 h.

El objetivo económico compartido se gestiona desde Deutsch o desde los accesos de la hucha en el cronómetro. Se puede editar su nombre y precio. Al eliminarlo desaparecen el objetivo y su saldo de la interfaz, mientras las sesiones canónicas se conservan internamente para no dañar el historial ni la sincronización.

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
  "exercises": []
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
| `piano-rewards.js` | Curva progresiva de piano, evidencia de sesiones y ledger combinado con el objetivo compartido |
| `german-session.js` | Estado propio y evidencia temporal por día; cierre idempotente |
| `german-srs.js` | SRS determinista, comparación literal y selección de cola |
| `german-import.js` | Validación atómica, CSV, normalización/hash, ejemplo y prompt |
| `german-study.js` | Navegación interna, UI, locks, checkpoints y guardado común |
| `german-study.css` | Estilos acotados a Deutsch, responsive y reducción de movimiento |

`db.germanStudy` y `db.pianoRewards` viven dentro del documento existente `user_data.data`, con copia local `alberto_piano_v2`. No hay escritor adicional ni tablas nuevas. **No requiere migración de Supabase**: el merge recursivo actual conserva estos campos y sus registros con ID. La prueba PostgreSQL ejecuta las migraciones de protección existentes en PGlite y verifica nuevas sesiones concurrentes y escrituras de clientes antiguos.

Colecciones: `materials` (tarjetas/ejercicios anidados e inmutables), `reviews` (observaciones con ID, tarjeta/ejercicio, sesión, respuesta/resultado y fecha), `sessions` (ID, dispositivo, objetivo, inicio/fin, estado, segmentos diarios, cola y cursor/borrador), `goals` (nombre, importe, política, creación/archivo), `ledger` (proyección persistida reconstruible).

Cada fila del ledger identifica `sessionId:day` y conserva `date`, `sessionId`, `goalId`, `duration`, `baseReward`, `goalScale`, `streakMultiplier`, `policyVersion`, `qualified`, `microEuros`, `finalReward`. **Las sesiones son la evidencia canónica**; la UI y los guardados reconstruyen el ledger después de cualquier merge para no sumar proyecciones antiguas calculadas offline. El saldo nunca se guarda como única fuente de verdad. Los registros se ordenan por día, inicio e ID, independientemente del orden del merge. Una sesión con `endedAt` no vuelve a aceptar tiempo.

La programación SRS se deriva de las revisiones ordenadas por instante e ID: contador de revisiones, última/próxima revisión, intervalo, ease y resultado. Again: 1 minuto y ease −0,2 (mínimo 1,3); Hard: mínimo 1 día o intervalo ×1,2 y ease −0,15; Good: 1 día inicial, luego intervalo ×ease redondeado; Easy: 4 días iniciales, luego intervalo ×ease ×1,3 y ease +0,15.

## PWA y verificación

Runtime v384: scripts y CSS de Deutsch y el taxímetro de piano cargados desde `index.html` y precacheados; `update-safety.js` bloquea promociones mientras haya sesión local abierta, incluso antes de cargar el addon. `update.html` también protege esa recuperación. Mantiene el lifecycle seguro y las versiones anteriores de assets no modificados.

Pruebas: `tests/unit/german-study.test.js`, nuevas regresiones en `document-postgres`, `update-safety-v2` y `service-worker-audit`; `tests/e2e/german-study.spec.js` cubre UI completa, importar/duplicados/XSS, umbral, recarga/borrador, locks, objetivos, móvil y PWA offline. Ejecutar `npm run check`, `npm run test:unit`, `npm run test:e2e` y `npm run test:visual`. El repositorio conserva una lista explícita de fallos E2E anteriores en `scripts/check-e2e-known-baseline.cjs`; no se deben confundir con regresiones de Deutsch.

Validación local del 2026-09-12: runtime **107 assets**; unit **431/431**; Deutsch E2E **8/8**; visual **4/4**. Batería E2E general: **129/144**, con 14 fallos incluidos en el baseline existente y un fallo de temporización en `professor-file-transfer` que pasó al repetir su spec aisladamente (**1/1**). No se han eliminado pruebas ni ampliado el baseline para ocultarlos. Tras el último ajuste del guardado de respuestas se repitieron las 80 unit de Deutsch/PostgreSQL/UpdateSafety y los 8 E2E de Deutsch, todos aprobados. La sincronización real de producción no se modificó ni se escribieron datos reales para estas pruebas.
