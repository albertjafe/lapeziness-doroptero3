param(
    [int]$PollSeconds = 15,
    [string]$ControlBranch = 'ai-control',
    [string]$ControlTaskPath = '.ai/CURRENT_TASK.md'
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

$repoRoot = ((& git rev-parse --show-toplevel 2>$null) -join '').Trim()
if (-not $repoRoot -or $LASTEXITCODE -ne 0) {
    throw 'Ejecuta este script desde dentro de la carpeta del repositorio.'
}
Set-Location $repoRoot

$runtimeDir = Join-Path $repoRoot '.ai/runtime'
$lastTaskBlobPath = Join-Path $runtimeDir 'watcher-last-task-blob.txt'
$aiScript = Join-Path $repoRoot 'ai.ps1'
$handoffScript = Join-Path $repoRoot 'ai-handoff.ps1'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

if (-not (Test-Path $aiScript)) { throw 'No encuentro ai.ps1 en la raíz del repo.' }
if (-not (Test-Path $handoffScript)) { throw 'No encuentro ai-handoff.ps1 en la raíz del repo.' }

function Get-TaskState {
    & git fetch origin $ControlBranch --quiet
    if ($LASTEXITCODE -ne 0) { throw "No pude descargar origin/$ControlBranch." }

    $spec = "origin/${ControlBranch}:$ControlTaskPath"
    $blob = ((& git rev-parse $spec 2>$null) -join '').Trim()
    if (-not $blob -or $LASTEXITCODE -ne 0) { throw "No pude identificar $ControlTaskPath." }

    $text = ((& git show $spec 2>$null) -join "`n")
    if ($LASTEXITCODE -ne 0) { throw "No pude leer $ControlTaskPath." }

    return @{ Blob = $blob; Text = $text }
}

function Read-LastTaskBlob {
    if (-not (Test-Path $lastTaskBlobPath)) { return '' }
    return (Get-Content -Raw $lastTaskBlobPath).Trim()
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host ' ChatGPT ↔ Codex watcher activo' -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Miro origin/$ControlBranch cada $PollSeconds s."
Write-Host 'Cuando ChatGPT publique una tarea nueva, Luna/Sol arrancarán solos.'
Write-Host 'Al terminar, el resultado vuelve a GitHub automáticamente.'
Write-Host 'Para detenerlo: Ctrl+C.'

$lastError = ''
while ($true) {
    try {
        $state = Get-TaskState
        $lastBlob = Read-LastTaskBlob
        $isEmpty = $state.Text -match 'STATUS:\s*EMPTY'

        if (-not $isEmpty -and $state.Blob -ne $lastBlob) {
            Write-Host "`n[NUEVA TAREA] $($state.Blob.Substring(0, 10))" -ForegroundColor Yellow
            Write-Host 'Arrancando Luna → Sol sobre el workspace actual...' -ForegroundColor Cyan

            # -Repeat evita que ai.ps1 use como identidad el commit completo de
            # ai-control. El watcher usa el blob de CURRENT_TASK.md, por lo que
            # los commits del buzón CODEX_TO_CHATGPT no disparan otra ejecución.
            $runSucceeded = $true
            $runError = ''
            try {
                & $aiScript -AllowDirty -Repeat
                $runSucceeded = $?
            }
            catch {
                $runSucceeded = $false
                $runError = $_.Exception.Message
            }

            if (-not $runSucceeded) {
                $suffix = if ($runError) { " Detalle: $runError" } else { '' }
                Write-Warning ("ai.ps1 terminó con error. Publicaré igualmente el estado actual para que ChatGPT pueda decidir el siguiente paso." + $suffix)
            }

            try {
                & $handoffScript -ControlBranch $ControlBranch -ControlTaskPath $ControlTaskPath
                if (-not $?) { throw 'ai-handoff.ps1 devolvió error.' }
                # ai-handoff también escribe este marcador, pero lo repetimos
                # aquí para dejar explícita la semántica del watcher.
                Write-Utf8NoBom $lastTaskBlobPath $state.Blob
                Write-Host "`nEsperando la siguiente respuesta de ChatGPT..." -ForegroundColor DarkCyan
            }
            catch {
                Write-Warning "No pude publicar el handoff: $($_.Exception.Message)"
                Write-Warning 'No repetiré esta tarea en bucle. Se marca como atendida localmente; puedes ejecutar ai-handoff.ps1 manualmente.'
                Write-Utf8NoBom $lastTaskBlobPath $state.Blob
            }
        }

        $lastError = ''
    }
    catch {
        $msg = $_.Exception.Message
        if ($msg -ne $lastError) {
            Write-Warning "Watcher: $msg"
            $lastError = $msg
        }
    }

    Start-Sleep -Seconds ([Math]::Max(5, $PollSeconds))
}
