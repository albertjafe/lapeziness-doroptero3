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

El cronómetro de piano aporta al mismo objetivo con una curva separada y más conservadora. Solo se guarda al terminar una sesión válida de al menos 10 minutos; descansos y sesiones fallidas no generan saldo. La **política v3** interpola linealmente dentro de cada tramo y adelanta parte de la recompensa hacia la jornada normal de 4–5 h sin cambiar el techo de 7 h:

| Piano acumulado en el día | Base v3 |
|---:|---:|
| 0 h | 0,00 € |
| 0,5 h | 0,05 € |
| 1 h | 0,11 € |
| 1,5 h | 0,18 € |
| 2 h | 0,27 € |
| 2,5 h | 0,38 € |
| 3 h | 0,53 € |
| 3,5 h | 0,75 € |
| **4 h** | **1,05 €** |
| 4,5 h | 1,43 € |
| 5 h | 1,93 € |
| 5,5 h | 2,58 € |
| 6 h | 3,38 € |
| 6,5 h | 4,38 € |
| **7 h o más** | **5,50 €** |

Los incrementos marginales de cada media hora siguen creciendo, de modo que una jornada larga continúa teniendo un premio extraordinario, pero llegar a 4 h ya mueve la hucha de forma visible. Se aplica la misma escala sublineal del importe del objetivo y dividir el estudio en varias sesiones no reinicia la curva diaria.

### Racha pianística de día completo

**4 h netas o más = día completo.** Los días completos consecutivos de estudio generan un multiplicador propio de piano:

| Racha de días completos | Multiplicador |
|---:|---:|
| 1–2 | ×1,00 |
| 3–4 | ×1,05 |
| 5–6 | ×1,10 |
| 7–9 | ×1,15 |
| 10–13 | ×1,20 |
| 14+ | **×1,25** |

Al alcanzar las 4 h, el multiplicador correspondiente se aplica a **toda la recompensa pianística de ese día**, no solo al tiempo posterior a las 4 h. Por eso el ledger se reconstruye desde las sesiones canónicas y una jornada puede subir de valor al cruzar el umbral durante una sesión en curso.

Un **día sin estudio pianístico registrado** se considera descanso: no incrementa la racha, pero tampoco la rompe. El siguiente día completo continúa desde donde se quedó. En cambio, un día en el que sí hay estudio pianístico registrado pero el total queda por debajo de 4 h rompe la racha; el siguiente día completo vuelve a 1. Esto evita que el sistema castigue el descanso deliberado y, al mismo tiempo, reserva el bonus para la constancia en jornadas completas.

Las sesiones guardan la versión de política con la que nacieron. Las anteriores a v384 mantienen la política v1 de 6 h; las de v384 mantienen la curva v2 de 7 h y **no reciben retroactivamente la nueva bonificación de racha**. Las sesiones nuevas de v385 usan v3. La evidencia histórica de días completos sí puede servir para determinar cuántos días completos llevas encadenados al llegar a v3, sin reescribir el dinero que ya ganaste con políticas anteriores.

El objetivo económico compartido se gestiona desde Deutsch o desde los accesos de la hucha en el cronómetro. Se puede editar su nombre y precio. Al eliminarlo desaparecen el objetivo y su saldo de la interfaz, mientras las sesiones canónicas se conservan internamente para no dañar el historial ni la sincronización.

Para repartir entre sesiones u objetivos se usa la diferencia `base(tDespués) − base(tAntes)` del tiempo **total diario**, con la escala del objetivo de cada sesión y, para piano v3 en un día completo, el multiplicador de racha de ese día. Así terminar/reiniciar o cambiar de objetivo no reinicia el límite. El redondeo se hace por diferencia de acumulados en microeuros enteros, nunca añadiendo céntimos por frame. La hucha se limita al importe del objetivo: no se traslada sobrante a otro objetivo. Tiempo sin objetivo queda registrado, pero no se paga retroactivamente al crear uno.

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
    { "type": "cloze", "front": "Ich ___ am Bahnhof. (warten)", "back": "warte", "tags": ["verbos"] }
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
| `piano-rewards.js` | Curva progresiva de piano, racha de días completos, evidencia de sesiones y ledger combinado con el objetivo compartido |
| `german-session.js` | Estado propio y evidencia temporal por día; cierre idempotente |
| `german-srs.js` | SRS determinista, comparación literal y selección de cola |
| `german-import.js` | Validación atómica, CSV, normalización/hash, ejemplo y prompt |
| `german-study.js` | Navegación interna, UI, locks, checkpoints y guardado común |
| `german-study.css` | Estilos acotados a Deutsch, responsive y reducción de movimiento |

`db.germanStudy` y `db.pianoRewards` viven dentro del documento existente `user_data.data`, con copia local `alberto_piano_v2`. No hay escritor adicional ni tablas nuevas. **No requiere migración de Supabase**: el merge recursivo actual conserva estos campos y sus registros con ID. La prueba PostgreSQL ejecuta las migraciones de protección existentes en PGlite y verifica nuevas sesiones concurrentes y escrituras de clientes antiguos.

Colecciones: `materials` (tarjetas/ejercicios anidados e inmutables), `reviews` (observaciones con ID, tarjeta/ejercicio, sesión, respuesta/resultado y fecha), `sessions` (ID, dispositivo, objetivo, inicio/fin, estado, segmentos diarios, cola y cursor/borrador), `goals` (nombre, importe, política, creación/archivo), `ledger` (proyección persistida reconstruible).

Cada fila del ledger identifica `sessionId:day` y conserva `date`, `sessionId`, `goalId`, `duration`, `baseReward`, `goalScale`, `streakDays`, `streakMultiplier`, `fullDay`, `policyVersion`, `qualified`, `microEuros`, `finalReward`. **Las sesiones son la evidencia canónica**; la UI y los guardados reconstruyen el ledger después de cualquier merge para no sumar proyecciones antiguas calculadas offline. El saldo nunca se guarda como única fuente de verdad. Los registros se ordenan por día, inicio e ID, independientemente del orden del merge. Una sesión con `endedAt` no vuelve a aceptar tiempo.

La programación SRS se deriva de las revisiones ordenadas por instante e ID: contador de revisiones, última/próxima revisión, intervalo, ease y resultado. Again: 1 minuto y ease −0,2 (mínimo 1,3); Hard: mínimo 1 día o intervalo ×1,2 y ease −0,15; Good: 1 día inicial, luego intervalo ×ease redondeado; Easy: 4 días iniciales, luego intervalo ×ease ×1,3 y ease +0,15.

## PWA y verificación

Runtime v385: scripts y CSS de Deutsch y el taxímetro de piano cargados desde `index.html` y precacheados; `update-safety.js` bloquea promociones mientras haya sesión local abierta, incluso antes de cargar el addon. `update.html` también protege esa recuperación. Mantiene el lifecycle seguro y las versiones anteriores de assets no modificados.

Pruebas: `tests/unit/german-study.test.js`, `tests/unit/piano-rewards.test.js`, regresiones en `document-postgres`, `update-safety-v2` y `service-worker-audit`; `tests/e2e/german-study.spec.js` y `tests/e2e/piano-rewards.spec.js` cubren la UI y el taxímetro. Ejecutar `npm run check`, `npm run test:unit`, `npm run test:e2e` y `npm run test:visual`. El repositorio conserva una lista explícita de fallos E2E anteriores en `scripts/check-e2e-known-baseline.cjs`; no se deben confundir con regresiones nuevas.

La validación histórica del runtime v384 permanece documentada en el historial del repositorio. Para v385, las pruebas nuevas fijan específicamente la curva v3, la compatibilidad v1/v2, la racha de 4 h, la congelación por descanso, el reinicio por día incompleto y el salto retroactivo del día al cruzar las 4 h.
