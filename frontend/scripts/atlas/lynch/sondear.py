"""Sonda: qué región contiene cada punto dado (x,y ...) según las figuras generadas.

Uso: uv run --no-project --with shapely python scripts/atlas/lynch/sondear.py 704 128 712 152
"""
from __future__ import annotations

import sys

from shapely.geometry import Point

from regiones import construir

figuras, _vasos, _d, silueta = construir()
nums = [float(v) for v in sys.argv[1:]]
for i in range(0, len(nums), 2):
    p = Point(nums[i], nums[i + 1])
    dentro = [k for k, g in figuras.items() if g.contains(p)]
    print((nums[i], nums[i + 1]), dentro or ("silueta" if silueta.contains(p) else "vacío"))
