"""Ensayo de las conversaciones del laboratorio con los modelos de verdad.

Monta las escenas desde el estado real (solo lectura: no escribe nada en
rosa.db ni cuenta contra el presupuesto de la corrida), genera conversaciones
completas con el mismo autor, las mismas validaciones y el mismo juez que el
servidor, y las imprime con las cifras que importan: cuántas saludan, cuántas
llaman a alguien por su nombre, cuántas suenan a plantilla, cuántas rechazó el
juez. Sirve para ajustar las instrucciones antes de publicar.

    ./.venv/bin/python scripts/ensayar_charlas.py [--corrida ID] [--charlas 8]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rosa import gateway  # noqa: E402
from rosa import laboratorio_conversaciones as L  # noqa: E402
from rosa.estado.almacen import Almacen  # noqa: E402


class Lectura:
    """Un almacén que se puede leer pero no escribir: el ensayo no guarda nada."""

    def __init__(self, estado):
        self.estado = estado
        self.obsoleto = False
        self.cerrado = False

    def mutar(self, *_a, **_k):  # pragma: no cover - el ensayo no publica
        return False


async def llamar(modelo, reglas, contenido, tema):
    propiedades = {"admisible": {"type": "boolean"}, "motivo": {"type": "string"}} if reglas == L.REGLAS_JUEZ else {
        "texto": {"type": "string"}, "referencias": {"type": "array", "items": {"type": "string", "enum": [m["id"] for m in tema["materiales"]]}},
        "emocion": {"type": "string", "enum": list(L.EMOCIONES)}, "gesto": {"type": "string", "enum": list(L.GESTOS)},
    }
    formato = {"type": "json_schema", "json_schema": {"name": "revision" if reglas == L.REGLAS_JUEZ else "intervencion", "strict": True,
               "schema": {"type": "object", "properties": propiedades, "required": list(propiedades), "additionalProperties": False}}}
    cliente = gateway.lm(modelo, max_tokens=16000, timeout=90, cache=False, response_format=formato)
    return L._objeto(await cliente.acall(messages=[{"role": "system", "content": reglas}, {"role": "user", "content": json.dumps(contenido, ensure_ascii=False)}]))


async def ensayar(estado, corrida_id: str, idioma: str, maximo: int):
    c = next(x for x in estado["corridas"] if x["id"] == corrida_id)
    it = next(x for x in estado["iteraciones"] if x["corridaId"] == corrida_id and x["numero"] == c["iteracionActual"])
    clave = (corrida_id, it["id"], idioma)
    # Sin historial v4 todavía: es como el primer rato de la mañana.
    s = L.Conversaciones(Lectura(estado), llamar)
    s.visitas[clave] = {"ensayo": time.monotonic() + 600}
    s._presupuesto = lambda tema, llamadas=2: True  # El ensayo no gasta de la corrida.
    tema = L.tema_de(estado, corrida_id, it["id"])
    temas = []
    for _ in range(6):
        nuevos = [t for t in s._temas(clave, tema) if t["huella"] not in {x["huella"] for x in temas}]
        if not nuevos:
            break
        for t in nuevos:
            s.intentos.setdefault(clave, {})[t["huella"]] = 9  # que no vuelva a salir
        temas.extend(nuevos)
    temas = temas[:maximo]
    publicados, rechazos = [], []
    vistos = set()
    for t in temas:
        a, b = t["participantes"]
        historial = []
        escena = t.get("escena") or {"tipo": "plan" if t.get("momento") == "plan_propuesto" else "arranque" if t.get("momento") == "inicio_tarea" else "trabajo"}
        escena = {**escena, "arco": escena.get("arco") or L.ARCOS[escena["tipo"]]}
        print(f"\n=== {escena['tipo']} · {L.SALA_LLANO.get(t.get('salaConversacion') or '', 'sala activa')} · {L.nombre_de(a)} y {L.nombre_de(b)}")
        parejas = ((a, b), (b, a)) if t.get("continuacion") else ((a, b), (b, a), (a, b))
        for n, (ag, de) in enumerate(parejas):
            papel = "abres" if n == 0 else "cierras" if n == len(parejas) - 1 and n > 1 else "respondes"
            abrio = n == 1 and historial and L._SALUDO.match(historial[-1]["texto"])
            puede = ag not in vistos and ((n == 0) or bool(abrio))
            contenido = {**t, "idioma": "English" if idioma == "en" else "español", "agente": ag, "destinatario": de,
                         "yo": L.ficha_de(ag), "companero": L.ficha_de(de), "personalidad": L.personalidad_de(ag),
                         "personalidadCompanero": L.personalidad_de(de), "quienEsQuien": L.quien_es_quien(ag, de, t),
                         "escena": escena, "papel": papel, "puedesSaludar": puede, "encuentroInicial": n == 0,
                         "historial": list(historial), "turno": n + 1, "memoriaDeVoz": [], "aperturasRecientes": [], "tendenciasDeApertura": []}
            final = None
            for intento in range(2):
                borrador = await llamar(L.modelo_de(ag), L.REGLAS, contenido, t)
                try:
                    v = L.validar_turno(borrador, t)
                    L.validar_variedad(v, contenido)
                    L.validar_humanidad(v, contenido)
                except ValueError as exc:
                    rechazos.append(("regla", L.nombre_de(ag), str(borrador.get("texto"))[:160], str(exc)))
                    contenido = {**contenido, "borrador": borrador, "revisionEstilo": str(exc), "correccion": "Reescribe atendiendo el problema señalado, conservando los hechos y las referencias."}
                    continue
                juez = await llamar(gateway.JUEZ, L.REGLAS_JUEZ, {**contenido, "intervencion": v}, t)
                if juez.get("admisible") is True:
                    final = v
                    break
                rechazos.append(("juez", L.nombre_de(ag), v["texto"][:160], str(juez.get("motivo"))[:200]))
                contenido = {**contenido, "borrador": borrador, "revisionAnterior": str(juez.get("motivo"))[:400], "correccion": "Reescribe corrigiendo el problema de fidelidad, con tu propia voz."}
            if not final:
                print(f"   ({L.nombre_de(ag)}: no pasó la revisión)")
                break
            vistos.add(ag)
            historial.append({"agente": ag, "destinatario": de, "texto": final["texto"]})
            publicados.append({"agente": ag, "texto": final["texto"], "turno": n + 1, "escena": escena["tipo"]})
            print(f"   {L.nombre_de(ag)} [{final.get('emocion')}]: {final['texto']}")
    return publicados, rechazos


def cifras(publicados, rechazos):
    nombres = set(L.NOMBRES.values()) if hasattr(L, "NOMBRES") else set()
    from rosa.laboratorio_personalidades import NOMBRES
    nombres = set(NOMBRES.values())
    n = len(publicados) or 1
    saludan = sum(bool(L._SALUDO.match(p["texto"])) for p in publicados)
    nombran = sum(any(re.search(rf"\b{re.escape(x)}\b", p["texto"]) for x in nombres) for p in publicados)
    plantilla = sum(bool(L._APERTURA_PLANTILLA.match(p["texto"])) for p in publicados)
    cautela = sum(bool(re.search(r"no (?:lo |la )?(?:tomar[ií]a|dar[ií]a|confundir[ií]a)|no daría ese salto|no me basta", p["texto"], re.I)) for p in publicados)
    print(f"\n--- {len(publicados)} líneas publicadas · saludan {saludan} · nombran a alguien {nombran} ({100 * nombran // n} %) · "
          f"abren con plantilla {plantilla} · cautela de muletilla {cautela} · rechazos {len(rechazos)} "
          f"(regla {sum(r[0] == 'regla' for r in rechazos)}, juez {sum(r[0] == 'juez' for r in rechazos)})")
    for r in rechazos:
        print(f"   rechazo {r[0]} · {r[1]}: «{r[2]}» → {r[3]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corrida")
    ap.add_argument("--idioma", default="es")
    ap.add_argument("--charlas", type=int, default=8)
    ap.add_argument("--atasco", action="store_true", help="simula en la copia una base que no respondió")
    a = ap.parse_args()
    estado = Almacen(Path(__file__).resolve().parents[1] / "rosa.db", solo_lectura=True).estado
    corrida = a.corrida or sorted(estado["corridas"], key=lambda c: c.get("numero", 0))[-1]["id"]
    # Sin las charlas v4 previas: el ensayo empieza en limpio.
    for c in estado["corridas"]:
        if c["id"] == corrida:
            c["_conversacionesLaboratorio"] = [x for x in c.get("_conversacionesLaboratorio", []) if x.get("estilo") != L.ESTILO]
            c["_memoriaConversacionesLaboratorio"] = {}
            c["_encuentrosLaboratorio"] = {}
    if a.atasco:
        c = next(x for x in estado["corridas"] if x["id"] == corrida)
        it = next(x for x in estado["iteraciones"] if x["corridaId"] == corrida and x["numero"] == c["iteracionActual"])
        p = next(p for p in it["pistas"] if p.get("tipo") == "literatura")
        p.setdefault("transcripcion", []).append({"t": 10**9, "tipo": "error", "texto": "Error: Europe PMC no respondió a tiempo tras tres intentos; la consulta sobre p-tau217 queda sin comprobar."})
    publicados, rechazos = asyncio.run(ensayar(estado, corrida, a.idioma, a.charlas))
    cifras(publicados, rechazos)


if __name__ == "__main__":
    main()
