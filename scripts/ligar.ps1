$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Set-Location $root
$port = 7000
$pidFile = Join-Path $root '.addon.pid'
$logDir = Join-Path $root 'logs'
$envFile = Join-Path $root '.env'

function Get-Tailscale {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $exe = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $exe) { return $exe }
  throw 'Tailscale nao instalado. Rode: winget install --id Tailscale.Tailscale -e'
}

function Get-Running {
  if (-not (Test-Path $pidFile)) { return $null }
  Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'node'
}

# .env
if (-not (Test-Path $envFile)) { throw '.env nao existe. Copie .env.example para .env e preencha.' }
$vars = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
}
$missing = 'GEMINI_API_KEY', 'OS_API_KEY' | Where-Object { -not $vars[$_] }
if ($missing) { throw "Preencha no .env: $($missing -join ', ')" }
if (-not $vars['ADDON_SECRET']) {
  $vars['ADDON_SECRET'] = [guid]::NewGuid().ToString('N')
  Add-Content $envFile "`r`nADDON_SECRET=$($vars['ADDON_SECRET'])"
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) { npm install --no-fund --no-audit }

# Tailscale: URL https fixa apontando pro PC
$ts = Get-Tailscale
$status = & $ts status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
  Write-Host 'Tailscale precisa de login, vai abrir o navegador...'
  & $ts up
  $status = & $ts status --json | ConvertFrom-Json
}
$publicUrl = 'https://' + $status.Self.DNSName.TrimEnd('.')
# Na primeira vez ele mostra um link pra habilitar o Funnel na conta
& $ts funnel --bg $port
if ($LASTEXITCODE -ne 0) { throw 'Falha ao ligar o Tailscale Funnel' }

# Addon
if (-not (Get-Running)) {
  New-Item -ItemType Directory -Force $logDir | Out-Null
  $env:PUBLIC_URL = $publicUrl
  $proc = Start-Process node -ArgumentList '--env-file=.env', 'index.js' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$logDir\out.log" -RedirectStandardError "$logDir\err.log" -PassThru
  $proc.Id | Set-Content $pidFile

  $ok = $false
  foreach ($i in 1..15) {
    Start-Sleep 1
    if ($proc.HasExited) { break }
    try { Invoke-WebRequest "http://127.0.0.1:$port/health" -UseBasicParsing | Out-Null; $ok = $true; break } catch {}
  }
  if (-not $ok) {
    Get-Content "$logDir\err.log" -ErrorAction SilentlyContinue
    & $ts funnel reset
    throw 'Addon nao subiu, veja o erro acima'
  }
}

$manifest = "$publicUrl/$($vars['ADDON_SECRET'])/manifest.json"
$manifest | Set-Clipboard
Write-Host ''
Write-Host 'Legendas IA ligado.'
Write-Host "Manifest (ja copiado): $manifest"
Write-Host 'Instale uma vez no Stremio, depois e so ligar/desligar.'
