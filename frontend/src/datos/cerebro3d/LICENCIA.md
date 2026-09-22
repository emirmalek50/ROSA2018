# Modelo anatómico del cerebro: procedencia y licencia

Las mallas de esta carpeta salen de **BodyParts3D 4.0**, la base de modelos
anatómicos tridimensionales del Database Center for Life Science (DBCLS),
Japón: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html

- Licencia: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
  según https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Titular: The Database Center for Life Science.
- Atribución que pide la fuente, literal:
  `BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International`
- Atribución que enseña ROSA2018 en pantalla (en `indice.json`, campo
  `atribucion`): "BodyParts3D, © The Database Center for Life Science, con
  licencia CC Attribution 4.0 International. Mallas simplificadas y
  recentradas por ROSA2018."
- Sin cláusula de compartir igual. Para usos no cubiertos por CC BY 4.0 la
  fuente pide contactar con el licenciante.
- Original descargado: `isa_BP3D_4.0_obj_99.zip` (unos 136 MB, no se guarda
  en el repositorio); su suma SHA-256 está en `procedencia.json`.

## Qué se transformó

Lo hace `frontend/scripts/cerebro3d/generar.py`, reproducible con el original:

1. Cada estructura de ROSA2018 se compone de uno o varios conceptos
   anatómicos de BodyParts3D (por ejemplo, la corteza prefrontal une los giros
   frontal superior, medio, inferior y orbitario de los dos hemisferios). La
   tabla exacta está en `frontend/scripts/cerebro3d/estructuras.py` y la
   correspondencia concepto a fichero OBJ, en `procedencia.json`.
2. Giro puro de ejes al sistema de ROSA2018: x a la derecha, y arriba, z hacia
   atrás (hacia el occipucio). Sin espejo.
3. Recentrado del conjunto en el origen por el centro de su caja envolvente.
   Sin reescalar: las unidades siguen siendo milímetros.
4. Simplificación de cada malla a entre 800 y 24.000 triángulos, según su
   tamaño, para que el navegador la mueva suelto (unos 224.000 triángulos en
   total, 5,3 MB).
5. Normales por vértice recalculadas y triángulos ordenados en sentido
   antihorario vistos desde fuera.
6. El árbol arterial se corta a la altura donde termina el tronco del
   encéfalo, porque las arterias vertebrales de la fuente bajan por el cuello.

## Lo que la fuente no tiene

- El bulbo olfatorio no está segmentado en BodyParts3D 4.0: no se dibuja.
- El precúneo no viene separado: queda dentro del lobulillo parietal superior.
- La corteza entorrinal no viene separada: se enseña el giro parahipocampal,
  que la contiene, y el nombre en pantalla lo dice.
- La barrera hematoencefálica no es una superficie dibujable: la clave
  `vascular_bhe` enseña el árbol arterial.

Tres estructuras llevan clave propia porque ROSA2018 no las tenía en su
vocabulario de regiones y por eso no reciben evidencia del atlas: la corteza
sensitivomotora, la ínsula y el cuerpo calloso. Se dibujan en color de tejido.
