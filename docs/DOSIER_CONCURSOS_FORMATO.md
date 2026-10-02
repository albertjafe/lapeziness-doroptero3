# Formato del dosier de concursos de piano (v1)

La sección **Concursos** de la app importa archivos `.json` con este formato. Lo puede
generar cualquier IA a partir de las bases oficiales. La app calcula sola la edad y la
elegibilidad con la fecha de nacimiento guardada, así que el archivo **no** debe decir
«elegible» o «no elegible»: solo copia la regla de edad de las bases.

## Reglas para la IA

1. **Solo fuentes oficiales**: web del concurso, PDF de bases o página de la WFIMC. Nada de
   blogs, agregadores o recuerdos de ediciones pasadas presentados como actuales.
2. **Nunca inventes**. Si un dato no está publicado, pon `null` (o lista vacía) y añade el
   nombre del campo a `sinConfirmar`. Si usas datos de una edición anterior como referencia,
   dilo en el texto («Referencia 2024: …»).
3. Fechas siempre `AAAA-MM-DD`. Importes como número (sin puntos ni símbolo) y la moneda en
   código ISO (`EUR`, `USD`, `GBP`, `CHF`, `CAD`, `AUD`, `JPY`).
4. Textos en español, breves y concretos. Las listas de obras, completas si las bases las dan.
5. Cada concurso con al menos una entrada en `fuentes` (URL exacta y fecha de consulta).
6. `id` estable: nombre corto + año de la edición, en minúsculas y con guiones
   (`maria-canals-2027`). Si actualizas un concurso que ya existe, **reutiliza su `id`**.

## Estructura

```json
{
  "formato": "dosier-concursos-piano",
  "version": 1,
  "generado": "2026-10-02",
  "autor": "Quién o qué lo generó",
  "concursos": [ { …ficha… } ]
}
```

También se acepta un array de fichas o una sola ficha suelta.

### Ficha de un concurso

| Campo | Tipo | Notas |
|---|---|---|
| `id` | texto | Obligatorio. `a-z`, `0-9` y guiones. |
| `nombre` | texto | Obligatorio. |
| `edicion` | texto | «72.ª (2027)». |
| `ciudad`, `pais` | texto | |
| `web` | URL | Página principal de la edición. |
| `fechas` | `{inicio, fin, nota}` | Fechas del concurso (presencial). |
| `plazo` | `{fecha, hora, zona, nota, cerrado}` | Fin de inscripción. `cerrado: true` si ya pasó aunque no se sepa la fecha. |
| `cuota` | `{importe, moneda, nota}` | Total a pagar; el desglose en `nota`. |
| `edad` | `{min, max, aFecha, nacidoDesde, nacidoHasta, texto, sinLimite}` | Ver abajo. |
| `video` | `{exige, duracion, resumen, detalles[]}` | Requisitos de la preselección. |
| `rondas` | `[{nombre, fecha, duracion, repertorio[]}]` | En orden, incluida la preselección. |
| `premios` | `[{puesto, importe, moneda, extra}]` | Un elemento por premio. |
| `premiosNota` | texto | Premios especiales, conciertos, impuestos… |
| `jurado` | `[texto]` | «Nombre (país), cargo». |
| `juradoNota` | texto | |
| `alojamiento`, `viaje` | `{estado, texto}` | `estado`: `si`, `parcial`, `no` o `desconocido`. |
| `otros` | `[texto]` | Restricciones (alumnos del jurado, ganadores previos), memoria, etc. |
| `estadoBases` | texto | `publicadas`, `parciales`, `pendientes` o `sin verificar`. |
| `fuentes` | `[{titulo, url, consultado}]` | Obligatorio al menos una. |
| `verificado` | fecha o `null` | Día en que se comprobó en la fuente oficial. |
| `sinConfirmar` | `[nombre de campo]` | Campos que no se pudieron comprobar. |

### Edad

Copia la regla tal cual en `texto` y rellena la forma estructurada que corresponda:

- Rango de nacimiento («nacidos entre el 25-04-1996 y el 24-04-2009»):
  `nacidoDesde: "1996-04-25"`, `nacidoHasta: "2009-04-24"` (ambos inclusive).
- «Nacidos después del 26-05-1995» → `nacidoDesde: "1995-05-27"`.
- Edad en una fecha («entre 17 y 29 años a 1 de enero de 2027»):
  `min: 17, max: 29, aFecha: "2027-01-01"`. Si no dice la fecha, `aFecha: null` (la app usa
  el primer día del concurso).
- «Menores de 30» → `max: 29`.
- Sin límite → `sinLimite: true`.

## Instrucción lista para copiar

> Investiga en las webs oficiales los concursos internacionales de piano que te indique
> (o los más relevantes de la temporada) y devuélveme **un único archivo JSON** con el
> formato `dosier-concursos-piano` versión 1 descrito abajo. Usa solo fuentes oficiales,
> pon `null` y añade el campo a `sinConfirmar` cuando algo no esté publicado, no inventes
> nada, cita la URL de cada dato importante en `fuentes` y escribe los textos en español.
> No calcules si soy elegible: copia la regla de edad.

(Pega debajo esta página entera o el botón «Instrucciones para la IA» de la app, que copia
lo mismo.)
