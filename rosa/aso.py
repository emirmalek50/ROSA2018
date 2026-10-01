"""Oligonucleótidos antisentido: candidatos por regla sobre la secuencia real.

Por qué esto sí y las moléculas pequeñas no (29 de septiembre de 2026). ROSA2018
no diseña moléculas: no tiene ninguna capacidad validada para hacerlo y una
estructura inventada destruiría la confianza en todo lo demás. Un oligonucleótido
antisentido es otra cosa. Se diseña DESDE LA SECUENCIA del ARN mensajero, que es
pública y exacta: se elige una ventana de veinte nucleótidos, se comprueba que
cumple unas reglas publicadas y sale algo que un proveedor puede sintetizar. Eso
sí se calcula.

Y el campo ya lo validó donde importa: diranersen (BIIB080, Ionis y Biogen), un
gapmer contra el ARN de MAPT administrado por vía intratecal, redujo la patología
tau en PET y el declive cognitivo en la fase 2 CELIA (mayo de 2026), con Fast
Track de la FDA desde abril de 2025. MAPT es además la diana más nombrada por la
propia evidencia de ROSA2018.

Qué hace este módulo: generar CANDIDATOS con su razonamiento, para que un
laboratorio los criba. Nunca un fármaco.

Tres cosas que NO puede hacer, y que la pantalla tiene que decir:

1. **El cribado de off-target no es una regla, es una búsqueda**, y este módulo
   no la hace: la hace `rosa/criba.py`, que compara cada candidato contra los
   669.547 transcritos humanos de Ensembl y marca el que encaja idéntico en
   otro gen (el 30 de septiembre de 2026, seis de ciento ochenta: tres Alu, un
   repetido CAG y uno en NDST4, el parálogo de NDST3). Lo que sale de AQUÍ está
   sin cribar por definición, y el campo `cribado` de cada candidato lo dice.
   Aun con el cribado hecho quedan dos huecos que `rosa/criba.py` documenta:
   solo mira coincidencia exacta, y solo sobre ARN maduro, cuando el corte
   promiscuo de la RNasa H1 sobre el borrador largo (pre-ARN) es el mecanismo
   conocido de hepatotoxicidad de los gapmers de alta afinidad (Burel et al.,
   Nucleic Acids Res 44:2093, 2016).
2. **Los filtros son estadística, no predicción.** Salen de mirar experimentos
   pasados. Una patente de Ionis describe sintetizar 156 oligonucleótidos para
   llevar unos pocos a dosis-respuesta, y QIAGEN dice de su herramienta que es en
   parte empírica, con veinte años de datos detrás. Lo que sale de aquí es una
   lista corta para probar.
3. **Un gen no hace un solo ARN.** MAPT tiene 55 transcritos y seis isoformas de
   tau en cerebro adulto; bajarlas todas no es lo mismo que mover el equilibrio
   entre ellas. Se dice qué transcrito se usó y cuántos más hay; elegir es una
   decisión científica y en ROSA2018 esas las toma una persona.

Fuentes de las reglas, todas en el código donde se aplican:
- Arquitectura 5-10-5 de 2'-MOE con enlaces fosforotioato y 5-metilcitosina: es
  la de los tres gapmers aprobados (mipomersen, inotersen, volanesorsen).
- Motivos de actividad y de estorbo: análisis estadístico de experimentos
  antisentido (Matveeva et al.).
- CpG y TLR9: los CpG sin metilar imitan ADN bacteriano y activan TLR9; la
  5-metilcitosina de la arquitectura estándar es ya una mitigación.
- Tramos GGGG: bajan la actividad y forman cuádruplex de guanina, que es
  justamente lo que se explota a propósito en los oligos inmunoestimuladores.
"""

from __future__ import annotations

import re
from typing import Any

from rosa import fiabilidad as FIABILIDAD

# ---------------------------------------------------------------------------
# La arquitectura: un gapmer 5-10-5 de 2'-MOE
# ---------------------------------------------------------------------------

LARGO = 20
ALA = 5  # nucleótidos de 2'-MOE a cada lado
HUECO = LARGO - 2 * ALA  # el hueco de ADN que reconoce la RNasa H1

QUIMICA = {
    "arquitectura": f"gapmer {ALA}-{HUECO}-{ALA}",
    "alas": "2'-O-metoxietilo (2'-MOE)",
    "hueco": "ADN (2'-desoxi), es lo que reconoce la RNasa H1",
    "enlaces": "fosforotioato en todos los enlaces",
    "citosinas": "5-metilcitosina",
    "porQue": "Es la arquitectura de los tres gapmers aprobados: mipomersen, inotersen y volanesorsen, los tres de veinte nucleótidos con alas de cinco y hueco de diez",
}

# Qué hace y qué NO hace. Se escribe aquí y viaja con el diseño porque es lo
# primero que se malentiende: un ASO destruye el ARN mensajero, que es la
# instrucción, y con eso deja de fabricarse proteína nueva. La proteína YA
# FABRICADA no la toca; se va con el recambio normal de la célula.
#
# El matiz que lo salva: los agregados no son un depósito muerto. Crecen
# reclutando proteína soluble y a la vez se eliminan despacio, así que cortar
# el suministro inclina la balanza. En la fase 1b del BIIB080 la señal de tau
# en PET bajó POR DEBAJO del punto de partida en las seis regiones corticales
# examinadas tras un año, y una bajada por debajo del inicio no se explica con
# «se acumula más despacio». Con dos avisos: eran dieciséis personas en la
# dosis alta, y la señal del PET de tau no es una medida perfecta de ovillos.
QUE_HACE = {
    "hace": "corta la producción: destruye el ARN mensajero, que es la instrucción para fabricar la proteína",
    "noHace": "no toca la proteína que ya está fabricada; esa se va con el recambio normal de la célula",
    "matiz": "los agregados no son un depósito muerto: crecen reclutando proteína soluble y se eliminan despacio, así que cortar el suministro inclina la balanza hacia la eliminación",
    "evidencia": "en la fase 1b del BIIB080 contra tau, la señal de PET bajó por debajo del punto de partida en las seis regiones corticales tras un año, y eso no se explica con acumular más despacio",
    "aviso": "eran dieciséis personas en la dosis alta y la señal del PET de tau no es una medida perfecta de ovillos: parte de la bajada podría ser que el trazador se une distinto",
}

# La vía de administración. No es un detalle de la hoja: para una diana del
# sistema nervioso central es lo que separa un experimento posible de uno
# imposible. Los ASO no cruzan la barrera hematoencefálica (son grandes y van
# muy cargados negativamente), así que se inyectan directamente en el líquido
# cefalorraquídeo. Es lo que se hace con el nusinersén, aprobado para la atrofia
# muscular espinal, y con el diranersen contra tau.
VIA = {
    "via": "intratecal (punción lumbar)",
    "porQue": "los oligonucleótidos antisentido NO cruzan la barrera hematoencefálica: son moléculas grandes y muy cargadas. Por vía intravenosa harían falta dosis enormes y casi nada llegaría al cerebro",
    "precedente": "es la vía del nusinersén (aprobado para la atrofia muscular espinal) y la del diranersen contra tau en Alzheimer",
    "limite": "la distribución por difusión deja menos fármaco en las regiones profundas del cerebro y más en la médula lumbar",
}

# ---------------------------------------------------------------------------
# Los filtros. Cada uno con su nombre, su motivo y su fuente.
# ---------------------------------------------------------------------------

# Proporción de G y C: fuera de esta banda el encaje es demasiado flojo o
# demasiado fuerte. La banda de 40 a 60 es la de uso corriente.
GC_MIN, GC_MAX = 0.40, 0.60

# Motivos asociados a MÁS actividad y a MENOS, del análisis estadístico de
# experimentos antisentido. No son una garantía: son una correlación.
MOTIVOS_BUENOS = ("CCAC", "TCCC", "ACTC", "GCCA", "CTCT")
MOTIVOS_MALOS = ("GGGG", "ACTG", "AAA", "TAA")

# Autocomplementariedad: si el oligo se pega a sí mismo, no se pega a su diana.
AUTO_MAX = 6

# Cuánto pesa la región del transcrito donde cae la ventana. No es una
# preferencia de estilo: hay un análisis de eficacia que mide la reducción
# conseguida según dónde apunta el oligo, con medianas de ~53 % para la región
# 3' no traducida y para exón, 44 % para la 5' no traducida y 32 % para las
# uniones de exones. Se traduce a un empujón del tamaño de uno o dos motivos,
# para que ordene sin aplastar al resto de criterios.
PESO_REGION = {
    "región 3' no traducida": 2.0,
    "región codificante": 2.0,
    "región 5' no traducida": 0.5,
}

_COMPLEMENTO = str.maketrans("ACGT", "TGCA")


def complemento_inverso(s: str) -> str:
    """El ASO es el complemento inverso del tramo del transcrito al que va."""
    return s.translate(_COMPLEMENTO)[::-1]


def _autocomplementariedad(aso: str) -> int:
    """El tramo más largo del oligo que encaja consigo mismo. Un oligo que se
    dobla sobre sí mismo o se empareja con otra copia no llega a su diana."""
    rc = complemento_inverso(aso)
    mayor = 0
    for k in range(3, min(10, len(aso)) + 1):
        if any(aso[i : i + k] in rc for i in range(len(aso) - k + 1)):
            mayor = k
    return mayor


def _repeticion_larga(aso: str) -> int:
    """La racha más larga de la misma letra. Cuatro guaninas seguidas forman
    cuádruplex; cuatro de cualquier otra letra tampoco son buena señal."""
    return max((len(m.group(0)) for m in re.finditer(r"(.)\1*", aso)), default=0)


def evaluar(aso: str) -> dict[str, Any]:
    """Pasa un candidato por todos los filtros y devuelve por qué pasa o no.

    Devuelve los motivos SIEMPRE, pasen o no: la pantalla enseña el porqué, no
    un veredicto sin explicación."""
    gc = (aso.count("G") + aso.count("C")) / len(aso) if aso else 0.0
    cpg = aso.count("CG")
    g4 = "GGGG" in aso
    auto = _autocomplementariedad(aso)
    racha = _repeticion_larga(aso)
    buenos = sum(aso.count(m) for m in MOTIVOS_BUENOS)
    malos = sum(aso.count(m) for m in MOTIVOS_MALOS)

    fallos: list[dict[str, str]] = []
    # Los avisos NO bloquean: penalizan y se ven. La diferencia importa,
    # porque un veto de más es tan malo como uno de menos y no se nota igual.
    avisos: list[dict[str, str]] = []
    if not GC_MIN <= gc <= GC_MAX:
        fallos.append({
            "filtro": "proporción de G y C",
            "motivo": f"{gc * 100:.0f} %, fuera de la banda de {GC_MIN * 100:.0f} a {GC_MAX * 100:.0f}",
            "porQue": "por debajo el encaje es demasiado flojo y por encima demasiado pegajoso, que trae consigo tolerar desajustes",
        })
    # UN CpG avisa; dos o más vetan.
    #
    # Antes vetaba cualquiera, y el 30 de septiembre de 2026 se vio lo que
    # costaba: los SEIS sitios más accesibles del ARN de MAPT (accesibilidad
    # 0,86 frente al 0,09 del candidato que ROSA2018 mandaría, nueve veces
    # mejor) quedaban fuera por tener un solo CpG. El motivo del filtro es que
    # los CpG sin metilar imitan ADN bacteriano y activan el receptor TLR9,
    # pero la arquitectura que ROSA2018 especifica lleva 5-metilcitosina en
    # TODAS las citosinas, que es justamente la mitigación de eso, y es la de
    # los tres gapmers aprobados. Vetar por un riesgo que la propia química
    # del diseño ya cubre era tirar la mejor respuesta por nada.
    if cpg >= 2:
        fallos.append({
            "filtro": "dinucleótidos CpG",
            "motivo": f"tiene {cpg}",
            "porQue": "los CpG sin metilar imitan ADN bacteriano y activan el receptor TLR9; con uno la 5-metilcitosina de la arquitectura basta, con dos o más ya no se asume",
        })
    elif cpg == 1:
        avisos.append({
            "filtro": "dinucleótidos CpG",
            "motivo": "tiene 1",
            "porQue": "los CpG sin metilar activan el receptor TLR9, pero la arquitectura lleva 5-metilcitosina en todas las citosinas, que es la mitigación estándar y la de los tres gapmers aprobados. Cuenta en contra, no descarta.",
        })
    if g4:
        fallos.append({
            "filtro": "tramo GGGG",
            "motivo": "lo tiene",
            "porQue": "baja la actividad y forma cuádruplex de guanina, que es justo lo que se busca a propósito en los oligos inmunoestimuladores",
        })
    if auto >= AUTO_MAX:
        fallos.append({
            "filtro": "autocomplementariedad",
            "motivo": f"encaja consigo mismo en {auto} nucleótidos",
            "porQue": "un oligo que se dobla sobre sí mismo o se empareja con otra copia no llega a su diana",
        })
    if racha >= 5:
        fallos.append({
            "filtro": "racha de la misma letra",
            "motivo": f"{racha} seguidas",
            "porQue": "las rachas largas dan síntesis peor y estructuras que estorban",
        })

    return {
        "gc": round(gc, 3),
        "cpg": cpg,
        "g4": g4,
        "autocomplementariedad": auto,
        "rachaMasLarga": racha,
        "motivosBuenos": buenos,
        "motivosMalos": malos,
        "pasa": not fallos,
        "fallos": fallos,
        "avisos": avisos,
    }


def partes(aso: str) -> dict[str, str]:
    """El oligo partido en ala, hueco y ala: es como se escribe en un pedido."""
    return {"ala5": aso[:ALA], "hueco": aso[ALA : ALA + HUECO], "ala3": aso[ALA + HUECO :]}


def _region(pos: int, largo_cdna: int, inicio_cds: int | None, fin_cds: int | None) -> str:
    """En qué parte del transcrito cae la ventana. Solo se dice si se sabe."""
    if inicio_cds is None or fin_cds is None:
        return ""
    if pos < inicio_cds:
        return "región 5' no traducida"
    if pos > fin_cds:
        return "región 3' no traducida"
    return "región codificante"


# Cuánto pesa que el sitio esté abierto, frente a los motivos y la región.
#
# Seis, por dos razones que coinciden. La de principio: los motivos van de 0 a
# 6 puntos, así que con peso 6 un sitio completamente abierto vale lo mismo
# que un candidato con seis motivos buenos, y ninguno de los dos tapa al otro.
# Ninguno predice potencia por sí solo y el campo trata los dos como criterios
# de primer orden, así que dejar la accesibilidad de desempate (que es lo que
# pasaba con peso 2) no se sostiene.
#
# La empírica: barriendo el peso de 0 a 12 sobre el ARN de MAPT, los
# candidatos con el sitio abierto pasan de 1 de 60 (peso 0) a 13 (peso 6) y
# ahí se aplana: con 8 son 14 y con 12 también. La rodilla está en 6, o sea
# que no es un número al filo.
#
# Se aplica sobre la RAÍZ CUADRADA y no sobre el número crudo porque la
# distribución está pegada a cero: la mediana de todas las ventanas de MAPT es
# 0,0001 y el mejor sitio 0,863. Con el crudo, la diferencia entre 0,001 y
# 0,05, que es la que de verdad separa candidatos, desaparecía.
PESO_ACCESIBILIDAD = 6.0

# Lo que resta un CpG, que avisa pero no veta. Uno y medio: bastante para que
# entre dos sitios parecidos gane el que no lo tiene, poco para que no tape
# una diferencia grande de accesibilidad (que es justo el caso que destapó el
# problema en MAPT).
PENALIZACION_CPG = 1.5


def _escanear(cdna: str, inicio_cds: int | None = None, fin_cds: int | None = None, accesibilidad: list[float] | None = None) -> tuple[list[tuple[float, int, str, dict[str, Any]]], int]:
    """Recorre el transcrito UNA vez y devuelve lo que pasa los filtros y
    cuántas ventanas se miraron. Recorrerlo dos veces costaba veintiocho
    segundos por visita con las diecisiete dianas."""
    puntuados: list[tuple[float, int, str, dict[str, Any]]] = []
    ventanas = 0
    for i in range(len(cdna) - LARGO + 1):
        diana = cdna[i : i + LARGO]
        if "N" in diana:
            continue
        ventanas += 1
        aso = complemento_inverso(diana)
        m = evaluar(aso)
        if not m["pasa"]:
            continue
        # Motivos más región. Ni uno ni otro predicen potencia: los dos salen
        # de medir experimentos pasados, y así se dice en la pantalla.
        punto = m["motivosBuenos"] - m["motivosMalos"] + PESO_REGION.get(_region(i + 1, len(cdna), inicio_cds, fin_cds), 0.0)
        if accesibilidad is not None and i < len(accesibilidad):
            punto += PESO_ACCESIBILIDAD * (accesibilidad[i] ** 0.5)
        punto -= PENALIZACION_CPG * m["cpg"]
        puntuados.append((punto, i, aso, m))
    puntuados.sort(key=lambda x: (-x[0], x[1]))
    return puntuados, ventanas


def candidatos(
    cdna: str,
    maximo: int = 8,
    separacion: int = 60,
    inicio_cds: int | None = None,
    fin_cds: int | None = None,
    accesibilidad: list[float] | None = None,
) -> list[dict[str, Any]]:
    """Los mejores candidatos sobre un transcrito, por las reglas publicadas.

    `separacion` evita el problema que sale solo al probarlo: sin ella, los
    diez mejores son diez ventanas solapadas de la misma región rica en
    motivos, o sea un candidato disfrazado de diez. Con ella, cada uno viene de
    un sitio distinto del transcrito, que es lo que un laboratorio quiere para
    cribar.
    """
    cdna = (cdna or "").upper()
    if len(cdna) < LARGO:
        return []
    puntuados, _ = _escanear(cdna, inicio_cds, fin_cds, accesibilidad)
    return _elegir(puntuados, cdna, maximo, separacion, inicio_cds, fin_cds)


def _elegir(
    puntuados: list[tuple[float, int, str, dict[str, Any]]],
    cdna: str,
    maximo: int,
    separacion: int,
    inicio_cds: int | None,
    fin_cds: int | None,
) -> list[dict[str, Any]]:
    elegidos: list[dict[str, Any]] = []
    for punto, i, aso, m in puntuados:
        if any(abs(i - c["posicion"] + 1) < separacion for c in elegidos):
            continue
        elegidos.append({
            "secuencia": aso,
            "partes": partes(aso),
            "posicion": i + 1,  # 1 en base, como se cuenta en biología
            "hasta": i + LARGO,
            "diana": cdna[i : i + LARGO],
            "region": _region(i + 1, len(cdna), inicio_cds, fin_cds),
            "puntuacionMotivos": punto,
            **{k: v for k, v in m.items() if k != "fallos"},
            # Sin BLAST contra el transcriptoma esto NO se puede pedir, y se
            # dice en el propio candidato para que no se pierda por el camino.
            "cribado": False,
            "avisoCribado": "Sin alinear todavía contra el transcriptoma; lo hace rosa/criba.py aparte. Un oligo encaja también donde el texto es casi igual, y ahí la RNasa H1 corta igual: sin cribado el candidato no se puede pedir.",
        })
        if len(elegidos) >= maximo:
            break
    return elegidos


# La versión de las reglas de diseño. El bucle rehace el diseño de una diana
# cuando la guardada es de una versión anterior. Es un marcador explícito y no
# una heurística sobre el número de candidatos: un transcrito corto puede dar
# ocho de verdad, y adivinarlo por la cuenta lo rehacía en cada tic para
# siempre.
VERSION = 4

# Cuántos candidatos se diseñan. Sesenta y no ocho porque ese es el orden de
# magnitud de un cribado primario de verdad: el protocolo de Ionis describe
# probar unos ochenta en células para quedarse con ocho o diez, y esos ocho o
# diez son ya el RESULTADO del cribado, no la entrada. Dar ocho era entregar el
# final del embudo como si fuera el principio.
CUANTOS = 60

# Los que viajan en el muro. Los demás se piden aparte: sesenta candidatos por
# cada una de diecisiete dianas serían cuatrocientos kilobytes por visita.
EN_EL_MURO = 8


def diseño(transcrito: dict[str, Any] | None, maximo: int = CUANTOS, accesibilidad: list[float] | None = None) -> dict[str, Any] | None:
    """El diseño completo para una diana, a partir de lo que trajo el conector.

    Devuelve None cuando no hay secuencia: es «no pude comprobar», no «no se
    puede diseñar», y la pantalla lo distingue."""
    if not isinstance(transcrito, dict) or not transcrito.get("cdna"):
        return None
    cdna = str(transcrito["cdna"]).upper()
    if len(cdna) < LARGO:
        return None
    ini = transcrito.get("inicioCds")
    fin = transcrito.get("finCds")
    inicio_cds = ini if isinstance(ini, int) else None
    fin_cds = fin if isinstance(fin, int) else None
    puntuados, ventanas = _escanear(cdna, inicio_cds, fin_cds, accesibilidad)
    # La separación se adapta al transcrito: con sesenta candidatos y sesenta
    # nucleótidos entre cada uno harían falta 3.600 nt, y hay transcritos de
    # 2.300. Sin esto, en los cortos salían muchos menos de los pedidos.
    separacion = max(20, min(60, (len(cdna) // max(1, maximo)) - 1))
    cands = _elegir(puntuados, cdna, maximo, separacion, inicio_cds, fin_cds)
    return {
        "transcrito": transcrito.get("transcrito"),
        "esCanonico": bool(transcrito.get("esCanonico")),
        "transcritosDelGen": int(transcrito.get("transcritosDelGen") or 0),
        "largo": len(cdna),
        # La garantía de que la proteína que se dibuja y este ARN son la misma
        # versión del gen. `None` es «no se pudo confirmar», no «no lo son».
        "maneSelect": transcrito.get("maneSelect"),
        "mismaIsoformaQueLaProteina": transcrito.get("mismaIsoformaQueLaProteina"),
        "inicioCds": inicio_cds,
        "finCds": fin_cds,
        "build": transcrito.get("build"),
        "version": VERSION,
        "quimica": QUIMICA,
        # De qué fiarse y de qué no, en un sitio y viajando con el diseño. Lo
        # pidió Emir el 1 de octubre de 2026 después de preguntar qué tan real
        # era todo esto: «justifícalo en la interfaz para que el que lee lo
        # sepa». Ver rosa/fiabilidad.py.
        "fiabilidad": FIABILIDAD.ficha(),
        "queHace": QUE_HACE,
        "via": VIA,
        "candidatos": cands,
        "separacionUsada": separacion,
        "ventanas": ventanas,
        "pasanFiltros": len(puntuados),
        "conAccesibilidad": accesibilidad is not None,
        "cribados": sum(1 for c in cands if c["cribado"]),
    }


def como_texto(simbolo: str, d: dict[str, Any], c: dict[str, Any]) -> str:
    """Un candidato como texto plano, que es lo que se manda a un proveedor."""
    p = c["partes"]
    l = [
        f"OLIGONUCLEÓTIDO ANTISENTIDO CANDIDATO · DIANA {simbolo}",
        "",
        f"SECUENCIA (5' a 3'): {c['secuencia']}",
        f"ARQUITECTURA: {QUIMICA['arquitectura']}  ->  {p['ala5']} | {p['hueco']} | {p['ala3']}",
        f"  alas ({ALA} nt cada una): {QUIMICA['alas']}",
        f"  hueco ({HUECO} nt): {QUIMICA['hueco']}",
        f"  enlaces: {QUIMICA['enlaces']}",
        f"  citosinas: {QUIMICA['citosinas']}",
        "",
        f"VÍA DE ADMINISTRACIÓN: {VIA['via']}",
        f"  {VIA['porQue']}",
        f"  {VIA['precedente']}",
        f"  a tener en cuenta: {VIA['limite']}",
        "",
        f"TRANSCRITO: {d['transcrito']} ({d['largo']} nt, build {d['build']})",
        f"POSICIÓN EN EL TRANSCRITO: {c['posicion']} a {c['hasta']}" + (f" ({c['region']})" if c["region"] else ""),
        f"TRAMO DIANA: 5'-{c['diana']}-3'",
        "",
        f"PROPORCIÓN G+C: {c['gc'] * 100:.0f} %",
        f"DINUCLEÓTIDOS CpG: {c['cpg']}",
        f"AUTOCOMPLEMENTARIEDAD: {c['autocomplementariedad']} nt",
        f"MOTIVOS DE ACTIVIDAD: {c['motivosBuenos']} a favor, {c['motivosMalos']} en contra",
        "",
        "CRIBADO CONTRA EL TRANSCRIPTOMA: " + ("hecho" if c["cribado"] else "NO HECHO. " + c["avisoCribado"]),
        "",
        f"El gen tiene {d['transcritosDelGen']} transcritos; este diseño va sobre el canónico. Cuál se baja no es lo mismo que cuánta se baja, y esa decisión es de quien dirige el experimento.",
        "",
        "Lo generó ROSA2018 por regla a partir de la secuencia pública del transcrito. Es un CANDIDATO PARA CRIBAR EN EL LABORATORIO, no un fármaco: los filtros aplicados son estadística de experimentos pasados, no una predicción de que funcione.",
    ]
    return "\n".join(l)


__all__ = [
    "ALA",
    "GC_MAX",
    "GC_MIN",
    "HUECO",
    "LARGO",
    "MOTIVOS_BUENOS",
    "MOTIVOS_MALOS",
    "QUE_HACE",
    "QUIMICA",
    "VERSION",
    "VIA",
    "candidatos",
    "complemento_inverso",
    "como_texto",
    "diseño",
    "evaluar",
    "partes",
]
