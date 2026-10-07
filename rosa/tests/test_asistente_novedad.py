"""Descubrimiento de Novedad usando las lecturas existentes, sin modelos ni red."""

import json

from rosa import asistente as AS
from rosa.agentes_tratamiento import VERSION, huella
from rosa.estado.almacen import Almacen


def test_catalogo_anuncia_informes_y_lectura_completa_sin_inventar_origen(tmp_path):
    al = Almacen(tmp_path / "asistente.db")
    h = {"id": "h/1", "investigacionId": "inv espacio", "titulo": "Intervención A", "tarjeta": {"intervencion": "A"}}
    h["revisionTratamiento"] = {"version": VERSION, "huella": huella(h), "perfil": {"nombre": "A"},
        "patentes": {"estado": "no_comprobado", "resumen": "No pude comprobar", "limitaciones": ["La fuente no respondió"], "_intento": "cor:it"}}
    obsoleta = {"id": "h-2", "investigacionId": "otra", "titulo": "B",
                "revisionTratamiento": {"version": 0, "huella": "vieja", "companias": {"estado": "coincidencias"}}}
    al.mutar(lambda e: e.update(hipotesis=[h, obsoleta]) or True, "prueba")
    try:
        tools = {t.name: t.func for t in AS.herramientas(al, "global", [])}
        catalogo = json.loads(tools["catalogo_proyecto"]())
        assert catalogo["hipotesis"] == 2
        informes = catalogo["informesTratamiento"]
        assert informes["hipotesisConRevision"] == 2
        assert informes["vigentes"] == 1
        assert informes["informesPorEstado"] == {"patentes": {"no_comprobado": 1}, "companias": {"coincidencias": 1}}
        assert "leer_registro" in informes["lectura"]
        assert informes["ejemplos"][0]["ruta"] == "#/investigaciones/inv%20espacio/novedad/h%2F1"
        assert "corridaId" not in informes["ejemplos"][0]
        assert "_intento" not in json.dumps(catalogo)
        detalle = tools["leer_registro"]("hipotesis", "h/1", investigacion="inv espacio")
        assert "No pude comprobar" in detalle and "La fuente no respondió" in detalle
        assert "_intento" not in detalle and "vigente" in detalle
        assert "No hay un registro" in tools["leer_registro"]("hipotesis", "h/1", investigacion="otra")
    finally:
        al.cerrar()
