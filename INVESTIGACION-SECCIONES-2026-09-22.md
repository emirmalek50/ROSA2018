# Qué secciones interactivas construir en ROSA2018

Investigación del 22 de septiembre de 2026, a petición de Emir ("qué secciones
nuevas interactivas recomiendas hacer", "investiga mejor"). Tres fuentes que se
cruzan:

1. **Referencias externas**, comprobadas hoy página a página: AI scientists con
   interfaz pública, herramientas de literatura, revisión sistemática y GRADE,
   portales de datos de Alzheimer, visores de procedencia y visualización
   causal. Cada afirmación lleva su URL; lo que no se pudo abrir va marcado.
2. **Auditoría del propio código**, de solo lectura, sobre qué datos existen ya,
   dónde viven y qué falta para pintar cada candidata, con fichero y línea y con
   los recuentos reales de `rosa.db` a 22 de septiembre.
3. **Los documentos del programa**, que mandan sobre el alcance.

## El criterio de orden

Lo fija `ROSA2018_SYSTEM_PLAN.md`, en su quinto nivel de evaluación: medir
"review time, correction burden, actionability, and the ability to reconstruct
and challenge decisions". Y avisa en la misma sección: "A visually clear report
is not an independent scientific success measure".

De ahí el criterio con el que se ordenan las candidatas, y que se aplica a cada
una más abajo:

- **Reconstruir y cuestionar.** ¿Deja a una persona rehacer el camino de una
  conclusión y discutirla? Es lo que más pesa.
- **Datos reales hoy.** Una sección que nace vacía enseña una promesa, no
  evidencia. Se dice cuántos registros reales tiene cada una.
- **Coste.** Días de ingeniería, backend y frontend por separado.
- **Qué la hace distinta.** Si una herramienta pública ya lo hace igual o mejor,
  no urge; si el hueco lo cubre solo ROSA2018, sube.

## El hueco que nadie cubre

De las diez herramientas de literatura revisadas, **ninguna resuelve la cita a
la página exacta del PDF**. Las mejores llegan al fragmento o a la frase:
Elicit abre el fragmento al pulsar una celda de la tabla de extracción
(https://support.elicit.com/en/articles/7927169), Scite da la frase con su
sección del artículo (https://scite.ai/features), PaperQA2 cita con rango de
páginas del tipo "(Qian2011Neural pages 1-2)"
(https://docs.edisonscientific.com/paperqa/readme.md), y Kosmos enlaza cada
frase a un artículo o a un cuaderno ejecutado con su identificador de
trayectoria (https://arxiv.org/html/2511.02824v1). Ninguna lleva al lector a la
página y al pasaje resaltado.

Eso es exactamente la regla no negociable de ROSA2018 ("las citas resuelven a la
página exacta; un desfase de una página es un fallo grave") y hoy está
implementada en el verificador pero **no se ve en pantalla**.

El segundo dato que ordena la lista viene de la evaluación publicada de Kosmos:
79,4 % de afirmaciones exactas en total, 85,5 % en análisis de datos, 82,1 % en
literatura y **57,9 % en síntesis** (https://arxiv.org/html/2511.02824v1). Lo
que falla es la interpretación, no el dato. Las secciones que enseñan cómo se
verifica y qué la sostiene valen más que las que enseñan resultados bonitos.

---

## Las trece candidatas

Orden: por lo que aportan al criterio de arriba, no por dificultad.

### 1. La mesa de la Killer

**Qué es.** Una matriz de hipótesis por comprobación: se elige una hipótesis y se
ve pasar cada afirmación por las quince pruebas adversarias (citas reales,
fidelidad a la evidencia, identificadores que resuelven, independencia de
cohortes, novedad, supuestos, falsabilidad, factibilidad, dirección de la
evidencia, unidades, sesgo, dirección causal y las del juez), con cuáles fallan y
por qué, la decisión por regla y su auditoría. Al lado, el panel de fallos
plantados como prueba de fuego del propio Killer.

**Qué la respalda.** Nadie hace esto. Lo más cercano es la curación por evidencia
de EMMAA, donde cada frase de apoyo se marca correcta o incorrecta con una
insignia verde o roja (https://emmaa.readthedocs.io/en/latest/dashboard/statement_evidence.html),
y el "Fact Checks" de Scite que marca referencias como verificadas o rechazadas
(https://blog-sc.hku.hk/features-and-limitations-of-scite-assistant-and-scite-mcp/).
La diferencia: en esas herramientas la etiqueta es salida de modelo sin revisión;
en ROSA2018 es una regla determinista con su auditoría. Es la sección que más
directamente responde a "reconstruct and challenge decisions".

**Datos.** Completos y en el estado público: `Decision` con `comprobaciones[]`,
`queHariaFalta`, `auditoria` y `contexto` (`frontend/src/datos/tipos.ts:1398-1416`),
escritas en `rosa/bucle/pasos.py:3183-3200`; las quince en `rosa/killer.py:87-207`
más `rosa/sesgo.py:288` y el grafo causal; el panel en
`rosa/evaluacion/panel_killer.py:233-308` hacia `estado.evaluaciones[]`.
Reales hoy: **59 decisiones**, todas con comprobaciones, 13 auditadas; exactamente
quince nombres de comprobación en la base; 2 registros de panel (35 casos con
detección 0,16; 15 casos con 0,667).

**Esfuerzo.** Backend 0 (0,5 opcional para el agregado). Frontend 2 a 3 días.

**Riesgo.** Las decisiones mezclan las de persona con las del Killer; las
hipótesis fusionadas conservan las suyas; el panel cuesta llamadas al juez y solo
hay dos registros, con una tasa de detección de 0,16 que conviene enseñar tal
cual, no esconder.

### 2. Escalera de certeza GRADE

**Qué es.** Por conclusión, los cuatro peldaños con dónde está, los factores que
la bajan o la suben con su explicación, el techo y su motivo, y al pulsar un
peldaño las afirmaciones que lo sostienen ordenadas por peso, con el juicio de
riesgo de sesgo por dominio e instrumento.

**Qué la respalda.** Es el canon. El GRADE Handbook fija los cuatro niveles, los
cinco factores que bajan y los tres que suben, y obliga a explicar en nota al pie
por qué se bajó y por qué no se bajó en los casos limítrofes
(https://gdt.gradepro.org/app/handbook/handbook.html). El capítulo 14 del Cochrane
Handbook fija los siete elementos de la tabla Summary of Findings y los símbolos
de certeza (https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-14),
y el 15 las frases plantilla por nivel, con la prohibición expresa de decir
"statistically significant"
(https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-15).
RevMan Web añadió en su versión 10.5.0, el 30 de abril de 2026, una pestaña
propia de "certainty of evidence" para puntuar los dominios con justificación, y
en la 11.8.0 tablas SoF dinámicas
(https://documentation.cochrane.org/revman-kb/revman-release-notes-342261851.html).
Y el propio grupo GRADE publicó en 2026 GRADErater, automatización de la
puntuación con reglas de decisión y supervisión humana explícita entre sus siete
principios (DOI 10.1016/j.jclinepi.2026.112411). ROSA2018 ya hace por regla lo
que ellos están empezando a automatizar; falta enseñarlo.

**Datos.** La conclusión viaja completa: `techo`, `escalera[{de, a, falta}]`,
`factores[{factor, efecto, explicacion}]`, `base` y `cohortesDistintas`
(`tipos.ts:1713-1748`), calculadas en `rosa/certeza.py` (`escalera` en 1178-1229,
`reacotar_conclusion` en 1026-1121). El riesgo de sesgo por instrumento (RoB 2,
ROBINS-I, QUADAS-2, SYRCLE) llega compacto por fuente (`tipos.ts:518-527`).
Reales: **28 de 28 hipótesis** con techo, escalera y factores; el reparto de
factores es riesgo de sesgo 28, evidencia indirecta 28, imprecisión 28,
inconsistencia 22, replicación independiente 4 neutros, efecto grande 2 al alza;
27 de 133 fuentes con instrumento de sesgo.

**Falta.** El peso por afirmación se calcula (`certeza.py:547-599`) pero no se
guarda: un endpoint que lo devuelva por regla, medio día.

**Esfuerzo.** Backend 0,5. Frontend 2 a 3.

**Riesgo.** Los factores no dicen si vienen del juez o de la regla (no hay campo
de origen); las 28 conclusiones bajan por riesgo de sesgo aunque solo 27 fuentes
tengan instrumento; `escalera[].falta` es texto libre y no estructura.

### 3. Visor de citas a la página exacta

**Qué es.** A la izquierda la afirmación con su veredicto; a la derecha la página
del PDF con el pasaje resaltado. Y desde cualquier pantalla, pulsar una cita
lleva ahí.

**Qué la respalda.** El hueco descrito arriba: nadie lo hace. Lo más parecido es
el Semantic Reader, que enseña tarjetas de cita en el sitio donde lees
(https://www.semanticscholar.org/product/semantic-reader), y la ventana de cita
arrastrable de Scite (https://scite.ai/blog/march-2026-release-notes). La regla
de Kosmos, "cada frase y cada figura cita o un artículo o un cuaderno"
(https://edisonscientific.com/news/announcing-kosmos), es el estándar que hay que
superar llevándola a la página.

**Datos.** Los PDF están en disco (`rosa/fuentes/pdf.py:34-63`, carpeta `pdfs/`,
hoy 14 ficheros y 39 MB), con lectura por página y comprobación de literalidad
contra una página concreta (`pdf.py:140-180`). Los fragmentos con su localizador
y la ruta del PDF viven en **claves privadas** de la corrida
(`pasos.py:624-680`), y al navegador llega solo el fragmento recortado y la
página (`tipos.ts:877`, `979`). **No existe ningún endpoint que sirva el PDF ni
el texto por página**: el único estático es `/assets`.

**Falta.** Dos endpoints (PDF por fuente y texto de página con el pasaje
localizado), más `fuenteId` y `localizador` en la afirmación pública, y modo
degradado para las fuentes que son JATS o texto web.

**Esfuerzo.** Backend 2 a 3. Frontend 3 a 4 con pdf.js. Total 5 a 7 días: la más
cara de las tres primeras.

**Riesgo.** Solo entran las primeras catorce páginas de cada PDF
(`pasos.py:97`), y solo cerca del 10 % de las fuentes tiene PDF descargado; de
128 fragmentos de la última corrida, 28 son de página de PDF, 4 de sección y 53
de texto web sin página. El fichero se nombra con el sha1 de la URL, así que si
la URL cambia no se reencuentra. Y hay que mirar las licencias antes de reservir
un PDF.

### 4. Embudo PRISMA

**Qué es.** El diagrama de flujo que reconoce cualquier revisor, con sus cajas
oficiales, animado por iteración y pulsable para ver los registros de cada caja
con su motivo de exclusión.

**Qué la respalda.** Rayyan genera PRISMA 2020 desde su pestaña Overview y tiene
una disciplina que conviene copiar: **solo los motivos de exclusión
estructurados alimentan el diagrama**, las etiquetas libres no
(https://help.rayyan.ai/hc/en-us/articles/45959279429649-How-to-Create-a-PRISMA-Flow-Diagram-in-Rayyan).
Covidence lo mantiene actualizado en continuo desde la importación y avisa de qué
casilla hay que corregir a mano
(https://support.covidence.org/help/export-prisma). Elicit lo entrega en la
sección de métodos junto con la estrategia de búsqueda reproducible
(https://elicit.com/solutions/systematic-review), y Consensus enseña su flujo en
la barra lateral del Deep Search
(https://aarontay.substack.com/p/a-2025-deep-dive-of-consensus-promises).

**Datos.** El endpoint ya existe y ya se usa para exportar:
`GET /api/corridas/{id}/prisma` (`rosa/servidor.py:437-454`) sobre
`rosa/prisma.py:44-99`, con variables del paquete R PRISMA2020 e informe con los
ítems 6, 7, 8, 16a y 16b más trAIce. El flujo viaja en el estado
(`tipos.ts:491-513`). Reales en la última corrida terminada: 2.104 identificados,
1.049 traídos, 50 cribados, 16 a texto completo, 34 usados, 48 consultas y **600
excluidos con su motivo**.

**Esfuerzo.** Backend 0 a 0,5. Frontend 2.

**Riesgo.** Los excluidos mezclan el corte del reranker con el juicio del modelo;
los duplicados salen a cero porque las consultas no guardan cuántos trajeron; el
informe recorta a 300 excluidos; y `usados` cuenta fuentes de toda la
investigación, no de la corrida.

### 5. Torneo de hipótesis en vivo

**Qué es.** Los duelos de la iteración en curso, el Elo moviéndose partido a
partido, Bradley-Terry con su intervalo al lado, y las relaciones entre
hipótesis (ataca, redundante con, absorbe).

**Qué la respalda.** Es la vista insignia del co-scientist de Google, que ordena
las hipótesis por Elo en una tabla de clasificación con cubos de alta viabilidad
y no viables, y una pestaña de especificaciones de la corrida
(https://support.google.com/hypothesis-generation/answer/17106281?hl=en); el
sistema apareció en Nature en mayo de 2026
(https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/).
ROSA2018 ya tiene el motor.

**Datos.** `partidos[]` con rival, resultado, resumen del debate y eje decisivo,
`historialElo[]`, `bt{fuerza, ic95, partidos}`, `ataca[]` (`tipos.ts:1120-1537`),
motor en `rosa/torneo.py`. Reales: **176 partidos** sobre 28 hipótesis, 21 con
Bradley-Terry.

**Falta.** La fecha del partido es privada (`_t`) y de las dos comparaciones que
hace el bucle solo se guarda una.

**Esfuerzo.** Backend 0,5. Frontend 2 a 3.

**Riesgo.** No existe el texto completo del debate, solo su resumen; sin fecha
pública los partidos de una misma iteración no se pueden ordenar.

### 6. Línea de tiempo de la investigación

**Qué es.** Las iteraciones y corridas en una línea recorrible con hitos, y al
parar en un punto, el árbol y el atlas se ponen en ese momento.

**Qué la respalda.** La línea de tiempo con red de citas de Undermind
(https://libguides.hkust.edu.hk/citation-chaining/undermind) y el "Inspect
evolutionary lineage" de Computational Discovery de Google
(https://labs.google/science). Para ROSA2018 el valor no es la línea en sí, sino
que el resto de pantallas se sincronicen con ella.

**Datos.** `estado.eventos[]` con 23 tipos (`tipos.ts:2007-2039`), `progreso[]`
por iteración con certezas y peldaños, fechas en todas las entidades, y los
ordinales globales ya calculados en `frontend/src/lib/arbol.ts:147-172`. Reales:
**938 eventos** (378 hechos nuevos, 175 cambios de estado de corrida, 56
revisiones automáticas, 50 de vigilancia, 40 de ranking, 40 del Killer) y 47
iteraciones.

**Esfuerzo.** Backend 0. Frontend 2 a 3.

**Riesgo.** Los eventos no llevan identificadores estructurados, solo una ruta y
un texto: enlazar un evento con su hipótesis exige parsear la ruta.

### 7. Sala de control de la corrida

**Qué es.** La iteración como circuito animado: buscar, leer, verificar, juzgar,
reconcluir, con las llamadas a cada modelo pasando por él, el gasto subiendo, los
permisos como compuertas y las incidencias parpadeando.

**Qué la respalda.** Lo vivo aquí no son los AI scientists sino las herramientas
de observación de agentes: el árbol de spans con línea de tiempo y latencia por
span de MLflow
(https://mlflow.org/docs/latest/genai/tracing/observe-with-traces/ui/), el flame
graph y los saltos entre llamadas hermanas de Weave
(https://docs.wandb.ai/weave/guides/tracking/trace-tree), el coste por tipo de
uso de Langfuse
(https://langfuse.com/docs/observability/features/token-and-cost-tracking) y las
vistas Trajectory, Turns y Details de LangSmith
(https://docs.langchain.com/langsmith/view-traces). De Galaxy conviene copiar que
el estado "aplazado" sea distinto de "error"
(https://training.galaxyproject.org/training-material/topics/galaxy-interface/tutorials/history/tutorial.html)
y de Seqera las tarjetas de estado con coste estimado
(https://docs.seqera.io/platform-cloud/monitoring/run-details). Edison lo
resuelve por el lado humano: dirigir la investigación a media corrida y hablar
con ella por Slack o correo (https://edisonscientific.com).

**Datos.** Todo el estado en vivo ya viaja: plan con estado por paso, pistas con
duración y transcripción con tiempo relativo, `esperandoModelo`, `saludModelos`
con latencia y caídas, incidencias, solicitudes. Reales: **641 pistas y 4.140
entradas de transcripción**.

**Esfuerzo.** Backend 0 a 1 (solo si se quieren eventos finos). Frontend 3 a 4.

**Riesgo.** El canal en vivo manda el estado entero en cada versión, con un
comentario en el código que habla de 10 MB; una animación fluida tiene que
interpolar en el navegador. Las llamadas en vuelo no están en el estado.

### 8. Grafo del modelo de mundo y mapa causal

**Qué es.** Los hechos como nodos unidos por lo que comparten, coloreados por
certeza, con la discordia marcada; y encima, la capa causal con las aristas
tipadas de `rosa/causal.py`.

**Qué la respalda.** Aquí la investigación fue la más productiva. De DAGitty:
los estados de nodo (exposición, resultado, ajustado, latente) y el pintar en
rojo los caminos sesgadores abiertos y en verde los causales, con recálculo
instantáneo de los conjuntos de ajuste al tocar el grafo
(https://www.dagitty.net/manual-3.x.pdf). De Tetrad: los tiers temporales y las
aristas prohibidas o requeridas como conocimiento previo explícito, y las marcas
de dirección incierta
(https://tetrad-manual.readthedocs.io/en/latest/tetrad-interface/box-by-box/knowledge-box.html).
De EMMAA e INDRA, lo más cercano a ROSA2018: la arista es una afirmación tipada
con su lista de frases de apoyo con identificador y fuente, curables una a una, y
un grado de creencia separado del recuento de evidencias
(https://emmaa.readthedocs.io/en/latest/dashboard/statement_evidence.html). De
STRING 12.5: un color por canal de evidencia y el pop-up al pulsar la arista con
los extractos (https://string-db.org/cgi/about). De Hetionet: explicar una
relación como lista de caminos tipados con su significación
(https://pmc.ncbi.nlm.nih.gov/articles/PMC10375517/). Para dibujar, Cytoscape.js
3.34.3 (https://js.cytoscape.org/) o la física que ya tiene el árbol.

Lo que **no** hay que copiar: la puntuación continua única. Open Targets avisa
en su propia documentación de que su score "should not be interpreted as a
confidence score" (https://platform-docs.opentargets.org/associations.md), y
STRING dice lo mismo de los suyos: son indicadores de confianza, no de fuerza
(https://string-db.org/cgi/info?footer_active_subpage=scores). Con GRADE por
regla, un número compuesto sobra.

**Datos.** Hechos con entidades canónicas, procedencia y citas a favor, en contra
y de mención; `grafoCausal` por hipótesis con aristas tipadas como supuesto,
inferencia con evidencia o base curada; `relaciones[]` con signo. Reales: **660
hechos** (327 con entidad canónica, 330 con afirmaciones enlazadas), 36
relaciones (21 supuestos, 15 de base curada y **0 con evidencia**), 21 hipótesis
con grafo causal.

**Esfuerzo.** Backend 0 a 1. Frontend 3 a 4.

**Riesgo.** El grafo causal real es hoy base curada más supuestos: ninguna arista
tiene evidencia propia todavía. La sección enseñaría sobre todo lo que se supone,
que es honesto pero hay que rotularlo bien. Y la mitad de los hechos no tiene
entidad canónica.

### 9. Mapa de fuentes consultadas

**Qué es.** Las bases públicas como un mapa: cuáles respondieron, cuáles no se
pudieron comprobar, con qué latencia, y qué aportó cada una.

**Qué la respalda.** La regla propia de ROSA2018 ("una fuente que no responde es
no pude comprobar, nunca no hay") coincide con lo que hacen bien los visores de
ejecución: Galaxy separa el estado aplazado del error, y el Workflow Run
RO-Crate modela cada paso como una acción con su instrumento y sus tiempos
(https://www.researchobject.org/workflow-run-crate/). Undermind estima cuánto de
lo relevante ha encontrado y ofrece extender la búsqueda
(https://undermind.ai/), que es el complemento honesto de la cobertura.

**Datos.** Catálogo de conectores con estado y motivo de los inertes
(`tipos.ts:2184-2202` desde `rosa/conectores/base.py:147`), y por consulta a base
el registro con invariante, error, duración y resumen (`tipos.ts:2155-2168`).
Reales: **87 conectores**, 21 de 28 hipótesis con consultas registradas.

**Falta.** Las consultas de literatura no guardan duración ni error, y los
contadores de uso del catálogo viven en memoria y se pierden al reiniciar.

**Esfuerzo.** Backend 1 a 2. Frontend 2 a 3.

**Riesgo.** Una base caída hoy solo se ve como incidencia, no en la consulta. El
CLAUDE.md dice 80 conectores y hay 87: conviene corregir el número.

### 10. Etiquetado a ciegas y acuerdo

**Qué es.** La persona etiqueta afirmaciones sin ver el veredicto del juez, y
después se comparan con kappa y matriz de confusión.

**Qué la respalda.** Es práctica estándar. Rayyan activa el modo ciego por
defecto al crear una revisión y solo lo desactiva para resolver conflictos
(https://help.rayyan.ai/hc/en-us/articles/17460918624145-How-to-Use-Blind-Mode-in-Rayyan);
Covidence manda los desacuerdos a una lista donde se ve quién votó pero no qué
votó, para no arrastrar el sesgo del compañero
(https://support.covidence.org/help/resolving-conflicts-at-screening-stage);
Elicit registra en su plan de empresa cada decisión, anulación y arbitraje con
kappa de Cohen (https://support.elicit.com/en/articles/7927169). Y Kosmos evaluó
así lo suyo: cada afirmación marcada como sostenida o refutada, con la tasa
separada por tipo (https://arxiv.org/html/2511.02824v1).

**Datos.** El cálculo está entero: `rosa/acuerdo.py:117-135` da kappa,
ponderado, AC1, intervalo por bootstrap y matriz. La acción para etiquetar
comprobaciones existe; la revisión a ciegas de hipótesis también.

**Falta.** **No existe ninguna acción que escriba el veredicto humano de una
afirmación**, así que el acierto por tipo siempre sale nulo. Reales: 0 casos
dorados, 0 afirmaciones etiquetadas, 0 decisiones con tiempo de revisión medido.

**Esfuerzo.** Backend 1 a 1,5. Frontend 2 a 3.

**Riesgo.** Nace vacía y el cuello de botella son las horas de la médica y de un
segundo revisor, no el código. Y a ciegas de verdad exige no mandar el veredicto
del juez al navegador, cuando hoy viaja el estado entero.

### 11. Procedencia con sello de tiempo

**Qué es.** Para una conclusión, la cadena hacia atrás hasta la fuente, con el
sello de cada eslabón y la verificación del hash a la vista.

**Qué la respalda.** Los visores de PROV están muertos o parados: ProvStore en
pausa, Prov Viewer y PROV-O-Viz sin mantenimiento. Lo que sigue vivo es
RO-Crate: Crate-O navega entidades con migas de pan del recorrido, y
ro-crate-html genera una previsualización estática sin depender de ninguna red
(https://github.com/UTS-eResearch/ro-crate-html-js). De los cuadernos de
laboratorio conviene copiar la firma con testigo y la hora sincronizada
(LabArchives), y de los registros de auditoría regulados la tabla con valor
anterior, valor nuevo y motivo del cambio
(https://developers.tetrascience.com/docs/audit-trail).

**Datos.** RO-Crate con PROV ya se genera (`rosa/rocrate.py:60-205`) y el sello
RFC 3161 está implementado (`rosa/sello.py`). El registro encadenado de
mutaciones tiene **23.031 filas** con hash y hash anterior.

**Falta.** La afirmación pública no lleva su fuente ni su localizador; el PROV no
incluye afirmaciones ni hechos; los planes de análisis tienen campo de sello pero
nadie lo escribe. Reales: **0 hipótesis selladas**, 67 afirmaciones sin
identificador.

**Esfuerzo.** Backend 1 a 2,5. Frontend 2 a 3.

**Riesgo.** Sin sellos reales la sección es un esqueleto. La autoridad de sellado
gratuita no da garantías de servicio.

### 12. Costes por resultado

**Qué es.** Cuánto costó cada hecho y cada hipótesis, por modelo e iteración.

**Qué la respalda.** Langfuse desglosa coste por tipo de uso y por modelo,
tiempo y usuario; Seqera estima el coste por tarea. Es una vista para el
ingeniero y para el jefe, no para la médica.

**Datos.** La tabla de llamadas tiene modelo, rol, corrida, iteración, tokens y
duración, con **7.608 filas**; los agregados por corrida ya se pintan.

**Falta.** La tabla **no guarda la hipótesis ni el paso**, así que un coste por
resultado fino no es reconstruible sin añadir dos columnas.

**Esfuerzo.** Backend 0,5 a 2. Frontend 2.

**Riesgo.** Los precios están fijados a mano con fecha; hay que distinguir el
gasto real del estimado.

### 13. Ensayo en seco

**Qué es.** Enseñar el ensayo sobre datos sintéticos antes de tocar los reales.

**Datos.** El generador existe (`rosa/sintetico.py:74-99`) y el resultado tiene
sitio en el estado, pero el perfil de columnas no se guarda. Reales: 12
ejecuciones y **0 con ensayo en seco**.

**Esfuerzo.** Backend 0,5. Frontend 1,5 a 2.

**Riesgo.** Sin datos reales hoy. Y sus cifras no deben poder confundirse nunca
con un resultado.

---

## El orden que recomiendo

**Primero, las tres que enseñan que ROSA2018 se puede comprobar.** Es lo que pide
el quinto nivel de evaluación del plan y lo que ninguna herramienta pública
cubre entero.

| Orden | Sección | Días | Datos reales hoy |
| --- | --- | --- | --- |
| 1 | Mesa de la Killer | 2 a 3,5 | 59 decisiones, 15 comprobaciones, 2 paneles |
| 2 | Escalera de certeza GRADE | 3 a 4 | 28 de 28 conclusiones |
| 3 | Visor de citas a la página | 5 a 7 | 14 PDF, 28 fragmentos con página |

**Después, las baratas con datos listos**, que dan continuidad y salen casi
gratis: embudo PRISMA (2 a 2,5 días, 600 excluidos con motivo), torneo en vivo
(2,5 a 3,5 días, 176 partidos) y línea de tiempo (2 a 3 días, 938 eventos).

**En tercer lugar, las grandes**: sala de control (3 a 5) y grafo del modelo de
mundo con la capa causal (3 a 5). La segunda conviene retrasarla hasta que haya
aristas causales con evidencia, que hoy son cero.

**Al final, las que dependen de datos que todavía no existen**: etiquetado a
ciegas, procedencia con sello, costes por resultado y ensayo en seco. En todas,
antes de la pantalla hay que escribir el dato.

## Lo que se descarta, y por qué

- **Puntuaciones compuestas** tipo Open Targets o Agora como cifra única. Ellos
  mismos avisan de que su score no es confianza. Con GRADE por regla, un número
  inventado sobraría y contradice las reglas del proyecto.
- **El medidor de consenso** de Consensus: es recuento de votos que ignora tamaño
  de efecto y riesgo de sesgo, justo lo contrario de GRADE.
- **Insignias de calidad por revista**: no son calidad del estudio.
- **BioRender y el mapa de KEGG** como modelo de interfaz: ilustraciones
  estáticas sin incertidumbre ni evidencia por arista.
- **El cribado por votos ciegos entre humanos** de Covidence tal cual: en ROSA2018
  el segundo lector es el verificador, y su desacuerdo con una persona es un
  hallazgo que hay que enseñar, no un empate que resolver.
- **Las estrellas de relevancia** de Rayyan: ROSA2018 no criba por probabilidad de
  inclusión sino por veredicto con motivo.

## Dudas que decide Emir

1. **El visor de citas cuesta el doble que las otras dos primeras.** ¿Va tercero
   como está, o se adelanta por ser la regla de oro del proyecto?
2. **La mesa de la Killer enseñará una tasa de detección de 0,16** en uno de los
   dos paneles. Enseñarla es lo honesto; confirma que se publica tal cual.
3. **El grafo causal no tiene ninguna arista con evidencia.** ¿Se construye la
   sección ahora enseñando supuestos y base curada, rotulados como tales, o se
   espera a tener aristas sostenidas?
4. **El etiquetado a ciegas necesita horas de la médica y de un segundo
   revisor.** Sin esas horas, la sección nace vacía y se queda vacía.

## Ficheros de trabajo

Los cinco informes de referencia completos, con todas las URL comprobadas, y la
auditoría del código con fichero y línea, quedan en el scratchpad de la sesión:
`informes_secciones/{ai_scientists,literatura,grade,portales,procedencia}.md`.
Las cifras de `rosa.db` se leyeron el 22 de septiembre de 2026 sobre una copia en
modo solo lectura.
