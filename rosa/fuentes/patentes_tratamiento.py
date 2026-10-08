"""Recuperación de patentes relacionadas con un tratamiento, sin juicio jurídico.

Google Patents vía SerpApi se consulta obligatoriamente. Exa descubre
publicaciones complementarias y recupera texto como datos externos inertes.
Orange Book aporta patentes estadounidenses declaradas por el titular de una
solicitud de fármaco aprobado. Ninguna consulta acredita libertad de operación,
ausencia mundial de patentes ni vigencia de derechos. Las reivindicaciones de
una solicitud no equivalen a las finalmente concedidas.

Documentación oficial: https://www.epo.org/en/searching-for-patents/data/web-services/ops
https://www.wipo.int/en/web/patentscope/data/index
https://open.fda.gov/apis/drug/orangebook/example-api-queries/
https://open.fda.gov/fields/drugorangebook.yaml
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote, urlencode, urlsplit, urlunsplit

from rosa.fuentes import exa, google_patents
from rosa.fuentes.base import FuenteNoDisponible, NoEncontrado, compartido, json_de, pedir

DOMINIOS = ["patents.google.com", "patentscope.wipo.int", "worldwide.espacenet.com", "register.epo.org", "data.epo.org", "uspto.gov"]
BASE_FDA = "https://api.fda.gov/drug/orangebook.json"
MAX_CONSULTAS = 4
MAX_DOCUMENTOS = 8
MAX_TEXTO = 12000
MAX_PAGINAS_FDA = 3
TAMANO_PAGINA_FDA = 100
_LIMITADOR_FDA = compartido("api.fda.gov", 4.0)
_PUBLICACION = re.compile(r"\b(?:US|WO|EP|CN|JP|KR|GB|CA|AU|DE|FR|ES|DO)\d{4,14}[A-Z]\d?\b", re.IGNORECASE)
_PATENTE_FDA = re.compile(r"\d{4,14}(?:\*PED)?", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_ERRORES_DATOS = (FuenteNoDisponible, TypeError, ValueError, AttributeError, KeyError)


def _url_patente(valor: Any) -> str | None:
    """Una URL externa nunca se interpreta como código ni como una instrucción."""
    if not isinstance(valor, str) or len(valor) > 3000 or _CONTROL.search(valor):
        return None
    try:
        p = urlsplit(valor)
        host = (p.hostname or "").lower().rstrip(".")
        permitido = host in DOMINIOS or host.endswith(".uspto.gov")
        if p.scheme != "https" or not permitido or p.username or p.password or p.port not in (None, 443):
            return None
        return urlunsplit(("https", p.netloc.lower(), p.path, p.query, ""))
    except ValueError:
        return None


def _identificador(url: str) -> str | None:
    m = _PUBLICACION.search(unquote(urlsplit(url).path))
    return m.group(0).upper() if m else None


def _registro(fuente: str, consulta: str, url: str, parametros: dict[str, Any]) -> dict[str, Any]:
    return {"fuente": fuente, "consulta": consulta, "url": url, "parametros": parametros, "total": None, "recuperados": 0, "paginas": 0, "completa": False, "error": None}


def _textos_validos(valores: Any, limite: int, etiqueta: str, limitaciones: list[str], *, ingrediente: bool = False) -> list[str]:
    if not isinstance(valores, list):
        if valores is not None:
            limitaciones.append(f"{etiqueta}: se esperaba una lista de textos; no se consultó ese valor.")
        return []
    salida: list[str] = []
    for valor in valores:
        if not isinstance(valor, str) or _CONTROL.search(valor):
            limitaciones.append(f"{etiqueta}: se omitió un valor inválido o con caracteres de control.")
            continue
        valor = valor.strip()
        if not valor:
            continue
        if ingrediente and (len(valor) > 180 or any(c in valor for c in '\\"[]{}:|&')):
            limitaciones.append("Orange Book: se omitió un ingrediente ambiguo para una búsqueda exacta.")
            continue
        if len(valor) > limite:
            valor = valor[:limite]
            limitaciones.append(f"{etiqueta}: una consulta se recortó a {limite} caracteres.")
        if valor.casefold() not in {v.casefold() for v in salida}:
            salida.append(valor)
    if len(salida) > MAX_CONSULTAS:
        limitaciones.append(f"{etiqueta}: se consultaron solo los primeros {MAX_CONSULTAS} términos únicos.")
    return salida[:MAX_CONSULTAS]


def _web_documento(fila: dict[str, Any], url: str) -> dict[str, Any]:
    identificador = _identificador(url)
    resumen = fila.get("resumen")
    if not isinstance(resumen, str):
        resumen = ""
    titulo = fila.get("titulo")
    if not isinstance(titulo, str):
        titulo = "Publicación de patente"
    d: dict[str, Any] = {
        "id": f"patente-{identificador}" if identificador else "patente-" + hashlib.sha256(url.encode()).hexdigest()[:16],
        "url": url, "titulo": titulo[:700], "texto": resumen[:MAX_TEXTO], "fuente": "Exa patentes",
        "datos": {"textoExterno": True, "tipoTexto": "resumen", "reivindicacionesLeidas": False, "estadoJuridicoVerificado": False},
    }
    if identificador:
        d["identificador"] = identificador
    if len(resumen) > MAX_TEXTO:
        d["datos"]["textoTruncado"] = True
    return d


async def _web(terminos: list[str], resultado: dict[str, Any]) -> None:
    por_id: dict[str, dict[str, Any]] = {}
    for termino in terminos:
        parametros = {"dominios": list(DOMINIOS), "categoria": None, "maximo": MAX_DOCUMENTOS}
        r = _registro("Exa patentes", termino, exa.BASE + "/search", parametros)
        resultado["consultas"].append(r)
        try:
            filas, _, coste = await exa.buscar(termino, maximo=MAX_DOCUMENTOS, dominios=list(DOMINIOS), categoria=None, pregunta_pasajes="Reivindicaciones, compuesto, diana, solicitud, concesión y familia de patentes relacionadas con: " + termino[:350])
            if not isinstance(filas, list):
                raise FuenteNoDisponible("Exa devolvió una lista de documentos inválida")
            r["paginas"] = 1
            r["costeUsd"] = coste
            for fila in filas[:MAX_DOCUMENTOS]:
                if not isinstance(fila, dict) or not (url := _url_patente(fila.get("url"))):
                    resultado["limitaciones"].append("Exa: se omitió un resultado mal formado o de un dominio no autorizado.")
                    continue
                d = _web_documento(fila, url)
                por_id.setdefault(d["id"], d)
                r["recuperados"] += 1
            if len(filas) > MAX_DOCUMENTOS:
                resultado["limitaciones"].append("Exa: una respuesta excedió ocho resultados y se recortó.")
            if r["recuperados"] == 0:
                resultado["limitaciones"].append("Exa: la consulta no devolvió documentos utilizables; no permite afirmar que no existan patentes.")
        except _ERRORES_DATOS as error:
            r["error"] = f"No comprobado: {type(error).__name__}: {str(error)[:220]}"
            resultado["limitaciones"].append("No pude comprobar una búsqueda de patentes en Exa.")

    documentos = list(por_id.values())
    if documentos:
        leidos = documentos[:MAX_DOCUMENTOS]
        por_url = {d["url"]: d for d in leidos}
        try:
            textos, coste = await exa.contenidos(list(por_url), maximo_caracteres=MAX_TEXTO)
            resultado["costeUsd"] += float(coste)
            if not isinstance(textos, list):
                raise FuenteNoDisponible("Exa devolvió contenidos mal formados")
            for fila in textos[:MAX_DOCUMENTOS]:
                if not isinstance(fila, dict) or not (url := _url_patente(fila.get("url"))):
                    resultado["limitaciones"].append("Exa contenido: se omitió una URL no autorizada o una fila inválida.")
                    continue
                contenido_doc = por_url.get(url)
                if contenido_doc is None:
                    ident = _identificador(url)
                    contenido_doc = next((x for x in leidos if ident and x.get("identificador") == ident), None)
                texto = fila.get("texto")
                if contenido_doc is None or not isinstance(texto, str) or not texto.strip():
                    continue
                contenido_doc["url"] = url
                contenido_doc["texto"] = texto[:MAX_TEXTO]
                contenido_doc["datos"]["tipoTexto"] = "contenido"
                contenido_doc["datos"]["reivindicacionesLeidas"] = bool(re.search(r"(?:^|\n)\s*(?:claims(?:\s*\(\d+\))?|reivindicaciones)\s*(?:\n|:|$)", contenido_doc["texto"], re.IGNORECASE))
                if len(texto) >= MAX_TEXTO:
                    contenido_doc["datos"]["textoTruncado"] = True
                    resultado["limitaciones"].append(f"Texto de {contenido_doc.get('identificador') or contenido_doc['id']} limitado a {MAX_TEXTO} caracteres; pueden faltar reivindicaciones.")
        except _ERRORES_DATOS as error:
            resultado["limitaciones"].append(f"No pude leer el contenido de las publicaciones: {type(error).__name__}; se conservaron solo sus resúmenes.")
        if any(d["datos"]["tipoTexto"] == "resumen" for d in documentos):
            resultado["limitaciones"].append("Algunas publicaciones solo tienen resumen; no se comprobó el alcance de sus reivindicaciones.")
        if len(documentos) > MAX_DOCUMENTOS:
            resultado["limitaciones"].append("Se leyó contenido de las primeras ocho publicaciones únicas; las demás conservan solo resúmenes.")
    resultado["documentos"].extend(documentos)
    resultado["costeUsd"] += sum(float(r.get("costeUsd") or 0) for r in resultado["consultas"] if r["fuente"] == "Exa patentes")


def _fila_fda(fila: Any, ingrediente: str) -> bool:
    if not isinstance(fila, dict) or not isinstance(fila.get("products"), list):
        return False
    return any(isinstance(p, dict) and isinstance(p.get("active_ingredients"), list) and any(isinstance(a, dict) and isinstance(a.get("name"), str) and a["name"].casefold() == ingrediente.casefold() for a in p["active_ingredients"]) for p in fila["products"])


async def _orangebook(ingrediente: str, resultado: dict[str, Any]) -> None:
    consulta = f'products.active_ingredients.name:"{ingrediente}"'
    parametros: dict[str, Any] = {"search": consulta, "limit": TAMANO_PAGINA_FDA, "skip": 0}
    r = _registro("openFDA Orange Book", ingrediente, BASE_FDA, dict(parametros))
    r["paginasConsultadas"] = []
    resultado["consultas"].append(r)
    por_patente: dict[str, dict[str, Any]] = {}
    numeros: set[str] = set()
    invalidas = False
    try:
        for pagina in range(MAX_PAGINAS_FDA):
            parametros["skip"] = pagina * TAMANO_PAGINA_FDA
            url = BASE_FDA + "?" + urlencode(parametros)
            try:
                respuesta = await pedir("GET", BASE_FDA, _LIMITADOR_FDA, params=dict(parametros), intentos=2)
            except NoEncontrado:
                # El 404 del cliente compartido no demuestra una consulta válida
                # sin coincidencias: también puede ser una ruta caída o retirada.
                raise FuenteNoDisponible("Orange Book respondió 404; no se pudo distinguir ausencia de resultados de un error del servicio") from None
            datos = json_de(respuesta)
            if not isinstance(datos, dict) or not isinstance(datos.get("results"), list):
                raise FuenteNoDisponible("Orange Book devolvió resultados mal formados")
            meta = datos.get("meta")
            if not isinstance(meta, dict):
                raise FuenteNoDisponible("Orange Book no devolvió un total verificable")
            total = meta.get("results", {}).get("total")
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise FuenteNoDisponible("Orange Book no devolvió un total verificable")
            if r["total"] is not None and r["total"] != total:
                raise FuenteNoDisponible("Orange Book cambió su total durante la paginación")
            r["total"] = total
            r["actualizadoEn"] = meta.get("last_updated")
            filas = datos["results"]
            r["paginas"] += 1
            r["paginasConsultadas"].append({"url": url, "parametros": dict(parametros), "recuperados": len(filas)})
            r["recuperados"] += len(filas)
            if len(filas) > TAMANO_PAGINA_FDA:
                raise FuenteNoDisponible("Orange Book excedió el tamaño solicitado de la página")
            for fila in filas:
                if not _fila_fda(fila, ingrediente):
                    invalidas = True
                    continue
                patentes = fila.get("patents", [])
                if not isinstance(patentes, list):
                    invalidas = True
                    continue
                for patente in patentes[:100]:
                    numero = patente.get("patent_number") if isinstance(patente, dict) else None
                    if not isinstance(numero, str) or not _PATENTE_FDA.fullmatch(numero):
                        invalidas = True
                        continue
                    campos = {k: v for k, v in patente.items() if k in {"patent_number", "expiration_date", "drug_substance_flag", "drug_product_flag", "patent_use_code", "patent_use_code_definition", "patent_delist_flag", "patent_submission_date"} and isinstance(v, (str, bool))}
                    campos = {k: v[:1500] if isinstance(v, str) else v for k, v in campos.items()}
                    numeros.add(numero)
                    if len(por_patente) < MAX_DOCUMENTOS or numero in por_patente:
                        documento = por_patente.setdefault(numero, {"id": f"orangebook-{numero}", "identificador": "US" + numero.upper().removesuffix("*PED"), "url": url, "titulo": f"Patente estadounidense {numero} declarada para {ingrediente}", "texto": json.dumps(campos, ensure_ascii=False), "fuente": "openFDA Orange Book", "datos": {"textoExterno": True, "pais": "US", "ingrediente": ingrediente, "ingredientes": [ingrediente], "patente": campos, "actualizadoEn": meta.get("last_updated"), "estadoJuridicoVerificado": False}})
                        inicial = documento["datos"]["patente"]
                        discrepancias = {k: v for k, v in campos.items() if k in inicial and inicial[k] != v}
                        if discrepancias:
                            documento["datos"]["discrepanciasEntreProductos"] = discrepancias
                            documento["texto"] = json.dumps({"patente": inicial, "discrepanciasEntreProductos": discrepancias}, ensure_ascii=False)
                            resultado["limitaciones"].append(f"Orange Book: la patente {numero} tiene campos distintos entre productos; requiere revisar las fichas originales.")
                    if len(patentes) > 100:
                        invalidas = True
            if r["recuperados"] >= total:
                r["completa"] = r["recuperados"] == total and not invalidas
                break
            if len(filas) != TAMANO_PAGINA_FDA:
                raise FuenteNoDisponible("Orange Book terminó una página antes de reconciliar el total")
        if not r["completa"]:
            resultado["limitaciones"].append(f"Orange Book ({ingrediente}): paginación o validación incompleta; se recibieron {r['recuperados']} de {r['total']} productos.")
        r["patentesUnicas"] = len(numeros)
        if len(numeros) > MAX_DOCUMENTOS:
            r["completa"] = False
            resultado["limitaciones"].append(f"Orange Book ({ingrediente}): se conservaron ocho de {len(numeros)} patentes únicas; el informe no es exhaustivo.")
        if not por_patente:
            resultado["limitaciones"].append(f"Orange Book ({ingrediente}): no se recuperaron patentes listadas; esto no excluye patentes de otro uso, otros países o tratamientos experimentales.")
    except _ERRORES_DATOS as error:
        r["completa"] = False
        r["error"] = f"No comprobado: {type(error).__name__}: {str(error)[:220]}"
        resultado["limitaciones"].append(f"No pude completar la consulta de Orange Book para {ingrediente}.")
    resultado["documentos"].extend(list(por_patente.values())[:MAX_DOCUMENTOS])


async def buscar(consultas: list[str], ingredientes: list[str] | None = None) -> dict[str, Any]:
    """Búsqueda acotada actual, nunca un certificado de ausencia de patentes.

Google Patents se consulta siempre con hasta cuatro términos; el cliente limita
la paginación y los detalles y conserva sus límites en el resultado. Exa añade
hasta cuatro consultas, ocho resultados por consulta y texto de ocho
publicaciones únicas. Hasta cuatro ingredientes exactos en Orange Book,
tres páginas de cien productos y ocho patentes únicas por ingrediente.
`completa` se refiere a recuperación, no a cobertura mundial ni juicio legal.
"""
    resultado: dict[str, Any] = {"documentos": [], "consultas": [], "limitaciones": ["Las búsquedas públicas no incluyen solicitudes aún sin publicar y no permiten certificar ausencia mundial de patentes.", "Google Patents no verifica jurídicamente el estado, la titularidad o la fecha de expiración; las reivindicaciones y el registro territorial requieren comprobación.", "OPS de EPO, ODP de USPTO y los servicios SOAP de WIPO requieren acceso propio; no se simula una consulta oficial si no se realizó."], "consultadoEn": datetime.now(timezone.utc).isoformat(), "costeUsd": 0.0}
    terminos = _textos_validos(consultas, 1000, "Búsqueda de patentes", resultado["limitaciones"])
    sustancias = _textos_validos(ingredientes, 180, "Orange Book", resultado["limitaciones"], ingrediente=True)
    # La búsqueda obligatoria nunca depende de Exa ni de que Orange Book tenga
    # ingredientes. Los nombres exactos son una alternativa si faltan consultas.
    try:
        google = await google_patents.buscar(terminos or sustancias)
        resultado["documentos"].extend(google.get("documentos", []))
        resultado["consultas"].extend(google.get("consultas", []))
        resultado["limitaciones"].extend(google.get("limitaciones", []))
        resultado["googlePatents"] = google.get("googlePatents", {})
        resultado["consumo"] = google.get("consumo", {})
        # SerpApi informa consumo de consultas; no inventar un coste por unidad
        # ni sumarlo al importe real que devuelve Exa.
    except _ERRORES_DATOS as error:
        detalle = f"No pude comprobar Google Patents vía SerpApi ({type(error).__name__})."
        resultado["googlePatents"] = {"proveedor": "serpapi", "protocolo": 1, "estado": "no_comprobado", "consultadoEn": resultado["consultadoEn"]}
        resultado["consumo"] = {"serpapiConsultas": 0}
        resultado["limitaciones"].append(detalle)
        registro = _registro("Google Patents vía SerpApi", "; ".join(terminos or sustancias), "https://serpapi.com/search.json", {})
        registro["error"] = detalle
        resultado["consultas"].append(registro)
    if terminos:
        await _web(terminos, resultado)
    if sustancias:
        resultado["limitaciones"].append("Orange Book solo recoge patentes declaradas para fármacos aprobados en Estados Unidos; la exclusividad regulatoria es distinta de una patente.")
        for ingrediente in sustancias:
            await _orangebook(ingrediente, resultado)
    if not terminos and not sustancias:
        resultado["limitaciones"].append("No hubo términos válidos; la situación de patentes no se pudo comprobar.")
    documentos: dict[str, dict[str, Any]] = {}
    for documento in resultado["documentos"]:
        anterior = documentos.setdefault(documento["id"], documento)
        if anterior is documento:
            continue
        # La misma publicación puede llegar por Google y Exa. Separar sus IDs de
        # lectura conserva ambos textos y evita atribuir el texto de Exa a Google.
        if documento["fuente"] != anterior["fuente"]:
            ident = documento["id"] + "-" + hashlib.sha256(documento["fuente"].encode()).hexdigest()[:8]
            documentos.setdefault(ident, {**documento, "id": ident})
            continue
        # Una patente de combinación puede reaparecer al consultar otro
        # ingrediente. La deduplicación conserva ambas identidades y registros.
        if documento["fuente"] == "openFDA Orange Book":
            anterior["datos"]["ingredientes"] = list(dict.fromkeys(anterior["datos"]["ingredientes"] + documento["datos"]["ingredientes"]))
            anterior["datos"].setdefault("registrosAdicionales", []).append({"url": documento["url"], "ingrediente": documento["datos"]["ingrediente"], "patente": documento["datos"]["patente"]})
    resultado["documentos"] = list(documentos.values())
    resultado["limitaciones"] = list(dict.fromkeys(resultado["limitaciones"]))
    return resultado
