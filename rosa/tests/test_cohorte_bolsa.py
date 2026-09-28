"""Una bolsa de plataformas deja de contar como cohorte independiente
(28 de septiembre de 2026).

El techo por regla sube de `muy_baja` a `baja` con dos cohortes distintas. La
hipótesis «SULF2 neuronal como barrera a la entrada de tau...» (corrida
`cor-mulntlr0-42`) subió con estas dos:

    ["cerebro humano con enfermedad de Alzheimer",
     "iPS-derived neurons, CNS cell lines, mouse brain slice"]

La segunda son tres plataformas metidas en un campo. No son réplicas
independientes del mismo efecto: son eslabones distintos medidos en sistemas
distintos, que es justo lo que la segunda cohorte debería descartar.

Contar comas no vale como regla: 'tejido postmortem de corteza prefrontal
(PFC), control y AD' es una cohorte con dos brazos, y 'AMARANTH, DAYBREAK-ALZ'
son dos ensayos del catálogo (ahí el problema es que se cuenten como uno). Por
eso la regla pide tres o más trozos y que ninguno resuelva al catálogo.
"""

from __future__ import annotations

from typing import Any

from rosa import certeza as CERTEZA
from rosa import metodos as METODOS

BOLSA = "iPS-derived neurons, CNS cell lines, mouse brain slice"


def _hipotesis(*cohortes: str) -> dict[str, Any]:
    fuentes = [{"id": f"f{i}", "referencia": f"Autor {i}", "cohorte": c} for i, c in enumerate(cohortes)]
    return {
        "afirmaciones": [{"texto": f"apoyo {i}", "veredicto": "sostenida", "fuenteId": f"f{i}", "clase": "dato"} for i in range(len(cohortes))],
        "fuentes": fuentes,
        "procedencia": {"fuentes": fuentes},
        "supuestos": [],
    }


def test_el_caso_de_sulf2_se_queda_en_muy_baja():
    nivel, motivo = CERTEZA.techo(_hipotesis("cerebro humano con enfermedad de Alzheimer", BOLSA))
    assert nivel == "muy_baja"
    assert "una sola cohorte" in motivo
    assert "sin cohorte identificada" in motivo, "el motivo dice que descartó una, no se la calla"


def test_dos_cohortes_de_verdad_siguen_llegando_a_baja():
    nivel, motivo = CERTEZA.techo(_hipotesis("ADNI", "A4"))
    assert nivel == "baja" and "2 cohortes distintas" in motivo


def test_que_es_bolsa_y_que_no_sobre_los_nombres_reales_de_la_base():
    descartan = [
        BOLSA,
        "lanabecestat, verubecestat, atabecestat (inhibidores de BACE",
        "tejido postmortem de corteza prefrontal (PFC), control y AD",
    ]
    mantienen = [
        "AMARANTH, DAYBREAK-ALZ",  # dos ensayos del catálogo: el problema es contarlos como uno, no descartarlos
        "modelos de ratón de tauopatía P301L y AAV-hTau-N368",  # dos brazos, no tres sistemas
        "Belder et al. (cohorte longitudinal ADAD, familias con mutación)",  # un nombre con aclaración
        "ADNI",
        "cerebro humano con enfermedad de Alzheimer",
    ]
    for n in descartan:
        assert METODOS._nombre_identificado(n) == "", n
        assert METODOS._es_bolsa(n) is True, n
    for n in mantienen:
        assert METODOS._nombre_identificado(n) == n.strip(), n


def test_la_regla_vieja_de_los_cuantificadores_sigue_en_pie():
    assert METODOS._nombre_identificado("multiple population-based cohorts") == ""
    assert METODOS._nombre_identificado("multiple sclerosis") == "multiple sclerosis"


def test_un_nombre_raro_no_tumba_el_techo():
    for raro in ("", "   ", ",,,", " y y y ", "(((", "a, b, c"):
        METODOS._nombre_identificado(raro)  # no revienta
    nivel, _ = CERTEZA.techo(_hipotesis("ADNI", "A4", ",,,"))
    assert nivel == "baja", "las dos buenas siguen contando"


def test_la_regla_esta_espejada_en_el_frontend():
    from pathlib import Path

    ts = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "priorizacion.ts"
    fuente = ts.read_text(encoding="utf-8")
    assert "TROZOS_QUE_HACEN_BOLSA = 3" in fuente and "export function esBolsaDeCohortes" in fuente
    assert f"_TROZOS_QUE_HACEN_BOLSA = {METODOS._TROZOS_QUE_HACEN_BOLSA}" in Path(METODOS.__file__).read_text(encoding="utf-8")
