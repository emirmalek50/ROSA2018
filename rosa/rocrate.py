"""El expediente de una hipotesis como RO-Crate con procedencia W3C PROV.

Mientras el libro de procedencia sea propio de ROSA2018, verificarlo obliga a
confiar en ROSA2018. RO-Crate es el formato estandar para empaquetar datos con
sus metadatos (JSON-LD sobre schema.org); su perfil Process Run Crate
describe ejecuciones (CreateAction con instrumento, entradas, salidas,
agente y tiempos), y W3C PROV es el vocabulario de procedencia que cualquier
herramienta entiende. Aqui se arma, sin ningun modelo:

  ro-crate-metadata.json   RO-Crate 1.2, conformsTo Process Run Crate 0.6
  prov.json                PROV-JSON con entidades, actividades y agentes
  hipotesis.json           la hipotesis tal como esta en el estado
  prerregistro.md          el texto congelado, si existe
  dossier.md               el dossier, generado ahora
  fuentes.csv              las fuentes con identificadores y riesgo de sesgo
  decisiones.json          las decisiones del Killer y de las personas
  ejecuciones/<id>.py      el codigo de cada analisis, y su resultado en JSON
  sello/<tsa>.tsr          los tokens RFC 3161 del prerregistro (verificables
                           con openssl sin ROSA2018)
  README.md                que hay y como verificarlo

Los datasets no van dentro (pueden ser datos con acceso controlado): se
referencian como Dataset con su sha256. El experimento propuesto va tipado
tambien como LabProcess (Bioschemas), siguiendo la propuesta de 2025 de
fusionar procedencia computacional y experimental en el mismo crate.

Referencias: RO-Crate 1.2 (w3id.org/ro/crate/1.2); Workflow Run RO-Crate
(Leo y otros, PLOS One 2024); PROV-O y PROV-JSON (W3C); Ott y otros, J Integr
Bioinform 2025.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any

from rosa import sello as S
from rosa import version as VERSION

CONTEXTO = "https://w3id.org/ro/crate/1.2/context"
PERFIL = "https://w3id.org/ro/wfrun/process/0.6"


def _iso(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _limpio(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _limpio(x) for k, x in v.items() if not (isinstance(k, str) and k.startswith("_"))}
    if isinstance(v, list):
        return [_limpio(x) for x in v]
    return v


def armar(e: dict[str, Any], h: dict[str, Any], ahora: int) -> dict[str, Any]:
    """Devuelve {"ficheros": {nombre: bytes}, "metadata": dict, "prov": dict}."""
    from rosa.dossier import texto_dossier

    inv = next((i for i in e["investigaciones"] if i["id"] == h["investigacionId"]), None)
    corridas = [c for c in e.get("corridas", []) if c.get("investigacionId") == h["investigacionId"]]
    corrida = corridas[-1] if corridas else None
    arnes = (corrida or {}).get("arnes") or VERSION.arnes()
    decisiones = [d for d in e.get("decisiones", []) if d.get("hipotesisId") == h["id"]]
    ejecuciones = [x for x in e.get("ejecuciones", []) if x.get("hipotesisId") == h["id"]]
    planes = {p["id"]: p for p in e.get("planesAnalisis", [])}
    x = h.get("experimento") or {}
    art_prerreg = next((a for a in e.get("artefactos", []) if a["id"] == x.get("prerregistroArtefactoId")), None)
    ficheros: dict[str, bytes] = {}
    grafo: list[dict[str, Any]] = []
    partes: list[dict[str, str]] = []
    acciones: list[dict[str, str]] = []
    prov: dict[str, Any] = {"prefix": {"rosa": "https://rosa.alzheimer-project.org/", "prov": "http://www.w3.org/ns/prov#", "xsd": "http://www.w3.org/2001/XMLSchema#"}, "entity": {}, "activity": {}, "agent": {}, "used": {}, "wasGeneratedBy": {}, "wasAssociatedWith": {}, "wasDerivedFrom": {}, "wasAttributedTo": {}, "wasRevisionOf": {}}

    def fichero(nombre: str, contenido: bytes, tipo: str, props: dict[str, Any] | None = None) -> str:
        ficheros[nombre] = contenido
        grafo.append({"@id": nombre, "@type": "File", "name": nombre, "encodingFormat": tipo, "contentSize": str(len(contenido)), "sha256": S.hash_canonico(contenido), **(props or {})})
        partes.append({"@id": nombre})
        prov["entity"][f"rosa:{nombre}"] = {"prov:type": "prov:Entity", "rosa:sha256": S.hash_canonico(contenido)}
        return nombre

    # Agentes.
    grafo.append({"@id": "#rosa", "@type": "SoftwareApplication", "name": "ROSA2018", "description": "IA del proyecto Alzheimer de AI Robotix y el INTEC", "softwareVersion": arnes.get("commit", ""), "identifier": f"firmas {arnes.get('firmas', '')}"})
    prov["agent"]["rosa:ROSA2018"] = {"prov:type": {"$": "prov:SoftwareAgent", "type": "xsd:QName"}, "rosa:commit": arnes.get("commit", ""), "rosa:firmas": arnes.get("firmas", "")}
    personas = sorted({d.get("quien", "") for d in decisiones if d.get("etapa") == "persona"} - {""})
    for i, p in enumerate(personas):
        grafo.append({"@id": f"#persona-{i}", "@type": "Person", "name": p})
        prov["agent"][f"rosa:persona-{i}"] = {"prov:type": {"$": "prov:Person", "type": "xsd:QName"}, "rosa:nombre": p}
    for rol in ("cerebro", "juez", "volumen"):
        modelo = ((corrida or {}).get("entorno") or {}).get(rol) or {"cerebro": "openai/gpt-6-astra", "juez": "anthropic/claude-opus-5", "volumen": "anthropic/claude-sonnet-5"}[rol]
        grafo.append({"@id": f"#modelo-{rol}", "@type": "SoftwareApplication", "name": modelo, "description": f"Modelo de lenguaje en el rol '{rol}', por el AI Gateway de Vercel"})
        prov["agent"][f"rosa:modelo-{rol}"] = {"prov:type": {"$": "prov:SoftwareAgent", "type": "xsd:QName"}, "rosa:modelo": modelo, "rosa:rol": rol}

    # La hipotesis y su expediente.
    fichero("hipotesis.json", json.dumps(_limpio(h), ensure_ascii=False, indent=1).encode("utf-8"), "application/json", {"description": f"Hipótesis {h['id']} versión {h.get('version', 1)} tal como está en el estado de ROSA2018"})
    from rosa.revision_agora import datos_exportacion

    agora = datos_exportacion(e, h)
    if agora is not None:
        fichero("agora.json", json.dumps(agora, ensure_ascii=False, indent=1).encode("utf-8"), "application/json", {"description": "Revisión de Agora con respuestas completas, consultas, cobertura y vigencia. Contexto de investigación, no evidencia verificada automáticamente."})
    fichero("dossier.md", texto_dossier(e, h, inv, corrida, ahora).encode("utf-8"), "text/markdown", {"description": "Dossier para el laboratorio, generado sin ningún modelo desde el estado"})
    fichero("decisiones.json", json.dumps(_limpio(decisiones), ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "referencia", "titulo", "anio", "doi", "pmid", "nct", "tipoEstudio", "nivelEvidencia", "cohorte", "retraccion", "riesgoSesgoInstrumento", "riesgoSesgoGlobal"])
    for f in h.get("procedencia", {}).get("fuentes", []):
        rs = f.get("riesgoSesgo") or {}
        w.writerow([f.get("id"), f.get("referencia"), f.get("titulo"), f.get("anio"), f.get("doi"), f.get("pmid"), f.get("nct"), f.get("tipoEstudio"), f.get("nivelEvidencia"), f.get("cohorte"), f.get("retraccion"), rs.get("instrumento"), rs.get("global")])
    fichero("fuentes.csv", buf.getvalue().encode("utf-8"), "text/csv")

    # Versiones de la hipótesis como revisiones PROV (rosa/registro.py): una entidad por
    # versión y wasRevisionOf de la n+1 a la n, con qué cambió campo a campo.
    from rosa import registro as REG

    for i, rev in enumerate(REG.revisiones_prov(h)):
        prov["entity"].setdefault(f"rosa:{rev['revisionDe']}", {"prov:type": "prov:Entity", "rosa:version": rev["revisionDe"].rsplit("-v", 1)[-1]})
        prov["entity"].setdefault(f"rosa:{rev['entidad']}", {"prov:type": "prov:Entity", "rosa:version": rev["entidad"].rsplit("-v", 1)[-1]})
        prov["wasRevisionOf"][f"_:rev-{i}"] = {"prov:generatedEntity": f"rosa:{rev['entidad']}", "prov:usedEntity": f"rosa:{rev['revisionDe']}", "rosa:fecha": _iso(rev.get("fecha")), "rosa:quien": rev.get("quien", ""), "rosa:motivo": (rev.get("motivo") or "")[:300], "rosa:cambios": [c["campo"] for c in rev.get("cambios", [])]}
    if h.get("versiones"):
        prov["wasRevisionOf"]["_:rev-actual"] = {"prov:generatedEntity": "rosa:hipotesis.json", "prov:usedEntity": f"rosa:hipotesis-{h['id']}-v{h.get('version', 1)}"}

    # Decisiones del Killer y de personas como acciones.
    for i, d in enumerate(decisiones):
        aid = f"#decision-{i}"
        es_persona = d.get("etapa") == "persona"
        agente = next((f"#persona-{j}" for j, p in enumerate(personas) if p == d.get("quien")), "#rosa") if es_persona else "#rosa"
        grafo.append({"@id": aid, "@type": "CreateAction" if not es_persona else "AssessAction", "name": f"Decisión {d.get('etapa')}: {d.get('decision')} (versión {d.get('version')})", "description": (d.get("motivo") or "")[:500], "instrument": {"@id": "#rosa" if not es_persona else "#rosa"} if not es_persona else {"@id": "#modelo-juez"}, "agent": {"@id": agente}, "object": {"@id": "hipotesis.json"}, "result": {"@id": "decisiones.json"}, "endTime": _iso(d.get("fecha")), "actionStatus": {"@id": "http://schema.org/CompletedActionStatus"}})
        if not es_persona:
            grafo[-1]["instrument"] = {"@id": "#modelo-juez"}
        acciones.append({"@id": aid})
        prov["activity"][f"rosa:decision-{i}"] = {"prov:endTime": _iso(d.get("fecha")), "rosa:etapa": d.get("etapa"), "rosa:decision": d.get("decision")}
        prov["used"][f"_:u-d{i}"] = {"prov:activity": f"rosa:decision-{i}", "prov:entity": "rosa:hipotesis.json"}
        prov["wasAssociatedWith"][f"_:a-d{i}"] = {"prov:activity": f"rosa:decision-{i}", "prov:agent": agente.replace("#", "rosa:")}

    # Ejecuciones in silico: codigo, resultado y el dataset referenciado por hash.
    for i, run in enumerate(ejecuciones):
        codigo = fichero(f"ejecuciones/{run['id']}.py", (run.get("codigo") or "").encode("utf-8"), "text/x-python", {"description": f"Código del plan {run.get('hashPlan') or planes.get(run.get('planId'), {}).get('hashPlan', '')} con semilla {run.get('semilla')}"})
        salida = fichero(f"ejecuciones/{run['id']}.json", json.dumps(_limpio({k: run.get(k) for k in ("estado", "runtime", "resultados", "baseline", "controlNegativo", "repeticiones", "interpretacion", "auditoria", "ensayoSeco", "duracionS", "codigoSalida", "entorno")}), ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
        ds_id = f"#dataset-{run.get('hashDatos', '')[:16] or i}"
        if not any(g["@id"] == ds_id for g in grafo):
            grafo.append({"@id": ds_id, "@type": "Dataset", "name": "Dataset de entrada (no incluido: puede tener acceso controlado)", "sha256": run.get("hashDatos", ""), "description": "Se identifica por su sha256; quien tenga el fichero puede comprobar que es el mismo."})
            prov["entity"][ds_id.replace("#", "rosa:")] = {"prov:type": "prov:Entity", "rosa:sha256": run.get("hashDatos", "")}
        img = (run.get("entorno") or {}).get("imagen") or "tabular"
        sb = f"#sandbox-{img}"
        if not any(g["@id"] == sb for g in grafo):
            grafo.append({"@id": sb, "@type": "SoftwareApplication", "name": f"Sandbox de ROSA2018 ({img})", "description": "Contenedor sin red, con plan congelado y control negativo obligatorio", "softwareVersion": json.dumps((run.get("entorno") or {}).get("paquetes", [])[:12], ensure_ascii=False)})
        aid = f"#ejecucion-{run['id']}"
        grafo.append({"@id": aid, "@type": "CreateAction", "name": f"Análisis in silico {run['id']} ({run.get('estado')})", "instrument": {"@id": sb}, "agent": {"@id": "#rosa"}, "object": [{"@id": codigo}, {"@id": ds_id}], "result": {"@id": salida}, "startTime": _iso(run.get("inicio")), "endTime": _iso(run.get("fin")), "actionStatus": {"@id": "http://schema.org/CompletedActionStatus" if run.get("estado") == "completado" else "http://schema.org/FailedActionStatus"}, "error": (run.get("error") or "")[:300] or None})
        acciones.append({"@id": aid})
        act = aid.replace("#", "rosa:")
        prov["activity"][act] = {"prov:startTime": _iso(run.get("inicio")), "prov:endTime": _iso(run.get("fin")), "rosa:estado": run.get("estado"), "rosa:semilla": run.get("semilla")}
        prov["used"][f"_:u-e{i}a"] = {"prov:activity": act, "prov:entity": f"rosa:{codigo}"}
        prov["used"][f"_:u-e{i}b"] = {"prov:activity": act, "prov:entity": ds_id.replace("#", "rosa:")}
        prov["wasGeneratedBy"][f"_:g-e{i}"] = {"prov:entity": f"rosa:{salida}", "prov:activity": act, "prov:time": _iso(run.get("fin"))}
        prov["wasAssociatedWith"][f"_:a-e{i}"] = {"prov:activity": act, "prov:agent": "rosa:ROSA2018"}
        prov["wasDerivedFrom"][f"_:d-e{i}"] = {"prov:generatedEntity": f"rosa:{salida}", "prov:usedEntity": ds_id.replace("#", "rosa:")}

    # Prerregistro, su sello externo y el experimento como LabProcess.
    if art_prerreg:
        contenido = ((art_prerreg.get("versiones") or [{}])[-1].get("contenido") or "")
        pre = fichero("prerregistro.md", contenido.encode("utf-8"), "text/markdown", {"description": f"Prerregistro congelado el {_iso(x.get('prerregistradoEn'))}; versión {x.get('versionPrerregistrada')} de la hipótesis", "dateCreated": _iso(x.get("prerregistradoEn"))})
        grafo.append({"@id": "#prerregistro", "@type": "CreateAction", "name": "Prerregistro del experimento", "agent": {"@id": "#rosa"}, "instrument": {"@id": "#rosa"}, "object": {"@id": "hipotesis.json"}, "result": {"@id": pre}, "endTime": _iso(x.get("prerregistradoEn")), "actionStatus": {"@id": "http://schema.org/CompletedActionStatus"}})
        acciones.append({"@id": "#prerregistro"})
        prov["activity"]["rosa:prerregistro"] = {"prov:endTime": _iso(x.get("prerregistradoEn"))}
        prov["wasGeneratedBy"]["_:g-pre"] = {"prov:entity": f"rosa:{pre}", "prov:activity": "rosa:prerregistro"}
        sello = x.get("selloExterno") or {}
        for s_ in sello.get("sellos") or []:
            if s_.get("ok") and s_.get("tsrBase64"):
                nombre = f"sello/{s_['tsa']}.tsr"
                fichero(nombre, base64.b64decode(s_["tsrBase64"]), "application/timestamp-reply", {"description": f"Token RFC 3161 de {s_['tsa']} sobre sha256 {sello.get('hash')}: hora firmada {s_.get('genTime')}, serie {s_.get('serial')}. Verificar: {S.comando_verificacion(sello.get('hash', ''), nombre)}"})
                prov["wasAttributedTo"][f"_:t-{s_['tsa']}"] = {"prov:entity": f"rosa:{pre}", "prov:agent": f"rosa:tsa-{s_['tsa']}"}
                prov["agent"][f"rosa:tsa-{s_['tsa']}"] = {"prov:type": {"$": "prov:Organization", "type": "xsd:QName"}, "rosa:url": s_.get("url"), "rosa:genTime": s_.get("genTime")}
        grafo.append({"@id": "#experimento", "@type": ["LabProcess", "PlanAction"], "name": f"Experimento propuesto: {(x.get('ensayo') or '')[:120]}", "description": (x.get("protocolo") or "")[:1000], "agent": {"@id": "#rosa"}, "object": {"@id": pre}, "executesLabProtocol": {"@id": "#protocolo"}, "actionStatus": {"@id": "http://schema.org/PotentialActionStatus" if x.get("estado") in ("propuesto", "asignado") else "http://schema.org/CompletedActionStatus"}})
        grafo.append({"@id": "#protocolo", "@type": "LabProtocol", "name": "Protocolo prerregistrado", "description": (x.get("protocolo") or "")[:2000], "conformsTo": {"@id": "https://bioschemas.org/profiles/LabProtocol/0.8-DRAFT"}})

    # README con la verificacion.
    readme = "\n".join([
        f"# RO-Crate de la hipótesis {h['id']} (ROSA2018)",
        "",
        f"Generado el {_iso(ahora)} por ROSA2018 {arnes.get('commit', '')} (firmas {arnes.get('firmas', '')}). Investigación: {(inv or {}).get('titulo', '')}.",
        "",
        "Contenido: `ro-crate-metadata.json` (RO-Crate 1.2, perfil Process Run Crate 0.6), `prov.json` (W3C PROV-JSON), la hipótesis, el dossier, las decisiones, las fuentes con su riesgo de sesgo, el código y el resultado de cada análisis in silico, el prerregistro y sus sellos de tiempo RFC 3161.",
        "",
        "Cómo verificar sin ROSA2018:",
        "- Cada fichero lleva su sha256 en `ro-crate-metadata.json`: `shasum -a 256 <fichero>`.",
        "- El sello del prerregistro: `openssl ts -verify -digest <sha256 de prerregistro.md> -in sello/<TSA>.tsr -CAfile <certificado raíz de la TSA>`.",
        "- El crate: `rocrate-validator validate . -p process-run-crate` (paquete roc-validator).",
        "- La procedencia: `prov.json` se lee con la libreria `prov` de Python (`ProvDocument.deserialize(source='prov.json', format='json')`).",
        "",
        "Los datasets de entrada no van dentro (pueden tener acceso controlado): se identifican por su sha256.",
    ])
    fichero("README.md", readme.encode("utf-8"), "text/markdown")

    metadata = {
        "@context": CONTEXTO,
        "@graph": [
            {"@id": "ro-crate-metadata.json", "@type": "CreativeWork", "about": {"@id": "./"}, "conformsTo": [{"@id": "https://w3id.org/ro/crate/1.2"}, {"@id": PERFIL}]},
            {"@id": "./", "@type": "Dataset", "name": f"Expediente de la hipótesis: {h['titulo'][:120]}", "description": (h.get("enunciado") or "")[:1000], "datePublished": _iso(ahora), "license": {"@id": "https://spdx.org/licenses/CC-BY-4.0"}, "hasPart": partes, "mentions": acciones, "conformsTo": {"@id": PERFIL}, "creator": {"@id": "#rosa"}, "keywords": ["Alzheimer", "hipotesis", "procedencia", "ROSA2018"]},
            {"@id": "https://spdx.org/licenses/CC-BY-4.0", "@type": "CreativeWork", "name": "Creative Commons Attribution 4.0", "identifier": "CC-BY-4.0"},
        ] + grafo,
    }
    ficheros["ro-crate-metadata.json"] = json.dumps(metadata, ensure_ascii=False, indent=1).encode("utf-8")
    ficheros["prov.json"] = json.dumps(prov, ensure_ascii=False, indent=1).encode("utf-8")
    return {"ficheros": ficheros, "metadata": metadata, "prov": prov}


def zip_bytes(crate: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nombre, contenido in sorted(crate["ficheros"].items()):
            z.writestr(nombre, contenido)
    return buf.getvalue()
