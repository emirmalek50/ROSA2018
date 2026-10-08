"""Memoria de errores: lecciones por regla, consultas previas con rendimiento,
excluidos reutilizados, descartados por pertinencia, el descarte pendiente del
Killer visible, vivero con memoria de retiradas y traspaso ejecutable."""
import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

from rosa import indice_semantico
from rosa import lecciones as LEC
from rosa.bucle import contexto as T
from rosa.bucle import pasos as PASOS
from rosa.bucle import vivero as VIVERO
from rosa.bucle.pasos import Ctx
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen


def _estado_cierre():
    c = {"id": "cor", "numero": 2, "investigacionId": "inv", "estado": "en_marcha", "empezadaEn": 100, "gasto": {"usd": 3.0},
         "busqueda": {"consultas": [{"consulta": "gfap AND nfl", "base": "PubMed", "iteracion": 2, "resultados": 0}, {"consulta": "retina AND amyloid", "base": "Europe PMC", "iteracion": 2, "resultados": 40, "relevantes": 0}, {"consulta": "buena", "base": "PubMed", "iteracion": 2, "resultados": 12, "relevantes": 5}, {"consulta": "vieja", "base": "PubMed", "iteracion": 1, "resultados": 0}], "excluidos": []},
         "_fallosFuente": {"ClinicalTrials.gov v2": 3, "Exa": 1}, "_afirmaciones": [{"iteracion": 2, "veredicto": "sin_verificar"}, {"iteracion": 2, "veredicto": "sostenida"}]}
    it = {"id": "it2", "corridaId": "cor", "numero": 2, "empezadaEn": 1000, "plan": [{"id": "p1", "titulo": "Buscar ensayos", "tipo": "ensayos", "estado": "fallido", "motivoFallo": "ClinicalTrials no respondió"}, {"id": "p2", "titulo": "Extraer", "estado": "hecho"}], "pistas": [{"id": "pi1", "titulo": "Exa gris", "tipo": "literatura", "fuente": "Exa", "estado": "fallida", "resumen": "sin clave"}], "revisionRegistro": {"hallazgos": [{"id": "rr1", "clase": "contradiccion_con_registro", "gravedad": "media", "detalle": "3 hipótesis en el texto, 2 en el registro", "estado": "abierto"}]}}
    it1 = {"id": "it1", "corridaId": "cor", "numero": 1, "empezadaEn": 100, "plan": [{"id": "p0", "titulo": "Buscar ensayos", "tipo": "ensayos", "estado": "fallido", "motivoFallo": "timeout"}], "pistas": []}
    e = {"investigaciones": [{"id": "inv", "titulo": "t", "objetivo": "GFAP y NfL", "viveroRetiradas": [{"id": "s1", "titulo": "TREM2 y GFAP", "enunciado": "x", "motivo": "6 iteraciones sin evidencia nueva", "iteracion": 1, "retiradaEn": 1500}]}],
         "corridas": [c], "iteraciones": [it1, it], "hipotesis": [{"id": "h1", "investigacionId": "inv", "titulo": "GFAP antes que NfL en BIOCARD", "estado": "descartada", "elo": 1400, "revisiones": [{"accion": "killer", "nota": "misma cohorte"}]}],
         "decisiones": [{"id": "d1", "investigacionId": "inv", "hipotesisId": "h1", "etapa": "killer_1", "decision": "descartar_en_contexto", "fecha": 1200, "comprobaciones": [{"comprobacion": "independencia_cohortes", "resultado": "falla"}, {"comprobacion": "fidelidad_evidencia", "resultado": "pasa"}], "queHariaFalta": "una segunda cohorte"}, {"id": "d0", "investigacionId": "inv", "hipotesisId": "h1", "etapa": "killer_1", "decision": "avanzar", "fecha": 1300, "comprobaciones": []}],
         "ejecuciones": [{"id": "run1", "investigacionId": "inv", "tipo": "analisis", "inicio": 1100, "estado": "completado", "interpretacion": {"estado": "sin_efecto_detectable", "resumen": "p = 0,4 en OASIS"}}],
         "incidencias": [{"id": "inc1", "corridaId": "cor", "tipo": "fuente_sin_respuesta", "recurso": "ClinicalTrials.gov v2", "titulo": "lleva 3 fallos", "alternativa": "seguir con las demás", "creadaEn": 1400, "estado": "pendiente"}],
         "aprendizaje": [{"investigacionId": "inv", "tipo": "creencia", "nivel": 1, "descripcion": "h2: de muy_baja a baja", "fecha": 1600}],
         "lecciones": [], "eventos": []}
    return e, c, it


def test_generar_lecciones_al_cerrar_por_regla_y_registrar_sin_repetir():
    e, c, it = _estado_cierre()
    lecs = LEC.generar_al_cerrar(e, c, it, it["revisionRegistro"], 2000)
    ambitos = sorted(l["ambito"] for l in lecs)
    textos = "\n".join(l["texto"] for l in lecs)
    assert ambitos.count("plan") == 3 and ambitos.count("consultas") == 2 and ambitos.count("fuentes") == 1 and ambitos.count("resumen") == 1 and ambitos.count("hipotesis") == 2 and ambitos.count("analisis") == 1
    assert "ya había fallado en la iteración anterior" in textos  # racha del paso
    assert "«vieja»" not in textos and "devolvió 0 resultados" in textos and "ninguno relevante" in textos
    assert "ClinicalTrials.gov v2 no respondió 3 veces" in textos and "Exa no respondió" not in textos
    assert "fallaron independencia cohortes" in textos and "una segunda cohorte" in textos and "avanzar" not in textos
    assert "TREM2 y GFAP» salió del vivero" in textos and "sin efecto detectable" in textos
    nuevas = LEC.registrar(e, lecs)
    assert nuevas == len(lecs) == len(e["lecciones"])
    # La misma lección otra vez suma veces en vez de duplicarse.
    otra = LEC.generar_al_cerrar(e, c, it, it["revisionRegistro"], 3000)
    assert LEC.registrar(e, otra) == 0 and all(l["veces"] == 2 for l in e["lecciones"]) and e["lecciones"][0]["ultimaVez"] == 3000
    texto = LEC.texto_de(LEC.recientes(e, "inv", ("consultas",)))
    assert texto.startswith("Lecciones de esta investigación") and "[consultas]" in texto and "(visto 2 veces)" in texto and "[plan]" not in texto
    assert LEC.texto_de([]) == "Ninguna todavía."


def test_lecciones_para_un_paso_sin_indice_y_con_indice(monkeypatch):
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    try:
        e0, c, it = _estado_cierre()
        lecs = LEC.generar_al_cerrar(e0, c, it, it["revisionRegistro"], 2000)

        def fn(e):
            LEC.registrar(e, lecs)
            return True

        al.mutar(fn, "test")
        sin = asyncio.run(LEC.para(al, "inv", ("consultas",), "gfap"))
        assert "[consultas]" in sin and "[plan]" not in sin

        class IndiceFalso:
            async def buscar(self, texto, k, investigacion_id=None, tipos=None, **kw):
                assert tipos == ("leccion",)
                objetivo = next(l for l in al.estado["lecciones"] if "sin efecto" in l["texto"])
                return [{"id": f"leccion:{objetivo['id']}", "similitud": 0.9}]

        monkeypatch.setattr(indice_semantico, "disponible", lambda: True)
        monkeypatch.setattr(indice_semantico, "de_almacen", lambda a: IndiceFalso())
        con = asyncio.run(LEC.para(al, "inv", None, "análisis OASIS", maximo=4))
        assert "sin efecto detectable" in con
    finally:
        al.cerrar()


def test_consultas_previas_de_toda_la_investigacion_con_rendimiento():
    e, c, it = _estado_cierre()
    e["corridas"].append({"id": "cor1", "numero": 1, "investigacionId": "inv", "busqueda": {"consultas": [{"consulta": "primera", "base": "PubMed", "iteracion": 1, "resultados": 3, "relevantes": 1, "modo": "amplitud"}]}})
    assert T.consultas_hechas(e, "inv") == ["gfap AND nfl", "retina AND amyloid", "buena", "vieja", "primera"] or T.consultas_hechas(e, "inv")[0] == "primera"
    texto = T.consultas_previas_texto(e, "inv")
    assert "«primera» (PubMed, corrida 1, iteración 1): 3 resultados, 1 relevantes [amplitud]" in texto
    assert "«gfap AND nfl» (PubMed, corrida 2, iteración 2): 0 resultados" in texto
    assert T.consultas_previas_texto({"corridas": []}, "inv") == "Ninguna"


def test_traspaso_de_iteracion_y_de_corrida():
    e, c, it = _estado_cierre()
    t = T.traspaso_iteracion(e, it, c)
    assert "Pasos que no terminaron: «Buscar ensayos» (fallido: ClinicalTrials no respondió)" in t
    assert "Pistas fallidas: «Exa gris»: sin clave" in t and "«gfap AND nfl» en PubMed (0 resultados" in t and "«buena»" not in t
    assert "ClinicalTrials.gov v2 (3 fallos)" in t and "1 afirmaciones quedaron sin verificar" in t and "Incidencias pendientes" in t
    assert "Cambios de creencia en la iteración: h2: de muy_baja a baja" in t and "Hallazgos del revisor de registro abiertos: contradiccion con registro" in t  # sin tildes: la clase del hallazgo es un identificador
    assert T.traspaso_iteracion(e, {"numero": 9, "plan": [], "pistas": [], "empezadaEn": 10**13}, {"id": "otra", "investigacionId": "inv", "busqueda": {"consultas": []}}) .startswith("La iteración anterior no dejó")
    assert T.traspaso_de_corrida(e, "inv") == "Primera corrida de la investigación: no hay traspaso."
    c["estado"] = "terminada"
    c["terminadaEn"] = 5000
    c["motivoCierre"] = "Se cumplió el tiempo"
    c["metrica"] = {"peldanosNetos": 2, "iteraciones": 2, "hechosNuevos": 7, "usd": 3.0, "fallidos": {"pasos": 1}}
    c["pregunta"] = {"enunciado": "¿La caída de tau-PET anticipa el beneficio?"}
    c["metaRevisiones"] = [{"debilidades": [{"texto": "Confunde cohortes", "inyectada": False}]}]
    c["arnes"] = {"commit": "abc1234"}
    it["terminadaEn"] = 4000
    it["resumen"] = "Se leyeron 40 fuentes."
    t2 = T.traspaso_de_corrida(e, "inv")
    assert t2.startswith("- Corrida 2 (terminada): Se cumplió el tiempo") and "Balance: 2 peldaños netos" in t2 and "Pregunta que trabajó: ¿La caída de tau-PET" in t2
    assert "Última iteración (2): Se leyeron 40 fuentes." in t2 and "«GFAP antes que NfL en BIOCARD» por independencia cohortes" in t2
    assert "Consultas hechas: 4" in t2 and "Debilidades del panorama no atendidas: Confunde cohortes" in t2 and "Corrió con ROSA2018 abc1234" in t2


def test_hipotesis_existentes_ensena_el_descarte_pendiente_del_killer():
    hs = [{"id": "h1", "investigacionId": "inv", "estado": "en_revision", "elo": 1500, "titulo": "GFAP antes que NfL", "decisionKiller": "descartar_en_contexto", "revisiones": [{"accion": "killer", "nota": "descartar en contexto: misma cohorte"}]},
          {"id": "h2", "investigacionId": "inv", "estado": "propuesta", "elo": 1500, "titulo": "Otra", "decisionKiller": None, "revisiones": []}]
    t = T.hipotesis_existentes(hs, "inv")
    assert "Killer propone descartar (pendiente de persona): descartar en contexto: misma cohorte" in t and "Otra" in t


def test_vivero_recuerda_las_retiradas_y_no_las_repropone():
    e = {"investigaciones": [{"id": "inv", "titulo": "t", "vivero": [{"id": "s1", "investigacionId": "inv", "titulo": "TREM2 y GFAP", "enunciado": "x", "iteracion": 1, "afirmaciones": [], "fuentes": []}]}], "eventos": []}
    assert VIVERO.retirar(e, e["investigaciones"][0]["vivero"][0], "6 iteraciones sin evidencia nueva", 9000) is True
    inv = e["investigaciones"][0]
    assert inv["vivero"] == [] and inv["viveroRetiradas"][0]["titulo"] == "TREM2 y GFAP" and inv["viveroRetiradas"][0]["retiradaEn"] == 9000
    assert "trem2 y gfap" in VIVERO.titulos(inv)
    assert "Ideas retiradas del vivero (no reproponerlas sin evidencia nueva): «TREM2 y GFAP»" in T.vivero_texto(inv) or "Ideas retiradas (no reproponerlas sin evidencia nueva): «TREM2 y GFAP»" in T.vivero_texto(inv)


def test_descartados_del_nucleo_por_pertinencia(monkeypatch):
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    try:
        def fn(e):
            for i in range(8):
                e["hechos"].append({"id": f"d{i}", "investigacionId": "inv", "enunciado": f"Descartado antiguo {i}", "estado": "descartado", "prioridad": 9, "tipo": "hecho", "tema": "x", "procedencia": [], "motivoDescarte": "viejo", "actualizadoEn": 100 + i})
            e["hechos"].append({"id": "dg", "investigacionId": "inv", "enunciado": "GFAP baja tras eliminar amiloide en toda cohorte", "estado": "descartado", "prioridad": 9, "tipo": "hecho", "tema": "gfap", "procedencia": [], "motivoDescarte": "contradicho", "actualizadoEn": 1})
            e["hechos"].append({"id": "s1", "investigacionId": "inv", "enunciado": "Un hecho sabido", "estado": "sabido", "prioridad": 2, "tipo": "hecho", "tema": "x", "procedencia": [], "motivoDescarte": None, "actualizadoEn": 50})
            e["investigaciones"].append({"id": "inv", "titulo": "t"})
            return True

        al.mutar(fn, "test")
        # Sin índice: los descartados más recientes, no los de menor prioridad (todos tienen 9).
        texto = asyncio.run(T.modelo_de_mundo_para(al, "inv", "GFAP", maximo=8))
        assert "Descartado antiguo 7" in texto and "GFAP baja tras eliminar" not in texto.split("Hechos pertinentes")[1][:400]

        class IndiceFalso:
            async def buscar(self, texto, k, investigacion_id=None, tipos=None, **kw):
                return [{"id": "hecho:dg", "similitud": 0.9}, {"id": "hecho:s1", "similitud": 0.5}]

        monkeypatch.setattr(indice_semantico, "disponible", lambda: True)
        monkeypatch.setattr(indice_semantico, "de_almacen", lambda a: IndiceFalso())
        texto = asyncio.run(T.modelo_de_mundo_para(al, "inv", "GFAP y amiloide", maximo=6))
        cuerpo = texto.split("Hechos pertinentes")[1]
        assert "GFAP baja tras eliminar amiloide" in cuerpo and cuerpo.index("GFAP baja") < cuerpo.index("Un hecho sabido")
    finally:
        al.cerrar()


def test_los_excluidos_de_la_investigacion_no_se_vuelven_a_cribar(monkeypatch):
    al = Almacen(Path(tempfile.mkdtemp()) / "t.db")
    try:
        def fn(e):
            e["investigaciones"].append({"id": "inv", "titulo": "t", "objetivo": "GFAP y NfL", "limites": [], "condicionParada": "x", "configuracion": {"preferencias": "", "atributos": [], "restricciones": [], "amplitud": "enfocada"}, "vivero": []})
            c_prev = P.nueva_corrida("inv", 1, 500)
            c_prev["id"] = "cor1"
            c_prev["estado"] = "terminada"
            c_prev["busqueda"]["excluidos"] = [{"referencia": "Lejano, 2026", "titulo": "Zebrafish tau model", "doi": "10.1/zebra", "pmid": None, "relevancia": 1, "modo": "foco", "motivo": "otra especie", "iteracion": 2}, {"referencia": "Rozando, 2026", "titulo": "Rozando el listón", "doi": "10.1/roza", "pmid": None, "relevancia": 4, "modo": "foco", "motivo": "casi", "iteracion": 2}]
            e["corridas"].append(c_prev)
            c = P.nueva_corrida("inv", 2, 1000)
            c["id"] = "cor"
            e["corridas"].append(c)
            it = P.nueva_iteracion("cor", 1, 1000, [P.nuevo_paso("Buscar", "", 20)], 40)
            it["id"] = "it"
            e["iteraciones"].append(it)
            return True

        al.mutar(fn, "test")
        articulos = [
            {"referencia": "Lejano, 2026", "titulo": "Zebrafish tau model", "resumen": "Zebrafish", "doi": "10.1/zebra", "pmid": None, "anio": 2026, "tipos": [], "autores": []},
            {"referencia": "Rozando, 2026", "titulo": "Rozando el listón", "resumen": "Roza", "doi": "10.1/roza", "pmid": None, "anio": 2026, "tipos": [], "autores": []},
            {"referencia": "Nuevo, 2026", "titulo": "GFAP precede a NfL en ADNI", "resumen": "ADNI", "doi": "10.1/nuevo", "pmid": None, "anio": 2026, "tipos": [], "autores": []},
        ]

        async def buscar_falso(consulta, maximo=10, solo_preprints=False):
            return articulos, 3

        async def fragmentos_falsos(ctx, datos, pista, con_texto):
            return [{"localizador": "resumen", "texto": datos.get("resumen", ""), "encabezado": ""}]

        monkeypatch.setattr(PASOS.europepmc, "buscar", buscar_falso)
        monkeypatch.setattr(PASOS, "_fragmentos_de", fragmentos_falsos)
        vistos = []

        async def llamar(self, rol, programa, **kw):
            vistos.append(kw["titulo"])
            return SimpleNamespace(puntuacion=7 if "GFAP" in kw["titulo"] else 3, motivo="m")

        monkeypatch.setattr(Ctx, "llamar", llamar)
        ctx = Ctx(al, SimpleNamespace(relevancia="relevancia"), None, "cor", "inv", "it", 1)
        paso = ctx.iteracion()["plan"][0]
        r = asyncio.run(PASOS._consulta_literatura(ctx, paso, {"base": "europepmc", "consulta": "gfap", "tema": "GFAP", "modo": "foco"}, "Objetivo: GFAP y NfL"))
        # El claramente excluido (1) no pasa por el modelo; el que rozaba (4) sí se vuelve a mirar.
        assert sorted(vistos) == ["GFAP precede a NfL en ADNI", "Rozando el listón"]
        assert r["cribados"] == 1
        ex = ctx.corrida()["busqueda"]["excluidos"]
        assert any(x["titulo"] == "Zebrafish tau model" and x["motivo"].startswith("ya excluido en la corrida 1 (iteración 2): otra especie") for x in ex)
        reg = ctx.corrida()["busqueda"]["consultas"][-1]
        assert reg["relevantes"] == 1
    finally:
        al.cerrar()


def test_consultas_incompletas_no_ensenan_ausencia_ni_prohiben_reintento():
    e, c, it = _estado_cierre()
    c["busqueda"]["consultas"] = [
        {"base": "Scopus", "consulta": "desconocida", "iteracion": 2, "resultados": None, "recuperados": 0, "estado": "no_comprobado", "error": "HTTP 403"},
        {"base": "Embase", "consulta": "parcial", "iteracion": 2, "resultados": None, "recuperados": 3, "relevantes": 0, "estado": "parcial", "limitaciones": ["Descubrimiento web acotado"]},
        {"base": "WoS", "consulta": "parcial con cifra", "iteracion": 2, "resultados": 0, "relevantes": 0, "estado": "parcial"},
    ]
    lecs = LEC.generar_al_cerrar(e, c, it, {}, 2000)
    assert not [l for l in lecs if l["ambito"] == "consultas"]
    texto = T.traspaso_iteracion(e, it, c)
    assert "Consultas que no rindieron" not in texto and "None resultados" not in texto
    assert "total no comprobado" in texto and "3 candidatos recuperados" in texto
    assert "HTTP 403" in texto and "estado parcial" in texto and "no permiten concluir ausencia" in texto


def test_resumen_para_modelos_separa_total_y_candidatos():
    texto = T.resumen_consulta({"resultados": None, "recuperados": 4, "estado": "parcial", "limitaciones": ["Índice privado no consultado"]})
    assert texto == "total no comprobado; 4 candidatos recuperados; estado parcial; limitaciones: Índice privado no consultado"
    assert T.resumen_consulta({"resultados": 0}) == "0 resultados"
