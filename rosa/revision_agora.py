"""Revisión trazable de Agora antes del cierre; no añade hechos al modelo de mundo."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from rosa import conectores as CON
from rosa import ontologias as ONTO
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.fuentes.agora import sesion_agora

VERSION = 1
_TERMINALES = {"completa", "parcial", "no_comprobado", "no_aplica"}
_SECCIONES = {
    "identidad": "gene_search", "dianas_nominadas": "nominated_targets",
    "farmacos_nominados": "nominated_drugs",
}
_LIMITACION = "Agora aporta contexto de investigación: asociación, expresión o nominación no demuestran causalidad, eficacia ni utilidad clínica. No cambia por sí sola la certeza GRADE. La ficha génica no resuelve por sí sola efectos de alelos, isoformas o modificaciones postraduccionales, como APOE4 o p-tau."


def _dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _entradas(h: dict) -> dict:
    return {k: h.get(k) for k in ("version", "titulo", "enunciado", "mecanismo", "entidades", "tarjeta", "comprobacion")} | {
        "identificadores": {k: _dict(h.get(k)).get("identificadores") for k in ("perfilDiana", "contextoBases")
                            if _dict(h.get(k)).get("version") is not None and _dict(h.get(k)).get("version") == h.get("version", 1)}
    }


def huella(h: dict) -> str:
    return hashlib.sha256(json.dumps(_entradas(h), sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def hipotesis_de(e: dict, inv_id: str) -> list[dict]:
    return [h for h in e.get("hipotesis", []) if h.get("investigacionId") == inv_id and h.get("estado") != "descartada"]


def huella_investigacion(e: dict, inv_id: str) -> str:
    partes = sorted((h["id"], huella(h)) for h in hipotesis_de(e, inv_id))
    return hashlib.sha256(json.dumps(partes).encode()).hexdigest()


def vigente_para_hipotesis(h: dict) -> bool:
    r = _dict(h.get("revisionAgora"))
    return r.get("version") == VERSION and r.get("versionHipotesis") == h.get("version", 1) and r.get("huella") == huella(h) and r.get("estado") in _TERMINALES


def revision_vigente(e: dict, c: dict) -> bool:
    r = _dict(c.get("revisionAgora"))
    return (r.get("version") == VERSION and r.get("estado") in _TERMINALES
            and r.get("huella") == huella_investigacion(e, c["investigacionId"])
            and all(vigente_para_hipotesis(h) and h["revisionAgora"].get("corridaId") == c["id"] for h in hipotesis_de(e, c["investigacionId"])))


def genes_de(h: dict) -> list[str]:
    """Candidatos explícitos, sin escoger el primer resultado de una búsqueda.

    Se resuelven después en Agora por identidad exacta. Los acrónimos no resueltos
    quedan visibles, sin presentarlos como genes confirmados ni como ausencia.
    """
    from rosa.bucle.pasos import simbolos_de_genes

    salida: list[str] = []
    def agregar(v: Any) -> None:
        if isinstance(v, str) and v.strip() and v.strip() not in salida:
            salida.append(v.strip())
        elif isinstance(v, list):
            for x in v:
                agregar(x)

    for campo in ("perfilDiana", "contextoBases"):
        contexto = _dict(h.get(campo))
        if contexto.get("version") is not None and contexto.get("version") == h.get("version", 1):
            ids = _dict(contexto.get("identificadores"))
            agregar(ids.get("simbolo") or ids.get("ensembl"))
    for entidad in h.get("entidades") or []:
        if isinstance(entidad, dict) and (entidad.get("tipo") in ("gen", "proteina") or entidad.get("ontologia") == "HGNC"):
            agregar(entidad.get("simbolo") or entidad.get("ensembl") or str(entidad.get("etiqueta") or "").split(" (")[0])
        elif isinstance(entidad, str):
            agregar(simbolos_de_genes(entidad))
    diana = str(_dict(h.get("tarjeta")).get("diana") or "")
    texto = " ".join(str(h.get(k) or "") for k in ("titulo", "enunciado", "mecanismo")) + " " + diana + " " + str(_dict(h.get("comprobacion")).get("biomarcador") or "")
    for entidad in ONTO.anotar_curadas(texto):
        if entidad.get("tipo") == "gen":
            agregar(entidad["etiqueta"].split(" (")[0])
    # El extractor habitual limita a seis: por token no pierde genes al final.
    for token in re.findall(r"[\w-]+", texto):
        if re.fullmatch(r"ENSG\d{11}(?:\.\d+)?", token):
            agregar(token.split(".")[0])
        else:
            agregar(simbolos_de_genes(token))
    if not salida and diana.strip() and diana.casefold() not in {"ninguna", "no aplica", "sin diana", "none"}:
        agregar(diana)
    return salida


def _vista(v: Any, profundidad: int = 0) -> Any:
    if profundidad > 6:
        return "Detalle completo en agora.json de la exportación RO-Crate."
    if isinstance(v, list):
        return [_vista(x, profundidad + 1) for x in v[:12]]
    if isinstance(v, dict):
        return {str(k): _vista(x, profundidad + 1) for k, x in list(v.items())[:60]}
    return v[:1500] if isinstance(v, str) else v


def _gen_publico(consulta: str, bruto: dict) -> dict:
    identidad = _dict(bruto.get("gen"))
    secciones = []
    for s in bruto.get("secciones") or []:
        if not isinstance(s, dict):
            continue
        dato = s.get("datos")
        identificador_original = str(s.get("id") or "sin_identificador")
        ids = [_SECCIONES.get(identificador_original, identificador_original)]
        if s.get("id") == "comparacion":
            ids = ["comparison_rna", "comparison_proteina"]
        for identificador in ids:
            datos = dato
            nombre = s.get("nombre", identificador)
            estado_seccion = s.get("estado", "no_comprobado")
            resumen = s.get("resumen", "")
            recuperados, esperados = s.get("recuperados"), s.get("esperados")
            analisis = s.get("analisisDescriptivo")
            if identificador == "comparison_rna":
                datos = {"rna_differential_expression": _dict(dato).get("rna_differential_expression")}
            elif identificador == "comparison_proteina":
                datos = {k: _dict(dato).get(k) for k in ("proteomics_LFQ", "proteomics_SRM", "proteomics_TMT")}
                analisis = None  # El análisis conjunto queda rotulado en comparación de ARN.
            if identificador in {"comparison_rna", "comparison_proteina"}:
                modalidad = "ARN" if identificador == "comparison_rna" else "proteína"
                nombre = "Gene Comparison: " + modalidad
                mediciones: dict[str, Any] = _dict(datos)
                recuentos: list[int] = [len(v) for v in mediciones.values() if isinstance(v, list)]
                recuperados = sum(recuentos)
                esperados = None
                valido = all(isinstance(v, list) and all(isinstance(f, dict) and all(
                    f[k] == identidad.get("ensembl_gene_id") for k in ("ensembl_gene_id", "ensg") if k in f) for f in v) for v in mediciones.values())
                estado_seccion = ("comprobado" if recuperados else "sin_datos") if valido else ("parcial" if recuperados else "no_comprobado")
                resumen = f"{recuperados} mediciones de {modalidad} del gen en la respuesta consultada."
                if not valido:
                    resumen += " No pude comprobar todas las modalidades o la identidad de sus filas."
                if analisis:
                    analisis = "Análisis conjunto de ARN y proteína; sus cifras no corresponden exclusivamente a ARN.\n" + str(analisis)
            secciones.append({"id": identificador, "nombre": nombre, "estado": estado_seccion,
                              "resumen": resumen, "fecha": bruto.get("fecha", P.ahora_ms()),
                              "fuentes": s.get("fuentes", []), "consultas": s.get("consultas", []),
                              "datos": {"recuperados": recuperados, "esperados": esperados, "vistaPrevia": _vista(datos),
                                        "analisisDescriptivo": analisis,
                                        "alcanceVista": "Hasta 12 filas por lista. Los datos completos se conservan en agora.json del RO-Crate."},
                              "limitaciones": s.get("limitaciones", [])})
    estado = "resuelto" if identidad else {"ambiguo": "ambiguo", "no_encontrado": "no_encontrado"}.get(str(bruto.get("estado")), "no_comprobado")
    if not secciones:
        secciones = [{"id": "gene_search", "nombre": "Gene Search", "estado": "no_comprobado", "resumen": "; ".join(bruto.get("advertencias") or ["No pude resolver la identidad del gen en Agora."]),
                      "fecha": bruto.get("fecha", P.ahora_ms()), "fuentes": [], "consultas": bruto.get("consultas", []), "datos": {"candidatos": _vista(bruto.get("candidatos", []))}, "limitaciones": bruto.get("advertencias", [])}]
    return {"consultado": consulta, "simbolo": identidad.get("hgnc_symbol"), "ensembl": identidad.get("ensembl_gene_id"), "url": identidad.get("url"),
            "estadoResolucion": estado, "secciones": secciones, "datos": {"version": bruto.get("version"), "identidad": identidad}}


def _estado(resultados: list[dict]) -> str:
    if not resultados:
        return "no_aplica"
    if all(r.get("estado") == "completa" and r.get("gen") for r in resultados):
        return "completa"
    return "parcial" if any(r.get("gen") for r in resultados) else "no_comprobado"


def _nominacion(resultados: list[dict]) -> dict:
    if not resultados:
        return {"estado": "no_aplica", "detalle": "No se identificó un gen o proteína explícito para consultar en Agora."}
    resueltos = []
    for r in resultados:
        s: dict = next((s for s in r.get("secciones", []) if isinstance(s, dict) and s.get("id") == "dianas_nominadas"), {})
        d = _dict(s.get("datos"))
        identidad = str(_dict(r.get("gen")).get("ensembl_gene_id") or "")
        simbolo = str(_dict(r.get("gen")).get("hgnc_symbol") or "").casefold()
        resuelto = bool(re.fullmatch(r"ENSG\d{11}", identidad))
        dianas, nominaciones = d.get("dianas"), d.get("nominaciones")
        dianas_validas = isinstance(dianas, list) and all(isinstance(x, dict) and x.get("ensembl_gene_id") == identidad for x in dianas)
        campos_nominacion = {"team", "team_full", "study", "input_data", "predicted_therapeutic_direction", "rationale"}
        nominaciones_validas = nominaciones is None or (isinstance(nominaciones, list) and all(
            isinstance(x, dict) and any(isinstance(x.get(k), str) and x[k].strip() for k in campos_nominacion)
            and ("hgnc_symbol" not in x or str(x["hgnc_symbol"]).casefold() == simbolo)
            and all(x[k] == identidad for k in ("ensembl_gene_id", "ensg") if k in x) for x in nominaciones))
        if resuelto and ((dianas_validas and dianas) or (nominaciones_validas and nominaciones)):
            return {"estado": "nominada", "detalle": "Agora documenta una nominación para al menos un gen. Consulte el informe para la cobertura completa; no implica eficacia."}
        resueltos.append(resuelto and dianas_validas and nominaciones_validas and s.get("estado") in ("comprobado", "sin_datos"))
    if all(resueltos):
        return {"estado": "no_nominada", "detalle": "No se recuperaron nominaciones para los genes exactos en la instantánea consultada de Agora; no se afirma ausencia fuera de ese catálogo."}
    return {"estado": "no_comprobado", "detalle": "No pude comprobar todas las nominaciones en Agora. Consulte la cobertura del informe."}


def texto_revision(h: dict) -> str:
    r = _dict(h.get("revisionAgora"))
    if not r:
        return "Agora: revisión pendiente."
    lineas = [f"Agora: {r.get('estado')}. {r.get('resumen', '')}", _LIMITACION]
    if not vigente_para_hipotesis(h):
        lineas.append("Revisión histórica: no corresponde al contenido actual de esta hipótesis.")
    for g in r.get("genes", []):
        lineas.append(f"Gen {g.get('simbolo') or g.get('consultado')} ({g.get('ensembl') or 'identidad no resuelta'}): {g.get('url') or ''}")
        for s in g.get("secciones", []):
            lineas.append(f"- {s.get('nombre')}: {s.get('estado')}. {s.get('resumen')}")
            lineas.extend("  Limitación: " + str(x) for x in s.get("limitaciones", []))
            analisis = _dict(s.get("datos")).get("analisisDescriptivo")
            if analisis:
                lineas.append("  Análisis descriptivo de todas las filas recuperadas: " + (analisis if isinstance(analisis, str) else json.dumps(analisis, ensure_ascii=False, default=str)))
            lineas.append("  Vista parcial: hasta 12 filas por lista y 1800 caracteres por apartado. Datos completos en agora.json del RO-Crate.")
            lineas.append("  Datos recuperados: " + json.dumps(_dict(s.get("datos")).get("vistaPrevia"), ensure_ascii=False, default=str)[:1800])
    lineas.extend("Limitación: " + str(x) for x in r.get("limitaciones", []))
    return "\n".join(lineas)


def datos_exportacion(e: dict, h: dict) -> dict | None:
    r = _dict(h.get("revisionAgora"))
    if not r:
        return None
    c: dict = next((c for c in e.get("corridas", []) if c.get("id") == r.get("corridaId")), {})
    cache = _dict(c.get("_revisionAgoraDatos"))
    return {"revision": r, "vigente": vigente_para_hipotesis(h), "genes": {g["consultado"]: cache.get(g["consultado"]) for g in r.get("genes", [])}}


async def revisar_cierre(ctx: Any, *, motivo: str | None = None) -> dict:
    """Un intento por alcance y corrida; comparte el catálogo entre todos los genes."""
    from rosa.bucle.pasos import CorridaParada, ESTADOS_QUE_PARAN_EL_PASO

    def comprobar() -> dict:
        c = next((c for c in ctx.e.get("corridas", []) if c["id"] == ctx.corrida_id), None)
        if not c or c.get("estado") in ESTADOS_QUE_PARAN_EL_PASO:
            raise CorridaParada(str((c or {}).get("estado", "eliminada")))
        return c

    c = comprobar()
    if revision_vigente(ctx.e, c):
        return c["revisionAgora"]
    hipotesis = copy.deepcopy(hipotesis_de(ctx.e, ctx.investigacion_id))
    huella_inicial = huella_investigacion(ctx.e, ctx.investigacion_id)
    candidatos = {h["id"]: genes_de(h) for h in hipotesis}
    genes = list(dict.fromkeys(g for lista in candidatos.values() for g in lista))
    pista = ctx.pista(None, "grafo", "Revisión final de Agora", "Agora")
    pista.accion(f"Reviso {len(genes)} candidatos de {len(hipotesis)} hipótesis: identidad, expresión, nominaciones y fármacos.")
    def iniciar(e):
        actual = next(c for c in e["corridas"] if c["id"] == ctx.corrida_id)
        actual["revisionAgora"] = {"version": VERSION, "estado": "en_curso", "huella": huella_inicial, "fecha": P.ahora_ms(), "genes": genes, "motivo": motivo}
        return True
    ctx.mutar(iniciar, "agora_inicio")
    resultados: dict[str, dict] = {}
    registros: dict[str, dict] = {}
    try:
        with sesion_agora(max_peticiones=min(2000, max(100, 80 + 12 * len(genes)))):
            for gen in genes:
                actual = comprobar()
                entrada = _dict(actual.get("_revisionAgoraDatos")).get(gen)
                if (isinstance(entrada, dict) and isinstance(entrada.get("registro"), dict)
                        and isinstance(entrada.get("resultado"), dict) and entrada["resultado"].get("gen")
                        and entrada["resultado"].get("estado") == "completa"):
                    resultados[gen] = entrada["resultado"]
                    registros[gen] = entrada["registro"]
                    continue
                pista.accion(f"Consulto Agora para {gen}.")
                registro, dato = await CON.consultar("agora", resumen=f"Revisión final de Agora: {gen}", gen=gen)
                comprobar()
                if not isinstance(dato, dict) or not isinstance(dato.get("secciones"), list):
                    dato = {"estado": "no_disponible", "gen": None, "secciones": [], "advertencias": [registro.get("error") or "No pude comprobar la respuesta de Agora."], "consultas": [], "fecha": P.ahora_ms()}
                if dato.get("estado") == "no_disponible":
                    registro = {**registro, "n": None, "error": registro.get("error") or "; ".join(str(a) for a in dato.get("advertencias", [])) or "No pude comprobar Agora."}
                resultados[gen], registros[gen] = dato, registro
                def cachear(e, gen=gen, dato=dato, registro=registro):
                    c = next(c for c in e["corridas"] if c["id"] == ctx.corrida_id)
                    c.setdefault("_revisionAgoraDatos", {})[gen] = {"resultado": dato, "registro": registro}
                    return True
                ctx.mutar(cachear, "agora_gen")
                pista.resultado(f"{gen}: {dato.get('estado', 'no_disponible')}. {len(dato.get('secciones', []))} apartados revisados.")
        comprobar()
        fecha = P.ahora_ms()
        def guardar(e):
            c = next(c for c in e["corridas"] if c["id"] == ctx.corrida_id)
            informes = []
            for original in hipotesis:
                h = next((h for h in hipotesis_de(e, ctx.investigacion_id) if h["id"] == original["id"]), None)
                if not h or huella(h) != huella(original):
                    continue
                propios = [resultados[g] for g in candidatos[h["id"]]]
                estado = _estado(propios)
                h["revisionAgora"] = {"version": VERSION, "versionHipotesis": h.get("version", 1), "huella": huella(h), "hipotesisId": h["id"],
                    "corridaId": ctx.corrida_id, "iteracionId": ctx.iteracion_id, "fecha": fecha, "estado": estado,
                    "resumen": f"{len(propios)} candidatos revisados; {sum(bool(x.get('gen')) for x in propios)} identidades resueltas. Estado: {estado}.",
                    "genes": [_gen_publico(g, resultados[g]) for g in candidatos[h["id"]]],
                    "limitaciones": list(dict.fromkeys([_LIMITACION, *[str(a) for r in propios for a in r.get("advertencias", [])]]))}
                h.setdefault("novedad", {})["agora"] = _nominacion(propios)
                existentes = {r.get("id") for r in h.get("consultas", [])}
                for gen in candidatos[h["id"]]:
                    registro = registros[gen]
                    if registro.get("id") not in existentes:
                        h.setdefault("consultas", []).append(registro)
                        existentes.add(registro.get("id"))
                informes.append(h)
            estado = _estado(list(resultados.values()))
            if huella_investigacion(e, ctx.investigacion_id) != huella_inicial:
                estado = "en_curso"
            c["revisionAgora"] = {"version": VERSION, "estado": estado, "huella": huella_inicial, "fecha": fecha, "genes": genes, "motivo": motivo, "hipotesis": [h["id"] for h in informes]}
            contenido = "# Revisión de Agora\n\nLos datos completos y sus consultas se exportan como agora.json en el RO-Crate de cada hipótesis.\n\n" + "\n\n".join("## " + h.get("titulo", h["id"]) + "\n\n" + texto_revision(h) for h in informes)
            art = A.guardar_artefacto(e, ctx.investigacion_id, f"Revisión Agora · corrida {c.get('numero', ctx.corrida_id)}", "informe", contenido, f"Agora: {len(genes)} candidatos; {estado}", ctx.numero, fecha,
                                       procedencia=A.procedencia_artefacto(registroEjecucion=list(registros.values()), entorno={"metodo": "agora", "version": VERSION}))
            c["revisionAgora"]["artefactoId"] = art
            for h in informes:
                h["revisionAgora"]["artefactoId"] = art
            return True
        ctx.mutar(guardar, "agora_cierre")
        resultado = comprobar()["revisionAgora"]
        if resultado["estado"] in {"parcial", "no_comprobado"}:
            ctx.incidencia("fuente_sin_respuesta", "La revisión de Agora quedó incompleta",
                           "No pude comprobar todos los apartados o identidades de Agora. Las limitaciones están conservadas en el informe; no significan ausencia de evidencia.",
                           "agora", "El cierre conserva esta limitación. Una nueva revisión con otro alcance vuelve a intentar las consultas incompletas.")
        pista.cerrar(f"Revisión de Agora: {resultado['estado']}; {len(genes)} candidatos.")
        return resultado
    except BaseException:
        pista.cerrar("Revisión de Agora interrumpida; el cierre queda pendiente.", "detenida")
        raise
