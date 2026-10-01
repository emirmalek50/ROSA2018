"""¿Sirve el mismo oligo en ratón? Porque primero se prueba ahí.

Por qué esto existe (1 de octubre de 2026). Emir lo dijo claro: «haz la vaina
de los ratones, porque recuerda que primero se prueba en ellos». Y tenía razón
en que faltaba: ROSA2018 proponía oligos sin comprobar en ningún sitio si se
podían llegar a probar en un animal.

El problema es concreto y práctico. Un oligo antisentido se diseña contra una
secuencia de veinte letras del ARN HUMANO. El ratón tiene su propia versión
del mismo gen, y su secuencia no es la misma: cambia lo bastante como para que
el oligo casi nunca encaje igual. Si no encaja, con ESA molécula no se puede
hacer ni un experimento con animales: no hay toxicología, no hay dosis, no hay
nada. Hay que diseñar aparte un «oligo sustituto» contra la secuencia del
ratón, probar ese en el animal, y aceptar que lo que se mide no es exactamente
la molécula que iría a la persona. Es lo que hace la industria y es un coste
real.

Así que la pregunta que contesta este módulo es: de los candidatos que ROSA2018
propone, ¿cuáles valen TAL CUAL para el ratón?

La regla es la MISMA que la del cribado de fuera de diana (`rosa/criba.py`),
usada al revés. Allí se pregunta dónde NO queremos que corte; aquí, si cortará
donde sí queremos. Y la respuesta la manda lo mismo: la RNasa H1 no lee las
veinte letras, reconoce la dúplex que forma el HUECO de diez del centro. Con
el hueco perfecto corta aunque fallen las alas (con menos afinidad); con un
fallo dentro del hueco, no corta.

Cómo se encuentra el gen equivalente del ratón: por el nombre, que en ratón se
escribe con la primera letra en mayúscula (MAPT en persona es Mapt en ratón).
Es una heurística y vale para la enorme mayoría, pero NO siempre: hay genes que
se llaman distinto en las dos especies y genes humanos que el ratón ni tiene.
Cuando el nombre no aparece se dice «no pude encontrar el equivalente», que no
es lo mismo que «no sirve».
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from pathlib import Path
from typing import Any

from rosa.criba import (
    ARGS_BLAST,
    BLAST,
    CARPETA,
    HUECO_DESDE,
    HUECO_HASTA,
    LARGO_OLIGO,
    PROCESOS,
    _complemento_inverso,
    en_el_hueco,
    fallos_de_btop,
)

VERSION = 1

FICHEROS = ("raton_cdna.fa.gz", "raton_ncrna.fa.gz")
DE_DONDE = {
    "raton_cdna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/mus_musculus/cdna/Mus_musculus.GRCm39.cdna.all.fa.gz",
    "raton_ncrna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/mus_musculus/ncrna/Mus_musculus.GRCm39.ncrna.fa.gz",
}
BASE = CARPETA / "blastdb" / "raton"
MAPA = CARPETA / "mapa_raton.tsv"

# Hasta cuántos fallos en las ALAS se acepta que el oligo siga sirviendo. Dos,
# por el mismo motivo que en el cribado: el hueco es lo que la enzima lee, y
# las alas solo aportan afinidad. Con más de dos la dúplex ya es demasiado
# floja para fiarse.
ALAS_MAX = 2

AVISOS = [
    {
        "que": "El gen equivalente se busca por el nombre",
        "porQue": "En ratón se escribe con la primera letra en mayúscula (MAPT es Mapt). Vale para la enorme mayoría, pero hay genes que se llaman distinto en las dos especies y genes humanos que el ratón ni tiene. Cuando no aparece se dice que no se pudo comprobar, no que no sirva.",
    },
    {
        "que": "Encajar no es funcionar",
        "porQue": "Que la secuencia encaje dice que el oligo PUEDE cortar ese ARN. No dice que el ratón sea un buen modelo de la enfermedad, ni que lo que pase ahí vaya a pasar en una persona.",
    },
    {
        "que": "Esto no sustituye a la toxicología",
        "porQue": "Un oligo que vale para el ratón sirve para hacer los experimentos; los efectos adversos propios de esta química (hígado, riñón, inflamación) se miden, no se predicen desde la secuencia.",
    },
]


def nombres_en_raton(simbolo: str) -> list[str]:
    """Cómo se podría llamar en ratón el gen que en persona se llama así.

    Se prueban varias formas y se queda la que exista: la convención es la
    primera letra en mayúscula, pero algunos (los del complemento, por
    ejemplo) conservan las mayúsculas."""
    s = simbolo.strip()
    if not s:
        return []
    vistos: dict[str, None] = {}
    for x in (s.capitalize(), s, s.upper(), s.lower()):
        vistos.setdefault(x, None)
    return list(vistos)


def hay_raton() -> dict[str, Any]:
    """Si están los ficheros y el índice del ratón. Sin ellos no se comprueba,
    y eso se dice: «no pude comprobar» no es «no sirve»."""
    falta = []
    for f in FICHEROS:
        if not (CARPETA / f).exists():
            falta.append(f)
    if not (CARPETA / "blastdb" / "raton.nsq").exists():
        falta.append("el índice de BLAST del ratón")
    if not MAPA.exists():
        falta.append("el mapa de transcritos del ratón")
    return {
        "hay": not falta,
        "ficheros": list(FICHEROS),
        "de": DE_DONDE,
        "motivo": "" if not falta else "Falta " + ", ".join(falta) + f" en {CARPETA}. Sin eso no se puede decir si el oligo sirve en ratón, que no es lo mismo que decir que no sirve.",
    }


_MAPA_CACHE: dict[str, str] | None = None
_POR_SIMBOLO: dict[str, set[str]] | None = None


def _mapa() -> tuple[dict[str, str], dict[str, set[str]]]:
    """Transcrito de ratón -> símbolo, y símbolo -> sus transcritos."""
    global _MAPA_CACHE, _POR_SIMBOLO
    if _MAPA_CACHE is None or _POR_SIMBOLO is None:
        m: dict[str, str] = {}
        por: dict[str, set[str]] = {}
        with MAPA.open(encoding="utf-8") as f:
            for linea in f:
                c = linea.rstrip("\n").split("\t")
                if len(c) >= 2 and c[1]:
                    m[c[0]] = c[1]
                    por.setdefault(c[1], set()).add(c[0])
        _MAPA_CACHE, _POR_SIMBOLO = m, por
    return _MAPA_CACHE, _POR_SIMBOLO


def _veredicto(simbolo_humano: str, golpes: list[tuple[str, int, list[int]]]) -> dict[str, Any]:
    """Si el oligo humano sirve tal cual en el ratón.

    `golpes` son (transcrito de ratón, número de fallos, dónde fallan)."""
    mapa, por_simbolo = _mapa()
    # El gen equivalente: el primero de los nombres posibles que exista.
    orto = next((x for x in nombres_en_raton(simbolo_humano) if x in por_simbolo), "")
    base: dict[str, Any] = {
        "comprobado": True,
        "version": VERSION,
        "simboloHumano": simbolo_humano,
        "ortologo": orto,
        "avisos": AVISOS,
    }
    if not orto:
        return {
            **base,
            "veredicto": "no pude comprobar",
            "sirve": None,
            "porQue": (
                f"No encontré en el ratón ningún gen que se llame como {simbolo_humano}. Puede que se llame "
                "distinto o que el ratón no lo tenga, pero NO quiere decir que el oligo no sirva: quiere decir "
                "que esto hay que mirarlo a mano."
            ),
        }
    # De los encajes, los que caen en el gen equivalente.
    suyos = [(t, n, d) for t, n, d in golpes if mapa.get(t) == orto]
    if not suyos:
        return {
            **base,
            "veredicto": "no sirve en ratón",
            "sirve": False,
            "fallos": None,
            "porQue": (
                f"El oligo no encaja en el ARN de {orto}, que es el {simbolo_humano} del ratón. Con esta misma "
                "molécula no se puede hacer ningún experimento con animales: habría que diseñar un oligo "
                "sustituto contra la secuencia del ratón, probar ese, y tener en cuenta que lo que se mide no es "
                "exactamente la molécula que iría a la persona."
            ),
        }
    mejor = min(suyos, key=lambda x: (en_el_hueco(x[2]), x[1]))
    tid, fallos, donde = mejor
    dentro = en_el_hueco(donde)
    base.update({
        "transcritoDeRaton": tid,
        "fallos": fallos,
        "dondeFallan": donde,
        "falloEnElHueco": dentro,
        "transcritosQueEncajan": len(suyos),
    })
    if fallos == 0:
        return {
            **base,
            "veredicto": "sirve tal cual",
            "sirve": True,
            "porQue": (
                f"Encaja PERFECTO en el ARN de {orto}, el {simbolo_humano} del ratón. Es la misma molécula para "
                "las dos especies: lo que se pruebe en el animal es exactamente lo que iría a la persona, que es "
                "la situación cómoda y no la normal."
            ),
        }
    if dentro:
        return {
            **base,
            "veredicto": "no sirve en ratón",
            "sirve": False,
            "porQue": (
                f"Se parece al ARN de {orto} pero falla en {fallos} letra(s), y al menos una cae DENTRO del hueco "
                f"de ADN (posiciones {HUECO_DESDE} a {HUECO_HASTA}), que es lo que la RNasa H1 necesita perfecto "
                "para cortar. Hace falta un oligo sustituto para el ratón."
            ),
        }
    if fallos <= ALAS_MAX:
        return {
            **base,
            "veredicto": "probablemente sirve, con menos fuerza",
            "sirve": True,
            "porQue": (
                f"En el ARN de {orto} el hueco de ADN encaja perfecto y solo falla {fallos} letra(s) de las alas. "
                "La RNasa H1 debería cortar igual, porque lo que lee es el hueco; lo que baja es la afinidad, así "
                "que haría falta más dosis. Se puede usar la misma molécula, midiendo la bajada en el animal antes "
                "de fiarse."
            ),
        }
    return {
        **base,
        "veredicto": "no sirve en ratón",
        "sirve": False,
        "porQue": (
            f"El hueco encaja en el ARN de {orto}, pero fallan {fallos} letras de las alas, que son demasiadas: "
            "la dúplex queda floja y no se puede contar con que corte. Hace falta un oligo sustituto."
        ),
    }


async def cribar_raton(peticion: list[dict[str, str]]) -> dict[str, Any]:
    """Pasa los candidatos por BLAST contra el transcriptoma del ratón."""
    t = hay_raton()
    if not peticion or not t["hay"]:
        return {"version": VERSION, "hecho": False, "motivo": t["motivo"], "porSecuencia": {}}

    import tempfile

    t0 = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".fa", delete=False) as f:
        for i, p in enumerate(peticion):
            f.write(f">{i}\n{_complemento_inverso(p['secuencia'])}\n")
        consulta = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            str(BLAST / "blastn"), *ARGS_BLAST,
            "-db", str(BASE), "-query", consulta,
            "-num_threads", str(PROCESOS),
            "-outfmt", "6 qseqid sseqid length mismatch btop",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            salida, error = await proc.communicate()
        except (asyncio.CancelledError, Exception):
            # Un hijo no muere con su padre, igual que en rosa/criba.py.
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            with contextlib.suppress(Exception):
                await proc.wait()
            raise
        if proc.returncode != 0:
            raise RuntimeError(f"BLAST contra el ratón falló: {error.decode('utf-8', 'replace')[:400]}")
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
    fuera = {p["secuencia"]: _veredicto(p["gen"], por_q.get(i, [])) for i, p in enumerate(peticion)}
    return {
        "version": VERSION,
        "hecho": True,
        "motivo": "",
        "segundos": round(time.perf_counter() - t0, 1),
        "especie": "Mus musculus (GRCm39, Ensembl)",
        "porSecuencia": fuera,
    }


__all__ = ["ALAS_MAX", "AVISOS", "BASE", "DE_DONDE", "FICHEROS", "MAPA", "VERSION", "cribar_raton", "hay_raton", "nombres_en_raton"]
