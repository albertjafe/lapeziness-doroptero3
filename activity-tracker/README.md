# Tracker personal de actividad (0 €)

Esta integración añade contexto digital al planificador sin convertir la app en un keylogger.

## Qué se guarda en Supabase

Por cada bloque: dispositivo, hora de inicio/fin, aplicación, **dominio reducido** (si existe), categoría y duración.

No se suben:

- títulos de ventanas;
- texto escrito o pulsaciones;
- portapapeles;
- contenido de mensajes;
- URL completas, rutas, búsquedas o parámetros;
- datos de pestañas en incógnito.

Los dominios financieros/autenticación conocidos se convierten en `private`: se conserva el tiempo, pero se elimina el dominio.

ActivityWatch conserva su base detallada localmente. El sincronizador solo lee localhost (`127.0.0.1:5600`) y envía la versión reducida.

## Windows + ActivityWatch

Ejecuta PowerShell normal (no hace falta administrador en la mayoría de equipos):

```powershell
irm https://raw.githubusercontent.com/albertjafe/lapeziness-doroptero3/main/activity-tracker/windows/install.ps1 | iex
```

El instalador pide el token personal del tracker, descarga `activity-sync.ps1`, intenta instalar ActivityWatch si no existe y registra una sincronización cada 5 minutos.

ActivityWatch ya registra la aplicación/ventana activa. Para obtener dominios web, instala también el watcher oficial `aw-watcher-web` para Chrome/Edge/Firefox. Nuestro sincronizador descarta el título y la URL completa antes de subir nada.

Archivos locales:

- `%LOCALAPPDATA%\PianoAppActivityTracker\config.json`
- `%LOCALAPPDATA%\PianoAppActivityTracker\state.json`
- `%LOCALAPPDATA%\PianoAppActivityTracker\activity-sync.ps1`

Para probar manualmente:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\PianoAppActivityTracker\activity-sync.ps1" -Once
```

## iPhone / iPad sin app nativa

Se puede registrar el uso de las apps que más importen mediante Automatizaciones de Atajos. No hace falta dejar la PWA abierta.

Endpoint:

```text
https://fexfeekifzgszluemihs.supabase.co/functions/v1/activity-tracker
```

Cada petición debe llevar el header:

```text
x-activity-token: TU_TOKEN_PERSONAL
```

Para cada app que quieras medir, crea dos automatizaciones: **al abrir** y **al cerrar**. Configúralas como `Ejecutar inmediatamente`.

### Al abrir una app

Usa `Obtener contenido de URL` → POST → JSON:

```json
{
  "mode": "start",
  "device_id": "iphone-personal",
  "device_type": "iphone",
  "session_key": "youtube",
  "app": "YouTube",
  "category": "entertainment",
  "local_date": "AAAA-MM-DD"
}
```

En iPad usa `device_type: ipad` y otro `device_id`.

### Al cerrar la misma app

```json
{
  "mode": "stop",
  "device_id": "iphone-personal",
  "device_type": "iphone",
  "session_key": "youtube",
  "source": "shortcut"
}
```

El servidor empareja apertura/cierre y guarda un único intervalo. Si un cierre llega sin apertura registrada, no inventa duración.

Para `local_date`, Atajos puede usar `Fecha actual` → `Formatear fecha` con formato personalizado `yyyy-MM-dd`.

Categorías admitidas: `productive`, `piano`, `ai`, `communication`, `social`, `entertainment`, `browsing`, `private`, `other`.

## En la app

La vista **Hoy** carga los bloques de `activity_events` del usuario autenticado y añade una tarjeta `Actividad digital · contexto del día` con:

- actividad registrada;
- Productivo + IA;
- Social + ocio;
- cambios de contexto;
- distribución por categorías;
- línea temporal reducida.

`window.ActivityTracker.reportContext(fecha)` expone además un resumen estructurado para informes futuros/IA, sin devolver el detalle sensible que ActivityWatch mantiene local.

## Principio del análisis

Los datos sirven para encontrar asociaciones (`los días que X ocurre, suele pasar Y`), no para declarar causalidad automáticamente. Un bloque de YouTube no implica por sí mismo que haya sido la causa de estudiar menos.
