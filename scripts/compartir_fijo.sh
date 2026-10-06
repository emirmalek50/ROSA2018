#!/bin/zsh
# Enlace FIJO para ROSA2018 con Tailscale Funnel: https://<este-mac>.<red>.ts.net
# apuntando al servidor. Se monta UNA vez; arranca con Tailscale al iniciar
# sesión en el Mac y se reconecta solo. Sin tocar el dominio ni el DNS
# (decisión de Emir, 5 de octubre de 2026: «sin programas externos, el
# tailscale está bien», tras ver que el túnel con dominio propio exigía mover
# los DNS de alzheimerproject.com de Vercel a Cloudflare).
#
#   ./scripts/compartir_fijo.sh            monta el enlace fijo (o lo enseña si ya está)
#   ./scripts/compartir_fijo.sh --estado   el enlace y si responde con ROSA2018
#   ./scripts/compartir_fijo.sh --parar    deja de publicar; el servidor sigue
#
# Lo que hace falta ANTES, una sola vez, y que no puede hacer un script:
#   1. Instalar Tailscale:   brew install --cask tailscale-app   (pide la
#      contraseña del Mac: instala una extensión de red), o desde
#      https://tailscale.com/download. Abrir la app e iniciar sesión (Google,
#      GitHub o Microsoft). Queda en la barra de menús y arranca al iniciar sesión.
#   2. La primera vez que se publica, Tailscale pide activar Funnel en la
#      red: imprime un enlace, se abre, un clic. Este script lo enseña tal cual.
#
# Qué publica: el puerto 443 público del nombre del Mac → http://127.0.0.1:PUERTO.
# El servidor sigue escuchando solo en 127.0.0.1; Tailscale es lo único que
# entra, manda la IP real en X-Forwarded-For (los topes de intentos del acceso
# son por persona, no por túnel) y delante está la pantalla de acceso. Quien
# entra NO necesita Tailscale: Funnel es público.
set -e
cd "$(dirname "$0")/.."

PUERTO=$(grep -E '^ROSA_PUERTO=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PUERTO=${PUERTO:-8765}

TS=$(command -v tailscale 2>/dev/null || true)
[ -z "$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -z "$TS" ]; then
  echo "Falta Tailscale. Instálalo con:   brew install --cask tailscale-app   (pide la contraseña del Mac)"
  echo "o desde https://tailscale.com/download. Después abre la app, inicia sesión y vuelve a ejecutar este script."
  exit 1
fi

# Con tope de tiempo: mientras macOS tenga la extensión de red de Tailscale
# sin permitir, la app no contesta y el CLI se queda colgado para siempre (le
# pasó a Emir el 5 de octubre de 2026: el script no decía nada). macOS no trae
# `timeout`; la alarma de perl sobrevive al exec y mata la orden.
con_tope() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

# Si macOS está esperando que se permita la extensión, nada de lo demás va a
# funcionar: se dice dónde está el botón y se para.
extension_bloqueada() { systemextensionsctl list 2>/dev/null | grep -i tailscale | grep -q "waiting for user"; }
AVISO_EXTENSION="macOS tiene bloqueada la extensión de red de Tailscale (está «esperando al usuario»). Permítela en Ajustes del Sistema > General > Ítems de inicio y extensiones > Extensiones de red (o en Privacidad y seguridad, abajo, «Permitir»), acepta el aviso de «añadir configuraciones VPN», inicia sesión en la app de Tailscale y vuelve a ejecutar este script."

# El nombre fijo de este Mac en la red de Tailscale (sin el punto final).
nombre() {
  con_tope 10 "$TS" status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("Self") or {}).get("DNSName","").rstrip("."))' 2>/dev/null || true
}
estado_backend() {
  con_tope 10 "$TS" status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null || true
}
# Comprobar desde FUERA de verdad. En este Mac el nombre ts.net lo resuelve
# MagicDNS a la IP interna (100.x) y la petición ni sale a internet: el 6 de
# octubre de 2026 «--estado» decía que respondía mientras el enlace público
# llevaba 17 horas cerrando cada conexión. Se resuelve el nombre en un DNS
# público (los relés de Tailscale) y se fuerza la petición por ese relé.
responde() {
  local ip
  ip=$(dig @8.8.8.8 "$1" A +short 2>/dev/null | head -1)
  if [ -z "$ip" ]; then
    curl -s -m 10 "https://$1/api/acceso/estado" 2>/dev/null | grep -q '"accesoConfigurado"'
  else
    curl -s -m 15 --resolve "$1:443:$ip" "https://$1/api/acceso/estado" 2>/dev/null | grep -q '"accesoConfigurado"'
  fi
}

if extension_bloqueada; then
  echo "$AVISO_EXTENSION"
  exit 1
fi

case "${1:-}" in
  --estado)
    N=$(nombre)
    if [ -z "$N" ]; then echo "Tailscale no está conectado (estado: ${$(estado_backend):-sin respuesta de la app}). Abre la app de Tailscale e inicia sesión."; exit 1; fi
    echo "Nombre fijo de este Mac: https://$N"
    con_tope 15 "$TS" funnel status 2>/dev/null | sed 's/^/  /' || true
    if responde "$N"; then
      echo "https://$N responde con ROSA2018 desde internet."
    else
      echo "https://$N NO responde desde internet aunque Funnel esté encendido."
      echo "Lo que lo arregló el 6 de octubre de 2026: cerrar la app de Tailscale (icono de la barra de menús > Quit) y volver a abrirla; el Mac había cambiado de red y los relés de Tailscale no lo encontraban. Después, ./scripts/compartir_fijo.sh --estado otra vez."
    fi
    exit 0 ;;
  --parar)
    con_tope 30 "$TS" funnel reset && echo "Ya no se publica. El servidor sigue en http://127.0.0.1:$PUERTO"
    exit 0 ;;
esac

ESTADO=$(estado_backend)
if [ "$ESTADO" != "Running" ]; then
  echo "Tailscale no está conectado (estado: ${ESTADO:-sin respuesta de la app}). Abre la app de Tailscale (barra de menús), inicia sesión y vuelve a ejecutar este script."
  exit 1
fi
if ! curl -s -m 3 -o /dev/null "http://127.0.0.1:$PUERTO/api/acceso/estado"; then
  echo "El servidor de ROSA2018 no responde en el puerto $PUERTO. Arráncalo primero (./rosa.sh o ./scripts/reiniciar_servidor.sh)."
  exit 1
fi
N=$(nombre)
if [ -z "$N" ]; then
  echo "Tailscale no da un nombre para este Mac. Activa MagicDNS y HTTPS en https://login.tailscale.com/admin/dns y vuelve a ejecutar."
  exit 1
fi

# Publicar: el 443 público del nombre → el servidor local. `--bg` lo deja
# guardado en Tailscale, que lo vuelve a levantar en cada arranque. Si Funnel
# no está activado en la red, Tailscale imprime el enlace para activarlo (un
# clic) y SE QUEDA ESPERANDO a que se haga: por eso su salida va directa a la
# pantalla y no capturada (la primera versión la capturaba y Emir estuvo tres
# minutos mirando una terminal muda, 5 de octubre de 2026). El vigilante de
# fondo lo corta a los diez minutos; la alarma de perl no mata este binario.
echo "Publicando en Tailscale (si pide activar Funnel, abre el enlace que salga, pulsa Enable y espera aquí)..."
set +e
"$TS" funnel --bg "$PUERTO" 2>&1 | sed 's/^/  /' &
TUBERIA=$!
( sleep 600; pkill -f "Tailscale funnel --bg $PUERTO" 2>/dev/null ) &
VIGILANTE=$!
wait $TUBERIA
CODIGO=$?
kill $VIGILANTE 2>/dev/null
set -e
if [ $CODIGO -ne 0 ]; then
  echo
  echo "Tailscale no pudo publicar. Si arriba hay un enlace para activar Funnel, ábrelo, acepta, y vuelve a ejecutar este script."
  exit $CODIGO
fi

echo "Esperando a que https://$N responda con ROSA2018..."
for i in $(seq 1 30); do
  if responde "$N"; then
    echo "ROSA2018 está en https://$N, de forma permanente: arranca con el Mac y no cambia."
    echo "Quien entre crea su cuenta con su correo @alzheimerproject.com y ve los mismos datos. Dejar de publicar: ./scripts/compartir_fijo.sh --parar"
    exit 0
  fi
  sleep 3
done
echo "Publicado, pero https://$N todavía no responde con ROSA2018; el certificado HTTPS del nombre tarda un minuto la primera vez. Comprueba con ./scripts/compartir_fijo.sh --estado"
