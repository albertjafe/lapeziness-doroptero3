$ErrorActionPreference = "Stop"

$ProjectRef = "fexfeekifzgszluemihs"
$FunctionName = "google-calendar"
$UseNpx = -not [bool](Get-Command supabase -ErrorAction SilentlyContinue)

function Invoke-Supabase([string[]]$Arguments) {
  $displayArgs = ($Arguments -join " ")
  Write-Host "  supabase $displayArgs" -ForegroundColor DarkGray
  if ($UseNpx) {
    & npx supabase @Arguments
  } else {
    & supabase @Arguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "El comando 'supabase $displayArgs' falló con código $LASTEXITCODE."
  }
}

function Invoke-Step([string]$title) {
  Write-Host ""
  Write-Host "==> $title" -ForegroundColor Cyan
}

if ($UseNpx) {
  Invoke-Step "Comprobando Supabase CLI (se usará npx supabase)"
} else {
  Invoke-Step "Comprobando Supabase CLI"
}

Invoke-Step "Inicia sesión en Supabase (se abrirá el navegador)"
Invoke-Supabase @("login")

Invoke-Step "Vinculando el proyecto $ProjectRef"
Invoke-Supabase @("link", "--project-ref", $ProjectRef)

Invoke-Step "Credenciales de Google OAuth"
$clientId = Read-Host "GOOGLE_CLIENT_ID"
$clientSecretSecure = Read-Host "GOOGLE_CLIENT_SECRET" -AsSecureString
if (-not $clientId -or -not $clientSecretSecure) {
  throw "Faltan el Client ID o el Client Secret."
}
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($clientSecretSecure)
$clientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Invoke-Step "Generando clave de cifrado (32 bytes, Base64URL)"
$keyBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
$encryptionKey = [Convert]::ToBase64String($keyBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

Invoke-Step "Configurando secretos de la función"
Invoke-Supabase @(
  "secrets", "set",
  "GOOGLE_CLIENT_ID=$clientId",
  "GOOGLE_CLIENT_SECRET=$clientSecret",
  "GOOGLE_TOKEN_ENCRYPTION_KEY=$encryptionKey"
)

Invoke-Step "Desplegando la función $FunctionName"
Invoke-Supabase @("functions", "deploy", $FunctionName)

Write-Host ""
Write-Host "Listo: la función quedó desplegada." -ForegroundColor Green
Write-Host ""
Write-Host "Pendiente por hacer una sola vez (si aún no lo has hecho):" -ForegroundColor Yellow
Write-Host "  1. Supabase -> SQL Editor -> pega supabase/migrations/202608170002_google_calendar.sql y pulsa Run."
Write-Host "  2. Google Cloud: añade la URI de redirección autorizada:"
Write-Host "     https://fexfeekifzgszluemihs.supabase.co/functions/v1/google-calendar/callback"
Write-Host "     y el origen autorizado https://albertjafe.github.io"
