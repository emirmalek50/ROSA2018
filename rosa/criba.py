"""Cribado de los candidatos antisentido contra el transcriptoma humano entero.

Por qué esto existe (30 de septiembre de 2026). Hasta ahora `rosa/aso.py`
marcaba TODOS los candidatos como «sin cribar» y decía en su docstring que
alinear contra el transcriptoma era BLAST y minutos por candidato. Eso era
verdad con el servicio de NCBI, que es asíncrono y hay que encolar. Pero el
transcriptoma humano entero se descarga de Ensembl sin clave ni registro y
ocupa 225 MB comprimido, y buscar en él una cadena de veinte letras es
`bytes.find`, que corre a velocidad de C. Medido en esta máquina: los 180
candidatos que ROSA2018 tenía diseñados, contra los 669.547 transcritos, en una
sola pasada.

Y encuentra cosas de verdad. De esos 180, seis encajaban PERFECTAMENTE en genes
que no eran su diana:
  - tres eran secuencias Alu, el elemento repetido más común del genoma humano
    (alrededor de un millón de copias) y muy frecuente en las regiones 3' no
    traducidas, que es justo donde el diseño busca porque ahí la actividad es
    mayor;
  - uno era un repetido CAG;
  - y uno, el candidato número 2 de NDST3, encajaba en NDST4, que es su
    parálogo. Ese no es un artefacto de repetidos: es un fuera de diana
    biológico.
Un oligo contra un Alu bajaría a la vez decenas de ARN que no tienen nada que
ver con la enfermedad.

QUÉ CUBRE Y QUÉ NO. Esto importa más que el resultado, porque un cribado que se
vende como completo y no lo es hace más daño que no tenerlo:

1. **Solo coincidencia EXACTA.** Un oligo también encaja donde el texto es casi
   igual, con uno o dos fallos, y ahí la RNasa H1 corta igual. Un alineador
   tolerante a desajustes (BLAST, bowtie2) es otra herramienta y no está
   instalada. Así que «limpio» aquí quiere decir «no hay ningún otro ARN con
   este tramo idéntico», que es menos que «es seguro».
2. **Solo ARN maduro.** Los ficheros de Ensembl traen el transcrito ya
   empalmado. El corte promiscuo de la RNasa H1 sobre el borrador largo
   (pre-ARN, con sus intrones) es el mecanismo conocido de hepatotoxicidad de
   los gapmers de alta afinidad (Burel et al., Nucleic Acids Res 44:2093,
   2016), y eso NO se está mirando aquí: haría falta el genoma con su
   anotación, no el transcriptoma.
3. **Una sola referencia, no todas las personas.** GRCh38 es una secuencia de
   consenso. Una variante común en el sitio diana haría que el oligo no pegara
   en parte de la población, y eso es otra comprobación (ROSA2018 tiene
   conectores de variantes y aquí no se usan).

Por eso el veredicto que sale de aquí es «descartado» o «sin choque exacto»,
nunca «seguro».

Va en un proceso aparte a propósito: `bytes.find` no suelta el GIL, así que los
minutos de cribado colgarían el servidor entero si corrieran en un hilo.
"""

from __future__ import annotations

import asyncio
import bisect
import contextlib
import gzip
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

# id del transcrito, símbolo del gen, biotipo, y (cromosoma, inicio, fin, hebra)
Golpe = tuple[str, str, str, tuple[str, int, int, str]]

# 2: el cribado pasa a hacerse con BLAST cuando está (tolera fallos y es más
# rápido), y el veredicto se decide por si el HUECO de ADN encaja, no por
# contar fallos. Subir esto rehace el cribado entero.
# 3: el resultado guarda contra cuántos transcritos se comparó. Sin eso la
# pantalla decía «comparado contra 0 transcritos», que es peor que callarlo.
# 4: cada candidato lleva además si sirve en RATÓN, que es donde se prueba
# primero (rosa/especie.py). Subir esto rehace el cribado entero.
# 5: cada candidato lleva en qué ESPECIES se puede probar (ratón, rata y
# macaco), no solo el ratón. Subir esto rehace el cribado entero.
VERSION = 5

# Los dos ficheros de Ensembl. El de cDNA trae lo codificante, los pseudogenes
# y los intrones retenidos; el de ncRNA trae los 195.143 lncRNA, que en cerebro
# son abundantes y que un oligo puede bajar igual.
CARPETA = Path(__file__).resolve().parent.parent / "datos" / "_transcriptoma"
FICHEROS = ("cdna.fa.gz", "ncrna.fa.gz")
DE_DONDE = {
    "cdna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/homo_sapiens/cdna/Homo_sapiens.GRCh38.cdna.all.fa.gz",
    "ncrna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/homo_sapiens/ncrna/Homo_sapiens.GRCh38.ncrna.fa.gz",
}

# Cuántos procesos. `bytes.find` es puro C y no suelta el GIL, así que hilos no
# sirven de nada: tienen que ser procesos. Cuatro porque son los núcleos de
# rendimiento de esta máquina y cada uno descomprime su copia del fichero.
PROCESOS = 4

# Tamaño del bloque que se busca de una vez. El coste está en recorrer bytes,
# no en llamar a `find`, así que el bloque solo tiene que ser lo bastante
# grande para que la vuelta de Python no pese. Ocho megabytes lo son.
BLOQUE = 8 << 20

LIMITE_GENES = 40  # cuántos genes ajenos se guardan por candidato

# El sitio de la cabecera de Ensembl: `chromosome:GRCh38:1:226870616:226896098:1`
# (o `scaffold:` en los andamios). Hace falta porque el nombre del gen NO basta
# para decidir si un choque es de verdad: PSEN2 comparte su locus con
# ENSG00000288674, un gen que Ensembl todavía no ha nombrado («Novel protein»),
# y sin mirar el sitio los 38 candidatos de PSEN2 salían descartados por
# encajar en «otro gen» que es el mismo tramo de cromosoma con otra etiqueta.
SITIO = re.compile(r"(?:chromosome|scaffold):[^:]+:([^:]+):(\d+):(\d+):(-?1)")


def _complemento_inverso(s: str) -> str:
    return s.upper().translate(str.maketrans("ACGT", "TGCA"))[::-1]


def transcriptoma() -> dict[str, Any]:
    """Qué hay descargado. Sin los ficheros no se criba, y eso se dice: es «no
    pude comprobar», nunca «está limpio»."""
    ficheros: list[dict[str, Any]] = []
    for n in FICHEROS:
        p = CARPETA / n
        ficheros.append({"nombre": n, "hay": p.exists(), "bytes": p.stat().st_size if p.exists() else 0, "de": DE_DONDE[n]})
    faltan = [str(f["nombre"]) for f in ficheros if not f["hay"]]
    return {
        "hay": not faltan,
        "ficheros": ficheros,
        "carpeta": str(CARPETA),
        "fuente": "Ensembl GRCh38, versión actual",
        "motivo": "" if not faltan else f"Falta descargar {', '.join(faltan)} en {CARPETA}. Sin eso ROSA2018 no puede cribar, y no cribado no es limpio.",
    }


# ---------------------------------------------------------------------------
# El trabajo, que corre en el proceso hijo
# ---------------------------------------------------------------------------


def _sitio(cab: str) -> tuple[str, int, int, str]:
    m = SITIO.search(cab)
    if not m:
        return ("", 0, 0, "")
    return (m.group(1), int(m.group(2)), int(m.group(3)), m.group(4))


def _buscar(dianas: list[bytes], ficheros: list[Path]) -> tuple[dict[bytes, list[Golpe]], int]:
    """Dónde encaja cada tramo diana, recorriendo los ficheros una sola vez.

    Se acumulan transcritos en un bloque grande y se busca ahí, porque el coste
    de `find` está en los bytes recorridos y no en el número de llamadas. Un
    separador que no es ACGT entre transcrito y transcrito impide que una
    coincidencia caiga a caballo entre dos."""
    golpes: dict[bytes, list[Golpe]] = {d: [] for d in dianas}
    n_tr = 0
    buf = bytearray()
    cortes: list[int] = []
    quien: list[Golpe] = []

    def volcar() -> None:
        if not buf:
            return
        b = bytes(buf)
        for d in dianas:
            i = b.find(d)
            while i != -1:
                golpes[d].append(quien[bisect.bisect_right(cortes, i) - 1])
                i = b.find(d, i + 1)

    for ruta in ficheros:
        cab: str | None = None
        trozos: list[bytes] = []

        def cerrar(cab: str, s: bytes) -> None:
            nonlocal n_tr
            n_tr += 1
            g = re.search(r"gene_symbol:(\S+)", cab)
            b = re.search(r"transcript_biotype:(\S+)", cab)
            cortes.append(len(buf))
            quien.append((cab.split()[0], g.group(1) if g else "", b.group(1) if b else "", _sitio(cab)))
            buf.extend(s)
            buf.extend(b"\n")
            if len(buf) >= BLOQUE:
                volcar()
                buf.clear()
                cortes.clear()
                quien.clear()

        with gzip.open(ruta, "rb") as f:
            for linea in f:
                if linea.startswith(b">"):
                    if cab is not None:
                        cerrar(cab, b"".join(trozos))
                    cab = linea[1:].decode("utf-8", "replace").strip()
                    trozos = []
                else:
                    trozos.append(linea.strip())
            if cab is not None:
                cerrar(cab, b"".join(trozos))
    volcar()
    return golpes, n_tr


def _veredicto(propio: str, gs: list[Golpe]) -> dict[str, Any]:
    """De los golpes en crudo al veredicto, por regla.

    «Otro gen» se decide por SITIO del cromosoma y no solo por nombre. Ensembl
    anota en el mismo locus genes que todavía no tiene nombrados: PSEN2 comparte
    el suyo con ENSG00000288674 («Novel protein», sin símbolo), y contando por
    nombre salían 38 de los 39 candidatos de PSEN2 descartados por un choque
    que no existe. Un ARN anotado encima del mismo tramo no es un fuera de
    diana: es el mismo tramo con otra etiqueta."""
    propios = [g for g in gs if g[1] and g[1] == propio]
    # El tramo de cromosoma que ocupa el propio gen, por hebra.
    mio: dict[tuple[str, str], tuple[int, int]] = {}
    for _, _, _, (cr, ini, fin, hebra) in propios:
        if not cr:
            continue
        k = (cr, hebra)
        a, b = mio.get(k, (ini, fin))
        mio[k] = (min(a, ini), max(b, fin))

    def en_mi_sitio(s: tuple[str, int, int, str]) -> bool:
        cr, ini, fin, hebra = s
        r = mio.get((cr, hebra))
        return bool(cr and r and ini <= r[1] and fin >= r[0])

    ajenos = [g for g in gs if g not in propios]
    mismo_sitio = [g for g in ajenos if en_mi_sitio(g[3])]
    fuera = [g for g in ajenos if g not in mismo_sitio]
    genes = sorted({g[1] or "(sin símbolo)" for g in fuera})
    otro_nombre = sorted({g[1] or "(sin nombre en Ensembl)" for g in mismo_sitio})
    base = {
        "cribado": True,
        "propios": len(propios),
        "mismoSitioOtroNombre": otro_nombre[:LIMITE_GENES],
        "genesMismoSitio": len(otro_nombre),
        "transcritosMismoSitio": len(mismo_sitio),
    }
    if not gs:
        return {
            **base,
            "fuera": [],
            "genesFuera": 0,
            "transcritosFuera": 0,
            "veredicto": "revisar",
            "porQue": (
                "Este tramo no aparece en NINGÚN transcrito de Ensembl, ni siquiera en el "
                "de su propio gen. O el diseño salió de una versión del transcrito que esta "
                "descarga no trae, o hay un desajuste entre las dos fuentes. No se puede pedir "
                "sin aclarar eso."
            ),
        }
    if genes:
        return {
            **base,
            "fuera": genes[:LIMITE_GENES],
            # El total exacto, porque la lista se corta en LIMITE_GENES y un
            # «40 genes» donde son 1.263 sería mentir por omisión.
            "genesFuera": len(genes),
            "transcritosFuera": len(fuera),
            "veredicto": "descartado",
            "porQue": (
                f"El tramo diana aparece IDÉNTICO en {len(fuera)} transcrito(s) de "
                f"{len(genes)} gen(es) en otro sitio del genoma, no en {propio}"
                + (f" ({', '.join(genes[:6])}{'...' if len(genes) > 6 else ''})" if genes else "")
                + ". Donde el oligo encaja, la RNasa H1 corta, así que bajaría también esos."
            ),
        }
    extra = (
        f" Encaja además en {len(mismo_sitio)} transcrito(s) anotados en el mismo sitio del "
        f"cromosoma con otro nombre ({', '.join(otro_nombre[:3])}), que es el mismo tramo, no otro gen."
        if mismo_sitio
        else ""
    )
    return {
        **base,
        "fuera": [],
        "genesFuera": 0,
        "transcritosFuera": 0,
        "veredicto": "sin choque exacto",
        "porQue": (
            f"No hay ningún otro ARN humano con este tramo idéntico; encaja en "
            f"{len(propios)} transcrito(s) de {propio}, que es lo que se busca." + extra
            + " Ojo: esto es coincidencia exacta sobre ARN maduro. No descarta encajar con uno o dos "
            "fallos, ni en el borrador largo con sus intrones."
        ),
    }


def cribar(peticion: list[dict[str, str]]) -> dict[str, Any]:
    """Criba una lista de `{secuencia, gen}`. Corre en ESTE proceso: se usa
    desde el hijo y desde los tests."""
    t0 = time.perf_counter()
    dueño: dict[bytes, str] = {}
    for p in peticion:
        dueño[_complemento_inverso(p["secuencia"]).encode()] = p["gen"]
    ficheros = [CARPETA / n for n in FICHEROS if (CARPETA / n).exists()]
    golpes, n_tr = _buscar(list(dueño), ficheros)
    por_secuencia = {}
    for p in peticion:
        d = _complemento_inverso(p["secuencia"]).encode()
        por_secuencia[p["secuencia"]] = _veredicto(p["gen"], golpes.get(d, []))
    return {
        "version": VERSION,
        "transcritos": n_tr,
        "ficheros": [f.name for f in ficheros],
        "segundos": round(time.perf_counter() - t0, 1),
        "porSecuencia": por_secuencia,
    }


# ---------------------------------------------------------------------------
# El reparto, que corre en el proceso del servidor
# ---------------------------------------------------------------------------


async def cribar_aparte(peticion: list[dict[str, str]], procesos: int = PROCESOS) -> dict[str, Any]:
    """Criba repartiendo los candidatos entre varios procesos hijos.

    En procesos y no en hilos porque `bytes.find` no suelta el GIL: en un hilo
    esto colgaría el servidor los minutos que dura. Cada hijo descomprime su
    copia del fichero y se queda con su trozo de la lista."""
    if not peticion:
        return {"version": VERSION, "transcritos": 0, "ficheros": [], "segundos": 0.0, "porSecuencia": {}}
    t = transcriptoma()
    if not t["hay"]:
        return {"version": VERSION, "transcritos": 0, "ficheros": [], "segundos": 0.0, "porSecuencia": {}, "motivo": t["motivo"]}
    n = max(1, min(procesos, len(peticion)))
    lotes = [peticion[i::n] for i in range(n)]
    t0 = time.perf_counter()

    async def uno(lote: list[dict[str, str]]) -> dict[str, Any]:
        p = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "rosa.criba",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            cwd=str(Path(__file__).resolve().parent.parent),
            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parent.parent)},
        )
        try:
            salida, error = await p.communicate(json.dumps(lote).encode())
        except (asyncio.CancelledError, Exception):
            # Un hijo NO muere con su padre. Sin esto, cada reinicio del
            # servidor dejaba cuatro procesos huérfanos moliendo el fichero;
            # el 30 de septiembre de 2026 llegó a haber tres generaciones a la
            # vez, diez procesos peleando por cuatro núcleos, y el cribado en
            # curso no terminaba nunca. Se mata al salir, pase lo que pase.
            with contextlib.suppress(ProcessLookupError):
                p.kill()
            with contextlib.suppress(Exception):
                await p.wait()
            raise
        if p.returncode != 0:
            raise RuntimeError(f"el cribado falló: {error.decode('utf-8', 'replace')[:400]}")
        r: dict[str, Any] = json.loads(salida)
        return r

    partes = await asyncio.gather(*(uno(l) for l in lotes))
    fusion: dict[str, Any] = {}
    for parte in partes:
        fusion.update(parte["porSecuencia"])
    return {
        "version": VERSION,
        "transcritos": partes[0]["transcritos"] if partes else 0,
        "ficheros": partes[0]["ficheros"] if partes else [],
        "segundos": round(time.perf_counter() - t0, 1),
        "procesos": n,
        "porSecuencia": fusion,
    }


# ---------------------------------------------------------------------------
# Qué hay que cribar, y cómo se sabe que ya está hecho
# ---------------------------------------------------------------------------


def peticion_de(e: dict[str, Any]) -> list[dict[str, str]]:
    """Todos los candidatos diseñados del estado, sin repetir.

    Sale de `secuencias`, que es donde el bucle guarda el diseño, y no de la
    sección de laboratorio: la sección filtra por dirección y por alias, y un
    candidato que hoy no se enseña puede enseñarse mañana. Cribar de más aquí
    no cuesta nada (el coste es recorrer el fichero, no comparar) y evita que
    la pantalla dependa de cuándo se cribó."""
    seqs = e.get("secuencias")
    if not isinstance(seqs, dict):
        return []
    pet: dict[str, dict[str, str]] = {}
    for guardada in seqs.values():
        if not isinstance(guardada, dict):
            continue
        dis = guardada.get("diseño")
        if not isinstance(dis, dict):
            continue
        gen = str(dis.get("gen") or guardada.get("gen") or guardada.get("simbolo") or "")
        for c in dis.get("candidatos") or []:
            if isinstance(c, dict) and c.get("secuencia"):
                pet.setdefault(str(c["secuencia"]), {"secuencia": str(c["secuencia"]), "gen": gen})
    return list(pet.values())


def huella_de(peticion: list[dict[str, str]]) -> str:
    """La huella del conjunto a cribar, para saber si ya está hecho.

    Por huella y no por contar: contar condenaría a recribar en cada vuelta."""
    import hashlib

    crudo = "|".join(sorted(f"{p['secuencia']}:{p['gen']}" for p in peticion))
    return hashlib.sha1(crudo.encode(), usedforsecurity=False).hexdigest()


SIN_CRIBAR = {
    "cribado": False,
    "veredicto": "sin cribar",
    "propios": 0,
    "fuera": [],
    "genesFuera": 0,
    "transcritosFuera": 0,
    "mismoSitioOtroNombre": [],
    "genesMismoSitio": 0,
    "transcritosMismoSitio": 0,
    "porQue": "Todavía sin comparar contra el transcriptoma humano. Sin eso no se sabe si este tramo aparece igual en otro ARN, y no cribado no es limpio.",
}


def pegar(e: dict[str, Any], diseño: dict[str, Any] | None) -> dict[str, Any] | None:
    """Pone el cribado en cada candidato del diseño y reordena.

    Reordenar importa más de lo que parece: `oligo_que_mandaria` coge el
    candidato número uno, así que sin esto ROSA2018 podría estar mandando un
    oligo que encaja en otros veintiocho genes. Los descartados NO se borran
    (se enseñan marcados, que es lo que pidió Emir), pero van al final."""
    if not isinstance(diseño, dict):
        return diseño
    c = e.get("criba")
    c = c if isinstance(c, dict) else {}
    por_sec = c.get("porSecuencia")
    por_sec = por_sec if isinstance(por_sec, dict) else {}
    fuera = dict(diseño)
    cands = []
    for cand in diseño.get("candidatos") or []:
        if not isinstance(cand, dict):
            continue
        r = por_sec.get(str(cand.get("secuencia") or ""))
        nuevo = dict(cand)
        nuevo["criba"] = dict(r) if isinstance(r, dict) else dict(SIN_CRIBAR)
        if not isinstance(r, dict) and c.get("motivo"):
            nuevo["criba"]["porQue"] = str(c["motivo"])
        nuevo["cribado"] = bool(nuevo["criba"].get("cribado"))
        nuevo["avisoCribado"] = str(nuevo["criba"].get("porQue") or "")
        # Lo de las ESPECIES sube al candidato, no se queda dentro del
        # cribado: es otra pregunta (¿dónde se puede probar esto?) y la
        # pantalla y la decisión la leen aparte.
        nuevo["especies"] = nuevo["criba"].pop("especies", None)
        cands.append(nuevo)
    # Estable: dentro de cada grado se respeta el orden por puntuación.
    grado = {"sin choque exacto": 0, "sin cribar": 1, "revisar": 2, "descartado": 3}
    cands.sort(key=lambda x: grado.get(str(x["criba"].get("veredicto")), 1))
    fuera["candidatos"] = cands
    fuera["cribados"] = sum(1 for x in cands if x["cribado"])
    fuera["descartadosPorCriba"] = sum(1 for x in cands if x["criba"].get("veredicto") == "descartado")
    fuera["limpios"] = sum(1 for x in cands if x["criba"].get("veredicto") == "sin choque exacto")
    fuera["conPaqueteCompleto"] = sum(1 for x in cands if (x.get("especies") or {}).get("veredicto") == "paquete completo")
    fuera["criba"] = {
        "hecho": bool(c.get("porSecuencia")),
        "fecha": c.get("fecha"),
        "transcritos": c.get("transcritos") or 0,
        "ficheros": c.get("ficheros") or [],
        "segundos": c.get("segundos"),
        "motivo": c.get("motivo") or "",
        "limites": LIMITES,
    }
    return fuera


# Lo que este cribado NO cubre, que viaja con el resultado a la pantalla: un
# cribado que se vende como completo y no lo es hace más daño que no tenerlo.
LIMITES = [
    {
        "que": "Solo coincidencia exacta",
        "porQue": "Un oligo encaja también donde el texto es casi igual, con uno o dos fallos, y ahí la RNasa H1 corta igual. Hace falta un alineador tolerante a desajustes (BLAST, bowtie2) para eso.",
    },
    {
        "que": "Solo ARN maduro, sin intrones",
        "porQue": "Ensembl da el transcrito ya empalmado. El corte promiscuo sobre el borrador largo es el mecanismo conocido de hepatotoxicidad de los gapmers de alta afinidad (Burel et al., Nucleic Acids Res 44:2093, 2016), y eso pide el genoma con su anotación, no el transcriptoma.",
    },
    {
        "que": "Una sola referencia, no todas las personas",
        "porQue": "GRCh38 es una secuencia de consenso. Una variante común en el sitio diana haría que el oligo no pegara en parte de la población, y eso es otra comprobación.",
    },
]


if __name__ == "__main__":
    json.dump(cribar(json.load(sys.stdin)), sys.stdout)


# ---------------------------------------------------------------------------
# Cribado tolerante a desajustes, con BLAST
# ---------------------------------------------------------------------------
#
# Por qué hace falta y por qué el criterio no es «cuántos fallos» (30 de
# septiembre de 2026). El cribado exacto de arriba encuentra los choques
# perfectos, pero un oligo se pega también donde falla una o dos letras, y ahí
# la RNasa H1 corta igual. Para eso está BLAST, que con el transcriptoma
# indexado tarda 243 s en pasar los 787 candidatos, no los minutos por
# candidato que cuesta el servicio del NCBI.
#
# Al medirlo salieron dos cosas que cambian el criterio entero:
#
# 1. **BLAST busca en las dos hebras y solo una existe.** La hebra de atrás de
#    un transcrito no es un ARN de la célula, así que un encaje ahí no es un
#    fuera de diana. Sin `-strand plus` salían 97 candidatos con choque
#    exacto en otro gen donde el barrido exacto encontraba 13.
#
# 2. **A dos fallos, el azar ya da encajes.** La cuenta es directa: hay
#    C(20,2)·3² = 1.710 maneras de fallar en dos letras, o sea un encaje cada
#    643 millones de posiciones, y el transcriptoma tiene 1.480 millones. Son
#    2,3 encajes esperados POR AZAR y por candidato (a tres fallos, 41).
#    Descartar por eso sería descartar a casi todos por ruido.
#
# Así que el criterio es MECANÍSTICO y no un recuento. La RNasa H1 no lee las
# veinte letras: reconoce la dúplex de ADN con ARN que forma el HUECO de diez
# del centro. Si el hueco encaja perfecto, corta, aunque fallen las alas de
# 2'-MOE; si el fallo cae dentro del hueco, no. Por eso:
#
#   - choque exacto en otro gen          -> descartado (0 esperados por azar)
#   - hueco perfecto y fallos solo en las alas -> descartado (ahí sí corta)
#   - fallos dentro del hueco            -> se cuenta y se enseña, no descarta
#
# El hueco son las posiciones 6 a 15 del oligo. Como se busca el complemento
# inverso y la arquitectura es simétrica (5-10-5), son también las posiciones
# 6 a 15 de la consulta, que es lo que devuelve BLAST.

VERSION_BLAST = 1

# El hueco, tomado de la arquitectura de rosa/aso.py para que no se puedan
# desincronizar: si allí cambia el 5-10-5, aquí cambia solo.
from rosa.aso import ALA as _ALA, HUECO as _HUECO, LARGO as _LARGO  # noqa: E402

LARGO_OLIGO = _LARGO
HUECO_DESDE = _ALA + 1           # 6
HUECO_HASTA = _ALA + _HUECO      # 15

# Lo que se pide a BLAST. Cada uno está aquí por una razón medida:
#   -word_size 6   : con 7 se pierden los encajes de 3 fallos (comprobado:
#                    mutando 3 letras del sitio de MAPT, con 7 no encuentra
#                    MAPT y con 6 encuentra los 43 transcritos). Con m fallos
#                    el trozo idéntico más largo puede ser ceil((20-m)/(m+1)),
#                    o sea 6 para m=2, que es el rango que decide.
#   -penalty -1    : con el -3 de por defecto BLAST no extiende a través de
#                    los fallos y devuelve encajes truncados, no de largo 20.
#   -ungapped      : una dúplex de oligo no hace bultos útiles.
#   -dust no       : sin esto BLAST enmascara las zonas repetitivas de la
#                    consulta, que es justo donde están los Alu que hay que
#                    cazar.
#   -strand plus   : ver arriba.
#   -qcov_hsp_perc 100 : solo encajes que cubren el oligo entero.
ARGS_BLAST = (
    "-task", "blastn-short", "-word_size", "6", "-penalty", "-1", "-reward", "1",
    "-ungapped", "-dust", "no", "-soft_masking", "false", "-strand", "plus",
    "-qcov_hsp_perc", "100", "-evalue", "5000", "-max_target_seqs", "50000",
)

BLAST = CARPETA.parent / "_herramientas" / "ncbi-blast-2.17.0+" / "bin"
BASE_BLAST = CARPETA / "blastdb" / "humano"
MAPA = CARPETA / "mapa.tsv"


def hay_blast() -> dict[str, Any]:
    """Si están el programa y el índice. Sin ellos no se criba con desajustes,
    y eso se dice: es «no pude comprobar», no «no hay fuera de diana»."""
    exe = BLAST / "blastn"
    falta = []
    if not exe.exists():
        falta.append(f"el programa blastn en {BLAST}")
    if not (CARPETA / "blastdb" / "humano.nsq").exists():
        falta.append(f"el índice de BLAST en {CARPETA / 'blastdb'}")
    if not MAPA.exists():
        falta.append(f"el mapa de transcritos en {MAPA}")
    return {
        "hay": not falta,
        "programa": str(exe),
        "indice": str(BASE_BLAST),
        "motivo": "" if not falta else "Falta " + ", ".join(falta) + ". Sin eso solo se criba coincidencia exacta, y eso no descarta encajar con uno o dos fallos.",
    }


def fallos_de_btop(btop: str) -> list[int]:
    """De la cadena de BLAST a las posiciones (base uno) donde falla.

    `btop` alterna números (letras iguales seguidas) con pares de letras
    (consulta y sujeto) donde difieren: «10AG9» son diez iguales, luego una A
    en la consulta frente a una G, luego nueve iguales."""
    pos: list[int] = []
    i = 0
    donde = 0
    while i < len(btop):
        if btop[i].isdigit():
            j = i
            while j < len(btop) and btop[j].isdigit():
                j += 1
            donde += int(btop[i:j])
            i = j
        else:
            donde += 1
            pos.append(donde)
            i += 2
    return pos


def en_el_hueco(fallos: list[int]) -> bool:
    """Si algún fallo cae dentro del hueco de ADN, que es lo que lee la RNasa H1."""
    return any(HUECO_DESDE <= p <= HUECO_HASTA for p in fallos)


def _mapa() -> dict[str, tuple[str, str, int, int, str]]:
    """Transcrito -> (gen, cromosoma, inicio, fin, hebra), de la cabecera FASTA.

    Se lee del fichero que se genera una vez; son 669.547 líneas y tarda un
    segundo, así que se guarda en memoria entre llamadas."""
    global _MAPA_CACHE
    if _MAPA_CACHE is None:
        m: dict[str, tuple[str, str, int, int, str]] = {}
        with MAPA.open(encoding="utf-8") as f:
            for linea in f:
                c = linea.rstrip("\n").split("\t")
                if len(c) >= 6:
                    m[c[0]] = (c[1], c[2], int(c[3] or 0), int(c[4] or 0), c[5])
        _MAPA_CACHE = m
    return _MAPA_CACHE


_MAPA_CACHE: dict[str, tuple[str, str, int, int, str]] | None = None


# El NULO, medido y no supuesto (30 de septiembre de 2026).
#
# La cuenta teórica del azar decía que a dos fallos habría 2,3 encajes
# esperados por candidato. Era falsa: el transcriptoma no son mil quinientos
# millones de letras DISTINTAS, porque los transcritos de un mismo gen se
# solapan. Así que el azar se midió: 300 secuencias de veinte letras al azar
# con el mismo reparto de G y C, por la misma tubería de BLAST y la misma
# regla del hueco. Resultado, el porcentaje de secuencias AL AZAR cuyo peor
# encaje ajeno con el hueco perfecto es de ese nivel.
#
# Lo que esto cambia: incluso al azar, el 15 % de las secuencias tienen algún
# encaje ajeno con el hueco perfecto. Tener uno no dice nada por sí solo. Lo
# que dice algo es tenerlo con cero o un fallo, que al azar pasa el 0,7 % de
# las veces.
#
# Estos números viajan a la pantalla a propósito: así nadie tiene que fiarse
# de la regla, puede ver contra qué se compara.
NULO = {
    0: 0.007,   # encaje exacto en otro gen
    1: 0.007,   # un fallo, y en las alas
    2: 0.027,   # dos fallos, y en las alas
    3: 0.063,
    4: 0.047,
}
NULO_N = 300

# Hasta cuántos fallos en las ALAS se descarta. Dos y no tres: a dos fallos el
# azar ya da un 2,7 %, y de tres en adelante (6,3 %) es ruido.
FALLOS_QUE_DESCARTAN = 1
FALLOS_QUE_AVISAN = 2


def _coma(x: float, d: int = 1) -> str:
    """Un número con coma decimal, que es como se escribe en castellano."""
    return f"{x:.{d}f}".replace(".", ",")


def _veredicto_blast(propio: str, golpes: list[tuple[str, int, list[int]]]) -> dict[str, Any]:
    """De los encajes de BLAST al veredicto, por la regla del hueco.

    `golpes` son (transcrito, número de fallos, posiciones de los fallos).

    La regla no cuenta fallos: mira DÓNDE caen. La RNasa H1 no lee las veinte
    letras, reconoce la dúplex de ADN con ARN que forma el hueco de diez del
    centro. Si el hueco encaja perfecto corta, aunque fallen las alas; si el
    fallo cae dentro del hueco, no. Y el umbral de cuántos fallos en las alas
    cuentan sale del NULO medido, no de una corazonada.

    Devuelve las MISMAS claves que `_veredicto` (el barrido exacto) más el
    detalle de los desajustes, porque BLAST encuentra todo lo que encuentra el
    barrido (comprobado: los mismos trece choques exactos) y cuando está,
    manda. Así ni `pegar` ni la pantalla tienen que preguntar de cuál vienen."""
    mapa = _mapa()
    propios = [g for g in golpes if mapa.get(g[0], ("",))[0] == propio]
    # El tramo de cromosoma del propio gen, para no contar como ajeno un ARN
    # anotado encima del mismo sitio con otro nombre (el caso de PSEN2: sin
    # esto salían 51 choques exactos donde hay 13).
    mio: dict[tuple[str, str], tuple[int, int]] = {}
    for tid, _, _ in propios:
        _, cr, a, b, h = mapa[tid]
        if not cr:
            continue
        x, y = mio.get((cr, h), (a, b))
        mio[(cr, h)] = (min(x, a), max(y, b))

    def es_ajeno(tid: str) -> bool:
        m = mapa.get(tid)
        if not m:
            return False
        gen, cr, a, b, h = m
        if gen == propio:
            return False
        r = mio.get((cr, h))
        return not (cr and r and a <= r[1] and b >= r[0])

    def mismo_sitio(tid: str) -> bool:
        m = mapa.get(tid)
        return bool(m and m[0] != propio and not es_ajeno(tid))

    # Genes ajenos donde el HUECO encaja perfecto, agrupados por fallos en las
    # alas. Un gen cuenta por su MEJOR encaje: si pega exacto en uno de sus
    # transcritos, da igual que en otro pegue con tres fallos.
    corta: dict[int, set[str]] = {}
    tapado: set[str] = set()   # el fallo cae en el hueco: ahí no corta
    for tid, n, donde in golpes:
        if not es_ajeno(tid):
            continue
        gen = mapa[tid][0] or "(sin símbolo)"
        if n and en_el_hueco(donde):
            tapado.add(gen)
        else:
            corta.setdefault(n, set()).add(gen)
    visto: set[str] = set()
    for n in sorted(corta):
        corta[n] -= visto
        visto |= corta[n]
    tapado -= visto

    peor = min((n for n, g in corta.items() if g), default=None)
    exactos = sorted(corta.get(0, set()))
    base: dict[str, Any] = {
        "cribado": True,
        "propios": len(propios),
        "fuera": exactos[:LIMITE_GENES],
        "genesFuera": len(exactos),
        "transcritosFuera": sum(1 for tid, n, _ in golpes if n == 0 and es_ajeno(tid)),
        "mismoSitioOtroNombre": sorted({mapa[t[0]][0] or "(sin nombre en Ensembl)" for t in golpes if t[1] == 0 and mismo_sitio(t[0])})[:LIMITE_GENES],
        "genesMismoSitio": len({mapa[t[0]][0] for t in golpes if t[1] == 0 and mismo_sitio(t[0])}),
        "transcritosMismoSitio": sum(1 for t in golpes if t[1] == 0 and mismo_sitio(t[0])),
        # Lo propio del cribado con desajustes.
        "cribadoConDesajustes": True,
        "versionBlast": VERSION_BLAST,
        "huecoDesde": HUECO_DESDE,
        "huecoHasta": HUECO_HASTA,
        "porFallos": {str(n): sorted(g)[:LIMITE_GENES] for n, g in sorted(corta.items()) if g},
        "cuantosPorFallos": {str(n): len(g) for n, g in sorted(corta.items()) if g},
        "conFalloEnElHueco": len(tapado),
        "peorFallos": peor,
        "nulo": {str(k): v for k, v in NULO.items()},
        "nuloN": NULO_N,
    }

    def listo(veredicto: str, texto: str) -> dict[str, Any]:
        # `porQue` repite el texto: es el mismo hallazgo contado una vez, y la
        # pantalla ya lee `porQue`.
        return {**base, "veredicto": veredicto, "veredictoDesajustes": veredicto, "porQue": texto, "porQueDesajustes": texto}

    if peor is None:
        extra = (
            f" Se parece a {len(tapado)} gen(es), pero en todos el fallo cae DENTRO del hueco, que es lo que la "
            "RNasa H1 necesita perfecto para cortar."
            if tapado
            else ""
        )
        return listo("sin parecido", "No hay ningún otro ARN humano donde este oligo encaje entero con el hueco de ADN perfecto." + extra)

    genes = sorted(corta[peor])
    cuantos = len(genes)
    azar = _coma(NULO.get(peor, 0.1) * 100)
    lista = ", ".join(genes[:6]) + ("..." if cuantos > 6 else "")
    if peor == 0:
        return listo("descartado", (
            f"Encaja IDÉNTICO en {cuantos} gen(es) que no son {propio} ({lista}). Ahí la RNasa H1 corta igual. "
            f"Al azar solo el {azar} % de las secuencias de veinte letras tienen un encaje así."
        ))
    if peor <= FALLOS_QUE_DESCARTAN:
        return listo("descartado", (
            f"En {cuantos} gen(es) ajenos ({lista}) el hueco de ADN encaja PERFECTO y solo falla {peor} letra de las "
            "alas. La RNasa H1 no lee las veinte: reconoce la dúplex que forma el hueco, así que ahí corta. "
            f"Al azar solo el {azar} % de las secuencias tienen un encaje así, o sea que esto no es ruido."
        ))
    if peor <= FALLOS_QUE_AVISAN:
        return listo("al borde del azar", (
            f"En {cuantos} gen(es) ({lista}) el hueco encaja perfecto con {peor} fallos en las alas. Al azar ya le "
            f"pasa al {azar} % de las secuencias, así que está en el límite de lo que se puede distinguir del ruido: "
            "se cuenta y se enseña, no descarta."
        ))
    return listo("sin parecido", (
        f"El parecido más cercano en otro gen tiene {peor} fallos en las alas, y al azar eso le pasa al {azar} % de "
        "las secuencias: es lo esperable en un transcriptoma de este tamaño, no una señal."
    ))


async def cribar_con_desajustes(peticion: list[dict[str, str]]) -> dict[str, Any]:
    """Pasa los candidatos por BLAST contra el transcriptoma indexado.

    En subproceso, como el cribado exacto, pero aquí es por otra razón: BLAST
    ES un programa aparte. Tarda 145 s con los 787 candidatos, frente a los
    minutos POR candidato que cuesta encolar en el servicio del NCBI.

    Sin BLAST o sin índice no se inventa nada: se devuelve el motivo y la
    pantalla dice que no se pudo cribar con desajustes, que no es lo mismo que
    decir que no hay fuera de diana."""
    t = hay_blast()
    if not peticion or not t["hay"]:
        # `version` es la del MÓDULO, que es la que mira el bucle para saber si
        # hay que rehacer. Devolver aquí VERSION_BLAST hacía que el bucle no
        # reconociera nunca su propio resultado y recribara en cada vuelta,
        # que es el mismo modo de fallo que ya costó una vez con la heurística
        # de contar candidatos.
        return {"version": VERSION, "versionBlast": VERSION_BLAST, "porSecuencia": {}, "motivo": t["motivo"], "hecho": False}

    import tempfile

    t0 = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".fa", delete=False) as f:
        for i, p in enumerate(peticion):
            # Se busca el tramo del ARN, que es el complemento inverso del
            # oligo. Y solo la hebra de delante: la de atrás de un transcrito
            # no es un ARN que exista en la célula.
            f.write(f">{i}\n{_complemento_inverso(p['secuencia'])}\n")
        consulta = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            str(BLAST / "blastn"), *ARGS_BLAST,
            "-db", str(BASE_BLAST), "-query", consulta,
            "-num_threads", str(PROCESOS),
            "-outfmt", "6 qseqid sseqid length mismatch btop",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            salida, error = await proc.communicate()
        except (asyncio.CancelledError, Exception):
            # Igual que los hijos del cribado exacto: un BLAST de dos minutos
            # no puede quedarse vivo cuando se para el servidor.
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            with contextlib.suppress(Exception):
                await proc.wait()
            raise
        if proc.returncode != 0:
            raise RuntimeError(f"BLAST falló: {error.decode('utf-8', 'replace')[:400]}")
    finally:
        with contextlib.suppress(OSError):
            Path(consulta).unlink()

    por_q: dict[int, list[tuple[str, int, list[int]]]] = {}
    for linea in salida.decode("utf-8", "replace").splitlines():
        c = linea.split("\t")
        if len(c) < 5 or c[2] != str(LARGO_OLIGO):
            continue
        n = int(c[3])
        por_q.setdefault(int(c[0]), []).append((c[1], n, fallos_de_btop(c[4]) if n else []))
    fuera = {}
    for i, p in enumerate(peticion):
        fuera[p["secuencia"]] = _veredicto_blast(p["gen"], por_q.get(i, []))
    return {
        "version": VERSION,
        "versionBlast": VERSION_BLAST,
        "hecho": True,
        "motivo": "",
        "segundos": round(time.perf_counter() - t0, 1),
        "programa": "blastn 2.17.0+",
        # Contra cuántos se comparó. Sale del mapa, que es el índice de lo que
        # hay en la base de BLAST. Sin esto la pantalla decía «comparado
        # contra 0 transcritos», que es peor que no decir nada.
        "transcritos": len(_mapa()),
        "ficheros": list(FICHEROS),
        "porSecuencia": fuera,
    }
