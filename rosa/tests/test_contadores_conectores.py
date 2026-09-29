"""Los contadores de uso de los conectores sobreviven al reinicio.

Medido el 29 de septiembre de 2026 sobre la base: el estado guarda 1.099
consultas a conectores hechas de verdad (en `hipotesis[].consultas` y en el
perfil de diana) y la pantalla de Conectores decía que los 87 tienen 0 usos y
0 errores. `Conector.usos` vive en el proceso, y al cargar el estado se
rehacía el catálogo desde el código, que arranca a cero. Así que la pantalla
que existe para enseñar cuál responde y cuál lleva fallando enseñaba siempre
lo mismo: nada.
"""

import shutil
import tempfile
from pathlib import Path

from rosa.conectores import REGISTRO, catalogo
from rosa.estado.almacen import Almacen


def _base(tmp):
    al = Almacen(tmp / "c.db")
    al.cerrar()
    return tmp / "c.db"


def _guardar_catalogo(ruta):
    al = Almacen(ruta)
    al.mutar(lambda e: (e.update(conectores=catalogo()), True)[1], "test")
    al.cerrar()


def test_los_contadores_siguen_ahi_al_arrancar_otra_vez():
    tmp = Path(tempfile.mkdtemp())
    ruta = _base(tmp)
    c = REGISTRO["uniprot_proteina"]
    antes = (c.usos, c.errores, c.ultimo_uso)
    try:
        c.usos, c.errores, c.ultimo_uso = 7, 2, 123_456
        _guardar_catalogo(ruta)
        # Proceso nuevo: el registro del código arranca a cero.
        c.usos, c.errores, c.ultimo_uso = 0, 0, None
        al = Almacen(ruta)
        try:
            x = next(y for y in al.estado["conectores"] if y["nombre"] == "uniprot_proteina")
            assert (x["usos"], x["errores"], x["ultimoUso"]) == (7, 2, 123_456)
            # Y el registro del proceso queda sembrado, así que la siguiente llamada suma 8.
            assert REGISTRO["uniprot_proteina"].usos == 7
        finally:
            al.cerrar()
    finally:
        c.usos, c.errores, c.ultimo_uso = antes


def test_nunca_baja_un_contador_ni_se_rompe_con_basura():
    """El proceso puede haber sumado más que lo guardado (se guarda al cerrar,
    no en cada llamada): se queda el mayor de los dos, nunca el menor."""
    tmp = Path(tempfile.mkdtemp())
    ruta = _base(tmp)
    c = REGISTRO["uniprot_proteina"]
    antes = (c.usos, c.errores, c.ultimo_uso)
    try:
        c.usos = 3
        _guardar_catalogo(ruta)
        c.usos = 11  # el proceso siguió trabajando
        al = Almacen(ruta)
        try:
            assert REGISTRO["uniprot_proteina"].usos == 11
        finally:
            al.cerrar()
        # Basura en el estado: nombres que no existen, valores que no son números.
        al = Almacen(ruta)
        al.mutar(lambda e: (e.update(conectores=[{"nombre": "no_existe", "usos": 5}, {"nombre": "uniprot_proteina", "usos": None, "ultimoUso": "ayer"}, "ni siquiera un dict"]), True)[1], "test")
        al.cerrar()
        al = Almacen(ruta)
        try:
            assert len(al.estado["conectores"]) == len(REGISTRO)
        finally:
            al.cerrar()
    finally:
        c.usos, c.errores, c.ultimo_uso = antes

