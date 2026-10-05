#!/bin/zsh
# Arranca ROSA2018 completa: el servidor con el bucle (8765) y la interfaz (5174),
# y abre el navegador cuando el servidor ya responde. Ctrl+C para parar las dos.
#
# Lo que hace falta en la máquina y por qué se comprueba aquí (5 de octubre de
# 2026: una compañera clonó el repo y la pantalla solo decía «Reintentar»; el
# servidor se lanzaba en segundo plano y, si `uv` no estaba, moría sin que nada
# lo dijera mientras la interfaz sí arrancaba):
#   - uv: instala Python 3.12 y las dependencias del servidor.
#   - Node.js (npm): la interfaz.
#   - .env con ROSA_GATEWAY_KEY: la llave del AI Gateway; no se versiona.
set -e
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "Falta uv, que es lo que instala Python y las dependencias de ROSA2018."
  echo "Instálalo con:   curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "y abre una terminal nueva antes de volver a ejecutar ./rosa.sh"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node.js (trae npm), que es lo que arranca la interfaz."
  echo "Instálalo desde https://nodejs.org (la versión LTS) y vuelve a ejecutar ./rosa.sh"
  exit 1
fi
if [ ! -f .env ]; then
  echo "Falta .env con ROSA_GATEWAY_KEY (se copia del .env del RAG, o te lo pasa quien administra ROSA2018; nunca por chat ni al repo)."
  exit 1
fi
if [ ! -d frontend/node_modules ]; then
  echo "Instalando la interfaz por primera vez..."
  (cd frontend && npm install)
fi

# El puerto del servidor, si .env lo cambia (ROSA_PUERTO); si no, 8765.
PUERTO=$(grep -E '^ROSA_PUERTO=' .env | cut -d= -f2 | tr -d '[:space:]')
PUERTO=${PUERTO:-8765}

export MLFLOW_DISABLE_AGENT_HINT=1
uv run python -m rosa.main &
SERVIDOR=$!
(cd frontend && npm run dev -- --host 127.0.0.1 >/dev/null 2>&1) &
INTERFAZ=$!

trap 'kill $SERVIDOR $INTERFAZ 2>/dev/null; wait $SERVIDOR $INTERFAZ 2>/dev/null; exit 0' INT TERM

# El navegador se abre cuando el servidor contesta, no a los cuatro segundos:
# la primera vez instala todo y tarda uno o dos minutos, y abrir antes
# enseñaba «Reintentar» sin motivo.
echo "Arrancando ROSA2018 (la primera vez instala las dependencias y tarda uno o dos minutos)..."
ESPERADO=0
while ! curl -s -m 2 -o /dev/null "http://127.0.0.1:$PUERTO/api/acceso/estado"; do
  if ! kill -0 $SERVIDOR 2>/dev/null; then
    echo
    echo "El servidor de ROSA2018 se cerró antes de arrancar. El motivo está en las líneas de arriba."
    kill $INTERFAZ 2>/dev/null || true
    exit 1
  fi
  if [ $ESPERADO -ge 600 ]; then
    echo
    echo "El servidor lleva diez minutos sin responder en el puerto $PUERTO. Mira las líneas de arriba; si no dicen nada, prueba a cerrar con Ctrl+C y volver a ejecutar ./rosa.sh"
    break
  fi
  sleep 2
  ESPERADO=$((ESPERADO + 2))
  printf '.'
done
echo
open "http://localhost:5174" 2>/dev/null || true
echo "ROSA2018: servidor en http://127.0.0.1:$PUERTO, interfaz en http://localhost:5174 (abre ESA dirección, no la del servidor). Ctrl+C para parar."
wait
