"""Previa de la lámina encajada en el lienzo, con rejilla, para trazar las regiones encima.

Uso: uv run --no-project --with shapely python previa_base.py [salida.html]
Los campos van en falso color (para distinguirlos) si se pasa --falso.
"""
from __future__ import annotations

import sys

from lamina import RECORTE_Y, VISTA, contorno, leer

falso = "--falso" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
salida = args[0] if args else "previa_base.html"
campos, trazos = leer()
d_contorno, _ = contorno(campos, trazos)
FALSO = ["#9ad", "#fc9", "#9c9", "#c9c"]
partes = [f'<svg viewBox="0 0 {VISTA[0]} {VISTA[1]}" width="{VISTA[0]*2}" height="{VISTA[1]*2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0b0a14"/>']
partes.append(f'<clipPath id="r"><rect width="{VISTA[0]}" height="{RECORTE_Y}"/></clipPath><g clip-path="url(#r)">')
for i, c in enumerate(campos):
    partes.append(f'<path d="{c["d"]}" fill="{FALSO[i] if falso else c["fill"]}" opacity="{0.8 if falso else 1}"/>')
for t in trazos:
    partes.append(f'<path d="{t["d"]}" fill="{t["fill"]}"/>')
partes.append("</g>")
partes.append(f'<path d="{d_contorno}" fill="none" stroke="#0f0" stroke-width="1"/>')
for x in range(0, VISTA[0] + 1, 50):
    w = 0.8 if x % 100 == 0 else 0.3
    partes.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{VISTA[1]}" stroke="#4af" stroke-width="{w}" opacity="0.6"/>')
    if x % 100 == 0:
        partes.append(f'<text x="{x+2}" y="10" font-size="9" fill="#4af">{x}</text><text x="{x+2}" y="{VISTA[1]-3}" font-size="9" fill="#4af">{x}</text>')
for y in range(0, VISTA[1] + 1, 50):
    w = 0.8 if y % 100 == 0 else 0.3
    partes.append(f'<line x1="0" y1="{y}" x2="{VISTA[0]}" y2="{y}" stroke="#4af" stroke-width="{w}" opacity="0.6"/>')
    if y % 100 == 0:
        partes.append(f'<text x="2" y="{y-2}" font-size="9" fill="#4af">{y}</text><text x="{VISTA[0]-22}" y="{y-2}" font-size="9" fill="#4af">{y}</text>')
partes.append("</svg>")
with open(salida, "w") as f:
    f.write("<!doctype html><meta charset='utf-8'><body style='margin:0;background:#222'>" + "".join(partes))
print("escrita", salida)
