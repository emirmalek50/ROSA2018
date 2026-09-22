# Formato de las mallas (R2M1)

Cada estructura es un fichero binario en little endian, que lee
`frontend/src/lib/cerebro_malla.ts` y escribe `generar.py`:

| Bytes | Contenido |
| --- | --- |
| 4 | La marca ASCII `R2M1` |
| 4 | uint32: número de vértices |
| 4 | uint32: número de triángulos |
| 4 | uint32: banderas (0) |
| 12 por vértice | float32 x, y, z |
| 12 por vértice | float32 normal, ya unitaria |
| 12 por triángulo | uint32 tres índices de vértice, antihorario visto desde fuera |

`indice.json` lista las estructuras (clave, nombre en castellano, fichero,
vértices, triángulos y caja envolvente) y lleva la fuente, la licencia, la
atribución que se enseña en pantalla, los ejes y la unidad.

Las claves de las estructuras son las mismas que usa el atlas de ROSA2018
(`rosa/mapa_enfermedad.py`), para que cada malla reciba la evidencia de su
región. Ver `LICENCIA.md` para la procedencia y lo que la fuente no tiene.
