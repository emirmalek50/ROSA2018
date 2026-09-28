"""«No pude comprobar» deja de decirse como «no hay» (28 de septiembre de 2026).

Cuando la evaluación de un supuesto fallaba (el modelo no respondía), ROSA2018
guardaba `estado: "sin_evidencia"` y ponía la verdad en `alcance:
"no_evaluado"`. De los 24 sitios que leen un supuesto, solo la ficha de la
interfaz miraba el alcance: el dossier, el Killer, el documento controlado, el
modelo de mundo y la priorización decían «sin evidencia». Va contra la regla de
la casa, y engañó a un revisor externo del dossier de SULF2, donde dos de doce
supuestos eran de estos.

Ahora el estado lo dice. `no_evaluado` no lo escribe nunca el modelo: no puede
declararse a sí mismo sin respuesta.
"""

from __future__ import annotations

from typing import Any

from rosa import documento_controlado as DC
from rosa import killer as K
from rosa import vigencia as VIGENCIA
from rosa.bucle.pasos import validar_supuesto_evaluado


def _sup(estado: str, **extra: Any) -> dict[str, Any]:
    return {"texto": "La degradación microglial no depende de la sulfatación 6-O", "estado": estado, "evidencia": "", **extra}


NO_EVALUADO = _sup("no_evaluado", evidencia="No se pudo evaluar: el modelo no respondió (AdapterParseError)", alcance="no_evaluado")


def test_no_evaluado_es_un_estado_y_no_lo_puede_escribir_el_modelo():
    assert VIGENCIA.ESTADO_NO_EVALUADO == "no_evaluado"
    assert "no_evaluado" in VIGENCIA.ESTADOS_SUPUESTO
    assert "no_evaluado" not in VIGENCIA.ESTADOS_SUPUESTO_DEL_MODELO
    # Si el modelo lo intenta, la regla lo baja a "sin evidencia".
    estado, _, _ = validar_supuesto_evaluado("no_evaluado", "lo que sea", [], [])
    assert estado == "sin_evidencia"
    for bueno in VIGENCIA.ESTADOS_SUPUESTO_DEL_MODELO:
        assert validar_supuesto_evaluado(bueno, "x", [], [])[0] == bueno or bueno == "contradicho"


def test_se_reconoce_por_estado_por_alcance_y_por_el_texto_viejo():
    """Los registros de antes del arreglo solo tienen el alcance, y los más
    viejos ni eso: solo el texto de la evidencia."""
    assert VIGENCIA.no_se_pudo_evaluar(NO_EVALUADO) is True
    assert VIGENCIA.no_se_pudo_evaluar(_sup("sin_evidencia", alcance="no_evaluado")) is True
    assert VIGENCIA.no_se_pudo_evaluar(_sup("sin_evidencia", evidencia="No se pudo evaluar: el modelo no respondió (TimeoutError)")) is True
    assert VIGENCIA.no_se_pudo_evaluar(_sup("sin_evidencia", evidencia="ninguna")) is False
    assert VIGENCIA.no_se_pudo_evaluar(_sup("respaldado")) is False
    for raro in (None, "texto", 7, []):
        assert VIGENCIA.no_se_pudo_evaluar(raro) is False, repr(raro)


def test_el_killer_no_da_por_bueno_un_supuesto_que_no_pudo_comprobar():
    """Antes salía «Ningún supuesto contradicho», que es afirmar algo que no se
    sabe. Ahora es «no comprobable», que en la tabla del Killer suspende."""
    def comprobacion(sups: list[dict[str, Any]]) -> dict[str, Any]:
        h = {"supuestos": sups, "afirmaciones": [], "procedencia": {"fuentes": []}, "tarjeta": {}, "enunciado": "x", "titulo": "x"}
        return next(c for c in K.comprobaciones_deterministas(h, {"hipotesis": [], "fuentes": []}) if c["comprobacion"] == "supuestos")

    r = comprobacion([NO_EVALUADO])
    assert r["resultado"] == "no_comprobable" and "no se pudieron evaluar" in r["detalle"]
    assert "supuestos" in K.CRITICAS, "no_comprobable en una comprobación crítica es lo que suspende"
    # Con evidencia de verdad sigue pasando, y un contradicho sigue fallando.
    assert comprobacion([_sup("sin_evidencia", evidencia="ninguna")])["resultado"] == "pasa"
    assert comprobacion([_sup("respaldado")])["resultado"] == "pasa"
    assert comprobacion([_sup("contradicho")])["resultado"] == "falla"
    # Un contradicho manda sobre un no evaluado: lo que se sabe pesa más.
    assert comprobacion([NO_EVALUADO, _sup("contradicho")])["resultado"] == "falla"


def test_no_se_cuenta_entre_los_que_no_tienen_evidencia():
    h = {"supuestos": [NO_EVALUADO, _sup("sin_evidencia", evidencia="ninguna")], "afirmaciones": [], "procedencia": {"fuentes": []}, "tarjeta": {}, "enunciado": "x", "titulo": "x"}
    r = next(c for c in K.comprobaciones_deterministas(h, {"hipotesis": [], "fuentes": []}) if c["comprobacion"] == "supuestos")
    assert r["resultado"] == "no_comprobable"  # el que no se pudo comprobar manda sobre el que sí se miró


def test_el_sello_lo_cuenta_como_fallido_y_la_hipotesis_no_esta_al_dia():
    h: dict[str, Any] = {"supuestos": [NO_EVALUADO], "afirmaciones": [], "supuestosEvaluados": VIGENCIA.sello(0, 1000, 1)}
    assert VIGENCIA.vigencia(h) == {"alDia": False, "motivo": "fallidos", "nuevas": 0}
    # Con el sello limpio sí está al día: el contador es lo que manda.
    assert VIGENCIA.vigencia({**h, "supuestosEvaluados": VIGENCIA.sello(0, 1000, 0)})["alDia"] is True


def test_el_documento_controlado_lo_traduce_y_no_dice_sin_evidencia():
    assert DC._ESTADO_SUPUESTO["no_evaluado"] == "no se pudo comprobar"
    assert set(VIGENCIA.ESTADOS_SUPUESTO) <= set(DC._ESTADO_SUPUESTO), "cada estado necesita su etiqueta en castellano"
