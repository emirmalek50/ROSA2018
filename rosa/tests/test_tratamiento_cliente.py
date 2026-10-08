"""El navegador no puede presentar un informe antiguo como revisión actual."""

from copy import deepcopy

from rosa.agentes_tratamiento import PROTOCOLO_PATENTES, VERSION, huella
from rosa.agentes_tratamiento import _acotar_recuperacion
from rosa.estado.almacen import _limpiar_para_cliente


def test_la_vigencia_se_calcula_sin_exponer_fuentes_borradores_o_intentos_privados():
    h = {"id": "h", "investigacionId": "inv", "titulo": "Intervención A",
         "tarjeta": {"intervencion": "A"}, "experimento": {"via": "oral"}}
    h["revisionTratamiento"] = {"version": VERSION, "huella": huella(h),
                               "patentes": {"estado": "coincidencias", "protocoloPatentes": PROTOCOLO_PATENTES, "_intento": "cor:it"}}
    estado = {"hipotesis": [h], "corridas": [{"_revisionTratamientoFuentes": {"h": "fuentes y borradores privados"}}]}
    original = deepcopy(estado)
    limpio = _limpiar_para_cliente(estado)
    assert limpio["hipotesis"][0]["revisionTratamiento"]["vigente"] is True
    assert "_intento" not in limpio["hipotesis"][0]["revisionTratamiento"]["patentes"]
    assert limpio["corridas"] == [{}]
    assert estado == original
    h["tarjeta"]["intervencion"] = "B"
    assert _limpiar_para_cliente(estado)["hipotesis"][0]["revisionTratamiento"]["vigente"] is False


def test_cambiar_estado_del_laboratorio_no_invalida_la_identidad():
    h = {"id": "h", "investigacionId": "inv", "titulo": "Intervención A", "experimento": {"via": "oral"}}
    h["revisionTratamiento"] = {"version": VERSION, "huella": huella(h), "patentes": {"protocoloPatentes": PROTOCOLO_PATENTES}}
    h["experimento"].update(estado="asignado", laboratorio="Lab")
    assert _limpiar_para_cliente(h)["revisionTratamiento"]["vigente"] is True


def test_publicacion_conserva_origen_por_informe_y_no_atribuye_historicos():
    h = {"id": "h", "investigacionId": "inv", "titulo": "A"}
    h["revisionTratamiento"] = {"version": VERSION, "huella": huella(h),
        "patentes": {"hipotesisId": "h", "corridaId": "cor-1", "iteracionId": "it-1", "_intento": "cor-1:it-1"},
        "companias": {"_intento": "cor-0:it-0"}}
    original = deepcopy(h)
    informes = _limpiar_para_cliente(h)["revisionTratamiento"]
    assert informes["patentes"] == {"hipotesisId": "h", "corridaId": "cor-1", "iteracionId": "it-1"}
    assert informes["companias"] == {}
    assert h == original


def test_el_corpus_reserva_fuentes_web_y_limita_tamano_antes_del_checkpoint():
    documentos = [{"id": str(i), "fuente": "ClinicalTrials.gov", "texto": "a" * 16000} for i in range(100)]
    documentos.append({"id": "web", "fuente": "Web (Exa)", "texto": "Programa preclínico"})
    rec = {"documentos": documentos, "consultas": [{"recuperados": 101}], "limitaciones": []}
    reducido = _acotar_recuperacion(rec)
    assert len(reducido["documentos"]) == 20
    assert any(d["id"] == "web" for d in reducido["documentos"])
    assert all(len(d["texto"]) <= 12000 for d in reducido["documentos"])
    assert reducido["consultas"][0]["recuperados"] == 101
    assert any("no es exhaustiva" in s for s in reducido["limitaciones"])
    assert len(rec["documentos"]) == 101
