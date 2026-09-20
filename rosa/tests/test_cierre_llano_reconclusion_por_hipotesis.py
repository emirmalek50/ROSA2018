"""Segunda pasada del arreglo del desfase entre el llano y las conclusiones
rehechas (rosa/bucle/cierre_texto.py), tras el informe del adversario del 19 de
septiembre de 2026: el aviso «Ojo: ...» se decide por hipótesis y no por nivel
global, los verbos de "mantenerse" van cerrados a formas conjugadas y admiten
el plural, el recorte del motivo no deja paréntesis sin cerrar, y una bajada
del juez por debajo del techo se explica con el motivo del juez.

Los títulos y los textos son los del estado real de la corrida 13
(investigación inv-mu2sz2ns-3, iteraciones 2 y 3): nueve hipótesis, de las que
solo «La normalización de P-tau181...» subió de muy baja a baja. Ninguno de
estos tests sale al gateway; los de punta a punta corren con el supervisor de
dobles de `test_integracion_corrida`.
"""

from __future__ import annotations

import copy
from typing import Any

from rosa.bucle import cierre_texto as CT
from rosa.tests.test_bucle_iteracion import palabras_sin_tilde
from rosa.tests.test_cierre_llano_reconclusion import _cambio, _cerrar, _conclusion_previa, _hip, _it, _llano, _parrafo_de
from rosa.tests.test_integracion_corrida import _preparar
from rosa.tests.test_llano_adversario_19sep import CAMBIO_CONCORDANCIA, CAMBIO_NORMALIZACION, CAMBIO_VASCULAR, LIMITACIONES_REAL, MOTIVO_TECHO_REAL, TITULO_SUBIO
from rosa.tests.test_tanda1_corrida import _respuestas_cierre

# Los nueve títulos reales de la corrida 13 y la versión breve de dos de ellos.
TITULOS_CORRIDA_13: dict[str, str] = {
    "acoplamiento": "El acoplamiento de la respuesta de GFAP o P-tau181 con NfL distingue una respuesta biológica de una clínicamente informativa",
    "severidad": "La severidad basal indicada por NfL modifica el valor clínico de una reducción de P-tau181",
    "gfap_amiloide": "La reducción de GFAP ligada a eliminación de Aβ cerebral distingue una respuesta informativa de una modulación glial aislada",
    "normalizacion": TITULO_SUBIO,
    "concordancia": "La concordancia plasma–LCR de P-tau181 distingue una respuesta central de una reducción plasmática aislada",
    "persistencia": "La persistencia de la reducción de P-tau181, frente a su rebote, distingue una respuesta clínicamente informativa",
    "vascular": "La carga vascular cerebral basal limita el valor clínico de una reducción de P-tau181",
    "selectiva": "La reducción selectiva de P-tau181 respecto a T-tau predice mejor el beneficio que la reducción aislada de P-tau181",
    "tau_pet": "Valor predictivo incremental de la interacción tau basal–reducción amiloide acumulada en contrastes aleatorizados",
}
BREVE_NORMALIZACION = "Alcanzar bajo tratamiento un nivel plasmático de P-tau181 dentro del intervalo de referencia amiloide-negativo predice el beneficio clínico mejor que la reducción porcentual del marcador"
# El tercer elemento real de `cambios` de la iteración 3: habla de la hipótesis
# de la reducción selectiva, pero comparte tres palabras (p-tau181, predice,
# beneficio) con el título de la que subió.
CAMBIO_SELECTIVA = "La hipótesis de que reducir P-tau181 respecto a tau total predice mejor el beneficio pasó de evidencia en contra a apoyo, sin superar una certeza muy baja. No se detalló el motivo concreto del cambio."


def _hipotesis_corrida_13(certeza_normalizacion: str = "baja") -> dict[str, dict[str, Any]]:
    """La instantánea de después con las nueve hipótesis: todas en muy baja
    salvo la normalización."""
    salida = {}
    for hid, titulo in TITULOS_CORRIDA_13.items():
        salida[hid] = {"titulo": titulo, "breve": BREVE_NORMALIZACION if hid == "normalizacion" else "", "estado": "propuesta", "certeza": certeza_normalizacion if hid == "normalizacion" else "muy_baja", "direccion": "apoya", "techo": "baja", "motivoTecho": MOTIVO_TECHO_REAL, "motivoCambio": "", "recalculadaEn": None}
    return salida


def _subida_normalizacion() -> list[dict[str, Any]]:
    return [_cambio("subio", id="normalizacion", titulo=TITULO_SUBIO, breve=BREVE_NORMALIZACION, motivo=MOTIVO_TECHO_REAL)]


# ---------------------------------------------------------------------------
# El aviso va por hipótesis
# ---------------------------------------------------------------------------


def test_sobre_el_llano_real_de_la_iteracion_3_solo_limitaciones_recibe_el_aviso():
    cambios, hipotesis = _subida_normalizacion(), _hipotesis_corrida_13()
    llano = {"limitaciones": LIMITACIONES_REAL, "cambios": [CAMBIO_CONCORDANCIA, CAMBIO_VASCULAR, CAMBIO_SELECTIVA], "mensajesClave": [], "queFalta": "f"}
    CT.llano_con_cambios(llano, CT.parrafo_de_cambios(cambios), cambios, hipotesis=hipotesis)
    assert llano["limitaciones"].startswith(CT.AVISO_DESFASE)
    assert llano["cambios"][:3] == [CAMBIO_CONCORDANCIA, CAMBIO_VASCULAR, CAMBIO_SELECTIVA], "las tres hablan de hipótesis que siguen en muy baja"
    assert llano["cambios"][3].startswith("En este cierre cambió la certeza de 1 hipótesis: «La normalización")


def test_la_frase_sobre_la_que_subio_queda_desfasada_con_y_sin_el_conjunto_completo():
    cambios = _subida_normalizacion()
    assert CT.frase_desfasada(CAMBIO_NORMALIZACION, cambios)
    assert CT.frase_desfasada(CAMBIO_NORMALIZACION, cambios, hipotesis=_hipotesis_corrida_13())
    # Si lo que afirma es el nivel nuevo, no está desfasada.
    assert not CT.frase_desfasada("La normalización de p-tau181 pasó a un balance favorable, con certeza baja.", cambios)


def test_una_palabra_unica_del_titulo_basta_para_nombrar_con_el_conjunto_completo():
    # "concordancia" solo está en un título: con el conjunto completo el texto
    # habla de esa hipótesis (que no cambió) y "la certeza sigue siendo muy baja"
    # es verdad. Sin el conjunto no se sabe de quién habla y va por todas.
    texto = "La concordancia pasó a recibir apoyo. La certeza sigue siendo muy baja."
    cambios = _subida_normalizacion()
    assert not CT.frase_desfasada(texto, cambios, hipotesis=_hipotesis_corrida_13())
    assert CT.frase_desfasada(texto, cambios), "sin el conjunto, 'la certeza' sin sujeto habla de todas"
    # Y la palabra única de la que subió la nombra aunque no haya dos en común.
    assert CT.frase_desfasada("La normalización pasó a recibir apoyo, con certeza muy baja.", cambios, hipotesis=_hipotesis_corrida_13())
    assert not CT.frase_desfasada("La normalización pasó a recibir apoyo, con certeza muy baja.", cambios), "sin el conjunto hace falta el solape de dos palabras"


def test_el_texto_habla_de_la_hipotesis_con_mas_solape_no_de_la_que_comparte_tres_palabras():
    # El texto sobre la reducción selectiva comparte tres palabras con la que
    # subió (p-tau181, predice, beneficio) y cuatro con la selectiva: habla de la
    # selectiva, así que un "con certeza muy baja" sobre ella no está desfasado.
    cambios, hipotesis = _subida_normalizacion(), _hipotesis_corrida_13()
    texto = "Reducir P-tau181 respecto a tau total predice mejor el beneficio: pasó a apoyo, con certeza muy baja."
    assert not CT.frase_desfasada(texto, cambios, hipotesis=hipotesis)
    assert CT.frase_desfasada(texto, cambios), "sin el conjunto completo no hay con qué desempatar: cuenta el solape de tres"


def test_un_empate_en_palabras_se_desempata_por_la_rareza_de_cada_palabra():
    # Texto real de otra iteración de la corrida 13 sobre la reducción selectiva:
    # comparte cuatro palabras con el título de la normalización (p-tau181,
    # predice, beneficio, clínico) y cuatro con el de la selectiva (p-tau181,
    # predice, mejor, beneficio). "mejor" solo está en la selectiva y "clínico"
    # en tres títulos: pesa más la selectiva, que no cambió.
    cambios, hipotesis = _subida_normalizacion(), _hipotesis_corrida_13()
    texto = "La hipótesis de que reducir p-tau181 respecto a tau total predice mejor el beneficio pasó de «sin evidencia directa» a apoyo. Sigue con certeza muy baja: los nuevos datos describen variaciones de los marcadores, pero no beneficio clínico."
    assert not CT.frase_desfasada(texto, cambios, hipotesis=hipotesis)
    cambiadas, otra = CT._quien_habla(CT._normalizar(texto), cambios, hipotesis)
    assert cambiadas == [] and otra is True
    # El mismo texto sobre la normalización, con sus palabras raras, sí la nombra.
    texto = "La hipótesis de que normalizar p-tau181, y no su reducción porcentual, predice el beneficio pasó a apoyo. Sigue con certeza muy baja."
    assert CT.frase_desfasada(texto, cambios, hipotesis=hipotesis)


def test_la_certeza_sin_sujeto_va_por_la_hipotesis_nombrada_o_por_todas():
    cambios = _subida_normalizacion()
    # Nombra a una que no cambió (marca "la hipótesis de que"): sigue siendo verdad.
    assert not CT.frase_desfasada(CAMBIO_VASCULAR, cambios)
    # Nombra a la que subió: desfasada.
    assert CT.frase_desfasada("La normalización de P-tau181 pasó a recibir apoyo. La certeza sigue siendo muy baja.", cambios)
    # No nombra a nadie: habla de todas.
    assert CT.frase_desfasada("La certeza sigue siendo muy baja.", cambios)
    assert CT.frase_desfasada("La certeza se mantuvo muy baja en esta iteración.", cambios)
    # Nombra a una concreta pero la frase dice "en todas": habla de todas.
    assert CT.frase_desfasada("La hipótesis de que el daño vascular limita el valor pasó a apoyo. En todas, la certeza sigue siendo muy baja.", cambios)
    assert CT.frase_desfasada("La hipótesis vascular pasó a apoyo; en las tres la certeza sigue siendo muy baja.", cambios)


def test_verbo_en_plural_habla_de_varias_y_en_singular_de_la_nombrada():
    cambios = _subida_normalizacion()
    assert CT.frase_desfasada("Mantienen una certeza muy baja.", cambios)
    assert CT.frase_desfasada("Siguen con certeza muy baja tras esta iteración.", cambios)
    assert CT.frase_desfasada("Permanecieron con certezas muy bajas.", cambios)
    # Singular sobre una concreta que no cambió: verdad. Sobre la que subió: desfasada.
    assert not CT.frase_desfasada("La hipótesis de la concordancia mantiene una certeza muy baja.", cambios)
    assert CT.frase_desfasada("La normalización de P-tau181 mantiene una certeza muy baja.", cambios)
    # Singular sin nadie nombrado: habla de todas.
    assert CT.frase_desfasada("Mantiene una certeza muy baja.", cambios)


def test_los_verbos_van_cerrados_y_el_plural_del_nivel_se_reconoce():
    cambios = _subida_normalizacion()
    for texto in (
        "En la siguiente revisión, la certeza muy baja de la hipótesis vascular debería subir con datos reales.",
        "A continuación, la certeza muy baja de las demás se explica por la falta de réplica.",
        "Un juicio conservador deja la certeza muy baja como punto de partida.",
        "Quedar con certeza muy baja es lo esperable sin datos reales.",
        "Continuó la búsqueda de una certeza mayor.",
    ):
        assert not CT.frase_desfasada(texto, cambios), texto
    for texto in (
        "Todas las hipótesis conservan certezas muy bajas.",
        "Las nueve hipótesis siguen con certezas muy bajas.",
        "Ninguna hipótesis supera certezas muy bajas.",
        "Las hipótesis mantuvieron una certeza muy baja.",
    ):
        assert CT.frase_desfasada(texto, cambios), texto
    # "certezas bajas" con la que subió a baja: es el nivel nuevo, no está desfasada.
    assert not CT.frase_desfasada("Todas las hipótesis conservan certezas bajas.", cambios)


def test_un_cambio_de_direccion_o_una_lista_sin_cambios_de_nivel_no_avisan():
    giro = [_cambio("direccion", "muy_baja", "muy_baja", direccionDespues="mixta")]
    assert not CT.frase_desfasada(LIMITACIONES_REAL, giro)
    assert not CT.frase_desfasada(CAMBIO_NORMALIZACION, giro, hipotesis=_hipotesis_corrida_13("muy_baja"))
    assert not CT.frase_desfasada(LIMITACIONES_REAL, [], hipotesis=_hipotesis_corrida_13())
    # Registros raros en `hipotesis`: no rompen ni cambian la decisión por solape.
    assert CT.frase_desfasada(CAMBIO_NORMALIZACION, _subida_normalizacion(), hipotesis="basura")
    assert CT.frase_desfasada(CAMBIO_NORMALIZACION, _subida_normalizacion(), hipotesis={"x": None, 3: {"titulo": "y"}})


def test_llano_con_cambios_es_idempotente_con_el_conjunto_completo():
    cambios, hipotesis = _subida_normalizacion(), _hipotesis_corrida_13()
    parrafo = CT.parrafo_de_cambios(cambios)
    llano = {"limitaciones": LIMITACIONES_REAL, "cambios": [CAMBIO_NORMALIZACION, CAMBIO_CONCORDANCIA], "mensajesClave": ["GFAP sube antes."]}
    CT.llano_con_cambios(llano, parrafo, cambios, hipotesis=hipotesis)
    copia = copy.deepcopy(llano)
    CT.llano_con_cambios(llano, parrafo, cambios, hipotesis=hipotesis)
    assert llano == copia
    assert llano["cambios"][0].startswith(CT.AVISO_DESFASE) and llano["cambios"][1] == CAMBIO_CONCORDANCIA and llano["cambios"][2] == parrafo
    assert llano["mensajesClave"] == ["GFAP sube antes."]


# ---------------------------------------------------------------------------
# El párrafo: paréntesis, motivo del juez, techo que sube
# ---------------------------------------------------------------------------


def test_el_recorte_del_motivo_no_deja_parentesis_abiertos():
    parrafo = CT.parrafo_de_cambios(_subida_normalizacion())
    assert parrafo.count("(") == parrafo.count(")")
    assert "aunque de 9 cohortes distintas...)" in parrafo, parrafo
    # Un motivo con el paréntesis desde el principio no puede cortarse antes: se cierra.
    largo = "(" + "palabra " * 40 + ")"
    r = CT._recortar(largo, 60)
    assert r.count("(") == r.count(")") and r.endswith("...)"), r
    # Dos niveles de paréntesis abiertos: se corta antes del primero sin pareja.
    r = CT._recortar("motivo largo de la regla (una fuente (sin cohorte) que no cuenta, y otra más que tampoco cuenta", 70)
    assert r == "motivo largo de la regla...", r
    # Uno cerrado y otro abierto: se corta antes del abierto y se conserva el cerrado.
    r = CT._recortar("a favor (2) y en contra (1 fuente sin cohorte identificada, que no cuentan como independientes)", 60)
    assert r == "a favor (2) y en contra...", r
    # Sin paréntesis, como antes; el texto corto se queda tal cual.
    assert CT._recortar("uno, dos, tres, cuatro, cinco", 12) == "uno, dos..." and CT._recortar("corto", 12) == "corto"


def test_una_bajada_del_juez_por_debajo_del_techo_lleva_su_motivo_y_no_el_del_techo():
    antes = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"}}
    despues = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya", "techo": "baja", "motivoTecho": "solo literatura, sin experimento ni análisis sobre datos reales, aunque de 2 cohortes distintas", "motivoCambio": "Una afirmación en contra sostenida en una segunda cohorte contradice el orden"}}
    [c] = CT.cambios_de_certeza(antes, despues)
    assert c["explicacion"] == "juez" and c["porRegla"] is False and c["motivo"].startswith("Una afirmación en contra")
    parrafo = CT.parrafo_de_cambios([c])
    assert parrafo == "En este cierre cambió la certeza de 1 hipótesis: «GFAP sube antes que NfL» bajó de baja a muy baja (motivo del juez: una afirmación en contra sostenida en una segunda cohorte contradice el orden; techo por regla: baja). Ninguna subió."
    # Sin motivo del juez guardado, no se pone el del techo en su lugar.
    despues["h"]["motivoCambio"] = ""
    [c] = CT.cambios_de_certeza(antes, despues)
    assert c["motivo"] == "" and "(por decisión del juez, por debajo del techo por regla: baja)" in CT.parrafo_de_cambios([c])
    assert palabras_sin_tilde([("p", parrafo), ("q", CT.parrafo_de_cambios([c]))]) == []


def test_una_subida_por_regla_hasta_el_techo_se_explica_con_el_techo():
    antes = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya", "recalculadaEn": None}}
    despues = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "baja", "direccion": "apoya", "techo": "baja", "motivoTecho": "solo literatura, aunque de 2 cohortes distintas", "motivoCambio": "Recálculo del techo por regla: solo literatura, aunque de 2 cohortes distintas", "recalculadaEn": 1000}}
    [c] = CT.cambios_de_certeza(antes, despues)
    assert c["explicacion"] == "techo" and c["porRegla"] is True
    assert "subió de muy baja a baja (techo por regla: baja; solo literatura, aunque de 2 cohortes distintas)" in CT.parrafo_de_cambios([c])


def test_un_techo_que_sube_por_regla_por_encima_del_juez_lo_dice():
    # El juez había dado moderada; el techo era muy baja y hoy la regla lo sube a
    # alta: la certeza vuelve a la del juez, que queda por debajo del techo nuevo.
    antes = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya", "recalculadaEn": 500}}
    despues = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "moderada", "direccion": "apoya", "techo": "alta", "motivoTecho": "hay evidencia directa (análisis sobre datos reales) y 2 cohortes distintas", "motivoCambio": "Recálculo del techo por regla: hay evidencia directa", "recalculadaEn": 1000}}
    [c] = CT.cambios_de_certeza(antes, despues)
    assert c["explicacion"] == "techo_sube" and c["porRegla"] is True and c["motivo"].startswith("hay evidencia directa")
    parrafo = CT.parrafo_de_cambios([c])
    assert "subió de muy baja a moderada (el techo por regla subió a alta: hay evidencia directa (análisis sobre datos reales) y 2 cohortes distintas; la certeza queda en la que dio el juez)" in parrafo
    assert parrafo.count("(") == parrafo.count(")")
    # El mismo `recalculadaEn` de antes no es un recálculo de este cierre: fue el juez.
    despues["h"]["recalculadaEn"] = 500
    [c] = CT.cambios_de_certeza(antes, despues)
    assert c["porRegla"] is False and c["explicacion"] == "juez"
    # Un booleano no es un instante.
    despues["h"]["recalculadaEn"] = True
    assert CT.cambios_de_certeza(antes, despues)[0]["porRegla"] is False


def test_un_cambio_sin_explicacion_guardada_la_deduce_del_techo():
    # Los diccionarios de `_cambio` (y los de un cierre parcial de la versión
    # anterior) no traen `explicacion`: se deduce comparando nivel y techo.
    assert "(techo por regla: baja; solo literatura" in CT.parrafo_de_cambios([_cambio("subio")])
    bajo_el_techo = _cambio("bajo", "baja", "muy_baja", techo="baja", motivo="el juez vio una contradicción")
    assert "(motivo del juez: el juez vio una contradicción; techo por regla: baja)" in CT.parrafo_de_cambios([bajo_el_techo])
    techo_sube = _cambio("subio", "muy_baja", "moderada", techo="alta", motivo="cuenta nueva", porRegla=True)
    assert "subió de muy baja a moderada (el techo por regla subió a alta: cuenta nueva; la certeza queda en la que dio el juez)" in CT.parrafo_de_cambios([techo_sube])
    assert CT.parrafo_de_cambios([_cambio("subio", techo=None, motivo="")]).endswith("subió de muy baja a baja. Ninguna bajó.")


def test_el_motivo_del_juez_pierde_la_mayuscula_inicial_pero_una_sigla_no():
    c = _cambio("bajo", "baja", "muy_baja", techo="baja", motivo="GFAP no subió antes en la segunda cohorte")
    assert "(motivo del juez: GFAP no subió antes en la segunda cohorte; techo por regla: baja)" in CT.parrafo_de_cambios([c])
    c = _cambio("bajo", "baja", "muy_baja", techo="baja", motivo="Casi todas las afirmaciones son indirectas.")
    assert "(motivo del juez: casi todas las afirmaciones son indirectas; techo por regla: baja)" in CT.parrafo_de_cambios([c])


# ---------------------------------------------------------------------------
# De punta a punta: el cierre pasa el conjunto de hipótesis al aviso
# ---------------------------------------------------------------------------


def test_de_punta_a_punta_el_cierre_reconoce_a_la_que_subio_por_una_palabra_unica(monkeypatch):
    # La única hipótesis del estado («GFAP sube antes que NfL») sube por regla. El
    # llano trae una frase que solo la nombra por "GFAP": sin el conjunto completo
    # no sería reconocida (hace falta el solape de dos), con él sí. Y otra frase
    # sobre otra hipótesis, que no se toca.
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")
    sobre_gfap = "GFAP pasó a recibir apoyo en dos cohortes, con certeza muy baja."
    _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano(cambios=[sobre_gfap, CAMBIO_CONCORDANCIA])}, monkeypatch)
    it = _it(al, ids)
    assert _hip(al, ids)["conclusion"]["certeza"] == "baja"
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in _parrafo_de(al, ids)
    llano = it["resumenLlano"]
    assert llano["cambios"][0] == f"{CT.AVISO_DESFASE} GFAP pasó a recibir apoyo en dos cohortes, con certeza muy baja."
    assert llano["cambios"][1] == CAMBIO_CONCORDANCIA
    assert llano["cambios"][2] == _parrafo_de(al, ids)
    assert palabras_sin_tilde([("resumen", it["resumen"]), ("cambios", " ".join(llano["cambios"]))]) == []
    al.cerrar()
