#!/bin/zsh
# Enlace FIJO para ROSA2018 (rosa.alzheimerproject.com) que arranca solo al
# iniciar sesión en el Mac y se reconecta si se cae: Cloudflare Tunnel «con
# nombre». Se monta UNA vez; después no hay nada que repetir (Emir, 5 de
# octubre de 2026: «¿no hay forma de hacerlo sin tener que repetirlo siempre?»).
#
#   ./scripts/compartir_fijo.sh                      monta rosa.alzheimerproject.com
#   ./scripts/compartir_fijo.sh otro.alzheimerproject.com
#   ./scripts/compartir_fijo.sh --estado
#
# Lo que hace falta ANTES, y que no se puede hacer desde un script:
#   1. Una cuenta de Cloudflare (gratis) con la zona alzheimerproject.com, es
#      decir, los DNS del dominio en Cloudflare. Hoy están en Vercel: hay que
#      recrear en Cloudflare los registros que apuntan a Vercel (modo «DNS
#      only») y cambiar los servidores de nombres en el registrador. La web
#      sigue en Vercel; solo cambia quién responde el DNS.
#   2. `cloudflared tunnel login` una vez: abre el navegador, se elige la zona
#      y deja el certificado en ~/.cloudflared/cert.pem.
#
# Qué hace: crea el túnel «rosa» si no existe, escribe ~/.cloudflared/config.yml
# (el nombre → http://127.0.0.1:PUERTO), apunta el DNS del nombre al túnel e
# instala el servicio de usuario (LaunchAgent) que lo arranca al iniciar
# sesión. El servidor de ROSA2018 sigue escuchando solo en 127.0.0.1: el túnel
# es lo único que entra, y delante está la pantalla de acceso.
#
# NO PROBADO desde aquí: requiere la cuenta. Las órdenes son las de la
# documentación de Cloudflare (tunnel create / route dns / service install).
set -e
cd "$(dirname "$0")/.."

NOMBRE=rosa
HOST=${1:-rosa.alzheimerproject.com}
PUERTO=$(grep -E '^ROSA_PUERTO=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PUERTO=${PUERTO:-8765}
CONF="$HOME/.cloudflared/config.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Falta cloudflared. Instálalo con:   brew install cloudflared"
  exit 1
fi

if [ "$HOST" = "--estado" ]; then
  if [ -f "$CONF" ]; then
    echo "Configuración: $CONF"; sed 's/^/  /' "$CONF"
    launchctl list 2>/dev/null | grep -q cloudflared && echo "Servicio de usuario: instalado (arranca al iniciar sesión)" || echo "Servicio de usuario: NO instalado"
    H=$(grep -E '^\s*-?\s*hostname:' "$CONF" | head -1 | sed 's/.*hostname:\s*//')
    [ -n "$H" ] && { curl -s -m 8 "https://$H/api/acceso/estado" | grep -q '"accesoConfigurado"' && echo "https://$H responde con ROSA2018" || echo "https://$H no responde (todavía) con ROSA2018"; }
  else
    echo "No hay túnel fijo montado."
  fi
  exit 0
fi

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "Falta el certificado de la cuenta. Ejecuta una vez:   cloudflared tunnel login"
  echo "(abre el navegador; elige la zona alzheimerproject.com, que tiene que estar en Cloudflare) y vuelve a ejecutar este script."
  exit 1
fi

if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$NOMBRE"; then
  echo "Creando el túnel «$NOMBRE»..."
  cloudflared tunnel create "$NOMBRE"
fi
ID=$(cloudflared tunnel list -o json | python3 -c 'import json,sys; print(next(t["id"] for t in json.load(sys.stdin) if t["name"] == sys.argv[1]))' "$NOMBRE")
if [ -z "$ID" ]; then
  echo "No encuentro el identificador del túnel «$NOMBRE»."
  exit 1
fi

mkdir -p "$HOME/.cloudflared"
cat > "$CONF" <<EOF
# Escrito por scripts/compartir_fijo.sh ($(date '+%Y-%m-%d %H:%M')).
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PUERTO
  - service: http_status:404
EOF
echo "Configuración escrita en $CONF ($HOST -> http://127.0.0.1:$PUERTO)"

# El DNS del nombre al túnel. Si ya existe (segunda ejecución), lo dice y sigue.
cloudflared tunnel route dns "$NOMBRE" "$HOST" 2>&1 | sed 's/^/  /' || true

# El servicio de usuario: arranca al iniciar sesión y se reconecta solo.
if launchctl list 2>/dev/null | grep -q cloudflared; then
  echo "El servicio ya estaba instalado; se reinicia para tomar la configuración."
  launchctl kickstart -k "gui/$(id -u)/com.cloudflare.cloudflared" 2>/dev/null || true
else
  cloudflared service install
fi

echo "Esperando a que https://$HOST responda con ROSA2018..."
for i in $(seq 1 40); do
  if curl -s -m 8 "https://$HOST/api/acceso/estado" 2>/dev/null | grep -q '"accesoConfigurado"'; then
    echo "ROSA2018 está en https://$HOST, de forma permanente. Nada que repetir: arranca con el Mac."
    exit 0
  fi
  sleep 3
done
echo "Todavía no responde; el DNS nuevo puede tardar unos minutos. Comprueba con ./scripts/compartir_fijo.sh --estado"
