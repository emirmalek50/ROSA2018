"""Los conectores a bases públicas, por grupo. Cada uno envuelve una API REST
o GraphQL sin clave (salvo NCBI y Semantic Scholar, opcionales), con el
límite de peticiones que la fuente pública y su licencia. Las formas de
respuesta se comprobaron en vivo el 11 de septiembre de 2026.
"""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import quote

from rosa import config
from rosa.conectores.base import Resultado, conector
from rosa.fuentes.base import FuenteNoDisponible, Limitador, compartido, pedir

ALZHEIMER_MONDO = "MONDO_0004975"
ALZHEIMER_EFO = "EFO_0000249"
HUMANO = 9606

_lim = {
    "ols": Limitador(5.0), "mygene": Limitador(5.0), "myvariant": Limitador(2.0), "uniprot": Limitador(5.0), "ensembl": Limitador(10.0),
    "string": Limitador(1.0), "reactome": Limitador(5.0), "gwas": Limitador(5.0), "chembl": Limitador(3.0), "hpa": Limitador(3.0),
    "alphafold": Limitador(3.0), "pdb": Limitador(3.0), "biorxiv": Limitador(2.0), "s2": Limitador(1.0), "ncbi": compartido("ncbi", 9.0 if getattr(config, "CLAVE_NCBI", "") else 2.5),
    "cellxgene": Limitador(1.0), "synapse": Limitador(2.0), "gtex": Limitador(3.0),
}


def _esq(**props: str) -> dict[str, Any]:
    return {"type": "object", "properties": {k: {"type": "string", "description": v} for k, v in props.items()}, "required": list(props)}


# ---------------------------------------------------------------------------
# Ontologias e identificadores
# ---------------------------------------------------------------------------


@conector("ols_resolver", "OLS4 (EMBL-EBI)", "Resuelve un término de enfermedad o fenotipo a su identificador de ontología (MONDO, EFO, HPO)", "El identificador que exigen Open Targets y GWAS Catalog; sinonimos y definición", _esq(termino="Texto libre, por ejemplo 'Alzheimer disease'", ontologia="mondo, efo o hp"), "Cada ontologia la suya: MONDO y HPO CC BY 4.0, EFO Apache-2.0", "No publicado; 5 por segundo en ROSA2018", "https://www.ebi.ac.uk/ols4/api-docs", grupo="genes_ontologias")
async def ols_resolver(termino: str, ontologia: str = "mondo") -> Resultado:
    r = await pedir("GET", "https://www.ebi.ac.uk/ols4/api/search", _lim["ols"], params={"q": termino, "ontology": ontologia, "rows": 5})
    docs = r.json().get("response", {}).get("docs", [])
    filas = [{"id": d.get("short_form"), "etiqueta": d.get("label"), "definicion": (d.get("description") or [""])[0][:300], "ontologia": d.get("ontology_prefix")} for d in docs]
    exacto = [f for f in filas if (f["etiqueta"] or "").lower() == termino.lower()]
    return Resultado(filas, len(filas), [f["id"] for f in filas if f["id"]], None, (bool(exacto), f"coincidencia exacta: {exacto[0]['id']}" if exacto else "sin coincidencia exacta; revisar el primer resultado"))


@conector("mygene_gen", "MyGene.info (BioThings)", "Normaliza un símbolo de gen humano a Ensembl, UniProt y Entrez con su nombre", "Identificadores estables para la tarjeta y para consultar las demás bases", _esq(simbolo="Símbolo HGNC, por ejemplo APOE"), "Software Apache-2.0; los datos heredan la fuente", "5000 términos por POST; 5 por segundo en ROSA2018", "https://docs.mygene.info/", grupo="genes_ontologias")
async def mygene_gen(simbolo: str) -> Resultado:
    r = await pedir("GET", "https://mygene.info/v3/query", _lim["mygene"], params={"q": f"symbol:{simbolo}", "species": "human", "fields": "symbol,name,ensembl.gene,uniprot.Swiss-Prot,entrezgene,summary"})
    hits = r.json().get("hits", [])
    exactos = [h for h in hits if (h.get("symbol") or "").upper() == simbolo.upper()]
    h = exactos[0] if exactos else (hits[0] if hits else None)
    if not h:
        return Resultado(None, 0, [], None, (False, "el símbolo no resuelve a ningún gen humano"))
    ens = h.get("ensembl")
    ens_id = (ens[0] if isinstance(ens, list) else ens or {}).get("gene") if ens else None
    uni = (h.get("uniprot") or {}).get("Swiss-Prot")
    uni = uni[0] if isinstance(uni, list) else uni
    datos = {"simbolo": h.get("symbol"), "nombre": h.get("name"), "ensembl": ens_id, "uniprot": uni, "entrez": str(h.get("entrezgene") or h.get("_id")), "resumen": (h.get("summary") or "")[:400]}
    return Resultado(datos, 1, [i for i in (ens_id, uni) if i], None, (len(exactos) == 1 and bool(ens_id), "un único gen con Ensembl" if len(exactos) == 1 and ens_id else f"{len(exactos)} coincidencias exactas; Ensembl {'si' if ens_id else 'no'}"))


@conector("ensembl_gen", "Ensembl REST", "Coordenadas, biotipo y descripción de un gen humano (GRCh38)", "Build y posición, para que la identidad del dato viaje con la afirmación", _esq(simbolo="Símbolo HGNC"), "Sin restricciones", "15 por segundo (cabeceras X-RateLimit)", "https://rest.ensembl.org/", grupo="genomas")
async def ensembl_gen(simbolo: str) -> Resultado:
    r = await pedir("GET", f"https://rest.ensembl.org/lookup/symbol/homo_sapiens/{quote(simbolo)}", _lim["ensembl"], params={"content-type": "application/json"})
    d = r.json()
    datos = {"ensembl": d.get("id"), "simbolo": d.get("display_name"), "biotipo": d.get("biotype"), "cromosoma": d.get("seq_region_name"), "inicio": d.get("start"), "fin": d.get("end"), "build": d.get("assembly_name"), "descripcion": (d.get("description") or "")[:200]}
    return Resultado(datos, 1 if d.get("id") else 0, [d["id"]] if d.get("id") else [], str(d.get("version") or ""), (d.get("assembly_name") == "GRCh38", f"build {d.get('assembly_name')}"))


@conector("ensembl_transcrito", "Ensembl REST", "El transcrito canónico de un gen humano y su secuencia de ARN mensajero (cDNA), con cuántos transcritos más tiene", "La secuencia exacta sobre la que se diseña un oligonucleótido antisentido", _esq(ensembl="Identificador Ensembl del gen, por ejemplo ENSG00000186868", uniprot="Accession UniProt de la proteína, para confirmar que es la misma isoforma (opcional)"), "Sin restricciones", "15 por segundo (cabeceras X-RateLimit)", "https://rest.ensembl.org/documentation/info/sequence_id", grupo="genomas")
async def ensembl_transcrito(ensembl: str, uniprot: str = "") -> Resultado:
    """El transcrito canónico y su cDNA.

    Se pide el canónico y NO se eligen los demás por cuenta propia: MAPT tiene
    55 transcritos y en cerebro adulto seis isoformas de tau, y cuál se baja no
    es lo mismo que cuánta se baja. El número de transcritos viaja en la
    respuesta para que la pantalla pueda decir que esa decisión existe."""
    r = await pedir("GET", f"https://rest.ensembl.org/lookup/id/{quote(ensembl)}", _lim["ensembl"], params={"expand": "1", "content-type": "application/json"})
    d = r.json()
    ts = d.get("Transcript") or []
    canon = next((t for t in ts if t.get("is_canonical")), None) or next((t for t in ts if t.get("biotype") == "protein_coding"), None)
    if not canon:
        return Resultado(None, 0, [], None, (False, "el gen no trae transcritos"))
    s2 = await pedir("GET", f"https://rest.ensembl.org/sequence/id/{quote(canon['id'])}", _lim["ensembl"], params={"type": "cdna", "content-type": "application/json"})
    seq = str(s2.json().get("seq") or "").upper()
    # Dónde empieza y acaba la parte que se traduce a proteína. Hace falta para
    # saber en qué región cae cada ventana, y eso importa de verdad: un
    # análisis de eficacia da ~53 % de reducción de mediana para 3'UTR y exón,
    # 44 % para 5'UTR y 32 % para las uniones de exones.
    inicio_cds = fin_cds = None
    if canon.get("biotype") == "protein_coding" and seq:
        s3 = await pedir("GET", f"https://rest.ensembl.org/sequence/id/{quote(canon['id'])}", _lim["ensembl"], params={"type": "cds", "content-type": "application/json"})
        cds = str(s3.json().get("seq") or "").upper()
        # Solo si aparece UNA vez: si no, no se sabe dónde empieza.
        if cds and seq.count(cds) == 1:
            i = seq.find(cds)
            inicio_cds, fin_cds = i + 1, i + len(cds)
    # MANE Select: el transcrito que el NCBI y el EMBL-EBI acuerdan como EL
    # representativo del gen, emparejado con la proteína canónica de UniProt.
    # Es lo que garantiza que la estructura que se dibuja y el ARN sobre el que
    # se diseña el oligo son la MISMA isoforma. Cuando no lo hay no se puede
    # confirmar, y eso pasa justo en los genes donde la pregunta está abierta:
    # MAPT no tiene MANE Select porque no hay acuerdo sobre cuál es la versión
    # representativa de tau.
    mane = None
    try:
        ru = await pedir("GET", f"https://rest.uniprot.org/uniprotkb/{quote(str(uniprot or ''))}.json", _lim["uniprot"], params={"fields": "xref_mane-select"}) if uniprot else None
        if ru is not None:
            mane = next((x.get("id") for x in ru.json().get("uniProtKBCrossReferences", []) if x.get("database") == "MANE-Select"), None)
    except Exception:  # noqa: BLE001  una fuente que no responde no cambia el diseño
        mane = None
    datos = {
        "gen": d.get("display_name"),
        "transcrito": canon.get("id"),
        "maneSelect": mane,
        # `None` es «no pude comprobarlo», `False` es «hay MANE y es OTRO».
        "mismaIsoformaQueLaProteina": None if not mane else (str(mane).split(".")[0] == str(canon.get("id"))),
        "biotipo": canon.get("biotype"),
        "esCanonico": bool(canon.get("is_canonical")),
        "transcritosDelGen": len(ts),
        "largo": len(seq),
        "inicioCds": inicio_cds,
        "finCds": fin_cds,
        "cdna": seq,
        "build": d.get("assembly_name"),
    }
    # Una secuencia que no sea solo ACGT no sirve para diseñar nada.
    limpia = bool(seq) and set(seq) <= set("ACGTN")
    return Resultado(datos, len(seq), [str(canon["id"])], str(canon.get("version") or ""), (limpia and d.get("assembly_name") == "GRCh38", f"{len(seq)} nt, build {d.get('assembly_name')}"))


@conector("myvariant_variante", "MyVariant.info (BioThings)", "Anota una variante por rsID: gen, significado clínico en ClinVar, frecuencia en gnomAD, CADD", "Si una variante nombrada en una hipótesis es patogenica, frecuente o rara", _esq(rsid="Identificador dbSNP, por ejemplo rs429358"), "Software Apache-2.0; ClinVar dominio publico, gnomAD ficheros publicos", "1000 peticiones por IP y día sin clave", "https://docs.myvariant.info/", grupo="variantes")
async def myvariant_variante(rsid: str) -> Resultado:
    r = await pedir("GET", "https://myvariant.info/v1/query", _lim["myvariant"], params={"q": f"dbsnp.rsid:{rsid}", "fields": "clinvar.rcv.clinical_significance,gnomad_genome.af.af,dbsnp.gene.symbol,cadd.phred", "assembly": "hg38"})
    hits = r.json().get("hits", [])
    if not hits:
        return Resultado(None, 0, [], None, (False, "rsID sin registro"))
    h = hits[0]
    rcv = (h.get("clinvar") or {}).get("rcv") or []
    rcv = rcv if isinstance(rcv, list) else [rcv]
    sig = sorted({x.get("clinical_significance", "") for x in rcv if x.get("clinical_significance")})
    gen = (h.get("dbsnp") or {}).get("gene")
    gen = (gen[0] if isinstance(gen, list) else gen or {}).get("symbol") if gen else None
    af = ((h.get("gnomad_genome") or {}).get("af") or {}).get("af")
    datos = {"hgvs": h.get("_id"), "gen": gen, "clinvar": sig, "gnomad_af": af, "cadd_phred": (h.get("cadd") or {}).get("phred"), "build": "hg38"}
    return Resultado(datos, 1, [h.get("_id", rsid)], None, (bool(gen), f"gen {gen}" if gen else "sin gen anotado"))


# ---------------------------------------------------------------------------
# Proteinas, expresion, estructuras
# ---------------------------------------------------------------------------


@conector("uniprot_proteina", "UniProt REST", "Función y longitud de la proteína revisada (Swiss-Prot) de un gen humano", "La función en una frase para el resumen en llano y para la tarjeta", _esq(simbolo="Símbolo HGNC"), "CC BY 4.0", "Sin límite estricto; 5 por segundo en ROSA2018", "https://www.uniprot.org/help/programmatic_access", grupo="genes_ontologias")
async def uniprot_proteina(simbolo: str) -> Resultado:
    r = await pedir("GET", "https://rest.uniprot.org/uniprotkb/search", _lim["uniprot"], params={"query": f"gene_exact:{simbolo} AND organism_id:{HUMANO} AND reviewed:true", "fields": "accession,protein_name,gene_names,cc_function,length", "format": "json", "size": 3})
    res = r.json().get("results", [])
    if not res:
        return Resultado(None, 0, [], r.headers.get("x-uniprot-release"), (False, "sin entrada revisada"))
    e = res[0]
    funcion = ""
    for c in e.get("comments", []):
        if c.get("commentType") == "FUNCTION":
            funcion = " ".join(t.get("value", "") for t in c.get("texts", []))[:600]
    datos = {"accession": e.get("primaryAccession"), "nombre": ((e.get("proteinDescription") or {}).get("recommendedName") or {}).get("fullName", {}).get("value"), "longitud": (e.get("sequence") or {}).get("length"), "funcion": funcion}
    return Resultado(datos, len(res), [x.get("primaryAccession") for x in res], r.headers.get("x-uniprot-release"), (len(res) == 1, f"{len(res)} entradas revisadas"))


@conector("hpa_expresion", "Human Protein Atlas", "Expresión por tejido y región cerebral, especificidad y clase de proteína de un gen", "Donde se expresa lo que la hipótesis nombra: cerebro, tipo celular, sangre", _esq(ensembl="Identificador Ensembl, por ejemplo ENSG00000130203"), "CC BY 4.0 con cita de version", "No publicado; 3 por segundo en ROSA2018", "https://www.proteinatlas.org/about/help/dataaccess", grupo="proteinas")
async def hpa_expresion(ensembl: str) -> Resultado:
    r = await pedir("GET", f"https://www.proteinatlas.org/{quote(ensembl)}.json", _lim["hpa"])
    d = r.json()
    # Las claves de distribución ("Detected in all", "Not detected") son las que
    # permiten decir "ausente" en vez de "no pude comprobar": sin ellas HPA solo
    # lista lo enriquecido y nunca lo que no está. Las de núcleo único de cerebro y
    # la nCPM por tipo celular (HPA 24 ya no devuelve la nTPM de célula única) son
    # las que nombran los tipos celulares para la comprobación de contexto humano.
    claves = {k: d.get(k) for k in (
        "Gene", "Gene description", "Protein class", "Biological process",
        "RNA tissue specificity", "RNA tissue distribution", "RNA tissue specific nTPM",
        "RNA brain regional specificity", "RNA brain regional distribution", "RNA brain regional specific nTPM",
        "RNA single cell type specificity", "RNA single cell type distribution", "RNA single cell type specific nTPM", "RNA single cell type specific nCPM",
        "RNA single nuclei brain specificity", "RNA single nuclei brain distribution", "RNA single nuclei brain specific nCPM",
        "Brain expression cluster", "Blood expression cluster", "RNA tissue cell type enrichment", "Subcellular location",
    ) if k in d}
    return Resultado(claves, 1 if d.get("Gene") else 0, [ensembl], None, (bool(d.get("Gene")), f"gen {d.get('Gene')}"))


@conector("gtex_expresion", "GTEx v10", "Expresión mediana (TPM) de un gen en un tejido, por ejemplo hipocampo", "Si el gen se expresa en el tejido que la hipótesis dice", _esq(gencode="Identificador GENCODE con version, por ejemplo ENSG00000130203.10", tejido="tissueSiteDetailId, por ejemplo Brain_Hippocampus"), "Términos GTEx (datos abiertos del portal)", "No publicado; 3 por segundo en ROSA2018", "https://gtexportal.org/api/v2/redoc", grupo="expresion")
async def gtex_expresion(gencode: str, tejido: str = "Brain_Hippocampus") -> Resultado:
    r = await pedir("GET", "https://gtexportal.org/api/v2/expression/medianGeneExpression", _lim["gtex"], params={"gencodeId": gencode, "tissueSiteDetailId": tejido, "datasetId": "gtex_v10"})
    filas = r.json().get("data", [])
    datos = [{"gen": f.get("geneSymbol"), "tejido": f.get("tissueSiteDetailId"), "mediana": f.get("median"), "unidad": f.get("unit")} for f in filas]
    return Resultado(datos, len(datos), [gencode], "gtex_v10", (len(datos) == 1, f"{len(datos)} filas"))


@conector("gtex_gen", "GTEx v10", "Resuelve un símbolo de gen al identificador GENCODE con versión (v39, GRCh38) que GTEx exige en sus consultas de expresión", "El gencodeId con versión (por ejemplo ENSG00000131095.14 para GFAP) que hace falta para preguntar a gtex_expresion; MyGene no lo da", _esq(simbolo="Símbolo HGNC, por ejemplo GFAP"), "Términos GTEx (datos abiertos del portal)", "No publicado; 3 por segundo en ROSA2018", "https://gtexportal.org/api/v2/redoc", grupo="expresion")
async def gtex_gen(simbolo: str) -> Resultado:
    # Comprobado en vivo el 16 de septiembre de 2026: data[0].gencodeId = 'ENSG00000131095.14' para GFAP; GTEx v10 usa GENCODE v39.
    r = await pedir("GET", "https://gtexportal.org/api/v2/reference/gene", _lim["gtex"], params={"geneId": simbolo, "gencodeVersion": "v39", "genomeBuild": "GRCh38/hg38"})
    cuerpo = r.json()
    # Una respuesta con otra forma (una lista, "data" que no es lista) es un fallo de
    # la fuente, no "el símbolo no resuelve": queda como "no pude comprobar".
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("data"), list):
        raise FuenteNoDisponible("GTEx devolvió una respuesta sin la lista 'data'")
    filas = [f for f in cuerpo["data"] if isinstance(f, dict)]
    # GTEx busca por prefijo: al pedir GFAP devuelve también GFAP-AS1. Solo vale la
    # coincidencia exacta de símbolo; tomar la primera fila daría el GENCODE de OTRO
    # gen y el perfil de la diana leería la expresión equivocada.
    exactas = [f for f in filas if str(f.get("geneSymbol") or "").upper() == str(simbolo).upper() and f.get("gencodeId")]
    f = exactas[0] if exactas else None
    if not f:
        return Resultado(None, 0, [], "v39", (False, f"ninguna de las {len(filas)} filas coincide exactamente con el símbolo en GENCODE v39" if filas else "el símbolo no resuelve a ningún gen en GENCODE v39"))
    datos = {"simbolo": f.get("geneSymbol"), "gencode": f.get("gencodeId"), "tipo": f.get("geneType"), "cromosoma": f.get("chromosome"), "inicio": f.get("start"), "fin": f.get("end"), "hebra": f.get("strand"), "version_gencode": "v39", "genoma": "GRCh38/hg38"}
    return Resultado(datos, len(filas), [f["gencodeId"]], "v39", (len(exactas) == 1, f"{len(exactas)} coincidencia exacta de símbolo entre {len(filas)} filas; gencodeId {f['gencodeId']}"))


@conector("alphafold_estructura", "AlphaFold DB", "Modelo predicho de una proteína con su confianza (pLDDT) y versión", "Si hay estructura para razonar sobre un sitio de unión", _esq(uniprot="Accession UniProt, por ejemplo P02649"), "CC BY 4.0", "No publicado; 3 por segundo en ROSA2018", "https://alphafold.ebi.ac.uk/api-docs", grupo="estructuras")
async def alphafold_estructura(uniprot: str) -> Resultado:
    r = await pedir("GET", f"https://alphafold.ebi.ac.uk/api/prediction/{quote(uniprot)}", _lim["alphafold"])
    lst = r.json()
    if not lst:
        return Resultado(None, 0, [], None, (False, "sin modelo"))
    m = lst[0]
    datos = {"modelo": m.get("modelEntityId"), "plddt_medio": m.get("globalMetricValue"), "fraccion_confiable": (m.get("fractionPlddtConfident") or 0) + (m.get("fractionPlddtVeryHigh") or 0), "version": m.get("latestVersion"), "pdb": m.get("pdbUrl"), "creado": m.get("modelCreatedDate")}
    return Resultado(datos, len(lst), [m.get("modelEntityId")], str(m.get("latestVersion")), (m.get("globalMetricValue") is not None, f"pLDDT medio {m.get('globalMetricValue')}"))


@conector("pdb_estructuras", "RCSB PDB", "Cuantas estructuras experimentales hay para una proteína (por accession UniProt) y cuales", "Si el mecanismo se apoya en una estructura real", _esq(uniprot="Accession UniProt"), "CC0", "Pocas por segundo; 1000 identificadores por lote", "https://search.rcsb.org/", grupo="estructuras")
async def pdb_estructuras(uniprot: str) -> Resultado:
    cuerpo = {"query": {"type": "terminal", "service": "text", "parameters": {"attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession", "operator": "exact_match", "value": uniprot}}, "return_type": "entry", "request_options": {"paginate": {"start": 0, "rows": 10}}}
    r = await pedir("POST", "https://search.rcsb.org/rcsbsearch/v2/query", _lim["pdb"], json=cuerpo)
    if r.status_code == 204 or not r.text.strip():
        return Resultado({"total": 0, "entradas": []}, 0, [], None, (True, "cero estructuras (respuesta vacía legítima)"))
    d = r.json()
    ids = [x.get("identifier") for x in d.get("result_set", [])]
    return Resultado({"total": d.get("total_count", 0), "entradas": ids}, d.get("total_count", 0), ids, None, (True, f"{d.get('total_count', 0)} entradas"))


# ---------------------------------------------------------------------------
# Redes, rutas, genetica, farmacos
# ---------------------------------------------------------------------------


@conector("string_interactores", "STRING (MCP y REST oficiales)", "Los interactores funcionales de una proteína con su puntuación combinada", "La vecindad que se mueve si la diana falla; candidatos a confusor o mediador", _esq(simbolo="Símbolo HGNC"), "CC BY 4.0", "1 por segundo, sin paralelo; caller_identity obligatorio", "https://string-db.org/help/api/", grupo="proteinas")
async def string_interactores(simbolo: str) -> Resultado:
    r = await pedir("GET", "https://version-12-0.string-db.org/api/json/interaction_partners", _lim["string"], params={"identifiers": simbolo, "species": HUMANO, "limit": 10, "caller_identity": "rosa-alzheimer-project"})
    filas = r.json()
    datos = [{"interactor": f.get("preferredName_B"), "puntuacion": f.get("score"), "experimental": f.get("escore"), "bases": f.get("dscore"), "texto": f.get("tscore")} for f in filas]
    resolvio = bool(filas) and all((f.get("preferredName_A") or "").upper() == simbolo.upper() for f in filas)
    return Resultado(datos, len(datos), [f["interactor"] for f in datos if f["interactor"]], "12.0", (resolvio, "el símbolo resolvió a la proteína pedida" if resolvio else ("sin interactores: el símbolo no resolvió o no tiene red" if not filas else "STRING resolvió a otra proteína")))


@conector("reactome_rutas", "Reactome ContentService", "Las rutas curadas en las que participa una proteína (por accession UniProt)", "La ruta biológica de la diana, con identificador estable", _esq(uniprot="Accession UniProt"), "CC0", "No publicado; 5 por segundo en ROSA2018", "https://reactome.org/dev/content-service", grupo="genes_ontologias")
async def reactome_rutas(uniprot: str) -> Resultado:
    r = await pedir("GET", f"https://reactome.org/ContentService/data/mapping/UniProt/{quote(uniprot)}/pathways", _lim["reactome"], params={"species": HUMANO})
    if r.status_code == 204 or not r.text.strip():
        return Resultado([], 0, [], None, (True, "cero rutas (respuesta vacía legítima)"))
    filas = r.json()
    datos = [{"id": f.get("stId"), "nombre": f.get("displayName"), "enfermedad": f.get("isInDisease")} for f in filas]
    return Resultado(datos, len(datos), [f["id"] for f in datos if f["id"]], None, (True, f"{len(datos)} rutas"))


@conector("gwas_asociaciones_gen", "GWAS Catalog REST v2", "Asociaciones GWAS de un gen, separando las de Alzheimer del resto", "Si la genética humana ya vincula el gen con la enfermedad, y con que p", _esq(simbolo="Símbolo HGNC"), "CC0 / terminos EMBL-EBI", "15 por segundo", "https://www.ebi.ac.uk/gwas/rest/api/v2/docs", grupo="genetica_humana")
async def gwas_asociaciones_gen(simbolo: str) -> Resultado:
    """Dos consultas filtradas por gen: todas sus asociaciones y las de
    Alzheimer (MONDO_0004975). Hasta el 25 de septiembre de 2026 se pedía con
    `gene_name`, que la API v2 ignora: devolvía el catálogo entero (1.192.604
    asociaciones), se miraban las 50 primeras (de cáncer de pulmón) y ROSA2018
    escribía que APOE tiene 0 asociaciones con Alzheimer. Con `mapped_gene` son
    138. Si la API vuelve a ignorar el filtro, se dice (FuenteNoDisponible) en
    vez de contar un cero."""
    sim = simbolo.strip().upper()

    async def consulta(**extra: Any) -> tuple[list[dict[str, Any]], int]:
        r = await pedir("GET", "https://www.ebi.ac.uk/gwas/rest/api/v2/associations", _lim["gwas"], params={"mapped_gene": sim, "size": 20, "sort": "p_value", "direction": "asc", **extra})
        d = r.json()
        filas = (d.get("_embedded") or {}).get("associations", []) or []
        # Cada fila tiene que ser del gen pedido: si no, la API ignoró el filtro.
        ajenas = [a for a in filas if sim not in {str(g).upper() for g in (a.get("mapped_genes") or [])}]
        if ajenas:
            raise FuenteNoDisponible(f"GWAS Catalog ignoró el filtro por gen: {len(ajenas)} de {len(filas)} filas no son de {sim}")
        return filas, int((d.get("page") or {}).get("totalElements", len(filas)) or 0)

    todas, total = await consulta()
    ad, n_ad = await consulta(efo_id=ALZHEIMER_MONDO)
    datos = {
        "total_asociaciones": total,
        "n_alzheimer": n_ad,
        "alzheimer": [{"estudio": a.get("accession_id"), "p": a.get("p_value"), "rasgo": "; ".join((a.get("reported_trait") or [])[:2]), "efecto": a.get("beta") or a.get("or_value")} for a in ad[:10]],
    }
    return Resultado(datos, total, [str(a["accession_id"]) for a in ad[:20] if a.get("accession_id")], None, (True, f"{n_ad} asociaciones de {sim} con Alzheimer entre {total} del gen (filtro por gen comprobado fila a fila)"))


@conector("chembl_diana", "ChEMBL REST", "La diana ChEMBL de una proteína (por accession UniProt) y los mecanismos de acción de fármacos que la tocan", "Si ya hay fármacos contra la diana, en que fase y con que acción: plausibilidad y reposicionamiento", _esq(uniprot="Accession UniProt"), "CC BY-SA 3.0 con atribucion de URL y version", "Sin cifra publicada; páginas de 20; 3 por segundo en ROSA2018", "https://www.ebi.ac.uk/chembl/api/data/docs", grupo="directorio")
async def chembl_diana(uniprot: str) -> Resultado:
    r = await pedir("GET", "https://www.ebi.ac.uk/chembl/api/data/target.json", _lim["chembl"], params={"target_components__accession": uniprot, "limit": 5})
    targets = r.json().get("targets", [])
    if not targets:
        return Resultado({"diana": None, "mecanismos": []}, 0, [], None, (True, "sin diana ChEMBL para esa proteína (cero legítimo)"))
    t = targets[0]
    r2 = await pedir("GET", "https://www.ebi.ac.uk/chembl/api/data/mechanism.json", _lim["chembl"], params={"target_chembl_id": t["target_chembl_id"], "limit": 20})
    mecs = r2.json().get("mechanisms", [])
    datos = {"diana": t["target_chembl_id"], "nombre": t.get("pref_name"), "mecanismos": [{"molecula": m.get("molecule_chembl_id"), "accion": m.get("action_type"), "mecanismo": m.get("mechanism_of_action"), "fase_maxima": m.get("max_phase")} for m in mecs]}
    return Resultado(datos, len(mecs), [t["target_chembl_id"]] + [m.get("molecule_chembl_id") for m in mecs[:10] if m.get("molecule_chembl_id")], None, (True, f"{len(mecs)} mecanismos registrados"))


# ---------------------------------------------------------------------------
# Datos publicos: GEO, CELLxGENE, Synapse
# ---------------------------------------------------------------------------


def _params_ncbi(**kw: Any) -> dict[str, Any]:
    p = {"tool": "rosa", "email": config.CORREO_CONTACTO, "retmode": "json", **kw}
    if getattr(config, "CLAVE_NCBI", ""):
        p["api_key"] = config.CLAVE_NCBI
    return p


@conector("geo_series", "GEO (NCBI E-utilities, db=gds)", "Busca series de expresión (GSE) por términos y devuelve título, n de muestras, plataforma, organismo y fecha", "Si existe un dataset publico para comprobar la hipótesis, y cual", _esq(terminos="Términos de búsqueda, por ejemplo 'Alzheimer hippocampus GFAP'"), "Dominio publico (NCBI)", "3 por segundo, 10 con clave NCBI", "https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html", grupo="omicas")
async def geo_series(terminos: str) -> Resultado:
    consulta = " AND ".join(f"{t}[All Fields]" for t in terminos.split()) + " AND gse[ETYP] AND Homo sapiens[Organism]"
    r = await pedir("GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", _lim["ncbi"], params=_params_ncbi(db="gds", term=consulta, retmax=8))
    es = r.json().get("esearchresult", {})
    ids = es.get("idlist", [])
    total = int(es.get("count", 0) or 0)
    series = []
    if ids:
        r2 = await pedir("GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", _lim["ncbi"], params=_params_ncbi(db="gds", id=",".join(ids)))
        res = r2.json().get("result", {})
        for i in ids:
            s = res.get(i) or {}
            series.append({"accession": s.get("accession"), "titulo": (s.get("title") or "")[:160], "n_muestras": s.get("n_samples"), "plataforma": s.get("gpl"), "organismo": s.get("taxon"), "tipo": s.get("gdstype"), "fecha": s.get("pdat"), "pubmed": [str(x) for x in (s.get("pubmedids") or [])][:3]})
    con_acc = [s_ for s_ in series if s_.get("accession")]
    return Resultado({"total": total, "series": con_acc}, total, [s_["accession"] for s_ in con_acc], None, (len(con_acc) == len(ids), f"{total} series; {len(con_acc)} de {len(ids)} ids con resumen"))


@conector("geo_serie", "GEO (NCBI E-utilities, db=gds)", "Los metadatos de una serie GSE concreta para el libro de procedencia", "Rellena origen, n, plataforma, organismo, fecha y artículo del dataset", _esq(accession="Accession GSE, por ejemplo GSE1297"), "Dominio publico (NCBI)", "3 por segundo, 10 con clave NCBI", "https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html", grupo="omicas")
async def geo_serie(accession: str) -> Resultado:
    r = await pedir("GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", _lim["ncbi"], params=_params_ncbi(db="gds", term=f"{accession}[Accession] AND gse[ETYP]", retmax=3))
    ids = r.json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return Resultado(None, 0, [], None, (False, "accession sin registro"))
    r2 = await pedir("GET", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", _lim["ncbi"], params=_params_ncbi(db="gds", id=",".join(ids)))
    res = r2.json().get("result", {})
    s = next((res[i] for i in ids if (res.get(i) or {}).get("accession") == accession), res.get(ids[0]) or {})
    datos = {"accession": s.get("accession"), "titulo": s.get("title"), "resumen": (s.get("summary") or "")[:600], "n_muestras": s.get("n_samples"), "plataforma": s.get("gpl"), "organismo": s.get("taxon"), "tipo": s.get("gdstype"), "fecha": s.get("pdat"), "pubmed": [str(x) for x in (s.get("pubmedids") or [])], "ftp": s.get("ftplink")}
    return Resultado(datos, 1, [accession], None, (s.get("accession") == accession, f"accession {s.get('accession')} con {s.get('n_samples')} muestras"))


_cache_cellxgene: dict[str, Any] = {"t": 0.0, "colecciones": []}


@conector("cellxgene_colecciones", "CZ CELLxGENE Discover", "Colecciones de célula única cuyo nombre o descripción mencionan un término (por ejemplo Alzheimer), con sus datasets", "Si hay un atlas de célula única publico (SEA-AD y otros) para la pregunta", _esq(termino="Texto a buscar en nombre y descripción"), "CC BY 4.0", "No publicado; el catálogo completo pesa 3 MB y se cachea una hora", "https://api.cellxgene.cziscience.com/curation/ui/", grupo="socios")
async def cellxgene_colecciones(termino: str) -> Resultado:
    if time.time() - _cache_cellxgene["t"] > 3600 or not _cache_cellxgene["colecciones"]:
        r = await pedir("GET", "https://api.cellxgene.cziscience.com/curation/v1/collections", _lim["cellxgene"], params={"visibility": "PUBLIC"})
        _cache_cellxgene.update(t=time.time(), colecciones=r.json())
    t = termino.lower()
    hits = [c for c in _cache_cellxgene["colecciones"] if t in (c.get("name") or "").lower() or t in (c.get("description") or "").lower()]
    datos = [{"id": c.get("collection_id"), "nombre": (c.get("name") or "")[:140], "url": c.get("collection_url"), "datasets": len(c.get("datasets") or []), "celulas": sum(int(d.get("cell_count") or 0) for d in c.get("datasets") or []), "doi": c.get("doi")} for c in hits[:15]]
    return Resultado(datos, len(hits), [d["id"] for d in datos if d["id"]], None, (True, f"{len(hits)} colecciones de {len(_cache_cellxgene['colecciones'])}"))


@conector("synapse_buscar", "Synapse.org (AD Knowledge Portal)", "Busca entidades públicas en Synapse por términos (búsqueda anonima)", "Qué estudios del AD Knowledge Portal tocan la pregunta; el acceso a datos individuales requiere cuenta y acuerdo de uso", _esq(terminos="Términos separados por espacio"), "Por nivel; los datos individuales exigen certificado de uso", "No publicado; 2 por segundo en ROSA2018", "https://rest-docs.synapse.org/rest/", grupo="socios")
async def synapse_buscar(terminos: str) -> Resultado:
    r = await pedir("POST", "https://repo-prod.prod.sagebase.org/repo/v1/search", _lim["synapse"], json={"queryTerm": terminos.split(), "size": 8})
    d = r.json()
    hits = d.get("hits", [])
    datos = {"total": d.get("found", len(hits)), "entidades": [{"id": h.get("id"), "nombre": (h.get("name") or "")[:140], "tipo": h.get("node_type"), "descripcion": (h.get("description") or "")[:200]} for h in hits]}
    return Resultado(datos, d.get("found", len(hits)), [h.get("id") for h in hits if h.get("id")], None, (True, f"{d.get('found', 0)} entidades públicas"))


# ---------------------------------------------------------------------------
# Literatura complementaria
# ---------------------------------------------------------------------------


@conector("biorxiv_preprint", "bioRxiv y medRxiv API", "Los detalles de un preprint por DOI y si ya se publico en revista", "Si una afirmación se apoya en un preprint y si ese preprint paso revisión", _esq(doi="DOI del preprint, por ejemplo 10.1101/2024.01.01.573777", servidor="biorxiv o medrxiv"), "Por preprint (CC BY a ninguna); no cachear texto completo", "No documentado; bloquean agentes 'bot'", "https://api.biorxiv.org/", grupo="directorio")
async def biorxiv_preprint(doi: str, servidor: str = "biorxiv") -> Resultado:
    r = await pedir("GET", f"https://api.biorxiv.org/details/{quote(servidor, safe='')}/{quote(doi, safe='/')}/na/json", _lim["biorxiv"])
    col = r.json().get("collection", [])
    if not col:
        return Resultado(None, 0, [], None, (False, "DOI sin registro en ese servidor"))
    v = col[-1]
    datos = {"doi": v.get("doi"), "titulo": v.get("title"), "fecha": v.get("date"), "version": v.get("version"), "categoria": v.get("category"), "licencia": v.get("license"), "publicado": v.get("published") if v.get("published") not in (None, "NA") else None}
    return Resultado(datos, len(col), [doi], str(v.get("version")), (True, f"{len(col)} versiones; publicado: {datos['publicado'] or 'no'}"))


@conector("s2_citas", "Semantic Scholar Academic Graph", "Número de citas e influyentes de un artículo por DOI", "Quien cito y cuanto peso tiene la fuente; complementa a OpenAlex", _esq(doi="DOI del artículo"), "Licencia propia de la API", "1 por segundo con clave; pool compartido sin clave", "https://api.semanticscholar.org/api-docs/", clave="opcional", grupo="literatura")
async def s2_citas(doi: str) -> Resultado:
    cab = {"x-api-key": config.CLAVE_S2} if getattr(config, "CLAVE_S2", "") else {}
    r = await pedir("GET", f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi, safe='/')}", _lim["s2"], params={"fields": "citationCount,influentialCitationCount,title,year"}, headers=cab, follow_redirects=False)
    d = r.json()
    datos = {"titulo": d.get("title"), "anio": d.get("year"), "citas": d.get("citationCount"), "influyentes": d.get("influentialCitationCount"), "paperId": d.get("paperId")}
    return Resultado(datos, 1 if d.get("paperId") else 0, [d.get("paperId")] if d.get("paperId") else [], None, (d.get("citationCount") is not None, f"{d.get('citationCount')} citas"))


SIMBOLO_GEN = re.compile(r"^[A-Z][A-Z0-9-]{1,10}$")


def parece_simbolo(texto: str) -> bool:
    """Un símbolo HGNC plausible (APOE, TREM2, GFAP, NfL no; NEFL si)."""
    return bool(SIMBOLO_GEN.match((texto or "").strip()))
