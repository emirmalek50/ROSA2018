"""La variedad oral conserva continuidad, procedencia y revisión independiente.

Todos los modelos son sustitutos locales; cada estado usa SQLite temporal.
"""

from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path

import dspy
import pytest
from litellm import ModelResponse

from rosa import gateway
from rosa.estado.almacen import Almacen
from rosa.laboratorio_conversaciones import ESTILO, REGLAS, REGLAS_JUEZ, Conversaciones, tema_de
from rosa.modulos.contador import contexto_actual

REPETIDO = "Me intriga cómo se asocia MAPT con tau en ratones."
NUEVO = "Aquí sigo viendo una asociación, todavía sin causalidad establecida."


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / "diversidad.db")
    def preparar(e):
        e.update(
            investigaciones=[{"id": "inv", "titulo": "MAPT"}],
            corridas=[{
                "id": cid, "investigacionId": "inv", "estado": "en_marcha", "iteracionActual": 1,
                "presupuesto": {"limiteLlamadas": 200},
                "gasto": {"llamadas": 0, "tokensEntrada": 0, "tokensSalida": 0, "usd": 0.0, "usdReal": 0.0},
                "contexto": {"tokensUsados": 0, "tokensLimite": 400000},
                "_afirmaciones": [{"id": "a", "iteracion": n, "texto": "MAPT se asoció con tau en ratones",
                                   "fragmento": "Association in mice", "cita": "PMID:123, p. 4", "veredicto": "parcial"}
                                  for n in (1, 2)],
            } for cid in ("cor", "otra-cor")],
            iteraciones=[{
                "id": iid, "corridaId": cid, "numero": n, "terminadaEn": None, "planAprobado": True,
                "presupuesto": {"limite": 100, "usado": 0, "reservaCierre": 10},
                "pistas": [{"id": f"pi-mu00000{n}-x", "tipo": "verificacion", "titulo": "Verificar evidencia",
                            "estado": "hecha", "transcripcion": [{"t": 1200, "tipo": "resultado",
                            "texto": "La asociación de MAPT con tau en ratones sigue siendo parcial."}]}],
            } for cid, iid, n in (("cor", "it-1", 1), ("cor", "it-2", 2), ("otra-cor", "otra-it", 1))],
            hechos=[{"id": "hecho", "enunciado": "Conocimiento original", "estado": "sabido"}],
            hipotesis=[{"id": "h", "investigacionId": "inv", "titulo": "Propuesta original", "estado": "propuesta"}],
        )
        return True
    al.mutar(preparar, "preparar_prueba")
    yield al
    al.cerrar()


def guardar_voz(almacen, texto=REPETIDO, *, corrida="cor", iteracion="it-1", idioma="es", estilo=ESTILO,
                agente="Juez", destinatario="Killer", ident="anterior"):
    def guardar(e):
        c = next(c for c in e["corridas"] if c["id"] == corrida)
        c.setdefault("_conversacionesLaboratorio", []).append({
            "id": ident, "iteracionId": iteracion, "idioma": idioma, "estilo": estilo, "temaId": "tema-anterior",
            "agente": agente, "destinatario": destinatario, "texto": texto, "turno": 1, "fecha": 1,
            "modelo": "modelo-de-prueba", "materiales": [],
        })
        return True
    almacen.mutar(guardar, "voz_de_prueba")


def habilitar(conversaciones, clave):
    conversaciones.visitas[clave] = {"persona": time.monotonic() + 60}


def tema_actual(almacen, clave, participantes=None):
    tema = tema_de(almacen.estado, clave[0], clave[1])
    assert tema is not None
    return {**tema, "tipoConversacion": "actividad", **({"participantes": participantes} if participantes else {})}


def publicados(conversaciones, clave, tema):
    return [t for t in conversaciones.leer(clave) if t["temaId"] == tema["huella"]]


@pytest.mark.asyncio
@pytest.mark.parametrize("otra_iteracion", [False, True])
async def test_la_voz_recuerda_otro_companero_y_sobrevive_a_reabrir_la_corrida(almacen, otra_iteracion):
    guardar_voz(almacen)
    guardar_voz(almacen, "MEMORIA AJENA DE OTRA CORRIDA", corrida="otra-cor", iteracion="otra-it", ident="otro-servidor")
    guardar_voz(almacen, "ENGLISH MEMORY FROM ANOTHER LANGUAGE", idioma="en", ident="otro-idioma")
    guardar_voz(almacen, "MEMORIA VIEJA DEL ESTILO ANTERIOR", estilo="conversacion-natural-v2", ident="otro-estilo")
    if otra_iteracion:
        almacen.mutar(lambda e: e["corridas"][0].update(iteracionActual=2) or True, "avanzar")
    ruta = almacen.ruta
    almacen.cerrar()
    al = Almacen(ruta)
    clave = ("cor", "it-2" if otra_iteracion else "it-1", "es")
    recibidas = []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            return {"admisible": True}
        recibidas.append(copy.deepcopy(contenido))
        if contenido["turno"] == 1:
            memoria = [t["texto"] for t in contenido["memoriaDeVoz"]]
            return {"texto": NUEVO if REPETIDO in memoria else "No recuerdo nuestra conversación anterior.", "referencias": ["af:a"]}
        return {"texto": "Vale.", "referencias": ["af:a"]}
    s = Conversaciones(al, llamar)
    try:
        habilitar(s, clave)
        tema = tema_actual(al, clave, ["Juez", "Revisor inicial"])
        await s._conversar(clave, tema)
        assert publicados(s, clave, tema)[0]["texto"] == NUEVO
        primera = recibidas[0]
        assert [t["texto"] for t in primera["memoriaDeVoz"]] == [REPETIDO]
        assert "MEMORIA AJENA" not in json.dumps(primera)
        assert "ENGLISH MEMORY" not in json.dumps(primera)
        assert "MEMORIA VIEJA" not in json.dumps(primera)
        assert primera["historial"] == []  # La pareja es nueva; la voz conserva su continuidad.
        assert [t["texto"] for t in publicados(s, clave, tema)[1:]] == ["Vale.", "Vale."]
        assert al.estado["hechos"][0]["enunciado"] == "Conocimiento original"
        assert al.estado["hipotesis"][0]["estado"] == "propuesta"
    finally:
        await s.cerrar()
        al.cerrar()


@pytest.mark.asyncio
async def test_copiar_comentario_largo_se_repara_una_vez_y_la_version_nueva_pasa_por_juez(almacen):
    guardar_voz(almacen)
    autores, revisiones = [], []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(contenido["intervencion"]["texto"])
            return {"admisible": True}
        autores.append(copy.deepcopy(contenido))
        return {"texto": (NUEVO if contenido.get("correccion") else REPETIDO) if contenido["turno"] == 1 else "Vale.",
                "referencias": ["af:a"]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    try:
        await s._conversar(clave, tema)
        filas = publicados(s, clave, tema)
        assert [t["texto"] for t in filas] == [NUEVO, "Vale.", "Vale."]
        assert [c["turno"] for c in autores] == [1, 1, 2, 3]
        assert revisiones == [NUEVO, "Vale.", "Vale."]
        assert REPETIDO not in [t["texto"] for t in filas]
        assert filas[0]["materiales"][0]["veredicto"] == "parcial"
        assert filas[0]["materiales"][0]["cita"] == "PMID:123, p. 4"
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_sonar_distinto_inventando_eficacia_no_elude_el_juez(almacen):
    guardar_voz(almacen)
    invento = "Yo veo que el tratamiento cura Alzheimer en todos los pacientes."
    autores, revisiones = [], []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(contenido["intervencion"]["texto"])
            return {"admisible": False, "motivo": "La fuente solo describe una asociación parcial en ratones."}
        autores.append(1)
        return {"texto": invento if contenido.get("correccion") else REPETIDO, "referencias": ["af:a"]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    original = copy.deepcopy(almacen.estado)
    try:
        await s._conversar(clave, tema)
        assert len(autores) == 2 and revisiones == [invento]
        assert publicados(s, clave, tema) == []
        assert almacen.estado == original
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("motivo", ["presupuesto", "presupuesto_iteracion_preguntar", "pausa"])
async def test_cambio_de_corrida_durante_reparacion_impide_publicar(almacen, motivo):
    if motivo == "presupuesto_iteracion_preguntar":
        almacen.estado["autonomia"]["gastar_grande"] = "preguntar"
    guardar_voz(almacen)
    autores, revisiones = [], []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(1)
            return {"admisible": True}
        autores.append(1)
        if contenido.get("correccion"):
            if motivo == "pausa":
                almacen.mutar(lambda e: e["corridas"][0].update(estado="pausada") or True, "pausar")
            else:
                def agotar(e):
                    p = e["iteraciones"][0]["presupuesto"]
                    if motivo == "presupuesto_iteracion_preguntar":
                        p["usado"] = p["limite"] - p["reservaCierre"]
                    else:
                        from rosa.bucle.corrida import coste_previsto_del_cierre

                        c = e["corridas"][0]
                        reserva = max(p["reservaCierre"], coste_previsto_del_cierre(e, c["investigacionId"]))
                        c["gasto"]["llamadas"] = c["presupuesto"]["limiteLlamadas"] - reserva
                    return True
                almacen.mutar(agotar, "agotar")
            return {"texto": NUEVO, "referencias": ["af:a"]}
        return {"texto": REPETIDO, "referencias": ["af:a"]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    try:
        await s._conversar(clave, tema)
        assert len(autores) == 2 and revisiones == []
        assert publicados(s, clave, tema) == []
        assert almacen.estado["hipotesis"][0]["estado"] == "propuesta"
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_reparacion_que_sigue_copiando_no_reintenta_sin_limite(almacen):
    guardar_voz(almacen)
    llamadas = []
    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append((reglas, copy.deepcopy(contenido)))
        return {"admisible": True} if reglas == REGLAS_JUEZ else {"texto": REPETIDO, "referencias": ["af:a"]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    try:
        await s._conversar(clave, tema)
        assert len(llamadas) == 2
        assert all(reglas != REGLAS_JUEZ for reglas, _ in llamadas)
        assert publicados(s, clave, tema) == []
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("antecedentes,limite_fuente,reparar", [(1, False, True), (2, False, True), (1, True, False)])
async def test_abrir_declarando_interes_se_rehace_y_la_cautela_honesta_no(almacen, antecedentes, limite_fuente, reparar):
    # Desde el 8 de octubre de 2026 (Emir: «no simplemente que digan "me
    # interesa saber tal y tal cosa"») abrir con una declaración de interés se
    # rehace una vez, aunque sea la primera, y la versión nueva vuelve al juez.
    # Decir con honestidad que algo no se pudo comprobar sigue siendo válido.
    anteriores = ["Me interesa saber si esa asociación cambia entre distintos ratones.",
                  "Me interesa saber si esa relación se observó en otra cohorte."]
    candidato = "Me interesa saber si esa señal cambia con la población estudiada."
    if limite_fuente:
        anteriores = ["No pude comprobar la identidad de ese constructo con una fuente primaria."]
        candidato = "No pude comprobar la identidad del tratamiento en los materiales que recibí."
        almacen.mutar(lambda e: e["iteraciones"][0]["pistas"][0]["transcripcion"][0].update(
            texto="La fuente no respondió al intentar comprobar la identidad del tratamiento.") or True, "fuente_inaccesible")
    for n, texto in enumerate(anteriores[:antecedentes]):
        guardar_voz(almacen, texto, destinatario="Killer" if n == 0 else "Revisor inicial", ident=f"apertura-{n}")
    aperturas, revisiones = [], []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(contenido["intervencion"]["texto"])
            return {"admisible": True}
        if contenido["turno"] == 1:
            aperturas.append(copy.deepcopy(contenido))
            texto = NUEVO if contenido.get("correccion") else candidato
        else:
            texto = "Vale."
        ref = next(m["id"] for m in tema["materiales"] if m["clase"] == "registro")
        return {"texto": texto, "referencias": [ref]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    try:
        await s._conversar(clave, tema)
        filas = publicados(s, clave, tema)
        assert len(aperturas) == (2 if reparar else 1)
        if reparar:
            assert "declaración de interés" in aperturas[1]["revisionEstilo"] or "misma apertura" in aperturas[1]["revisionEstilo"]
        assert [t["texto"] for t in filas] == [NUEVO if reparar else candidato, "Vale.", "Vale."]
        assert revisiones == [t["texto"] for t in filas]
        if limite_fuente:
            assert filas[0]["texto"].startswith("No pude comprobar")
            assert "no respondió" in filas[0]["materiales"][0]["texto"]
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_tendencia_crosspareja_cuenta_cada_apertura_una_vez_sin_obligar_a_fabular(almacen):
    anteriores = ["Me interesa saber cómo se midió tau en los ratones.",
                  "Me interesa saber por qué falta describir la cohorte estudiada."]
    for n, texto in enumerate(anteriores):
        guardar_voz(almacen, texto, destinatario="Killer" if n == 0 else "Revisor inicial", ident=f"habito-{n}")
    aperturas = []
    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            return {"admisible": True}
        if contenido["turno"] == 1:
            aperturas.append(copy.deepcopy(contenido))
        return {"texto": NUEVO if contenido["turno"] == 1 else "Vale.", "referencias": ["af:a"]}
    clave = ("cor", "it-1", "es")
    s = Conversaciones(almacen, llamar)
    habilitar(s, clave)
    tema = tema_actual(almacen, clave)
    try:
        await s._conversar(clave, tema)
        primera = aperturas[0]
        assert [t["texto"] for t in primera["memoriaDeVoz"]] == anteriores
        assert [t["texto"] for t in primera["aperturasRecientes"]] == anteriores
        tendencias = {t["inicio"]: t["veces"] for t in primera["tendenciasDeApertura"]}
        assert tendencias["me interesa saber"] == 2
        assert "me interesa" not in tendencias  # Dos voces reales, no cuatro por duplicar las vistas.
        filas = publicados(s, clave, tema)
        assert [t["texto"] for t in filas] == [NUEVO, "Vale.", "Vale."]
        assert filas[0]["materiales"][0]["veredicto"] == "parcial"
        assert almacen.estado["hechos"][0]["enunciado"] == "Conocimiento original"
        assert almacen.estado["hipotesis"][0]["estado"] == "propuesta"
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("autor", [gateway.CEREBRO, gateway.JUEZ, gateway.VOLUMEN])
async def test_gateway_separa_cache_de_voz_y_juez_sin_tocar_otros_roles(almacen, monkeypatch, autor):
    configuraciones = []
    async def responder(**kwargs):
        es_juez = kwargs["messages"][0]["content"] == REGLAS_JUEZ
        respuesta = {"admisible": True, "motivo": "Conserva los límites"} if es_juez else {
            "texto": "Vale.", "referencias": ["af:a"], "emocion": "neutral", "gesto": "asentir"}
        return ModelResponse(model="openai/prueba", choices=[{"index": 0,
            "message": {"role": "assistant", "content": json.dumps(respuesta)}, "finish_reason": "stop"}],
            usage={"prompt_tokens": 20, "completion_tokens": 10, "cost": 0.0})
    def cliente(modelo, **kwargs):
        configuraciones.append((modelo, copy.deepcopy(kwargs)))
        lm = dspy.LM("openai/prueba", cache=kwargs["cache"])
        monkeypatch.setattr(lm, "aforward", responder)
        return lm
    monkeypatch.setattr(gateway, "lm", cliente)
    s = Conversaciones(almacen)
    tema = tema_actual(almacen, ("cor", "it-1", "es"))
    cientifico = dspy.LM("openai/otro-rol", cache=True, max_tokens=1234)
    original = copy.deepcopy(cientifico.kwargs)
    try:
        with dspy.context(lm=cientifico):
            voz = await s._llamar(autor, REGLAS, {"hallazgo": "Asociación parcial en ratones"}, tema)
            juez = await s._llamar(gateway.JUEZ, REGLAS_JUEZ, {"intervencion": voz}, tema)
            assert dspy.settings.lm is cientifico
        assert voz["referencias"] == ["af:a"] and juez["admisible"] is True
        assert [m for m, _ in configuraciones] == [autor, gateway.JUEZ]
        assert [kw["cache"] for _, kw in configuraciones] == [False, True]
        assert all("temperature" not in kw for _, kw in configuraciones)
        assert cientifico.kwargs == original and cientifico.cache is True
        assert contexto_actual.get() is None
        assert almacen.estado["corridas"][0]["gasto"]["llamadas"] == 2
        assert almacen.estado["iteraciones"][0]["presupuesto"]["usado"] == 2
    finally:
        await s.cerrar()


def test_protocolo_v4_es_el_que_acepta_la_interfaz():
    frontend = Path(__file__).resolve().parents[2] / "frontend/src/lib/conversacionesLaboratorio.ts"
    version = re.search(r"export const ESTILO_LABORATORIO\s*=\s*['\"]([^'\"]+)['\"]", frontend.read_text())
    assert version is not None
    assert version[1] == ESTILO == "conversacion-natural-v4"
