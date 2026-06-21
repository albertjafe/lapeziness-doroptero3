# CLAUDE.md — Planificador de estudio (Piano Practice PWA)

## Proyecto

App PWA para práctica de piano de Alberto. Sirve como planificador de estudio con cronómetro y sincronización con Supabase. UI completamente en **español**.

## MÉTRICA ÚNICA: SOLIDEZ (refactor jun 2026)

Una obra tiene SOLO: nombre, compositor, **dificultad**, **duración** y **solidez** (0-100, única métrica con historial `solHistory`). Solidez 100% = "la toco en público y sale perfecta". **Eliminados de la UI**: movimientos, compases (compasActual/Total), pasajes, pases, ejes apr/esc y fase "digitando". Los datos viejos NO se borran (se preservan en los objetos guardados para poder revertir); solo se dejan de usar/mostrar.

Implementación segura: la tarjeta de obra es `renderObraCardSimple` (la antigua quedó como `renderObraCard_LEGACY`, código muerto). El modal Hecho oculta vía CSS `!important` las secciones `#hechoCompasSection/#hechoPasesSection/#hechoPasajesSection/#hechoMemSection/#hechoZoneSection`. El marcado de las vistas `view-pasajes`/`view-pases` se **eliminó de `index.html`** (jun 2026), igual que sus ramas en `showView` y su CSS; las funciones `renderPasajesGlobal`/`renderPases`/`setPasajesSort` quedan como código muerto inalcanzable (los helpers `renderPasajeItem`/`renderPasajeMiniGraph`/`renderPasajeSolChart` siguen vivos porque los usa `renderObraCard_LEGACY`). Backup pre-refactor en rama `backup/pre-solidez-refactor`.

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

### Metrónomo — ELIMINADO

El metrónomo (drawer lateral derecho, ruleta de tempo, planificador con lookahead, golpes fortísimos) **se eliminó a propósito** al simplificar la pantalla del cronómetro (commit `dda1a33`). El marcado de `index.html` y el CSS se quitaron entonces; el JS huérfano (`_metro*`) y el CSS `.metro-*` se borraron después en la limpieza. **No existe metrónomo en la app.** Si se quisiera recuperar, habría que reintroducir marcado + init desde cero.

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

Todas las funcionalidades listadas arriba están implementadas y en `main`. La versión de caché activa es `estudio-v86`.

### Modal "Sesiones por horas" (tramos individuales con hora inicio/fin)

En la cabecera de "Sesiones registradas" (vista historial), junto a "Mostrar", el botón **"↗ Por horas"** abre `#modalSesionesDetalle` (`openSesionesDetalle`): lista cada tramo de estudio individual con su rango horario `HH:MM–HH:MM`, agrupado por día (todos los días, más recientes arriba, con scroll; hoy marcado "Hoy · …"). Lee `db.sessionPlants` + `db.forestPlants` (cada planta = un tramo real con `startedAt`/`endedAt`), excluye descansos (`tipo:'descanso'`/`obraId:'_rest_'`) y fallidos; el fin se deriva de `endedAt` o `startedAt + mins`. Punto de color de la obra + nombre + minutos. El modal `.sesdet-modal` usa el patrón scroll (`height:84dvh; overflow:hidden` + `.sesdet-body{flex:1 1 0;min-height:0;overflow-y:auto}`). Es distinto del historial inline (`renderSesionesHistorial`), que agrupa por día con obras/minutos y permite editar/borrar.

### Meta de estudio por evento (horas para todo al 80%)

`renderEventoCard`, en eventos próximos no completados con obras, añade bajo "Preparación" una caja `.evento-meta80` (`_eventoHorasA80(ev, ev.dias)`): suma las horas para llevar **todas** las obras del evento al 80% desde su solidez actual estimada (`estimateSolActual` + `predictSolidez`), muestra el total (`Para todo al 80%: ~Xh`), cuántas obras faltan si no son todas, y el ritmo sugerido `~Y h/día hasta el evento` (= horas / `ev.dias`). Si todas ya ≥80% → `Todas tus obras ≥ 80% ✓` (`.evento-meta80.ok`, verde).

La misma cifra aparece **viva dentro del modal de evento** (`#eventoMetaPred`, `updateEventoModalPred`): se recalcula al marcar/desmarcar obras (`onchange` en los checkbox de `renderObraCheckList`) y al cambiar la fecha (`onchange` en `#eventoFecha`), con los días restantes derivados de la fecha elegida. Comparte estilos `.evento-meta80`.

El ritmo diario sugerido (`_eventoRitmoSub`) añade tu **media real de h/día** como ancla (`_mediaHorasDiaReal`, últimos 28 días de calendario contando días en blanco), p.ej. `~7,5 h/día hasta el evento · tu media ~2 h/día`, para que se entienda si es alcanzable. La estimación se auto-calibra: la solidez de partida sale de `estimateSolActual` (medir una obra baja sus horas al instante) y `β` se reajusta con el uso (`_solidezFitCached` por firma de datos).

### Predictor de solidez (cuánto tardaré en tenerla sólida)

En el modal "Añadir estudio", bajo el slider de solidez, una caja viva (`#addObraPrediccion`, `updateAddObraPrediccion`) estima **cuántas horas de estudio y cuántas semanas** faltan para llegar al **80% de solidez** ("sólida"), según el comportamiento histórico del propio usuario. Se actualiza al mover dificultad/duración/solidez (oninput) y al cambiar de tipo (`selectModalTipo`).

Modelo (`predictSolidez` y helpers en app.js, junto a los `_stats*`): cruza `solHistory` (subida de solidez) con las horas reales por obra (`_plantsByObra` sobre `_statsAllPlants`) para medir **horas por punto de solidez**, escalado por la **carga** de la pieza (`dificultad × duración`, proxy ya usado en la app; duración ausente → 8). `_solidezModelFit` saca, por cada obra con subida real (Δsol ≥ 10), la muestra `horas / Δsol / carga` (ventana entre la PRIMERA medida y el PICO de solidez; las horas se cuentan en esa ventana, da igual cuándo se anote la solidez) y toma la **mediana** → `β` personal (defecto 0.011 si no hay datos). Predicción: `horas = β × carga × (80 − solInicial)`. Las semanas salen de `_horasPorSemanaPorObra` (mediana de horas/semana que recibe una obra activa). Confianza por nº de obras que informan (`n`): ≥5 alta, ≥3 media, ≥1 baja. El ajuste se cachea por firma de datos (`_solidezFitCached`/`_solFitSignature`) para no recalcular en cada tarjeta. Los antiguos estimadores `renderRangoWidget`/`computeEficienciaObras` dependen de `compasesTotal`/`compasHistory` (métricas eliminadas) y no aplican a obras nuevas.

Cada **tarjeta de obra** (`renderObraCardSimple`, solo si `hasHist`) muestra `_obraPredHint(o, pct)`: si la solidez estimada (`estimateSolActual`, con decaimiento) < 80% → `→ 80%: ~Xh · Y sem`; si ≥ 80% → dosis de **mantenimiento** `Mantener · ~Z h/sem` (`_obraMantenimientoHsem`), calculada como `puntos_perdidos_semana × β × carga`, usando el decaimiento personal de `computeDecayRate` (puntos/día) con factor de estabilidad por solidez. El acento verde distingue mantenimiento de progreso.

### Tema Brutalista (experimental, anti-"slop de IA")

`[data-theme="brutalista"]` es un tema diseñado a propósito como la **antítesis del diseño genérico de IA** (sin Inter, sin degradados azul→morado, sin esquinas redondeadas, sin sombras suaves). En su lugar: papel hueso (`--bg #ece6d6`) + tinta negra + un único tinte riso magenta (`--accent #e11d5c`); `--border` es **negro sólido**; bordes de 2-3px, **sombras duras macizas** (`box-shadow: 4px 4px 0 0` sin blur), `border-radius:0` en todas las superficies, y tipografía **JetBrains Mono** pesada con etiquetas en mayúsculas espaciadas. Overrides en `styles.css` (tras el bloque Swiss): `.card/.obra-card/.stats-card/.ajustes-card/.session-hero/.modal`, botones, nav, barra de solidez. Registrado en `THEME_BG.brutalista` (`#ece6d6`) y con su botón+glifo (bloque con sombra desplazada) en el selector de `#view-ajustes`. El sistema de temas es data-driven (`refreshTheme` solo lee localStorage y marca `.active`), así que no hay lista blanca de temas que actualizar.

### Meta para superar el periodo anterior (estadísticas)

La tarjeta **"Tendencia"** del dashboard de estadísticas (`_statsComparisonCard`) añade, solo en el periodo EN CURSO (`partial`), una línea-meta (`_statsMetaSuperar`, caja `.stats-meta-super`): si ya vas por encima del total del periodo anterior cerrado, muestra el **margen** (`✓ Ya superas la semana pasada · +Xh de margen`); si aún no, calcula cuánto necesitas estudiar **al día de media** en los días que quedan del periodo para superarlo (`▲ Para superar la semana pasada: Xh Ym/día · faltan Zh en N días`). `objetivo = rows[1].fullMin` (total del periodo anterior, ya cerrado), `hecho = rows[0].fullMin`, `diasRest = ceil((cur.end - now)/día)`, `porDia = ceil(falta / diasRest)`. La unidad textual ("la semana pasada/el mes pasado/el año pasado") sale de `_statsRange`. La variante "ya superas" usa `.stats-meta-super.ahead` (borde y fondo teñidos con `--accent`).

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

### Ajustes es una PANTALLA, no un modal (jun 2026)

Antes Ajustes era `#modalSettings` (un modal monolítico con 15 controles apilados). Ahora es una **vista a pantalla completa** `#view-ajustes`, igual que Sesión/Obras/etc., pero **no** está en la barra de navegación inferior: se abre con el ⚙ del topbar (`openSettings()` → `showView('ajustes')`) y se cierra con la flecha ← de su cabecera (`closeAjustes()` → `showView(_ajustesPrevView)`, que recuerda la vista de origen). `openSettings` además llama `refreshTheme()` y `_syncAjustesActiveOptions()` para re-marcar tema/fuente/tamaño activos al entrar.

El contenido se agrupa en tarjetas (`.ajustes-card`) bajo etiquetas de grupo (`.ajustes-group-label`): **Apariencia** (tema, modo noche, fuente, tamaño), **Sonido** (paquete, volumen+mute, vibración), **Datos** (importar Forest), **Cuenta** (sincronización). Cabecera con `.ajustes-back` (botón circular ←) + `.ajustes-title` (Cormorant 30px). Todos los ids/handlers originales se conservaron (solo cambió el envoltorio), así que el JS de sonido/forest/sync sigue igual. Quedan 3 `closeModal('modalSettings')` en `app.js` como no-ops inofensivos (closeModal es null-safe).

### Selector de temas con glifo por tema (no swatch de color)

Cada `.theme-option` ya no muestra un `.theme-swatch` (gradiente plano) sino un `.theme-glyph`: un cuadro redondeado con el `--bg` del tema de fondo y, encima, un **glifo SVG a trazo fino** teñido con el `--accent` del tema (vía `style="background:#bg;color:#accent"` + `stroke="currentColor"`). Glifos: Concierto=vela, Botánico=hoja, Swiss=retícula, Noche=luna, Cozy=taza, Bruma=niebla, Abeto=abeto. Los `.theme-option` ahora son `<button>` (reset `font/color/background`), en grid `auto-fill minmax(74px,1fr)`. El activo: `border-color: var(--accent)` + ring interno. `refreshTheme` sigue marcando `.active` por `data-theme`. `.theme-swatch` queda en CSS como legacy sin uso.

### Catedral del mes — ELIMINADA

La visualización "Catedral del mes" del cronómetro en reposo (con su Museo y el toggle catedral/flores) **se eliminó** (jun 2026). El **jardín de flores** (`renderCronoGarden`) es ahora la única visualización en reposo; `refreshConcentradoUI` lo llama directamente. Se borró el bloque completo en `app.js` (`_cathedral*`, `_roseWindow`, `renderCronoBuild`, `toggleCronoVisual`, `openMuseo`, `renderMuseo`, `setCatedralHoras`, helpers `_ym/_monthName/_validPlants/_monthTiles/_catFechas`), el DOM en `index.html` (`#cronoBuild`, controles, `#modalMuseo`) y el CSS (`.crono-build*`, `.cat-*`, `.cbar-*`, `.museo-*`). localStorage `alberto_crono_visual`/`alberto_catedral_horas` quedan obsoletos.

### Algoritmo de generación (`generateSession` / `scoreEntity`)

Los pesos del scoring viven en una sola constante `SCORE_W` (justo antes de `generateSession`), con la jerarquía declarada: urgencia de evento (60) ≳ pasajes (50) ≈ solidez (50) > rotación (~33) > escenario (20) > ticks (±25) > fatiga (−20). Cada bloque está **acotado a su techo** (`pasajeCap`, `solidezCap`, `urgCap`) para que ninguna señal aplaste al resto. Para afinar el comportamiento, tocar solo los números de `SCORE_W`.

El reparto de tiempo en sesión de trabajo recorta 5 min de la tarjeta mayor en bucle hasta encajar en el tiempo disponible (suelo de 10 min/tarjeta), de modo que la asignación nunca excede el total.

El antiguo registro de **ataques TOC** (marcadores en la gráfica de Estado diario, sección "Registro TOC" y campos del modal de editar sesión) se ha **eliminado por completo**. El estado diario (Bienestar/Sueño) persiste de forma independiente vía `alberto_estado_v1` + `db.estadoDiario` con marca de fecha; **no** debe restaurarse desde `draft.estado` (eso machacaba los valores guardados el mismo día).
