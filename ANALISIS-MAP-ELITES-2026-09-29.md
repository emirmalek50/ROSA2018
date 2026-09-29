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

(Se rellena después de calcular, sin tocar la sección 1.)
