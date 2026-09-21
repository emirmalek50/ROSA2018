# Ilustración base del atlas de la enfermedad

`lynch_sagital.svg` es el fichero original, sin modificar, de:

- Título: *Brain human sagittal section*
- Autores: Patrick J. Lynch (ilustrador médico) y C. Carl Jaffe (cardiólogo), Yale University School of Medicine
- Año: 2006
- Fuente: https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg
- Licencia: Creative Commons Atribución 2.5 Genérica (CC BY 2.5), https://creativecommons.org/licenses/by/2.5/

## Qué se modificó en ROSA2018

La lámina no se edita a mano: `scripts/atlas/lynch/generar.py` la lee y
escribe `src/lib/cerebro_base.ts` con sus cuatro campos de color y sus 146
trazos de tinta como datos. Las modificaciones respecto al original son:

- Escala por 2 y traslación de (312, 30) para encajarla en el lienzo lógico
  de 1000 por 620 del atlas (`VISTA` en `src/lib/atlas_dibujo.ts`).
- Recorte de la médula espinal por debajo de y = 590 del lienzo.
- Regiones superpuestas: las veinte regiones del vocabulario de
  `rosa/mapa_enfermedad.py` se trazan encima como capas semitransparentes
  (`src/lib/atlas_dibujo.ts`), con el hipocampo, la amígdala, la corteza
  entorrinal y los ventrículos como esquemas discretos, y se añade un bulbo
  olfatorio bajo el frontal que el original no tiene.
- Los colores del original (#f0e1df, #e0cbbd, #f1eed4 y la tinta #532e1f) se
  conservan.

El crédito se muestra en la propia interfaz, en el lienzo del atlas:
«Ilustración base: Patrick J. Lynch y C. Carl Jaffe, Yale University School
of Medicine, CC BY 2.5 (adaptada: escala, recorte y regiones superpuestas)».
