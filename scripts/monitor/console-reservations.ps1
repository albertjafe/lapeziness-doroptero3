param(
    [string]$MonitorDirectory = $PSScriptRoot,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Profile = 'emma',
    [string]$LogPath,
    [switch]$FollowOnly,
    [int]$MonitorProcessId = 0,
    [switch]$Once,
    [switch]$LibraryOnly
)

# Presentation only. The monitor keeps writing every diagnostic to disk.
# Do not import the Python monitor or call Asimut/Telegram from this reader.
function ConvertTo-ReservationEvent {
    param([string]$Line, [ValidateSet('activity','console')][string]$Source = 'activity')
    $stamp = ''
    $body = $Line.Trim()
    if ($Source -eq 'activity') {
        if ($body -notmatch '^\[(\d{4}-\d{2}-\d{2} [\d:]+)\] \[BOT→\] (.*)$') { return }
        $stamp = $Matches[1]
        $body = $Matches[2]
    } else {
        # These events have no equivalent in the ordinary BOT log. Everything
        # else (HTTP, raw JSON, polling, retries, configuration) stays on disk.
        if ($body -notmatch '^\[(DESAPARECE|RECORTE|CONSOLA)\] (.*)$') { return }
        $tag = $Matches[1]
        $body = $Matches[2]
        if ($tag -eq 'DESAPARECE' -and $body -notmatch 'reserva|aula|recort|cancel|tramo') { return }
        if ($tag -eq 'CONSOLA' -and $body -notmatch 'cancelad|reservad|ampliad|recortad|modificad') { return }
    }
    $body = [System.Net.WebUtility]::HtmlDecode(($body -replace '<[^>]+>', ''))
    $body = $body.Replace('↵', ' · ') -replace '\*', ''
    $body = ($body -replace '\s+', ' ').Trim()
    $body = $body -replace '^\P{L}*(?=\p{L})', ''
    $body = $body -replace ' Si sí lo quieres:.*$', ''
    # Explicit action messages, not keyword matches against the entire log:
    # "no migration possible" and hypothetical plans are not booking events.
    $kind = $null
    if ($Source -eq 'console' -and $tag -in @('DESAPARECE','RECORTE')) { $kind = 'Cambio detectado' }
    elseif ($body -match '^(Migración completada|Migración PAOD confirmada)') { $kind = 'Migración' }
    elseif ($body -match '^Migración detectada.*Ejecutando') { $kind = 'Motivo de migración' }
    elseif ($body -match '^Migración en curso.*cancelando reservas') { $kind = 'Cancelación'; $body += ' · Por el monitor para migrar.' }
    elseif ($body -match '^Fusión: junto') { $kind = 'Motivo de migración' }
    elseif ($body -match '^(Reserva cancelada|Cancelada reserva|Reserva.*cancelada por /skip|Reserva.*cancelada: franja ciega|Migración.*cancelada por /skip|Migración.*cancelada: franja ciega)') { $kind = 'Cancelación' }
    elseif ($body -match '^(Reserva (aula|VIP|ESPEJO)|Emergencia resuelta).*?(VERIFICADA|reservada|confirmada|correcta)' -or $body -match '^Reservad[ao]\b') { $kind = 'Reserva' }
    elseif ($body -match '^Aula .*hueco liberado por') { $kind = 'Hueco liberado' }
    elseif ($body -match '^(Absorbido \+|Ampliad[ao]|Reserva.*(ampliada|modificada|recortada)|Modificad[ao].*reserva)') { $kind = 'Modificación' }
    elseif ($body -match '^Rescate (anticaída|fallido)' -or $body -match '^Rescate:.*recuperado') { $kind = 'Recuperación' }
    elseif ($body -match '^(¡?ALERTA MIGRACIÓN|Cancelación parcial: restaurando|VIP: cancelación parcial fallida|Emergencia: no se pudo reservar|No he cancelado la reserva protegida)') { $kind = 'Incidencia de reserva' }
    if (-not $kind) { return }
    # Source/actor must come from evidence; releasing a room is not proof of
    # who cancelled another booking. Never infer a professor from disappearance.
    if ($kind -in @('Cancelación','Cambio detectado') -and $body -match 'cancel|desaparec|quitad|recort|ahora es' -and
        $body -notmatch '(por (el |la |un |una )?(profesor|usuario|monitor|Asimut)|desde (la app|dashboard|Telegram)|por /skip|franja ciega|autor:|quién|quien)') {
        $body += ' · Autor no identificado.'
    }
    if ($kind -eq 'Motivo de migración' -and $body -match 'Subtipo:\s*(\w+)') {
        $reasons = @{ temporal = 'ganar tiempo'; estamental = 'pasar a un aula mejor sin perder tiempo'; estamental_asc = 'pasar a un aula mejor'; baja_compensada = 'ganar tiempo a cambio de un aula de menor prioridad' }
        $reason = $reasons[$Matches[1]]
        $room = if ($body -match 'Aula destino:\s*(\d+)') { $Matches[1] } else { '?' }
        $slot = if ($body -match 'Hueco ajustado:\s*([\d:]+[–-][\d:]+)') { $Matches[1] } elseif ($body -match 'Hueco original:\s*([\d:]+[–-][\d:]+)') { $Matches[1] } else { '' }
        if ($reason) { $body = 'Aula ' + $room + ' · ' + $slot + ' · Motivo: ' + $reason + '.' }
    }
    $body = $body -replace '\s*\(ok_completo\)', ''
    $body = $body -replace '\[group\]|\[anon\]', ''
    $body = $body -replace '(\d{2}:\d{2}):00', '$1'
    if ($body -match '^(Emergencia: no se pudo reservar aula \d+) \((?:❌\s*)?([^|]+)') {
        $body = $Matches[1] + ': ' + $Matches[2].Trim().TrimEnd(')', '.') + '.'
    }
    $body = $body -replace '(bot\d{5,}):[A-Za-z0-9_-]{20,}', '$1:***'
    [pscustomobject]@{ Time = $stamp; Kind = $kind; Text = ($body -replace '\s+', ' ').Trim().TrimEnd([char]0x00B7).Trim() }
}

function Read-ReservationLog {
    param([hashtable]$State)
    if (-not (Test-Path -LiteralPath $State.Path -PathType Leaf)) { return }
    if ($State.Reader -and (Get-Item -LiteralPath $State.Path).Length -lt $State.Reader.BaseStream.Position) {
        $State.Reader.Dispose(); $State.Reader = $null; $State.Pending = ''
    }
    if (-not $State.Reader) {
        $stream = [IO.File]::Open($State.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $State.Reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
    }
    $text = $State.Pending + $State.Reader.ReadToEnd()
    $lines = $text -split "`n", 0, 'SimpleMatch'
    $State.Pending = $lines[-1]
    for ($i = 0; $i -lt $lines.Length - 1; $i++) {
        ConvertTo-ReservationEvent -Line $lines[$i] -Source $State.Source
    }
}

function Write-ReservationEvents {
    param([object[]]$Events, [hashtable]$Seen)
    foreach ($event in $Events) {
        # Suppress duplicate notices, but retain genuinely later events.
        $key = $event.Time + '|' + $event.Kind + '|' + $event.Text
        $now = [DateTime]::UtcNow
        if ($Seen.ContainsKey($key) -and ($event.Time -or ($now - $Seen[$key]).TotalMinutes -lt 10)) { continue }
        $Seen[$key] = $now
        $prefix = if ($event.Time) { $event.Time.Substring(5, 11) + '  ' } else { '' }
        Write-Host ($prefix + $event.Kind + ' · ' + $event.Text)
    }
    if ($Seen.Count -gt 2000) {
        foreach ($entry in @($Seen.GetEnumerator() | Sort-Object Value | Select-Object -First 500)) { $Seen.Remove($entry.Key) }
    }
}

function Write-MonitorStartupFailure {
    param([System.Management.Automation.ErrorRecord]$Failure, [string]$LogPath, [string]$ExecutablePath)
    $detail = $ExecutablePath + "`r`n" + $Failure.Exception.ToString() + "`r`n" + $Failure.ScriptStackTrace
    $blocked = $detail -match 'Control de aplicaciones|App Control|application control|code integrity|firma digital|digital signature'
    for ($exception = $Failure.Exception; $exception; $exception = $exception.InnerException) {
        if ($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -in @(577, 1260)) { $blocked = $true }
    }
    if ($blocked) {
        Write-Host 'Monitor sin iniciar: Windows ha bloqueado el ejecutable por su politica de seguridad.' -ForegroundColor Yellow
    } else {
        Write-Host 'No se pudo iniciar el monitor.' -ForegroundColor Yellow
    }
    $errorPath = $LogPath + '.launcher.log'
    try {
        [IO.File]::AppendAllText($errorPath, ('[{0:o}] Error de arranque{1}{2}{1}' -f [DateTimeOffset]::Now, "`r`n", $detail), [Text.Encoding]::UTF8)
        Write-Host ('Detalle del error: ' + $errorPath)
    } catch {
        Write-Host ('No se pudo guardar el error. Causa original: ' + $Failure.Exception.Message) -ForegroundColor Yellow
    }
}

if ($LibraryOnly) { return }
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch {}
$MonitorDirectory = (Resolve-Path -LiteralPath $MonitorDirectory).Path
if (-not $LogPath -and $FollowOnly) {
    $latest = Get-ChildItem -LiteralPath (Join-Path $MonitorDirectory 'logs') -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match ('^monitor_' + [regex]::Escape($Profile) + '_\d{8}_\d{6}(?:_\d+)?\.log$') } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { $LogPath = $latest.FullName }
}
if (-not $LogPath) { $LogPath = Join-Path $MonitorDirectory ('logs/monitor_' + $Profile + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log') }
$activityPath = Join-Path $MonitorDirectory ('data/telegram_log_' + $Profile + '.txt')
$states = @(
    @{ Path = $activityPath; Source = 'activity'; Reader = $null; Pending = '' },
    @{ Path = $LogPath; Source = 'console'; Reader = $null; Pending = '' }
)
$seen = @{}
$child = $null
try {
    $Host.UI.RawUI.WindowTitle = 'Reservas · ' + $Profile
    Write-Host ('RESERVAS · ' + $Profile) -ForegroundColor Cyan
    # Show a short, dated history once, then follow only new lines. Technical
    # stderr is deliberately not echoed: its complete file remains available.
    $history = @(Read-ReservationLog $states[0])
    if ($history.Count) { Write-Host 'Ultima actividad registrada (historial):' }
    Write-ReservationEvents -Events @($history | Select-Object -Last 12) -Seen $seen
    $null = @(Read-ReservationLog $states[1])
    if ($Once) { return }
    if (-not $FollowOnly) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
        $env:ASIMUT_MODE = $Profile
        $env:PYTHONUTF8 = '1'
        $env:PYTHONIOENCODING = 'utf-8'
        # Inherit stdin so the monitor's existing console commands still work.
        # No second monitor, network client or booking writer is introduced.
        try {
            $child = Start-Process -FilePath (Join-Path $MonitorDirectory 'Monitor Alberto.exe') -WorkingDirectory $MonitorDirectory -NoNewWindow -PassThru -RedirectStandardOutput $LogPath -RedirectStandardError ($LogPath + '.stderr.log')
        } catch {
            Write-MonitorStartupFailure -Failure $_ -LogPath $LogPath -ExecutablePath (Join-Path $MonitorDirectory 'Monitor Alberto.exe')
            exit 1
        }
        $MonitorProcessId = $child.Id
    }
    while ($true) {
        foreach ($state in $states) {
            try { Write-ReservationEvents -Events @(Read-ReservationLog $state) -Seen $seen }
            catch { Write-Host 'No se puede leer el log de reservas. Los detalles siguen en el log del monitor.' -ForegroundColor Yellow; throw }
        }
        if ($MonitorProcessId -and -not (Get-Process -Id $MonitorProcessId -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Host 'Monitor detenido.' -ForegroundColor Yellow
} finally {
    foreach ($state in $states) { if ($state.Reader) { $state.Reader.Dispose() } }
}
if ($child) { $child.WaitForExit(); exit $child.ExitCode }
