"""Programas clínicos públicos, sin filtrar enfermedad ni estado del ensayo.

Conserva patrocinadores, colaboradores y alias para comprobar qué intervención
se estudió. Una consulta completa solo describe este registro y estos términos;
nunca acredita que ninguna empresa haya investigado el tratamiento.
"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlencode

from rosa.fuentes.base import FuenteNoDisponible, json_de, pedir
from rosa.fuentes.clinicaltrials import BASE, _limitador

MAX_TERMINOS = 6
MAX_PAGINAS = 3


def _objeto(valor: Any, campo: str) -> dict[str, Any]:
    if valor is None:
        return {}
    if not isinstance(valor, dict):
        raise FuenteNoDisponible(f"ClinicalTrials.gov: {campo} no es un objeto")
    return valor


def _lista(valor: Any, campo: str) -> list[Any]:
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise FuenteNoDisponible(f"ClinicalTrials.gov: {campo} no es una lista")
    return valor


def _textos(valor: Any, campo: str) -> list[str]:
    filas = _lista(valor, campo)
    if any(not isinstance(x, str) for x in filas):
        raise FuenteNoDisponible(f"ClinicalTrials.gov: {campo} contiene valores que no son texto")
    return filas


def _entidad(valor: Any, campo: str) -> dict[str, Any]:
    fila = _objeto(valor, campo)
    return {"nombre": fila.get("name"), "clase": fila.get("class")}


def _estudio(valor: Any) -> dict[str, Any]:
    s = _objeto(valor, "estudio")
    p = _objeto(s.get("protocolSection"), "protocolSection")
    ident = _objeto(p.get("identificationModule"), "identificationModule")
    nct = ident.get("nctId")
    if not isinstance(nct, str) or re.fullmatch(r"NCT\d{8}", nct) is None:
        raise FuenteNoDisponible("ClinicalTrials.gov: estudio sin un NCT válido")
    estado = _objeto(p.get("statusModule"), "statusModule")
    diseno = _objeto(p.get("designModule"), "designModule")
    condiciones = _objeto(p.get("conditionsModule"), "conditionsModule")
    patrocinio = _objeto(p.get("sponsorCollaboratorsModule"), "sponsorCollaboratorsModule")
    tratamientos = _objeto(p.get("armsInterventionsModule"), "armsInterventionsModule")
    intervenciones = []
    for x in _lista(tratamientos.get("interventions"), "interventions"):
        i = _objeto(x, "intervención")
        intervenciones.append({"nombre": i.get("name"), "tipo": i.get("type"),
                              "otrosNombres": _textos(i.get("otherNames"), "otherNames"),
                              "descripcion": i.get("description"),
                              "brazos": _textos(i.get("armGroupLabels"), "armGroupLabels")})
    brazos = []
    for x in _lista(tratamientos.get("armGroups"), "armGroups"):
        b = _objeto(x, "brazo")
        brazos.append({"nombre": b.get("label"), "tipo": b.get("type"),
                       "descripcion": b.get("description"),
                       "intervenciones": _textos(b.get("interventionNames"), "interventionNames")})
    referencias = []
    ref = _objeto(p.get("referencesModule"), "referencesModule")
    for x in _lista(ref.get("references"), "references"):
        r = _objeto(x, "referencia")
        referencias.append({"pmid": r.get("pmid"), "tipo": r.get("type"), "cita": r.get("citation")})
    resultados = _objeto(s.get("resultsSection"), "resultsSection")
    medidas = _objeto(resultados.get("outcomeMeasuresModule"), "outcomeMeasuresModule")
    desenlaces = []
    for x in _lista(medidas.get("outcomeMeasures"), "outcomeMeasures"):
        m = _objeto(x, "desenlace")
        desenlaces.append({"titulo": m.get("title"), "tipo": m.get("type"),
                          "plazo": m.get("timeFrame"), "descripcion": m.get("description"),
                          "unidades": m.get("unitOfMeasure")})
    publicados = s.get("hasResults")
    if publicados is not None and not isinstance(publicados, bool):
        raise FuenteNoDisponible("ClinicalTrials.gov: hasResults no es booleano")
    fechas = {"estadoVerificado": estado.get("statusVerifiedDate")}
    for nombre, clave in (("inicio", "startDateStruct"), ("finalizacionPrimaria", "primaryCompletionDateStruct"),
                          ("finalizacion", "completionDateStruct"), ("primeraPublicacion", "studyFirstPostDateStruct"),
                          ("ultimaActualizacion", "lastUpdatePostDateStruct"),
                          ("resultadosPrimeraPublicacion", "resultsFirstPostDateStruct")):
        f = _objeto(estado.get(clave), clave)
        fechas[nombre] = {"fecha": f.get("date"), "tipo": f.get("type")}
    return {"nct": nct, "url": f"https://clinicaltrials.gov/study/{nct}",
            "titulo": ident.get("briefTitle"), "tituloOficial": ident.get("officialTitle"),
            "codigoPatrocinador": _objeto(ident.get("orgStudyIdInfo"), "orgStudyIdInfo").get("id"),
            "estado": estado.get("overallStatus"), "tipo": diseno.get("studyType"),
            "fases": _textos(diseno.get("phases"), "phases"),
            "condiciones": _textos(condiciones.get("conditions"), "conditions"),
            "patrocinador": _entidad(patrocinio.get("leadSponsor"), "leadSponsor"),
            "colaboradores": [_entidad(x, "colaborador") for x in _lista(patrocinio.get("collaborators"), "collaborators")],
            "intervenciones": intervenciones, "brazos": brazos,
            "whyStopped": estado.get("whyStopped"), "hasResults": publicados, "fechas": fechas,
            "resultados": {"publicados": publicados, "secciones": list(resultados),
                           "desenlaces": desenlaces, "referencias": referencias}}


async def buscar(terminos: list[str], max_paginas: int = 3, tamano_pagina: int = 50) -> dict[str, Any]:
    """Busca cada nombre o alias literal en las intervenciones del registro.

    Las coincidencias son candidatos, no una decisión de equivalencia. Se
    deduplican por NCT y se conserva qué términos los recuperaron. Los topes,
    errores y respuestas inconsistentes dejan la cobertura incompleta visible.
    """
    if not isinstance(terminos, list) or not terminos:
        raise ValueError("Se necesita una lista de nombres o alias de la intervención")
    if (type(max_paginas) is not int or max_paginas < 1 or
            type(tamano_pagina) is not int or not 1 <= tamano_pagina <= 1000):
        raise ValueError("Las páginas deben ser enteras positivas y su tamaño debe estar entre 1 y 1000")
    nombres = []
    vistos = set()
    for termino in terminos:
        if (not isinstance(termino, str) or not termino.strip() or len(termino) > 300 or
                any(ord(c) < 32 for c in termino) or '"' in termino or "\\" in termino):
            raise ValueError("Cada nombre debe ser texto de 1 a 300 caracteres, sin controles, comillas ni barras inversas")
        limpio = termino.strip()
        if limpio.casefold() not in vistos:
            nombres.append(limpio)
            vistos.add(limpio.casefold())
    limitaciones = ["ClinicalTrials.gov no cubre toda la investigación mundial ni los programas preclínicos privados; no permite afirmar que ninguna compañía haya probado el tratamiento.",
                    "Los registros y las fechas proceden de sus responsables; un ensayo terminado o sin resultados públicos no demuestra fracaso ni ausencia de investigación."]
    if len(nombres) > MAX_TERMINOS:
        limitaciones.append(f"Solo se consultaron los primeros {MAX_TERMINOS} términos únicos de {len(nombres)}; faltan alias por comprobar.")
    if max_paginas > MAX_PAGINAS:
        limitaciones.append(f"Se limitó la búsqueda a {MAX_PAGINAS} páginas por término.")
    consultas = []
    por_nct: dict[str, dict[str, Any]] = {}
    for termino in nombres[:MAX_TERMINOS]:
        parametros = {"query.intr": f'"{termino}"', "pageSize": tamano_pagina, "countTotal": "true", "format": "json"}
        consulta: dict[str, Any] = {"fuente": "ClinicalTrials.gov", "consulta": termino,
                                   "url": BASE + "?" + urlencode(parametros), "parametros": dict(parametros),
                                   "consultadoEn": datetime.now(timezone.utc).isoformat(),
                                   "total": None, "recuperados": 0, "paginas": 0, "completa": False,
                                   "error": None, "paginasConsultadas": []}
        consultas.append(consulta)
        ids: set[str] = set()
        cursores: set[str] = set()
        try:
            for numero in range(min(max_paginas, MAX_PAGINAS)):
                r = await pedir("GET", BASE, _limitador, params=parametros)
                consulta["paginas"] += 1
                cuerpo = _objeto(json_de(r), "respuesta")
                if "studies" not in cuerpo or not isinstance(cuerpo["studies"], list):
                    raise FuenteNoDisponible("ClinicalTrials.gov: respuesta sin una lista studies válida")
                filas = _lista(cuerpo["studies"], "studies")
                total = cuerpo.get("totalCount")
                if type(total) is not int or total < 0:
                    raise FuenteNoDisponible("ClinicalTrials.gov: totalCount no es un entero válido")
                conteo_cambio = consulta["total"] is not None and consulta["total"] != total
                if consulta["total"] is None:
                    consulta["total"] = total
                consulta["paginasConsultadas"].append({"url": BASE + "?" + urlencode(parametros), "cantidad": len(filas)})
                for fila in filas:
                    estudio = _estudio(fila)
                    nct = estudio["nct"]
                    if nct in ids:
                        raise FuenteNoDisponible("ClinicalTrials.gov: un NCT se repitió dentro de la misma consulta")
                    ids.add(nct)
                    if nct not in por_nct:
                        por_nct[nct] = {**estudio, "terminosCoincidentes": []}
                    if termino not in por_nct[nct]["terminosCoincidentes"]:
                        por_nct[nct]["terminosCoincidentes"].append(termino)
                consulta["recuperados"] = len(ids)
                if conteo_cambio:
                    raise FuenteNoDisponible("ClinicalTrials.gov: totalCount cambió durante la paginación")
                if len(ids) > total or (not filas and total > len(ids)):
                    raise FuenteNoDisponible("ClinicalTrials.gov: cantidad de estudios incompatible con totalCount")
                siguiente = cuerpo.get("nextPageToken")
                if siguiente is not None and (not isinstance(siguiente, str) or not siguiente or len(siguiente) > 10000):
                    raise FuenteNoDisponible("ClinicalTrials.gov: cursor de página inválido")
                if not siguiente:
                    if len(ids) != total:
                        raise FuenteNoDisponible("ClinicalTrials.gov: faltan estudios y no hay otra página")
                    consulta["completa"] = True
                    break
                if siguiente in cursores:
                    raise FuenteNoDisponible("ClinicalTrials.gov: cursor de página repetido")
                if len(ids) >= total:
                    raise FuenteNoDisponible("ClinicalTrials.gov: existe otra página aunque se alcanzó totalCount")
                cursores.add(siguiente)
                if numero + 1 == min(max_paginas, MAX_PAGINAS):
                    limitaciones.append(f"{termino}: se recuperaron {len(ids)} de {total} estudios; quedó otra página sin consultar.")
                parametros = {**parametros, "pageToken": siguiente}
        except FuenteNoDisponible as ex:
            consulta["recuperados"] = len(ids)
            consulta["error"] = str(ex)
            limitaciones.append(f"{termino}: no pude completar la consulta ({ex}); no se afirma ausencia.")
    return {"estudios": list(por_nct.values()), "consultas": consultas, "limitaciones": limitaciones}
