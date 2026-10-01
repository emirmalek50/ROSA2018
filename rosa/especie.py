"""¿Sirve el mismo oligo en las especies donde hay que probarlo?

Por qué esto existe (1 de octubre de 2026). Emir: «haz la vaina de los
ratones, porque recuerda que primero se prueba en ellos». Y al día siguiente,
de su compañero: «para que un ASO sea bueno, debe servir en las tres especies,
humanos, ratones y ratas».

Lo investigué antes de darlo por bueno, porque la idea es correcta pero el
marco real es otro, y conviene que la pantalla diga el de verdad:

- Lo que piden los reguladores NO son tres especies, son DOS: un roedor y un
  NO roedor (ICH M3(R2), y el borrador de la FDA de 2024 sobre seguridad no
  clínica de oligonucleótidos). El ratón y la rata son los dos roedores, así
  que hace falta UNO de los dos, no los dos.
- El no roedor es casi siempre el macaco cangrejero (Macaca fascicularis), por
  su homología con la persona y porque se considera predictivo de la toxicidad
  humana. El minipig está validado como alternativa.
- Y para un oligo del sistema nervioso central, que es el caso de ROSA2018, el
  macaco es además el único donde la vía es la MISMA que en la clínica: en el
  ratón se inyecta en el ventrículo y en la rata por catéter, pero la punción
  lumbar intratecal solo se hace igual en el macaco. Es la vía del nusinersén
  y la del tofersén, y las dos pasaron por roedor más macaco.
- Que el oligo humano NO funcione en roedores es LO NORMAL, no un fallo del
  diseño, y está previsto: la FDA acepta explícitamente un «oligo sustituto»
  específico de especie, de la misma química, para la toxicología. Es trabajo
  y dinero de más, no un muro.

Así que esto no dice «sirve o no sirve». Dice con qué especies se puede usar
LA MISMA molécula y dónde haría falta un sustituto, que es la pregunta que de
verdad cambia el plan y el presupuesto.

La regla por especie es la MISMA que la del cribado de fuera de diana
(`rosa/criba.py`), usada al revés. Allí se pregunta dónde NO queremos que
corte; aquí, si cortará donde sí queremos. Y la respuesta la manda lo mismo:
la RNasa H1 no lee las veinte letras, reconoce la dúplex que forma el HUECO de
diez del centro. Con el hueco perfecto corta aunque fallen las alas (con menos
afinidad); con un fallo dentro del hueco, no.

Cómo se encuentra el gen equivalente: por el nombre. En roedores se escribe
con la primera letra en mayúscula (MAPT es Mapt) y en macaco suele conservar
el de la persona. Es una heurística: hay genes que se llaman distinto y genes
humanos que la otra especie no tiene. Cuando el nombre no aparece se dice «no
pude encontrar el equivalente», que no es lo mismo que «no sirve».
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

VERSION = 2

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
    "macaco": {
        "clave": "macaco",
        # En los informes y en la industria se le llama siempre «cynomolgus» (o
        # «cyno»); el nombre en castellano es macaco cangrejero. Van los dos
        # porque quien lea la pantalla puede conocer solo uno.
        "nombre": "macaco cangrejero (cynomolgus)",
        "latin": "Macaca fascicularis",
        "ensamblado": "Macaca_fascicularis_6.0",
        "papel": "no roedor",
        "ficheros": ("macaco_cdna.fa.gz", "macaco_ncrna.fa.gz"),
        "base": "macaco",
        "mapa": "mapa_macaco.tsv",
        "via": "es la ÚNICA de las tres donde la vía es la misma que en la clínica: punción lumbar intratecal. Es la que usaron el nusinersén y el tofersén",
        "de": {
            "macaco_cdna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/macaca_fascicularis/cdna/Macaca_fascicularis.Macaca_fascicularis_6.0.cdna.all.fa.gz",
            "macaco_ncrna.fa.gz": "https://ftp.ensembl.org/pub/current_fasta/macaca_fascicularis/ncrna/Macaca_fascicularis.Macaca_fascicularis_6.0.ncrna.fa.gz",
        },
    },
}

# Hasta cuántos fallos en las ALAS se acepta que el oligo siga sirviendo. Dos,
# por el mismo motivo que en el cribado: el hueco es lo que la enzima lee, y
# las alas solo aportan afinidad. Con más de dos la dúplex ya es demasiado
# floja para fiarse.
ALAS_MAX = 2

# Lo que de verdad piden los reguladores, para que la pantalla no repita el
# mito de «tienen que ser las tres».
EL_MARCO = {
    "queSePide": (
        "Toxicología en DOS especies: un roedor y un no roedor (ICH M3(R2), y el borrador de la FDA de 2024 sobre "
        "seguridad no clínica de oligonucleótidos). No son tres, y el ratón y la rata son los dos roedores: hace "
        "falta UNO de los dos, no los dos."
    ),
    "elNoRoedor": (
        "Casi siempre el macaco cangrejero, por su homología con la persona y porque se considera predictivo de la "
        "toxicidad humana. El minipig está validado como alternativa."
    ),
    "yEnElCerebro": (
        "Para un oligo del sistema nervioso central el macaco es además el único donde la vía es la MISMA que en la "
        "clínica: punción lumbar intratecal. En el ratón se inyecta en el ventrículo y en la rata por catéter. Es la "
        "vía del nusinersén y la del tofersén, y las dos pasaron por roedor más macaco."
    ),
    "siNoSirve": (
        "Que el oligo humano no funcione en roedores es LO NORMAL y está previsto: la FDA acepta explícitamente un "
        "«oligo sustituto» específico de especie, de la misma química, para la toxicología. Es trabajo y dinero de "
        "más, no un muro."
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
        "que": "No servir en una especie no es un muro",
        "porQue": "Es lo normal, y se resuelve con un oligo sustituto específico de esa especie, de la misma química, que la FDA acepta para la toxicología. Cuesta trabajo y dinero; no cierra el camino.",
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
    """El veredicto de conjunto, con el marco regulatorio de verdad.

    No es «sirve en las tres». Lo que se pide es un roedor y un no roedor, así
    que lo que importa es si hay AL MENOS UNO de cada."""
    roedores = [v for v in por_especie.values() if v.get("papel") == "roedor" and v.get("sirve")]
    no_roedores = [v for v in por_especie.values() if v.get("papel") == "no roedor" and v.get("sirve")]
    sirven = [v for v in por_especie.values() if v.get("sirve")]
    faltan = [v for v in por_especie.values() if v.get("sirve") is False]
    tiene_roedor, tiene_no_roedor = bool(roedores), bool(no_roedores)
    if tiene_roedor and tiene_no_roedor:
        v, por = "paquete completo", (
            f"Con esta MISMA molécula se puede hacer la toxicología entera: sirve en {roedores[0]['nombre']} "
            f"(el roedor) y en {no_roedores[0]['nombre']} (el no roedor), que es lo que piden ICH M3(R2) y la FDA. "
            "Es la situación cómoda y no la normal."
        )
    elif tiene_roedor:
        v, por = "falta el no roedor", (
            f"Sirve en {roedores[0]['nombre']}, así que el roedor está cubierto, pero no en el macaco. Para el no "
            "roedor haría falta un oligo sustituto, y además el macaco es el único donde la vía es la misma que en "
            "la clínica (punción lumbar intratecal)."
        )
    elif tiene_no_roedor:
        v, por = "falta el roedor", (
            "Sirve en el macaco, que es el no roedor y el que da la vía de la clínica, pero en ningún roedor. Para "
            "el roedor haría falta un oligo sustituto."
        )
    else:
        v, por = "hacen falta sustitutos", (
            "No sirve tal cual en ninguna de las especies donde hay que probarlo. No cierra el camino (es lo normal "
            "y la FDA acepta oligos sustitutos específicos de especie), pero es diseñar y caracterizar moléculas "
            "aparte para la toxicología."
        )
    return {
        "veredicto": v,
        "porQue": por,
        "sirvenEn": [x["nombre"] for x in sirven],
        "noSirvenEn": [x["nombre"] for x in faltan],
        "tieneRoedor": tiene_roedor,
        "tieneNoRoedor": tiene_no_roedor,
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
