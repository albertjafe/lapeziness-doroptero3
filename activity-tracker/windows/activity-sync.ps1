param(
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$TrackerRoot = Join-Path $env:LOCALAPPDATA 'PianoAppActivityTracker'
$ConfigPath = Join-Path $TrackerRoot 'config.json'
$StatePath = Join-Path $TrackerRoot 'state.json'
$ActivityWatchBase = 'http://127.0.0.1:5600/api/0'

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Write-JsonFile([string]$Path, $Value) {
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-ConfigToken($Config) {
  if ($Config -and -not [string]::IsNullOrWhiteSpace([string]$Config.TokenProtected)) {
    try {
      $secure = ConvertTo-SecureString ([string]$Config.TokenProtected)
      return [System.Net.NetworkCredential]::new('', $secure).Password
    } catch { return '' }
  }
  # Compatibilidad con una instalación antigua. El nuevo instalador ya no escribe esto.
  if ($Config -and -not [string]::IsNullOrWhiteSpace([string]$Config.Token)) { return [string]$Config.Token }
  return ''
}

function Get-Hash([string]$Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

function Get-LocalDate([datetimeoffset]$When) {
  return $When.ToLocalTime().ToString('yyyy-MM-dd')
}

function Get-OffsetMinutes([datetimeoffset]$When) {
  return [int][Math]::Round([TimeZoneInfo]::Local.GetUtcOffset($When.LocalDateTime).TotalMinutes)
}

function Get-Domain([string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
  try {
    $uri = [Uri]$Url
    if (-not $uri.IsAbsoluteUri -or [string]::IsNullOrWhiteSpace($uri.Host)) { return $null }
    $host = $uri.Host.ToLowerInvariant()
    if ($host.StartsWith('www.')) { $host = $host.Substring(4) }
    return $host
  } catch { return $null }
}

function Test-SensitiveDomain([string]$Domain) {
  if ([string]::IsNullOrWhiteSpace($Domain)) { return $false }
  return $Domain -match '(?i)(bankinter|caixabank|myinvestor|traderepublic|trade-republic|paypal|revolut|wise\.com|n26\.com|1password|bitwarden|lastpass|password|login\.microsoftonline|accounts\.google|auth0|stripe\.com)'
}

function Get-Category([string]$App, [string]$Domain, [bool]$Private) {
  if ($Private) { return 'private' }
  $d = [string]$Domain
  $a = [string]$App
  if ($d -match '(?i)(chatgpt\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com)') { return 'ai' }
  if ($d -match '(?i)(web\.whatsapp\.com|discord\.com|slack\.com|teams\.microsoft\.com|mail\.google\.com|outlook\.(live|office)\.com)') { return 'communication' }
  if ($d -match '(?i)(instagram\.com|reddit\.com|(^|\.)x\.com$|twitter\.com|tiktok\.com|facebook\.com|threads\.net)') { return 'social' }
  if ($d -match '(?i)(youtube\.com|youtu\.be|netflix\.com|twitch\.tv|spotify\.com|primevideo\.com|disneyplus\.com)') { return 'entertainment' }
  if ($d -match '(?i)(github\.com|stackoverflow\.com|notion\.so|docs\.google\.com|sheets\.google\.com|drive\.google\.com|figma\.com|canva\.com)') { return 'productive' }
  if ($a -match '(?i)(musescore|sibelius|dorico|finale|pianoteq|forScore)') { return 'piano' }
  if ($a -match '(?i)(code\.exe|visual studio|devenv|powershell|windows terminal|cmd\.exe|excel|winword|powerpnt|notion|obsidian|acrobat|audition|reaper|cubase|logic)') { return 'productive' }
  if ($a -match '(?i)(spotify|steam|epicgames|discord)') { return 'entertainment' }
  if (-not [string]::IsNullOrWhiteSpace($d)) { return 'browsing' }
  return 'other'
}

function New-NormalizedEvent($BucketId, $Bucket, $Event) {
  $type = [string]$Bucket.type
  $timestamp = [datetimeoffset]::Parse([string]$Event.timestamp)
  $duration = [double]$Event.duration
  if ($duration -le 0) { return $null }
  $ended = $timestamp.AddSeconds($duration)
  $eventId = if ($null -ne $Event.id) { [string]$Event.id } else { Get-Hash("$BucketId|$($Event.timestamp)|$($Event.duration)|$($Event.data | ConvertTo-Json -Compress -Depth 5)") }
  $source = 'activitywatch_other'
  $app = $null
  $domain = $null
  $private = $false
  $isAfk = $false

  if ($type -eq 'currentwindow' -or $BucketId -like 'aw-watcher-window_*') {
    $source = 'activitywatch_window'
    $app = [string]$Event.data.app
  } elseif ($type -eq 'web.tab.current' -or $BucketId -like 'aw-watcher-web*') {
    $source = 'activitywatch_web'
    $app = 'Navegador'
    $private = [bool]$Event.data.incognito
    if (-not $private) { $domain = Get-Domain ([string]$Event.data.url) }
    if (Test-SensitiveDomain $domain) { $private = $true; $domain = $null }
  } elseif ($type -eq 'afkstatus' -or $BucketId -like 'aw-watcher-afk_*') {
    $source = 'activitywatch_afk'
    $isAfk = ([string]$Event.data.status) -eq 'afk'
    $app = if ($isAfk) { 'Ausente' } else { 'Activo' }
  } else {
    return $null
  }

  $category = Get-Category -App $app -Domain $domain -Private $private
  return [ordered]@{
    source = $source
    external_id = "$BucketId`:$eventId"
    started_at = $timestamp.UtcDateTime.ToString('o')
    ended_at = $ended.UtcDateTime.ToString('o')
    local_date = Get-LocalDate $timestamp
    tz_offset_minutes = Get-OffsetMinutes $timestamp
    app = if ([string]::IsNullOrWhiteSpace($app)) { $null } else { $app.Substring(0, [Math]::Min(160, $app.Length)) }
    domain = if ([string]::IsNullOrWhiteSpace($domain)) { $null } else { $domain.Substring(0, [Math]::Min(220, $domain.Length)) }
    category = $category
    label = $null
    is_afk = $isAfk
  }
}

function Get-AwEvents([string]$BucketId, [datetimeoffset]$Start, [datetimeoffset]$End) {
  $id = [Uri]::EscapeDataString($BucketId)
  $startText = [Uri]::EscapeDataString($Start.UtcDateTime.ToString('o'))
  $endText = [Uri]::EscapeDataString($End.UtcDateTime.ToString('o'))
  $url = "$ActivityWatchBase/buckets/$id/events?start=$startText&end=$endText&limit=-1"
  return @(Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 20)
}

function Send-Batch($Config, [string]$Token, [array]$Events) {
  if (-not $Events.Count) { return 0 }
  $accepted = 0
  for ($i = 0; $i -lt $Events.Count; $i += 400) {
    $last = [Math]::Min($i + 399, $Events.Count - 1)
    $chunk = @($Events[$i..$last])
    $body = [ordered]@{
      mode = 'batch'
      device_id = [string]$Config.DeviceId
      device_type = 'windows'
      events = $chunk
    } | ConvertTo-Json -Depth 10
    $result = Invoke-RestMethod -Uri ([string]$Config.Endpoint) -Method Post -ContentType 'application/json' -Headers @{ 'x-activity-token' = $Token } -Body $body -TimeoutSec 30
    $accepted += [int]$result.accepted
  }
  return $accepted
}

function Invoke-SyncOnce {
  if (-not (Test-Path $TrackerRoot)) { New-Item -ItemType Directory -Path $TrackerRoot -Force | Out-Null }
  $config = Read-JsonFile $ConfigPath
  $token = Get-ConfigToken $config
  if (-not $config -or [string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace([string]$config.Endpoint)) {
    throw "Falta o no se puede descifrar la configuración privada de $ConfigPath. Ejecuta primero install.ps1."
  }

  try {
    $buckets = Invoke-RestMethod -Uri "$ActivityWatchBase/buckets" -Method Get -TimeoutSec 10
  } catch {
    throw 'ActivityWatch no responde en http://127.0.0.1:5600. Ábrelo y vuelve a intentarlo.'
  }

  $state = Read-JsonFile $StatePath
  $end = [datetimeoffset]::UtcNow
  $lookbackHours = if ($config.InitialLookbackHours) { [double]$config.InitialLookbackHours } else { 24.0 }
  $start = if ($state -and $state.lastSyncedAt) {
    ([datetimeoffset]::Parse([string]$state.lastSyncedAt)).AddMinutes(-2)
  } else {
    $end.AddHours(-1 * [Math]::Max(1, [Math]::Min(72, $lookbackHours)))
  }

  $normalized = New-Object System.Collections.Generic.List[object]
  foreach ($property in $buckets.PSObject.Properties) {
    $bucketId = [string]$property.Name
    $bucket = $property.Value
    $type = [string]$bucket.type
    if ($type -notin @('currentwindow', 'web.tab.current', 'afkstatus') -and $bucketId -notlike 'aw-watcher-window_*' -and $bucketId -notlike 'aw-watcher-web*' -and $bucketId -notlike 'aw-watcher-afk_*') { continue }
    try {
      foreach ($event in (Get-AwEvents -BucketId $bucketId -Start $start -End $end)) {
        $item = New-NormalizedEvent -BucketId $bucketId -Bucket $bucket -Event $event
        if ($item) { $normalized.Add($item) }
      }
    } catch {
      Write-Warning "No se pudo leer $bucketId`: $($_.Exception.Message)"
    }
  }

  $events = @($normalized | Sort-Object started_at)
  $accepted = Send-Batch -Config $config -Token $token -Events $events
  Write-JsonFile $StatePath ([ordered]@{ lastSyncedAt = $end.UtcDateTime.ToString('o'); lastAccepted = $accepted; updatedAt = [datetimeoffset]::UtcNow.ToString('o') })
  Write-Host "Actividad sincronizada: $accepted bloques aceptados ($($events.Count) revisados)."
}

if ($Once) {
  Invoke-SyncOnce
  exit 0
}

while ($true) {
  try { Invoke-SyncOnce } catch { Write-Warning $_.Exception.Message }
  Start-Sleep -Seconds 300
}
