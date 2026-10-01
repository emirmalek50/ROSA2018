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


# ---------------------------------------------------------------------------
# La dúplex (rosa/duplex.py)
# ---------------------------------------------------------------------------


def test_la_duplex_es_antiparalela_y_el_arn_va_de_5_a_3():
    """Las dos cadenas van en sentidos contrarios, y el ARN de izquierda a
    derecha se lee de 5' a 3', que es como se escribe.

    La primera versión tenía las letras en un sentido y las etiquetas 5' y 3'
    diciendo el contrario, que es de los errores que un biólogo ve al
    instante."""
    from rosa import duplex as DUPLEX

    aso = "CTCTCCCACTCCCACTTCTT"
    diana = ASO.complemento_inverso(aso)
    d = DUPLEX.de_un_candidato(aso, diana, ASO.ALA, ASO.HUECO)
    # El ARN, leído de izquierda a derecha, es el tramo tal cual.
    assert "".join(p["arn"] for p in d["pares"]) == diana.replace("T", "U")
    # Y el oligo, al revés: la columna 1 lleva su ÚLTIMA letra.
    assert "".join(p["aso"] for p in d["pares"]) == aso[::-1]
    assert d["pares"][0]["posAso"] == len(aso)
    assert d["pares"][-1]["posAso"] == 1


def test_el_arn_de_la_duplex_lleva_U_y_nunca_T():
    """El ARN mensajero no tiene timina. El tramo diana viene del cDNA, que sí
    se escribe con T, y por ahí se coló una T en la fila del ARN."""
    from rosa import duplex as DUPLEX

    aso = "AAAACCCCGGGGTTTTACGT"
    d = DUPLEX.de_un_candidato(aso, ASO.complemento_inverso(aso), ASO.ALA, ASO.HUECO)
    arn = "".join(p["arn"] for p in d["pares"])
    assert "T" not in arn
    assert "U" in arn
    # El oligo sí lleva T: en el hueco es ADN.
    assert "T" in "".join(p["aso"] for p in d["pares"])


def test_cada_columna_de_la_duplex_empareja_de_verdad():
    """Si una columna no empareja, el dibujo está mintiendo sobre el
    mecanismo entero."""
    from rosa import duplex as DUPLEX

    comp = {"A": "U", "U": "A", "G": "C", "C": "G"}
    for aso in ("CTCTCCCACTCCCACTTCTT", "AAAACCCCGGGGTTTTACGT", "GCGCATATGCGCATATGCGC"):
        d = DUPLEX.de_un_candidato(aso, ASO.complemento_inverso(aso), ASO.ALA, ASO.HUECO)
        for p in d["pares"]:
            del_oligo = "U" if p["aso"] == "T" else p["aso"]
            assert comp[p["arn"]] == del_oligo, f"la columna {p['i']} no empareja: {p['arn']} con {p['aso']}"


def test_el_hueco_y_el_corte_van_en_columnas_del_dibujo():
    """Y se CALCULAN, no se dan por hecho: con 5-10-5 salen los mismos números
    porque es simétrica, pero una arquitectura asimétrica lo rompería en
    silencio."""
    from rosa import duplex as DUPLEX

    aso = "A" * 20
    d = DUPLEX.de_un_candidato(aso, ASO.complemento_inverso(aso), ASO.ALA, ASO.HUECO)
    assert d["hueco"] == [6, 15]
    assert d["huecoEnElOligo"] == [6, 15]
    # Las columnas del hueco son exactamente las de química «hueco».
    c = [p["i"] for p in d["pares"] if p["quimica"] == "hueco"]
    assert [min(c), max(c)] == d["hueco"]
    assert len(c) == ASO.HUECO
    # Con una arquitectura asimétrica las columnas YA NO coinciden con las
    # posiciones del oligo, y es justo lo que hay que no romper.
    d2 = DUPLEX.de_un_candidato("A" * 20, "T" * 20, 3, 14)
    c2 = [p["i"] for p in d2["pares"] if p["quimica"] == "hueco"]
    assert [min(c2), max(c2)] == d2["hueco"]
    assert d2["huecoEnElOligo"] == [4, 17]


def test_la_duplex_dice_que_NO_es_una_estructura_resuelta():
    """Se intentó generar un PDB para el visor 3D y hubo que tirarlo: los
    parámetros publicados dan la forma de la hélice, no dónde está cada átomo,
    y ponerlos habría sido inventarlos."""
    from rosa import duplex as DUPLEX

    d = DUPLEX.de_un_candidato("A" * 20, "T" * 20, ASO.ALA, ASO.HUECO)
    assert len(d["avisos"]) == 3
    textos = " ".join(a["que"] + a["porQue"] for a in d["avisos"])
    assert "no una estructura resuelta" in textos.lower()
    assert "inventar" in textos.lower()
    # Y ninguna coordenada atómica.
    assert "pdb" not in d
