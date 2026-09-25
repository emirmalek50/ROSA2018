"""Integración de ROSA2018 en la corrida (16 de septiembre de 2026): la ruta
terapéutica se escribe al concluir y al evaluar el laboratorio; el contrato del
experimento entra con la propuesta; el resultado se juzga por lectura; al cerrar
la iteración la investigación recibe el mapa de la enfermedad, el mapa de ruta y
las cifras de aprendizaje; el dossier y el contexto los enseñan; y el servidor
los sirve. Todo con modelos simulados: una `llamar` falsa responde según el
programa y lanza para los demás (los caminos con try/except tienen que aguantar)."""

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from rosa import config
from rosa import cuestiones as CU
from rosa import experimento as XP
from rosa.bucle import contexto as T
from rosa.bucle import corrida as CO
from rosa.bucle.pasos import Ctx
from rosa.dossier import texto_dossier
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.servidor import crear_app


# ---------------------------------------------------------------------------
# Estado y modelos simulados
# ---------------------------------------------------------------------------


def _af(texto="GFAP en plasma sube antes que NfL en portadores de APOE4", veredicto="sostenida", cohorte="BioFINDER", tipo="dato"):
    return {"afirmacionId": P.nuevo_id("af"), "texto": texto, "cita": "[Kim 2025, p. 3]", "veredicto": veredicto, "motivo": "", "entidadDistinta": False, "tipo": tipo, "clase": "literatura", "sintetico": False, "cohorte": cohorte, "trayectoria": None, "fragmento": texto}


def _preparar():
    """Un almacén en un fichero temporal con una investigación con misión, una
    corrida en marcha, una iteración abierta y una hipótesis con evidencia."""
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")

    def fn(e):
        inv_id = A.crear_investigacion(e, {"titulo": "GFAP y astrocitos", "objetivo": "Orden de alteración de GFAP y NfL en la fase preclínica", "condicionParada": "3 iteraciones"}, 1000)
        inv = next(i for i in e["investigaciones"] if i["id"] == inv_id)
        inv["mision"] = {"poblacion": "portadores de APOE4 con amiloide positivo", "etapa": "preclínica", "celulaTejido": "astrocitos del hipocampo", "mecanismo": "activación astrocitaria", "tipoIntervencion": "sin intervención", "capacidadesLaboratorio": ["inmunoensayo en plasma"]}
        c = P.nueva_corrida(inv_id, 1, 1000)
        c["estado"] = "en_marcha"
        e["corridas"].append(c)
        it = P.nueva_iteracion(c["id"], 1, 1000, [])
        it["planAprobado"] = True
        e["iteraciones"].append(it)
        h = P.nueva_hipotesis(inv_id, 1, 1000, titulo="GFAP sube antes que NfL", enunciado="En portadores de APOE4 con amiloide positivo, GFAP en plasma se altera antes que NfL", mecanismo="La activación de los astrocitos precede al daño axonal",
                              comprobacion={"biomarcador": "GFAP", "cohorte": "BioFINDER", "diseno": "cohorte"}, afirmaciones=[_af(), _af("NfL en plasma sube después de GFAP", cohorte="Knight ADRC")])
        h["procedencia"]["fuentes"] = [{"id": "kim", "referencia": "Kim, 2025", "titulo": "GFAP", "cohorte": "BioFINDER"}, {"id": "xie", "referencia": "Xie, 2026", "titulo": "NfL", "cohorte": "Knight ADRC"}]
        h["tarjeta"] = {**P.tarjeta_vacia(), "diana": "GFAP", "celula": "astrocitos", "etapa": "preclínica", "intervencion": "ninguna", "direccion": "sin_intervencion", "prediccionFalsable": "GFAP sube antes que NfL", "riesgos": [], "pasoRuta": "mecanismo"}
        e["_ids"] = {"inv": inv_id, "cor": c["id"], "it": it["id"], "hip": h["id"]}
        e["hipotesis"].append(h)
        return True

    al.mutar(fn, "preparar")
    ids = al.estado.pop("_ids")
    return al, ids


class Llamadas:
    """La `llamar` falsa: responde por nombre de programa; lo demás lanza."""

    def __init__(self, respuestas):
        self.respuestas = respuestas
        self.vistas = []

    async def __call__(self, ctx, rol, programa, **kw):
        self.vistas.append((programa, kw))
        if programa not in self.respuestas:
            raise RuntimeError(f"programa simulado sin respuesta: {programa}")
        r = self.respuestas[programa]
        return r(kw) if callable(r) else r


def _supervisor(al, ids, respuestas, monkeypatch):
    llamadas = Llamadas(respuestas)

    async def llamar(self, rol, programa, **kw):
        return await llamadas(self, rol, programa, **kw)

    monkeypatch.setattr(Ctx, "llamar", llamar)  # simulación local; el módulo real llama por el gateway
    programas = SimpleNamespace(concluir="concluir", experimento="experimento", evaluar_resultado="evaluar_resultado", derivar="derivar", resumir="resumir", en_llano="en_llano", revisar_registro="revisar_registro", asignar_evidencia="asignar_evidencia", meta="meta", killer="killer", hipotesis_en_llano="hipotesis_en_llano")
    modelos = SimpleNamespace(cerebro=SimpleNamespace(model="sim-cerebro"), juez=SimpleNamespace(model="sim-juez"), volumen=SimpleNamespace(model="sim-volumen"))
    sup = CO.Supervisor(al, programas, modelos)
    ctx = Ctx(al, programas, modelos, ids["cor"], ids["inv"], ids["it"], 1)
    return sup, ctx, llamadas


def _pred_conclusion():
    factor = SimpleNamespace(factor="evidencia_indirecta", efecto="baja", explicacion="Solo literatura, sin datos propios")
    return SimpleNamespace(conclusion=SimpleNamespace(hipotesis_breve="GFAP se altera antes que NfL", certeza="baja", direccion="apoya", conclusion="Puede que GFAP se altere antes.", factores=[factor], a_favor=["Kim 2025"], en_contra=[], lo_mas_fragil="una sola plataforma", subiria="otra cohorte", bajaria="orden inverso en otra cohorte"))


def _lecturas():
    return [
        SimpleNamespace(nombre="fosforilación de STAT3", tipo="compromiso_diana", que_confirma="fosforilación de STAT3 baja al menos un 50 %", que_refuta="bajada menor del 10 %", control="vehículo", unidad="% del control"),
        SimpleNamespace(nombre="GFAP en plasma", tipo="funcion_mecanismo", que_confirma="aumento de GFAP mayor del 20 %", que_refuta="cambio menor del 5 %", control="cultivo sin tratar", unidad="%"),
    ]


def _pred_experimento(con_contrato=True):
    base = dict(protocolo=["Cultivar astrocitos humanos de donante", "Tratar con el inhibidor", "Medir GFAP a las 48 h", "Comparar con vehículo"], ensayo="Inmunoensayo de GFAP", resultado_que_confirma="GFAP sube más del 20 %", resultado_que_refuta="GFAP no cambia", controles="vehículo y control positivo", tamano_muestral="n = 6 por grupo", alternativa="estrés del cultivo", coste_estimado="dos semanas", analisis_pedido="", decision_que_cambia="si confirma, pasa a organoide")
    if con_contrato:
        base.update(lecturas=_lecturas(), sistema=SimpleNamespace(tipo="celulas_humanas_donante", que_prueba="que la diana responde en astrocitos humanos", que_no_representa=""), proposito_biomarcador="monitorizacion", nivel_desenlace="celular", puente_al_beneficio="un cambio celular no es beneficio clínico; haría falta el paso a organoide y después a cohorte")
    return SimpleNamespace(experimento=SimpleNamespace(**base))


def _pred_resultado(veredicto, clasificacion, cifras):
    dm = SimpleNamespace(fallo_tecnico=False, inconcluso=veredicto == "inconcluso", efecto_pequeno_interpretable=False, efecto_predicho=veredicto == "confirma", efecto_inesperado=False, toxicidad=False, nota="una sola dimensión")
    return SimpleNamespace(resultado=SimpleNamespace(veredicto=veredicto, clasificacion=clasificacion, dimensiones=dm, contexto_corregido="", resultado=f"Resultado {veredicto} contra el prerregistro.", motivo="Se aplicaron los criterios congelados.", limitaciones="n pequeño", cifras=[SimpleNamespace(nombre=n, valor=v) for n, v in cifras], exploratorio=""))


def _hip(al, ids):
    return next(h for h in al.estado["hipotesis"] if h["id"] == ids["hip"])


# ---------------------------------------------------------------------------
# Ruta al concluir
# ---------------------------------------------------------------------------


def test_concluir_escribe_la_ruta_con_ocho_pasos(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {"concluir": _pred_conclusion()}, monkeypatch)
    h = _hip(al, ids)
    assert "ruta" not in h or h.get("ruta") is None  # registro anterior: la clave puede no existir
    asyncio.run(sup._concluir_hipotesis(ctx, h))
    h = _hip(al, ids)
    assert h["conclusion"]["certeza"] in ("baja", "muy_baja")
    ruta = h["ruta"]
    assert ruta["hipotesisId"] == h["id"] and len(ruta["pasos"]) == 8
    assert {p["paso"] for p in ruta["pasos"]} >= {"mecanismo", "evidencia_poblacion"}
    assert all(p["estado"] in ("cubierto", "parcial", "vacio", "no_comprobable") for p in ruta["pasos"])
    assert ruta["declarado"] == "mecanismo" and isinstance(ruta["coherente"], bool) and ruta["resumen"]


def test_si_el_juez_falla_no_hay_conclusion_ni_ruta_y_nada_se_rompe(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {}, monkeypatch)
    asyncio.run(sup._concluir_hipotesis(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    assert h.get("conclusion") is None and h.get("ruta") is None and h["_conclusionIntentada"] == 1


def test_un_fallo_de_la_regla_de_ruta_no_tumba_la_conclusion(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {"concluir": _pred_conclusion()}, monkeypatch)
    _hip(al, ids)["ruta"] = {"anterior": True}

    def rompe(e, h):
        raise ValueError("regla rota a propósito")

    monkeypatch.setattr(CO.RUTA, "evaluar_ruta", rompe)
    asyncio.run(sup._concluir_hipotesis(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    assert h["conclusion"] and h["ruta"] == {"anterior": True}  # se conserva la ruta anterior


# ---------------------------------------------------------------------------
# Contrato del experimento
# ---------------------------------------------------------------------------


def test_proponer_experimento_guarda_lecturas_sistema_y_problemas(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {"experimento": _pred_experimento()}, monkeypatch)
    asyncio.run(sup._proponer_experimento(ctx, _hip(al, ids)))
    x = _hip(al, ids)["experimento"]
    assert x["estado"] == "propuesto" and x["protocolo"].startswith("1. ")
    assert [l["nombre"] for l in x["lecturas"]] == ["fosforilación de STAT3", "GFAP en plasma"]
    assert x["lecturas"][0]["tipo"] == "compromiso_diana" and x["lecturas"][0]["queConfirma"].startswith("fosforilación")
    assert x["sistema"]["tipo"] == "celulas_humanas_donante" and x["sistema"]["quePrueba"].startswith("que la diana")
    assert x["propositoBiomarcador"] == "monitorizacion" and x["nivelDesenlace"] == "celular" and x["puenteAlBeneficio"]
    assert isinstance(x["problemasContrato"], list) and isinstance(x["hashLecturas"], str) and len(x["hashLecturas"]) == 64
    assert x["hashLecturas"] == XP.hash_lecturas(x)
    registro = _hip(al, ids)["procedencia"]["registro"]
    assert any(r.startswith("contrato del experimento: 2 lecturas, sistema ") and "problema" in r for r in registro)
    assert not any("celulas_humanas_donante" in r for r in registro)  # la etiqueta legible, no la clave


def test_una_firma_antigua_sin_contrato_deja_los_campos_vacios_y_lo_dice(monkeypatch):
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {"experimento": _pred_experimento(con_contrato=False)}, monkeypatch)
    asyncio.run(sup._proponer_experimento(ctx, _hip(al, ids)))
    x = _hip(al, ids)["experimento"]
    assert x["lecturas"] == [] and x["sistema"] is None and x["propositoBiomarcador"] is None
    # Por regla, el contrato antiguo se juzga por lo que decía (ensayo, confirma, refuta
    # valen como una lectura) y le faltan el sistema, el propósito BEST y el nivel.
    assert any("sistema experimental" in p for p in x["problemasContrato"]) and any("nivel del desenlace" in p for p in x["problemasContrato"])
    assert any(r.startswith("contrato del experimento: 0 lecturas, sistema no declarado") for r in _hip(al, ids)["procedencia"]["registro"])


def test_el_texto_del_proponente_lleva_el_perfil_de_la_diana(monkeypatch):
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, {"experimento": _pred_experimento()}, monkeypatch)
    h = _hip(al, ids)
    h["perfilDiana"] = {"version": 1, "diana": "GFAP", "identificadores": {"ensembl": "ENSG00000131095"}, "capas": [{"capa": "expresion_celular", "estado": "presente", "detalle": "HPA: astrocitos", "direccion": None, "conectores": ["hpa_expresion"]}]}
    asyncio.run(sup._proponer_experimento(ctx, h))
    programa, kw = llamadas.vistas[0]
    assert programa == "experimento" and "Perfil de evidencia por diana: GFAP" in kw["hipotesis"]
    # Sin perfil (registro antiguo) el texto dice que no se consultó, no rompe.
    al2, ids2 = _preparar()
    sup2, ctx2, llamadas2 = _supervisor(al2, ids2, {"experimento": _pred_experimento()}, monkeypatch)
    asyncio.run(sup2._proponer_experimento(ctx2, _hip(al2, ids2)))
    assert "sin consultar" in llamadas2.vistas[0][1]["hipotesis"]


# ---------------------------------------------------------------------------
# Veredicto por lectura y lectura del negativo
# ---------------------------------------------------------------------------


def _con_experimento_asignado(al, ids, tmp_path, monkeypatch, con_fichero=True):
    from rosa import datos as D

    monkeypatch.setattr(D, "DIR_DATOS", tmp_path)

    def fn(e):
        h = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])
        x = {"protocolo": "1. Cultivar\n2. Medir", "ensayo": "Inmunoensayo", "confirma": "GFAP sube más del 20 %", "refuta": "GFAP no cambia", "controles": "vehículo", "tamanoMuestral": "n = 6", "alternativa": "", "decisionQueCambia": "", "costeEstimado": "", "laboratorio": "Lab", "estado": "asignado", "ficheroDatos": "datos.csv" if con_fichero else "no_existe.csv", "analisisPedido": "", "prerregistradoEn": 1500, "versionPrerregistrada": 1}
        x.update(XP.contrato_desde_propuesta(SimpleNamespace(lecturas=_lecturas(), sistema=None, proposito_biomarcador=None, nivel_desenlace=None, puente_al_beneficio="")))
        h["experimento"] = x
        return True

    al.mutar(fn, "asignar")
    if con_fichero:
        d = D.ruta_de(ids["hip"], "datos.csv")
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_text("grupo,gfap\ncontrol,10\ntratado,13.5\n")


def test_evaluar_resultado_da_veredicto_por_lectura_y_lee_el_negativo(monkeypatch, tmp_path):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    # Diana comprometida (STAT3 baja un 60 %) y el efecto no aparece (GFAP +2 %): el negativo cuestiona el mecanismo.
    respuestas = {"evaluar_resultado": _pred_resultado("refuta", "negativo_interpretable", [("fosforilación de STAT3", "-60 %"), ("GFAP en plasma", "+2 %")]), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    r = h["experimento"]["resultado"]
    assert r["veredicto"] == "refuta" and r["clasificacion"] == "negativo_interpretable"
    por_lectura = {v["lectura"]: v["veredicto"] for v in r["veredictosPorLectura"]}
    assert por_lectura == {"fosforilación de STAT3": "confirma", "GFAP en plasma": "refuta"}
    assert r["lecturaDelNegativo"]["rama"] == "diana_comprometida_sin_efecto" and r["lecturaDelNegativo"]["explicacion"]
    # La ruta se recalcula con el resultado y la conclusión se rehace.
    assert h["ruta"] and len(h["ruta"]["pasos"]) == 8 and h["conclusion"]
    # El contexto para la siguiente iteración dice qué rama es.
    texto = T.resultado_experimental(h)
    assert "Lectura del negativo" in texto and "cuestiona el mecanismo" in texto


@pytest.mark.parametrize(
    "veredicto, clasificacion, relacion",
    [("confirma", "apoyo_reproducido", "apoya"), ("refuta", "negativo_interpretable", "contradice"), ("inconcluso", "inconcluso", None)],
)
def test_el_resultado_del_laboratorio_cuenta_en_su_sentido_en_la_certeza(monkeypatch, tmp_path, veredicto, clasificacion, relacion):
    """Hasta el 25 de septiembre de 2026 la afirmación del laboratorio se guardaba
    sin relación y certeza.py la contaba como apoyo: un negativo subía la
    certeza. Ahora el apoyo va a favor, el negativo en contra y el inconcluso no
    entra en la evidencia (queda en el resultado del experimento)."""
    from rosa import certeza as C

    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    respuestas = {"evaluar_resultado": _pred_resultado(veredicto, clasificacion, [("GFAP en plasma", "+2 %")]), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    lab = [a for a in h["afirmaciones"] if str(a.get("cita", "")).startswith("[Datos del laboratorio")]
    if relacion is None:
        assert lab == []
    else:
        assert [a["relacion"] for a in lab] == [relacion]
        # Lo que cuenta la certeza, no solo la etiqueta: el negativo está en contras.
        v = C._Vista(h)
        i = h["afirmaciones"].index(lab[0])
        assert (i in v.contras) is (relacion == "contradice") and (i in v.apoyos) is (relacion == "apoya")


def test_la_migracion_da_relacion_a_lo_guardado_y_marca_lo_sintetico():
    from rosa.estado.almacen import _migrar_relacion_laboratorio

    af = lambda cita, fichero: {"texto": "x", "cita": cita, "veredicto": "sostenida", "trayectoria": {"id": fichero, "celda": 0}}  # noqa: E731
    e = {"hipotesis": [
        {"id": "a", "afirmaciones": [af("[Datos del laboratorio: datos_sintetico.csv, 11/09/2026]", "datos_sintetico.csv"), {"texto": "otra", "cita": "[Xie 2026]"}], "experimento": {"resultado": {"veredicto": "confirma"}}},
        {"id": "b", "afirmaciones": [af("[Datos del laboratorio: real.csv, 1/09/2026]", "real.csv")], "experimento": {"resultado": {"veredicto": "refuta", "clasificacion": "negativo_interpretable"}}},
        {"id": "c", "afirmaciones": [af("[Datos del laboratorio: real.csv, 1/09/2026]", "real.csv")], "experimento": {"resultado": {"veredicto": "inconcluso", "clasificacion": "inconcluso"}}},
        {"id": "d", "afirmaciones": "roto"},
        None,
    ]}
    _migrar_relacion_laboratorio(e)
    a, b, c = e["hipotesis"][:3]
    assert a["afirmaciones"][0]["relacion"] == "apoya" and a["afirmaciones"][0]["sintetico"] is True and "relacion" not in a["afirmaciones"][1]
    assert b["afirmaciones"][0]["relacion"] == "contradice" and not b["afirmaciones"][0].get("sintetico")
    assert c["afirmaciones"] == [] and c["experimento"]["resultado"]["afirmacionRetirada"]["cita"].startswith("[Datos del laboratorio")
    antes = repr(e)
    _migrar_relacion_laboratorio(e)
    assert repr(e) == antes


def test_fichero_ausente_deja_lista_vacia_y_rama_none(monkeypatch, tmp_path):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch, con_fichero=False)
    sup, ctx, llamadas = _supervisor(al, ids, {"concluir": _pred_conclusion()}, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    r = _hip(al, ids)["experimento"]["resultado"]
    assert r["veredicto"] == "no_evaluable" and r["veredictosPorLectura"] == []
    assert r["lecturaDelNegativo"]["rama"] is None and r["lecturaDelNegativo"]["explicacion"]
    assert not any(p == "evaluar_resultado" for p, _ in llamadas.vistas)


def test_juez_que_falla_deja_lista_vacia_y_rama_none(monkeypatch, tmp_path):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    sup, ctx, _ = _supervisor(al, ids, {"concluir": _pred_conclusion()}, monkeypatch)  # sin evaluar_resultado: lanza
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    r = _hip(al, ids)["experimento"]["resultado"]
    assert r["veredicto"] == "no_evaluable" and r["clasificacion"] == "fallo_tecnico"
    assert r["veredictosPorLectura"] == [] and r["lecturaDelNegativo"] == {"rama": None, "explicacion": "sin veredictos por lectura: no hay nada que leer"}


def test_experimento_antiguo_sin_lecturas_no_rompe_la_evaluacion(monkeypatch, tmp_path):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    al.mutar(lambda e: [next(z for z in e["hipotesis"] if z["id"] == ids["hip"])["experimento"].pop(k, None) for k in XP.CLAVES_CONTRATO] and True, "viejo")
    respuestas = {"evaluar_resultado": _pred_resultado("confirma", "apoyo_reproducido", [("GFAP", "+35 %")]), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    r = _hip(al, ids)["experimento"]["resultado"]
    # Sin lecturas declaradas, la regla deriva una del ensayo y sin cifra que la nombre es "no pude comprobar", nunca "no hay efecto".
    assert r["veredicto"] == "confirma" and all(v["veredicto"] == "no_evaluable" for v in r["veredictosPorLectura"]) and r["lecturaDelNegativo"]["rama"] is None
    assert "Lectura del negativo" not in T.resultado_experimental(_hip(al, ids))  # solo se añade en refuta o inconcluso


# ---------------------------------------------------------------------------
# Cierre de iteración: mapa, mapa de ruta, cifras, cuestiones por hueco
# ---------------------------------------------------------------------------


def _pred_llano():
    return SimpleNamespace(resumen=SimpleNamespace(titulo="Qué pasó", mensajes_clave=["uno"], que_buscaba="a", que_hizo="b", que_encontro=["c"], limitaciones="d", cambios=[], que_propone=["e"], que_falta="f", que_te_toca="g", terminos=[]))


def test_cerrar_iteracion_escribe_las_vistas_de_programa(monkeypatch):
    al, ids = _preparar()
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen técnico de la iteración."), "en_llano": _pred_llano(), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    c = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    asyncio.run(sup._cerrar_iteracion(c, it))
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    assert it["terminadaEn"] is not None
    m = inv["mapaEnfermedad"]
    assert m["fecha"] == it["terminadaEn"] and m["iteracion"] == 1 and "celdas" in m and "huecos" in m
    assert m["etiquetas"]["estadio"]["preclinica"] and m["definiciones"]["estadio"]["preclinica"] and m["definiciones"]["nivel"]["molecular"]
    mr = inv["mapaRuta"]
    assert mr["fecha"] == it["terminadaEn"] and mr["iteracion"] == 1 and mr["investigacionId"] == ids["inv"] and isinstance(mr["filas"], list) and mr["resumen"]
    cf = inv["cifrasAprendizaje"]
    assert cf["fecha"] == it["terminadaEn"] and cf["iteracion"] == 1 and cf["acierto"] and cf["tiempo"] and cf["reutilizacion"] and cf["texto"] and cf["glosario"]
    # El texto de las cifras va al resumen en llano como párrafo aparte.
    assert it["resumenLlano"]["titulo"] == "Qué pasó" and it["resumenLlano"]["aprendizaje"] == cf["texto"]
    # La ruta de la hipótesis viva quedó escrita al rehacer su conclusión.
    assert _hip(al, ids)["ruta"]["pasos"]
    # Los huecos que la misión nombra y nada cubre quedan como cuestiones abiertas, sin repetirse.
    abiertas = CU.abiertas(al.estado, ids["inv"])
    textos = [q["texto"] for q in abiertas if q["texto"].startswith("La misión nombra")]
    assert len(textos) == len(set(textos))
    if m["huecos"]:
        assert textos and any(q["queLaResolveria"].startswith("un hecho o una hipótesis") for q in abiertas)
    # Volver a cerrar con las mismas vistas no duplica cuestiones.
    n_antes = len(CU.abiertas(al.estado, ids["inv"]))
    al.mutar(lambda e2: CO._vistas_de_programa_al_cerrar(e2, ids["inv"], next(x for x in e2["iteraciones"] if x["id"] == ids["it"]), 5000) or True, "otra_vez")
    assert len(CU.abiertas(al.estado, ids["inv"])) == n_antes
    # Los tres campos viajan al navegador (no empiezan por guion bajo) y sobreviven a la serialización.
    assert all(k in al.instantanea()["investigaciones"][0] for k in ("mapaEnfermedad", "mapaRuta", "cifrasAprendizaje"))


def test_un_fallo_de_una_vista_deja_incidencia_y_las_otras_se_escriben(monkeypatch):
    al, ids = _preparar()

    def rompe(e, inv_id):
        raise RuntimeError("mapa roto a propósito")

    monkeypatch.setattr(CO.MAPA, "mapa", rompe)
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    it["resumenLlano"] = None  # sin resumen en llano: el texto de las cifras se queda en la investigación
    al.mutar(lambda e2: CO._vistas_de_programa_al_cerrar(e2, ids["inv"], next(x for x in e2["iteraciones"] if x["id"] == ids["it"]), 4000) or True, "cierre")
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert "mapaEnfermedad" not in inv or inv.get("mapaEnfermedad") is None
    assert inv["mapaRuta"]["fecha"] == 4000 and inv["cifrasAprendizaje"]["fecha"] == 4000
    assert any(ev["tipo"] == "incidencia" and "mapa de la enfermedad" in ev["texto"] for ev in al.estado["eventos"])
    # Investigación desconocida: no hace nada y no lanza.
    al.mutar(lambda e2: CO._vistas_de_programa_al_cerrar(e2, "inv-que-no-existe", {"numero": 9}, 4000) or True, "nada")


# ---------------------------------------------------------------------------
# Dossier y contexto
# ---------------------------------------------------------------------------


def test_el_dossier_lleva_la_ruta_el_contrato_y_el_perfil(monkeypatch, tmp_path):
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    respuestas = {"evaluar_resultado": _pred_resultado("refuta", "negativo_interpretable", [("fosforilación de STAT3", "-60 %"), ("GFAP en plasma", "+2 %")]), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    h["perfilDiana"] = {"version": 1, "diana": "GFAP", "identificadores": {}, "capas": [{"capa": "genetica_humana", "estado": "no_pude_comprobar", "detalle": "Open Targets no respondió", "direccion": None, "conectores": []}]}
    e = al.estado
    inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
    texto = texto_dossier(e, h, inv, next(c for c in e["corridas"] if c["id"] == ids["cor"]), 9000)
    assert "Completar este paso no completa la ruta" not in texto
    assert "Ruta terapéutica:" in texto and "1. Mecanismo" in texto and "8. " in texto
    assert texto.index("## 2. La hipótesis") < texto.index("Ruta terapéutica:") < texto.index("## 3. Evidencia")
    assert "### Qué dicen las bases de la diana" in texto and "Perfil de evidencia por diana: GFAP" in texto
    assert "Contrato del experimento" in texto and "fosforilación de STAT3" in texto
    assert "Veredicto por lectura" in texto and "GFAP en plasma [función o mecanismo]: refuta" in texto
    assert "Lectura del negativo: Diana comprometida sin efecto" in texto
    for n in range(1, 8):
        assert f"## {n}. " in texto  # la numeración sigue siendo 1 a 7


def test_el_dossier_aguanta_un_registro_antiguo_y_uno_roto():
    al, ids = _preparar()
    e = al.estado
    h = _hip(al, ids)
    inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
    # Registro antiguo: sin ruta, sin perfil, sin experimento, con tarjeta None.
    h["tarjeta"] = None
    h.pop("ruta", None)
    h.pop("perfilDiana", None)
    texto = texto_dossier(e, h, inv, None, 9000)
    assert "Ruta terapéutica:" in texto and "Sin tarjeta de hipótesis" in texto and "Qué dicen las bases de la diana" not in texto and "Sin experimento propuesto" in texto
    # Perfil roto (lista, texto) y ruta guardada como texto: no rompen el dossier.
    h["perfilDiana"] = ["basura"]
    h["ruta"] = "no es un diccionario"
    h["experimento"] = {"protocolo": "1. x", "ensayo": "e", "lecturas": "texto en vez de lista", "resultado": {"veredicto": "refuta", "fecha": 1, "resultado": "r", "veredictosPorLectura": "basura"}}
    texto = texto_dossier(e, h, inv, None, 9000)
    assert "Ruta terapéutica" in texto and "Contrato del experimento" in texto and "Qué dicen las bases de la diana" not in texto
    h["perfilDiana"] = {"capas": 7}
    assert "Qué dicen las bases de la diana" in texto_dossier(e, h, inv, None, 9000)


def test_modelo_de_mundo_para_lleva_el_mapa(monkeypatch):
    monkeypatch.delenv("ROSA_GATEWAY_KEY", raising=False)
    al, ids = _preparar()

    def fn(e):
        e["hechos"].append(P.nuevo_hecho(ids["inv"], "hecho", "GFAP", "GFAP en plasma sube en la fase preclínica en portadores de APOE4", "sabido", "literatura", [{"fuenteId": None, "referencia": "Kim, 2025", "pagina": 3}], 2000))
        return True

    al.mutar(fn, "hecho")
    texto = asyncio.run(T.modelo_de_mundo_para(al, ids["inv"], "GFAP"))
    assert "Mapa del estado de la enfermedad" in texto and texto.index("Hechos pertinentes") < texto.index("Mapa del estado de la enfermedad")
    # Un mapa guardado con forma rara (texto) no se usa como precalculado y no rompe.
    al.mutar(lambda e: next(i for i in e["investigaciones"] if i["id"] == ids["inv"]).__setitem__("mapaEnfermedad", "basura") or True, "raro")
    assert "Mapa del estado de la enfermedad" in asyncio.run(T.modelo_de_mundo_para(al, ids["inv"], "GFAP"))
    # Si la regla del mapa falla, el texto lo dice y el paso sigue.
    from rosa import mapa_enfermedad as MAPA

    def rompe(*a, **k):
        raise RuntimeError("mapa roto")

    monkeypatch.setattr(MAPA, "texto_mapa", rompe)
    assert "no pude construirlo" in asyncio.run(T.modelo_de_mundo_para(al, ids["inv"], "GFAP"))


def test_resultado_experimental_aguanta_resultados_rotos():
    assert T.resultado_experimental({"experimento": None}) == "Ninguno"
    h = {"experimento": {"resultado": {"veredicto": "inconcluso", "cifras": "basura", "veredictosPorLectura": None}}}
    texto = T.resultado_experimental(h)
    assert "inconcluso" in texto and "Lectura del negativo: Sin rama" in texto
    h = {"experimento": {"resultado": {"veredicto": "refuta", "cifras": [{"nombre": "x", "valor": "1"}, "basura", None], "veredictosPorLectura": [{"lectura": "a", "tipo": "compromiso_diana", "veredicto": "refuta", "motivo": "", "cifras": []}]}}}
    assert "Diana no comprometida" in T.resultado_experimental(h)


# ---------------------------------------------------------------------------
# Servidor
# ---------------------------------------------------------------------------


@pytest.fixture
def cliente(monkeypatch):
    raiz = Path(tempfile.mkdtemp())
    monkeypatch.setattr(config, "RAIZ", raiz)
    dist = raiz / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>rosa</html>")
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    al, ids = _preparar()
    app = crear_app(al)
    app.state.acceso = SimpleNamespace(usuario=lambda token: "test@alzheimerproject.com" if token == "sesion-test" else None)
    app.state.correo = SimpleNamespace(preferencias=lambda email: al.instantanea()["avisos"])
    return TestClient(app, base_url="http://127.0.0.1:8765", cookies={"rosa_sesion": "sesion-test"}), al, ids


def test_los_endpoints_de_programa_responden(cliente, monkeypatch, tmp_path):
    c, al, ids = cliente
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    r = c.get(f"/api/investigaciones/{ids['inv']}/ruta")
    assert r.status_code == 200 and r.json()["investigacionId"] == ids["inv"] and "filas" in r.json() and r.json()["resumen"]
    r = c.get(f"/api/investigaciones/{ids['inv']}/mapa")
    assert r.status_code == 200 and "celdas" in r.json()["mapa"] and r.json()["texto"].startswith("Mapa del estado de la enfermedad")
    r = c.get(f"/api/investigaciones/{ids['inv']}/cifras")
    assert r.status_code == 200 and r.json()["investigacionId"] == ids["inv"] and r.json()["texto"] and "glosario" in r.json()
    r = c.get("/api/experimento/vocabularios")
    assert r.status_code == 200 and set(r.json()) == {"propositosBiomarcador", "nivelesDesenlace", "sistemasExperimentales", "tiposLectura"}
    assert r.json()["tiposLectura"]["compromiso_diana"]["etiqueta"] and r.json()["tiposLectura"]["compromiso_diana"]["definicion"]
    r = c.get(f"/api/hipotesis/{ids['hip']}/contrato")
    assert r.status_code == 200 and isinstance(r.json()["problemas"], list) and "fosforilación de STAT3" in r.json()["texto"] and len(r.json()["hash"]) == 64
    # Sin experimento: problemas lo dicen, hash vacío.
    al.mutar(lambda e: next(z for z in e["hipotesis"] if z["id"] == ids["hip"]).__setitem__("experimento", None) or True, "quitar")
    r = c.get(f"/api/hipotesis/{ids['hip']}/contrato")
    assert r.status_code == 200 and r.json()["problemas"] == ["no hay experimento propuesto"] and r.json()["hash"] == ""
    # Desconocidos: 404, no 500.
    for ruta in ("/api/investigaciones/no-existe/ruta", "/api/investigaciones/no-existe/mapa", "/api/investigaciones/no-existe/cifras", "/api/hipotesis/no-existe/contrato"):
        assert c.get(ruta).status_code == 404, ruta


# ---------------------------------------------------------------------------
# Adversario (16 de septiembre de 2026): lo que se rompió al intentar romper
# la integración y quedó arreglado dentro de corrida, contexto y dossier.
# ---------------------------------------------------------------------------


def _progreso(al, ids):
    return next(x for x in al.estado["corridas"] if x["id"] == ids["cor"]).get("progreso") or []


def test_la_metrica_de_la_corrida_ve_las_cifras_de_la_iteracion_que_acaba_de_cerrar(monkeypatch):
    """`PROG.metrica_de_corrida` lee `investigacion.cifrasAprendizaje` a demanda,
    sin calcularlas: tras cerrar la iteración tiene que ver las de esa iteración
    (y antes, ninguna), o la métrica que enseña la interfaz miente."""
    from rosa import progreso as PROG

    al, ids = _preparar()
    assert PROG.aprendizaje_de(al.estado, ids["inv"]) is None
    respuestas = {"resumir": SimpleNamespace(resumen="Resumen."), "en_llano": _pred_llano(), "concluir": _pred_conclusion()}
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    c = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    asyncio.run(sup._cerrar_iteracion(c, it))
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    m = PROG.metrica_de_corrida(al.estado, ids["cor"])
    assert m and m["aprendizaje"] is not None and inv["cifrasAprendizaje"]["iteracion"] == 1
    assert m["aprendizaje"]["acierto"] == inv["cifrasAprendizaje"]["acierto"] and m["aprendizaje"]["tiempo"] == inv["cifrasAprendizaje"]["tiempo"]
    assert len(_progreso(al, ids)) == 1  # la instantánea de progreso se sigue guardando una vez por cierre


def test_un_fallo_de_la_regla_del_contrato_no_pierde_el_protocolo_del_cerebro(monkeypatch):
    """La llamada al modelo está pagada: si `validar_contrato` lanza, el
    experimento se guarda igual con los campos del contrato vacíos y un problema
    que lo dice, en vez de tirarse entero."""
    al, ids = _preparar()
    sup, ctx, _ = _supervisor(al, ids, {"experimento": _pred_experimento()}, monkeypatch)

    def rompe(x):
        raise KeyError("regla del contrato rota a propósito")

    monkeypatch.setattr(CO.XP, "validar_contrato", rompe)
    asyncio.run(sup._proponer_experimento(ctx, _hip(al, ids)))
    x = _hip(al, ids)["experimento"]
    assert x and x["estado"] == "propuesto" and x["protocolo"].startswith("1. ")
    assert x["lecturas"] and x["problemasContrato"] == ["no pude leer el contrato de la propuesta (KeyError): lecturas, sistema y propósito quedan sin declarar"]
    assert isinstance(x["hashLecturas"], str) and len(x["hashLecturas"]) == 64
    assert any(r.startswith("contrato del experimento: 2 lecturas") and "1 problema" in r for r in _hip(al, ids)["procedencia"]["registro"])
    # Y si también falla la propuesta, quedan las claves canónicas vacías (no faltan).
    al2, ids2 = _preparar()
    sup2, ctx2, _ = _supervisor(al2, ids2, {"experimento": _pred_experimento()}, monkeypatch)
    monkeypatch.setattr(CO.XP, "contrato_desde_propuesta", rompe)
    asyncio.run(sup2._proponer_experimento(ctx2, _hip(al2, ids2)))
    x2 = _hip(al2, ids2)["experimento"]
    assert x2 and set(XP.CLAVES_CONTRATO) <= set(x2) and x2["lecturas"] == [] and x2["sistema"] is None
    assert x2["hashLecturas"] == XP.hash_lecturas(x2)


def test_los_huecos_solo_cuentan_como_nuevos_cuando_de_verdad_entran():
    """`CU.registrar` devuelve también la cuestión fundida o la ya resuelta: el
    recuento (y el evento «quedan N huecos como cuestiones abiertas») solo puede
    contar las que entraron. Una resuelta por una persona no se reabre ni se cuenta."""
    al, ids = _preparar()

    def mision_con_hueco(e):
        inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
        inv["mision"]["celulaTejido"] = "microglía de la corteza entorrinal"  # nada en el estado sitúa esa combinación
        return True

    al.mutar(mision_con_hueco, "mision")
    from rosa import mapa_enfermedad as MAPA

    huecos = MAPA.mapa(al.estado, ids["inv"])["huecos"]
    assert huecos, "la preparación tiene que dejar al menos un hueco"
    n1 = al.mutar(lambda e: CO._cuestiones_por_hueco(e, ids["inv"], huecos, 3000), "h1")
    assert n1 == len(huecos[:6]) and n1 >= 1
    abiertas = CU.abiertas(al.estado, ids["inv"])
    assert len(abiertas) == n1
    # Segunda vez: nada nuevo, aunque `registrar` devuelva la fundida.
    assert al.mutar(lambda e: CO._cuestiones_por_hueco(e, ids["inv"], huecos, 3001), "h2") == 0
    # Una persona la resuelve: no se reabre ni se cuenta, y no aparece evento de huecos.
    al.mutar(lambda e: CU.resolver(e, abiertas[0]["id"], "Dra. Allegri", "Ya buscado", 3002, quien="Dra. Allegri"), "resolver")
    assert al.mutar(lambda e: CO._cuestiones_por_hueco(e, ids["inv"], huecos, 3003), "h3") == 0
    assert len(CU.abiertas(al.estado, ids["inv"])) == n1 - 1
    n_eventos = len(al.estado["eventos"])
    al.mutar(lambda e: CO._vistas_de_programa_al_cerrar(e, ids["inv"], {"numero": 2}, 3004) or True, "cierre")
    assert not any(ev["tipo"] == "aprendizaje" and "hueco" in ev["texto"] for ev in al.estado["eventos"][n_eventos:])
    # Huecos con forma rara (motivo que no es texto, lista que no es lista) no abren nada.
    assert al.mutar(lambda e: CO._cuestiones_por_hueco(e, ids["inv"], [{"motivo": 7}, {"motivo": None}, "x", None], 3005), "raros") == 0
    assert al.mutar(lambda e: CO._cuestiones_por_hueco(e, ids["inv"], "no es lista", 3006), "raro") == 0


def test_la_ruta_se_escribe_al_evaluar_el_resultado_aunque_el_juez_de_la_conclusion_falle(monkeypatch, tmp_path):
    """Si solo la escribiera `_concluir_hipotesis`, quitar la línea de
    `_evaluar_resultado` pasaría desapercibido: aquí el juez de la conclusión
    falla y la ruta tiene que venir del resultado."""
    al, ids = _preparar()
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)
    respuestas = {"evaluar_resultado": _pred_resultado("confirma", "apoyo_reproducido", [("GFAP en plasma", "+35 %")])}  # sin concluir: lanza
    sup, ctx, _ = _supervisor(al, ids, respuestas, monkeypatch)
    asyncio.run(sup._evaluar_resultado(ctx, _hip(al, ids)))
    h = _hip(al, ids)
    assert h.get("conclusion") is None
    assert h["ruta"] and len(h["ruta"]["pasos"]) == 8 and h["ruta"]["hipotesisId"] == h["id"]
    # El resultado confirmado cuenta como evidencia de laboratorio en algún paso de la ruta.
    assert any(ev["tipo"] == "laboratorio" for p in h["ruta"]["pasos"] for ev in p["evidencia"])


def test_el_resumen_en_llano_que_llega_tarde_recibe_el_parrafo_de_aprendizaje():
    al, ids = _preparar()

    def cerrar_sin_llano(e):
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["terminadaEn"] = 5000
        it["resumen"] = "Resumen."
        it["resumenLlano"] = None
        CO._vistas_de_programa_al_cerrar(e, ids["inv"], it, 5000)
        return True

    al.mutar(cerrar_sin_llano, "cierre")
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert inv["cifrasAprendizaje"]["texto"]

    def llega_tarde(e):
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["resumenLlano"] = {"titulo": "Tarde"}
        CO._anadir_aprendizaje_al_llano(e, ids["cor"], it)
        return True

    al.mutar(llega_tarde, "tarde")
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    assert it["resumenLlano"]["aprendizaje"] == inv["cifrasAprendizaje"]["texto"]
    # Cifras de otra iteración no se pegan; un resumen que ya lo trae no se pisa; formas raras no rompen.
    e = al.estado
    it2 = {"numero": 7, "resumenLlano": {"titulo": "x"}}
    CO._anadir_aprendizaje_al_llano(e, ids["cor"], it2)
    assert "aprendizaje" not in it2["resumenLlano"]
    it3 = {"numero": 1, "resumenLlano": {"aprendizaje": "propio"}}
    CO._anadir_aprendizaje_al_llano(e, ids["cor"], it3)
    assert it3["resumenLlano"]["aprendizaje"] == "propio"
    CO._anadir_aprendizaje_al_llano(e, "cor-que-no-existe", {"numero": 1, "resumenLlano": {}})
    CO._anadir_aprendizaje_al_llano(e, ids["cor"], {"numero": 1, "resumenLlano": "texto"})


def test_las_vistas_aguantan_una_iteracion_con_forma_rara_y_la_linea_del_contrato_no_cuenta_letras():
    al, ids = _preparar()
    for it2 in (None, "texto", 7, {}):
        al.mutar(lambda e, it2=it2: CO._vistas_de_programa_al_cerrar(e, ids["inv"], it2, 4000) or True, "raro")
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert inv["mapaEnfermedad"]["iteracion"] is None and inv["mapaRuta"]["fecha"] == 4000 and inv["cifrasAprendizaje"]["fecha"] == 4000
    assert not any(ev["tipo"] == "incidencia" for ev in al.estado["eventos"])
    assert CO._linea_contrato({"lecturas": "texto en vez de lista", "sistema": "in vitro", "problemasContrato": "uno"}) == "contrato del experimento: 0 lecturas, sistema no declarado, 0 problemas"
    assert CO._linea_contrato({"lecturas": [{"nombre": "a"}], "sistema": {"tipo": "celulas_humanas_donante"}, "problemasContrato": ["p"]}).startswith("contrato del experimento: 1 lectura, sistema ")
    assert CO._linea_contrato({}) == "contrato del experimento: 0 lecturas, sistema no declarado, 0 problemas"


def test_el_contexto_y_el_dossier_aguantan_registros_con_otra_forma():
    # Experimento o resultado como texto: se dice, no se lanza; nunca "no hay".
    assert T.resultado_experimental({"experimento": "texto"}) == "Ninguno"
    texto = T.resultado_experimental({"experimento": {"resultado": "texto"}})
    assert "no pude leer" in texto and "no hay" not in texto
    al, ids = _preparar()
    e = al.estado
    h = _hip(al, ids)
    inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
    h["tarjeta"] = "texto"
    h["procedencia"] = "texto"
    h["comprobacion"] = None
    h["experimento"] = {"protocolo": "1. x", "ensayo": "e", "resultado": "texto", "prerregistradoEn": 1500}
    h["bloqueos"] = None
    texto = texto_dossier(e, h, inv, {"id": ids["cor"], "arnes": {"commit": "abc"}}, 9000)
    assert "Sin tarjeta de hipótesis" in texto and "biomarcador sin declarar" in texto and "Ruta terapéutica:" in texto
    assert "forma que no pude leer" in texto and "Contrato del experimento" in texto
    h["tarjeta"] = {**P.tarjeta_vacia(), "riesgos": None}
    h["experimento"] = {"protocolo": "1. x", "resultado": {"veredicto": None, "veredictosPorLectura": [{"lectura": None, "tipo": 3, "veredicto": None}]}}
    texto = texto_dossier(e, h, inv, {"id": ids["cor"], "arnes": {"commit": "abc"}}, 9000)
    assert "Resultado recibido (sin fecha): sin veredicto / sin clasificar" in texto and "Veredicto por lectura" in texto


def test_un_estado_guardado_antes_de_los_siete_modulos_se_lee_y_se_sirve(cliente, monkeypatch, tmp_path):
    """Un rosa.db anterior no trae ruta, perfilDiana, contrato, mapa ni cifras:
    la migración los pone a None y todo lo que los lee (dossier, contexto,
    endpoints, cierre) tiene que seguir funcionando con ellos a None."""
    from rosa.estado import almacen as AL

    c, al, ids = cliente
    _con_experimento_asignado(al, ids, tmp_path, monkeypatch)

    def envejecer(e):
        for h in e["hipotesis"]:
            for k in ("ruta", "perfilDiana", "alternativas", *XP.CLAVES_CONTRATO, "problemasContrato", "hashLecturas"):
                h.pop(k, None)
            for k in list(XP.CLAVES_CONTRATO) + ["problemasContrato", "hashLecturas"]:
                h["experimento"].pop(k, None)
            h["experimento"]["resultado"] = {"veredicto": "refuta", "clasificacion": "negativo_interpretable", "fecha": 3000, "resultado": "GFAP no cambió.", "motivo": "criterio congelado", "limitaciones": "", "cifras": [{"nombre": "GFAP", "valor": "+1 %"}], "exploratorio": ""}
        for inv in e["investigaciones"]:
            for k in ("mapaEnfermedad", "mapaRuta", "cifrasAprendizaje"):
                inv.pop(k, None)
        e.pop("datasetsPrograma", None)
        return True

    al.mutar(envejecer, "envejecer")
    e = al.estado
    h = _hip(al, ids)
    assert "ruta" not in h and "mapaEnfermedad" not in e["investigaciones"][0]
    AL._migrar(e)
    assert h["ruta"] is None and h["perfilDiana"] is None and e["investigaciones"][0]["mapaEnfermedad"] is None and e["datasetsPrograma"] == []
    inv = e["investigaciones"][0]
    texto = texto_dossier(e, h, inv, None, 9000)
    assert "Ruta terapéutica:" in texto and "Contrato del experimento" in texto and "Qué dicen las bases de la diana" not in texto
    # Resultado antiguo sin veredictos por lectura: el negativo se lee como "sin rama", no se inventa.
    ctx_txt = T.resultado_experimental(h)
    assert "Lectura del negativo: Sin rama" in ctx_txt
    for ruta in (f"/api/investigaciones/{ids['inv']}/ruta", f"/api/investigaciones/{ids['inv']}/mapa", f"/api/investigaciones/{ids['inv']}/cifras", f"/api/hipotesis/{ids['hip']}/contrato"):
        r = c.get(ruta)
        assert r.status_code == 200, (ruta, r.text[:200])
    r = c.get(f"/api/hipotesis/{ids['hip']}/contrato").json()
    assert isinstance(r["problemas"], list) and "sistema experimental" in " ".join(r["problemas"]) and len(r["hash"]) == 64
    monkeypatch.delenv("ROSA_GATEWAY_KEY", raising=False)
    # Sin hechos propios el modelo de mundo devuelve el texto de vacío (camino anterior, sin mapa); con uno, lleva el mapa con la clave a None.
    assert "Mapa del estado de la enfermedad" not in asyncio.run(T.modelo_de_mundo_para(al, ids["inv"], "GFAP"))
    al.mutar(lambda e2: e2["hechos"].append(P.nuevo_hecho(ids["inv"], "hecho", "GFAP", "GFAP en plasma sube en la fase preclínica", "sabido", "literatura", [{"fuenteId": None, "referencia": "Kim, 2025", "pagina": 3}], 2000)) or True, "hecho")
    assert "Mapa del estado de la enfermedad" in asyncio.run(T.modelo_de_mundo_para(al, ids["inv"], "GFAP"))
    al.mutar(lambda e2: CO._vistas_de_programa_al_cerrar(e2, ids["inv"], {"numero": 3}, 9500) or True, "cierre")
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert inv["mapaEnfermedad"]["iteracion"] == 3 and inv["cifrasAprendizaje"]["iteracion"] == 3
    # Y el estado sigue siendo serializable para el navegador.
    assert al.instantanea()["investigaciones"][0]["mapaRuta"]["fecha"] == 9500


def test_completar_en_llano_pega_el_aprendizaje_cuando_el_resumen_llega_tarde(monkeypatch):
    """Camino real: la iteración cerró sin resumen en llano (el modelo falló),
    las cifras ya están en la investigación y `_completar_en_llano_paso` rellena
    el resumen después; tiene que salir con el párrafo `aprendizaje`."""
    al, ids = _preparar()

    def cerrar_sin_llano(e):
        h = next(z for z in e["hipotesis"] if z["id"] == ids["hip"])
        h.update({"_enLlanoIntentado": True, "_conclusionIntentada": 1, "_experimentoIntentado": True})  # que el relleno no se pare en la hipótesis
        it = next(x for x in e["iteraciones"] if x["id"] == ids["it"])
        it["terminadaEn"] = 5000
        it["resumen"] = "Resumen."
        it["resumenLlano"] = None
        CO._vistas_de_programa_al_cerrar(e, ids["inv"], it, 5000)
        return True

    al.mutar(cerrar_sin_llano, "cierre")
    sup, ctx, llamadas = _supervisor(al, ids, {"en_llano": _pred_llano()}, monkeypatch)
    asyncio.run(sup._completar_en_llano_paso())
    assert any(p == "en_llano" for p, _ in llamadas.vistas)
    it = next(x for x in al.estado["iteraciones"] if x["id"] == ids["it"])
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == ids["inv"])
    assert it["resumenLlano"]["titulo"] == "Qué pasó" and it["resumenLlano"]["aprendizaje"] == inv["cifrasAprendizaje"]["texto"]


# ---------------------------------------------------------------------------
# El planificador recibe todos los campos de su firma
# ---------------------------------------------------------------------------


def test_proponer_plan_pasa_todos_los_campos_de_la_firma(monkeypatch):
    """Regresión de la corrida 7 del 16 de septiembre de 2026: `ProponerPlan`
    ganó el campo `datasets_disponibles` y la llamada de `_proponer_plan` no lo
    pasaba; DSPy avisaba "Missing: ['datasets_disponibles']" y el planificador no
    veía los datasets del programa. El test llama al planificador con modelos
    simulados y comprueba que cada InputField de la firma llega en la llamada."""
    from rosa.modulos import firmas as F

    al, ids = _preparar()
    respuestas = {
        "plan": SimpleNamespace(plan=[SimpleNamespace(tipo="literatura", titulo="Leer ensayos", detalle="Buscar los ensayos con tau PET", valor_decision="", espera="", si_no_aparece="")]),
    }
    sup, ctx, llamadas = _supervisor(al, ids, respuestas, monkeypatch)
    sup.programas.plan = "plan"

    async def sin_red(*a, **k):
        return ""

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", sin_red)
    monkeypatch.setattr(CO.LEC, "para", sin_red)

    def preparar(e):
        inv = next(i for i in e["investigaciones"] if i["id"] == ids["inv"])
        inv["_misionIntentada"] = True
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["_preguntaIntentada"] = True
        c["pregunta"] = {"enunciado": "¿Qué distingue a un biomarcador que predice beneficio clínico?"}
        return True

    al.mutar(preparar, "preparar")
    c = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    asyncio.run(sup._proponer_plan(c, None))
    vistas = [kw for programa, kw in llamadas.vistas if programa == "plan"]
    assert vistas, "el planificador no llegó a llamar al modelo"
    esperados = set(F.ProponerPlan.input_fields)
    faltan = esperados - set(vistas[0])
    assert not faltan, f"campos de ProponerPlan sin pasar: {sorted(faltan)}"
    assert "datasets_disponibles" in vistas[0] and isinstance(vistas[0]["datasets_disponibles"], str)
    # Y el plan propuesto quedó escrito en una iteración nueva.
    # La preparación ya deja una iteración vacía; la del planificador es la última.
    it = [i for i in al.estado["iteraciones"] if i["corridaId"] == ids["cor"]][-1]
    assert it["plan"] and it["plan"][0]["tipo"] == "literatura" and it["plan"][0]["titulo"] == "Leer ensayos"


def test_cerrar_una_iteracion_sin_pasos_ejecutados_no_llama_a_ningun_modelo(monkeypatch):
    """Corridas 8 y 9: el tope se cumplió antes de empezar la iteración, todos los
    pasos se omitieron y aun así corrieron el resumen, el resumen en llano, las
    lecciones, el revisor y la meta-revisión (llamadas al juez sobre nada)."""
    al, ids = _preparar()
    sup, ctx, llamadas = _supervisor(al, ids, {}, monkeypatch)

    def preparar(e):
        it = next(i for i in e["iteraciones"] if i["id"] == ids["it"])
        it["plan"] = [dict(P.nuevo_paso("Leer", "literatura", 10), tipo="literatura", estado="omitido", motivoFallo="Se cumplió el tiempo fijado para esta corrida (1 hora)")]
        it["empezadaEn"] = 1
        return True

    al.mutar(preparar, "preparar")
    c = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    it = next(i for i in al.estado["iteraciones"] if i["id"] == ids["it"])
    asyncio.run(sup._cerrar_iteracion(c, it))
    assert llamadas.vistas == []
    it2 = next(i for i in al.estado["iteraciones"] if i["id"] == ids["it"])
    assert it2["terminadaEn"] and it2["resumen"].startswith("Iteración cerrada sin ejecutar ningún paso")
    assert any(ev["tipo"] == "iteracion_terminada" and "sin ejecutar" in ev["texto"] for ev in al.estado["eventos"])


def test_detener_la_corrida_mientras_se_propone_el_plan_no_la_resucita(monkeypatch):
    """17 de septiembre de 2026: la orden de detener llegó mientras el modelo
    proponía el plan y la escritura del plan devolvió la corrida a
    "esperando_plan"; quedaron dos corridas vivas sobre la misma investigación."""
    al, ids = _preparar()

    def detener_durante_el_plan(kw):
        al.mutar(lambda e: A.detener_corrida(e, ids["cor"], "La persona la detuvo", 5), "detener")
        return SimpleNamespace(plan=[SimpleNamespace(tipo="literatura", titulo="Leer", detalle="d", valor_decision="", espera="", si_no_aparece="")])

    sup, ctx, llamadas = _supervisor(al, ids, {"plan": detener_durante_el_plan}, monkeypatch)
    sup.programas.plan = "plan"

    async def sin_red(*a, **k):
        return ""

    monkeypatch.setattr(CO.T, "modelo_de_mundo_para", sin_red)
    monkeypatch.setattr(CO.LEC, "para", sin_red)

    def preparar(e):
        next(i for i in e["investigaciones"] if i["id"] == ids["inv"])["_misionIntentada"] = True
        c = next(x for x in e["corridas"] if x["id"] == ids["cor"])
        c["_preguntaIntentada"] = True
        c["pregunta"] = {"enunciado": "¿Qué distingue a un biomarcador?"}
        return True

    al.mutar(preparar, "preparar")
    c = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    n_antes = len(al.estado["iteraciones"])
    asyncio.run(sup._proponer_plan(c, None))
    c2 = next(x for x in al.estado["corridas"] if x["id"] == ids["cor"])
    assert c2["estado"] == "detenida"
    assert len(al.estado["iteraciones"]) == n_antes
