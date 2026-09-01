from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'{label}: source snippet not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Load the PWA self tracker from the already-loaded companion module.
ux = Path('study-session-ux.js')
text = ux.read_text(encoding='utf-8')
marker = "activitySelfTrackerScript"
if marker not in text:
    text += r'''

// Uso de la propia PWA: solo visibilidad + sección, nunca contenido escrito.
(function loadActivitySelfTracker() {
  'use strict';
  if (window.ActivitySelfTracker || document.getElementById('activitySelfTrackerScript')) return;
  const script = document.createElement('script');
  script.id = 'activitySelfTrackerScript';
  script.src = './activity-self-tracker.js?v=1';
  script.async = true;
  document.head.appendChild(script);
}());
'''
    ux.write_text(text, encoding='utf-8')


# Protect the personal ingestion token with Windows DPAPI instead of plaintext.
install = Path('activity-tracker/windows/install.ps1')
text = install.read_text(encoding='utf-8')
old_prompt = """if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host ''
  Write-Host 'Pega el token personal del tracker que te dio ChatGPT.' -ForegroundColor Yellow
  $Token = Read-Host 'Token'
}
"""
new_prompt = """if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host ''
  Write-Host 'Pega el token personal del tracker que te dio ChatGPT. No se mostrará en pantalla.' -ForegroundColor Yellow
  $secureToken = Read-Host 'Token' -AsSecureString
  $Token = [System.Net.NetworkCredential]::new('', $secureToken).Password
}
"""
if old_prompt in text:
    text = text.replace(old_prompt, new_prompt, 1)
old_config = "  Token = $Token.Trim()\n"
new_config = "  TokenProtected = ConvertFrom-SecureString (ConvertTo-SecureString $Token.Trim() -AsPlainText -Force)\n"
if old_config in text:
    text = text.replace(old_config, new_config, 1)
install.write_text(text, encoding='utf-8')


sync = Path('activity-tracker/windows/activity-sync.ps1')
text = sync.read_text(encoding='utf-8')
if 'function Get-ConfigToken' not in text:
    anchor = """function Write-JsonFile([string]$Path, $Value) {
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

"""
    addition = anchor + """function Get-ConfigToken($Config) {
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

"""
    if anchor not in text:
        raise SystemExit('activity-sync token helper anchor missing')
    text = text.replace(anchor, addition, 1)

old_send = "function Send-Batch($Config, [array]$Events) {"
new_send = "function Send-Batch($Config, [string]$Token, [array]$Events) {"
if old_send in text:
    text = text.replace(old_send, new_send, 1)
text = text.replace("'x-activity-token' = [string]$Config.Token", "'x-activity-token' = $Token")
old_check = """  $config = Read-JsonFile $ConfigPath
  if (-not $config -or [string]::IsNullOrWhiteSpace([string]$config.Token) -or [string]::IsNullOrWhiteSpace([string]$config.Endpoint)) {
    throw \"Falta $ConfigPath. Ejecuta primero install.ps1.\"
  }
"""
new_check = """  $config = Read-JsonFile $ConfigPath
  $token = Get-ConfigToken $config
  if (-not $config -or [string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace([string]$config.Endpoint)) {
    throw \"Falta o no se puede descifrar la configuración privada de $ConfigPath. Ejecuta primero install.ps1.\"
  }
"""
if old_check in text:
    text = text.replace(old_check, new_check, 1)
old_call = "$accepted = Send-Batch -Config $config -Events $events"
new_call = "$accepted = Send-Batch -Config $config -Token $token -Events $events"
if old_call in text:
    text = text.replace(old_call, new_call, 1)
sync.write_text(text, encoding='utf-8')


readme = Path('activity-tracker/README.md')
text = readme.read_text(encoding='utf-8')
if 'DPAPI' not in text:
    needle = "- `%LOCALAPPDATA%\\PianoAppActivityTracker\\activity-sync.ps1`\n"
    replacement = needle + "\nEl token se guarda cifrado con **Windows DPAPI**, ligado a tu usuario de Windows; no queda en texto plano dentro de `config.json`.\n"
    if needle not in text:
        raise SystemExit('README Windows files marker missing')
    text = text.replace(needle, replacement, 1)
if 'Uso de la propia PWA' not in text:
    needle = "## En la app\n"
    addition = """## Uso de la propia PWA

Sin instalar nada adicional, la propia PWA registra cuando está **visible** y la sección abierta (`Hoy`, `Cronómetro`, `Obras`, etc.) en iPhone, iPad, Windows o Mac. Los bloques se encolan localmente si no hay conexión y se suben al volver a tener sesión/red.

No registra texto de tareas, contenido de obras, teclas, campos escritos ni modales. El objetivo es saber cuándo y cuánto se usó la app en cada dispositivo.

""" + needle
    if needle not in text:
        raise SystemExit('README app marker missing')
    text = text.replace(needle, addition, 1)
readme.write_text(text, encoding='utf-8')
