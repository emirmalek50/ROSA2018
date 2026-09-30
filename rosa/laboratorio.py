"""Lo que una investigación mandaría al laboratorio, reunido por regla.

Por qué (29 de septiembre de 2026). Cuando una hipótesis de ROSA2018 llega a
proponer un experimento, lo que el laboratorio recibe hoy es texto. Esta pieza
reúne lo que ese texto NOMBRA y lo convierte en lo que un laboratorio puede
usar: la proteína diana con su identificador y su estructura, el compuesto con
su SMILES, y la hoja de pedido con los controles y el criterio de refutación.

Tres reglas que no se negocian, y por las que este módulo está escrito como
está:

1. **ROSA2018 no diseña moléculas.** No tiene ninguna capacidad validada para
   hacerlo, y una estructura inventada destruiría la confianza en todo lo demás,
   igual que una cita mal resuelta. Aquí solo se reúne lo que la evidencia ya
   nombra. Nada se genera.
2. **La fórmula molecular NO identifica un compuesto:** C24H29NO3 la comparten
   muchos isómeros. Lo que lo fija es el SMILES y, como clave corta, el
   InChIKey. Los tres van juntos en la ficha, con la fórmula como dato y no
   como identificador.
3. **Quien decide si algo es un compuesto es PubChem, no ROSA2018.** De los
   textos de intervención se sacan CANDIDATOS por regla, y solo entra el que
   PubChem resuelve. Un nombre que PubChem no conoce se queda fuera y se dice.

Lo que no hace: no calcula acoplamientos, no predice estructuras y no propone
sustituciones. Lo que se enseña de cada cosa es lo que su fuente dice de ella,
con su licencia y su fecha.
"""

from __future__ import annotations

import math
import re
from typing import Any

from rosa import aso as ASO
from rosa import criba as CRIBA

# El nombre y el formato del modelo de AlphaFold. La versión la confirma el
# conector; esta es la de reserva para construir la URL sin consultar.
VERSION_ALPHAFOLD = 6


def url_alphafold(uniprot: str, version: int = VERSION_ALPHAFOLD, formato: str = "cif") -> str:
    return f"https://alphafold.ebi.ac.uk/files/AF-{uniprot}-F1-model_v{version}.{formato}"


# ---------------------------------------------------------------------------
# Las dianas: lo que TODA la investigación nombra, no lo que una hipótesis pide
# ---------------------------------------------------------------------------
#
# De dónde salen (29 de septiembre de 2026, corregido el mismo día). La primera
# versión las sacaba del `perfilDiana` de cada hipótesis, y eso hacía la sección
# una vista por hipótesis: para la investigación del amiloide y la tau daba 5
# proteínas cuando su evidencia nombra 13. Ahora salen de lo que ROSA2018 sabe
# entero:
#
# - de `hechos[].entidades`, que es el modelo de mundo de la investigación: cada
#   entidad ya trae su HGNC, su UniProt y su Ensembl resueltos;
# - del `perfilDiana` de las hipótesis, que añade las que todavía nadie ha
#   medido pero alguna propone;
# - de `relaciones`, el grafo causal, para decir de cada una qué mueve y qué la
#   mueve.
#
# Una diana no vale lo mismo que otra y el orden lo dice: manda cuánta evidencia
# la nombra (MAPT sale con 216 afirmaciones de 78 fuentes; C3, con 2 de 1).

ESTADOS_FUERA = ("descartada",)

# Cuántos enunciados sostenidos se llevan a la lámina por diana.
MAX_LO_QUE_SE_SABE = 4


def _vivas(e: dict[str, Any], inv_id: str | None = None) -> list[dict[str, Any]]:
    """Las hipótesis que siguen en pie. Sin `inv_id`, las de TODAS las
    investigaciones: la sección de laboratorio reúne lo de todas."""
    return [
        h for h in (e.get("hipotesis") or [])
        if isinstance(h, dict) and h.get("estado") not in ESTADOS_FUERA and (inv_id is None or h.get("investigacionId") == inv_id)
    ]


def _hechos(e: dict[str, Any], inv_id: str | None = None) -> list[dict[str, Any]]:
    """El modelo de mundo. Sin `inv_id`, el de todas las investigaciones."""
    return [
        h for h in (e.get("hechos") or [])
        if isinstance(h, dict) and (inv_id is None or h.get("investigacionId") == inv_id)
    ]


def _identificadores(h: dict[str, Any]) -> dict[str, Any]:
    p = h.get("perfilDiana")
    i = (p or {}).get("identificadores") if isinstance(p, dict) else None
    return i if isinstance(i, dict) else {}


def _dic(d: dict[str, Any], clave: str) -> dict[str, Any]:
    """El subdiccionario de una clave, o uno vacío. El estado guardado trae
    claves a medio rellenar y una hipótesis vieja puede no tener tarjeta."""
    v = d.get(clave)
    return v if isinstance(v, dict) else {}


# Cuánto texto se lleva cada campo del contrato. Son largos de verdad (el
# protocolo de una hipótesis pasa de los 4.000 caracteres) y la pantalla los
# enseña enteros: recortarlos aquí sería mandar media receta al laboratorio.
LARGO_PROTOCOLO = 6000
LARGO_CAMPO = 1600


def _lecturas(x: dict[str, Any]) -> list[dict[str, Any]]:
    """Las lecturas del experimento: qué se mide, de qué clase es cada medida y
    qué confirmaría. Es lo que distingue un experimento de una intención."""
    salida = []
    for lt in (x.get("lecturas") or []):
        if not isinstance(lt, dict):
            continue
        salida.append({
            "nombre": str(lt.get("nombre") or "")[:400],
            "tipo": lt.get("tipo"),
            "queConfirma": str(lt.get("queConfirma") or "")[:600],
            "queRefuta": str(lt.get("queRefuta") or "")[:600],
        })
    return salida[:8]


def _de_la_hipotesis(h: dict[str, Any]) -> dict[str, Any]:
    """Lo que la lámina enseña de la hipótesis que nombra una diana: su tarjeta
    y el CONTRATO ENTERO del experimento, que es lo que se manda."""
    t = _dic(h, "tarjeta")
    k = _dic(h, "conclusion")
    x = _dic(h, "experimento")
    sis = _dic(x, "sistema")
    return {
        "id": h.get("id"),
        "investigacionId": h.get("investigacionId"),
        "titulo": str(h.get("titulo") or "")[:160],
        "estado": h.get("estado"),
        "decisionKiller": h.get("decisionKiller"),
        "certeza": k.get("certeza"),
        # La dirección que pide la intervención: subir, bajar, modular o
        # ninguna. Es lo que decide si un oligonucleótido antisentido tiene
        # sentido aquí, porque un ASO solo sabe BAJAR.
        "direccion": t.get("direccion"),
        # A qué momento de la enfermedad apunta. Importa para un ASO más de lo
        # que parece: corta la PRODUCCIÓN, y la proteína ya fabricada se queda
        # hasta que la célula la degrade. Una hipótesis sobre un modelo «con
        # inclusiones ya establecidas» no es lo mismo que una sobre fase
        # preclínica, y quien lea la propuesta tiene que verlo.
        "etapa": str(t.get("etapa") or "").strip()[:220],
        "intervencion": str(t.get("intervencion") or "").strip()[:400],
        "prediccionFalsable": str(t.get("prediccionFalsable") or "").strip()[:400],
        # El contrato, tal como está prerregistrado.
        "protocolo": str(x.get("protocolo") or "").strip()[:LARGO_PROTOCOLO],
        "ensayo": str(x.get("ensayo") or "").strip()[:LARGO_CAMPO],
        "sistema": sis.get("tipo"),
        "quePrueba": str(sis.get("quePrueba") or "").strip()[:LARGO_CAMPO],
        "lecturas": _lecturas(x),
        "confirma": str(x.get("confirma") or "").strip()[:LARGO_CAMPO],
        "refuta": str(x.get("refuta") or "").strip()[:LARGO_CAMPO],
        "controles": str(x.get("controles") or "").strip()[:LARGO_CAMPO],
        "tamanoMuestral": str(x.get("tamanoMuestral") or "").strip()[:LARGO_CAMPO],
        "alternativa": str(x.get("alternativa") or "").strip()[:LARGO_CAMPO],
        "decisionQueCambia": str(x.get("decisionQueCambia") or "").strip()[:LARGO_CAMPO],
        "costeEstimado": str(x.get("costeEstimado") or "").strip()[:LARGO_CAMPO],
        "nivelDesenlace": x.get("nivelDesenlace"),
        "puenteAlBeneficio": str(x.get("puenteAlBeneficio") or "").strip()[:LARGO_CAMPO],
        "estadoExperimento": x.get("estado"),
        "prerregistradoEn": x.get("prerregistradoEn"),
    }


def resolucion_por_uniprot(e: dict[str, Any]) -> dict[str, set[str]]:
    """Para cada UniProt, con qué clase de nombre lo alcanzó ROSA2018: el
    símbolo aprobado (`symbol`), un símbolo antiguo (`prev_symbol`) o un alias
    (`alias_symbol`). Sale de `entidadesCache`, cuyas claves son el token que se
    buscó."""
    por: dict[str, set[str]] = {}
    for v in (e.get("entidadesCache") or {}).values():
        if isinstance(v, dict) and v.get("uniprot"):
            por.setdefault(str(v["uniprot"]), set()).add(str(v.get("resueltoPor") or "desconocido"))
    return por


def uniprot_por_simbolo_aprobado(e: dict[str, Any]) -> set[str]:
    """Los UniProt que ROSA2018 alcanzó escribiendo el SÍMBOLO APROBADO del gen,
    no un alias ni un símbolo antiguo.

    Hace falta porque la normalización de entidades resuelve por alias y eso
    mete genes que nadie mencionó: ADAS (la escala ADAS-Cog) entra como AGPS,
    ARIA (la anomalía de imagen por amiloide) como ECSCR, FDG y F18 (los
    trazadores de PET) como SMUG1 y MAMLD1, GLP como GOLGA6A. En el modelo de
    mundo ya quedan guardados con el símbolo equivocado y son indistinguibles
    de uno bueno; lo único que los delata es que el token que los trajo estaba
    en la lista de alias. `entidadesCache` guarda ese token como clave y cómo se
    resolvió, así que aquí se cruza por ahí.

    El fallo de fondo (la normalización) está en PENDIENTE.md; esto no lo
    arregla, lo esquiva para que no acaben en un pedido al laboratorio."""
    buenos: set[str] = set()
    cache = e.get("entidadesCache")
    for v in (cache or {}).values():
        if isinstance(v, dict) and v.get("uniprot") and v.get("resueltoPor") == "symbol":
            buenos.add(str(v["uniprot"]))
    return buenos


def _simbolo_limpio(etiqueta: Any) -> str:
    """'MAPT (tau)' -> 'MAPT'. La etiqueta del modelo de mundo lleva entre
    paréntesis el nombre por el que se conoce en la clínica."""
    return re.sub(r"\s*\(.*$", "", str(etiqueta or "")).strip()


def _entidades_gen(h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las entidades de tipo gen de un hecho, sin repetir dentro del mismo hecho
    (un enunciado que nombra tau tres veces cuenta una)."""
    por_id: dict[str, dict[str, Any]] = {}
    for x in (h.get("entidades") or []):
        if isinstance(x, dict) and x.get("tipo") == "gen" and x.get("id"):
            por_id.setdefault(str(x["id"]), x)
    return list(por_id.values())


def nombres_de(simbolo: str, etiqueta: str, alias: Any) -> set[str]:
    """Todos los nombres por los que se conoce a una diana, en minúsculas.

    Hace falta porque el grafo causal no habla en símbolos de gen: sus nodos
    son «tau», «NfL» y «APOE4», que es como se nombra la enfermedad en la
    clínica. El modelo de mundo guarda ese nombre entre paréntesis en la
    etiqueta («MAPT (tau)») y el resto en la lista de alias."""
    ns = {simbolo.lower()}
    m = re.search(r"\(([^)]+)\)", str(etiqueta or ""))
    if m:
        ns.add(m.group(1).strip().lower())
    for a in (alias if isinstance(alias, list) else []):
        a = str(a).strip().lower()
        # Los alias largos de HGNC (FLJ31424, MGC138549) no los usa nadie al
        # dibujar un grafo causal; los que sirven son los cortos y con sentido.
        if 2 <= len(a) <= 12:
            ns.add(a)
    return {n for n in ns if n}


def quimica_por_diana(e: dict[str, Any], inv_id: str | None = None) -> dict[str, dict[str, int]]:
    """Qué compuestos nombra la evidencia JUNTO a cada gen, contando en cuántos
    hechos aparecen los dos a la vez.

    No es una relación causal ni una afinidad: es coaparición en la misma
    afirmación, y así se dice en la pantalla. Sirve para que la lámina de una
    proteína lleve la química que su propia evidencia menciona, en vez de
    mandar la proteína por un lado y la fórmula por otro."""
    junto: dict[str, dict[str, int]] = {}
    for h in _hechos(e, inv_id):
        ents = [x for x in (h.get("entidades") or []) if isinstance(x, dict)]
        genes = {str(x.get("id")) for x in ents if x.get("tipo") == "gen" and x.get("id")}
        comps = {str(x.get("etiqueta")) for x in ents if x.get("tipo") == "compuesto" and x.get("etiqueta")}
        for g in genes:
            for c in comps:
                junto.setdefault(g, {})[c] = junto.setdefault(g, {}).get(c, 0) + 1
    return junto


def _causal_de(e: dict[str, Any], inv_id: str | None, nombres: set[str]) -> dict[str, Any]:
    """Qué dice el grafo causal de esta diana: qué la mueve y qué mueve ella.
    Solo lo que ya está en `relaciones` (base curada y supuestos declarados);
    aquí no se infiere ninguna flecha."""
    arriba, abajo = [], []
    for r in (e.get("relaciones") or []):
        if not isinstance(r, dict):
            continue
        if r.get("investigacionId") not in (None, inv_id):
            continue
        de, a = str(r.get("de") or ""), str(r.get("a") or "")
        # Una flecha con los dos extremos en la misma diana no dice nada: MAPT
        # se llama «tau» y «p-tau181» a la vez, y «tau -> p-tau181» la dejaba
        # apuntándose a sí misma.
        if de.lower() in nombres and a.lower() in nombres:
            continue
        if a.lower() in nombres:
            arriba.append({"otro": de, "tipo": r.get("tipo"), "contexto": str(r.get("contexto") or "")[:200]})
        elif de.lower() in nombres:
            abajo.append({"otro": a, "tipo": r.get("tipo"), "contexto": str(r.get("contexto") or "")[:200]})
    return {"aguasArriba": arriba[:4], "aguasAbajo": abajo[:4]}


def dianas_y_descartes(e: dict[str, Any], inv_id: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Todas las proteínas que la investigación nombra, con el peso de la
    evidencia que las nombra.

    Entra una diana si tiene UniProt, si ese UniProt se alcanzó por símbolo
    aprobado y si además la nombran DOS hechos o la propone una hipótesis. Lo de
    los dos hechos es para que una mención de paso no acabe en un pedido: CPAP
    aparece una vez en una investigación y es el aparato, no la proteína.

    Lo que queda fuera no se calla: sale en `nombradasSinEstructura` (resueltas
    pero sin UniProt, como TREM2, que sin acceso no tiene estructura que traer)
    y en `descartadasPorAlias`."""
    aprobados = uniprot_por_simbolo_aprobado(e)
    resolucion = resolucion_por_uniprot(e)
    quimica = quimica_por_diana(e, inv_id)
    hechos = _hechos(e, inv_id)
    titulos = {str(i.get("id")): str(i.get("titulo") or i.get("id") or "") for i in (e.get("investigaciones") or []) if isinstance(i, dict)}

    por_hgnc: dict[str, dict[str, Any]] = {}
    for h in hechos:
        sabido = h.get("estado") == "sabido"
        for x in _entidades_gen(h):
            d = por_hgnc.setdefault(
                str(x["id"]),
                {"hgnc": x["id"], "simbolo": _simbolo_limpio(x.get("etiqueta")), "_etiqueta": x.get("etiqueta"), "_alias": x.get("alias"),
                 "uniprot": None, "ensembl": None, "entrez": None,
                 "hechos": 0, "sabidos": 0, "abiertos": 0, "_fuentes": set(), "_investigaciones": {}, "loQueSeSabe": []},
            )
            # Las entidades vienen desiguales: unas traen los identificadores y
            # otras solo el HGNC. Se queda la más rica de todas.
            for k in ("uniprot", "ensembl", "entrez"):
                if not d[k] and x.get(k):
                    d[k] = x[k]
            d["hechos"] += 1
            # Qué investigaciones la nombran y cuánto: es lo que convierte el
            # muro en la unión de todo y no en una lista sin procedencia.
            iid = str(h.get("investigacionId") or "")
            if iid:
                d["_investigaciones"][iid] = d["_investigaciones"].get(iid, 0) + 1
            if sabido:
                d["sabidos"] += 1
            elif h.get("estado") == "abierto":
                d["abiertos"] += 1
            for p in (h.get("procedencia") or []):
                if isinstance(p, dict) and p.get("referencia"):
                    d["_fuentes"].add(str(p["referencia"]))
            if sabido and len(d["loQueSeSabe"]) < MAX_LO_QUE_SE_SABE:
                cita = next((c for c in (h.get("citas") or []) if isinstance(c, dict)), {})
                d["loQueSeSabe"].append({
                    "tema": str(h.get("tema") or "")[:90],
                    "enunciado": str(h.get("enunciado") or "")[:300],
                    "referencia": str(cita.get("referencia") or (h.get("procedencia") or [{}])[0].get("referencia") or "")[:80],
                    "fragmento": str(cita.get("fragmento") or "")[:220],
                    "investigacion": titulos.get(str(h.get("investigacionId") or ""), ""),
                })

    # Las hipótesis: las que proponen un experimento sobre una diana.
    hips: dict[str, list[dict[str, Any]]] = {}
    ident: dict[str, dict[str, Any]] = {}
    for hp in _vivas(e, inv_id):
        i = _identificadores(hp)
        u = str(i.get("uniprot") or "").strip()
        if not u:
            continue
        hips.setdefault(u, []).append(_de_la_hipotesis(hp))
        ident.setdefault(u, i)

    dianas: list[dict[str, Any]] = []
    sin_estructura: list[dict[str, Any]] = []
    por_alias: list[dict[str, Any]] = []
    for d in por_hgnc.values():
        resumen_corto = {"simbolo": d["simbolo"], "hechos": d["hechos"], "sabidos": d["sabidos"]}
        if not d["uniprot"]:
            # Tres menciones y un símbolo de tres letras o más: con dos bastaba
            # para colar «IV» y «MS», que en HGNC son fichas de enfermedad
            # (situs inversus, esclerosis múltiple) y no genes.
            if d["hechos"] >= 3 and len(d["simbolo"]) >= 3:
                # OJO con el motivo: decir «no tiene UniProt» sería MENTIRA.
                # TREM2 es Q9NZC2 y tiene estructura; lo que pasa es que la
                # normalización de entidades de ROSA2018 no le pegó el acceso
                # (está cacheada en negativo, ver PENDIENTE.md). Eso es «no
                # pude resolverlo», que no es «no existe».
                sin_estructura.append({**resumen_corto, "motivo": "ROSA2018 no consiguió resolver su acceso de UniProt, así que no sabe qué estructura pedir. No quiere decir que no la tenga"})
            continue
        if d["uniprot"] not in aprobados:
            # El motivo tiene que ser el de verdad: no es lo mismo saber que la
            # trajo un alias que no poder comprobar con qué nombre entró.
            modos = resolucion.get(d["uniprot"])
            if not modos:
                motivo = "no consta con qué nombre se resolvió, así que no se puede descartar que sea otra cosa"
            elif "prev_symbol" in modos:
                motivo = "el nombre que la trajo era un símbolo antiguo del gen, no el aprobado"
            else:
                motivo = "el nombre que la trajo era un alias, no el símbolo aprobado"
            por_alias.append({**resumen_corto, "motivo": motivo})
            continue
        if d["hechos"] < 2 and d["uniprot"] not in hips:
            continue
        dianas.append(d)

    vistos = {d["uniprot"] for d in dianas}
    for u, i in ident.items():
        if u in vistos:
            continue
        # Propuesta por una hipótesis y todavía sin ninguna afirmación que la
        # nombre: entra igual, y la ficha lo dice.
        dianas.append({"hgnc": i.get("hgnc"), "simbolo": str(i.get("simbolo") or u), "_etiqueta": i.get("simbolo"), "_alias": i.get("alias"),
                       "uniprot": u, "ensembl": i.get("ensembl"),
                       "entrez": i.get("entrez"), "hechos": 0, "sabidos": 0, "abiertos": 0, "_fuentes": set(), "_investigaciones": {}, "loQueSeSabe": []})

    orden = {"avanzar": 0, "reformular": 1, "suspender": 2, "descartar_en_contexto": 3}
    for d in dianas:
        u = d["uniprot"]
        i = ident.get(u, {})
        d["nombre"] = str(i.get("nombre") or _nombre_de(e, u) or "").strip()
        # La que se DIBUJA es siempre la predicha: es la única de longitud
        # completa. Pero se dice cuántas medidas hay, porque para tau el
        # modelo predicho tiene un 8 % de confianza alta y el PDB guarda
        # cientos de estructuras reales. Callarlo mientras el pie de página
        # decía que se usaba el PDB era mentir dos veces.
        medidas = (e.get("estructurasMedidas") or {}).get(u) if isinstance(e.get("estructurasMedidas"), dict) else None
        d["estructura"] = {
            "url": url_alphafold(u),
            "fuente": "AlphaFold DB",
            "licencia": "CC BY 4.0",
            "clase": "predicha",
            "medidas": int((medidas or {}).get("total") or 0) if medidas and medidas.get("comprobado", True) else None,
            "entradasPDB": list((medidas or {}).get("entradas") or [])[:6],
            "urlPDB": f"https://www.rcsb.org/search?request=%7B%22query%22%3A%7B%22type%22%3A%22terminal%22%2C%22service%22%3A%22text%22%2C%22parameters%22%3A%7B%22attribute%22%3A%22rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession%22%2C%22operator%22%3A%22exact_match%22%2C%22value%22%3A%22{u}%22%7D%7D%2C%22return_type%22%3A%22entry%22%7D",
        }
        d["fuentes"] = len(d.pop("_fuentes"))
        invs = d.pop("_investigaciones", {})
        for hp in hips.get(u, []):
            iid = str(hp.get("investigacionId") or "")
            if iid and iid not in invs:
                invs[iid] = 0
        d["investigaciones"] = [
            {"id": k, "titulo": titulos.get(k, k), "hechos": v}
            for k, v in sorted(invs.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        d["hipotesis"] = sorted(hips.get(u, []), key=lambda x: (orden.get(str(x.get("decisionKiller")), 9), str(x.get("titulo"))))
        d["enHipotesis"] = len(d["hipotesis"])
        d["intervenciones"] = [x["intervencion"] for x in d["hipotesis"] if x["intervencion"]]
        etiqueta = str(d.pop("_etiqueta", "") or "")
        nombres = nombres_de(d["simbolo"], etiqueta, d.pop("_alias", None))
        # Para enseñar, solo el nombre clínico (el del paréntesis de la
        # etiqueta): los alias de HGNC son códigos (FLJ31424, MGC138549) que no
        # le dicen nada a nadie. Para cruzar con el grafo se usan todos.
        m = re.search(r"\(([^)]+)\)", etiqueta)
        d["tambienLlamada"] = m.group(1).strip() if m else ""
        d["causal"] = _causal_de(e, inv_id, nombres)
        # Los compuestos que la evidencia nombra junto a esta diana, el más
        # coaparecido primero. La química la rellena luego `compuestos_de`.
        d["quimica"] = [
            {"nombre": k, "juntas": v}
            for k, v in sorted(quimica.get(str(d.get("hgnc") or ""), {}).items(), key=lambda kv: (-kv[1], kv[0]))
        ][:4]
        d["deDonde"] = "ambas" if d["hechos"] and d["enHipotesis"] else ("hipotesis" if d["enHipotesis"] else "evidencia")
        d["hojaDePedido"] = hoja_de_pedido(d)
        d["deBanco"] = d["hojaDePedido"]["deBanco"]
        # El oligonucleótido antisentido que ROSA2018 diseñaría sobre esta
        # diana. Es lo único que puede diseñar de verdad: sale de la secuencia
        # del transcrito, que es pública y exacta. El cDNA NO viaja: son casi
        # siete mil nucleótidos por diana y la pantalla solo enseña el diseño.
        seqs = e.get("secuencias")
        g = seqs.get(u) if isinstance(seqs, dict) else None
        guardada: dict[str, Any] = g if isinstance(g, dict) else {}
        # `comprobado` en falso es «Ensembl no respondió», que no es lo mismo
        # que «esta proteína no tiene transcrito».
        comprobada = bool(guardada) and bool(guardada.get("comprobado", True))
        # El diseño ya viene calculado del bucle: aquí solo se lee. Calcularlo
        # en cada petición costaba dos segundos con las diecisiete dianas.
        #
        # Y solo se OFRECE donde la evidencia pide bajar la proteína. El diseño
        # se guarda igual (la secuencia es correcta, y si mañana aparece una
        # hipótesis que pida bajarla ya está hecho), pero no se enseña como
        # propuesta donde iría al revés.
        d["direccion"] = direccion_de(d)
        # COPIA, no la referencia del estado. `aligerar` recorta la lista de
        # candidatos para el muro, y con la referencia viva ese recorte se
        # comía el diseño guardado: una visita a la pantalla dejaba en ocho los
        # sesenta candidatos, y encima se persistía. Una lectura no puede
        # destruir datos.
        dis = guardada.get("diseño") if comprobada and d["direccion"]["asoEncaja"] else None
        # `pegar` devuelve estructura nueva, así que el recorte de `aligerar` no
        # toca el estado, y además REORDENA: los que encajan en otro gen bajan
        # al final. Sin eso `oligo_que_mandaria` cogería el número uno sin
        # saber si es uno de los que hay que descartar.
        d["aso"] = CRIBA.pegar(e, dict(dis)) if isinstance(dis, dict) else None
        d["asoSinComprobar"] = bool(guardada) and not comprobada and d["direccion"]["asoEncaja"]
    # El orden lo manda lo que SE PUEDE MANDAR, y después el peso de la
    # evidencia. Ordenar solo por evidencia ponía arriba las cuatro proteínas
    # de biomarcador en sangre, con la hoja en blanco, y dejaba en el puesto 17
    # de 17 la única con un experimento de banco propuesto: justo lo contrario
    # de lo que promete el título de la sección.
    def orden_de(d: dict[str, Any]) -> tuple[int, int, str]:
        hoja = d["hojaDePedido"]
        if hoja.get("deBanco"):
            grado = 0          # hay un experimento de laboratorio propuesto
        elif hoja.get("queSeHace"):
            grado = 1          # hay un experimento, pero es de escritorio
        elif d["hipotesis"]:
            grado = 2          # hay hipótesis, sin contrato que decir qué se hace
        else:
            grado = 3          # solo la evidencia la señala
        return (grado, -d["hechos"], d["simbolo"])

    dianas.sort(key=orden_de)
    sin_estructura.sort(key=lambda d: -d["hechos"])
    por_alias.sort(key=lambda d: -d["hechos"])
    return dianas, sin_estructura, por_alias


def dianas_de(e: dict[str, Any], inv_id: str | None = None) -> list[dict[str, Any]]:
    """Solo las dianas, para quien no necesita los descartes."""
    return dianas_y_descartes(e, inv_id)[0]


def _nombre_de(e: dict[str, Any], uniprot: str) -> str:
    """El nombre largo del gen, del caché de entidades."""
    for v in (e.get("entidadesCache") or {}).values():
        if isinstance(v, dict) and v.get("uniprot") == uniprot and v.get("nombre"):
            return str(v["nombre"])
    return ""


# ---------------------------------------------------------------------------
# Los compuestos: candidatos por regla, confirmados por PubChem
# ---------------------------------------------------------------------------

# Terminaciones de nombre común internacional (DCI) que marcan un fármaco. No
# son todas las que hay: son las que aparecen en lo que ROSA2018 investiga.
_SUFIJOS = ("mab", "nib", "tinib", "zumab", "ximab", "umab", "statina", "stat", "vir", "prazol", "sartan",
            "tida", "tide", "glutida", "pezilo", "pezil", "antina", "amina", "fenaco", "cilina", "micina",
            "ciclina", "oxetina", "azepam", "parina", "grelida", "dopa", "sulfato", "carbamato")

# Palabras que pasan el filtro de forma pero no son compuestos: siglas de genes,
# cohortes, técnicas y unidades que aparecen en los mismos textos.
_NO_COMPUESTO = {
    "ADNI", "BIOCARD", "DIAN", "ADAD", "APOE", "MAPT", "SULF2", "GPC4", "NDST3", "TFEB", "CAPRIN1", "SORLA",
    "ARRB2", "BACE1", "GFAP", "NFL", "PET", "LCR", "RM", "RMN", "MCI", "DCL", "ELISA", "SIMOA", "FRET",
    "PCR", "RT", "WB", "IHC", "PBS", "DMSO", "ARN", "ADN", "RNA", "DNA", "SIRNA", "ASO", "IPSC", "CRISPR",
    "GRADE", "PRISMA", "INTEC", "ROSA2018", "AAV", "PS19", "5XFAD", "TREM2", "CLEAR", "PP2A", "APP", "HRS",
}

# Una palabra candidata: empieza por letra, de 4 a 30 caracteres, sin cifras
# pegadas salvo las de un código de compuesto (TP2, MB-2-VHL2).
_PALABRA = re.compile(r"\b[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]{2,29}\b")


def compuestos_nombrados(e: dict[str, Any], inv_id: str | None = None, maximo: int = 16) -> list[dict[str, Any]]:
    """Los compuestos que la evidencia de la investigación nombra, con su
    identificador de ontología y cuántas veces los nombra.

    Salen de `hechos[].entidades` (CHEBI, ya resuelto), no de pasar una regex
    por los textos de intervención como hacía la primera versión: para la
    investigación del amiloide la regex no encontraba nada y la evidencia
    nombra amyloid-beta 224 veces y lecanemab 58.

    Esto es lo que HAY QUE PEDIR; que además PubChem lo tenga como compuesto
    con su SMILES es un añadido, y para un anticuerpo como el lecanemab no lo
    tendrá nunca porque no es una molécula pequeña."""
    por_id: dict[str, dict[str, Any]] = {}
    for h in _hechos(e, inv_id):
        vistos: set[str] = set()
        for x in (h.get("entidades") or []):
            if not isinstance(x, dict) or x.get("tipo") != "compuesto" or not x.get("etiqueta"):
                continue
            k = str(x["etiqueta"])
            if k in vistos:
                continue
            vistos.add(k)
            d = por_id.setdefault(k, {"nombre": k, "ontologiaId": x.get("id"), "ontologia": x.get("ontologia"), "alias": x.get("alias") or [], "menciones": 0, "sostenidos": 0})
            d["menciones"] += 1
            if h.get("estado") == "sabido":
                d["sostenidos"] += 1
    salida = sorted(por_id.values(), key=lambda d: (-int(d["menciones"]), str(d["nombre"])))
    return salida[:maximo]


def candidatos_de_compuesto(textos: list[str], maximo: int = 12) -> list[str]:
    """Nombres que PARECEN un compuesto en los textos de intervención. Es un
    colador ancho a propósito: quien decide de verdad es PubChem, y lo que no
    resuelve se queda fuera. Devolver de más aquí solo cuesta una consulta."""
    vistos: dict[str, None] = {}
    for t in textos:
        for m in _PALABRA.finditer(str(t or "")):
            p = m.group(0)
            if p.upper() in _NO_COMPUESTO or len(p) < 5:
                continue
            bajo = p.lower()
            if not any(bajo.endswith(s) for s in _SUFIJOS):
                continue
            vistos.setdefault(bajo, None)
            if len(vistos) >= maximo:
                return list(vistos)
    return list(vistos)


def ficha_de_compuesto(nombre: str, datos: dict[str, Any] | None) -> dict[str, Any] | None:
    """Lo que el laboratorio necesita para PEDIR el compuesto. `datos` es lo que
    devolvió `pubchem_compuesto`; sin SMILES no se publica la ficha, porque sin
    él la fórmula no identifica nada."""
    if not isinstance(datos, dict) or not datos.get("smiles"):
        return None
    peso = datos.get("peso")
    try:
        peso_n = float(peso) if peso is not None else None
    except (TypeError, ValueError):
        peso_n = None
    logp = datos.get("logp")
    tpsa = datos.get("tpsa")
    return {
        "nombre": nombre,
        "cid": datos.get("cid"),
        "formula": datos.get("formula"),
        "peso": peso,
        "iupac": datos.get("iupac"),
        "smiles": datos.get("smiles"),
        "inchi": datos.get("inchi"),
        "inchikey": datos.get("inchikey"),
        "logp": logp,
        "tpsa": tpsa,
        "donantesH": datos.get("donantesH"),
        "aceptoresH": datos.get("aceptoresH"),
        "cerebro": llegada_al_cerebro(peso_n, logp, tpsa),
        "url2d": f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{datos.get('cid')}/PNG?image_size=400x300" if datos.get("cid") else None,
        "url3d": f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{datos.get('cid')}/SDF?record_type=3d" if datos.get("cid") else None,
        "fuente": "PubChem",
        "licencia": "dominio público",
    }


def llegada_al_cerebro(peso: float | None, logp: Any, tpsa: Any) -> dict[str, Any]:
    """Si por sus propiedades podría cruzar la barrera hematoencefálica por
    difusión pasiva. Es un criterio de cribado, no una medición: hay fármacos
    que entran por transportador y otros que cumplen el perfil y no entran.

    Los umbrales son los de uso corriente en química medicinal para el sistema
    nervioso central: peso por debajo de 450 g/mol, logP entre 1 y 4 y una
    superficie polar por debajo de 90 Å². La semaglutida, por ejemplo, sale con
    logP -5,8 y 1.650 Å²: no cruza por difusión, y eso hay que decirlo cuando
    una hipótesis la propone para un efecto cerebral."""
    try:
        logp_n = float(logp) if logp is not None else None
        tpsa_n = float(tpsa) if tpsa is not None else None
    except (TypeError, ValueError):
        logp_n = tpsa_n = None
    if peso is None or logp_n is None or tpsa_n is None:
        return {"veredicto": "no_comprobable", "motivo": "faltan propiedades para juzgarlo"}
    fallos = []
    if peso > 450:
        fallos.append(f"pesa {peso:.0f} g/mol y por encima de 450 la difusión cae")
    if not 1 <= logp_n <= 4:
        fallos.append(f"logP {logp_n:g}, fuera de la banda de 1 a 4")
    if tpsa_n > 90:
        fallos.append(f"superficie polar {tpsa_n:g} Å², por encima de 90")
    if not fallos:
        return {"veredicto": "compatible", "motivo": f"peso {peso:.0f}, logP {logp_n:g} y superficie polar {tpsa_n:g} Å² están en la banda de los fármacos que entran por difusión"}
    return {"veredicto": "improbable", "motivo": "; ".join(fallos) + ". Puede entrar igual por un transportador, pero no por difusión"}


# ---------------------------------------------------------------------------
# La hoja de pedido
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# La dirección: qué le pide la evidencia a cada diana
# ---------------------------------------------------------------------------
#
# Un oligonucleótido antisentido solo sabe hacer una cosa: BAJAR la proteína.
# Ofrecerlo donde la evidencia pide subirla es proponer lo contrario de lo que
# la propia investigación concluyó. El 30 de septiembre de 2026 la sección
# enseñaba ocho oligos para apagar APP y SULF2 cuando las dos hipótesis que las
# nombran piden AUMENTARLAS: cada secuencia estaba bien diseñada y la propuesta
# estaba al revés.

DIRECCION_EN_PALABRAS = {
    "disminuye": "bajarla",
    "aumenta": "subirla",
    "modula": "modularla, sin decir en qué sentido",
    "sin_intervencion": "no intervenir sobre ella",
}


def direccion_de(diana: dict[str, Any]) -> dict[str, Any]:
    """Qué dirección piden las hipótesis que nombran esta diana, y si un
    oligonucleótido antisentido encaja con eso.

    Manda lo que dicen las hipótesis, no lo que se podría hacer: si ninguna
    propone intervenir, la diana es un biomarcador y todavía no una diana de
    tratamiento, y eso hay que decirlo en vez de ofrecer un oligo igual."""
    cuenta: dict[str, int] = {}
    for h in diana.get("hipotesis") or []:
        d = h.get("direccion")
        if d:
            cuenta[str(d)] = cuenta.get(str(d), 0) + 1
    baja = cuenta.get("disminuye", 0)
    sube = cuenta.get("aumenta", 0)
    modula = cuenta.get("modula", 0)

    if baja and not sube:
        pide, encaja = "bajar", True
        motivo = f"{baja} {'hipótesis pide' if baja == 1 else 'hipótesis piden'} bajarla, que es lo único que un oligonucleótido antisentido sabe hacer"
    elif sube and not baja:
        pide, encaja = "subir", False
        motivo = f"{sube} {'hipótesis pide' if sube == 1 else 'hipótesis piden'} SUBIRLA. Un oligonucleótido antisentido la bajaría: sería justo lo contrario de lo que concluyó la investigación"
    elif sube and baja:
        pide, encaja = "mezclado", False
        motivo = f"hay {baja} que {'pide' if baja == 1 else 'piden'} bajarla y {sube} que {'pide' if sube == 1 else 'piden'} subirla; mientras eso no se resuelva, proponer un oligo es elegir un bando sin decirlo"
    elif modula:
        pide, encaja = "modular", False
        motivo = f"{modula} {'hipótesis habla' if modula == 1 else 'hipótesis hablan'} de modularla sin decir en qué sentido; un oligonucleótido solo baja"
    else:
        pide, encaja = "ninguna", False
        motivo = "ninguna hipótesis propone intervenir sobre ella: por ahora es un biomarcador, no una diana de tratamiento"

    return {"pide": pide, "cuenta": cuenta, "asoEncaja": encaja, "motivo": motivo}


# Sistemas que NO son un experimento de banco: lo que se hace es leer lo que ya
# está publicado. Separarlos importa porque la tarjeta de una hipótesis puede
# decir «expresión inducible en neuronas» mientras su contrato dice que lo que
# se va a hacer es una revisión; enseñar las dos cosas juntas sin avisar hace
# que la hoja parezca un pedido cuando no lo es.
SISTEMAS_DE_ESCRITORIO = ("datos_publicos_existentes",)


def es_de_banco(h: dict[str, Any]) -> bool:
    """Si el experimento se hace en un laboratorio de verdad."""
    return bool(h.get("sistema")) and h["sistema"] not in SISTEMAS_DE_ESCRITORIO


def hoja_de_pedido(diana: dict[str, Any]) -> dict[str, Any]:
    """Lo que se manda con la diana.

    Sale de los contratos de experimento que ya están prerregistrados y
    sellados, no de lo que un modelo escriba hoy: si el contrato no dice algo,
    la hoja lo deja en blanco y lo nombra.

    Una diana puede tener varias hipótesis encima, y entonces la hoja lleva
    TODOS los experimentos propuestos, el que más lejos ha llegado primero. No
    se funden en uno: dos experimentos distintos con controles distintos
    fundidos en una hoja serían un protocolo que nadie prerregistró. Y una
    diana que la evidencia señala sin que ninguna hipótesis proponga nada lleva
    la hoja vacía diciendo justo eso, que es lo que hay que saber."""
    hs = diana.get("hipotesis") or []
    h = hs[0] if hs else {}
    return {
        "hipotesis": h.get("titulo"),
        "certeza": h.get("certeza"),
        "queSeHace": h.get("intervencion") or "",
        "identificador": f"UniProt {diana['uniprot']}",
        "sistema": h.get("sistema"),
        "controles": h.get("controles") or "",
        "refuta": h.get("refuta") or h.get("prediccionFalsable") or "",
        # La tarjeta propone una intervención de banco y el contrato dice que
        # lo que se hace es leer literatura: se dice, no se disimula.
        "contradiceLaIntervencion": bool(h.get("intervencion")) and h.get("sistema") in SISTEMAS_DE_ESCRITORIO,
        "deBanco": es_de_banco(h),
        "otrosExperimentos": [
            {"hipotesis": x.get("titulo"), "certeza": x.get("certeza"), "decisionKiller": x.get("decisionKiller"),
             "queSeHace": x.get("intervencion") or "", "sistema": x.get("sistema"),
             "controles": x.get("controles") or "", "refuta": x.get("refuta") or x.get("prediccionFalsable") or ""}
            for x in hs[1:]
        ],
        "sinExperimento": not hs,
        "faltan": [
            k
            for k, v in (("qué se hace", h.get("intervencion")), ("controles", h.get("controles")), ("qué lo refutaría", h.get("refuta") or h.get("prediccionFalsable")), ("sistema experimental", h.get("sistema")))
            if not v
        ] if hs else [],
    }


def resumen(dianas: list[dict[str, Any]], compuestos: list[dict[str, Any]], vivas: int, hechos: int, investigaciones: int = 0) -> dict[str, Any]:
    """Las cifras de cabecera. `afirmaciones` es de lo que sostiene a las
    dianas, no del modelo de mundo entero: es lo que la sección enseña."""
    con_hip = len({x["id"] for d in dianas for x in d["hipotesis"]})
    return {
        "dianas": len(dianas),
        "compuestos": len(compuestos),
        "hipotesisVivas": vivas,
        "hipotesisConDiana": con_hip,
        "sinDiana": max(0, vivas - con_hip),
        # Lo que de verdad sostiene el muro: cuánta evidencia lo nombra.
        "afirmaciones": sum(d["hechos"] for d in dianas),
        "sostenidas": sum(d["sabidos"] for d in dianas),
        "hechosDeLaInvestigacion": hechos,
        # Dianas que la evidencia señala y ninguna hipótesis propone todavía:
        # es un hueco del programa y se cuenta.
        "sinExperimento": sum(1 for d in dianas if not d["hipotesis"]),
        # Cuántas se pueden mandar de verdad hoy: con un experimento de banco
        # propuesto. Es la cifra que importa y hasta ahora no se decía.
        "deBanco": sum(1 for d in dianas if d.get("deBanco")),
        # Para cuántas hay ya un oligonucleótido antisentido diseñado Y con
        # sentido: la evidencia pide bajarlas.
        "conAso": sum(1 for d in dianas if d.get("aso")),
        # Y en cuántas iría al revés de lo que la evidencia concluyó.
        "asoAlReves": sum(1 for d in dianas if (d.get("direccion") or {}).get("pide") == "subir"),
        "investigaciones": investigaciones,
    }


def compuestos_de(e: dict[str, Any], inv_id: str | None = None, resueltos: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Los compuestos que la evidencia nombra, con la química de PubChem cuando
    la hay.

    Quien decide QUÉ compuestos salen es la evidencia de la investigación, no
    PubChem: un anticuerpo como el lecanemab lo nombran 58 afirmaciones y
    PubChem no lo tiene como compuesto porque no es una molécula pequeña. Antes
    eso lo dejaba fuera de la sección; ahora entra con su CHEBI y su peso de
    evidencia, y lo que se dice es que no tiene ficha de molécula pequeña.

    `resueltos` es lo que el bucle ya trajo de PubChem (una consulta por nombre
    y por investigación, registrada); aquí no se toca la red."""
    por_nombre = {str(c.get("nombre") or "").lower(): c for c in (resueltos or []) if isinstance(c, dict)}
    nombrados = compuestos_nombrados(e, inv_id)
    ya = {str(c["nombre"]).lower() for c in nombrados}
    # Los que salieron de los textos de intervención y PubChem sí resolvió
    # entran también aunque el modelo de mundo no los tenga como entidad: la
    # semaglutida de una investigación la nombra su intervención, no un hecho.
    for k, q in por_nombre.items():
        if k not in ya and q.get("encontrado"):
            nombrados.append({"nombre": q.get("nombre"), "ontologiaId": None, "ontologia": None, "alias": [], "menciones": 0, "sostenidos": 0})
    salida = []
    for c in nombrados:
        ficha = por_nombre.get(str(c["nombre"]).lower())
        if ficha and ficha.get("encontrado"):
            salida.append({**ficha, **{k: c[k] for k in ("menciones", "sostenidos", "ontologiaId", "ontologia")}, "enPubchem": True})
        else:
            salida.append({
                **c,
                "enPubchem": False,
                "motivo": str((ficha or {}).get("motivo") or "todavía no se ha consultado en PubChem"),
                "cid": None, "formula": None, "peso": None, "smiles": None, "inchikey": None,
                "logp": None, "tpsa": None, "url2d": None, "url3d": None,
                "cerebro": llegada_al_cerebro(None, None, None),
            })
    # Manda cuánto lo nombra la evidencia; el que tiene ficha, antes a igualdad.
    salida.sort(key=lambda c: (-int(c.get("menciones") or 0), not c.get("enPubchem"), str(c.get("nombre"))))
    return salida


# Los campos del contrato que solo hace falta ver al abrir el experimento. Son
# el 25 % de la respuesta (el protocolo de una hipótesis pasa de los 3.000
# caracteres y GFAP sola, con sus dieciséis, pesaba 186 KB), y el muro no
# enseña ni uno.
CAMPOS_DEL_EXPERIMENTO = ("protocolo", "ensayo", "quePrueba", "lecturas", "confirma", "tamanoMuestral", "alternativa", "decisionQueCambia", "costeEstimado", "puenteAlBeneficio")


def aligerar(dianas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Quita lo que solo se lee al abrir un panel. Lo que queda basta para el
    muro y para la hoja de la lámina."""
    for d in dianas:
        for h in d.get("hipotesis") or []:
            for k in CAMPOS_DEL_EXPERIMENTO:
                h.pop(k, None)
        # De los sesenta candidatos de oligo, los ocho primeros. Los demás se
        # piden aparte: sesenta por diecisiete dianas serían 400 KB por visita.
        # `a` es ya una copia hecha en `dianas_y_descartes`; aun así el
        # recorte crea una lista nueva y no toca la de dentro del estado.
        a = d.get("aso")
        if isinstance(a, dict) and isinstance(a.get("candidatos"), list):
            a["candidatosEnTotal"] = len(a["candidatos"])
            a["candidatos"] = list(a["candidatos"][:ASO.EN_EL_MURO])
    return dianas


def oligos_de(e: dict[str, Any], uniprot: str, inv_id: str | None = None) -> dict[str, Any] | None:
    """Los sesenta candidatos de oligo de una diana, con su diseño entero.

    Va aparte del muro por tamaño, igual que los protocolos: el muro enseña
    ocho y quien abre el panel recibe el cribado completo."""
    for d in dianas_de(e, inv_id):
        if d["uniprot"] != uniprot:
            continue
        seqs = e.get("secuencias")
        g = seqs.get(uniprot) if isinstance(seqs, dict) else None
        guardada: dict[str, Any] = g if isinstance(g, dict) else {}
        if not guardada.get("comprobado", True) or not direccion_de(d)["asoEncaja"]:
            return None
        dis = guardada.get("diseño")
        return CRIBA.pegar(e, dict(dis)) if isinstance(dis, dict) else None
    return None


def experimentos_de(e: dict[str, Any], uniprot: str, inv_id: str | None = None) -> list[dict[str, Any]]:
    """El contrato entero de los experimentos propuestos sobre una diana."""
    for d in dianas_de(e, inv_id):
        if d["uniprot"] == uniprot:
            return list(d["hipotesis"])
    return []


def laboratorio(e: dict[str, Any], inv_id: str | None = None, compuestos: list[dict[str, Any]] | None = None, completo: bool = False) -> dict[str, Any]:
    """Todo lo que ROSA2018 mandaría al laboratorio.

    Sin `inv_id` reúne TODAS las investigaciones, que es como se usa: la
    sección no es la vista de una investigación ni de una hipótesis, es lo que
    ROSA2018 tiene verificado hasta hoy en un solo sitio. Una proteína que tres
    investigaciones nombran sale una vez, con la evidencia de las tres sumada.

    Los compuestos se pasan ya resueltos (los trae el servidor por el conector
    de PubChem, que registra la consulta); aquí no se toca la red."""
    dianas, sin_estructura, por_alias = dianas_y_descartes(e, inv_id)
    comp = compuestos_de(e, inv_id, compuestos)
    # La ficha completa del compuesto viaja también dentro de la diana: la
    # lámina tiene que poder enseñar la fórmula sin salir de la proteína.
    por_nombre = {str(c.get("nombre") or "").lower(): c for c in comp}
    for d in dianas:
        for q in d.get("quimica") or []:
            ficha = por_nombre.get(str(q["nombre"]).lower())
            if ficha:
                q.update({k: ficha.get(k) for k in ("cid", "formula", "peso", "smiles", "inchikey", "ontologiaId", "enPubchem", "cerebro", "url2d", "motivo")})
    hechos = len(_hechos(e, inv_id))
    invs = len({str(h.get("investigacionId")) for h in _hechos(e, inv_id) if h.get("investigacionId")} | {str(h.get("investigacionId")) for h in _vivas(e, inv_id) if h.get("investigacionId")})
    # La decisión se calcula ANTES de aligerar: necesita el candidato entero.
    decision = oligo_que_mandaria(dianas)
    return {
        "oligoQueMandaria": decision,
        "dianas": dianas if completo else aligerar(dianas),
        "compuestos": comp,
        "nombradasSinEstructura": sin_estructura,
        "descartadasPorAlias": por_alias,
        "resumen": resumen(dianas, comp, len(_vivas(e, inv_id)), hechos, invs),
    }


__all__ = ["VERSION_ALPHAFOLD", "candidatos_de_compuesto", "compuestos_de", "compuestos_nombrados", "dianas_de", "dianas_y_descartes", "ficha_de_compuesto", "hoja_de_pedido", "laboratorio", "llegada_al_cerebro", "quimica_por_diana", "resolucion_por_uniprot", "aligerar", "direccion_de", "es_de_banco", "experimentos_de", "oligos_de", "resumen", "uniprot_por_simbolo_aprobado", "url_alphafold"]


# ---------------------------------------------------------------------------
# La decisión: cuál de todas, y por qué esa
# ---------------------------------------------------------------------------
#
# Por qué (30 de septiembre de 2026). La sección daba 126 candidatos repartidos
# en 17 proteínas y ninguna respuesta a «cuál». Un oligonucleótido general que
# las apague todas NO EXISTE: un ASO funciona emparejando bases con UNA
# secuencia, y la que encaja con MAPT no encaja con APP. Lo que sí se puede
# reunir de toda la investigación es la DECISIÓN: qué proteína apagar y con qué
# oligo, argumentada con lo que ROSA2018 ha verificado.
#
# Todo lo que puntúa aquí sale de datos que ROSA2018 ya tiene, y cada término
# viaja en la respuesta para que se pueda discutir. No hay ningún modelo.

# Orden del Killer, de más a menos avanzada.
_ORDEN_KILLER = {"avanzar": 3.0, "reformular": 2.0, "suspender": 1.0, "descartar_en_contexto": 0.0}
# La certeza GRADE. No sube mucho a propósito: casi todo está en muy baja, y si
# pesara demasiado no distinguiría nada.
_PESO_CERTEZA = {"alta": 3.0, "moderada": 2.0, "baja": 1.0, "muy_baja": 0.5}


def _terminos(d: dict[str, Any]) -> list[dict[str, Any]]:
    """Lo que suma y lo que resta para elegir esta diana, término a término.

    El Killer y la certeza salen SOLO de las hipótesis que piden bajar la
    proteína, que son las que un oligonucleótido pondría a prueba. Tomarlos de
    cualquiera era mezclar hipótesis distintas para justificar una decisión: en
    GFAP, el «avanzar» venía de una hipótesis de biomarcador que no propone
    intervenir, mientras la única que pide bajarla está suspendida y en certeza
    muy baja. Sumar lo mejor de cada una dibujaba una diana más sólida de lo
    que ninguna hipótesis sostiene."""
    todas = d.get("hipotesis") or []
    # Las que justifican el oligo. Si no hay ninguna, esta diana no debería
    # estar compitiendo, pero los términos se calculan igual y dan cero.
    hs = [h for h in todas if h.get("direccion") == "disminuye"] or []
    killer = max((_ORDEN_KILLER.get(str(h.get("decisionKiller")), 0.0) for h in hs), default=0.0)
    certeza = max((_PESO_CERTEZA.get(str(h.get("certeza")), 0.0) for h in hs), default=0.0)
    causal = len(d["causal"]["aguasArriba"]) + len(d["causal"]["aguasAbajo"])
    convergen = sum(1 for i in d["investigaciones"] if i.get("hechos"))
    # El peso de la evidencia se comprime: entre 405 afirmaciones y 96 hay una
    # diferencia real, pero no de cuatro veces a la hora de decidir.
    return [
        {"criterio": "afirmaciones que la sostienen", "valor": f"{d['sabidos']} de {d['hechos']}", "puntos": round(math.log10(1 + d["sabidos"]) * 2.0, 2)},
        {"criterio": "fuentes distintas", "valor": str(d["fuentes"]), "puntos": round(math.log10(1 + d["fuentes"]) * 1.5, 2)},
        # Solo las que APORTAN evidencia. Contar también las que nombran la
        # diana en una hipótesis y no traen ni un hecho hinchaba el término:
        # GFAP figuraba en seis investigaciones y en dos de ellas con cero
        # hechos, y eso le regalaba 1,2 puntos de convergencia que no existía.
        {"criterio": "investigaciones que aportan evidencia", "valor": str(convergen), "puntos": round(max(0, convergen - 1) * 0.6, 2)},
        {"criterio": "el Killer, en la hipótesis que pide bajarla", "valor": max((str(h.get("decisionKiller") or "sin decisión") for h in hs), key=lambda k: _ORDEN_KILLER.get(k, 0.0)) if hs else "ninguna la pide bajar", "puntos": killer},
        {"criterio": "certeza GRADE de esa misma hipótesis", "valor": max((str(h.get("certeza") or "sin certeza") for h in hs), key=lambda k: _PESO_CERTEZA.get(k, 0.0)) if hs else "ninguna la pide bajar", "puntos": certeza},
        {"criterio": "flechas en el grafo causal", "valor": str(causal), "puntos": round(causal * 0.5, 2)},
        {"criterio": "hay un experimento de banco propuesto", "valor": "sí" if d.get("deBanco") else "no", "puntos": 2.0 if d.get("deBanco") else 0.0},
    ]


def oligo_que_mandaria(dianas: list[dict[str, Any]]) -> dict[str, Any] | None:
    """De todo lo que ROSA2018 ha verificado, cuál apagaría y con qué oligo.

    Dos puertas antes de puntuar, y las dos son puertas y no términos.

    La dirección: una proteína que la evidencia pide SUBIR no compite, por
    mucha evidencia que tenga.

    El cribado: una diana cuyo mejor candidato encaja idéntico en otro gen
    tampoco compite. `pegar` ya dejó los descartados al final, así que basta
    con mirar el primero; sin esta puerta ROSA2018 podría estar mandando un
    oligo que baja de paso otros mil doscientos ARN, que es lo que le pasa al
    candidato de ATM que cae en un Alu. Un candidato SIN CRIBAR sí compite,
    marcado: se enseña lo que hay, no lo que gustaría."""
    aptas = [
        d
        for d in dianas
        if d.get("aso")
        and (d.get("aso") or {}).get("candidatos")
        and ((d["aso"]["candidatos"][0].get("criba") or {}).get("veredicto") or "sin cribar") != "descartado"
    ]
    if not aptas:
        return None

    puntuadas = []
    for d in aptas:
        ts = _terminos(d)
        puntuadas.append((sum(t["puntos"] for t in ts), d, ts))
    puntuadas.sort(key=lambda x: (-x[0], x[1]["simbolo"]))

    total, elegida, terminos = puntuadas[0]
    candidato = elegida["aso"]["candidatos"][0]

    # Por qué no las demás, con la diferencia concreta.
    otras = []
    for punto, d, ts in puntuadas[1:]:
        peor = min(
            (
                (t["criterio"], t["puntos"] - next(x["puntos"] for x in terminos if x["criterio"] == t["criterio"]))
                for t in ts
            ),
            key=lambda x: x[1],
            default=("", 0.0),
        )
        otras.append({
            "simbolo": d["simbolo"],
            "uniprot": d["uniprot"],
            "puntos": round(punto, 2),
            "porQueNo": f"suma {punto:.1f} frente a {total:.1f}; donde más pierde es en {peor[0]}",
        })

    # Y las que ni compiten, con el motivo de cada grupo.
    fuera: dict[str, list[str]] = {}
    for d in dianas:
        if d in aptas:
            continue
        cands = (d.get("aso") or {}).get("candidatos") or []
        if cands and (cands[0].get("criba") or {}).get("veredicto") == "descartado":
            fuera.setdefault("ningún candidato pasa el cribado contra el transcriptoma", []).append(d["simbolo"])
            continue
        dd = d.get("direccion") or {}
        fuera.setdefault(str(dd.get("pide") or "sin secuencia"), []).append(d["simbolo"])

    return {
        "simbolo": elegida["simbolo"],
        "uniprot": elegida["uniprot"],
        "nombre": elegida["nombre"],
        "tambienLlamada": elegida.get("tambienLlamada", ""),
        "candidato": candidato,
        # Sin los candidatos (ya va el elegido arriba) pero CON cuántos se
        # cribaron: es el dato que dice si esto es un cribado o una muestra.
        "diseño": {**{k: v for k, v in elegida["aso"].items() if k != "candidatos"}, "candidatosEnTotal": len(elegida["aso"]["candidatos"])},
        "puntos": round(total, 2),
        "porQue": terminos,
        "frenteA": otras,
        "fueraDeConcurso": fuera,
        # Lo que la haría cambiar. Es la misma idea que «qué la refutaría» del
        # Killer: una decisión que no dice qué la cambiaría no es una decisión,
        # es una opinión.
        "queLaCambiaria": (
            f"Que aparezca evidencia de que bajar {elegida['simbolo']} hace daño, o una hipótesis que pida subirla: "
            f"la dirección es una puerta y no un término, y con eso {elegida['simbolo']} saldría del concurso entera. "
            + (f"También que {otras[0]['simbolo']} gane {total - otras[0]['puntos']:.1f} puntos, que es lo que le falta ahora mismo." if otras else "")
        ),
        # El estado del cribado del candidato elegido, arriba del todo: es lo
        # que decide si esto se puede pedir hoy o no.
        "criba": dict(candidato.get("criba") or {}),
    }
