"""La revisión mantiene su procedencia en la interfaz, el asistente y el dossier."""
import json

from rosa import asistente as AS, revision_agora as AG, rocrate
from rosa.estado.almacen import _limpiar_para_cliente
from rosa.tests.test_integracion_corrida import _preparar


def test_el_estado_legacy_no_afirma_ausencia_ni_inexistencia_de_api():
    h = {"novedad": {"agora": {"estado": "no_nominada", "detalle": "No comprobado: Agora no tiene API pública estable. No se afirma ausencia."}}}
    salida = _limpiar_para_cliente(h)
    assert salida["novedad"]["agora"]["estado"] == "no_comprobado"
    assert "API pública estable" not in salida["novedad"]["agora"]["detalle"]
    assert h["novedad"]["agora"]["estado"] == "no_nominada"


def test_dossier_rocrate_y_asistente_preservan_origen_y_datos_completos():
    al, ids = _preparar()
    try:
        def preparar(e):
            h = next(h for h in e["hipotesis"] if h["id"] == ids["hip"])
            c = next(c for c in e["corridas"] if c["id"] == ids["cor"])
            h["revisionAgora"] = {"version": AG.VERSION, "versionHipotesis": h["version"], "huella": AG.huella(h),
                "hipotesisId": h["id"], "corridaId": c["id"], "estado": "parcial", "resumen": "Falta una modalidad",
                "genes": [{"consultado": "GFAP", "simbolo": "GFAP", "ensembl": "ENSG00000131095", "secciones": []}], "limitaciones": ["Proteómica no comprobada"]}
            c["_revisionAgoraDatos"] = {"GFAP": {"resultado": {"datos": list(range(30)), "advertencias": ["Proteómica no comprobada"]}}}
            return True
        al.mutar(preparar, "preparar_agora")
        h = next(h for h in al.estado["hipotesis"] if h["id"] == ids["hip"])
        publico = al.instantanea()
        hp = next(h for h in publico["hipotesis"] if h["id"] == ids["hip"])
        assert hp["revisionAgora"]["vigente"] is True
        assert "_revisionAgoraDatos" not in json.dumps(publico)
        paquete = rocrate.armar(al.estado, h, 2000)
        exportado = json.loads(paquete["ficheros"]["agora.json"])
        assert exportado["genes"]["GFAP"]["resultado"]["datos"] == list(range(30))
        assert "Proteómica no comprobada" in paquete["ficheros"]["dossier.md"].decode()
        assert any(p.get("@id") == "agora.json" and p.get("sha256") for p in paquete["metadata"]["@graph"])
        tools = {t.name: t.func for t in AS.herramientas(al, "global", [])}
        catalogo = json.loads(tools["catalogo_proyecto"]())
        assert catalogo["informesAgora"]["hipotesisConRevision"] == 1
        assert catalogo["informesAgora"]["vigentes"] == 1
        assert "revisionAgora" in tools["leer_registro"]("hipotesis", h["id"], investigacion=ids["inv"])
        h["titulo"] = "Diana modificada"
        assert _limpiar_para_cliente(h)["revisionAgora"]["vigente"] is False
        assert "histórica" in AG.texto_revision(h)
    finally:
        al.cerrar()
