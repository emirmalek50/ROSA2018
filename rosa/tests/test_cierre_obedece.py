"""El cierre de la iteración obedece a Detener y a Pausar
(28 de septiembre de 2026).

`Ctx.llamar` solo comprueba el estado de la corrida cuando el contexto lleva
`de_paso=True`, y de todos los contextos que llaman a modelos solo lo llevaba
el de ejecutar un paso. El cierre corría sin él, y es el tramo MÁS CARO de la
iteración: resumen, meta-revisión, resumen en llano, evidencia por cada
hipótesis viva y por cada idea del vivero, conclusiones, revisor de registro y
reparación. Del orden de 40 llamadas con Opus.

Quien pulsaba "Detener" en el minuto uno del cierre pagaba las 39 restantes.
Es el mismo fallo que `test_detener_corta_el_paso.py` documenta para los pasos
("la corrida 15 hizo 146 de sus 148 llamadas después de que la detuvieran"),
que allí se arregló y aquí se quedó.

Cortar a mitad del cierre es seguro: `it["_cierre"]` guarda lo ya calculado y
se retoma sin repagar.
"""

from __future__ import annotations

import inspect

from rosa.bucle import corrida as CO
from rosa.bucle import pasos as PASOS


def test_el_contexto_del_cierre_puede_cortarse():
    fuente = inspect.getsource(CO.Supervisor._cerrar_iteracion)
    i = fuente.index("ctx = Ctx(")
    linea = fuente[i:fuente.index("\n", i)]
    assert "de_paso=True" in linea, "el cierre volvió a correr sin poder cortarse"


def test_detener_y_pausar_estan_entre_los_estados_que_cortan():
    for estado in ("detenida", "pausada", "terminada", "pausada_por_presupuesto"):
        assert estado in PASOS.ESTADOS_QUE_PARAN_EL_PASO, estado


def test_un_cierre_cortado_sale_limpio_y_no_pausa_por_presupuesto():
    """`CorridaParada` a mitad del cierre no puede tumbar la tarea ni acabar
    tratada como si fuera falta de presupuesto: lo pidió una persona."""
    fuente = inspect.getsource(CO.Supervisor._cerrar_con_presupuesto)
    assert "except PASOS.CorridaParada:" in fuente
    # Y sale antes de tocar el estado: no pausa ni escribe motivo de presupuesto.
    tramo = fuente.split("except PASOS.CorridaParada:", 1)[1]
    assert "_pausar_por_presupuesto" not in tramo
    assert "return" in tramo


def test_el_cierre_no_pisa_el_estado_que_puso_una_persona():
    """Si además de detenerla se cumplía la condición de parada, el cierre
    ponía "terminada" encima de "detenida" y borraba el motivo que escribió la
    persona ("Detenida por la investigadora") con el de la condición."""
    fuente = inspect.getsource(CO.Supervisor._cerrar_iteracion)
    assert 'if terminar and c2["estado"] not in ("detenida", "terminada"):' in fuente


def test_la_llamada_comprueba_el_estado_antes_de_gastar():
    """La comprobación va ANTES de la llamada, no después: si fuera después,
    la llamada ya se habría pagado."""
    fuente = inspect.getsource(PASOS.Ctx.llamar)
    corte = fuente.index("ESTADOS_QUE_PARAN_EL_PASO")
    assert "await" not in fuente[:corte], "se llama al modelo antes de mirar si la corrida sigue viva"
    assert "CorridaParada" in fuente[corte:corte + 300]
