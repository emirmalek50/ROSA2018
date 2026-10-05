#!/bin/zsh
# Saca ROSA2018 a un enlace público para que el equipo entre a ESTE servidor,
# con ESTOS datos (decisión de Emir, 5 de octubre de 2026: una sola ROSA2018 y
# todo el mundo con la misma base; cada copia del repo arranca vacía).
#
#   ./scripts/compartir.sh            arranca el túnel y escribe el enlace
#   ./scripts/compartir.sh --estado   el enlace actual, si el túnel está vivo
#   ./scripts/compartir.sh --parar    cierra el túnel (el servidor sigue)
#
# Es un túnel rápido de Cloudflare (`cloudflared tunnel --url`): sin cuenta,
# HTTPS, y el enlace cambia cada vez que se arranca. Para el Mac que estará
# siempre encendido hace falta un túnel con nombre y dominio fijo (ver
# PENDIENTE.md). El túnel solo reenvía al 127.0.0.1: el servidor no escucha en
# la red, y quien entra pasa por la pantalla de acceso como todo el mundo.
set -e
cd "$(dirname "$0")/.."

PUERTO=$(grep -E '^ROSA_PUERTO=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PUERTO=${PUERTO:-8765}
PID_TUNEL=/tmp/rosa2018-tunel.pid
LOG_TUNEL=/tmp/rosa2018-tunel.log

vivo() { [ -f "$PID_TUNEL" ] && kill -0 "$(cat "$PID_TUNEL")" 2>/dev/null; }
enlace() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_TUNEL" 2>/dev/null | head -1; }

case "${1:-}" in
  --estado)
    if vivo; then echo "Túnel vivo (pid $(cat "$PID_TUNEL")): $(enlace)"; else echo "No hay túnel abierto."; fi
    exit 0 ;;
  --parar)
    if vivo; then kill "$(cat "$PID_TUNEL")" && rm -f "$PID_TUNEL" && echo "Túnel cerrado. El servidor sigue en http://127.0.0.1:$PUERTO"; else echo "No había túnel abierto."; fi
    exit 0 ;;
esac

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Falta cloudflared. Instálalo con:   brew install cloudflared"
  exit 1
fi
if ! curl -s -m 3 -o /dev/null "http://127.0.0.1:$PUERTO/api/acceso/estado"; then
  echo "El servidor de ROSA2018 no responde en el puerto $PUERTO. Arráncalo primero (./rosa.sh o ./scripts/reiniciar_servidor.sh)."
  exit 1
fi
if vivo; then
  echo "Ya hay un túnel abierto: $(enlace)"
  exit 0
fi

: > "$LOG_TUNEL"
nohup cloudflared tunnel --url "http://127.0.0.1:$PUERTO" --no-autoupdate > "$LOG_TUNEL" 2>&1 &
echo $! > "$PID_TUNEL"
for i in $(seq 1 30); do
  URL=$(enlace)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "El túnel no dio un enlace en 30 s. Lo que dijo está en $LOG_TUNEL"
  exit 1
fi
# Primero, que el túnel haya conectado con Cloudflare (hasta 60 s); probar el
# nombre antes de eso deja una resolución negativa en la caché del sistema y
# luego falla un rato aunque el túnel ya funcione (es lo que pasó la primera
# vez, el 5 de octubre de 2026).
for i in $(seq 1 60); do
  grep -q "Registered tunnel connection" "$LOG_TUNEL" 2>/dev/null && break
  sleep 1
done
# Después se comprueba desde fuera, hasta dos minutos: que conteste ROSA2018 y
# no una página de error del túnel.
for i in $(seq 1 40); do
  if curl -s -m 8 "$URL/api/acceso/estado" 2>/dev/null | grep -q '"accesoConfigurado"'; then
    echo "ROSA2018 está compartida en:  $URL"
    echo "Quien entre crea su cuenta con su correo @alzheimerproject.com y ve los mismos datos que tú. Cerrar: ./scripts/compartir.sh --parar"
    exit 0
  fi
  sleep 3
done
echo "El enlace es $URL pero desde aquí todavía no responde con ROSA2018. Ábrelo en el navegador: si carga la pantalla de acceso, funciona (el nombre tarda en propagarse). Si no, lo que dijo el túnel está en $LOG_TUNEL"
exit 1
