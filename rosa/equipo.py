"""El equipo de generación de hipótesis: varios generadores con enfoques distintos
que comparten un tablón, en rondas, y un marcador por regla que decide qué entra.

Viene de dos lecturas del 27 de septiembre de 2026:

- Park y otros, "Scaling Discovery through Test-Time Communication" (arXiv
  2609.21032): k agentes que comparten un directorio rinden mucho más que k
  aislados (en ARC-AGI-3, team@5 rinde como 33 agentes independientes), SIEMPRE
  QUE haya un verificador denso que puedan consultar mientras trabajan y reglas
  contra el rebaño: cada agente declara un enfoque distinto, solo adopta la idea
  de otro ante un resultado verificado mejor, y aun así conserva una variación
  propia. Lo que más ayudó a los demás fueron los intentos FALLIDOS publicados.
- Shen, Druckmann y Zou, "Unlocking LLM Creativity in Science through Analogical
  Reasoning" (arXiv 2605.11258): los modelos colapsan hacia las mismas soluciones
  (1,6 % de novedad con Claude pidiendo soluciones a secas) y construir una
  analogía estructural con otro campo lo sube al 50-69 %. Aquí es uno de los
  enfoques del equipo.

El problema que ataca, medido sobre el estado del 27 de septiembre: 20 de las 28
hipótesis vivas hablan de GFAP y 20 de NfL, y ninguna toma la estructura de otro
campo. Un solo generador, una sola llamada por paso, siempre los mismos marcadores.

Cómo funciona. Cada miembro es una llamada al CEREBRO (GPT-6 Astra) con un
enfoque asignado; Sonnet no genera hipótesis (TRASPASO 7.4). En la primera ronda
proponen en paralelo sin verse. El marcador puntúa cada propuesta POR REGLA, sin
ningún modelo, con las mismas reglas con las que ROSA2018 ya decide si una
hipótesis vale (que cite afirmaciones sostenidas, que tenga dos cohortes
distintas, que tenga predicción falsable, que no repita una existente) y escribe
en el tablón por qué puntuó así cada una. En la segunda ronda cada miembro lee el
tablón, con lo que falló y por qué, y propone otra vez: puede mejorar lo suyo o
adoptar lo de otro, pero solo si la otra puntuó más, y conservando una variación.
Al final entran las mejores por puntuación, sin repetir enfoque mientras quede
otro, y siguen el camino de siempre: vivero si solo tienen una cohorte, revisión
inicial, supuestos, Killer, novedad y torneo. El equipo propone; no decide nada.

Lo que cuesta: MIEMBROS x RONDAS llamadas al cerebro en vez de una, en el paso de
hipótesis. El coste por token no es criterio en ROSA2018 (regla de la casa); la
reserva del paso sube en consecuencia.
"""

from __future__ import annotations

import re
from typing import Any

# Los enfoques. Cada miembro recibe uno y lo declara; el tablón no deja que dos
# miembros persigan lo mismo (la "ranura" de Park y otros).
ENFOQUES: dict[str, str] = {
    "analogia": (
        "Razonamiento por analogía entre campos. Primero, abstrae la estructura de una pregunta abierta: qué entidades hay "
        "y qué relaciones las unen, sin la biología concreta. Después, busca un problema de OTRO campo (ingeniería, economía, "
        "ecología, física, epidemiología, teoría de la información) con esa misma estructura de relaciones y que ese campo ya "
        "haya resuelto. Por último, traslada la solución de vuelta al Alzheimer como mecanismo comprobable. Di en el mecanismo "
        "cuál es la analogía, cuál es el campo de origen y qué relación se conserva. Las afirmaciones que cites tienen que "
        "sostener la biología, no la analogía."
    ),
    "contradiccion": (
        "Contradicción y anomalía. Busca dos afirmaciones sostenidas que no encajan entre sí, o un hecho del modelo de mundo "
        "que ninguna hipótesis viva explica, y propón el mecanismo que las reconcilia. Lo que interesa es lo que no cuadra, "
        "no lo que ya encaja."
    ),
    "mecanismo_opuesto": (
        "El mecanismo contrario. Toma la hipótesis viva mejor situada y propón una explicación rival de los mismos datos: otra "
        "causa, la causalidad invertida, un confusor, o un mecanismo que hace la predicción opuesta en algún grupo. Si la rival "
        "es buena, una de las dos está equivocada, y eso es lo que el torneo necesita."
    ),
    "otra_escala": (
        "Otra escala o momento. Si lo que existe habla de biomarcadores en plasma, busca la célula, el circuito, la región del "
        "cerebro o la etapa de la enfermedad donde la misma idea hace una predicción distinta y más fácil de refutar. Evita "
        "los marcadores que ya dominan las hipótesis vivas salvo que cambies de escala."
    ),
}
# Lo que se le dice a cada miembro además de su enfoque. Medido el 27 de septiembre
# de 2026 con GPT-6 Astra sobre la corrida viva: con la instrucción del generador
# único ("devolver la lista vacía es una respuesta válida y frecuente"), los ocho
# miembros devolvieron CERO propuestas. Veían ideas nuevas (la pseudoatrofia tras
# ARIA, el agonismo de TREM2) y las descartaban ellos mismos porque "no constituyen
# validación en dos cohortes clínicas". Pero exigir dos cohortes es lo que decide
# si una propuesta NACE o va al vivero, y eso lo aplica una regla después
# (`destino_de_propuesta`), no el que propone. Un miembro que se autocensura por
# una regla que viene detrás deja al equipo sin nada que el marcador pueda medir.
MANDATO = (
    "Dentro del equipo tu trabajo es PROPONER, no filtrar: después de ti, una regla decide si la propuesta nace o va "
    "al vivero, y la revisión, los supuestos y el Killer deciden si vale. Propón una o dos hipótesis desde tu enfoque "
    "aunque la evidencia solo venga de una cohorte o sea preclínica: si solo tiene una cohorte irá al vivero a esperar "
    "la segunda, que es su sitio. Lo que no puedes hacer es inventar: cada propuesta cita afirmaciones sostenidas de la "
    "lista, por su número, y no repite una hipótesis existente. Devolver la lista vacía solo es aceptable si ninguna "
    "afirmación de tu lista sostiene nada que no esté ya propuesto; si lo haces, dilo en una frase."
)
MIEMBROS = tuple(ENFOQUES)
RONDAS = 2
# Cuántas propuestas del equipo entran por iteración, en total: el mismo tope que
# el generador de siempre, para que el equipo cambie la calidad y no la cantidad.
MAX_QUE_ENTRAN = 2
# Por encima de esta proporción de palabras compartidas, dos propuestas dicen lo
# mismo con otras palabras.
UMBRAL_REPETIDA = 0.6

# -- El marcador, por regla y sin ningún modelo ------------------------------------

_PALABRA = re.compile(r"[a-záéíóúñü0-9][a-záéíóúñü0-9\-]{3,}", re.I)
_VACIAS = {"para", "como", "entre", "sobre", "desde", "hasta", "donde", "cuando", "tiene", "tienen", "puede", "pueden", "sería", "serían", "este", "esta", "estos", "estas", "otro", "otra", "otros", "otras", "más", "menos", "mayor", "menor", "hipótesis", "alzheimer", "pacientes", "personas", "enfermedad"}


def _tokens(texto: str) -> set[str]:
    return {t.lower() for t in _PALABRA.findall(texto or "") if t.lower() not in _VACIAS}


def parecido(a: str, b: str) -> float:
    """Jaccard de palabras largas. Rápido y sin modelo: sirve para decir "esto ya
    está", no para medir cuánto se parecen dos ideas."""
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _texto(hp: Any) -> str:
    return " ".join(str(getattr(hp, k, "") or "") for k in ("titulo", "enunciado", "mecanismo"))


def puntuar(hp: Any, validas: list[dict[str, Any]], fuentes: dict[str, Any], existentes: list[str], dominantes: set[str], nichos: dict[str, Any] | None = None, inv: dict[str, Any] | None = None) -> dict[str, Any]:
    """La puntuación de una propuesta y por qué, SOLO con reglas.

    Es el verificador denso que pide Park y otros, y no es nuevo: son las reglas que
    ROSA2018 ya aplica para decidir si una propuesta nace (`destino_de_propuesta`,
    dos cohortes), si el Killer la puede juzgar (predicción falsable) y si repite
    algo. Un modelo no puntúa aquí: las 20 conversaciones de Claude Science
    midieron 0,03 de correlación entre dos puntuaciones del mismo modelo."""
    from rosa.bucle.pasos import _fuente_publica, destino_de_propuesta

    motivos: list[str] = []
    puntos = 0
    indices = [i for i in (getattr(hp, "afirmaciones", None) or []) if isinstance(i, int)]
    respaldo = [validas[i - 1] for i in indices if 1 <= i <= len(validas)]
    if not respaldo:
        return {"puntos": 0, "nace": False, "motivos": ["no cita ninguna afirmación sostenida: no puede entrar"], "respaldo": 0}
    puntos += min(len(respaldo), 5)
    fuentes_h = [_fuente_publica(fuentes[a["fuenteId"]], a) for a in respaldo if a.get("fuenteId") in fuentes]
    afs = [{"cohorte": a.get("cohorte", ""), "veredicto": a.get("veredicto"), "tipo": a.get("tipo", "dato"), "fuenteId": a.get("fuenteId"), "texto": a.get("texto", "")} for a in respaldo]
    destino, _, motivo_nace = destino_de_propuesta(afs, fuentes_h)
    nace = destino == "nace"
    if nace:
        puntos += 5
    else:
        motivos.append(f"no nace todavía, iría al vivero: {motivo_nace}")
    if str(getattr(hp, "prediccion_falsable", "") or "").strip():
        puntos += 3
    else:
        motivos.append("sin predicción falsable: el Killer la mandaría a reformular")
    texto = _texto(hp)
    repetida = max((parecido(texto, x) for x in existentes), default=0.0)
    if repetida >= UMBRAL_REPETIDA:
        puntos -= 6
        motivos.append(f"repite una hipótesis que ya existe ({round(repetida * 100)} % de palabras compartidas)")
    marcadores = {m for m in dominantes if m.lower() in texto.lower()}
    if dominantes and not marcadores:
        puntos += 2
    elif marcadores:
        motivos.append(f"vuelve a los marcadores que ya dominan ({', '.join(sorted(marcadores))})")
    # MAP-Elites (rosa/nichos.py): caer en un rincón vacío de la enfermedad con
    # evidencia de dos cohortes suma; caer SOLO en la celda que ya está llena resta.
    # Es lo que empuja al equipo fuera del rincón de siempre sin prohibir nada.
    en_nicho = False
    if nichos:
        from rosa import nichos as NI

        extra, motivo_nicho = NI.puntos_por_nicho(NI.celdas_de_propuesta(hp, inv), nichos)
        puntos += extra
        en_nicho = extra > 0
        if motivo_nicho and extra < 0:
            motivos.append(motivo_nicho)
    if not motivos:
        motivos.append("cita afirmaciones sostenidas, nace con dos cohortes, es falsable y no repite nada" + ("; y cae en un nicho vacío de la enfermedad" if en_nicho else ""))
    return {"puntos": puntos, "nace": nace, "motivos": motivos, "respaldo": len(respaldo), "enNicho": en_nicho}


def dominantes(hipotesis: list[dict[str, Any]], investigacion_id: str, umbral: float = 0.5) -> set[str]:
    """Los marcadores que aparecen en más de la mitad de las hipótesis vivas: los
    que el equipo tiene que evitar salvo que cambie de escala."""
    candidatos = ("GFAP", "NfL", "P-tau181", "P-tau217", "APOE", "amiloide", "semaglutida", "lecanemab", "donanemab", "TREM2", "YKL-40")
    vivas = [h for h in hipotesis if isinstance(h, dict) and h.get("investigacionId") == investigacion_id and h.get("estado") != "descartada"]
    if len(vivas) < 4:
        return set()
    return {m for m in candidatos if sum(1 for h in vivas if m.lower() in (str(h.get("titulo", "")) + " " + str(h.get("enunciado", ""))).lower()) / len(vivas) > umbral}


def texto_tablon(entradas: list[dict[str, Any]]) -> str:
    """El tablón compartido, tal como lo lee cada miembro en la segunda ronda: cada
    propuesta con su enfoque, su puntuación por regla y el motivo, las que fallaron
    incluidas. Los intentos fallidos son lo que más ayudó en Park y otros."""
    if not entradas:
        return "Vacío."
    filas = []
    for x in sorted(entradas, key=lambda y: -y["puntos"]):
        filas.append(f"[{x['enfoque']}, ronda {x['ronda']}, {x['puntos']} puntos] {x['titulo']}\n  Mecanismo: {x['mecanismo'][:300]}\n  Marcador: {'; '.join(x['motivos'])}")
    return "\n".join(filas)


def elegir(entradas: list[dict[str, Any]], maximo: int = MAX_QUE_ENTRAN) -> list[dict[str, Any]]:
    """Las que entran: las de más puntos que citan evidencia, sin dos del mismo
    enfoque mientras quede otro, y sin dos que digan lo mismo. Las de la segunda
    ronda ganan a las de la primera con los mismos puntos, porque ya vieron el
    tablón. Diversidad por construcción, no por buena voluntad."""
    utiles = sorted((x for x in entradas if x["respaldo"] > 0 and x["puntos"] > 0), key=lambda x: (-x["puntos"], -x["ronda"]))
    salida: list[dict[str, Any]] = []
    for x in utiles:
        if len(salida) >= maximo:
            break
        if any(parecido(x["texto"], y["texto"]) >= UMBRAL_REPETIDA for y in salida):
            continue
        if any(y["enfoque"] == x["enfoque"] for y in salida) and any(z["enfoque"] not in {y["enfoque"] for y in salida} for z in utiles if z is not x):
            continue
        salida.append(x)
    return salida


# Cuánta evidencia ve cada miembro, en caracteres: lo mismo que veía el generador
# único, pero un trozo DISTINTO para cada uno.
CARACTERES_POR_MIEMBRO = 12_000


def reparto_de_evidencia(validas: list[dict[str, Any]], n_miembros: int, maximo: int = CARACTERES_POR_MIEMBRO) -> list[list[int]]:
    """Qué afirmaciones ve cada miembro: una lista de índices (en `validas`) por
    miembro.

    El fallo que arregla, medido el 27 de septiembre de 2026 sobre la corrida viva:
    el generador recibía el texto de las afirmaciones sostenidas cortado a 12.000
    caracteres, en orden de extracción. De 1.149 afirmaciones veía 54, TODAS de la
    iteración 1; las 712 de las iteraciones 2 y 3 no las vio nunca ningún
    generador. Cada iteración generaba con la misma ventana de evidencia vieja, y
    así salían las mismas hipótesis.

    El reparto: lo más reciente primero (lo que ninguna hipótesis ha usado
    todavía), una afirmación por fuente antes de repetir fuente (69 fuentes
    distintas en esa corrida), y en turnos, para que cada miembro reciba un trozo
    distinto. Entre todos ven hasta `n_miembros` veces más evidencia que antes."""
    orden = sorted(range(len(validas)), key=lambda i: (-int(validas[i].get("iteracion") or 0), i))
    # Una por fuente antes de repetir: primero la mejor de cada fuente, luego la siguiente...
    por_fuente: dict[str, list[int]] = {}
    for i in orden:
        por_fuente.setdefault(str(validas[i].get("fuenteId") or f"sin-{i}"), []).append(i)
    intercalado: list[int] = []
    capa = 0
    while len(intercalado) < len(orden):
        añadidas = False
        for lista in por_fuente.values():
            if capa < len(lista):
                intercalado.append(lista[capa])
                añadidas = True
        if not añadidas:
            break
        capa += 1
    repartos: list[list[int]] = [[] for _ in range(max(1, n_miembros))]
    usados = [0] * len(repartos)
    for k, i in enumerate(intercalado):
        m = k % len(repartos)
        coste = len(str(validas[i].get("texto") or "")) + len(str(validas[i].get("cita") or "")) + 24
        if repartos[m] and usados[m] + coste > maximo:
            continue
        repartos[m].append(i)
        usados[m] += coste
    return repartos


def texto_de_indices(validas: list[dict[str, Any]], indices: list[int]) -> str:
    """El texto numerado que ve un miembro. La numeración es la GLOBAL de `validas`,
    así que los índices que cite el miembro se resuelven igual que siempre."""
    lineas = [f"{i + 1}. ({validas[i].get('tipo', 'dato')}{', parcial' if validas[i].get('veredicto') == 'parcial' else ''}{', cohorte ' + str(validas[i]['cohorte']) if validas[i].get('cohorte') else ''}) {validas[i].get('texto', '')} {validas[i].get('cita', '')}" for i in sorted(indices)]
    return "\n".join(lineas) if lineas else "Ninguna afirmación sostenida todavía."


def entrada(hp: Any, enfoque: str, ronda: int, marcador: dict[str, Any]) -> dict[str, Any]:
    return {"hp": hp, "enfoque": enfoque, "ronda": ronda, "titulo": str(getattr(hp, "titulo", "") or "").strip(), "mecanismo": str(getattr(hp, "mecanismo", "") or "").strip(), "texto": _texto(hp), **marcador}
