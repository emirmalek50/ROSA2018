"""Búsquedas institucionales acotadas, con acceso y contenido verificables.

Contratos oficiales consultados el 8 de octubre de 2026:
https://dev.elsevier.com/documentation/EmbaseAPI.wadl
https://dev.elsevier.com/documentation/ScopusSearchAPI.wadl
https://dev.elsevier.com/sc_search_views.html
https://developer.clarivate.com/apis/wos-starter/swagger
https://developer.ebsco.com/eds-api/docs/performing-a-search
https://developer.ebsco.com/eds-api/docs/making-your-first-request

EDS no documenta un parámetro dbid para Search. Una consulta de descubrimiento
identifica el DbId en Statistics.Databases y su faceta ContentProvider; después
se busca con esa faceta y se comprueba el DbId de cada registro. La consulta de
descubrimiento nunca aporta artículos. Una clave configurada no acredita licencia.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import re
from contextvars import ContextVar
from datetime import datetime, timezone
from html import unescape
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlsplit

import httpx

from rosa import credenciales_academicas
from rosa.fuentes.base import compartido, referencia_corta

MAX_PAGINAS = 2
TAMANO_PAGINA = 10
MAX_BYTES = 8 * 1024 * 1024
EMBASE = "https://api.elsevier.com/content/embase/article"
SCOPUS = "https://api.elsevier.com/content/search/scopus"
WOS = "https://api.clarivate.com/apis/wos-starter/v1/documents"
EDS = "https://eds-api.ebscohost.com/edsapi/rest/"
AUTH = "https://eds-api.ebscohost.com/authservice/rest/uidauth"
_ENDPOINTS = {EMBASE, SCOPUS, WOS, AUTH, *(EDS + x for x in ("createsession", "info", "search", "endsession"))}
_REQUERIDOS = {
    "embase": ("elsevier_api_key",), "scopus": ("elsevier_api_key",),
    "web_of_science": ("wos_api_key",),
    "cinahl": ("ebsco_user", "ebsco_password", "ebsco_profile", "cinahl_db"),
    "psycinfo": ("ebsco_user", "ebsco_password", "ebsco_profile", "psycinfo_db"),
}
_SECRETOS: ContextVar[tuple[str, ...]] = ContextVar("academicas_secretos", default=())


def _limpiar(v: Any) -> Any:
    if isinstance(v, str):
        for secreto in _SECRETOS.get():
            if secreto:
                v = v.replace(secreto, "[ACCESO_OCULTO]")
        return v
    if isinstance(v, dict):
        return {_limpiar(str(k)): _limpiar(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_limpiar(x) for x in v]
    return v


class _FiltroSecretos(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if _SECRETOS.get():
            record.msg, record.args = _limpiar(record.getMessage()), ()
            # No serializar una excepción de transporte que pueda contener headers.
            record.exc_info = None
            record.exc_text = None
        return True


for _logger in ("httpx", "httpcore.connection", "httpcore.http11", "httpcore.http2"):
    logging.getLogger(_logger).addFilter(_FiltroSecretos())


def _configurada(fuente: str, cfg: dict) -> bool:
    return fuente in _REQUERIDOS and all(isinstance(cfg.get(k), str) and cfg[k].strip() for k in _REQUERIDOS[fuente])


def disponible(fuente: str) -> bool:
    """Configuración suficiente para intentar la API; no verifica la licencia."""
    return fuente in _REQUERIDOS and _configurada(fuente, credenciales_academicas.leer())


def _cliente() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10), follow_redirects=False,
                             headers={"Accept": "application/json", "User-Agent": "ROSA2018/1.0"})


def _dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _lista(v: Any) -> list:
    return v if isinstance(v, list) else []


def _texto(v: Any) -> str:
    return unescape(re.sub(r"<[^>]*>", " ", v)).strip() if isinstance(v, str) else ""


def _entero(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int) and v >= 0:
        return v
    if isinstance(v, str) and re.fullmatch(r"\d+", v):
        try:
            return int(v)
        except ValueError:
            return None
    return None


def _anio(v: Any) -> int | None:
    m = re.search(r"\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b", str(v or ""))
    return int(m[0]) if m else None


def _url(v: Any) -> str:
    if not isinstance(v, str) or len(v) > 4000 or "\\" in v or re.search(r"[\x00-\x20\x7f]", v):
        return ""
    try:
        p = urlsplit(v)
        host = p.hostname or ""
        if p.scheme != "https" or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", host) or p.username or p.password or p.port not in {None, 443}:
            return ""
        if host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
            return ""
        if any(k.lower() in {"api_key", "apikey", "token", "access_token", "authorization", "password", "key"} for k in parse_qs(p.query)):
            return ""
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return v
        return ""
    except ValueError:
        return ""


def _doi(v: Any) -> str | None:
    """Normaliza el identificador; una URL de DOI no incorpora sus parámetros."""
    if not isinstance(v, str):
        return None
    v = v.strip()
    if v.lower().startswith(("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/")):
        v = unquote(urlsplit(v).path.lstrip("/"))
    return v.lower() if re.fullmatch(r"10\.\d{4,9}/[^\s\x00-\x1f\x7f]+", v) else None


def _articulo(fuente: str, ident: str, titulo: Any, *, resumen: Any = "", autores: list | None = None,
              doi: Any = None, pmid: Any = None, anio: Any = None, revista: Any = "", tipos: list | None = None,
              url: Any = "") -> dict | None:
    titulo, resumen = _texto(titulo), _texto(resumen)
    if not titulo or not ident:
        return None
    autores = [x for a in (autores or []) if (x := _texto(a))]
    # Los DOI pueden contener '<' y '>'; no son marcado HTML y no se eliminan.
    doi = _doi(doi)
    pmid = pmid.strip() if isinstance(pmid, str) else ""
    pmid = pmid if re.fullmatch(r"[1-9]\d{0,11}", pmid) else ""
    url = _url(url)
    enlace = urlsplit(url)
    if enlace.hostname in {"doi.org", "dx.doi.org"}:
        doi_url = _doi(url)
        if not doi_url or doi and doi != doi_url:
            return None
        doi = doi or doi_url
    if enlace.hostname == "pubmed.ncbi.nlm.nih.gov":
        m = re.fullmatch(r"/([1-9]\d{0,11})/?", enlace.path)
        if m:
            if pmid and pmid != m[1]:
                return None
            pmid = pmid or m[1]
    anio = _anio(anio)
    return {"id": ident, "fuente": fuente, "pmid": pmid, "doi": doi, "pmcid": None,
            "titulo": titulo, "autores": autores, "centro": "", "anio": anio, "revista": _texto(revista),
            "referencia": referencia_corta(autores, anio, identificador=doi or ident), "resumen": resumen,
            "tipos": [_texto(t) for t in (tipos or []) if _texto(t)],
            "url": url or ("https://doi.org/" + quote(doi, safe="/") if doi else ""),
            "tipoContenido": "resumen" if resumen else "metadatos_bibliograficos", "resumenDisponible": bool(resumen),
            "modoAcceso": "api_institucional", "textoCompleto": False}


def _scopus(r: dict) -> dict | None:
    autores = [_dict(a).get("authname") for a in _lista(r.get("author"))]
    enlaces = {_texto(_dict(x).get("@ref")): _dict(x).get("@href") for x in _lista(r.get("link"))}
    return _articulo("scopus", _texto(r.get("dc:identifier") or r.get("eid")), r.get("dc:title"),
                     resumen=r.get("dc:description"), autores=autores or [r.get("dc:creator")],
                     doi=r.get("prism:doi"), pmid=r.get("pubmed-id"), anio=r.get("prism:coverDate"),
                     revista=r.get("prism:publicationName"), tipos=[r.get("subtypeDescription")], url=enlaces.get("scopus"))


def _embase(r: dict) -> dict | None:
    ids, h = _dict(_dict(r.get("itemInfo")).get("itemIdList")), _dict(r.get("head"))
    titulos = _lista(_dict(h.get("citationTitle")).get("titleText"))
    resumenes = _lista(_dict(h.get("abstracts")).get("abstracts"))
    autores = [" ".join(filter(None, [_texto(_dict(a).get("surname")), _texto(_dict(a).get("initials"))]))
               for a in _lista(_dict(h.get("authorList")).get("authors"))]
    source = _dict(h.get("source"))
    return _articulo("embase", _texto(ids.get("lui") or ids.get("embase")),
                     " ".join(_texto(_dict(t).get("ttltext")) for t in titulos),
                     resumen="\n".join(_texto(_dict(a).get("para")) for a in resumenes), autores=autores,
                     doi=ids.get("doi"), pmid=ids.get("medl"), anio=source.get("publicationYear"),
                     revista="; ".join(_texto(t) for t in _lista(source.get("sourceTitle"))),
                     tipos=[_dict(t).get("content") for t in _lista(_dict(h.get("citationInfo")).get("citationType"))],
                     url=_dict(r.get("openLink")).get("openUrl"))


def _wos(r: dict) -> dict | None:
    ids, source = _dict(r.get("identifiers")), _dict(r.get("source"))
    return _articulo("web_of_science", _texto(r.get("uid")), r.get("title"),
                     autores=[_dict(a).get("displayName") for a in _lista(_dict(r.get("names")).get("authors"))],
                     doi=ids.get("doi"), pmid=ids.get("pmid"), anio=source.get("publishYear"),
                     revista=source.get("sourceTitle"), tipos=_lista(r.get("types")), url=_dict(r.get("links")).get("record"))


class _Busqueda:
    def __init__(self, fuente: str, http: httpx.AsyncClient):
        self.fuente, self.http = fuente, http
        self.resultado: dict[str, Any] = {"articulos": [], "total": None, "consultas": [], "estado": "no_comprobado",
                                        "limitaciones": [], "consumo": {}}
        self.fallo = False
        self.comprobada = False

    def limitar(self, texto: str, *, fallo: bool = True) -> None:
        if texto not in self.resultado["limitaciones"]:
            self.resultado["limitaciones"].append(texto)
        self.fallo |= fallo

    async def pedir(self, metodo: str, endpoint: str, *, headers: dict | None = None,
                    params: dict | None = None, cuerpo: dict | None = None, auditoria: dict | None = None) -> dict | None:
        if endpoint not in _ENDPOINTS:
            raise ValueError("Endpoint académico no permitido.")
        publicos = auditoria if auditoria is not None else params or cuerpo or {}
        registro = {"fuente": self.fuente, "modoAcceso": "api_institucional", "endpoint": endpoint,
                    "metodo": metodo, "parametros": _limpiar(publicos), "fecha": datetime.now(timezone.utc).isoformat(),
                    "estado": "no_comprobado", "n": None, "httpStatus": None, "sha256": None}
        self.resultado["consultas"].append(registro)
        consumo = self.resultado["consumo"]
        contador = "elsevierConsultas" if self.fuente in {"embase", "scopus"} else "wosConsultas" if self.fuente == "web_of_science" else "ebscoConsultas"
        consumo[contador] = consumo.get(contador, 0) + 1
        await compartido("academicas:" + urlsplit(endpoint).netloc, 2).esperar()
        try:
            async with self.http.stream(metodo, endpoint, headers=headers, params=params, json=cuerpo,
                                        follow_redirects=False) as respuesta:
                registro["httpStatus"] = respuesta.status_code
                if respuesta.status_code != 200:
                    motivo = ("La API rechazó el acceso institucional (autenticación o licencia)." if respuesta.status_code in {401, 403}
                              else "La API no completó la petición.")
                    registro["error"] = f"{motivo} HTTP {respuesta.status_code}."
                    self.limitar(registro["error"])
                    return None
                contenido = bytearray()
                async for trozo in respuesta.aiter_bytes():
                    contenido.extend(trozo)
                    if len(contenido) > MAX_BYTES:
                        raise ValueError("Respuesta demasiado grande")
            registro["sha256"] = hashlib.sha256(contenido).hexdigest()
            datos = json.loads(contenido)
            if not isinstance(datos, dict) or any(datos.get(k) for k in ("error", "ErrorNumber", "service-error", "error-response")):
                raise ValueError("Respuesta inválida")
            registro["estado"] = "completa"
            return _limpiar(datos)
        except (httpx.HTTPError, ValueError, UnicodeError):
            registro["error"] = "No pude comprobar la respuesta de la API (red, formato o tamaño)."
            self.limitar(registro["error"])
            return None

    def pagina(self, filas: Any, total: Any, parser: Any, maximo: int) -> int | None:
        if not isinstance(filas, list) or _entero(total) is None:
            self.limitar("La API no devolvió un listado y un total verificables; no equivale a ausencia de resultados.")
            self.resultado["consultas"][-1].update(estado="no_comprobado", error=self.resultado["limitaciones"][-1])
            return None
        if (_entero(total) or 0) < len(filas) or (_entero(total) and not filas):
            self.limitar("El listado de la API contradice su total; no pude comprobar los resultados.")
            self.resultado["consultas"][-1].update(estado="no_comprobado", error=self.resultado["limitaciones"][-1])
            return None
        self.comprobada = True
        anterior = self.resultado["total"]
        if anterior is not None and anterior != _entero(total):
            self.limitar("El total cambió durante la paginación; la cobertura no pudo cerrarse de forma completa.")
        self.resultado["total"] = _entero(total)
        self.resultado["consultas"][-1].update(n=len(filas), total=_entero(total))
        if len(filas) > TAMANO_PAGINA:
            self.limitar("La API excedió el tamaño de página solicitado; se conservó solo el límite local.")
        vistos = {a["id"] for a in self.resultado["articulos"]}
        for fila in filas[:TAMANO_PAGINA]:
            articulo = parser(fila) if isinstance(fila, dict) else None
            if not articulo:
                self.limitar("Se omitieron registros sin identidad, título o base verificable.")
                continue
            if articulo["id"] in vistos:
                self.limitar("La API repitió registros entre páginas; se deduplicaron por identificador.")
                continue
            vistos.add(articulo["id"])
            if len(self.resultado["articulos"]) < maximo:
                self.resultado["articulos"].append(articulo)
        return len(filas)

    def terminar(self) -> dict:
        articulos, total = self.resultado["articulos"], self.resultado["total"]
        if total is not None and total > len(articulos):
            self.limitar("Recuperación acotada: no se revisó el inventario completo de resultados.")
        if any(not a["resumenDisponible"] for a in articulos):
            self.limitar("Los registros sin resumen contienen solo metadatos bibliográficos; no aportan contenido científico leído.", fallo=False)
        self.resultado["estado"] = ("parcial" if self.fallo else "completa") if self.comprobada else "no_comprobado"
        if self.fallo and not articulos:
            self.resultado["estado"] = "no_comprobado"
        return _limpiar(self.resultado)


async def _buscar_simple(b: _Busqueda, consulta: str, cfg: dict, maximo: int) -> None:
    fuente, tamano = b.fuente, min(TAMANO_PAGINA, maximo)
    if fuente in {"embase", "scopus"}:
        headers = {"X-ELS-APIKey": cfg["elsevier_api_key"]}
        if cfg.get("elsevier_insttoken"):
            headers["X-ELS-Insttoken"] = cfg["elsevier_insttoken"]
    else:
        headers = {"X-ApiKey": cfg["wos_api_key"]}
    for pagina in range(MAX_PAGINAS):
        if fuente == "embase":
            endpoint, params = EMBASE, {"query": consulta, "start": pagina * tamano + 1, "count": tamano, "sort": "relevance"}
        elif fuente == "scopus":
            endpoint, params = SCOPUS, {"query": consulta, "start": pagina * tamano, "count": tamano, "view": "COMPLETE"}
        else:
            q = consulta if re.match(r"^[A-Z]{2,4}\s*=", consulta) else f"TS=({consulta})"
            endpoint, params = WOS, {"q": q, "db": "WOS", "page": pagina + 1, "limit": tamano}
        d = await b.pedir("GET", endpoint, headers=headers, params=params)
        if d is None:
            return
        if fuente == "embase":
            n = b.pagina(d.get("results"), _dict(d.get("header")).get("hits"), _embase, maximo)
        elif fuente == "scopus":
            s = _dict(d.get("search-results"))
            filas, total = s.get("entry"), s.get("opensearch:totalResults")
            # Elsevier representa cero resultados con una entrada de error específica.
            if _entero(total) == 0 and filas == [{"error": "Result set was empty"}]:
                filas = []
            n = b.pagina(filas, total, _scopus, maximo)
        else:
            n = b.pagina(d.get("hits"), _dict(d.get("metadata")).get("total"), _wos, maximo)
        if n is None or n < tamano or (pagina + 1) * tamano >= (b.resultado["total"] or 0) or len(b.resultado["articulos"]) >= maximo:
            return


def _eds_registro(fuente: str, dbid: str, r: dict) -> dict | None:
    h = _dict(r.get("Header"))
    if h.get("DbId") != dbid or not _texto(h.get("An")):
        return None
    items = {_texto(_dict(x).get("Name")): _dict(x).get("Data") for x in _lista(r.get("Items"))}
    bib = _dict(_dict(r.get("RecordInfo")).get("BibRecord"))
    entity = _dict(bib.get("BibEntity"))
    ids = _lista(entity.get("Identifiers"))
    doi = next((_dict(x).get("Value") for x in ids if _dict(x).get("Type") == "doi"), None)
    relaciones = _dict(bib.get("BibRelationships"))
    autores = [_dict(_dict(_dict(x).get("PersonEntity")).get("Name")).get("NameFull")
               for x in _lista(relaciones.get("HasContributorRelationships"))]
    revista = next((_texto(_dict(t).get("TitleFull"))
                    for x in _lista(relaciones.get("IsPartOfRelationships"))
                    for t in _lista(_dict(_dict(x).get("BibEntity")).get("Titles"))
                    if _dict(t).get("Type") == "main"), "")
    fechas = _lista(entity.get("Dates"))
    return _articulo(fuente, f"{dbid}:{h['An']}", items.get("Title"), resumen=items.get("Abstract"),
                     autores=autores, doi=doi, anio=next((_dict(x).get("Y") for x in fechas), None),
                     revista=revista, tipos=[h.get("PubType")], url=r.get("PLink"))


def _eds_base(descubrimiento: dict, dbid: str, fuente: str) -> str | None:
    resultado = _dict(descubrimiento.get("SearchResult"))
    bases = _lista(_dict(resultado.get("Statistics")).get("Databases"))
    seleccionadas = [d for d in bases if isinstance(d, dict) and d.get("Id") == dbid]
    if len(seleccionadas) != 1 or str(seleccionadas[0].get("Status")) != "0":
        return None
    nombre = _texto(seleccionadas[0].get("Label"))
    if not re.search(r"\b" + fuente + r"\b", nombre, flags=re.I):
        return None
    # Un nombre ambiguo no puede servir para restringir una sola base.
    if sum(_dict(d).get("Label") == nombre for d in bases) != 1:
        return None
    facetas = [f for f in _lista(resultado.get("AvailableFacets")) if _dict(f).get("Id") == "ContentProvider"]
    valores = [v for f in facetas for v in _lista(f.get("AvailableFacetValues")) if _dict(v).get("Value") == nombre]
    return nombre if len(valores) == 1 else None


async def _buscar_eds(b: _Busqueda, consulta: str, cfg: dict, maximo: int) -> None:
    token, sesion = "", ""
    auth = await b.pedir("POST", AUTH, cuerpo={"UserId": cfg["ebsco_user"], "Password": cfg["ebsco_password"], "InterfaceId": "wsapi"},
                         auditoria={"UserId": "[ACCESO_OCULTO]", "Password": "[ACCESO_OCULTO]", "InterfaceId": "wsapi"})
    if not auth or not isinstance(auth.get("AuthToken"), str) or not auth["AuthToken"]:
        b.limitar("EBSCO no devolvió un token de autenticación válido.")
        return
    token = auth["AuthToken"]
    _SECRETOS.set((*_SECRETOS.get(), token))
    headers = {"x-authenticationToken": token}
    try:
        d = await b.pedir("POST", EDS + "createsession", headers=headers, cuerpo={"Profile": cfg["ebsco_profile"], "Guest": "n"},
                          auditoria={"Profile": "[ACCESO_OCULTO]", "Guest": "n"})
        if not d or not isinstance(d.get("SessionToken"), str) or not d["SessionToken"]:
            b.limitar("EBSCO no devolvió una sesión institucional válida.")
            return
        sesion = d["SessionToken"]
        _SECRETOS.set((*_SECRETOS.get(), sesion))
        headers["x-sessionToken"] = sesion
        info = await b.pedir("GET", EDS + "info", headers=headers)
        if not info or not isinstance(info.get("AvailableSearchCriteria"), dict):
            b.limitar("No pude verificar las opciones del perfil institucional de EBSCO.")
            return
        params: dict[str, Any] = {"query-1": consulta, "searchmode": "bool", "includefacets": "y", "view": "title",
                                  "resultsperpage": 1, "pagenumber": 1, "highlight": "n", "autosuggest": "n", "autocorrect": "n"}
        d = await b.pedir("GET", EDS + "search", headers=headers, params=params)
        if d is None:
            return
        b.resultado["consultas"][-1]["uso"] = "identificar_base_sin_incorporar_articulos"
        dbid = cfg[b.fuente + "_db"]
        nombre = _eds_base(d, dbid, b.fuente)
        if not nombre:
            b.limitar("No pude verificar una correspondencia única entre la base configurada de EBSCO y su faceta ContentProvider.")
            return
        # Escapar los caracteres reservados documentados para los valores de faceta.
        faceta = re.sub(r"([\\:,()])", r"\\\1", nombre)
        params.update({"facetfilter": f"1,ContentProvider:{faceta}", "view": "detailed", "resultsperpage": min(10, maximo)})
        for pagina in range(MAX_PAGINAS):
            params["pagenumber"] = pagina + 1
            d = await b.pedir("GET", EDS + "search", headers=headers, params=params)
            if d is None:
                return
            r = _dict(d.get("SearchResult"))
            estadisticas = _dict(r.get("Statistics"))
            bases = _lista(estadisticas.get("Databases"))
            objetivo = [x for x in bases if _dict(x).get("Id") == dbid and _dict(x).get("Label") == nombre and str(_dict(x).get("Status")) == "0"]
            filas = _dict(r.get("Data")).get("Records")
            if len(objetivo) != 1 or any(_dict(_dict(x).get("Header")).get("DbId") != dbid for x in _lista(filas)):
                b.limitar("La respuesta filtrada no acredita una única base de EBSCO; sus registros no se incorporaron.")
                return
            total = estadisticas.get("TotalHits")
            if _entero(total) is None or _entero(objetivo[0].get("Hits")) != _entero(total):
                b.limitar("El total filtrado de EBSCO no coincide con la base solicitada; no pude comprobar su cobertura.")
                return
            n = b.pagina(filas, total, lambda x: _eds_registro(b.fuente, dbid, x), maximo)
            if n is None or n < params["resultsperpage"] or (pagina + 1) * params["resultsperpage"] >= total or len(b.resultado["articulos"]) >= maximo:
                return
    finally:
        if sesion:
            await b.pedir("POST", EDS + "endsession", headers={"x-authenticationToken": token},
                          cuerpo={"SessionToken": sesion}, auditoria={"SessionToken": "[ACCESO_OCULTO]"})


async def buscar(fuente: str, consulta: str, maximo: int = 10) -> dict | None:
    """Devuelve None solo sin configuración. Los fallos conservan su procedencia."""
    if fuente not in _REQUERIDOS:
        return None
    cfg = credenciales_academicas.leer()
    if not _configurada(fuente, cfg):
        return None
    secretos = tuple(v for k, v in cfg.items() if isinstance(v, str) and v and not k.endswith("_db"))
    contexto = _SECRETOS.set(secretos)
    try:
        async with _cliente() as http:
            b = _Busqueda(fuente, http)
            if not isinstance(consulta, str) or not consulta.strip() or len(consulta) > 4000 or re.search(r"[\x00-\x1f\x7f]", consulta):
                b.limitar("Consulta vacía, demasiado larga o con caracteres de control; no se envió a la API.")
                return b.terminar()
            if not isinstance(maximo, int) or isinstance(maximo, bool) or maximo < 1:
                b.limitar("El máximo de registros debe ser un entero positivo; no se envió a la API.")
                return b.terminar()
            maximo = min(maximo, MAX_PAGINAS * TAMANO_PAGINA)
            if fuente in {"cinahl", "psycinfo"}:
                await _buscar_eds(b, consulta.strip(), cfg, maximo)
            else:
                await _buscar_simple(b, consulta.strip(), cfg, maximo)
            return b.terminar()
    finally:
        _SECRETOS.reset(contexto)
