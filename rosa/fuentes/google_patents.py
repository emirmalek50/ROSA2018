"""Google Patents mediante la API documentada de SerpApi, proveedor independiente.

Contrato: https://serpapi.com/google-patents-api y
https://serpapi.com/google-patents-details-api. La cobertura describe estas
consultas acotadas, nunca ausencia mundial de patentes ni libertad de operación.
Las reivindicaciones y los metadatos recuperados son datos externos inertes.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlsplit
from weakref import WeakKeyDictionary

from rosa.fuentes.base import FuenteNoDisponible, compartido, pedir

BASE = "https://serpapi.com/search.json"
FUENTE = "Google Patents (SerpApi)"
MAX_CONSULTAS = 4
MAX_PAGINAS = 2
TAMANO_PAGINA = 10
MAX_DETALLES = 8
MAX_TEXTO = 12000
_LIMITADOR = compartido("serpapi.com", 3)
_PUBLICACION = re.compile(r"[A-Z]{2}(?:RE|PP|D|T|H|S)?\d{4,14}[A-Z]\d{0,2}\Z")
_PATENT_ID = re.compile(r"patent/([^/]+)(?:/([a-z]{2}))?\Z")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_CLAVE_LOG: ContextVar[str] = ContextVar("serpapi_clave_log", default="")
_SEMAFOROS: WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = WeakKeyDictionary()
_PARAMETRO_SECRETO = re.compile(r"(?i)(api_key(?:=|%3d))[^&\s\"'<>]+")
_CAMPOS = (
    "abstract", "abstract_original", "claims", "claims_translated", "assignees", "assignee",
    "inventors", "inventor", "family_id", "priority_year", "priority_date", "prior_art_date",
    "filing_date", "grant_date", "publication_date", "application_number", "publication_number",
    "country", "country_status", "prior_art_keywords", "worldwide_applications", "events",
    "classifications", "child_applications", "parent_applications", "priority_applications",
    "applications_claiming_priority", "patent_citations", "non_patent_citations", "cited_by",
    "similar_documents", "legal_events", "legal_status", "description_link", "description_link_translated",
)


def _fecha() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clave() -> str:
    from rosa.credenciales_patentes import clave
    return clave() or ""


def _redactar_texto(texto: str, clave: str) -> str:
    if clave:
        texto = texto.replace(clave, "[CLAVE_OCULTA]")
    return _PARAMETRO_SECRETO.sub(r"\1[CLAVE_OCULTA]", texto)


class _RedaccionSerpApi(logging.Filter):
    """HTTPX registra la URL: se conserva el mensaje, ocultando la credencial."""

    def filter(self, record: logging.LogRecord) -> bool:
        mensaje = record.getMessage()
        clave = _CLAVE_LOG.get()
        if clave or "serpapi.com" in mensaje.lower():
            limpio = _redactar_texto(mensaje, clave)
            if limpio != mensaje:
                record.msg, record.args = limpio, ()
        return True


_FILTRO_LOG = _RedaccionSerpApi()
for _nombre_logger in ("httpx", "httpcore.connection", "httpcore.http11", "httpcore.http2"):
    logging.getLogger(_nombre_logger).addFilter(_FILTRO_LOG)


def _limpiar(valor: Any, clave: str) -> Any:
    if isinstance(valor, str):
        return _redactar_texto(valor, clave)
    if isinstance(valor, list):
        return [_limpiar(v, clave) for v in valor]
    if isinstance(valor, dict):
        return {_redactar_texto(str(k), clave): _limpiar(v, clave) for k, v in valor.items() if str(k).lower() not in {"api_key", "apikey", "authorization"}}
    return valor


def _numero(valor: Any) -> int | None:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and valor >= 0 else None


def _parametros(consulta: str) -> dict[str, Any]:
    return {"engine": "google_patents", "q": consulta, "num": TAMANO_PAGINA, "patents": "true", "scholar": "false", "dups": "language"}


def _registro(parametros: dict[str, Any]) -> dict[str, Any]:
    return {
        "fuente": FUENTE, "consulta": parametros.get("q", parametros.get("patent_id", "")),
        "url": BASE, "parametros": dict(parametros), "fecha": _fecha(), "total": None,
        "recuperados": 0, "paginas": 0, "completa": False, "error": None, "sha256": None,
    }


class _Sesion:
    def __init__(self, clave: str, resultado: dict[str, Any]):
        self.clave = clave
        self.resultado = resultado
        # Varias hipótesis pueden consultar a la vez; comparten el límite en
        # el bucle del servidor, sin vincularlo a los bucles aislados de tests.
        bucle = asyncio.get_running_loop()
        self.semaforo = _SEMAFOROS.setdefault(bucle, asyncio.Semaphore(3))

    def incompleta(self, motivo: str) -> None:
        self.resultado["googlePatents"]["estado"] = "parcial"
        if motivo not in self.resultado["limitaciones"]:
            self.resultado["limitaciones"].append(motivo)

    async def consultar(self, parametros: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        registro = _registro(parametros)
        self.resultado["consultas"].append(registro)
        async with self.semaforo:
            token = _CLAVE_LOG.set(self.clave)
            try:
                self.resultado["consumo"]["serpapiConsultas"] += 1
                # Un intento hace que el contador corresponda a peticiones HTTP;
                # no hay reintentos ocultos ni redirecciones con la credencial.
                respuesta = await pedir("GET", BASE, _LIMITADOR, params={**parametros, "api_key": self.clave}, intentos=1, timeout=20.0, follow_redirects=False)
                if respuesta.status_code != 200:
                    registro["error"] = f"No comprobado: HTTP {respuesta.status_code}."
                    return None, registro
                registro["sha256"] = hashlib.sha256(respuesta.content).hexdigest()
                cuerpo = respuesta.json()
                if not isinstance(cuerpo, dict):
                    registro["error"] = "No comprobado: la respuesta no es un objeto JSON."
                    return None, registro
                metadata = cuerpo.get("search_metadata")
                if not isinstance(metadata, dict) or metadata.get("status") != "Success" or cuerpo.get("error"):
                    registro["error"] = "No comprobado: SerpApi no confirmó una respuesta final satisfactoria."
                    return None, registro
                registro["metadatos"] = {k: metadata[k] for k in ("id", "status", "created_at", "processed_at") if k in metadata}
                registro["paginas"] = 1
                return cuerpo, registro
            except (FuenteNoDisponible, ValueError, TypeError):
                # La excepción HTTP puede llevar api_key en URL o cuerpo. No se
                # copia, registra ni interpola su mensaje bajo ninguna condición.
                registro["error"] = "No comprobado: no pude obtener una respuesta válida de SerpApi."
                return None, registro
            finally:
                _CLAVE_LOG.reset(token)


def _identidad(fila: dict[str, Any]) -> tuple[str, str] | None:
    publicacion = fila.get("publication_number")
    if not isinstance(publicacion, str) or not _PUBLICACION.fullmatch(publicacion):
        return None
    idioma = "en"
    patent_id = fila.get("patent_id")
    if patent_id is not None:
        coincidencia = _PATENT_ID.fullmatch(patent_id) if isinstance(patent_id, str) else None
        if coincidencia is None or coincidencia[1] != publicacion:
            return None
        idioma = coincidencia[2] or idioma
    enlace = fila.get("patent_link")
    if enlace is not None:
        try:
            url = urlsplit(enlace) if isinstance(enlace, str) and not _CONTROL.search(enlace) else None
            coincidencia = _PATENT_ID.fullmatch(url.path.lstrip("/")) if url else None
            if (url is None or url.scheme != "https" or url.hostname != "patents.google.com" or url.username or url.password
                    or url.port not in (None, 443) or coincidencia is None or coincidencia[1] != publicacion):
                return None
        except ValueError:
            return None
    return publicacion, f"patent/{publicacion}/{idioma}"


def _documento(fila: dict[str, Any], identidad: tuple[str, str]) -> dict[str, Any]:
    publicacion, patent_id = identidad
    titulo_recibido, texto_recibido = fila.get("title"), fila.get("snippet")
    titulo = titulo_recibido if isinstance(titulo_recibido, str) else "Publicación de patente"
    texto = texto_recibido if isinstance(texto_recibido, str) else ""
    return {
        "id": f"patente-{publicacion}", "url": f"https://patents.google.com/{patent_id}",
        "titulo": titulo, "texto": texto[:MAX_TEXTO], "fuente": FUENTE, "identificador": publicacion,
        "datos": {**{k: fila[k] for k in _CAMPOS if k in fila}, "patent_id": patent_id,
                  "textoExterno": True, "tipoTexto": "resumen", "reivindicacionesLeidas": False,
                  "estadoJuridicoVerificado": False, "detalleComprobado": False,
                  "textoTruncado": len(texto) > MAX_TEXTO},
    }


def _siguiente(cuerpo: dict[str, Any], consulta: str) -> tuple[int | None, bool]:
    """Solo extrae el número de página; nunca sigue una URL de la respuesta."""
    paginacion = cuerpo.get("serpapi_pagination")
    if paginacion is None:
        return None, False
    if not isinstance(paginacion, dict):
        return None, True
    siguiente = paginacion.get("next")
    if not siguiente:
        return None, False
    try:
        if not isinstance(siguiente, str) or _CONTROL.search(siguiente):
            return None, True
        url = urlsplit(siguiente)
        if (url.scheme != "https" or url.hostname != "serpapi.com" or url.username or url.password
                or url.port not in (None, 443) or url.path not in ("/search", "/search.json")):
            return None, True
        params = parse_qs(url.query)
        if params.get("engine", ["google_patents"]) != ["google_patents"] or params.get("q", [consulta]) != [consulta]:
            return None, True
        paginas = params.get("page", [])
        if len(paginas) != 1 or not paginas[0].isdigit() or len(paginas[0]) > 6:
            return None, True
        return int(paginas[0]), False
    except (TypeError, ValueError):
        return None, True


async def _buscar_consulta(sesion: _Sesion, consulta: str, documentos: dict[str, dict[str, Any]]) -> None:
    parametros = _parametros(consulta)
    paginas_vistas: set[int] = set()
    publicaciones_vistas: set[str] = set()
    total_anterior: int | None = None
    for indice in range(MAX_PAGINAS):
        cuerpo, registro = await sesion.consultar(parametros)
        if cuerpo is None:
            sesion.incompleta("No pude comprobar al menos una página de resultados de Google Patents mediante SerpApi.")
            return
        info = cuerpo.get("search_information")
        info = info if isinstance(info, dict) else {}
        total = _numero(info.get("total_results"))
        registro["total"] = total
        actual = _numero(info.get("page_number"))
        if actual is not None:
            if actual in paginas_vistas or ("page" in parametros and actual != parametros["page"]):
                registro["error"] = "No comprobado: la API repitió o cambió la página solicitada."
                sesion.incompleta("La paginación de Google Patents no fue consistente.")
                return
            paginas_vistas.add(actual)
        if total_anterior is not None and total is not None and total != total_anterior:
            sesion.incompleta("El total de resultados cambió entre páginas; la búsqueda no es una instantánea estable.")
        total_anterior = total
        filas = cuerpo.get("organic_results", [] if total == 0 else None)
        if not isinstance(filas, list):
            registro["error"] = "No comprobado: falta una lista válida de resultados de patentes."
            sesion.incompleta("No pude comprobar la estructura de una página de Google Patents.")
            return
        if len(filas) > TAMANO_PAGINA:
            sesion.incompleta("La API devolvió más de diez resultados en una página; se conservaron los primeros diez.")
        for fila in filas[:TAMANO_PAGINA]:
            identidad = _identidad(fila) if isinstance(fila, dict) else None
            if identidad is None:
                sesion.incompleta("Se omitió una publicación con identidad ausente, inválida o contradictoria.")
                continue
            publicacion = identidad[0]
            if publicacion in publicaciones_vistas:
                sesion.incompleta("Google Patents repitió una publicación dentro de la paginación de una consulta.")
                continue
            publicaciones_vistas.add(publicacion)
            registro["recuperados"] += 1
            documentos.setdefault(publicacion, _documento(fila, identidad))
        siguiente, invalida = _siguiente(cuerpo, consulta)
        if invalida or siguiente in paginas_vistas:
            registro["error"] = "No comprobado: la siguiente página no tiene una referencia válida y progresiva."
            sesion.incompleta("No se siguió una referencia de paginación inválida o repetida.")
            return
        if siguiente is None:
            if total is not None and len(publicaciones_vistas) == total and len(filas) <= TAMANO_PAGINA:
                registro["completa"] = True
            else:
                sesion.incompleta("No se pudo verificar el agotamiento de los resultados frente al total publicado por la API.")
            return
        if indice + 1 == MAX_PAGINAS:
            sesion.incompleta("Búsqueda limitada a dos páginas de diez resultados por consulta; quedaron páginas sin recuperar.")
            return
        parametros = {**_parametros(consulta), "page": siguiente}


async def _detalle(sesion: _Sesion, documento: dict[str, Any]) -> None:
    identidad = documento["identificador"]
    cuerpo, registro = await sesion.consultar({"engine": "google_patents_details", "patent_id": documento["datos"]["patent_id"]})
    if cuerpo is None:
        sesion.incompleta(f"No pude comprobar los detalles de {identidad}; se conserva su resumen de búsqueda.")
        return
    if cuerpo.get("type") != "patent" or cuerpo.get("publication_number") != identidad:
        registro["error"] = "No comprobado: el detalle no corresponde a la publicación solicitada."
        sesion.incompleta(f"Se rechazó un detalle de identidad contradictoria para {identidad}.")
        return
    claims = cuerpo.get("claims", [])
    if not isinstance(claims, list) or any(not isinstance(c, str) for c in claims):
        registro["error"] = "No comprobado: las reivindicaciones no tienen el formato documentado."
        sesion.incompleta(f"No pude comprobar las reivindicaciones de {identidad}; se conserva su resumen.")
        return
    datos = documento["datos"]
    datos.update({k: cuerpo[k] for k in _CAMPOS if k in cuerpo})
    datos.update({"tipoTexto": "contenido", "detalleComprobado": True,
                  "reivindicacionesLeidas": bool(claims), "reivindicacionesRecuperadas": len(claims)})
    if isinstance(cuerpo.get("title"), str):
        documento["titulo"] = cuerpo["title"]
    partes = ["Reivindicaciones:\n" + "\n".join(claims)] if claims else []
    if isinstance(cuerpo.get("abstract"), str):
        partes.append("Resumen:\n" + cuerpo["abstract"])
    # Estos campos permiten al juez citar familia, titularidad y fechas sin
    # convertir el estado comunicado por Google en una verificación jurídica.
    metadatos = {k: datos[k] for k in _CAMPOS if k in datos and k not in {"claims", "claims_translated", "abstract", "abstract_original", "description_link", "description_link_translated"}}
    if metadatos:
        partes.append("Metadatos comunicados por Google Patents (sin verificación jurídica):\n" + json.dumps(metadatos, ensure_ascii=False, sort_keys=True))
    texto = "\n\n".join(partes)
    documento["texto"] = texto[:MAX_TEXTO]
    datos["textoTruncado"] = len(texto) > MAX_TEXTO
    datos["caracteresTextoCompleto"] = len(texto)
    datos["reivindicacionesCompletasEnTexto"] = bool(claims) and len(partes[0]) <= MAX_TEXTO
    registro.update({"total": 1, "recuperados": 1, "completa": True})
    if not claims:
        sesion.incompleta(f"El detalle de {identidad} no aportó reivindicaciones; no se comprobó su alcance.")
    if datos["textoTruncado"]:
        sesion.incompleta(f"El texto de {identidad} se limitó a {MAX_TEXTO} caracteres; los datos estructurados conservan todas las reivindicaciones y metadatos recibidos.")


def _resultado() -> dict[str, Any]:
    return {
        "documentos": [], "consultas": [], "limitaciones": [
            "SerpApi es un intermediario independiente, no una API oficial de Google.",
            "La cobertura se limita a las consultas realizadas; no acredita ausencia mundial de patentes, vigencia jurídica ni libertad de operación.",
            "Se recuperan los detalles estructurados de la API; no se descargan PDF ni páginas adicionales de descripción.",
            "El coste monetario de SerpApi es desconocido y depende de la cuenta; costeUsd solo refleja el coste Exa compatible, aquí cero.",
        ],
        "googlePatents": {"proveedor": "serpapi", "protocolo": 1, "estado": "completa", "consultadoEn": _fecha()},
        "consumo": {"serpapiConsultas": 0}, "costeUsd": 0,
    }


async def buscar(consultas: list[str]) -> dict[str, Any]:
    """Recupera búsqueda y detalles con identidad exacta y cobertura visible."""
    resultado = _resultado()
    clave = _clave()
    sesion = _Sesion(clave, resultado)
    terminos: list[str] = []
    for consulta in consultas if isinstance(consultas, list) else []:
        if not isinstance(consulta, str) or not consulta.strip() or _CONTROL.search(consulta) or len(consulta) > 2000:
            sesion.incompleta("Se omitió una consulta vacía, inválida o de más de 2000 caracteres.")
            continue
        consulta = consulta.strip()
        if consulta not in terminos:
            terminos.append(consulta)
    if len(terminos) > MAX_CONSULTAS:
        sesion.incompleta("Búsqueda limitada a las primeras cuatro consultas únicas.")
    if not clave or not terminos:
        registro = _registro(_parametros(terminos[0] if terminos else ""))
        registro["error"] = "No comprobado: falta configurar la clave de SerpApi." if not clave else "No comprobado: no se recibieron consultas válidas."
        resultado["consultas"].append(registro)
        resultado["limitaciones"].append(registro["error"])
        resultado["googlePatents"]["estado"] = "no_comprobado"
        return _limpiar(resultado, clave)
    documentos: dict[str, dict[str, Any]] = {}
    for consulta in terminos[:MAX_CONSULTAS]:
        await _buscar_consulta(sesion, consulta, documentos)
    resultado["documentos"] = list(documentos.values())
    if len(documentos) > MAX_DETALLES:
        sesion.incompleta("Se consultaron detalles de las primeras ocho publicaciones únicas; las demás conservan solo resúmenes de búsqueda.")
    # TaskGroup cancela y espera los hijos si la corrida se cancela o falla.
    async with asyncio.TaskGroup() as grupo:
        for documento in resultado["documentos"][:MAX_DETALLES]:
            grupo.create_task(_detalle(sesion, documento))
    if not any(r["paginas"] and not r["error"] for r in resultado["consultas"]):
        resultado["googlePatents"]["estado"] = "no_comprobado"
    return _limpiar(resultado, clave)


async def probar_conexion(*, credencial: str | None = None) -> dict[str, Any]:
    """Una sola búsqueda fija, sin detalles ni páginas adicionales."""
    resultado = _resultado()
    clave = _clave() if credencial is None else credencial
    if not clave:
        consulta = _registro(_parametros("Alzheimer"))
        consulta["error"] = "No comprobado: falta configurar la clave de SerpApi."
        return {"ok": False, "detalle": consulta["error"], "consulta": consulta}
    cuerpo, consulta = await _Sesion(clave, resultado).consultar(_parametros("Alzheimer"))
    if cuerpo is not None:
        info = cuerpo.get("search_information")
        total = _numero(info.get("total_results")) if isinstance(info, dict) else None
        filas = cuerpo.get("organic_results", [] if total == 0 else None)
        if isinstance(filas, list):
            consulta.update({"total": total, "recuperados": len(filas)})
            return _limpiar({"ok": True, "detalle": "Conexión comprobada con la API de Google Patents de SerpApi mediante una búsqueda de prueba.", "consulta": consulta}, clave)
        consulta["error"] = "No comprobado: respuesta sin una lista válida de resultados."
    return _limpiar({"ok": False, "detalle": consulta["error"], "consulta": consulta}, clave)
