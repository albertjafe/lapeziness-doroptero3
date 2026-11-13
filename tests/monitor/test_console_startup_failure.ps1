$ErrorActionPreference = 'Stop'
$reader = Join-Path $PSScriptRoot '../../scripts/monitor/console-reservations.ps1'
. $reader -LibraryOnly
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('monitor-startup-failure-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
$log = Join-Path $fixture 'monitor.log'
# No executable exists: exercise the real launcher failure path without running
# the production monitor or an unsigned fixture blocked by Windows policy.
$output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $reader -MonitorDirectory $fixture -Profile fixture -LogPath $log 2>&1
if ($LASTEXITCODE -ne 1) { throw 'El fallo de arranque debe devolver codigo 1' }
if (($output -join "`n") -notmatch 'No se pudo iniciar el monitor') { throw 'Falta el aviso breve de arranque fallido' }
if (-not (Test-Path -LiteralPath ($log + '.launcher.log'))) { throw 'El error no se guardo en disco' }
if ((Get-Content -LiteralPath ($log + '.launcher.log') -Raw) -notmatch 'Monitor Alberto.exe') { throw 'Falta el detalle del ejecutable' }
# Simulate a policy rejection; never relax or bypass the machine's policy.
try { throw (New-Object ComponentModel.Win32Exception(577, 'Firma digital bloqueada')) }
catch { $output = Write-MonitorStartupFailure -Failure $_ -LogPath $log 6>&1 }
if (($output -join "`n") -notmatch 'Windows ha bloqueado') { throw 'Falta la explicacion del bloqueo de Windows' }
if ((Get-Content -LiteralPath ($log + '.launcher.log') -Raw) -notmatch 'Firma digital bloqueada') { throw 'No se conserva la causa del bloqueo' }
# An unwritable diagnostics path must still expose the original cause.
try { throw 'Causa original de prueba' }
catch { $output = Write-MonitorStartupFailure -Failure $_ -LogPath (Join-Path $fixture 'missing/monitor.log') 6>&1 }
if (($output -join "`n") -notmatch 'Causa original de prueba') { throw 'Se perdio el error al fallar el guardado' }
Write-Output 'OK: fallo de arranque visible, codigo 1, bloqueo explicado y detalle persistido sin iniciar procesos de reservas.'
