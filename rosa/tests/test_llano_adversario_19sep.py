"""Adversario del arreglo del desfase entre el resumen en llano y las
conclusiones rehechas en el mismo cierre (rosa/bucle/cierre_texto.py, 19 de
septiembre de 2026). Los textos de estos tests son los del estado real de la
corrida 13 (investigación inv-mu2sz2ns-3, iteraciones 2 y 3), donde «La
normalización de P-tau181, no su reducción porcentual, predice el beneficio
clínico» subió de muy baja a baja mientras el llano decía que todas se
mantenían en muy baja.

Los tests marcados como defecto fallan con el código de hoy a propósito: cada
uno reproduce un hallazgo del informe del adversario. Los demás documentan
casos límite que sí se sostienen. Ninguno sale al gateway.
"""

from __future__ import annotations

import asyncio
import copy
from typing import Any

from rosa.bucle import cierre_texto as CT
from rosa.bucle import corrida as CO
from rosa.tests.test_bucle_iteracion import palabras_sin_tilde
from rosa.estado.almacen import _limpiar_para_cliente
from rosa.tests.test_cierre_llano_reconclusion import _cambio, _cerrar, _conclusion_previa, _llano, _parrafo_de
from rosa.tests.test_integracion_corrida import _preparar, _supervisor
from rosa.tests.test_tanda1_corrida import _corrida, _it, _respuestas_cierre

# La hipótesis que subió en la iteración 3 de la corrida 13 y el motivo del techo
# que la regla dejó escrito (con su paréntesis).
TITULO_SUBIO = "La normalización de P-tau181, no su reducción porcentual, predice el beneficio clínico"
MOTIVO_TECHO_REAL = "solo literatura, sin experimento ni análisis sobre datos reales, aunque de 9 cohortes distintas (1 fuente sin cohorte identificada, que no cuentan como independientes)"

# Lo que el modelo escribió en `cambios` de la iteración 3 sobre OTRAS hipótesis
# (las dos siguieron en muy baja) y en `limitaciones` sobre todas.
CAMBIO_CONCORDANCIA = "La concordancia de P-tau181 entre sangre y líquido cefalorraquídeo pasó de carecer de evidencia directa a recibir apoyo, siempre con certeza muy baja. No se detalló el motivo concreto del cambio."
CAMBIO_VASCULAR = "La hipótesis de que el daño vascular cerebral inicial limita el valor de reducir P-tau181 pasó de carecer de evidencia directa a recibir apoyo. La certeza sigue siendo muy baja y no se detalló el motivo concreto del cambio."
LIMITACIONES_REAL = "Todas las hipótesis mantienen una certeza muy baja. La evidencia combina experimentos, modelos, asociaciones observadas y ensayos con medidas y poblaciones diferentes."
# Y lo que escribió en la iteración 2 sobre la hipótesis que sí subiría: es la
# forma en que el modelo habla de una hipótesis concreta ("..., con certeza muy baja.").
CAMBIO_NORMALIZACION = "La normalización de p-tau181 pasó de no tener evidencia directa a un balance favorable, con certeza muy baja. Sigue suspendida por un supuesto contradicho sobre cómo los ensayos publican las diferencias entre tratamientos."


def _subida_real() -> list[dict[str, Any]]:
    """El cambio real de la corrida 13: solo esa hipótesis pasó de muy baja a baja."""
    return [_cambio("subio", id="hip-mu2uqqzu-5871", titulo=TITULO_SUBIO, motivo=MOTIVO_TECHO_REAL)]


# ---------------------------------------------------------------------------
# Defecto 1 (media): el aviso se pone por nivel, no por hipótesis. En el llano
# real de la iteración 3, dos de los tres avisos caen sobre frases que siguen
# siendo ciertas (hablan de hipótesis que no cambiaron), y la frase que sí queda
# desfasada (la de la hipótesis que subió, escrita como el modelo escribe:
# "..., con certeza muy baja.") no recibe ninguno.
# ---------------------------------------------------------------------------


def test_defecto_el_aviso_no_debe_caer_sobre_frases_de_hipotesis_que_no_cambiaron():
    cambios = _subida_real()
    llano = {"titulo": "Qué pasó", "mensajesClave": [], "queBuscaba": "a", "queHizo": "b", "queEncontro": [], "limitaciones": LIMITACIONES_REAL, "cambios": [CAMBIO_CONCORDANCIA, CAMBIO_VASCULAR], "quePropone": [], "queFalta": "f", "queTeToca": "g", "terminos": []}
    CT.llano_con_cambios(llano, CT.parrafo_de_cambios(cambios), cambios)
    assert llano["limitaciones"].startswith(CT.AVISO_DESFASE), "la frase sobre todas las hipótesis sí está desfasada"
    # La concordancia plasma-LCR y la hipótesis vascular siguen en muy baja: lo que
    # el modelo dijo de ellas sigue siendo verdad y no merece un "Ojo".
    assert llano["cambios"][0] == CAMBIO_CONCORDANCIA, llano["cambios"][0]
    assert llano["cambios"][1] == CAMBIO_VASCULAR, llano["cambios"][1]


def test_defecto_la_frase_sobre_la_hipotesis_que_subio_si_queda_desfasada():
    cambios = _subida_real()
    assert CT.frase_desfasada(CAMBIO_NORMALIZACION, cambios), "habla de la hipótesis que subió y afirma que sigue en muy baja"
    llano = {"cambios": [CAMBIO_NORMALIZACION], "limitaciones": "x"}
    CT.llano_con_cambios(llano, CT.parrafo_de_cambios(cambios), cambios)
    assert llano["cambios"][0].startswith(CT.AVISO_DESFASE)


def test_defecto_de_punta_a_punta_el_aviso_no_marca_lo_que_no_cambio(monkeypatch):
    # La única hipótesis del estado («GFAP sube antes que NfL») sube por regla; el
    # llano trae una frase sobre otra hipótesis que sigue en muy baja.
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")
    _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano(cambios=[CAMBIO_CONCORDANCIA])}, monkeypatch)
    it = _it(al, ids)
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in _parrafo_de(al, ids)
    assert it["resumenLlano"]["cambios"][0] == CAMBIO_CONCORDANCIA, it["resumenLlano"]["cambios"][0]
    al.cerrar()


# ---------------------------------------------------------------------------
# Defecto 2 (baja): el recorte del motivo del techo a MAX_MOTIVO corta dentro de
# un paréntesis y el párrafo queda con uno sin cerrar. Pasa con el motivo real
# de la corrida 13 (165 caracteres).
# ---------------------------------------------------------------------------


def test_defecto_el_parrafo_no_deja_parentesis_sin_cerrar_al_recortar_el_motivo():
    assert len(MOTIVO_TECHO_REAL) > CT.MAX_MOTIVO
    parrafo = CT.parrafo_de_cambios(_subida_real())
    assert parrafo.count("(") == parrafo.count(")"), parrafo
    assert "como...)" not in parrafo, "el recorte cae dentro del paréntesis del motivo"


# ---------------------------------------------------------------------------
# Defecto 3 (baja): una bajada del juez por debajo del techo se explica con el
# techo ("techo por regla: baja; solo literatura...") aunque el techo, que está
# por encima del nivel nuevo, no es lo que la bajó; el motivo que dejó el juez
# (`cambio.motivo`) no aparece.
# ---------------------------------------------------------------------------


def test_defecto_una_bajada_del_juez_por_debajo_del_techo_no_se_explica_con_el_techo():
    antes = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"}}
    despues = {"h": {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya", "techo": "baja", "motivoTecho": "solo literatura, sin experimento ni análisis sobre datos reales, aunque de 2 cohortes distintas", "motivoCambio": "el juez encontró una afirmación en contra sostenida en una segunda cohorte"}}
    cambios = CT.cambios_de_certeza(antes, despues)
    assert [c["tipo"] for c in cambios] == ["bajo"]
    parrafo = CT.parrafo_de_cambios(cambios)
    assert "bajó de baja a muy baja" in parrafo
    assert "el juez encontró una afirmación en contra" in parrafo, parrafo
    assert "(techo por regla: baja; solo literatura" not in parrafo, "el techo está por encima del nivel nuevo: no explica la bajada"


# ---------------------------------------------------------------------------
# Defecto 4 (baja): patrones del aviso. `sigu\\w*` casa "siguiente" y marca una
# frase que no afirma nada sobre el nivel; y el plural "certezas muy bajas" no
# se reconoce aunque sea la misma afirmación que "certeza muy baja".
# ---------------------------------------------------------------------------


def test_defecto_siguiente_no_es_sigue():
    subida = [_cambio("subio")]
    assert not CT.frase_desfasada("En la siguiente revisión, la certeza muy baja de la hipótesis vascular debería subir con datos reales.", subida)
    assert not CT.frase_desfasada("A continuación, la certeza muy baja de las demás se explica por la falta de réplica.", subida)


def test_defecto_el_plural_certezas_muy_bajas_es_la_misma_afirmacion():
    subida = [_cambio("subio")]
    assert CT.frase_desfasada("Todas las hipótesis conservan certezas muy bajas.", subida)
    assert CT.frase_desfasada("Las nueve hipótesis siguen con certezas muy bajas.", subida)


# ---------------------------------------------------------------------------
# Lo que sí se sostiene: casos límite probados por el adversario
# ---------------------------------------------------------------------------


def test_un_cierre_parcial_con_la_instantanea_de_otro_tipo_se_recalcula_y_se_guarda(monkeypatch):
    # Un `_cierre` de una versión anterior (o corrompido) trae `certezasAntes` que
    # no es un diccionario: se recalcula al entrar y el cierre termina.
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")
    al.mutar(lambda e: CO._guardar_cierre_parcial(e, ids["it"], resumen="Resumen previo.", certezasAntes=["basura"]), "cierre_parcial")
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("resumir") == 0, "el resumen del cierre parcial no se repaga"
    it = _it(al, ids)
    assert it["terminadaEn"] is not None and "_cierre" not in it
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in _parrafo_de(al, ids)
    al.cerrar()


def test_la_instantanea_guardada_sobrevive_a_json_y_no_viaja_al_navegador(monkeypatch):
    import json

    from rosa.modulos.contador import PresupuestoAgotado

    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", huella_vieja=True)

    def sin_presupuesto(kw):
        raise PresupuestoAgotado("tope")

    sup, ctx, _ = _supervisor(al, ids, {**_respuestas_cierre(), "concluir": sin_presupuesto}, monkeypatch)
    try:
        asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    except PresupuestoAgotado:
        pass
    it = _it(al, ids)
    guardada = it["_cierre"]["certezasAntes"]
    assert json.loads(json.dumps(guardada)) == guardada
    it_cliente = next(x for x in _limpiar_para_cliente(al.estado)["iteraciones"] if x["id"] == ids["it"])
    assert "_cierre" not in it_cliente, "las claves privadas no viajan al navegador"
    al.cerrar()


def test_el_parrafo_de_la_corrida_13_va_con_tildes_sin_porcentajes_ni_guion_largo():
    parrafo = CT.parrafo_de_cambios(_subida_real())
    assert parrafo.startswith(f"En este cierre cambió la certeza de 1 hipótesis: «{TITULO_SUBIO}» subió de muy baja a baja (techo por regla: baja; ")
    assert parrafo.endswith("Ninguna bajó.")
    assert "%" not in parrafo and "demostrad" not in parrafo and "confirmad" not in parrafo and "\u2014" not in parrafo
    assert palabras_sin_tilde([("parrafo", parrafo)]) == []


def test_dos_pasadas_con_parrafos_distintos_no_marcan_el_parrafo_viejo_como_desfasado():
    # Si el mismo llano recibiera dos párrafos (dos cierres retomados con cambios
    # distintos), el párrafo anterior no debe recibir el aviso: lo escribió la regla.
    cambios1 = [_cambio("subio")]
    cambios2 = [_cambio("subio"), _cambio("bajo", "moderada", "baja", titulo="Otra", id="h2")]
    p1, p2 = CT.parrafo_de_cambios(cambios1), CT.parrafo_de_cambios(cambios2)
    llano = {"cambios": [], "limitaciones": "x"}
    CT.llano_con_cambios(llano, p1, cambios1)
    CT.llano_con_cambios(copy.deepcopy(llano), p2, cambios2)
    CT.llano_con_cambios(llano, p2, cambios2)
    assert llano["cambios"] == [p1, p2]
    assert not any(x.startswith(CT.AVISO_DESFASE) for x in llano["cambios"])
