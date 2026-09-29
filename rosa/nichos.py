"""El archivo de ideas por nichos: MAP-Elites aplicado a las hipótesis de ROSA2018.

Por qué (29 de septiembre de 2026, ANALISIS-MAP-ELITES-2026-09-29.md). MAP-Elites
(Mouret y Clune, arXiv 1504.04909) no guarda "las mejores ideas", guarda la mejor
de cada NICHO, y genera para los nichos que faltan. Es lo contrario de lo que hacía
ROSA2018: en la investigación "GFAP y NfL en portadores de APOE4" las 7 hipótesis
vivas estaban en la misma celda de la enfermedad (fase preclínica × plasma ×
astrocito), mientras "prodrómica o DCL × plasma × astrocito" tenía 7 hechos de dos
cohortes y ninguna hipótesis. El generador no repetía títulos (0 de 34 casi
iguales): proponía siempre en el mismo rincón.

Un nicho es una celda del mapa de la enfermedad (rosa/mapa_enfermedad.py): fase
de la enfermedad × región o compartimento × tipo celular. El mapa ya guarda en
cada celda sus hechos, sus cohortes y sus hipótesis; aquí solo se lee.

Lo que sale de aquí, todo por regla y sin llamadas:

- el archivo: las celdas ocupadas, cada una con su élite (la viva de más Elo), y
  los nichos LISTOS, que son las celdas con hechos de dos o más cohortes distintas,
  ninguna hipótesis y al menos dos de los tres ejes con valor;
- el reparto: qué nicho le toca a cada miembro del equipo de hipótesis
  (rosa/equipo.py), con uno siempre libre para que la exploración no desaparezca;
- el nicho de una propuesta, para que el marcador del equipo premie caer en uno
  listo y la hipótesis que nace lo guarde.

Por qué solo nichos de dos cohortes: el 74 % de las celdas vacías de la base solo
tenía evidencia de una. Lo que naciera ahí iría al vivero, a esperar una segunda
cohorte que puede no llegar, y se retiraría a las seis iteraciones. Apuntar ahí
sería trabajo tirado.
"""

from __future__ import annotations

from typing import Any

from rosa import mapa_enfermedad as MAPA

EJES = ("estadio", "region", "tipoCelular")

# Cuántas cohortes distintas necesita la evidencia de un nicho para que lo que nazca
# ahí nazca directamente (la regla de `destino_de_propuesta`: dos cohortes).
COHORTES_PARA_NICHO_LISTO = 2

# A partir de cuántas vivas una celda está saturada: proponer ahí resta en el
# marcador del equipo, salvo que la propuesta caiga también en un nicho listo.
VIVAS_PARA_SATURAR = 3

# Cuántos hechos del nicho se le enseñan al miembro que lo recibe.
HECHOS_POR_NICHO = 4


def clave(celda: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    return (celda.get("estadio") or None, celda.get("region") or None, celda.get("tipoCelular") or None)


def _ejes_con_valor(k: tuple[str | None, ...]) -> int:
    return sum(1 for x in k if x)


def etiqueta(k: tuple[str | None, str | None, str | None]) -> str:
    """"fase prodrómica o DCL × plasma × astrocito", con lo que falte dicho."""
    estadio, region, celula = k
    partes = [f"fase {MAPA.etiqueta('estadio', estadio)}" if estadio else "cualquier fase", MAPA.etiqueta("region", region) if region else "cualquier región", MAPA.etiqueta("tipoCelular", celula) if celula else "cualquier tipo celular"]
    return " × ".join(partes)


def archivo(e: dict[str, Any], inv_id: str, mapa: dict[str, Any] | None = None) -> dict[str, Any]:
    """{ocupados, listos, saturada, sinFruto}. `ocupados` y `listos` van ordenados
    por lo que importa: los ocupados por cuántas vivas tienen, los listos por si la
    misión los nombra, luego por cohortes y luego por hechos.

    Sin `mapa`, se calcula en el momento. NO se usa el guardado en la investigación
    por defecto: el 29 de septiembre de 2026 uno era del 17 de septiembre (1 celda
    con dos cohortes; recalculado, 4) y tres investigaciones no tenían ninguno. Con
    el guardado, la investigación de APOE4 salía sin un solo nicho listo. Calcularlo
    cuesta hasta 0,9 s, así que quien llama desde el bucle lo hace en un hilo; el
    tablero del método, que corre justo después de recalcular el mapa al cerrar la
    iteración, le pasa ese mapa recién hecho."""
    inv = next((i for i in (e.get("investigaciones") or []) if isinstance(i, dict) and i.get("id") == inv_id), None)
    vacio: dict[str, Any] = {"ocupados": [], "listos": [], "saturada": None, "sinFruto": 0}
    if inv is None:
        return vacio
    try:
        mapa = mapa if isinstance(mapa, dict) and isinstance(mapa.get("celdas"), list) else MAPA.mapa(e, inv["id"])
    except Exception:  # noqa: BLE001  sin mapa no hay nichos: el equipo sigue sin ellos
        return vacio
    vivas = {h.get("id"): h for h in (e.get("hipotesis") or []) if isinstance(h, dict) and h.get("investigacionId") == inv_id and h.get("estado") != "descartada"}
    ocupados: list[dict[str, Any]] = []
    listos: list[dict[str, Any]] = []
    sin_fruto = 0
    for c in mapa.get("celdas") or []:
        if not isinstance(c, dict):
            continue
        k = clave(c)
        hip = [x for x in (c.get("hipotesis") or []) if isinstance(x, str)]
        en_la_celda = [vivas[x] for x in hip if x in vivas]
        if en_la_celda:
            elite = max(en_la_celda, key=lambda h: (float(h.get("elo") or 0), str(h.get("id"))))
            ocupados.append({"clave": k, "etiqueta": etiqueta(k), "vivas": len(en_la_celda), "elite": {"id": elite.get("id"), "titulo": str(elite.get("titulo") or "")[:120], "elo": elite.get("elo")}})
            continue
        hechos = [x for x in (c.get("hechos") or []) if isinstance(x, str)]
        if hip or not hechos or _ejes_con_valor(k) < 2:
            continue
        cohortes = [str(x) for x in (c.get("cohortes") or []) if x]
        if len(cohortes) < COHORTES_PARA_NICHO_LISTO:
            sin_fruto += 1
            continue
        listos.append({"clave": k, "etiqueta": etiqueta(k), "hechos": hechos, "cohortes": cohortes, "porMision": int(c.get("porMision") or 0)})
    # Un nicho con un eje vacío que coincide en los demás con una celda ocupada NO es
    # un rincón nuevo: es la celda ocupada con la especificidad borrada ("cualquier
    # fase × plasma × astrocito" frente a "preclínica × plasma × astrocito", donde
    # estaban las 7 vivas de APOE4). Premiarlo premiaría escribir hipótesis más
    # vagas: quitar la fase para ganar puntos. Se descarta.
    ocupadas = [o["clave"] for o in ocupados]

    def version_vaga_de_una_ocupada(k: tuple[str | None, str | None, str | None]) -> bool:
        return any(all(a is None or a == b for a, b in zip(k, o)) for o in ocupadas if o != k)

    vagos = [x for x in listos if version_vaga_de_una_ocupada(x["clave"])]
    listos = [x for x in listos if x not in vagos]
    ocupados.sort(key=lambda x: (-x["vivas"], x["etiqueta"]))
    listos.sort(key=lambda x: (-x["porMision"], -len(x["cohortes"]), -len(x["hechos"]), x["etiqueta"]))
    saturada = ocupados[0]["clave"] if ocupados and ocupados[0]["vivas"] >= VIVAS_PARA_SATURAR else None
    return {"ocupados": ocupados, "listos": listos, "saturada": saturada, "sinFruto": sin_fruto, "vagos": len(vagos)}


def reparto(listos: list[dict[str, Any]], miembros: tuple[str, ...] | list[str], turno: int) -> dict[str, dict[str, Any] | None]:
    """Qué nicho le toca a cada miembro. Uno queda libre (None), rotando con la
    iteración, para que el equipo no pierda la exploración sin rumbo, que es de
    donde salen las ideas que nadie planeó. Los demás reciben nichos listos en
    orden, desplazados por la iteración para que no salgan siempre los mismos."""
    miembros = list(miembros)
    if not miembros:
        return {}
    turno = max(0, int(turno or 0))
    libre = miembros[turno % len(miembros)]
    salida: dict[str, dict[str, Any] | None] = {m: None for m in miembros}
    if not listos:
        return salida
    con_nicho = [m for m in miembros if m != libre]
    inicio = (turno * len(con_nicho)) % len(listos)
    for i, m in enumerate(con_nicho):
        if i >= len(listos):
            break
        salida[m] = listos[(inicio + i) % len(listos)]
    return salida


def texto_para_miembro(nicho: dict[str, Any] | None, arch: dict[str, Any], e: dict[str, Any]) -> str:
    """Lo que el miembro lee: su nicho con los hechos que lo pueblan, las celdas ya
    ocupadas con su élite, y la regla de no forzar."""
    ocupados = arch.get("ocupados") or []
    lineas = []
    if ocupados:
        lineas.append("Celdas de la enfermedad donde YA hay hipótesis vivas (proponer ahí solo si la propuesta supera a la mejor de la celda):")
        for o in ocupados[:5]:
            lineas.append(f"- {o['etiqueta']}: {o['vivas']} {'viva' if o['vivas'] == 1 else 'vivas'}; la mejor, «{o['elite']['titulo']}»")
    if nicho is None:
        lineas.append("Nicho: libre. En esta iteración te toca explorar sin nicho asignado.")
        return "\n".join(lineas) if lineas else "Nicho: libre."
    hechos_por_id = {h.get("id"): h for h in (e.get("hechos") or []) if isinstance(h, dict)}
    muestra = [hechos_por_id[x] for x in nicho.get("hechos") or [] if x in hechos_por_id][:HECHOS_POR_NICHO]
    lineas.append(f"Nicho que te toca: {nicho['etiqueta']}. Ninguna hipótesis ahí todavía, y la evidencia viene de {len(nicho['cohortes'])} cohortes distintas ({', '.join(nicho['cohortes'][:4])}), así que lo que nazca ahí nace directamente, sin pasar por el vivero. {len(nicho['hechos'])} hechos del modelo de mundo lo pueblan, por ejemplo:")
    for h in muestra:
        lineas.append(f"- {str(h.get('enunciado') or '')[:220]}")
    lineas.append("Sitúa tu propuesta en este nicho SOLO si las afirmaciones sostenidas que tienes lo permiten. Si no dan para él, no lo fuerces: propón donde tu evidencia lo sostenga, o nada. Una hipótesis encajada a la fuerza en un nicho vale menos que ninguna.")
    return "\n".join(lineas)


def celdas_de_propuesta(hp: Any, inv: dict[str, Any] | None) -> set[tuple[str | None, str | None, str | None]]:
    """Las celdas donde cae una propuesta del generador, con la misma regla con que
    el mapa sitúa las hipótesis (`ejes_de_hipotesis`)."""

    def campo(nombre: str) -> str:
        v = hp.get(nombre) if isinstance(hp, dict) else getattr(hp, nombre, "")
        return str(v or "")

    pseudo = {
        "titulo": campo("titulo"),
        "enunciado": campo("enunciado"),
        "mecanismo": campo("mecanismo"),
        "tarjeta": {"etapa": campo("etapa"), "celula": campo("celula"), "diana": campo("diana")},
        "comprobacion": {"biomarcador": campo("biomarcador"), "cohorte": campo("cohorte"), "diseno": campo("diseno")},
    }
    try:
        ejes = MAPA.ejes_de_hipotesis(pseudo, inv)
    except Exception:  # noqa: BLE001
        return set()
    estadio = ejes.get("estadio") or None
    regiones = [r for r in (ejes.get("region") or []) if r] or [None]
    celulas = [c for c in (ejes.get("tipoCelular") or []) if c] or [None]
    return {(estadio, r, c) for r in regiones for c in celulas}


def ejes_de_respaldo(textos: list[str]) -> tuple[set[str], set[str], set[str]]:
    """(fases, regiones, tipos celulares) que nombran las afirmaciones citadas."""
    fases: set[str] = set()
    regiones: set[str] = set()
    celulas: set[str] = set()
    for t in textos:
        try:
            x = MAPA.ejes_de_texto(t)
        except Exception:  # noqa: BLE001
            continue
        if x.get("estadio"):
            fases.add(str(x["estadio"]))
        regiones |= {str(r) for r in x.get("region") or [] if r}
        celulas |= {str(c) for c in x.get("tipoCelular") or [] if c}
    return fases, regiones, celulas


def sostenido_por_la_evidencia(k: tuple[str | None, str | None, str | None], respaldo: tuple[set[str], set[str], set[str]] | None) -> bool:
    """El nicho lo sostienen las afirmaciones que la propuesta CITA, no sus propias
    palabras: cada eje con valor del nicho lo nombra al menos una de ellas.

    Por qué (29 de septiembre de 2026). Huang y otros (arXiv 2609.28614) midieron
    que un agente que ve por qué lo puntúa su revisor aprende a esquivarlo: la
    evasión llega al 40,5 % si el revisor explica sus razones, frente al 20,3 % si
    solo dice que no. El equipo de hipótesis ve en el tablón qué puntuó y por qué.
    Si el nicho saliera del texto de la propuesta, bastaría con escribir "deterioro
    cognitivo leve" para ganar los dos puntos aunque la evidencia citada no dijera
    nada de esa fase. Sin respaldo (None) no se puede comprobar y no se premia."""
    if respaldo is None:
        return False
    for valor, nombrados in zip(k, respaldo):
        if valor and valor not in nombrados:
            return False
    return True


def puntos_por_nicho(celdas: set[tuple[str | None, str | None, str | None]], arch: dict[str, Any] | None, respaldo: tuple[set[str], set[str], set[str]] | None = None) -> tuple[int, str | None]:
    """(puntos, motivo) para el marcador del equipo: +2 si la propuesta cae en un
    nicho listo Y sus afirmaciones citadas lo sostienen; −2 si SOLO cae en la celda
    saturada. Lo demás, 0. La resta no pide respaldo: caer en la celda llena no se
    puede fingir para ganar nada."""
    if not arch or not celdas:
        return 0, None
    listos = {x["clave"]: x for x in arch.get("listos") or []}
    en_listo = [listos[k] for k in celdas if k in listos and sostenido_por_la_evidencia(k, respaldo)]
    if en_listo:
        return 2, f"cae en un nicho vacío con evidencia de {len(en_listo[0]['cohortes'])} cohortes ({en_listo[0]['etiqueta']})"
    saturada = arch.get("saturada")
    if saturada is not None and celdas == {tuple(saturada)}:
        ocupada = next((o for o in arch.get("ocupados") or [] if o["clave"] == tuple(saturada)), None)
        return -2, f"cae solo en la celda donde ya hay {ocupada['vivas'] if ocupada else 'varias'} hipótesis vivas ({etiqueta(tuple(saturada))})"
    return 0, None


def nicho_de_hipotesis(hp: Any, inv: dict[str, Any] | None, arch: dict[str, Any] | None, respaldo: tuple[set[str], set[str], set[str]] | None = None) -> dict[str, Any]:
    """Lo que guarda la hipótesis que nace: sus celdas y si cayó en un nicho listo
    que su evidencia sostiene. Es lo que dirá, dentro de unas iteraciones, si
    MAP-Elites hizo lo que predijo; con la misma regla que el marcador, para que la
    medida del efecto tampoco se pueda inflar con palabras."""
    celdas = celdas_de_propuesta(hp, inv)
    listos = {x["clave"] for x in (arch or {}).get("listos") or []}
    en_listo = any(k in listos and sostenido_por_la_evidencia(k, respaldo) for k in celdas)
    return {"celdas": [etiqueta(k) for k in sorted(celdas, key=lambda k: tuple(x or "" for x in k))][:6], "enNichoListo": en_listo}


__all__ = ["COHORTES_PARA_NICHO_LISTO", "VIVAS_PARA_SATURAR", "archivo", "celdas_de_propuesta", "clave", "ejes_de_respaldo", "etiqueta", "nicho_de_hipotesis", "puntos_por_nicho", "reparto", "sostenido_por_la_evidencia", "texto_para_miembro"]
