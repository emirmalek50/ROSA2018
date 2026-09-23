"""Cifras con procedencia (rosa/revisor_registro.py): una cifra del resumen no
vale por existir en el registro, tiene que estar dicha de lo mismo.

El caso que motivó la regla, tomado del revisor de Claude Science: el registro
guarda el umbral de un marcador y el resumen se lo cuelga a otro. El número
existe, así que la comprobación de siempre lo daba por bueno. Trece de los
sesenta y cuatro fallos que aquel revisor encontró eran de esta clase.

Sin red ni modelos.
"""

import re

import pytest

from rosa import revisor_registro as RR
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen


def _corpus(*textos: str) -> dict:
    """Un registro mínimo: sus cifras, sus anclas y nada más."""
    anclados: dict[str, set[str]] = {}
    numeros: set[str] = set()
    for t in textos:
        RR.anclar_numeros(t, anclados)
        numeros |= RR._numeros(t)
    return {"numeros": numeros, "anclados": anclados, "ids": set(), "textos": list(textos), "recuentos": {}}


# -- El caso que motivó todo ----------------------------------------------------


def test_el_umbral_de_un_marcador_puesto_sobre_otro_es_un_hallazgo():
    corpus = _corpus("El umbral de anormalidad de GFAP en plasma se fijó en 0,027 unidades.")
    # La cifra existe en el registro. Antes pasaba; ahora se ve que es de GFAP.
    fuera = RR.cifras_fuera_de_contexto("NfL supera su umbral de 0,027 en la cohorte.", corpus)
    assert len(fuera) == 1
    assert "0.027" in fuera[0]
    assert "GFAP" in fuera[0]

    hallazgos = RR.comprobaciones_deterministas("NfL supera su umbral de 0,027 en la cohorte.", corpus, None, 0)
    clases = [x["clase"] for x in hallazgos]
    assert clases == ["cifra_fuera_de_contexto"]
    assert hallazgos[0]["gravedad"] == "alta"
    assert hallazgos[0]["origen"] == "regla"


def test_la_misma_cifra_dicha_de_lo_mismo_no_es_hallazgo():
    corpus = _corpus("El umbral de anormalidad de GFAP en plasma se fijó en 0,027 unidades.")
    assert RR.cifras_fuera_de_contexto("GFAP supera su umbral de 0,027 en la cohorte.", corpus) == []
    assert RR.comprobaciones_deterministas("GFAP supera su umbral de 0,027.", corpus, None, 0) == []


def test_una_cifra_que_no_existe_en_el_registro_sigue_siendo_la_otra_clase():
    """`cifra_fuera_de_contexto` no se come a `contradiccion_con_registro`: la
    cifra inventada no está anclada a nada, así que no entra aquí."""
    corpus = _corpus("El umbral de GFAP se fijó en 0,027 unidades.")
    hallazgos = RR.comprobaciones_deterministas("NfL supera su umbral de 0,999.", corpus, None, 0)
    assert [x["clase"] for x in hallazgos] == ["contradiccion_con_registro"]
    assert "0.999" in hallazgos[0]["detalle"]


# -- Cuándo tiene que callarse --------------------------------------------------


def test_sin_anclas_en_la_frase_no_se_dice_nada():
    """Una frase que no nombra a nadie no se puede juzgar, y callar es lo
    correcto: un falso positivo hace que se deje de mirar la lista entera."""
    corpus = _corpus("El umbral de GFAP se fijó en 0,027 unidades.")
    assert RR.cifras_fuera_de_contexto("El valor obtenido fue 0,027.", corpus) == []


def test_sin_anclas_en_el_registro_tampoco():
    corpus = _corpus("El valor de corte quedó en 0,027.")
    assert RR.cifras_fuera_de_contexto("GFAP supera su umbral de 0,027.", corpus) == []


def test_una_cifra_con_dos_duenos_en_el_registro_vale_para_los_dos():
    corpus = _corpus(
        "El umbral de GFAP en plasma se fijó en 0,027 unidades.",
        "El umbral de NfL en plasma también quedó en 0,027 unidades.",
    )
    assert RR.cifras_fuera_de_contexto("GFAP supera su umbral de 0,027.", corpus) == []
    assert RR.cifras_fuera_de_contexto("NfL supera su umbral de 0,027.", corpus) == []
    # Y una tercera entidad sí chirría.
    assert len(RR.cifras_fuera_de_contexto("El amiloide supera su umbral de 0,027.", corpus)) == 1


def test_las_siglas_de_la_propia_rosa2018_no_anclan():
    """«ROSA2018 midió 0,027» no ancla en ROSA2018: si lo hiciera, cualquier
    frase del sistema quedaría anclada a sí misma y la regla no vería nada."""
    assert RR.anclas_cerca("ROSA2018 y GRADE dan 0,027", 22, 27) == frozenset()
    assert "sig:ROSA2018" not in RR.anclas_cerca("ROSA2018 mide 0,5", 14, 17)


# -- Contabilidad frente a medida -----------------------------------------------


def test_los_recuentos_de_la_contabilidad_no_se_anclan():
    """El fallo que la prueba contra el estado real destapó: «de 35 afirmaciones,
    29 sostenidas» se anclaba al marcador que la frase nombrara de paso. Eran 16
    avisos falsos en los 40 resúmenes de verdad, todos de recuentos. Un recuento
    no tiene dueño biológico, y para eso está `recuentos_del_registro`."""
    corpus = _corpus("Sobre GFAP en plasma se sostuvieron 35 afirmaciones de seis fuentes.")
    texto = "Sobre NfL se verificaron 35 afirmaciones y entraron 18 hechos al modelo."
    assert RR.cifras_fuera_de_contexto(texto, corpus) == []
    assert [x["clase"] for x in RR.comprobaciones_deterministas(texto, corpus, None, 0)] != ["cifra_fuera_de_contexto"]


def test_un_entero_con_unidad_si_es_una_medida():
    corpus = _corpus("GFAP en plasma subió 164 pg/mL sobre el control.")
    assert RR.es_medida("subió 164 pg/mL", "164", 10) is True
    fuera = RR.cifras_fuera_de_contexto("NfL en plasma subió 164 pg/mL.", corpus)
    assert len(fuera) == 1 and "164" in fuera[0]


@pytest.mark.parametrize(
    "texto, n, fin, medida",
    [
        ("el corte es 0,027", "0.027", 17, True),   # decimal
        ("subió 164 pg/mL", "164", 9, True),        # entero con unidad
        ("cayó 12 %", "12", 7, True),               # porcentaje
        ("duró 18 meses", "18", 7, True),
        ("de 35 afirmaciones", "35", 5, False),     # contabilidad
        ("entraron 18 hechos", "18", 11, False),
        ("quedan 7 pasos", "7", 8, False),
    ],
)
def test_que_cuenta_como_medida(texto, n, fin, medida):
    assert RR.es_medida(texto, n, fin) is medida


# -- Cómo se calculan las anclas ------------------------------------------------


def test_la_ventana_no_salta_a_la_frase_de_al_lado():
    texto = "GFAP " + "x" * 200 + " el corte es 0,027."
    i = texto.index("0,027")
    assert RR.anclas_cerca(texto, i, i + 5) == frozenset()
    # Con la ventana ancha sí lo alcanza, que es lo que dice el parámetro.
    assert "HGNC:4235" in RR.anclas_cerca(texto, i, i + 5, ventana=400)


def test_las_anclas_salen_del_diccionario_curado_y_de_los_identificadores():
    anclas = RR.anclas_cerca("En GSE174367, el oligodendrocito da 0,027 en plasma.", 36, 41)
    assert "gse:GSE174367" in anclas
    assert "CL:0000128" in anclas  # oligodendrocito
    assert "UBERON:0001969" in anclas  # plasma


def test_el_registro_se_recorre_texto_a_texto_sin_mezclar_duenos():
    """Una cifra del hecho A no hereda las anclas del hecho B: por eso
    `anclar_numeros` se acumula por texto y no sobre el registro pegado."""
    anclados = {}
    RR.anclar_numeros("GFAP da 0,5.", anclados)
    RR.anclar_numeros("NfL da 0,9.", anclados)
    # Un gen del diccionario curado ancla dos veces, por su identificador y por
    # su sigla; da igual, las dos apuntan a lo mismo. Lo que importa es que la
    # cifra de una frase no se lleve el dueño de la otra.
    assert "HGNC:4235" in anclados["0.5"] and "HGNC:7739" not in anclados["0.5"]
    assert "HGNC:7739" in anclados["0.9"] and "HGNC:4235" not in anclados["0.9"]


def test_los_anos_sueltos_se_saltan_como_en_la_comprobacion_de_siempre():
    situados = RR._numeros_situados("En 2026 GFAP subió 0,027 puntos.")
    assert [n for n, _, _ in situados] == ["0.027"]
    # Y `_numeros` sigue dando lo mismo que antes de partirlo en dos.
    assert RR._numeros("En 2026 GFAP subió 0,027 puntos.") == {"0.027"}


def test_la_misma_cifra_repetida_no_se_repite_en_el_hallazgo():
    corpus = _corpus("El umbral de GFAP se fijó en 0,027.")
    fuera = RR.cifras_fuera_de_contexto("NfL pasa de 0,027 y NfL vuelve a pasar de 0,027.", corpus)
    assert len(fuera) == 1


# -- De punta a punta, con el registro de verdad ---------------------------------


def test_por_el_camino_completo_desde_el_estado():
    """`corpus_del_registro` tiene que dejar las anclas puestas, no solo las
    cifras: es lo que hace que la comprobación pueda decir de quién es cada una."""
    e = {
        "hipotesis": [{
            "id": "hip-1", "investigacionId": "inv-1",
            "titulo": "Umbral de GFAP", "enunciado": "El umbral de GFAP en plasma es 0,027", "mecanismo": "",
            "afirmaciones": [{"id": "af-1", "texto": "El umbral de anormalidad de GFAP en plasma quedó en 0,027 unidades", "veredicto": "sostenida", "fragmento": "", "cita": "", "efecto": "", "incertidumbre": "", "n": ""}],
            "procedencia": {"fuentes": [], "registro": []}, "consultas": [],
        }],
        "hechos": [], "ejecuciones": [], "reproducciones": [], "investigaciones": [{"id": "inv-1", "datasets": []}],
    }
    corpus = RR.corpus_del_registro(e, "inv-1", None, None)
    assert "0.027" in corpus["numeros"]
    assert "HGNC:4235" in corpus["anclados"]["0.027"]
    assert RR.cifras_fuera_de_contexto("GFAP supera 0,027.", corpus) == []
    assert len(RR.cifras_fuera_de_contexto("NfL supera 0,027.", corpus)) == 1


# -- Reglas de la casa -----------------------------------------------------------


def test_la_clase_nueva_esta_en_el_vocabulario_y_no_se_le_ofrece_al_juez():
    assert "cifra_fuera_de_contexto" in RR.CLASES
    assert "cifra_fuera_de_contexto" not in RR.CLASES_JUEZ
    assert len(RR.CLASES_JUEZ) == 6


def test_los_textos_del_modulo_llevan_tildes_y_no_guion_largo():
    """Solo la prosa: comentarios y docstrings. Los identificadores van sin
    tilde por regla, y `numero = it.get("numero")` no es una falta."""
    import io
    import tokenize
    from pathlib import Path

    ruta = Path(RR.__file__)
    fuente = ruta.read_text(encoding="utf-8")
    assert "—" not in fuente, "guion largo en revisor_registro.py"

    prosa = []
    for tok in tokenize.generate_tokens(io.StringIO(fuente).readline):
        if tok.type == tokenize.COMMENT:
            prosa.append(tok.string)
        elif tok.type == tokenize.STRING and tok.line.strip().startswith(('"""', "'''")):
            prosa.append(tok.string)
    texto = "\n".join(prosa)
    assert texto, "no se leyó ningún comentario ni docstring"
    for palabra in ("numero", "numeros", "tambien", "segun", "esta cifra", "aqui", "asi que", "mas repetido"):
        assert not re.search(rf"\b{palabra}\b", texto, re.I), f"«{palabra}» sin tilde en la prosa del módulo"
