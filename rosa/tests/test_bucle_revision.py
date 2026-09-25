"""El bucle de revisión: el revisor devuelve el trabajo y quien lo escribió lo
rehace o lo rebate, con tres candados que no cuestan ninguna llamada.

Hasta el 25 de septiembre de 2026 el revisor de registro escribía sus hallazgos y
ahí se quedaban: 170 hallazgos en 33 iteraciones, los 170 abiertos, ninguno
atendido nunca. Lo que se comprueba aquí es lo que el bucle NO puede hacer:
cerrar un hallazgo sin tocar el texto, empeorar el resumen, absolverse con una
rebatida, ciclar, o dejar la publicación abierta sin decirlo. Sin red ni modelos.
"""

from types import SimpleNamespace
from typing import Any

import pytest

from rosa import revisor_registro as RR
from rosa.bucle import corrida as CO
from rosa.modulos import firmas as F
from rosa.tests.test_integracion_corrida import _preparar, _supervisor


def _hallazgo(hid: str = "h1", origen: str = "juez", gravedad: str = "alta", detalle: str = "El resumen dice «164 pg/mL» y la afirmación A1 dice 120 pg/mL") -> dict[str, Any]:
    return {"id": hid, "clase": "contradiccion_con_registro", "gravedad": gravedad, "detalle": detalle, "origen": origen, "estado": "abierto"}


def _revision(*hallazgos: dict[str, Any]) -> dict[str, Any]:
    return {"hallazgos": list(hallazgos), "porRegla": sum(1 for h in hallazgos if h["origen"] == "regla"), "juez": "sim-juez", "resumen": "El revisor comparó el resumen con el registro.", "fecha": 1, "estado": "con_hallazgos" if hallazgos else "limpia"}


def _rehecho(resumen: str, decision: str = "corregido", explicacion: str = "Se cambió la cifra por la del registro", hid: str = "h1") -> Any:
    return SimpleNamespace(rehecho=SimpleNamespace(decisiones=[SimpleNamespace(id=hid, decision=decision, explicacion=explicacion)], resumen=resumen, llano=None))


def _comprobado(sigue: bool, hid: str = "h1", nuevos: list[Any] | None = None) -> Any:
    return SimpleNamespace(revision=SimpleNamespace(veredictos=[SimpleNamespace(id=hid, sigue=sigue, motivo="lo miré en el registro")], hallazgos=nuevos or [], resumen="Comprobado."))


def _correr(monkeypatch, respuestas: dict[str, Any], revision: dict[str, Any], resumen: str = "GFAP sube 164 pg/mL en portadores.", llano: dict[str, Any] | None = None):
    import asyncio

    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, respuestas, monkeypatch)
    e = al.estado
    inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
    it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
    c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
    salida = asyncio.run(sup._reparar_resumen(ctx, inv, it, c, resumen, llano, revision))
    return salida, llamadas, al, ids


# -- La puerta de entrada --------------------------------------------------------


def test_sin_hallazgo_grave_no_se_abre_vuelta_y_no_se_gasta_nada(monkeypatch):
    for revision in (_revision(), _revision(_hallazgo(gravedad="media")), _revision(_hallazgo(gravedad="baja"))):
        salida, llamadas, _, _ = _correr(monkeypatch, {}, revision)
        assert salida is None and llamadas.vistas == [], "una vuelta que no hacía falta es una vuelta pagada de más"


def test_un_hallazgo_ya_atendido_o_descartado_no_reabre_la_vuelta(monkeypatch):
    for estado in ("atendido", "descartado"):
        salida, llamadas, _, _ = _correr(monkeypatch, {}, _revision({**_hallazgo(), "estado": estado}))
        assert salida is None and llamadas.vistas == []


def test_una_etapa_incumplida_no_abre_vuelta_porque_no_se_arregla_con_prosa(monkeypatch):
    """El choque que avisó el verificador: si abriera vuelta, el bucle cerraría el
    hallazgo reescribiendo el resumen PARA QUE MENCIONE la etapa rota. La etapa
    seguiría rota y el registro quedaría limpio. Blanqueo por prosa."""
    hz = {"id": "h9", "clase": "etapa_incumplida", "gravedad": "alta", "detalle": "la literatura no trajo nada", "origen": "regla", "estado": "abierto", "reparablePorTexto": False}
    salida, llamadas, _, _ = _correr(monkeypatch, {}, _revision(hz))
    assert salida is None and llamadas.vistas == []


# -- Quién rehace y quién comprueba ----------------------------------------------


def test_rehace_el_cerebro_y_comprueba_el_juez_nunca_al_reves(monkeypatch):
    """El juez no puede reescribir: estaría corrigiendo su propia nota. Y Sonnet no
    entra en ninguno de los dos papeles (TRASPASO.md 7.4)."""
    roles: list[tuple[str, str]] = []
    al, ids = _preparar()
    respuestas = {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores."), "revisar_reparacion": _comprobado(False)}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)

    async def espiar(self, rol, programa, **kw):
        roles.append((rol, programa))
        return respuestas[programa]

    monkeypatch.setattr(type(ctx), "llamar", espiar)
    import asyncio

    e = al.estado
    asyncio.run(sup._reparar_resumen(ctx, next(i for i in e["investigaciones"] if i["id"] == ids["inv"]), next(x for x in e["iteraciones"] if x["id"] == ids["it"]), next(x for x in e["corridas"] if x["id"] == ids["cor"]), "GFAP sube 164 pg/mL en portadores.", None, _revision(_hallazgo())))
    assert roles == [("cerebro", "rehacer_resumen"), ("juez", "revisar_reparacion")]
    assert "volumen" not in [r for r, _ in roles], "Sonnet no rehace ni juzga"


# -- CANDADO 2: el arreglo falso, que es el fallo de Yoon -------------------------


def test_el_juez_no_puede_cerrar_un_hallazgo_si_el_texto_no_cambio_donde_senalaba(monkeypatch):
    """El fallo del artículo: dar por resuelto lo que no se tocó. Aquí lo caza el
    código (RR.toco_el_texto), no otro modelo."""
    # El cerebro dice que lo corrigió y el juez lo da por resuelto, pero el «164
    # pg/mL» que el hallazgo señalaba sigue ahí, palabra por palabra.
    salida, _, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 164 pg/mL en portadores, y además NfL sube después."), "revisar_reparacion": _comprobado(False)}, _revision(_hallazgo()))
    assert salida is not None
    h = salida["revision"]["hallazgos"][0]
    assert h["estado"] == "abierto" and h["arregloFalso"] is True
    assert "no cambió donde el hallazgo señalaba" in h["comprobacion"]
    assert salida["revision"]["estado"] == "con_hallazgos"


def test_si_el_texto_cambio_de_verdad_donde_senalaba_el_hallazgo_queda_atendido(monkeypatch):
    salida, _, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores."), "revisar_reparacion": _comprobado(False)}, _revision(_hallazgo()))
    h = salida["revision"]["hallazgos"][0]
    assert h["estado"] == "atendido" and h["comprobacion"] == "juez" and h["vuelta"] == 1
    assert salida["resumen"] == "GFAP sube 120 pg/mL en portadores."
    assert salida["revision"]["estado"] == "limpia"


def test_si_el_juez_dice_que_sigue_el_hallazgo_sigue_abierto_diga_lo_que_diga_el_cerebro(monkeypatch):
    salida, _, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores."), "revisar_reparacion": _comprobado(True)}, _revision(_hallazgo()))
    assert salida["revision"]["hallazgos"][0]["estado"] == "abierto"


# -- La rebatida no absuelve -----------------------------------------------------


def test_una_rebatida_no_cierra_el_hallazgo_y_sigue_reteniendo_la_publicacion(monkeypatch):
    from rosa import priorizacion

    salida, _, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 164 pg/mL en portadores.", decision="rebatido", explicacion="La afirmación A1 dice 164, no 120"), "revisar_reparacion": _comprobado(True)}, _revision(_hallazgo()))
    h = salida["revision"]["hallazgos"][0]
    assert h["estado"] == "rebatido" and "A1 dice 164" in h["respuesta"]
    assert salida["revision"]["estado"] == "con_hallazgos"
    # Y la puerta de publicación lo sigue contando: la rebatida la escribe la misma
    # parte que escribió el texto.
    e = {"artefactos": [], "corridas": [{"id": "c", "investigacionId": "inv"}], "iteraciones": [{"corridaId": "c", "terminadaEn": 9, "revisionRegistro": salida["revision"]}]}
    assert priorizacion.revision_registro_abierta(e, {"investigacionId": "inv"}) is True


# -- CANDADO 1: las reglas son deterministas -------------------------------------


def test_un_hallazgo_de_regla_que_ya_no_salta_se_cierra_sin_preguntar_al_juez(monkeypatch):
    """39 de los 170 hallazgos reales son de regla: se resuelven volviendo a correr
    las reglas, que no cuesta nada. El juez solo ve los suyos."""
    hz = _hallazgo(origen="regla", detalle="El texto habla de ejecuciones y no hay ninguna completada")
    hz["clase"] = "calculo_no_ejecutado"
    salida, llamadas, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores.", hid="h1")}, _revision(hz), resumen="Se ejecutó el análisis y GFAP sube 164 pg/mL.")
    assert [p for p, _ in llamadas.vistas] == ["rehacer_resumen"], "sin hallazgos del juez no se llama al juez"
    h = salida["revision"]["hallazgos"][0]
    assert h["estado"] == "atendido" and h["comprobacion"] == "regla"


# -- CANDADO 3: la vuelta no puede empeorar --------------------------------------


def test_una_vuelta_que_empeora_el_texto_se_rechaza_y_se_vuelve_al_anterior(monkeypatch):
    """Gratis y determinista: las reglas se vuelven a correr enteras sobre el texto
    nuevo y, si pesan más, la vuelta se tira. Hace imposible que el bucle degrade el
    resumen."""
    # El "arreglo" mete un DOI que no está en el registro y afirma una ejecución.
    peor = "Se ejecutó el análisis y se reprodujo (10.1234/inventado.2026); GFAP sube 120 pg/mL."
    salida, llamadas, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho(peor), "revisar_reparacion": _comprobado(False)}, _revision(_hallazgo()))
    assert salida is not None
    assert salida["resumen"] == "GFAP sube 164 pg/mL en portadores.", "se vuelve al texto anterior"
    assert salida["revision"]["vueltas"][0]["estado"] == "rechazada"
    assert "empeoró el texto" in salida["revision"]["vueltas"][0]["motivo"]
    assert "revisar_reparacion" not in [p for p, _ in llamadas.vistas], "una vuelta rechazada no paga al juez"
    assert salida["revision"]["hallazgos"][0]["estado"] == "abierto"


# -- El tope, y que no cicla -----------------------------------------------------


def test_el_tope_de_vueltas_es_uno_y_el_maximo_son_dos_llamadas(monkeypatch):
    assert F.MAX_VUELTAS_REPARACION == 1, "Yoon no fija tope y una tarea se quedó colgada tras diez revisiones"
    salida, llamadas, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 164 pg/mL en portadores."), "revisar_reparacion": _comprobado(True)}, _revision(_hallazgo()))
    assert len(llamadas.vistas) == 2 and len(salida["revision"]["vueltas"]) == 1


def test_un_hallazgo_que_trae_el_arreglo_entra_marcado_y_no_dispara_otra_vuelta(monkeypatch):
    nuevo = SimpleNamespace(clase="cita_sin_soporte", gravedad="alta", detalle="La cita nueva no está en el registro")
    salida, llamadas, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores."), "revisar_reparacion": _comprobado(False, nuevos=[nuevo])}, _revision(_hallazgo()))
    assert len(salida["revision"]["hallazgos"]) == 2
    traido = salida["revision"]["hallazgos"][1]
    assert traido["nacidoEnVuelta"] == 1 and traido["estado"] == "abierto" and traido["origen"] == "juez"
    assert len(llamadas.vistas) == 2, "el tope de una vuelta manda: el hallazgo nuevo lo ve la iteración siguiente"


# -- Presupuesto y modelos: es lo único del cierre que no pausa la corrida -------


@pytest.mark.parametrize("fallo", [CO.PresupuestoAgotado("sin tope"), CO.ModeloSinRespuesta("cerebro", "openai/gpt-6-astra", 3, 1000)])
def test_sin_presupuesto_o_sin_modelo_no_se_pausa_la_corrida_y_se_dice(monkeypatch, fallo):
    """Los hallazgos abiertos ya retienen la publicación, así que nada se cuela. Y
    pausar una corrida entera después de haberlo pagado todo, para pulir un resumen,
    sale peor."""

    def lanza(kw: Any) -> Any:
        raise fallo

    salida, _, al, ids = _correr(monkeypatch, {"rehacer_resumen": lanza}, _revision(_hallazgo()))
    assert salida is not None
    assert salida["resumen"] == "GFAP sube 164 pg/mL en portadores.", "el texto se queda como estaba"
    v = salida["revision"]["vueltas"][0]
    assert v["estado"] == "no_hecha" and "siguen abiertos y retienen la publicación" in v["motivo"]
    assert salida["revision"]["hallazgos"][0]["estado"] == "abierto"
    corrida = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    assert corrida["estado"] == "en_marcha", "la reparación es la única parte del cierre que no pausa"


def test_si_el_juez_no_puede_comprobar_el_arreglo_no_queda_limpio(monkeypatch):
    """La regla de la casa: "no pude comprobar", nunca "está limpio"."""

    def lanza(kw: Any) -> Any:
        raise CO.ModeloSinRespuesta("juez", "anthropic/claude-opus-5", 3, 1000)

    salida, _, _, _ = _correr(monkeypatch, {"rehacer_resumen": _rehecho("GFAP sube 120 pg/mL en portadores."), "revisar_reparacion": lanza}, _revision(_hallazgo()))
    h = salida["revision"]["hallazgos"][0]
    assert h["estado"] == "abierto" and h["comprobacion"] == "no_comprobada"
    assert salida["revision"]["estado"] == "con_hallazgos"
    assert "No pude comprobar todos los arreglos" in salida["revision"]["resumen"]
    # El texto rehecho SÍ se conserva: se pagó y no empeoró (las reglas lo aprobaron).
    assert salida["resumen"] == "GFAP sube 120 pg/mL en portadores."


# -- El texto revisable, que antes dejaba fuera la mitad del llano ---------------


def test_el_revisor_ve_las_listas_del_llano_que_antes_no_veia():
    """Caza del 23 de septiembre: se unían solo los campos de texto, así que
    `mensajesClave`, `queEncontro`, `cambios` y `quePropone` no se revisaban, y son
    lo primero que lee la médica."""
    llano = {"titulo": "¿Sube GFAP antes?", "mensajesClave": ["GFAP sube 164 pg/mL antes que NfL"], "queHizo": "Se consultaron dos bases", "queEncontro": ["Dos cohortes lo apoyan"], "cambios": [], "quePropone": ["Si GFAP sube, entonces NfL sigue"], "terminos": [{"termino": "GFAP", "definicion": "x"}]}
    texto = RR.texto_revisable("Resumen técnico.", llano)
    assert texto.startswith("Resumen técnico."), "el resumen primero: si algo se recorta, que sea lo menos denso"
    for esperado in ("164 pg/mL", "Dos cohortes lo apoyan", "Si GFAP sube"):
        assert esperado in texto
    # Las listas que no son de texto (términos, que son objetos) no se aplanan a lo bruto.
    assert "definicion" not in texto
    # Sin llano, solo el resumen.
    assert RR.texto_revisable("Solo resumen.", None) == "Solo resumen."
    assert RR.texto_revisable("R.", {"_privado": "no sale", "titulo": "T"}) == "R.\n\ntitulo: T"
