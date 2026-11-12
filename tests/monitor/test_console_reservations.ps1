$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/monitor/console-reservations.ps1') -LibraryOnly

function Assert-True($value, [string]$message) { if (-not $value) { throw $message } }
function Event([string]$body) { ConvertTo-ReservationEvent ('[2026-11-12 10:30:00] [BOT→] ' + $body) }

foreach ($line in @(
    '[HTTP] últimos 10 min: 80 lecturas/min', '[EMERGENCIA] Sin huecos libres en la ventana.',
    '[POST_ONCE] HTTP 200 | ok=True', '[POST_ONCE] Raw JSON: {"success":true}', '[RELOJ] reloj ajustado',
    '[DESAPARECE] TimeoutError: timeout', '[LIBERADOR] Error: fallo técnico'
)) { Assert-True ($null -eq (ConvertTo-ReservationEvent $line console)) ('Ruido visible: ' + $line) }
foreach ($line in @(
    '🧩 No hubo ninguna migración viable tras aplicar ventana y cuotas.',
    '🧩 *Posible MIGRACIÓN (teórica)*', '⏳ Espera táctica: aula 123', 'Reservas para hoy: …',
    '🟢 Migración ACTIVADA: al detectar una migración válida, cancelaré por UI y reservaré el bloque destino.',
    '📋 Estado actual antes de cambios', '❌ TimeoutError: servidor caído'
)) { Assert-True ($null -eq (Event $line)) ('Rutina visible: ' + $line) }
Assert-True ((Event '✅ Reserva aula 123 (12:15–13:15) con perfil [group] — VERIFICADA').Kind -eq 'Reserva') 'Falta reserva confirmada'
Assert-True ((Event '✅ *Migración completada*: reservada aula 123 14:00–15:00').Kind -eq 'Migración') 'Falta migración'
$why = Event '🧩 *Migración detectada* → Ejecutando… ↵ Mejora: una sala de mayor prioridad y 30 minutos más'
Assert-True ($why.Text -match '30 minutos más' -and $why.Kind -eq 'Motivo de migración') 'Se perdió el motivo'
$reason = Event '🧩 Migración detectada → Ejecutando… ↵ • Clase: 1 | Subtipo: baja_compensada ↵ • Aula destino: 123 (Nivel 999) ↵ • Hueco original: 10:00:00–12:00:00 ↵ • Hueco ajustado: 10:30:00–12:00:00'
Assert-True ($reason.Text -match 'ganar tiempo a cambio' -and $reason.Text -match '10:30–12:00' -and $reason.Text -notmatch 'Nivel|Clase:') 'Motivo de migración demasiado técnico'
Assert-True ((Event '🧩 Migración en curso — cancelando reservas cubiertas: ↵ • ✅ aula 123').Text -match 'Por el monitor') 'Falta autor en cancelación para migrar'
Assert-True ((Event '🍰 <b>Absorbido +15min</b> → en 10.123 ↵ 12:15–13:15 → 12:15–13:30 (ok_completo)').Kind -eq 'Modificación') 'Falta ampliación'
Assert-True ((Event '✅ Reserva cancelada desde la app de estudio: aula 123').Text -notmatch 'no identificado') 'Se perdió el origen conocido'
Assert-True ((Event '✅ Reserva cancelada: aula 123').Text -match 'Autor no identificado') 'Se inventa autor'
Assert-True ((Event '✅ Reserva cancelada por profesor: aula 123').Text -notmatch 'no identificado') 'Se perdió el profesor'
Assert-True ((Event '🛟 <b>Rescate anticaída</b> ↵ 123 · 13:15–13:30').Kind -eq 'Recuperación') 'Falta rescate'
Assert-True ((Event '🔓 Aula 123 13:15–13:30 (reserva): hueco liberado por <b>una persona</b>.').Text -match 'una persona') 'Se perdió quién liberó el hueco'
Assert-True ((ConvertTo-ReservationEvent '[DESAPARECE] Has recortado la reserva del aula 123. Si sí lo quieres: escribe permitir 123.' console).Kind -eq 'Cambio detectado') 'Falta recorte'
Assert-True ((ConvertTo-ReservationEvent '[DESAPARECE] Tu reserva 123 ha desaparecido y no la ha cancelado el monitor. Si sí lo quieres: escribe permitir 123.' console).Text -match 'Autor no identificado') 'Atribución incorrecta por desaparición'
Assert-True ($null -eq (ConvertTo-ReservationEvent '[2026-11-12 10:30:00] [TRACE:MIG] Migración completada falsa en diagnóstico')) 'Traza confundida con reserva'

$temp = Join-Path ([IO.Path]::GetTempPath()) ('monitor-console-test-' + [guid]::NewGuid() + '.log')
$state = @{ Path = $temp; Source = 'activity'; Reader = $null; Pending = '' }
try {
    [IO.File]::WriteAllText($temp, '[2026-11-12 10:30:00] [BOT→] ✅ Reserva aula 123 ', [Text.Encoding]::UTF8)
    Assert-True (@(Read-ReservationLog $state).Count -eq 0) 'Se imprimió una línea incompleta'
    [IO.File]::AppendAllText($temp, "VERIFICADA`n", [Text.Encoding]::UTF8)
    Assert-True (@(Read-ReservationLog $state).Count -eq 1) 'No siguió la escritura del monitor'
    Assert-True (@(Read-ReservationLog $state).Count -eq 0) 'Repitió la reserva al sondear'
    [IO.File]::WriteAllText($temp, "[2026-11-12 11:00:00] [BOT→] Reservada aula 124`n", [Text.Encoding]::UTF8)
    Assert-True (@(Read-ReservationLog $state).Count -eq 1) 'No siguió la rotación del log'
} finally {
    if ($state.Reader) { $state.Reader.Dispose() }
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
Write-Output 'OK: ruido oculto, acciones y motivos visibles, autor conservado, seguimiento incremental y rotación.'
