"""La misma afirmación no se cuenta dos veces, y lo que no puede ser evidencia
no lo es en ningún sitio (28 de septiembre de 2026).

Dos reglas que no cuadraban entre sí:

1. `AsignarEvidencia` pide "una entrada por candidata" y nada lo comprobaba.
   Un índice repetido por el modelo añadía la MISMA afirmación dos veces a la
   misma hipótesis, y `certeza._Vista.balance` suma el peso de cada entrada
   sin agrupar por id: dos copias de un apoyo pesan 2,0. Con 2 apoyos y 2 en
   contra el techo es `muy_baja` ("la evidencia en contra pesa tanto o más");
   con una copia de más pasa a `baja`. Y la ficha dice que hay una afirmación
   de respaldo más de las que hay.

2. `evidencia.puede_ser_evidencia` excluye las sintéticas, las de otra entidad
   y las sospechosas de inyección; `contexto.afirmaciones_sostenidas` solo
   miraba el veredicto. Resultado: una afirmación con texto inyectado no podía
   sumarse a una hipótesis viva, pero sí podía entrar al modelo de mundo y
   fundar una hipótesis nueva, que nacía con ella pesando en su GRADE.
"""

from __future__ import annotations

import inspect
from typing import Any

from rosa import certeza as CERTEZA
from rosa.bucle import contexto as T
from rosa.bucle import evidencia as EV


def _af(texto: str, **extra: Any) -> dict[str, Any]:
    return {"texto": texto, "veredicto": "sostenida", "tipo": "dato", "cita": "[X, pág. 1]", "fuenteId": "f1", **extra}


def test_un_apoyo_contado_dos_veces_subiria_un_peldano():
    """Por qué importa: el duplicado no es cosmético, mueve el techo GRADE."""
    fuentes = [{"id": "f1", "cohorte": "ADNI"}, {"id": "f2", "cohorte": "A4"}]
    base = {
        "afirmaciones": [
            {"texto": "a", "veredicto": "sostenida", "fuenteId": "f1", "clase": "dato"},
            {"texto": "b", "veredicto": "sostenida", "fuenteId": "f2", "clase": "dato"},
            {"texto": "c", "veredicto": "sostenida", "fuenteId": "f1", "clase": "dato", "relacion": "contradice"},
            {"texto": "d", "veredicto": "sostenida", "fuenteId": "f2", "clase": "dato", "relacion": "contradice"},
        ],
        "fuentes": fuentes, "procedencia": {"fuentes": fuentes}, "supuestos": [],
    }
    nivel_limpio, _ = CERTEZA.techo(base)
    con_duplicado = {**base, "afirmaciones": [*base["afirmaciones"], dict(base["afirmaciones"][0])]}
    nivel_sucio, _ = CERTEZA.techo(con_duplicado)
    assert nivel_limpio == "muy_baja"
    assert nivel_sucio == "baja", "si esto deja de subir, la regla del techo cambió y el test hay que rehacerlo"


def test_acumular_descarta_el_indice_repetido():
    fuente = inspect.getsource(EV.acumular)
    assert "vistos: set[int] = set()" in fuente
    assert "if int(indice) in vistos:" in fuente


def test_el_vivero_tambien_descarta_el_indice_repetido():
    fuente = inspect.getsource(EV.acumular_vivero)
    assert "vistos_v" in fuente, "en el vivero una cohorte de más es lo que hace nacer una idea"


def test_las_sostenidas_usan_el_mismo_filtro_que_la_evidencia():
    buena = _af("vale")
    casos = [
        ("sintetica", _af("no vale", sintetico=True)),
        ("de otra entidad", _af("no vale", entidadDistinta=True)),
        ("sospechosa de inyección", _af("no vale", sospechosoInyeccion=True)),
        ("no sostenida", _af("no vale", veredicto="no_sostenida")),
    ]
    for nombre, mala in casos:
        _, validas = T.afirmaciones_sostenidas([buena, mala])
        assert validas == [buena], f"una afirmación {nombre} se coló en las sostenidas"
        assert EV.puede_ser_evidencia(mala) is False, nombre
    # Y la buena pasa por los dos caminos.
    assert EV.puede_ser_evidencia(buena) is True
    assert T.afirmaciones_sostenidas([buena])[1] == [buena]


def test_una_parcial_sigue_contando():
    parcial = _af("a medias", veredicto="parcial")
    assert EV.puede_ser_evidencia(parcial) is True
    assert T.afirmaciones_sostenidas([parcial])[1] == [parcial]


def test_un_registro_raro_no_rompe_las_sostenidas():
    for raro in (None, "texto", 7, {}, {"veredicto": "sostenida"}):
        T.afirmaciones_sostenidas([raro])  # no revienta
