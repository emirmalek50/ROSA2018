"""Accesibilidad del sitio: si el ARN está abierto ahí o plegado sobre sí mismo.

Por qué hace falta (30 de septiembre de 2026). Un ARN mensajero no es una
cinta estirada: se dobla sobre sí mismo y forma horquillas, como un cable en
el bolsillo. Un oligonucleótido antisentido tiene que abrirse paso hasta su
tramo, y si ese tramo está emparejado dentro de una horquilla no entra, por
buenas que sean sus veinte letras.

ROSA2018 no lo miraba, y la primera medición fue incómoda: de los sesenta
candidatos de MAPT solo DOS tenían accesibilidad por encima de 0,1, el
candidato número uno (el que ROSA2018 mandaría) estaba en 0,013, y el mejor
sitio del transcrito entero (posición 4585, accesibilidad 0,863) no estaba en
la lista. El más accesible de los sesenta era el número sesenta, el último. El
orden iba casi al revés de lo que importa.

Cómo se calcula. Con RNAplfold del paquete ViennaRNA: el modelo de vecino más
próximo de Turner y Mathews sobre una ventana deslizante, que da la
probabilidad de que un tramo de `u` letras esté ENTERO sin emparejar. No es
una estimación de ROSA2018: es el algoritmo estándar del campo, publicado y
con sus parámetros medidos en laboratorio. Cuesta 0,7 s por transcrito de
siete mil letras, así que se calcula en el bucle y se guarda.

Tres avisos que la pantalla tiene que dar, porque esto es un MODELO:

1. **La correlación con la potencia real es buena pero no perfecta.** Un sitio
   accesible funciona más a menudo, no siempre. Por eso aquí es un término
   más y nunca una puerta: un candidato con accesibilidad baja se enseña
   marcado, no se tira.
2. **En la célula el ARN va vestido de proteínas.** El modelo dobla una
   cadena desnuda en un tubo. Las proteínas que se pegan al ARN abren unos
   sitios y cierran otros, y eso no se está calculando.
3. **La ventana es local.** RNAplfold mira emparejamientos dentro de un tramo
   de `VENTANA` letras, no los de punta a punta del transcrito. Es lo
   habitual (plegar seis mil letras enteras es lento y además poco realista:
   el ARN se pliega mientras se fabrica), pero es una aproximación.
"""

from __future__ import annotations

from typing import Any

VERSION = 1

# El tramo cuya accesibilidad se mide: el del oligo.
LARGO = 20

# Ventana de plegado local y distancia máxima entre dos letras emparejadas.
# Los valores de uso común con RNAplfold para accesibilidad. Con 150/100 el
# cálculo pasa de 0,7 s a 3,2 s por transcrito y el orden de los candidatos
# apenas cambia, así que se queda en el barato.
VENTANA = 80
ALCANCE = 40

# Dónde se corta «abierto» y «tapado». No es un umbral de la naturaleza: es
# una etiqueta para leer la pantalla, y por eso el número crudo va siempre al
# lado. Sale de mirar la distribución real: en MAPT la mediana de todas las
# ventanas es 0,0001 y el mejor sitio 0,863, así que 0,1 ya separa el uno por
# ciento bueno del resto.
ABIERTO = 0.10
MEDIO = 0.01

AVISOS = [
    {
        "que": "Es un modelo, no una medida",
        "porQue": "Un sitio accesible funciona más a menudo, no siempre. Aquí es un término más y nunca una puerta: un candidato poco accesible se enseña marcado, no se tira.",
    },
    {
        "que": "En la célula el ARN va vestido de proteínas",
        "porQue": "El modelo dobla una cadena desnuda en un tubo. Las proteínas que se pegan al ARN abren unos sitios y cierran otros, y eso no se calcula aquí.",
    },
    {
        "que": "El plegado es local",
        "porQue": f"Se miran emparejamientos dentro de una ventana de {VENTANA} letras, no de punta a punta del transcrito. Es lo habitual, porque el ARN se pliega mientras se fabrica, pero es una aproximación.",
    },
]


def hay_viennarna() -> bool:
    try:
        import RNA  # noqa: F401
    except ImportError:
        return False
    return True


def etiqueta(a: float) -> str:
    if a >= ABIERTO:
        return "abierto"
    if a >= MEDIO:
        return "medio"
    return "tapado"


def _coma(x: float, d: int = 1) -> str:
    """Un número con coma decimal, que es como se escribe en castellano."""
    return f"{x:.{d}f}".replace(".", ",")


def como_se_lee(a: float) -> str:
    """Qué significa el número, en una frase."""
    if a >= ABIERTO:
        return f"El tramo está abierto: {_coma(a * 100)} de cada 100 veces las veinte letras están libres a la vez, que en un ARN plegado es mucho. El oligo puede llegar."
    if a >= MEDIO:
        return f"El tramo está a medias: libre entero {_coma(a * 100)} de cada 100 veces. Ni descartable ni cómodo."
    return f"El tramo está tapado: libre entero {_coma(a * 100, 2)} de cada 100 veces. Está emparejado dentro de una horquilla casi siempre, y el oligo tiene que abrirla para entrar."


def perfil(cdna: str) -> list[float] | None:
    """La accesibilidad de CADA posición del transcrito, de una vez.

    Devuelve una lista donde el índice `i` es la probabilidad de que el tramo
    que empieza en la posición `i + 1` (uno en base uno, como las posiciones
    del diseño) esté entero sin emparejar. `None` si no hay ViennaRNA: eso es
    «no pude comprobar», no «está tapado»."""
    if not cdna or len(cdna) < LARGO:
        return None
    try:
        import RNA
    except ImportError:
        return None
    arn = cdna.upper().replace("T", "U")
    # pfl_fold_up devuelve una matriz [posicion][largo]; se pide el largo del
    # oligo, que es «estas veinte letras, todas libres a la vez».
    up = RNA.pfl_fold_up(arn, LARGO, VENTANA, ALCANCE)
    return [float(up[i][LARGO]) for i in range(1, len(arn) - LARGO + 2)]


def de_un_sitio(perf: list[float] | None, posicion: int) -> dict[str, Any] | None:
    """Lo que se enseña de un candidato. `posicion` es en base uno."""
    if not perf or not (1 <= posicion <= len(perf)):
        return None
    a = perf[posicion - 1]
    orden = sorted(perf, reverse=True)
    # En qué percentil cae dentro de su propio transcrito. Importa más que el
    # número absoluto: 0,05 es malo en un ARN suelto y bueno en uno muy
    # plegado, y lo que se elige es entre sitios del MISMO transcrito.
    mejores = sum(1 for x in orden if x > a)
    return {
        "accesibilidad": round(a, 5),
        "etiqueta": etiqueta(a),
        "comoSeLee": como_se_lee(a),
        "percentil": round(100 * (1 - mejores / max(1, len(perf))), 1),
        "mejorDelTranscrito": round(max(perf), 4),
        "posicionMejor": perf.index(max(perf)) + 1,
        "medianaDelTranscrito": round(sorted(perf)[len(perf) // 2], 5),
        "ventana": VENTANA,
        "alcance": ALCANCE,
        "version": VERSION,
    }


def dibujo(cdna: str, desde: int, hasta: int) -> dict[str, Any] | None:
    """El plegado de un trozo del ARN alrededor del sitio, para dibujarlo.

    Se devuelve la estructura en notación de paréntesis (cada letra es `.` si
    está libre y `(` o `)` si está emparejada con otra), que es lo que la
    pantalla necesita para pintar la horquilla y marcar dónde cae el oligo."""
    if not cdna:
        return None
    try:
        import RNA
    except ImportError:
        return None
    a = max(1, desde)
    b = min(len(cdna), hasta)
    trozo = cdna[a - 1 : b].upper().replace("T", "U")
    if len(trozo) < 6:
        return None
    est, energia = RNA.fold(trozo)
    return {
        "desde": a,
        "hasta": b,
        "secuencia": trozo,
        "estructura": est,
        "energia": round(float(energia), 2),
        # Cada par, para que la pantalla pueda dibujar los arcos sin tener que
        # interpretar los paréntesis.
        "pares": _pares(est),
    }


def _pares(estructura: str) -> list[list[int]]:
    """De los paréntesis a la lista de pares (en base uno, dentro del trozo)."""
    pila: list[int] = []
    pares: list[list[int]] = []
    for i, c in enumerate(estructura, 1):
        if c == "(":
            pila.append(i)
        elif c == ")" and pila:
            pares.append([pila.pop(), i])
    return sorted(pares)


__all__ = ["ABIERTO", "ALCANCE", "AVISOS", "LARGO", "MEDIO", "VENTANA", "VERSION", "como_se_lee", "de_un_sitio", "dibujo", "etiqueta", "hay_viennarna", "perfil"]
