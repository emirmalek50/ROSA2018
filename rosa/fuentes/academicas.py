"""Acceso académico directo cuando está configurado y descubrimiento explícito.

SerpApi: https://serpapi.com/google-scholar-api y https://serpapi.com/search-api.
Los resultados web no acreditan consulta de los índices licenciados. Sus
snippets son pistas, nunca resúmenes científicos ni evidencia leída.
SciELO documenta OAI-PMH para cosechar metadatos por fecha/colección, no una
búsqueda temática equivalente: https://github.com/scieloorg/kernel-oaipmh.
LILACS documenta búsqueda/exportación en https://lilacs.bvsalud.org/es/faq-es/;
no se presupone una API pública de consulta de su índice.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import re
import time
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

from rosa.fuentes import google_patents as GP
from rosa.fuentes.base import FuenteNoDisponible, pedir, referencia_corta

BASE = "https://serpapi.com/search.json"
MAX_PAGINAS = 2
TAMANO_PAGINA = 10
MAX_RESULTADOS = 20
TIEMPO_INTENTO = 45.0
BASES: dict[str, dict[str, Any]] = {
    "embase": {"nombre": "Embase", "dominios": ("embase.com",)},
    "cochrane": {"nombre": "Cochrane Library", "dominios": ("cochranelibrary.com",)},
    "scopus": {"nombre": "Scopus", "dominios": ("scopus.com",)},
    "web_of_science": {"nombre": "Web of Science", "dominios": ("webofscience.com",)},
    "lilacs": {"nombre": "LILACS / BVS", "dominios": ("pesquisa.bvsalud.org", "search.bvsalud.org")},
    # Colecciones enlazadas por https://www.scielo.org/en/, incluidas las que
    # están en desarrollo. Se verifica el dominio de cada resultado devuelto.
    "scielo": {"nombre": "SciELO", "dominios": (
        "scielo.org", "scielo.br", "scielo.org.ar", "scielo.org.bo", "scielo.cl", "scielo.org.co",
        "scielo.sa.cr", "scielo.sld.cu", "scielo.senescyt.gob.ec", "scielo.org.mx", "scielo.iics.una.py",
        "scielo.org.pe", "scielo.pt", "scielosp.org", "scielo.org.za", "scielo.isciii.es", "scielo.edu.uy", "scielo.do",
    )},
    "cinahl": {"nombre": "CINAHL", "dominios": ("research.ebsco.com", "search.ebscohost.com")},
    "psycinfo": {"nombre": "APA PsycInfo", "dominios": ("psycnet.apa.org", "research.ebsco.com", "search.ebscohost.com")},
    "google_scholar": {"nombre": "Google Scholar", "dominios": ("scholar.google.com",)},
}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DOI = re.compile(r"10\.\d{4,9}/[^\s?#<>\"\\]+\Z", re.IGNORECASE)
_PMID = re.compile(r"[1-9]\d{0,9}\Z")
_HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z")
_SENSIBLES = {"api_key", "apikey", "token", "access_token", "authorization", "password", "key"}


def _clave() -> str:
    from rosa.credenciales_patentes import clave
    return clave() or ""


async def _directa(fuente: str, consulta: str, maximo: int) -> dict[str, Any] | None:
    from rosa.fuentes import academicas_licenciadas
    return await academicas_licenciadas.buscar(fuente, consulta, maximo)


def estado_fuentes() -> dict[str, dict[str, Any]]:
    """La configuración no acredita licencia vigente ni conectividad comprobada."""
    from rosa.fuentes import academicas_licenciadas
    serpapi = bool(_clave())
    resultado = {}
    for fuente, metadata in BASES.items():
        directa = fuente != "google_scholar" and academicas_licenciadas.disponible(fuente)
        resultado[fuente] = {
            "nombre": metadata["nombre"], "dominios": list(metadata["dominios"]),
            "accesoDirectoConfigurado": directa, "descubrimientoConfigurado": serpapi,
            "modo": "api_directa" if directa else "indice_scholar" if fuente == "google_scholar" else "descubrimiento_web",
            "accesoComprobado": False,
        }
    return resultado


def _url(valor: Any, dominios: tuple[str, ...] | None = None) -> str | None:
    """Valida enlaces que se conservan como datos. No descarga ninguno."""
    if not isinstance(valor, str) or len(valor) > 4000 or _CONTROL.search(valor) or "\\" in valor:
        return None
    try:
        p = urlsplit(valor)
        host = (p.hostname or "").lower()
        if (p.scheme != "https" or not _HOST.fullmatch(host) or p.username or p.password
                or p.port not in (None, 443) or host.endswith((".local", ".localhost", ".internal", ".test", ".invalid"))):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        if dominios is not None and not any(host == d or host.endswith("." + d) for d in dominios):
            return None
        parametros = parse_qs(p.query, keep_blank_values=True)
        if any(k.lower() in _SENSIBLES for k in parametros):
            return None
        return urlunsplit(("https", host, p.path, p.query, ""))
    except ValueError:
        return None


def _identificadores(fila: dict[str, Any], url: str) -> tuple[str | None, str | None] | None:
    """Solo campos exactos o rutas de identificadores, nunca título o snippet."""
    p = urlsplit(url)
    ruta = unquote(p.path)
    doi_url = None
    if p.hostname in {"doi.org", "dx.doi.org"}:
        doi_url = ruta.lstrip("/")
    elif p.hostname and (p.hostname == "cochranelibrary.com" or p.hostname.endswith(".cochranelibrary.com")):
        coincidencia = re.fullmatch(r"/(?:cdsr|central)/doi/(10\..+)/(?:full|abstract|references|information)", ruta)
        if coincidencia:
            doi_url = coincidencia[1]
    if doi_url and not _DOI.fullmatch(doi_url):
        return None
    doi = fila.get("doi")
    if doi is not None and (not isinstance(doi, str) or len(doi) > 300 or not _DOI.fullmatch(doi)):
        return None
    if doi and doi_url and doi.lower() != doi_url.lower():
        return None
    doi = (doi or doi_url or "").lower() or None
    pmid_url = None
    if p.hostname == "pubmed.ncbi.nlm.nih.gov":
        coincidencia = re.fullmatch(r"/([1-9]\d{0,9})/?", ruta)
        if coincidencia:
            pmid_url = coincidencia[1]
    pmid = fila.get("pmid")
    if pmid is not None and (not isinstance(pmid, str) or not _PMID.fullmatch(pmid)):
        return None
    if pmid and pmid_url and pmid != pmid_url:
        return None
    return doi, pmid or pmid_url


def _pagina_documental(fuente: str, url: str) -> bool:
    """No transforma páginas de producto o acceso en artículos científicos."""
    if fuente == "google_scholar":
        return True
    p = urlsplit(url)
    ruta = unquote(p.path).lower()
    args = {k.lower(): v for k, v in parse_qs(p.query).items()}
    if fuente == "cochrane":
        return ruta.startswith(("/cdsr/doi/", "/central/doi/"))
    if fuente == "embase":
        return "/record/" in ruta or "/records/" in ruta or (args.get("subaction") == ["viewrecord"] and bool(args.get("id")))
    if fuente == "scopus":
        return "/record/" in ruta or ("record.uri" in ruta and bool(args.get("eid")))
    if fuente == "web_of_science":
        return "/full-record/" in ruta
    if fuente == "lilacs":
        return "/resource/" in ruta and bool(re.search(r"/(?:lil|biblio)-\d+(?:/|$)", ruta))
    if fuente == "scielo":
        return bool(re.search(r"/j/[^/]+/a/[^/]+", ruta)) or (
            bool(args.get("pid")) and args.get("script", [""])[0] in {"sci_arttext", "sci_abstract", "sci_pdf"}
        ) or "/article/" in ruta
    if fuente == "psycinfo" and p.hostname == "psycnet.apa.org":
        return ruta.startswith(("/record/", "/doi/", "/fulltext/"))
    if fuente in {"cinahl", "psycinfo"}:
        return "/c/" in ruta or "/linkprocessor/" in ruta or (bool(args.get("an")) and bool(args.get("db")))
    return False


def _articulo(fuente: str, fila: Any) -> dict[str, Any] | None:
    if not isinstance(fila, dict) or not isinstance(fila.get("title"), str) or not fila["title"].strip():
        return None
    scholar = fuente == "google_scholar"
    # Scholar devuelve enlaces a editoriales y repositorios diversos: se
    # admiten destinos HTTPS públicos como datos, sin solicitar esas URL.
    url = _url(fila.get("link"), None if scholar else BASES[fuente]["dominios"])
    if not url or not _pagina_documental(fuente, url) or (identificadores := _identificadores(fila, url)) is None:
        return None
    doi, pmid = identificadores
    info = fila.get("publication_info")
    info = info if isinstance(info, dict) else {}
    recibidos = info.get("authors")
    autores = [a["name"] for a in recibidos if isinstance(a, dict) and isinstance(a.get("name"), str)] if isinstance(recibidos, list) else []
    anio = fila.get("year")
    anio = anio if isinstance(anio, int) and not isinstance(anio, bool) and 1000 <= anio <= 2200 else None
    revista = info.get("journal") if isinstance(info.get("journal"), str) else ""
    pista = fila.get("snippet") if isinstance(fila.get("snippet"), str) else ""
    modo = "indice_scholar" if scholar else "descubrimiento_web"
    meta: dict[str, Any] = {"tipoContenido": "resultado_de_buscador", "textoExterno": True, "resumenCientificoLeido": False}
    for clave in ("result_id", "publication_info", "date", "source", "position"):
        if clave in fila:
            # Se conserva solo la parte bibliográfica de publication_info, no
            # enlaces auxiliares con tokens de navegación de SerpApi.
            meta[clave] = ({"summary": info.get("summary"), "autores": autores} if clave == "publication_info" else fila[clave])
    if fuente == "cochrane":
        ruta = unquote(urlsplit(url).path)
        if re.search(r"/cdsr/doi/10\.1002/14651858\.CD\d{6}(?:\.|/|$)", ruta, re.IGNORECASE):
            meta["coleccion"] = "CDSR"
        elif re.search(r"/central/doi/10\.1002/central/CN-\d+(?:/|$)", ruta, re.IGNORECASE):
            meta["coleccion"] = "CENTRAL"
        else:
            meta["coleccion"] = "no_identificada"
    return {
        "id": "academica-" + hashlib.sha256((fuente + ":" + url).encode()).hexdigest()[:20],
        "fuente": BASES[fuente]["nombre"], "url": url, "titulo": fila["title"].strip(),
        "doi": doi, "pmid": pmid, "pmcid": None, "autores": autores, "anio": anio,
        "revista": revista, "centro": "", "tipos": [], "resumen": "",
        "referencia": referencia_corta(autores, anio, dominio=urlsplit(url).hostname, identificador=doi or pmid),
        "pistaDescubrimiento": pista, "metadatos": meta,
        "_academica": {"fuente": fuente, "modo": modo, "proveedor": "serpapi", "consultaIndice": scholar,
                       "indexacionEnBaseComprobada": scholar, "resumenCientificoLeido": False},
    }


def _registro(fuente: str, consulta: str, parametros: dict[str, Any], modo: str) -> dict[str, Any]:
    return {"fuente": fuente, "nombre": BASES.get(fuente, {}).get("nombre", fuente), "consulta": consulta,
            "url": BASE, "parametros": parametros, "modo": modo, "fecha": GP._fecha(), "total": None,
            "recuperados": 0, "paginas": 0, "completa": False, "error": None, "sha256": None,
            "intento": None, "codigoError": None, "httpStatus": None, "duracionMs": 0,
            "peticionEnviada": False}


async def _pedir(parametros: dict[str, Any], clave: str, registro: dict[str, Any], resultado: dict[str, Any]) -> dict[str, Any] | None:
    bucle = asyncio.get_running_loop()
    semaforo = GP._SEMAFOROS.setdefault(bucle, asyncio.Semaphore(3))
    token = GP._CLAVE_LOG.set(clave)
    inicio = time.monotonic()

    def al_enviar() -> None:
        registro["peticionEnviada"] = True
        resultado["consumo"]["serpapiConsultas"] += 1

    try:
        # El tope incluye la cola, el límite de tasa y la lectura de la respuesta.
        async with asyncio.timeout(TIEMPO_INTENTO), semaforo:
            respuesta = await pedir("GET", BASE, GP._LIMITADOR, params={**parametros, "api_key": clave},
                                    intentos=1, timeout=TIEMPO_INTENTO, follow_redirects=False, al_enviar=al_enviar)
        registro["httpStatus"] = respuesta.status_code
        if respuesta.status_code != 200:
            _error_http(registro, respuesta.status_code)
            return None
        registro["sha256"] = hashlib.sha256(respuesta.content).hexdigest()
        datos = respuesta.json()
        metadata = datos.get("search_metadata") if isinstance(datos, dict) else None
        if (not isinstance(metadata, dict) or metadata.get("status") != "Success"
                or (datos.get("error") and not _vacio_web_confirmado(datos, parametros))):
            registro.update(codigoError="respuesta_invalida", error="No comprobado: el proveedor no confirmó una respuesta final satisfactoria.")
            return None
        parametros_recibidos = datos.get("search_parameters")
        if isinstance(parametros_recibidos, dict) and any(
            k in parametros_recibidos and parametros_recibidos[k] != parametros[k] for k in ("q", "engine", "start")
        ):
            registro.update(codigoError="respuesta_ajena", error="No comprobado: la respuesta corresponde a otra consulta, motor o página.")
            return None
        registro["metadatos"] = {k: metadata[k] for k in ("id", "status", "created_at", "processed_at") if k in metadata}
        return datos
    except TimeoutError:
        registro.update(codigoError="timeout", error="No comprobado: SerpApi agotó el límite de 45 segundos de este intento.")
    except FuenteNoDisponible as ex:
        if ex.status_http is not None:
            _error_http(registro, ex.status_http)
        elif ex.causa == "timeout":
            registro.update(codigoError="timeout", error="No comprobado: se agotó el tiempo de espera de SerpApi, con un máximo de 45 segundos por intento.")
        elif ex.causa == "red":
            registro.update(codigoError="red", error="No comprobado: falló la conexión de red con SerpApi.")
        else:
            registro.update(codigoError=ex.causa, error="No comprobado: no pude obtener una respuesta válida del proveedor.")
    except (ValueError, TypeError):
        registro.update(codigoError="formato", error="No comprobado: SerpApi devolvió una respuesta con formato no válido.")
    finally:
        registro["duracionMs"] = round((time.monotonic() - inicio) * 1000)
        GP._CLAVE_LOG.reset(token)
    return None


def _error_http(registro: dict[str, Any], estado: int) -> None:
    detalle = {401: "el proveedor rechazó la credencial", 403: "el proveedor denegó el acceso",
               429: "el proveedor indicó un límite de solicitudes o de cuota"}.get(estado, "el proveedor no completó la solicitud")
    registro.update(codigoError="http", httpStatus=estado, error=f"No comprobado: HTTP {estado}; {detalle}.")


def _vacio_web_confirmado(datos: dict[str, Any], parametros: dict[str, Any]) -> bool:
    """Caso vacío documentado por SerpApi, sin afirmar ausencia en el índice.

    https://serpapi.com/api-status-and-error-codes
    Un error distinto o campos contradictorios siguen siendo no comprobados.
    """
    info = datos.get("search_information")
    return (parametros.get("engine") == "google"
            and datos.get("error") == "Google hasn't returned any results for this query."
            and isinstance(info, dict)
            and ("total_results" not in info or (type(info["total_results"]) is int and info["total_results"] == 0))
            and info.get("organic_results_state") == "Fully empty"
            and datos.get("organic_results", []) == [])


def _siguiente(datos: dict[str, Any], parametros: dict[str, Any]) -> tuple[int | None, bool]:
    paginacion = datos.get("serpapi_pagination")
    if paginacion is None:
        return None, False
    if not isinstance(paginacion, dict):
        return None, True
    siguiente = paginacion.get("next") or paginacion.get("next_link")
    if not siguiente:
        return None, False
    if not isinstance(siguiente, str) or _CONTROL.search(siguiente):
        return None, True
    try:
        url = urlsplit(siguiente)
        if (url.scheme != "https" or url.hostname != "serpapi.com" or url.username or url.password
                or url.port not in (None, 443) or url.path not in ("/search", "/search.json")):
            return None, True
        args = parse_qs(url.query)
        if any(args.get(k, [str(parametros[k])]) != [str(parametros[k])] for k in ("q", "engine")):
            return None, True
        siguiente_start = args.get("start", [])
        if len(siguiente_start) != 1 or not siguiente_start[0].isdigit() or len(siguiente_start[0]) > 5:
            return None, True
        start = int(siguiente_start[0])
        return (start, False) if start == parametros["start"] + TAMANO_PAGINA else (None, True)
    except (TypeError, ValueError):
        return None, True


def _vacio() -> dict[str, Any]:
    return {"articulos": [], "total": None, "consultas": [], "estado": "no_comprobado", "limitaciones": [],
            "consumo": {"serpapiConsultas": 0}}


def _normalizar_directo(fuente: str, resultado: dict[str, Any]) -> dict[str, Any]:
    """Añade el mismo contrato de procedencia sin alterar resúmenes licenciados."""
    salida = {**resultado, "modo": "api_directa", "consumo": {"serpapiConsultas": 0, **resultado.get("consumo", {})}}
    salida["articulos"] = [
        {**a, "_academica": {"fuente": fuente, "modo": "api_directa", "proveedor": "institucional",
                             "consultaIndice": True, "indexacionEnBaseComprobada": True,
                             "resumenCientificoLeido": bool(a.get("resumen"))}}
        for a in resultado.get("articulos", [])
    ]
    salida["consultas"] = [{**r, "modo": "api_directa", "url": r.get("url", r.get("endpoint", ""))} for r in resultado.get("consultas", [])]
    return salida


async def _web(fuente: str, consulta: str, maximo: int) -> dict[str, Any]:
    resultado = _vacio()
    scholar = fuente == "google_scholar"
    modo = "indice_scholar" if scholar else "descubrimiento_web"
    resultado["modo"] = modo
    resultado["limitaciones"] = [
        "SerpApi es un intermediario independiente. Su coste depende de la cuenta y no se ha calculado en USD.",
        "Los fragmentos del buscador son pistas de descubrimiento; no se leyeron resúmenes científicos ni textos completos.",
    ]
    if scholar:
        resultado["limitaciones"].append("La cobertura corresponde a resultados de Google Scholar; el total es una estimación del buscador, no un censo exhaustivo.")
    else:
        resultado["limitaciones"].append(f"Descubrimiento web en dominios de {BASES[fuente]['nombre']}; no es una consulta directa de su índice ni confirma que cada página esté indexada en esa base.")
        if fuente in {"lilacs", "scielo"}:
            resultado["limitaciones"].append("No se utilizó una API pública de búsqueda temática de esta base; no se equipara OAI-PMH o una interfaz de administración con esa búsqueda.")
    alcance = " OR ".join("site:" + d for d in BASES[fuente]["dominios"])
    q = consulta if scholar else f"({consulta}) ({alcance})"
    parametros: dict[str, Any] = {"engine": "google_scholar" if scholar else "google", "q": q, "start": 0, "hl": "es"}
    if scholar:
        parametros.update({"num": TAMANO_PAGINA, "as_sdt": "0", "as_vis": "1"})
    clave = _clave()
    if not clave:
        registro = _registro(fuente, consulta, parametros, modo)
        registro["codigoError"] = "sin_clave"
        registro["error"] = "No comprobado: falta configurar la clave de SerpApi."
        resultado["consultas"].append(registro)
        resultado["limitaciones"].append(registro["error"])
        return resultado
    identidades: set[str] = set()
    parcial = not scholar
    for pagina in range(MAX_PAGINAS):
        for intento in (1, 2):
            registro = _registro(fuente, consulta, dict(parametros), modo)
            registro["intento"] = intento
            resultado["consultas"].append(registro)
            datos = await _pedir(parametros, clave, registro, resultado)
            reintentable = registro["codigoError"] in {"timeout", "red"} or registro["httpStatus"] in {502, 503, 504}
            if datos is not None or not reintentable or intento == 2:
                break
            resultado["limitaciones"].append("Se repitió una vez la misma petición tras un fallo transitorio; ambos intentos quedan registrados y el consumo de SerpApi se cuenta por petición enviada.")
        if datos is None:
            parcial = True
            if registro.get("error"):
                resultado["limitaciones"].insert(0, registro["error"])
            resultado["limitaciones"].append("No pude comprobar una página de resultados; el fallo no demuestra ausencia de publicaciones.")
            break
        info = datos.get("search_information")
        info = info if isinstance(info, dict) else {}
        estimado = GP._numero(info.get("total_results"))
        registro["totalEstimadoBuscador"] = estimado
        resultado["totalEstimadoBuscador"] = estimado
        filas = datos.get("organic_results", [] if estimado == 0 or _vacio_web_confirmado(datos, parametros) else None)
        if not isinstance(filas, list):
            registro["codigoError"] = "formato"
            registro["error"] = "No comprobado: falta una lista válida de resultados orgánicos."
            parcial = True
            break
        registro["paginas"] = 1
        if len(filas) > TAMANO_PAGINA:
            parcial = True
            resultado["limitaciones"].append("El proveedor devolvió más de diez filas en una página; se conservaron como máximo diez.")
        for fila in filas[:TAMANO_PAGINA]:
            articulo = _articulo(fuente, fila)
            if articulo is None:
                parcial = True
                resultado["limitaciones"].append("Se omitió una fila sin identidad utilizable, de URL insegura, ajena a los dominios permitidos o que no conduce a una ficha documental reconocible.")
                continue
            identidad = articulo.get("doi") or articulo.get("pmid") or articulo["url"]
            if identidad in identidades:
                parcial = True
                resultado["limitaciones"].append("Se deduplicaron resultados repetidos; su repetición impide acreditar una paginación exhaustiva.")
                continue
            if len(resultado["articulos"]) >= maximo:
                parcial = True
                resultado["limitaciones"].append("La recuperación alcanzó el máximo de resultados solicitado.")
                break
            identidades.add(identidad)
            resultado["articulos"].append(articulo)
            registro["recuperados"] += 1
        siguiente, invalido = _siguiente(datos, parametros)
        if invalido:
            parcial = True
            registro["codigoError"] = "paginacion_invalida"
            registro["error"] = "No comprobado: paginación inválida o que no avanza a la siguiente página esperada."
            resultado["limitaciones"].append("No se siguió la referencia de paginación no válida.")
            break
        if siguiente is None:
            agotado = _vacio_web_confirmado(datos, parametros) or (estimado is not None and len(identidades) == estimado and len(filas) <= TAMANO_PAGINA)
            registro["completa"] = scholar and agotado and not parcial
            if not agotado:
                parcial = True
                resultado["limitaciones"].append("No se verificó el agotamiento de resultados frente al total comunicado por el buscador.")
            break
        if pagina + 1 >= MAX_PAGINAS or len(resultado["articulos"]) >= maximo:
            parcial = True
            resultado["limitaciones"].append("Quedaron páginas sin recuperar: máximo dos páginas de diez resultados, sujeto al límite solicitado.")
            break
        parametros = {**parametros, "start": siguiente}
    if any(r["paginas"] for r in resultado["consultas"]):
        resultado["estado"] = "parcial" if parcial else "completa"
    if not resultado["articulos"]:
        resultado["limitaciones"].append("No se recuperaron fichas utilizables del descubrimiento; esto no acredita ausencia de publicaciones en la base.")
    resultado["limitaciones"] = list(dict.fromkeys(resultado["limitaciones"]))
    return GP._limpiar(resultado, clave)


async def buscar(fuente: str, consulta: str, maximo: int = 10) -> dict[str, Any]:
    """Consulta real del proveedor disponible; el modo de acceso es explícito."""
    if (not isinstance(fuente, str) or fuente not in BASES or not isinstance(consulta, str) or not consulta.strip()
            or _CONTROL.search(consulta) or len(consulta) > 2000
            or not isinstance(maximo, int) or isinstance(maximo, bool) or maximo < 1):
        resultado = _vacio()
        registro = _registro(fuente if isinstance(fuente, str) else "", consulta if isinstance(consulta, str) else "", {}, "no_comprobado")
        registro["codigoError"] = "parametros_invalidos"
        registro["error"] = "No comprobado: fuente, consulta o límite no válidos."
        resultado["consultas"].append(registro)
        resultado["limitaciones"].append(registro["error"])
        return resultado
    limite = min(maximo, MAX_RESULTADOS)
    directo = None if fuente == "google_scholar" else await _directa(fuente, consulta.strip(), limite)
    if directo is not None:
        directo = _normalizar_directo(fuente, directo)
    if directo is not None and directo.get("estado") in {"completa", "parcial"}:
        return directo
    resultado = await _web(fuente, consulta.strip(), limite)
    if maximo > MAX_RESULTADOS:
        resultado["limitaciones"].append("El máximo solicitado se acotó a veinte resultados por fuente.")
        if resultado["estado"] == "completa":
            resultado["estado"] = "parcial"
    if directo is not None:
        resultado["consultas"] = directo.get("consultas", []) + resultado["consultas"]
        resultado["limitaciones"] = directo.get("limitaciones", []) + [
            "El acceso directo configurado no pudo comprobarse. Se intentó descubrimiento web y se conserva el fallo del índice."
        ] + resultado["limitaciones"]
        resultado["consumo"] = {**directo.get("consumo", {}), **resultado["consumo"]}
        if resultado["estado"] == "completa":
            resultado["estado"] = "parcial"
    return resultado
