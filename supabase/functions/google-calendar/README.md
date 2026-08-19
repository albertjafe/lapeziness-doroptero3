# Google Calendar (solo lectura)

Integración de Google Calendar en la PWA. La app solo lee los calendarios y
eventos que el usuario elige; nunca escribe en Google Calendar.

## Qué hace

- `authorize`: genera la URL de consentimiento OAuth de Google.
- `callback`: intercambia el código de autorización y guarda el refresh token
  cifrado en `public.google_calendar_connections`.
- `sync`: devuelve la lista de calendarios visibles y sus eventos.
- `disconnect`: revoca el token y borra la conexión.

El refresh token se cifra con **AES-GCM** usando la clave
`GOOGLE_TOKEN_ENCRYPTION_KEY` y nunca se envía al cliente.

## Despliegue en Supabase

1. Ejecutar la migración:
   `supabase/migrations/202608170002_google_calendar.sql`.
2. Crear un cliente OAuth en Google Cloud Console:
   - URI de redirección autorizada:
     `https://fexfeekifzgszluemihs.supabase.co/functions/v1/google-calendar/callback`
   - Origen autorizado (para la vuelta a la app):
     `https://albertjafe.github.io`
   - Permisos: `calendar.calendarlist.readonly` y `calendar.events.readonly`.
3. Configurar los secretos de la Edge Function:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_TOKEN_ENCRYPTION_KEY` (32 bytes en Base64URL)
   - `APP_URL` (opcional; por defecto apunta a GitHub Pages)
   - `GOOGLE_REDIRECT_URI` (opcional; por defecto apunta al callback de la
     función)
4. Desplegar la función con `supabase functions deploy google-calendar`.

La app añade automáticamente `?google_calendar=connected` al volver del
consentimiento y sincroniza la capa en la vista de calendario.
