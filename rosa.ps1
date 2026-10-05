# Arranca ROSA2018 completa en Windows: el servidor con el bucle (8765) y la
# interfaz (5174), y abre el navegador cuando el servidor ya responde. Es el
# equivalente de rosa.sh (que es de zsh y en PowerShell no hace nada; 5 de
# octubre de 2026: una compañera lo ejecutó y no salió ni una letra).
#
#   .\rosa.ps1
#
# Si PowerShell se niega a ejecutar scripts, esta forma no pide permiso:
#   powershell -ExecutionPolicy Bypass -File .\rosa.ps1
#
# Ctrl+C para parar las dos cosas.
#
# Lo que hace falta en la máquina y se comprueba aquí:
#   - uv: instala Python 3.12 y las dependencias del servidor.
#   - Node.js (npm): la interfaz.
#   - .env con ROSA_GATEWAY_KEY: la llave del AI Gateway; no se versiona.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "Falta uv, que es lo que instala Python y las dependencias de ROSA2018."
  Write-Host 'Instálalo con:   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
  Write-Host "y abre una terminal nueva antes de volver a ejecutar .\rosa.ps1"
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Falta Node.js (trae npm), que es lo que arranca la interfaz."
  Write-Host "Instálalo desde https://nodejs.org (la versión LTS), abre una terminal nueva y vuelve a ejecutar .\rosa.ps1"
  exit 1
}
if (-not (Test-Path ".env")) {
  Write-Host "Falta .env con ROSA_GATEWAY_KEY (te lo pasa quien administra ROSA2018 por un canal privado; nunca por chat ni al repo)."
  exit 1
}
if (-not (Test-Path "frontend\node_modules")) {
  Write-Host "Instalando la interfaz por primera vez..."
  Push-Location frontend
  try { cmd /c "npm install" } finally { Pop-Location }
}

# El puerto del servidor, si .env lo cambia (ROSA_PUERTO); si no, 8765.
$puerto = 8765
$linea = Get-Content ".env" | Where-Object { $_ -match '^ROSA_PUERTO=\s*(\d+)' } | Select-Object -First 1
if ($linea -and ($linea -match '^ROSA_PUERTO=\s*(\d+)')) { $puerto = [int]$Matches[1] }

$env:MLFLOW_DISABLE_AGENT_HINT = "1"
# Los textos de ROSA2018 llevan tildes y comillas latinas: sin esto, Python en
# Windows escribe la consola en la página de códigos antigua y puede fallar.
$env:PYTHONUTF8 = "1"
$env:PYTHONUNBUFFERED = "1"

# Las dos cosas en esta misma consola, para que lo que diga el servidor se
# vea aquí (si falla al arrancar, el motivo sale en estas líneas).
$servidor = Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "rosa.main" -NoNewWindow -PassThru
$interfaz = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev -- --host 127.0.0.1" -WorkingDirectory "$PSScriptRoot\frontend" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\rosa2018-interfaz.log" -RedirectStandardError "$env:TEMP\rosa2018-interfaz-errores.log"

function Parar-Todo {
  foreach ($p in @($servidor, $interfaz)) {
    if ($p -and -not $p.HasExited) { cmd /c "taskkill /PID $($p.Id) /T /F >nul 2>&1" }
  }
}

try {
  # El navegador se abre cuando el servidor contesta, no a los pocos segundos:
  # la primera vez instala todo y tarda uno o dos minutos.
  Write-Host "Arrancando ROSA2018 (la primera vez instala las dependencias y tarda uno o dos minutos)..."
  $esperado = 0
  $responde = $false
  while (-not $responde) {
    try {
      $null = Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/api/acceso/estado" -UseBasicParsing -TimeoutSec 2
      $responde = $true
    } catch {
      if ($servidor.HasExited) {
        Write-Host ""
        Write-Host "El servidor de ROSA2018 se cerró antes de arrancar. El motivo está en las líneas de arriba."
        Parar-Todo
        exit 1
      }
      if ($esperado -ge 600) {
        Write-Host ""
        Write-Host "El servidor lleva diez minutos sin responder en el puerto $puerto. Mira las líneas de arriba; si no dicen nada, cierra con Ctrl+C y vuelve a ejecutar .\rosa.ps1"
        break
      }
      Start-Sleep -Seconds 2
      $esperado += 2
      Write-Host -NoNewline "."
    }
  }
  Write-Host ""
  Start-Process "http://localhost:5174"
  Write-Host "ROSA2018: servidor en http://127.0.0.1:$puerto, interfaz en http://localhost:5174 (abre ESA dirección, no la del servidor). Ctrl+C para parar."
  Wait-Process -Id $servidor.Id
} finally {
  Parar-Todo
}
