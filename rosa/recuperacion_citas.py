"""La recuperación de las afirmaciones bloqueadas por reglas que ya no valen
(28 de septiembre de 2026).

Por qué existe. El verificador de citas se arregló varias veces (el
localizador "texto web, parte N", la normalización del PDF), pero una
afirmación guarda el veredicto con el que se extrajo. Medido sobre la base del
28 de septiembre: de 4.747 afirmaciones, 1.986 (el 42 %) estaban en
`cita_no_resuelve`, y en las 17 corridas terminadas 1.417 de 1.447 (el 98 %)
ya no lo estarían con el verificador de hoy. Era evidencia pagada que no
contaba para ninguna hipótesis.

Ya había una pasada por corrida (`citas.reverificar`, el botón "Reverificar"
de la pantalla de Citas), pero se quedaba a medias: cambiaba el veredicto y ahí
paraba. Una afirmación recuperada quedaba sostenida en su corrida sin
enlazarse a ninguna hipótesis, así que no movía ninguna certeza. Además iba
corrida a corrida, el navegador esperaba la pasada entera del juez (cientos de
llamadas) y cargaba cada llamada al tope de la última iteración de la corrida,
que suele estar gastado porque así se cerró.

Qué hace esta, de principio a fin, para una investigación (o una corrida):

1. Juez. Las bloqueadas que hoy ya no lo estarían (`citas.a_reverificar`) y las
   que se quedaron sin juez (`sin_verificar`) vuelven a pasar por el mismo
   camino del bucle (`pasos.verificar_afirmaciones`: comprobaciones
   deterministas y después el juez). En tandas que se guardan una a una: si
   ROSA2018 se reinicia a mitad, lo ya juzgado no se vuelve a pagar. Cada
   llamada se carga al tope de la corrida de la afirmación, no al de su
   iteración (`Ctx.sin_tope_de_iteracion`).
2. Enlazar. Las que salen sostenidas o parciales se ofrecen a las hipótesis
   vivas de la investigación con la misma acumulación del cierre de cada
   iteración (`evidencia.acumular`), agrupadas por la corrida y la iteración de
   las que vinieron: es lo que habría enlazado aquel cierre si no hubieran
   estado bloqueadas. También al vivero (`acumular_vivero`): una idea que con
   ellas llega a certeza baja nace como hipótesis, y ninguna se retira por esta
   pasada, que no es una iteración más.
3. Conclusiones. Las hipótesis que ganaron evidencia rehacen su conclusión con
   el juez (`Supervisor._concluir_hipotesis`, lo mismo que el cierre) y después
   se reacota todo por regla (`recalcular_conclusiones_por_regla`). La certeza
   solo se mueve así: el techo por regla sube con la evidencia, pero la certeza
   es el mínimo entre el techo y lo que dijo el juez en su última conclusión.

Lo pide una persona con un botón (acción `pedirRecuperacionCitas`) y lo atiende
el supervisor como trabajo de fondo (`Supervisor._recuperar_citas`), así que
sobrevive a un reinicio: la petición vive en el estado
(`investigacion.recuperacionCitas`) y se retoma donde iba. No arranca mientras
una corrida de esa investigación está trabajando, para no escribir las mismas
afirmaciones e hipótesis desde dos sitios; espera a que pare. El registro dice
en todo momento en qué fase va, cuánto lleva y, al terminar, qué cambió: es el
informe de diferencias.
"""

from __future__ import annotations

from typing import Any

from rosa import citas as CI
from rosa import verificador as V
from rosa.bucle import evidencia as EV
from rosa.estado import acciones as A
from rosa.estado import plantilla as P

# Afirmaciones por tanda del juez. Cada tanda se guarda al terminar: es lo más
# que se volvería a pagar si ROSA2018 se reinicia a mitad.
TANDA = 40
# Estados de la petición en los que el supervisor tiene trabajo que hacer.
ESTADOS_PENDIENTES = ("pedida", "en_curso", "en_espera")
# Cuántos registros de pasadas anteriores se conservan en la investigación.
MAX_ANTERIORES = 5


def _corridas(e: dict[str, Any], investigacion_id: str, corrida_id: str | None = None) -> list[dict[str, Any]]:
    propias = [c for c in e.get("corridas", []) if isinstance(c, dict) and c.get("investigacionId") == investigacion_id]
    if corrida_id:
        propias = [c for c in propias if c.get("id") == corrida_id]
    return sorted(propias, key=lambda c: int(c.get("numero") or 0))


def viva(c: dict[str, Any]) -> bool:
    return c.get("estado") in CI.ESTADOS_VIVOS


def sin_juez(c: dict[str, Any], desde: int | None = None) -> list[dict[str, Any]]:
    """Las afirmaciones que se quedaron sin juez (`sin_verificar`). Con `desde`,
    las que no se intentaron ya en esta misma pasada: si el juez vuelve a no
    dictaminar, no se reintentan en bucle."""
    return [
        a for a in c.get("_afirmaciones") or []
        if isinstance(a, dict) and a.get("veredicto") == "sin_verificar" and not (desde is not None and int(a.get("reverificadaEn") or 0) >= desde)
    ]


def pendientes_de_juez(c: dict[str, Any], desde: int | None = None) -> list[dict[str, Any]]:
    """Lo que esta pasada vuelve a juzgar en la corrida `c`. Nada que ya se
    haya intentado en esta misma pasada (`reverificadaEn` posterior a la
    petición): lo que el juez vuelva a dejar donde estaba no se paga dos veces."""
    vistas: set[int] = set()
    salida: list[dict[str, Any]] = []
    for a in CI.a_reverificar(c) + sin_juez(c, desde):
        if desde is not None and int(a.get("reverificadaEn") or 0) >= desde:
            continue
        if id(a) not in vistas:
            vistas.add(id(a))
            salida.append(a)
    return salida


def por_enlazar(c: dict[str, Any]) -> list[dict[str, Any]]:
    """Las recuperadas que aún no se ofrecieron a las hipótesis."""
    return [a for a in c.get("_afirmaciones") or [] if isinstance(a, dict) and a.get("recuperadaEn") and not a.get("recuperadaEnlazadaEn")]


def recuperables(e: dict[str, Any], investigacion_id: str) -> dict[str, Any]:
    """Sin modelo: por corrida de la investigación, cuántas bloqueadas ya no lo
    estarían hoy, cuántas se quedaron sin juez y cuántas recuperadas faltan por
    enlazar. Una corrida que trabaja no se cuenta (su lista cambia mientras se
    lee, y la recuperación no la toca)."""
    filas: list[dict[str, Any]] = []
    for c in _corridas(e, investigacion_id):
        if viva(c):
            filas.append({"corridaId": c["id"], "numero": c.get("numero"), "estado": c.get("estado"), "viva": True, "bloqueosViejos": None, "sinJuez": None, "porEnlazar": None})
            continue
        filas.append({"corridaId": c["id"], "numero": c.get("numero"), "estado": c.get("estado"), "viva": False, "bloqueosViejos": len(CI.a_reverificar(c)), "sinJuez": len(sin_juez(c)), "porEnlazar": len(por_enlazar(c))})
    cuenta = [f for f in filas if not f["viva"]]
    return {
        "investigacionId": investigacion_id,
        "bloqueosViejos": sum(f["bloqueosViejos"] for f in cuenta),
        "sinJuez": sum(f["sinJuez"] for f in cuenta),
        "porEnlazar": sum(f["porEnlazar"] for f in cuenta),
        "corridasVivas": sum(1 for f in filas if f["viva"]),
        "porCorrida": filas,
    }


# ---------------------------------------------------------------------------
# El registro en la investigación (lo que enseña la pantalla)
# ---------------------------------------------------------------------------


def registro_nuevo(corrida_id: str | None, quien: str, ahora: int) -> dict[str, Any]:
    return {
        "estado": "pedida",
        "pedidaEn": ahora,
        "quien": quien,
        "corridaId": corrida_id,
        "empezadaEn": None,
        "terminadaEn": None,
        "fase": None,
        "total": 0,
        "revisadas": 0,
        "recuento": {},
        "desbloqueadas": 0,
        "enlazadas": 0,
        "hipotesisConEvidencia": [],
        "nacidas": [],
        "reconcluidas": [],
        "llamadas": 0,
        "gastoInicial": {},
        "notas": [],
        "motivo": None,
    }


def _registro(e: dict[str, Any], investigacion_id: str) -> dict[str, Any] | None:
    inv = next((i for i in e.get("investigaciones", []) if i.get("id") == investigacion_id), None)
    reg = (inv or {}).get("recuperacionCitas")
    return reg if isinstance(reg, dict) else None


def _actualizar(sup: Any, investigacion_id: str, cambios: dict[str, Any], nombre: str = "recuperacion_citas") -> None:
    def fn(e: dict[str, Any]) -> bool:
        reg = _registro(e, investigacion_id)
        if reg is None:
            return False
        antes = {k: reg.get(k) for k in cambios}
        reg.update(cambios)
        return antes != cambios

    sup.almacen.mutar(fn, nombre)


def _nota(sup: Any, investigacion_id: str, texto: str) -> None:
    def fn(e: dict[str, Any]) -> bool:
        reg = _registro(e, investigacion_id)
        if reg is None:
            return False
        reg.setdefault("notas", []).append(texto)
        return True

    sup.almacen.mutar(fn, "recuperacion_citas")


def _llamadas_desde(e: dict[str, Any], gasto_inicial: dict[str, Any]) -> int:
    total = 0
    for c in e.get("corridas", []):
        if c.get("id") in gasto_inicial:
            total += max(0, int(((c.get("gasto") or {}).get("llamadas")) or 0) - int(gasto_inicial[c["id"]] or 0))
    return total


# ---------------------------------------------------------------------------
# Contextos
# ---------------------------------------------------------------------------


def _ctx_de_corrida(sup: Any, c: dict[str, Any], numero: int = 0) -> Any:
    """Un contexto sobre una corrida cerrada: las llamadas se cargan al tope de
    la corrida y no al de ninguna iteración."""
    from rosa.bucle.pasos import Ctx

    its = [i for i in sup.almacen.estado["iteraciones"] if i.get("corridaId") == c["id"]]
    ultima = max(its, key=lambda i: int(i.get("numero") or 0)) if its else None
    return Ctx(sup.almacen, sup.programas, sup.modelos, c["id"], c["investigacionId"], (ultima or {}).get("id", ""), numero, de_paso=False, sin_tope_de_iteracion=True)


# ---------------------------------------------------------------------------
# La pasada
# ---------------------------------------------------------------------------


class EnEspera(Exception):
    """Una corrida de la investigación se puso a trabajar: se espera a que pare."""


def _comprobar_que_nada_trabaja(sup: Any, investigacion_id: str) -> None:
    if any(viva(c) for c in _corridas(sup.almacen.estado, investigacion_id)):
        raise EnEspera()


async def recuperar(sup: Any, investigacion_id: str) -> str:
    """Atiende la petición de la investigación si la hay. Devuelve el estado en
    que la deja. `ModeloSinRespuesta` se deja pasar: la petición sigue en curso
    y se retoma cuando el modelo vuelva, sin perder lo ya hecho."""
    from rosa.bucle import corrida as CO
    from rosa.bucle.pasos import PresupuestoAgotado, verificar_afirmaciones

    al = sup.almacen
    reg = _registro(al.estado, investigacion_id)
    if reg is None or reg.get("estado") not in ESTADOS_PENDIENTES:
        return (reg or {}).get("estado") or "sin_peticion"
    inv = next(i for i in al.estado["investigaciones"] if i["id"] == investigacion_id)
    corridas = [c for c in _corridas(al.estado, investigacion_id, reg.get("corridaId")) if not viva(c)]
    try:
        _comprobar_que_nada_trabaja(sup, investigacion_id)
    except EnEspera:
        if reg.get("estado") != "en_espera":
            _actualizar(sup, investigacion_id, {"estado": "en_espera", "motivo": "Hay una corrida trabajando en esta investigación: la recuperación empieza cuando pare, para no escribir las mismas afirmaciones e hipótesis desde dos sitios."})
        return "en_espera"

    ahora = P.ahora_ms()
    desde = int(reg.get("pedidaEn") or ahora)
    if reg.get("estado") != "en_curso" or not reg.get("empezadaEn"):
        total = sum(len(pendientes_de_juez(c, desde)) for c in corridas)
        gasto = reg.get("gastoInicial") or {c["id"]: int((c.get("gasto") or {}).get("llamadas") or 0) for c in _corridas(al.estado, investigacion_id)}
        _actualizar(sup, investigacion_id, {"estado": "en_curso", "empezadaEn": reg.get("empezadaEn") or ahora, "fase": "juez", "total": total, "gastoInicial": gasto, "motivo": None})

    try:
        # 1. El juez.
        for c in corridas:
            ctx = _ctx_de_corrida(sup, c)
            # Tope de vueltas: cada tanda marca lo que juzga y no se vuelve a elegir,
            # así que bastan las justas; el margen es por si alguna regla futura
            # dejara de marcar. Un bucle sin fin aquí sería pagar al juez para siempre.
            vueltas = len(pendientes_de_juez(c, desde)) // TANDA + 2
            for _ in range(vueltas):
                if getattr(sup, "_cerrando", lambda: False)():
                    return "en_curso"  # se retoma al volver a arrancar
                _comprobar_que_nada_trabaja(sup, investigacion_id)
                tanda = pendientes_de_juez(c, desde)[:TANDA]
                if not tanda:
                    break
                antes = {id(a): a.get("veredicto") for a in tanda}
                try:
                    recuento = await verificar_afirmaciones(ctx, tanda, None, inv.get("objetivo", ""))
                except PresupuestoAgotado:
                    quedan = len(pendientes_de_juez(c, desde))
                    _nota(sup, investigacion_id, f"Corrida {c.get('numero')}: se agotó su tope de llamadas; {quedan} afirmaciones quedan sin volver a juzgar. Se puede ampliar el tope y pedir la recuperación otra vez.")
                    break
                marca = P.ahora_ms()

                def fn(e: dict[str, Any], tanda=tanda, antes=antes, recuento=recuento, marca=marca) -> bool:
                    desbloqueadas = 0
                    for a in tanda:
                        a["reverificadaEn"] = marca
                        previo = antes.get(id(a))
                        ahora_v = a.get("veredicto")
                        if (previo in V.BLOQUEAN or previo == "sin_verificar") and ahora_v not in V.BLOQUEAN and ahora_v != "sin_verificar":
                            a["recuperadaEn"] = marca
                            a["veredictoAnterior"] = previo
                            desbloqueadas += 1
                    reg2 = _registro(e, investigacion_id)
                    if reg2 is not None:
                        reg2["revisadas"] = int(reg2.get("revisadas") or 0) + len(tanda)
                        rec = dict(reg2.get("recuento") or {})
                        for k, n in (recuento or {}).items():
                            rec[k] = int(rec.get(k) or 0) + int(n)
                        reg2["recuento"] = rec
                        reg2["desbloqueadas"] = int(reg2.get("desbloqueadas") or 0) + desbloqueadas
                        reg2["llamadas"] = _llamadas_desde(e, reg2.get("gastoInicial") or {})
                    return True

                al.mutar(fn, "recuperacion_citas")

        # 2. Enlazar a las hipótesis y al vivero.
        _actualizar(sup, investigacion_id, {"fase": "enlazar"})
        fecha_txt = _fecha(desde)
        for c in corridas:
            pendientes = por_enlazar(c)
            if not pendientes:
                continue
            _comprobar_que_nada_trabaja(sup, investigacion_id)
            ctx = _ctx_de_corrida(sup, c)
            grupos: dict[int, list[dict[str, Any]]] = {}
            for a in pendientes:
                grupos.setdefault(int(a.get("iteracion") or 0), []).append(a)
            for it_n, afs in sorted(grupos.items()):
                etiqueta = f"Recuperación de citas del {fecha_txt} (corrida {c.get('numero')}, iteración {it_n})"
                usar = [a for a in afs if EV.puede_ser_evidencia(a)]
                resumen: dict[str, Any] = {"anadidas": 0, "ids": []}
                nacidas: list[str] = []
                try:
                    if usar:
                        resumen = await EV.acumular(ctx, it_n, None, afirmaciones=usar, etiqueta=etiqueta)
                        viv = await EV.acumular_vivero(ctx, it_n, None, afirmaciones=usar, etiqueta=etiqueta, retirar=False)
                        nacidas = list(viv.get("nacidas") or [])
                except (PresupuestoAgotado, EV.PresupuestoAgotadoEvidencia):
                    _nota(sup, investigacion_id, f"Corrida {c.get('numero')}: se agotó su tope de llamadas al enlazar la iteración {it_n}; lo que falta se enlaza al pedir la recuperación otra vez.")
                    break
                marca = P.ahora_ms()

                def fn2(e: dict[str, Any], afs=afs, resumen=resumen, nacidas=nacidas, marca=marca) -> bool:
                    for a in afs:
                        a["recuperadaEnlazadaEn"] = marca
                    reg2 = _registro(e, investigacion_id)
                    if reg2 is not None:
                        reg2["enlazadas"] = int(reg2.get("enlazadas") or 0) + int(resumen.get("anadidas") or 0)
                        ids = list(reg2.get("hipotesisConEvidencia") or [])
                        for h_id in resumen.get("ids") or []:
                            if h_id not in ids:
                                ids.append(h_id)
                        reg2["hipotesisConEvidencia"] = ids
                        reg2["nacidas"] = list(reg2.get("nacidas") or []) + [n for n in nacidas if n not in (reg2.get("nacidas") or [])]
                        reg2["llamadas"] = _llamadas_desde(e, reg2.get("gastoInicial") or {})
                    return True

                al.mutar(fn2, "recuperacion_citas")

        # 3. Rehacer las conclusiones de las hipótesis que ganaron evidencia.
        _actualizar(sup, investigacion_id, {"fase": "conclusiones"})
        reg = _registro(al.estado, investigacion_id) or {}
        hechas = {x.get("hipotesisId") for x in reg.get("reconcluidas") or []}
        ultima = A.ultima_corrida_de(al.estado, investigacion_id)
        if ultima is not None:
            ctx_rc = _ctx_de_corrida(sup, ultima, int(ultima.get("iteracionActual") or 0))
            for h_id in list(reg.get("hipotesisConEvidencia") or []):
                if h_id in hechas:
                    continue
                _comprobar_que_nada_trabaja(sup, investigacion_id)
                h = next((x for x in al.estado["hipotesis"] if x.get("id") == h_id), None)
                if h is None or h.get("estado") == "descartada":
                    continue
                antes_c = (h.get("conclusion") or {}).get("certeza") if isinstance(h.get("conclusion"), dict) else None
                if CO.motivo_para_reconcluir(h):
                    try:
                        await sup._concluir_hipotesis(ctx_rc, h)
                    except PresupuestoAgotado:
                        _nota(sup, investigacion_id, f"Corrida {ultima.get('numero')}: se agotó su tope al rehacer conclusiones; las que faltan se rehacen en el próximo cierre de una iteración.")
                        break
                h2 = next((x for x in al.estado["hipotesis"] if x.get("id") == h_id), None) or {}
                despues_c = (h2.get("conclusion") or {}).get("certeza") if isinstance(h2.get("conclusion"), dict) else None

                def fn3(e: dict[str, Any], h_id=h_id, titulo=str(h.get("titulo") or "")[:140], antes_c=antes_c, despues_c=despues_c) -> bool:
                    reg2 = _registro(e, investigacion_id)
                    if reg2 is None:
                        return False
                    reg2.setdefault("reconcluidas", []).append({"hipotesisId": h_id, "titulo": titulo, "antes": antes_c, "despues": despues_c})
                    reg2["llamadas"] = _llamadas_desde(e, reg2.get("gastoInicial") or {})
                    return True

                al.mutar(fn3, "recuperacion_citas")

        # 4. Reacotar por regla y cerrar con el informe.
        fin = P.ahora_ms()

        def cerrar(e: dict[str, Any]) -> bool:
            CO.recalcular_conclusiones_por_regla(e, fin, investigacion_id)
            reg2 = _registro(e, investigacion_id)
            if reg2 is None:
                return False
            reg2["llamadas"] = _llamadas_desde(e, reg2.get("gastoInicial") or {})
            reg2.update({"estado": "terminada", "terminadaEn": fin, "fase": None})
            A.con_evento(e, investigacion_id, "revision_automatica", texto_informe(reg2), f"#/investigaciones/{investigacion_id}/citas", fin)
            return True

        al.mutar(cerrar, "recuperacion_citas")
        return "terminada"
    except EnEspera:
        _actualizar(sup, investigacion_id, {"estado": "en_espera", "motivo": "Una corrida de esta investigación se puso a trabajar: la recuperación sigue donde iba cuando pare."})
        return "en_espera"
    except Exception as ex:
        from rosa.vigilante_modelos import ModeloSinRespuesta

        if isinstance(ex, ModeloSinRespuesta):
            raise
        _actualizar(sup, investigacion_id, {"estado": "fallida", "motivo": f"{type(ex).__name__}: {str(ex)[:240]}", "fase": None})
        raise


def _fecha(ms: int) -> str:
    import datetime as dt

    return dt.datetime.fromtimestamp(ms / 1000).strftime("%d/%m/%Y")


def texto_informe(reg: dict[str, Any]) -> str:
    """La línea del evento al terminar: qué cambió, en llano."""
    rec = reg.get("recuento") or {}
    sost = int(rec.get("sostenida") or 0)
    parc = int(rec.get("parcial") or 0)
    no_sost = int(rec.get("no_sostenida") or 0)
    siguen = sum(int(n) for k, n in rec.items() if k in V.BLOQUEAN and k != "no_sostenida")
    sin = int(rec.get("sin_verificar") or 0)
    subidas = sum(1 for x in reg.get("reconcluidas") or [] if _orden(x.get("despues")) > _orden(x.get("antes")))
    bajadas = sum(1 for x in reg.get("reconcluidas") or [] if _orden(x.get("despues")) < _orden(x.get("antes")))
    partes = [f"Recuperación de citas: {int(reg.get('revisadas') or 0)} afirmaciones vueltas a juzgar ({sost} sostenidas, {parc} parciales, {no_sost} no sostenidas, {siguen} siguen bloqueadas, {sin} sin juez)"]
    partes.append(f"{int(reg.get('enlazadas') or 0)} enlazadas a {len(reg.get('hipotesisConEvidencia') or [])} hipótesis")
    if reg.get("nacidas"):
        partes.append(f"{len(reg['nacidas'])} ideas del vivero nacieron como hipótesis")
    partes.append(f"{len(reg.get('reconcluidas') or [])} conclusiones rehechas ({subidas} subieron de certeza, {bajadas} bajaron)")
    partes.append(f"{int(reg.get('llamadas') or 0)} llamadas a modelos")
    return "; ".join(partes) + "."


def _orden(certeza: Any) -> int:
    from rosa import certeza as CERTEZA

    try:
        return CERTEZA.NIVELES.index(certeza)
    except (ValueError, AttributeError):
        return -1
