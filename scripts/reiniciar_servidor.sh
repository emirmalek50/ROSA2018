#!/usr/bin/env bash
# Reinicia el servidor de ROSA2018 de la única manera segura: parando primero
# con el guardián (scripts/parar_servidor.py), que se niega si hay una corrida
# viva. Si la parada no se hace, aquí no se arranca nada: nunca dos procesos
# escribiendo sobre la misma base, que es lo que bifurca el registro.
#
#   ./scripts/reiniciar_servidor.sh
#   ./scripts/reiniciar_servidor.sh --forzar --motivo "el servidor no responde"
set -euo pipefail
cd "$(dirname "$0")/.."

PY=./.venv/bin/python
LOG="${ROSA_LOG:-/tmp/rosa2018-servidor.log}"

echo "== estado antes de tocar nada =="
$PY scripts/parar_servidor.py --estado

echo
echo "== parando =="
set +e
$PY scripts/parar_servidor.py "$@"
CODIGO=$?
set -e

# 0 = paró bien. 3 = no había servidor, así que se puede arrancar.
if [ "$CODIGO" != "0" ] && [ "$CODIGO" != "3" ]; then
  echo
  echo "No se arranca nada: la parada no se completó (código $CODIGO)."
  exit "$CODIGO"
fi

echo
echo "== arrancando =="
set -a
# shellcheck disable=SC1091
[ -f .env ] && source .env
set +a
MLFLOW_DISABLE_AGENT_HINT=1 PYTHONUNBUFFERED=1 nohup $PY -m rosa.main > "$LOG" 2>&1 &
PID=$!
echo "arrancado con pid $PID; el registro va a $LOG"

for _ in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8765/; then
    echo "el servidor responde en http://127.0.0.1:8765"
    exit 0
  fi
  sleep 2
done
echo "el servidor no respondió a tiempo; mira $LOG"
exit 1
