"""Una declaración de ignorancia no cuenta como evidencia a favor
(28 de septiembre de 2026).

`_ausencia` en el verificador devolvía veredicto `sostenida` para dos casos
que no afirman nada del mundo: "no pude comprobar X" y "no encontré X en lo
que leí". Es correcto que no sean un fallo (su cita no falla, la frase es
honesta), pero el veredicto `sostenida` las metía en todas partes:

- `certeza.peso_afirmacion` les daba peso 1,0 (relación de origen 1,0, sin
  fuente emparejada 1,0, sin sesgo 1,0, n desconocido 1,0);
- `VEREDICTOS_QUE_CUENTAN` las admitía como apoyos;
- `evidencia.puede_ser_evidencia` las enlazaba a una hipótesis;
- `verificador.fidelidad` las contaba en el numerador.

Medido antes del arreglo: TRES frases que dicen "no pude comprobar" sumaban
3,0 de peso a favor, que es el umbral de `alta` (`UMBRALES_PESO`), y con tres
cohortes distintas el techo salía `baja`. ROSA2018 podía escribir "la
evidencia sugiere, con limitaciones, que..." apoyándose en declaraciones de
ignorancia.
"""

from __future__ import annotations

from typing import Any

from rosa import certeza as CERTEZA
from rosa import verificador as V
from rosa.bucle import contexto as T
from rosa.bucle import evidencia as EV

MOTIVO_NO_PUDE = "Declaración honesta de comprobación no hecha; no se juzga contra las fuentes ni cuenta como evidencia."
MOTIVO_AUSENCIA = "Declaración de ausencia sin contradicción en lo leído; no cuenta como evidencia a favor."


def _h(afs: list[dict[str, Any]]) -> dict[str, Any]:
    fuentes = [{"id": f"f{i}", "cohorte": f"Cohorte {i}"} for i in range(len(afs))]
    for i, a in enumerate(afs):
        a.setdefault("fuenteId", f"f{i}")
        a.setdefault("clase", "dato")
    return {"afirmaciones": afs, "fuentes": fuentes, "procedencia": {"fuentes": fuentes}, "supuestos": []}


def _abst(i: int) -> dict[str, Any]:
    return {"texto": f"No pude comprobar {i}", "veredicto": "sostenida", "abstencion": True}


def _dato(i: int) -> dict[str, Any]:
    return {"texto": f"Dato medido {i}", "veredicto": "sostenida"}


def test_el_verificador_marca_las_dos_clases_de_abstencion():
    r = V._ausencia("No pude comprobar si existe un ensayo con SULF2.", [])
    assert r.veredicto == "sostenida" and r.abstencion is True
    r2 = V._ausencia("No aparece SULF2 en los documentos recuperados.", [])
    assert r2.veredicto == "sostenida" and r2.abstencion is True


def test_tres_abstenciones_no_llegan_a_baja():
    nivel, motivo = CERTEZA.techo(_h([_abst(0), _abst(1), _abst(2)]))
    assert nivel == "muy_baja"
    assert "no afirme algo del mundo" in motivo or "no se pudo comprobar" in motivo
    # Y tres datos de verdad con las mismas cohortes sí llegan: la diferencia
    # es la abstención, no otra cosa.
    assert CERTEZA.techo(_h([_dato(0), _dato(1), _dato(2)]))[0] == "baja"


def test_una_abstencion_pesa_cero():
    p = CERTEZA.peso_afirmacion(_abst(0), None)
    assert p["peso"] == 0.0
    assert any("no afirma nada del mundo" in f["motivo"] for f in p["factores"])
    assert CERTEZA.peso_afirmacion(_dato(0), None)["peso"] > 0


def test_los_registros_viejos_se_reconocen_por_su_motivo():
    """Los anteriores a la marca no traen `abstencion`: la única señal que
    tenían era el motivo que escribió el verificador."""
    for motivo in (MOTIVO_NO_PUDE, MOTIVO_AUSENCIA):
        viejo = {"texto": "x", "veredicto": "sostenida", "motivo": motivo}
        assert CERTEZA.es_abstencion(viejo) is True, motivo[:40]
    assert CERTEZA.es_abstencion({"texto": "x", "veredicto": "sostenida", "motivo": "El fragmento la respalda"}) is False


def test_no_se_enlaza_a_una_hipotesis_ni_entra_en_las_sostenidas():
    a = {**_abst(0), "fuenteId": "f1", "tipo": "dato", "cita": "[X, pág. 1]"}
    b = {**_dato(1), "fuenteId": "f2", "tipo": "dato", "cita": "[Y, pág. 2]"}
    assert EV.puede_ser_evidencia(a) is False
    assert EV.puede_ser_evidencia(b) is True
    assert T.afirmaciones_sostenidas([a, b])[1] == [b]


def test_un_registro_raro_no_rompe_la_comprobacion():
    for raro in (None, "texto", 7, [], {}):
        assert CERTEZA.es_abstencion(raro) is False, repr(raro)
