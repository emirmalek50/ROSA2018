"""El cribado tiene que recoger lo que CONTRADICE una hipótesis viva, no solo lo
que la apoya.

Hasta el 29 de septiembre de 2026, `PuntuarRelevancia` puntuaba "cuánto ayuda
este artículo a responder el objetivo" y el criterio que recibía eran el
objetivo, la pregunta de la corrida y las preguntas abiertas. Nada le decía qué
resultado tumbaría una hipótesis viva, así que un artículo con el efecto nulo o
el signo contrario (el que cierra la pregunta en vez de alargarla) competía en
igualdad con uno que no viene a cuento. Es sesgo de confirmación metido en la
tubería, y no cuesta ninguna llamada arreglarlo: el `refuta` del experimento
prerregistrado y la predicción falsable de la tarjeta ya están en el estado.
"""

from rosa.bucle import contexto as T


def _hip(id_, titulo, estado="propuesta", refuta=None, falsable=None, iteracion=1):
    h = {"id": id_, "investigacionId": "inv-1", "titulo": titulo, "estado": estado, "iteracion": iteracion, "tarjeta": {}}
    if falsable:
        h["tarjeta"]["prediccionFalsable"] = falsable
    if refuta:
        h["experimento"] = {"refuta": refuta}
    return h


def test_el_criterio_dice_que_refutaria_cada_hipotesis_viva():
    hs = [_hip("h1", "GFAP precede a NfL", falsable="El GFAP no cambia antes que el NfL en la cohorte")]
    r = T.que_refutaria(hs, "inv-1")
    assert "GFAP precede a NfL" in r and "El GFAP no cambia antes que el NfL" in r
    # Y lo dice en voz alta, porque el modelo lo tiene que tratar como valioso.
    assert "tanto como uno que la apoye" in r


def test_manda_el_refuta_del_prerregistro_sobre_la_prediccion_de_la_tarjeta():
    """El `refuta` prerregistrado es más concreto (un intervalo, un signo, un
    umbral) que la predicción de la tarjeta: es el que reconoce un resultado."""
    hs = [_hip("h1", "Brecha GFAP-NfL", refuta="Un IC del 95 % de D completamente por debajo de cero", falsable="texto más vago de la tarjeta")]
    r = T.que_refutaria(hs, "inv-1")
    assert "IC del 95 % de D completamente por debajo de cero" in r
    assert "texto más vago" not in r


def test_una_descartada_o_suspendida_no_entra_y_otra_investigacion_tampoco():
    hs = [
        _hip("h1", "Descartada", estado="descartada", falsable="a"),
        _hip("h2", "Suspendida", estado="suspendida", falsable="b"),
        _hip("h3", "Viva", falsable="c"),
    ]
    ajena = _hip("h4", "De otra investigación", falsable="d")
    ajena["investigacionId"] = "inv-2"
    r = T.que_refutaria(hs + [ajena], "inv-1")
    assert "Viva" in r and "Descartada" not in r and "Suspendida" not in r and "otra investigación" not in r


def test_primero_las_que_mas_importa_refutar_y_con_tope():
    """Una aceptada o en revisión es la que más importa tumbar: si resulta falsa,
    lo que cuelga de ella cae también. Y el bloque tiene tope porque el cribado
    se hace cientos de veces por corrida."""
    hs = [
        _hip("h1", "Propuesta tardía", iteracion=9, falsable="p"),
        _hip("h2", "Aceptada", estado="aceptada", falsable="a"),
        _hip("h3", "En revisión", estado="en_revision", falsable="r"),
        _hip("h4", "Propuesta temprana", iteracion=1, falsable="t"),
    ]
    r = T.que_refutaria(hs, "inv-1")
    lineas = [x for x in r.split("\n") if x.startswith("- ")]
    assert len(lineas) == T.MAX_HIPOTESIS_EN_CRIBADO == 3
    assert "Aceptada" in lineas[0] and "En revisión" in lineas[1] and "Propuesta temprana" in lineas[2]


def test_sin_hipotesis_con_criterio_no_ensucia_el_prompt():
    assert T.que_refutaria([], "inv-1") == ""
    assert T.que_refutaria([_hip("h1", "Sin criterio")], "inv-1") == ""


def test_el_criterio_del_paso_lo_lleva_de_verdad():
    """No basta con que exista la función: el paso de literatura tiene que
    pasarla al modelo. Se comprueba sobre el código, que es lo que corre."""
    import inspect

    from rosa.bucle import pasos as PASOS

    fuente = inspect.getsource(PASOS._criterio)
    assert "que_refutaria" in fuente, "el cribado volvería a ver solo lo que confirma"
    from rosa.modulos import firmas as F

    firma = F.PuntuarRelevancia.__doc__ or ""
    assert "REFUTAR CUENTA IGUAL QUE APOYAR" in firma
