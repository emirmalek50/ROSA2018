"""Encuentros y continuaciones sin inventar novedades ni gastar la reserva.

Los interlocutores y sus jueces son sustitutos locales. El historial se
persiste en SQLite temporal para probar también un servidor recién abierto.
"""

from __future__ import annotations

import asyncio
import copy
import time
from collections import Counter

import pytest

from rosa.estado.almacen import Almacen
from rosa.laboratorio_conversaciones import COMPANEROS, ESTILO, REGLAS_JUEZ, Conversaciones, tema_de
from rosa.modulos.contador import PresupuestoAgotado

CLAVE = ("cor", "it-1", "es")


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / "encuentros.db")

    def preparar(e):
        e.update(
            autonomia={**e.get("autonomia", {}), "gastar_grande": "preguntar"},
            investigaciones=[{"id": "inv", "titulo": "Asociación de MAPT"}],
            corridas=[{
                "id": cid, "investigacionId": "inv", "estado": "en_marcha", "iteracionActual": 1,
                "presupuesto": {"limiteLlamadas": 500},
                "gasto": {"llamadas": 0, "tokensEntrada": 0, "tokensSalida": 0, "usd": 0.0, "usdReal": 0.0},
                "contexto": {"tokensUsados": 0, "tokensLimite": 400000},
                "_afirmaciones": [{"id": "a", "iteracion": n, "texto": "MAPT se asoció con tau en ratones",
                                   "fragmento": "Association in mice", "cita": "PMID:123, p. 4", "veredicto": "parcial"}
                                  for n in (1, 2)],
            } for cid in ("cor", "otra-cor")],
            iteraciones=[{
                "id": iid, "corridaId": cid, "numero": n, "terminadaEn": None, "planAprobado": True,
                "presupuesto": {"limite": 400, "usado": 0, "reservaCierre": 20},
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


@pytest.fixture
def reloj(monkeypatch):
    ahora = [1_790_000_000_000]
    monkeypatch.setattr("rosa.laboratorio_conversaciones.P.ahora_ms", lambda: ahora[0])
    return ahora


def habilitar(s, clave=CLAVE):
    s.visitas[clave] = {"persona": time.monotonic() + 60}


def tema_actual(al, clave=CLAVE):
    tema = tema_de(al.estado, clave[0], clave[1])
    assert tema is not None
    return {**tema, "tipoConversacion": "actividad"}


async def hablar(modelo, reglas, contenido, tema):
    if reglas == REGLAS_JUEZ:
        return {"admisible": True}
    return {"texto": "Vale.", "referencias": ["af:a"]}


async def completar_pendientes(s, tema, clave=CLAVE):
    """Agota una tanda temporal sin adelantar el reloj ni crear nueva evidencia."""
    for _ in range(20):
        temas = s._temas(clave, tema)
        if not temas:
            return
        await s._ronda(clave, temas)
    pytest.fail("El mismo contexto sigue iniciando conversaciones sin límite")


def guardar_encuentro(al, *, corrida="cor", iteracion="it-1", idioma="es", estilo=ESTILO,
                      agente="Señalizador de sesgo", destinatario="Juez"):
    def guardar(e):
        c = next(c for c in e["corridas"] if c["id"] == corrida)
        c.setdefault("_conversacionesLaboratorio", []).append({
            "id": "encuentro-persistido", "iteracionId": iteracion, "idioma": idioma,
            "estilo": estilo, "temaId": "otro-contexto", "hallazgoId": "otro-contexto",
            "agente": agente, "destinatario": destinatario, "texto": "Hola, ¿cómo vamos?",
            "turno": 1, "fecha": 1, "modelo": "modelo-de-prueba", "materiales": [],
        })
        return True

    al.mutar(guardar, "encuentro_de_prueba")


def sin_evidencia_nueva(t, tema):
    """La charla de una sala lleva el momento del laboratorio y, delante, lo
    suyo (su registro, sus decisiones, la oficina) desde el 8 de octubre de
    2026: cada sala habla de lo suyo. Lo que no puede traer es evidencia nueva:
    ninguna afirmación que no estuviera ya en el momento."""
    ids = {m["id"] for m in t["materiales"]}
    extras = [m for m in t["materiales"] if m["id"] not in {x["id"] for x in tema["materiales"]}]
    return {m["id"] for m in tema["materiales"]} <= ids and all(m["clase"] in ("oficina", "registro", "decision") for m in extras)


@pytest.mark.asyncio
@pytest.mark.parametrize("antecedente,espera_saludo", [
    (None, True), ("misma-pareja", False), ("otra-iteracion", False),
    ("otro-idioma", True), ("otra-corrida", True), ("voz-v2", True), ("otro-companero", True),
])
async def test_un_encuentro_no_se_reinicia_al_reabrir_y_no_mezcla_idiomas_ni_corridas(almacen, antecedente, espera_saludo):
    clave = CLAVE
    if antecedente:
        opciones = {
            "otro-idioma": {"idioma": "en"},
            "otra-corrida": {"corrida": "otra-cor", "iteracion": "otra-it"},
            "voz-v2": {"estilo": "conversacion-natural-v2"},
            "otro-companero": {"destinatario": "Killer"},
        }.get(antecedente, {})
        guardar_encuentro(almacen, **opciones)
        if antecedente == "otra-iteracion":
            almacen.mutar(lambda e: e["corridas"][0].update(iteracionActual=2) or True, "avanzar_iteracion")
            clave = ("cor", "it-2", "es")
    ruta = almacen.ruta
    almacen.cerrar()
    al = Almacen(ruta)
    autores, revisiones = [], []

    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(copy.deepcopy(contenido))
            return {"admisible": True}
        autores.append(copy.deepcopy(contenido))
        texto = "Hola, ¿cómo vamos?" if contenido["turno"] == 1 and contenido.get("encuentroInicial") else "Vale."
        return {"texto": texto, "referencias": ["af:a"]}

    s = Conversaciones(al, llamar)
    habilitar(s, clave)
    tema = tema_actual(al, clave)
    try:
        await s._conversar(clave, tema)
        nuevos = [t for t in s.leer(clave) if t["temaId"] == tema["huella"]]
        assert autores[0].get("encuentroInicial", False) is espera_saludo
        assert all(c.get("encuentroInicial", False) is espera_saludo for c in autores)
        assert len(nuevos) == len(revisiones) == 3
        assert nuevos[0]["texto"] == ("Hola, ¿cómo vamos?" if espera_saludo else "Vale.")
        assert revisiones[0]["intervencion"]["texto"] == nuevos[0]["texto"]
        assert nuevos[0]["materiales"][0]["cita"] == "PMID:123, p. 4"
        assert al.estado["hechos"][0]["enunciado"] == "Conocimiento original"
        assert al.estado["hipotesis"][0]["estado"] == "propuesta"
    finally:
        await s.cerrar()
        al.cerrar()


@pytest.mark.asyncio
async def test_la_siguiente_charla_retoma_sin_repetir_el_saludo(almacen):
    aperturas, revisiones = [], []

    async def llamar(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(contenido["intervencion"]["texto"])
            return {"admisible": True}
        if contenido["turno"] == 1:
            aperturas.append(contenido.get("encuentroInicial", False))
            texto = "Hola, ¿cómo vamos?" if contenido.get("encuentroInicial") else "Sigo con esa asociación."
        else:
            texto = "Vale."
        return {"texto": texto, "referencias": ["af:a"]}

    s = Conversaciones(almacen, llamar)
    habilitar(s)
    try:
        await s._conversar(CLAVE, tema_actual(almacen))

        def avanzar(e):
            e["corridas"][0]["iteracionActual"] = 2
            return True

        almacen.mutar(avanzar, "avanzar_iteracion")
        nueva_clave = ("cor", "it-2", "es")
        habilitar(s, nueva_clave)
        await s._conversar(nueva_clave, tema_actual(almacen, nueva_clave))
        textos = [t["texto"] for t in almacen.estado["corridas"][0]["_conversacionesLaboratorio"]]
        assert aperturas == [True, False]
        assert textos.count("Hola, ¿cómo vamos?") == 1
        assert revisiones == textos
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_un_saludo_con_un_resultado_inventado_no_evade_al_juez(almacen):
    llamadas = []

    async def llamar(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        if reglas == REGLAS_JUEZ:
            return {"admisible": False, "motivo": "No hay un resultado de eficacia clínica en los materiales."}
        return {"texto": "Hola, ya curé el Alzheimer con este tratamiento.", "referencias": ["af:a"]}

    s = Conversaciones(almacen, llamar)
    habilitar(s)
    original = copy.deepcopy(almacen.estado)
    try:
        await s._conversar(CLAVE, tema_actual(almacen))
        assert llamadas.count(REGLAS_JUEZ) == 2
        assert s.leer(CLAVE) == []
        assert almacen.estado == original
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_continuaciones_esperan_cooldown_y_conservan_el_hallazgo_sin_nueva_evidencia(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        await completar_pendientes(s, tema)
        assert {t["salaConversacion"] for t in s.leer(CLAVE) if t["tipoConversacion"] == "companeros"} == set(COMPANEROS)
        assert s._temas(CLAVE, tema) == []
        reloj[0] += 44_999
        assert s._temas(CLAVE, tema) == []
        reloj[0] += 1
        continuaciones = s._temas(CLAVE, tema)
        assert continuaciones
        assert all(t.get("continuacion") is True and t["tipoConversacion"] == "companeros" for t in continuaciones)
        assert len({t["salaConversacion"] for t in continuaciones}) == len(continuaciones)
        assert all(t["hallazgoId"] == tema["huella"] and sin_evidencia_nueva(t, tema) for t in continuaciones)
        antes = list(s.leer(CLAVE))
        await s._ronda(CLAVE, continuaciones)
        nuevas = s.leer(CLAVE)[len(antes):]
        assert len(nuevas) == 2 * len(continuaciones)
        assert {t["hallazgoId"] for t in nuevas} == {tema["huella"]}
        assert all(t["materiales"][0]["veredicto"] == "parcial" for t in nuevas)
        assert all(t["materiales"][0]["cita"] == "PMID:123, p. 4" for t in nuevas)
        assert almacen.estado["hipotesis"][0]["estado"] == "propuesta"
        assert almacen.estado["hechos"][0]["enunciado"] == "Conocimiento original"
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_las_salas_que_aun_no_hablaron_tienen_prioridad_sobre_una_continuacion(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        primeras = s._temas(CLAVE, tema)
        await s._ronda(CLAVE, primeras)
        reloj[0] += 46_000
        siguientes = s._temas(CLAVE, tema)
        assert siguientes
        assert all(not t.get("continuacion") for t in siguientes)
        primeras_salas = {t.get("salaConversacion") for t in primeras}
        assert all(t.get("salaConversacion") not in primeras_salas for t in siguientes)
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_las_retomas_continuan_durante_la_corrida_y_reabrir_conserva_su_secuencia(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        await completar_pendientes(s, tema)
        iniciales = Counter(t["salaConversacion"] for t in s.leer(CLAVE) if t["tipoConversacion"] == "companeros")
        assert set(iniciales) == set(COMPANEROS)
        for _ in range(3):
            reloj[0] += 45_000
            await completar_pendientes(s, tema)
        finales = Counter(t["salaConversacion"] for t in s.leer(CLAVE) if t["tipoConversacion"] == "companeros")
        assert finales == Counter({sala: n + 6 for sala, n in iniciales.items()})
        assert len({t["id"] for t in s.leer(CLAVE)}) == len(s.leer(CLAVE))
        assert s._temas(CLAVE, tema) == []
    finally:
        await s.cerrar()
    ruta = almacen.ruta
    almacen.cerrar()
    al = Almacen(ruta)
    reiniciado = Conversaciones(al, hablar)
    try:
        habilitar(reiniciado)
        assert reiniciado._temas(CLAVE, tema_actual(al)) == []
        assert Counter(t["salaConversacion"] for t in reiniciado.leer(CLAVE) if t["tipoConversacion"] == "companeros") == finales
        reloj[0] += 45_000
        siguientes = reiniciado._temas(CLAVE, tema_actual(al))
        assert siguientes and all(t.get("continuacion") and t["rondaConversacion"] == 4 for t in siguientes)
        anteriores = {t["id"] for t in reiniciado.leer(CLAVE)}
        await reiniciado._ronda(CLAVE, siguientes)
        assert len({t["id"] for t in reiniciado.leer(CLAVE)} - anteriores) == 2 * len(siguientes)
    finally:
        await reiniciado.cerrar()
        al.cerrar()


@pytest.mark.asyncio
async def test_dos_pollings_no_encargan_dos_veces_la_misma_continuacion(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    esperando, liberar = asyncio.Event(), asyncio.Event()

    async def lento(modelo, reglas, contenido, tema):
        if reglas != REGLAS_JUEZ:
            esperando.set()
            await liberar.wait()
        return await hablar(modelo, reglas, contenido, tema)

    try:
        await completar_pendientes(s, tema)
        reloj[0] += 45_000
        s.llamar = lento
        s.proxima[CLAVE] = 0
        antes = list(s.leer(CLAVE))
        s.tocar(CLAVE, "persona", True)
        primera = s.tareas[CLAVE]
        await asyncio.wait_for(esperando.wait(), 2)
        s.tocar(CLAVE, "segunda-persona", True)
        assert s.tareas[CLAVE] is primera
        liberar.set()
        await primera
        nuevas = s.leer(CLAVE)[len(antes):]
        assert nuevas
        assert len({t["id"] for t in nuevas}) == len(nuevas)
        assert set(Counter(t["salaConversacion"] for t in nuevas).values()) == {2}
    finally:
        liberar.set()
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("ultimo,libre", [("terminado", True), ("fallido", True), ("en_curso", False), (None, False), ("desconocido", False)])
async def test_ocupacion_usa_el_ultimo_estado_del_agente_y_es_conservadora_si_falta(almacen, reloj, ultimo, libre):
    def pista_abierta(e):
        e["iteraciones"][0]["pistas"].insert(0, {
            "id": "pi-aa000001-x", "tipo": "novedad", "titulo": "Revisar patentes", "estado": "en_curso",
            "transcripcion": [
                {"tipo": "accion", "agente": "patentes", "estadoAgente": "en_curso", "t": 0,
                 "texto": "Reviso las patentes relacionadas con el tratamiento propuesto."},
                {"tipo": "resultado", "agente": "patentes", "t": 1,
                 **({"estadoAgente": ultimo} if ultimo is not None else {}),
                 "texto": "Termino esta revisión sin establecer libertad jurídica de operación."},
            ],
        })
        return True

    almacen.mutar(pista_abierta, "pista_atribuida")
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    try:
        await completar_pendientes(s, tema_actual(almacen))
        nuevas = [t for t in s.leer(CLAVE) if t.get("salaConversacion") == "novedad"]
        assert bool(nuevas) is libre
        if libre:
            assert {t["agente"] for t in nuevas} == set(COMPANEROS["novedad"])
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("estado_pista", ["hecha", "en_curso"])
async def test_los_ultimos_protagonistas_terminados_quedan_libres_y_retoman_en_su_cuarto(almacen, reloj, estado_pista):
    def cerrar_patentes(e):
        pista = e["iteraciones"][0]["pistas"][0]
        pista.update(tipo="novedad", titulo="Revisar el tratamiento", estado=estado_pista)
        pista["transcripcion"] = [
            {"t": 1200, "tipo": "resultado", "agente": "patentes", "estadoAgente": "terminado",
             "texto": "La revisión del tratamiento terminó sin establecer libertad jurídica de operación."},
        ]
        return True

    almacen.mutar(cerrar_patentes, "terminar_ultima_revision_de_patentes")
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    assert set(tema["participantes"]) == set(COMPANEROS["novedad"])
    try:
        primera_tanda = s._temas(CLAVE, tema)
        # La tarea principal tiene a sus dos interlocutores mientras se comenta.
        assert any(t["tipoConversacion"] == "actividad" for t in primera_tanda)
        assert all(t.get("salaConversacion") != "novedad" for t in primera_tanda)
        await s._ronda(CLAVE, primera_tanda)
        # Una vez publicada, ser el último autor no mantiene ocupados a ambos.
        await completar_pendientes(s, tema)
        primeras = [t for t in s.leer(CLAVE) if t.get("salaConversacion") == "novedad"]
        assert len(primeras) == 3
        assert all(not t.get("continuacion") for t in primeras)
        assert {t["agente"] for t in primeras} == set(COMPANEROS["novedad"])
        reloj[0] += 44_999
        assert s._temas(CLAVE, tema) == []
        reloj[0] += 1
        await completar_pendientes(s, tema)
        retomas = [t for t in s.leer(CLAVE) if t.get("salaConversacion") == "novedad" and t.get("continuacion")]
        assert len(retomas) == 2
        assert {t["agente"] for t in retomas} == set(COMPANEROS["novedad"])
        assert {t["hallazgoId"] for t in retomas} == {tema["huella"]}
        assert len({t["id"] for t in retomas}) == 2
        assert all(t["materiales"][0]["id"] == "af:a" for t in retomas)
        assert all(t["materiales"][0]["veredicto"] == "parcial" for t in retomas)
        assert all(t["materiales"][0]["cita"] == "PMID:123, p. 4" for t in retomas)
        assert almacen.estado["iteraciones"][0]["pistas"][0]["estado"] == estado_pista
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("motivo", ["sin-visita", "visita-caducada", "reserva"])
async def test_una_continuacion_elegible_no_inicia_sin_observador_o_con_la_reserva(almacen, reloj, motivo):
    llamadas = []

    async def contar(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        return await hablar(modelo, reglas, contenido, tema)

    s = Conversaciones(almacen, contar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        await completar_pendientes(s, tema)
        reloj[0] += 45_000
        assert s._temas(CLAVE, tema)
        anteriores = list(s.leer(CLAVE))
        n_llamadas = len(llamadas)
        if motivo == "reserva":
            almacen.mutar(lambda e: e["iteraciones"][0]["presupuesto"].update(usado=380) or True, "reservar_cierre")
        else:
            s.visitas[CLAVE] = {} if motivo == "sin-visita" else {"persona": time.monotonic() - 1}
        s.proxima[CLAVE] = 0
        respuesta = s.tocar(CLAVE, "cliente-inactivo", False)
        assert respuesta["estado"] == ("sin_presupuesto" if motivo == "reserva" else "pausada")
        assert CLAVE not in s.tareas
        assert len(llamadas) == n_llamadas and s.leer(CLAVE) == anteriores
        assert almacen.estado["iteraciones"][0]["presupuesto"]["reservaCierre"] == 20
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("motivo", ["pausa", "sin-visita", "reserva"])
async def test_si_deja_de_ser_vigente_mientras_el_autor_responde_no_publica_la_continuacion(almacen, reloj, motivo):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    revisiones = []

    async def interrumpir(modelo, reglas, contenido, tema):
        if reglas == REGLAS_JUEZ:
            revisiones.append(1)
            return {"admisible": True}
        if motivo == "pausa":
            almacen.mutar(lambda e: e["corridas"][0].update(estado="pausada") or True, "pausar")
        elif motivo == "reserva":
            almacen.mutar(lambda e: e["iteraciones"][0]["presupuesto"].update(usado=380) or True, "reservar_cierre")
        else:
            s.visitas[CLAVE].clear()
        return {"texto": "Vale.", "referencias": ["af:a"]}

    try:
        await completar_pendientes(s, tema)
        reloj[0] += 45_000
        continuacion = s._temas(CLAVE, tema)[0]
        assert continuacion.get("continuacion") is True
        anteriores = list(s.leer(CLAVE))
        s.llamar = interrumpir
        await s._conversar(CLAVE, continuacion)
        assert revisiones == []
        assert s.leer(CLAVE) == anteriores
        assert almacen.estado["iteraciones"][0]["presupuesto"]["reservaCierre"] == 20
    finally:
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("libres", [3, 4])
async def test_una_continuacion_cuesta_cuatro_llamadas_y_no_toca_la_reserva(almacen, reloj, libres):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    llamadas = []

    async def consumir(modelo, reglas, contenido, tema):
        llamadas.append(reglas)

        def contar(e):
            e["corridas"][0]["gasto"]["llamadas"] += 1
            e["iteraciones"][0]["presupuesto"]["usado"] += 1
            return True

        almacen.mutar(contar, "consumir_llamada_simulada")
        return await hablar(modelo, reglas, contenido, tema)

    try:
        await completar_pendientes(s, tema)
        reloj[0] += 45_000
        assert s._temas(CLAVE, tema)

        def acotar(e):
            e["corridas"][0]["gasto"]["llamadas"] = 500 - 20 - libres
            e["iteraciones"][0]["presupuesto"]["usado"] = 380 - libres
            return True

        almacen.mutar(acotar, "acotar_presupuesto")
        candidatas = s._temas(CLAVE, tema)
        assert len(candidatas) == (1 if libres == 4 else 0)
        assert all(t.get("continuacion") is True for t in candidatas)
        anteriores = list(s.leer(CLAVE))
        s.llamar = consumir
        s.proxima[CLAVE] = 0
        s.tocar(CLAVE, "persona", True)
        if libres == 4:
            await s.tareas[CLAVE]
            assert len(llamadas) == 4 and llamadas.count(REGLAS_JUEZ) == 2
            assert len(s.leer(CLAVE)) == len(anteriores) + 2
            assert almacen.estado["corridas"][0]["gasto"]["llamadas"] == 480
            assert almacen.estado["iteraciones"][0]["presupuesto"]["usado"] == 380
        else:
            assert CLAVE not in s.tareas and llamadas == []
            assert s.leer(CLAVE) == anteriores
        assert almacen.estado["iteraciones"][0]["presupuesto"]["reservaCierre"] == 20
        s.proxima[CLAVE] = 0
        assert s.tocar(CLAVE, "persona", True)["estado"] == "sin_presupuesto"
        assert len(llamadas) == (4 if libres == 4 else 0)
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_perder_al_observador_durante_el_juez_impide_publicar_la_continuacion(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    llamadas = []

    async def sin_observador(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        if reglas == REGLAS_JUEZ:
            s.visitas[CLAVE].clear()
            return {"admisible": True}
        return {"texto": "Vale.", "referencias": ["af:a"]}

    try:
        await completar_pendientes(s, tema)
        reloj[0] += 45_000
        continuacion = s._temas(CLAVE, tema)[0]
        assert continuacion.get("continuacion") is True
        anteriores = list(s.leer(CLAVE))
        s.llamar = sin_observador
        await s._conversar(CLAVE, continuacion)
        assert len(llamadas) == 2 and llamadas.count(REGLAS_JUEZ) == 1
        assert s.leer(CLAVE) == anteriores
        assert almacen.estado["hipotesis"][0]["estado"] == "propuesta"
    finally:
        await s.cerrar()


@pytest.mark.asyncio
async def test_prevision_real_agotada_no_apaga_la_voz_con_tope_global_disponible(almacen, monkeypatch):
    monkeypatch.setattr("rosa.bucle.corrida.coste_previsto_del_cierre", lambda e, inv: 24)
    almacen.estado["autonomia"]["gastar_grande"] = "actuar"
    c = almacen.estado["corridas"][0]
    c["presupuesto"]["limiteLlamadas"] = 1500
    c["gasto"]["llamadas"] = 535
    it = almacen.estado["iteraciones"][0]
    it["presupuesto"].update(limite=542, usado=518, reservaCierre=28)
    llamadas = []

    async def consumir(modelo, reglas, contenido, tema):
        llamadas.append(reglas)
        c["gasto"]["llamadas"] += 1
        it["presupuesto"]["usado"] += 1
        return await hablar(modelo, reglas, contenido, tema)

    s = Conversaciones(almacen, consumir)
    try:
        respuesta = s.tocar(CLAVE, "persona", True)
        assert respuesta["estado"] == "conversando"
        await s.tareas[CLAVE]
        assert len(s.leer(CLAVE)) == 9 and len(llamadas) == 18
        assert llamadas.count(REGLAS_JUEZ) == 9
        assert c["gasto"]["llamadas"] == 553 and it["presupuesto"]["usado"] == 536
        assert it["presupuesto"] == {"limite": 542, "usado": 536, "reservaCierre": 28}
    finally:
        await s.cerrar()


@pytest.mark.parametrize("autonomia,denegado,global_usado,reserva_estimada,esperado", [
    ("actuar", False, 535, 24, True),
    ("preguntar", False, 535, 24, False),
    ("actuar", True, 535, 24, False),
    ("actuar", False, 1500, 24, False),
    ("actuar", False, 1472, 24, False),
    ("actuar", False, 1470, 24, True),
    ("actuar", False, 1470, 31, False),
    ("preguntar", False, 1472, 24, False),
])
def test_voz_respeta_global_reserva_actual_y_decisiones_humanas(almacen, monkeypatch, autonomia, denegado, global_usado, reserva_estimada, esperado):
    monkeypatch.setattr("rosa.bucle.corrida.coste_previsto_del_cierre", lambda e, inv: reserva_estimada)
    almacen.estado["autonomia"]["gastar_grande"] = autonomia
    c = almacen.estado["corridas"][0]
    c["presupuesto"]["limiteLlamadas"] = 1500
    c["gasto"]["llamadas"] = global_usado
    it = almacen.estado["iteraciones"][0]
    it["presupuesto"].update(limite=542, usado=518, reservaCierre=28)
    it["_presupuestoDenegado"] = denegado
    s = Conversaciones(almacen)
    assert s._presupuesto(tema_actual(almacen), 2) is esperado


@pytest.mark.asyncio
async def test_historial_recortado_y_reinicio_no_reusan_rondas_ni_saludan_otra_vez(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        await completar_pendientes(s, tema)
        for _ in range(3):
            reloj[0] += 45_000
            await completar_pendientes(s, tema)
        anteriores = {t["id"] for t in s._historial(CLAVE)}
        memoria = copy.deepcopy(almacen.estado["corridas"][0]["_memoriaConversacionesLaboratorio"])

        def recortar(e):
            filas = e["corridas"][0]["_conversacionesLaboratorio"]
            base = {**filas[-1], "idioma": "en"}
            e["corridas"][0]["_conversacionesLaboratorio"] = [{**base, "id": f"otro-turno-{i}"} for i in range(300)]
            return True

        almacen.mutar(recortar, "recorte_temporal_de_historial")
        assert s.leer(CLAVE) == []
        assert s._temas(CLAVE, tema) == []
    finally:
        await s.cerrar()
    ruta = almacen.ruta
    almacen.cerrar()
    al = Almacen(ruta)
    vistos = []

    async def continuar(modelo, reglas, contenido, tema):
        if reglas != REGLAS_JUEZ:
            vistos.append(copy.deepcopy(contenido))
        return await hablar(modelo, reglas, contenido, tema)

    nuevo = Conversaciones(al, continuar)
    habilitar(nuevo)
    try:
        assert al.estado["corridas"][0]["_memoriaConversacionesLaboratorio"] == memoria
        assert nuevo._temas(CLAVE, tema_actual(al)) == []
        reloj[0] += 45_000
        candidatas = nuevo._temas(CLAVE, tema_actual(al))
        assert candidatas and all(t.get("continuacion") and t["rondaConversacion"] == 4 for t in candidatas)
        await nuevo._ronda(CLAVE, candidatas)
        nuevos = nuevo.leer(CLAVE)
        assert len(nuevos) == len(vistos) == 2 * len(candidatas)
        assert anteriores.isdisjoint(t["id"] for t in nuevos)
        assert all(not c["encuentroInicial"] for c in vistos)
        assert all(sin_evidencia_nueva(c, tema) for c in vistos)
        assert len(al.estado["corridas"][0]["_conversacionesLaboratorio"]) == 300
        assert nuevo._temas(CLAVE, tema_actual(al)) != candidatas
    finally:
        await nuevo.cerrar()
        al.cerrar()


def respuesta_modelo_de_prueba():
    from litellm import ModelResponse

    return ModelResponse(model="openai/prueba", choices=[{"index": 0, "message": {
        "role": "assistant", "content": '{"texto":"Vale.","referencias":["af:a"]}'}, "finish_reason": "stop"}],
        usage={"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001})


@pytest.mark.asyncio
async def test_dos_idiomas_reservan_llamadas_en_vuelo_sin_invadir_el_cierre(almacen, monkeypatch):
    import dspy

    monkeypatch.setattr("rosa.bucle.corrida.coste_previsto_del_cierre", lambda e, inv: 28)
    almacen.estado["autonomia"]["gastar_grande"] = "actuar"
    c = almacen.estado["corridas"][0]
    c["presupuesto"]["limiteLlamadas"] = 1500
    c["gasto"]["llamadas"] = 1470
    almacen.estado["iteraciones"][0]["presupuesto"].update(limite=542, usado=518, reservaCierre=28)
    entraron, liberar = asyncio.Event(), asyncio.Event()
    llamadas = []
    lm = dspy.LM("openai/prueba", cache=False)

    async def responder(**kwargs):
        llamadas.append(kwargs)
        if len(llamadas) == 2:
            entraron.set()
        await liberar.wait()
        return respuesta_modelo_de_prueba()

    monkeypatch.setattr(lm, "aforward", responder)
    monkeypatch.setattr("rosa.laboratorio_conversaciones.gateway.lm", lambda *a, **kw: lm)
    s = Conversaciones(almacen)
    tema = tema_actual(almacen)
    tareas = [asyncio.create_task(s._llamar("modelo-de-prueba", "Reglas", {"idioma": idioma}, tema)) for idioma in ("es", "en")]
    try:
        await asyncio.wait_for(entraron.wait(), 2)
        assert s.llamadas_en_vuelo == {"cor": 2}
        assert not s._presupuesto(tema, 1)
        with pytest.raises(PresupuestoAgotado):
            await s._llamar("modelo-de-prueba", "Reglas", {"idioma": "es"}, tema)
        assert len(llamadas) == 2
        liberar.set()
        await asyncio.gather(*tareas)
        assert s.llamadas_en_vuelo == {}
        assert c["gasto"]["llamadas"] == 1472
        assert not s._presupuesto(tema, 1)
        assert almacen.estado["iteraciones"][0]["presupuesto"]["reservaCierre"] == 28
    finally:
        liberar.set()
        await asyncio.gather(*tareas, return_exceptions=True)
        await s.cerrar()


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupcion", ["error", "cancelacion"])
async def test_error_o_cancelacion_libera_la_reserva_de_llamada(almacen, monkeypatch, interrupcion):
    import dspy

    empezo, liberar = asyncio.Event(), asyncio.Event()
    lm = dspy.LM("openai/prueba", cache=False)

    async def responder(**kwargs):
        empezo.set()
        await liberar.wait()
        if interrupcion == "error":
            raise RuntimeError("Error local de prueba")
        return respuesta_modelo_de_prueba()

    monkeypatch.setattr(lm, "aforward", responder)
    monkeypatch.setattr("rosa.laboratorio_conversaciones.gateway.lm", lambda *a, **kw: lm)
    s = Conversaciones(almacen)
    tema = tema_actual(almacen)
    tarea = asyncio.create_task(s._llamar("modelo-de-prueba", "Reglas", {}, tema))
    try:
        await asyncio.wait_for(empezo.wait(), 2)
        assert s.llamadas_en_vuelo == {"cor": 1}
        if interrupcion == "cancelacion":
            tarea.cancel()
        else:
            liberar.set()
        with pytest.raises(asyncio.CancelledError if interrupcion == "cancelacion" else RuntimeError):
            await tarea
        assert s.llamadas_en_vuelo == {}
        assert s._presupuesto(tema, 2)
        assert almacen.estado["corridas"][0]["gasto"]["llamadas"] == 0
    finally:
        liberar.set()
        await asyncio.gather(tarea, return_exceptions=True)
        await s.cerrar()


@pytest.mark.asyncio
async def test_nadie_habla_en_dos_conversaciones_de_la_misma_ronda(almacen, reloj, monkeypatch):
    """Dos intenciones con la misma pareja no salen las dos a la vez.

    El 9 de octubre de 2026, en la corrida 26, el Generador de consultas dijo
    «voy a buscar las tablas que faltan... para comparar tau-PET y CDR-SB» y,
    216 ms después, «voy a buscar los suplementos que faltan... para comparar
    tau-PET y CDR-SB». Eran dos temas distintos de la MISMA ronda, que
    `_ronda` lanza con gather: cada uno se redacta sin ver al otro, así que
    los dos abren igual. Lo mismo pasó con los dos especialistas de novedad.
    """
    pareja = ["Generador de consultas", "Explorador"]
    intenciones = [
        {"huella": f"int-{n}", "participantes": list(pareja), "salaConversacion": "lectura",
         "materiales": [], "tipoConversacion": "actividad"} for n in range(3)
    ]
    intenciones.append({"huella": "int-otros", "participantes": ["Juez", "Señalizador de sesgo"],
                        "salaConversacion": "evidencia", "materiales": [], "tipoConversacion": "actividad"})
    monkeypatch.setattr("rosa.laboratorio_conversaciones.intenciones_de", lambda *_a, **_k: intenciones)
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        temas = s._temas(CLAVE, tema)
        assert temas, "la ronda se quedó sin ningún tema"
        # De las tres intenciones de la misma pareja sale una sola.
        veces = Counter(p for t in temas for p in t["participantes"])
        repetidos = {p: n for p, n in veces.items() if n > 1}
        assert repetidos == {}, f"estos hablan en dos conversaciones a la vez: {repetidos}"
        # Y la pareja libre sí entra: la regla no se come la ronda entera.
        assert "Juez" in veces
    finally:
        await s.cerrar()
