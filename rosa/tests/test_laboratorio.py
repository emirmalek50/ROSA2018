"""Lo que va al laboratorio: que las dianas salgan de lo que la evidencia
nombra, que un compuesto sin SMILES no se publique, que la fórmula nunca haga
de identificador y que el cribado de la barrera diga cuándo no puede juzgar.

Los tres invariantes que estas pruebas defienden están escritos en la cabecera
de rosa/laboratorio.py: ROSA2018 no diseña moléculas, la fórmula no identifica
un compuesto y quien decide si algo es un compuesto es PubChem."""
from rosa import laboratorio as LAB


def _estado():
    """Una investigación con tres hipótesis: dos con diana resuelta (una de
    ellas compartida) y una sin perfil de diana."""
    return {
        "investigaciones": [{"id": "inv", "titulo": "Reducir tau", "objetivo": "x"}],
        "hipotesis": [
            {
                "id": "h1", "investigacionId": "inv", "estado": "propuesta", "decisionKiller": "avanzar",
                "titulo": "SULF2 como barrera",
                "conclusion": {"certeza": "baja"},
                "perfilDiana": {"identificadores": {"uniprot": "Q8IWU5", "simbolo": "SULF2", "nombre": "Extracellular sulfatase Sulf-2"}},
                "tarjeta": {"intervencion": "Expresión inducible de SULF2", "prediccionFalsable": "entra menos tau"},
                "experimento": {"controles": "vector vacío", "refuta": "que la entrada de tau no cambie", "sistema": {"tipo": "ipsc"}},
            },
            {
                "id": "h2", "investigacionId": "inv", "estado": "propuesta", "decisionKiller": "suspender",
                "titulo": "SULF2 otra vez",
                "conclusion": {"certeza": "muy_baja"},
                "perfilDiana": {"identificadores": {"uniprot": "Q8IWU5", "simbolo": "SULF2", "nombre": "Extracellular sulfatase Sulf-2"}},
                "tarjeta": {}, "experimento": {},
            },
            {"id": "h3", "investigacionId": "inv", "estado": "propuesta", "titulo": "sin diana", "tarjeta": {"intervencion": "donepezilo a 10 mg"}},
            {"id": "h4", "investigacionId": "otra", "estado": "propuesta", "perfilDiana": {"identificadores": {"uniprot": "P10636", "simbolo": "MAPT"}}},
            {"id": "h5", "investigacionId": "inv", "estado": "descartada", "perfilDiana": {"identificadores": {"uniprot": "P05067", "simbolo": "APP"}}},
        ],
    }


def test_las_dianas_salen_de_las_hipotesis_vivas_de_esa_investigacion():
    d = LAB.dianas_de(_estado(), "inv")
    assert [x["uniprot"] for x in d] == ["Q8IWU5"]  # ni la de otra investigación ni la descartada
    assert d[0]["enHipotesis"] == 2
    assert {h["id"] for h in d[0]["hipotesis"]} == {"h1", "h2"}


def test_la_url_de_la_estructura_es_la_de_alphafold_y_se_dice_que_es_predicha():
    d = LAB.dianas_de(_estado(), "inv")[0]
    assert d["estructura"]["url"] == LAB.url_alphafold("Q8IWU5")
    assert d["estructura"]["clase"] == "predicha"  # una predicción no es una medición
    assert d["estructura"]["licencia"] == "CC BY 4.0"


def test_la_hoja_sale_de_la_hipotesis_que_mas_lejos_ha_llegado():
    # Las dos nombran SULF2, pero h1 avanza y h2 está suspendida: manda h1.
    d = LAB.dianas_de(_estado(), "inv")[0]
    assert [h["id"] for h in d["hipotesis"]] == ["h1", "h2"]
    hoja = LAB.hoja_de_pedido(d)
    assert hoja["identificador"] == "UniProt Q8IWU5"
    assert hoja["sistema"] == "ipsc"
    assert hoja["faltan"] == []  # h1 trae el contrato completo
    vacia = LAB.hoja_de_pedido({"uniprot": "X", "hipotesis": [{"titulo": "t"}]})
    assert vacia["faltan"] == ["qué se hace", "controles", "qué lo refutaría", "sistema experimental"]
    assert vacia["queSeHace"] == ""  # no se rellena con nada inventado


def test_sin_smiles_no_hay_ficha_de_compuesto():
    # La fórmula sola no identifica: la comparten los isómeros. Sin SMILES la
    # ficha no se publica, por mucho que PubChem haya devuelto lo demás.
    assert LAB.ficha_de_compuesto("x", {"cid": 1, "formula": "C24H29NO3", "peso": "379.5"}) is None
    assert LAB.ficha_de_compuesto("x", None) is None
    assert LAB.ficha_de_compuesto("x", {}) is None
    f = LAB.ficha_de_compuesto("donepezilo", {"cid": 3152, "formula": "C24H29NO3", "peso": "379.5", "smiles": "O=C1...", "inchikey": "ADEBPBSSDYVVLD-UHFFFAOYSA-N", "logp": 4.2, "tpsa": 38.8})
    assert f is not None and f["smiles"] and f["inchikey"]
    assert f["licencia"] == "dominio público"


def test_el_cribado_de_la_barrera_dice_cuando_no_puede_juzgar():
    # Sin propiedades no se inventa un veredicto: "no pude comprobar".
    assert LAB.llegada_al_cerebro(None, None, None)["veredicto"] == "no_comprobable"
    assert LAB.llegada_al_cerebro(379.5, None, 38.8)["veredicto"] == "no_comprobable"
    assert LAB.llegada_al_cerebro(379.5, "no es un número", 38.8)["veredicto"] == "no_comprobable"


def test_el_cribado_de_la_barrera_aplica_los_tres_umbrales():
    assert LAB.llegada_al_cerebro(379.5, 4.0, 38.8)["veredicto"] == "compatible"
    # La semaglutida: peso, logP y superficie polar fuera de banda a la vez.
    fuera = LAB.llegada_al_cerebro(4113.6, -5.8, 1650.0)
    assert fuera["veredicto"] == "improbable"
    assert "450" in fuera["motivo"] and "logP" in fuera["motivo"] and "90" in fuera["motivo"]
    # Y no se cierra la puerta: puede entrar por transportador.
    assert "transportador" in fuera["motivo"]
    assert LAB.llegada_al_cerebro(451.0, 2.0, 40.0)["veredicto"] == "improbable"
    assert LAB.llegada_al_cerebro(300.0, 0.9, 40.0)["veredicto"] == "improbable"
    assert LAB.llegada_al_cerebro(300.0, 2.0, 90.1)["veredicto"] == "improbable"


def test_los_candidatos_a_compuesto_son_un_colador_ancho_pero_no_cogen_genes():
    c = LAB.candidatos_de_compuesto(["Tratamiento con donepezilo y lecanemab en portadores"])
    assert "lecanemab" in c
    # Siglas de genes, cohortes y técnicas no pasan aunque la forma encaje.
    assert LAB.candidatos_de_compuesto(["Supresión de MAPT y SULF2 en la cohorte ADNI medida por ELISA"]) == []


def test_el_resumen_cuadra_con_lo_que_hay():
    e = _estado()
    d = LAB.laboratorio(e, "inv", [])
    r = d["resumen"]
    assert r["dianas"] == 1
    assert r["hipotesisVivas"] == 3  # h1, h2, h3; ni h4 (otra investigación) ni h5 (descartada)
    assert r["hipotesisConDiana"] == 2
    assert r["sinDiana"] == 1
    assert r["compuestos"] == 0


def test_sin_investigacion_no_revienta_y_no_inventa():
    d = LAB.laboratorio({"investigaciones": [], "hipotesis": []}, "no-existe", [])
    assert d["dianas"] == [] and d["compuestos"] == []
    assert d["resumen"]["dianas"] == 0


def test_la_suspendida_no_manda_aunque_gane_por_orden_alfabetico():
    # Adversarial: se le pone a la suspendida un título que ordena antes. Si la
    # hoja saliera del orden del texto y no de la decisión del Killer, la
    # investigación mandaría al laboratorio una hipótesis que está parada.
    e = _estado()
    por_id = {h["id"]: h for h in e["hipotesis"]}
    por_id["h2"]["titulo"] = "AAA suspendida"
    por_id["h2"]["tarjeta"] = {"intervencion": "no hacer nada"}
    d = LAB.dianas_de(e, "inv")[0]
    assert d["hipotesis"][0]["id"] == "h1"
    assert LAB.hoja_de_pedido(d)["queSeHace"] == "Expresión inducible de SULF2"


def test_un_perfil_de_diana_sin_uniprot_no_entra():
    # Un símbolo escrito en un texto no es una proteína identificada: sin
    # UniProt no hay estructura que traer ni identificador que mandar.
    e = _estado()
    e["hipotesis"].append({"id": "h6", "investigacionId": "inv", "estado": "propuesta", "perfilDiana": {"identificadores": {"simbolo": "TREM2"}}})
    assert [d["uniprot"] for d in LAB.dianas_de(e, "inv")] == ["Q8IWU5"]


# ---------------------------------------------------------------------------
# La unión: todas las investigaciones, no una
# ---------------------------------------------------------------------------


def _mundo():
    """Dos investigaciones que nombran la misma proteína, más los nombres que
    la normalización de entidades resolvió mal."""
    def hecho(i, inv, simbolo, hgnc, uniprot, estado="sabido", ref="Fuente A"):
        return {
            "id": f"he-{i}", "investigacionId": inv, "tipo": "hecho", "estado": estado,
            "tema": f"Tema {i}", "enunciado": f"Enunciado {i}",
            "procedencia": [{"fuenteId": f"f-{ref}", "referencia": ref}],
            "citas": [{"referencia": ref, "fragmento": f"fragmento {i}"}],
            "entidades": [{"id": hgnc, "etiqueta": simbolo, "ontologia": "HGNC", "tipo": "gen", **({"uniprot": uniprot} if uniprot else {})}],
        }
    return {
        "investigaciones": [{"id": "inv-a", "titulo": "Investigación A"}, {"id": "inv-b", "titulo": "Investigación B"}],
        "entidadesCache": {
            "gen:MAPT": {"simbolo": "MAPT", "nombre": "microtubule associated protein tau", "uniprot": "P10636", "tipo": "gen", "resueltoPor": "symbol"},
            "gen:GFAP": {"simbolo": "GFAP", "nombre": "glial fibrillary acidic protein", "uniprot": "P14136", "tipo": "gen", "resueltoPor": "symbol"},
            # ADAS es la escala ADAS-Cog; la normalización la resolvió como AGPS.
            "gen:ADAS": {"simbolo": "AGPS", "nombre": "alkylglycerone phosphate synthase", "uniprot": "O00116", "tipo": "gen", "resueltoPor": "alias_symbol"},
            # HD es la enfermedad de Huntington, resuelta por símbolo antiguo.
            "gen:HD": {"simbolo": "HTT", "nombre": "huntingtin", "uniprot": "P42858", "tipo": "gen", "resueltoPor": "prev_symbol"},
            "gen:CA2": {"simbolo": "CA2", "nombre": "carbonic anhydrase 2", "uniprot": "P00918", "tipo": "gen", "resueltoPor": "symbol"},
        },
        "relaciones": [
            {"id": "r1", "investigacionId": None, "de": "amiloide", "a": "tau", "tipo": "base_curada", "contexto": "el amiloide precede a la tau"},
            {"id": "r2", "investigacionId": None, "de": "tau", "a": "neurodegeneracion", "tipo": "base_curada", "contexto": "la tau se asocia a la pérdida neuronal"},
        ],
        "hipotesis": [],
        "hechos": [
            hecho(1, "inv-a", "MAPT (tau)", "HGNC:6893", "P10636"),
            hecho(2, "inv-a", "MAPT (tau)", "HGNC:6893", None, estado="abierto", ref="Fuente B"),
            hecho(3, "inv-b", "MAPT (tau)", "HGNC:6893", "P10636", ref="Fuente C"),
            hecho(4, "inv-a", "GFAP", "HGNC:4235", "P14136"),
            hecho(13, "inv-b", "GFAP", "HGNC:4235", "P14136", ref="Fuente C"),
            # Una sola mención: no llega a diana aunque esté bien resuelta.
            hecho(5, "inv-b", "CA2", "HGNC:1373", "P00918"),
            # Mal resueltas: no pueden acabar en un pedido.
            hecho(6, "inv-a", "AGPS", "HGNC:327", "O00116"),
            hecho(7, "inv-b", "AGPS", "HGNC:327", "O00116"),
            hecho(8, "inv-a", "HTT", "HGNC:4851", "P42858"),
            hecho(9, "inv-b", "HTT", "HGNC:4851", "P42858"),
            # Resuelta en HGNC y sin UniProt: no hay estructura que traer.
            hecho(10, "inv-a", "TREM2", "HGNC:17761", None),
            hecho(11, "inv-b", "TREM2", "HGNC:17761", None),
            hecho(12, "inv-b", "TREM2", "HGNC:17761", None, ref="Fuente C"),
        ],
    }


def test_una_proteina_de_dos_investigaciones_sale_una_vez_con_la_evidencia_sumada():
    d = LAB.laboratorio(_mundo())
    mapt = next(x for x in d["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["hechos"] == 3  # dos de inv-a y una de inv-b
    assert mapt["sabidos"] == 2 and mapt["abiertos"] == 1
    assert mapt["fuentes"] == 3
    assert [i["titulo"] for i in mapt["investigaciones"]] == ["Investigación A", "Investigación B"]
    assert [i["hechos"] for i in mapt["investigaciones"]] == [2, 1]
    # Y el identificador se recoge del hecho que lo trae, aunque otro no lo lleve.
    assert mapt["uniprot"] == "P10636"


def test_el_orden_lo_pone_el_peso_de_la_evidencia():
    d = LAB.laboratorio(_mundo())
    assert [x["simbolo"] for x in d["dianas"]] == ["MAPT", "GFAP"]


def test_los_genes_resueltos_por_alias_o_simbolo_antiguo_no_entran():
    # Este es el fallo que haría el daño: la escala ADAS-Cog y la enfermedad de
    # Huntington acabarían pedidas al laboratorio como proteínas.
    d = LAB.laboratorio(_mundo())
    assert "AGPS" not in [x["simbolo"] for x in d["dianas"]]
    assert "HTT" not in [x["simbolo"] for x in d["dianas"]]
    # Pero no se callan: se dicen, con el motivo.
    fuera = {x["simbolo"]: x for x in d["descartadasPorAlias"]}
    assert set(fuera) == {"AGPS", "HTT"}
    assert "alias" in fuera["AGPS"]["motivo"]
    # Y el motivo es el de verdad: un símbolo antiguo no es un alias.
    assert "antiguo" in fuera["HTT"]["motivo"]


def test_una_mencion_de_paso_no_es_una_diana():
    d = LAB.laboratorio(_mundo())
    assert "CA2" not in [x["simbolo"] for x in d["dianas"]]


def test_lo_nombrado_sin_uniprot_se_dice_en_vez_de_callarse():
    d = LAB.laboratorio(_mundo())
    sin = {x["simbolo"]: x for x in d["nombradasSinEstructura"]}
    assert "TREM2" in sin and sin["TREM2"]["hechos"] == 3
    assert "UniProt" in sin["TREM2"]["motivo"]


def test_el_grafo_causal_cruza_por_el_nombre_clinico_y_no_por_el_simbolo():
    # El grafo habla de «tau», no de «MAPT»; sin cruzar por el nombre clínico
    # la lámina de la proteína más nombrada saldría sin una sola flecha.
    d = LAB.laboratorio(_mundo())
    mapt = next(x for x in d["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["tambienLlamada"] == "tau"
    assert [r["otro"] for r in mapt["causal"]["aguasArriba"]] == ["amiloide"]
    assert [r["otro"] for r in mapt["causal"]["aguasAbajo"]] == ["neurodegeneracion"]


def test_una_diana_que_nadie_propone_lleva_la_hoja_vacia_y_lo_dice():
    d = LAB.laboratorio(_mundo())
    gfap = next(x for x in d["dianas"] if x["simbolo"] == "GFAP")
    assert gfap["enHipotesis"] == 0
    assert gfap["hojaDePedido"]["sinExperimento"] is True
    assert gfap["deDonde"] == "evidencia"
    # Y se cuenta: es un hueco del programa.
    assert d["resumen"]["sinExperimento"] == 2


def test_filtrar_por_investigacion_sigue_siendo_posible_pero_no_es_lo_normal():
    solo_a = LAB.laboratorio(_mundo(), "inv-a")
    mapt = next(x for x in solo_a["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["hechos"] == 2
    assert LAB.laboratorio(_mundo())["dianas"][0]["hechos"] == 3


def test_los_compuestos_salen_de_la_evidencia_y_el_que_pubchem_no_tiene_entra_igual():
    e = _mundo()
    e["hechos"].append({
        "id": "he-c1", "investigacionId": "inv-a", "tipo": "hecho", "estado": "sabido", "tema": "t", "enunciado": "x",
        "entidades": [{"id": "CHEBI:229272", "etiqueta": "lecanemab", "ontologia": "CHEBI", "tipo": "compuesto", "alias": []}],
    })
    cs = {c["nombre"]: c for c in LAB.laboratorio(e)["compuestos"]}
    assert "lecanemab" in cs
    assert cs["lecanemab"]["enPubchem"] is False
    assert cs["lecanemab"]["ontologiaId"] == "CHEBI:229272"
    assert cs["lecanemab"]["menciones"] == 1
    # Sin ficha no se inventa química.
    assert cs["lecanemab"]["smiles"] is None and cs["lecanemab"]["formula"] is None


def test_una_proteina_que_no_consta_en_el_cache_no_entra_pero_el_motivo_es_otro():
    # No es lo mismo saber que la trajo un alias que no poder comprobarlo. Si
    # el motivo mintiera, quien lea la sección creería que hay un fallo de
    # normalización donde solo hay un caché incompleto.
    e = _mundo()
    del e["entidadesCache"]["gen:CA2"]
    e["hechos"].append({
        "id": "he-ca2b", "investigacionId": "inv-a", "tipo": "hecho", "estado": "sabido", "tema": "t", "enunciado": "x",
        "entidades": [{"id": "HGNC:1373", "etiqueta": "CA2", "ontologia": "HGNC", "tipo": "gen", "uniprot": "P00918"}],
    })
    fuera = {x["simbolo"]: x for x in LAB.laboratorio(e)["descartadasPorAlias"]}
    assert "CA2" in fuera
    assert "no consta" in fuera["CA2"]["motivo"]
    assert "alias" not in fuera["CA2"]["motivo"]


# ---------------------------------------------------------------------------
# Lo que la sección decía y no era verdad (29 de septiembre de 2026)
# ---------------------------------------------------------------------------


def _con_experimentos():
    """Una diana con experimento de banco, otra con uno de escritorio cuya
    tarjeta habla como si fuera de banco, y una que solo nombra la evidencia."""
    e = _mundo()
    e["hipotesis"] = [
        {
            "id": "hb", "investigacionId": "inv-a", "estado": "propuesta", "decisionKiller": "avanzar",
            "titulo": "TFEB en neuronas", "conclusion": {"certeza": "baja"},
            "perfilDiana": {"identificadores": {"uniprot": "P19484", "simbolo": "TFEB", "nombre": "transcription factor EB"}},
            "tarjeta": {"intervencion": "Activación de TFEB en neuronas de iPSC"},
            "experimento": {"sistema": {"tipo": "ipsc"}, "controles": "vehículo", "refuta": "que no cambie", "protocolo": "1. Diferenciar.\n2. Activar."},
        },
        {
            "id": "he", "investigacionId": "inv-a", "estado": "propuesta", "decisionKiller": "suspender",
            "titulo": "SULF2 como barrera", "conclusion": {"certeza": "muy_baja"},
            "perfilDiana": {"identificadores": {"uniprot": "Q8IWU5", "simbolo": "SULF2", "nombre": "sulfatase 2"}},
            # La tarjeta habla de banco y el contrato dice que es revisión.
            "tarjeta": {"intervencion": "Expresión inducible de SULF2 en neuronas"},
            "experimento": {"sistema": {"tipo": "datos_publicos_existentes"}, "controles": "", "refuta": "x"},
        },
    ]
    return e


def test_arriba_va_lo_que_se_puede_mandar_no_lo_mas_nombrado():
    # MAPT tiene 3 hechos y ninguna hipótesis; TFEB tiene 0 hechos y un
    # experimento de banco. La sección se llama «lo que mandaría al
    # laboratorio», así que manda TFEB.
    d = LAB.laboratorio(_con_experimentos())
    assert d["dianas"][0]["simbolo"] == "TFEB"
    assert d["dianas"][0]["hechos"] == 0
    assert d["resumen"]["deBanco"] == 1
    # Y la de escritorio va por delante de las que no tienen experimento.
    simbolos = [x["simbolo"] for x in d["dianas"]]
    assert simbolos.index("SULF2") < simbolos.index("MAPT")


def test_una_revision_de_literatura_no_se_presenta_como_pedido_de_banco():
    d = LAB.laboratorio(_con_experimentos())
    sulf2 = next(x for x in d["dianas"] if x["simbolo"] == "SULF2")
    hoja = sulf2["hojaDePedido"]
    assert hoja["deBanco"] is False
    # La tarjeta dice «expresión inducible» y el contrato dice revisión: se avisa.
    assert hoja["contradiceLaIntervencion"] is True
    tfeb = next(x for x in d["dianas"] if x["simbolo"] == "TFEB")
    assert tfeb["hojaDePedido"]["deBanco"] is True
    assert tfeb["hojaDePedido"]["contradiceLaIntervencion"] is False


def test_lo_que_no_se_pudo_resolver_no_se_presenta_como_que_no_existe():
    # Decía «sin acceso de UniProt»: TREM2 es Q9NZC2 y sí lo tiene. Quien no lo
    # resolvió fue ROSA2018, y eso es lo que hay que decir.
    d = LAB.laboratorio(_mundo())
    trem2 = next(x for x in d["nombradasSinEstructura"] if x["simbolo"] == "TREM2")
    assert "no consiguió resolver" in trem2["motivo"]
    assert "No quiere decir que no la tenga" in trem2["motivo"]


def test_el_muro_no_carga_con_los_protocolos_enteros():
    # Eran 100 KB de los 400 que pesaba la respuesta, y el muro no enseña ni
    # uno: el contrato se pide aparte al abrir el experimento.
    e = _con_experimentos()
    ligero = LAB.laboratorio(e)
    tfeb = next(x for x in ligero["dianas"] if x["simbolo"] == "TFEB")
    assert "protocolo" not in tfeb["hipotesis"][0]
    assert tfeb["hipotesis"][0]["intervencion"]  # lo que la hoja sí necesita
    # Y sigue estando entero donde toca.
    completo = LAB.experimentos_de(e, "P19484")
    assert completo[0]["protocolo"].startswith("1. Diferenciar")


def test_se_dice_cuantas_estructuras_medidas_hay_y_cuando_no_se_sabe():
    e = _mundo()
    e["estructurasMedidas"] = {"P10636": {"total": 308, "entradas": ["5O3L"], "comprobado": True}}
    d = LAB.laboratorio(e)
    mapt = next(x for x in d["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["estructura"]["medidas"] == 308
    assert mapt["estructura"]["clase"] == "predicha"  # la que se dibuja sigue siendo la predicha
    # Sin comprobar no se dice «cero»: se dice que no se sabe.
    e["estructurasMedidas"] = {"P10636": {"total": 0, "entradas": [], "comprobado": False}}
    mapt = next(x for x in LAB.laboratorio(e)["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["estructura"]["medidas"] is None


# ---------------------------------------------------------------------------
# La dirección y la decisión (30 de septiembre de 2026)
# ---------------------------------------------------------------------------


def _con_direcciones():
    """Tres dianas: una que hay que bajar, una que hay que subir y una que
    nadie propone tocar."""
    e = _mundo()
    e["secuencias"] = {
        # `diseño` es lo que el bucle guarda ya calculado, y es lo que la
        # pantalla lee: el MANE viaja dentro de él, como en el código real.
        u: {"comprobado": True, "transcrito": f"ENST{u}", "maneSelect": f"ENST{u}.1",
            "diseño": {"transcrito": f"ENST{u}", "maneSelect": f"ENST{u}.1", "mismaIsoformaQueLaProteina": True,
                       "candidatos": [{"secuencia": "CTCTCCCACTCCCACTTCTT", "posicion": 100}], "largo": 2000}}
        for u in ("P10636", "P14136", "P05067")
    }
    e["hipotesis"] = [
        {"id": "hb", "investigacionId": "inv-a", "estado": "propuesta", "decisionKiller": "avanzar", "titulo": "bajar tau",
         "conclusion": {"certeza": "baja"},
         "perfilDiana": {"identificadores": {"uniprot": "P10636", "simbolo": "MAPT"}},
         "tarjeta": {"direccion": "disminuye", "intervencion": "supresión de MAPT"},
         "experimento": {"sistema": {"tipo": "ipsc"}}},
        {"id": "hs", "investigacionId": "inv-a", "estado": "propuesta", "decisionKiller": "suspender", "titulo": "subir APP",
         "conclusion": {"certeza": "muy_baja"},
         "perfilDiana": {"identificadores": {"uniprot": "P05067", "simbolo": "APP"}},
         "tarjeta": {"direccion": "aumenta", "intervencion": "expresión de APP"},
         "experimento": {"sistema": {"tipo": "ipsc"}}},
    ]
    return e


def test_un_oligo_no_se_ofrece_donde_la_evidencia_pide_subir_la_proteina():
    # Este era el fallo: se enseñaban ocho oligos para apagar APP y SULF2
    # cuando sus hipótesis piden aumentarlas. La secuencia estaba bien y la
    # propuesta estaba al revés.
    d = LAB.laboratorio(_con_direcciones())
    por = {x["simbolo"]: x for x in d["dianas"]}
    assert por["MAPT"]["direccion"]["pide"] == "bajar"
    assert por["MAPT"]["aso"] is not None
    assert por["APP"]["direccion"]["pide"] == "subir"
    assert por["APP"]["aso"] is None
    assert "SUBIRLA" in por["APP"]["direccion"]["motivo"]
    assert d["resumen"]["asoAlReves"] == 1


def test_una_diana_sin_hipotesis_que_intervengan_es_biomarcador_no_diana():
    d = LAB.laboratorio(_con_direcciones())
    gfap = next(x for x in d["dianas"] if x["simbolo"] == "GFAP")
    assert gfap["direccion"]["pide"] == "ninguna"
    assert gfap["aso"] is None
    assert "biomarcador" in gfap["direccion"]["motivo"]


def test_la_decision_elige_una_y_dice_cada_termino():
    d = LAB.laboratorio(_con_direcciones())
    o = d["oligoQueMandaria"]
    assert o is not None
    assert o["simbolo"] == "MAPT"  # la única cuya dirección encaja
    # Cada término se ve: una decisión que no se puede discutir no sirve.
    criterios = {t["criterio"] for t in o["porQue"]}
    assert "afirmaciones que la sostienen" in criterios
    # El Killer y la certeza salen de la hipótesis que pide BAJAR la proteína,
    # no de la que más lejos llegó: mezclarlas dibujaba una diana más sólida
    # de lo que ninguna hipótesis sostiene.
    assert "el Killer, en la hipótesis que pide bajarla" in criterios
    assert "certeza GRADE de esa misma hipótesis" in criterios
    assert abs(o["puntos"] - sum(t["puntos"] for t in o["porQue"])) < 0.01
    # Y dice qué la cambiaría, como el Killer dice qué refutaría una hipótesis.
    assert "dirección es una puerta" in o["queLaCambiaria"]
    # Las descartadas, agrupadas por motivo.
    assert "subir" in o["fueraDeConcurso"]
    assert "APP" in o["fueraDeConcurso"]["subir"]


def test_la_direccion_es_una_puerta_y_no_un_termino():
    # Una proteína con montañas de evidencia pero dirección equivocada NO
    # compite, por mucho que sume en todo lo demás.
    e = _con_direcciones()
    for h in e["hechos"]:
        if any(x.get("id") == "HGNC:6893" for x in (h.get("entidades") or [])):
            continue
    # APP con dirección «aumenta» no puede salir elegida ni segunda.
    o = LAB.laboratorio(e)["oligoQueMandaria"]
    assert o is not None
    assert "APP" not in [x["simbolo"] for x in o["frenteA"]]
    assert o["simbolo"] != "APP"


def test_se_dice_si_la_proteina_y_el_arn_son_la_misma_version_del_gen():
    # MANE Select es el acuerdo entre NCBI y EMBL-EBI sobre cuál es el
    # transcrito representativo, emparejado con la proteína canónica. Sin él
    # no se puede confirmar, y eso pasa justo en MAPT.
    e = _con_direcciones()
    d = LAB.laboratorio(e)
    mapt = next(x for x in d["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["aso"]["mismaIsoformaQueLaProteina"] is True
    # Sin MANE: None es «no se pudo confirmar», no «no lo son».
    e["secuencias"]["P10636"]["diseño"]["mismaIsoformaQueLaProteina"] = None
    d2 = LAB.laboratorio(e)
    mapt2 = next(x for x in d2["dianas"] if x["simbolo"] == "MAPT")
    assert mapt2["aso"]["mismaIsoformaQueLaProteina"] is None


def test_servir_la_pantalla_no_puede_destruir_el_diseño_guardado():
    # Pasó de verdad el 30 de septiembre de 2026: `aligerar` recortaba la lista
    # de candidatos para el muro, pero recibía la referencia viva del estado,
    # así que una visita dejaba en ocho los sesenta candidatos guardados. Y se
    # persistía. Una lectura no puede destruir datos.
    e = _con_direcciones()
    e["secuencias"]["P10636"]["diseño"]["candidatos"] = [{"secuencia": "A" * 20, "posicion": i} for i in range(60)]
    antes = len(e["secuencias"]["P10636"]["diseño"]["candidatos"])
    d1 = LAB.laboratorio(e)
    mapt = next(x for x in d1["dianas"] if x["simbolo"] == "MAPT")
    # El muro trae ocho y dice cuántos hay.
    assert len(mapt["aso"]["candidatos"]) == LAB.ASO.EN_EL_MURO
    assert mapt["aso"]["candidatosEnTotal"] == 60
    # Y el estado sigue con los sesenta, tras una y tras dos lecturas.
    assert len(e["secuencias"]["P10636"]["diseño"]["candidatos"]) == antes == 60
    LAB.laboratorio(e)
    assert len(e["secuencias"]["P10636"]["diseño"]["candidatos"]) == 60
    # Y la ruta del cribado completo los sigue dando todos.
    assert len(LAB.oligos_de(e, "P10636")["candidatos"]) == 60


def _con_dos_candidatos() -> dict:
    """El fixture con DOS candidatos en MAPT, que es lo que hace falta para
    probar el reordenado: con uno solo el descartado no puede irse al final."""
    e = _con_direcciones()
    dis = e["secuencias"]["P10636"]["diseño"]
    primero = dis["candidatos"][0]
    segundo = {**primero, "secuencia": "TTTTTGGGGGCCCCCAAAAA", "posicion": primero["posicion"] + 400}
    dis["candidatos"] = [primero, segundo]
    return e


def _descartado(gen: str = "OTRO") -> dict:
    return {
        "cribado": True, "veredicto": "descartado", "propios": 3, "fuera": [gen],
        "genesFuera": 1, "transcritosFuera": 9, "mismoSitioOtroNombre": [],
        "genesMismoSitio": 0, "transcritosMismoSitio": 0, "porQue": f"encaja en {gen}",
    }


def test_el_cribado_es_otra_puerta_de_la_decision():
    """Una diana cuyo mejor candidato encaja idéntico en otro gen no compite
    con ese candidato.

    Sin esta puerta ROSA2018 podría mandar un oligo que baja de paso otros mil
    doscientos ARN, que es lo que le pasa al candidato de ATM que cae en una
    secuencia Alu. La dirección ya era una puerta; el cribado es la segunda."""
    e = _con_dos_candidatos()
    antes = LAB.laboratorio(e)["oligoQueMandaria"]
    assert antes is not None and antes["simbolo"] == "MAPT"
    primero = antes["candidato"]["secuencia"]
    e["criba"] = {"porSecuencia": {primero: _descartado()}}
    o = LAB.laboratorio(e)["oligoQueMandaria"]
    assert o is not None
    # Sigue ganando MAPT, pero con el OTRO candidato: el descartado no se manda.
    assert o["simbolo"] == "MAPT"
    assert o["candidato"]["secuencia"] != primero
    assert o["criba"]["veredicto"] != "descartado"


def test_si_TODOS_los_candidatos_chocan_la_diana_sale_del_concurso():
    e = _con_dos_candidatos()
    secs = [c["secuencia"] for c in e["secuencias"]["P10636"]["diseño"]["candidatos"]]
    e["criba"] = {"porSecuencia": {x: _descartado() for x in secs}}
    d = LAB.laboratorio(e)
    assert d["oligoQueMandaria"] is None
    # Y el motivo se dice por su nombre, no se calla.
    mapt = next(x for x in d["dianas"] if x["simbolo"] == "MAPT")
    assert mapt["aso"]["candidatos"][0]["criba"]["veredicto"] == "descartado"


def test_el_cribado_reordena_pero_no_esconde():
    """Los descartados van al final, no desaparecen: Emir pidió enseñarlos
    marcados, y una lista que oculta lo que falló no deja comprobar nada."""
    e = _con_dos_candidatos()
    cands = [c["secuencia"] for c in e["secuencias"]["P10636"]["diseño"]["candidatos"]]
    e["criba"] = {"porSecuencia": {cands[0]: _descartado("Z")}}
    d1 = LAB.laboratorio(e, completo=True)
    m1 = next(x for x in d1["dianas"] if x["simbolo"] == "MAPT")
    secs = [c["secuencia"] for c in m1["aso"]["candidatos"]]
    assert sorted(secs) == sorted(cands)  # ninguno desaparece
    assert secs[-1] == cands[0]  # el descartado, al final
    assert m1["aso"]["descartadosPorCriba"] == 1 and m1["aso"]["limpios"] == 0


def test_sin_cribar_compite_pero_marcado():
    """«Sin cribar» no es «descartado»: se enseña lo que hay, no lo que
    gustaría. La regla de ROSA2018 es que no poder comprobar no es un no."""
    e = _con_dos_candidatos()
    d = LAB.laboratorio(e)
    o = d["oligoQueMandaria"]
    assert o is not None
    assert o["criba"]["veredicto"] == "sin cribar"
    assert o["criba"]["cribado"] is False


def test_una_lectura_del_laboratorio_no_toca_el_diseño_guardado():
    """Ya pasó una vez con `aligerar`. Ahora `pegar` copia también, y esto lo
    defiende: dos lecturas seguidas tienen que dar lo mismo."""
    e = _con_dos_candidatos()
    dis = e["secuencias"]["P10636"]["diseño"]
    antes = len(dis["candidatos"])
    LAB.laboratorio(e)
    LAB.laboratorio(e)
    LAB.oligos_de(e, "P10636")
    assert len(dis["candidatos"]) == antes
    assert "criba" not in dis["candidatos"][0]
