"""Cribado de los candidatos antisentido contra el transcriptoma humano.

Lo que estas pruebas defienden, y por qué, está en la cabecera de
rosa/criba.py. Lo esencial: que un choque en otro gen descarte, que un gen
anotado en el MISMO sitio del cromosoma con otro nombre NO descarte (el fallo
que dejaba 38 de los 39 candidatos de PSEN2 fuera por un choque inexistente),
que «sin cribar» y «limpio» nunca se confundan, y que reordenar no destruya
datos del estado.

No tocan los ficheros de Ensembl: son 225 MB que no están en el repositorio.
Se prueba la regla, que es lo que se puede romper sin darse cuenta."""
from typing import Any

from rosa import criba as CRIBA


def _golpe(tid: str, gen: str, cr: str = "1", ini: int = 1000, fin: int = 2000, hebra: str = "1", bio: str = "protein_coding") -> Any:
    return (tid, gen, bio, (cr, ini, fin, hebra))


def test_el_oligo_se_busca_por_su_complemento_inverso():
    # El ASO no aparece en el ARN: aparece su complemento inverso, que es el
    # tramo al que se pega. Buscar el ASO tal cual no encontraría nada.
    assert CRIBA._complemento_inverso("ACGT") == "ACGT"
    assert CRIBA._complemento_inverso("AAAATTTTGGGGCCCCACGT") == "ACGTGGGGCCCCAAAATTTT"


def test_un_choque_en_otro_gen_descarta_y_dice_cual():
    v = CRIBA._veredicto("NDST3", [_golpe("T1", "NDST3"), _golpe("T2", "NDST4", cr="4", ini=9, fin=99)])
    assert v["veredicto"] == "descartado"
    assert v["fuera"] == ["NDST4"]
    assert v["genesFuera"] == 1
    assert "NDST4" in v["porQue"] and "RNasa H1" in v["porQue"]


def test_un_gen_sin_nombre_en_el_mismo_sitio_NO_descarta():
    # El fallo real del 30 de septiembre de 2026: PSEN2 comparte locus con
    # ENSG00000288674, que Ensembl no ha nombrado, y contando por símbolo
    # salían 38 de 39 candidatos descartados por un choque que no existe.
    v = CRIBA._veredicto("PSEN2", [
        _golpe("T1", "PSEN2", cr="1", ini=226870616, fin=226896098),
        _golpe("T2", "", cr="1", ini=226870184, fin=226983855),
    ])
    assert v["veredicto"] == "sin choque exacto"
    assert v["transcritosFuera"] == 0
    assert v["transcritosMismoSitio"] == 1
    assert v["mismoSitioOtroNombre"] == ["(sin nombre en Ensembl)"]
    assert "mismo sitio" in v["porQue"]


def test_el_mismo_nombre_en_OTRO_sitio_si_descarta():
    # Un pseudogen procesado lleva el símbolo del padre con un sufijo, pero
    # si cayera con el mismo nombre en otro cromosoma sigue siendo otro ARN.
    v = CRIBA._veredicto("GFAP", [
        _golpe("T1", "GFAP", cr="17", ini=100, fin=200),
        _golpe("T2", "RPL14", cr="3", ini=500, fin=900),
    ])
    assert v["veredicto"] == "descartado"


def test_el_total_de_genes_es_exacto_aunque_la_lista_se_corte():
    # Un Alu real cae en 1.263 genes; decir «40» porque la lista se corta ahí
    # sería mentir por omisión.
    muchos = [_golpe("T0", "ATM", cr="11", ini=1, fin=9)] + [
        _golpe(f"T{i}", f"GEN{i}", cr="2", ini=i * 100, fin=i * 100 + 50) for i in range(1, 200)
    ]
    v = CRIBA._veredicto("ATM", muchos)
    assert v["genesFuera"] == 199
    assert len(v["fuera"]) == CRIBA.LIMITE_GENES
    assert "199 gen(es)" in v["porQue"]


def test_no_aparecer_ni_en_su_propio_gen_es_revisar_no_limpio():
    v = CRIBA._veredicto("MAPT", [])
    assert v["veredicto"] == "revisar"
    assert "No se puede pedir" in v["porQue"]


def test_sin_cribar_no_es_limpio():
    # La regla de ROSA2018: una fuente que no responde es «no pude comprobar»,
    # nunca «no hay». Aquí: sin el transcriptoma no se dice que esté limpio.
    assert CRIBA.SIN_CRIBAR["cribado"] is False
    assert CRIBA.SIN_CRIBAR["veredicto"] == "sin cribar"
    assert "no cribado no es limpio" in CRIBA.SIN_CRIBAR["porQue"]
    # Y tiene las mismas claves que un veredicto de verdad, para que la
    # pantalla no tenga que preguntar cuál de los dos le llegó.
    real = CRIBA._veredicto("X", [_golpe("T1", "X")])
    assert set(CRIBA.SIN_CRIBAR) == set(real)


def test_el_veredicto_limpio_dice_lo_que_NO_cubre():
    # Un cribado que se vende como completo y no lo es hace más daño que no
    # tenerlo: el texto tiene que decir que es exacto y sobre ARN maduro.
    v = CRIBA._veredicto("X", [_golpe("T1", "X")])
    assert v["veredicto"] == "sin choque exacto"
    assert "exacta" in v["porQue"] and "maduro" in v["porQue"]
    assert len(CRIBA.LIMITES) == 3
    assert all(l["que"] and l["porQue"] for l in CRIBA.LIMITES)


def test_la_peticion_sale_de_las_secuencias_con_su_gen():
    e = {"secuencias": {
        "P1": {"gen": "MAPT", "diseño": {"candidatos": [{"secuencia": "A" * 20}, {"secuencia": "C" * 20}]}},
        "P2": {"gen": "GFAP", "diseño": {"candidatos": [{"secuencia": "G" * 20}]}},
        "P3": {"gen": "X", "diseño": None},
        "P4": {"gen": "Y"},
    }}
    pet = CRIBA.peticion_de(e)
    assert len(pet) == 3
    assert {p["gen"] for p in pet} == {"MAPT", "GFAP"}


def test_la_huella_no_cambia_con_el_orden_pero_si_con_el_contenido():
    # Se criba por huella y no por contar: contar condenaría a recribar en
    # cada vuelta lo que ya está hecho.
    a = [{"secuencia": "A" * 20, "gen": "M"}, {"secuencia": "C" * 20, "gen": "G"}]
    assert CRIBA.huella_de(a) == CRIBA.huella_de(list(reversed(a)))
    assert CRIBA.huella_de(a) != CRIBA.huella_de(a[:1])
    assert CRIBA.huella_de(a) != CRIBA.huella_de([{"secuencia": "A" * 20, "gen": "OTRO"}, a[1]])


def test_pegar_pone_los_descartados_al_final():
    # `oligo_que_mandaria` coge el candidato número uno. Sin reordenar, ROSA2018
    # podría estar mandando un oligo que encaja en otros mil doscientos genes.
    e = {"criba": {"porSecuencia": {
        "A" * 20: {"cribado": True, "veredicto": "descartado", "porQue": "mal", "fuera": ["Z"], "genesFuera": 1, "transcritosFuera": 3, "propios": 1, "mismoSitioOtroNombre": [], "genesMismoSitio": 0, "transcritosMismoSitio": 0},
        "C" * 20: {"cribado": True, "veredicto": "sin choque exacto", "porQue": "bien", "fuera": [], "genesFuera": 0, "transcritosFuera": 0, "propios": 9, "mismoSitioOtroNombre": [], "genesMismoSitio": 0, "transcritosMismoSitio": 0},
    }}}
    dis = {"candidatos": [{"secuencia": "A" * 20}, {"secuencia": "C" * 20}]}
    r = CRIBA.pegar(e, dis)
    assert r is not None
    assert r["candidatos"][0]["secuencia"] == "C" * 20
    assert r["candidatos"][0]["cribado"] is True
    assert r["descartadosPorCriba"] == 1 and r["limpios"] == 1


def test_pegar_no_destruye_el_diseño_del_estado():
    # Una lectura no puede destruir datos. Ya pasó una vez con `aligerar`, que
    # recortaba la lista viva del estado y dejaba en ocho los sesenta
    # candidatos guardados.
    dis: dict[str, Any] = {"candidatos": [{"secuencia": "A" * 20, "gc": 0.5}, {"secuencia": "C" * 20}]}
    e = {"criba": {"porSecuencia": {}}, "secuencias": {"P1": {"gen": "M", "diseño": dis}}}
    r = CRIBA.pegar(e, dis)
    assert r is not None
    r["candidatos"].clear()
    r["candidatos"] = []
    assert len(dis["candidatos"]) == 2
    assert "criba" not in dis["candidatos"][0]


def test_sin_transcriptoma_se_dice_y_no_se_finge():
    t = CRIBA.transcriptoma()
    assert set(t) >= {"hay", "ficheros", "carpeta", "motivo"}
    assert len(t["ficheros"]) == 2
    if not t["hay"]:
        assert "no cribado" in t["motivo"] or "Falta descargar" in t["motivo"]


def test_cancelar_el_cribado_no_deja_procesos_huerfanos():
    """Un hijo NO muere con su padre.

    El 30 de septiembre de 2026 cada reinicio del servidor dejaba cuatro
    procesos moliendo el fichero de 225 MB; llegó a haber tres generaciones a
    la vez, diez procesos peleando por cuatro núcleos, y el cribado en curso no
    terminaba nunca porque no le quedaba máquina. Ahora se matan al salir.

    Necesita el transcriptoma descargado, así que se salta donde no está (no
    viaja en el repositorio: son 225 MB)."""
    import asyncio
    import subprocess

    import pytest

    if not CRIBA.transcriptoma()["hay"]:
        pytest.skip("hace falta el transcriptoma de Ensembl en datos/_transcriptoma")

    def cuantos() -> int:
        r = subprocess.run(["pgrep", "-f", r"rosa\.criba"], capture_output=True, text=True)
        return len([x for x in r.stdout.split() if x.strip()])

    antes = cuantos()

    async def prueba() -> None:
        pet = [{"secuencia": "ACGT" * 5, "gen": "X"}] * 4
        t = asyncio.create_task(CRIBA.cribar_aparte(pet))
        # Lo justo para que los hijos existan de verdad.
        for _ in range(40):
            await asyncio.sleep(0.1)
            if cuantos() > antes:
                break
        assert cuantos() > antes, "los procesos hijos no llegaron a arrancar"
        t.cancel()
        with __import__("contextlib").suppress(asyncio.CancelledError):
            await t

    asyncio.run(prueba())
    # Darles un instante a que el sistema los recoja.
    for _ in range(30):
        if cuantos() <= antes:
            break
        import time

        time.sleep(0.1)
    assert cuantos() <= antes, "quedaron procesos de cribado huérfanos tras cancelar"


def test_solo_se_criba_lo_que_falta():
    """Un resultado ya calculado no cambia nunca: una secuencia es la que es y
    el fichero de Ensembl también.

    Recribar las 787 secuencias porque apareció una diana nueva son seis
    minutos tirados. Esto comprueba la cuenta que hace el bucle antes de
    lanzar nada."""
    pet = [{"secuencia": s, "gen": "X"} for s in ("A" * 20, "C" * 20, "G" * 20)]
    ya = {"A" * 20: {"veredicto": "sin choque exacto"}}
    faltan = [x for x in pet if x["secuencia"] not in ya]
    assert len(faltan) == 2
    # Y lo que ya no se diseña se cae, para que no queden veredictos zombis.
    vivas = {x["secuencia"] for x in pet}
    ya_con_basura = {**ya, "T" * 20: {"veredicto": "descartado"}}
    limpio = {k: v for k, v in ya_con_basura.items() if k in vivas}
    assert set(limpio) == {"A" * 20}


def test_pegar_marca_sin_cribar_lo_que_todavia_no_paso():
    """Mezclar cribado y sin cribar en la misma pantalla es lo normal mientras
    el proceso corre; lo que no puede pasar es que un sin cribar se pinte como
    limpio."""
    e = {"criba": {"porSecuencia": {"A" * 20: {
        "cribado": True, "veredicto": "sin choque exacto", "propios": 4, "fuera": [],
        "genesFuera": 0, "transcritosFuera": 0, "mismoSitioOtroNombre": [],
        "genesMismoSitio": 0, "transcritosMismoSitio": 0, "porQue": "bien",
    }}}}
    r = CRIBA.pegar(e, {"candidatos": [{"secuencia": "A" * 20}, {"secuencia": "C" * 20}]})
    assert r is not None
    veredictos = [c["criba"]["veredicto"] for c in r["candidatos"]]
    assert veredictos == ["sin choque exacto", "sin cribar"]
    assert r["cribados"] == 1 and r["limpios"] == 1


# ---------------------------------------------------------------------------
# Cribado tolerante a desajustes (BLAST)
# ---------------------------------------------------------------------------


def test_btop_dice_donde_falla_no_solo_cuantos():
    # Es la base de toda la regla: la RNasa H1 corta según DÓNDE caiga el
    # fallo, no según cuántos haya.
    assert CRIBA.fallos_de_btop("20") == []
    assert CRIBA.fallos_de_btop("10AG9") == [11]
    assert CRIBA.fallos_de_btop("5CT4GA9") == [6, 11]
    assert CRIBA.fallos_de_btop("AG19") == [1]
    assert CRIBA.fallos_de_btop("19AG") == [20]


def test_el_hueco_son_las_diez_del_centro():
    # Si en rosa/aso.py cambia la arquitectura 5-10-5, esto cambia solo.
    from rosa import aso as ASO

    assert CRIBA.HUECO_DESDE == ASO.ALA + 1
    assert CRIBA.HUECO_HASTA == ASO.ALA + ASO.HUECO
    assert (CRIBA.HUECO_DESDE, CRIBA.HUECO_HASTA) == (6, 15)
    assert CRIBA.en_el_hueco([6]) and CRIBA.en_el_hueco([15]) and CRIBA.en_el_hueco([10])
    # Las alas no.
    assert not CRIBA.en_el_hueco([1, 5, 16, 20])


def test_un_fallo_en_las_ALAS_descarta_y_uno_en_el_HUECO_no():
    """El corazón de la regla, y lo que la separa de contar fallos.

    La RNasa H1 no lee las veinte letras: reconoce la dúplex de ADN con ARN
    que forma el hueco de diez del centro. Con el hueco perfecto corta aunque
    fallen las alas; con un fallo dentro del hueco, no."""
    CRIBA._MAPA_CACHE = {
        "T_MIO": ("MAPT", "17", 100, 200, "1"),
        "T_OTRO": ("OTRO", "3", 500, 600, "1"),
    }
    try:
        # Falla una letra, en el ALA: el hueco encaja -> descartado.
        v = CRIBA._veredicto_blast("MAPT", [("T_MIO", 0, []), ("T_OTRO", 1, [2])])
        assert v["veredicto"] == "descartado"
        assert "hueco de ADN encaja PERFECTO" in v["porQue"]
        assert "OTRO" in v["porQue"]
        # La misma letra de fallo, pero DENTRO del hueco: no corta ahí.
        v2 = CRIBA._veredicto_blast("MAPT", [("T_MIO", 0, []), ("T_OTRO", 1, [10])])
        assert v2["veredicto"] == "sin parecido"
        assert v2["conFalloEnElHueco"] == 1
    finally:
        CRIBA._MAPA_CACHE = None


def test_dos_fallos_en_las_alas_avisan_pero_no_descartan():
    """Porque a dos fallos el azar ya da encajes.

    Medido, no supuesto: 300 secuencias de veinte letras al azar por la misma
    tubería dan un 2,7 % con un encaje así, frente al 0,7 % de uno o cero.
    Descartar por eso sería descartar por ruido."""
    CRIBA._MAPA_CACHE = {"T_MIO": ("GFAP", "17", 1, 99, "1"), "T_OTRO": ("AJENO", "5", 1, 99, "1")}
    try:
        v = CRIBA._veredicto_blast("GFAP", [("T_MIO", 0, []), ("T_OTRO", 2, [2, 19])])
        assert v["veredicto"] == "al borde del azar"
        assert "no descarta" in v["porQue"]
        # Y el nulo viaja con el resultado, para que nadie tenga que fiarse.
        assert v["nulo"]["2"] == CRIBA.NULO[2]
        assert v["nuloN"] == 300
    finally:
        CRIBA._MAPA_CACHE = None


def test_tres_fallos_es_ruido_y_se_dice_con_el_numero():
    CRIBA._MAPA_CACHE = {"T_MIO": ("C3", "19", 1, 99, "1"), "T_OTRO": ("AJENO", "5", 1, 99, "1")}
    try:
        v = CRIBA._veredicto_blast("C3", [("T_MIO", 0, []), ("T_OTRO", 3, [1, 2, 20])])
        assert v["veredicto"] == "sin parecido"
        assert "6,3 %" in v["porQue"]
    finally:
        CRIBA._MAPA_CACHE = None


def test_el_filtro_de_locus_tambien_vale_con_BLAST():
    # El fallo de PSEN2: un gen sin nombre anotado encima del mismo tramo no
    # es un fuera de diana. Sin esto salían 51 choques exactos donde hay 13.
    CRIBA._MAPA_CACHE = {
        "T_MIO": ("PSEN2", "1", 226870616, 226896098, "1"),
        "T_SIN_NOMBRE": ("", "1", 226870184, 226983855, "1"),
    }
    try:
        v = CRIBA._veredicto_blast("PSEN2", [("T_MIO", 0, []), ("T_SIN_NOMBRE", 0, [])])
        assert v["veredicto"] == "sin parecido"
        assert v["genesFuera"] == 0
        assert v["genesMismoSitio"] == 1
    finally:
        CRIBA._MAPA_CACHE = None


def test_el_veredicto_de_blast_tiene_las_mismas_claves_que_el_exacto():
    """BLAST sustituye al barrido cuando está, así que la pantalla no puede
    tener que preguntar de cuál de los dos viene el veredicto."""
    CRIBA._MAPA_CACHE = {"T": ("X", "1", 1, 9, "1")}
    try:
        b = CRIBA._veredicto_blast("X", [("T", 0, [])])
    finally:
        CRIBA._MAPA_CACHE = None
    e = CRIBA._veredicto("X", [("T", "X", "protein_coding", ("1", 1, 9, "1"))])
    assert set(e) <= set(b), f"a BLAST le faltan: {set(e) - set(b)}"


def test_sin_blast_se_dice_y_no_se_finge():
    t = CRIBA.hay_blast()
    assert set(t) >= {"hay", "programa", "indice", "motivo"}
    if not t["hay"]:
        assert "Falta" in t["motivo"] and "no descarta" in t["motivo"]


def test_el_cribado_devuelve_la_version_del_MODULO_no_la_de_blast():
    """Si no, el bucle no reconoce su propio resultado y recriba sin parar.

    Pasó el 1 de octubre de 2026: `cribar_con_desajustes` devolvía
    VERSION_BLAST (1) donde el bucle compara contra VERSION (2), así que tras
    158 s de BLAST volvía a empezar. Es el mismo modo de fallo que la
    heurística de contar candidatos, por otra puerta."""
    import asyncio

    r = asyncio.run(CRIBA.cribar_con_desajustes([]))
    assert r["version"] == CRIBA.VERSION
    assert r["versionBlast"] == CRIBA.VERSION_BLAST
    # Y el barrido exacto, igual.
    r2 = asyncio.run(CRIBA.cribar_aparte([]))
    assert r2["version"] == CRIBA.VERSION


def test_lo_de_las_especies_sube_al_candidato_y_no_se_queda_dentro_del_cribado():
    """Son dos preguntas distintas: dónde NO queremos que corte, y dónde se
    puede probar esto. La pantalla y la decisión leen la segunda aparte, y si
    se queda enterrada dentro del cribado no la ve nadie."""
    e = {"criba": {"porSecuencia": {"A" * 20: {
        "cribado": True, "veredicto": "sin parecido", "porQue": "bien", "propios": 3,
        "fuera": [], "genesFuera": 0, "transcritosFuera": 0, "mismoSitioOtroNombre": [],
        "genesMismoSitio": 0, "transcritosMismoSitio": 0,
        "especies": {"veredicto": "paquete completo", "tieneRoedor": True, "tieneNoRoedor": True, "sirvenEn": ["ratón", "macaco"]},
    }}}}
    r = CRIBA.pegar(e, {"candidatos": [{"secuencia": "A" * 20}, {"secuencia": "C" * 20}]})
    assert r is not None
    c0 = r["candidatos"][0]
    assert c0["especies"]["veredicto"] == "paquete completo"
    # Y no duplicado dentro del cribado.
    assert "especies" not in c0["criba"]
    # El que no se cribó no se inventa un veredicto de especies.
    assert r["candidatos"][1]["especies"] is None
    assert r["conPaqueteCompleto"] == 1
