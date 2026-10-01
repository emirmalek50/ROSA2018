"""¿Se puede probar el mismo oligo en un roedor? Porque es donde se prueba.

Por qué esto existe. Emir: «haz la vaina de los ratones, porque recuerda que
primero se prueba en ellos». Faltaba de verdad: ROSA2018 proponía oligos sin
comprobar en ningún sitio si se podían llegar a probar en un animal.

El problema es concreto. Un oligo antisentido se diseña contra una secuencia
de veinte letras del ARN HUMANO. El ratón y la rata tienen su propia versión
del mismo gen, y su secuencia no es la misma: cambia lo bastante como para que
el oligo casi nunca encaje igual. Si no encaja, con ESA molécula no se puede
hacer el experimento: hay que diseñar aparte un «oligo sustituto» contra la
secuencia del animal, probar ese, y aceptar que lo que se mide no es
exactamente la molécula que iría a la persona. Es trabajo de más, no un muro.

Qué especies, y por qué solo estas (1 de octubre de 2026). Se llegó a montar
también el macaco cangrejero, porque es el no roedor que pide el expediente
regulatorio para ir a personas. Se quitó por decisión de Emir, y con razón
para lo que es esto: un macaco cuesta decenas de miles de dólares, no se van a
hacer experimentos con uno, y ROSA2018 es una herramienta de INVESTIGACIÓN.
Para investigar se prueba en lo que haga falta y lo normal son roedores; lo de
«dos especies» solo aplica mucho después, al presentar para meterlo en
personas, y eso está a años de aquí.

La regla por especie es la MISMA que la del cribado de fuera de diana
(`rosa/criba.py`), usada al revés. Allí se pregunta dónde NO queremos que
corte; aquí, si cortará donde sí queremos. Y la respuesta la manda lo mismo:
la RNasa H1 no lee las veinte letras, reconoce la dúplex que forma el HUECO de
diez del centro. Con el hueco perfecto corta aunque fallen las alas (con menos
afinidad); con un fallo dentro del hueco, no.

Cómo se encuentra el gen equivalente: por el nombre, que en roedores se
escribe con la primera letra en mayúscula (MAPT es Mapt). Es una heurística y
vale para la enorme mayoría, pero NO siempre: hay genes que se llaman distinto
y genes humanos que el roedor ni tiene (CA2 en ratón es Car2). Cuando el
nombre no aparece se dice «no pude encontrar el equivalente», que no es lo
mismo que «no sirve».
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

VERSION = 4

# Las especies, con su papel en el paquete regulatorio. El papel importa tanto
# como la especie: lo que se pide es UN roedor y UN no roedor, no tres.
ESPECIES: dict[str, dict[str, Any]] = {
    "raton": {
        "clave": "raton",
        "nombre": "ratón",
        "latin": "Mus musculus",
        "ensamblado": "GRCm39",
        "papel": "roedor",
        "ficheros": ("raton_cdna.fa.gz", "raton_ncrna.fa.gz"),
        "base": "raton",
        "mapa": "mapa_raton.tsv",
        "via": "en el ratón el oligo se inyecta en el ventrículo cerebral, no por punción lumbar: la vía no es la de la clínica",
        "de": {
            "raton_cdna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/mus_musculus/cdna/Mus_musculus.GRCm39.cdna.all.fa.gz",
            "raton_ncrna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/mus_musculus/ncrna/Mus_musculus.GRCm39.ncrna.fa.gz",
        },
    },
    "rata": {
        "clave": "rata",
        "nombre": "rata",
        "latin": "Rattus norvegicus",
        "ensamblado": "GRCr8",
        "papel": "roedor",
        "ficheros": ("rata_cdna.fa.gz", "rata_ncrna.fa.gz"),
        "base": "rata",
        "mapa": "mapa_rata.tsv",
        "via": "en la rata se administra por catéter intratecal, que se parece más a la clínica que el ventrículo del ratón pero sigue sin ser una punción lumbar",
        "de": {
            "rata_cdna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/rattus_norvegicus/cdna/Rattus_norvegicus.GRCr8.cdna.all.fa.gz",
            "rata_ncrna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/rattus_norvegicus/ncrna/Rattus_norvegicus.GRCr8.ncrna.fa.gz",
        },
    },
}

# Hasta cuántos fallos en las ALAS se acepta que el oligo siga sirviendo. Dos,
# por el mismo motivo que en el cribado: el hueco es lo que la enzima lee, y
# las alas solo aportan afinidad. Con más de dos la dúplex ya es demasiado
# floja para fiarse.
ALAS_MAX = 2

# El encuadre. Importa acertarlo, porque la primera versión lo erró dos veces:
# puso el marco REGULATORIO delante cuando ROSA2018 es una herramienta de
# INVESTIGACIÓN, y metió el macaco, que ni se va a usar (cuesta decenas de
# miles de dólares) ni hace falta para investigar.
#
# Para investigar se prueba en lo que haga falta, y lo normal son roedores. No
# hay nada que cumplir aquí.
EL_MARCO = {
    "paraInvestigar": (
        "Para investigar basta con poder probarlo en un roedor, y es lo que se hace: no hay ningún requisito que "
        "cumplir, se prueba en lo que haga falta para contestar la pregunta."
    ),
    "siNoEncaja": (
        "Que el oligo humano no encaje en el roedor es LO NORMAL. Se resuelve diseñando un oligo sustituto contra "
        "la secuencia del animal, de la misma química, y teniendo en cuenta que lo que se mide ahí no es "
        "exactamente la molécula que iría a la persona. Es trabajo de más, no un muro."
    ),
}

AVISOS = [
    {
        "que": "El gen equivalente se busca por el nombre",
        "porQue": "En roedores se escribe con la primera letra en mayúscula (MAPT es Mapt) y en macaco suele conservar el de la persona. Vale para la enorme mayoría, pero hay genes que se llaman distinto y genes humanos que la otra especie no tiene. Cuando no aparece se dice que no se pudo comprobar, no que no sirva.",
    },
    {
        "que": "Encajar no es funcionar",
        "porQue": "Que la secuencia encaje dice que el oligo PUEDE cortar ese ARN. No dice que el animal sea un buen modelo de la enfermedad, ni que lo que pase ahí vaya a pasar en una persona.",
    },
    {
        "que": "Esto es para investigar",
        "porQue": "Se prueba en lo que haga falta para contestar la pregunta, y lo normal son roedores. Mucho más adelante, para meterlo en personas, se piden además otras especies; eso está a años de aquí y no cambia nada de lo que se decide hoy.",
    },
    {
        "que": "No encajar en una especie no es un muro",
        "porQue": "Es lo normal, y se resuelve con un oligo sustituto específico de esa especie, de la misma química. Cuesta trabajo; no cierra el camino.",
    },
    {
        "que": "Esto no sustituye a la toxicología",
        "porQue": "Los efectos adversos propios de esta química (hígado, riñón, inflamación, plaquetas) se miden en el animal; no se predicen desde la secuencia.",
    },
]


def nombres_posibles(simbolo: str, papel: str = "roedor") -> list[str]:
    """Cómo se podría llamar en otra especie el gen que en persona se llama
    así. En roedores la primera en mayúscula, en primates igual que en
    persona; se prueban varias y se queda la que exista."""
    s = simbolo.strip()
    if not s:
        return []
    orden = [s.capitalize(), s, s.upper(), s.lower()] if papel == "roedor" else [s, s.upper(), s.capitalize(), s.lower()]
    vistos: dict[str, None] = {}
    for x in orden:
        vistos.setdefault(x, None)
    return list(vistos)


def hay(clave: str) -> dict[str, Any]:
    """Si están los ficheros y el índice de una especie."""
    esp = ESPECIES[clave]
    falta = [f for f in esp["ficheros"] if not (CARPETA / f).exists()]
    if not (CARPETA / "blastdb" / f"{esp['base']}.nsq").exists():
        falta.append(f"el índice de BLAST de {esp['nombre']}")
    if not (CARPETA / esp["mapa"]).exists():
        falta.append(f"el mapa de transcritos de {esp['nombre']}")
    return {
        "hay": not falta,
        "clave": clave,
        "nombre": esp["nombre"],
        "de": esp["de"],
        "motivo": "" if not falta else "Falta " + ", ".join(falta) + f" en {CARPETA}. Sin eso no se puede decir si el oligo sirve en {esp['nombre']}, que no es lo mismo que decir que no sirve.",
    }


def cuales_hay() -> dict[str, Any]:
    """Qué especies se pueden comprobar ahora mismo."""
    por = {k: hay(k) for k in ESPECIES}
    return {"especies": por, "hay": [k for k, v in por.items() if v["hay"]], "faltan": [k for k, v in por.items() if not v["hay"]]}


_MAPAS: dict[str, tuple[dict[str, str], dict[str, set[str]]]] = {}


def _mapa(clave: str) -> tuple[dict[str, str], dict[str, set[str]]]:
    """Transcrito -> símbolo, y símbolo -> sus transcritos, de una especie."""
    if clave not in _MAPAS:
        m: dict[str, str] = {}
        por: dict[str, set[str]] = {}
        with (CARPETA / ESPECIES[clave]["mapa"]).open(encoding="utf-8") as f:
            for linea in f:
                c = linea.rstrip("\n").split("\t")
                if len(c) >= 2 and c[1]:
                    m[c[0]] = c[1]
                    por.setdefault(c[1], set()).add(c[0])
        _MAPAS[clave] = (m, por)
    return _MAPAS[clave]


def _veredicto(clave: str, simbolo_humano: str, golpes: list[tuple[str, int, list[int]]]) -> dict[str, Any]:
    """Si el oligo humano sirve tal cual en una especie."""
    esp = ESPECIES[clave]
    mapa, por_simbolo = _mapa(clave)
    orto = next((x for x in nombres_posibles(simbolo_humano, str(esp["papel"])) if x in por_simbolo), "")
    base: dict[str, Any] = {
        "comprobado": True,
        "version": VERSION,
        "clave": clave,
        "nombre": esp["nombre"],
        "latin": esp["latin"],
        "papel": esp["papel"],
        "via": esp["via"],
        "simboloHumano": simbolo_humano,
        "ortologo": orto,
    }
    if not orto:
        return {
            **base,
            "veredicto": "no pude comprobar",
            "sirve": None,
            "porQue": (
                f"No encontré en {esp['nombre']} ningún gen que se llame como {simbolo_humano}. Puede que se llame "
                "distinto o que esa especie no lo tenga, pero NO quiere decir que el oligo no sirva: quiere decir "
                "que esto hay que mirarlo a mano."
            ),
        }
    suyos = [(t, n, d) for t, n, d in golpes if mapa.get(t) == orto]
    if not suyos:
        return {
            **base,
            "veredicto": "no sirve",
            "sirve": False,
            "fallos": None,
            "porQue": (
                f"El oligo no encaja en el ARN de {orto}, que es el {simbolo_humano} de {esp['nombre']}. Para esa "
                "especie haría falta un oligo sustituto contra su secuencia, de la misma química, y aceptar que lo "
                "que se mide ahí no es exactamente la molécula que iría a la persona."
            ),
        }
    mejor = min(suyos, key=lambda x: (en_el_hueco(x[2]), x[1]))
    tid, fallos, donde = mejor
    dentro = en_el_hueco(donde)
    base.update({"transcrito": tid, "fallos": fallos, "dondeFallan": donde, "falloEnElHueco": dentro, "transcritosQueEncajan": len(suyos)})
    if fallos == 0:
        return {**base, "veredicto": "sirve tal cual", "sirve": True, "porQue": (
            f"Encaja PERFECTO en el ARN de {orto}, el {simbolo_humano} de {esp['nombre']}. Es la misma molécula "
            "para las dos especies: lo que se pruebe ahí es exactamente lo que iría a la persona."
        )}
    if dentro:
        return {**base, "veredicto": "no sirve", "sirve": False, "porQue": (
            f"Se parece al ARN de {orto} pero falla en {fallos} letra(s), y al menos una cae DENTRO del hueco de "
            f"ADN (posiciones {HUECO_DESDE} a {HUECO_HASTA}), que es lo que la RNasa H1 necesita perfecto para "
            "cortar. Haría falta un oligo sustituto para esa especie."
        )}
    if fallos <= ALAS_MAX:
        return {**base, "veredicto": "probablemente sirve, con menos fuerza", "sirve": True, "porQue": (
            f"En el ARN de {orto} el hueco de ADN encaja perfecto y solo falla {fallos} letra(s) de las alas. La "
            "RNasa H1 debería cortar igual, porque lo que lee es el hueco; lo que baja es la afinidad, así que "
            "haría falta más dosis. Hay que medir la bajada en el animal antes de fiarse."
        )}
    return {**base, "veredicto": "no sirve", "sirve": False, "porQue": (
        f"El hueco encaja en el ARN de {orto}, pero fallan {fallos} letras de las alas, que son demasiadas: la "
        "dúplex queda floja y no se puede contar con que corte. Haría falta un oligo sustituto."
    )}


def juntar(por_especie: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """El veredicto de conjunto: ¿se puede empezar el experimento con esta
    misma molécula, o hay que diseñar un sustituto?"""
    sirven = [v for v in por_especie.values() if v.get("sirve")]
    faltan = [v for v in por_especie.values() if v.get("sirve") is False]
    sin_mirar = [v for v in por_especie.values() if v.get("sirve") is None]
    if sirven:
        v = "se puede probar"
        por = (
            f"Se puede empezar mañana: encaja en {' y '.join(x['nombre'] for x in sirven)}, así que el experimento "
            "con animales se hace con ESTA misma molécula."
        )
    elif faltan:
        v = "hace falta un sustituto"
        por = (
            "No encaja en el ARN de ningún roedor, así que con esta molécula no se puede empezar por un "
            "experimento con animales. Es lo normal y no cierra el camino: se diseña un oligo sustituto contra la "
            "secuencia del animal, de la misma química, sabiendo que lo que se mide ahí no es exactamente lo que "
            "iría a la persona."
        )
    else:
        v = "no pude comprobar"
        por = (
            "No se pudo encontrar el gen equivalente en ninguna de las especies, así que esto hay que mirarlo a "
            "mano. No quiere decir que el oligo no sirva."
        )
    return {
        "veredicto": v,
        "porQue": por,
        "sirvenEn": [x["nombre"] for x in sirven],
        "noSirvenEn": [x["nombre"] for x in faltan],
        "sinComprobar": [x["nombre"] for x in sin_mirar],
        "sePuedeProbar": bool(sirven),
        "cuantas": len(sirven),
        "deCuantas": len(por_especie),
        "marco": EL_MARCO,
        "avisos": AVISOS,
    }


async def _blast(clave: str, peticion: list[dict[str, str]]) -> dict[int, list[tuple[str, int, list[int]]]]:
    """BLAST de los candidatos contra una especie."""
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".fa", delete=False) as f:
        for i, p in enumerate(peticion):
            f.write(f">{i}\n{_complemento_inverso(p['secuencia'])}\n")
        consulta = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            str(BLAST / "blastn"), *ARGS_BLAST,
            "-db", str(CARPETA / "blastdb" / str(ESPECIES[clave]["base"])), "-query", consulta,
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
            raise RuntimeError(f"BLAST contra {clave} falló: {error.decode('utf-8', 'replace')[:400]}")
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
    return por_q


async def cribar(peticion: list[dict[str, str]]) -> dict[str, Any]:
    """Pasa los candidatos por todas las especies que estén descargadas."""
    estado = cuales_hay()
    if not peticion or not estado["hay"]:
        return {
            "version": VERSION,
            "hecho": False,
            "motivo": "; ".join(estado["especies"][k]["motivo"] for k in estado["faltan"]),
            "porSecuencia": {},
            "marco": EL_MARCO,
        }
    t0 = time.perf_counter()
    golpes = {k: await _blast(k, peticion) for k in estado["hay"]}
    fuera: dict[str, Any] = {}
    for i, p in enumerate(peticion):
        por_esp = {k: _veredicto(k, p["gen"], golpes[k].get(i, [])) for k in estado["hay"]}
        fuera[p["secuencia"]] = {**juntar(por_esp), "porEspecie": por_esp}
    return {
        "version": VERSION,
        "hecho": True,
        "motivo": "; ".join(estado["especies"][k]["motivo"] for k in estado["faltan"]),
        "segundos": round(time.perf_counter() - t0, 1),
        "especies": [{"clave": k, **{x: ESPECIES[k][x] for x in ("nombre", "latin", "ensamblado", "papel", "via")}} for k in estado["hay"]],
        "sinComprobar": [ESPECIES[k]["nombre"] for k in estado["faltan"]],
        "marco": EL_MARCO,
        "porSecuencia": fuera,
    }


__all__ = ["ALAS_MAX", "AVISOS", "EL_MARCO", "ESPECIES", "VERSION", "cribar", "cuales_hay", "hay", "juntar", "nombres_posibles"]
