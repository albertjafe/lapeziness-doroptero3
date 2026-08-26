param(
    [ValidateSet('run', 'refresh-map', 'status')]
    [string]$Action = 'run',
    [string]$TaskFile = '',
    [switch]$AllowDirty,
    [switch]$Repeat
)

$ErrorActionPreference = 'Stop'

# Change these IDs here if Codex renames the models in the future.
$LunaModel = 'gpt-5.6-luna'
$SolModel  = 'gpt-5.6-sol'
$ControlBranch = 'ai-control'
$ControlTaskPath = '.ai/CURRENT_TASK.md'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Assert-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "No encuentro '$Name'. $InstallHint"
    }
}

function Invoke-CodexRun {
    param(
        [string]$Model,
        [string]$Effort,
        [string]$Sandbox,
        [string]$Prompt,
        [string]$OutputPath,
        [string]$SchemaPath = ''
    )

    $args = @(
        'exec',
        '--ephemeral',
        '--model', $Model,
        '--sandbox', $Sandbox,
        '-c', ('model_reasoning_effort="{0}"' -f $Effort)
    )

    if ($SchemaPath) {
        $args += @('--output-schema', $SchemaPath)
    }

    if ($OutputPath) {
        $args += @('--output-last-message', $OutputPath)
    }

    $args += $Prompt

    & codex @args | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Codex terminó con código $LASTEXITCODE usando $Model/$Effort."
    }
}

function Get-RepoFileShapeHash {
    $paths = (& git ls-files --cached --others --exclude-standard) -join "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($paths)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

Assert-Command 'git' 'Instala Git y vuelve a abrir PowerShell.'
Assert-Command 'codex' 'Instala Codex con: powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'

$repoRoot = ((& git rev-parse --show-toplevel 2>$null) -join '').Trim()
if (-not $repoRoot -or $LASTEXITCODE -ne 0) {
    throw 'Ejecuta este comando desde dentro de la carpeta del repositorio.'
}
Set-Location $repoRoot

$aiDir = Join-Path $repoRoot '.ai'
$runtimeDir = Join-Path $aiDir 'runtime'
$runtimeTask = Join-Path $runtimeDir 'CURRENT_TASK.md'
$workplanPath = Join-Path $runtimeDir 'WORKPLAN.json'
$schemaPath = Join-Path $aiDir 'workplan.schema.json'
$seedMapPath = Join-Path $aiDir 'REPO_MAP.md'
$mapPath = Join-Path $runtimeDir 'REPO_MAP.md'
$shapeHashPath = Join-Path $runtimeDir 'repo-shape.sha256'
$lastTaskCommitPath = Join-Path $runtimeDir 'last-task-commit.txt'
$script:ControlTaskCommit = ''
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Refresh-RepoMap {
    Write-Host "`n[Luna] Actualizando mapa compacto local del repo..." -ForegroundColor Cyan
    $prompt = @'
Read AGENTS.md and the seed .ai/REPO_MAP.md first. Build a compact navigational map of this repository for future coding agents.

This is repository reconnaissance, not feature planning and not implementation. Do not edit source files.
Use targeted search and symbol/function discovery. app.js is very large, so search it rather than reading it wholesale.
Inspect the actual current tree, package scripts/tests, important source modules, entry points, integrations, and CI.

Output Markdown only, preferably under 250 lines. For each important file/module include:
- purpose/responsibility;
- important entry points, functions, classes, or exports;
- important dependencies/consumers when useful;
- relevant tests/checks when identifiable.

Also include a short architecture/data-flow overview and a short 'where to look for X' index.
Do not copy implementation bodies. Do not produce a changelog. This result is the local detailed repo map.
'@
    Invoke-CodexRun -Model $LunaModel -Effort 'medium' -Sandbox 'read-only' -Prompt $prompt -OutputPath $mapPath
    Write-Utf8NoBom $shapeHashPath (Get-RepoFileShapeHash)
}

function Ensure-RepoMap {
    if (-not (Test-Path $mapPath)) {
        Refresh-RepoMap
        return
    }

    $currentHash = Get-RepoFileShapeHash
    if (-not (Test-Path $shapeHashPath)) {
        Write-Utf8NoBom $shapeHashPath $currentHash
        return
    }

    $oldHash = (Get-Content -Raw $shapeHashPath).Trim()
    if ($oldHash -ne $currentHash) {
        Write-Host 'La estructura de archivos ha cambiado; refresco el mapa con Luna.' -ForegroundColor DarkYellow
        Refresh-RepoMap
    }
}

function Load-Task {
    if ($TaskFile) {
        $resolved = (Resolve-Path $TaskFile).Path
        Write-Utf8NoBom $runtimeTask (Get-Content -Raw $resolved)
        Write-Host "Plan local cargado: $resolved" -ForegroundColor Green
        return
    }

    Write-Host "`nDescargando el último plan de la rama '$ControlBranch'..." -ForegroundColor Cyan
    & git fetch origin $ControlBranch --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "No pude descargar origin/$ControlBranch. Comprueba conexión y que la rama exista."
    }

    $script:ControlTaskCommit = ((& git rev-parse "origin/$ControlBranch" 2>$null) -join '').Trim()
    if (-not $script:ControlTaskCommit) {
        throw "No pude identificar el commit actual de origin/$ControlBranch."
    }

    if (-not $Repeat -and (Test-Path $lastTaskCommitPath)) {
        $last = (Get-Content -Raw $lastTaskCommitPath).Trim()
        if ($last -eq $script:ControlTaskCommit) {
            throw 'Ese plan del puente ya terminó correctamente antes. Pide a ChatGPT un plan nuevo o usa -Repeat si de verdad quieres repetirlo.'
        }
    }

    $spec = "origin/${ControlBranch}:$ControlTaskPath"
    $task = (& git show $spec 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $task.Trim()) {
        throw "No pude leer $ControlTaskPath desde origin/$ControlBranch."
    }

    if ($task -match 'STATUS:\s*EMPTY') {
        throw 'El puente todavía no contiene una tarea. En ChatGPT di: "Planifica este cambio para Codex y súbelo al puente".'
    }

    Write-Utf8NoBom $runtimeTask $task
    Write-Host 'Plan recibido. No se ha mezclado ninguna rama ni se ha tocado tu rama local.' -ForegroundColor Green
}

if ($Action -eq 'status') {
    Write-Host "Repo: $repoRoot"
    Write-Host "Branch local: $((& git branch --show-current) -join '')"
    Write-Host "Codex: $((& codex --version) -join '')"
    Write-Host "Luna: $LunaModel"
    Write-Host "Sol:  $SolModel"
    Write-Host "Mapa local: $(if (Test-Path $mapPath) { 'sí' } else { 'no' })"
    Write-Host "Tarea runtime: $(if (Test-Path $runtimeTask) { 'sí' } else { 'no' })"
    Write-Host "`nGit status:"
    & git status --short
    exit 0
}

if ($Action -eq 'refresh-map') {
    Refresh-RepoMap
    Write-Host "`nMapa actualizado en .ai/runtime/REPO_MAP.md" -ForegroundColor Green
    exit 0
}

if (-not $AllowDirty) {
    $dirty = ((& git status --porcelain) -join "`n").Trim()
    if ($dirty) {
        throw "El repo ya tiene cambios sin guardar. Para no mezclar trabajos, haz commit/stash primero. Si son cambios que quieres conservar dentro de esta tarea, ejecuta .\ai.ps1 -AllowDirty."
    }
}

Load-Task
Ensure-RepoMap
$shapeBeforeImplementation = Get-RepoFileShapeHash

Write-Host "`n[Luna] Convirtiendo el plan ya decidido en paquetes de ejecución..." -ForegroundColor Cyan
$dispatcherPrompt = @'
Read AGENTS.md, .ai/runtime/REPO_MAP.md, and .ai/runtime/CURRENT_TASK.md in full.

The task has already been planned externally. Do NOT redesign it, debate architecture, brainstorm alternatives, or expand scope. Your only job is mechanical dispatch: convert the authoritative plan into 1 to 5 small sequential implementation packets matching the supplied JSON schema.

Rules:
- Prefer fewer packets when the change is tightly coupled.
- Give each packet a concrete goal and the smallest plausible file scope.
- Order packets so each can work on the current working tree after previous packets.
- Put only targeted checks in each packet; reserve broad checks for final_checks.
- Do not edit any repository files.
- Return only data matching the schema.
'@
Invoke-CodexRun -Model $LunaModel -Effort 'low' -Sandbox 'read-only' -Prompt $dispatcherPrompt -OutputPath $workplanPath -SchemaPath $schemaPath

try {
    $workplan = Get-Content -Raw $workplanPath | ConvertFrom-Json
}
catch {
    throw "Luna no produjo un WORKPLAN.json válido. Revisa $workplanPath"
}

$failedSteps = @()
$stepNumber = 0
foreach ($step in $workplan.steps) {
    $stepNumber++
    $id = [string]$step.id
    $safeId = ($id -replace '[^a-zA-Z0-9_-]', '_')
    $stepOutput = Join-Path $runtimeDir ("STEP-{0}.md" -f $safeId)
    $stepJson = $step | ConvertTo-Json -Depth 8

    Write-Host "`n[Luna $stepNumber/$($workplan.steps.Count)] $($step.goal)" -ForegroundColor Cyan

    $implementPrompt = @"
Read AGENTS.md, .ai/runtime/REPO_MAP.md, .ai/runtime/CURRENT_TASK.md, and .ai/runtime/WORKPLAN.json.

Implement ONLY the following work packet from the already-approved plan:

$stepJson

The plan is authoritative. Do not re-plan the feature or broaden its scope.
Work on the current working tree, which may contain changes from earlier packets.
Use targeted search before opening large files, especially app.js.
The listed files are the expected scope; modify another file only when concretely required to make this packet correct.
Preserve unrelated behavior. Do not commit or push.
Run the packet's targeted checks when practical.
Finish with a concise note of files changed, checks run, and any concrete blocker for the final integrator.
"@

    try {
        Invoke-CodexRun -Model $LunaModel -Effort 'medium' -Sandbox 'workspace-write' -Prompt $implementPrompt -OutputPath $stepOutput
    }
    catch {
        $failedSteps += $id
        Write-Warning "El paquete $id falló. No aborto: Sol recibirá el estado actual y terminará/recuperará lo necesario. Detalle: $($_.Exception.Message)"
    }
}

$failedText = if ($failedSteps.Count -gt 0) { $failedSteps -join ', ' } else { 'ninguno' }
$solOutput = Join-Path $runtimeDir 'LAST_RESULT.md'
Write-Host "`n[Sol medium] Integración, revisión y comprobación final (una sola pasada)..." -ForegroundColor Magenta
$integratorPrompt = @"
You are the final integrator, not the planner.

Read AGENTS.md, .ai/runtime/REPO_MAP.md, .ai/runtime/CURRENT_TASK.md, .ai/runtime/WORKPLAN.json, the current git diff/status, and only the source ranges needed to verify the result.

The feature was already planned externally and Luna implementors have attempted the work packets. Failed packet IDs, if any: $failedText.

Do NOT restart broad planning. Instead:
1. Check the current diff against every acceptance criterion in CURRENT_TASK.md and every packet in WORKPLAN.json.
2. Complete any missing implementation, including recovery from failed Luna packets.
3. Fix integration errors, regressions, obvious edge cases, and inconsistent changes.
4. Run the broadest practical relevant checks from the project's existing scripts, prioritizing the checks named in the task/workplan and AGENTS.md.
5. Keep scope strictly to the requested task; avoid unrelated agent drift.
6. Update .ai/runtime/REPO_MAP.md only if this task materially changed file responsibilities, architecture, important entry points, or important public functions.
7. Do not commit, push, switch branches, reset, rebase, or rewrite history.

Finish with a concise implementation summary, tests/checks and their outcomes, and any remaining real limitation.
"@
Invoke-CodexRun -Model $SolModel -Effort 'medium' -Sandbox 'workspace-write' -Prompt $integratorPrompt -OutputPath $solOutput

$shapeAfterImplementation = Get-RepoFileShapeHash
if ($shapeAfterImplementation -ne $shapeBeforeImplementation) {
    Write-Host "`n[Luna] La tarea añadió/eliminó archivos; sincronizando el mapa local..." -ForegroundColor Cyan
    Refresh-RepoMap
}
else {
    Write-Utf8NoBom $shapeHashPath $shapeAfterImplementation
}

if ($script:ControlTaskCommit) {
    Write-Utf8NoBom $lastTaskCommitPath $script:ControlTaskCommit
}

Write-Host "`n==============================" -ForegroundColor Green
Write-Host 'TERMINADO' -ForegroundColor Green
Write-Host '==============================' -ForegroundColor Green
Write-Host 'Codex NO ha hecho commit ni push.'
Write-Host 'Resultado final: .ai/runtime/LAST_RESULT.md'
Write-Host "`nArchivos cambiados:"
& git status --short
Write-Host "`nPara revisar el cambio: git diff" -ForegroundColor Yellow
