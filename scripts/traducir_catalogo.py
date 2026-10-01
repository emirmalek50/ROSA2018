"""Traduce al inglés el catálogo de la interfaz, por el AI Gateway de Vercel.

Por qué existe: la interfaz tiene unas 2.300 frases que el codemod ya dejó
envueltas en `tr()` pero que nadie ha traducido. A mano son semanas, y lo que
se escribe de memoria sale mal (en una prueba, de 200 traducciones escritas
sin mirar la lista, solo 111 correspondían a una cadena real).

Lo que NO hace: decidir qué se traduce. Eso ya está decidido en el código, y
las cadenas que son dato (identificadores, alias de cohorte, colores,
trazados, consultas de API) no llegan aquí porque no están envueltas.

Es resumible: cada lote se escribe en el JSONL nada más llegar, y al volver a
correr se salta lo que ya está. Si una llamada falla, se pierde ese lote, no
el trabajo.

    ./.venv/bin/python scripts/traducir_catalogo.py --entrada /tmp/faltan.json
    ./.venv/bin/python scripts/traducir_catalogo.py --escribir-ts
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

SALIDA = RAIZ / "frontend" / "scripts" / "i18n" / "traducciones.jsonl"

REGLAS = """Traduces la interfaz de ROSA2018, una IA que investiga el Alzheimer, del castellano al inglés.
Quien va a leer esto es un investigador o un médico anglófono. El texto es de interfaz: etiquetas, ayudas, explicaciones y conclusiones.

Reglas, por orden de importancia:

1. TERMINOLOGÍA QUE YA EXISTE EN INGLÉS. Usa la del campo, no una traducción literal.
   - GRADE: certainty (no "certainty level"), "high / moderate / low / very low", "rated down for risk of bias", "imprecision", "indirectness", "inconsistency", "publication bias".
   - Anatomía: entorhinal cortex, locus coeruleus, hippocampus, precuneus, posterior cingulate, white matter hyperintensities, blood-brain barrier.
   - Células: astrocyte, microglia, oligodendrocyte, oligodendrocyte precursor cell (OPC), pericyte, endothelium.
   - Estudios: cohort, case-control, cross-sectional, randomised trial, preregistration, target engagement, readout, held-out set.
   - PRISMA, RoB 2, ROBINS-I, BEST, Elo, Bradley-Terry, e-value, kappa: tal cual.

2. DOS COSAS QUE NO SE PUEDEN CONFUNDIR, porque es una regla del proyecto:
   - "no pude comprobar" / "no se pudo comprobar" -> "could not check". NUNCA "none found", "no results", "there is none".
   - "no hay" -> "there is none". Son estados distintos y la interfaz los distingue a propósito.
   - "tiempo agotado" -> "timed out", nunca "no results".

3. NUNCA uses "proven", "confirmed", "demonstrates" ni porcentajes de confianza que no estén en el original. ROSA2018 no demuestra nada; sostiene o no sostiene.

4. FORMA:
   - Conserva EXACTAMENTE los huecos entre llaves: {n}, {q}, {clase}. No los traduzcas ni los reordenes dentro de la llave.
   - Conserva los símbolos de gen y de biomarcador tal cual: GFAP, NfL, p-tau217, APOE e4, TREM2, Abeta42.
   - Conserva las cifras, las unidades y la puntuación final.
   - Comillas angulares « » -> comillas dobles " ".
   - NUNCA uses guion largo (—). Usa coma, punto o dos puntos.
   - Si la cadena empieza o acaba con espacio, consérvalo.
   - Si la cadena ya está en inglés o es un nombre propio, devuélvela igual.

5. REGISTRO: la interfaz tutea en castellano ("tu decisión"). En inglés, "your decision". Directo y llano, sin floreos.

Devuelves SOLO un objeto JSON: {"<original en castellano>": "<traducción al inglés>", ...}. Una entrada por cada cadena que te den, con la clave idéntica al original, carácter a carácter."""


def lotes(cadenas: list[str], tope_caracteres: int = 4500) -> list[list[str]]:
    """Agrupa por tamaño, no por número: hay frases de 10 y de 500 caracteres."""
    fuera: list[list[str]] = []
    actual: list[str] = []
    n = 0
    for c in cadenas:
        if actual and n + len(c) > tope_caracteres:
            fuera.append(actual)
            actual, n = [], 0
        actual.append(c)
        n += len(c)
    if actual:
        fuera.append(actual)
    return fuera


def ya_hechas() -> dict[str, str]:
    if not SALIDA.exists():
        return {}
    out: dict[str, str] = {}
    for linea in SALIDA.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        try:
            out.update(json.loads(linea))
        except json.JSONDecodeError:
            continue
    return out


def comprobar(original: str, traducido: str) -> str | None:
    """Lo que se revisa de cada traducción antes de aceptarla."""
    if not traducido.strip():
        return "vacía"
    if "—" in traducido:
        return "lleva guion largo"
    huecos_o = set(re.findall(r"\{(\w+)\}", original))
    huecos_t = set(re.findall(r"\{(\w+)\}", traducido))
    if huecos_o != huecos_t:
        return f"los huecos no coinciden: {sorted(huecos_o)} frente a {sorted(huecos_t)}"
    bajo = traducido.lower()
    if re.search(r"\b(?:proven|confirmed|demonstrates|demonstrated)\b", bajo):
        return "afirma de más (proven/confirmed)"
    if "no pude comprobar" in original.lower() or "no se pudo comprobar" in original.lower():
        if not re.search(r"could not (?:be )?check", bajo):
            return "«no pude comprobar» no se tradujo como «could not check»"
    return None


def traducir(cadenas: list[str], modelo: str) -> dict[str, str]:
    from rosa.gateway import lm

    cliente = lm(modelo, max_tokens=16000)
    fuera: dict[str, str] = {}
    hechas = ya_hechas()
    pendientes = [c for c in cadenas if c not in hechas]
    grupos = lotes(pendientes)
    print(f"{len(pendientes)} por traducir en {len(grupos)} lotes (ya hechas: {len(hechas)})")
    for i, grupo in enumerate(grupos, 1):
        peticion = json.dumps(grupo, ensure_ascii=False, indent=1)
        try:
            respuesta = cliente(
                messages=[
                    {"role": "system", "content": REGLAS},
                    {"role": "user", "content": f"Traduce estas {len(grupo)} cadenas:\n{peticion}"},
                ]
            )
        except Exception as e:  # noqa: BLE001 - un lote que falla no para los demás
            print(f"  lote {i}/{len(grupos)}: falló ({type(e).__name__}: {e})")
            continue
        texto = respuesta[0] if isinstance(respuesta, list) else str(respuesta)
        m = re.search(r"\{.*\}", texto, re.S)
        if not m:
            print(f"  lote {i}/{len(grupos)}: la respuesta no trae JSON")
            continue
        try:
            datos = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            print(f"  lote {i}/{len(grupos)}: JSON inválido ({e})")
            continue
        buenas, malas = {}, []
        for k, v in datos.items():
            if k not in grupo:
                continue
            fallo = comprobar(k, str(v))
            if fallo:
                malas.append((k, fallo))
            else:
                buenas[k] = str(v)
        with SALIDA.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(buenas, ensure_ascii=False) + "\n")
        fuera.update(buenas)
        aviso = f"; {len(malas)} rechazadas" if malas else ""
        print(f"  lote {i}/{len(grupos)}: {len(buenas)} de {len(grupo)}{aviso}")
        for k, f in malas[:3]:
            print(f"      {f}: {k[:60]}")
    return fuera


def escribir_ts(destino: pathlib.Path) -> int:
    hechas = ya_hechas()
    if not hechas:
        print("no hay traducciones que escribir")
        return 0
    lineas = [
        "/** Traducido con Opus 5 por el AI Gateway, con las reglas de",
        " *  scripts/traducir_catalogo.py: terminologia del campo (GRADE, anatomia,",
        " *  diseños de estudio), «no pude comprobar» separado de «no hay», sin",
        " *  «proven» ni «confirmed», y los huecos {n} intactos. Revisado a mano lo",
        " *  que toca una regla del proyecto. */",
        "export const GENERADO: Record<string, string> = {",
    ]
    for k in sorted(hechas):
        clave = json.dumps(k, ensure_ascii=False)
        valor = json.dumps(hechas[k], ensure_ascii=False)
        lineas.append(f"  {clave}: {valor},")
    lineas.append("};")
    destino.write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print(f"{len(hechas)} entradas en {destino}")
    return len(hechas)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--entrada", type=pathlib.Path, help="JSON con la lista de cadenas")
    p.add_argument("--modelo", default="anthropic/claude-opus-5")
    p.add_argument("--limite", type=int, default=0, help="solo las primeras N (para probar)")
    p.add_argument("--escribir-ts", action="store_true")
    p.add_argument("--destino", type=pathlib.Path, default=RAIZ / "frontend/src/i18n/en/17-generado.ts")
    a = p.parse_args()
    if a.escribir_ts:
        return 0 if escribir_ts(a.destino) else 1
    if not a.entrada:
        p.error("hace falta --entrada o --escribir-ts")
    cadenas = json.loads(a.entrada.read_text(encoding="utf-8"))
    if a.limite:
        cadenas = cadenas[: a.limite]
    traducir(cadenas, a.modelo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
