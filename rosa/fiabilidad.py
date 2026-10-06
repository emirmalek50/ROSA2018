"""De qué se puede uno fiar en el diseño de oligos, y de qué no.

Por qué existe este módulo (1 de octubre de 2026). Emir preguntó lo único que
de verdad importa: «¿qué tan real es la simulación? ¿todo lo que dice es
verdad? ¿literalmente se coge ese mismo ASO y se manda al laboratorio?». La
respuesta tiene partes muy distintas, y hasta hoy esas partes estaban
repartidas por los docstrings del código, donde no las lee quien usa ROSA2018.
Su encargo fue explícito: «todo lo que me dijiste tienes que justificarlo en la
interfaz de rosa para que el que lee lo sepa».

Así que aquí está, en un sitio, y viaja a la pantalla y al texto que se copia
para el proveedor.

La idea es separar cuatro cosas que en una pantalla se confunden con facilidad
y que tienen grados de verdad muy distintos:

1. Lo EXACTO: aritmética sobre secuencias reales. Comprobable por cualquiera.
2. Lo MODELADO: algoritmos publicados y estándar, pero que predicen.
3. La ESTADÍSTICA: correlaciones de experimentos pasados de OTROS oligos.
4. Lo MÍO: los pesos con los que ROSA2018 combina lo anterior. Es el eslabón
   más flojo y es el que más fácil sería callar.

Y una quinta, que es la que evita el malentendido grande: qué ES esto. No es un
fármaco ni un candidato a fármaco. Es la entrada de un cribado primario.
"""

from __future__ import annotations

from typing import Any

VERSION = 2

NIVELES: list[dict[str, Any]] = [
    {
        "nivel": "exacto",
        "titulo": "Exacto: se puede comprobar",
        "resumen": "Aritmética sobre secuencias reales. No hay modelo ni estimación; cualquiera puede repetirlo y le tiene que dar lo mismo.",
        "cosas": [
            {
                "que": "La secuencia del oligo",
                "porQue": "El tramo de veinte letras está LITERALMENTE en el ARN del gen tal como lo publica Ensembl, y el oligo es su complemento inverso, que es una operación exacta. Si se manda esa cadena a un proveedor, fabrica esa molécula y esa molécula se pega a ese ARN.",
            },
            {
                "que": "La química del pedido",
                "porQue": "El gapmer 5-10-5 de 2'-MOE con enlaces fosforotioato y 5-metilcitosina no es una propuesta de ROSA2018: es la arquitectura de los tres gapmers aprobados, y es lo que se escribe en una hoja de pedido.",
            },
            {
                "que": "Los filtros de la secuencia",
                "porQue": "La proporción de G y C, los dinucleótidos CpG, los tramos GGGG, la autocomplementariedad y las rachas son cuentas sobre las letras. No predicen nada; describen.",
            },
            {
                "que": "El cribado de fuera de diana",
                "porQue": "Cuando dice que el oligo encaja en otro gen, ese gen contiene de verdad ese tramo de veinte letras en el transcriptoma de Ensembl. Es un hecho, y se puede repetir.",
            },
            {
                "que": "Si sirve en ratón",
                "porQue": "Lo mismo, contra el transcriptoma del ratón: o el tramo encaja en el ARN del gen equivalente o no encaja. Lo único heurístico ahí es encontrar el gen equivalente por su nombre.",
            },
        ],
    },
    {
        "nivel": "modelo",
        "titulo": "Modelo: algoritmo real, pero predicción",
        "resumen": "Herramientas estándar del campo, publicadas y usadas por todo el mundo. Siguen siendo predicciones, y una predicción no es una medición.",
        "cosas": [
            {
                "que": "Si el sitio está abierto o tapado",
                "porQue": "Se calcula con RNAplfold (modelo de Turner, ViennaRNA), que estima la accesibilidad local del ARN. Es un cálculo computacional, no un experimento en un tubo. El modelo no incluye las proteínas que se unen al ARN en la célula y pueden cambiar su accesibilidad. Esta predicción no mide la potencia del oligo ni valida su actividad en células.",
            },
            {
                "que": "El dibujo del ARN plegado",
                "porQue": "Es una estructura predicha, no una foto. Nadie ha visto ese ARN plegado así. La disposición de las letras es la clásica del campo (naview), pero lo que se dibuja es el resultado de un modelo.",
            },
            {
                "que": "La dúplex con el oligo",
                "porQue": "Es un esquema. El emparejamiento sí es exacto, y los números de la hélice están medidos para dúplex híbridas de ARN con ADN, pero nadie ha resuelto la estructura de ESTE oligo con ESTE ARN. Por eso no se dibujan átomos.",
            },
        ],
    },
    {
        "nivel": "estadistica",
        "titulo": "Estadística: de experimentos de otros oligos",
        "resumen": "Correlaciones sacadas de mirar hacia atrás. Dicen qué ha funcionado en promedio, no qué va a hacer este.",
        "cosas": [
            {
                "que": "Los motivos de actividad",
                "porQue": "Tramos como CCAC o TCCC aparecen más en los oligos que funcionaron, y otros como GGGG en los que no. Sale de analizar muchos experimentos antisentido pasados; no es una propiedad de este oligo.",
            },
            {
                "que": "El peso de la región",
                "porQue": "Que la región 3' no traducida dé de media más bajada que un intrón también es estadística de experimentos pasados. En un gen concreto puede no cumplirse.",
            },
        ],
    },
    {
        "nivel": "mio",
        "titulo": "Esto lo decidió ROSA2018, y nadie lo ha validado",
        "resumen": "El eslabón más flojo de toda la pantalla, y el que más fácil sería callar.",
        "cosas": [
            {
                "que": "Los pesos que combinan todo lo anterior",
                "porQue": "Que la accesibilidad valga 6 puntos y un CpG reste 1,5 lo decidió ROSA2018. Hay un razonamiento escrito detrás (igualar el rango de los motivos, y un barrido donde la mejora se aplana en 6), pero NADIE ha comprobado que esa combinación prediga potencia.",
            },
            {
                "que": "Qué significa en claro",
                "porQue": "El CONJUNTO de candidatos es defendible: todos pasan filtros publicados y el cribado. El ORDEN entre ellos es lo menos fiable de la pantalla. Que el número uno sea mejor que el número catorce es una apuesta de ROSA2018, no un resultado.",
            },
            {
                "que": "Y la elección de la diana",
                "porQue": "La puntuación con la que ROSA2018 elige a qué proteína ir también es suya. Cada término se enseña para poder discutirlo, que es justo porque no está validado.",
            },
        ],
    },
]

NO_COMPROBADO: list[dict[str, str]] = [
    {
        "que": "El borrador largo del ARN, con sus intrones",
        "porQue": "El cribado mira el ARN mensajero ya empalmado. La degradación fuera de diana de transcritos largos de pre-ARN mensajero, dependiente de la RNasa H1, se estudió como mecanismo de toxicidad hepática de algunos gapmers de alta afinidad en ratones (Burel et al., Nucleic Acids Res 44:2093, 2016). Ese riesgo NO se está evaluando aquí. Requiere el genoma con su anotación, no solo el transcriptoma de ARN empalmado.",
    },
    {
        "que": "Las variantes de cada persona",
        "porQue": "Se compara contra una secuencia de referencia. Una variante común en el sitio diana haría que el oligo no pegara en parte de la población, y eso no se comprueba.",
    },
    {
        "que": "Que el orden sea el bueno",
        "porQue": "Nadie ha probado estos oligos en células. El orden sale de reglas, y las reglas se equivocan: por eso un cribado primario de verdad prueba decenas y no uno.",
    },
    {
        "que": "Los efectos adversos de la química",
        "porQue": "Hígado, riñón, inflamación y plaquetas son efectos conocidos de los gapmers fosforotioato. Se miden en el laboratorio; no se predicen desde la secuencia, y aquí no hay nada sobre eso.",
    },
]

QUE_ES_ESTO: dict[str, str] = {
    "es": (
        "La entrada de un cribado primario: la lista que un laboratorio sintetiza para probar en células."
    ),
    "noEs": (
        "No es un fármaco ni un candidato a fármaco, y el número uno no es «el bueno»."
    ),
    "comoSeUsa": (
        "Una campaña de verdad sintetiza del orden de ochenta oligos, los prueba en células, se queda con ocho o "
        "diez y de ahí salen uno o dos líderes. Lo que hay aquí es el principio de ese embudo, no el final."
    ),
    "yLaPremisa": (
        "Y por encima de todo esto: que bajar esta proteína ayude en el Alzheimer es una HIPÓTESIS, con la certeza "
        "que diga su ficha GRADE. Un oligo bien diseñado contra una diana equivocada sigue siendo un oligo contra "
        "una diana equivocada."
    ),
}


def ficha() -> dict[str, Any]:
    """Todo junto, para la pantalla y para el texto del pedido."""
    return {
        "version": VERSION,
        "niveles": NIVELES,
        "noComprobado": NO_COMPROBADO,
        "queEsEsto": QUE_ES_ESTO,
    }


def como_texto() -> str:
    """Lo mismo en texto plano: viaja con el pedido, porque quien lo reciba
    tiene que saber qué le están mandando."""
    lineas = ["DE QUÉ FIARSE Y DE QUÉ NO", ""]
    for n in NIVELES:
        lineas.append(f"{n['titulo'].upper()}")
        lineas.append(f"  {n['resumen']}")
        for c in n["cosas"]:
            lineas.append(f"  - {c['que']}: {c['porQue']}")
        lineas.append("")
    lineas.append("LO QUE NO SE HA COMPROBADO")
    for c in NO_COMPROBADO:
        lineas.append(f"  - {c['que']}: {c['porQue']}")
    lineas += [
        "",
        "QUÉ ES ESTO",
        f"  {QUE_ES_ESTO['es']}",
        f"  {QUE_ES_ESTO['noEs']}",
        f"  {QUE_ES_ESTO['comoSeUsa']}",
        f"  {QUE_ES_ESTO['yLaPremisa']}",
    ]
    return "\n".join(lineas)


__all__ = ["NIVELES", "NO_COMPROBADO", "QUE_ES_ESTO", "VERSION", "como_texto", "ficha"]
