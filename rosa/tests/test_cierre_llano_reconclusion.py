"""El resumen y el resumen en llano de una iteración se escriben antes de rehacer
las conclusiones (18 de septiembre de 2026, corrida 13): si una hipótesis sube o
baja de certeza en ese mismo cierre, el texto decía "todas mantienen una certeza
muy baja" con la ficha ya en "baja". El arreglo (rosa/bucle/cierre_texto.py,
aplicado dentro de `_cerrar_iteracion`) compara la certeza y la dirección de
cada hipótesis viva antes y después del cierre y, si algo cambió, pega por
regla un párrafo al final del resumen, del llano y del informe, y antepone un
aviso a lo que el llano afirmaba y ya no es. Sin pagar otra llamada al modelo.

Los cierres de punta a punta corren con un supervisor de dobles (`Ctx.llamar`
simulado por nombre de programa; nada sale al gateway). Con la hipótesis de
`_preparar` (dos cohortes de literatura) el techo por regla es "baja", así que
una conclusión vieja en "muy baja" con el juez en "baja" sube por regla, una
en "alta" baja por regla, y con la huella vieja el juez rehace y sube.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from typing import Any

from rosa import certeza as CERTEZA
from rosa.bucle import cierre_texto as CT
from rosa.bucle import corrida as CO
from rosa.tests.test_bucle_iteracion import palabras_sin_tilde
from rosa.tests.test_integracion_corrida import _hip, _pred_conclusion, _preparar, _supervisor
from rosa.tests.test_tanda1_corrida import _corrida, _it, _respuestas_cierre
from rosa.tests.test_tanda2_cierre import _conclusion_vieja

MANTIENEN = "Todas las hipótesis mantienen una certeza muy baja. La evidencia combina experimentos y asociaciones."


# ---------------------------------------------------------------------------
# Ayudantes
# ---------------------------------------------------------------------------


def _llano(limitaciones: str = MANTIENEN, mensajes: list[str] | None = None, cambios: list[str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(resumen=SimpleNamespace(titulo="Qué pasó", mensajes_clave=mensajes if mensajes is not None else ["Ninguna hipótesis supera la certeza muy baja por ahora.", "GFAP sube antes."], que_buscaba="a", que_hizo="b", que_encontro=["c"], limitaciones=limitaciones, cambios=cambios or [], que_propone=["e"], que_falta="Falta otra cohorte.", que_te_toca="g", terminos=[]))


def _conclusion_previa(al, ids, certeza: str, juez: str | None = None, huella_vieja: bool = False) -> None:
    """Una conclusión anterior conservable (huella al día, intento anotado) con
    el techo guardado en `certeza` y el juez en `juez`; con `huella_vieja` la
    huella no cuadra y el cierre paga al juez."""

    def fn(e):
        h = next(x for x in e["hipotesis"] if x["id"] == ids["hip"])
        h["conclusion"] = _conclusion_vieja(certeza, techo={"nivel": certeza, "motivo": "cuenta antigua", "acotada": False, "certezaDelJuez": juez or certeza})
        h["_conclusionIntentada"] = 0
        h["conclusion"]["huella"] = "vieja" if huella_vieja else CO.huella_de_conclusion(h)
        return True

    al.mutar(fn, "conclusion_previa")


def _cerrar(al, ids, respuestas, monkeypatch):
    sup, ctx, llamadas = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._cerrar_iteracion(_corrida(al, ids), _it(al, ids)))
    return llamadas


def _parrafo_de(al, ids) -> str:
    return _it(al, ids)["resumen"].splitlines()[-1]


def _eventos(al, tipo: str) -> list[dict[str, Any]]:
    return [x for x in al.estado["eventos"] if x["tipo"] == tipo]


def _informe(al, ids) -> str:
    a = next(x for x in al.estado["artefactos"] if x["investigacionId"] == ids["inv"] and x["nombre"].startswith("Informe de la iteración"))
    return a["versiones"][-1]["contenido"]


def _cambio(tipo: str, antes: str | None = "muy_baja", despues: str | None = "baja", titulo: str = "La normalización de P-tau181 predice el beneficio", **k: Any) -> dict[str, Any]:
    base = {"id": "h1", "titulo": titulo, "tipo": tipo, "certezaAntes": antes, "certezaDespues": despues, "direccionAntes": "apoya", "direccionDespues": "apoya", "techo": despues, "motivo": "solo literatura, sin experimento ni análisis sobre datos reales, aunque de 2 cohortes distintas"}
    base.update(k)
    return base


# ---------------------------------------------------------------------------
# De punta a punta con dobles: sube, baja, nada, llano ausente o raro, retomado
# ---------------------------------------------------------------------------


def test_una_subida_por_el_juez_se_cuenta_al_final_del_resumen_y_del_llano(monkeypatch):
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", huella_vieja=True)  # huella vieja: el juez rehace y dice "baja"
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 1 and [p for p, _ in llamadas.vistas].count("en_llano") == 1
    h, it = _hip(al, ids), _it(al, ids)
    assert h["conclusion"]["certeza"] == "baja" and "_cierre" not in it
    lineas = it["resumen"].splitlines()
    assert lineas[0] == "Resumen técnico de la iteración." and len(lineas) == 2
    parrafo = lineas[1]
    assert parrafo.startswith("En este cierre cambió la certeza de 1 hipótesis: «GFAP sube antes que NfL» subió de muy baja a baja (techo por regla: baja; ")
    assert parrafo.endswith("Ninguna bajó.") and "2 cohortes distintas" in parrafo
    llano = it["resumenLlano"]
    assert llano["cambios"] == [parrafo], "el párrafo va en la lista que la interfaz pinta como 'Qué cambió'"
    assert llano["limitaciones"] == f"{CT.AVISO_DESFASE} todas las hipótesis mantienen una certeza muy baja. La evidencia combina experimentos y asociaciones."
    assert llano["mensajesClave"][0].startswith(CT.AVISO_DESFASE) and llano["mensajesClave"][1] == "GFAP sube antes."
    assert llano["queFalta"] == "Falta otra cohorte." and llano["titulo"] == "Qué pasó"
    assert "cambiosDelCierre" not in llano
    assert _eventos(al, "revision_automatica") == [], "subir no es una alarma: sin evento"
    informe = _informe(al, ids)
    assert informe.rstrip().endswith(f"{CT.TITULO_INFORME}\n{parrafo}")
    assert palabras_sin_tilde([("resumen", it["resumen"]), ("limitaciones", llano["limitaciones"])]) == []
    al.cerrar()


def test_una_subida_por_regla_sin_pagar_al_juez_tambien_se_cuenta(monkeypatch):
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")  # techo viejo en muy baja; hoy la regla da baja: sube sin juez (M-14)
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 0, "la conclusión se conserva: el juez no cobra"
    h, it = _hip(al, ids), _it(al, ids)
    assert h["conclusion"]["certeza"] == "baja"
    parrafo = _parrafo_de(al, ids)
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in parrafo and parrafo.endswith("Ninguna bajó.")
    assert it["resumenLlano"]["cambios"] == [parrafo] and it["resumenLlano"]["limitaciones"].startswith(CT.AVISO_DESFASE)
    assert _eventos(al, "revision_automatica") == []
    al.cerrar()


def test_una_bajada_por_regla_se_cuenta_y_el_evento_revision_automatica_no_se_duplica(monkeypatch):
    al, ids = _preparar()
    _conclusion_previa(al, ids, "alta")  # por encima del techo de hoy (baja): baja por regla con su evento
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano(limitaciones="Todas las hipótesis mantienen una certeza alta.")}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 0
    h, it = _hip(al, ids), _it(al, ids)
    assert h["conclusion"]["certeza"] == "baja"
    parrafo = _parrafo_de(al, ids)
    assert parrafo.startswith("En este cierre cambió la certeza de 1 hipótesis: «GFAP sube antes que NfL» bajó de alta a baja (techo por regla: baja; ")
    assert parrafo.endswith("Ninguna subió.")
    ev = _eventos(al, "revision_automatica")
    assert len(ev) == 1 and "bajó de alta a baja al recalcular el techo por regla" in ev[0]["texto"], "el único evento es el del recálculo por regla; el párrafo no añade otro"
    assert len([x for x in al.estado["aprendizaje"] if x.get("nivel") == 1]) == 1
    llano = it["resumenLlano"]
    assert llano["limitaciones"] == f"{CT.AVISO_DESFASE} todas las hipótesis mantienen una certeza alta."
    assert llano["cambios"] == [parrafo]
    assert it["resumen"].count("En este cierre cambió") == 1
    al.cerrar()


def test_sin_cambios_de_certeza_no_se_anade_nada(monkeypatch):
    al, ids = _preparar()
    h = _hip(al, ids)
    assert CERTEZA.acotar("baja", h, [])["certeza"] == "baja"
    _conclusion_previa(al, ids, "baja")  # al día con la regla: ni juez ni recálculo
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 0
    it = _it(al, ids)
    assert it["resumen"] == "Resumen técnico de la iteración."
    llano = it["resumenLlano"]
    assert llano["cambios"] == [] and llano["limitaciones"] == MANTIENEN and "cambiosDelCierre" not in llano
    assert llano["mensajesClave"] == ["Ninguna hipótesis supera la certeza muy baja por ahora.", "GFAP sube antes."], "sin cambio en el cierre no se toca lo que escribió el modelo, aunque no cuadre"
    assert CT.TITULO_INFORME not in _informe(al, ids)
    assert "_cierre" not in it and _eventos(al, "revision_automatica") == []
    al.cerrar()


def test_la_primera_conclusion_no_es_un_cambio_de_certeza(monkeypatch):
    # Sin conclusión previa el juez escribe la primera: no hay nivel anterior que
    # comparar, el resumen queda como lo escribió el modelo (contrato de S-14).
    al, ids = _preparar()
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 1
    it = _it(al, ids)
    assert _hip(al, ids)["conclusion"]["certeza"] == "baja"
    assert it["resumen"] == "Resumen técnico de la iteración." and it["resumenLlano"]["cambios"] == []
    al.cerrar()


def test_con_el_llano_ausente_el_resumen_lleva_el_parrafo_y_nada_se_rompe(monkeypatch):
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")
    respuestas = _respuestas_cierre()
    del respuestas["en_llano"]  # el modelo del llano no responde: `_explicar_en_llano` devuelve None
    _cerrar(al, ids, respuestas, monkeypatch)
    it = _it(al, ids)
    assert it["terminadaEn"] is not None and it.get("resumenLlano") is None
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in _parrafo_de(al, ids)
    assert CT.TITULO_INFORME in _informe(al, ids)
    al.cerrar()


def test_con_el_llano_en_otro_formato_no_se_pisa_y_el_cierre_termina(monkeypatch):
    al, ids = _preparar()
    _conclusion_previa(al, ids, "muy_baja", juez="baja")
    raro = {"titulo": "x", "cambios": "no es una lista", "limitaciones": None, "mensajesClave": [1, None, "Todas mantienen una certeza muy baja"], "queFalta": 7}
    al.mutar(lambda e: CO._guardar_cierre_parcial(e, ids["it"], resumen="Resumen previo.", metaHecha=True, llano=copy.deepcopy(raro)), "cierre_parcial")
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("en_llano") == 0 and [p for p, _ in llamadas.vistas].count("resumir") == 0, "lo del cierre parcial no se repaga"
    it = _it(al, ids)
    assert it["terminadaEn"] is not None and "_cierre" not in it
    parrafo = _parrafo_de(al, ids)
    assert it["resumen"].startswith("Resumen previo.\n") and "subió de muy baja a baja" in parrafo
    llano = it["resumenLlano"]
    assert llano["cambios"] == "no es una lista" and llano["cambiosDelCierre"] == parrafo
    assert llano["limitaciones"] is None and llano["queFalta"] == 7
    assert llano["mensajesClave"][:2] == [1, None] and llano["mensajesClave"][2].startswith(CT.AVISO_DESFASE)
    al.cerrar()


def test_un_cierre_retomado_compara_contra_lo_de_antes_del_primer_intento(monkeypatch):
    # Primer intento (simulado): la instantánea guardada dice "muy baja"; la
    # conclusión ya se rehizo a "baja" y en este intento no cambia nada más.
    al, ids = _preparar()
    _conclusion_previa(al, ids, "baja")
    antes = {ids["hip"]: {"titulo": "GFAP sube antes que NfL", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya", "techo": "muy_baja", "motivoTecho": "", "motivoCambio": ""}}
    al.mutar(lambda e: CO._guardar_cierre_parcial(e, ids["it"], certezasAntes=antes), "cierre_parcial")
    llamadas = _cerrar(al, ids, {**_respuestas_cierre(), "en_llano": _llano()}, monkeypatch)
    assert [p for p, _ in llamadas.vistas].count("concluir") == 0
    assert "«GFAP sube antes que NfL» subió de muy baja a baja" in _parrafo_de(al, ids)
    al.cerrar()


def test_la_instantanea_de_antes_se_guarda_en_el_cierre_parcial_cuando_el_cierre_se_corta(monkeypatch):
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
    assert guardada[ids["hip"]]["certeza"] == "muy_baja" and guardada[ids["hip"]]["direccion"] == "apoya"
    al.cerrar()


# ---------------------------------------------------------------------------
# Las funciones puras
# ---------------------------------------------------------------------------


def test_cambios_de_certeza_distingue_subida_bajada_direccion_y_lo_que_no_cuenta():
    antes = {
        "sube": {"titulo": "S", "estado": "propuesta", "certeza": "muy_baja", "direccion": "apoya"},
        "baja": {"titulo": "B", "estado": "propuesta", "certeza": "moderada", "direccion": "apoya"},
        "gira": {"titulo": "G", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "igual": {"titulo": "I", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "rara": {"titulo": "R", "estado": "propuesta", "certeza": "desconocida", "direccion": "apoya"},
        "fuera": {"titulo": "F", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "sin": {"titulo": "N", "estado": "propuesta", "certeza": None, "direccion": None},
    }
    despues = {
        "sube": {"titulo": "S", "estado": "propuesta", "certeza": "baja", "direccion": "mixta", "techo": "baja", "motivoTecho": "dos cohortes", "motivoCambio": "x"},
        "baja": {"titulo": "B", "estado": "en_revision", "certeza": "muy_baja", "direccion": "apoya", "techo": "muy_baja", "motivoTecho": "", "motivoCambio": "Recálculo del techo por regla"},
        "gira": {"titulo": "G", "estado": "propuesta", "certeza": "baja", "direccion": "en_contra"},
        "igual": {"titulo": "I", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "rara": {"titulo": "R", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "fuera": {"titulo": "F", "estado": "descartada", "certeza": "muy_baja", "direccion": "apoya"},
        "sin": {"titulo": "N", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
        "nueva": {"titulo": "V", "estado": "propuesta", "certeza": "baja", "direccion": "apoya"},
    }
    cambios = {c["id"]: c for c in CT.cambios_de_certeza(antes, despues)}
    assert set(cambios) == {"sube", "baja", "gira", "rara"}, "la descartada, la igual y las que reciben su primera conclusión no cuentan"
    assert cambios["sube"]["tipo"] == "subio" and cambios["sube"]["direccionDespues"] == "mixta" and cambios["sube"]["motivo"] == "dos cohortes"
    assert cambios["baja"]["tipo"] == "bajo" and cambios["baja"]["motivo"] == "Recálculo del techo por regla", "sin motivo del techo vale el del cambio"
    assert cambios["gira"]["tipo"] == "direccion" and cambios["rara"]["tipo"] == "cambio"
    sin_direccion_antes = CT.cambios_de_certeza({"a": {"certeza": "baja", "direccion": None}}, {"a": {"estado": "p", "certeza": "baja", "direccion": "apoya"}})
    assert sin_direccion_antes == [], "una conclusión antigua sin dirección guardada no cambia de dirección al recibirla"
    con_subida = CT.cambios_de_certeza({"a": {"certeza": "muy_baja", "direccion": None}}, {"a": {"estado": "p", "certeza": "baja", "direccion": "apoya"}})
    assert con_subida[0]["tipo"] == "subio" and "dirección" not in CT.parrafo_de_cambios(con_subida)
    # Registros raros: nada explota y no se inventa un cambio.
    assert CT.cambios_de_certeza(None, despues) == [], "sin instantánea de antes no hay nivel anterior: ningún cambio"
    assert CT.cambios_de_certeza(antes, None) == [] and CT.cambios_de_certeza("x", {"a": "basura"}) == []
    assert CT.cambios_de_certeza({"a": {"certeza": "muy baja"}}, {"a": {"certeza": "muy_baja", "estado": "p"}}) == [], "'muy baja' y 'muy_baja' son el mismo nivel"


def test_instantanea_certezas_solo_tipos_simples_y_solo_la_investigacion():
    e = {"hipotesis": [
        {"id": "a", "investigacionId": "inv", "titulo": "A", "estado": "propuesta", "conclusion": {"certeza": "baja", "direccion": "apoya", "techo": {"nivel": "baja", "motivo": "m"}, "cambio": {"motivo": "c"}}},
        {"id": "b", "investigacionId": "inv", "titulo": "B", "estado": "propuesta", "conclusion": None},
        {"id": "c", "investigacionId": "otra", "titulo": "C", "estado": "propuesta", "conclusion": {"certeza": "alta"}},
        {"id": "d", "investigacionId": "inv", "titulo": "D", "conclusion": {"certeza": 3, "techo": "no es dict", "cambio": []}},
        "basura", None, {"investigacionId": "inv"},
    ]}
    s = CT.instantanea_certezas(e, "inv")
    assert set(s) == {"a", "b", "d"}
    assert s["a"] == {"titulo": "A", "breve": "", "estado": "propuesta", "certeza": "baja", "direccion": "apoya", "techo": "baja", "motivoTecho": "m", "motivoCambio": "c", "recalculadaEn": None}
    assert s["b"]["certeza"] is None and s["d"]["certeza"] is None and s["d"]["techo"] is None
    import json

    json.dumps(s)  # va al cierre parcial, que se guarda en SQLite
    assert CT.instantanea_certezas({}, "inv") == {} and CT.instantanea_certezas(None, "inv") == {}


def test_el_parrafo_dice_quien_subio_quien_bajo_y_por_que_sin_porcentajes():
    solo_sube = CT.parrafo_de_cambios([_cambio("subio")])
    assert solo_sube == "En este cierre cambió la certeza de 1 hipótesis: «La normalización de P-tau181 predice el beneficio» subió de muy baja a baja (techo por regla: baja; solo literatura, sin experimento ni análisis sobre datos reales, aunque de 2 cohortes distintas). Ninguna bajó."
    solo_baja = CT.parrafo_de_cambios([_cambio("bajo", "moderada", "muy_baja", titulo="GFAP sube antes", motivo="")])
    assert solo_baja == "En este cierre cambió la certeza de 1 hipótesis: «GFAP sube antes» bajó de moderada a muy baja (techo por regla: muy baja). Ninguna subió."
    ambas = CT.parrafo_de_cambios([_cambio("subio"), _cambio("bajo", "moderada", "baja", titulo="Otra", id="h2")])
    assert ambas.startswith("En este cierre cambió la certeza de 2 hipótesis: «La normalización") and "; «Otra» bajó de moderada a baja" in ambas
    assert "Ninguna" not in ambas
    con_giro = CT.parrafo_de_cambios([_cambio("subio", direccionAntes="apoya", direccionDespues="mixta")])
    assert "subió de muy baja a baja, y la dirección pasó de a favor a mixta (techo" in con_giro
    solo_giro = CT.parrafo_de_cambios([_cambio("direccion", "baja", "baja", direccionAntes="apoya", direccionDespues="en_contra")])
    assert solo_giro == "En este cierre no subió ni bajó la certeza de ninguna hipótesis que ya tuviera conclusión. Cambió la dirección de la evidencia de 1 hipótesis sin cambiar su certeza: «La normalización de P-tau181 predice el beneficio» pasó de a favor a en contra."
    sin_techo = CT.parrafo_de_cambios([_cambio("cambio", "rara", "baja", techo=None, motivo="el juez dejó esto")])
    assert "pasó de rara a baja (el juez dejó esto)" in sin_techo
    assert CT.parrafo_de_cambios([]) == "" and CT.parrafo_de_cambios(None) == "" and CT.parrafo_de_cambios(["x", {"tipo": "primera"}]) == ""
    for texto in (solo_sube, solo_baja, ambas, con_giro, solo_giro):
        assert "%" not in texto and "demostrad" not in texto and "confirmad" not in texto and "\u2014" not in texto
    assert palabras_sin_tilde([("p", t) for t in (solo_sube, solo_baja, ambas, con_giro, solo_giro, sin_techo)]) == []


def test_el_parrafo_nombra_hasta_seis_y_cuenta_el_resto_y_recorta_titulos_y_motivos_largos():
    muchas = [_cambio("subio", id=f"h{i}", titulo=f"Hipótesis número {i}") for i in range(9)]
    p = CT.parrafo_de_cambios(muchas)
    assert p.startswith("En este cierre cambió la certeza de 9 hipótesis: ") and "; y 3 más." in p and "«Hipótesis número 6»" not in p
    assert p.endswith("Ninguna bajó.")
    largo = CT.parrafo_de_cambios([_cambio("subio", titulo="palabra " * 40, motivo="motivo " * 60)])
    assert "..." in largo and len(largo) < 500
    sin_titulo = CT.parrafo_de_cambios([_cambio("bajo", "baja", "muy_baja", titulo="")])
    assert "una hipótesis sin título bajó de baja a muy baja" in sin_titulo


def test_frase_desfasada_reconoce_las_variantes_y_no_dispara_sin_motivo():
    subio = [_cambio("subio")]
    for frase in (
        "Todas las hipótesis mantienen una certeza muy baja.",
        "Todas las hip" + "otesis mantienen una certeza muy baja",  # sin tilde (en dos trozos para que el escáner de tildes no la marque)
        "La certeza sigue siendo muy baja en las tres.",
        "Las hipótesis siguen con certeza muy baja.",
        "Ninguna hipótesis pasa de una certeza muy baja.",
        "La normalización de P-tau181 pasó a recibir apoyo, siempre con certeza muy baja.",  # nombra a la que subió
        "La certeza se mantiene muy baja.",
        "La certeza no cambió: muy baja.",
    ):
        assert CT.frase_desfasada(frase, subio), frase
    # Lo que afirma el nivel al que se llegó no está desfasado.
    assert not CT.frase_desfasada("Todas las hipótesis mantienen una certeza baja.", subio)
    assert not CT.frase_desfasada("Todas mantienen una certeza muy baja.", [_cambio("bajo", "baja", "muy_baja")])
    # Una frase sobre una hipótesis concreta que no es la que cambió sigue siendo
    # verdad (19 de septiembre: el aviso va por hipótesis, no por nivel global).
    assert not CT.frase_desfasada("La concordancia pasó a recibir apoyo, siempre con certeza muy baja.", subio)
    # Mencionar un nivel sin decir que se mantiene no es una afirmación desfasada.
    assert not CT.frase_desfasada("Nació una hipótesis nueva con certeza muy baja.", subio)
    assert not CT.frase_desfasada("La certeza muy baja es el punto de partida.", subio)
    # Un cambio solo de dirección no desfasa frases sobre la certeza.
    assert not CT.frase_desfasada("Todas las hipótesis mantienen una certeza muy baja.", [_cambio("direccion", "muy_baja", "muy_baja", direccionDespues="mixta")])
    # Registros raros.
    assert not CT.frase_desfasada(None, subio) and not CT.frase_desfasada("", subio) and not CT.frase_desfasada("Todas mantienen una certeza muy baja", None)
    assert not CT.frase_desfasada("Todas mantienen una certeza muy baja", ["x", {"tipo": "subio"}])


def test_anteponer_aviso_respeta_siglas_y_es_idempotente():
    assert CT.anteponer_aviso("Todas mantienen una certeza muy baja.") == f"{CT.AVISO_DESFASE} todas mantienen una certeza muy baja."
    assert CT.anteponer_aviso("GFAP sube antes que NfL.") == f"{CT.AVISO_DESFASE} GFAP sube antes que NfL."
    una_vez = CT.anteponer_aviso("  Todas mantienen una certeza muy baja. ")
    assert CT.anteponer_aviso(una_vez) == una_vez
    assert CT.anteponer_aviso("") == CT.AVISO_DESFASE + " " and CT.anteponer_aviso("a") == f"{CT.AVISO_DESFASE} a"


def test_llano_con_cambios_en_cada_formato():
    parrafo = CT.parrafo_de_cambios([_cambio("subio")])
    cambios = [_cambio("subio")]
    # Diccionario normal: párrafo al final de `cambios`, aviso donde toca, dos pasadas no duplican.
    llano = {"titulo": "Todas mantienen una certeza muy baja", "mensajesClave": ["Todas mantienen una certeza muy baja.", "Otra cosa."], "queBuscaba": "a", "queHizo": "b", "queEncontro": ["c"], "limitaciones": "Todas mantienen una certeza muy baja.", "cambios": ["X: la normalización de P-tau181 pasó a recibir apoyo, siempre con certeza muy baja."], "quePropone": [], "queFalta": "f", "queTeToca": "g", "colaPorRegla": "Todas mantienen una certeza muy baja", "aprendizaje": "Todas mantienen una certeza muy baja", "terminos": []}
    r = CT.llano_con_cambios(llano, parrafo, cambios)
    assert r is llano
    assert llano["cambios"] == [f"{CT.AVISO_DESFASE} X: la normalización de P-tau181 pasó a recibir apoyo, siempre con certeza muy baja.", parrafo], "una letra sola se conserva: puede ser una sigla"
    assert llano["mensajesClave"] == [f"{CT.AVISO_DESFASE} todas mantienen una certeza muy baja.", "Otra cosa."]
    assert llano["limitaciones"].startswith(CT.AVISO_DESFASE)
    assert llano["titulo"] == "Todas mantienen una certeza muy baja" and llano["colaPorRegla"] == "Todas mantienen una certeza muy baja" and llano["aprendizaje"] == "Todas mantienen una certeza muy baja", "lo que va por regla o es el título no se toca"
    copia = copy.deepcopy(llano)
    CT.llano_con_cambios(llano, parrafo, cambios)
    assert llano == copia, "idempotente"
    # Sin `cambios`: se crea. Con `cambios` de otra forma: no se pisa, el párrafo va aparte.
    sin = {"limitaciones": "x"}
    assert CT.llano_con_cambios(sin, parrafo, cambios)["cambios"] == [parrafo]
    otro = {"cambios": "texto", "limitaciones": None, "mensajesClave": "no es lista", "queEncontro": [None, 3]}
    assert CT.llano_con_cambios(otro, parrafo, cambios) == {"cambios": "texto", "limitaciones": None, "mensajesClave": "no es lista", "queEncontro": [None, 3], "cambiosDelCierre": parrafo}
    # Texto: se pega al final. Ausente u otra cosa: None (nada que escribir). Sin párrafo: None.
    assert CT.llano_con_cambios("Un resumen en texto.", parrafo, cambios) == f"Un resumen en texto.\n\n{parrafo}"
    assert CT.llano_con_cambios("", parrafo, cambios) == parrafo
    assert CT.llano_con_cambios(None, parrafo, cambios) is None and CT.llano_con_cambios(42, parrafo, cambios) is None and CT.llano_con_cambios([], parrafo, cambios) is None
    assert CT.llano_con_cambios({"cambios": []}, "", cambios) is None


def test_resumen_e_informe_con_cambios():
    parrafo = CT.parrafo_de_cambios([_cambio("subio")])
    assert CT.resumen_con_cambios("Resumen.\nSegunda línea.  ", parrafo) == f"Resumen.\nSegunda línea.\n{parrafo}"
    assert CT.resumen_con_cambios("", parrafo) == parrafo and CT.resumen_con_cambios(None, parrafo) == parrafo
    assert CT.resumen_con_cambios("Resumen.", "") == "Resumen." and CT.resumen_con_cambios(None, "") is None
    assert CT.resumen_con_cambios(f"Resumen.\n{parrafo}", parrafo) == f"Resumen.\n{parrafo}", "idempotente"
    informe = "# Título\n\nResumen.\n\n## Plan ejecutado\n- x\n"
    con = CT.informe_con_cambios(informe, parrafo)
    assert con == f"{informe.rstrip()}\n\n{CT.TITULO_INFORME}\n{parrafo}" and CT.informe_con_cambios(con, parrafo) == con
    assert CT.informe_con_cambios(informe, "") == informe and CT.informe_con_cambios(None, parrafo) is None


def test_texto_del_cierre_sobre_un_estado():
    e = {"hipotesis": [{"id": "a", "investigacionId": "inv", "titulo": "A", "estado": "propuesta", "conclusion": {"certeza": "baja", "direccion": "apoya", "techo": {"nivel": "baja", "motivo": "dos cohortes"}}}]}
    antes = {"a": {"certeza": "muy_baja", "direccion": "apoya"}}
    cambios, parrafo = CT.texto_del_cierre(antes, e, "inv")
    assert [c["tipo"] for c in cambios] == ["subio"] and parrafo.startswith("En este cierre cambió la certeza de 1 hipótesis: «A» subió de muy baja a baja (techo por regla: baja; dos cohortes). Ninguna bajó.")
    assert CT.texto_del_cierre(CT.instantanea_certezas(e, "inv"), e, "inv") == ([], "")
    assert CT.texto_del_cierre(None, e, "inv") == ([], ""), "sin instantánea de antes no se inventa un cambio"
