"""La dúplex del oligo con su ARN: la geometría para dibujarla.

Qué es y qué NO es (1 de octubre de 2026). Esto da las coordenadas para
dibujar la hélice que forman el oligonucleótido y su tramo de ARN, usando los
parámetros geométricos publicados de una dúplex híbrida de ARN con ADN: el
giro por par, la subida por par y el radio del esqueleto. Esos tres números
están medidos y son los que le dan la forma.

Lo que NO se hace, y por qué: no se escriben coordenadas atómicas. Se intentó
primero generar un PDB para el visor 3D que ya tiene la pantalla, y hubo que
tirarlo: los parámetros publicados dan la FORMA de la hélice, no dónde está
cada átomo de cada base. Poner esos átomos habría sido inventarlos, y un
modelo inventado destruye la confianza en todo lo demás. Así que se dibuja lo
que se sabe (los dos esqueletos y los pares que los unen) y se dice que es un
esquema.

Para qué sirve entonces. Para ver la arquitectura, que es justo lo que no se
entiende leyendo veinte letras: dónde están las alas de 2'-MOE, dónde el hueco
de ADN, y por qué la RNasa H1 solo puede cortar en el hueco. Eso es geometría
y mecanismo, no conformación.

Por qué híbrida y no ADN ni ARN. Una dúplex de ARN con ADN no es ni de forma B
(la del ADN) ni de forma A (la del ARN): queda en medio, más cerca de la A. Y
no es un detalle: es la forma lo que la RNasa H1 reconoce. El surco menor de
la híbrida mide unos 9,5 ángstroms, frente a los ~11 del ARN puro y los ~6 del
ADN de forma B, y ahí encaja la enzima. Con los parámetros del ADN el dibujo
diría otra cosa.
"""

from __future__ import annotations

import math
from typing import Any

VERSION = 1

# Parámetros medidos de la dúplex híbrida de ARN con ADN. Están aquí con su
# nombre y no tomados prestados del ADN porque la diferencia es el mecanismo.
GIRO_POR_PAR = 32.7       # grados de giro de un par al siguiente
SUBIDA_POR_PAR = 2.62     # ángstroms que avanza la hélice por par
RADIO_ESQUELETO = 9.4     # ángstroms del esqueleto al eje
SURCO_MENOR = 9.5         # ángstroms; ARN puro ~11, ADN de forma B ~6
PARES_POR_VUELTA = 360.0 / GIRO_POR_PAR   # ~11,0

QUE_ES = {
    "ala": "2'-O-metoxietilo (2'-MOE). Sube la afinidad y protege de las nucleasas, pero la RNasa H1 NO lo reconoce.",
    "hueco": "ADN (2'-desoxi). Es lo ÚNICO que la RNasa H1 reconoce, y por eso el corte ocurre aquí y no en las alas.",
    "arn": "El ARN mensajero de la diana. Es la cadena que se corta.",
}

AVISOS = [
    {
        "que": "Es un esquema, no una estructura resuelta",
        "porQue": "Nadie ha cristalizado este oligo con este ARN. Lo que se dibuja es la hélice que forman dos cadenas complementarias de esta química, con las letras de este candidato puestas encima.",
    },
    {
        "que": "No hay coordenadas atómicas, y a propósito",
        "porQue": "Los parámetros publicados dan la forma de la hélice (giro, subida, radio), no dónde está cada átomo de cada base. Dibujar esos átomos sería inventarlos, así que se dibuja el esqueleto y los pares, que es lo que sí se sabe.",
    },
    {
        "que": "Sirve para ver la arquitectura, no para medir",
        "porQue": "Se ve dónde están las alas, dónde el hueco y por qué la RNasa H1 solo corta en el hueco. No se puede usar para distancias ni para nada que dependa de la conformación exacta.",
    },
]


def de_un_candidato(aso: str, diana: str, ala: int, hueco: int) -> dict[str, Any]:
    """Las coordenadas para dibujar la dúplex, par por par.

    Cada par lleva su posición en la hélice proyectada (la `x` avanza con la
    subida y la `y` es el seno del giro, que es lo que da el aspecto de doble
    hélice), su letra en cada cadena, de qué química es y si queda por delante
    o por detrás del eje, para poder dibujar el cruce de las dos cadenas."""
    n = len(aso)
    pares = []
    for j in range(n):
        ang = math.radians(j * GIRO_POR_PAR)
        quimica = "ala" if j < ala or j >= ala + hueco else "hueco"
        pares.append({
            "i": j + 1,
            "aso": aso[j],
            # La dúplex es antiparalela: la primera letra del oligo se empareja
            # con la última del tramo de ARN.
            "arn": diana[n - 1 - j],
            "quimica": quimica,
            # Avance a lo largo del eje, en ángstroms.
            "z": round(j * SUBIDA_POR_PAR, 3),
            # Dónde está cada esqueleto al proyectar la hélice en un plano.
            "yAso": round(math.sin(ang), 4),
            "yArn": round(math.sin(ang + math.pi), 4),
            # Por delante o por detrás, para dibujar bien el cruce.
            "delanteAso": math.cos(ang) >= 0,
        })
    return {
        "version": VERSION,
        "aso": aso,
        "diana": diana,
        "pares": pares,
        "alas": [[1, ala], [ala + hueco + 1, n]],
        "hueco": [ala + 1, ala + hueco],
        # Dónde corta la RNasa H1. No es un punto exacto: la enzima corta
        # dentro del tramo que reconoce, y eso es el hueco.
        "dondeCorta": [ala + 2, ala + hueco - 1],
        "queEs": QUE_ES,
        "avisos": AVISOS,
        "largoAngstroms": round((n - 1) * SUBIDA_POR_PAR, 1),
        "vueltas": round((n - 1) / PARES_POR_VUELTA, 2),
        "giroPorPar": GIRO_POR_PAR,
        "subidaPorPar": SUBIDA_POR_PAR,
        "surcoMenor": SURCO_MENOR,
        "porQueHibrida": (
            "Una dúplex de ARN con ADN no es ni de forma B (la del ADN) ni de forma A (la del ARN): queda en medio, "
            "más cerca de la A. Y eso no es un detalle, porque es la forma lo que la RNasa H1 reconoce: el surco menor "
            f"de la híbrida mide unos {SURCO_MENOR} ángstroms, frente a los ~11 del ARN puro y los ~6 del ADN de forma "
            "B, y ahí es donde encaja la enzima."
        ),
        "porQueSoloElHueco": (
            "La RNasa H1 necesita ver ADN de verdad en la cadena de arriba. Las alas de 2'-MOE le valen para que el "
            "oligo agarre fuerte y no lo destruyan las nucleasas, pero la enzima no las reconoce. Por eso el corte "
            f"cae en el hueco, entre las posiciones {ala + 2} y {ala + hueco - 1} del oligo, y por eso la "
            "arquitectura es 5-10-5 y no veinte letras iguales."
        ),
    }


__all__ = ["AVISOS", "GIRO_POR_PAR", "PARES_POR_VUELTA", "QUE_ES", "RADIO_ESQUELETO", "SUBIDA_POR_PAR", "SURCO_MENOR", "VERSION", "de_un_candidato"]
