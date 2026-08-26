# Cronómetro más armónico + estimador personal de «tiempo hasta estar a punto»

STATUS: READY

## Goal

Implementar dos mejoras coordinadas, sin convertirlas en un rediseño general:

1. **Refinar visualmente el Cronómetro** para que los botones, jerarquías y disposiciones en reposo / marcha / pausa sean más limpios, centrados y coherentes. La composición actual en iPad y el reloj/anillo gustan al usuario y deben preservarse.
2. Crear una función importante y rigurosa de **estimación de tiempo neto de práctica restante hasta que una obra esté «a punto»**, usando el historial real y personal del usuario. La estimación debe aprender/calibrarse a partir de sus propios datos, ser conservadora ante datos escasos y mostrar incertidumbre en vez de falsa precisión.

«A punto» no debe significar simplemente que una medición aislada alcance 80. El objetivo base es **solidez ~80 estable**, con suficiente cobertura de la obra y evidencia de que ese nivel se sostiene razonablemente entre sesiones/pases.

La estimación principal que se muestre al usuario será **tiempo neto de práctica restante** (por ejemplo `≈ 5–7 h netas`), no una fecha artificialmente exacta. Si hay datos suficientes, se puede ofrecer como detalle secundario una conversión aproximada a días/semanas según el ritmo reciente de esa obra.

---

## Contexto real de datos ya auditado

La app dispone, entre otras cosas, de:

- `db.obras[]`: `id`, `name`, `composer`, `tipo`, `origen`, `dificultad`, `duracion`, `sol`, `esc`, `learningStage`, `currentZone`, `zoneHistory`, `compasActual`, `compasesTotal`, `movimientos`, `paseHistory`, `solHistory`, `escHistory`, `minutosExtra`.
- `db.sesiones[].items[]`: `obraId`, `movId`, `minutosReales` (y fallback antiguo `minutosEstudiados`), `startedAt`, `endedAt`, `solRating`, `rating`, `zona`, `zone`, etc.
- Hay 405 bloques de sesión actualmente; 37 tienen `solRating` no vacío, 160 tienen `rating`, 244 tienen zona y 176 están ligados a movimientos.
- Hay 35 obras no-actividad; ~12 tienen ya 6+ observaciones combinadas suficientes para calibración útil.
- `db.eventos`: resultados formales por obra con `sol`, `esc`, `obraScore`; hay 32 resultados de obra, 13 obras con resultado formal y 11 resultados formales con `sol >= 80`.
- El repertorio histórico reciente vive **separado** en `db.historicalRepertoire`; sus `estimatedHours` NO entran en gráficas/estadísticas. Al reactivar una obra se enlaza mediante `historicalSourceId` / `reactivatedObraId` y la obra activa nace con 0 horas reales.

Importante: algunos datos antiguos/importados no tienen timestamps finos. En particular, `minutosExtra` representa exposición acumulada histórica/importada, no una secuencia de sesiones. Puede ser útil como prior de familiaridad, pero **NO se puede usar como si fueran minutos entre dos checkpoints de solidez**.

---

## Parte A — Refinamiento visual conservador del Cronómetro

### Lo que hay que preservar

- El anillo/reloj y su protagonismo visual.
- La identidad Mármol y el aspecto actual que funciona bien en iPad.
- La obra seleccionada, la información de sesión, los Destellos, modos Libre/Temporizador, tareas/memoria/metrónomo/pases y todos los comportamientos actuales.
- Hold-to-stop, pausa/reanudación, auto-reanudación si existe, accesibilidad y targets táctiles.
- No reimaginar toda la pantalla ni mover elementos porque sí.

### Problemas actuales a resolver

- El Cronómetro ha acumulado varias generaciones de overrides CSS para los mismos selectores; tamaños/offsets cambian varias veces por breakpoint.
- `.crono-run-action-rail` tiene múltiples reglas de `right`, `top`, `--crono-action-size` y compensaciones según diámetro; esto funciona pero hace que la jerarquía visual sea menos limpia y difícil de mantener.
- `Iniciar`, los controles en marcha y los controles de pausa hablan lenguajes visuales parcialmente distintos.
- Cabecera: `Horas`, refrescar y cerrar no parecen una familia única de controles.
- En el drawer, `Tareas / Memoria / Metrónomo` son navegación, mientras `Pase +` es una acción; no deberían parecer exactamente la misma cosa.

### Dirección visual a implementar

Aplicar varios cambios de alta confianza, conservadores:

1. **Gramática única de botones del Cronómetro**
   - icon-only => controles circulares o casi circulares, geometría consistente;
   - CTA con texto (`Iniciar`, `Reanudar`) => rectángulo redondeado coherente;
   - selector de estado (`Libre / Temporizador`, tabs) => segmented control;
   - chips/pills => solo información, no acciones principales.
   - Mantener targets táctiles de al menos ~44 px donde proceda.

2. **Reposo / antes de iniciar**
   - Mantener selector de obra + reloj + modos + Iniciar, pero componerlos como una columna central claramente alineada con el centro geométrico del anillo.
   - `Libre / Temporizador`: ancho visual controlado y centrado (~280–300 px como referencia, responsive).
   - `Iniciar`: no debe sentirse como una barra arbitrariamente full-width en iPad; usar un ancho máximo armónico (~220–280 px de referencia), centrado y con el mismo radio/altura que el CTA principal de pausa.
   - Reducir ruido y saltos de espaciado; no reducir legibilidad.

3. **En marcha**
   - **Preservar en iPad la idea de rail lateral junto al anillo**, porque al usuario le gusta la composición actual. No sustituirla por un rediseño radical horizontal salvo que un breakpoint estrecho lo necesite para no desbordar.
   - Hacer Destello + control principal una familia coherente: tamaños, strokes, separación y estados visuales consistentes.
   - Destello puede conservar brillo/identidad, pero no competir más que el control primario de sesión.
   - Mantener el hold-to-stop exactamente; no convertirlo en un stop accidental de un toque.
   - Reducir reglas CSS duplicadas del rail a un sistema pequeño de tokens (`--crono-action-size`, `--crono-action-gap`, posición derivada del ring) y breakpoints claros. Solo consolidar CSS del Cronómetro; NO refactor global.

4. **Pausa / descanso**
   - Jerarquía centrada y evidente:
     - `DESCANSO`
     - tiempo de descanso grande
     - `Sesión pausada en …` secundario
     - `Reanudar` como CTA dominante
     - `Terminar sesión` secundario
     - `Añadir destello` terciario/discreto
   - `Reanudar` debe compartir gramática con `Iniciar`.
   - Mantener todas las semánticas actuales de pausa, finalización y temporizador.

5. **Cabecera del Cronómetro**
   - Unificar visualmente `Horas`, refrescar y cerrar en un único cluster derecho consistente en altura/tap target/stroke.
   - `Horas` puede conservar texto si mejora comprensión; no forzar icon-only si pierde claridad.
   - Respetar safe areas, Windows rail y iPad.

6. **Herramientas / drawer**
   - `Tareas`, `Memoria`, `Metrónomo` siguen siendo tabs/segmentos.
   - `Pase +` sigue haciendo exactamente lo mismo, pero visualmente debe leerse como **acción** y no como cuarta pestaña indistinguible. Puede ser un botón compacto separado en la misma zona.

7. **No cambiar por gusto lo que ya funciona**
   - Si una propuesta empeora iPad, no aplicarla.
   - Prioridad: armonía, alineación, menos ruido y menos CSS contradictorio, no “más diseño”.

---

## Parte B — Motor de «tiempo neto hasta estar a punto»

### Principio de producto

Mostrar una estimación del tipo:

- `A punto · ≈ 5–7 h netas`
- `Confianza media`

Y, al abrir detalle:

- estado efectivo actual;
- rango central estimado y, si tiene sentido, punto medio;
- nivel de confianza;
- evidencia utilizada (`4 pases`, `12 sesiones`, `último pase 76`, `obra recuperada`, `buen mantenimiento tras descansos`, etc.);
- opcional: `A tu ritmo reciente: ~X–Y días`, solo si el ritmo reciente de esa obra permite una conversión razonable.

No mostrar una cifra como `5 h 13 min` si la incertidumbre real es grande.

### Definición operativa de «a punto»

Target base: **80 de solidez**, pero de forma robusta.

Una obra se considera `ready/stable` cuando:

1. la cobertura de la obra está suficientemente completa (no hay un movimiento/parte claramente sin aprender que invalide el promedio), Y
2. la solidez efectiva está alrededor de `>=80`, Y
3. existe evidencia de estabilidad, preferentemente una de estas:
   - pase de obra completa o resultado formal >=80 reciente;
   - dos observaciones independientes >=80 en días distintos dentro de una ventana razonable;
   - un resultado >=80 seguido posteriormente por una medición todavía razonablemente alta después de varios días / tras un descanso.

No marcar como definitivamente “a punto” por una sola sesión de un pasaje o un único movimiento que dio 80.

Si la obra está >=80 pero la evidencia de estabilidad es insuficiente, la estimación debe pasar a un pequeño **tiempo de consolidación restante** en lugar de cero, y la confianza reflejarlo.

### Arquitectura recomendada

Crear un **core puro y testeable**, preferiblemente un archivo nuevo (`readiness-core.js` o nombre equivalente) UMD/CommonJS compatible con Vitest, similar a `data-core.js`.

Evitar meter cientos de líneas nuevas en `app.js`.

El core debe exponer algo equivalente a:

```js
estimateReadiness(db, obraId, options?) => {
  targetScore,
  rawScore,
  effectiveScore,
  coverage,
  pointEstimateMinutes,
  lowMinutes,
  highMinutes,
  confidence, // low | medium | high
  isReady,
  evidenceCount,
  calendarEstimate?,
  factors: [...],
  diagnostics: {...}
}
```

La predicción debe calcularse al vuelo desde `db`; **no persistir el resultado como nueva fuente de verdad** salvo que haya una razón técnica fuerte. Así se actualiza automáticamente al añadir sesiones/pases/eventos y evita conflictos de sincronización.

### Construcción del timeline de evidencia

Construir una línea temporal por obra (y por movimiento cuando corresponda) con:

#### A. Minutos reales de práctica
- `sesiones[].items[].minutosReales` como fuente principal.
- fallback antiguo `minutosEstudiados` solo si falta `minutosReales`.
- respetar `estudiado === false`.
- usar timestamps `endedAt` / `startedAt` / `session.date` con fallback seguro.
- NO contar actividades.

#### B. Checkpoints de solidez
1. `paseHistory`
   - `solidezPct` como señal fuerte;
   - tipo de pase (solo/informal/escena/etc.) modifica fiabilidad, no la escala;
   - obra completa pesa más para readiness global que pasaje/movimiento.

2. `solHistory`
   - `val`, `date`, `context`;
   - deduplicar cuando el mismo pase/evento ha generado también un punto en `solHistory` para no contar una acción dos veces.

3. `sesiones[].items[].solRating`
   - señal válida pero de peso menor que un pase formal;
   - distinguir obra completa, movimiento y pasaje mediante `movId`, `zona/zone`;
   - un `solRating=80` de un pasaje NO significa obra al 80.

4. `eventos[].resultado.obrasResultados[]`
   - `sol` es una evidencia de alta fiabilidad de comportamiento en contexto real;
   - `tipo` (`concierto`, `concurso`, `audicion`) puede subir confianza;
   - `obraScore` y `esc` pueden usarse como corroboración/volatilidad/escena, pero **no sustituir automáticamente a solidez**.

5. Estado de aprendizaje
   - `learningStage`, `currentZone`, `zoneHistory`.
   - `compasActual / compasesTotal` cuando existan.
   - movimientos y su propio estado/historial.

#### C. Exposición histórica / recuperación
- `minutosExtra`: usar únicamente como **prior de familiaridad acumulada**, con transformación/cap para que 500 h antiguas no anulen la predicción. No introducirlo en la velocidad temporal entre checkpoints porque no tiene timestamps fiables.
- `origen === 'recuperacion'`: señal fuerte de que la curva de reaprendizaje no es la de obra nueva.
- Si existe `historicalSourceId`, localizar `db.historicalRepertoire` correspondiente:
  - `estimatedHours`: prior débil/moderado, nunca “horas reales”;
  - `peakLevel`: una obra antes tocada en público/concurso debe tener mayor prior de recuperación que una solo leída;
  - `lastPlayedYear`, periodo aproximado: cuanto más antiguo, menor peso del prior;
  - bajar `confidence` cuando el modelo depende mucho de horas históricas estimadas.

### Obras con movimientos

No estimar una obra grande usando simplemente el mejor movimiento.

Para cada movimiento:
- obtener score reciente/efectivo y cobertura;
- usar `duracion` como peso si está disponible; si no, peso igual o razonable;
- aplicar **penalización de cuello de botella**: un movimiento claramente atrasado debe bajar el readiness global aunque el promedio simple sea alto;
- whole-work passes / eventos deben actuar como ancla de la estimación global.

Una solución razonable es media ponderada + penalización por dispersión / percentil bajo, no `max` ni promedio ingenuo.

### Descansos y retención

Este punto es importante.

1. Detectar gaps reales por obra usando fechas de estudio/checkpoints: por ejemplo >=7, >=14 y >=30 días.
2. Cuando existan mediciones antes y después de un gap, calcular cuánto cayó o se mantuvo la solidez.
3. Crear una **curva personal de retención** a partir del historial disponible:
   - primero de la misma obra si hay suficientes pares;
   - después de obras similares / global del usuario;
   - si no hay datos, fallback conservador pequeño, no una penalización extrema.
4. El score oficial (`obra.sol`) NO se modifica. El estimador puede usar internamente un `effectiveScore` corregido por antigüedad/retención.
5. Si una obra históricamente conserva muy bien el nivel tras 2–3 semanas, no penalizarla como otra que cae 20 puntos tras el mismo gap.

### Frecuencia y ritmo de estudio

Usar ventanas recientes (p.ej. 14/28/56 días, escoger con robustez) para calcular:
- minutos por semana dedicados a esa obra;
- sesiones/días activos;
- regularidad/espaciado;
- días desde último contacto.

Esto **no debe alterar mucho las horas netas necesarias** (que son esfuerzo), pero sí:
- ajustar ligeramente eficiencia si los datos personales muestran efecto de spacing;
- permitir convertir opcionalmente el rango neto a calendario: `a tu ritmo reciente, ~10–14 días`.

Si no hay ritmo reciente suficiente, omitir días/semanas en vez de inventarlos.

### Modelo de velocidad de aprendizaje: jerárquico y personal

No usar una fórmula fija universal si los datos propios permiten aprender algo.

1. Ordenar checkpoints válidos por obra.
2. Para intervalos entre checkpoints, sumar **solo minutos reales timestamped** ocurridos entre ellos.
3. Generar muestras de mejora, descartando/dando muy poco peso a intervalos absurdos o sin minutos suficientes.
4. Estimar `minutos por punto de solidez` en bandas, porque pasar 30→50 no cuesta lo mismo que 72→80. Bandas sugeridas:
   - 0–39
   - 40–59
   - 60–69
   - 70–79
5. Usar estadísticos robustos (mediana ponderada / trimmed values), no media sensible a outliers.
6. Jerarquía:
   - si la propia obra tiene >=3 intervalos útiles, usar su curva reciente pero **shrink** hacia el patrón global para no sobreajustar;
   - si no, usar obras análogas por dificultad, duración, nº movimientos, nueva/recuperación, stage;
   - fallback final: curva global del propio usuario.
7. Ajustadores pequeños y acotados, no multiplicadores salvajes:
   - dificultad;
   - duración / nº movimientos;
   - obra nueva vs recuperada;
   - cobertura actual;
   - retención tras descansos;
   - volatilidad de los últimos scores;
   - evidencia pública/formal.

### Incertidumbre y confianza

El rango es obligatorio.

Confidence sugerida:
- **high**: varias observaciones recientes de fuentes distintas, varios intervalos propios útiles, cobertura clara y poca contradicción.
- **medium**: datos personales razonables pero aún depende parcialmente del patrón global.
- **low**: obra nueva/recuperada sin checkpoints, datos antiguos sin timestamp, estimación dependiente de `minutosExtra`/histórico o mucha volatilidad.

El rango debe ensancharse cuando:
- hay pocos checkpoints;
- los scores son muy volátiles;
- faltan movimientos/coverage;
- hay gap largo sin observación posterior;
- depende de horas históricas aproximadas.

Nunca devolver `NaN`, negativos ni un rango invertido.

### Fallback para obras con pocos datos

Si no hay suficiente timeline propio:
- usar curva global personal + dificultad/duración/stage;
- `minutosExtra` / repertorio histórico solo como prior de familiaridad;
- devolver rango ancho y `confidence: low`.

Si prácticamente no hay ninguna señal actual de solidez/cobertura, mostrar algo equivalente a:
`Estimación inicial · confianza baja`
y no venderla como precisa.

---

## Presentación en el Cronómetro

### Ubicación

La estimación debe vivir en el Cronómetro sin robar protagonismo al reloj.

- **Idle:** al seleccionar una obra, mostrar una línea/chip compacto cerca del selector de obra / zona superior del reloj:
  - `A punto · ≈ 5–7 h netas`
  - subtítulo o estado de confianza muy discreto.
- **Running:** conservar una versión compacta que no interfiera con dígitos, ring ni rail lateral.
- **Paused:** no hace falta duplicarla si ensucia la pausa.

Tap/click abre un pequeño detalle, no una pantalla enorme.

### Recalibración

- Recalcular al seleccionar/cambiar obra.
- Recalcular después de guardar/finalizar una sesión, registrar un pase o actualizar datos relevantes.
- Durante una sesión activa **NO restar linealmente cada minuto del ETA como si todo minuto garantizara progreso**. Mantener el estimate base hasta disponer del resultado de la sesión; se puede mostrar el tiempo de sesión aparte como ya se hace.

### Copia sugerida

- `A punto · ≈ 5–7 h netas`
- `Confianza media`
- Detalle: `Basado en 12 sesiones, 4 pases y 1 concierto · último nivel 76 · buen mantenimiento tras 10 días`.

Evitar lenguaje de certeza tipo `Te faltan exactamente 5 h 12 min`.

---

## Implementación por paquetes sugeridos

El dispatcher puede dividir en 2–4 paquetes, secuenciales:

1. **Readiness core + tests unitarios**
   - colector de timelines, dedupe, cobertura/movimientos, retención, aprendizaje, rango/confianza.
   - tests sintéticos fuertes.

2. **Integración con datos reales de la app**
   - historicalSourceId/historicalRepertoire, eventos, pases, sesiones, movimientos, refresh hooks.
   - minimizar cambios en `app.js`; preferir módulo nuevo y puntos de integración pequeños.

3. **Cronómetro UI + refinamiento visual**
   - estimate chip/detail + cambios conservadores de botones/layout/CSS.

4. **Integración final / visual / regresiones**
   - Sol debe revisar que la feature compleja no rompe cronómetro, sync, datos ni estadísticas.

No fragmentar más si no aporta valor.

---

## Tests mínimos obligatorios

### Unit — estimator

Crear tests que prueben al menos:

1. Una actividad devuelve `null`/no estimate.
2. `estimatedHistoricalHours` y `minutosExtra` **nunca** se cuentan como minutos reales entre checkpoints.
3. Una obra recuperada con historial previo puede necesitar menos tiempo que una nueva equivalente, pero nunca cae artificialmente a 0 solo por muchas horas estimadas.
4. Un gap largo aumenta incertidumbre/remaining time frente a la misma observación fresca cuando no hay evidencia de retención.
5. Si esa misma obra tiene evidencia repetida de buena retención tras gaps, la penalización baja.
6. Un único `solRating=80` de un pasaje/movimiento NO marca toda la obra como ready.
7. Dos/varias evidencias robustas >=80 sí pueden marcar stable-ready.
8. Un resultado de concierto/concurso >=80 aumenta confianza.
9. Un movimiento débil impide que una obra multi-movimiento aparezca ready aunque otros estén altos.
10. Dedupe: pase + `solHistory` generado por la misma acción no se cuenta doble.
11. Sparse data => intervalo ancho + low confidence, sin NaN.
12. Current score >=80 pero sin estabilidad => pequeño consolidation ETA, no necesariamente cero.
13. Orden/rangos siempre válidos (`0 <= low <= point <= high`).
14. El cálculo no muta `db`.

### Regression / behavior

- `npm run check`
- `npm run test:unit`
- `npm run test:e2e`
- `npm run test:visual`

### Visual matrix del Cronómetro

Comprobar explícitamente:

- 390×844 móvil
- 834×1194 iPad portrait
- 1194×834 o equivalente iPad landscape
- 1280×720 desktop

Estados:
- idle sin obra / con obra
- Libre / Temporizador
- running
- paused
- estimate con texto corto/largo
- confidence low/medium/high

Criterios:
- ring sigue geométricamente centrado;
- no overflow horizontal;
- rail no pisa ring/dígitos/texto;
- estimate no desplaza el reloj de forma fea;
- botones coherentes y targets táctiles correctos;
- hold-to-stop sigue funcionando;
- pause/resume/finish siguen funcionando;
- estilos Mármol claros y night; no romper otros temas accidentalmente.

---

## Acceptance criteria

- [ ] El Cronómetro se siente más limpio y coherente, pero sigue siendo reconociblemente la misma pantalla que al usuario le gusta en iPad.
- [ ] Reposo, marcha y pausa comparten una jerarquía clara de botones.
- [ ] `Pase +` se distingue visualmente de tabs sin cambiar función.
- [ ] Se han reducido overrides contradictorios del Cronómetro sin refactor global de `styles.css`.
- [ ] Existe un core de estimación testeable y mayormente separado de `app.js`.
- [ ] La estimación usa minutos reales, sesiones, passes, `solHistory`, `solRating`, eventos, stage/coverage, movimientos, gaps/retención, dificultad/duración y recuperación cuando estén disponibles.
- [ ] `minutosExtra` y horas históricas estimadas solo son priors; no contaminan estadísticas ni velocidad temporal.
- [ ] Obras reactivadas pueden aprovechar `historicalSourceId` / repertorio histórico como prior.
- [ ] Multi-movement works tienen penalización de weak link/coverage.
- [ ] El resultado principal es un **rango de horas netas** + confianza, no una cifra falsa exacta.
- [ ] Opcionalmente se muestra ETA calendario solo si el ritmo reciente lo soporta.
- [ ] El estimate aparece de forma discreta en Cronómetro idle/running y tiene detalle explicable.
- [ ] No se descuenta el ETA minuto a minuto durante una sesión sin evidencia de resultado.
- [ ] Tests unitarios, e2e y visuales relevantes pasan.
- [ ] No se modifica Supabase directamente ni se migran datos del usuario para esta tarea; todo debe funcionar sobre el JSON existente.

---

## Explicit non-goals

- No entrenar un modelo externo ni enviar datos pianísticos a un servicio nuevo.
- No usar LLM/API en runtime para calcular el ETA.
- No convertir horas históricas estimadas en horas reales ni meterlas en gráficas.
- No rediseñar toda la app.
- No cambiar la definición oficial ni los datos almacenados de `sol` solo para hacer encajar la predicción.
- No alterar sync salvo hooks mínimos necesarios; el estimate debe ser derivado, no una segunda fuente de verdad.
- No hacer refactor global de `app.js`/`styles.css`.
- No añadir dependencias salvo necesidad excepcional y justificada.

---

## Compatibility / safety constraints

- `app.js` es muy grande: localizar funciones por `rg`/símbolos; NO releerlo entero.
- `historical-repertoire.js` y `DataCore.mergeHistoricalRepertoire` deben existir en el checkout actual. Si no existen, el checkout local está desactualizado respecto a `origin/main`: no reimplementar esa feature desde cero; informar claramente que hace falta actualizar el checkout antes de continuar.
- Preservar IDs, sesiones, passes y datos existentes.
- No commit/push automático del resultado funcional.
- No reset/rebase/destructive git.
- Mantener la estimación determinista y explicable.

## Final Sol review

Usar **Sol medium una sola vez al final**, como está diseñado el bridge. Debe revisar especialmente:

1. sesgos/errores conceptuales del estimator;
2. data leakage (`minutosExtra` o histórico usados como si fueran timestamps);
3. doble conteo entre pases / solHistory / sesiones / eventos;
4. obras con movimientos y weak-link;
5. gaps/retención;
6. confidence/ranges razonables en sparse data;
7. integración visual en iPad, sin destruir la composición actual;
8. regresiones de pausa/hold-to-stop/sync/estadísticas.
