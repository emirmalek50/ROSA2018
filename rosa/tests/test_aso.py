"""Oligonucleótidos antisentido: que el diseño salga de la secuencia y por
regla, que cada rechazo diga por qué, y que un candidato sin cribar contra el
transcriptoma NO se presente como algo que se pueda pedir.

Lo que estas pruebas defienden está escrito en la cabecera de rosa/aso.py: el
cribado de off-target no es una regla sino una búsqueda, los filtros son
estadística y no una predicción, y un gen no hace un solo ARN."""
from rosa import aso as ASO


def test_el_oligo_es_el_complemento_inverso_del_tramo_del_arn():
    # Es la base del mecanismo: el oligo encaja con el ARN como una cremallera.
    assert ASO.complemento_inverso("ACGT") == "ACGT"
    assert ASO.complemento_inverso("AAAA") == "TTTT"
    assert ASO.complemento_inverso("ATGGCC") == "GGCCAT"


def test_la_arquitectura_es_la_de_los_gapmers_aprobados():
    # 5-10-5: mipomersen, inotersen y volanesorsen son los tres así.
    assert ASO.LARGO == 20
    assert ASO.ALA == 5
    assert ASO.HUECO == 10
    p = ASO.partes("A" * 5 + "C" * 10 + "G" * 5)
    assert p["ala5"] == "AAAAA" and p["hueco"] == "CCCCCCCCCC" and p["ala3"] == "GGGGG"


def test_cada_rechazo_dice_que_filtro_fue_y_por_que():
    # Un veredicto sin explicación no sirve para decidir nada.
    m = ASO.evaluar("GGGGCGCGCGCGGGGCGCGC")
    assert m["pasa"] is False
    filtros = {f["filtro"] for f in m["fallos"]}
    assert "proporción de G y C" in filtros
    assert "dinucleótidos CpG" in filtros
    assert "tramo GGGG" in filtros
    for f in m["fallos"]:
        assert f["motivo"] and f["porQue"]


def test_los_filtros_hacen_lo_que_dicen():
    # CpG: activan TLR9.
    assert ASO.evaluar("ATCTTACGTTACTTATCTTA")["cpg"] == 1
    # Cuatro guaninas: bajan la actividad y forman cuádruplex.
    assert ASO.evaluar("ATCTTAGGGGTACTTATCTT")["g4"] is True
    # Y una secuencia corriente pasa.
    assert ASO.evaluar("CTCTCCCACTCCCACTTCTT")["pasa"] is True


def test_los_candidatos_vienen_de_sitios_distintos_del_transcrito():
    # Sin separación, los diez mejores son diez ventanas solapadas de la misma
    # región rica en motivos: un candidato disfrazado de diez.
    cdna = "CTCTCCCACTCCCACTTCTT" * 40  # una secuencia con la misma zona repetida
    cs = ASO.candidatos(cdna, maximo=5, separacion=60)
    posiciones = [c["posicion"] for c in cs]
    assert len(cs) == len(set(posiciones))
    for a, b in zip(sorted(posiciones), sorted(posiciones)[1:]):
        assert b - a >= 60


def test_un_candidato_sin_cribar_lo_dice_en_si_mismo():
    # El aviso viaja DENTRO del candidato, no en un texto de la pantalla: así
    # no se pierde al copiarlo ni al pasarlo a otra vista.
    cs = ASO.candidatos("CTCTCCCACTCCCACTTCTT" * 20)
    assert cs, "la secuencia de prueba debería dar algún candidato"
    for c in cs:
        assert c["cribado"] is False
        assert "transcriptoma" in c["avisoCribado"]


def test_sin_secuencia_es_no_pude_comprobar_y_no_no_se_puede():
    assert ASO.diseño(None) is None
    assert ASO.diseño({}) is None
    assert ASO.diseño({"cdna": ""}) is None


def test_el_diseño_dice_cuantos_transcritos_tiene_el_gen():
    # Cuál se baja no es lo mismo que cuánta se baja, y el número de
    # transcritos es lo que hace visible que esa decisión existe.
    d = ASO.diseño({"cdna": "CTCTCCCACTCCCACTTCTT" * 20, "transcrito": "ENST1", "transcritosDelGen": 55, "esCanonico": True, "build": "GRCh38"})
    assert d is not None
    assert d["transcritosDelGen"] == 55
    assert d["esCanonico"] is True
    assert d["cribados"] == 0


def test_el_texto_del_pedido_dice_que_es_un_candidato_y_no_un_farmaco():
    d = ASO.diseño({"cdna": "CTCTCCCACTCCCACTTCTT" * 20, "transcrito": "ENST1", "transcritosDelGen": 55, "build": "GRCh38"})
    assert d is not None
    t = ASO.como_texto("MAPT", d, d["candidatos"][0])
    assert "CANDIDATO PARA CRIBAR EN EL LABORATORIO, no un fármaco" in t
    assert "NO HECHO" in t  # el cribado
    assert "5-metilcitosina" in t and "fosforotioato" in t
    # Y la secuencia, que es lo que se manda.
    assert d["candidatos"][0]["secuencia"] in t


def test_una_ventana_con_letras_ambiguas_no_entra():
    # Una N en la secuencia no se puede sintetizar ni contar como diana.
    cs = ASO.candidatos("N" * 30 + "CTCTCCCACTCCCACTTCTT" * 5)
    assert all("N" not in c["secuencia"] and "N" not in c["diana"] for c in cs)
