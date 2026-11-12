param([string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
if (-not $FixtureDirectory) { $FixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('monitor-console-smoke-' + [guid]::NewGuid()) }
New-Item -ItemType Directory -Force -Path $FixtureDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $FixtureDirectory 'data') | Out-Null
$exe = Join-Path $FixtureDirectory 'Monitor Alberto.exe'
# A local stand-in: no browser, credentials, network or reservations.
Add-Type -OutputAssembly $exe -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Text;
public class MonitorConsoleFixture {
    public static int Main() {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.WriteLine("[HTTP] technical detail retained");
        Console.Error.WriteLine("technical stderr retained");
        var command = Console.ReadLine();
        Console.WriteLine("stdin=" + command);
        var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data", "telegram_log_fixture.txt");
        File.AppendAllText(path, "[2026-11-12 12:30:00] [BOT\u2192] Reserva aula 123 VERIFICADA\n", new UTF8Encoding(false));
        return command == "estado" ? 0 : 9;
    }
}
'@
$reader = Join-Path $PSScriptRoot '../../scripts/monitor/console-reservations.ps1'
$log = Join-Path $FixtureDirectory 'logs/monitor.log'
$output = 'estado' | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $reader -MonitorDirectory $FixtureDirectory -Profile fixture -LogPath $log 2>&1
if ($LASTEXITCODE -ne 0) { throw ('El lanzador no conserva stdin/código de salida: ' + $LASTEXITCODE + ' ' + ($output -join ' ')) }
$visible = $output -join "`n"
if ($visible -notmatch 'Reserva aula 123' -or $visible -match 'technical detail|technical stderr|stdin=') { throw ('Salida filtrada incorrecta: ' + $visible) }
if ((Get-Content -LiteralPath $log -Raw) -notmatch 'technical detail retained|stdin=estado') { throw 'Log técnico incompleto' }
if ((Get-Content -LiteralPath ($log + '.stderr.log') -Raw) -notmatch 'technical stderr retained') { throw 'Falta stderr' }
Write-Output 'OK: proceso simulado, stdin, salida breve, logs completos y código de salida conservados.'
