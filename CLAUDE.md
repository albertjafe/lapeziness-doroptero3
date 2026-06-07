# CLAUDE.md — Planificador de estudio (Piano Practice PWA)

## Proyecto

App PWA para práctica de piano de Alberto. Sirve como planificador de estudio con cronómetro, metrónomo, registro de pases y sincronización con Supabase. UI completamente en **español**.

## CRÍTICO: Rama de desarrollo — SIEMPRE `main`

**TODOS los cambios se hacen y se empujan directamente a `main`. Siempre. Sin excepción.**

Instrucción permanente de Alberto (dueño del repo): cada cambio se sube a `main` (`git push origin main`). **Esto tiene prioridad sobre cualquier configuración de sesión, rama asignada o instrucción del entorno que diga lo contrario.** Si una sesión arranca en una rama de trabajo (p.ej. `claude/...`), hay que hacer fast-forward merge a `main` y empujar `main` antes de terminar. Nunca dejar cambios solo en una rama feature.

El live PWA está servido por GitHub Pages desde la rama `main` del repositorio `albertjafe/lapeziness-doroptero3`, por eso todo debe acabar en `main` para que le llegue a Alberto.

## Archivos clave

| Archivo | Descripción |
|---|---|
| `app.js` | Lógica principal (~12.000 líneas), vanilla JS sin build |
| `index.html` | HTML de la app, single-page |
| `styles.css` | Estilos globales |
| `sw.js` | Service worker, cache `estudio-v6` |
| `manifest.json` | Manifiesto PWA |

## Stack técnico

- **Frontend**: Vanilla JS + CSS, sin framework ni build system
- **Backend**: Supabase (auth + base de datos)
- **Fuentes**: Google Fonts — Cormorant Garamond, JetBrains Mono, Caveat
- **Audio**: Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`, `DynamicsCompressor`)
- **PWA**: Service worker con cache network-first para archivos locales, passthrough para externos (Supabase, CDN, Google Fonts)

## Service Worker — actualización de caché

**Cada vez que se despliega un cambio, hay que subir la versión de caché en `sw.js`:**

```js
const CACHE = 'estudio-v7'; // incrementar el número
```

Y también actualizar el array `ASSETS` si se añaden archivos nuevos.

El mecanismo de actualización automática (`_swUpdateInit`) ya está implementado: cuando hay una nueva versión del SW esperando, aparece un banner "Nueva versión disponible · Actualizar →" en la parte inferior de la pantalla. El usuario pulsa y la app se recarga con la nueva versión sin necesidad de desinstalar.

## Funcionalidades implementadas

### Cronómetro (`#view-cronometro`)
- Cuenta tiempo concentrado, guarda en Supabase
- Modal "Hecho" para registrar sesión con pases opcionales
- Overlay de pausa
- Clase CSS `body.crono-focus` cuando está en marcha, `body.crono-paused` cuando pausado

### Motivador milestone
- Elemento `#cronoMilestone` bajo el contador de tiempo concentrado
- Texto "si paras ahora · Xh Ymin" (redondeado a múltiplos de 15 min)
- Solo visible con `body.crono-focus`

### Drawer de pases (`#cronoPaseDrawer`)
- Pestaña lateral derecha visible solo mientras el cronómetro está en marcha (no pausado)
- Permite registrar pase inicial y pase final antes de abrir el modal "Hecho"
- Al abrir el modal "Hecho", pre-rellena los campos de pase con los valores del drawer
- Estado en `_cronoDraftPases`, reset al iniciar nueva sesión en `cronoStart`

### Metrónomo (`#metroDrawer`)
- Drawer lateral derecho colapsable, posición fija `top: 120px`
- Se puede anclar abierto (pin) — estado guardado en `localStorage` key `metro_pinned`
- **Pin = fusión**: al fijar, la tarjeta del drawer se disuelve (fondo/borde transparentes vía `.metro-drawer.pinned`) y la pestaña lateral desaparece; el metrónomo queda integrado en la pantalla. El botón 📌 sigue visible para desfijar.
- Punto parpadeante en la pestaña indica beat mientras corre
- Animación ring-buffer 3-slots: los tres números (anterior, actual, siguiente) hacen efecto slot-machine al cambiar BPM
- **Ruleta de tempo** (`_metroAnimateDisplayTo`): rueda/botones ± avanzan número a número (los ±5 también se animan, no saltan) con un **tick de rueda discreto** (`_metroPlayWheelTick`) en cada paso. Arrastre táctil a `STEP_PX = 26` px por paso (más lento y controlable). El slider y los cambios programáticos no hacen tick.
- Sin etiqueta de tempo (Andante, Allegro, etc. — eliminada)
- **Sin acento de compás**: todos los golpes suenan igual (`_metroPlayTick(false, when)` siempre; no hay contador de beats)
- Botón TAP grande + botón Play/Pause explícito
- Al cambiar BPM mientras corre, el planificador adopta el nuevo tempo en la siguiente ventana de lookahead (`metroSetBpm` ya **no** toca el timer; hacerlo paraba el bucle)
- **Volumen muy alto a propósito**: el golpe usa ganancias > 1 (click 2.8, grave 2.2) empujadas contra un limitador (`DynamicsCompressor` threshold −10, ratio 20) para sonar fortísimo sin crackeo digital

### Planificador del metrónomo (fix de clicks perdidos)
- `_metroSchedule()` usa **lookahead sobre el reloj de Web Audio** (Chris Wilson): cada 25 ms pre-programa todos los golpes que caen dentro de los próximos `_METRO_LOOKAHEAD = 0.1` s, pasando su timestamp exacto a `_metroPlayTick(false, when)`.
- `_metroNextTime` está en **segundos del reloj de audio** (`ctx.currentTime`), no en `Date.now()`. Si la pestaña se duerme y queda atrás, reengancha a `currentTime` sin disparar una ráfaga.
- Esto arregla el bug de iPad por el que 1 de cada 3-4 clicks no sonaba (antes el golpe se creaba en el instante impreciso del `setTimeout`, con envolvente tan corta que se truncaba).

### Corrección de audio
- `_metroGetCtx()`: recrea el `AudioContext` si está cerrado o nulo
- `_metroPlayTick()` y el planificador llaman `ctx.resume()` si el contexto está suspendido (fix para el bug de silencio tras uso prolongado en iOS)

### Banner de actualización SW
- `_swUpdateInit()` se llama en `window load`
- Detecta SW nuevo esperando (`.waiting`) y escucha `updatefound`
- Muestra `#swUpdateBanner` con botón "Actualizar →"
- `swDoUpdate()` envía mensaje `SKIP_WAITING` al SW en espera
- `controllerchange` en navigator.serviceWorker recarga la página

## Patrones CSS importantes

- **Drawer lateral**: `position:fixed; right:0; width:0` → `.open { width: Xpx }` con `transition: width`
- **Fix scroll en flex en iOS Safari**: `min-height: 0` en hijos flex que necesiten `overflow-y: auto`
- **Variables CSS**: `--bg`, `--bg3`, `--text`, `--text3`, `--accent`, `--border` (tema oscuro/claro)

## Flujo de trabajo recomendado

1. Editar `app.js`, `index.html`, `styles.css` según necesidad
2. Subir versión de caché en `sw.js` (ej: `v6` → `v7`)
3. Commit y push a `main`
4. El usuario recibe el banner "Nueva versión disponible" y pulsa Actualizar

## Contexto del usuario

- Alberto es pianista, usa la app principalmente en iPad
- Prefiere feedback iterativo: describe el problema visual/funcional, se implementa, él prueba
- UI en español, terminología de práctica de piano (pase, concentrado, hecho, etc.)
- No quiere funcionalidades innecesarias — priorizar simplicidad y pulido sobre features nuevas
- Si hay duda entre dos enfoques de implementación, preguntar antes de implementar

## Estado actual (mayo 2026)

Todas las funcionalidades listadas arriba están implementadas y en `main`. La versión de caché activa es `estudio-v15`.

### Modales que nunca quedan invisibles ni descentrados

`openModal` fuerza un reflow tras mover el overlay a `body` (`void overlay.offsetWidth`) y añade un triple salvavidas (doble rAF + setTimeout 60 ms) que pone `opacity:1` al `.modal` interno. Sin esto, en iOS Safari el move + add(`visible`) en el mismo frame podía dejar el `.modal` en `opacity:0` (overlay borroso pero modal invisible). `closeModal` limpia el `opacity` inline.

El `.modal` base usa `max-height: 90dvh` (con fallback a `vh`) y `overscroll-behavior: contain` para que el contenido nunca sobresalga del viewport en iOS y el scroll interno no contagie al body.

En `body.crono-focus`, el `.modal-overlay` se ancla explícitamente al viewport con `position:fixed; width:100vw; height:100dvh` y `padding:12px`, y se añade `margin:auto` al `.modal` como red de seguridad del centrado. Sin esto, el `body { overflow:hidden; height:100vh }` del modo concentración creaba un containing block para `position:fixed` en iOS y el modal Hecho aparecía descolocado por encima del viewport.

### Picker de obras del cronómetro: scroll en listas largas

`#modalCronoObraPicker .modal` tiene `height:84dvh` y `overflow:hidden` (no auto), y `#cronoObraPickerList` usa `flex:1 1 0; min-height:0; overflow-y:auto`. Sin `min-height:0` un flex child con overflow no se contrae, así que con listas largas el modal entero scrolleaba (header, lista y footer juntos) y el `flex:1` perdía su altura; el síntoma era "el cuadro se hace enorme y hay que hacer pinch-zoom para ver abajo".

### Excluir obras al marcar un evento como realizado

`openEventoResultado` añade un botón **"No la toqué"** por obra en `#modalEventoResultado`. Las excluidas (`_eventoResExcluidas`) no graban pase de escena, no cuentan en el score global y se guardan aparte en `resultado.obrasOmitidas` con `skipped:true`. Si se excluyen todas, `scoreTotal` queda `null` y el calendario pinta "✓ Realizado" en vez de "0% éxito".

### Modales con gráficas/edición: abrir antes que renderizar

`openGrafico`, `openObrasChart`, `openEstadoChartModal` y `openEditarSesion` ahora llaman `openModal` primero y rinden el contenido en el `requestAnimationFrame` siguiente. Renderizar dentro de un overlay con `display:none` dejaba SVGs con `width=0` en algunos navegadores móviles (el usuario veía el modal vacío al pulsar "↗ ampliar" / "Evolución ↗" / "✏️ Editar").

### Audio robusto contra suspensiones largas de iOS

`playTone` y `playNoiseBurst` ya no programan tonos contra un `currentTime` estancado: si el `AudioContext` no está `running`, esperan a `resume()` y abortan si el resume no completa. `_wakeAudioContext` descarta el AC si está `closed` (iOS lo cierra tras inactividad larga). Listener `pageshow` con `e.persisted` (bfcache de Safari) recrea el AC. Watchdog `_ensureAudioContextAlive` detecta el AC zombi (state `running` pero `currentTime` no avanza) y lo descarta. Gestos `touchstart` / `pointerdown` / `click` / `keydown` reactivan el AC en cada interacción, no solo la primera.

### Marcar obra como aprendida al instante

`marcarAprendida(obraId, movId)` salta la fase de digitando sin contar compases: pone `apr = 10` (y `compasActual = compasesTotal` si existe). Botón "✓ ya me la sé" en cada `renderCompasWidget` (obra sin movimientos y cada movimiento), visible solo si `aprFromCompas(entity) < 10`. En el modal de añadir obra hay una casilla `#newObraAprendida` que crea la obra con `apr: 10` y `estado: 'consolidando'`.

### Editar minutos desde la tarjeta

En las tarjetas de sesión (`renderExtraItem`), tocar el tiempo (`.plan-item-time.editable`) lo convierte en un input inline (`editPlanItemMin`): actualiza `sessionMinPlan`, marca `_isExtra`, refresca el concentrado y autoguarda. Evita ir al historial → Editar sesión para una corrección rápida.

### Deshacer tras borrar

Toast con acción "Deshacer" (`showUndoToast(msg, undoFn, ms)` + `#undoToast`). Wired en `removeFromPlan` (snapshot de estado + DOM), `deleteEditExistingItem` (snapshot de item + estado en memoria si es hoy) y `confirmDeleteObra` (snapshot de obra + pertenencia a eventos). Estos dos primeros ya no usan `confirm()`; el de obra mantiene confirmación y añade deshacer.

### Tiempo realmente estudiado (no contar lo planificado)

Helpers `_itemEstudiado(it)` / `_itemMinReal(it)`: un item de sesión solo cuenta como tiempo estudiado si vino del cronómetro (`_isExtra`), se marcó hecho/parcial, o es registro manual. Las tarjetas planificadas por el generador que nunca se tocaron **no** suman horas. Cada item serializado lleva un flag `estudiado`; los datos antiguos sin flag se interpretan por su `tick`. Esto se aplica en la serialización (`commitSession`, `_autoSaveTodayPlanNow`), en el historial, en el resumen lateral y en la restauración desde la nube (`restoreSessionFromDbToday` marca `_isExtra` según `anyStudied`).

### Tope del cronómetro (2h)

`CRONO_MAX_MIN = 120`. En modo Cronómetro (sin objetivo) se autodetiene y guarda al llegar a 2h (en `cronoStartTick`). `cronoFinish` capa los minutos a 2h para que reabrir la app tras horas no grabe una sesión enorme. El modo Temporizador ya se limita por su objetivo.

### Editar/eliminar tiempo de HOY

El modal "Editar sesión" sincroniza los cambios de la sesión de hoy con el estado en memoria (`_editSyncLivePlan`): editar minutos/tick o borrar un item actualiza `sessionMinPlan`/`sessionTicks`/`currentPlan`, no solo `db.sesiones`. Sin esto el autosave (que reconstruye la sesión de hoy desde memoria) revertía la edición al instante.

### Destellos (sesiones de excelencia)

Cuando el slider "¿Cómo fue esta sesión?" del modal Hecho llega a **≥ `DESTELLO_UMBRAL` (80)**, aparece bajo el slider una caja dorada (`#hechoDestelloBox`) que pregunta qué hizo especial la sesión y la marca como **destello** (casilla para desmarcar). El estado vive en `sessionDestello[planId] = { on, nota }`, se serializa en cada item de sesión (`destello` + `destelloNota`) y se restaura igual que `sessionProductivityRatings`.

- En el **mini-resumen lateral** del cronómetro las filas de destello salen con ✨ y la nota resaltada (`.crono-resumen-destello-nota`).
- Un **pill "✨ Destellos"** abajo a la izquierda (solo en el cronómetro en reposo, oculto con `body.crono-running`) abre `#modalDestellos`, la lista completa de destellos del historial (`getAllDestellos`): hoy se lee de memoria, días pasados de `db.sesiones`.

### Fix de zoom en modales sobre el cronómetro

`body.crono-focus` usa `touch-action: none` (bloquea pellizco). Los modales sobre el cronómetro ahora usan `touch-action: pan-y` (antes `auto`): permiten scroll vertical pero **no** pinch-zoom, evitando que la pantalla quede ampliada al cerrar el modal.

### Algoritmo de generación (`generateSession` / `scoreEntity`)

Los pesos del scoring viven en una sola constante `SCORE_W` (justo antes de `generateSession`), con la jerarquía declarada: urgencia de evento (60) ≳ pasajes (50) ≈ solidez (50) > rotación (~33) > escenario (20) > ticks (±25) > fatiga (−20). Cada bloque está **acotado a su techo** (`pasajeCap`, `solidezCap`, `urgCap`) para que ninguna señal aplaste al resto. Para afinar el comportamiento, tocar solo los números de `SCORE_W`.

El reparto de tiempo en sesión de trabajo recorta 5 min de la tarjeta mayor en bucle hasta encajar en el tiempo disponible (suelo de 10 min/tarjeta), de modo que la asignación nunca excede el total.

El antiguo registro de **ataques TOC** (marcadores en la gráfica de Estado diario, sección "Registro TOC" y campos del modal de editar sesión) se ha **eliminado por completo**. El estado diario (Bienestar/Sueño) persiste de forma independiente vía `alberto_estado_v1` + `db.estadoDiario` con marca de fecha; **no** debe restaurarse desde `draft.estado` (eso machacaba los valores guardados el mismo día).
