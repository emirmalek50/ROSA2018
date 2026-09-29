"""Los ejecutores de paso: una funcion por tipo de paso del plan.

Cada ejecutor recibe el contexto de la corrida (almacen, programas, modelos,
ids) y el paso, lanza sus pistas y devuelve un resumen. Escribe en el estado
solo a traves del almacen. Los datos de trabajo de la corrida (fuentes con
sus fragmentos, afirmaciones con su veredicto, consultas hechas) viven en
claves privadas de la corrida (`_fuentes`, `_afirmaciones`,
`_consultasHechas`) que no viajan al navegador.

Reglas que se cumplen aqui:
- Una fuente que no responde es "no pude comprobar", nunca "no hay".
- Toda afirmacion nace `sin_verificar` y solo cambia por el verificador.
- Al modelo de mundo solo entran afirmaciones sostenidas o parciales.
- Las hipotesis nuevas entran a la cola como `propuesta`; nadie las acepta
  por ellas.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
from datetime import datetime, timezone
import math
import re
import traceback
from dataclasses import dataclass
from typing import Any, Awaitable, NamedTuple

import dspy

from rosa import acuerdo_dorado as ACU
from rosa import ontologias as ONTO
from rosa import sesgo as SESGO
from rosa import config, politicas
from rosa import cuestiones as CU
from rosa import dependencias as DEP
from rosa import causal as CAUSAL
from rosa import conectores as CON
from rosa import datasets_programa as DP
from rosa import dianas as DI
from rosa import ruta as RUTA
from rosa import killer as K
from rosa import hechos as H
from rosa import metodos as METODOS
from rosa import verificador as V
from rosa import solidez as SOL
from rosa import equipo as EQ
from rosa import tareas as TA
from rosa import viabilidad as VIA
from rosa import torneo
from rosa import vigilante_modelos as VIG
from rosa import vigencia as VIGENCIA
from rosa.bucle import contexto as T
from rosa.bucle.pista import Pista
from rosa.estado import acciones as A
from rosa.estado import plantilla as P
from rosa.estado.almacen import Almacen
from rosa import certeza as CERTEZA
from rosa import indice_semantico, reranker
from rosa import lecciones as LEC
from rosa.bucle import vivero as VIVERO
from rosa.fuentes import clinicaltrials, crossref, europepmc, exa, openalex, opentargets, pdf, pubmed, unpaywall
from rosa.fuentes import base as FB
from rosa.fuentes.base import FuenteNoDisponible
from rosa.gateway import Modelos
from rosa.modulos.contador import ContextoLlamada, PresupuestoAgotado, contexto_actual, presupuesto_ok
from rosa.modulos.firmas import Programas

MAX_FUENTES_POR_CONSULTA = politicas.MAX_FUENTES_POR_CONSULTA
MAX_FUENTES_CON_RERANKER = politicas.MAX_FUENTES_CON_RERANKER
MAX_CRIBADO_MODELO = politicas.MAX_CRIBADO_MODELO


def maximo_por_consulta() -> int:
    """Cuántos candidatos se traen por consulta: más si el reranker va a cortar."""
    return MAX_FUENTES_CON_RERANKER if reranker.disponible() else MAX_FUENTES_POR_CONSULTA


async def cortar_con_reranker(pregunta: str, articulos: list[dict[str, Any]], pista: Pista | None, maximo: int = MAX_CRIBADO_MODELO) -> tuple[list[dict[str, Any]], list[tuple[dict[str, Any], float]]]:
    """Ordena los artículos por pertinencia con el reranker del gateway y
    devuelve (los que ve el modelo, los que quedan fuera con su pertinencia).
    Si el reranker no está o falla, todos pasan al modelo, como antes."""
    if len(articulos) <= maximo or not reranker.disponible():
        return articulos, []
    try:
        orden = await reranker.reordenar(pregunta, [reranker.texto_de_articulo(a) for a in articulos])
    except FuenteNoDisponible as ex:
        if pista:
            pista.nota(f"Reranker no disponible ({str(ex)[:80]}); el modelo criba todos los candidatos")
        return articulos, []
    puntuacion = {i: s for i, s in orden}
    ordenados = sorted(range(len(articulos)), key=lambda i: -puntuacion.get(i, -1.0))
    dentro = [articulos[i] for i in ordenados[:maximo]]
    fuera = [(articulos[i], puntuacion.get(i, 0.0)) for i in ordenados[maximo:]]
    if pista:
        pista.accion("Reranker", {"base": "AI Gateway", "parametros": f"model={reranker.MODELO}&documentos={len(articulos)}&top_n={maximo}", "resultados": f"{len(dentro)} al modelo, {len(fuera)} fuera del corte"})
    return dentro, fuera
MAX_FUENTES_EXTRAER = politicas.MAX_FUENTES_EXTRAER
MAX_FRAGMENTOS_POR_FUENTE = politicas.MAX_FRAGMENTOS_POR_FUENTE
MAX_PAGINAS_PDF = 14
RELEVANCIA_MINIMA = politicas.RELEVANCIA_MINIMA
TAU_COBERTURA = 20.0


# La excepción del paso que falla sin cambiar de modelo es la del vigilante
# (filtro o vacío persistente; modelo vivo pero lento con la petición).
ModeloBloqueado = VIG.ModeloBloqueado


# El tiempo por intento vive en rosa/vigilante_modelos.py (TIEMPO_AVISO_S, por rol:
# 240 s el cerebro, 300 s el juez, 120 s el volumen). Esta constante queda como el
# mayor de ellos para quien la lea como "tope de una llamada"; antes eran 600 s
# fijos y LiteLLM reintentaba por dentro cuatro veces cinco minutos (la hora
# perdida de la corrida 13, 18 de septiembre de 2026).
SEGUNDOS_MAX_LLAMADA = max(VIG.TIEMPO_AVISO_S.values())

# Excepciones que cortan un paso entero aunque salgan de un solo elemento (una
# afirmación, un artículo): sin presupuesto no se sigue gastando, y con el
# cerebro o el juez caídos el paso se retoma cuando vuelvan (TRASPASO.md 7.4), no
# se pasa al siguiente elemento para que haga otros cuatro intentos.
class CorridaParada(BaseException):
    """La persona detuvo o pausó la corrida mientras un paso corría. La lanza
    `Ctx.llamar` antes de cada llamada, solo en el contexto que ejecuta los pasos
    de la corrida (`de_paso`). Hasta el 25 de septiembre de 2026 el estado de la
    corrida solo se miraba entre paso y paso: la corrida 15 hizo 146 de sus 148
    llamadas después de que la detuvieran.

    Hereda de BaseException, como la cancelación de asyncio, para que ningún
    `except Exception` de dentro del paso se la trague y siga con el siguiente
    elemento, que volvería a lanzarla y dejaría el paso "hecho" con basura."""

    def __init__(self, estado: str) -> None:
        super().__init__(f"La corrida está {estado}: el paso se interrumpe sin llamar al modelo")
        self.estado = estado


# Los estados en los que un paso de la corrida no puede seguir llamando.
ESTADOS_QUE_PARAN_EL_PASO = ("detenida", "terminada", "pausada", "pausada_por_presupuesto")

EXCEPCIONES_QUE_CORTAN_EL_PASO: tuple[type[BaseException], ...] = (PresupuestoAgotado, VIG.ModeloSinRespuesta, CorridaParada)


async def _en_paralelo(*coros: Awaitable[Any], return_exceptions: bool = False) -> list[Any]:
    """`asyncio.gather` que, si una tarea lanza, cancela a las hermanas antes de
    propagar. `gather` a secas propaga la primera excepción y deja a las demás
    corriendo: con Opus caído, cada afirmación pendiente seguía haciendo sus
    cuatro intentos en segundo plano (22 minutos cada una con los tiempos
    reales) después de que el paso ya hubiera fallado con `ModeloSinRespuesta`.
    Con `return_exceptions=True` se comporta como `gather(return_exceptions=True)`
    (cada fallo vuelve en su sitio como excepción) salvo para
    EXCEPCIONES_QUE_CORTAN_EL_PASO, que cancelan y se propagan igual."""
    tareas = [asyncio.ensure_future(c) for c in coros]
    pendientes = set(tareas)
    try:
        while pendientes:
            hechas, pendientes = await asyncio.wait(pendientes, return_when=asyncio.FIRST_EXCEPTION)
            for t in hechas:
                if t.cancelled():
                    continue
                ex = t.exception()
                if ex is None:
                    continue
                if not return_exceptions or isinstance(ex, EXCEPCIONES_QUE_CORTAN_EL_PASO):
                    raise ex
        salida: list[Any] = []
        for t in tareas:
            if t.cancelled():
                salida.append(asyncio.CancelledError())
            elif t.exception() is not None:
                salida.append(t.exception())
            else:
                salida.append(t.result())
        return salida
    except BaseException:
        for t in tareas:
            if not t.done():
                t.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)
        raise


def _pregunta_de(ctx: "Ctx") -> str | None:
    """El enunciado de la pregunta de la corrida, si ROSA2018 ya la formuló."""
    return ((ctx.corrida().get("pregunta") or {}).get("enunciado")) or None


def _criterio(ctx: "Ctx", inv: dict[str, Any]) -> str:
    """El criterio de relevancia de este paso: objetivo, pregunta de la corrida,
    preguntas abiertas propias (ver contexto.preguntas_abiertas) y qué refutaría
    las hipótesis vivas (contexto.que_refutaria), para que el cribado recoja
    también lo que las contradice y no solo lo que las apoya."""
    base = T.preguntas_abiertas(ctx.e["hechos"], ctx.investigacion_id, inv["objetivo"], pregunta=_pregunta_de(ctx), cuestiones=ctx.e.get("cuestiones"), turno=ctx.numero)
    refuta = T.que_refutaria(ctx.e["hipotesis"], ctx.investigacion_id)
    return f"{base}\n\n{refuta}" if refuta else base


def destino_de_propuesta(afirmaciones: list[dict[str, Any]], fuentes: list[dict[str, Any]]) -> tuple[str, str, str]:
    """('nace' | 'vivero', nivel, motivo). Una propuesta del generador nace como
    hipótesis solo si su evidencia ya da para certeza baja por regla (dos
    cohortes distintas); si no, va al vivero a esperar la segunda cohorte."""
    nivel, motivo = CERTEZA.techo({"afirmaciones": afirmaciones, "procedencia": {"fuentes": fuentes}})
    return ("nace" if CERTEZA.NIVELES.index(nivel) >= 1 else "vivero"), nivel, motivo


def _claves_articulo(a: dict[str, Any]) -> set[str]:
    """Los identificadores normalizados de un artículo (doi:, pmid:, nct:,
    titulo:), los mismos que `claves_de_fuente` usa para fusionar fuentes
    (S-06 g). Antes había dos funciones: una escribía "título:" con tilde y la
    otra comparaba "titulo:" sin ella, así que la caché de exclusiones por
    título nunca acertaba."""
    return claves_de_fuente(a)


def _clave_articulo(a: dict[str, Any]) -> str:
    """La clave principal de un artículo, por preferencia DOI, PMID, NCT y
    título; cadena vacía si no tiene ninguna. Se conserva para quien la use:
    la caché de exclusiones compara todas las claves con `_claves_articulo`."""
    claves = _claves_articulo(a)
    for prefijo in ("doi:", "pmid:", "nct:", "titulo:"):
        for c in sorted(claves):
            if c.startswith(prefijo):
                return c
    return ""


# Motivos de exclusión que no salieron de un modelo: el corte del reranker, una
# exclusión reutilizada de otra corrida o un fallo del modelo. Sirven para las
# exclusiones anteriores al 18 de septiembre de 2026, que no traen `puntuadoPorModelo`.
_MOTIVOS_SIN_MODELO = ("fuera del corte del reranker", "ya excluido en la corrida", "ya cribada en", "sin puntuar")


def exclusion_puntuada_por_modelo(ex: dict[str, Any]) -> bool:
    """True si un modelo puntuó la relevancia del excluido. Con el campo
    `puntuadoPorModelo` manda el campo; sin él (registro antiguo) se mira el
    motivo: un corte del reranker o una exclusión reutilizada no lo son."""
    if isinstance(ex.get("puntuadoPorModelo"), bool):
        return ex["puntuadoPorModelo"]
    motivo = str(ex.get("motivo") or "").strip().lower()
    return not motivo.startswith(_MOTIVOS_SIN_MODELO)


_LINEAS_ESTABLES_CRITERIO = ("objetivo:", "pregunta de esta corrida:")


def criterio_estable(criterio: str) -> str:
    """La parte del criterio de relevancia que no cambia de una iteración a otra:
    las líneas "Objetivo:" y "Pregunta de esta corrida:" y, si el criterio lleva
    preguntas heredadas de otra investigación, la marca "con preguntas heredadas"
    (S-07: un juicio hecho con preguntas heredadas no vale para el criterio
    propio). Las preguntas abiertas no entran: cambian casi en cada iteración y,
    si entraran en la huella, la caché de exclusiones moriría con cada pregunta
    nueva y el mismo artículo irrelevante volvería al modelo en cada iteración.
    Un texto sin esas líneas (el objetivo a secas, en amplitud) vuelve entero."""
    lineas = [l_.strip() for l_ in str(criterio or "").splitlines() if l_.strip().lower().startswith(_LINEAS_ESTABLES_CRITERIO)]
    if not lineas:
        return str(criterio or "")
    if "(heredada)" in str(criterio):
        lineas.append("con preguntas heredadas")
    return "\n".join(lineas)


def hash_criterio(criterio: str) -> str:
    """Huella corta de lo estable del criterio de relevancia (`criterio_estable`:
    objetivo, pregunta de la corrida y si había preguntas heredadas) con el que
    se juzgó un artículo: una exclusión hecha con otro objetivo u otra pregunta
    de corrida no vale para estos (S-07); una hecha con las mismas y otras
    preguntas abiertas sí."""
    return hashlib.sha1(V.normalizar(criterio_estable(criterio)).encode("utf-8")).hexdigest()[:12]


def _excluidos_previos(ctx: "Ctx", modo: str, relevancia_maxima: int, criterio: str | None = None) -> dict[str, dict[str, Any]]:
    """Los artículos excluidos con claridad (relevancia baja) en cualquier corrida
    de la investigación, en el mismo modo, indexados por cada una de sus claves
    (DOI, PMID, NCT, título): no se vuelven a cribar; se reutiliza el motivo.
    Solo cuentan las exclusiones que puntuó un modelo (no los cortes del
    reranker, que ningún modelo miró) y, si traen huella de criterio, las
    hechas con este mismo criterio (S-07). Las anteriores a la huella se
    reutilizan si las puntuó un modelo; la regla del nombre propio en el título
    (`titulo_nombra`) rescata las que nombran lo que la persona pidió. Un
    excluido por poco (rozando el listón) sí se vuelve a mirar, porque otra
    pregunta puede rescatarlo."""
    salida: dict[str, dict[str, Any]] = {}
    for c in ctx.e["corridas"]:
        if c["investigacionId"] != ctx.investigacion_id:
            continue
        for ex in (c.get("busqueda") or {}).get("excluidos", []):
            if not isinstance(ex, dict):
                continue
            if (ex.get("modo") or "foco") != modo or int(ex.get("relevancia") or 0) > relevancia_maxima:
                continue
            if not exclusion_puntuada_por_modelo(ex):
                continue
            if criterio and ex.get("criterio") and ex["criterio"] != criterio:
                continue
            for clave in _claves_articulo(ex):
                salida[clave] = dict(ex, corrida=c["numero"])
    return salida


def titulo_nombra(titulo: str, nombres: list[str]) -> str | None:
    """El nombre propio del objetivo (fármaco, ensayo, cohorte) que aparece en el
    título como palabra completa, o None. "evoke" no casa con "evoked"; "evoke+"
    se busca sin el signo; "TRAILBLAZER-ALZ 2" admite guion o espacio entre
    sus partes; un guion pegado ("Lecanemab-associated ARIA") es frontera, como
    el espacio. Un artículo así no se descarta por el corte del reranker ni por
    una exclusión anterior sin huella de criterio: es la evidencia directa que
    la persona pidió por nombre (S-07)."""
    t = str(titulo or "").lower()
    if not t:
        return None
    for n in nombres or []:
        base = str(n or "").strip().rstrip("+").lower()
        if len(base) < 3:
            continue
        partes = [re.escape(x) for x in re.split(r"[\s\-]+", base) if x]
        if not partes:
            continue
        patron = r"(?<![\w+])" + r"[\s\-]*".join(partes) + r"(?![\w+])"
        if re.search(patron, t):
            return n
    return None


def regresion_de_comprobaciones(e: dict[str, Any], h: dict[str, Any], comprobaciones: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Las comprobaciones que fallan ahora y pasaban en la decisión del Killer
    sobre la versión anterior de la hipótesis. Reformular para arreglar una cosa
    no puede colar otra peor."""
    version = int(h.get("version", 1) or 1)
    if version <= 1:
        return []
    previas = [d for d in e.get("decisiones", []) if d.get("hipotesisId") == h["id"] and str(d.get("etapa", "")).startswith("killer") and int(d.get("version") or 0) == version - 1]
    if not previas:
        return []
    anterior = max(previas, key=lambda d: d.get("fecha") or 0)
    pasaban = {c["comprobacion"] for c in anterior.get("comprobaciones", []) if c.get("resultado") == "pasa"}
    return [{"comprobacion": c["comprobacion"], "antes": "pasa", "ahora": "falla", "detalle": (c.get("detalle") or "")[:160]} for c in comprobaciones if c.get("resultado") == "falla" and c["comprobacion"] in pasaban]


def _liston_de(f: dict[str, Any]) -> int:
    """El listón de relevancia con el que entró la fuente: el de amplitud si llegó explorando."""
    return politicas.RELEVANCIA_MINIMA_AMPLITUD if f.get("modo") == "amplitud" else RELEVANCIA_MINIMA


def _criterio_para_fuente(preguntas: str, f: dict[str, Any]) -> str:
    """El criterio que ve el extractor: el general más, para una fuente de amplitud,
    por qué se conservó, para que extraiga también lo que sirve a eso."""
    if f.get("modo") == "amplitud" and f.get("porque"):
        return f"{preguntas}\nEsta fuente llegó por búsqueda en amplitud y se conservó porque podría cambiar: {f['porque']}. Extrae también las afirmaciones que sirvan a eso, aunque no respondan a las preguntas anteriores."
    return preguntas


def _consulta_del_paso(ctx: "Ctx", inv: dict[str, Any], extra: str = "") -> str:
    """Con qué se eligen los hechos del modelo de mundo para un paso: el
    objetivo, la pregunta de la corrida y lo propio del paso."""
    return " ".join(x for x in (inv["objetivo"], _pregunta_de(ctx) or "", extra) if x)[:2000]


@dataclass
class Ctx:
    almacen: Almacen
    programas: Programas
    modelos: Modelos
    corrida_id: str
    investigacion_id: str
    iteracion_id: str
    numero: int
    # Si este contexto ejecuta un paso de la corrida. Solo ese se corta al detener o
    # pausar: el trabajo de fondo que pide la persona (una revisión, los datos del
    # laboratorio) usa la última corrida aunque esté parada.
    de_paso: bool = False
    # Trabajo que no pertenece a ninguna iteración (la recuperación de citas de
    # corridas ya cerradas): se carga al tope de la corrida, no al de su última
    # iteración, que suele estar gastado porque así se cerró.
    sin_tope_de_iteracion: bool = False

    # -- lecturas ---------------------------------------------------------

    @property
    def e(self) -> dict[str, Any]:
        return self.almacen.estado

    def corrida(self) -> dict[str, Any]:
        return next(c for c in self.e["corridas"] if c["id"] == self.corrida_id)

    def inv(self) -> dict[str, Any]:
        return next(i for i in self.e["investigaciones"] if i["id"] == self.investigacion_id)

    def iteracion(self) -> dict[str, Any]:
        return next(i for i in self.e["iteraciones"] if i["id"] == self.iteracion_id)

    def fuentes(self) -> dict[str, dict[str, Any]]:
        return self.corrida().setdefault("_fuentes", {})

    def afirmaciones(self) -> list[dict[str, Any]]:
        return self.corrida().setdefault("_afirmaciones", [])

    def fragmentos_verificador(self) -> list[V.Fragmento]:
        salida = []
        for f in self.fuentes().values():
            for fr in f.get("fragmentos", []):
                salida.append(V.Fragmento(f["id"], f["referencia"], fr["localizador"], fr["texto"], fr.get("encabezado", "")))
        return salida

    # -- escrituras --------------------------------------------------------

    def mutar(self, fn, nombre: str = "bucle") -> Any:
        return self.almacen.mutar(fn, nombre)

    def evento(self, tipo: str, texto: str, ruta: str | None = None) -> None:
        self.mutar(lambda e: A.con_evento(e, self.investigacion_id, tipo, texto, ruta, P.ahora_ms()) or True, "evento")

    def pista(self, paso_id: str | None, tipo: str, titulo: str, fuente: str) -> Pista:
        return Pista(self.almacen, self.iteracion_id, paso_id, tipo, titulo, fuente)

    # -- modelos -----------------------------------------------------------

    async def llamar(self, rol: str, programa, rollout_id: int | None = None, **kwargs) -> Any:
        """Una llamada a un modelo por rol, con el contexto para el contador y
        vigilada por rosa/vigilante_modelos.py: si el modelo no responde
        (tiempo agotado, conexión, 429, 5xx) se reintenta con el MISMO modelo
        hasta `MAX_INTENTOS` veces, sondeando el gateway entre intentos, y la
        persona lo ve en la incidencia `modelo_sin_respuesta`, en
        `saludModelos` y en `esperandoModelo`; si devuelve vacío o lo bloquea
        un filtro (cerebro, juez, réplica) se reintenta con el mismo modelo
        variando el `rollout_id` y, si persiste, el paso falla con
        `ModeloBloqueado` e incidencia `modelo_bloqueado`. Nunca se cambia de
        modelo: el cerebro es GPT-6 Astra y solo Astra, el juez Opus 5 y solo
        Opus (regla de Emir, TRASPASO.md 7.4); Sonnet queda para el volumen.

        `rollout_id` (S-20) entra en la clave de la caché de DSPy sin cambiar
        el prompt: dos llamadas iguales con ids distintos son dos lecturas
        reales (lo usan las trayectorias de réplica); sin él, una llamada
        repetida vuelve de la caché."""
        lm = {"cerebro": self.modelos.cerebro, "juez": self.modelos.juez, "volumen": self.modelos.volumen, "replica": getattr(self.modelos, "replica", None) or self.modelos.juez}[rol]
        if rollout_id is not None and hasattr(lm, "copy"):
            lm = lm.copy(rollout_id=int(rollout_id))
        # Detener o pausar mandan sobre el paso en curso: se mira antes de cada llamada.
        if self.de_paso:
            estado = next((c.get("estado") for c in self.e["corridas"] if c["id"] == self.corrida_id), None)
            if estado in ESTADOS_QUE_PARAN_EL_PASO:
                raise CorridaParada(str(estado))
        # El corte de presupuesto de verdad: antes de llamar. (El callback de DSPy no
        # puede cortar: DSPy captura lo que lance y sigue.)
        if not presupuesto_ok(self.almacen, self.corrida_id, None if self.sin_tope_de_iteracion else self.numero):
            raise PresupuestoAgotado(f"Presupuesto de la corrida {self.corrida_id}" + ("" if self.sin_tope_de_iteracion else f" (o de su iteración {self.numero})") + " agotado")
        kwargs = self._acotar_contexto(rol, kwargs)

        async def ejecutar(modelo):
            # `modelo` es el lm del rol o, en un reintento por contenido, su copia con
            # otro rollout_id: siempre el mismo modelo del gateway.
            servicio = getattr(self.almacen, "gepa_servicio", None)
            if servicio is not None:
                return await servicio.llamar(self, programa, modelo, kwargs)
            with dspy.context(lm=modelo):
                return await programa.acall(**kwargs)

        token = contexto_actual.set(ContextoLlamada(self.corrida_id, self.numero, rol))
        try:
            return await VIG.llamar_vigilado(ejecutar, rol, lm, ganchos=VIG.ganchos_de_contexto(self))
        finally:
            contexto_actual.reset(token)

    def _acotar_contexto(self, rol: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        """Politica de contexto: cada rol tiene un presupuesto de tokens de
        entrada (politicas.TOKENS_MAX_POR_ROL). Si el prompt lo excede, las
        entradas de texto mas largas se recortan (se conserva el principio y
        el final, con una marca) y queda registrado en la corrida como
        compactacion. Estimacion: 4 caracteres por token."""
        tope = politicas.TOKENS_MAX_POR_ROL.get(rol)
        if not tope:
            return kwargs
        textos = {k: v for k, v in kwargs.items() if isinstance(v, str)}
        total = sum(len(v) for v in textos.values()) // 4
        if total <= tope:
            return kwargs
        exceso_chars = (total - tope) * 4
        nuevos = dict(kwargs)
        for k, v in sorted(textos.items(), key=lambda kv: -len(kv[1])):
            if exceso_chars <= 0:
                break
            recorte = min(exceso_chars, max(0, len(v) - 2000))
            if recorte <= 0:
                continue
            mitad = (len(v) - recorte) // 2
            nuevos[k] = v[:mitad] + f"\n[... {recorte // 4} tokens recortados por la política de contexto del rol {rol} ...]\n" + v[len(v) - mitad:]
            exceso_chars -= recorte

        def fn(e: dict[str, Any]) -> bool:
            c = next((x for x in e["corridas"] if x["id"] == self.corrida_id), None)
            if not c:
                return False
            c["contexto"]["compactaciones"] = int(c["contexto"].get("compactaciones") or 0) + 1
            c["contexto"]["ultimaCompactacion"] = P.ahora_ms()
            return True

        self.mutar(fn, "compactacion")
        return nuevos

    def incidencia(self, tipo: str, titulo: str, detalle: str, recurso: str, alternativa: str | None) -> None:
        ahora = P.ahora_ms()

        def fn(e: dict[str, Any]) -> bool:
            for inc in e["incidencias"]:
                if inc["corridaId"] == self.corrida_id and inc["estado"] == "pendiente" and inc["recurso"] == recurso and inc["tipo"] == tipo:
                    return False
            e["incidencias"].append({"id": P.nuevo_id("inc"), "corridaId": self.corrida_id, "tipo": tipo, "titulo": titulo, "detalle": detalle, "recurso": recurso, "alternativa": alternativa, "estado": "pendiente", "creadaEn": ahora, "resueltaEn": None, "resolucion": None})
            A.con_evento(e, self.investigacion_id, "incidencia", f"Incidencia: {titulo}", f"#/investigaciones/{self.investigacion_id}/corrida", ahora)
            return True

        self.mutar(fn, "incidencia")


# ---------------------------------------------------------------------------
# Literatura
# ---------------------------------------------------------------------------


def claves_de_fuente(datos: dict[str, Any]) -> set[str]:
    """Identificadores normalizados con los que se reconoce una fuente ya vista:
    doi:..., pmid:..., nct:... y título:... (sin puntuación). Nunca la cadena
    vacía: dos fuentes sin nada en común no se fusionan."""
    claves: set[str] = set()
    doi = (datos.get("doi") or "").strip().lower()
    doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi).rstrip(".")
    if doi:
        claves.add(f"doi:{doi}")
    for campo in ("pmid", "nct"):
        v = str(datos.get(campo) or "").strip().lower()
        if v:
            claves.add(f"{campo}:{v}")
    titulo = re.sub(r"[^a-z0-9]+", " ", (datos.get("titulo") or "").lower()).strip()
    if len(titulo) >= 20:
        claves.add(f"titulo:{titulo}")
    return claves


def _desambiguar_referencia_local(referencia: str, existentes: list[str]) -> str:
    """Respaldo mientras rosa/fuentes/base.py no traiga `desambiguar_referencia`
    (grupo A, mismo contrato): si ya hay otra fuente con la misma referencia
    corta en la corrida, se añade una letra al año ("Sin autor, 2023b") o un
    ordinal ("Sin autor (2)"), para que dos artículos distintos del mismo
    primer autor y año no compartan cita."""
    existentes_norm = {(x or "").strip().lower() for x in existentes}
    base = (referencia or "").strip()
    if base.lower() not in existentes_norm:
        return base
    m = re.search(r"(\d{4})[a-z]?$", base)
    for i in range(1, 26):
        letra = chr(ord("a") + i)  # b, c, d...
        candidata = (base[: m.start()] + m.group(1) + letra) if m else f"{base} ({i + 1})"
        if candidata.lower() not in existentes_norm:
            return candidata
    return base


def desambiguar_referencia(referencia: str, existentes: list[str]) -> str:
    """La referencia corta que se guarda y que va en la cita `[referencia,
    localizador]`: única dentro de la corrida. Usa la del grupo A
    (rosa/fuentes/base.py) si existe; si no, el respaldo local."""
    fn = getattr(FB, "desambiguar_referencia", None)
    if fn is None:
        return _desambiguar_referencia_local(referencia, existentes)
    try:
        return str(fn(referencia, list(existentes)) or referencia)
    except Exception:  # noqa: BLE001  la desambiguación nunca tumba el registro de una fuente
        return _desambiguar_referencia_local(referencia, existentes)


def _registrar_fuente(ctx: Ctx, datos: dict[str, Any], tipo: str, fragmentos: list[dict[str, str]], relevancia: int, marca: str | None, marca_detalle: str, comprobada_en: int | None, consulta: str | None = None, ya_extraida: bool = False, reutilizada_de: int | None = None) -> str:
    """Añade una fuente al almacén privado de la corrida (o la actualiza) y
    devuelve su id. Una fuente nueva cuya referencia corta ya la usa otra
    fuente distinta de la corrida se registra desambiguada (S-04: dos
    "Bhagunde et al., 2026" resolvían la cita al texto equivocado).

    Cada fragmento lleva `extraido` (S-06 d, S-26): si a una fuente ya
    extraída le llegan fragmentos nuevos (el PDF de un artículo del que solo
    se tenía el resumen), la fuente se reabre y el extractor lee solo lo
    nuevo. `ya_extraida` y `reutilizada_de` sirven para copiar a esta corrida
    una fuente cribada y leída en otra corrida de la investigación sin volver
    a extraerla (S-06 e)."""
    claves = claves_de_fuente(datos)

    def fn(e: dict[str, Any]) -> str:
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        fuentes = c.setdefault("_fuentes", {})
        # La misma fuente puede llegar de PubMed sin DOI y de Europe PMC con DOI:
        # coincide si comparte cualquier identificador normalizado (o el título
        # normalizado). Sin identificadores ni título, nunca se fusiona.
        existente = next((f for f in fuentes.values() if claves and (set(f.get("_claves") or ([f["_clave"]] if f.get("_clave") else [])) & claves)), None)
        if existente:
            existente["_claves"] = sorted(set(existente.get("_claves") or []) | claves)
            for campo in ("doi", "pmid", "nct"):
                if not existente.get(campo) and datos.get(campo):
                    existente[campo] = datos[campo]
            vistos = {fr["localizador"] for fr in existente["fragmentos"]}
            nuevos = [fr for fr in fragmentos if fr["localizador"] not in vistos]
            if nuevos:
                # Lo leído bajo el booleano antiguo (fuente sin `extraido` por fragmento)
                # cuenta como leído; la fuente se reabre solo si llega algo sin leer.
                if existente.get("extraida"):
                    for fr in existente["fragmentos"]:
                        fr.setdefault("extraido", True)
                for fr in nuevos:
                    fr.setdefault("extraido", bool(ya_extraida))
                existente["fragmentos"].extend(nuevos)
                if any(not fr.get("extraido") for fr in nuevos):
                    existente["extraida"] = False
            existente["relevancia"] = max(existente.get("relevancia", 0), relevancia)
            existente["textoCompleto"] = existente["textoCompleto"] or any(fr["localizador"] != "resumen" for fr in fragmentos)
            if consulta and consulta not in existente.setdefault("consultas", []):
                existente["consultas"].append(consulta)
            # Si una consulta de foco también la trajo, deja de contar como hallazgo de amplitud.
            # Una fuente anterior al 16 de septiembre de 2026 (sin modo) llegó por foco.
            if datos.get("_modo") == "foco" or not existente.get("modo"):
                existente["modo"] = "foco"
            if datos.get("_porque") and not existente.get("porque"):
                existente["porque"] = datos["_porque"]
            return existente["id"]
        tipo_estudio, nivel = pubmed.tipo_estudio(datos.get("tipos", []), datos.get("titulo", ""))
        referencia = desambiguar_referencia(datos["referencia"], [x.get("referencia", "") for x in fuentes.values()])
        f = P.nueva_fuente(
            referencia=referencia,
            titulo=datos.get("titulo", ""),
            tipo=tipo,
            doi=datos.get("doi"),
            pmid=datos.get("pmid"),
            nct=datos.get("nct"),
            pagina=None,
            fragmento=(fragmentos[0]["texto"][:300] if fragmentos else ""),
            retraccion=marca,
            retraccionComprobadaEn=comprobada_en,
            anio=datos.get("anio"),
            autores=list(datos.get("autores", []))[:12],
            centro=(datos.get("centro") or None),
            tipoEstudio=tipo_estudio if tipo != "ensayo" else "registro",
            nivelEvidencia=nivel,
            textoCompleto=any(fr["localizador"] != "resumen" for fr in fragmentos),
            citas=datos.get("citas"),
        )
        f["_claves"] = sorted(claves)
        f["_clave"] = next(iter(sorted(claves)), "")
        f["_marcaDetalle"] = marca_detalle
        for fr in fragmentos:
            fr.setdefault("extraido", bool(ya_extraida))
        f["fragmentos"] = fragmentos
        f["relevancia"] = relevancia
        f["extraida"] = bool(ya_extraida)
        if reutilizada_de is not None:
            f["_reutilizadaDe"] = reutilizada_de
        f["iteracion"] = ctx.numero
        f["consultas"] = [consulta] if consulta else []
        # Por qué modo llegó: foco (la pregunta) o amplitud (explorando alrededor), y en
        # amplitud, por qué se conservó (qué podría cambiar), para que el extractor lo sepa.
        f["modo"] = datos.get("_modo") or "foco"
        if datos.get("_porque"):
            f["porque"] = datos["_porque"]
        fuentes[f["id"]] = f
        return f["id"]

    return ctx.mutar(fn, "fuente")


async def _fragmentos_de(ctx: Ctx, datos: dict[str, Any], pista: Pista, con_texto_completo: bool) -> list[dict[str, str]]:
    """Resumen siempre; texto completo por páginas (PDF) o secciones (JATS)
    si está disponible y la fuente es relevante."""
    fragmentos: list[dict[str, str]] = []
    if datos.get("resumen"):
        fragmentos.append({"localizador": "resumen", "texto": datos["resumen"], "encabezado": datos.get("titulo", "")})
    if not con_texto_completo:
        return fragmentos
    # 1. PDF en acceso abierto: página exacta.
    url_pdf = datos.get("pdf")
    if not url_pdf and datos.get("doi"):
        try:
            oa = await unpaywall.pdf_de(datos["doi"])
            url_pdf = oa["url"] if oa else None
        except FuenteNoDisponible as ex:
            pista.nota(f"Unpaywall no respondió para {datos['referencia']}: {ex}")
    if url_pdf:
        try:
            ruta = await pdf.descargar(url_pdf)
            if ruta:
                pags = pdf.paginas(ruta)[:MAX_PAGINAS_PDF]
                for p in pags:
                    fragmentos.append({"localizador": f"pág. {p['pagina']}", "texto": p["texto"], "encabezado": datos.get("titulo", ""), "_ruta": str(ruta)})
                pista.resultado(f"{datos['referencia']}: PDF con {len(pags)} páginas leídas")
                return fragmentos
        except FuenteNoDisponible as ex:
            pista.nota(f"PDF no descargable de {datos['referencia']}: {str(ex)[:120]}")
    # 2. XML de Europe PMC: sección como localizador.
    if datos.get("pmcid"):
        try:
            secciones = await europepmc.texto_completo(datos["pmcid"])
            # Se guardan hasta cuatro veces las que se leen: el extractor elige cuáles
            # (resultados primero, S-26), y las secciones de resultados suelen ir tras
            # una docena de subsecciones de introducción y métodos.
            for s in secciones[:MAX_FRAGMENTOS_POR_FUENTE * 4]:
                fragmentos.append({"localizador": f"sección {s['seccion'][:60]}", "texto": s["texto"], "encabezado": s["seccion"]})
            if secciones:
                pista.resultado(f"{datos['referencia']}: texto completo en {len(secciones)} secciones (Europe PMC)")
        except FuenteNoDisponible as ex:
            pista.nota(f"Europe PMC sin texto completo para {datos['pmcid']}: {str(ex)[:120]}")
    # 3. Último recurso: el texto limpio de la página, por Exa. Sin número de
    #    página, así que el localizador lo dice ("texto web, parte N"): sirve
    #    para verificar contra el pasaje literal, no sustituye a la cita a la
    #    página exacta de un PDF.
    if not any(fr["localizador"] != "resumen" for fr in fragmentos) and exa.disponible():
        url = datos.get("url") or (f"https://doi.org/{datos['doi']}" if datos.get("doi") else None)
        if url:
            try:
                paginas, coste = await exa.contenidos([url], maximo_caracteres=40000)
                _anotar_coste_exa(ctx, coste)
                texto = (paginas[0].get("texto") if paginas else "") or ""
                trozos = trocear_texto(texto)
                for i, t in enumerate(trozos[: MAX_FRAGMENTOS_POR_FUENTE * 2], start=1):
                    fragmentos.append({"localizador": f"texto web, parte {i}", "texto": t, "encabezado": datos.get("titulo", ""), "_url": url})
                if trozos:
                    pista.resultado(f"{datos['referencia']}: texto de la página en {min(len(trozos), MAX_FRAGMENTOS_POR_FUENTE * 2)} partes (Exa, sin paginación)")
                else:
                    pista.nota(f"{datos['referencia']}: Exa no devolvió texto para {url[:80]}")
            except FuenteNoDisponible as ex:
                pista.nota(f"Exa sin texto para {datos['referencia']}: {str(ex)[:120]}")
    return fragmentos


def trocear_texto(texto: str, tamano: int = 2500, minimo: int = 200) -> list[str]:
    """Parte un texto largo en trozos de unos `tamano` caracteres cortando en
    saltos de párrafo (o en punto y espacio si el párrafo es enorme). Los
    trozos más cortos que `minimo` se pegan al anterior; el texto vacío da []."""
    texto = (texto or "").strip()
    if not texto:
        return []
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", texto) if p.strip()]
    trozos: list[str] = []
    actual = ""
    for p in parrafos:
        while len(p) > tamano:
            corte = p.rfind(". ", 0, tamano)
            corte = corte + 1 if corte >= minimo else tamano
            trozo, p = p[:corte].strip(), p[corte:].strip()
            if actual:
                trozos.append(actual)
                actual = ""
            trozos.append(trozo)
        if len(actual) + len(p) + 1 > tamano and actual:
            trozos.append(actual)
            actual = p
        else:
            actual = f"{actual}\n{p}".strip() if actual else p
    if actual:
        if trozos and len(actual) < minimo:
            trozos[-1] = f"{trozos[-1]}\n{actual}"
        else:
            trozos.append(actual)
    return trozos


NOMBRES_BASE = {"pubmed": "PubMed", "europepmc": "Europe PMC", "preprints": "bioRxiv y medRxiv (vía Europe PMC)", "exa": "Exa (búsqueda semántica de publicaciones)", "gris": "Exa (literatura gris: reguladores, registros, portales del campo)"}


_CAMPO_CONSULTA = r"(?:title_abs|title|abstract|tiab|ti|tw)"


def es_consulta_simple(consulta: str, nombre: str) -> bool:
    """True si la consulta es solo el nombre, en cualquiera de sus formas:
    `lecanemab`, `"lecanemab"`, `TITLE_ABS:"lecanemab"`, `lecanemab[tiab]`,
    `("evoke+")`, con o sin el «+» final. Una consulta con AND, OR u otras
    palabras alrededor del nombre no lo es: `"lecanemab"[tiab] AND ("tau PET")`
    no cuenta como haber buscado lecanemab (S-07)."""
    q = str(consulta or "").strip().lower()
    n = str(nombre or "").strip().lower()
    if not q or not n:
        return False
    q = re.sub(r"^\(+|\)+$", "", q).strip()
    q = re.sub(rf"^{_CAMPO_CONSULTA}\s*:\s*", "", q)
    q = re.sub(rf"\s*\[{_CAMPO_CONSULTA}(?:/abstract)?\]$", "", q)
    q = q.strip().strip('"').strip()
    return q.rstrip("+") == n.rstrip("+")


def clausulas_and(consulta: str) -> list[str]:
    """Las cláusulas de una consulta booleana separadas por AND al nivel más
    alto (fuera de paréntesis y comillas). `a AND (b OR c) AND "d e"` da tres."""
    s_ = str(consulta or "")
    partes: list[str] = []
    actual: list[str] = []
    nivel = 0
    en_comillas = False
    i = 0
    while i < len(s_):
        ch = s_[i]
        if ch == '"':
            en_comillas = not en_comillas
        elif not en_comillas and ch == "(":
            nivel += 1
        elif not en_comillas and ch == ")":
            nivel = max(0, nivel - 1)
        if not en_comillas and nivel == 0 and s_[i : i + 5].upper() == " AND ":
            partes.append("".join(actual).strip())
            actual = []
            i += 5
            continue
        actual.append(ch)
        i += 1
    partes.append("".join(actual).strip())
    return [x for x in partes if x]


def quitar_ultima_clausula(consulta: str) -> str | None:
    """La consulta sin su última cláusula AND, o None si solo tiene una."""
    partes = clausulas_and(consulta)
    if len(partes) < 2:
        return None
    return " AND ".join(partes[:-1])


def limitar_clausulas(consulta: str, maximo: int = politicas.MAX_CLAUSULAS_AND) -> str:
    """La consulta acotada a `máximo` cláusulas AND (las primeras: el plan las
    escribe por importancia). Tal cual si ya cumple."""
    partes = clausulas_and(consulta)
    if len(partes) <= maximo:
        return consulta
    return " AND ".join(partes[:maximo])


def _entero_seguro(x: Any) -> int:
    """`int(x)` que devuelve 0 con None, texto raro o cualquier cosa que no sea un número."""
    try:
        return int(x or 0)
    except (TypeError, ValueError):
        return 0


def _entero_o_none(x: Any) -> int | None:
    """`x` si es un entero de verdad (no un booleano ni un texto); None si no."""
    return x if isinstance(x, int) and not isinstance(x, bool) else None


def consultas_por_nombre(nombres: list[str], consultas: list[dict[str, Any]], previas: list[str], maximo: int = 4, registro: list[dict[str, Any]] | None = None, corrida_actual: int | None = None, explicaciones: list[str] | None = None) -> list[dict[str, Any]]:
    """Red de seguridad determinista: cada nombre propio del objetivo que no se
    ha buscado todavía va como consulta por nombre exacto a Europe PMC. Así una
    corrida no termina sin haber buscado los ensayos que la persona escribió
    en el objetivo.

    "Buscado" significa (S-07): una consulta simple (solo el nombre, ver
    `es_consulta_simple`) en el plan de este paso, o una consulta simple
    anterior que trajo al menos un relevante. Una consulta estrecha que
    contiene el nombre entre cinco cláusulas no cuenta, y una consulta simple
    que no trajo relevantes tampoco: se repite. `registro` son las consultas
    de la investigación con su rendimiento (`resultados`, `relevantes`,
    `corrida`; `contexto.consultas_de_la_investigacion`); sin él, una consulta
    simple previa cuenta como buscado (regla anterior).

    Pero insistir tiene tope (segunda pasada): un nombre con dos consultas
    simples y cero resultados en la base no está allí; y un nombre con
    `politicas.MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES` consultas simples que
    trajeron resultados y ningún relevante (o una en la corrida en curso,
    `corrida_actual`) tampoco se repite: sin tope, "lecanemab" (miles de
    resultados) volvía en cada iteración de cada corrida con su búsqueda, su
    reranker y sus cribados. Lo que se deja de buscar y por qué se escribe en
    `explicaciones`, si se pasa la lista, para que la pista lo diga."""
    salida: list[dict[str, Any]] = []
    previas = [str(x) for x in (previas or [])]
    tope = politicas.MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES

    def buscado(n: str) -> bool:
        if any(es_consulta_simple(str(q.get("consulta") or ""), n) for q in consultas):
            return True
        if registro is None:
            return any(es_consulta_simple(p_, n) for p_ in previas)
        simples = [r for r in registro if isinstance(r, dict) and es_consulta_simple(str(r.get("consulta") or ""), n)]
        if any(_entero_seguro(r.get("relevantes")) >= 1 for r in simples):
            return True
        sin_nada = sum(1 for r in simples if _entero_o_none(r.get("resultados")) == 0)
        if sin_nada >= 2:
            if explicaciones is not None:
                explicaciones.append(f"«{n}» ya se buscó por nombre {sin_nada} veces y la base no tiene ningún resultado; no se insiste")
            return True
        # Consultas simples que trajeron resultados pero ninguno pasó el cribado.
        sin_relevantes = [r for r in simples if _entero_o_none(r.get("relevantes")) == 0 and (_entero_o_none(r.get("resultados")) or 0) > 0]
        if len(sin_relevantes) >= tope:
            corridas = sorted({c_ for c_ in (_entero_o_none(r.get("corrida")) for r in sin_relevantes) if c_ is not None})
            donde = ("las corridas " + ", ".join(str(c_) for c_ in corridas)) if len(corridas) > 1 else (f"la corrida {corridas[0]}" if corridas else "esta investigación")
            if explicaciones is not None:
                explicaciones.append(f"«{n}» ya se buscó por nombre {len(sin_relevantes)} veces en {donde} sin ningún relevante; no se repite (política: {tope} consultas simples sin relevantes)")
            return True
        if corrida_actual is not None and any(_entero_o_none(r.get("corrida")) == corrida_actual for r in sin_relevantes):
            if explicaciones is not None:
                explicaciones.append(f"«{n}» ya se buscó por nombre en esta corrida sin ningún relevante; no se repite en la misma corrida")
            return True
        return False

    for n in nombres:
        if not str(n or "").strip() or buscado(n):
            continue
        salida.append({"base": "europepmc", "consulta": f'"{n}"', "tema": f"Por nombre exacto: {n}", "_por_nombre": True})
        if len(salida) >= maximo:
            break
    return salida


def amplitud_de(inv: dict[str, Any]) -> str:
    """La amplitud de búsqueda elegida para la investigación (botones), o la de por defecto."""
    valor = (inv.get("configuracion") or {}).get("amplitud")
    return valor if isinstance(valor, str) and valor in politicas.AMPLITUD else politicas.AMPLITUD_POR_DEFECTO


def cuantas_de_amplitud(n_foco: int, amplitud: str) -> int:
    """Cuántas consultas exploran fuera de la pregunta para que sean la fracción
    elegida del total: con un tercio y 4 de foco, 2; con la mitad, 4; enfocada, 0."""
    fraccion = politicas.AMPLITUD.get(amplitud, 0.0)
    if fraccion <= 0 or n_foco <= 0:
        return 0
    n = round(n_foco * fraccion / (1 - fraccion))
    return max(1, min(politicas.MAX_CONSULTAS_AMPLITUD, n))


def consulta_novedad_del_campo(inv: dict[str, Any], ahora_ms: int) -> dict[str, Any] | None:
    """La consulta determinista de "novedad del campo": el objetivo, por
    significado, acotado a lo publicado en los últimos meses. Con Exa; sin
    Exa, por términos clave en Europe PMC con la misma ventana de fecha."""
    desde = fecha_iso_de_ms(ahora_ms - politicas.DIAS_NOVEDAD_DEL_CAMPO * 86_400_000)
    porque = f"Lo publicado en los últimos {politicas.DIAS_NOVEDAD_DEL_CAMPO} días sobre el terreno del objetivo puede traer una segunda cohorte, un contraejemplo o una línea que el árbol no tiene"
    if exa.disponible():
        return {"base": "exa", "consulta": f"Novedades recientes en la investigación del Alzheimer relacionadas con: {inv['objetivo'][:400]}", "tema": "Novedad reciente del campo", "modo": "amplitud", "porque": porque, "desde_fecha": desde}
    # Sin clave de Exa la novedad no se pierde: va a Europe PMC por términos clave del
    # objetivo con la misma ventana de fecha (FIRST_PDATE), y queda anotado el desvío.
    hasta = fecha_iso_de_ms(ahora_ms)
    terminos = [t for t in T.terminos_clave(inv["objetivo"], maximo=6) if t.lower() != "alzheimer"][:4]
    nucleo = " OR ".join(f'"{t}"' for t in terminos) if terminos else "biomarker*"
    return {"base": "europepmc", "consulta": f"(Alzheimer*) AND ({nucleo}) AND FIRST_PDATE:[{desde} TO {hasta}]", "tema": "Novedad reciente del campo", "modo": "amplitud", "porque": porque, "desde_fecha": desde, "_desviada_de": "Exa (búsqueda semántica de publicaciones)"}


async def _consultas_amplitud(ctx: "Ctx", inv: dict[str, Any], cuantas: int, previas: list[str], pista: Pista | None = None, lecciones: str = "Ninguna todavía.") -> list[dict[str, Any]]:
    """Las consultas de amplitud de este paso: la novedad del campo (sin modelo)
    y las adyacentes y de sorpresa que escribe el cerebro con el mapa del
    árbol delante. Nunca reformulan la pregunta de la corrida."""
    if cuantas <= 0:
        return []
    salida: list[dict[str, Any]] = []
    ahora = P.ahora_ms()
    novedad = consulta_novedad_del_campo(inv, ahora)
    hechas = {q.lower() for q in previas}
    if novedad and novedad["consulta"].lower() not in hechas:
        salida.append(novedad)
        if novedad.get("_desviada_de") and pista:
            pista.nota("Sin clave de Exa: la novedad reciente del campo se busca en Europe PMC por términos clave del objetivo, con la misma ventana de fecha")
    restantes = cuantas - len(salida)
    if restantes <= 0:
        return salida
    e = ctx.e
    propios = [h for h in e["hechos"] if h["investigacionId"] == ctx.investigacion_id]
    mapa = T.mapa_del_modelo(propios, {h["id"]: h for h in e["hechos"]}, e.get("investigaciones", []))
    try:
        pred = await ctx.llamar(
            "cerebro",
            ctx.programas.explorar,
            objetivo=inv["objetivo"],
            mapa_del_arbol=mapa,
            hipotesis_y_vivero=T.hipotesis_vivas(e["hipotesis"], ctx.investigacion_id) + "\n" + T.vivero_texto(inv),
            pregunta_y_preguntas_abiertas=_criterio(ctx, inv),
            consultas_previas=T.consultas_previas_texto(e, ctx.investigacion_id) + ("\nEn este paso ya: " + "; ".join(q["consulta"][:80] for q in salida) if salida else ""),
            lecciones=lecciones,
            bases_disponibles=", ".join(bases_disponibles()),
            cuantas=restantes,
        )
    except PresupuestoAgotado:
        raise
    except VIG.ModeloSinRespuesta:
        raise
    except Exception as ex:  # noqa: BLE001  sin exploración este paso; el foco sigue
        if pista:
            pista.nota(f"No se pudieron escribir las consultas de amplitud ({type(ex).__name__}); este paso solo busca en foco")
        return salida
    # Se recorren todas las propuestas y se para al llegar al cupo: una repetida
    # o ya hecha no consume plaza.
    for c in list(pred.consultas):
        if len(salida) >= cuantas:
            break
        q = base_efectiva(c.model_dump())
        q["modo"] = "amplitud"
        if not q.get("porque"):
            q["porque"] = "Explorar alrededor del objetivo"
        if q["consulta"].strip() and q["consulta"].lower() not in hechas and q["consulta"].lower() not in {x["consulta"].lower() for x in salida}:
            salida.append(q)
    return salida[:cuantas]


def bases_disponibles() -> list[str]:
    """Las bases que el planificador puede elegir ahora. Exa y la literatura
    gris (que va por Exa) solo con clave."""
    bases = ["pubmed", "europepmc", "preprints"]
    if exa.disponible():
        bases.extend(["exa", "gris"])
    return bases


def base_efectiva(consulta: dict[str, Any]) -> dict[str, Any]:
    """Si el planificador eligió una base que no está disponible (exa sin clave),
    la consulta va a Europe PMC, que admite lenguaje natural razonablemente,
    con una nota. Nunca se pierde una consulta por falta de clave."""
    if consulta.get("base") not in bases_disponibles():
        return {**consulta, "base": "europepmc", "tema": consulta.get("tema", ""), "_desviada_de": consulta.get("base")}
    return consulta


def _indice_fuentes_investigacion(ctx: Ctx) -> dict[str, tuple[dict[str, Any], int | None, bool]]:
    """Cada clave (DOI, PMID, NCT, título) de cada fuente ya registrada en
    cualquier corrida de la investigación -> (fuente, número de corrida, es de
    esta corrida). La corrida actual manda sobre las anteriores y, entre las
    anteriores, la más reciente (S-06 e): lo ya cribado no vuelve al reranker
    ni al modelo de relevancia."""
    salida: dict[str, tuple[dict[str, Any], int | None, bool]] = {}
    corridas = [c for c in ctx.e.get("corridas", []) or [] if isinstance(c, dict) and c.get("investigacionId") == ctx.investigacion_id]
    corridas.sort(key=lambda c: (c.get("id") == ctx.corrida_id, int(c.get("numero") or 0)))
    for c in corridas:
        actual = c.get("id") == ctx.corrida_id
        for f in (c.get("_fuentes") or {}).values():
            if not isinstance(f, dict):
                continue
            claves = set(f.get("_claves") or ([f["_clave"]] if f.get("_clave") else [])) or claves_de_fuente(f)
            for k in claves:
                if k:
                    salida[k] = (f, c.get("numero"), actual)
    return salida


# Lo que una fuente cribada en otra corrida trae ya hecho y no hay que rehacer.
_CAMPOS_REUTILIZABLES = ("cohorte", "metodo", "riesgoSesgo", "centro", "porque")


def _tiene_texto_completo(f: dict[str, Any]) -> bool:
    """True si la fuente guarda algún fragmento que no sea el resumen (páginas
    de un PDF, secciones de Europe PMC o texto web)."""
    return any(isinstance(fr, dict) and fr.get("localizador") and fr.get("localizador") != "resumen" for fr in f.get("fragmentos") or [])


def comprobacion_retraccion_caducada(f: dict[str, Any], ahora_ms: int, dias: int = politicas.DIAS_VIGENCIA_COMPROBACION_RETRACCION) -> bool:
    """True si la comprobación de retracción guardada en la fuente no sirve para
    reutilizarla: nunca llegó (`retraccionComprobadaEn` None: Crossref no
    respondió, o entonces no había DOI) o es más antigua que el tope de la
    política (DIAS_VIGENCIA_COMPROBACION_RETRACCION, 90 por defecto). "No pude
    comprobar" es transitorio, no una comprobación; copiarlo entre corridas
    dejaba sin marca para siempre un artículo retractado con Crossref caído
    aquel día. Una marca de retractado ya comprobada no caduca: una retracción
    no se deshace."""
    comprobada = f.get("retraccionComprobadaEn")
    if not isinstance(comprobada, (int, float)) or isinstance(comprobada, bool) or comprobada <= 0:
        return True
    if f.get("retraccion") == "retractado":
        return False
    return (int(ahora_ms) - int(comprobada)) > int(dias) * 86_400_000


async def _comprobar_retraccion(a: dict[str, Any], pista: Pista) -> tuple[str | None, str, int | None]:
    """La marca editorial de Crossref para el DOI del artículo: (marca, detalle,
    cuándo se comprobó). Sin DOI no se puede comprobar. Si Crossref no responde,
    la fecha queda en None y el detalle lo dice: no se afirma que esté limpio y
    la siguiente corrida vuelve a preguntar."""
    if not a.get("doi"):
        return None, "Sin DOI: no se pudo comprobar en Crossref", None
    try:
        marca, detalle = await crossref.marca_editorial(a["doi"])
        comprobada: int | None = P.ahora_ms()
    except FuenteNoDisponible as ex:
        marca, detalle, comprobada = None, f"Crossref no respondió: {str(ex)[:100]}. No se afirma que esté limpio.", None
    if marca == "retractado":
        pista.error(f"{a['referencia']} está RETRACTADO ({detalle}); se guarda marcado y no se usa como respaldo")
    return marca, detalle, comprobada


def _corrida_de_fuente(ctx: Ctx, fuente_id: str) -> dict[str, Any] | None:
    """La corrida de la investigación en cuyas `_fuentes` privadas vive esa fuente, o None."""
    if not fuente_id:
        return None
    for c in ctx.e.get("corridas", []) or []:
        if isinstance(c, dict) and c.get("investigacionId") == ctx.investigacion_id and fuente_id in (c.get("_fuentes") or {}):
            return c
    return None


def _actualizar_fuente(ctx: Ctx, fuente_id: str, campos: dict[str, Any]) -> bool:
    """Escribe campos sueltos en una fuente de esta corrida (por el almacén, no
    sobre el dict vivo). False si la fuente no está."""

    def fn(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        f = (c.get("_fuentes") or {}).get(fuente_id)
        if not f:
            return False
        f.update(campos)
        return True

    return bool(ctx.mutar(fn, "fuente"))


def _reutilizar_fuente(ctx: Ctx, a: dict[str, Any], fuente_prev: dict[str, Any], numero_prev: int | None, actual: bool, relevancia: int, consulta: str, modo: str, fragmentos_nuevos: list[dict[str, Any]] | None = None, comprobacion: tuple[str | None, str, int | None] | None = None) -> tuple[str, bool, int]:
    """Registra en esta corrida un artículo ya cribado antes sin volver a
    puntuarlo (S-06 e). Si ya está en esta corrida, se le anota la consulta y
    se le suman los `fragmentos_nuevos` (el texto completo que antes no se
    descargó), que reabren la fuente para extraer solo lo nuevo. Si viene de
    otra corrida se copian sus fragmentos con su marca de leído, la cohorte,
    el método, el riesgo de sesgo y el porqué de amplitud ya evaluados, y las
    afirmaciones que aquella corrida extrajo y verificó de ella, con el id de
    la fuente nueva, la cita reescrita a la referencia de esta corrida y el
    mismo veredicto (no vuelven a la cola de verificación): sin ellas, la
    extracción saltaba la fuente y las hipótesis y el Killer de esta corrida no
    veían ni una afirmación de un artículo registrado como relevante y leído.
    Una fuente marcada como extraída sin ninguna afirmación guardada que copiar
    se vuelve a extraer. La marca de retracción se copia salvo que llegue una
    `comprobacion` (marca, detalle, cuándo) hecha ahora. El modo se conserva:
    una fuente de foco reutilizada por una consulta de amplitud sigue siendo
    de foco. Devuelve (id de la fuente, si tiene texto completo, afirmaciones
    copiadas)."""
    modo_prev = fuente_prev.get("modo") or "foco"
    a["_modo"] = "foco" if "foco" in (modo, modo_prev) else "amplitud"
    if fuente_prev.get("porque") and not a.get("_porque"):
        a["_porque"] = fuente_prev["porque"]
    tipo = fuente_prev.get("tipo") or ("preprint" if a.get("preprint") else "articulo")
    if comprobacion is not None:
        marca, detalle, comprobada = comprobacion
    else:
        marca = fuente_prev.get("retraccion")
        detalle = fuente_prev.get("_marcaDetalle") or ("Marca de retracción comprobada en otra corrida" if marca else "Sin comprobar de nuevo en Crossref: se reutiliza la comprobación anterior")
        comprobada = fuente_prev.get("retraccionComprobadaEn")
    nuevos = [dict(fr, extraido=False) for fr in (fragmentos_nuevos or []) if isinstance(fr, dict) and fr.get("localizador") and fr.get("texto")]
    if actual:
        fid = _registrar_fuente(ctx, a, tipo, nuevos, relevancia, marca, detalle, comprobada, consulta)
        if comprobacion is not None:
            _actualizar_fuente(ctx, fid, {"retraccion": marca, "_marcaDetalle": detalle, "retraccionComprobadaEn": comprobada})
        return fid, bool(nuevos) or _tiene_texto_completo(fuente_prev), 0
    ya = bool(fuente_prev.get("extraida"))
    copia: list[dict[str, Any]] = []
    for fr in fuente_prev.get("fragmentos", []) or []:
        if isinstance(fr, dict) and fr.get("localizador") and fr.get("texto"):
            c_ = dict(fr)
            c_["extraido"] = bool(fr.get("extraido", ya))
            copia.append(c_)
    corrida_prev = _corrida_de_fuente(ctx, str(fuente_prev.get("id") or ""))
    afs_prev = [x for x in ((corrida_prev or {}).get("_afirmaciones") or []) if isinstance(x, dict) and x.get("fuenteId") == fuente_prev.get("id")]
    if ya and not afs_prev:
        # Leída entonces, pero sin nada guardado que traer: se vuelve a extraer aquí.
        ya = False
        for fr in copia:
            fr["extraido"] = False
    if marca == "retractado":
        afs_prev = []  # un artículo retractado no presta respaldo a esta corrida
    vistos = {fr["localizador"] for fr in copia}
    todos = copia + [fr for fr in nuevos if fr["localizador"] not in vistos]
    ya_extraida = bool(todos) and all(fr.get("extraido") for fr in todos) if todos else ya
    fid = _registrar_fuente(ctx, a, tipo, todos, relevancia, marca, detalle, comprobada, consulta, ya_extraida=ya_extraida, reutilizada_de=numero_prev)
    heredables = {k: copy.deepcopy(fuente_prev[k]) for k in _CAMPOS_REUTILIZABLES if fuente_prev.get(k)}
    ref_prev = str(fuente_prev.get("referencia") or "")
    copiadas = [0]

    def fn(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        f = (c.get("_fuentes") or {}).get(fid)
        if not f:
            return False
        for k, v in heredables.items():
            if not f.get(k):
                f[k] = v
        if not afs_prev:
            return True
        lista = c.setdefault("_afirmaciones", [])
        ya_copiadas = {str((x.get("_reutilizadaDe") or {}).get("afirmacionId")) for x in lista if isinstance(x, dict) and isinstance(x.get("_reutilizadaDe"), dict)}
        for a_prev in afs_prev:
            if str(a_prev.get("id")) in ya_copiadas:
                continue
            nueva = copy.deepcopy(a_prev)
            nueva["id"] = P.nuevo_id("af")
            nueva["fuenteId"] = fid
            loc = str(a_prev.get("localizador") or "")
            if loc:
                nueva["cita"] = f"[{f['referencia']}, {loc}]"
            elif ref_prev and f["referencia"] != ref_prev:
                nueva["cita"] = str(a_prev.get("cita") or "").replace(ref_prev, f["referencia"])
            nueva["iteracion"] = ctx.numero
            nueva["_reutilizadaDe"] = {"corrida": numero_prev, "afirmacionId": a_prev.get("id"), "fuenteId": fuente_prev.get("id")}
            lista.append(nueva)
            copiadas[0] += 1
        c["busqueda"]["usados"] = len({x.get("fuenteId") for x in lista if isinstance(x, dict)})
        return True

    ctx.mutar(fn, "fuente")
    return fid, _tiene_texto_completo({"fragmentos": todos}), copiadas[0]


async def _buscar_en_base(ctx: Ctx, base: str, consulta_texto: str, pista: Pista, guia_pasajes: str, desde_fecha: str | None) -> tuple[list[dict[str, Any]], int]:
    """Una búsqueda en la base elegida, con su acción en la pista. Devuelve
    (artículos traídos, total identificado). Lanza FuenteNoDisponible si la base
    no responde: quien llama lo convierte en "no pude comprobar"."""
    if base == "pubmed":
        ids, total = await pubmed.buscar(consulta_texto, maximo=maximo_por_consulta())
        pista.accion("esearch + efetch", {"base": "PubMed E-utilities", "parametros": f"db=pubmed&term={consulta_texto}&retmax={maximo_por_consulta()}", "resultados": f"{total} PMID, se traen {len(ids)}"})
        return await pubmed.detalles(ids), total
    if base in ("exa", "gris"):
        # Búsqueda semántica: la consulta es una pregunta en lenguaje natural. Los
        # pasajes destacados se guían con las preguntas abiertas, para que el pasaje que
        # vuelve sea el que responde. Exa no da un total: identificados = traídos. "gris"
        # busca sin categoría y acotado a los dominios de reguladores, registros y portales.
        gris = base == "gris"
        articulos, total, coste_exa = await exa.buscar(consulta_texto, maximo=maximo_por_consulta(), desde_fecha=desde_fecha, categoria=None if gris else "publication", dominios=exa.DOMINIOS_GRIS if gris else None, pregunta_pasajes=guia_pasajes or None)
        pista.accion("search (neural)", {"base": "Exa", "parametros": (f"includeDomains={','.join(exa.DOMINIOS_GRIS[:4])}..." if gris else "category=publication") + (f"&startPublishedDate={desde_fecha}" if desde_fecha else "") + f"&numResults={MAX_FUENTES_POR_CONSULTA}&type=auto&highlights.query=preguntas abiertas", "resultados": f"{total} documentos, {coste_exa:.4f} USD"})
        _anotar_coste_exa(ctx, coste_exa)
        if articulos:
            # Orden por afinidad del mejor pasaje con las preguntas, cuando Exa la da.
            articulos.sort(key=lambda a: -(a.get("similitud") or 0.0))
        return articulos, total
    traducir = getattr(europepmc, "traducir_consulta", None)
    enviada = traducir(consulta_texto) if callable(traducir) else consulta_texto
    if enviada != consulta_texto:
        pista.nota(f"Europe PMC ignora el «+» final de un nombre: se envía {enviada}")
    articulos, total = await europepmc.buscar(consulta_texto, maximo=maximo_por_consulta(), solo_preprints=(base == "preprints"))
    pista.accion("REST search", {"base": "Europe PMC", "parametros": f"query={enviada}{' AND SRC:PPR' if base == 'preprints' else ''}&pageSize={maximo_por_consulta()}&resultType=core", "resultados": f"{total} resultados, se traen {len(articulos)}"})
    return articulos, total


def _fundir_articulos(base_lista: list[dict[str, Any]], mas: list[dict[str, Any]]) -> int:
    """Añade a `base_lista` los artículos de `mas` que no comparten ninguna
    clave con los que ya hay. Devuelve cuántos entraron."""
    vistos: set[str] = set()
    for a in base_lista:
        vistos |= claves_de_fuente(a)
    nuevos = 0
    for a in mas:
        cl = claves_de_fuente(a)
        if cl and cl & vistos:
            continue
        vistos |= cl
        base_lista.append(a)
        nuevos += 1
    return nuevos


async def _consulta_literatura(ctx: Ctx, paso: dict[str, Any], consulta: dict[str, Any], preguntas: str) -> dict[str, int]:
    base = consulta["base"]
    nombre_base = NOMBRES_BASE[base]
    modo = "amplitud" if consulta.get("modo") == "amplitud" else "foco"
    minimo = politicas.RELEVANCIA_MINIMA_AMPLITUD if modo == "amplitud" else RELEVANCIA_MINIMA
    titulo_pista = (consulta.get("tema") or consulta["consulta"])[:80]
    pista = ctx.pista(paso["id"], "literatura", (f"Amplitud: {titulo_pista}" if modo == "amplitud" else titulo_pista)[:90], nombre_base)
    # `msBases` es lo que tardan las bases en contestar la consulta y `msFuentes` lo
    # que tarda en traer los documentos uno a uno. Los dos son tiempo de corrida que
    # hasta el 29 de septiembre de 2026 no se medía: de las 4,22 h de la corrida 42,
    # 47 min no tenían ninguna llamada al modelo viva y no se sabía en qué se iban.
    resultado = {"identificados": 0, "cribados": 0, "textoCompleto": 0, "leidos": 0, "msBases": 0, "msFuentes": 0}
    inv = ctx.inv()
    contexto_amplitud = ""
    if modo == "amplitud":
        contexto_amplitud = T.hipotesis_vivas(ctx.e["hipotesis"], ctx.investigacion_id, maximo=6) + "\n" + T.vivero_texto(inv, maximo=5)
    # En amplitud, los pasajes destacados y el orden por similitud se guían con el
    # objetivo y el "por qué" de la consulta, no con la pregunta de foco: se busca lo que
    # podría cambiar algo. Es el mismo criterio que usa el reranker y el cribado.
    criterio_amplitud = f"{inv['objetivo']}\n{consulta.get('tema') or ''}\n{consulta.get('porque') or ''}"
    guia_pasajes = criterio_amplitud[:500] if modo == "amplitud" else preguntas[:500]
    booleana = base in ("pubmed", "europepmc", "preprints")
    try:
        pista.accion(f"Consulta: {consulta['consulta']}")
        if modo == "amplitud" and consulta.get("porque"):
            pista.nota(f"Búsqueda en amplitud. Por qué: {consulta['porque'][:200]}. Los pasajes y el orden se guían con el objetivo y ese porqué, no con la pregunta de foco.")
        if consulta.get("_desviada_de"):
            pista.nota(f"El plan la dirigía a {consulta['_desviada_de']}, que no está disponible (sin clave); va a {nombre_base}")
        if consulta.get("_acotadaDe"):
            pista.nota(f"El plan traía {len(clausulas_and(consulta['_acotadaDe']))} cláusulas AND; se acota a {politicas.MAX_CLAUSULAS_AND} (política de consultas): la original era «{consulta['_acotadaDe'][:200]}»")
        ahora = P.ahora_ms()
        articulos, total = await _buscar_en_base(ctx, base, consulta["consulta"], pista, guia_pasajes, consulta.get("desde_fecha"))
        # Relajación acotada (S-07): una consulta de foco con pocos resultados y tres o más
        # cláusulas AND se relanza una sola vez sin la última cláusula, y queda anotado.
        relajada: str | None = None
        total_relajada: int | None = None
        n_clausulas = len(clausulas_and(consulta["consulta"])) if booleana else 0
        if modo == "foco" and booleana and not consulta.get("_por_nombre") and total < politicas.RESULTADOS_MINIMOS_ANTES_DE_RELAJAR and n_clausulas >= politicas.CLAUSULAS_MINIMAS_PARA_RELAJAR:
            relajada = quitar_ultima_clausula(consulta["consulta"])
        if relajada:
            pista.nota(f"Solo {total} resultados con {n_clausulas} cláusulas AND: se relanza una vez sin la última cláusula: {relajada}")
            try:
                mas, total_relajada = await _buscar_en_base(ctx, base, relajada, pista, guia_pasajes, consulta.get("desde_fecha"))
                nuevos = _fundir_articulos(articulos, mas)
                pista.resultado(f"Consulta relajada: {total_relajada} resultados, {nuevos} candidatos nuevos para cribar")
            except FuenteNoDisponible as ex:
                pista.nota(f"La consulta relajada no llegó a {nombre_base} ({str(ex)[:100]}); se sigue con lo que trajo la original. No es 'sin resultados'.")
                total_relajada = None
        resultado["identificados"] = max(total, total_relajada or 0)
        # Cuánto tardó en traer esto. ROSA2018 cronometra cada llamada al modelo al
        # milisegundo y no cronometraba NADA de la literatura, que es la otra mitad
        # de una corrida: de las 4,22 h de la corrida 42, 47 min no tenían ninguna
        # llamada al modelo viva y no había forma de saber en qué se iban.
        resultado["msBases"] += max(0, P.ahora_ms() - ahora)
        ms_consulta = max(0, P.ahora_ms() - ahora)

        def anotar(e: dict[str, Any]) -> bool:
            c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
            registro = {"base": nombre_base, "consulta": consulta["consulta"], "fecha": ahora, "ms": ms_consulta, "resultados": total, "iteracion": ctx.numero, "tema": consulta["tema"], "modo": modo, "porque": (consulta.get("porque") or "")[:300], "desdeFecha": consulta.get("desde_fecha")}
            if consulta.get("_acotadaDe"):
                registro["acotadaDe"] = consulta["_acotadaDe"][:300]
            if relajada:
                registro["relajadaA"] = relajada
                registro["resultadosRelajada"] = total_relajada  # None si la relajada no llegó a la base
            c["busqueda"]["consultas"].append(registro)
            # La relajada solo cuenta como hecha si la base respondió: si no, se podrá repetir.
            if relajada and total_relajada is not None:
                c["busqueda"]["consultas"].append({"base": nombre_base, "consulta": relajada, "fecha": ahora, "resultados": total_relajada, "iteracion": ctx.numero, "tema": consulta["tema"], "modo": modo, "porque": "", "desdeFecha": consulta.get("desde_fecha"), "relajadaDe": consulta["consulta"]})
            c["busqueda"]["identificados"] += resultado["identificados"]
            hechas = c.setdefault("_consultasHechas", [])
            hechas.append(consulta["consulta"])
            if relajada and total_relajada is not None:
                hechas.append(relajada)
            return True

        ctx.mutar(anotar, "consulta")
        pista.resultado(f"{total} resultados en {nombre_base}; {len(articulos)} para cribar")
        if not articulos:
            pista.cerrar(f"{total} resultados, ninguno traído", "hecha")
            return resultado

        # Corte previo por pertinencia con el reranker del gateway: el modelo
        # solo puntúa a los mejores; los demás quedan excluidos con su cifra.
        # En amplitud el reranker ordena contra el objetivo y el "por qué" de la consulta,
        # no contra la pregunta: lo que se busca es lo que podría cambiar algo.
        pregunta_reranker = criterio_amplitud if modo == "amplitud" else f"{preguntas}\n{consulta['tema']}"
        # Tres memorias antes de gastar (S-06 e, S-07): (1) lo ya registrado como fuente
        # en esta investigación no vuelve al reranker ni al modelo, se reutiliza su
        # relevancia; (2) lo excluido con claridad por un modelo con este mismo criterio
        # tampoco, se reutiliza el motivo ("do not re-mine"); (3) un artículo cuyo título
        # nombra un fármaco, ensayo o cohorte del objetivo va siempre al modelo, aunque
        # esté en la caché de exclusiones o el reranker lo cortara: es la evidencia
        # directa que la persona pidió por nombre.
        nombres_objetivo = T.nombres_propios(f"{inv['objetivo']} {preguntas}")
        criterio = hash_criterio(preguntas if modo == "foco" else inv["objetivo"])
        ya_excluidos = _excluidos_previos(ctx, modo, minimo - 2, criterio)
        conocidas = _indice_fuentes_investigacion(ctx)
        repetidos: list[tuple[dict[str, Any], dict[str, Any]]] = []
        frescos: list[dict[str, Any]] = []
        forzados: list[dict[str, Any]] = []
        reutilizadas: dict[int, tuple[dict[str, Any], int | None, bool]] = {}
        rescatados: list[str] = []
        no_rescatados: list[str] = []
        forzados_fuera_de_tope = 0
        for a in articulos:
            if not a.get("titulo"):
                continue
            claves = sorted(_claves_articulo(a))
            conocida = next((conocidas[k] for k in claves if k in conocidas), None)
            # Se reutiliza solo si ya pasó el listón de este modo: una fuente de amplitud
            # con 4 que trae una consulta de foco (listón 5) se vuelve a puntuar contra la
            # pregunta, y si llega a 5 deja de contar como hallazgo de amplitud.
            if conocida is not None and int(conocida[0].get("relevancia") or 0) >= minimo:
                reutilizadas[id(a)] = conocida
                continue
            nombre = titulo_nombra(a.get("titulo", ""), nombres_objetivo)
            ex_prev = next((ya_excluidos[k] for k in claves if k in ya_excluidos), None)
            if ex_prev is not None and nombre and ex_prev.get("criterio") == criterio:
                # Un modelo ya lo juzgó con este mismo criterio estable (objetivo y pregunta
                # de la corrida): el rescate por nombre vale una vez por criterio; repetirlo
                # en cada iteración anularía la caché para siempre. Con otra pregunta de
                # corrida la huella cambia y vuelve al modelo.
                repetidos.append((a, ex_prev))
                no_rescatados.append(f"{a.get('referencia', '')} ({nombre})")
                continue
            if ex_prev is not None and not nombre:
                repetidos.append((a, ex_prev))
                continue
            if ex_prev is not None and nombre:
                rescatados.append(f"{a.get('referencia', '')} ({nombre})")
            if nombre and len(forzados) < politicas.MAX_FORZADOS_POR_NOMBRE:
                forzados.append(a)
            else:
                if nombre:
                    forzados_fuera_de_tope += 1
                frescos.append(a)
        if repetidos:
            pista.nota(f"{len(repetidos)} artículos ya excluidos por un modelo en esta investigación no se vuelven a cribar; se reutiliza su motivo")
        if rescatados:
            pista.nota("Vuelven al modelo aunque estaban en la caché de exclusiones, porque su título nombra algo del objetivo y la exclusión se hizo sin huella de este criterio: " + "; ".join(rescatados)[:300])
        if no_rescatados:
            pista.nota("Nombran algo del objetivo pero un modelo ya los excluyó con este mismo objetivo y pregunta de corrida; no se vuelven a cribar hasta que cambie la pregunta: " + "; ".join(no_rescatados)[:300])
        if reutilizadas:
            pista.nota(f"{len(reutilizadas)} artículos ya cribados como fuente en esta investigación no vuelven al reranker ni al modelo; se reutiliza su relevancia y su texto")
        al_modelo, fuera = await cortar_con_reranker(pregunta_reranker, frescos, pista)
        if forzados:
            pista.nota(f"{len(forzados)} artículos cuyo título nombra un fármaco, ensayo o cohorte del objetivo pasan al modelo sin corte del reranker" + (f" (tope {politicas.MAX_FORZADOS_POR_NOMBRE} por consulta: otros {forzados_fuera_de_tope} van por el reranker como los demás)" if forzados_fuera_de_tope else "") + ": " + "; ".join(str(a.get("referencia", ""))[:40] for a in forzados[:6]))
            al_modelo = forzados + al_modelo
        ids_modelo = {id(a) for a in al_modelo}
        # Cribado por relevancia (Sonnet 5), como el RCS de PaperQA. En amplitud, con
        # otra pregunta (qué podría cambiar) y el listón un punto más bajo.
        puntuados: list[tuple[int, dict[str, Any], str]] = []
        for a, ex_prev in repetidos:
            puntuados.append((int(ex_prev.get("relevancia") or 0), a, f"ya excluido en la corrida {ex_prev.get('corrida')} (iteración {ex_prev.get('iteracion')}): {(ex_prev.get('motivo') or '')[:160]}"))
        for a, s_ in fuera:
            puntuados.append((min(minimo - 1, int(round(s_ * 10))), a, f"fuera del corte del reranker (pertinencia {s_:.2f}); no se gastó una llamada al modelo"))
        for a in articulos:
            con = reutilizadas.get(id(a))
            if con is None:
                continue
            fuente_prev, numero_prev, actual = con
            rel = int(fuente_prev.get("relevancia") or 0)
            donde = "esta corrida" if actual else f"la corrida {numero_prev}"
            puntuados.append((rel, a, f"ya cribada en {donde} (relevancia {rel}); se reutiliza sin volver a puntuar ni a descargar"))
        sem = asyncio.Semaphore(4)

        async def puntuar(a: dict[str, Any]) -> None:
            async with sem:
                try:
                    if modo == "amplitud":
                        pred = await ctx.llamar("volumen", ctx.programas.relevancia_amplitud, objetivo=inv["objetivo"], hipotesis_y_vivero=contexto_amplitud, titulo=a.get("titulo", ""), resumen=K.como_dato((a.get("resumen") or "")[:3000]))
                        a["_porque"] = str(pred.podria_cambiar or "")[:200]
                        puntuados.append((int(pred.puntuacion), a, f"{pred.motivo} Podría cambiar: {pred.podria_cambiar}"))
                    else:
                        pred = await ctx.llamar("volumen", ctx.programas.relevancia, preguntas_abiertas=preguntas, titulo=a.get("titulo", ""), resumen=K.como_dato((a.get("resumen") or "")[:3000]))
                        puntuados.append((int(pred.puntuacion), a, pred.motivo))
                except PresupuestoAgotado:
                    raise
                except VIG.ModeloSinRespuesta:
                    raise
                except Exception as ex:  # noqa: BLE001
                    # Un fallo del modelo no vuelve irrelevante al articulo: se conserva con nota.
                    puntuados.append((minimo, a, f"sin puntuar (el modelo no respondió: {str(ex)[:60]}); se conserva para no perderlo"))

        await _en_paralelo(*(puntuar(a) for a in al_modelo))
        puntuados.sort(key=lambda x: -x[0])
        relevantes = [x for x in puntuados if x[0] >= minimo]
        descartados = [x for x in puntuados if x[0] < minimo]
        resultado["cribados"] = len(relevantes)
        pista.resultado(f"Cribado{' en amplitud' if modo == 'amplitud' else ''}: {len(relevantes)} de {len(puntuados)} relevantes (puntuación >= {minimo}); descartados: " + ", ".join(f"{a['referencia']} ({p})" for p, a, _ in descartados)[:300])
        demasiado_amplia = total > politicas.RESULTADOS_DEMASIADO_AMPLIA and not relevantes

        def anotar_cribado(e: dict[str, Any]) -> bool:
            # Cada excluido con su motivo: es el item 16b de PRISMA 2020 y la caja de
            # exclusiones de la herramienta automatica del diagrama.
            c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
            b = c["busqueda"]
            b["traidos"] = int(b.get("traidos") or 0) + len(puntuados)
            # El rendimiento de la consulta queda en su registro: cuántos relevantes trajo.
            # La consulta relajada comparte el cribado con la original y lleva la misma cifra.
            pendientes_registro = {consulta["consulta"]} | ({relajada} if relajada else set())
            for q_ in reversed(b["consultas"]):
                if q_.get("consulta") in pendientes_registro and q_.get("iteracion") == ctx.numero:
                    q_["relevantes"] = len(relevantes)
                    if demasiado_amplia:
                        q_["demasiadoAmplia"] = True
                    pendientes_registro.discard(q_.get("consulta"))
                    if not pendientes_registro:
                        break
            ex = b.setdefault("excluidos", [])
            for p_, a_, motivo_ in descartados:
                puntuado = id(a_) in ids_modelo and not str(motivo_ or "").startswith("sin puntuar")
                ex.append({"referencia": a_.get("referencia", ""), "titulo": (a_.get("titulo") or "")[:160], "doi": a_.get("doi"), "pmid": a_.get("pmid"), "relevancia": int(p_), "modo": modo, "motivo": (motivo_ or "")[:240], "iteracion": ctx.numero, "consulta": consulta["consulta"][:160], "base": nombre_base, "puntuadoPorModelo": puntuado, "criterio": criterio})
            if len(ex) > 600:
                del ex[: len(ex) - 600]
            return True

        ctx.mutar(anotar_cribado, "cribado")
        if demasiado_amplia:
            pista.nota(f"Consulta demasiado amplia: {total} resultados y ninguno relevante entre los {len(puntuados)} cribados. Queda marcada para que el plan la acote (nombre exacto en el título y el resumen, o un término más específico).")

        numero_corrida = int(ctx.corrida().get("numero") or 0)
        # El bucle de abajo es EN SERIE y cada vuelta hace dos llamadas de red
        # (Crossref para la retracción, y el resumen o el PDF de la fuente). Se
        # cronometra aparte de la consulta para poder decir cuánto de una corrida
        # se va en traer documentos, que hasta ahora no se medía.
        t_fuentes = P.ahora_ms()
        for i, (puntuacion, a, motivo) in enumerate(relevantes):
            if pista.detenida():
                break
            con_texto = i < 4 and puntuacion >= 7
            con = reutilizadas.get(id(a))
            if con is not None:
                fuente_prev, numero_prev, actual = con
                donde = "esta corrida" if actual else f"la corrida {numero_prev}"
                # Lo que aquella vez no se hizo se hace ahora (S-06 e, segunda pasada): el
                # texto completo si esta corrida lo descargaría y entonces solo se guardó el
                # resumen (un intento por iteración y fuente), y Crossref si la comprobación
                # de entonces no llegó o caducó. Lo demás se copia sin gastar.
                nuevos_frags: list[dict[str, Any]] = []
                intento = fuente_prev.get("_sinTextoCompletoEn")
                intentado_aqui = isinstance(intento, dict) and intento.get("corrida") == numero_corrida and intento.get("iteracion") == ctx.numero
                intentar_texto = con_texto and not _tiene_texto_completo(fuente_prev) and not intentado_aqui
                if intentar_texto:
                    pista.nota(f"{a['referencia']}: reutilizada de {donde}, que solo guardó el resumen; se completa con el texto completo que entonces no se descargó")
                    nuevos_frags = [fr for fr in await _fragmentos_de(ctx, a, pista, True) if isinstance(fr, dict) and fr.get("localizador") != "resumen"]
                    if not nuevos_frags:
                        pista.nota(f"{a['referencia']}: tampoco ahora hay texto completo accesible; se sigue con el resumen y no se reintenta en esta iteración")
                comprobacion = None
                # Una fuente de esta misma corrida cuya comprobación falló se reintenta como
                # mucho una vez por iteración (no en cada consulta que la vuelva a traer).
                otra_iteracion = not actual or int(fuente_prev.get("iteracion") or 0) != ctx.numero
                if a.get("doi") and otra_iteracion and comprobacion_retraccion_caducada(fuente_prev, ahora):
                    comprobacion = await _comprobar_retraccion(a, pista)
                    pista.nota(f"{a['referencia']}: la comprobación de retracción de {donde} " + ("no llegó" if fuente_prev.get("retraccionComprobadaEn") is None else f"tiene más de {politicas.DIAS_VIGENCIA_COMPROBACION_RETRACCION} días") + "; se repite en Crossref: " + (comprobacion[1] or "")[:120])
                fid, con_texto_prev, copiadas = _reutilizar_fuente(ctx, a, fuente_prev, numero_prev, actual, puntuacion, consulta["consulta"], modo, fragmentos_nuevos=nuevos_frags, comprobacion=comprobacion)
                if intentar_texto and not nuevos_frags:
                    _actualizar_fuente(ctx, fid, {"_sinTextoCompletoEn": {"corrida": numero_corrida, "iteracion": ctx.numero}})
                if con_texto_prev:
                    resultado["textoCompleto"] += 1
                resultado["leidos"] += 1
                extra = ""
                if copiadas:
                    extra = f"; {copiadas} afirmaciones ya extraídas y verificadas en la corrida {numero_prev} pasan a esta corrida con su veredicto"
                elif not actual and fuente_prev.get("extraida") and not nuevos_frags:
                    extra = f"; la corrida {numero_prev} la leyó pero no guardó ninguna afirmación suya: se vuelve a extraer"
                pista.resultado(f"{a['referencia']} (relevancia {puntuacion}): {motivo[:100]}{extra}")
                continue
            marca, detalle, comprobada = await _comprobar_retraccion(a, pista)
            fragmentos = await _fragmentos_de(ctx, a, pista, con_texto)
            if any(fr["localizador"] != "resumen" for fr in fragmentos):
                resultado["textoCompleto"] += 1
            tipo = "preprint" if a.get("preprint") or base == "preprints" else "articulo"
            a["_modo"] = modo
            _registrar_fuente(ctx, a, tipo, fragmentos, puntuacion, marca, detalle, comprobada, consulta["consulta"])
            resultado["leidos"] += 1
            pista.resultado(f"{a['referencia']} (relevancia {puntuacion}): {motivo[:100]}")

        resultado["msFuentes"] += max(0, P.ahora_ms() - t_fuentes)
        pista.cerrar(f"{total} resultados, {len(relevantes)} relevantes, {resultado['textoCompleto']} con texto completo, {(P.ahora_ms() - ahora) / 1000:.0f} s en total")
    except PresupuestoAgotado:
        pista.cerrar("Presupuesto agotado: la pista se retoma al ampliarlo", "detenida")
        raise
    except FuenteNoDisponible as ex:
        pista.fallar(f"{nombre_base} no respondió: {str(ex)[:160]}. No es 'sin resultados': la consulta no llegó.")
        _contar_fallo_fuente(ctx, nombre_base, str(ex))
    return resultado


def fecha_iso_de_ms(ms: Any) -> str | None:
    """AAAA-MM-DD a partir de milisegundos desde la época; None si no hay."""
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).date().isoformat() if ms else None
    except (TypeError, ValueError, OSError):
        return None


def estado_por_puntuacion(mejor: int, alto: str, parcial: str, ninguno: str) -> str:
    """La misma regla que el precedente en la literatura: 8 o más es "ya
    existe", de 5 a 7 es parcial, menos es nada claro."""
    return alto if mejor >= 8 else parcial if mejor >= 5 else ninguno


async def _novedad_exa_dominios(ctx: Ctx, h: dict[str, Any], pista: Pista, novedad: dict[str, Any], clave: str, dominios: list[str], pregunta: str, estados: tuple[str, str, str], etiqueta: str) -> None:
    """Una comprobación de novedad sobre un conjunto de dominios de Exa
    (patentes, financiación): búsqueda semántica del enunciado, acotada a lo
    publicado antes de que ROSA2018 propusiera la hipótesis, y cribado de los tres
    mejores con el programa de relevancia. Sin Exa queda "no comprobado" con
    el motivo, nunca "no hay"."""
    if not exa.disponible():
        novedad[clave] = {"estado": "no_comprobado", "detalle": f"No comprobado: requiere Exa (ROSA_EXA_KEY) para buscar en {etiqueta}", "url": None}
        return
    try:
        docs, n, coste = await exa.buscar(h["enunciado"][:600], maximo=5, categoria=None, dominios=dominios, pregunta_pasajes=h["enunciado"][:500], hasta_fecha=fecha_iso_de_ms(h.get("creadaEn")))
        pista.accion(f"Exa ({etiqueta}): enunciado completo", {"base": "Exa", "parametros": f"includeDomains={','.join(dominios[:3])}...&numResults=5&endPublishedDate=creación de la hipótesis", "resultados": f"{n} documentos, {coste:.4f} USD"})
        _anotar_coste_exa(ctx, coste)
        candidatos = [x for x in docs if x.get("titulo")][:3]
        if not candidatos:
            # Cero documentos no es "no hay": es que no se pudo comparar con nada (S-02).
            novedad[clave] = {"estado": "no_comprobado", "detalle": f"No comprobado: Exa no devolvió documentos con título en {etiqueta} anteriores a la hipótesis ({n} resultados); no se puede afirmar ausencia", "url": None}
            return
        mejor, mejor_ref, mejor_url = 0, "", None
        evaluadas, fallos = 0, 0
        for d in candidatos:
            try:
                p = await ctx.llamar("volumen", ctx.programas.relevancia, preguntas_abiertas=f"{pregunta}: {h['enunciado']}", titulo=d["titulo"], resumen=(d.get("resumen") or "")[:2500])
                evaluadas += 1
                if int(p.puntuacion) > mejor:
                    mejor, mejor_ref, mejor_url = int(p.puntuacion), f"{d['titulo'][:90]} ({d.get('fecha') or 'sin fecha'})", d.get("url")
            except PresupuestoAgotado:
                raise
            except VIG.ModeloSinRespuesta:
                raise
            except Exception as ex:  # noqa: BLE001
                fallos += 1
                pista.nota(f"Relevancia ({etiqueta}) falló para «{str(d.get('titulo', ''))[:60]}»: {type(ex).__name__}: {str(ex)[:80]}")
        if evaluadas == 0:
            novedad[clave] = {"estado": "no_comprobado", "detalle": f"No comprobado: el modelo de relevancia no respondió en {fallos} de {len(candidatos)} documentos de {etiqueta}; no se puede afirmar ausencia", "url": None}
            return
        estado = estado_por_puntuacion(mejor, *estados)
        if estado == estados[0]:
            detalle = f"Ya existe algo muy cercano en {etiqueta}: {mejor_ref} (puntuación {mejor}/10)"
        elif estado == estados[1]:
            detalle = f"Relación parcial en {etiqueta}: {mejor_ref} (puntuación {mejor}/10)"
        else:
            detalle = f"Nada claro en {etiqueta}: {evaluadas} documentos evaluados de {n} anteriores a la hipótesis" + (f"; {fallos} sin puntuar por fallo del modelo" if fallos else "")
        novedad[clave] = {"estado": estado, "detalle": detalle, "url": mejor_url if estado != estados[2] else None}
    except FuenteNoDisponible as ex:
        novedad[clave] = {"estado": "no_comprobado", "detalle": f"No comprobado: Exa no respondió al buscar en {etiqueta} ({str(ex)[:60]})", "url": None}


def _anotar_coste_exa(ctx: Ctx, usd: float) -> None:
    """El gasto en Exa se suma al gasto de la corrida (`gasto.exaUsd`), junto al
    de los modelos, para que el coste por decisión lo incluya."""
    if not usd:
        return

    def fn(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        c["gasto"]["exaUsd"] = round(float(c["gasto"].get("exaUsd") or 0.0) + float(usd), 6)
        return True

    ctx.mutar(fn, "gasto_exa")


def _contar_fallo_fuente(ctx: Ctx, base: str, error: str) -> None:
    """Un fallo más de esta base en esta corrida. A los tres, incidencia.

    El contador es acumulativo y el texto lo dice así. Antes decía "lleva 3
    fallos SEGUIDOS" y nada lo bajaba nunca (28 de septiembre de 2026): PubMed
    fallaba tres veces en la iteración 1, funcionaba perfectamente en las cinco
    siguientes, y la incidencia seguía diciendo "3 fallos seguidos" mientras el
    traspaso la listaba entre las bases que no respondieron y la cola de tareas
    proponía buscar en otra. Se elige contar acumulado y decirlo, que es lo que
    ya esperan `lecciones.py` y `tareas.py` ("en esta corrida")."""

    def fn(e: dict[str, Any]) -> bool:
        c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
        fallos = c.setdefault("_fallosFuente", {})
        fallos[base] = fallos.get(base, 0) + 1
        return True

    ctx.mutar(fn, "fallo_fuente")
    cuantos = ctx.corrida().get("_fallosFuente", {}).get(base, 0)
    if cuantos >= 3:
        ctx.incidencia("fuente_sin_respuesta", f"{base} lleva {cuantos} fallos en esta corrida", error[:400], base, "Comprobar la conexión o esperar; ROSA2018 sigue con las demás fuentes.")


async def paso_literatura(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    e = ctx.e
    preguntas = _criterio(ctx, inv)
    # Consultas ya hechas en TODAS las corridas de la investigación, con su rendimiento.
    previas = T.consultas_hechas(e, ctx.investigacion_id)
    lecciones = await LEC.para(ctx.almacen, ctx.investigacion_id, ("consultas", "fuentes"), preguntas[:1500])
    nombres = T.nombres_propios(f"{inv['objetivo']} {preguntas}")
    pred = await ctx.llamar("cerebro", ctx.programas.consultas, objetivo=inv["objetivo"], preguntas_abiertas=preguntas, hipotesis_vivas=T.hipotesis_vivas(e["hipotesis"], ctx.investigacion_id) + "\n" + T.vivero_texto(inv), consultas_previas=T.consultas_previas_texto(e, ctx.investigacion_id), lecciones=lecciones, indicaciones_humanas=T.indicaciones_humanas(ctx.iteracion()) + ("\n" + paso["detalle"] if paso.get("detalle") else ""), bases_disponibles=", ".join(bases_disponibles()), nombres_propios=", ".join(nombres) or "Ninguno")
    consultas = [base_efectiva(c.model_dump()) for c in pred.consultas][: politicas.MAX_CONSULTAS_FOCO]
    # Tope de tres cláusulas AND (política): la consulta se acota por regla aunque el
    # modelo escriba cinco, y la pista lo dice (S-07).
    for q in consultas:
        if q.get("base") in ("pubmed", "europepmc", "preprints"):
            acotada = limitar_clausulas(q["consulta"])
            if acotada != q["consulta"]:
                q["_acotadaDe"] = q["consulta"]
                q["consulta"] = acotada
    avisos_nombre: list[str] = []
    por_nombre = consultas_por_nombre(nombres, consultas, previas, registro=T.consultas_de_la_investigacion(e, ctx.investigacion_id), corrida_actual=ctx.corrida().get("numero"), explicaciones=avisos_nombre)
    consultas += por_nombre
    if avisos_nombre:
        # La decisión de no insistir queda escrita donde se lee la corrida, no solo en el código.
        ctx.pista(paso["id"], "literatura", "Red de seguridad por nombre: lo que ya no se repite", "regla").cerrar("; ".join(avisos_nombre)[:900])
    for q in consultas:
        q["modo"] = "foco"
    # Amplitud: una parte de las consultas explora fuera de la pregunta (temas
    # adyacentes, novedad del campo, sorpresa), según el ajuste de la investigación.
    amplitud = amplitud_de(inv)
    n_amplitud = cuantas_de_amplitud(len(consultas), amplitud)
    if n_amplitud:
        pista_amp = ctx.pista(paso["id"], "literatura", f"Búsqueda en amplitud ({amplitud}): qué hay alrededor del objetivo", "GPT-6 Astra")
        try:
            de_amplitud = await _consultas_amplitud(ctx, inv, n_amplitud, previas + [q["consulta"] for q in consultas], pista_amp, lecciones)
        except PresupuestoAgotado:
            pista_amp.cerrar("Presupuesto agotado antes de escribir las consultas de amplitud; el paso se retoma al ampliarlo", "detenida")
            raise
        pista_amp.cerrar(f"{len(de_amplitud)} consultas de amplitud: " + "; ".join(q["tema"][:40] for q in de_amplitud) if de_amplitud else "Sin consultas de amplitud en este paso")
        consultas += de_amplitud
    if not consultas:
        return "El modelo no propuso consultas"
    crudos = await _en_paralelo(*(_consulta_literatura(ctx, paso, c, preguntas) for c in consultas), return_exceptions=True)
    for c, r in zip(consultas, crudos):
        if isinstance(r, (PresupuestoAgotado, VIG.ModeloSinRespuesta)):
            raise r
        if isinstance(r, BaseException):
            # Una consulta que reventó no tumba las otras cuatro.
            traceback.print_exc()
            ctx.pista(paso["id"], "literatura", f"Consulta fallida: {c.get('consulta', '')[:50]}", "").fallar(f"{type(r).__name__}: {str(r)[:160]}")
    pares = [(q, r) for q, r in zip(consultas, crudos) if isinstance(r, dict)]
    resultados = [r for _, r in pares]
    total = {k: sum(r[k] for r in resultados) for k in resultados[0]} if resultados else {}
    leidos_por_tema: dict[str, int] = {}
    for q, r in pares:
        leidos_por_tema[q["tema"][:60]] = leidos_por_tema.get(q["tema"][:60], 0) + r["leidos"]

    def actualizar(e2: dict[str, Any]) -> bool:
        c = next(x for x in e2["corridas"] if x["id"] == ctx.corrida_id)
        c["busqueda"]["cribados"] += total.get("cribados", 0)
        c["busqueda"]["textoCompleto"] += total.get("textoCompleto", 0)
        c["busqueda"]["msBases"] = int(c["busqueda"].get("msBases") or 0) + total.get("msBases", 0)
        c["busqueda"]["msFuentes"] = int(c["busqueda"].get("msFuentes") or 0) + total.get("msFuentes", 0)
        c["gasto"]["articulosLeidos"] += total.get("leidos", 0)
        for q in consultas:
            if q.get("modo") == "amplitud":
                continue  # la cobertura mide cuánto se ha leído de los temas de la pregunta, no de la exploración
            tema = q["tema"][:60]
            cob = next((x for x in c["coberturas"] if x["tema"] == tema), None)
            if cob is None:
                cob = {"tema": tema, "leidos": 0, "fraccion": 0.0, "tau": TAU_COBERTURA}
                c["coberturas"].append(cob)
            cob["leidos"] += leidos_por_tema.get(tema, 0)
            cob["fraccion"] = round(1 - math.exp(-cob["leidos"] / cob["tau"]), 3)
        return True

    ctx.mutar(actualizar, "busqueda")
    # Predicción escrita antes de buscar: si el paso esperaba algo y no trajo ninguna
    # fuente relevante, la ausencia se interpreta con la regla escrita antes, no después.
    if total.get("cribados", 0) == 0 and (paso.get("espera") or paso.get("siNoAparece")):
        texto_lec = f"El paso «{paso['titulo'][:70]}» esperaba «{(paso.get('espera') or '')[:120]}» y no trajo ninguna fuente relevante; lo escrito antes: {(paso.get('siNoAparece') or 'sin conclusión declarada')[:160]}"
        ahora_l = P.ahora_ms()
        ctx.mutar(lambda e2, t=texto_lec, a=ahora_l: LEC.registrar(e2, [LEC.nueva(ctx.investigacion_id, "consultas", t, f"paso:{paso.get('id')}", ctx.corrida_id, ctx.numero, a)]) >= 0, "leccion")
    n_amp = sum(1 for q in consultas if q.get("modo") == "amplitud")
    return f"{len(consultas)} consultas ({len(consultas) - n_amp} de foco, {n_amp} de amplitud), {total.get('identificados', 0)} identificados, {total.get('cribados', 0)} relevantes, {total.get('textoCompleto', 0)} con texto completo"


# ---------------------------------------------------------------------------
# Ensayos clinicos
# ---------------------------------------------------------------------------


async def paso_ensayos(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    terminos = T.terminos_registro(inv["objetivo"], _pregunta_de(ctx), paso.get("detalle", ""), maximo=3)
    pista = ctx.pista(paso["id"], "ensayos", "Ensayos registrados sobre " + (", ".join(terminos) or "el objetivo"), "ClinicalTrials.gov v2")
    try:
        # Nombres propios y siglas unidos con OR: ClinicalTrials.gov está en inglés y su
        # sintaxis (Essie) trata el espacio como AND, así que "A B C" no devuelve nada.
        termino = " OR ".join(terminos)
        pista.accion("GET /api/v2/studies", {"base": "ClinicalTrials.gov v2", "parametros": f"query.cond=Alzheimer Disease&query.term={termino}&pageSize=25&countTotal=true", "resultados": "..."})
        estudios, total = await clinicaltrials.buscar("Alzheimer Disease", termino=termino, maximo=25)
        pista.resultado(f"{total} estudios; se registran {len(estudios)}")
        ahora = P.ahora_ms()
        for s in estudios:
            texto = f"{s['titulo']}. Estado: {s['estado']}. Fases: {', '.join(s['fases'])}. Intervenciones: {', '.join(x for x in s['intervenciones'] if x)}. Desenlaces primarios: {'; '.join(x for x in s['desenlaces'] if x)}. Inicio: {s['inicio']}. Patrocinador: {s['patrocinador']}."
            datos = {"referencia": f"{s['nct']}", "titulo": s["titulo"], "nct": s["nct"], "anio": int(s["inicio"][:4]) if s.get("inicio") and s["inicio"][:4].isdigit() else None, "tipos": ["registro"]}
            _registrar_fuente(ctx, datos, "ensayo", [{"localizador": "resumen", "texto": texto, "encabezado": s["titulo"]}], 6, None, "Registro de ensayo; no aplica retractación", ahora, f"cond=Alzheimer Disease term={termino}")

        def anotar(e: dict[str, Any]) -> bool:
            c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
            c["busqueda"]["consultas"].append({"base": "ClinicalTrials.gov v2", "consulta": f"cond=Alzheimer Disease term={termino}", "fecha": ahora, "resultados": total, "iteracion": ctx.numero, "tema": "Ensayos registrados"})
            c["busqueda"]["identificados"] += total
            return True

        ctx.mutar(anotar, "consulta")
        pista.cerrar(f"{total} estudios, {len(estudios)} registrados como fuentes")
        return f"{total} ensayos encontrados, {len(estudios)} registrados"
    except FuenteNoDisponible as ex:
        pista.fallar(f"ClinicalTrials.gov no respondió: {str(ex)[:160]}. No es 'sin ensayos': la consulta no llegó.")
        _contar_fallo_fuente(ctx, "ClinicalTrials.gov v2", str(ex))
        return "ClinicalTrials.gov no respondió"


# ---------------------------------------------------------------------------
# Extraccion
# ---------------------------------------------------------------------------


# Secciones "de fondo": lo que un artículo dice en su introducción, antecedentes o
# discusión resume trabajo ajeno o interpreta; no es un resultado propio de su cohorte.
# La certeza (rosa/certeza.py) lo pesa menos y no le da cohorte (M-10).
SECCIONES_DE_FONDO = re.compile(r"^\s*(?:secci[oó]n\s+)?(?:\d+(?:\.\d+)*[.)]?\s*)?(introduction|background|discussion|introducci[oó]n|antecedentes|discusi[oó]n)\b", re.IGNORECASE)


def es_de_fondo(localizador: str | None, encabezado: str | None = None) -> bool:
    """True si el fragmento viene de una sección de fondo (Introduction,
    Background, Discussion o sus equivalentes en castellano), mirando el
    localizador ("sección Introduction") y, solo cuando el localizador es una
    sección, el encabezado (que ahí es el nombre completo de la sección). La
    sección tiene que empezar por esa palabra (se admite un numeral delante:
    "1. Introduction"); "Results and discussion" es una sección de resultados.
    Una página de PDF, el resumen o un texto web no lo son nunca: en esos
    fragmentos el encabezado es el título del artículo, y un artículo titulado
    "Background parenchymal..." o "Discussion of..." no es de fondo."""
    if not isinstance(localizador, str) or not localizador.strip():
        return False
    if SECCIONES_DE_FONDO.match(localizador):
        return True
    es_seccion = re.match(r"^\s*secci[oó]n\s+", localizador, re.IGNORECASE) is not None
    return es_seccion and isinstance(encabezado, str) and SECCIONES_DE_FONDO.match(encabezado) is not None


def _resolver_cita(cita: str, fragmentos: list[V.Fragmento], fuente_id: str | None) -> V.Fragmento | None:
    """`V.resolver_cita` con el id de la fuente cuando el verificador lo admite
    (grupo A: resuelve primero por (fuente_id, localizador)); si aún no lo
    admite, por texto de la cita como antes."""
    try:
        return V.resolver_cita(cita, fragmentos, fuente_id=fuente_id)
    except TypeError:
        return V.resolver_cita(cita, fragmentos)


def _comprobar_determinista(texto: str, cita: str, fragmento_citado: str | None, fragmentos: list[V.Fragmento], alcance: list[V.Fragmento], excluir: set[str] | None, fuente_id: str | None) -> V.Resultado:
    """`V.comprobar_determinista` pasando el id de la fuente de la afirmación,
    para que dos fuentes con la misma referencia corta no se crucen (S-04).
    Si el verificador aún no admite el parámetro, se llama como antes."""
    try:
        return V.comprobar_determinista(texto, cita, fragmento_citado, fragmentos, alcance, excluir, fuente_id=fuente_id)
    except TypeError:
        return V.comprobar_determinista(texto, cita, fragmento_citado, fragmentos, alcance, excluir)


def _localizador_admitido(localizador: str) -> bool:
    """Si el verificador declara qué localizadores admite
    (`LOCALIZADORES_ADMITIDOS`, grupo A), se comprueba contra eso; si no, se
    acepta y la resolución de la cita lo dirá."""
    patron = getattr(V, "LOCALIZADORES_ADMITIDOS", None)
    if patron is None:
        return True
    try:
        return bool(patron.fullmatch(localizador.strip())) or bool(patron.match(localizador.strip()))
    except Exception:  # noqa: BLE001
        return True


# Qué fragmentos de una fuente se leen (S-26). Antes se leían los seis primeros por
# posición: portada, introducción y métodos, y nunca la página 7 ni las tablas de
# eficacia. Ahora se puntúan y se leen los seis mejores: secciones de resultados
# primero, páginas de PDF por densidad de cifras y patrones de resultado, referencias
# al final; y con reranker, además, por pertinencia a las preguntas abiertas.
_SECCION_RESULTADOS = re.compile(r"\b(results?|findings?|outcomes?|efficacy|primary\s+end\s*points?|secondary\s+end\s*points?|resultados|hallazgos|eficacia)\b", re.IGNORECASE)
_SECCION_METODOS = re.compile(r"\b(methods?|materials|participants|procedures?|statistical|study\s+design|m[eé]todos|dise[nñ]o|participantes)\b", re.IGNORECASE)
_SECCION_RESIDUAL = re.compile(r"\b(references?|bibliograph\w*|acknowledg\w*|funding|supplementary|author\s+contributions?|conflicts?\s+of\s+interest|declarations?|data\s+availability|referencias|agradecimientos|financiaci[oó]n|conflictos?\s+de\s+inter[eé]s)\b", re.IGNORECASE)
# Las siglas de medidas de efecto (OR, HR, RR, SD, IQR, CI) solo cuentan en mayúscula y
# con una cifra al lado: la conjunción inglesa "or" y el verbo "mean" no son resultados
# (segunda pasada: una introducción con ocho "or" se llevaba el máximo de esta parte).
# "p <" y "n =" llevan su cifra por la misma razón y porque, sin ella, "p < 0.001" con
# espacio nunca casaba (la frontera de palabra tras "<" fallaba).
_PATRONES_RESULTADO = re.compile(r"\b(95\s*%\s*ci|ci\s*95|(?-i:\b(?:OR|HR|RR|SD|IQR|CI))\s*[=:(\[]?\s*[<>≤≥]?\s*[-−+]?\d+(?:[.,]\d+)?|p\s*[<=>]\s*\d+(?:[.,]\d+)?|(?:mean|median|media|mediana)\b[^.\n]{0,25}?\d+|n\s*=\s*\d+|versus|vs\.?|difference|reduction|increase|decrease|slowing|table\s*\d|figure\s*\d|fig\.\s*\d|primary\s+(?:end\s*point|outcome)|baseline|change\s+from\s+baseline|fold|adjusted|estimate|intervalo\s+de\s+confianza|diferencia|reducci[oó]n|aumento|tabla\s*\d)\b", re.IGNORECASE)
_MARCAS_REFERENCIA = re.compile(r"\bet\s+al\b|\bdoi\b|https?://|\b(?:19|20)\d{2}\s*;\s*\d|\bPMID\b|\bpp?\.\s*\d", re.IGNORECASE)


def _parece_lista_de_referencias(texto: str, palabras: int) -> bool:
    marcas = len(_MARCAS_REFERENCIA.findall(texto))
    return marcas >= 10 and marcas * 40 > palabras


def puntuar_fragmento(fr: dict[str, Any]) -> tuple[float, str]:
    """(puntuación, detalle en llano) de cuánto promete un fragmento para la
    extracción. Sección de resultados: 3 de base; sección neutra (conclusiones,
    resumen JATS): 1,5; métodos: 1; introducción, antecedentes y discusión
    (secciones de fondo): 0,5; referencias y agradecimientos: 0. Una página de
    PDF o un trozo de texto web parte de 1, y una página que parece la lista de
    referencias, de 0. A la base se suma el contenido: densidad de cifras (hasta
    2) y patrones de resultado como "95 % CI", "p <", "n =", "Table 2" (hasta
    1,5). Tolera fragmentos sin texto o sin localizador."""
    loc = str(fr.get("localizador") or "")
    enc = str(fr.get("encabezado") or "")
    texto = str(fr.get("texto") or "")
    palabras = max(1, len(texto.split()))
    cifras = len(V.PATRON_CIFRA.findall(texto))
    patrones = len(_PATRONES_RESULTADO.findall(texto))
    contenido = min(cifras / palabras * 20.0, 2.0) + min(patrones / 5.0, 1.5)
    detalle = f"cifras {cifras}, patrones de resultado {patrones}"
    es_seccion = re.match(r"^\s*secci[oó]n\s+", loc, re.IGNORECASE) is not None
    if es_seccion:
        nombre = f"{loc} {enc}"
        if _SECCION_RESIDUAL.search(nombre) and not _SECCION_RESULTADOS.search(nombre):
            return 0.0, "referencias, agradecimientos o material residual"
        if _SECCION_RESULTADOS.search(nombre):
            base, clase = 3.0, "sección de resultados"
        elif es_de_fondo(loc, enc):
            base, clase = 0.5, "sección de fondo"
        elif _SECCION_METODOS.search(nombre):
            base, clase = 1.0, "sección de métodos"
        else:
            base, clase = 1.5, "sección"
        return round(base + contenido, 2), f"{clase}, {detalle}"
    if loc == "resumen":
        return round(1.0 + contenido, 2), f"resumen, {detalle}"
    if _parece_lista_de_referencias(texto, palabras):
        return round(0.1 * contenido, 2), "parece la lista de referencias"
    return round(1.0 + contenido, 2), detalle


async def elegir_fragmentos(candidatos: list[dict[str, Any]], maximo: int, preguntas: str = "") -> tuple[list[dict[str, Any]], str]:
    """Los `maximo` fragmentos que se leen de una fuente y la explicación para la
    pista. Con `maximo` o menos candidatos van todos, en su orden. Con más, se
    ordenan por `puntuar_fragmento` y, si el reranker del gateway está
    disponible y hay preguntas, se suma su pertinencia (0 a 1, por 3) a la
    puntuación por regla; si el reranker no responde, decide la regla sola y
    queda dicho. Los elegidos vuelven en orden de puntuación."""
    if len(candidatos) <= maximo:
        return list(candidatos), f"se leen los {len(candidatos)} fragmentos disponibles"
    puntuaciones = [puntuar_fragmento(fr) for fr in candidatos]
    como = " por regla (secciones de resultados y densidad de cifras)"
    if preguntas and reranker.disponible():
        try:
            orden = await reranker.reordenar(preguntas[:2000], [str(fr.get("texto") or "")[:4000] for fr in candidatos])
            por_indice = {i: float(s_) for i, s_ in orden}
            puntuaciones = [(round(pt + 3.0 * por_indice.get(i, 0.0), 2), f"{d}, reranker {por_indice.get(i, 0.0):.2f}") for i, (pt, d) in enumerate(puntuaciones)]
            como = " por regla y reranker contra las preguntas abiertas"
        except FuenteNoDisponible as ex:
            como = f" por regla (el reranker no respondió: {str(ex)[:60]})"
    orden_idx = sorted(range(len(candidatos)), key=lambda i: -puntuaciones[i][0])
    elegidos_idx = orden_idx[:maximo]
    elegidos = [candidatos[i] for i in elegidos_idx]
    sin_leer = [str(candidatos[i].get("localizador") or "?") for i in orden_idx[maximo:]]
    descripcion = f"se leen {len(elegidos)} de {len(candidatos)} fragmentos{como}: " + ", ".join(f"{candidatos[i].get('localizador')} ({puntuaciones[i][1]})" for i in elegidos_idx) + "; sin leer: " + ", ".join(sin_leer)
    return elegidos, descripcion


def partes_de_fragmento(texto: str, maximo: int = politicas.MAX_CARACTERES_POR_LLAMADA_EXTRACTOR, partes_max: int = politicas.MAX_PARTES_POR_FRAGMENTO) -> list[str]:
    """Lo que ve el extractor de un fragmento: entero si cabe en una llamada;
    si no, en trozos que cortan en párrafo o frase (`trocear_texto`) en vez de
    cortar el texto a secas a los 6.000 caracteres, hasta `partes_max` trozos.
    La cita de cada afirmación sigue apuntando al mismo localizador (la misma
    página o sección), así que el verificador compara contra el texto entero."""
    texto = texto or ""
    if len(texto) <= maximo:
        return [texto]
    partes = trocear_texto(texto, tamano=maximo, minimo=400) or [texto[:maximo]]
    return partes[:partes_max]


def fragmentos_pendientes(f: dict[str, Any]) -> list[dict[str, Any]]:
    """Los fragmentos de una fuente que el extractor no ha leído (`extraido`
    ausente o falso). Con más de un fragmento, el resumen se salta: las cifras
    están en el cuerpo. Un fragmento sin texto o sin localizador no cuenta."""
    frags = [fr for fr in (f.get("fragmentos") or []) if isinstance(fr, dict) and fr.get("localizador")]
    pendientes = [fr for fr in frags if not fr.get("extraido")]
    if len(frags) > 1:
        pendientes = [fr for fr in pendientes if fr["localizador"] != "resumen"]
    return pendientes


async def paso_extraccion(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    preguntas = _criterio(ctx, inv)
    # Orden por margen sobre el listón de cada modo: una fuente de amplitud con 4 (listón 4)
    # no queda siempre detrás de las de foco con 5 (listón 5).
    pendientes = sorted([f for f in ctx.fuentes().values() if not f.get("extraida") and f.get("retraccion") != "retractado"], key=lambda f: -(f.get("relevancia", 0) - _liston_de(f)))[:MAX_FUENTES_EXTRAER]
    if not pendientes:
        return "No hay fuentes nuevas de las que extraer"
    pista = ctx.pista(paso["id"], "extraccion", f"Extraer afirmaciones de {len(pendientes)} fuentes", "Sonnet 5")
    pista.accion(f"Un fragmento a la vez (resumen, página o sección), sin cruzar de fragmento; cada afirmación con su cita literal. De cada fuente se leen hasta {MAX_FRAGMENTOS_POR_FUENTE} fragmentos, los que más prometen (resultados y cifras primero), y solo los que no se habían leído")
    sem = asyncio.Semaphore(4)
    total = 0
    hechas = 0

    async def extraer(f: dict[str, Any]) -> None:

        fallos_fragmentos = 0
        nonlocal total, hechas
        nuevas: list[dict[str, Any]] = []
        frags_todos = f.get("fragmentos", [])
        # Los fragmentos de esta fuente tal como los ve el verificador: la cita que se
        # escribe tiene que resolver contra ellos antes de guardarse (S-03).
        frags_verificador = [V.Fragmento(f["id"], f["referencia"], x["localizador"], x["texto"], x.get("encabezado", "")) for x in frags_todos if isinstance(x, dict) and x.get("localizador")]
        localizadores_avisados: set[str] = set()
        # Solo lo no leído (S-06 d); demasiado corto para leer cuenta como leído.
        candidatos = fragmentos_pendientes(f)
        cortos = [fr["localizador"] for fr in candidatos if len(str(fr.get("texto") or "").strip()) < 80]
        candidatos = [fr for fr in candidatos if len(str(fr.get("texto") or "").strip()) >= 80]
        leidos_ok: list[str] = list(cortos)
        elegidos, descripcion = await elegir_fragmentos(candidatos, MAX_FRAGMENTOS_POR_FUENTE, preguntas)
        if candidatos:
            pista.nota(f"{f['referencia']}: {descripcion}"[:900])
        for fr in elegidos:
            if pista.detenida():
                return
            texto_entero = str(fr.get("texto") or "")
            partes = partes_de_fragmento(texto_entero)
            if len(partes) > 1 or len(texto_entero) > politicas.MAX_CARACTERES_POR_LLAMADA_EXTRACTOR:
                leidos_chars = sum(len(x) for x in partes)
                pista.nota(f"{f['referencia']} ({fr['localizador']}): {len(texto_entero)} caracteres; se lee en {len(partes)} partes" + (f" (las {len(partes)} primeras: {leidos_chars} de {len(texto_entero)} caracteres)" if leidos_chars < len(texto_entero) else "") + " en vez de cortar a " + str(politicas.MAX_CARACTERES_POR_LLAMADA_EXTRACTOR))
            de_fondo = es_de_fondo(fr["localizador"], fr.get("encabezado", ""))
            cita = f"[{f['referencia']}, {fr['localizador']}]"
            cita_resuelve = _resolver_cita(cita, frags_verificador, f["id"]) is not None
            if fr["localizador"] not in localizadores_avisados:
                if not cita_resuelve:
                    localizadores_avisados.add(fr["localizador"])
                    pista.nota(f"{f['referencia']}: el verificador no reconoce el localizador «{fr['localizador']}»; sus afirmaciones se guardan como cita_no_resuelve con ese motivo (no es que la fuente falte)")
                elif not _localizador_admitido(fr["localizador"]):
                    # Resuelve por el id de la fuente, pero el patrón de citas no lo admite:
                    # la réplica (que resuelve por texto) fallaría. Se avisa, no se bloquea.
                    localizadores_avisados.add(fr["localizador"])
                    pista.nota(f"{f['referencia']}: el localizador «{fr['localizador']}» no está en los admitidos por el patrón de citas; la cita resuelve por el id de la fuente, pero la réplica por texto no lo reconocería")
            sospechoso = K.sospechoso_inyeccion(texto_entero)
            if sospechoso:
                pista.nota(f"{f['referencia']} ({fr['localizador']}): el fragmento contiene texto que parece una instrucción para un modelo; se marca y se enseña, no se bloquea")
            fallo = False
            for texto in partes:
                if pista.detenida():
                    return
                async with sem:
                    try:
                        # El fragmento entra delimitado como dato (spotlighting), nunca como instrucción.
                        pred = await ctx.llamar("volumen", ctx.programas.extraer, preguntas_abiertas=_criterio_para_fuente(preguntas, f), referencia=f["referencia"], localizador=fr["localizador"], fragmento=K.como_dato(texto))
                    except PresupuestoAgotado:
                        raise
                    except VIG.ModeloSinRespuesta:
                        raise
                    except Exception as ex:  # noqa: BLE001
                        pista.error(f"{f['referencia']} ({fr['localizador']}): el extractor falló: {str(ex)[:120]}")
                        fallos_fragmentos += 1
                        fallo = True
                        break
                for a in pred.afirmaciones:
                    # Comprobación literal en PDF: la página de la cita tiene que contener el fragmento.
                    if not (a.fragmento or "").strip():
                        # Sin pasaje no hay nada que verificar: el motivo dice la causa real.
                        pista.nota(f"{f['referencia']} ({fr['localizador']}): el extractor no devolvió pasaje para una afirmación; se marca cita_no_resuelve")
                        veredicto_inicial = "cita_no_resuelve"
                        motivo = "El extractor no devolvió el pasaje copiado de la fuente; sin pasaje no se puede comprobar la literalidad."
                    elif fr["localizador"].startswith("pág.") and not pdf.fragmento_en_texto_de_pagina(fr.get("texto", ""), a.fragmento):
                        # Misma regla que el verificador, contra el texto ya guardado de la
                        # página (sin reabrir el PDF por afirmación; S-05).
                        pista.nota(f"{f['referencia']}: fragmento no encontrado literalmente en la {fr['localizador']}; la afirmación se marca cita_no_resuelve")
                        veredicto_inicial = "cita_no_resuelve"
                        motivo = "El fragmento citado no aparece literalmente en la página indicada."
                    elif not cita_resuelve:
                        veredicto_inicial = "cita_no_resuelve"
                        motivo = f"Localizador no reconocido por el verificador: «{fr['localizador']}». La fuente y el pasaje existen; hay que ampliar los localizadores admitidos y volver a verificar."
                    else:
                        veredicto_inicial, motivo = "sin_verificar", "Pendiente de verificación"
                    # M-03: el nombre de cohorte se recorta sin romper ni perder ningún NCT
                    # ni nombre del catálogo (antes el corte a 60 dejaba "NCT044375").
                    cohorte = METODOS.recortar_nombre_cohorte(getattr(a, "cohorte", ""))
                    nivel = getattr(a, "nivel_medicion", "resultado_analisis") or "resultado_analisis"
                    registro = {k: (getattr(a, k, "") or "").strip()[:80] for k in ("n", "comparador", "efecto", "incertidumbre")}
                    # Comprobaciones automáticas del registro de evidencia (plan completo,
                    # sección 3): lo que un dato debería traer y no trae queda sin resolver.
                    sin_resolver = [k for k in ("n", "comparador", "efecto") if a.tipo == "dato" and not registro[k]]
                    if a.tipo == "dato" and nivel == "interpretacion_autor":
                        sin_resolver.append("una interpretación de los autores no es una medida: se rebaja a literatura")
                        tipo_af = "literatura"
                    else:
                        tipo_af = a.tipo
                    nuevas.append({"id": P.nuevo_id("af"), "texto": a.texto.strip(), "cita": cita, "fragmento": a.fragmento.strip(), "veredicto": veredicto_inicial, "motivo": motivo, "entidadDistinta": False, "tipo": tipo_af, "clase": "literatura", "sintetico": False, "cohorte": cohorte, "sospechosoInyeccion": sospechoso, "nivelMedicion": nivel, **registro, "sinResolver": sin_resolver, "tema": a.tema, "fuenteId": f["id"], "localizador": fr["localizador"], "deFondo": de_fondo, "iteracion": ctx.numero, "encabezado": fr.get("encabezado", "")})

            if not fallo:
                leidos_ok.append(fr["localizador"])

        def guardar(e: dict[str, Any]) -> bool:
            c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
            c.setdefault("_afirmaciones", []).extend(nuevas)
            fuente = c["_fuentes"][f["id"]]
            # `extraido` por fragmento (S-06 d): los leídos quedan marcados; los no elegidos
            # siguen sin marca y entran en la siguiente elección si la fuente se reabre. Con
            # algún fragmento sin extraer por fallo del modelo, la fuente queda pendiente.
            for fr_ in fuente.get("fragmentos", []):
                if isinstance(fr_, dict) and fr_.get("localizador") in leidos_ok:
                    fr_["extraido"] = True
            fuente["extraida"] = fallos_fragmentos == 0
            # La cohorte de la fuente: la que más dijeron sus afirmaciones, o la que
            # se reconoce en el título y el resumen. Sirve para contar cohortes, no
            # artículos, al medir replicación.
            if not fuente.get("cohorte"):
                dichas = [a["cohorte"] for a in nuevas if a.get("cohorte")]
                fuente["cohorte"] = (max(set(dichas), key=dichas.count) if dichas else METODOS.recortar_nombre_cohorte(K.cohorte_en_texto(fuente.get("titulo", "") + " " + " ".join(fr.get("texto", "")[:600] for fr in fuente.get("fragmentos", [])[:1])))) or None
            # Método como nodo (rosa/metodos.py): cohorte canónica, plataforma de medida y
            # muestra reconocidas en título, fragmento y afirmaciones, con su origen.
            try:
                m_ = METODOS.metodo_de_fuente(fuente, nuevas)
                fuente["metodo"] = {"cohorte": m_.get("cohorte"), "plataforma": m_.get("plataforma"), "muestra": m_.get("muestra"), "origen": m_.get("origen")}
            except Exception:  # noqa: BLE001  el catálogo nunca tumba la extracción
                pass
            c["busqueda"]["usados"] = len({a["fuenteId"] for a in c["_afirmaciones"]})
            return True

        ctx.mutar(guardar, "afirmaciones")
        total += len(nuevas)
        hechas += 1
        pista.resultado(f"Fuente {hechas} de {len(pendientes)}: {f['referencia']}, {len(nuevas)} afirmaciones ({total} acumuladas)")

    try:
        await _en_paralelo(*(extraer(f) for f in pendientes))
        pista.cerrar(f"{len(pendientes)} fuentes, {total} afirmaciones con cita")
    except PresupuestoAgotado:
        pista.cerrar("Presupuesto agotado a mitad de la extracción", "detenida")
        raise
    return f"{total} afirmaciones extraídas de {hechas} fuentes"


# ---------------------------------------------------------------------------
# Verificacion
# ---------------------------------------------------------------------------


# Lo que ve el juez de verificación del fragmento. El extractor lee hasta 18.000
# caracteres y el determinista busca el pasaje en el fragmento entero; el juez
# solo veía los primeros 6.000, y cuando el pasaje caía más abajo juzgaba sin él.
# En el estado del 23 de septiembre de 2026 había 35 afirmaciones así: 17 se
# rechazaron (más de la mitad de todas las rechazadas) y 5 se aprobaron sin ver
# su respaldo.
VENTANA_JUEZ = 6000


def ventana_para_juez(texto: str, pasaje: str, maximo: int = VENTANA_JUEZ) -> str:
    """El trozo del fragmento que ve el juez: entero si cabe; si no, una
    ventana de `maximo` caracteres centrada en el pasaje que copió el extractor,
    con una marca de lo que se omite a cada lado. Si el pasaje no se encuentra,
    el principio, como antes, y el juez lo sabe por la marca."""
    from rosa import citas as CI

    texto = texto or ""
    if len(texto) <= maximo:
        return texto
    tramos = CI.marcar_pasaje(texto, pasaje or "").get("tramos") or []
    if not tramos:
        return texto[:maximo] + f"\n[... {len(texto) - maximo} caracteres más del fragmento omitidos; el pasaje citado no se localizó en él ...]"
    ini, fin = tramos[0]["inicio"], tramos[-1]["fin"]
    margen = max(0, (maximo - (fin - ini)) // 2)
    a = max(0, ini - margen)
    b = min(len(texto), max(fin + margen, a + maximo))
    a = max(0, min(a, b - maximo))
    return ("[... " + str(a) + " caracteres anteriores omitidos ...]\n" if a else "") + texto[a:b] + ("\n[... " + str(len(texto) - b) + " caracteres posteriores omitidos ...]" if b < len(texto) else "")


async def verificar_afirmaciones(ctx: Ctx, afirmaciones: list[dict[str, Any]], pista: Pista | None, pregunta: str, rol: str = "juez", rollout_id: int | None = None) -> dict[str, int]:
    """Deterministas primero, juez después. Cambia el veredicto en sitio (y en
    el almacén). Devuelve el recuento por veredicto. `rollout_id` distingue las
    trayectorias de réplica en la caché de DSPy (S-20)."""
    frags = ctx.fragmentos_verificador()
    recuento: dict[str, int] = {}
    al_juez: list[tuple[dict[str, Any], V.Resultado]] = []
    # Los términos del objetivo (la enfermedad, la cohorte) no cuentan como
    # identificadores en una declaración de ausencia: están en todo el corpus.
    excluir = V.terminos_del_dominio(pregunta)
    for a in afirmaciones:
        # El id de la fuente manda sobre el texto de la cita: dos fuentes con la misma
        # referencia corta ("Sin autor", dos "Bhagunde et al., 2026") ya no se cruzan (S-04).
        r = _comprobar_determinista(a["texto"], a["cita"], a.get("fragmento"), frags, frags, excluir, a.get("fuenteId"))
        if r.necesita_juez:
            al_juez.append((a, r))
        else:
            a["veredicto"], a["motivo"] = r.veredicto, r.motivo
            # Una abstención se acepta y no cuenta como evidencia (V.Resultado).
            if r.abstencion:
                a["abstencion"] = True
            recuento[r.veredicto] = recuento.get(r.veredicto, 0) + 1
    if pista:
        pista.resultado(f"Deterministas: {sum(recuento.values())} resueltas sin juez ({', '.join(f'{k} {v}' for k, v in recuento.items()) or 'ninguna'}); {len(al_juez)} van al juez")
    sem = asyncio.Semaphore(4)
    juzgadas = 0

    def _fragmento_propio(a: dict[str, Any]) -> V.Fragmento | None:
        """El fragmento de la propia fuente de la afirmación, por (fuenteId,
        localizador), cuando el determinista no lo dejó resuelto."""
        if not a.get("fuenteId") or not a.get("localizador"):
            return None
        clave = V._clave_localizador(str(a["localizador"]))
        return next((x for x in frags if x.fuente_id == a["fuenteId"] and V._clave_localizador(x.localizador) == clave), None)

    async def juzgar(a: dict[str, Any], r: V.Resultado) -> None:
        nonlocal juzgadas
        frag = r.fragmento or _fragmento_propio(a)
        async with sem:
            try:
                pred = await ctx.llamar(rol, ctx.programas.juzgar, rollout_id=rollout_id, pregunta=pregunta, afirmacion=a["texto"], fragmento=K.como_dato(f"Encabezado: {frag.encabezado if frag else a.get('encabezado', '')}\n\n{ventana_para_juez(frag.texto if frag else a.get('fragmento', ''), a.get('fragmento', ''))}"), pistas=r.pistas)
                v = pred.veredicto
                a["veredicto"] = v.veredicto
                a["motivo"] = v.motivo
                a["entidadDistinta"] = bool(v.entidad_distinta) and v.veredicto == "no_sostenida"
                # El juez ve una ventana de 6.000 caracteres de la página, no el
                # pasaje que se guarda: puede votar "sostenida" con razón y dejar
                # guardada como respaldo una cita que solo cubre media afirmación
                # (28 de septiembre de 2026). La regla mira lo que se guarda.
                if a["veredicto"] == "sostenida":
                    falta = V.tramo_no_cubierto_por_el_pasaje(a["texto"], str(a.get("fragmento") or ""))
                    if falta:
                        a["veredicto"] = "parcial"
                        a["motivo"] = f"{v.motivo} | Rebajado a parcial por regla: {falta}"
            except PresupuestoAgotado:
                raise
            except VIG.ModeloSinRespuesta:
                raise
            except Exception as ex:  # noqa: BLE001
                a["veredicto"] = "sin_verificar"
                a["motivo"] = f"El juez no dictaminó: {str(ex)[:120]}"
        juzgadas += 1
        recuento[a["veredicto"]] = recuento.get(a["veredicto"], 0) + 1
        if pista and juzgadas % 10 == 0:
            pista.resultado(f"Juez: {juzgadas} de {len(al_juez)}")

    await _en_paralelo(*(juzgar(a, r) for a, r in al_juez))
    ctx.mutar(lambda e: True, "veredictos")
    return recuento


async def paso_verificacion(ctx: Ctx, paso: dict[str, Any]) -> str:
    pendientes = [a for a in ctx.afirmaciones() if a["veredicto"] == "sin_verificar"]
    if not pendientes:
        return "Nada pendiente de verificar"
    pista = ctx.pista(paso["id"], "verificacion", f"Verificar {len(pendientes)} afirmaciones", "Opus 5 (juez)")
    pista.accion("Comprobaciones deterministas: citas que resuelven, fragmento literal, identificadores, cifras normalizadas")
    inv = ctx.inv()
    try:
        recuento = await verificar_afirmaciones(ctx, pendientes, pista, inv["objetivo"])
    except PresupuestoAgotado:
        pista.cerrar("Presupuesto agotado a mitad de la verificación", "detenida")
        raise
    bloqueadas = sum(v for k, v in recuento.items() if V.bloquea(k))
    resumen = f"{len(pendientes)} afirmaciones: " + ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in sorted(recuento.items(), key=lambda x: -x[1])) + f"; {bloqueadas} bloqueadas"
    pista.cerrar(resumen)
    fid = V.fidelidad([a["veredicto"] for a in pendientes])
    ahora = P.ahora_ms()

    def metricas(e: dict[str, Any]) -> bool:
        e["metricas"].append(
            {
                "fecha": ahora,
                "juez": ctx.modelos.juez.model,
                "casos": len(pendientes),
                # Acuerdo con las personas: sale del conjunto dorado (etiquetas humanas
                # sobre veredictos del Killer), no de una constante.
                "acuerdoConHumanos": (ACU.acuerdo_dorado(e).get("global") or {}).get("kappa"),
                "sostenidas": round(fid, 3) if fid is not None else 0,
                "cobertura": round(1 - recuento.get("cita_no_resuelve", 0) / max(1, len(pendientes)), 3),
                "ausenciasRefutadas": recuento.get("ausencia_refutada", 0),
                "entidadDistinta": sum(1 for a in pendientes if a.get("entidadDistinta")),
                "sinVerificar": recuento.get("sin_verificar", 0),
                "aciertoPorTipo": ACU.acierto_por_tipo(e),
            }
        )
        return True

    ctx.mutar(metricas, "metricas")
    return resumen


# ---------------------------------------------------------------------------
# Modelo de mundo
# ---------------------------------------------------------------------------


def _fuente_publica(f: dict[str, Any], afirmacion: dict[str, Any] | None = None) -> dict[str, Any]:
    """La Fuente tal como la ve la interfaz, con la página y el fragmento de
    la afirmación concreta si se da."""
    publica = {k: v for k, v in f.items() if not k.startswith("_") and k not in ("fragmentos", "relevancia", "extraida", "iteracion", "consultas")}
    publica.setdefault("cohorte", None)
    if afirmacion:
        loc = afirmacion.get("localizador", "")
        m = re.match(r"p[aá]g\.\s*(\d+)", loc)
        publica["pagina"] = int(m.group(1)) if m else None
        publica["fragmento"] = afirmacion.get("fragmento", "")[:400]
    return publica


# Las dos mitades de M-08 (el bucle al nacer un hecho; el estado al cargar y al
# heredar, rosa/hechos.py) comparten una sola regla de referencia compartida y de
# números (también los escritos con letra: "excluyeron cuatro" y "excluyeron
# seis" no son el mismo hecho). Los nombres se conservan porque el resto del
# módulo y los tests los usan. Una referencia genérica ("Sin autor, 2023") no
# cuenta como compartida: dos obras sin autor no son la misma obra.
comparte_referencia = H.comparte_referencia
_NUMEROS_EN_LETRA = H.NUMEROS_EN_LETRA
_numeros_de = H.numeros_de


def hecho_duplicado(existentes: list[dict[str, Any]], enunciado: str, procedencia: list[dict[str, Any]], ids_entidades: set[str] | frozenset[str] = frozenset(), tipo: str = "hecho") -> tuple[dict[str, Any] | None, str]:
    """El hecho ya existente que dice lo mismo que `enunciado`, con el motivo,
    o (None, ""). Tres reglas (M-08): texto normalizado idéntico (con cualquier
    tipo y estado, como antes); una paráfrasis según `cuestiones.equivalencia`
    (solape de tokens alto, misma dirección) con los mismos números (también
    escritos con letra), las mismas siglas fuera de la referencia y las mismas
    negaciones largas (las guardas de rosa/hechos.py `guardas_de_parafrasis`,
    para que el bucle y el estado fundan lo mismo: "GFAP sube" no es "YKL40
    sube" y "redujo" no es "nunca redujo" aunque salgan de la misma fuente)
    cuando comparte al menos una fuente o referencia con la procedencia nueva;
    o dos entidades canónicas en común y el mismo comienzo (la regla anterior).
    Las dos últimas solo entre hechos del mismo tipo y no descartados: una
    paráfrasis con otra fuente es una replicación y nace aparte."""
    norm = V.normalizar(enunciado)
    if not norm:
        return None, ""
    for x in existentes:
        if V.normalizar(x.get("enunciado")) == norm:
            return x, "texto idéntico"
    numeros = _numeros_de(enunciado)
    limpio = H.sin_cita(enunciado)
    negaciones = H.negaciones_de(limpio)
    for x in existentes:
        if x.get("estado") == "descartado" or x.get("tipo", "hecho") != tipo:
            continue
        enunciado_x = str(x.get("enunciado") or "")
        eq = CU.equivalencia(enunciado, enunciado_x)
        if eq and numeros == _numeros_de(enunciado_x) and comparte_referencia(x.get("procedencia"), procedencia):
            # Las siglas de la obra citada ("Belder", "2026", "ADNI-3 team") no son
            # contenido del hecho: se quitan antes de comparar, como en hechos.py.
            procedencias = [*(x.get("procedencia") if isinstance(x.get("procedencia"), list) else []), *(procedencia if isinstance(procedencia, list) else [])]
            ref = {t for p_ in procedencias if isinstance(p_, dict) for t in CU.normalizar(str(p_.get("referencia") or "")).split()}
            limpio_x = H.sin_cita(enunciado_x)
            if H.siglas_de(limpio, ref) == H.siglas_de(limpio_x, ref) and negaciones == H.negaciones_de(limpio_x):
                return x, f"misma afirmación con otras palabras ({eq}) y misma fuente"
        if ids_entidades and len(set(ids_entidades) & ONTO.ids_de(x.get("entidades"))) >= 2 and V.normalizar(x.get("enunciado"))[:40] == norm[:40]:
            return x, "mismas entidades canónicas y mismo comienzo"
    return None, ""


def fundir_hecho(h: dict[str, Any], procedencia: list[dict[str, Any]], citas: list[dict[str, Any]], afirmacion_ids: list[str], ahora: int, motivo: str) -> bool:
    """Suma al hecho existente la procedencia, las citas y las afirmaciones de
    un enunciado equivalente. Devuelve True si entró algo nuevo; entonces el
    hecho queda actualizado y su historial lo dice. Sin nada nuevo, no toca."""
    anadido = False
    proc = h.setdefault("procedencia", [])
    for p_ in procedencia or []:
        if isinstance(p_, dict) and p_ not in proc:
            proc.append(p_)
            anadido = True
    citas_h = h.setdefault("citas", [])
    for c_ in citas or []:
        if isinstance(c_, dict) and not any(isinstance(x, dict) and x.get("referencia") == c_.get("referencia") and x.get("seccion") == c_.get("seccion") for x in citas_h):
            citas_h.append(c_)
            anadido = True
    ids = h.setdefault("afirmacionIds", [])
    for i in afirmacion_ids or []:
        if i and i not in ids:
            ids.append(i)
            anadido = True
    if anadido:
        h["actualizadoEn"] = ahora
        h.setdefault("historial", []).append({"fecha": ahora, "de": h.get("estado"), "a": h.get("estado"), "quien": config.QUIEN_ROSA, "motivo": motivo[:240]})
    return anadido


async def paso_modelo(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    e = ctx.e
    nuevas = [a for a in ctx.afirmaciones() if a["iteracion"] == ctx.numero]
    texto, validas = T.afirmaciones_sostenidas(nuevas)
    pista = ctx.pista(paso["id"], "modelo", "Actualizar hechos y preguntas", "GPT-6 Astra")
    if not validas:
        pista.cerrar("Sin afirmaciones sostenidas nuevas: el modelo de mundo no cambia")
        return "Sin afirmaciones sostenidas nuevas"
    pista.accion(f"Leyendo el modelo de mundo y {len(validas)} afirmaciones sostenidas o parciales")
    mundo = await T.modelo_de_mundo_para(ctx.almacen, ctx.investigacion_id, _consulta_del_paso(ctx, inv, texto[:1500]))
    # El modelo de mundo se mantiene, no solo crece: hechos existentes numerados (para
    # sustituir o contradecir) y cuestiones abiertas numeradas (para resolver).
    hechos_texto, hechos_lista = T.hechos_numerados(e["hechos"], ctx.investigacion_id)
    cuestiones_texto, cuestiones_lista = CU.numeradas(e, ctx.investigacion_id)
    pred = await ctx.llamar("cerebro", ctx.programas.mundo, objetivo=inv["objetivo"], modelo_de_mundo=mundo, afirmaciones_sostenidas=texto, hechos_existentes=hechos_texto, cuestiones_abiertas=cuestiones_texto)
    ahora = P.ahora_ms()
    fuentes = ctx.fuentes()
    anadidos = 0
    preguntas = 0
    sustituidos = 0
    contradichos = 0
    resueltas = 0
    fundidos = 0
    omitidos = 0
    # Genes nombrados en los hechos nuevos, resueltos en HGNC (con cache en el estado).
    cache_ent = dict(ctx.e.get("entidadesCache") or {})
    simbolos_nuevos = sorted({s_ for hp in pred.hechos for s_ in simbolos_de_genes(hp.enunciado)})[:12]
    genes_resueltos = await ONTO.normalizar(simbolos_nuevos, [], cache_ent) if simbolos_nuevos else []

    def aplicar(e2: dict[str, Any]) -> bool:
        nonlocal anadidos, preguntas, sustituidos, contradichos, resueltas, fundidos, omitidos
        e2["entidadesCache"] = {k: v for k, v in list(cache_ent.items())[-2000:]}
        propios = [h for h in e2["hechos"] if h["investigacionId"] == ctx.investigacion_id]
        por_id = {h["id"]: h for h in e2["hechos"]}

        def enlazar(h: dict[str, Any], hp: Any, citas: list[dict[str, Any]]) -> tuple[int, int, list[str]]:
            """Lo que el cerebro dijo de este hecho respecto al modelo de mundo: a qué
            hechos sustituye, cuáles contradice y qué cuestiones resuelve. Vale igual
            para un hecho nuevo y para uno ya existente con el que se fundió una
            paráfrasis (M-08): el enlace que produjo la llamada no se tira porque el
            enunciado ya estuviera. Devuelve (sustituidos, contradichos, cuestiones)."""
            nonlocal sustituidos, contradichos, resueltas
            h.setdefault("sustituyeA", [])
            h.setdefault("contradiceA", [])
            h.setdefault("resuelveA", [])
            n_sust = 0
            n_contra = 0
            # Sustituye: el viejo queda como sustituido (descartado con motivo, sin
            # tocar actualizadoEn) y lo que dependía de él pasa a pendiente de revisar.
            for i in list(getattr(hp, "sustituye", []) or []):
                if not (isinstance(i, int) and 1 <= i <= len(hechos_lista)):
                    continue
                viejo = por_id.get(hechos_lista[i - 1]["id"])
                if not viejo or viejo["id"] == h["id"] or viejo.get("estado") != "sabido":
                    continue
                viejo["estado"] = "descartado"
                viejo["motivoDescarte"] = f"Sustituido en la iteración {ctx.numero} por un hecho más reciente: {hp.enunciado[:160]}"
                viejo["sustituidoPor"] = h["id"]
                viejo["cerradoEn"] = ahora
                viejo.setdefault("historial", []).append({"fecha": ahora, "de": "sabido", "a": "descartado", "quien": config.QUIEN_ROSA, "motivo": viejo["motivoDescarte"]})
                if viejo["id"] not in h["sustituyeA"]:
                    h["sustituyeA"].append(viejo["id"])
                n_sust += 1
                DEP.propagar_sustitucion(e2, ctx.investigacion_id, viejo["id"], h["id"], ahora)
            # Contradice: los dos quedan, la contradicción se anota como cita
            # "contrasta" sobre el viejo y sus dependientes pasan a pendiente.
            for i in list(getattr(hp, "contradice", []) or []):
                if not (isinstance(i, int) and 1 <= i <= len(hechos_lista)):
                    continue
                viejo = por_id.get(hechos_lista[i - 1]["id"])
                if not viejo or viejo["id"] == h["id"] or viejo["id"] in h["sustituyeA"] or viejo["id"] in h["contradiceA"]:
                    continue
                h["contradiceA"].append(viejo["id"])
                viejo.setdefault("citas", []).append({"referencia": (citas[0]["referencia"] if citas else f"hecho {h['id']}"), "seccion": (citas[0]["seccion"] if citas else ""), "clasificacion": "contrasta", "fragmento": hp.enunciado[:300]})
                n_contra += 1
                DEP.propagar_contradiccion(e2, ctx.investigacion_id, viejo["id"], h["id"], ahora)
            # Resuelve: cierra las cuestiones señaladas; si una era una pregunta del
            # modelo de mundo, la pregunta pasa a sabida (respondida).
            ids_resueltas = CU.cerradas_por_hecho(e2, ctx.investigacion_id, h, list(getattr(hp, "resuelve", []) or []), cuestiones_lista, ahora)
            for cid in ids_resueltas:
                c_ = CU.buscar(e2, cid)
                for hid in (c_ or {}).get("hechoIds", []):
                    preg = por_id.get(hid)
                    if preg and preg.get("tipo") == "pregunta" and preg.get("estado") == "abierto":
                        preg["estado"] = "sabido"
                        preg["cerradoEn"] = ahora
                        preg.setdefault("historial", []).append({"fecha": ahora, "de": "abierto", "a": "sabido", "quien": config.QUIEN_ROSA, "motivo": f"Respondida en la iteración {ctx.numero} por el hecho: {hp.enunciado[:160]}"})
                        if hid not in h["resuelveA"]:
                            h["resuelveA"].append(hid)
            sustituidos += n_sust
            contradichos += n_contra
            resueltas += len(ids_resueltas)
            return n_sust, n_contra, ids_resueltas

        for hp in pred.hechos:
            respaldo = [validas[i - 1] for i in hp.afirmaciones if 1 <= i <= len(validas)]
            if hp.tipo == "hecho" and not respaldo:
                continue  # un hecho sin afirmacion sostenida no entra
            procedencia = []
            citas = []
            for a in respaldo:
                if a["fuenteId"] not in fuentes:
                    continue
                m = re.match(r"p[aá]g\.\s*(\d+)", a["localizador"])
                entrada = {"fuenteId": a["fuenteId"], "referencia": fuentes[a["fuenteId"]]["referencia"], "pagina": int(m.group(1)) if m else None}
                if entrada not in procedencia:
                    procedencia.append(entrada)
                # Cita sobre el hecho (patrón Scite): la referencia, la sección leída y el
                # fragmento que lo sostiene. La página solo si el localizador la trae.
                cita = {"referencia": fuentes[a["fuenteId"]]["referencia"], "seccion": a.get("localizador") or "", "clasificacion": "apoya", "fragmento": (a.get("fragmento") or "")[:300]}
                if not any(c_["referencia"] == cita["referencia"] and c_["seccion"] == cita["seccion"] for c_ in citas):
                    citas.append(cita)
            ids_afirmaciones = [a["id"] for a in respaldo if a.get("id")]
            tipo_hecho = "hecho" if hp.tipo == "hecho" else "pregunta"
            # Entidades canonicas del hecho: diccionario curado mas los genes que HGNC
            # resolvio (cache `entidadesCache` del estado). Con ellas el modelo de mundo
            # se puede consultar y deduplicar por identificador, no por cadena.
            entidades = ONTO.fusionar(ONTO.anotar_curadas(hp.enunciado), [x for x in genes_resueltos if x["texto"].upper() in {s_.upper() for s_ in simbolos_de_genes(hp.enunciado)}])
            # El mismo hecho con otras palabras no nace dos veces (M-08): se funde con el
            # existente sumando procedencia, citas y afirmaciones. Un hecho descartado no
            # absorbe nada: si su texto vuelve idéntico, se omite como antes.
            duplicado, motivo_dup = hecho_duplicado(propios, hp.enunciado, procedencia, ONTO.ids_de(entidades), tipo_hecho)
            if duplicado is not None:
                if duplicado.get("estado") == "descartado":
                    omitidos += 1
                    continue
                if fundir_hecho(duplicado, procedencia, citas, ids_afirmaciones, ahora, f"Fundido en la iteración {ctx.numero} con «{hp.enunciado[:100]}»: {motivo_dup}"):
                    fundidos += 1
                else:
                    omitidos += 1
                if tipo_hecho == "hecho":
                    # El enlace que el cerebro señaló para la paráfrasis (qué sustituye, qué
                    # contradice, qué cuestión cierra) vale para el hecho con el que se fundió.
                    n_s, n_c, ids_r = enlazar(duplicado, hp, citas)
                    if n_s or n_c or ids_r:
                        partes = ([f"resuelve {len(ids_r)} cuestiones"] if ids_r else []) + ([f"sustituye a {n_s} hechos"] if n_s else []) + ([f"contradice a {n_c} hechos"] if n_c else [])
                        duplicado["actualizadoEn"] = ahora
                        duplicado.setdefault("historial", []).append({"fecha": ahora, "de": duplicado.get("estado"), "a": duplicado.get("estado"), "quien": config.QUIEN_ROSA, "motivo": f"Fundido en la iteración {ctx.numero} con «{hp.enunciado[:80]}»; el enlace del cerebro pasa a este hecho: " + ", ".join(partes)})
                continue
            h = P.nuevo_hecho(ctx.investigacion_id, tipo_hecho, hp.tema, hp.enunciado, "sabido" if hp.tipo == "hecho" else "abierto", "fuente" if hp.tipo == "hecho" else "inferencia", procedencia, ahora, hp.prioridad, f"Añadido en la iteración {ctx.numero}",
                              afirmacion_ids=ids_afirmaciones, citas=citas)
            h["entidades"] = entidades
            e2["hechos"].append(h)
            propios.append(h)
            por_id[h["id"]] = h
            if hp.tipo == "hecho":
                anadidos += 1
                A.con_evento(e2, ctx.investigacion_id, "hecho_nuevo", f"Hecho nuevo: {hp.enunciado[:120]}", f"#/investigaciones/{ctx.investigacion_id}/mundo", ahora)
                enlazar(h, hp, citas)
            else:
                preguntas += 1
                # La pregunta también es una cuestión persistente, con lo que la resolvería.
                CU.desde_pregunta_hecho(e2, h, getattr(hp, "que_la_resolveria", "") or "", ahora)
        return True

    ctx.mutar(aplicar, "modelo_de_mundo")
    pista.resultado(f"{anadidos} hechos y {preguntas} preguntas nuevas" + (f"; {sustituidos} hechos sustituidos" if sustituidos else "") + (f"; {contradichos} contradichos" if contradichos else "") + (f"; {resueltas} cuestiones resueltas" if resueltas else "") + (f"; {fundidos} fundidos con hechos que ya decían lo mismo (se suma su procedencia y se conserva lo que resuelven o sustituyen)" if fundidos else "") + (f"; {omitidos} omitidos por repetir un hecho descartado o uno que ya tenía esa procedencia" if omitidos else ""))
    # Instantanea del modelo de mundo como artefacto.
    contenido = "# Modelo de mundo\n\n" + T.modelo_de_mundo(ctx.e["hechos"], ctx.investigacion_id, maximo=500, investigaciones=ctx.e["investigaciones"])
    ctx.mutar(lambda e2: A.guardar_artefacto(e2, ctx.investigacion_id, "Modelo de mundo", "modelo_mundo", contenido, f"Iteración {ctx.numero}: {anadidos} hechos y {preguntas} preguntas nuevas", ctx.numero, ahora), "artefacto")
    # Tareas que el cerebro pidió abrir al integrar (arnés de Yoon 2026), de polizón
    # en esta misma llamada: cero llamadas nuevas.
    crudas_t = len(list(getattr(pred, "tareas", None) or []))
    if crudas_t:
        nota_de_tareas(pista, registrar_tareas_propuestas(ctx, pred, paso), crudas_t)
    pista.cerrar(f"{anadidos} hechos, {preguntas} preguntas" + (f", {sustituidos} sustituidos" if sustituidos else "") + (f", {resueltas} cuestiones resueltas" if resueltas else ""))
    return f"{anadidos} hechos y {preguntas} preguntas nuevas en el modelo de mundo" + (f"; {sustituidos} hechos sustituidos" if sustituidos else "") + (f"; {contradichos} contradichos" if contradichos else "") + (f"; {resueltas} cuestiones resueltas" if resueltas else "") + (f"; {fundidos} fundidos con hechos existentes" if fundidos else "")


# ---------------------------------------------------------------------------
# Hipotesis: generar, revisar, torneo
# ---------------------------------------------------------------------------


def _texto_mision(inv: dict[str, Any]) -> str:
    m = inv.get("mision") or {}
    memoria = inv.get("memoria") or []
    texto_mem = (" Memoria del proyecto (hechos fijados por las personas): " + " | ".join(x["texto"] for x in memoria[:12])) if memoria else ""
    operativo = inv.get("conocimientoOperativo") or []
    if operativo:
        # Lo que el laboratorio sabe y no esta en ningun articulo: protocolos poco
        # fiables, lotes que fallan, artefactos de medida. Clase de evidencia propia.
        texto_mem += " Conocimiento operativo del laboratorio (no publicado; clase conocimiento_operativo): " + " | ".join(f"[{x['tipo']}] {x['texto']}" for x in operativo[:12])
    if not m:
        return "Sin misión estructurada todavía." + texto_mem
    return f"Población: {m.get('poblacion') or 'sin fijar'}. Etapa: {m.get('etapa') or 'sin fijar'}. Célula o tejido: {m.get('celulaTejido') or 'sin fijar'}. Mecanismo: {m.get('mecanismo') or 'sin fijar'}. Tipo de intervención: {m.get('tipoIntervencion') or 'sin fijar'}. Capacidades del laboratorio: {'; '.join(m.get('capacidadesLaboratorio', [])) or 'sin declarar'}." + texto_mem


async def _completar_tarjeta(ctx: Ctx, h: dict[str, Any], pista: Pista | None) -> None:
    """La tarjeta (contrato mínimo) de una hipótesis que no la trae: humana o
    anterior a septiembre de 2026. La escribe el modelo de volumen: es
    descriptivo, no juzga."""
    try:
        pred = await ctx.llamar("volumen", ctx.programas.tarjeta, hipotesis=T.hipotesis_texto(h), mision=_texto_mision(ctx.inv()), afirmaciones="\n".join(f"- [{a['veredicto']}] {a['texto']} {a['cita']}" for a in h["afirmaciones"]) or "Ninguna")
        t = pred.tarjeta
        tarjeta = {"diana": t.diana.strip(), "celula": t.celula.strip(), "etapa": t.etapa.strip(), "intervencion": t.intervencion.strip(), "direccion": t.direccion, "prediccionFalsable": t.prediccion_falsable.strip(), "riesgos": [r.strip() for r in t.riesgos if r.strip()][:6], "pasoRuta": getattr(t, "paso_ruta", "mecanismo") or "mecanismo"}
    except PresupuestoAgotado:
        raise
    except VIG.ModeloSinRespuesta:
        raise
    except Exception as ex:  # noqa: BLE001
        if pista:
            pista.error(f"No se pudo completar la tarjeta de {h['titulo'][:50]}: {str(ex)[:100]}")
        tarjeta = None

    def fn(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        x["_tarjetaIntentada"] = True
        if tarjeta:
            x["tarjeta"] = tarjeta
        return True

    ctx.mutar(fn, "tarjeta")


MAX_FUENTES_SESGO = 3


async def _anotar_entidades(ctx: Ctx, h: dict[str, Any]) -> None:
    """`h["entidades"]`: identificadores canonicos (HGNC, MONDO, CL, UBERON, GO,
    ChEBI) de lo que nombra la hipotesis. Se recalcula si cambio la version."""
    if (h.get("_entidadesVersion") == h.get("version", 1)) and h.get("entidades") is not None:
        return
    t = h.get("tarjeta") or {}
    texto = " ".join([h.get("titulo", ""), h.get("enunciado", ""), h.get("mecanismo", ""), t.get("diana", ""), t.get("celula", ""), (h.get("comprobacion") or {}).get("biomarcador", "")])
    curadas = ONTO.anotar_curadas(texto)
    simbolos = simbolos_de_genes(" ".join([h.get("titulo", ""), t.get("diana", ""), (h.get("comprobacion") or {}).get("biomarcador", "")]))[:6]
    cache_ent = dict(ctx.e.get("entidadesCache") or {})
    try:
        genes = await ONTO.normalizar(simbolos, [], cache_ent) if simbolos else []
    except Exception:  # noqa: BLE001
        genes = []
    entidades = ONTO.fusionar(curadas, genes)

    def fn(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        x["entidades"] = entidades
        x["_entidadesVersion"] = x.get("version", 1)
        e["entidadesCache"] = {k: v for k, v in list(cache_ent.items())[-2000:]}
        return True

    ctx.mutar(fn, "entidades")
    h["entidades"] = entidades


def _fuentes_de_hipotesis(ctx: Ctx, h: dict[str, Any]) -> list[dict[str, Any]]:
    """Las fuentes que respaldan la hipótesis, con lo acumulado entre corridas
    (S-08): primero la copia privada de esta corrida (con fragmentos), después
    la privada de otra corrida de la misma investigación y, si no queda ninguna,
    la copia pública de la procedencia (lleva el riesgo de sesgo compacto, así
    que la comprobación de sesgo funciona sobre ella)."""
    privadas = ctx.fuentes()
    publicas = [f for f in ((h.get("procedencia") or {}).get("fuentes") or []) if isinstance(f, dict) and f.get("id")]
    otras: dict[str, dict[str, Any]] | None = None
    salida: list[dict[str, Any]] = []
    for f in publicas:
        i = f["id"]
        if i in privadas:
            salida.append(privadas[i])
            continue
        if otras is None:
            otras = {}
            for c in ctx.e.get("corridas", []) or []:
                if isinstance(c, dict) and c.get("id") != ctx.corrida_id and isinstance(c.get("_fuentes"), dict):
                    otras.update(c["_fuentes"])
        salida.append(otras[i] if i in otras else f)
    # La misma publicación registrada en dos corridas con dos ids (Raket 2026 dos
    # veces en hip-mu2tskgf-2920) es una fuente, una cohorte y un sesgo, no dos.
    vistas: set[str] = set()
    unicas: list[dict[str, Any]] = []
    for f in salida:
        claves = set(f.get("_claves") or []) or claves_de_fuente(f)
        if claves and claves & vistas:
            continue
        vistas |= claves
        unicas.append(f)
    return unicas


# ---------------------------------------------------------------------------
# Evidencia acumulada: orden por relación y recorte por caracteres (S-08, M-21)
# ---------------------------------------------------------------------------

# Cuántas veces puede fallar el juez del Killer sobre una hipótesis antes de que
# ROSA2018 deje constancia de una suspensión explícita y espere a una persona (S-09).
# Mismo valor que MAX_INTENTOS_KILLER en rosa/bucle/corrida.py.
MAX_INTENTOS_JUEZ = 3
_ORDEN_RELACION = {None: 0, "": 0, "apoya": 0, "apoya_indirecta": 1, "socava": 2, "contradice": 3}


def es_contra(a: dict[str, Any]) -> bool:
    """Una afirmación cuenta EN CONTRA de la hipótesis si su relación es
    'contradice' o 'socava', o si otra la socavó (`socavadaPor`). Es el
    complemento del predicado `apoyos_existentes` de rosa/bucle/evidencia.py:
    lo que no es apoyo no puede entrar como apoyo de signo opuesto (M-21)."""
    if not isinstance(a, dict):
        return False
    if a.get("relacion") in ("contradice", "socava"):
        return True
    s = a.get("socavadaPor")
    return bool(s) if not isinstance(s, str) else bool(s.strip())


def afirmaciones_ordenadas(afirmaciones: Any) -> list[dict[str, Any]]:
    """Las afirmaciones de una hipótesis en el orden en que conviene leerlas:
    primero las que apoyan (directas, después indirectas), luego las que
    socavan y al final las que contradicen; dentro de cada grupo, las
    sostenidas antes que las no verificadas. Estable: no cambia el orden
    relativo de las iguales. Tolera filas que no son diccionarios."""
    afs = [a for a in (afirmaciones if isinstance(afirmaciones, list) else []) if isinstance(a, dict)]
    return sorted(afs, key=lambda a: (_ORDEN_RELACION.get(a.get("relacion"), 1), 0 if a.get("veredicto") in ("sostenida", "parcial") else 1))


def recortar_lineas(lineas: list[str], maximo: int, que: str = "afirmaciones") -> str:
    """Une líneas hasta el tope de caracteres (la primera entra siempre) y, si
    sobran, lo dice con el número exacto en vez de cortar a las 8 primeras."""
    salida: list[str] = []
    total = 0
    for linea in lineas:
        if salida and total + len(linea) + 1 > maximo:
            break
        salida.append(linea)
        total += len(linea) + 1
    if len(salida) < len(lineas):
        salida.append(f"(... {len(lineas) - len(salida)} {que} más no se listan por tope de caracteres; están en la ficha)")
    return "\n".join(salida)


def _etiqueta_relacion(a: dict[str, Any]) -> str:
    if a.get("relacion") == "contradice":
        return ", EN CONTRA de la hipótesis"
    if a.get("relacion") == "socava":
        return ", SOCAVA un apoyo"
    if a.get("relacion") == "apoya_indirecta":
        return ", apoyo indirecto"
    return ""


def texto_afirmaciones_killer(h: dict[str, Any], maximo: int = 14000) -> str:
    """Lo que el juez del Killer lee de la evidencia: toda la acumulada, ordenada
    por relación (S-08), cada una con veredicto, tipo, clase, cohorte y pasaje,
    recortada por caracteres y no por las primeras N."""
    lineas = []
    for a in afirmaciones_ordenadas(h.get("afirmaciones")):
        cabecera = f"[{a.get('veredicto', 'sin_verificar')}, {a.get('tipo', 'dato')}, clase {a.get('clase', 'literatura')}{', SINTÉTICO' if a.get('sintetico') else ''}{_etiqueta_relacion(a)}{', cohorte ' + str(a['cohorte']) if a.get('cohorte') else ''}]"
        linea = f"- {cabecera} {a.get('texto', '')} {a.get('cita', '')}"
        if a.get("fragmento"):
            linea += f"\n    Pasaje: \"{str(a['fragmento'])[:240]}\""
        lineas.append(linea)
    return recortar_lineas(lineas, maximo) if lineas else "Ninguna"


def hipotesis_para_torneo(h: dict[str, Any], maximo: int = 6000, etiqueta: str = "Candidata") -> str:
    """La tarjeta que el juez del torneo compara, A CIEGAS (25 de septiembre de
    2026, arnés de Yoon y otros 2026: los nombres de fichero se anonimizan antes
    de cada par): la hipótesis y su evidencia, y nada más.

    Quedan fuera tres cosas. El título, porque el enunciado lo dice entero y más
    despacio, y porque el título es la etiqueta con la que la hipótesis se nombra
    en la interfaz y en los resúmenes de debate: es justo lo que la identifica.
    El cluster, porque es una agrupación propia de ROSA2018 y dos del mismo
    cluster son ramas hermanas: eso es linaje, no evidencia, y le dice al juez
    cuál nació de cuál. Y el bloque "Revisiones automáticas", que llevaba dentro
    el veredicto del Killer, el de la novedad y la frase "Partido en la iteración
    N contra <título del rival>: ganó", que además filtraba la identidad de un
    tercero. La caza de fallos del 23 de septiembre midió la consecuencia: el
    orden de Bradley-Terry de inv-mu2sz2ns-3 seguía al veredicto del Killer, y
    las tres últimas eran justo las tres con "descartar en contexto". Un juez que
    ya sabe el veredicto no es una segunda opinión, es un repetidor.

    Las afirmaciones van ordenadas por relación y recortadas por caracteres
    (antes solo las 8 primeras, así que una hipótesis con 28 acumuladas se
    juzgaba con la evidencia de su nacimiento). Quitar la cabecera y las
    revisiones libera unos 2.600 caracteres por tarjeta, que ocupan afirmaciones
    de verdad."""
    lineas = [f"  - [{a.get('veredicto', 'sin_verificar')}{_etiqueta_relacion(a).replace(', apoyo indirecto', ', indirecta')}] {a.get('texto', '')} {a.get('cita', '')}" for a in afirmaciones_ordenadas(h.get("afirmaciones"))]
    afs = recortar_lineas(lineas, maximo) if lineas else "  (ninguna)"
    sup = "\n".join(f"  - [{s.get('estado', 'sin_evidencia')}] {s.get('texto', '')}" for s in (h.get("supuestos") or [])[:8] if isinstance(s, dict))
    c = h.get("comprobacion") or {}
    cab = f"{etiqueta} (anónima)\nEnunciado: {h.get('enunciado', '')}\nMecanismo: {h.get('mecanismo', '')}\nComprobación: biomarcador {c.get('biomarcador', '')}; cohorte {c.get('cohorte', '')}; diseño {c.get('diseno', '')}"
    return f"{cab}\nAfirmaciones:\n{afs}\nSupuestos:\n{sup or '  (ninguno)'}"


def comprobaciones_con_contras_aparte(h: dict[str, Any], deterministas: list[dict[str, str]]) -> list[dict[str, str]]:
    """M-21: la dirección de la evidencia y las unidades se comprueban solo sobre
    las afirmaciones que cuentan a favor. Una afirmación 'contradice' enlazada
    por la búsqueda en amplitud iba al cálculo como si fuera un apoyo con el
    signo cambiado, `direccion_evidencia` fallaba y el Killer pedía reformular
    por una evidencia que en realidad es inconsistencia (un factor GRADE que
    valora rosa/certeza.py). Las contras se informan aparte en el detalle."""
    afs = [a for a in (h.get("afirmaciones") or []) if isinstance(a, dict)]
    contras = [a for a in afs if es_contra(a)]
    if not contras:
        return deterministas
    sin_contras = {**h, "afirmaciones": [a for a in afs if not es_contra(a)]}
    nuevas = {c["comprobacion"]: dict(c) for c in K.consistencia_medidas(sin_contras)}
    sostenidas_contra = sum(1 for a in contras if a.get("veredicto") in ("sostenida", "parcial"))
    nota = f" {len(contras)} afirmaciones en contra o que socavan un apoyo quedan fuera de esta comprobación: las valora la certeza GRADE como inconsistencia, no el Killer como fallo."
    salida: list[dict[str, str]] = []
    for c in deterministas:
        nombre = c.get("comprobacion")
        if nombre in nuevas:
            n = nuevas[nombre]
            if nombre == "direccion_evidencia":
                n["detalle"] = (n.get("detalle") or "") + nota
            salida.append(n)
        elif nombre == "fidelidad_evidencia" and c.get("resultado") == "pasa":
            salida.append({**c, "detalle": f"{c.get('detalle', '')}; {sostenidas_contra} en contra, también sostenidas por su fuente"})
        else:
            salida.append(c)
    return salida


def _huella(h: dict[str, Any]) -> str:
    """`rosa.killer.huella_evidencia` (grupo D) o, si aún no existe, un hash
    local de ids de afirmaciones, fuentes y versión con el mismo sentido."""
    fn = getattr(K, "huella_evidencia", None)
    if callable(fn):
        try:
            v = fn(h)
            if isinstance(v, str) and v:
                return v
        except Exception:  # noqa: BLE001
            pass
    import hashlib
    import json

    afs = sorted(str(a.get("afirmacionId") or a.get("texto") or "") + "|" + str(a.get("veredicto")) + "|" + str(a.get("relacion")) for a in (h.get("afirmaciones") or []) if isinstance(a, dict))
    fuentes = sorted(str(f.get("id") or "") for f in ((h.get("procedencia") or {}).get("fuentes") or []) if isinstance(f, dict))
    return hashlib.sha256(json.dumps([afs, fuentes, h.get("version", 1)], sort_keys=True).encode("utf-8")).hexdigest()[:16]


def _decisiones_killer_de(e: dict[str, Any], hipotesis_id: str) -> list[dict[str, Any]]:
    return [d for d in (e.get("decisiones") or []) if isinstance(d, dict) and d.get("hipotesisId") == hipotesis_id and str(d.get("etapa", "")).startswith("killer")]


def indice_auditoria(e: dict[str, Any], investigacion_id: str, excluir_id: str | None = None) -> int:
    """Cuántas decisiones descartar o reformular del Killer (etapa killer_1)
    lleva ya la investigación, sin contar la recién registrada. Es el índice
    del muestreo de la auditoría (S-12): antes se contaba por corrida y, como
    cada corrida arrancaba en 0 y el índice 0 siempre se audita, se auditaba el
    69 % en vez del 34 % de la política."""
    return sum(1 for d in (e.get("decisiones") or []) if isinstance(d, dict) and d.get("investigacionId") == investigacion_id and d.get("etapa") == "killer_1" and d.get("decision") in ("descartar_en_contexto", "reformular") and d.get("id") != excluir_id)


def normalizar_comprobacion_discutida(texto: Any, nombres: list[str]) -> str:
    """El nombre canónico de la comprobación que el auditor pone en duda (lo
    escribe libre: 'supuestos', 'Supuestos', 'fidelidad de la evidencia'). Vacío
    si no casa con ninguna de la decisión."""
    import unicodedata

    plano = "".join(ch for ch in unicodedata.normalize("NFKD", str(texto or "")) if not unicodedata.combining(ch))
    t = re.sub(r"[^a-z0-9_ ]", "", plano.strip().lower().replace("-", "_")).replace(" ", "_")
    t = re.sub(r"_+", "_", t).strip("_")
    if not t:
        return ""
    for n in nombres:
        if t == n:
            return n
    for n in nombres:
        if n in t or t in n or n.replace("_", "") == t.replace("_", "") or n.replace("_evidencia", "") == t.replace("_de_la_evidencia", "").replace("_evidencia", ""):
            return n
    return ""


_AUSENCIA = re.compile(r"ning[uú]n[ao]?s?\s+(?:de\s+las\s+)?(?:afirmaci[oó]n(?:es)?|fuentes?|evidencia)\s+(?:lo|la|los|las|le)?\s*(?:menciona|mencionan|toca|tocan|habla|hablan|trata|tratan|aborda|abordan|nombra|nombran|se refiere|se refieren|respalda|respaldan|contradice|contradicen|niega|niegan)|no\s+(?:hay|existe|aparece|se encuentra|se menciona)\s+(?:ninguna\s+|una\s+)?(?:afirmaci[oó]n|evidencia|dato|menci[oó]n)|no (?:lo|la) mencionan?|none of the (?:claims|statements)|no (?:claim|statement) mentions", re.I)


def validar_supuesto_evaluado(estado: Any, evidencia: Any, indices: Any, afirmaciones: list[dict[str, Any]]) -> tuple[str, str, list[str]]:
    """Regla sobre lo que devuelve `EvaluarSupuesto` (S-10): 'contradicho' solo
    vale si señala al menos una afirmación de la lista numerada que se le pasó
    (índices 1..N válidos) y la evidencia no dice que ninguna afirmación lo
    menciona; si no, baja a 'sin_evidencia' con la evidencia original conservada
    y la nota de por qué. Ausencia no es negación. Devuelve (estado, evidencia,
    ids de las afirmaciones que lo niegan)."""
    estado = str(estado or "sin_evidencia").strip()
    if estado not in VIGENCIA.ESTADOS_SUPUESTO_DEL_MODELO:
        # `no_evaluado` tampoco: ese lo pone ROSA2018 cuando la llamada falla,
        # nunca el modelo, que no puede declararse a sí mismo sin respuesta.
        estado = "sin_evidencia"
    evidencia = str(evidencia or "").strip()
    validos: list[int] = []
    for i in (indices if isinstance(indices, (list, tuple)) else []):
        try:
            n = int(i)
        except (TypeError, ValueError):
            continue
        if 1 <= n <= len(afirmaciones) and n not in validos:
            validos.append(n)
    ids = [str(afirmaciones[n - 1].get("afirmacionId") or afirmaciones[n - 1].get("id") or f"#{n}") for n in validos]
    if estado == "contradicho":
        ausencia = bool(_AUSENCIA.search(evidencia))
        if not validos or ausencia:
            motivo = "la evidencia dice que ninguna afirmación lo menciona" if ausencia else "el evaluador no señaló ninguna afirmación de la lista que lo niegue"
            estado = "sin_evidencia"
            evidencia = f"{evidencia[:400]} | Rebajado a 'sin evidencia' por regla: {motivo}; ausencia no es negación."
            ids = []
    return estado, evidencia, ids


DONDE_SE_RESPONDE = ("literatura", "catalogo_de_cohorte", "registro_de_ensayos", "analisis_de_datos", "experimento_nuevo")
_TIENE_CIFRA = re.compile(r"\d")


def alcance_del_supuesto(estado: str, indices_tocan: Any, ids_niegan: list[str], donde: Any, cota: Any, afirmaciones: list[dict[str, Any]]) -> dict[str, Any]:
    """Qué significa el estado de un supuesto (regla 3 de rosa/vigencia.py, 23 de
    septiembre de 2026). "Sin evidencia" decía lo mismo cuando las afirmaciones de
    la corrida no hablaban del tema que cuando hablaban y no lo resolvían; el
    primero no informa de nada, el segundo sí. Viene de las conversaciones de
    Claude Science, que nunca escriben "refutado" a secas: separan "no evaluado"
    de "refutado", y un nulo con potencia de uno sin ella.

    - `alcance`: 'resuelto' si el estado es respaldado o contradicho; si no,
      'tocado_sin_respuesta' cuando alguna afirmación trata el tema, y
      'no_tocado' cuando ninguna. Lo decide la regla con los índices, no el
      modelo: los índices se validan contra la lista numerada (1..N) como los de
      `validar_supuesto_evaluado`, y las que lo niegan cuentan como que lo tocan.
      El cuarto valor, 'no_evaluado', no sale de aquí: lo pone `_revisar_hipotesis`
      cuando el modelo no respondió.
    - `dondeSeResponde`: dónde estaría la respuesta; None si el modelo dio algo
      fuera de la lista, que no se adivina.
    - `cota`: el límite de un nulo acotado. Sin una cifra no es un límite y se
      descarta.
    """
    tocan: list[int] = []
    for i in (indices_tocan if isinstance(indices_tocan, (list, tuple)) else []):
        try:
            n = int(i)
        except (TypeError, ValueError):
            continue
        if 1 <= n <= len(afirmaciones) and n not in tocan:
            tocan.append(n)
    ids = [str(afirmaciones[n - 1].get("afirmacionId") or afirmaciones[n - 1].get("id") or f"#{n}") for n in tocan]
    for x in ids_niegan:
        if x not in ids:
            ids.append(x)
    if estado in ("respaldado", "contradicho"):
        alcance = "resuelto"
    elif ids:
        alcance = "tocado_sin_respuesta"
    else:
        alcance = "no_tocado"
    donde = str(donde or "").strip()
    cota = str(cota or "").strip()
    return {
        "alcance": alcance,
        "tocaAfirmaciones": ids,
        "dondeSeResponde": donde if donde in DONDE_SE_RESPONDE else None,
        "cota": cota[:300] if _TIENE_CIFRA.search(cota) else "",
    }


def fusionar_supuestos(existentes: Any, del_revisor: Any, nunca_revisada: bool, maximo: int = 12) -> list[dict[str, Any]]:
    """Los supuestos con los que se evalúa la hipótesis (S-10): se conservan los
    que ya tenía (los del generador, con origen 'generador'; en un registro ya
    revisado antes de esta regla el origen se deja como esté) y se añaden los
    que descompone el revisor inicial con origen 'revisor', sin repetir textos
    (por texto normalizado) y reutilizando el id para que los hallazgos no se
    dupliquen entre pasadas. Antes la lista del revisor sustituía a la del
    generador entera, con ids nuevos cada vez."""
    salida: list[dict[str, Any]] = []
    vistos: set[str] = set()
    for s in (existentes if isinstance(existentes, list) else []):
        if not isinstance(s, dict):
            continue
        texto = str(s.get("texto") or "").strip()
        clave = V.normalizar(texto)
        if not texto or clave in vistos:
            continue
        vistos.add(clave)
        item = {"id": s.get("id") or P.nuevo_id("sup"), "texto": texto, "estado": s.get("estado") or "sin_evidencia", "evidencia": s.get("evidencia") or "Pendiente", "hijos": s.get("hijos") if isinstance(s.get("hijos"), list) else []}
        origen = s.get("origen") or ("generador" if nunca_revisada else None)
        if origen:
            item["origen"] = origen
        salida.append(item)
    for t in (del_revisor if isinstance(del_revisor, (list, tuple)) else []):
        texto = str(t or "").strip()
        clave = V.normalizar(texto)
        if not texto or clave in vistos:
            continue
        vistos.add(clave)
        salida.append({"id": P.nuevo_id("sup"), "texto": texto[:400], "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": [], "origen": "revisor"})
    return salida[:maximo]


def _clave_afirmacion(a: dict[str, Any]) -> str:
    return str(a.get("afirmacionId") or a.get("id") or V.normalizar(str(a.get("texto") or "")))


def afirmaciones_para_supuestos(h: dict[str, Any], de_la_corrida: list[dict[str, Any]], maximo: int = 8000) -> tuple[str, list[dict[str, Any]]]:
    """La lista numerada contra la que se evalúan los supuestos (S-08): primero
    las afirmaciones sostenidas o parciales de la propia hipótesis (toda su
    evidencia acumulada, ordenada por relación y con las contras marcadas) y
    después las de la corrida que no estén ya. Se recorta por caracteres
    completando afirmaciones enteras, para que la numeración que ve el modelo
    sea exactamente la lista contra la que se validan los índices."""
    lista: list[dict[str, Any]] = []
    vistos: set[str] = set()
    for a in afirmaciones_ordenadas(h.get("afirmaciones")):
        if a.get("veredicto") not in ("sostenida", "parcial"):
            continue
        clave = _clave_afirmacion(a)
        if clave in vistos:
            continue
        vistos.add(clave)
        copia = dict(a)
        copia.setdefault("tipo", "dato")
        copia.setdefault("cita", "")
        if es_contra(a):
            copia["texto"] = f"{copia.get('texto', '')} [EN CONTRA de la hipótesis]"
        lista.append(copia)
    for a in (de_la_corrida if isinstance(de_la_corrida, list) else []):
        if not isinstance(a, dict) or a.get("veredicto") not in ("sostenida", "parcial"):
            continue
        clave = _clave_afirmacion(a)
        if clave in vistos:
            continue
        vistos.add(clave)
        lista.append(a)
    seleccion: list[dict[str, Any]] = []
    total = 0
    for a in lista:
        coste = len(str(a.get("texto") or "")) + len(str(a.get("cita") or "")) + 24
        if seleccion and total + coste > maximo:
            break
        seleccion.append(a)
        total += coste
    return T.afirmaciones_sostenidas(seleccion)


def _hallazgo_abierto(x: dict[str, Any], resumen: str) -> dict[str, Any] | None:
    return next((z for z in (x.get("hallazgos") or []) if isinstance(z, dict) and z.get("estado") == "abierto" and z.get("resumen") == resumen), None)


def _atender_hallazgos(x: dict[str, Any], prefijo: str, respuesta: str) -> int:
    n = 0
    for z in (x.get("hallazgos") or []):
        if isinstance(z, dict) and z.get("estado") == "abierto" and str(z.get("resumen") or "").startswith(prefijo):
            z["estado"] = "atendido"
            z["respuestaDeRosa"] = respuesta
            n += 1
    return n


def _hubo_accion_humana_despues(e: dict[str, Any], x: dict[str, Any], excluir_id: str | None = None) -> bool:
    """Si la última palabra sobre la hipótesis la tuvo una persona (decisión de
    etapa 'persona' posterior a la última del Killer), el Killer no le cambia el
    estado por su cuenta. `excluir_id` es la decisión que el Killer acaba de
    registrar en esta misma pasada: sin excluirla, la última del Killer era
    siempre la de ahora mismo y ninguna persona podía ser posterior (adversario
    del 17 de septiembre de 2026: la protección solo saltaba con fechas del
    futuro)."""
    propias = [d for d in (e.get("decisiones") or []) if isinstance(d, dict) and d.get("hipotesisId") == x.get("id") and (excluir_id is None or d.get("id") != excluir_id)]
    ultima_persona = max((int(d.get("fecha") or 0) for d in propias if d.get("etapa") == "persona"), default=-1)
    ultima_killer = max((int(d.get("fecha") or 0) for d in propias if str(d.get("etapa", "")).startswith("killer")), default=-1)
    return ultima_persona > ultima_killer


# Revisiones que escribe la propia ROSA2018 sin que medie una persona: no cuentan
# como "última palabra" de nadie al decidir si el Killer puede cambiar el estado.
_REVISIONES_AUTOMATICAS = ("killer", "suspendida", "propuesta", "reformulada")
# Revisiones que señalan un diálogo abierto con una persona: un comentario suyo
# (acciones.enviar_comentarios deja la hipótesis en_revision), un "no puedo
# juzgar" y la aclaración de ROSA2018 que lo responde. Mientras duren, el estado lo
# cambia la persona, no el Killer.
_REVISIONES_DIALOGO = ("comentada", "aclarada", "no_puedo_juzgar")


def _sacar_de_revision_si_toca(e2: dict[str, Any], x: dict[str, Any], anterior: str | None, decision: str, nota: str, decision_id: str | None = None) -> str | None:
    """M-19: una hipótesis que está `en_revision` porque el propio Killer propuso
    descartarla (la decisión anterior fue descartar, o sigue abierto el hallazgo
    'El Killer propone descartarla': en el estado real hay hipótesis con la
    decisión ya en 'avanzar' y el hallazgo abierto por el código viejo) o porque
    una persona la reabrió, vuelve a `propuesta` cuando el Killer decide después
    avanzar, suspender o reformular, y el hallazgo queda atendido. Si hay un
    diálogo abierto con una persona (comentario, "no puedo juzgar", aclaración)
    o la última decisión fue de una persona, el hallazgo se atiende igual (el
    Killer ya no propone descartarla) pero el estado no se toca. Devuelve
    'propuesta' si cambió el estado, 'hallazgo' si solo atendió el hallazgo y
    None si no había nada que hacer."""
    if x.get("estado") != "en_revision" or decision not in ("avanzar", "suspender", "reformular"):
        return None
    hallazgo_abierto = _hallazgo_abierto(x, "El Killer propone descartarla en este contexto") is not None
    # La última revisión que no escribió la propia ROSA2018 por su cuenta.
    ultima_ajena = next((r for r in reversed(x.get("revisiones") or []) if isinstance(r, dict) and r.get("accion") not in _REVISIONES_AUTOMATICAS), None)
    accion_ajena = ultima_ajena.get("accion") if ultima_ajena else None
    reabierta = accion_ajena == "reabierta"
    if anterior != "descartar_en_contexto" and not hallazgo_abierto and not reabierta:
        return None
    _atender_hallazgos(x, "El Killer propone descartarla", nota)
    if accion_ajena in _REVISIONES_DIALOGO:
        return "hallazgo"
    if _hubo_accion_humana_despues(e2, x, decision_id) and not reabierta:
        return "hallazgo"
    x["estado"] = "propuesta"
    return "propuesta"


def _registrar_juez_sin_respuesta(ctx: Ctx, h: dict[str, Any], deterministas: list[dict[str, str]], error: str, pista: Pista | None) -> str:
    """S-09: el juez del Killer no respondió (tiempo agotado, adaptador que no
    parsea, filtro). No se registra ninguna decisión: la hipótesis conserva su
    `decisionKiller` y su motivo anteriores, queda con `_revisionPedida` para
    que el siguiente paso la repita y se cuenta el intento en `_killerIntentos`.
    A partir de MAX_INTENTOS_JUEZ intentos se registra una decisión explícita
    'suspender' con el motivo técnico y una cuestión, y se deja de insistir hasta
    que una persona pida la revisión o llegue evidencia nueva. Devuelve
    'pendiente' o 'suspender'."""
    ahora = P.ahora_ms()
    quien = ctx.modelos.juez.model
    ruta = f"#/investigaciones/{ctx.investigacion_id}/hipotesis/{h['id']}"
    resultado = {"decision": "pendiente", "intentos": 0}

    def fn(e2: dict[str, Any]) -> bool:
        x = next((y for y in e2["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        intentos = int(x.get("_killerIntentos") or 0) + 1
        resultado["intentos"] = intentos
        if intentos < MAX_INTENTOS_JUEZ:
            x["_killerIntentos"] = intentos
            x["_revisionPedida"] = True
            # Clave pública para la ficha (S-09): la interfaz enseña "pendiente de
            # juicio" en vez de la decisión anterior mientras el juez no responde.
            x["killerPendiente"] = {"intentos": intentos, "maximo": MAX_INTENTOS_JUEZ, "motivo": f"el juez no respondió (intento {intentos} de {MAX_INTENTOS_JUEZ})"}
            x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"El juez del Killer no respondió (motivo técnico, intento {intentos} de {MAX_INTENTOS_JUEZ}): {error[:160]}. La decisión anterior se conserva y la revisión se repite en el siguiente paso.", "creadoEn": ahora})
            A.con_evento(e2, ctx.investigacion_id, "killer", f"Killer pendiente de juicio sobre «{x['titulo'][:70]}»: el juez no respondió (intento {intentos} de {MAX_INTENTOS_JUEZ}); se repite en el siguiente paso", ruta, ahora)
            return True
        # Tope: decisión explícita, técnica y visible, y se deja de insistir.
        motivo = f"El juez no respondió {intentos} veces (motivo técnico, no científico): pendiente de que una persona pida la revisión o de que llegue evidencia nueva. Último error: {error[:120]}"
        falta = "Que el juez responda: pide la revisión desde la ficha cuando el modelo esté disponible"
        d = A.registrar_decision(e2, x, "killer_1", "suspender", motivo, quien, ahora, deterministas, falta)
        d["corridaId"] = ctx.corrida_id
        d["sinJuez"] = True
        # Huella también aquí: rosa/bucle/corrida.py::pedir_revision_por_huella la
        # compara con la actual; sin ella comparaba con una decisión anterior y
        # pedía otros tres juicios sobre la misma evidencia.
        d["huella"] = _huella(x)
        x["_huellaKiller"] = d["huella"]
        x["decisionKiller"] = "suspender"
        x["_killerIntentos"] = 0
        x.pop("_revisionPedida", None)
        x.pop("killerPendiente", None)
        CU.desde_killer(e2, x, falta, ahora)
        x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "killer", "nota": f"suspender: {motivo[:240]}", "aCiegas": False})
        x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "suspendida", "nota": falta, "aCiegas": False})
        x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"Hypothesis Killer (v{x.get('version', 1)}): suspender. {motivo}", "creadoEn": ahora})
        A.con_evento(e2, ctx.investigacion_id, "killer", f"El Killer deja suspendida «{x['titulo'][:70]}» hasta que una persona pida la revisión: el juez no respondió {intentos} veces", ruta, ahora)
        A.recalcular_bloqueos(e2, x)
        resultado["decision"] = "suspender"
        return True

    ctx.mutar(fn, "killer_sin_juez")
    ctx.incidencia("juez_sin_respuesta", f"El Killer no pudo juzgar «{h['titulo'][:60]}»", error[:400], h["id"], f"Se repite en el siguiente paso de hipótesis; a los {MAX_INTENTOS_JUEZ} intentos la hipótesis queda suspendida hasta que una persona pida la revisión desde la ficha.")
    if pista:
        if resultado["decision"] == "pendiente":
            pista.error(f"El Killer no respondió para {h['titulo'][:50]} (intento {resultado['intentos']} de {MAX_INTENTOS_JUEZ}): {error[:100]}; la hipótesis queda pendiente de juicio, no suspendida")
        else:
            pista.error(f"El Killer no respondió {resultado['intentos']} veces para {h['titulo'][:50]}: queda suspendida hasta que una persona pida la revisión")
    return resultado["decision"]


def _texto_fuente_para_sesgo(f: dict[str, Any]) -> str:
    partes = [f.get("titulo") or "", f.get("resumen") or f.get("fragmento") or ""]
    partes += [fr.get("texto", "") for fr in (f.get("fragmentos") or [])[:8]]
    return "\n".join(x for x in partes if x)[:9000]


async def _evaluar_sesgo_fuentes(ctx: Ctx, h: dict[str, Any], pista: Pista | None) -> None:
    """Riesgo de sesgo por instrumento para las fuentes primarias de la
    hipotesis que aun no lo tienen (hasta MAX_FUENTES_SESGO por pasada, las
    mas relevantes). Se guarda en la fuente privada y en la copia publica."""
    pendientes = []
    for f in _fuentes_de_hipotesis(ctx, h):
        if f.get("riesgoSesgo") or f.get("retraccion") == "retractado":
            continue
        clave = SESGO.instrumento_para(f.get("tipoEstudio"), (f.get("titulo") or "") + " " + (f.get("resumen") or ""))
        if clave:
            pendientes.append((f, clave))
    pendientes.sort(key=lambda x: -x[0].get("relevancia", 0))
    for f, clave in pendientes[:MAX_FUENTES_SESGO]:
        try:
            pred = await ctx.llamar("juez", ctx.programas.senalizacion, instrumento_y_preguntas=SESGO.texto_preguntas(clave), referencia=f.get("referencia", ""), texto=K.como_dato(_texto_fuente_para_sesgo(f)))
            respuestas = [{"id": r.id, "respuesta": r.respuesta, "cita": r.cita} for r in pred.respuestas]
        except PresupuestoAgotado:
            raise
        except VIG.ModeloSinRespuesta:
            raise
        except Exception as ex:  # noqa: BLE001
            if pista:
                pista.error(f"Riesgo de sesgo de {f.get('referencia', '')[:40]} sin evaluar: {str(ex)[:100]}")
            continue
        evaluacion = SESGO.evaluar(clave, respuestas, ctx.modelos.juez.model, P.ahora_ms())
        compacta = {k: evaluacion[k] for k in ("instrumento", "clave", "version", "global", "resumen", "fecha", "modelo")} | {"dominios": [{"id": d["id"], "nombre": d["nombre"], "juicio": d["juicio"], "motivo": d["motivo"]} for d in evaluacion["dominios"]]}
        if pista:
            pista.resultado(f"{f.get('referencia', '')[:50]}: {evaluacion['resumen'][:160]}")

        def fn(e: dict[str, Any], fid=f["id"], ev=evaluacion, comp=compacta) -> bool:
            c = next(x for x in e["corridas"] if x["id"] == ctx.corrida_id)
            priv = c.get("_fuentes", {}).get(fid)
            if priv is not None:
                priv["riesgoSesgo"] = ev
            for x in e["hipotesis"]:
                for fu in (x.get("procedencia") or {}).get("fuentes", []):
                    if fu.get("id") == fid:
                        fu["riesgoSesgo"] = comp
            return True

        ctx.mutar(fn, "riesgo_sesgo")


CLASES_ALTERNATIVA = ("causa_inversa", "confusor", "seleccion", "artefacto", "otra")
_ALT_INVERSA = re.compile(r"invers|reverse|revers", re.I)
_ALT_CONFUSOR = re.compile(r"confusor|confund|confound|\bedad\b|\bage\b|ageing|aging|causa com[úu]n|common cause", re.I)
_ALT_SELECCION = re.compile(r"selecci[óo]n|selection|supervivencia|survivor|survival|colider|collider", re.I)
_ALT_ARTEFACTO = re.compile(r"artefact|artifact|batch|\blote\b|medici[óo]n|measurement|plataforma|platform|preanal[íi]tic|preanalytic|ensayo|assay", re.I)


def clasificar_alternativa(texto: str) -> str:
    """La clase de una explicación alternativa, por palabras: causa inversa
    (Y causa X), confusor (una causa común, como la edad), selección
    (supervivencia, colisionador), artefacto (medida, lote, plataforma) u
    otra. Delega en la regla de rosa/causal.py cuando existe, para que el
    grafo causal y la lista de alternativas clasifiquen igual; si no, aplica
    una regla mínima equivalente. Nunca lanza."""
    t = str(texto or "")
    regla = getattr(CAUSAL, "_clasificar_alternativa", None) or getattr(CAUSAL, "clasificar_alternativa", None)
    if callable(regla):
        try:
            clase = regla(t)
            if clase in CLASES_ALTERNATIVA:
                return clase
        except Exception:  # noqa: BLE001
            pass
    if _ALT_INVERSA.search(t):
        return "causa_inversa"
    if _ALT_CONFUSOR.search(t):
        return "confusor"
    if _ALT_SELECCION.search(t):
        return "seleccion"
    if _ALT_ARTEFACTO.search(t):
        return "artefacto"
    return "otra"


def alternativas_de_revision(alternativas: Any) -> list[dict[str, str]]:
    """Las alternativas que devuelve `RevisionKiller` (objetos con `texto` y
    `que_la_distinguiria`, o cadenas sueltas de un programa antiguo) como
    lista de {texto, queLaDistinguiria}, sin vacíos ni repetidos."""
    salida: list[dict[str, str]] = []
    vistos: set[str] = set()
    for a in (alternativas if isinstance(alternativas, (list, tuple)) else []):
        if isinstance(a, str):
            texto, dist = a, ""
        elif isinstance(a, dict):
            texto, dist = a.get("texto") or "", a.get("que_la_distinguiria") or a.get("queLaDistinguiria") or ""
        else:
            texto, dist = getattr(a, "texto", "") or "", getattr(a, "que_la_distinguiria", "") or ""
        texto = str(texto).strip()
        if not texto or V.normalizar(texto) in vistos:
            continue
        vistos.add(V.normalizar(texto))
        salida.append({"texto": texto[:400], "queLaDistinguiria": str(dist).strip()[:400]})
    return salida


def anadir_alternativas(x: dict[str, Any], nuevas: list[dict[str, str]], iteracion: int | None) -> int:
    """Escribe en `x["alternativas"]` las alternativas nuevas con la forma
    {texto, clase, queLaDistinguiria, iteracion}, sin repetir textos ya
    presentes (por texto normalizado). Un registro antiguo sin la clave o con
    algo que no es lista arranca de cero. Devuelve cuántas entraron."""
    previas = x.get("alternativas")
    lista = [a for a in previas if isinstance(a, dict) and a.get("texto")] if isinstance(previas, list) else []
    vistos = {V.normalizar(str(a.get("texto") or "")) for a in lista}
    n = 0
    for a in nuevas:
        clave = V.normalizar(a["texto"])
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        lista.append({"texto": a["texto"], "clase": clasificar_alternativa(a["texto"]), "queLaDistinguiria": a.get("queLaDistinguiria", ""), "iteracion": iteracion})
        n += 1
    x["alternativas"] = lista
    return n


def datasets_para_plan(e: dict[str, Any], investigacion_id: str | None, pregunta: str | None, maximo: int = 12) -> str:
    """El texto de `datasets_disponibles` para la firma `ProponerPlan`: el
    registro de datasets del programa (los de esta investigación primero) y,
    debajo, los que coinciden con la pregunta de la corrida por términos
    (accession, tipo, acceso, con qué coinciden); los de acceso controlado
    llevan su aviso y no se proponen para análisis. Nunca lanza: si el
    registro falla, lo dice."""
    # La pregunta y el id llegan a veces como None o como algo que no es texto
    # (un registro antiguo, una llamada de prueba): se normalizan una vez.
    pregunta = str(pregunta).strip() if isinstance(pregunta, str) else ("" if pregunta is None else str(pregunta).strip())
    investigacion_id = investigacion_id if isinstance(investigacion_id, str) and investigacion_id else None
    try:
        texto = DP.texto_registro(e, investigacion_id, maximo=maximo)
    except Exception as ex:  # noqa: BLE001
        texto = f"No pude leer el registro de datasets del programa ({type(ex).__name__})."
    try:
        casan = DP.coincidencias(e, pregunta) if pregunta else []
    except Exception:  # noqa: BLE001
        casan = []
    if casan:
        lineas = ["Coinciden con la pregunta de esta corrida:"]
        for c in casan[:maximo]:
            acceso = c.get("acceso") or "desconocido"
            linea = f"- {c.get('accession') or c.get('id')} ({c.get('fuente') or 'fuente sin registrar'}; tipo {c.get('tipo') or 'sin comprobar'}; acceso {acceso}): coincide en {', '.join(c.get('coincide') or []) or 'nada concreto'}"
            if c.get("aviso") or acceso == "controlado":
                linea += f". AVISO: {c.get('aviso') or 'acceso controlado; el proyecto no lo pide, no se propone para análisis'}"
            lineas.append(linea)
        texto += "\n" + "\n".join(lineas)
    elif pregunta:
        texto += "\nNingún dataset del registro coincide por términos con la pregunta de esta corrida."
    return texto


async def _killer(ctx: Ctx, h: dict[str, Any], texto_afirmaciones: str, pista: Pista | None, profundidad: int = 0) -> str:
    """El Hypothesis Killer sobre la versión actual de la hipótesis. Devuelve
    la decisión. Si decide reformular, reformula (versión nueva) y vuelve a
    juzgar la nueva versión, hasta el límite de la política."""
    e = ctx.e
    inv = ctx.inv()
    h = next((y for y in e["hipotesis"] if y["id"] == h["id"]), h)
    if h.get("tarjeta") is None and not h.get("_tarjetaIntentada"):
        await _completar_tarjeta(ctx, h, pista)
        h = next((y for y in e["hipotesis"] if y["id"] == h["id"]), h)
    try:
        await contexto_de_bases(ctx, h, pista)
    except Exception as ex:  # noqa: BLE001
        if pista:
            pista.nota(f"Las bases no respondieron para la diana: {str(ex)[:100]}")
    # ¿Se puede hacer la prueba con los ensayos que nombra? Si es revisar lo ya
    # publicado, se leen sus criterios de elegibilidad antes de que el Killer juzgue la
    # factibilidad (rosa/viabilidad.py). Una vez por versión de la prueba.
    try:
        await VIA.asegurar(ctx, h, pista)
    except EXCEPCIONES_QUE_CORTAN_EL_PASO:  # presupuesto, modelo caído o corrida parada
        raise
    except Exception as ex:  # noqa: BLE001  la viabilidad no tumba al Killer
        if pista:
            pista.nota(f"No se pudo comprobar la viabilidad de la prueba: {str(ex)[:100]}")
    h = next((y for y in e["hipotesis"] if y["id"] == h["id"]), h)
    deterministas = K.comprobaciones_deterministas(h, e)
    # Entidades canonicas de la hipotesis (HGNC para la diana, diccionario curado
    # para lo demas) y redundancia por identificador: dos hipotesis vivas que
    # comparten dos o mas entidades canonicas hablan quiza de lo mismo con otras
    # palabras; el juez lo recibe como pista, no como veredicto.
    await _anotar_entidades(ctx, h)
    # Con quién es redundante (ids): el torneo les fuerza un partido dirimente y,
    # si el juez las declara equivalentes, se fusionan (fusión de ramas).
    redundantes_ids: list[str] = []
    if not any(c["comprobacion"] == "redundancia" for c in deterministas):
        parecidas = [(x, ONTO.comparten(h.get("entidades"), x.get("entidades"))) for x in e["hipotesis"] if x["id"] != h["id"] and x["investigacionId"] == h["investigacionId"] and x["estado"] != "descartada"]
        parecidas = [(x, c) for x, c in parecidas if c]
        if parecidas:
            redundantes_ids += [x["id"] for x, _ in parecidas[:3]]
            deterministas.append({"comprobacion": "redundancia", "resultado": "no_comprobable", "detalle": "Comparte entidades canónicas con: " + "; ".join(f"{x['titulo'][:60]} ({', '.join(c)})" for x, c in parecidas[:3]) + ". El juez decide si es la misma hipótesis con otras palabras."})
    # Redundancia por significado (índice semántico): también contra las
    # descartadas, porque repetir una descartada con otras palabras es el
    # anclaje que más cuesta ver.
    if not any(c["comprobacion"] == "redundancia" for c in deterministas):
        try:
            semejantes = await indice_semantico.hipotesis_parecidas(ctx.almacen, h)
        except FuenteNoDisponible as ex:
            semejantes = []
            if pista:
                pista.nota(f"Índice semántico sin respuesta: {str(ex)[:80]}")
        if semejantes:
            redundantes_ids += [x["id"] for x in semejantes[:3] if x.get("id") and x.get("estado") != "descartada"]
            resultado = "falla" if any(x["estado"] == "descartada" and x["similitud"] >= 0.95 for x in semejantes) else "no_comprobable"
            deterministas.append({"comprobacion": "redundancia", "resultado": resultado, "detalle": "Por significado se parece a: " + "; ".join(f"{x['titulo'][:60]} (similitud {x['similitud']:.2f}, {x['estado']}{', Killer: ' + x['decisionKiller'] if x.get('decisionKiller') else ''})" for x in semejantes[:3]) + (". Repite casi literalmente una hipótesis ya descartada." if resultado == "falla" else ". El juez decide si es la misma hipótesis con otras palabras.")})
    # Riesgo de sesgo por instrumento (RoB 2, ROBINS-I, QUADAS-2, ROBIS, SYRCLE):
    # el modelo responde las preguntas de senalizacion de cada fuente primaria y
    # el veredicto lo pone la regla del instrumento. Sustituye al juicio libre.
    await _evaluar_sesgo_fuentes(ctx, h, pista)
    deterministas = [c for c in deterministas if c["comprobacion"] != "sesgo_evidencia"] + [SESGO.comprobacion_sesgo(_fuentes_de_hipotesis(ctx, h))]
    # M-21: las afirmaciones en contra no entran en la dirección de la evidencia
    # como apoyos de signo opuesto; se informan aparte y las valora GRADE.
    deterministas = comprobaciones_con_contras_aparte(h, deterministas)
    # El comprobador de supuestos causales entra como una comprobacion mas: si
    # la identificacion no cierra, direccion_causal queda "no comprobable" con
    # los supuestos que faltan (el juez o un experimento los resuelven).
    if not any(c["comprobacion"] == "direccion_causal" for c in deterministas):
        indep_previa = next((c["resultado"] for c in deterministas if c["comprobacion"] == "independencia_cohortes"), None)
        grafo_previo = CAUSAL.grafo_local(h, [], True if indep_previa == "pasa" else False if indep_previa == "falla" else None, P.ahora_ms())
        if grafo_previo["identificacion"] == "identificable":
            deterministas.append({"comprobacion": "direccion_causal", "resultado": "pasa", "detalle": "Identificación por regla: " + "; ".join(grafo_previo["supuestosCumplidos"])[:300]})
        elif grafo_previo["identificacion"] in ("acotado", "sin_resolver"):
            deterministas.append({"comprobacion": "direccion_causal", "resultado": "no_comprobable", "detalle": f"Identificación {grafo_previo['identificacion']}: faltan " + "; ".join(grafo_previo["supuestosFaltantes"])[:300]})
    # Toda la evidencia acumulada, ordenada por relación y recortada por caracteres (S-08).
    afs_texto = texto_afirmaciones_killer(h)
    mundo_h = await T.modelo_de_mundo_para(ctx.almacen, ctx.investigacion_id, f"{h['titulo']}. {h['enunciado']}", maximo=40)
    juez_fallo: str | None = None
    try:
        pred = await ctx.llamar(
            "juez",
            ctx.programas.killer,
            objetivo=inv["objetivo"],
            mision=_texto_mision(inv),
            hipotesis=T.hipotesis_texto(h) + "\n" + K.texto_tarjeta(h) + "\n" + DI.texto_perfil(h.get("perfilDiana")),
            afirmaciones=afs_texto,
            # Registros incompletos (supuesto sin 'evidencia', o un texto suelto) no
            # pueden convertirse en "el juez no respondió": este argumento se monta
            # dentro del mismo try que la llamada al modelo.
            supuestos="\n".join(f"- [{s.get('estado', 'sin_evidencia')}] {s.get('texto', '')} ({s.get('evidencia') or 'sin evaluar'})" for s in (h.get("supuestos") or []) if isinstance(s, dict) and s.get("texto")) or "Sin supuestos evaluados",
            modelo_de_mundo=mundo_h + "\n\nOtras hipótesis vivas:\n" + T.hipotesis_existentes([x for x in e["hipotesis"] if x["id"] != h["id"]], ctx.investigacion_id),
            comprobaciones_deterministas="\n".join(f"- {c['comprobacion']}: {c['resultado']}. {c['detalle']}" for c in deterministas),
            criterios_revision="\n".join(e["criteriosRevision"]),
        )
        rev = pred.revision
        del_juez = [{"comprobacion": c.comprobacion, "resultado": c.resultado, "detalle": c.detalle} for c in rev.comprobaciones]
        alternativas_rev = alternativas_de_revision(getattr(rev, "alternativas", None))[:4]
        # `alternativas` sigue siendo la lista de textos que el grafo causal y el
        # mensaje de procedencia ya esperaban; la forma completa va a x["alternativas"].
        alternativas = [a["texto"] for a in alternativas_rev]
        resumen, sugerida, falta, invalidante = rev.resumen.strip(), rev.reformulacion_sugerida.strip(), rev.que_haria_falta.strip(), rev.supuesto_invalidante.strip()
        contradice_a = [c.strip() for c in (getattr(rev, "contradice_a", None) or []) if isinstance(c, str) and c.strip()][:6]
    except PresupuestoAgotado:
        raise
    except VIG.ModeloSinRespuesta:
        raise
    except Exception as ex:  # noqa: BLE001
        juez_fallo = f"{type(ex).__name__}: {str(ex)[:200]}"
        del_juez, resumen, sugerida, falta, alternativas, invalidante = [], f"El juez no respondió: {str(ex)[:120]}", "", "Repetir la revisión cuando el modelo responda", [], ""
        alternativas_rev = []
        contradice_a = []
    comprobaciones = K.fusionar(deterministas, del_juez)
    if juez_fallo is not None:
        # S-09: sin juez no hay juicio. Solo las comprobaciones que ROSA2018 hace sola
        # contra el texto (citas que resuelven, fidelidad al pasaje) pueden
        # descartar sin él; todo lo demás (avanzar, suspender, reformular) espera
        # a que el juez responda, y el intento se cuenta.
        fallan_descarte = [c for c in comprobaciones if c["resultado"] == "falla" and c["comprobacion"] in K.DESCARTAN]
        if not fallan_descarte:
            return _registrar_juez_sin_respuesta(ctx, h, comprobaciones, juez_fallo, pista)
    # El supuesto invalidante del juez solo tumba si algun supuesto esta contradicho
    # de verdad; si no, es un aviso de lo que haria falta comprobar.
    if invalidante and any(s_.get("estado") == "contradicho" for s_ in h.get("supuestos", [])) and not any(c["comprobacion"] == "supuestos" and c["resultado"] == "falla" for c in comprobaciones):
        comprobaciones = [c for c in comprobaciones if c["comprobacion"] != "supuestos"] + [{"comprobacion": "supuestos", "resultado": "falla", "detalle": f"Supuesto invalidante: {invalidante[:200]}"}]
    elif invalidante and not falta:
        falta = f"Comprobar el supuesto: {invalidante[:200]}"
    tiene_prediccion = bool((h.get("tarjeta") or {}).get("prediccionFalsable")) and "no falsable" not in (h.get("tarjeta") or {}).get("prediccionFalsable", "").lower()
    decision, motivo = K.decidir(comprobaciones, tiene_prediccion, h.get("version", 1))
    if juez_fallo is not None:
        motivo = f"[Sin juez: {juez_fallo[:80]}; deciden las comprobaciones que ROSA2018 hace sola contra el texto] {motivo}"
    # Regresión entre versiones: la versión n+1 solo avanza si no falla lo que la n pasaba.
    regresion = regresion_de_comprobaciones(e, h, comprobaciones)
    if regresion and decision == "avanzar":
        decision = "reformular"
        motivo = f"Regresión respecto a la versión {h.get('version', 1) - 1}: ahora fallan {', '.join(r['comprobacion'].replace('_', ' ') for r in regresion)} que antes pasaban. {motivo}"
    ahora = P.ahora_ms()
    quien = ctx.modelos.juez.model
    fallidas = [c for c in comprobaciones if c["resultado"] in ("falla", "no_comprobable")]
    version_juzgada = h.get("version", 1)

    def aplicar(e2: dict[str, Any]) -> dict[str, Any] | bool:
        x = next((y for y in e2["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        if x.get("version", 1) != version_juzgada:
            # Escritura tardia: la hipotesis cambio mientras el juez pensaba. La
            # decision queda registrada sobre la version que juzgo y no toca la actual.
            d = A.registrar_decision(e2, x, "killer_1", decision, f"[Sobre la versión {version_juzgada}; la hipótesis ya está en la {x.get('version', 1)} y se volverá a juzgar] {motivo}", quien, ahora, comprobaciones, falta)
            d["version"] = version_juzgada
            d["corridaId"] = ctx.corrida_id
            x["_revisionPedida"] = True
            return d
        anterior = x.get("decisionKiller")
        d = A.registrar_decision(e2, x, "killer_1", decision, motivo, quien, ahora, comprobaciones, falta)
        d["_alternativas"] = alternativas
        d["corridaId"] = ctx.corrida_id
        # La huella de la evidencia que vio el Killer: rosa/bucle/corrida.py la
        # compara con la actual para pedir revisión solo cuando cambie (S-08, S-13).
        d["huella"] = _huella(x)
        x["_huellaKiller"] = d["huella"]
        if juez_fallo is not None:
            d["sinJuez"] = True
        if regresion:
            d["regresion"] = regresion
        x["decisionKiller"] = decision
        # La petición de revisión queda atendida al juzgar la versión actual (M-19):
        # antes sobrevivía a cualquier reformulación y provocaba un segundo juicio.
        x.pop("_revisionPedida", None)
        x.pop("_killerIntentos", None)
        x.pop("killerPendiente", None)
        # Grafo de evidencia: con quién es redundante (partido dirimente en el torneo)
        # y a quién contradice según el juez (ataque declarado; rosa/argumentacion.py
        # calcula con ello qué candidatas no pueden ser ciertas a la vez).
        vivas_ids = {y["id"] for y in e2["hipotesis"] if y["investigacionId"] == x["investigacionId"] and y["estado"] != "descartada" and y["id"] != x["id"]}
        x["redundanteCon"] = sorted({i for i in redundantes_ids if i in vivas_ids})
        if falta and decision in ("suspender", "reformular", "avanzar"):
            CU.desde_killer(e2, x, falta, ahora)
        for objetivo in contradice_a:
            if objetivo in vivas_ids and not any(t.get("hipotesisId") == objetivo for t in x.setdefault("ataca", [])):
                x["ataca"].append({"hipotesisId": objetivo, "motivo": "contradiccion_declarada", "detalle": f"El Killer (v{version_juzgada}) la declaró incompatible con {objetivo}: {resumen[:160]}"})
        # Explicaciones alternativas del Killer, con su clase y qué las
        # distinguiría, para la ficha de la hipótesis (frontend Alternativas.tsx).
        # Se acumulan ANTES del grafo causal: el grafo tiene que poder caer en
        # las ya conocidas si esta ronda no trae ninguna (ver abajo).
        anadir_alternativas(x, alternativas_rev, ctx.numero)
        # Motor causal minimo: grafo local tipado e identificacion por regla, con
        # las alternativas del Killer como nodos. Entra al modelo de mundo como arista.
        #
        # Las de ESTA ronda mandan, pero si el juez no devolvió ninguna se cae a
        # las ya conocidas en vez de dejar el grafo sin amenazas. El 22 de
        # septiembre de 2026 pasó justo eso: una hipótesis con 12 alternativas
        # guardadas se recalculó con cero y las cajas rojas desaparecieron de la
        # pantalla de mecanismos. Una amenaza conocida no deja de existir porque
        # una llamada no la repita.
        indep = next((c["resultado"] for c in comprobaciones if c["comprobacion"] == "independencia_cohortes"), None)
        para_grafo = alternativas or [a["texto"] for a in (x.get("alternativas") or []) if isinstance(a, dict) and a.get("texto")][:4]
        x["grafoCausal"] = CAUSAL.grafo_local(x, para_grafo, True if indep == "pasa" else False if indep == "falla" else None, ahora)
        CAUSAL.registrar_relacion(e2, x, x["grafoCausal"], ahora)
        # Ruta terapéutica por regla (rosa/ruta.py): el grafo causal recién
        # calculado cambia el paso 'mecanismo', así que se recalcula aquí. Nunca
        # tumba al Killer: si la regla falla, la ruta queda como estaba.
        try:
            x["ruta"] = RUTA.evaluar_ruta(e2, x)
        except Exception as ex:  # noqa: BLE001
            x.setdefault("ruta", None)
            x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "rosa", "texto": f"No pude calcular la ruta terapéutica por regla: {type(ex).__name__}", "creadoEn": ahora})
        for r in x["revisionesAutomaticas"]:
            if r["tipo"] == "completa":
                r.update(estado="hecha" if r["estado"] == "pendiente" else "rehecha", resumen=f"Killer: {decision}. {resumen}", fecha=ahora)
        x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"Hypothesis Killer (v{x.get('version', 1)}): {decision.replace('_', ' ')}. {resumen}" + (f" Alternativas a considerar: {'; '.join(alternativas)}" if alternativas else ""), "creadoEn": ahora})
        x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "killer", "nota": f"{decision.replace('_', ' ')}: {motivo[:240]}", "aCiegas": False})
        if decision == "suspender":
            x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "suspendida", "nota": falta[:240] or motivo[:240], "aCiegas": False})
        ruta_h = f"#/investigaciones/{ctx.investigacion_id}/hipotesis/{x['id']}"
        if decision == "descartar_en_contexto":
            if e2["autonomia"].get("descartar_hipotesis") == "actuar":
                A.revisar_hipotesis(e2, x["id"], "descartar", f"Descartada en este contexto por el Killer: {motivo[:300]}", quien, ahora, False, None, etapa="killer_1")
            else:
                x["estado"] = "en_revision"
                abierto = _hallazgo_abierto(x, "El Killer propone descartarla en este contexto")
                if abierto:
                    # Ya estaba propuesto: se actualiza el motivo, sin segundo hallazgo ni segundo "Decide tú" (M-19).
                    abierto["razonamiento"] = motivo
                else:
                    x["hallazgos"].append({"id": P.nuevo_id("hal"), "tipo": "conclusion_no_sigue", "resumen": "El Killer propone descartarla en este contexto", "razonamiento": motivo, "estado": "abierto", "respuestaDeRosa": None})
                    A.con_evento(e2, ctx.investigacion_id, "killer", f"El Killer propone descartar: {x['titulo'][:80]}. Decide tú.", ruta_h, ahora)
        else:
            retirada = _sacar_de_revision_si_toca(e2, x, anterior, decision, f"Retirada en la versión {x.get('version', 1)}: el Killer decidió {decision.replace('_', ' ')} con la evidencia actual. {motivo[:160]}", d["id"])
            if retirada == "propuesta":
                A.con_evento(e2, ctx.investigacion_id, "killer", f"El Killer retira la propuesta de descarte de «{x['titulo'][:70]}» (ahora {decision.replace('_', ' ')}): vuelve a la cola como propuesta", ruta_h, ahora)
            elif retirada == "hallazgo":
                A.con_evento(e2, ctx.investigacion_id, "killer", f"El Killer retira la propuesta de descarte de «{x['titulo'][:70]}» (ahora {decision.replace('_', ' ')}); sigue en revisión porque una persona la está mirando", ruta_h, ahora)
            if decision == "avanzar":
                A.con_evento(e2, ctx.investigacion_id, "killer", f"El Killer deja avanzar (v{x.get('version', 1)}): {x['titulo'][:80]}", ruta_h, ahora)
        A.recalcular_bloqueos(e2, x)
        return d

    d = ctx.mutar(aplicar, "killer")
    actual = next((y for y in ctx.e["hipotesis"] if y["id"] == h["id"]), h)
    if actual.get("version", 1) != version_juzgada:
        if pista:
            pista.nota(f"La hipótesis cambió a la versión {actual.get('version', 1)} mientras se juzgaba la {version_juzgada}: la decisión queda registrada sobre la {version_juzgada} y la nueva se juzga aparte")
        return decision
    if pista:
        pista.resultado(f"Killer sobre '{h['titulo'][:50]}' (v{h.get('version', 1)}): {decision.replace('_', ' ')}. " + "; ".join(f"{c['comprobacion']} {c['resultado']}" for c in fallidas)[:200])
    # Auditoría de una muestra de descartes y reformulaciones, con otro método
    # (debate) y otra familia (cerebro). El índice del muestreo se deriva de las
    # decisiones de la investigación (S-12), no de un contador por corrida.
    if decision in ("descartar_en_contexto", "reformular") and isinstance(d, dict) and juez_fallo is None:
        indice = indice_auditoria(ctx.e, ctx.investigacion_id, excluir_id=d.get("id"))
        if K.muestrear_para_auditoria(indice):
            recalculada = await _auditar_descarte(ctx, h, d, fallidas, afs_texto, pista)
            if recalculada is not None:
                # La auditoría discrepó y la decisión se recalculó por regla
                # (killer_2): en esta pasada no se reformula ni se descarta.
                return recalculada
    if decision == "reformular" and profundidad < politicas.MAX_REFORMULACIONES:
        ok = await _reformular(ctx, h, "Killer: " + motivo + (f". Sugerencia: {sugerida}" if sugerida else ""), quien, pista)
        if ok:
            # S-11: si la reformulación se pidió por algo que solo recalcula un paso
            # del plan (novedad: OpenAlex y Exa; contexto humano: las bases por
            # diana), no se vuelve a juzgar de inmediato con el dato de la versión
            # vieja. `reformular_hipotesis` deja `_revisionPedida` y reinicia la
            # novedad; el paso de novedad la recomprueba y el siguiente paso de
            # hipótesis la juzga con el precedente fresco.
            por_recuperacion = [c["comprobacion"] for c in comprobaciones if c["resultado"] == "falla" and c["comprobacion"] in ("novedad", "contexto_humano")]
            if por_recuperacion:
                if pista:
                    pista.nota(f"Reformulada por {', '.join(c.replace('_', ' ') for c in por_recuperacion)}: la versión nueva se juzga cuando el paso de novedad y las bases la hayan recomprobado, no ahora")
                return decision
            nueva = next((y for y in ctx.e["hipotesis"] if y["id"] == h["id"]), h)
            return await _killer(ctx, nueva, texto_afirmaciones, pista, profundidad + 1)
    return decision


async def _auditar_descarte(ctx: Ctx, h: dict[str, Any], decision: dict[str, Any], fallidas: list[dict[str, str]], evidencia: str, pista: Pista | None) -> str | None:
    """Segundo método, otra familia: el cerebro defiende la hipótesis y luego
    juzga si la decisión del Killer resiste. Si el auditor no responde, la
    auditoría queda como `acuerdo: None` (sin auditar), nunca como acuerdo. En
    desacuerdo (S-12) se aplica la regla "se abstiene, no mata" que ya tiene
    `fusionar`: la comprobación discutida baja a no_comprobable con el argumento
    del auditor, la decisión se recalcula con `K.decidir` (regla pura, sin
    modelo) y se registra como etapa `killer_2`; la persona recibe un evento
    "Decide tú" con las dos posturas. Devuelve la decisión recalculada cuando
    hubo desacuerdo (aunque coincida con la original), y None si no."""
    quien = ctx.modelos.cerebro.model
    try:
        pred = await ctx.llamar("cerebro", ctx.programas.auditar_descarte, hipotesis=T.hipotesis_texto(h) + "\n" + K.texto_tarjeta(h) + "\n" + DI.texto_perfil(h.get("perfilDiana")), decision=f"{decision['decision']}: {decision['motivo']}", comprobaciones_fallidas="\n".join(f"- {c['comprobacion']}: {c['resultado']}. {c['detalle']}" for c in fallidas) or "ninguna", evidencia=evidencia + "\n\nSupuestos:\n" + "\n".join(f"- [{s.get('estado', 'sin_evidencia')}] {s.get('texto', '')}" for s in (h.get("supuestos") or []) if isinstance(s, dict)))
        au = pred.auditoria
        argumento = str(getattr(au, "mejor_argumento_a_favor", "") or "").strip()
        acuerdo = bool(au.acuerdo)
        nombres = [c["comprobacion"] for c in (decision.get("comprobaciones") or []) if isinstance(c, dict)]
        auditoria = {"quien": quien, "acuerdo": acuerdo, "estado": "respondio", "motivo": (str(au.motivo or "").strip() + (f" Mejor argumento a favor: {argumento}" if not acuerdo else ""))[:600], "argumentoAFavor": argumento[:600], "fecha": P.ahora_ms(), "comprobacionDiscutida": normalizar_comprobacion_discutida(getattr(au, "comprobacion_discutida", ""), nombres) or str(getattr(au, "comprobacion_discutida", "") or "").strip()[:80]}
    except PresupuestoAgotado:
        raise
    except VIG.ModeloSinRespuesta:
        raise
    except Exception as ex:  # noqa: BLE001
        auditoria = {"quien": quien, "acuerdo": None, "estado": "no_respondio", "motivo": f"El auditor no respondió: {str(ex)[:120]}", "argumentoAFavor": "", "fecha": P.ahora_ms(), "comprobacionDiscutida": ""}
        ctx.incidencia("auditoria_sin_respuesta", f"La auditoría del Killer sobre «{h['titulo'][:60]}» quedó sin respuesta", str(ex)[:400], decision["id"], "La decisión queda sin auditar (no cuenta como acuerdo); se vuelve a muestrear en la siguiente decisión.")

    resultado: dict[str, Any] = {"nueva": None}
    ahora = P.ahora_ms()
    ruta_h = f"#/investigaciones/{h['investigacionId']}/hipotesis/{h['id']}"

    def fn(e: dict[str, Any]) -> bool:
        d = next((x for x in e.get("decisiones", []) if x["id"] == decision["id"]), None)
        if not d:
            return False
        d["auditoria"] = auditoria
        if auditoria["acuerdo"] is not False:
            return True
        x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return True
        abierto = _hallazgo_abierto(x, "La auditoría discrepa del Killer")
        if abierto:
            abierto["razonamiento"] = auditoria["motivo"]
        else:
            x["hallazgos"].append({"id": P.nuevo_id("hal"), "tipo": "conclusion_no_sigue", "resumen": "La auditoría discrepa del Killer", "razonamiento": auditoria["motivo"], "estado": "abierto", "respuestaDeRosa": None})
        nombre = auditoria["comprobacionDiscutida"]
        comps = [dict(c) for c in (d.get("comprobaciones") or []) if isinstance(c, dict)]
        discutible = nombre and any(c.get("comprobacion") == nombre and c.get("resultado") == "falla" for c in comps) and x.get("version", 1) == d.get("version", x.get("version", 1))
        if not discutible:
            A.con_evento(e, h["investigacionId"], "killer", f"Auditoría en desacuerdo con el Killer sobre «{x['titulo'][:60]}» sin señalar una comprobación fallida concreta: la decisión ({d['decision'].replace('_', ' ')}) se mantiene. Decide tú.", ruta_h, ahora)
            return True
        for c in comps:
            if c.get("comprobacion") == nombre:
                c["resultado"] = "no_comprobable"
                c["detalle"] = f"Discutida por la auditoría ({quien}): {auditoria['argumentoAFavor'][:200] or auditoria['motivo'][:200]}"
        tiene_prediccion = bool((x.get("tarjeta") or {}).get("prediccionFalsable")) and "no falsable" not in str((x.get("tarjeta") or {}).get("prediccionFalsable", "")).lower()
        nueva, motivo2 = K.decidir(comps, tiene_prediccion, x.get("version", 1))
        d2 = A.registrar_decision(e, x, "killer_2", nueva, f"Recalculada por regla tras el desacuerdo de la auditoría sobre {nombre.replace('_', ' ')} (se abstiene, no mata): {motivo2}", quien, ahora, comps, auditoria["argumentoAFavor"][:400] if nueva != "avanzar" else "")
        d2["corridaId"] = ctx.corrida_id
        d2["huella"] = d.get("huella")
        d2["discuteA"] = d["id"]
        anterior = d["decision"]
        if nueva != anterior:
            x["decisionKiller"] = nueva
            x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "killer", "nota": f"{nueva.replace('_', ' ')} (tras auditoría en desacuerdo sobre {nombre.replace('_', ' ')}): {motivo2[:200]}", "aCiegas": False})
            if nueva == "suspender":
                x["revisiones"].append({"fecha": ahora, "quien": quien, "accion": "suspendida", "nota": auditoria["argumentoAFavor"][:240] or motivo2[:240], "aCiegas": False})
            _sacar_de_revision_si_toca(e, x, anterior, nueva, f"Retirada tras la auditoría: la comprobación {nombre.replace('_', ' ')} quedó discutida y el Killer recalculó a {nueva.replace('_', ' ')}", d2["id"])
            if nueva == "descartar_en_contexto" and anterior != "descartar_en_contexto" and e["autonomia"].get("descartar_hipotesis") != "actuar":
                x["estado"] = "en_revision"
            A.recalcular_bloqueos(e, x)
        x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"Auditoría en desacuerdo con el Killer sobre {nombre.replace('_', ' ')}. Argumento a favor: {auditoria['argumentoAFavor'][:240] or 'sin detallar'}. Recalculado por regla: {nueva.replace('_', ' ')}.", "creadoEn": ahora})
        A.con_evento(e, h["investigacionId"], "killer", f"Auditoría en desacuerdo con el Killer sobre «{x['titulo'][:60]}»: el Killer dijo {anterior.replace('_', ' ')} por {nombre.replace('_', ' ')}; el auditor: {auditoria['argumentoAFavor'][:120] or auditoria['motivo'][:120]}. Recalculado por regla: {nueva.replace('_', ' ')}. Decide tú.", ruta_h, ahora)
        resultado["nueva"] = nueva
        return True

    ctx.mutar(fn, "auditoria_descarte")
    if pista:
        estado = "sin respuesta del auditor (no cuenta como acuerdo)" if auditoria["acuerdo"] is None else ("de acuerdo" if auditoria["acuerdo"] else f"EN DESACUERDO; recalculado por regla: {resultado['nueva'].replace('_', ' ') if resultado['nueva'] else 'sin recalcular'}")
        pista.resultado(f"Auditoría de la decisión sobre '{h['titulo'][:40]}': {estado}")
    return resultado["nueva"]


async def _reformular(ctx: Ctx, h: dict[str, Any], motivo: str, quien: str, pista: Pista | None) -> bool:
    """Versión nueva de la hipótesis que atiende el motivo. Si la política ya
    no permite reformular, se descarta en este contexto (o se propone
    descartar, según la autonomía)."""
    e = ctx.e
    texto_af, _ = T.afirmaciones_sostenidas(ctx.afirmaciones())
    if not politicas.puede_reformular(h.get("version", 1)):
        ahora = P.ahora_ms()

        def agotada(e2: dict[str, Any]) -> bool:
            x = next((y for y in e2["hipotesis"] if y["id"] == h["id"]), None)
            if not x:
                return False
            m = f"Agotó las {politicas.MAX_REFORMULACIONES} reformulaciones de la política: {motivo[:200]}"
            d = A.registrar_decision(e2, x, "killer_1", "descartar_en_contexto", m, quien, ahora)
            d["corridaId"] = ctx.corrida_id
            d["huella"] = _huella(x)
            x["decisionKiller"] = "descartar_en_contexto"
            x.pop("_revisionPedida", None)
            x.pop("_killerIntentos", None)
            x.pop("killerPendiente", None)
            if e2["autonomia"].get("descartar_hipotesis") == "actuar":
                A.revisar_hipotesis(e2, x["id"], "descartar", m, quien, ahora, False, None, etapa="killer_1")
            else:
                x["estado"] = "en_revision"
                A.con_evento(e2, ctx.investigacion_id, "killer", f"Sin reformulaciones disponibles: el Killer propone descartar {x['titulo'][:70]}", f"#/investigaciones/{ctx.investigacion_id}/hipotesis/{x['id']}", ahora)
            return True

        ctx.mutar(agotada, "reformulacion_agotada")
        return False
    try:
        pred = await ctx.llamar("cerebro", ctx.programas.reformular, hipotesis=T.hipotesis_texto(h) + "\n" + K.texto_tarjeta(h) + "\n" + DI.texto_perfil(h.get("perfilDiana")), motivo=motivo, afirmaciones=texto_af[:8000] or "Ninguna", modelo_de_mundo=T.modelo_de_mundo(e["hechos"], ctx.investigacion_id, maximo=30))
        r = pred.reformulacion
        t = r.tarjeta
        cambios = {"titulo": r.titulo, "enunciado": r.enunciado, "mecanismo": r.mecanismo, "comprobacion": {"biomarcador": r.biomarcador, "cohorte": r.cohorte, "diseno": r.diseno}, "tarjeta": {"diana": t.diana, "celula": t.celula, "etapa": t.etapa, "intervencion": t.intervencion, "direccion": t.direccion, "prediccionFalsable": t.prediccion_falsable, "riesgos": [x.strip() for x in t.riesgos if x.strip()][:6], "pasoRuta": getattr(t, "paso_ruta", "mecanismo") or "mecanismo"}}
        ok = ctx.mutar(lambda e2: A.reformular_hipotesis(e2, h["id"], cambios, quien, f"{motivo[:200]} | {r.que_cambio.strip()[:200]}", P.ahora_ms()), "reformular")
        if pista:
            pista.resultado(f"Reformulada como versión {h.get('version', 1) + 1}: {r.titulo[:70]}" if ok else "No se pudo reformular")
        return bool(ok)
    except PresupuestoAgotado:
        raise
    except VIG.ModeloSinRespuesta:
        raise
    except Exception as ex:  # noqa: BLE001
        if pista:
            pista.error(f"La reformulación falló: {str(ex)[:120]}")
        return False


async def _revisar_hipotesis(ctx: Ctx, h: dict[str, Any], texto_afirmaciones: str, pista: Pista | None) -> None:
    """Revisión inicial (juez), supuestos (volumen), y el Killer con su
    decisión derivada por regla. Desde la revisión del 17 de septiembre de 2026:
    si la revisión inicial falla se sigue con los supuestos y el Killer (S-08:
    antes se perdía la petición); la revisión inicial no se repite si ya se hizo
    para esta versión (solo se reevalúan los supuestos y se vuelve a pasar el
    Killer, que es lo que cambia con la evidencia); los supuestos del generador
    se conservan y los del revisor se añaden con su origen (S-10); y se evalúan
    primero contra las afirmaciones propias de la hipótesis, con la lista
    numerada exacta contra la que se validan los índices."""
    inv = ctx.inv()
    ahora = P.ahora_ms()
    version = h.get("version", 1)
    # Cuántas afirmaciones ve esta evaluación: si luego llegan más, el sello lo
    # delata (rosa/vigencia.py). Se cuenta aquí, antes de las llamadas.
    afirmaciones_vistas = VIGENCIA.n_afirmaciones(h)
    rev = None
    inicial_fallo: str | None = None
    ya_revisada = h.get("_revisionInicialVersion") == version and h.get("ultimaRevisionAutomatica") is not None
    if ya_revisada:
        if pista:
            pista.nota(f"Revisión inicial ya hecha para la versión {version} de «{h['titulo'][:50]}»: se reevalúan los supuestos con la evidencia acumulada y se vuelve a pasar el Killer")
    else:
        try:
            pred = await ctx.llamar("juez", ctx.programas.revisar_inicial, objetivo=inv["objetivo"], hipotesis=T.hipotesis_texto(h), criterios_revision="\n".join(ctx.e["criteriosRevision"]))
            rev = pred.revision
        except PresupuestoAgotado:
            raise
        except VIG.ModeloSinRespuesta:
            raise
        except Exception as ex:  # noqa: BLE001
            inicial_fallo = f"{type(ex).__name__}: {str(ex)[:100]}"
            if pista:
                pista.error(f"Revisión inicial falló para {h['titulo'][:60]}: {inicial_fallo}; se sigue con los supuestos y el Killer")
    supuestos = fusionar_supuestos(h.get("supuestos"), list(getattr(rev, "supuestos", None) or [])[:8] if rev is not None else [], nunca_revisada=h.get("ultimaRevisionAutomatica") is None)
    texto_sup, lista_sup = afirmaciones_para_supuestos(h, ctx.afirmaciones())
    evaluados: list[dict[str, Any] | None] = [None] * len(supuestos)
    sem = asyncio.Semaphore(4)

    async def evaluar(i: int, s: dict[str, Any]) -> None:
        async with sem:
            try:
                p2 = await ctx.llamar("volumen", ctx.programas.evaluar_supuesto, supuesto=s["texto"], afirmaciones_sostenidas=texto_sup)
                ev = p2.evaluacion
                estado, evidencia, ids = validar_supuesto_evaluado(getattr(ev, "estado", None), getattr(ev, "evidencia", None), getattr(ev, "indices_que_lo_niegan", None), lista_sup)
                alcance = alcance_del_supuesto(estado, getattr(ev, "indices_que_lo_tocan", None), ids, getattr(ev, "donde_se_responde", None), getattr(ev, "cota", None), lista_sup)
                evaluados[i] = {**s, "estado": estado, "evidencia": evidencia, "niegaAfirmaciones": ids, **alcance}
            except PresupuestoAgotado:
                raise
            except VIG.ModeloSinRespuesta:
                raise
            except Exception as ex:  # noqa: BLE001
                # "No pude comprobar", nunca "no hay": el estado lo dice, no solo el
                # alcance (28 de septiembre de 2026, ver rosa/vigencia.py).
                evaluados[i] = {**s, "estado": VIGENCIA.ESTADO_NO_EVALUADO, "evidencia": f"{VIGENCIA.NO_SE_PUDO}: el modelo no respondió ({type(ex).__name__})", "niegaAfirmaciones": [], "alcance": "no_evaluado", "tocaAfirmaciones": [], "dondeSeResponde": None, "cota": ""}

    await _en_paralelo(*(evaluar(i, s) for i, s in enumerate(supuestos)))
    finales = [s for s in evaluados if s is not None]
    contradichos = [s for s in finales if s["estado"] == "contradicho"]

    def aplicar(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        x["supuestos"] = finales
        x["supuestosEvaluados"] = VIGENCIA.sello(afirmaciones_vistas, ahora, sum(1 for s in finales if VIGENCIA.no_se_pudo_evaluar(s)))
        for r in x["revisionesAutomaticas"]:
            if r["tipo"] == "inicial" and rev is not None:
                r.update(estado="hecha" if r["estado"] == "pendiente" else "rehecha", resumen=("Pasa: " if rev.pasa else "NO pasa: ") + rev.resumen, fecha=ahora)
            elif r["tipo"] == "profunda":
                r.update(estado="hecha" if r["estado"] == "pendiente" else "rehecha", resumen=f"{len(finales)} supuestos: " + ", ".join(f"{s['estado']} {sum(1 for t in finales if t['estado'] == s['estado'])}" for s in {v['estado']: v for v in finales}.values()), fecha=ahora)
            elif r["tipo"] == "completa":
                r.update(estado="hecha" if r["estado"] == "pendiente" else "rehecha", resumen=f"{sum(1 for a in x['afirmaciones'] if a['veredicto'] == 'sostenida')} de {len(x['afirmaciones'])} afirmaciones sostenidas; {len(contradichos)} supuestos contradichos", fecha=ahora)
        x["ultimaRevisionAutomatica"] = ahora
        if rev is not None:
            x["_revisionInicialVersion"] = version
            if not rev.pasa and not _hallazgo_abierto(x, "La revisión inicial no la da por buena"):
                x["hallazgos"].append({"id": P.nuevo_id("hal"), "tipo": "conclusion_no_sigue", "resumen": "La revisión inicial no la da por buena", "razonamiento": rev.resumen, "estado": "abierto", "respuestaDeRosa": None})
            x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"Revisión inicial: {rev.resumen}", "creadoEn": ahora})
        elif inicial_fallo:
            x["procedencia"]["mensajes"].append({"id": P.nuevo_id("m"), "de": "revisor", "texto": f"La revisión inicial no respondió ({inicial_fallo}); se siguió con los supuestos y el Killer.", "creadoEn": ahora})
        for s in contradichos:
            resumen = f"Supuesto contradicho: {s['texto'][:100]}"
            abierto = _hallazgo_abierto(x, resumen)
            if abierto:
                abierto["razonamiento"] = s["evidencia"]
            else:
                x["hallazgos"].append({"id": P.nuevo_id("hal"), "tipo": "valor_contradice_fuente", "resumen": resumen, "razonamiento": s["evidencia"], "estado": "abierto", "respuestaDeRosa": None})
        # Un supuesto que dejó de estar contradicho cierra su hallazgo.
        vivos = {f"Supuesto contradicho: {s['texto'][:100]}" for s in contradichos}
        for z in x["hallazgos"]:
            if isinstance(z, dict) and z.get("estado") == "abierto" and str(z.get("resumen", "")).startswith("Supuesto contradicho: ") and z["resumen"] not in vivos:
                z["estado"] = "atendido"
                z["respuestaDeRosa"] = "El supuesto ya no aparece contradicho al reevaluarlo con la evidencia acumulada."
        return True

    ctx.mutar(aplicar, "revision_hipotesis")
    actual = next((y for y in ctx.e["hipotesis"] if y["id"] == h["id"]), None)
    if actual and actual["estado"] not in ("descartada", "aceptada"):
        await _killer(ctx, actual, texto_afirmaciones, pista)


def par_sin_evidencia_nueva(a: dict[str, Any], b: dict[str, Any], huellas: dict[str, str]) -> bool:
    """S-13: un par ya se jugó con exactamente esta evidencia si el último
    partido entre las dos guarda la misma huella de evidencia de cada una que
    la actual (`_huellaPropia`, `_huellaRival`, privadas: no viajan al
    navegador). Los partidos antiguos sin huella no cuentan como repetidos: se
    juegan una vez más y quedan con huella. Unas tablas (el juez cambió de
    opinión al invertir A y B) no son un resultado: tras unas tablas el par se
    rejuega una vez con la misma evidencia; tras dos tablas seguidas con la
    misma evidencia, ya no (el Elo no se mueve y el juez no aporta)."""
    contra_b = [p for p in (a.get("partidos") or []) if isinstance(p, dict) and p.get("rivalId") == b.get("id")]
    if not contra_b:
        return False

    def misma_evidencia(p: dict[str, Any]) -> bool:
        return bool(p.get("_huellaPropia")) and bool(p.get("_huellaRival")) and p["_huellaPropia"] == huellas.get(a["id"]) and p["_huellaRival"] == huellas.get(b["id"])

    ultimo = contra_b[-1]
    if not misma_evidencia(ultimo):
        return False
    if ultimo.get("resultado") != "tablas":
        return True
    penultimo = contra_b[-2] if len(contra_b) >= 2 else None
    return penultimo is not None and penultimo.get("resultado") == "tablas" and misma_evidencia(penultimo)


class Ronda(NamedTuple):
    """Lo que se juega esta iteración. `pares` van al juez (dos llamadas cada uno,
    A contra B y B contra A). `por_regla` los decide `rosa.solidez` sin ninguna
    llamada, con los motivos de cada lado, y no gastan del tope `maximo`."""

    pares: list[tuple[dict[str, Any], dict[str, Any]]]
    saltados: int
    huellas: dict[str, str]
    por_regla: list[tuple[dict[str, Any], dict[str, Any], list[str], list[str]]]
    # Pares que el juez habría jugado y no caben en el tope de esta iteración. Se
    # dicen en voz alta: un tope que recorta en silencio se lee como cobertura
    # completa, y estos pares vuelven a estar disponibles en la iteración siguiente.
    aplazados: int = 0


def _ya_dirimido(a: dict[str, Any], idb: str) -> bool:
    """El par forzado por redundancia ya tuvo su partido dirimente.

    Lo marca `_dirimidoCon` (clave privada: no viaja al navegador), que escribe
    `_torneo` al jugar un par forzado, y valen también las relaciones distintas de
    "distintas" ya guardadas, que solo pudo escribir un dirimente anterior.

    No sirve preguntar "¿algún partido de este par guarda una relación?", que era
    la primera versión de esto: desde el 25 de septiembre de 2026 la relación se
    guarda siempre, "distintas" incluida, así que un par que ya hubiera jugado
    antes de que el Killer lo marcara redundante quedaría dirimido sin haberse
    dirimido nunca. Y el fallo que hay que evitar es el contrario: mientras
    "distintas" no se guardaba, el par se forzaba en cada iteración para siempre
    (en inv-mu2sz2ns-3 hubo uno con 9 partidos)."""
    if idb in (a.get("_dirimidoCon") or []):
        return True
    return any(isinstance(p_, dict) and p_.get("rivalId") == idb and p_.get("relacion") not in (None, "", "distintas") for p_ in (a.get("partidos") or []))


def pares_del_torneo(propias: list[dict[str, Any]], forzados: list[tuple[str, str]], semilla: int | None, maximo: int = 6, e: dict[str, Any] | None = None) -> Ronda:
    """Lo que se juega esta iteración, en REJILLA COMPLETA (Yoon y otros, 2026:
    cada par una vez, 342 pares ordenados).

    Se enumeran todos los pares posibles en el orden de `torneo.emparejar`; los
    que repetirían un partido sin evidencia nueva en ninguna de las dos se saltan
    (S-13), salvo los forzados por redundancia que no tengan ya su dirimente; los
    que tienen una descalificada por `rosa.solidez` salen aparte y se resuelven
    por regla, sin juez; y del resto se juegan hasta `maximo` con el juez.

    Antes se pedía `maximo * 2` candidatos a `emparejar` y se rellenaban los
    huecos a mano; eso sobra con la rejilla, porque `emparejar` ya devuelve todos
    los pares nunca jugados ordenados por cercanía de Elo. Con 9 vivas devolvía 4
    pares de los 36 posibles: 7 pares nunca se jugaron y uno se jugó 9 veces."""
    huellas = {h["id"]: _huella(h) for h in propias if isinstance(h, dict) and h.get("id")}
    por_id = {h["id"]: h for h in propias if isinstance(h, dict) and h.get("id")}
    forzados_vivos = [(x, y) for x, y in (forzados or []) if x in por_id and y in por_id and not _ya_dirimido(por_id[x], y)]
    forzados_set = {frozenset(par) for par in forzados_vivos}
    candidatos = torneo.emparejar(propias, maximo=len(propias) * len(propias), semilla=semilla, forzados=forzados_vivos, una_vez_por_ronda=False)
    pares: list[tuple[dict[str, Any], dict[str, Any]]] = []
    por_regla: list[tuple[dict[str, Any], dict[str, Any], list[str], list[str]]] = []
    saltados = 0
    aplazados = 0
    fuera: dict[str, list[str]] = {}
    for a, b in candidatos:
        if frozenset((a["id"], b["id"])) not in forzados_set and par_sin_evidencia_nueva(a, b, huellas):
            saltados += 1
            continue
        if e is not None:
            for h in (a, b):
                if h["id"] not in fuera:
                    fuera[h["id"]] = SOL.motivos(e, h)
            ma, mb = fuera[a["id"]], fuera[b["id"]]
            if ma or mb:
                por_regla.append((a, b, ma, mb))
                continue
        if len(pares) < maximo:
            pares.append((a, b))
        else:
            aplazados += 1
    return Ronda(pares, saltados, huellas, por_regla, aplazados)


async def _torneo(ctx: Ctx, pista: Pista) -> int:
    inv = ctx.inv()
    propias = [h for h in ctx.e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id]
    # Pares forzados: las que el Killer marcó como redundantes juegan un partido
    # dirimente (fusión de ramas por torneo, rosa/torneo.py).
    forzados = [(h["id"], r) for h in propias if h["estado"] != "descartada" for r in (h.get("redundanteCon") or [])]
    ronda = pares_del_torneo(propias, forzados, ctx.numero, maximo=politicas.MAX_PARTIDOS_CON_JUEZ_POR_ITERACION, e=ctx.e)
    # Los pares que se juegan por redundancia declarada: su dirimente queda marcado al
    # registrarse, para que no se fuercen en cada iteración (_ya_dirimido).
    era_forzado = {frozenset(par) for par in forzados}
    if ronda.saltados:
        pista.nota(f"{ronda.saltados} pares no se rejuegan: la evidencia de las dos hipótesis es la misma que en su último partido (el Elo no se mueve sin evidencia nueva)")
    if not ronda.pares and not ronda.por_regla:
        pista.nota("Sin torneo en esta iteración: todos los pares posibles ya se jugaron con esta misma evidencia" if ronda.saltados else "Menos de dos hipótesis vivas: no hay torneo")
        return 0
    jugados = 0
    cambios: list[str] = []
    # 1. Los partidos que decide la regla de solidez (rosa/solidez.py): cero llamadas
    #    al juez. Van PRIMERO, así que quedan registrados aunque el presupuesto se
    #    agote en el primer partido con juez. Hoy, sin presupuesto, el torneo no hacía
    #    absolutamente nada.
    for a, b, ma, mb in ronda.por_regla:
        gano_a_r: bool | None = None if (ma and mb) else (not ma)
        if gano_a_r is None:
            motivo_r = f"Tablas por la regla de solidez, sin llamar al juez: las dos pierden. A: {'; '.join(ma)[:200]}. B: {'; '.join(mb)[:200]}"
        else:
            motivo_r = f"Pierde por la regla de solidez, sin llamar al juez: {'; '.join(mb if gano_a_r else ma)[:300]}"

        def aplicar_regla(e: dict[str, Any], a: dict[str, Any] = a, b: dict[str, Any] = b, gano: bool | None = gano_a_r, motivo: str = motivo_r) -> bool:
            x = next((y for y in e["hipotesis"] if y["id"] == a["id"]), None)
            y_ = next((y for y in e["hipotesis"] if y["id"] == b["id"]), None)
            if x is None or y_ is None:
                return False
            torneo.registrar_partido(x, y_, gano, ctx.numero, motivo, "solidez", relacion="distintas", por_regla=True)
            for h, propia, rival in ((x, a["id"], b["id"]), (y_, b["id"], a["id"])):
                if h.get("partidos"):
                    h["partidos"][-1]["_huellaPropia"], h["partidos"][-1]["_huellaRival"] = ronda.huellas.get(propia, ""), ronda.huellas.get(rival, "")
                if frozenset((a["id"], b["id"])) in era_forzado and rival not in h.setdefault("_dirimidoCon", []):
                    h["_dirimidoCon"].append(rival)
            return True

        ctx.mutar(aplicar_regla, "partido")
        jugados += 1
        pista.resultado(f"{a['titulo'][:50]} vs {b['titulo'][:50]}: {'tablas' if gano_a_r is None else ('gana A' if gano_a_r else 'gana B')} por la regla de solidez, sin juez")
        cambios.append(f"{a['titulo'][:40]} vs {b['titulo'][:40]}: por regla")
    if ronda.aplazados:
        pista.nota(f"{ronda.aplazados} pares más se jugarán en las iteraciones siguientes: el tope es de {politicas.MAX_PARTIDOS_CON_JUEZ_POR_ITERACION} partidos con juez por iteración (dos llamadas cada uno). La rejilla no queda cubierta todavía")
    if ronda.por_regla:
        pista.nota(f"{len(ronda.por_regla)} partidos se decidieron por la regla de solidez (rosa/solidez.py) sin llamar al juez: una hipótesis cuya evidencia no la sostiene pierde sin debate")
    if not ronda.pares:
        if jugados:
            ctx.evento("ranking_cambio", f"Torneo de la iteración {ctx.numero}: {jugados} partidos, todos por regla", f"#/investigaciones/{ctx.investigacion_id}/ranking")
        return jugados
    texto_af, _ = T.afirmaciones_sostenidas(ctx.afirmaciones())
    evidencia = (texto_af[:6000] + "\n\nModelo de mundo:\n" + await T.modelo_de_mundo_para(ctx.almacen, ctx.investigacion_id, _consulta_del_paso(ctx, inv), maximo=30))
    huellas = ronda.huellas
    # 2. Los partidos con juez, a ciegas: la tarjeta va sin título, sin cluster y sin
    #    el bloque de revisiones automáticas (hipotesis_para_torneo).
    for a, b in ronda.pares:
        try:
            # Las dos lecturas del par (A contra B y B contra A) son
            # independientes: se piden a la vez. En serie costaban dos esperas
            # del juez, unos 36 s de mediana por partido, y el torneo es la
            # parte más lenta del paso de hipótesis (28 de septiembre de 2026).
            # El orden de los partidos ENTRE SÍ no cambia, que es lo único que
            # afectaría al Elo, porque se aplica igual que antes.
            p1, p2 = await _en_paralelo(
                ctx.llamar("juez", ctx.programas.comparar, objetivo=inv["objetivo"], hipotesis_a=hipotesis_para_torneo(a, etiqueta="Candidata A"), hipotesis_b=hipotesis_para_torneo(b, etiqueta="Candidata B"), evidencia=evidencia, revisiones_humanas=f"Sobre A: {T.revisiones_humanas(a)}\nSobre B: {T.revisiones_humanas(b)}"),
                ctx.llamar("juez", ctx.programas.comparar, objetivo=inv["objetivo"], hipotesis_a=hipotesis_para_torneo(b, etiqueta="Candidata A"), hipotesis_b=hipotesis_para_torneo(a, etiqueta="Candidata B"), evidencia=evidencia, revisiones_humanas=f"Sobre A: {T.revisiones_humanas(b)}\nSobre B: {T.revisiones_humanas(a)}"),
            )
        except PresupuestoAgotado:
            raise
        except VIG.ModeloSinRespuesta:
            raise
        except Exception as ex:  # noqa: BLE001
            pista.error(f"Partido {a['titulo'][:40]} vs {b['titulo'][:40]}: el juez falló ({str(ex)[:80]})")
            continue
        gano_a_1 = p1.comparacion.mejor == "A"
        gano_a_2 = p2.comparacion.mejor == "B"  # en la segunda llamada A y B van invertidas
        gano_a: bool | None = gano_a_1 if gano_a_1 == gano_a_2 else None
        # Qué son una respecto a la otra, solo si el juez lo dijo igual en las dos llamadas.
        relacion = torneo.relacion_acordada(getattr(p1.comparacion, "relacion", None), getattr(p2.comparacion, "relacion", None))
        ahora = P.ahora_ms()

        def aplicar(e: dict[str, Any]) -> bool:
            x = next(y for y in e["hipotesis"] if y["id"] == a["id"])
            y_ = next(y for y in e["hipotesis"] if y["id"] == b["id"])
            torneo.registrar_partido(x, y_, gano_a, ctx.numero, p1.comparacion.resumen, p1.comparacion.eje, relacion)
            # Con qué evidencia se jugó (S-13): claves privadas, no viajan al navegador.
            if x.get("partidos"):
                x["partidos"][-1]["_huellaPropia"], x["partidos"][-1]["_huellaRival"] = huellas.get(a["id"], ""), huellas.get(b["id"], "")
            if y_.get("partidos"):
                y_["partidos"][-1]["_huellaPropia"], y_["partidos"][-1]["_huellaRival"] = huellas.get(b["id"], ""), huellas.get(a["id"], "")
            if frozenset((a["id"], b["id"])) in era_forzado:
                for h, rival in ((x, b["id"]), (y_, a["id"])):
                    if rival not in h.setdefault("_dirimidoCon", []):
                        h["_dirimidoCon"].append(rival)
            for r in x["revisionesAutomaticas"] + y_["revisionesAutomaticas"]:
                if r["tipo"] == "torneo":
                    r["fecha"] = P.ahora_ms()
            if relacion in ("equivalentes", "a_subsume_b", "b_subsume_a"):
                # Fusión de ramas: la ganadora del partido hereda la evidencia. Con
                # tablas, la de más Elo. Descartar hipótesis es una decisión de persona
                # salvo que la autonomía diga "actuar" (misma regla que el Killer).
                gana_x = gano_a if gano_a is not None else x["elo"] >= y_["elo"]
                ganadora, absorbida = (x, y_) if gana_x else (y_, x)
                motivo = f"El torneo las declaró {relacion.replace('_', ' ')} en las dos lecturas del juez: {p1.comparacion.resumen[:160]}"
                if e["autonomia"].get("descartar_hipotesis") == "actuar":
                    A.fusionar_hipotesis(e, ganadora["id"], absorbida["id"], motivo, config.QUIEN_ROSA, ahora)
                else:
                    absorbida["fusionPropuesta"] = {"con": ganadora["id"], "relacion": relacion, "motivo": motivo, "propuestaEn": ahora}
                    A.con_evento(e, x["investigacionId"], "revision_automatica", f"ROSA2018 propone fusionar '{absorbida['titulo'][:60]}' en '{ganadora['titulo'][:60]}' ({relacion.replace('_', ' ')}); decide la persona", f"#/investigaciones/{x['investigacionId']}/hipotesis/{absorbida['id']}", ahora)
            elif relacion == "incompatibles":
                # Ataque declarado en las dos direcciones (rosa/argumentacion.py lo lee).
                for de, hacia in ((x, y_), (y_, x)):
                    if not any(t.get("hipotesisId") == hacia["id"] for t in de.setdefault("ataca", [])):
                        de["ataca"].append({"hipotesisId": hacia["id"], "motivo": "contradiccion_declarada", "detalle": f"El juez del torneo las declaró incompatibles en la iteración {ctx.numero}: {p1.comparacion.resumen[:160]}"})
            return True

        ctx.mutar(aplicar, "partido")
        jugados += 1
        resultado = "tablas" if gano_a is None else ("gana A" if gano_a else "gana B")
        pista.resultado(f"{a['titulo'][:50]} vs {b['titulo'][:50]}: {resultado} por {p1.comparacion.eje}" + (f"; {relacion.replace('_', ' ')}" if relacion != "distintas" else ""))
        cambios.append(f"{a['titulo'][:40]} vs {b['titulo'][:40]}: {resultado}")
    if jugados:
        ctx.evento("ranking_cambio", f"Torneo de la iteración {ctx.numero}: {jugados} partidos", f"#/investigaciones/{ctx.investigacion_id}/ranking")
    return jugados


def hechos_que_motivan(hechos: Any, investigacion_id: str, respaldo: Any, maximo: int = 12) -> list[str]:
    """Ids de los hechos del modelo de mundo de esta investigación que comparten
    una afirmación (afirmacionIds) o una fuente (procedencia[].fuenteId) con las
    afirmaciones que respaldan una hipótesis nueva. Los descartados no cuentan.
    Es una regla sobre el registro, no una lectura del prompt: el modelo de
    mundo llega al generador como texto sin ids. Tolera filas raras."""
    ids_af = {str(a.get("id")) for a in (respaldo if isinstance(respaldo, list) else []) if isinstance(a, dict) and a.get("id")}
    ids_fuente = {str(a.get("fuenteId")) for a in (respaldo if isinstance(respaldo, list) else []) if isinstance(a, dict) and a.get("fuenteId")}
    if not ids_af and not ids_fuente:
        return []
    salida: list[str] = []
    for x in (hechos if isinstance(hechos, list) else []):
        if not isinstance(x, dict) or x.get("investigacionId") != investigacion_id or x.get("estado") == "descartado" or not isinstance(x.get("id"), str):
            continue
        afs = x.get("afirmacionIds") if isinstance(x.get("afirmacionIds"), list) else []
        proc = x.get("procedencia") if isinstance(x.get("procedencia"), list) else []
        if any(str(a) in ids_af for a in afs) or any(isinstance(p_, dict) and str(p_.get("fuenteId")) in ids_fuente for p_ in proc):
            salida.append(x["id"])
        if len(salida) >= maximo:
            break
    return salida


async def _equipo_de_hipotesis(ctx: Ctx, paso: dict[str, Any], pista: Pista, inv: dict[str, Any], mundo: str, texto_af: str, validas: list[dict[str, Any]], lecciones_h: str) -> list[Any]:
    """Las propuestas del equipo de generación (rosa/equipo.py): varios miembros con
    enfoques distintos, en rondas, compartiendo un tablón con la puntuación por
    regla de cada propuesta y por qué, y elegidas al final por esa puntuación y sin
    repetir enfoque. Devuelve las propuestas que siguen el camino de siempre.

    Cada llamada es al cerebro. Una llamada que falla no tumba el equipo: se anota
    y siguen los demás; solo el presupuesto, un modelo caído o una corrida parada
    lo cortan, como a cualquier paso."""
    e = ctx.e
    existentes_txt = [f"{x.get('titulo', '')} {x.get('enunciado', '')} {x.get('mecanismo', '')}" for x in e["hipotesis"] if x.get("investigacionId") == ctx.investigacion_id]
    domina = EQ.dominantes(e["hipotesis"], ctx.investigacion_id)
    fuentes = ctx.fuentes()
    base = {"objetivo": inv["objetivo"], "configuracion": T.configuracion(inv), "modelo_de_mundo": mundo, "hipotesis_existentes": T.hipotesis_existentes(e["hipotesis"], ctx.investigacion_id) + "\n\n" + T.vivero_texto(inv), "lecciones": lecciones_h, "criterios_revision": "\n".join(e["criteriosRevision"])}
    # Cada miembro, su trozo de evidencia: lo más reciente primero, una fuente distinta
    # por afirmación, sin solaparse (EQ.reparto_de_evidencia). Antes el generador veía
    # siempre las 54 primeras de 1.149, todas de la primera iteración.
    reparto = EQ.reparto_de_evidencia(validas, len(EQ.MIEMBROS))
    evidencia_de = {enfoque: EQ.texto_de_indices(validas, reparto[k]) for k, enfoque in enumerate(EQ.MIEMBROS)}
    tablon: list[dict[str, Any]] = []
    fallos = 0
    for ronda in range(1, EQ.RONDAS + 1):
        texto_del_tablon = EQ.texto_tablon(tablon)

        async def miembro(enfoque: str, ronda: int = ronda, texto_del_tablon: str = texto_del_tablon) -> tuple[str, Any]:
            try:
                return enfoque, await ctx.llamar("cerebro", ctx.programas.hipotesis, **base, afirmaciones_sostenidas=evidencia_de[enfoque], enfoque=f"{enfoque}: {EQ.ENFOQUES[enfoque]}\n\n{EQ.MANDATO}", tablon=texto_del_tablon)
            except VIG.ModeloSinRespuesta:
                raise
            except EXCEPCIONES_QUE_CORTAN_EL_PASO:
                raise  # presupuesto agotado o corrida parada
            except Exception as ex:  # noqa: BLE001  un miembro que falla no tumba al equipo
                return enfoque, ex

        resultados = await _en_paralelo(*(miembro(x) for x in EQ.MIEMBROS))
        for enfoque, pred in resultados:
            if isinstance(pred, BaseException):
                fallos += 1
                pista.nota(f"El miembro «{enfoque}» del equipo no respondió en la ronda {ronda}: {str(pred)[:100]}")
                continue
            # Tareas que el miembro pidió abrir al ver algo raro (cola de triaje).
            crudas_t = len(list(getattr(pred, "tareas", None) or []))
            if crudas_t:
                nota_de_tareas(pista, registrar_tareas_propuestas(ctx, pred, paso), crudas_t)
            for hp in list(getattr(pred, "hipotesis", None) or [])[: politicas.MAX_PROPUESTAS_POR_ITERACION]:
                tablon.append(EQ.entrada(hp, enfoque, ronda, EQ.puntuar(hp, validas, fuentes, existentes_txt, domina)))
    elegidas = EQ.elegir(tablon)
    descartadas = [x for x in tablon if x not in elegidas]
    vistas_en_total = len({i for r in reparto for i in r})
    pista.nota(f"Equipo de {len(EQ.MIEMBROS)} enfoques en {EQ.RONDAS} rondas: {len(tablon)} propuestas, entran {len(elegidas)}. Entre todos vieron {vistas_en_total} de {len(validas)} afirmaciones sostenidas" + (f"; {fallos} llamadas sin respuesta" if fallos else ""))
    for x in elegidas:
        pista.nota(f"Entra por el enfoque «{x['enfoque']}» (ronda {x['ronda']}, {x['puntos']} puntos): {x['titulo'][:90]}")
    for x in sorted(descartadas, key=lambda y: -y["puntos"])[:4]:
        pista.nota(f"Se queda fuera «{x['titulo'][:70]}» ({x['enfoque']}, {x['puntos']} puntos): {'; '.join(x['motivos'])[:160]}")
    return [x["hp"] for x in elegidas]


async def paso_hipotesis(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    e = ctx.e
    texto_af, validas = T.afirmaciones_sostenidas(ctx.afirmaciones())
    pista = ctx.pista(paso["id"], "modelo", "Generar y revisar hipótesis", "GPT-6 Astra + Opus 5")
    nuevas_ids: list[str] = []
    vivas = sum(1 for x in e["hipotesis"] if x["investigacionId"] == ctx.investigacion_id and x["estado"] not in ("descartada",))
    tope_de_vivas = vivas >= politicas.MAX_HIPOTESIS_VIVAS_POR_MISION
    if tope_de_vivas:
        pista.nota(f"Hay {vivas} hipótesis vivas: la política fija {politicas.MAX_HIPOTESIS_VIVAS_POR_MISION} por misión, así que no se generan nuevas hasta que se decidan algunas")
        validas = []
    if validas:
        pista.accion(f"Generando hipótesis a partir de {len(validas)} afirmaciones sostenidas y las preguntas abiertas")
        try:
            mundo = await T.modelo_de_mundo_para(ctx.almacen, ctx.investigacion_id, _consulta_del_paso(ctx, inv, texto_af[:1500]))
            lecciones_h = await LEC.para(ctx.almacen, ctx.investigacion_id, ("hipotesis",), texto_af[:1500])
            propuestas = await _equipo_de_hipotesis(ctx, paso, pista, inv, mundo, texto_af, validas, lecciones_h)
        except PresupuestoAgotado:
            pista.cerrar("Presupuesto agotado antes de generar", "detenida")
            raise
        ahora = P.ahora_ms()
        fuentes = ctx.fuentes()
        existentes_titulos = {V.normalizar(h["titulo"]) for h in e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id} | {V.normalizar(t) for t in VIVERO.titulos(inv)}
        for hp in propuestas:
            if V.normalizar(hp.titulo) in existentes_titulos:
                continue
            respaldo = [validas[i - 1] for i in hp.afirmaciones if 1 <= i <= len(validas)]
            if not respaldo:
                pista.nota(f"Descartada antes de entrar: '{hp.titulo[:60]}' no cita ninguna afirmación sostenida")
                continue
            afirmaciones = [{"afirmacionId": a.get("id"), "texto": a["texto"], "cita": a["cita"], "veredicto": a["veredicto"], "motivo": a["motivo"], "entidadDistinta": a.get("entidadDistinta", False), "tipo": a["tipo"], "clase": a.get("clase", "literatura"), "sintetico": False, "cohorte": a.get("cohorte", ""), "sospechosoInyeccion": bool(a.get("sospechosoInyeccion")), "nivelMedicion": a.get("nivelMedicion", "resultado_analisis"), "n": a.get("n", ""), "comparador": a.get("comparador", ""), "efecto": a.get("efecto", ""), "incertidumbre": a.get("incertidumbre", ""), "sinResolver": list(a.get("sinResolver", [])), "trayectoria": None, "fragmento": (a.get("fragmento") or "")[:600]} for a in respaldo]
            vistas: set[str] = set()
            fuentes_h = []
            for a in respaldo:
                if a["fuenteId"] in fuentes and a["fuenteId"] + a["localizador"] not in vistas:
                    vistas.add(a["fuenteId"] + a["localizador"])
                    fuentes_h.append(_fuente_publica(fuentes[a["fuenteId"]], a))
            # Regla del 15 de septiembre: nace solo si su evidencia ya da para certeza
            # baja (dos cohortes distintas); con una sola cohorte va al vivero.
            destino, nivel_nace, motivo_nace = destino_de_propuesta(afirmaciones, fuentes_h)
            if destino == "vivero":
                semilla = VIVERO.nueva_semilla(ctx.investigacion_id, ctx.numero, ahora, hp, afirmaciones, fuentes_h, motivo_nace, ctx.corrida_id)
                ctx.mutar(lambda e2, s=semilla: VIVERO.anadir(e2, ctx.investigacion_id, s, ahora), "vivero")
                existentes_titulos.add(V.normalizar(hp.titulo))
                pista.nota(f"Al vivero, no nace todavía: '{hp.titulo[:60]}' ({motivo_nace}). Le falta: {semilla['falta'][:120]}")
                continue
            derivada = hp.derivada_de if hp.derivada_de and any(h["id"] == hp.derivada_de for h in e["hipotesis"]) else None
            h = P.nueva_hipotesis(
                ctx.investigacion_id,
                ctx.numero,
                ahora,
                titulo=hp.titulo.strip(),
                enunciado=hp.enunciado.strip(),
                mecanismo=hp.mecanismo.strip(),
                comprobacion={"biomarcador": hp.biomarcador, "cohorte": hp.cohorte, "diseno": hp.diseno},
                cluster=hp.cluster or "Sin cluster",
                relevancia={"justificacion": hp.justificacion, "votoHumano": None},
                afirmaciones=afirmaciones,
                supuestos=[{"id": P.nuevo_id("sup"), "texto": s, "estado": "sin_evidencia", "evidencia": "Pendiente", "hijos": []} for s in hp.supuestos[:8]],
                derivadaDe=derivada,
                evidenciaEstadistica="moderada" if any(a["tipo"] == "dato" for a in afirmaciones) else "no_aplica",
                coste={"literatura": round(len(respaldo) * 0.15, 2), "analisis": 0},
                tarjeta={"diana": (hp.diana or "").strip(), "celula": (hp.celula or "").strip(), "etapa": (hp.etapa or "").strip(), "intervencion": (hp.intervencion or "").strip(), "direccion": hp.direccion or "sin_intervencion", "prediccionFalsable": (hp.prediccion_falsable or "").strip(), "riesgos": [r.strip() for r in (hp.riesgos or []) if r.strip()][:6], "pasoRuta": getattr(hp, "paso_ruta", "mecanismo") or "mecanismo"},
            )
            # Los hechos del modelo de mundo que motivaron la hipótesis, por regla:
            # el generador recibe el modelo de mundo como texto sin ids, así que se
            # toman los hechos de esta investigación enlazados con las afirmaciones
            # o las fuentes que la respaldan (afirmacionIds y procedencia.fuenteId).
            # Se anotan en la línea del registro para que la regla de reutilización
            # de rosa/cifras_aprendizaje.py (hecho nombrado en la procedencia) dispare.
            hechos_motivo = hechos_que_motivan(e["hechos"], ctx.investigacion_id, respaldo)
            linea_registro = f"iteración {ctx.numero}: generar -> {hp.titulo[:60]}" + (f" a partir de los hechos {', '.join(hechos_motivo)}" if hechos_motivo else "")
            h["procedencia"] = P.procedencia_vacia(f"Generada en la iteración {ctx.numero} a partir de {len(respaldo)} afirmaciones sostenidas. Supuestos y novedad se comprueban a continuación.", ahora, codigo=f"programas.hipótesis(objetivo, modelo_de_mundo, afirmaciones_sostenidas[{len(validas)}])", registro=[linea_registro])
            h["procedencia"]["fuentes"] = fuentes_h
            h["_entidades"] = list(hp.entidades_novedad)[:6]
            h["_corridaOrigen"] = ctx.corrida_id
            ctx.mutar(lambda e2, h=h: (e2["hipotesis"].append(h), A.con_evento(e2, ctx.investigacion_id, "hipotesis_nueva", f"Hipótesis nueva en la cola: {h['titulo']}", f"#/investigaciones/{ctx.investigacion_id}/hipotesis/{h['id']}", ahora)) and True, "hipotesis_nueva")
            nuevas_ids.append(h["id"])
            existentes_titulos.add(V.normalizar(h["titulo"]))
            pista.resultado(f"Nueva: {h['titulo'][:90]}")
    else:
        # Solo cuando el motivo ES ese. Al llegar al tope de hipótesis vivas se
        # vaciaba `validas` y se caía aquí, así que la pista decía "Sin
        # afirmaciones sostenidas" justo debajo de "hay 10 hipótesis vivas",
        # con 400 afirmaciones sostenidas en la corrida (28 de septiembre de
        # 2026). La segunda contradice a la primera y es la que se lee.
        if not tope_de_vivas:
            pista.nota("Sin afirmaciones sostenidas: no se generan hipótesis nuevas en esta iteración")

    # Revision de las nuevas y de las humanas sin revisar.
    a_revisar = [h for h in ctx.e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id and (h["id"] in nuevas_ids or (h["origen"] == "humana" and h["ultimaRevisionAutomatica"] is None) or h.get("_revisionPedida"))]
    for h in a_revisar:
        await _revisar_hipotesis(ctx, h, texto_af[:8000], pista)

        def quitar_peticion(e2: dict[str, Any], h=h) -> bool:
            # La marca la quita el propio Killer al juzgar la versión actual (M-19) y
            # la deja puesta si el juez no respondió (S-09). Aquí solo se retira si la
            # hipótesis ya salió del bucle (decidida por una persona) y no hay nada
            # que juzgar.
            x = next((y for y in e2["hipotesis"] if y["id"] == h["id"]), None)
            if x and x.get("estado") in ("descartada", "aceptada"):
                x.pop("_revisionPedida", None)
            return True

        ctx.mutar(quitar_peticion, "revision")
        pista.resultado(f"Revisada: {h['titulo'][:70]}")
    partidos = await _torneo(ctx, pista)
    pista.cerrar(f"{len(nuevas_ids)} hipótesis nuevas, {len(a_revisar)} revisadas, {partidos} partidos")
    return f"{len(nuevas_ids)} hipótesis nuevas en la cola, {len(a_revisar)} revisadas, {partidos} partidos de torneo"


# ---------------------------------------------------------------------------
# Novedad
# ---------------------------------------------------------------------------


async def _novedad_por_conectores(ctx: Ctx, h: dict[str, Any], genes: list[str], novedad: dict[str, Any], pista: Pista) -> list[dict[str, Any]]:
    """Las tres comprobaciones de novedad que añaden los conectores: si la
    genética humana ya vincula el gen con el Alzheimer (GWAS Catalog, ClinVar),
    si ya hay fármacos contra la diana (ChEMBL, DGIdb) y si existe un dataset
    publico para comprobar la hipótesis (GEO, CELLxGENE). Cada llamada deja su
    registro de consulta con la invariante comprobada. Una fuente que no
    responde queda como "no comprobado", nunca como "no hay"."""
    regs: list[dict[str, Any]] = []
    novedad.setdefault("genetica", {"estado": "no_comprobado", "detalle": "No comprobado todavía"})
    novedad.setdefault("farmacos", {"estado": "no_comprobado", "detalle": "No comprobado todavía"})
    novedad.setdefault("datosPublicos", {"estado": "no_comprobado", "detalle": "No comprobado todavía", "series": []})
    gen = genes[0] if genes else None
    if gen:
        reg_g, gwas = await CON.consultar("gwas_asociaciones_gen", resumen=f"GWAS Catalog: {gen}", simbolo=gen)
        reg_c, clin = await CON.consultar("clinvar_gen", resumen=f"ClinVar: {gen}", simbolo=gen)
        regs += [reg_g, reg_c]
        pista.accion(f"GWAS Catalog y ClinVar: {gen}", {"base": "GWAS Catalog v2, ClinVar", "parametros": f"mapped_gene={gen}, efo_id=MONDO_0004975", "resultados": f"{(gwas or {}).get('n_alzheimer', '?')} asociaciones AD; {(clin or {}).get('con_enfermedad', '?')} variantes ClinVar con Alzheimer"})
        fallos = [n for n, r_ in (("GWAS Catalog", reg_g), ("ClinVar", reg_c)) if r_.get("error")]
        n_ad = (gwas or {}).get("n_alzheimer", 0)
        n_cv = (clin or {}).get("con_enfermedad", 0)
        if len(fallos) == 2 or (fallos and not (n_ad or n_cv)):
            # Una fuente que no responde es "no pude comprobar", nunca "no hay".
            novedad["genetica"] = {"estado": "no_comprobado", "detalle": "No comprobado: " + " y ".join(fallos) + " no respondieron" + (f"; la que respondió no encontró vínculo" if len(fallos) == 1 else "")}
        else:
            nota_fallo = f" (no pude comprobar {fallos[0]})" if fallos else ""
            if n_ad or n_cv:
                mejor = min(((a.get("p") or 1.0) for a in (gwas or {}).get("alzheimer", [])), default=None)
                novedad["genetica"] = {"estado": "vinculo_conocido", "detalle": f"{gen}: {n_ad} asociaciones GWAS con Alzheimer" + (f" (mejor p {mejor:.1e})" if mejor else "") + f"; {n_cv} variantes en ClinVar con Alzheimer. La genética humana ya vincula el gen: la novedad tiene que estar en el mecanismo o el contexto, no en el vínculo" + nota_fallo}
            else:
                novedad["genetica"] = {"estado": "sin_vinculo", "detalle": f"{gen}: sin asociaciones GWAS con Alzheimer entre {(gwas or {}).get('total_asociaciones', 0)} registradas y sin variantes ClinVar con la enfermedad. Si la hipótesis afirma un vínculo genético, es nuevo y hay que decir por que la genética no lo vio"}
        reg_m, ids = await CON.consultar("mygene_gen", resumen=f"MyGene: {gen}", simbolo=gen)
        regs.append(reg_m)
        chembl = None
        reg_ch: dict[str, Any] = {}
        if ids and ids.get("uniprot"):
            reg_ch, chembl = await CON.consultar("chembl_diana", resumen=f"ChEMBL: {ids['uniprot']}", uniprot=ids["uniprot"])
            regs.append(reg_ch)
        reg_d, dg = await CON.consultar("dgidb_gen", resumen=f"DGIdb: {gen}", simbolo=gen)
        regs.append(reg_d)
        pista.accion(f"ChEMBL y DGIdb: {gen}", {"base": "ChEMBL, DGIdb", "parametros": f"uniprot={(ids or {}).get('uniprot')}", "resultados": f"{len((chembl or {}).get('mecanismos', []))} mecanismos; {(dg or {}).get('total', '?')} interacciones"})
        fallos_f = [n for n, r_ in (("ChEMBL", reg_ch if ids and ids.get("uniprot") else None), ("DGIdb", reg_d)) if r_ is not None and r_.get("error")]
        mecs = (chembl or {}).get("mecanismos", [])
        if reg_d.get("error") and not mecs:
            novedad["farmacos"] = {"estado": "no_comprobado", "detalle": "No comprobado: " + " y ".join(fallos_f) + " no respondieron"}
        else:
            nota_fallo_f = f" (no pude comprobar {fallos_f[0]})" if fallos_f else ""
            aprob = [x for x in (dg or {}).get("interacciones", []) if x.get("aprobado")]
            fases = [m.get("fase_maxima") for m in mecs if m.get("fase_maxima") is not None]
            if mecs or aprob:
                novedad["farmacos"] = {"estado": "farmacos_existentes", "detalle": f"{gen}: {len(mecs)} mecanismos de acción en ChEMBL" + (f" (fase máxima {max(fases)})" if fases else "") + f"; {len(aprob)} fármacos aprobados con interacción en DGIdb" + (": " + ", ".join(str(x.get('farmaco')) for x in aprob[:4]) if aprob else "") + ". La diana es abordable; una hipótesis de intervención puede reposicionar" + nota_fallo_f}
            else:
                novedad["farmacos"] = {"estado": "sin_farmacos", "detalle": f"{gen}: sin mecanismos en ChEMBL ni fármacos con interacción en DGIdb. Si la hipótesis propone intervenir, no hay herramienta farmacológica lista" + nota_fallo_f}
    bio = ((h.get("comprobacion") or {}).get("biomarcador") or (h.get("tarjeta") or {}).get("diana") or gen or "").strip()
    if bio:
        reg_geo, geo = await CON.consultar("geo_series", resumen=f"GEO: Alzheimer {bio}", terminos=f"Alzheimer {bio}")
        reg_cx, cx = await CON.consultar("cellxgene_colecciones", resumen="CELLxGENE: Alzheimer", termino="Alzheimer")
        regs += [reg_geo, reg_cx]
        pista.accion(f"GEO y CELLxGENE: {bio}", {"base": "GEO gds, CELLxGENE Discover", "parametros": f"Alzheimer {bio}", "resultados": f"{(geo or {}).get('total', '?')} series GEO; {reg_cx.get('n') if cx is not None else '?'} colecciones"})
        fallos_d = [n for n, r_ in (("GEO", reg_geo), ("CELLxGENE", reg_cx)) if r_.get("error")]
        series = [{"accession": s_["accession"], "titulo": s_["titulo"], "n": s_.get("n_muestras"), "plataforma": s_.get("plataforma")} for s_ in (geo or {}).get("series", [])[:5]]
        registrar_datasets_programa(ctx, (geo or {}).get("series") if isinstance(geo, dict) else None, cx, pista)
        n_geo = (geo or {}).get("total", 0)
        n_cx = (reg_cx.get("n") or 0) if not reg_cx.get("error") else 0
        if len(fallos_d) == 2 or (fallos_d and not (n_geo or n_cx)):
            novedad["datosPublicos"] = {"estado": "no_comprobado", "detalle": "No comprobado: " + " y ".join(fallos_d) + " no respondieron", "series": []}
        else:
            nota_fallo_d = f" (no pude comprobar {fallos_d[0]})" if fallos_d else ""
            if n_geo or n_cx:
                novedad["datosPublicos"] = {"estado": "hay_datos", "detalle": f"{n_geo} series GEO humanas con 'Alzheimer {bio}' y {n_cx} colecciones de célula única con Alzheimer en CELLxGENE: la hipótesis se puede empezar a comprobar in silico sin pedir datos" + nota_fallo_d, "series": series}
            else:
                novedad["datosPublicos"] = {"estado": "sin_datos", "detalle": f"Ninguna serie GEO humana con 'Alzheimer {bio}' ni colección CELLxGENE: comprobarla exige datos propios o del laboratorio", "series": []}
    return regs


def registrar_datasets_programa(ctx: Ctx, series_geo: Any, colecciones_cx: Any, pista: Pista | None) -> int:
    """Cada serie GEO y cada colección CELLxGENE que el paso de novedad vio
    entra al registro de datasets del programa (rosa/datasets_programa.py),
    con esta investigación como uso, en una sola mutación. Una fila rara (sin
    accession, no diccionario) se salta sin romper el paso; si el conector
    no respondió no se registra nada, porque no hay accession que registrar.
    Devuelve cuántas filas se registraron."""
    filas_geo = [s_ for s_ in (series_geo if isinstance(series_geo, list) else []) if isinstance(s_, dict)]
    filas_cx = [c_ for c_ in (colecciones_cx if isinstance(colecciones_cx, list) else []) if isinstance(c_, dict)]
    if not filas_geo and not filas_cx:
        return 0
    ahora = P.ahora_ms()
    cuenta = {"n": 0}

    def aplicar(e2: dict[str, Any]) -> bool:
        for s_ in filas_geo:
            try:
                if DP.desde_geo(e2, s_.get("accession") or "", s_, ctx.investigacion_id, ahora):
                    cuenta["n"] += 1
            except Exception:  # noqa: BLE001  una fila rara no tumba el paso
                continue
        for c_ in filas_cx:
            try:
                if DP.desde_cellxgene(e2, c_, ctx.investigacion_id, ahora):
                    cuenta["n"] += 1
            except Exception:  # noqa: BLE001
                continue
        return True

    try:
        ctx.mutar(aplicar, "datasets_programa")
    except Exception as ex:  # noqa: BLE001
        if pista:
            pista.nota(f"No pude registrar los datasets del programa: {str(ex)[:100]}")
        return 0
    if pista and cuenta["n"]:
        pista.nota(f"{cuenta['n']} datasets públicos anotados en el registro del programa (GEO y CELLxGENE)")
    return cuenta["n"]


ALIAS_GEN = {"NFL": "NEFL", "NF-L": "NEFL", "P-TAU": "MAPT", "PTAU": "MAPT", "P-TAU181": "MAPT", "P-TAU217": "MAPT", "TAU": "MAPT", "ABETA": "APP", "AB42": "APP", "AB40": "APP", "APOE4": "APOE", "APOE-E4": "APOE", "TREM-2": "TREM2"}
NO_GEN = {"PET", "MCI", "MMSE", "CDR", "CSF", "LCR", "ADNI", "AD", "EA", "IC", "CI", "HR", "OR", "SD", "DE", "RNA", "DNA", "ARN", "ADN", "ELISA", "SIMOA", "MRI", "RM", "TC", "MR", "NCT", "GEO", "GSE", "UK", "USA", "EE", "UU", "BIOFINDER", "AIBL", "WRAP", "ROSMAP", "MSBB", "MAYO", "SEA", "MAP", "ROS", "CA1", "CA3", "IADG", "UP", "DOWN", "GWAS", "SNP", "QTL", "TPM", "NTPM", "FDR", "ANOVA", "AUC", "ROC", "BIOCARD", "PREVENT", "DIAN", "A4", "ATN", "ANA", "VS"}


def simbolos_de_genes(texto: str) -> list[str]:
    """Candidatos a símbolo de gen en un texto libre: tokens en mayúsculas de 2
    a 10 caracteres, con alias del dominio (NfL a NEFL, p-tau a MAPT, Abeta a
    APP) y una lista de siglas que no son genes. MyGene decide después cual
    resuelve de verdad."""
    vistos: list[str] = []
    for bruto in re.findall(r"[A-Za-z][A-Za-z0-9\-\u03b5]{1,14}", texto or ""):
        bruto = bruto.replace("\u03b5", "E")
        # Un alias compuesto (p-tau181, NF-L) se resuelve entero; si no, se separa por guion (GFAP-NfL).
        partes = [bruto] if bruto.upper() in ALIAS_GEN else bruto.split("-")
        for tok in partes:
            t = ALIAS_GEN.get(tok.upper(), tok.upper())
            if not t or t in NO_GEN or t in vistos or not re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", t):
                continue
            if not (tok.isupper() or tok.upper() in ALIAS_GEN or re.search(r"\d", tok)):
                continue  # palabras normales en minusculas no cuentan
            vistos.append(t)
    return vistos[:6]


def contexto_al_dia(h: dict[str, Any]) -> bool:
    """Si el contexto de bases de la hipótesis ya está calculado para su
    versión actual y no hace falta volver a las bases. Una hipótesis anterior
    a la integración del perfil de diana tiene `contextoBases` de la versión
    pero ningún `perfilDiana`: si su diana resolvió a un gen (hay Ensembl), el
    perfil falta y hay que calcularlo una vez; si no resolvió, no hay a quién
    preguntar y el contexto sigue al día. Un `contextoBases` que no es
    diccionario (registro roto) cuenta como no calculado."""
    ctxb = h.get("contextoBases")
    if not isinstance(ctxb, dict) or ctxb.get("version") != h.get("version", 1):
        return False
    perfil = h.get("perfilDiana")
    if isinstance(perfil, dict) and perfil.get("version") == h.get("version", 1):
        return True
    ids = ctxb.get("identificadores") if isinstance(ctxb.get("identificadores"), dict) else {}
    return not ids.get("ensembl")


async def contexto_de_bases(ctx: Ctx, h: dict[str, Any], pista: Pista | None) -> None:
    """El contexto de la diana desde las bases: identificadores (MyGene),
    funcion (UniProt), expresion en cerebro (Human Protein Atlas), interactores
    (STRING) y rutas (Reactome). Se calcula una vez por hipotesis y version, y
    se ensena en la tarjeta. El Killer usa los identificadores en la
    comprobacion `identificadores_resuelven`."""
    diana = ((h.get("tarjeta") or {}).get("diana") or "").strip() if isinstance(h.get("tarjeta"), dict) else ""
    if contexto_al_dia(h):
        return
    candidatos = simbolos_de_genes(" ".join([diana, (h.get("comprobacion") or {}).get("biomarcador") or "", h.get("titulo", "")]))
    if not diana and not candidatos:
        return
    regs: list[dict[str, Any]] = []
    ctxb: dict[str, Any] = {"diana": diana or ", ".join(candidatos[:3]), "identificadores": {}, "funcion": "", "expresionCerebro": "", "interactores": [], "rutas": [], "version": h.get("version", 1), "consultadoEn": P.ahora_ms(), "candidatos": candidatos[:5]}
    ids = None
    simbolo = ""
    for cand in candidatos[:3]:
        reg, ids = await CON.consultar("mygene_gen", resumen=f"MyGene: {cand}", simbolo=cand)
        regs.append(reg)
        if ids and ids.get("ensembl"):
            simbolo = cand
            break
        ids = None
    perfil: dict[str, Any] | None = None
    if simbolo:
        if ids:
            ctxb["identificadores"] = {k: ids.get(k) for k in ("simbolo", "nombre", "ensembl", "uniprot", "entrez")}
            # GTEx exige el identificador GENCODE con versión (ENSG...14), que MyGene
            # no da: lo resuelve gtex_gen y se guarda antes de pedir el perfil de la
            # diana, que con él consulta la mediana de expresión en el tejido.
            try:
                reg_gc, gc = await CON.consultar("gtex_gen", resumen=f"GTEx GENCODE: {simbolo}", simbolo=simbolo)
                regs.append(reg_gc)
                if isinstance(gc, dict) and gc.get("gencode"):
                    ids["gencode"] = gc["gencode"]
                    ctxb["identificadores"]["gencode"] = gc["gencode"]
            except Exception as ex:  # noqa: BLE001
                if pista:
                    pista.nota(f"GTEx no resolvió el GENCODE de {simbolo}: {str(ex)[:80]}")
            if ids.get("uniprot"):
                reg_u, uni = await CON.consultar("uniprot_proteina", resumen=f"UniProt: {simbolo}", simbolo=simbolo)
                reg_r, rutas = await CON.consultar("reactome_rutas", resumen=f"Reactome: {ids['uniprot']}", uniprot=ids["uniprot"])
                regs += [reg_u, reg_r]
                ctxb["funcion"] = (uni or {}).get("funcion", "")[:500]
                ctxb["rutas"] = [{"id": r_["id"], "nombre": r_["nombre"]} for r_ in (rutas or [])[:8]]
            if ids.get("ensembl"):
                reg_h, hpa = await CON.consultar("hpa_expresion", resumen=f"HPA: {ids['ensembl']}", ensembl=ids["ensembl"])
                regs.append(reg_h)
                if hpa:
                    partes = []
                    for k in ("RNA tissue specificity", "RNA brain regional specificity", "RNA single cell type specificity"):
                        if hpa.get(k):
                            partes.append(f"{k.replace('RNA ', '').lower()}: {hpa[k]}")
                    # HPA 24 da la nCPM por tipo celular (ya no la nTPM de célula única).
                    ntpm = hpa.get("RNA brain regional specific nTPM") or hpa.get("RNA single nuclei brain specific nCPM") or hpa.get("RNA single cell type specific nCPM") or hpa.get("RNA single cell type specific nTPM")
                    if isinstance(ntpm, dict) and ntpm:
                        def _valor(v: Any) -> float:
                            try:
                                return float(v or 0)
                            except (TypeError, ValueError):
                                return 0.0
                        top = sorted(ntpm.items(), key=lambda kv: -_valor(kv[1]))[:4]
                        partes.append("mayor expresión en " + ", ".join(f"{k} ({v})" for k, v in top))
                    ctxb["expresionCerebro"] = "; ".join(partes)[:400]
            reg_s, inter = await CON.consultar("string_interactores", resumen=f"STRING: {simbolo}", simbolo=simbolo)
            regs.append(reg_s)
            ctxb["interactores"] = [{"simbolo": i_["interactor"], "puntuacion": i_["puntuacion"]} for i_ in (inter or [])[:8]]
        # Perfil de evidencia por diana (rosa/dianas.py): una fila por capa
        # (genética humana, expresión en tejido, expresión celular, proteína,
        # farmacología, literatura), sin puntuación combinada. Lo leen el Killer
        # (comprobación contexto_humano) y el juez (texto_perfil). Se pasa
        # `consultar=CON.consultar` para que los tests puedan sustituir el conector.
        try:
            perfil = await DI.perfil_de_diana(simbolo, ids, consultar=CON.consultar, contexto=h.get("tarjeta"))
            if isinstance(perfil, dict):
                perfil["version"] = h.get("version", 1)
            else:
                perfil = None
        except Exception as ex:  # noqa: BLE001
            perfil = None
            if pista:
                pista.nota(f"No pude construir el perfil de la diana {simbolo}: {str(ex)[:100]}")
    if pista:
        pista.accion(f"Bases para {simbolo or diana[:30] or 'la diana'}", {"base": "MyGene, GTEx, UniProt, HPA, STRING, Reactome y el perfil por diana (GWAS Catalog, ClinVar, Open Targets, ChEMBL, DGIdb, PubTator)", "parametros": ", ".join(candidatos[:3]) or diana[:40], "resultados": f"Ensembl {ctxb['identificadores'].get('ensembl') or 'ningún candidato resuelve'}; {len(ctxb['interactores'])} interactores; {len(ctxb['rutas'])} rutas; perfil de la diana {'calculado' if perfil else 'sin calcular'}"})

    def aplicar(e: dict[str, Any]) -> bool:
        x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
        if not x:
            return False
        x["contextoBases"] = ctxb
        # El perfil se guarda en la misma mutación que el contexto: los dos son de
        # la misma versión de la hipótesis. Sin perfil (sin símbolo o base caída)
        # se deja None y el Killer lo dice como "no comprobable".
        x["perfilDiana"] = perfil
        x.setdefault("consultas", []).extend(regs)
        return True

    ctx.mutar(aplicar, "contexto_bases")


class _SinConsulta(Exception):
    """Señal interna de `paso_novedad`: una base no se consultó porque no había
    con qué (la novedad ya quedó escrita como "no comprobado" con su motivo)."""


def novedad_pendiente(h: dict[str, Any]) -> bool:
    """Si la hipótesis necesita (otra) comprobación de novedad: el precedente
    quedó "no comprobado" (por estado o por detalle), o quedó "sin precedente"
    sin haber evaluado ninguna obra (los registros antiguos "entre 0 obras",
    S-02), o la genética sigue sin comprobar. Un registro sin `novedad` o sin
    `precedente` también cuenta como pendiente."""
    n = h.get("novedad") if isinstance(h.get("novedad"), dict) else {}
    prec = n.get("precedente") if isinstance(n.get("precedente"), dict) else {}
    detalle = str(prec.get("detalle") or "")
    if not prec or prec.get("estado") == "no_comprobado" or detalle.startswith("No comprobado"):
        return True
    if prec.get("estado") == "sin_precedente" and re.search(r"\bentre 0 obras\b", detalle):
        return True
    return (n.get("genetica") or {}).get("estado") == "no_comprobado"


async def paso_novedad(ctx: Ctx, paso: dict[str, Any]) -> str:
    pendientes = [h for h in ctx.e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id and h["estado"] not in ("descartada",) and novedad_pendiente(h)]
    if not pendientes:
        return "Todas las hipótesis tienen la novedad comprobada"
    # Las menos intentadas primero: si las seis primeras de la lista se quedan en
    # "no comprobado" (sin términos en inglés y sin Exa), sin este orden se
    # repetirían cada iteración y las demás no llegarían nunca a comprobarse
    # (adversario del 17 de septiembre de 2026). `_novedadIntentos` es privada.
    pendientes.sort(key=lambda h: (int(h.get("_novedadIntentos") or 0), int(h.get("creadaEn") or 0)))
    pista = ctx.pista(paso["id"], "novedad", f"Novedad de {len(pendientes)} hipótesis", "Open Targets, ClinicalTrials.gov, OpenAlex")
    for h in pendientes[:6]:
        if pista.detenida():
            break
        entidades = h.get("_entidades") or T.terminos_clave(h.get("titulo") or "", maximo=4)
        # Un registro antiguo puede venir sin `novedad` o con entradas que no son dict:
        # el filtro `novedad_pendiente` lo deja pasar, así que aquí no puede romper.
        novedad = {k: dict(v) for k, v in (h.get("novedad") or {}).items() if isinstance(v, dict)}
        # Open Targets: genes o proteínas.
        genes = [x for x in entidades if re.fullmatch(r"[A-Z][A-Z0-9\-]{1,9}", x) and x not in NO_GEN] or simbolos_de_genes(" ".join([h["titulo"], ((h.get("tarjeta") or {}).get("diana") or ""), ((h.get("comprobacion") or {}).get("biomarcador") or "")]))
        detalles = []
        for g in genes[:3]:
            try:
                r = await opentargets.asociacion_alzheimer(g)
                pista.accion(f"Open Targets: {g}", {"base": "Open Targets GraphQL", "parametros": f"search({g}) + target.associatedDiseases(MONDO_0004975)", "resultados": f"{r.get('puntuacion')}"})
                if not r["encontrado"]:
                    detalles.append(f"{g}: no es una diana en Open Targets")
                elif r["puntuacion"] is None:
                    detalles.append(f"{g}: diana sin asociación registrada con Alzheimer")
                else:
                    detalles.append(f"{g}: asociación {r['puntuacion']} (" + ", ".join(f"{k} {v}" for k, v in r["tipos"].items()) + ")")
            except FuenteNoDisponible as ex:
                detalles.append(f"{g}: Open Targets no respondió ({str(ex)[:60]}); no se afirma ausencia")
        if genes:
            def _punt(d: str) -> float:
                # Con tilde y sin ella: el texto de arriba se escribe
                # "asociación" y este regex buscaba "asociacion", así que NUNCA
                # casaba y `con_asociacion` era siempre falso. Es una regresión
                # de la regla de acentos del 14 de septiembre de 2026: el texto
                # se acentuó y el patrón se quedó atrás. Resultado: ROSA2018
                # decía "sin evidencia previa" de una diana con asociación
                # documentada, con el detalle debajo diciendo lo contrario.
                m_ = re.search(r"asociaci[oó]n ([0-9]+(?:\.[0-9]+)?)", d)
                return float(m_.group(1)) if m_ else 0.0

            con_asociacion = any(_punt(d) >= 0.3 for d in detalles)
            # Basta con que UN gen no haya respondido para no afirmar ausencia.
            # Con `all` hacía falta que fallaran todos: con dos caídos de tres,
            # el estado quedaba en "sin evidencia previa", que es afirmar una
            # ausencia que no se comprobó. Regla de la casa: una fuente que no
            # responde es "no pude comprobar", nunca "no hay".
            sin_respuesta = [d for d in detalles if "no respondió" in d.lower() or "no pude" in d.lower()]
            if detalles and sin_respuesta:
                novedad["openTargets"] = {"estado": "no_comprobado", "detalle": f"No comprobado: Open Targets no respondió para {len(sin_respuesta)} de {len(detalles)} " + ("gen" if len(detalles) == 1 else "genes") + ". " + "; ".join(detalles)[:220]}
                detalles = None
            if detalles is not None:
                novedad["openTargets"] = {"estado": "evidencia_previa" if con_asociacion else "sin_evidencia", "detalle": "; ".join(detalles)}
        else:
            novedad["openTargets"] = {"estado": "sin_evidencia", "detalle": "No aplica: la hipótesis no nombra una diana molecular"}
        # ClinicalTrials.gov está en inglés: siglas, genes y tokens con cifra, nunca
        # palabras sueltas en castellano ("Precedencia anormalidad" daba 0 ensayos).
        termino_registro = " ".join(T.terminos_para_ingles(h, maximo=3))
        try:
            if not termino_registro:
                # No se consultó: decirlo así, no "no respondió" (la base no tuvo la culpa).
                novedad["ensayos"] = {"estado": "no_comprobado", "detalle": "No comprobado: la hipótesis no da términos buscables en inglés (siglas, genes o tokens con cifra) para ClinicalTrials.gov; no se puede afirmar que no haya ensayo", "nct": None}
                raise _SinConsulta()
            termino = termino_registro
            estudios, total = await clinicaltrials.buscar("Alzheimer Disease", termino=termino, maximo=5)
            pista.accion(f"ClinicalTrials.gov: {termino}", {"base": "ClinicalTrials.gov v2", "parametros": f"query.cond=Alzheimer Disease&query.term={termino}", "resultados": f"{total}"})
            if total > 0:
                novedad["ensayos"] = {"estado": "ensayo_existente", "detalle": f"{total} ensayos con esos términos; el más cercano: {estudios[0]['nct']} ({estudios[0]['titulo'][:80]}). Hay que leer si mide lo mismo.", "nct": estudios[0]["nct"]}
            else:
                novedad["ensayos"] = {"estado": "sin_ensayo", "detalle": f"Ningún ensayo registrado con: {termino}", "nct": None}
        except _SinConsulta:
            pass
        except FuenteNoDisponible as ex:
            novedad["ensayos"] = {"estado": "no_comprobado", "detalle": f"No comprobado: ClinicalTrials.gov no respondió ({str(ex)[:60]})", "nct": None}
        # Precedente en literatura: OpenAlex por términos en inglés (siglas, genes,
        # tokens con cifra) y Exa por significado, con cribado del modelo. Tres
        # salidas distintas (S-02): "no comprobado" cuando no hubo obras o el modelo
        # no puntuó ninguna; "ya publicado" o "parcial" cuando alguna puntuó alto;
        # "sin precedente" solo cuando se evaluaron obras y ninguna se parece.
        terminos_ingles = T.terminos_para_ingles(h, maximo=3)
        # Con un solo término ("P-tau181") OpenAlex devuelve los artículos más citados
        # del tema, que no dicen nada del precedente: hacen falta al menos dos.
        termino = " ".join(terminos_ingles) if len(terminos_ingles) >= 2 else ""
        try:
            candidatas: list[dict[str, Any]] = []
            total = 0
            bases: list[str] = []
            if termino:
                obras, total, coste = await openalex.buscar(termino, maximo=6)
                pista.accion(f"OpenAlex: {termino}", {"base": "OpenAlex", "parametros": f"filter=title_and_abstract.search:{termino}", "resultados": f"{total} obras, {coste} USD"})
                candidatas = list(obras[:5])
                bases.append("OpenAlex")
            else:
                pista.nota(f"{h['titulo'][:60]}: la hipótesis no da al menos dos términos buscables en inglés (siglas, genes o tokens con cifra; tiene {len(terminos_ingles)}); no se consulta OpenAlex")
            if exa.disponible():
                # Por significado, con el enunciado entero: la pregunta de novedad
                # difícil es "¿alguien ya propuso esto con otras palabras?".
                try:
                    # Solo lo publicado antes de que ROSA2018 propusiera la hipótesis: la
                    # novedad honesta, también cuando se vuelve a juzgar meses después.
                    obras_exa, n_exa, coste_exa = await exa.buscar(h["enunciado"][:600], maximo=6, pregunta_pasajes=h["enunciado"][:500], hasta_fecha=fecha_iso_de_ms(h.get("creadaEn")))
                    pista.accion("Exa: enunciado completo", {"base": "Exa", "parametros": "category=publication&numResults=6&endPublishedDate=creación de la hipótesis&highlights.query=enunciado", "resultados": f"{n_exa} documentos, {coste_exa:.4f} USD"})
                    _anotar_coste_exa(ctx, coste_exa)
                    vistos = {o.get("doi") for o in candidatas if o.get("doi")}
                    candidatas.extend(o for o in obras_exa[:5] if not (o.get("doi") and o["doi"] in vistos))
                    total += n_exa
                    bases.append("Exa")
                except FuenteNoDisponible as ex:
                    pista.nota(f"Exa no respondió: {str(ex)[:80]}; la novedad se comprueba solo con OpenAlex")
            con_titulo = [o for o in candidatas if o.get("titulo")]
            consulta_texto = termino or h["enunciado"][:80]
            if not bases:
                novedad["precedente"] = {"estado": "no_comprobado", "detalle": "No comprobado: la hipótesis no da términos buscables en inglés y Exa no está disponible; no se puede afirmar novedad"}
            elif not con_titulo:
                novedad["precedente"] = {"estado": "no_comprobado", "detalle": f"No comprobado: la consulta «{consulta_texto}» no devolvió obras evaluables en {' ni '.join(bases)} ({total} obras); no se puede afirmar novedad"}
            else:
                candidatas, _fuera = await cortar_con_reranker(f"Alguien ya propuso o demostró esto: {h['enunciado']}", con_titulo, pista, maximo=5)
                mejor = 0
                mejor_ref = ""
                evaluadas, fallos = 0, 0
                for o in candidatas:
                    try:
                        p = await ctx.llamar("volumen", ctx.programas.relevancia, preguntas_abiertas=f"Alguien ya propuso o demostró esto: {h['enunciado']}", titulo=o["titulo"], resumen=(o.get("resumen") or "")[:2500])
                        evaluadas += 1
                        if int(p.puntuacion) > mejor:
                            mejor, mejor_ref = int(p.puntuacion), f"{o.get('referencia') or o['titulo'][:60]} ({o.get('doi') or 'sin DOI'})"
                    except PresupuestoAgotado:
                        raise
                    except VIG.ModeloSinRespuesta:
                        raise
                    except Exception as ex:  # noqa: BLE001
                        fallos += 1
                        pista.nota(f"Relevancia falló para «{str(o.get('referencia') or o.get('titulo') or '?')[:60]}»: {type(ex).__name__}: {str(ex)[:80]}")
                if evaluadas == 0:
                    novedad["precedente"] = {"estado": "no_comprobado", "detalle": f"No comprobado: el modelo de relevancia no respondió en {fallos} de {len(candidatas)} obras candidatas; no se puede afirmar novedad"}
                elif mejor >= 8:
                    novedad["precedente"] = {"estado": "ya_publicado", "detalle": f"Ya publicado o muy cercano: {mejor_ref} (puntuación {mejor}/10)"}
                elif mejor >= 5:
                    novedad["precedente"] = {"estado": "parcial", "detalle": f"Precedente parcial: {mejor_ref} (puntuación {mejor}/10)"}
                else:
                    novedad["precedente"] = {"estado": "sin_precedente", "detalle": f"Sin precedente claro: {evaluadas} obras evaluadas de {total} que casan con «{consulta_texto}» en {' y '.join(bases)}" + (f"; {fallos} sin puntuar por fallo del modelo" if fallos else "")}
        except FuenteNoDisponible as ex:
            novedad["precedente"] = {"estado": "no_comprobado", "detalle": f"No comprobado: OpenAlex no respondió ({str(ex)[:60]})"}

        # Patentes y financiación (Exa): una idea ya protegida o ya financiada no es nueva.
        await _novedad_exa_dominios(ctx, h, pista, novedad, "patentes", exa.DOMINIOS_PATENTES, "Alguien ya patentó o reivindicó esto", ("patente_relacionada", "parcial", "sin_patente"), "patentes")
        await _novedad_exa_dominios(ctx, h, pista, novedad, "financiacion", exa.DOMINIOS_FINANCIACION, "Alguien ya financió un proyecto para comprobar esto", ("proyecto_financiado", "parcial", "sin_proyecto"), "convocatorias y proyectos financiados")

        # Conectores: genética humana, fármacos y datos públicos para la misma diana.
        consultas = await _novedad_por_conectores(ctx, h, genes[:1], novedad, pista)

        def aplicar(e: dict[str, Any], h=h, novedad=novedad, consultas=consultas) -> bool:
            x = next((y for y in e["hipotesis"] if y["id"] == h["id"]), None)
            if not x:
                return False
            estados_antes = _estados_de_novedad(x.get("novedad"))
            primera_vez = int(x.get("_novedadIntentos") or 0) == 0
            x["novedad"] = novedad
            x["_novedadIntentos"] = int(x.get("_novedadIntentos") or 0) + 1
            x.setdefault("consultas", []).extend(consultas)
            if x.get("decisionKiller") == "suspender" and (primera_vez or estados_antes != _estados_de_novedad(novedad)):
                # El Killer la suspendió antes de tener la novedad: hay que volver a
                # juzgarla. Solo si algún estado de la novedad cambió (o es la primera
                # comprobación): si sigue igual de "no comprobado" que antes, otro juicio
                # daría lo mismo y, tras una suspensión técnica del juez (sinJuez),
                # encadenaba tres fallos más por iteración.
                x["_revisionPedida"] = True
            x.setdefault("procedencia", {}).setdefault("registro", []).append(f"iteración {ctx.numero}: novedad -> Open Targets {novedad['openTargets']['estado']}, ensayos {novedad['ensayos']['estado']}, precedente {novedad['precedente']['estado']}, genética {novedad.get('genetica', {}).get('estado')}, fármacos {novedad.get('farmacos', {}).get('estado')}, datos públicos {novedad.get('datosPublicos', {}).get('estado')}")
            return True

        ctx.mutar(aplicar, "novedad")
        pista.resultado(f"{h['titulo'][:60]}: precedente {novedad['precedente']['estado']}, ensayos {novedad['ensayos']['estado']}, Open Targets {novedad['openTargets']['estado']}")
    pista.cerrar(f"Novedad comprobada en {min(len(pendientes), 6)} hipótesis")
    return f"Novedad comprobada en {min(len(pendientes), 6)} hipótesis"


def _estados_de_novedad(novedad: Any) -> dict[str, Any]:
    """Los estados de cada comprobación de novedad (precedente, ensayos,
    patentes...), para saber si una comprobación nueva cambió algo."""
    if not isinstance(novedad, dict):
        return {}
    return {k: v.get("estado") for k, v in novedad.items() if isinstance(v, dict)}


# ---------------------------------------------------------------------------
# Meta-revision y panorama
# ---------------------------------------------------------------------------


async def paso_meta(ctx: Ctx, paso: dict[str, Any]) -> str:
    inv = ctx.inv()
    e = ctx.e
    propias = [h for h in e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id]
    pista = ctx.pista(paso["id"], "modelo", "Meta-revisión y panorama", "GPT-6 Astra")
    if not propias:
        pista.cerrar("Sin hipótesis: no hay meta-revisión")
        return "Sin hipótesis que meta-revisar"
    pred = await ctx.llamar("cerebro", ctx.programas.meta, objetivo=inv["objetivo"], hipotesis=T.todas_las_hipotesis(e["hipotesis"], ctx.investigacion_id)[:20000], modelo_de_mundo=T.modelo_de_mundo(e["hechos"], ctx.investigacion_id))
    ahora = P.ahora_ms()
    ids = {h["id"] for h in propias}

    def aplicar(e2: dict[str, Any]) -> bool:
        c = next(x for x in e2["corridas"] if x["id"] == ctx.corrida_id)
        debilidades = [{"id": P.nuevo_id("deb"), "texto": d.texto, "hipotesisAfectadas": [x for x in d.hipotesis if x in ids], "inyectada": False} for d in pred.debilidades[:6]]
        c["metaRevisiones"].append({"iteracion": ctx.numero, "fecha": ahora, "debilidades": debilidades})
        c["panorama"] = [{"titulo": d.titulo, "razon": d.razon, "hallazgosRecientes": d.hallazgos[:5], "queInvestigar": d.que_investigar[:5], "ideaEjemplo": d.idea_ejemplo, "inesperada": d.inesperada, "hipotesisIds": [x for x in d.hipotesis if x in ids]} for d in pred.direcciones[:4]]
        # Cada debilidad es un cambio de nivel 2 propuesto: cambiaria como razona
        # ROSA2018. Queda en el registro de aprendizaje hasta que una persona lo promueva.
        existentes = {a["descripcion"] for a in e2.get("aprendizaje", [])}
        for d in debilidades:
            if d["texto"] not in existentes and d["texto"] not in e2["criteriosRevision"]:
                e2.setdefault("aprendizaje", []).append(P.nuevo_cambio_aprendizaje(ctx.investigacion_id, 2, "criterio", d["texto"], f"debilidad:{d['id']}", "propuesto", config.QUIEN_ROSA, ahora))
        return True

    ctx.mutar(aplicar, "meta_revision")
    pista.cerrar(f"{len(pred.debilidades)} debilidades, {len(pred.direcciones)} direcciones")
    return f"{len(pred.debilidades)} debilidades recurrentes y {len(pred.direcciones)} direcciones en el panorama"


# ---------------------------------------------------------------------------
# Analisis in silico (ROSA2018, etapas 5 a 7)
# ---------------------------------------------------------------------------


def _cerrar_analisis_fallido(e: dict[str, Any], hipotesis_id: str) -> bool:
    """Un análisis que reventó por excepción: se quita la petición y las
    ejecuciones en curso de la hipótesis pasan a error técnico."""
    x = next((y for y in e["hipotesis"] if y["id"] == hipotesis_id), None)
    if x:
        x.pop("_analisisPedido", None)
    for r in e.get("ejecuciones", []):
        if r.get("hipotesisId") == hipotesis_id and r.get("estado") == "en_curso":
            r["estado"] = "error_tecnico"
            r["error"] = (r.get("error") or "") + " Interrumpida por una excepción del paso de análisis."
    return True


async def paso_analisis(ctx: Ctx, paso: dict[str, Any]) -> str:
    """Primero las reproducciones pendientes de la puerta; después los
    análisis que pidió la persona; después, si la autonomía lo permite, un
    análisis por hipótesis que el Killer dejo avanzar y aún no tiene datos,
    sobre el primer dataset aprobado. Todo dentro de las políticas."""
    from rosa.bucle import analisis as AN

    e = ctx.e
    inv = ctx.inv()
    datasets_ok = [d for d in inv.get("datasets", []) if d["estado"] == "aprobado" and (d.get("procedencia") or {}).get("hash")]
    pista = ctx.pista(paso["id"], "modelo", "Análisis in silico", "Sandbox + GPT-6 Astra + Opus 5")
    hechos = 0
    for rep in [r for r in e.get("reproducciones", []) if r["investigacionId"] == ctx.investigacion_id and r["estado"] == "pendiente"][:3]:
        try:
            await AN.reproducir(ctx, rep, pista)
        except PresupuestoAgotado:
            raise
        except VIG.ModeloSinRespuesta:
            raise
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            pista.error(f"La reproducción {rep['referencia'][:40]} fallo: {str(ex)[:120]}")
            ctx.mutar(lambda e2, rep=rep, ex=ex: AN._estado_rep(e2, rep["id"], "error_tecnico", None, None, f"{type(ex).__name__}: {str(ex)[:200]}"), "reproduccion")
        hechos += 1
    if not datasets_ok:
        pista.cerrar("Sin datasets aprobados con fichero: no hay análisis que hacer" + (f"; {hechos} reproducciones" if hechos else ""))
        return "Sin datasets aprobados con fichero"
    pedidos = [h for h in e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id and h.get("_analisisPedido")]
    for h in pedidos:
        p = h["_analisisPedido"]
        try:
            await AN.analizar_hipotesis(ctx, h, p["datasetId"], p.get("pregunta", ""), pista)
        except PresupuestoAgotado:
            raise
        except VIG.ModeloSinRespuesta:
            raise
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            pista.error(f"El análisis pedido de {h['titulo'][:40]} fallo: {str(ex)[:120]}")
            ctx.mutar(lambda e2, h=h: _cerrar_analisis_fallido(e2, h["id"]), "analisis")
        hechos += 1
    if e["autonomia"].get("correr_analisis") == "actuar":
        candidatas = [h for h in e["hipotesis"] if h["investigacionId"] == ctx.investigacion_id and h.get("decisionKiller") == "avanzar" and not h.get("ejecuciones") and h["estado"] not in ("descartada",) and (h.get("tarjeta") or {}).get("prediccionFalsable")]
        for h in sorted(candidatas, key=lambda x: -x["elo"])[:2]:
            if pista.detenida():
                break
            try:
                await AN.analizar_hipotesis(ctx, h, datasets_ok[0]["id"], "", pista)
            except PresupuestoAgotado:
                raise
            except VIG.ModeloSinRespuesta:
                raise
            except Exception as ex:  # noqa: BLE001
                traceback.print_exc()
                pista.error(f"El análisis de {h['titulo'][:40]} fallo: {str(ex)[:120]}")
                ctx.mutar(lambda e2, h=h: _cerrar_analisis_fallido(e2, h["id"]), "analisis")
            hechos += 1
    pista.cerrar(f"{hechos} análisis o reproducciones")
    return f"{hechos} análisis in silico o reproducciones ejecutados"


EJECUTORES = {
    "literatura": paso_literatura,
    "ensayos": paso_ensayos,
    "extraccion": paso_extraccion,
    "verificacion": paso_verificacion,
    "novedad": paso_novedad,
    "modelo": paso_modelo,
    "hipotesis": paso_hipotesis,
    "meta": paso_meta,
    "analisis": paso_analisis,
}


def registrar_tareas_propuestas(ctx: Any, pred: Any, paso: dict[str, Any], motivo_paso: str = "") -> int:
    """Las tareas que un paso propone (campo `tareas` de una llamada que ya se paga)
    pasan por el triaje por regla y quedan escritas con su veredicto.

    Del arnés de Yoon y otros (2026): un paso que ve algo raro puede pedir trabajo.
    Cuesta cero llamadas nuevas: las propuestas viajan como campo de salida de
    `ActualizarModeloDeMundo`, `GenerarHipotesis` y `RevisionRegistro`, y el triaje
    (`rosa/tareas.py`) es regla pura. Devuelve cuántas se aceptaron."""
    crudas = list(getattr(pred, "tareas", None) or [])[:politicas.MAX_TAREAS_PROPUESTAS_POR_PASO]
    if not crudas:
        return 0
    ahora = P.ahora_ms()
    aceptadas = 0
    resultados: list[tuple[str, str, str]] = []

    def fn(e: dict[str, Any]) -> bool:
        nonlocal aceptadas
        ya = sum(1 for x in (e.get("tareas") or []) if isinstance(x, dict) and x.get("investigacionId") == ctx.investigacion_id and (x.get("origen") or {}).get("iteracion") == ctx.numero and x.get("estado") in ("aceptada", "programada"))
        for x in crudas:
            t = TA.nueva(
                ctx.investigacion_id,
                str(getattr(x, "que_vio", "") or ""), str(getattr(x, "que_haria", "") or ""), str(getattr(x, "por_que", "") or ""), str(getattr(x, "herramienta", "") or ""),
                {"tipo": "paso", "pasoId": paso.get("id"), "iteracion": ctx.numero, "detalle": motivo_paso or str(paso.get("titulo") or "")},
                ahora,
            )
            estado, motivo = TA.registrar_con_motivo(e, t, ahora, aceptadas_ya=ya + aceptadas)
            resultados.append((estado, motivo, t["queHaria"]))
            if estado == "aceptada":
                aceptadas += 1
                ya += 0
        return True

    ctx.mutar(fn, "tareas")
    return aceptadas


def nota_de_tareas(pista: Any, resultados: int, crudas: int) -> None:
    """Lo que la pista cuenta de las tareas propuestas, para que se vea sin abrir
    la cola de triaje."""
    if crudas:
        pista.nota(f"{crudas} {'tarea propuesta' if crudas == 1 else 'tareas propuestas'} al ver algo que el plan no cubría; {resultados} pasaron el triaje (la cola de triaje dice el motivo de cada una)")
