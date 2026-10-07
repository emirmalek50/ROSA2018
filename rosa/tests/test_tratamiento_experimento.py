"""El protocolo y la revisión sobreviven a una pausa y al reinicio de SQLite.

Se ejecutan el supervisor, el contexto y los checkpoints reales. Únicamente las
respuestas de modelos y fuentes se sustituyen, sin red ni llamadas pagadas.
"""

from collections import Counter
from copy import deepcopy
from types import SimpleNamespace

import pytest

from rosa import agentes_tratamiento as AT
from rosa.bucle import corrida as CO
from rosa.bucle.pasos import Ctx
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa.modulos.contador import PresupuestoAgotado


def _preparar(almacen):
    ids = {}

    def crear(e):
        inv_id = A.crear_investigacion(e, {
            "titulo": "Tratamiento de amiloide", "objetivo": "Evaluar lecanemab",
            "condicionParada": "3 iteraciones",
        }, 1000)
        inv = next(i for i in e["investigaciones"] if i["id"] == inv_id)
        inv["mision"] = {"tipoIntervencion": "anticuerpo", "capacidadesLaboratorio": []}
        corrida = P.nueva_corrida(inv_id, 1, 1000)
        corrida["estado"] = "en_marcha"
        it = P.nueva_iteracion(corrida["id"], 1, 1000, [])
        it["planAprobado"] = True
        h = P.nueva_hipotesis(inv_id, 1, 1000,
            titulo="Tratamiento con lecanemab", enunciado="Evaluar lecanemab para Alzheimer.",
            mecanismo="Reducción de amiloide", _conclusionIntentada=True,
            _enLlanoIntentado="llano-de-prueba")
        h["tarjeta"] = {**P.tarjeta_vacia(), "diana": "APP", "intervencion": "lecanemab", "direccion": "disminuye"}
        e["corridas"].append(corrida)
        e["iteraciones"].append(it)
        e["hipotesis"].append(h)
        ids.update(inv=inv_id, cor=corrida["id"], it=it["id"], hip=h["id"])
        return True

    almacen.mutar(crear, "preparar_test")
    return ids


def _hipotesis(almacen, ids):
    return next(h for h in almacen.estado["hipotesis"] if h["id"] == ids["hip"])


def _estado_corrida(almacen, ids, estado):
    def cambiar(e):
        next(c for c in e["corridas"] if c["id"] == ids["cor"])["estado"] = estado
        return True
    almacen.mutar(cambiar, "estado_test")


def _pred_experimento():
    return SimpleNamespace(experimento=SimpleNamespace(
        protocolo=["Tratar el cultivo con lecanemab", "Medir amiloide y comparar con vehículo"],
        ensayo="Inmunoensayo de amiloide", resultado_que_confirma="Reducción de amiloide",
        resultado_que_refuta="No se reduce amiloide", controles="vehículo",
        tamano_muestral="Seis cultivos por grupo", alternativa="Efecto inespecífico",
        coste_estimado="Dos semanas", analisis_pedido="Comparar grupos",
        decision_que_cambia="Revisar la propuesta si no se reduce amiloide",
    ))


def _recuperacion(documentos):
    return {"documentos": documentos, "consultas": [{
        "fuente": "Registro de prueba", "consulta": "lecanemab", "paginas": 1,
        "total": len(documentos), "recuperados": len(documentos), "completa": True, "error": None,
    }], "limitaciones": ["Cobertura acotada a las fuentes consultadas."], "costeUsd": 0.0}


def _simular(monkeypatch, ids, pausar_juez=True):
    llamadas = []
    fuentes = Counter()
    documento = {"id": "NCT00000001", "url": "https://clinicaltrials.gov/study/NCT00000001",
        "titulo": "Ensayo de lecanemab", "fuente": "ClinicalTrials.gov",
        "texto": "La compañía Eisai estudió lecanemab en personas con enfermedad de Alzheimer.",
        "datos": {"patrocinador": {"nombre": "Eisai", "clase": "INDUSTRY"},
                  "colaboradores": [], "estado": "COMPLETED", "hasResults": False}}
    dictamen = {"hallazgos": [{"id": documento["id"], "relacion": "mismo_tratamiento",
        "cita": documento["texto"], "explicacion": "El registro describe un ensayo empresarial.",
        "diferencias": []}], "limitaciones": ["No acredita eficacia del tratamiento."]}

    async def llamar(ctx, rol, programa, **kwargs):
        llamadas.append((rol, programa, kwargs))
        if programa == "experimento":
            return _pred_experimento()
        if programa == "perfil":
            return SimpleNamespace(perfil={"tipo": "intervencion", "nombre": "Lecanemab",
                "ingredientes": ["lecanemab"], "sinonimos": ["BAN2401"], "dianas": ["APP"],
                "modalidad": "anticuerpo", "indicacion": "Alzheimer",
                "consultasPatentes": ["lecanemab"], "consultasProgramas": ["lecanemab", "BAN2401"]})
        if programa == "companias":
            return SimpleNamespace(dictamen=deepcopy(dictamen))
        if programa == "auditar":
            intentos = sum(p == "auditar" for _, p, _ in llamadas)
            if pausar_juez and intentos == 1:
                _estado_corrida(ctx.almacen, ids, "pausada_por_presupuesto")
                raise PresupuestoAgotado("Pausa de prueba antes del juez")
            return SimpleNamespace(dictamen=deepcopy(dictamen))
        raise AssertionError(f"Llamada inesperada al programa {programa}")

    async def buscar_patentes(*args):
        fuentes["patentes"] += 1
        return _recuperacion([])

    async def buscar_companias(*args):
        fuentes["companias"] += 1
        return _recuperacion([deepcopy(documento)])

    monkeypatch.setattr(Ctx, "llamar", llamar)
    monkeypatch.setattr(AT.patentes_tratamiento, "buscar", buscar_patentes)
    monkeypatch.setattr(AT, "_programas", buscar_companias)
    # Este test alcanza la petición de tratamiento sin crear trabajo ajeno.
    monkeypatch.setattr(CO.VIA, "necesita", lambda h: False)
    monkeypatch.setattr(CO.T, "huella_llano", lambda e, h: "llano-de-prueba")
    programas = SimpleNamespace(experimento="experimento", perfil_tratamiento="perfil",
        patentes_tratamiento="patentes", companias_tratamiento="companias", auditar_tratamiento="auditar")
    modelos = SimpleNamespace(cerebro=SimpleNamespace(model="simulado/cerebro"),
        juez=SimpleNamespace(model="simulado/juez"), volumen=SimpleNamespace(model="simulado/volumen"))
    return programas, modelos, llamadas, fuentes


@pytest.mark.asyncio
async def test_revision_del_experimento_reanuda_tras_pausa_y_reinicio_sin_repetir_llamadas(tmp_path, monkeypatch):
    ruta = tmp_path / "rosa.db"
    almacen = Almacen(ruta)
    try:
        ids = _preparar(almacen)
        programas, modelos, llamadas, fuentes = _simular(monkeypatch, ids)
        supervisor = CO.Supervisor(almacen, programas, modelos)
        ctx = supervisor._ctx(next(c for c in almacen.estado["corridas"] if c["id"] == ids["cor"]))

        with pytest.raises(PresupuestoAgotado):
            await supervisor._proponer_experimento(ctx, _hipotesis(almacen, ids))
        h = _hipotesis(almacen, ids)
        experimento_guardado = deepcopy(h["experimento"])
        assert experimento_guardado["protocolo"].startswith("1. Tratar el cultivo con lecanemab")
        assert h["_experimentoIntentado"] and h["_revisionTratamientoPendiente"]
        assert h["revisionTratamiento"]["patentes"]["estado"] == "sin_coincidencias_en_fuentes_consultadas"
        assert "companias" not in h["revisionTratamiento"]
        cache = ctx.corrida()["_revisionTratamientoFuentes"][ids["hip"]]
        assert cache["borrador_companias"]["hallazgos"][0]["id"] == "NCT00000001"
        assert cache["companias"]["documentos"][0]["id"] == "NCT00000001"

        # La petición y el borrador tienen que sobrevivir también a un proceso nuevo.
        almacen.cerrar()
        almacen = Almacen(ruta)
        supervisor = CO.Supervisor(almacen, programas, modelos)
        h = _hipotesis(almacen, ids)
        assert h["experimento"] == experimento_guardado
        assert h["_revisionTratamientoPendiente"]
        anteriores = len(llamadas)
        await supervisor._completar_en_llano()
        assert len(llamadas) == anteriores
        assert h["_revisionTratamientoPendiente"]

        _estado_corrida(almacen, ids, "en_marcha")
        await supervisor._completar_en_llano()
        h = _hipotesis(almacen, ids)
        assert h["experimento"] == experimento_guardado
        assert h["_experimentoIntentado"]
        assert "_revisionTratamientoPendiente" not in h
        assert h["revisionTratamiento"]["companias"]["estado"] == "coincidencias"
        assert h["revisionTratamiento"]["companias"]["hallazgos"][0]["id"] == "NCT00000001"
        assert not AT.pendiente(h, ids["cor"], ids["it"])
        assert Counter(p for _, p, _ in llamadas) == {
            "experimento": 1, "perfil": 1, "companias": 1, "auditar": 2,
        }
        assert fuentes == {"patentes": 1, "companias": 1}
        # Otra vuelta no repropone el protocolo ni hace una revisión adicional.
        await supervisor._completar_en_llano()
        assert len(llamadas) == anteriores + 1
    finally:
        almacen.cerrar()


@pytest.mark.parametrize("estado", [
    "pausada", "pausada_por_presupuesto", "esperando_modelo", "esperando_plan", "detenida", "terminada",
])
@pytest.mark.asyncio
async def test_peticion_de_revision_no_se_consume_fuera_de_corrida_en_marcha(tmp_path, monkeypatch, estado):
    almacen = Almacen(tmp_path / "rosa.db")
    try:
        ids = _preparar(almacen)
        programas, modelos, llamadas, fuentes = _simular(monkeypatch, ids)
        h = _hipotesis(almacen, ids)
        h.update(experimento={"protocolo": "Protocolo ya guardado", "estado": "propuesto"},
                 _experimentoIntentado=True, _revisionTratamientoPendiente=True)
        _estado_corrida(almacen, ids, estado)
        supervisor = CO.Supervisor(almacen, programas, modelos)
        await supervisor._completar_en_llano()
        assert h["_revisionTratamientoPendiente"]
        assert h["experimento"]["protocolo"] == "Protocolo ya guardado"
        assert llamadas == [] and not fuentes
    finally:
        almacen.cerrar()
