param(
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
$solOutput = Join-Path $runtimeDir 'LAST_RESULT.md'
$localReport = Join-Path $runtimeDir 'CODEX_TO_CHATGPT.md'
$localPatch = Join-Path $runtimeDir 'LAST_WORKSPACE.patch'
$watcherTaskBlobPath = Join-Path $runtimeDir 'watcher-last-task-blob.txt'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Get-CurrentTaskBlob {
    & git fetch origin $ControlBranch --quiet
    if ($LASTEXITCODE -ne 0) { throw "No pude descargar origin/$ControlBranch." }
    $spec = "origin/${ControlBranch}:$ControlTaskPath"
    $blob = ((& git rev-parse $spec 2>$null) -join '').Trim()
    if (-not $blob -or $LASTEXITCODE -ne 0) {
        throw "No pude identificar el blob de $ControlTaskPath en origin/$ControlBranch."
    }
    return $blob
}

function Get-WorkspacePatch {
    $tempIndex = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-handoff-index-" + [guid]::NewGuid().ToString('N'))
    $oldIndex = $env:GIT_INDEX_FILE
    try {
        Remove-Item $tempIndex -Force -ErrorAction SilentlyContinue
        $env:GIT_INDEX_FILE = $tempIndex
        & git read-tree HEAD
        if ($LASTEXITCODE -ne 0) { throw 'No pude preparar el índice temporal del handoff.' }
        & git add -A
        if ($LASTEXITCODE -ne 0) { throw 'No pude capturar el estado actual del workspace.' }
        return ((& git diff --cached --binary --full-index HEAD) -join "`n")
    }
    finally {
        if ($null -eq $oldIndex) { Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue }
        else { $env:GIT_INDEX_FILE = $oldIndex }
        Remove-Item $tempIndex -Force -ErrorAction SilentlyContinue
    }
}

$taskBlob = Get-CurrentTaskBlob
$branch = ((& git branch --show-current) -join '').Trim()
$head = ((& git rev-parse HEAD) -join '').Trim()
$status = ((& git status --short) -join "`n").Trim()
$solText = if (Test-Path $solOutput) { Get-Content -Raw $solOutput } else { 'No existe .ai/runtime/LAST_RESULT.md.' }
$patch = Get-WorkspacePatch
$generatedAt = (Get-Date).ToUniversalTime().ToString('o')

$report = @"
# Codex → ChatGPT handoff

STATUS: READY_FOR_REVIEW
GENERATED_AT: $generatedAt
TASK_BLOB: $taskBlob
LOCAL_BRANCH: $branch
LOCAL_HEAD: $head

## Working tree

````text
$status
````

## Sol final report

$solText

## Review material

The exact current workspace patch, including untracked files, is published beside this file as `.ai/LAST_WORKSPACE.patch` on the `ai-control` branch.
ChatGPT should read this report and that patch before issuing the next task.
"@

Write-Utf8NoBom $localReport $report
Write-Utf8NoBom $localPatch $patch

$tempWorktree = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-control-handoff-" + [guid]::NewGuid().ToString('N'))
try {
    & git worktree add --detach $tempWorktree "origin/$ControlBranch" --quiet
    if ($LASTEXITCODE -ne 0) { throw 'No pude crear el worktree temporal para publicar el handoff.' }

    $remoteAiDir = Join-Path $tempWorktree '.ai'
    New-Item -ItemType Directory -Force -Path $remoteAiDir | Out-Null
    Write-Utf8NoBom (Join-Path $remoteAiDir 'CODEX_TO_CHATGPT.md') $report
    Write-Utf8NoBom (Join-Path $remoteAiDir 'LAST_WORKSPACE.patch') $patch

    Push-Location $tempWorktree
    try {
        & git add .ai/CODEX_TO_CHATGPT.md .ai/LAST_WORKSPACE.patch
        if ($LASTEXITCODE -ne 0) { throw 'No pude preparar el handoff para commit.' }

        & git -c user.name='Codex Bridge' -c user.email='codex-bridge@local' commit -m 'Publish Codex handoff for ChatGPT' --quiet
        if ($LASTEXITCODE -ne 0) { throw 'No pude crear el commit del handoff.' }

        & git push origin "HEAD:$ControlBranch" --quiet
        if ($LASTEXITCODE -ne 0) {
            & git fetch origin $ControlBranch --quiet
            & git rebase "origin/$ControlBranch" --quiet
            if ($LASTEXITCODE -ne 0) { throw 'El buzón ai-control cambió y no pude rebasar el handoff automáticamente.' }
            & git push origin "HEAD:$ControlBranch" --quiet
            if ($LASTEXITCODE -ne 0) { throw 'No pude publicar el handoff en ai-control.' }
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    & git worktree remove --force $tempWorktree 2>$null | Out-Null
    Remove-Item $tempWorktree -Recurse -Force -ErrorAction SilentlyContinue
}

# Marcar esta versión de CURRENT_TASK como ya atendida por el watcher. Los
# commits del buzón no cambian este blob, así que no generan bucles.
Write-Utf8NoBom $watcherTaskBlobPath $taskBlob

Write-Host "`nHandoff publicado en origin/$ControlBranch" -ForegroundColor Green
Write-Host 'Ya puedes volver a ChatGPT y escribir solamente: sigue' -ForegroundColor Green
