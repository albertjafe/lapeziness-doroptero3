# lapeziness-doroptero3
# TOCCCC

## Para IA / Codex

**No reconstruyas el repositorio desde cero.** Empieza por [`.ai/APP_MAP.md`](.ai/APP_MAP.md): es el mapa canónico, compacto y actualizado de arquitectura, features, datos y “dónde mirar para X”. Después lee `AGENTS.md` y abre solo los módulos necesarios para la tarea.

`CLAUDE.md` y las auditorías grandes son documentación histórica/específica, no contexto inicial.

## Vista Piano Rooms

La app incluye una vista **Salas** de solo lectura. Para mostrar disponibilidad real debe estar ejecutándose en el ordenador el puente local del monitor Piano Rooms:

```text
Piano Rooms Cuadricula.cmd
```

La vista consulta `http://127.0.0.1:8765/api/state` cada minuto. No envía mensajes de Telegram, no reserva, no cancela y no realiza pagos. Si el puente no está activo, la vista sigue funcionando y muestra un aviso de desconexión.

El historial local permite distinguir una franja que desaparece antes de empezar (posible reserva) de una franja que llegó a su hora sin ser reservada. La aplicación no recibe credenciales del área de cliente.
