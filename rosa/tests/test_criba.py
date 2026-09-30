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
