# Generador del dibujo del atlas de la enfermedad

**Desde el 21 de septiembre de 2026 el generador vigente es `lynch/`**: el atlas
pinta debajo de las regiones la lámina anatómica de Patrick J. Lynch y C. Carl
Jaffe (`src/datos/atlas/lynch_sagital.svg`, CC BY 2.5, ver `LICENCIA.md` allí)
y las regiones se trazan encima, sobre esa anatomía. `lynch/lamina.py` lee y
encaja la lámina, `lynch/regiones.py` traza las veinte regiones con shapely,
`lynch/generar.py` escribe `src/lib/cerebro_base.ts` y `src/lib/atlas_dibujo.ts`
(y una previa HTML si se le pasa una ruta), y `lynch/sondear.py` dice qué
región contiene un punto. Uso, desde `frontend/`:

```
uv run --no-project --with shapely python scripts/atlas/lynch/generar.py [previa.html]
```

Lo que sigue describe el generador ANTERIOR (el dibujo geométrico del concurso
del 18 de septiembre), que queda obsoleto y se conserva por si hay que volver a
él; `geom.py` sigue en uso porque `lynch/` lo importa.

El corte sagital de `frontend/src/lib/atlas_dibujo.ts` no se dibuja a mano
directamente: se genera desde puntos de control con `shapely`, para que cada
estructura comparta frontera con sus vecinas y entre regiones quede siempre un
surco de 3 píxeles.

- `formas_final.py`: los polígonos de cada región (puntos de control y
  operaciones geométricas). Es el fichero que se toca para cambiar la anatomía.
- `geom.py`: utilidades geométricas (retroceso, suavizado, conversión a Bézier).
- `emitir_final.py`: escribe `atlas_dibujo.ts` con el contrato que espera la
  pantalla (`REGIONES_DIBUJO`, `CONTORNO_CEREBRO`, `TRAZOS_FINOS`...).
- `previa_final.html` y `capturar.js`: previa autónoma con los conteos reales
  (`conteos_reales.json`) y captura con Playwright para revisar el resultado
  antes de integrarlo.

Uso (con un entorno aparte que tenga `shapely`; no se instala en el `.venv`
del proyecto):

```
uv run --no-project --with shapely python frontend/scripts/atlas/emitir_final.py
cp frontend/scripts/atlas/atlas_dibujo.ts frontend/src/lib/atlas_dibujo.ts
```

El generador escribe `atlas_dibujo.ts` y `previa.html` junto a sí mismo; el
`cp` lo lleva a su sitio. Después, `npx vitest run src/lib/atlas_dibujo` comprueba el vocabulario, las
guías y las medidas anatómicas acordadas con los jueces del concurso del 18 de
septiembre de 2026 (tálamo, ventrículo, hipocampo, cerebelo, tronco y vasos).
