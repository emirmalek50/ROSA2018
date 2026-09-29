"""El tablero del método (rosa/metodo.py): cómo está investigando ROSA2018, medido
por regla sobre las trazas.

Los casos salen de lo que se midió en la base el 29 de septiembre de 2026: 117
afirmaciones a favor y una en contra, 127 cuestiones abiertas con 2 resueltas, 27
de 34 hipótesis suspendidas, 16 de 87 conectores usados. Y de dos errores que el
propio tablero destapó al pasarlo por la base: una corrida pausada una semana que
salía con 483 minutos "sin modelo", y la corrida 42, que no tenía 47 minutos
muertos sino 5 (los otros eran el relleno de fondo de después y un reinicio).
"""

from __future__ import annotations

import asyncio
import inspect

from rosa import metodo as M

INV = "inv-1"


def _h(i, apoyos=0, contras=0, estado="propuesta", decision=None, titulo=None, certeza=None, enfoque=None, **kw):
    afs = [{"relacion": "apoya"} for _ in range(apoyos)] + [{"relacion": "contradice"} for _ in range(contras)]
    h = {"id": f"h{i}", "investigacionId": INV, "titulo": titulo or f"Hipótesis {i}", "enunciado": "", "estado": estado, "decisionKiller": decision, "afirmaciones": afs, "origen": "rosa"}
    if certeza:
        h["conclusion"] = {"certeza": certeza}
    if enfoque:
        h["enfoque"] = enfoque
    h.update(kw)
    return h


def _e(hipotesis=(), **kw):
    e = {"hipotesis": list(hipotesis), "investigaciones": [{"id": INV, "titulo": "GFAP y NfL en portadores de APOE4", "objetivo": "Si GFAP se altera antes que NfL en APOE4"}], "corridas": [], "iteraciones": [], "cuestiones": [], "decisiones": [], "conectores": []}
    e.update(kw)
    return e


def _por_clave(t):
    return {i["clave"]: i for i in t["indicadores"]}


# --- balanza -----------------------------------------------------------------


def test_la_balanza_avisa_de_la_firma_de_no_buscar_lo_que_refuta():
    assert M.balanza(_e([_h(1, apoyos=25)]), INV)["texto"].startswith("Ninguna de las afirmaciones enlazadas tira en contra")
    e = _e([_h(1, apoyos=17), _h(2, apoyos=10), _h(3, apoyos=5, contras=1)])
    i = M.balanza(e, INV)
    assert i["estado"] == "aviso" and i["cifra"] == "32 a favor, 1 en contra"
    assert [x["id"] for x in i["datos"]["sinContraste"]] == ["h1", "h2"]
    assert "no de que sea cierta" in i["texto"] and i["fase"] == "cribado"


def test_la_balanza_con_contraste_real_va_bien_y_con_poco_no_dice_nada():
    assert M.balanza(_e([_h(1, apoyos=15, contras=5)]), INV)["estado"] == "bien"
    assert M.balanza(_e([_h(1, apoyos=6)]), INV)["estado"] == "sin_datos"


def test_la_balanza_no_cuenta_las_descartadas():
    e = _e([_h(1, apoyos=30, estado="descartada"), _h(2, apoyos=3, contras=1)])
    assert M.balanza(e, INV)["cifra"] == "3 a favor, 1 en contra"


# --- cuestiones --------------------------------------------------------------


def _c(i, estado="abierta", tipo="killer"):
    return {"id": f"cu{i}", "investigacionId": INV, "estado": estado, "origen": {"tipo": tipo}}


def test_las_cuestiones_que_nadie_cierra_avisan_con_su_origen():
    e = _e(cuestiones=[_c(i) for i in range(12)] + [_c(99, estado="resuelta")])
    i = M.cuestiones(e, INV)
    assert i["estado"] == "aviso" and "12 del Killer" in i["texto"]
    e2 = _e(cuestiones=[_c(i) for i in range(10)] + [_c(90 + i, estado="resuelta") for i in range(5)])
    assert M.cuestiones(e2, INV)["estado"] == "bien"
    assert M.cuestiones(_e(cuestiones=[_c(1)]), INV)["estado"] == "sin_datos"


# --- embudo ------------------------------------------------------------------


def test_el_embudo_atascado_dice_que_comprobacion_frena_y_cuales_son_tecnicas():
    hs = [_h(i, decision="suspender") for i in range(4)] + [_h(9, decision="avanzar")]
    decs = [{"hipotesisId": f"h{i}", "fecha": 10, "sinJuez": i == 0, "comprobaciones": [{"comprobacion": "novedad", "resultado": "no_comprobable"}, {"comprobacion": "sesgo_evidencia", "resultado": "falla"}]} for i in range(4)]
    i = M.embudo(_e(hs, decisiones=decs), INV)
    assert i["estado"] == "aviso" and i["cifra"] == "4 de 5 vivas suspendidas"
    assert i["datos"]["fallan"] == {"sesgo_evidencia": 4} and i["datos"]["sinComprobar"] == {"novedad": 4}
    assert "1 de las suspensiones es técnica" in i["texto"]


def test_el_embudo_mira_la_ultima_decision_y_no_una_vieja():
    hs = [_h(i, decision="suspender") for i in range(5)] + [_h(9)]
    decs = [{"hipotesisId": "h0", "fecha": 1, "comprobaciones": [{"comprobacion": "novedad", "resultado": "falla"}]}, {"hipotesisId": "h0", "fecha": 2, "comprobaciones": [{"comprobacion": "supuestos", "resultado": "falla"}]}]
    assert M.embudo(_e(hs, decisiones=decs), INV)["datos"]["fallan"] == {"supuestos": 1}


# --- enfoques ----------------------------------------------------------------


def test_la_eficacia_por_enfoque_separa_el_equipo_del_generador_unico():
    hs = [_h(1, enfoque="analogia", decision="avanzar"), _h(2, enfoque="analogia", certeza="baja"), _h(3, enfoque="contradiccion"), _h(4), _h(5, origen="humana")]
    i = M.eficacia_por_enfoque(_e(hs), INV)
    t = i["datos"]["tabla"]
    assert t["analogia"]["nacidas"] == 2 and t["analogia"]["avanzan"] == 1 and t["analogia"]["conCertezaBaja"] == 1
    assert t["generador_unico"]["nacidas"] == 1 and t["persona"]["nacidas"] == 1
    assert i["estado"] == "bien" and "analogía: 2 nacidas, 1 avanza" in i["texto"]


def test_sin_supervivientes_de_ningun_origen_no_se_comparan_enfoques():
    """Si nada avanza, el enfoque no es lo que frena: decir "bien" engañaría."""
    hs = [_h(i, enfoque="analogia", decision="suspender") for i in range(3)] + [_h(9, decision="suspender")]
    i = M.eficacia_por_enfoque(_e(hs), INV)
    assert i["estado"] == "sin_datos" and "lo que frena es el embudo" in i["texto"]


def test_un_enfoque_que_produce_y_nada_avanza_avisa_si_otro_si():
    hs = [_h(i, enfoque="otra_escala", decision="suspender") for i in range(3)] + [_h(9, enfoque="analogia", decision="avanzar")]
    i = M.eficacia_por_enfoque(_e(hs), INV)
    assert i["estado"] == "aviso" and "El enfoque otra escala produce y nada de lo suyo avanza" in i["texto"]


def test_el_enfoque_de_las_hipotesis_viejas_sale_de_la_traza():
    """Las que nacieron del equipo antes de que el enfoque se guardara en la
    hipótesis: queda la nota de la pista, casada por título."""
    e = _e([_h(1, titulo="SULF2 neuronal como barrera a la entrada de tau")], corridas=[{"id": "c1", "investigacionId": INV}], iteraciones=[{"corridaId": "c1", "pistas": [{"transcripcion": [{"texto": "Entra por el enfoque «analogia» (ronda 2, 7 puntos): SULF2 neuronal como barrera a la entrada de tau"}]}]}])
    assert M.enfoques_desde_la_traza(e, INV) == {"h1": "analogia"}


# --- concentración -----------------------------------------------------------


def test_lo_que_el_objetivo_pide_no_cuenta_como_concentracion():
    """Si todas las de "GFAP y NfL en APOE4" nombran APOE ε4, es la misión: el
    objetivo dice APOE4 y las hipótesis dicen APOE, y son lo mismo."""
    hs = [_h(i, titulo=f"GFAP en portadores de APOE ε4, caso {i}") for i in range(7)]
    assert M.concentracion(_e(hs), INV)["estado"] == "sin_datos"  # nada fuera del objetivo


def test_la_concentracion_avisa_cuando_colapsa_hacia_algo_que_no_se_pidio():
    hs = [_h(i, titulo=f"TREM2 y GFAP, variante {i}") for i in range(5)] + [_h(8, titulo="Otra cosa"), _h(9, titulo="Otra más")]
    i = M.concentracion(_e(hs), INV)
    assert i["estado"] == "aviso" and i["datos"]["entidad"] == "TREM2" and i["cifra"] == "5 de 7 nombran TREM2"


def test_la_raiz_no_confunde_genes_distintos():
    """En un gen el número es la identidad: TREM1 y TREM2 no se funden al contar."""
    hs = [_h(1, titulo="TREM1 en microglía"), _h(2, titulo="TREM2 en microglía")] + [_h(i, titulo="nada") for i in range(3, 8)]
    assert M.concentracion(_e(hs), INV)["datos"]["cuenta"] == {"TREM1": 1, "TREM2": 1}
    assert M._raiz("APOE4") == "APOE" and M._raiz("APOE-E4") == "APOE" and M._raiz("P-TAU181") == "P-TAU"


# --- conectores --------------------------------------------------------------


def test_los_conectores_cuentan_solo_lo_de_la_corrida_y_solo_los_disponibles():
    disponibles = [{"nombre": f"con{i}", "estado": "disponible"} for i in range(10)] + [{"nombre": "x", "estado": "requiere_cuenta"}, {"nombre": "y", "estado": "disponible", "permiso": "bloquear"}]
    h = _h(1, consultas=[{"herramienta": "con0", "invariante": None, "fecha": 150}, {"herramienta": "con1", "invariante": None, "fecha": 500}])
    corrida = {"id": "c1", "empezadaEn": 100, "terminadaEn": 200}
    i = M.conectores(_e([h], conectores=disponibles), INV, corrida)
    assert i["cifra"] == "1 de 10 disponibles" and i["estado"] == "aviso"
    assert "solo las usa la pregunta con herramientas" in i["texto"]


# --- tiempo ------------------------------------------------------------------


def test_el_tiempo_se_reparte_en_cuatro_y_solo_vigila_el_trabajo_sin_modelo():
    minuto = 60_000
    c = {"id": "c1", "estado": "terminada", "empezadaEn": 0, "terminadaEn": 100 * minuto, "pausaMs": 10 * minuto, "esperaHumanaMs": 0}
    llamadas = [(0, 50 * minuto), (40 * minuto, 20 * minuto)]  # solapan: 60 min de unión, no 70
    ticks = list(range(0, 80 * minuto + 1, 20_000)) + [100 * minuto]  # de 80 a 100 sin nada: apagado
    i = M.tiempo(c, llamadas, 10**15, ticks)
    d = i["datos"]
    assert d["conModeloMs"] == 60 * minuto and d["apagadoMs"] == 20 * minuto and d["sinModeloMs"] == 10 * minuto
    assert "20 con el servidor apagado o colgado" in i["texto"]
    assert i["estado"] == "bien"  # 10 de 70 activos: 14 %, por debajo del 15 %


def test_las_llamadas_de_despues_de_la_corrida_no_cuentan():
    """El error del 29 de septiembre: el relleno de fondo sigue llamando después de
    terminar, y contarlo dio 47 min muertos en una corrida que tenía 5."""
    minuto = 60_000
    c = {"id": "c1", "estado": "terminada", "empezadaEn": 0, "terminadaEn": 30 * minuto}
    i = M.tiempo(c, [(0, 30 * minuto), (40 * minuto, 60 * minuto)], 10**15, list(range(0, 30 * minuto, 20_000)))
    assert i["datos"]["conModeloMs"] == 30 * minuto and i["datos"]["sinModeloMs"] == 0


def test_una_corrida_pausada_no_se_reparte():
    """cor-mucppi81-3411, pausada por presupuesto una semana, salía con 483 min
    "sin modelo" contando hasta ahora."""
    i = M.tiempo({"id": "c1", "estado": "pausada_por_presupuesto", "empezadaEn": 0}, [], 10**9, [])
    assert i["estado"] == "sin_datos" and "no está en marcha" in i["texto"]


def test_la_union_de_intervalos():
    assert M.union_de_intervalos([]) == 0
    assert M.union_de_intervalos([(0, 10), (5, 10), (20, 5)]) == 20
    assert M.union_de_intervalos([(0, 10), (0, 10)]) == 10


# --- el tablero --------------------------------------------------------------


def test_el_tablero_entero_con_estado_vacio_no_rompe_y_un_indicador_roto_no_tumba_los_demas(monkeypatch):
    t = M.tablero({}, INV, 1000)
    assert len(t["indicadores"]) == 8 and t["avisos"] == []
    monkeypatch.setattr(M, "embudo", lambda e, i: 1 / 0)
    t2 = M.tablero(_e(), INV, 1000)
    rotos = [i for i in t2["indicadores"] if i["clave"] == "embudo"]
    assert rotos and rotos[0]["estado"] == "sin_datos" and "ZeroDivisionError" in rotos[0]["texto"]


def test_solo_se_avisa_de_lo_que_pasa_a_aviso():
    e = _e([_h(1, apoyos=25)])
    t1 = M.tablero(e, INV, 1000)
    assert [x["clave"] for x in M.fijar(e, INV, t1)] == ["balanza"]
    t2 = M.tablero(e, INV, 2000)
    assert M.fijar(e, INV, t2) == []  # el mismo aviso otra vez es ruido
    assert e["investigaciones"][0]["metodo"]["fecha"] == 2000


def test_el_texto_para_el_modelo_lleva_estado_cifra_fase_y_que_haria_falta():
    t = M.tablero(_e([_h(1, apoyos=25)]), INV, 1000)
    txt = M.texto(t)
    assert "[AVISO] Lo que apoya frente a lo que contradice (25 a favor, 0 en contra; fase: cribado)" in txt
    assert "Haría falta: Búsquedas dirigidas" in txt
    assert M.texto(None) == "Tablero del método sin calcular."


def test_el_tablero_no_decide_nada():
    """No cambia la certeza, no suspende, no toca hipótesis: solo lee."""
    import copy

    e = _e([_h(1, apoyos=25, decision="suspender", certeza="baja")], cuestiones=[_c(i) for i in range(12)])
    antes = copy.deepcopy(e)
    M.tablero(e, INV, 1000)
    assert e == antes


# --- integración -------------------------------------------------------------


def test_el_cierre_de_iteracion_calcula_el_tablero_y_el_revisor_del_arnes_lo_recibe():
    from rosa.bucle import corrida as CO
    from rosa.modulos import firmas as F

    cierre = inspect.getsource(CO._vistas_de_programa_al_cerrar)
    assert "METODO.tablero(" in cierre and "METODO.fijar(" in cierre
    assert "metodo" in F.RevisarArnes.model_fields
    revisor = inspect.getsource(CO.Supervisor._revisar_arnes) if hasattr(CO, "Supervisor") else inspect.getsource(CO)
    assert "metodo=METODO.texto(tablero)" in revisor
    assert "Cada propuesta cita el indicador del tablero" in (F.RevisarArnes.__doc__ or "")


def test_la_hipotesis_nacida_del_equipo_guarda_su_enfoque():
    from rosa.bucle import pasos as PASOS
    from rosa.bucle import vivero as VIVERO

    fuente = inspect.getsource(PASOS.paso_hipotesis)
    assert 'h["enfoque"] = enfoque' in fuente and 'semilla["enfoque"] = enfoque' in fuente
    assert 'h["enfoque"] = semilla["enfoque"]' in inspect.getsource(VIVERO.nacer)


def test_el_bucle_calcula_el_tablero_que_falta_sin_eventos_y_una_sola_vez(tmp_path, monkeypatch):
    """Las investigaciones anteriores al tablero lo reciben en el primer tick, por
    regla y sin eventos (de golpe serían veinte avisos que ya estaban). Si el
    registro falla, sale sin el tiempo; y nunca se reintenta en cada tick."""
    from types import SimpleNamespace

    from rosa.bucle import corrida as CO
    from rosa.estado.almacen import Almacen

    al = Almacen(tmp_path / "m.db")
    try:
        al.mutar(lambda e: (e["investigaciones"].append({"id": "inv-x", "titulo": "T", "objetivo": "O"}), e["hipotesis"].extend(_h(i, apoyos=25) | {"investigacionId": "inv-x"} for i in range(1)), True)[-1], "test")
        eventos_antes = len(al.estado["eventos"])
        sup = SimpleNamespace(almacen=al)
        asyncio.run(CO.Supervisor._tableros_que_faltan(sup))
        inv = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-x")
        assert inv["metodo"]["avisos"] == ["balanza"]
        assert len(al.estado["eventos"]) == eventos_antes
        # Ya lo tiene: el siguiente tick no escribe nada.
        version = al.version
        asyncio.run(CO.Supervisor._tableros_que_faltan(sup))
        assert al.version == version

        # Con el registro roto, igual sale (sin el tiempo) y no se queda pendiente.
        al.mutar(lambda e: (e["investigaciones"].append({"id": "inv-y", "titulo": "T", "objetivo": "O"}), e["corridas"].append({"id": "c-y", "investigacionId": "inv-y", "empezadaEn": 1}), True)[-1], "test")
        monkeypatch.setattr(al, "intervalos_de_llamadas", lambda cid: 1 / 0)
        asyncio.run(CO.Supervisor._tableros_que_faltan(sup))
        inv_y = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-y")
        assert isinstance(inv_y["metodo"], dict) and len(inv_y["metodo"]["indicadores"]) == 8
    finally:
        al.cerrar()


def test_un_tablero_de_reglas_viejas_se_rehace(tmp_path):
    """Un tablero guardado con otra versión de las reglas no es el de hoy: el
    bucle lo rehace, como se reacotan las conclusiones cuando cambia la certeza."""
    from types import SimpleNamespace

    from rosa.bucle import corrida as CO
    from rosa.estado.almacen import Almacen

    al = Almacen(tmp_path / "v.db")
    try:
        viejo = {"fecha": 1, "iteracion": 3, "corridaId": None, "reglas": M.VERSION_REGLAS - 1, "indicadores": [], "avisos": []}
        al.mutar(lambda e: (e["investigaciones"].append({"id": "inv-v", "titulo": "T", "objetivo": "O", "metodo": viejo}), True)[-1], "test")
        asyncio.run(CO.Supervisor._tableros_que_faltan(SimpleNamespace(almacen=al)))
        t = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-v")["metodo"]
        assert M.vigente(t) and len(t["indicadores"]) == 8
        assert not M.vigente(viejo) and not M.vigente(None)
    finally:
        al.cerrar()


# --- nichos (MAP-Elites) -----------------------------------------------------


def _mapa(*celdas):
    return {"fecha": 1, "celdas": list(celdas)}


def _celda(estadio, region, celula, hipotesis=(), hechos=(), cohortes=()):
    return {"estadio": estadio, "region": region, "tipoCelular": celula, "hipotesis": list(hipotesis), "hechos": list(hechos), "cohortes": list(cohortes)}


def test_el_indicador_de_nichos_avisa_del_rincon_lleno_con_rincones_listos():
    hs = [_h(i) for i in range(4)]
    mapa = _mapa(_celda("preclinica", "plasma", "astrocito", hipotesis=[h["id"] for h in hs]), _celda("prodromica_dcl", "plasma", "astrocito", hechos=["he1", "he2"], cohortes=["ADNI", "BIOCARD"]))
    i = M.nichos(_e(hs), INV, mapa)
    assert i["estado"] == "aviso" and "4 hipótesis vivas en la misma celda" in i["texto"]
    assert "fase prodrómica o DCL" in i["texto"] and i["datos"]["listos"] == 1


def test_el_indicador_de_nichos_cuenta_las_nacidas_en_un_rincon_vacio():
    """Es la comprobación de la predicción: de las que guardan su nicho, cuántas
    cayeron en uno vacío."""
    hs = [_h(1, nicho={"celdas": ["x"], "enNichoListo": True}), _h(2, nicho={"celdas": ["y"], "enNichoListo": False}), _h(3)]
    mapa = _mapa(_celda("preclinica", "plasma", "astrocito", hipotesis=["h1"]))
    i = M.nichos(_e(hs), INV, mapa)
    assert "De las 2 que nacieron desde que se guarda el nicho, 1 cayó en un rincón vacío." in i["texto"]
    solo = M.nichos(_e([_h(1, nicho={"celdas": ["x"], "enNichoListo": False})]), INV, mapa)
    assert "La única que nació desde que se guarda el nicho no cayó en un rincón vacío." in solo["texto"]
    assert i["datos"]["conNicho"] == 2 and i["datos"]["enNichoListo"] == 1


def test_sin_mapa_calculado_lo_dice_y_no_finge():
    assert "no se ha calculado todavía" in M.nichos(_e(), INV, None)["texto"]
    assert "no se ha calculado todavía" in M.nichos(_e(), INV, {"celdas": []})["texto"]



def test_un_mapa_viejo_se_rehace_y_el_tablero_lo_usa(tmp_path):
    """El mapa guardado de APOE4 era del 17 de septiembre y el tablero decía "0
    rincones vacíos" justo donde estaban las 7 hipótesis amontonadas. Un mapa más
    viejo que la última hipótesis de la investigación se rehace, sin eventos."""
    from types import SimpleNamespace

    from rosa.bucle import corrida as CO
    from rosa.estado.almacen import Almacen

    al = Almacen(tmp_path / "mv.db")
    try:
        def fn(e):
            e["investigaciones"].append({"id": "inv-m", "titulo": "T", "objetivo": "O", "mapaEnfermedad": {"fecha": 5, "celdas": [], "iteracion": 2}})
            e["hipotesis"].append(_h(1) | {"investigacionId": "inv-m", "creadaEn": 50})
            return True

        al.mutar(fn, "test")
        eventos = len(al.estado["eventos"])
        asyncio.run(CO.Supervisor._tableros_que_faltan(SimpleNamespace(almacen=al)))
        inv = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-m")
        assert inv["mapaEnfermedad"]["fecha"] > 50 and inv["mapaEnfermedad"]["iteracion"] == 2
        assert "etiquetas" in inv["mapaEnfermedad"] and M.vigente(inv["metodo"])
        assert len(al.estado["eventos"]) == eventos
        # Al día: el siguiente tick no escribe nada.
        version = al.version
        asyncio.run(CO.Supervisor._tableros_que_faltan(SimpleNamespace(almacen=al)))
        assert al.version == version
    finally:
        al.cerrar()


def test_un_mapa_que_no_se_deja_calcular_no_se_reintenta_en_cada_tick(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from rosa import mapa_enfermedad as MAPA
    from rosa.bucle import corrida as CO
    from rosa.estado.almacen import Almacen

    al = Almacen(tmp_path / "mf.db")
    llamadas = []

    def roto(e, inv_id):
        llamadas.append(inv_id)
        raise RuntimeError("dictionary changed size during iteration")

    monkeypatch.setattr(MAPA, "mapa", roto)
    try:
        al.mutar(lambda e: (e["investigaciones"].append({"id": "inv-f", "titulo": "T", "objetivo": "O"}), True)[-1], "test")
        sup = SimpleNamespace(almacen=al)
        asyncio.run(CO.Supervisor._tableros_que_faltan(sup))
        inv = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-f")
        assert M.vigente(inv["metodo"])  # el tablero sale igual, sin el mapa
        version = al.version
        for _ in range(5):
            asyncio.run(CO.Supervisor._tableros_que_faltan(sup))
        assert llamadas == ["inv-f"] and al.version == version
    finally:
        al.cerrar()


def test_el_tablero_rehecho_con_un_mapa_fresco_lee_sus_nichos(tmp_path):
    """El fallo de la primera versión: el mapa recién calculado se le pasaba al
    tablero sin fecha, y el indicador de nichos decía "sin mapa" en las cuatro
    investigaciones cuyo mapa se acababa de rehacer."""
    from types import SimpleNamespace

    from rosa.bucle import corrida as CO
    from rosa.estado.almacen import Almacen

    al = Almacen(tmp_path / "mn.db")
    try:
        al.mutar(lambda e: (e["investigaciones"].append({"id": "inv-n", "titulo": "T", "objetivo": "O"}), True)[-1], "test")
        asyncio.run(CO.Supervisor._tableros_que_faltan(SimpleNamespace(almacen=al)))
        inv = next(i for i in al.estado["investigaciones"] if i["id"] == "inv-n")
        nichos = next(x for x in inv["metodo"]["indicadores"] if x["clave"] == "nichos")
        assert "no se ha calculado todavía" not in nichos["texto"]
    finally:
        al.cerrar()
