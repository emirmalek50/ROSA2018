"""Una mutación que no se puede guardar no deja el almacén atascado
(28 de septiembre de 2026).

`mutar` aplica el reducer sobre `self.estado` y después serializa, arma el
registro y escribe. Solo el reducer estaba dentro del `try` que recarga desde
disco: `_serializar`, los dos `json.dumps` y `hash_fila` quedaban fuera. Si
cualquiera de los tres lanzaba, el reducer YA había mutado la memoria y nadie
lo deshacía, así que el valor venenoso se quedaba dentro y todas las
mutaciones siguientes fallaban en el mismo punto, para siempre.

El disparador más fácil es un sustituto Unicode suelto, que es lo que produce
`JSON.stringify` de una cadena cortada a mitad de un emoji: `json.loads` lo
acepta y orjson no. Un solo POST bastaba.

Lo caro no es el 400 de esa petición: es que a partir de ahí el bucle sigue
aplicando reducers sobre memoria y pagando llamadas al modelo, la versión no
sube, el SSE no empuja nada, la interfaz se queda congelada en la última
instantánea buena y al reiniciar se pierde todo lo hecho desde el fallo.
"""

from __future__ import annotations

import tempfile
from datetime import datetime
from pathlib import Path

import pytest

from rosa.estado.almacen import Almacen

# Un sustituto alto suelto, sin su pareja: UTF-8 no lo puede codificar.
VENENO = "criterio \ud83d"


def _almacen() -> Almacen:
    return Almacen(Path(tempfile.mkdtemp()) / "t.db")


def test_un_texto_que_no_se_puede_serializar_no_deja_el_almacen_atascado():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "sano 1"})
    version, cuantos = al.version, len(al.estado["criteriosRevision"])

    with pytest.raises(Exception):
        al.aplicar("anadirCriterio", {"texto": VENENO})

    # Lo que importa: la memoria volvió a lo guardado.
    assert len(al.estado["criteriosRevision"]) == cuantos, "el valor venenoso se quedó en memoria"
    assert al.version == version
    assert VENENO not in al.estado["criteriosRevision"]

    # Y el almacén sigue vivo: la siguiente mutación sana funciona.
    al.aplicar("anadirCriterio", {"texto": "sano 2"})
    assert al.version == version + 1
    assert al.estado["criteriosRevision"][-1] == "sano 2"
    al.cerrar()


def test_lo_guardado_en_disco_sigue_siendo_lo_bueno():
    al = _almacen()
    al.aplicar("anadirCriterio", {"texto": "sano"})
    with pytest.raises(Exception):
        al.aplicar("anadirCriterio", {"texto": VENENO})
    ruta = al.ruta
    al.cerrar()
    otro = Almacen(ruta)
    assert otro.estado["criteriosRevision"][-1] == "sano"
    assert VENENO not in otro.estado["criteriosRevision"]
    otro.cerrar()


def test_una_fecha_en_el_estado_tampoco_lo_atasca():
    """El otro camino que ya se conocía: un objeto que orjson no serializa.
    El test que había solo comprobaba el disco y cerraba el almacén, así que
    no veía que la memoria se quedaba sucia."""
    al = _almacen()
    cuantos = len(al.estado["criteriosRevision"])
    with pytest.raises(TypeError):
        al.mutar(lambda e: e["criteriosRevision"].append(datetime(2026, 9, 28)) or True, "fecha")
    assert len(al.estado["criteriosRevision"]) == cuantos
    al.aplicar("anadirCriterio", {"texto": "despues"})
    assert al.estado["criteriosRevision"][-1] == "despues"
    al.cerrar()


def test_un_reducer_que_lanza_sigue_deshaciendose(alias=None):
    """Lo que ya funcionaba antes tiene que seguir funcionando."""
    al = _almacen()
    cuantos = len(al.estado["criteriosRevision"])

    def a_medias(e):
        e["criteriosRevision"].append("a medias")
        raise RuntimeError("el reducer se rompió")

    with pytest.raises(RuntimeError, match="se rompió"):
        al.mutar(a_medias, "roto")
    assert len(al.estado["criteriosRevision"]) == cuantos
    al.cerrar()


def test_el_mismo_diccionario_se_conserva_al_recargar():
    """Las corrutinas del bucle capturan `almacen.estado`: si al recargar se
    rebindeara el atributo, seguirían escribiendo en un diccionario huérfano."""
    al = _almacen()
    capturado = al.estado
    with pytest.raises(Exception):
        al.aplicar("anadirCriterio", {"texto": VENENO})
    assert al.estado is capturado, "el bucle se quedaría con un estado huérfano"
    al.cerrar()
