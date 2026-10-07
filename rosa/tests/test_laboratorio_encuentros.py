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

CLAVE = ("cor", "it-1", "es")


@pytest.fixture
def almacen(tmp_path):
    al = Almacen(tmp_path / "encuentros.db")

    def preparar(e):
        e.update(
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
        assert all(t["hallazgoId"] == tema["huella"] and t["materiales"] == tema["materiales"] for t in continuaciones)
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
async def test_cada_sala_agota_dos_continuaciones_y_reabrir_no_reinicia_el_limite(almacen, reloj):
    s = Conversaciones(almacen, hablar)
    habilitar(s)
    tema = tema_actual(almacen)
    try:
        await completar_pendientes(s, tema)
        iniciales = Counter(t["salaConversacion"] for t in s.leer(CLAVE) if t["tipoConversacion"] == "companeros")
        assert set(iniciales) == set(COMPANEROS)
        for _ in range(2):
            reloj[0] += 45_000
            await completar_pendientes(s, tema)
        finales = Counter(t["salaConversacion"] for t in s.leer(CLAVE) if t["tipoConversacion"] == "companeros")
        assert finales == Counter({sala: n + 4 for sala, n in iniciales.items()})
        assert len({t["id"] for t in s.leer(CLAVE)}) == len(s.leer(CLAVE))
        reloj[0] += 3_600_000
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
            e["corridas"][0]["gasto"]["llamadas"] = 500 - libres
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
            assert almacen.estado["corridas"][0]["gasto"]["llamadas"] == 500
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
