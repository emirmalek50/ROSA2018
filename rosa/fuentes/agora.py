"""Revisión reproducible de genes humanos en Agora, sin inferir eficacia clínica.

Contrato oficial: Sage-Bionetworks/sage-monorepo, libs/agora/api-description.
La ficha del gen contiene las mismas mediciones que alimentan Gene Comparison
(apps/agora/api/src/components/comparison.ts), conservando estudio, región y
método. No se descarga la matriz completa de otros 20 000 genes ni se inventa
una posición relativa. Las respuestas externas son datos, nunca instrucciones.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from collections import Counter
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator

from rosa.fuentes.base import FuenteNoDisponible, NoEncontrado, compartido, json_de, pedir

BASE = "https://agora.adknowledgeportal.org/api/v1"
WEB = "https://agora.adknowledgeportal.org"
DOC = "https://github.com/Sage-Bionetworks/sage-monorepo/tree/main/libs/agora/api-description"
_LIMITE = compartido("agora.adknowledgeportal.org", 3)
_ENSG = re.compile(r"ENSG\d{11}\Z")
_CHEMBL = re.compile(r"CHEMBL\d+\Z")
_SESION: ContextVar[ClienteAgora | None] = ContextVar("sesion_agora", default=None)


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _numero(datos: Any) -> int:
    return len(datos) if isinstance(datos, list) else int(datos is not None and datos != {})


def _lista(datos: Any, campo: str = "respuesta") -> list[dict[str, Any]]:
    if not isinstance(datos, list) or any(not isinstance(d, dict) for d in datos):
        raise FuenteNoDisponible(f"Agora: formato inesperado en {campo}")
    return datos


def _seccion(identificador: str, nombre: str, datos: Any, consultas: list[dict],
             *, limitaciones: list[str] | None = None, error: str = "",
             esperados: int | None = None, url: str = WEB) -> dict[str, Any]:
    limitaciones = list(limitaciones or [])
    n = _numero(datos)
    estado = ("parcial" if n else "no_comprobado") if error else ("comprobado" if n else "sin_datos")
    resumen = error or (f"{n} {'registro recuperado' if n == 1 else 'registros recuperados'} en Agora." if n else "Agora no aporta registros en este apartado para el gen consultado.")
    if error:
        limitaciones.append(error)
    return {"id": identificador, "nombre": nombre, "estado": estado, "resumen": resumen,
            "datos": datos, "consultas": consultas, "limitaciones": limitaciones,
            "fuentes": [{"nombre": "Agora: " + nombre, "url": url}],
            "recuperados": n, "esperados": esperados, "detalle": resumen}


def _menciones_farmaco(farmaco: dict[str, Any], simbolo: str, ensembl: str) -> list[dict[str, str]]:
    """Coincidencias textuales, separadas de las relaciones explícitas de diana."""
    patron = re.compile(r"(?<![A-Za-z0-9_])(?:" + re.escape(simbolo) + "|" + re.escape(ensembl) + r")(?![A-Za-z0-9_])")
    menciones = []
    for n, nominacion in enumerate(farmaco.get("drug_nominations") or []):
        if not isinstance(nominacion, dict):
            continue
        for campo in ("ad_moa", "evidence", "data_used", "computational_validation_results", "experimental_validation_results", "additional_evidence"):
            valor = nominacion.get(campo)
            if isinstance(valor, str) and patron.search(valor):
                menciones.append({"campo": f"drug_nominations[{n}].{campo}", "texto": valor})
    return menciones


def _resumir_seccion(seccion: dict[str, Any], ficha: dict[str, Any]) -> None:
    """Recuentos de evidencia, sin decidir causalidad ni certeza clínica."""
    if seccion["estado"] in {"parcial", "no_comprobado"}:
        return
    identificador, datos = seccion["id"], seccion["datos"]
    resumen = seccion["resumen"]
    if identificador == "identidad":
        resumen = f"{ficha['hgnc_symbol']} ({ficha['ensembl_gene_id']}): identidad humana resuelta en Agora."
    elif identificador in {"rna", "proteina_lfq", "proteina_srm", "proteina_tmt"} and datos:
        regiones = {str(f.get("tissue")) for f in datos if f.get("tissue")}
        estudios = {str(f.get("study")) for f in datos if f.get("study")}
        resumen = f"{len(datos)} mediciones en {len(regiones)} regiones o tejidos"
        resumen += f" y {len(estudios)} estudios." if estudios else "; la respuesta no identifica estudios por fila."
        seccion["limitaciones"].append("La expresión diferencial es una asociación; no determina por sí sola causalidad ni la dirección terapéutica.")
    elif identificador == "validacion" and datos:
        especies = sorted({str(f["species"]) for f in datos if f.get("species")})
        resumen = f"{len(datos)} registros de validación experimental; especies declaradas: {', '.join(especies) or 'no informadas'}."
        seccion["limitaciones"].append("Conservar la especie y el sistema experimental de cada registro; la validación preclínica no es validación clínica.")
    elif identificador == "puntuaciones" and datos:
        resumen = "Puntuaciones de priorización publicadas por Agora: " + ", ".join(f"{k}={v}" for k, v in datos.items() if isinstance(v, (int, float))) + "."
        seccion["limitaciones"].append("Las puntuaciones de Agora no son porcentajes de confianza ni grados GRADE.")
    elif identificador == "comparacion":
        n = sum(len(v) for v in datos.values() if isinstance(v, list))
        seccion["recuperados"] = n
        seccion["estado"] = "comprobado" if n else "sin_datos"
        resumen = f"{n} mediciones de ARN y proteína del gen, conservando modalidad, región y estudio."
    elif identificador == "redes" and isinstance(datos, dict):
        n = len(datos.get("links") or [])
        seccion["recuperados"] = n
        resumen = f"{n} relaciones en la red del gen; la coexpresión no demuestra interacción directa ni causalidad."
    seccion.update(resumen=resumen, detalle=resumen)


def _json_descriptivo(dato: Any) -> str:
    return json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _filas_descriptivas(filas: list[dict], campos: tuple[str, ...], signo: str | None = None) -> str:
    """Describe todas las filas, sin tomar una muestra ni decidir significación."""
    salida = []
    for indice, fila in enumerate(filas, 1):
        dato = {c: fila.get(c) for c in campos}
        if signo:
            valor = fila.get(signo)
            # El signo del coeficiente se conserva sin inferir qué contraste,
            # unidad o dirección terapéutica representa en cada modelo.
            if isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor):
                dato[f"signo_{signo}"] = "positivo" if valor > 0 else "negativo" if valor < 0 else "cero"
        salida.append(f"Fila {indice}: " + _json_descriptivo(dato))
    return "\n".join(salida)


def _analisis_descriptivo(seccion: dict[str, Any]) -> str:
    """Contexto científico completo para el juez, separado de la vista previa.

    Cada fila de mediciones, correlaciones, validaciones y nominaciones se
    describe íntegra en los campos científicos del contrato oficial. Las redes
    se recorren completas y se agregan por región; sus aristas permanecen en el
    artefacto. No se fija un umbral de significación ni se convierten unidades.
    """
    identificador, datos = seccion["id"], seccion["datos"]
    if seccion["estado"] == "no_comprobado":
        return "No se interpreta evidencia de este apartado: " + seccion["resumen"]
    if seccion["estado"] == "parcial" and identificador not in {"dianas_nominadas", "farmacos_nominados"}:
        return "Cobertura o formato incompleto; los datos no se interpretan como evidencia validada. " + seccion["resumen"]
    if datos is None or datos == [] or datos == {}:
        return seccion["resumen"] + " Sin registros no se deduce ausencia de asociación."
    cabecera = "Descripción de todos los registros recuperados; valores originales, sin umbral de significación añadido. Los campos null no están informados.\n"
    if identificador == "rna":
        return cabecera + _filas_descriptivas(datos, (
            "_id", "ensembl_gene_id", "hgnc_symbol", "study", "tissue", "model",
            "logfc", "fc", "ci_l", "ci_r", "adj_p_val"), "logfc")
    if identificador in {"proteina_lfq", "proteina_srm", "proteina_tmt"}:
        return cabecera + f"Modalidad: {identificador.rsplit('_', 1)[-1].upper()}.\n" + _filas_descriptivas(datos, (
            "_id", "uniqid", "ensembl_gene_id", "hgnc_symbol", "uniprotid", "tissue",
            "log2_fc", "ci_lwr", "ci_upr", "pval", "cor_pval"), "log2_fc")
    if identificador == "neuropatologia":
        return cabecera + _filas_descriptivas(datos, (
            "_id", "ensg", "gname", "neuropath_type", "oddsratio", "ci_lower", "ci_upper", "pval", "pval_adj"))
    if identificador == "validacion":
        # Todos los campos del contrato, incluido el texto completo de cada
        # hallazgo y referencia. La fila número trece no desaparece del juez.
        return cabecera + _filas_descriptivas(datos, (
            "_id", "ensembl_gene_id", "hgnc_symbol", "hypothesis_tested", "summary_findings",
            "species", "model_system", "outcome_measure", "outcome_measure_details",
            "balanced_for_sex", "published", "reference", "reference_doi", "date_report", "team", "contributors"))
    if identificador == "comparacion":
        # Las mediciones completas ya figuran en los cuatro apartados previos;
        # repetirlas aquí duplicaría el contexto sin añadir evidencia.
        return "Comparación enfocada al gen. " + _json_descriptivo({k: len(v or []) for k, v in datos.items()}) + ". Todas las filas y sus valores se describen en Expresión diferencial de ARN y Expresión proteica LFQ, SRM y TMT; no es un ranking de genes."
    if identificador == "redes":
        relaciones = datos.get("links") or []
        regiones = Counter(str(f.get("brainRegion") or "no informada") for f in relaciones)
        genes = {str(f[k]) for f in relaciones for k in ("geneA_ensembl_gene_id", "geneB_ensembl_gene_id") if f.get(k)}
        red = datos.get("similar_genes_network") or {}
        return "Agregación de todas las aristas recuperadas: " + _json_descriptivo({
            "relaciones": len(relaciones), "genesDistintos": len(genes), "relacionesPorRegion": dict(sorted(regiones.items())),
            "nodosRedSimilar": len(red.get("nodes") or []), "aristasRedSimilar": len(red.get("links") or [])}) + ". Las relaciones de red no demuestran causalidad; aristas completas en el artefacto."
    if identificador == "farmacos_nominados":
        # El catálogo global se audita por recuento. Todas las fichas relacionadas
        # y menciones, incluso las posteriores a doce, entran sin truncamiento.
        return "Cobertura del catálogo: " + _json_descriptivo({
            "nominacionesRecuperadas": len(datos.get("catalogo") or []), "nominacionesEsperadas": seccion.get("esperados"),
            "fichasRevisadas": datos.get("detallesRevisados"), "fichasEsperadas": datos.get("detallesEsperados")}) + (
            "\nFármacos vinculados por identificador exacto (todas las fichas): " + _json_descriptivo(datos.get("vinculados") or []) +
            "\nMenciones textuales (todas, sin inferir unión a la proteína): " + _json_descriptivo(datos.get("menciones") or []) +
            "\nUna nominación o fase clínica máxima no establece eficacia en Alzheimer. " + seccion["resumen"])
    return "Campos completos del apartado, sin truncamiento: " + _json_descriptivo(datos)


class ClienteAgora:
    """Instantánea de consultas compartida solo durante una revisión de corrida.

    Dos intentos HTTP, tres peticiones por segundo y hasta tres simultáneas.
    El límite de 100 consultas nuevas evita descargas masivas accidentales;
    alcanzarlo produce cobertura parcial explícita, nunca ausencia de evidencia.
    La caché conserva la fecha de recuperación original, incluidos los errores.
    """

    def __init__(self, *, max_peticiones: int = 100):
        self.max_peticiones = max_peticiones
        self.peticiones = 0
        self._cache: dict[str, tuple[Any, dict[str, Any]]] = {}
        self._pendientes: dict[str, asyncio.Task] = {}
        self._semaforo = asyncio.Semaphore(3)
        self._catalogo_farmacos: dict[str, Any] | None = None

    async def obtener(self, ruta: str, parametros: dict[str, Any] | None = None) -> tuple[Any, dict[str, Any]]:
        parametros = parametros or {}
        clave = json.dumps([ruta, parametros], sort_keys=True)
        if clave in self._cache:
            return self._cache[clave]
        # Compartir la tarea también evita duplicar solicitudes concurrentes.
        if clave not in self._pendientes:
            self._pendientes[clave] = asyncio.create_task(self._obtener(ruta, parametros))
        try:
            resultado = await self._pendientes[clave]
            self._cache[clave] = resultado
            return resultado
        finally:
            self._pendientes.pop(clave, None)

    async def _obtener(self, ruta: str, parametros: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        registro: dict[str, Any] = {"url": BASE + ruta, "parametros": parametros, "fecha": _ahora(),
                    "n": None, "error": None, "sha256": None, "http": None}
        if self.peticiones >= self.max_peticiones:
            registro["error"] = "No pude comprobar: se alcanzó el límite de consultas de esta revisión de Agora."
            return None, registro
        self.peticiones += 1
        try:
            async with self._semaforo:
                respuesta = await pedir("GET", BASE + ruta, _LIMITE, params=parametros,
                                        headers={"Accept": "application/json"}, intentos=2, timeout=15.0)
                registro["http"] = respuesta.status_code
                datos = json_de(respuesta)
                registro.update(n=_numero(datos), sha256=hashlib.sha256(respuesta.content).hexdigest())
                return datos, registro
        except NoEncontrado:
            # Un 404 de un apartado o de un endpoint cambiado no demuestra que
            # el gen o el fármaco no exista. La búsqueda exacta decide identidad.
            registro.update(http=404, error="No pude comprobar: Agora respondió HTTP 404 en este apartado.")
        except FuenteNoDisponible as ex:
            registro["error"] = f"No pude comprobar: {str(ex)[:250]}"
        return None, registro

    async def paginar(self, ruta: str, campo: str, parametros: dict[str, Any],
                      campo_id: str) -> dict[str, Any]:
        filas: list[dict[str, Any]] = []
        consultas: list[dict[str, Any]] = []
        ids: set[str] = set()
        esperados: int | None = None
        error = ""
        pagina = 0
        while True:
            datos, consulta = await self.obtener(ruta, {**parametros, "pageNumber": pagina, "pageSize": 100})
            consultas.append(consulta)
            if consulta["error"]:
                error = consulta["error"]
                break
            try:
                if not isinstance(datos, dict) or not isinstance(datos.get("page"), dict):
                    raise FuenteNoDisponible("Agora: faltan metadatos de paginación")
                lote = _lista(datos.get(campo), campo)
                meta = datos["page"]
                total, numero, siguiente = meta.get("totalElements"), meta.get("number"), meta.get("hasNext")
                if type(total) is not int or total < 0 or type(numero) is not int or numero != pagina or type(siguiente) is not bool:
                    raise FuenteNoDisponible("Agora: metadatos de paginación inconsistentes")
                if esperados is not None and total != esperados:
                    raise FuenteNoDisponible("Agora: el total cambió durante la paginación")
                esperados = total
                nuevos = [f.get(campo_id) for f in lote]
                if any(not isinstance(i, str) or not i or i in ids for i in nuevos) or len(set(nuevos)) != len(nuevos):
                    raise FuenteNoDisponible("Agora: identificadores ausentes o duplicados entre páginas")
                filas.extend(lote)
                ids.update(str(i) for i in nuevos)
                consulta.update(n=len(lote), recuperados=len(filas), esperados=esperados, pagina=pagina)
                if len(filas) > esperados or (siguiente and not lote):
                    raise FuenteNoDisponible("Agora: recuento de página incompatible con el total")
                if not siguiente:
                    if len(filas) != esperados:
                        raise FuenteNoDisponible("Agora: terminó la paginación sin recuperar el total declarado")
                    break
                if len(filas) >= 10000:
                    raise FuenteNoDisponible("Agora: descarga parcial al alcanzar 10 000 registros")
                pagina += 1
            except FuenteNoDisponible as ex:
                error = f"No pude comprobar la cobertura completa: {ex}"
                consulta["error"] = error
                break
        return {"filas": filas, "consultas": consultas, "esperados": esperados, "error": error}

    async def farmacos(self) -> dict[str, Any]:
        if self._catalogo_farmacos is not None:
            return self._catalogo_farmacos
        pagina = await self.paginar("/comparison-tools/drugs", "nominatedDrugs",
                                    {"itemFilterType": "exclude", "sortFields": "common_name,composite_id", "sortOrders": "1,1"},
                                    "composite_id")
        consultas = list(pagina["consultas"])
        errores = [pagina["error"]] if pagina["error"] else []
        identificadores = {str(f.get("chembl_id", "")) for f in pagina["filas"]}
        validos = sorted(i for i in identificadores if _CHEMBL.fullmatch(i))
        if len(validos) != len(identificadores):
            errores.append("No pude comprobar fármacos con identificador ChEMBL ausente o inválido.")
        detalles = []
        for identificador, (dato, consulta) in zip(validos, await asyncio.gather(*[
            self.obtener(f"/drugs/{i}") for i in validos
        ])):
            consultas.append(consulta)
            if consulta["error"]:
                errores.append(consulta["error"])
                continue
            if not isinstance(dato, dict) or dato.get("chembl_id") != identificador or not isinstance(dato.get("linked_targets"), list):
                errores.append(f"No pude comprobar las dianas de {identificador}: respuesta incompatible.")
                continue
            if any(not isinstance(t, dict) or not _ENSG.fullmatch(str(t.get("ensembl_gene_id", ""))) for t in dato["linked_targets"]):
                errores.append(f"No pude comprobar todas las dianas de {identificador}: identificador ausente o inválido.")
                continue
            detalles.append(dato)
        resultado = {"catalogo": pagina["filas"], "detalles": detalles, "consultas": consultas,
                     "esperados": pagina["esperados"], "detallesEsperados": len(identificadores),
                     "errores": list(dict.fromkeys(errores))}
        self._catalogo_farmacos = resultado
        return resultado

    async def revisar_gen(self, gen: str) -> dict[str, Any]:
        consulta = str(gen).strip()
        resultado: dict[str, Any] = {"consulta": consulta, "estado": "no_disponible", "gen": None,
                                  "secciones": [], "consultas": [], "advertencias": [], "version": None, "fecha": _ahora()}
        # La API solo admite símbolos/alias alfanuméricos, guiones y guiones bajos.
        # No elimina caracteres de una proteína para fabricar otro identificador.
        if not re.fullmatch(r"[A-Za-z0-9_-]{2,100}", consulta):
            resultado["estado"] = "ambiguo"
            resultado["advertencias"] = ["La identidad requiere un símbolo génico humano, un alias exacto de Agora o un identificador Ensembl ENSG sin versión."]
            return resultado
        busqueda, registro = await self.obtener("/genes/search/enhanced", {"q": consulta})
        resultado["consultas"].append(registro)
        if registro["error"]:
            resultado["advertencias"].append(registro["error"])
            return resultado
        try:
            candidatos = _lista(busqueda, "búsqueda de genes")
        except FuenteNoDisponible as ex:
            resultado["advertencias"].append(str(ex))
            return resultado
        exactos = {f.get("id"): f for f in candidatos
                   if _ENSG.fullmatch(str(f.get("id", ""))) and
                   (str(f.get("id", "")).casefold() == consulta.casefold() or
                    str(f.get("hgnc_symbol", "")).casefold() == consulta.casefold() or
                    (f.get("match_field") == "alias" and str(f.get("match_value", "")).casefold() == consulta.casefold()))}
        if len(exactos) != 1:
            resultado["estado"] = "ambiguo" if candidatos else "no_encontrado"
            resultado["advertencias"].append("La búsqueda de Agora no resolvió una identidad exacta y única; no se interpreta como ausencia biológica.")
            resultado["candidatos"] = candidatos
            return resultado
        identificador = next(iter(exactos))
        ficha, ficha_reg = await self.obtener(f"/genes/{identificador}")
        resultado["consultas"].append(ficha_reg)
        if ficha_reg["error"] or not isinstance(ficha, dict) or ficha.get("ensembl_gene_id") != identificador:
            resultado["advertencias"].append(ficha_reg["error"] or "No pude comprobar: la ficha no coincide con el identificador resuelto.")
            return resultado
        simbolo = ficha.get("hgnc_symbol")
        if not isinstance(simbolo, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", simbolo):
            resultado["advertencias"].append("No pude comprobar: el símbolo humano de la ficha es inválido.")
            return resultado
        url = f"{WEB}/genes/{identificador}"
        resultado["gen"] = {"ensembl_gene_id": identificador, "hgnc_symbol": simbolo,
                            "nombre": ficha.get("name"), "alias": ficha.get("alias", []),
                            "uniprotkb_accessions": ficha.get("uniprotkb_accessions", []), "url": url, "taxon": 9606}
        version, version_reg = await self.obtener("/data-version")
        resultado["consultas"].append(version_reg)
        if version_reg["error"] or not isinstance(version, dict) or not version.get("data_version"):
            resultado["advertencias"].append(version_reg["error"] or "No pude comprobar la versión de datos de Agora.")
        else:
            resultado["version"] = version
        secciones = resultado["secciones"]
        grupos = [
            ("identidad", "Gene Search: identidad del gen", ("name", "summary", "alias", "ensembl_info", "uniprotkb_accessions")),
            ("evidencia_ad", "Asociación genética y evidencia en Alzheimer", ("is_igap", "is_eqtl", "rna_brain_change_studied", "is_any_rna_changed_in_ad_brain", "protein_brain_change_studied", "is_any_protein_changed_in_ad_brain")),
            ("rna", "Expresión diferencial de ARN", ("rna_differential_expression",)),
            ("proteina_lfq", "Expresión proteica LFQ", ("proteomics_LFQ",)),
            ("proteina_srm", "Expresión proteica SRM", ("proteomics_SRM",)),
            ("proteina_tmt", "Expresión proteica TMT", ("proteomics_TMT",)),
            ("metabolomica", "Metabolómica", ("metabolomics",)),
            ("neuropatologia", "Correlaciones neuropatológicas", ("neuropathologic_correlations",)),
            ("puntuaciones", "Puntuaciones de priorización", ("overall_scores",)),
            ("validacion", "Validación experimental", ("experimental_validation",)),
            ("farmacologia", "Viabilidad farmacológica", ("druggability",)),
            ("dominios", "Dominios biológicos", ("bio_domains",)),
            ("expresion", "Expresión por tejido", ("median_expression",)),
            ("redes", "Redes y genes similares", ("links", "similar_genes_network")),
            ("recursos", "Recursos para estudiar la diana", ("is_adi", "is_tep", "resource_url")),
        ]
        campos_lista = {"rna_differential_expression", "proteomics_LFQ", "proteomics_SRM", "proteomics_TMT",
                        "neuropathologic_correlations", "experimental_validation", "median_expression", "links"}
        campos_objeto = {"metabolomics", "overall_scores", "druggability", "bio_domains", "similar_genes_network", "ensembl_info"}
        campos_gen = {"rna_differential_expression", "proteomics_LFQ", "proteomics_SRM", "proteomics_TMT",
                      "neuropathologic_correlations", "experimental_validation", "metabolomics", "overall_scores", "bio_domains"}
        for id_seccion, nombre, campos in grupos:
            datos = ficha.get(campos[0]) if len(campos) == 1 else {c: ficha[c] for c in campos if c in ficha}
            faltantes = [c for c in campos if c not in ficha]
            # La implementación oficial omite metabolomics cuando no encuentra
            # documento; el silencio de ese campo no es evidencia de ausencia.
            limites = ["La respuesta no aporta el campo " + c + "; no permite concluir ausencia de asociación." for c in faltantes]
            error = "No pude comprobar todos los campos previstos de este apartado." if faltantes and id_seccion != "metabolomica" else ""
            for campo in campos:
                valor = ficha.get(campo)
                if valor is None:
                    continue
                if campo in campos_lista and (not isinstance(valor, list) or any(not isinstance(f, dict) for f in valor)):
                    error = f"No pude comprobar {campo}: formato de filas incompatible."
                if campo in campos_objeto and not isinstance(valor, dict):
                    error = f"No pude comprobar {campo}: formato de objeto incompatible."
                if campo in campos_gen:
                    filas = valor if isinstance(valor, list) else [valor]
                    if any(isinstance(f, dict) and any(f[k] != identificador for k in ("ensembl_gene_id", "ensg") if k in f) for f in filas):
                        error = f"No pude comprobar {campo}: contiene registros atribuidos a otro gen."
            secciones.append(_seccion(id_seccion, nombre, datos, [ficha_reg], limitaciones=limites, error=error, url=url))
        comparacion = {c: ficha[c] for c in ("rna_differential_expression", "proteomics_LFQ", "proteomics_SRM", "proteomics_TMT") if c in ficha}
        secciones.append(_seccion("comparacion", "Gene Comparison: ARN y proteína del gen", comparacion, [ficha_reg], url=f"{WEB}/genes/comparison",
            error="No pude comprobar todas las modalidades de comparación." if len(comparacion) != 4 or any(s["estado"] in {"parcial", "no_comprobado"} for s in secciones if s["id"] in {"rna", "proteina_lfq", "proteina_srm", "proteina_tmt"}) else "",
            limitaciones=["Mediciones del gen por estudio, región y método obtenidas de la ficha que alimenta Gene Comparison. No es un ranking frente a todos los genes."]))
        nominaciones = await self.paginar("/comparison-tools/targets", "nominatedTargets",
            {"items": simbolo, "itemFilterType": "include", "sortFields": "hgnc_symbol", "sortOrders": "1"}, "ensembl_gene_id")
        resultado["consultas"].extend(nominaciones["consultas"])
        dianas = [d for d in nominaciones["filas"] if d.get("ensembl_gene_id") == identificador]
        error_dianas = nominaciones["error"]
        if len(dianas) != len(nominaciones["filas"]):
            error_dianas = "No pude comprobar la selección: Agora devolvió dianas de otro identificador."
        nominaciones_ficha = ficha.get("target_nominations")
        if "target_nominations" not in ficha or (nominaciones_ficha is not None and
                (not isinstance(nominaciones_ficha, list) or any(not isinstance(n, dict) for n in nominaciones_ficha))):
            error_dianas = "No pude comprobar el detalle de nominaciones: campo ausente o formato incompatible."
        elif isinstance(nominaciones_ficha, list) and any(
                "hgnc_symbol" in n and n["hgnc_symbol"] != simbolo for n in nominaciones_ficha):
            error_dianas = "No pude comprobar las nominaciones: contienen un símbolo génico diferente al de la ficha."
        if not error_dianas and bool(dianas) != bool(nominaciones_ficha):
            error_dianas = "La tabla de dianas y la ficha discrepan sobre las nominaciones; requiere revisión."
        seccion_dianas = _seccion("dianas_nominadas", "Nominated Targets", {"dianas": dianas, "nominaciones": nominaciones_ficha},
            [ficha_reg, *nominaciones["consultas"]], error=error_dianas, esperados=nominaciones["esperados"], url=f"{WEB}/comparison/targets",
            limitaciones=["Una nominación de investigación no constituye eficacia terapéutica ni validación clínica."])
        seccion_dianas["recuperados"] = len(dianas)
        if not error_dianas:
            seccion_dianas["estado"] = "comprobado" if dianas else "sin_datos"
            seccion_dianas["resumen"] = f"{len(dianas)} entradas en la tabla de dianas y {len(nominaciones_ficha or [])} nominaciones en la ficha de Agora."
            seccion_dianas["detalle"] = seccion_dianas["resumen"]
        secciones.append(seccion_dianas)
        drogas = await self.farmacos()
        resultado["consultas"].extend(drogas["consultas"])
        vinculadas = [d for d in drogas["detalles"] if any(t["ensembl_gene_id"] == identificador for t in d["linked_targets"])]
        menciones = [{"farmaco": d, "coincidencias": m} for d in drogas["detalles"] if (m := _menciones_farmaco(d, simbolo, identificador))]
        seccion_drogas = _seccion("farmacos_nominados", "Nominated Drugs", {"vinculados": vinculadas,
            "menciones": menciones, "catalogo": drogas["catalogo"], "detallesRevisados": len(drogas["detalles"]), "detallesEsperados": drogas["detallesEsperados"]},
            drogas["consultas"], error="; ".join(drogas["errores"]), esperados=drogas["esperados"], url=f"{WEB}/comparison/drugs",
            limitaciones=["Vínculos únicamente por linked_targets.ensembl_gene_id exacto. El catálogo global no se atribuye al gen.",
                          "Las menciones textuales del símbolo o Ensembl en una nominación se conservan aparte; no se interpretan como unión del fármaco a la proteína.",
                          "Un fármaco nominado y su fase máxima no prueban eficacia en Alzheimer ni recomendación de uso."])
        seccion_drogas["recuperados"] = len(drogas["catalogo"])
        if not drogas["errores"]:
            seccion_drogas["resumen"] = (f"{len(drogas['catalogo'])} nominaciones y {len(drogas['detalles'])} fichas revisadas; "
                                         f"{len(vinculadas)} fármacos con vínculo explícito al gen y {len(menciones)} con mención textual en Agora.")
            seccion_drogas["detalle"] = seccion_drogas["resumen"]
        secciones.append(seccion_drogas)
        for seccion in secciones:
            _resumir_seccion(seccion, ficha)
            seccion["analisisDescriptivo"] = _analisis_descriptivo(seccion)
            for fuente in seccion["fuentes"]:
                fuente["version"] = resultado["version"]
        resultado["advertencias"].extend(l for s in secciones if s["estado"] in {"parcial", "no_comprobado"} for l in s["limitaciones"])
        resultado["estado"] = "parcial" if resultado["advertencias"] else "completa"
        return resultado


@contextmanager
def sesion_agora(*, max_peticiones: int = 100) -> Iterator[ClienteAgora]:
    """Compartir las recuperaciones entre genes sin reutilizarlas en otra corrida."""
    cliente = ClienteAgora(max_peticiones=max_peticiones)
    token = _SESION.set(cliente)
    try:
        yield cliente
    finally:
        _SESION.reset(token)


async def revisar_gen(gen: str) -> dict[str, Any]:
    return await (_SESION.get() or ClienteAgora()).revisar_gen(gen)
