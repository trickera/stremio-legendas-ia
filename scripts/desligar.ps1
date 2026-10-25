$root = Split-Path $PSScriptRoot
$pidFile = Join-Path $root '.addon.pid'

if (Test-Path $pidFile) {
  Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'node' | Stop-Process -Force
  Remove-Item $pidFile
}

# Tira o PC da internet. O Tailscale continua instalado, so sem nada exposto.
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) { $ts = 'C:\Program Files\Tailscale\tailscale.exe' }
if ($ts) { & $ts funnel reset }

Write-Host 'Legendas IA desligado.'
