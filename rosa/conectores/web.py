"""Web pública y reloj para el asistente, con procedencia por consulta.

Exa recupera páginas; la interpretación sigue en el modelo de ROSA por el
Gateway. No se usan sus endpoints de respuestas ni de investigación.
"""
from __future__ import annotations

import ipaddress
from datetime import datetime, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rosa import config
from rosa.conectores.base import Resultado, conector, inerte
from rosa.fuentes import exa
from rosa.fuentes.base import FuenteNoDisponible, json_de, pedir

_DOC = "https://exa.ai/docs/reference/search"
_LICENCIA = "Recuperación mediante Exa; el contenido conserva la licencia de cada sitio"
_MAX_TEXTO = 60000
_PAGINA = 5000


def _esquema(**campos: str) -> dict:
    return {"type": "object", "properties": {k: {"type": "string", "description": v} for k, v in campos.items()}, "required": [next(iter(campos))]}


def _url_publica(url: str) -> str:
    url = url.strip()
    u = urlsplit(url)
    host = (u.hostname or "").lower().rstrip(".")
    if (len(url) > 2048 or u.scheme not in {"http", "https"} or not host
            or u.username is not None or u.password is not None
            or host == "localhost" or host.endswith((".localhost", ".local", ".internal"))):
        raise ValueError("Se necesita una URL pública HTTP o HTTPS sin credenciales")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if "." not in host:
            raise ValueError("Se necesita un dominio público") from None
    else:
        if not ip.is_global:
            raise ValueError("No se permiten direcciones de redes privadas o locales")
    # Solo se envía a Exa: ROSA no conecta a esta URL ni le envía cookies.
    return url


if config.CLAVE_EXA:
    @conector(
        "buscar_web", "Exa (web pública)",
        "Busca en internet cualquier tema, noticias, documentación y páginas públicas, sin restringirse a publicaciones científicas",
        "Cinco resultados con URL, título, fecha y fragmentos; no equivale a leer la página completa",
        _esquema(consulta="Qué buscar en internet; incluye fechas, país o sitio cuando sean relevantes"),
        _LICENCIA, "5 por segundo en ROSA2018", _DOC, clave="si", grupo="web",
    )
    async def buscar_web(consulta: str) -> Resultado:
        if not consulta.strip():
            raise ValueError("Escribe qué quieres buscar en internet")
        r = await pedir("POST", f"{exa.BASE}/search", exa._limitador,
                        headers=exa._cabeceras(), json={
                            "query": consulta.strip()[:1000], "type": "auto", "numResults": 5,
                            "contents": {"text": {"maxCharacters": 1200}},
                        })
        d = json_de(r)
        if not isinstance(d.get("results"), list):
            raise FuenteNoDisponible("La búsqueda web no devolvió una lista de resultados válida")
        paginas = [{"url": x["url"], "titulo": str(x.get("title") or "")[:250],
                    "fechaPublicacion": x.get("publishedDate"),
                    "fragmento": str(x.get("text") or "")[:1200]}
                   for x in d["results"][:5] if isinstance(x, dict) and x.get("url")]
        return Resultado({"paginas": paginas, "consultadoEn": datetime.now(timezone.utc).isoformat(),
                          "alcance": "Resultados del buscador; para leer una página usa leer_pagina_web. No son un reloj en tiempo real.",
                          "costeUsd": exa._coste(d)}, len(paginas), [x["url"] for x in paginas])

    @conector(
        "leer_pagina_web", "Exa (lectura de páginas)",
        "Abre una URL pública y lee su texto por páginas de 5000 caracteres, solicitando una recuperación reciente",
        "Texto de la página con URL y fecha de consulta; no ejecuta interacciones, no inicia sesión ni supera muros de pago",
        _esquema(url="URL pública completa", desde="Posición del texto: 0 al empezar; usa siguienteDesde para continuar"),
        _LICENCIA, "5 por segundo en ROSA2018", "https://exa.ai/docs/reference/get-contents", clave="si", grupo="web",
    )
    async def leer_pagina_web(url: str, desde: str = "0") -> Resultado:
        url = _url_publica(url)
        inicio = int(desde or "0")
        if not 0 <= inicio < _MAX_TEXTO:
            raise ValueError("La posición debe estar entre 0 y 59999 caracteres")
        r = await pedir("POST", f"{exa.BASE}/contents", exa._limitador,
                        headers=exa._cabeceras(), json={
                            "urls": [url], "text": {"maxCharacters": _MAX_TEXTO},
                            "maxAgeHours": 0, "livecrawlTimeout": 10000,
                        })
        d = json_de(r)
        estados = d.get("statuses") or []
        if any(s.get("status") != "success" for s in estados):
            raise FuenteNoDisponible("El proveedor no pudo recuperar esa página; puede estar bloqueada o no disponible")
        filas = d.get("results") or []
        if not filas or not str(filas[0].get("text") or "").strip():
            raise FuenteNoDisponible("La página no devolvió texto legible; no se pudo comprobar su contenido")
        fila = filas[0]
        texto = str(fila["text"])[:_MAX_TEXTO]
        fin = min(inicio + _PAGINA, len(texto))
        final_url = _url_publica(str(fila.get("url") or url))
        datos = {"url": final_url, "urlSolicitada": url, "titulo": str(fila.get("title") or "")[:250],
                 "fechaPublicacion": fila.get("publishedDate"), "consultadoEn": datetime.now(timezone.utc).isoformat(),
                 "texto": texto[inicio:fin], "desde": inicio, "siguienteDesde": fin if fin < len(texto) else None,
                 "caracteresRecuperados": len(texto), "puedeEstarRecortado": len(texto) >= _MAX_TEXTO,
                 "origenContenido": [s.get("source") for s in estados], "costeUsd": exa._coste(d)}
        return Resultado(datos, 1, [final_url])
else:
    for nombre, descripcion in (
        ("buscar_web", "Busca cualquier tema en la web pública"),
        ("leer_pagina_web", "Lee el texto de una página pública por URL"),
    ):
        inerte(nombre, "Exa (web pública)", descripcion, "Información pública de internet",
               "requiere_cuenta", "La búsqueda web necesita una conexión de Exa configurada en ROSA.", _DOC, "web", _LICENCIA)


@conector(
    "hora_actual", "Reloj del servidor ROSA",
    "Fecha y hora actuales en una zona horaria IANA; Santo Domingo usa America/Santo_Domingo",
    "Hora calculada en este instante, sin depender de una página indexada ni del conocimiento del modelo",
    _esquema(zona="Zona IANA, por ejemplo America/Santo_Domingo, Europe/Madrid o UTC"),
    "Reloj del sistema y base de zonas horarias IANA", "Local", "https://www.iana.org/time-zones", grupo="web",
)
async def hora_actual(zona: str) -> Resultado:
    try:
        tz = ZoneInfo(zona.strip())
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Zona horaria desconocida; usa un nombre IANA como America/Santo_Domingo") from None
    utc = datetime.now(timezone.utc)
    local = utc.astimezone(tz)
    return Resultado({"zona": tz.key, "fechaHora": local.isoformat(timespec="seconds"),
                      "utc": utc.isoformat(timespec="seconds"), "fuente": "Reloj del servidor ROSA",
                      "nota": "Hora en el instante de la consulta; no proviene de una búsqueda web."}, 1)
