"""Prueba de punta a punta de la tanda 2 (bloque A), 18 de septiembre de 2026:
los pendientes cruzados que los cinco constructores dejaron declarados en
ficheros ajenos y que se cierran en la integración. Sin red ni modelos: el
extractor es un doble local.

- M-03 (certeza -> pasos.py): la cohorte que escribe el extractor pasa por
  `metodos.recortar_nombre_cohorte` en vez de cortarse a 60 caracteres, así
  que "TRAILBLAZER-ALZ (NCT03367403) y TRAILBLAZER-ALZ 2 (NCT04437511)"
  conserva los dos NCT en la afirmación y en la fuente. Antes quedaba
  "NCT044375", roto, y el segundo ensayo se fundía con el primero.
- M-08 (hechos -> pasos.py): las dos mitades del hallazgo (el bucle al nacer
  un hecho y rosa/hechos.py al cargar y heredar) comparten la regla de
  referencia compartida y de números, y el bucle aplica las guardas de siglas
  y de negaciones largas que el estado ya tenía.
- S-14 (cierre -> plantilla.py): `nueva_iteracion` admite la reserva del
  cierre y la escribe en `presupuesto.reservaCierre` al nacer la iteración.
- El acentuador de Python (scripts/acentuar_py.py) respeta lo que va entre
  comillas invertidas: `direccion` es un identificador, no una palabra.
"""

from __future__ import annotations

import asyncio
import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace

from rosa import cuestiones as CU
from rosa import hechos as H
from rosa import metodos as METODOS
from rosa import reranker
from rosa.bucle import pasos as PASOS
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen

COHORTE_RAKET = "TRAILBLAZER-ALZ (NCT03367403) y TRAILBLAZER-ALZ 2 (NCT04437511)"
COHORTE_LARGA = "Participantes con Alzheimer temprano de TRAILBLAZER-ALZ (NCT03367403) y de TRAILBLAZER-ALZ 2 (NCT04437511) con amiloide confirmado por PET"
PASAJE = "Donanemab slowed clinical progression in TRAILBLAZER-ALZ (NCT03367403) and TRAILBLAZER-ALZ 2 (NCT04437511) participants with confirmed amyloid pathology."
PAGINA = ("Table 2. Primary outcome. " + PASAJE + " The integrated Alzheimer's Disease Rating Scale changed by -6.02 versus -9.27 with placebo "
          "(difference 3.25; 95% CI 1.88 to 4.62; p < 0.001). n = 860 versus 876. Amyloid PET fell 88.0 centiloids (SD 24.1). ")
PAGINA_ADNI = ("Table 3. Plasma GFAP in the Alzheimer's Disease Neuroimaging Initiative (ADNI) cohort rose 12.4% (95% CI 9.8 to 15.1) in amyloid positive "
               "participants versus 0.3% in amyloid negative participants (p < 0.001). n = 412 versus 388. NfL did not differ (p = 0.41). ")


def _almacen():
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        e["investigaciones"].append({"id": "inv", "titulo": "t", "objetivo": "Qué biomarcador predice el beneficio clínico de donanemab", "limites": [], "condicionParada": "x", "configuracion": {"preferencias": "", "atributos": [], "restricciones": [], "amplitud": "enfocada"}, "vivero": []})
        c = P.nueva_corrida("inv", 1, 1000)
        c["id"] = "cor"
        c["estado"] = "en_marcha"
        e["corridas"].append(c)
        it = P.nueva_iteracion("cor", 1, 1000, [P.nuevo_paso("Extraer", "", 20)], 40)
        it["id"] = "it"
        e["iteraciones"].append(it)
        return True

    al.mutar(fn, "test")
    return al


def _ctx(al):
    programas = SimpleNamespace(extraer="extraer", mundo="mundo", relevancia="relevancia")
    return Ctx(al, programas, SimpleNamespace(cerebro=SimpleNamespace(model="sim"), juez=SimpleNamespace(model="sim"), volumen=SimpleNamespace(model="sim")), "cor", "inv", "it", 1)


def _paso(al, tipo="extraccion"):
    paso = {"id": f"paso-{tipo}", "tipo": tipo, "titulo": tipo, "estado": "en_curso", "detalle": "", "indicacionHumana": False, "motivoFallo": None}
    al.mutar(lambda e: next(i for i in e["iteraciones"] if i["id"] == "it")["plan"].append(paso) or True, "plan")
    return paso


def _afirmacion(texto, fragmento, cohorte):
    return SimpleNamespace(texto=texto, fragmento=fragmento, tipo="dato", tema="eficacia", cohorte=cohorte, nivel_medicion="resultado_analisis", n="860 vs 876", comparador="placebo", efecto="3,25", incertidumbre="95% CI 1.88 to 4.62")


# ---------------------------------------------------------------------------
# M-03: la cohorte completa de Raket 2026 conserva los dos NCT de punta a punta
# ---------------------------------------------------------------------------


def test_la_cohorte_completa_de_raket_conserva_los_dos_nct_de_punta_a_punta(monkeypatch):
    monkeypatch.setattr(reranker, "disponible", lambda: False)
    assert len(COHORTE_RAKET) > 60 and "NCT04437511" not in COHORTE_RAKET[:60], "el caso solo vale si el corte antiguo rompía el segundo NCT"
    al = _almacen()
    try:
        ctx = _ctx(al)
        ctx.modelos.volumen.model = "openai/anthropic/claude-sonnet-5.5"
        frs = [{"localizador": "pág. 9", "texto": PAGINA, "encabezado": "Results"}, {"localizador": "pág. 10", "texto": PAGINA.replace("Table 2", "Table 4"), "encabezado": "Results"}]
        fid = PASOS._registrar_fuente(ctx, {"referencia": "Raket et al., 2026", "titulo": "Donanemab in early symptomatic Alzheimer disease", "doi": "10.1/raket", "tipos": [], "resumen": ""}, "articulo", frs, 9, None, "limpio", 1, "q")

        async def llamar(self, rol, programa, **kw):
            assert programa == "extraer"
            if kw["localizador"] == "pág. 9":
                return SimpleNamespace(afirmaciones=[_afirmacion("Donanemab frenó la progresión clínica en los dos ensayos TRAILBLAZER", PASAJE, COHORTE_RAKET)])
            return SimpleNamespace(afirmaciones=[_afirmacion("La descripción larga de la cohorte también conserva los registros", PASAJE, COHORTE_LARGA)])

        monkeypatch.setattr(Ctx, "llamar", llamar)  # doble local; el módulo real llama por el gateway
        assert asyncio.run(PASOS.paso_extraccion(ctx, _paso(al))) == "2 afirmaciones extraídas de 1 fuentes"
        assert al.estado["iteraciones"][0]["pistas"][-1]["fuente"] == "Claude Sonnet 5.5"
        afs = {a["localizador"]: a for a in ctx.afirmaciones()}
        assert afs["pág. 9"]["cohorte"] == COHORTE_RAKET, afs["pág. 9"]["cohorte"]
        larga = afs["pág. 10"]["cohorte"]
        assert "NCT03367403" in larga and "NCT04437511" in larga and larga != COHORTE_LARGA[:60], larga
        assert "NCT044375" not in larga.replace("NCT04437511", ""), "ningún NCT roto"
        assert larga == METODOS.recortar_nombre_cohorte(COHORTE_LARGA)
        f = ctx.fuentes()[fid]
        assert f["cohorte"] and "NCT03367403" in f["cohorte"] and "NCT04437511" in f["cohorte"], f["cohorte"]
        # El nodo de método canoniza por el NCT, que sigue entero.
        assert f.get("metodo", {}).get("cohorte"), f.get("metodo")
    finally:
        al.cerrar()


def test_la_cohorte_de_la_fuente_que_ninguna_afirmacion_nombra_sale_del_texto_y_pasa_por_el_recorte(monkeypatch):
    monkeypatch.setattr(reranker, "disponible", lambda: False)
    al = _almacen()
    try:
        ctx = _ctx(al)
        fid = PASOS._registrar_fuente(ctx, {"referencia": "Kim et al., 2025", "titulo": "Plasma GFAP in the ADNI cohort", "doi": "10.1/k", "tipos": [], "resumen": ""}, "articulo", [{"localizador": "pág. 3", "texto": PAGINA_ADNI, "encabezado": "Results"}], 8, None, "limpio", 1, "q")

        async def llamar(self, rol, programa, **kw):
            return SimpleNamespace(afirmaciones=[_afirmacion("El GFAP en plasma subió un 12,4 % en los amiloide positivos", "Plasma GFAP in the Alzheimer's Disease Neuroimaging Initiative (ADNI) cohort rose 12.4%", "")])

        monkeypatch.setattr(Ctx, "llamar", llamar)
        asyncio.run(PASOS.paso_extraccion(ctx, _paso(al)))
        assert ctx.afirmaciones()[0]["cohorte"] == ""
        f = ctx.fuentes()[fid]
        assert f["cohorte"] == "ADNI", f["cohorte"]
        # Un nombre de cohorte vacío o que no es texto no rompe el recorte.
        assert METODOS.recortar_nombre_cohorte(None) == "" and METODOS.recortar_nombre_cohorte("   ") == "" and METODOS.recortar_nombre_cohorte(123) == "123"
    finally:
        al.cerrar()


# ---------------------------------------------------------------------------
# M-08: una sola regla para el bucle y el estado
# ---------------------------------------------------------------------------


def _hecho(enunciado, referencia="Belder et al., 2026", fuente_id="f-1"):
    h = P.nuevo_hecho("inv", "hecho", "GFAP", enunciado, "sabido", "fuente", [{"fuenteId": fuente_id, "referencia": referencia, "pagina": 2}], 1000, 3, "test", afirmacion_ids=["af-1"], citas=[])
    h["entidades"] = []
    return h


def test_el_bucle_y_el_estado_comparten_la_regla_de_referencia_y_de_numeros():
    assert PASOS.comparte_referencia is H.comparte_referencia
    assert PASOS._numeros_de is H.numeros_de and PASOS._NUMEROS_EN_LETRA is H.NUMEROS_EN_LETRA
    # "Sin autor" no identifica una obra: solo el id de fuente vale para esas.
    assert not PASOS.comparte_referencia([{"fuenteId": "f-1", "referencia": "Sin autor, 2023"}], [{"fuenteId": "f-2", "referencia": "Sin autor, 2023"}])
    assert PASOS.comparte_referencia([{"fuenteId": "f-1", "referencia": "Sin autor"}], [{"fuenteId": "f-1"}])
    # La puntuación de la referencia no separa dos citas de la misma obra.
    assert PASOS.comparte_referencia([{"referencia": "Belder et al., 2026"}], [{"fuenteId": "otro", "referencia": "belder et al. 2026"}])
    assert not PASOS.comparte_referencia(None, [{"fuenteId": "f"}]) and not PASOS.comparte_referencia("basura", [])
    assert PASOS._numeros_de("Se excluyeron cuatro de 312 participantes, un 27 % del total") == {"cuatro", "312", "27"}
    assert PASOS._numeros_de("") == set() and PASOS._numeros_de(None) == set()


def test_hecho_duplicado_no_funde_siglas_ni_negaciones_distintas_de_la_misma_fuente():
    misma = [{"fuenteId": "f-1", "referencia": "Belder et al., 2026", "pagina": 4}]
    gfap = _hecho("GFAP sube en portadores presintomáticos de mutación antes del inicio clínico estimado")
    ykl40 = "YKL40 sube en portadores presintomáticos de mutación antes del inicio clínico estimado"
    assert CU.equivalencia(gfap["enunciado"], ykl40), "el caso solo vale si el solape las daba por la misma frase"
    assert PASOS.hecho_duplicado([gfap], ykl40, misma) == (None, "")
    redujo = _hecho("El tratamiento redujo la carga amiloide en la cohorte tratada frente a placebo")
    nunca = "El tratamiento nunca redujo la carga amiloide en la cohorte tratada frente a placebo"
    assert CU.equivalencia(redujo["enunciado"], nunca)
    assert PASOS.hecho_duplicado([redujo], nunca, misma) == (None, "")
    reduced = _hecho("Treatment reduced amyloid burden in the treated cohort compared with placebo")
    assert PASOS.hecho_duplicado([reduced], "Treatment never reduced amyloid burden in the treated cohort compared with placebo", misma) == (None, "")
    # Las dos mitades dicen lo mismo: el estado tampoco los funde.
    for a, b in ((gfap, ykl40), (redujo, nunca)):
        assert H.mismo_hecho(a, dict(_hecho(b), id="he-otro")) is None
    # Y la paráfrasis de verdad, de la misma fuente, sigue fundiéndose.
    existente = _hecho("Se excluyeron cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP")
    dup, motivo = PASOS.hecho_duplicado([existente], "Los autores excluyeron a cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP", misma)
    assert dup is existente and "misma fuente" in motivo
    # Las siglas de la propia referencia no cuentan: "ADNI-3" en la cita no separa dos frases iguales.
    ref_sigla = [{"fuenteId": "f-7", "referencia": "ADNI-3 team, 2026", "pagina": 1}]
    con_ref = _hecho("Se excluyeron cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP", referencia="ADNI-3 team, 2026", fuente_id="f-7")
    assert PASOS.hecho_duplicado([con_ref], "Los autores excluyeron a cuatro participantes no portadores de la cohorte DIAN antes del análisis de GFAP [ADNI-3 team, 2026, pág. 1]".replace(" [ADNI-3 team, 2026, pág. 1]", ""), ref_sigla)[0] is con_ref
    # Un existente sin enunciado o con procedencia rota no tumba la regla.
    roto = dict(_hecho("x"), enunciado=None, procedencia="basura")
    assert PASOS.hecho_duplicado([roto], ykl40, misma) == (None, "")


# ---------------------------------------------------------------------------
# S-14: la reserva del cierre nace con la iteración
# ---------------------------------------------------------------------------


def test_nueva_iteracion_admite_la_reserva_del_cierre():
    sin = P.nueva_iteracion("cor", 1, 1000, [], 40)
    assert sin["presupuesto"] == {"limite": 40, "usado": 0}, "sin reserva la forma es la de siempre"
    con = P.nueva_iteracion("cor", 1, 1000, [], 52, reserva_cierre=12)
    assert con["presupuesto"] == {"limite": 52, "usado": 0, "reservaCierre": 12}
    assert P.nueva_iteracion("cor", 1, 1000, [], 40, reserva_cierre=0)["presupuesto"]["reservaCierre"] == 0
    assert P.nueva_iteracion("cor", 1, 1000, [], 40, reserva_cierre=7.0)["presupuesto"]["reservaCierre"] == 7


# ---------------------------------------------------------------------------
# El acentuador de Python respeta las comillas invertidas
# ---------------------------------------------------------------------------


def _acentuador():
    ruta = Path(__file__).resolve().parents[2] / "scripts" / "acentuar_py.py"
    spec = importlib.util.spec_from_file_location("acentuar_py_bajo_prueba", ruta)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def test_el_acentuador_de_python_respeta_las_comillas_invertidas():
    A = _acentuador()
    # Fuera de las comillas invertidas sí acentúa (si no, la prueba no probaría nada).
    assert A.acentuar_literal('"la direccion de la hipotesis"') == '"la dirección de la hipótesis"'  # sin tildes
    assert A.acentuar_literal('"""La `direccion` de la hipotesis y el campo `sintetico` se comparan"""') == '"""La `direccion` de la hipótesis y el campo `sintetico` se comparan"""'  # sin tildes
    # Varias, al principio y al final, y en una f-string con llaves.
    assert A.acentuar_literal('"`direccion` de la hipotesis `sintetico`"') == '"`direccion` de la hipótesis `sintetico`"'  # sin tildes
    assert A.acentuar_literal('f"la hipotesis {h[\'titulo\']} con `direccion` en la iteracion"') == 'f"la hipótesis {h[\'titulo\']} con `direccion` en la iteración"'  # sin tildes
    # Una comilla invertida suelta no es un tramo: el texto se acentúa igual.
    assert A.acentuar_literal('"la direccion ` de la hipotesis"') == '"la dirección ` de la hipótesis"'  # sin tildes
