"""El evaluador de supuestos ve el perfil de diana.

ROSA2018 consulta 16 bases curadas por hipótesis y guarda el resultado en
`perfilDiana`: expresión en tejido y por tipo celular (HPA, GTEx), función e
interactores (UniProt, STRING, Reactome), genética (GWAS Catalog, ClinVar),
fármacos (ChEMBL, DGIdb) y recuento de publicaciones (PubTator). 29 de las 34
hipótesis de la base lo tienen, y 26 de las 27 suspendidas.

`EvaluarSupuesto` no lo veía: recibía el supuesto y las afirmaciones de la
literatura, y nada más. Y muchos supuestos son exactamente eso (si algo se
expresa donde la hipótesis dice, si la proteína interactúa con quien se dice):
el propio docstring de la firma reconocía que "muchos supuestos no se contestan
leyendo artículos". Pasárselo no cuesta ninguna llamada.

Con un límite que no se negocia: de una base curada NO puede salir un
"contradicho". Contradecir falla la comprobación del Killer, y eso no lo decide
un modelo leyendo una tabla; exige señalar una afirmación numerada de la
literatura, y `validar_supuesto_evaluado` ya lo impone.
"""

from rosa.bucle.pasos import validar_supuesto_evaluado
from rosa.modulos import firmas as F


def test_la_firma_recibe_el_perfil_y_dice_para_que_sirve():
    assert "perfil_diana" in F.EvaluarSupuesto.model_fields
    doc = F.EvaluarSupuesto.__doc__ or ""
    assert "NO puede dar `contradicho`" in doc and "NO puede dar `respaldado`" in doc
    assert "de `sin_evidencia` a `plausible`" in doc
    # Y que una capa sin comprobar no cuenta como nada.
    assert 'Una capa en "no pude comprobar" no dice nada' in doc


def test_el_paso_se_lo_pasa_de_verdad():
    """Que exista el campo no basta: el paso tiene que rellenarlo."""
    import inspect

    from rosa.bucle import pasos as PASOS

    fuente = inspect.getsource(PASOS)
    i = fuente.index("ctx.programas.evaluar_supuesto")
    assert "perfil_diana=perfil_diana" in fuente[i : i + 260]
    assert "DI.texto_perfil(h.get(\"perfilDiana\")" in fuente


def test_un_contradicho_sin_afirmacion_numerada_no_pasa():
    """La regla que sujeta el límite: si el modelo dijera 'contradicho' apoyado
    en el perfil (que no está numerado), baja a 'sin_evidencia'."""
    afs = [{"id": "a1", "texto": "El GFAP sube en astrocitos"}]
    estado, evidencia, ids = validar_supuesto_evaluado("contradicho", "HPA dice que no se expresa en neuronas", [], afs)
    assert estado == "sin_evidencia" and ids == []
    assert "HPA dice que no se expresa en neuronas" in evidencia
    # Señalando una afirmación real sí vale.
    estado2, _, ids2 = validar_supuesto_evaluado("contradicho", "la afirmación 1 lo niega", [1], afs)
    assert estado2 == "contradicho" and ids2 == ["a1"]


def test_sin_perfil_el_texto_lo_dice_y_no_rompe():
    from rosa import dianas as DI

    for vacio in (None, {}, {"capas": []}):
        t = DI.texto_perfil(vacio)
        assert "sin consultar" in t
