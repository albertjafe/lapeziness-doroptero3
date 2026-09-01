param(
  [string]$Token = '',
  [switch]$SkipActivityWatch,
  [switch]$SkipBrowserHelp
)

$ErrorActionPreference = 'Stop'
$TrackerRoot = Join-Path $env:LOCALAPPDATA 'PianoAppActivityTracker'
$SyncPath = Join-Path $TrackerRoot 'activity-sync.ps1'
$ConfigPath = Join-Path $TrackerRoot 'config.json'
$Endpoint = 'https://fexfeekifzgszluemihs.supabase.co/functions/v1/activity-tracker'
$SyncSource = 'https://raw.githubusercontent.com/albertjafe/lapeziness-doroptero3/main/activity-tracker/windows/activity-sync.ps1'

function Test-ActivityWatch {
  try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:5600/api/0/info' -Method Get -TimeoutSec 3 | Out-Null
    return $true
  } catch { return $false }
}

function Try-InstallActivityWatch {
  Write-Host 'ActivityWatch no está activo. Intentando instalar la versión estable oficial…' -ForegroundColor Cyan
  try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ActivityWatch/activitywatch/releases/latest' -Headers @{ 'User-Agent' = 'PianoAppActivityTracker' }
    $asset = @($release.assets | Where-Object { $_.name -match '(?i)\.exe$' -and $_.name -notmatch '(?i)research' -and $_.name -match '(?i)(setup|activitywatch)' }) | Select-Object -First 1
    if (-not $asset) { throw 'No se encontró el instalador de Windows en la última release.' }
    $installer = Join-Path $env:TEMP ([string]$asset.name)
    Invoke-WebRequest -Uri ([string]$asset.browser_download_url) -OutFile $installer -UseBasicParsing
    Start-Process -FilePath $installer -Wait
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Warning "No pude instalar ActivityWatch automáticamente: $($_.Exception.Message)"
    Write-Host 'Puedes instalarlo manualmente desde https://activitywatch.net/ y volver a ejecutar este instalador.'
  }
}

function Try-StartActivityWatch {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'ActivityWatch\aw-qt.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'ActivityWatch\aw-qt.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ActivityWatch\aw-qt.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count) {
    try { Start-Process -FilePath $candidates[0] | Out-Null; Start-Sleep -Seconds 4 } catch {}
  }
}

function Register-SyncTask {
  $taskName = 'PianoAppActivitySync'
  $taskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$SyncPath`" -Once"
  try {
    & schtasks.exe /Create /TN $taskName /TR $taskCommand /SC MINUTE /MO 5 /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks devolvió $LASTEXITCODE" }
    Write-Host 'Sincronización automática: cada 5 minutos.' -ForegroundColor Green
    return $true
  } catch {
    Write-Warning 'No se pudo crear la tarea programada. Crearé un arranque automático alternativo.'
    $startup = [Environment]::GetFolderPath('Startup')
    $cmdPath = Join-Path $startup 'PianoAppActivitySync.cmd'
    @"
@echo off
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$SyncPath"
"@ | Set-Content -LiteralPath $cmdPath -Encoding ASCII
    return $false
  }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host ''
  Write-Host 'Pega el token personal del tracker que te dio ChatGPT. No se mostrará en pantalla.' -ForegroundColor Yellow
  $secureToken = Read-Host 'Token' -AsSecureString
  $Token = [System.Net.NetworkCredential]::new('', $secureToken).Password
}
if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 24) { throw 'El token no parece válido.' }

New-Item -ItemType Directory -Path $TrackerRoot -Force | Out-Null
Write-Host 'Descargando el sincronizador del tracker…' -ForegroundColor Cyan
Invoke-WebRequest -Uri $SyncSource -OutFile $SyncPath -UseBasicParsing

$config = [ordered]@{
  Endpoint = $Endpoint
  TokenProtected = ConvertFrom-SecureString (ConvertTo-SecureString $Token.Trim() -AsPlainText -Force)
  DeviceId = ('windows-' + $env:COMPUTERNAME.ToLowerInvariant())
  InitialLookbackHours = 24
  InstalledAt = [datetimeoffset]::Now.ToString('o')
}
$config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

if (-not (Test-ActivityWatch) -and -not $SkipActivityWatch) { Try-InstallActivityWatch; Try-StartActivityWatch }

Register-SyncTask | Out-Null

if (Test-ActivityWatch) {
  Write-Host 'ActivityWatch detectado. Haciendo la primera sincronización…' -ForegroundColor Green
  try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SyncPath -Once } catch { Write-Warning $_.Exception.Message }
} else {
  Write-Warning 'ActivityWatch todavía no está abierto. Ábrelo una vez; después la sincronización automática empezará sola.'
}

if (-not $SkipBrowserHelp) {
  Write-Host ''
  Write-Host 'Para saber qué DOMINIO visitas (sin subir la URL completa), instala también aw-watcher-web.' -ForegroundColor Cyan
  Write-Host 'Abriré la documentación oficial de los watchers del navegador.'
  try { Start-Process 'https://docs.activitywatch.net/en/latest/watchers.html#browser-watchers' } catch {}
}

Write-Host ''
Write-Host 'Listo.' -ForegroundColor Green
Write-Host "Configuración privada: $ConfigPath"
Write-Host 'Se suben solo bloques reducidos: programa/dominio/categoría/duración. No títulos, teclas ni URL completas.'
