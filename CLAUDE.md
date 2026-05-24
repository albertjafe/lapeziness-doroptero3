# CLAUDE.md — Planificador de estudio (Piano Practice PWA)

## Proyecto

App PWA para práctica de piano de Alberto. Sirve como planificador de estudio con cronómetro, metrónomo, registro de pases y sincronización con Supabase. UI completamente en **español**.

## CRÍTICO: Rama de desarrollo

**Todos los cambios se hacen sobre `main` directamente.**

El live PWA está servido por GitHub Pages desde la rama `main` del repositorio `albertjafe/lapeziness-doroptero3`. Si se usa una rama de trabajo, **siempre rebasar sobre `main` y hacer fast-forward merge de vuelta a `main` antes de hacer push**. Nunca dejar cambios importantes solo en una rama feature.

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
- **Sin acento de compás**: todos los golpes suenan igual (`_metroPlayTick(false)` siempre; no hay contador de beats)
- Botón TAP grande + botón Play/Pause explícito
- Al cambiar BPM mientras corre solo se reprograma el timer (sin golpe de metrónomo inmediato)

### Corrección de audio
- `_metroGetCtx()`: recrea el `AudioContext` si está cerrado o nulo
- `_metroPlayTick()`: llama `ctx.resume()` antes de programar nodos si el contexto está suspendido (fix para el bug de silencio tras uso prolongado en iOS)

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

Todas las funcionalidades listadas arriba están implementadas y en `main`. La versión de caché activa es `estudio-v7`.

El antiguo registro de **ataques TOC** (marcadores en la gráfica de Estado diario, sección "Registro TOC" y campos del modal de editar sesión) se ha **eliminado por completo**. El estado diario (Bienestar/Sueño) persiste de forma independiente vía `alberto_estado_v1` + `db.estadoDiario` con marca de fecha; **no** debe restaurarse desde `draft.estado` (eso machacaba los valores guardados el mismo día).
