# Formato del dosier de festivales y becas (v1)

Las pestañas **Festivales** y **Becas** de la sección **Oportunidades** importan archivos
`.json` con este formato (`dosier-oportunidades`). Es hermano del dosier de concursos
(`docs/DOSIER_CONCURSOS_FORMATO.md`) y sigue sus mismas reglas: la app calcula la edad y la
elegibilidad, así que el archivo solo copia la regla de edad de las bases.

## Reglas para la IA

1. **Solo fuentes oficiales**: web de la entidad, PDF de bases, BOE o boletines oficiales.
2. **Nunca inventes**. Lo no publicado va a `null` (o lista vacía) y el nombre del campo a
   `sinConfirmar`. Si usas una edición anterior como referencia, dilo («Referencia 2025: …»).
3. Fechas `AAAA-MM-DD`; importes como número y moneda ISO (`EUR`, `USD`, `GBP`, `CHF`).
4. Solo festivales con una **vía de entrada clara**: convocatoria, audición o propuestas
   aceptadas expresamente. Un festival que solo programa por invitación no entra.
5. Cada ficha con al menos una fuente (URL exacta y fecha de consulta) y `verificado` con el
   día en que se comprobó.
6. `id` estable en minúsculas con guiones; si actualizas una ficha, reutiliza su `id`.

## Estructura

```json
{
  "formato": "dosier-oportunidades",
  "version": 1,
  "generado": "2026-10-03",
  "autor": "Quién o qué lo generó",
  "oportunidades": [ { …ficha… } ]
}
```

También se acepta un array de fichas o una ficha suelta. Un dosier de concursos se rechaza
con un aviso (se importa en la pestaña Concursos).

### Ficha

| Campo | Tipo | Notas |
|---|---|---|
| `id` | texto | Obligatorio. `a-z`, `0-9` y guiones. |
| `tipo` | `festival` \| `beca` | Festivales, ciclos, salas y programas de conciertos / becas y ayudas. |
| `nombre`, `entidad`, `ciudad`, `pais`, `web`, `resumen` | texto | |
| `via` | `{tipo, texto}` | `tipo`: `convocatoria`, `audicion`, `propuesta`, `nominacion` u `organizador` (la solicita quien te invita). |
| `plazo` | `{fecha, nota, cerrado, abierto, recurrente}` | `abierto: true` = se aceptan solicitudes todo el año. `recurrente`: cuándo suele abrir («Anual, en enero»). |
| `fechas` | `{inicio, fin, nota}` | Fechas del festival o del periodo de la beca. |
| `dotacion` | `{importe, moneda, nota}` | Importe máximo o caché si se publica. |
| `edad` | `{min, max, aFecha, nacidoDesde, nacidoHasta, texto, sinLimite}` | La regla tal cual; la app calcula si cumples. |
| `requisitos` | lista de textos | Nacionalidad, residencia, matrícula… |
| `envio` | `{resumen, documentos[], email, url}` | Qué mandar y a dónde. |
| `contacto` | `{nombre, email, telefono}` | |
| `otros` | lista de textos | Notas. |
| `estadoBases` | texto | `publicadas`, `parciales`, `pendientes` o `sin verificar`. |
| `fuentes` | `[{titulo, url, consultado}]` | Al menos una. |
| `verificado` | fecha | Día de la última comprobación en fuente oficial. |
| `sinConfirmar` | lista | Nombres de campo no publicados (`plazo`, `dotacion`, `edad`, `envio`…). |

## En la app

- Las fichas se guardan en `db.oportunidades.fichas` como texto JSON (reimportar sustituye la
  ficha entera); «★ Me interesa» / «No me interesa» es tuyo y no se pisa al importar.
- «Añadir a seguimiento» crea un contacto en la pestaña **Seguimiento** con el email y el
  teléfono de la ficha. Allí también se apuntan los ayuntamientos.
