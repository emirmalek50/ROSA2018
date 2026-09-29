# ¿Conviene un archivo de ideas por nichos (MAP-Elites) en ROSA2018?

29 de septiembre de 2026. Análisis pedido por Emir: medir con datos reales si
organizar la generación de hipótesis por nichos haría a ROSA2018 más creativa, qué
ganaría y qué podría romper, y construirlo solo si el resultado sale al menos un
60 % a favor.

## 1. Regla de decisión (prerregistrada)

Esta sección se escribió y se subió al repositorio ANTES de calcular ninguna cifra,
para que el resultado no pueda acomodarse a lo que salga. Es el mismo prerregistro
que ROSA2018 exige a sus experimentos.

### Qué es un nicho

Una celda del mapa de la enfermedad (`rosa/mapa_enfermedad.py`): fase de la
enfermedad × región o compartimento × tipo celular. El mapa ya guarda en cada celda
sus hechos, sus cohortes y sus hipótesis.

La propuesta original decía "diana × estadio × tipo de mecanismo". No se puede
medir: la diana de la tarjeta es "sin diana" en la mayoría de las hipótesis y el
tipo de mecanismo no está clasificado en ningún sitio (clasificarlo costaría
llamadas al modelo). Se usan los ejes que existen.

### Lo que se mide

Beneficios (cuánto margen hay para que MAP-Elites ayude):

| Clave | Peso | Qué mide | Puntuación (0 a 1) |
|---|---|---|---|
| B1 | 3 | Concentración: fracción de las hipótesis vivas situadas en el mapa que caen en las dos celdas más pobladas de su investigación | (x − 0,3) / 0,4, acotado |
| B2 | 3 | Nichos listos: celdas con evidencia de dos o más cohortes distintas y ninguna hipótesis, por investigación con mapa (una hipótesis ahí podría nacer ya, sin pasar por el vivero) | x / 3, acotado |
| B3 | 2 | Redundancia: fracción de hipótesis vivas que tienen otra de su misma investigación con título casi igual (Jaccard de palabras ≥ 0,5) | x / 0,4, acotado |
| B4 | 1 | Respaldo externo: Mouret y Clune (MAP-Elites), Shen, Druckmann y Zou (novedad del 1,6 % al 50-69 % con analogía estructural), el archivo de ideas de The AI Scientist | 1, fijo |

Daños (lo que lo haría inútil o dañino):

| Clave | Peso | Qué mide | Puntuación (0 a 1) |
|---|---|---|---|
| H1 | 3 | Bloqueo: fracción de investigaciones con 10 o más hipótesis vivas (`MAX_HIPOTESIS_VIVAS_POR_MISION`): ahí no se genera nada y MAP-Elites no tendría efecto | x |
| H2 | 3 | Nichos que no darían fruto ya: de las celdas con evidencia y sin hipótesis, fracción con evidencia de una sola cohorte (lo que naciera ahí iría al vivero, no a la cola) | x |
| H3 | 2 | Coste: llamadas extra por iteración (se supone un miembro más del equipo en dos rondas, 2 llamadas) sobre la mediana de llamadas por iteración | ratio / 0,10, acotado |
| H4 | 1 | Deriva de relevancia: fracción de celdas candidatas que la misión no nombra cuando la misión nombra ejes; 0,5 si la misión no nombra ninguno (no se puede comprobar, cuenta medio en contra) | x |

### La cuenta

P = Σ(peso × B) / (Σ(peso × B) + Σ(peso × H))

Si P ≥ 0,60, se arma un plan estructurado y se ejecuta. Si P < 0,60, no se
construye, y se escribe qué tendría que cambiar en los datos para que conviniera.

Los pesos: 3 para lo que decide si hay efecto (dónde hay margen, qué lo bloquea), 2
para lo que lo agranda o lo encarece, 1 para lo que no sale de la base de ROSA2018.

## 2. Resultados

Calculado a las 09:20 sobre la base real (34 hipótesis, 6 investigaciones), con el
mapa de la enfermedad recalculado en el momento y no el guardado.

| Clave | Medido | Puntuación |
|---|---|---|
| B1 concentración | 0,76 de las vivas en las dos celdas más pobladas | 1,00 |
| B2 nichos listos | 6,5 por investigación (celdas con 2 o más cohortes y ninguna hipótesis) | 1,00 |
| B3 redundancia | 0 de 34 con un título casi igual | 0,00 |
| B4 respaldo externo | fijo | 1,00 |
| H1 bloqueo por tope | 0 de 6 investigaciones con 10 vivas | 0,00 |
| H2 nichos de una cohorte | 109 de 148 celdas vacías | 0,74 |
| H3 coste | 2 llamadas sobre una mediana de 147 por iteración (1,4 %) | 0,14 |
| H4 deriva | 0,12 de las celdas candidatas fuera de la misión | 0,12 |

Beneficio ponderado 7,00; daño ponderado 2,61. **P = 0,729. Supera el 0,60: se
construye.**

### Comprobación de robustez (no prerregistrada, informativa)

Una hipótesis puede estar en varias celdas a la vez, así que una celda genérica
("plasma, sin fase, sin tipo celular") podría inflar la concentración. No pasa:
cada hipótesis viva ocupa de media 1,6 celdas (mediana 1). Quitando las celdas con
dos o más ejes vacíos, P = 0,717. La decisión no depende de eso.

### Lo que dicen los datos, en concreto

- En "GFAP y NfL en portadores de APOE4" las 7 hipótesis vivas están en la MISMA
  celda: fase preclínica × plasma × astrocito. La celda "prodrómica o DCL × plasma
  × astrocito" tiene 7 hechos de 2 cohortes y ninguna hipótesis.
- En "reducir amiloide y tau en neuronas", "plasma × neurona" tiene 86 hechos de
  26 cohortes y ninguna hipótesis, y "LCR × neurona", 43 hechos de 19 cohortes.
- El generador no repite títulos (B3 = 0): el problema no es que proponga lo mismo
  dos veces, es que propone siempre en el mismo rincón de la enfermedad.

## 3. Predicción

**Lo que ganaría.** El equipo recibiría, además de su enfoque, un nicho concreto con
los hechos que ya lo pueblan, y el marcador por regla premiaría caer en un nicho
vacío con evidencia de dos cohortes. Con 2 entradas por iteración y 4,5 a 6,5
nichos listos por investigación, en 3 o 4 iteraciones las investigaciones
tendrían hipótesis repartidas por la enfermedad en vez de amontonadas en una
celda. Y como los nichos listos tienen dos cohortes, lo que naciera ahí nacería
directamente, sin pasar por el vivero.

**Lo que podría romper, y cómo se evita.**

1. El 74 % de las celdas vacías solo tiene evidencia de una cohorte. Si el equipo
   apuntara ahí, lo que propusiera iría al vivero y se retiraría a las seis
   iteraciones: trabajo tirado. Se evita apuntando SOLO a nichos con dos o más
   cohortes.
2. Forzar un nicho puede empujar al modelo a inventar para encajar. Se evita con
   un mandato explícito: si las afirmaciones no dan para el nicho, no forzarlo, y
   un miembro del equipo queda siempre libre, sin nicho asignado.
3. MAP-Elites no arregla el embudo del Killer (27 de 34 suspendidas). Da más
   variedad a lo que entra, no más supervivencia a lo que ya está. Lo que suspende
   (novedad sin comprobar, sesgo de la evidencia) sigue igual.
4. Coste: cero llamadas extra si se guía a los miembros que ya existen en vez de
   añadir uno. Es lo que se hará.

**Cómo se comprobará que funcionó.** El tablero del método gana un indicador de
nichos: cuántas celdas ocupan las vivas y cuántos nichos listos siguen vacíos, y
cada hipótesis guarda su nicho. Si tras tres iteraciones las nuevas siguen cayendo
en la celda de siempre, la predicción falló y se dice.

## 4. Plan

1. `rosa/nichos.py`: el archivo por nichos, por regla, desde el mapa de la
   enfermedad guardado. Celdas ocupadas con su élite (la mejor hipótesis de cada
   una por Elo), nichos listos (hechos de dos o más cohortes, ninguna hipótesis,
   al menos dos ejes con valor), el reparto de nichos entre los miembros del equipo
   (uno queda libre, rotando por iteración) y el nicho de una propuesta.
2. `GenerarHipotesis` recibe su nicho con los hechos que lo pueblan y la regla:
   si las afirmaciones no dan para él, no forzarlo.
3. El marcador del equipo (`equipo.puntuar`), por regla: +2 si la propuesta cae en
   un nicho listo; −2 si solo cae en la celda más poblada con tres o más vivas.
4. La hipótesis que nace guarda su nicho (y la semilla del vivero también).
5. El tablero del método gana el indicador de nichos (versión 3 de sus reglas).
6. Tests, prueba sobre la base real, commit y reinicio.
