# Pendiente para la siguiente sesion

Actualizado el 28 de septiembre de 2026. El plan completo por etapas esta en
`PLAN-ROSA2018.md`; esto es la lista corta de lo inmediato.

## El sandbox existe y funciona: lo que le falta (auditoria del 28 de septiembre de 2026)

Emir preguntó si convenía darle un sandbox a ROSA2018. Ya lo tiene, y con
kilometraje real: `rosa/ejecucion.py` (445 líneas) y `rosa/bucle/analisis.py`
(636) llevan 12 ejecuciones en la base de producción, 11 en Docker, y las tres
reproducciones que abrieron la puerta salieron de ahí. Las garantías que promete
están implementadas, no solo escritas: contenedor nuevo por ejecución con
`--network none`, 2 GB, 2 CPU, `--cap-drop ALL`, `--security-opt
no-new-privileges`, `--pids-limit 256`, sin swap, datos montados en solo
lectura, trabajo efímero, salida a ficheros fuera del volumen, y al contenedor
solo entran `ROSA_SEMILLA` y `ROSA_DATOS` (ninguna clave). Sin Docker y con
datos reales no cae a ejecutar sin aislamiento: queda en `no_ejecutado` con el
motivo.

Lo que falta, por orden de lo que más desbloquea:

1. **Que ROSA2018 pueda traerse un dataset sola.** Es la causa real de que el
   sandbox lleve parado desde el 14 de septiembre y de que, de sus 12
   ejecuciones, **once fueran reproducciones para abrir la puerta y solo una
   produjera evidencia nueva** para una hipótesis. Hoy los datasets solo entran
   subidos a mano, así que el paso de análisis casi nunca tiene sobre qué
   trabajar. Mientras esto siga así, endurecer o ampliar el sandbox no cambia
   nada medible.
2. **El camino Docker no tiene ni un test.** El único test que ejecuta código de
   verdad (`rosa/tests/test_rosa2018.py:781`) prueba el aislamiento blando
   local, y el que dice cubrir el sandbox (`rosa/tests/test_rosa2018.py:206`) se
   salta siempre que hay Docker, o sea siempre en CI. Sin cobertura:
   `_asegurar_imagen`, el `docker run` de `rosa/ejecucion.py:312-328`,
   `versiones_imagen` y el `docker rm -f` por tiempo agotado.
3. **Límites por entorno.** 180 s y 2 GB son globales
   (`rosa/politicas.py:72-73`) y no dan para célula única: los h5ad de SEA-AD
   van de 4,2 a 50,8 GB. La imagen `rosa-sandbox-celula:1` está construida
   (1,28 GB) y **nunca se ha estrenado**: las 12 ejecuciones son tabulares.
4. **Contradicción abierta**: `rosa/skills/pseudobulk-por-donante/SKILL.md`
   cuenta con pydeseq2 y `rosa/sandbox/Dockerfile.celula:6` no lo instala.
5. **M-26 sigue abierto** (`REVISION-BUGS-2026-09-17.md:526`): el apagado de
   `rosa/main.py:80-92` no aborta los contenedores en vuelo, y un hilo del
   sandbox puede sobrevivir al cierre y escribir en un almacén cerrado. No
   existe ningún `abortar_todo()` de contenedores.
6. **`--cpus 2` está clavado** en `rosa/ejecucion.py:319`, fuera de
   `politicas.py`, a diferencia del tiempo y la memoria.
7. **El camino de Apple `container` nunca se ha ejercitado** y recibe banderas
   de Docker (`--memory-swap`, `--pids-limit`, `--cap-drop`, `--security-opt`)
   sin comprobar que las acepte.
8. **`TRASPASO.md` no documenta el sandbox.** La documentación viva de esta
   pieza está repartida en `PLAN-ROSA2018.md:36-39`, `README.md:378-380` y
   `ESTADO-ROSA-2026-09-11.md:405-407`.
9. El campo `"red": "deshabilitada"` del RunRecord está fijo en la plantilla
   (`rosa/estado/plantilla.py:622`) y la interfaz lo enseña como si fuera un
   hecho medido. Es cierto en ambos caminos, pero es un dato declarado, no
   observado.

## Hecho: los cinco fallos que destapó el dossier de SULF2 (28 de septiembre de 2026)

Emir mandó a Codex el dossier de «SULF2 neuronal como barrera a la entrada de
tau en un entorno microglial GPC4 alto» (`hip-mult...`, corrida
`cor-mulntlr0-42`), la única hipótesis de la corrida que subió a certeza
`baja`. La crítica principal de Codex («falta el supuesto que carga con todo el
peso: que la entrada neuronal y la degradación microglial de tau dependan
distinto de la sulfatación 6-O») **es falsa**: ROSA2018 tiene ese supuesto,
`sup-multxk0a-25447`, y lo marcó **`contradicho`** citando las afirmaciones 8,
9, 10 y 13. El dossier imprime los 12 supuestos con su estado
(`rosa/dossier.py:175-177`), sin recorte.

Pero al comprobarlo salieron cinco fallos reales, y el primero es peor que lo
que decía Codex:

1. **Un supuesto contradicho no baja la certeza ni aparece entre los factores
   GRADE.** La conclusión de esta hipótesis es `baja / apoya` con tres factores
   (`evidencia_indirecta` baja, `imprecision` baja, `efecto_grande` sube) y
   **ninguno menciona el supuesto contradicho**. O sea: ROSA2018 demostró que el
   supuesto central de su propia hipótesis es falso y después lo ignoró al
   concluir. La regla de que «solo un supuesto contradicho tumba» vive en el
   Killer, no en la escalera de certeza.
2. **El Killer nunca la juzgó** (`decisionKiller: None`): nació en la iteración
   2 y la corrida terminó. Es decir, la única pieza que habría actuado sobre el
   supuesto contradicho no llegó a correr. El dossier lo dice
   (`rosa/dossier.py:125`, «Decisión del Killer sobre esta versión: pendiente»)
   pero lo entierra en una línea de estado, mientras la conclusión GRADE va
   arriba y con su sello. Decidir si una hipótesis sin juzgar por el Killer
   puede presentarse con certeza por encima de `muy_baja`.
3. **`cohortesDistintas` cuenta una bolsa como una cohorte, y eso sube el
   techo.** El valor guardado es `["cerebro humano con enfermedad de
   Alzheimer", "iPS-derived neurons, CNS cell lines, mouse brain slice"]`: la
   segunda son tres plataformas metidas en una cadena. Con ellas el techo por
   regla pasó de `muy_baja` a `baja` («2 cohortes distintas»). No son réplicas
   independientes del mismo efecto: son eslabones distintos medidos en sistemas
   distintos. Codex acertó aquí.
4. **`sin_evidencia` cuando en realidad fue `no_evaluado`.** Dos de los doce
   supuestos llevan `estado: sin_evidencia` con `evidencia: "No se pudo
   evaluar: el modelo no respondió (AdapterParseError)"` y `alcance:
   no_evaluado`; `supuestosEvaluados.fallidos` es 2. El dossier imprime
   `[sin_evidencia]`, que un lector entiende como «se miró y no hay». Va contra
   la regla de la casa: una fuente que no responde es «no pude comprobar»,
   nunca «no hay». El estado mostrado debe reflejar `alcance`.
5. **El verificador dio `sostenida` a una afirmación que dice más que su
   pasaje.** La afirmación 13 dice «...mientras que la condroitín sulfato y la
   heparina 6-O-desulfatada **no lo hicieron**», y el pasaje literal citado
   (Rauch 2018, pág. 4) es solo «incubation with heparin, heparan sulfate, or
   2-O-desulfated heparin reduced uptake of tau...». La mitad negativa, que es
   justo la que sostiene la especificidad 6-O, no está en el pasaje. Es el
   mismo fallo que el panel del Killer ya midió («cifra alterada frente al
   pasaje: 0 de 5 detectados»), pero en su versión por extensión: la afirmación
   añade un brazo que la cita no cubre. Y esa afirmación es una de las cuatro
   que sostienen el supuesto contradicho del punto 1.

De regalo, un ejemplo de rúbrica que se satisface por presencia y no por
sustancia (Codex lo señaló con otro nombre): la capa `farmacologia` del perfil
de diana figura como **`presente`** con este detalle: «ChEMBL: sin diana
registrada para esa proteína; DGIdb: 1 interacciones fármaco-gen, 1 con
fármacos aprobados (VINCRISTINE)». Vincristina es un alcaloide de la vinca; que
aparezca en una fila de DGIdb no hace que SULF2 tenga farmacología.

**Los cinco están arreglados y empujados** (ver `TRASPASO.md`, "Los cinco
fallos del dossier de SULF2"). Sobre la base real, con las reglas nuevas cambia
exactamente una hipótesis de las 34: SULF2 pasa de `baja` a `muy_baja` por el
supuesto contradicho. Dos hipótesis vivas que el Killer nunca juzgó quedan con
la revisión pedida y con el aviso en su dossier.

Lo que NO se hizo y queda pendiente:

- **Juzgar en el cierre las hipótesis que nacen del vivero.** Lo arreglado es
  que dejen de ser invisibles (se les pide revisión, el abandono por
  presupuesto deja el motivo escrito, el dossier lo avisa arriba); lo que sigue
  sin pasar es que el Killer las juzgue antes de que la corrida termine. El
  punto natural es `_cerrar_iteracion` justo después de `EV.acumular_vivero`,
  que ya tiene los ids en `vivero_res["nacidas"]`. Cuesta de 6 a 15 llamadas
  por hipótesis (revisión inicial, un evaluador por supuesto, sesgo por fuente
  primaria y el juez del Killer) y hace falta una partida `"killer"` en
  `coste_estimado_del_cierre` y en `desglose_previsto_del_cierre`, o el cierre
  pausará la corrida (el fallo S-14).
- **La capa `farmacologia` del perfil de diana dice `presente` por presencia de
  una fila, no de un fármaco.** `_estado_capa` (`rosa/dianas.py:266`) devuelve
  `presente` si alguna fuente trae datos; para SULF2 eso fue «ChEMBL: sin diana
  registrada; DGIdb: 1 interacción con fármacos aprobados (VINCRISTINE)».
  Vincristina es quimioterapia. Arreglarlo bien pide un cuarto estado (algo
  como `parcial`) y toca `ESTADOS`, `ETIQUETAS_ESTADO`, `tipos.ts`,
  `etiquetas.ts` y el resumen de `dianas.py:691-699`. Es el hallazgo más débil
  de los seis y el que más ramifica, así que se deja apuntado.
- **No hay panel de evaluación del verificador de citas ni del juez
  `JuzgarAfirmacion`**, con fallos plantados, como el que sí existe para el
  Killer (`rosa/evaluacion/panel_killer.py`). La comprobación nueva de
  sobreafirmación se prueba con el caso real y con casos construidos, pero no
  hay medida de cuántos se le escapan.

Lo que Codex aportó y vale la pena conservar, aunque sea de biología y no de
código: reformular la hipótesis un nivel hacia arriba (¿el código de sulfatación
del heparán sulfato discrimina la entrada neuronal de tau de su eliminación
microglial?), el brazo de control que falta (SULF2 expresada en microglía, que
es la acción en trans), la distinción entre GPC4 de membrana y GPC4 liberado, y
un experimento previo de 2.000 a 5.000 euros (microglía en monocultivo, con y
sin condiciones 6-O-desulfatadas) que puede cerrar la vía antes del factorial.
Ese orden, matar primero y barato, es el del propio Killer.

## Acordado el 28 de septiembre y aún sin hacer

- **Que el equipo de hipótesis no tire lo que no entra.** Medido en la corrida
  `cor-mulntlr0-42`: 23 propuestas, 6 entraron, 17 se perdieron, y 11 de las 12
  perdedoras anotadas cumplían todos los criterios. Lo decidido con Emir: que
  entre **una sola por iteración** (`EQ.MAX_QUE_ENTRAN` de 2 a 1), la mejor
  estructurada, y que las demás se guarden en el vivero marcadas `esperaTurno`
  (para que `acumular_vivero` no las haga nacer solas) y **compitan en el paso
  de hipótesis de la iteración siguiente**. Guardar en la hipótesis nacida su
  procedencia: `enfoque`, `ronda` y `puntos`. Cita de Emir: "tampoco es que
  quería 11 hipótesis, quería la mejor estructurada de esas 11".
- **Que ROSA2018 escriba sus propias preguntas abiertas al empezar una
  investigación nueva.** Hoy hereda el conocimiento de las demás (que es lo que
  debe hacer), pero al no tener preguntas propias las heredadas pasan a ser el
  100 % del criterio de búsqueda. Lo decidido: un paso al arranque donde
  ROSA2018 escribe sus preguntas abiertas a partir del objetivo, usando lo
  heredado como punto de partida y no como destino; las propias ordenan primero
  y las heredadas quedan de contexto; las búsquedas por nombre salen solo del
  objetivo y de las preguntas propias; y un freno para las palabras comunes (un
  nombre que devuelve más de un millón de resultados con cero relevantes no se
  vuelve a buscar por nombre). Cita de Emir: "un ser humano solo por saber
  información sobre algo no significa que no pensará en las cosas que apoyarían
  la investigación de algo nuevo que no sabe".

## Hecho el 14 de septiembre (tarde): segunda auditoria y los quince huecos

- Segunda auditoria (cuatro criticos, siete altos, doce medios) cerrada; ver
  el commit "Segunda auditoria" y `rosa/tests/test_auditoria2.py`.
- Los quince huecos de un AI scientist profesional, verificados y aplicados:
  `INVESTIGACION-AI-SCIENTIST-2026.md` y la seccion nueva del README.
- Queda para despues del primer ciclo real, a proposito: H08 (valor de la
  informacion cuantificado; la advertencia de que informacion no es utilidad
  de decision esta anotada) y H10 (contrato con el laboratorio concreto:
  identificadores de muestra, formato de retorno, quien confirma la identidad;
  el RO-Crate ya tipa el experimento como LabProcess para cuando exista).
  H15 completo (firma electronica por persona, validacion del sistema) solo
  si el destino es regulado.
- Cuando haya etiquetas: correr el panel del Killer y mirar el kappa por
  comprobacion en Calidad; hacen falta 100 casos por comprobacion (200 si el
  fallo es raro) para que la cifra sea estable.
- Opcional con cuenta: prerregistro en OSF (token en `.env` como `OSF_TOKEN`)
  ademas de los sellos RFC 3161.

## Hecho el 14 de septiembre: auditoria de bugs de todo ROSA2018

Cinco revisores en paralelo (servidor y estado, bucle, conectores y fuentes,
sandbox y datos, frontend) mas los nueve hallazgos de Codex. Se corrigio todo
en cuatro lotes, cada uno con tests y commit (`2bf90d5`, `97b3668`,
`327a2e4`, `6565fdb`).

- Servidor y estado: ruta estatica sin salida del directorio; acciones solo
  con JSON, cabecera `X-ROSA2018: 1`, token opcional `ROSA_TOKEN`, cuerpo de 1 MB,
  subidas por trozos; acciones internas del bucle fuera del alcance del
  navegador; una accion que falla a medias no deja el estado a medias (se
  recarga del disco); Convex con funciones internas y recorte garantizado.
- Bucle y gasto: el presupuesto se comprueba antes de cada llamada, una
  corrida parada no gasta, tope de 10 minutos por llamada; e-valores sin
  inflar por repeticion (una prueba por hash de datos y de plan); cambiar la
  semilla ya no toca filtros del codigo; Elo con tablas.
- Sandbox: aislamiento local apagado por defecto (`ROSA_PERMITIR_LOCAL_SINTETICO=1`
  solo para sinteticos) y endurecido; contenedores con nombre que se borran al
  agotar el tiempo, sin capacidades, sin escalada de privilegios, con limite
  de procesos y de swap; salida a fichero fuera del directorio montado; skills
  importables con `python -I`.
- Fuentes y conectores: limitador compartido por host (NCBI, Europe PMC),
  404 es "sin registro" y no caida, JSON y XML rotos son "no pude comprobar",
  PDF en streaming con tope de 50 MB y sin hosts privados; argumentos de las
  herramientas validados; lo que devuelve una base va delimitado como dato.
- Datos: el juez no recibe filas del laboratorio, columnas de muchos valores
  no se enumeran, miles y coma decimal, `.txt` sin delimitador no es tabla.
- Interfaz: una accion rechazada por el servidor se ve (aviso bajo la
  cabecera) y se deshace; la resincronizacion respeta versiones; formularios
  que se rehidratan; claves por investigacion; guardas para URL, fechas y
  tipos desconocidos.

Queda por hacer una persona: rotar la clave de despliegue de Convex (paso por
el chat) en el panel de Convex y poner la nueva en `.env`.

## Hecho el 11 de septiembre (ROSA2018)

- Mision con areas de investigacion y pregunta de campana; politicas en
  codigo; tarjeta y versiones de hipotesis; Hypothesis Killer con decision
  por regla, reformulacion y auditoria de descartes; registro de decisiones;
  datasets con libro de procedencia y hash; puerta de reproduccion; analisis
  in silico con plan congelado, sandbox, interpretacion y auditor; bloqueos
  no compensables, candidatas y dossier; retorno con seis clases y
  dimensiones; registro de aprendizaje en tres niveles con evaluacion sobre
  conjunto reservado; registro de metodos; recalculo con informe de
  diferencias al cambiar el estado editorial de una fuente; presupuesto en
  dolares y horas; documentos recuperados como datos.
- Los puntos 1 a 5 de la lista anterior (prerregistro, plan por ganancia de
  informacion, version del arnes, cierre del loop con datos, analisis en
  entorno aislado) estan cubiertos.

## Datos: solo publicos por ahora

Decision de la persona responsable del programa (11 de septiembre): no se
piden accesos controlados (ADNI, AD Knowledge Portal, dbGaP). ROSA2018 trabaja
con datos publicos: GEO, SEA-AD procesado (abierto) y OASIS (registro
gratuito). El libro de procedencia y la regla de no enviar filas al modelo
siguen activos para cuando entren datos controlados.

## Hecho tambien el 11 de septiembre (tarde)

- Concurrencia y carga de revision: sello de version en el Killer y en las
  decisiones humanas; segundos de revision por decision; responsables en la
  mision.
- Bradley-Terry con intervalos por bootstrap en el ranking; repeticiones con
  semillas en el sandbox; e-valores por hipotesis.
- Misma cohorte por autores, centro y periodo; comprobaciones automaticas de
  direccion de la evidencia y de unidades.
- Protocolo real, desviaciones, identidad de muestras y enmiendas fechadas.
- Gobierno de areas (elegir, pausar con condicion, reabrir, sin explorar,
  asignar a campana) y jerarquia programa, areas, campanas, preguntas.
- Motor causal minimo con aristas tipadas e identificacion por regla.
- Panel del Killer con fallos plantados y registro de evaluaciones.
- Puerta: dos reproducciones mas, superadas, con criterios congelados de los
  metodos publicados (GSE29378 Miller 2013: NRIP3 CA3 frente a CA1 en
  controles, 2,14 veces, tolerancia 20 %; GSE36980 Hokama 2014: media de
  diez marcadores neuronales en hipocampo, 64,87 %, tolerancia 15 %).
- Investigacion de las herramientas de Claude Science
  (`INVESTIGACION-HERRAMIENTAS-CLAUDE-SCIENCE.md`) y su aplicacion: 80
  conectores con registro de consultas, novedad por genetica, farmacos y
  datos publicos, contexto de la diana, preguntar a las bases (ReAct),
  permisos por conector, memoria del proyecto, revisor de registro,
  artefactos con cinco pestanas de procedencia, siete skills, imagen de
  celula unica. Ver README, seccion "Lo que ROSA2018 tomo de Claude Science".

## Bases de datos: SQLite en el bucle, Convex para las personas (decisión del 15 de septiembre de 2026)

Emir decidió aplazar la migración a Convex como fuente de verdad: hoy no
cambia mucho y costaría una o dos semanas (75 puntos de mutación del estado
entero, documentos de más de 1 MiB, permisos para las claves privadas).
SQLite se queda como memoria de trabajo del proceso del bucle por su
velocidad (microsegundos por escritura, sin red). Queda anotado para cuando
haga falta, en este orden:

1. Paso barato (dos o tres días): el frontend lee del espejo de Convex por
   suscripción reactiva en vez de `/api/estado` y SSE; solo las acciones van
   al servidor. Con eso la interfaz en Vercel funciona con el bucle en
   cualquier sitio y varias personas ven lo mismo a la vez.
2. Paso largo: mover la escritura a mutations de Convex con permisos, partir
   el estado en documentos, y usar la búsqueda vectorial nativa de Convex en
   lugar del índice en numpy. Hacerlo cuando el bucle esté estable.

## Herramientas evaluadas el 15 de septiembre y lo que queda

Hecho: reranker por el gateway, índice semántico del registro, conectores de
PubTator 3, banco de objetivos (ver README). Queda, por orden de valor:

1. Correr una corrida sobre el objetivo `biomarcador_beneficio_clinico` del
   banco y comparar la puntuación con la primera corrida real (0 de 7
   nombres buscados). Es la cifra de referencia de todo lo demás.
2. Regla en el revisor de registro para cifras del resumen que no aparecen
   en ningún pasaje (hoy solo cuenta hechos e hipótesis; las cifras
   sueltas las juzga el modelo).
3. GROBID (extracción de PDF con estructura, propio servidor Docker) para
   el texto completo cuando Europe PMC no lo trae; y OpenCitations o
   Semantic Scholar para citas entrantes en la novedad.
4. Lens.org (patentes con API propia, requiere cuenta) si las patentes por
   Exa resultan insuficientes; OSF y Zenodo para depositar los dossieres
   con DOI (requieren cuenta institucional).
5. Clave de Exa: se pegó en el chat; rotarla en dashboard.exa.ai.

## Inmediato

1. Puerta de reproduccion: 3 de 3 superadas con datos publicos (Blalock
   2004 en GSE1297, 418 frente a 431; Miller 2013 en GSE29378, 2,1391
   frente a 2,14; Hokama 2014 en GSE36980, 65,11 frente a 64,87). Las dos
   ultimas fallaron a la primera porque el escritor de codigo declaro "no
   evaluable" por una duda del texto del metodo; se corrigio el texto y las
   firmas (NO_EVALUABLE solo por condiciones de los datos). Los registros
   fallidos quedan a la vista.
2. Panel del Killer (11 de septiembre, 35 casos, 8 USD): deteccion 16 %,
   abstencion 0 %, sobre-matanza en gris 80 %. Las cinco hipotesis originales
   salieron "descartar" por `supuestos`: el juez trataba un supuesto "sin
   evidencia" como invalidante. Corregido: `supuestos` es ahora por regla
   (solo un supuesto contradicho tumba), el supuesto invalidante del juez
   solo cuenta si hay contradiccion real, y cuando juez y regla discrepan en
   fidelidad, citas o supuestos la hipotesis se suspende en vez de morir.
   Lo que el juez si detecto: supuesto contradicho (4 de 5), causalidad sin
   temporalidad (5 de 5), prediccion vaga (2 de 3 sin error). Lo que no
   detecto: cifra alterada frente al pasaje (0 de 5); se le a�adi� la
   instruccion explicita de comparar texto y pasaje. Tres casos fallaron por
   JSON truncado; el juez pasa a 8000 tokens de salida. Queda un segundo
   panel reducido para medir el efecto; repetir el panel completo tras cada
   cambio del prompt del Killer.
3. SEA-AD procesado: agregar por donante (los ficheros pesan de 1 a 33 GB;
   ROSA2018 admite 200 MB) antes de subirlo.
4. Alinear con la persona responsable del documento de concepto los nombres
   de los registros (ver `PLAN-ROSA2018.md`, introduccion) y los responsables
   de la mision.

## De Claude Science, lo que queda

- Probar la imagen `rosa-sandbox-celula:1` (construida, 1,28 GB) con un h5ad real
  (SEA-AD por CELLxGENE) y una reproduccion de celula unica en la puerta.
- Lector de ficheros del eQTL Catalogue (la API REST se retiro) y de ARCHS4
  (H5 de 30 GB), si se decide descargarlos al servidor.
- Un segundo panel del Killer completo (35 casos) tras las correcciones,
  con hipotesis cuyo veredicto real sea avanzar, y un panel del revisor de
  registro con resumenes con errores plantados.
- El bucle de herramientas dentro de los pasos de novedad y factibilidad
  (hoy la novedad usa una secuencia fija de conectores; el ReAct solo
  responde a preguntas de personas).
- Kernels persistentes, R, notebooks y trabajos remotos: no se copian;
  revisar si el laboratorio los pide.

## Codigo (lo que queda del plan, seccion 4)

- Las cuatro condiciones de comparacion y los cinco niveles de prueba del
  plan completo (seccion 7); replay historico con evidencia fechada.
- Valor esperado de la informacion como desempate entre candidatas.
- Motor causal: consultas al modelo de mundo que devuelvan cantidad,
  supuestos, evidencia, metodo, incertidumbre y limites, o "sin resolver"
  (hoy el grafo es por hipotesis y las relaciones tipadas se ven; falta la
  consulta).
- Panel del Killer con hipotesis buenas y grises con veredicto humano (hoy
  las grises se generan recortando pasajes; falta la version juzgada por una
  persona) y con mas hipotesis cuyo veredicto real sea avanzar.
- Al fusionar comprobaciones, hoy la determinista manda: si el juez detecta
  una cifra alterada pero el veredicto guardado de la afirmacion es
  "sostenida", la deteccion del juez se pierde. Decidir si fidelidad y citas
  deben bajar a "no comprobable" cuando juez y determinista discrepan.

## Tambien

- Clasificar las citas de cada hecho del modelo de mundo en apoya, menciona,
  contrasta (campo `citas`, hoy vacio).
- Rotar en el panel de Convex la clave de despliegue que paso por el chat el
  14 de septiembre (y la anterior), y poner la nueva en `.env`. Despues,
  decidir si la interfaz lee del espejo cuando el servidor no responde.
- Las corridas anteriores a septiembre no tienen `arnes` ni `pregunta`.

## 29 de septiembre de 2026: el guion de tildes ya no corrompe, pero le queda un hueco

`scripts/acentuar_py.py` y `frontend/scripts/acentuar.py` decidían mal en cinco
clases de sitio (claves de diccionario, valores de clave de identificador, SQL en
minúsculas, inglés sin `the/of/and`, y cadenas que un test compara con `==`), y
además "corregían" el imperfecto de subjuntivo de los verbos en -ar al futuro.
Las 20 apariciones de ese último caso en el árbol eran TODAS subjuntivo correcto:
"que hoy dejara de estarlo", "si el NfL cambiara antes que el GFAP", "aunque solo
cambiara una línea". Arreglado: los dos guiones pasaron de 40 hallazgos falsos a
0, y `python3 frontend/scripts/acentuar.py --a-mano` lista las que decide una
persona.

Lo que queda sin resolver: los pares nombre/verbo. El diccionario mapea
`termino -> término`, `numero -> número`, `titulo -> título`, `calculo -> cálculo`
y una docena más, siempre al nombre. Cuando el texto quiere el verbo ("la corrida
termino", "se calculo el peso", "el juez numero las páginas") el guion escribe el
nombre. Hoy no hay ninguna apariencia sin tilde en el árbol, así que el fallo es
prospectivo: aparecerá la próxima vez que alguien escriba una de esas frases.

Se probó un detector por determinante delante (el/la/del/de/su... => nombre
seguro): 705 seguras y 245 a mirar, y de las 245 casi todas eran nombres en una
enumeración ("id, título, longitud del fragmento"). Precisión demasiado baja para
que alguien lea ese informe, así que no se metió. Lo que sí serviría: mirar la
palabra ANTERIOR y la SIGUIENTE con una tabla de sujetos del proyecto (corrida,
iteración, juez, ROSA2018, paso) delante del verbo, o etiquetar por categoría
gramatical con una librería, que es dependencia nueva para un guion de apoyo.

## 29 de septiembre de 2026: auditoría de bugs, ineficiencias y ROSA2018 como científica

Lo que se arregló está en los commits de esa madrugada. Aquí queda lo que se
midió y NO se tocó, con la cifra, para que se decida con datos.

### Lo más grande: 71 conectores que el bucle nunca considera

De los 87 conectores, se usan 16, siempre los mismos, y son los del perfil de
diana (HPA, UniProt, Reactome, STRING, GWAS Catalog, ClinVar, ChEMBL, DGIdb,
MyGene, Open Targets, GTEx, PubTator, GEO, CELLxGENE, Exa). 1.099 consultas en
total, 1 % de error.

Los otros 71 solo se alcanzan por el ReAct de `rosa/herramientas.py`, y esa
ruta únicamente corre cuando una PERSONA pregunta desde la interfaz
(`/api/investigaciones/{id}/preguntar`). El bucle autónomo nunca se plantea
consultar una base curada para resolver un supuesto o una comprobación, aunque
27 de las 34 hipótesis estén suspendidas y las razones que escribe el Killer
sean muchas veces preguntas que una base contesta.

Por qué no se hizo esta noche: meter el ReAct en el bucle es decidir cuándo,
para qué y con qué presupuesto, y eso cambia el coste y el comportamiento de
cada corrida. Es una decisión de Emir, no de un agente a las 2 de la mañana.

Lo barato y seguro que sí se puede hacer primero: `EvaluarSupuesto` recibe solo
el supuesto y las afirmaciones sostenidas de la literatura. NO recibe el perfil
de diana, que ROSA2018 ya tiene calculado y guardado para 29 de las 34
hipótesis (26 de las 27 suspendidas), con 654 tokens de expresión en tejido y
por tipo celular, función de la proteína, interactores, rutas, fármacos y
recuento de publicaciones. El propio docstring de la firma dice que "muchos
supuestos no se contestan leyendo artículos". Pasarle el perfil no cuesta
ninguna llamada de más.

### Por qué están suspendidas las 27

Comprobaciones que FALLAN: sesgo_evidencia 10, independencia_cohortes 7,
supuestos contradichos 6, identificadores_resuelven 1.
NO COMPROBABLES: factibilidad 19, novedad 15, contexto_humano 9,
fidelidad_evidencia 7, sesgo_evidencia 6, independencia_cohortes 5,
direccion_causal 4, redundancia 2, supuestos 1.

De esas, las que suspenden por no poder comprobarse son las de `CRITICAS`:
novedad (15) y fidelidad_evidencia (7). La factibilidad, aunque salga 19 veces,
reformula, no suspende.

Dentro de la novedad hay 97 comprobaciones en "no comprobado". 23 por un fallo
de red o de consulta y 74 por el marcador de fábrica "No comprobado todavía",
que quiere decir que el paso nunca llegó a esa clave. 25 hipótesis llevan
`genetica = no_comprobado` con el detalle "por comprobar otra vez: se sacó de
GWAS Catalog cuando el conector no filtraba por gen; arreglado el 25 de
septiembre de 2026": el conector se arregló y el veredicto viejo sigue puesto.
Esas 25 sí están en la cola de reintento (6 por iteración), así que se
resolverán solas si se deja correr una corrida.

### El reparto del tiempo de una corrida (CORREGIDO el mismo 29 de septiembre)

Lo que se escribió aquí de madrugada estaba mal. Se dijo que la corrida 42 tenía
47 min (18,5 %) sin ninguna llamada al modelo y se señaló el bucle en serie de las
fuentes como sospechoso principal. Esa cifra se midió desde la primera hasta la
última llamada con el identificador de la corrida, y eso incluye el relleno de
fondo que sigue DESPUÉS de que la corrida termine. El tablero del método
(rosa/metodo.py) reparte la pared dentro de la ventana real de la corrida y separa
cuatro cosas: 135 min de pared, 100 con el modelo trabajando, 20 esperando a una
persona, 10 con el servidor apagado (un reinicio) y 5 min de trabajo sin modelo:
un 4 %. No hay nada que paralelizar ahí.

Sobre las 26 corridas terminadas de la base, las antiguas pasaban del 23 al 76 %
del tiempo activo trabajando sin modelo y las tres más recientes están entre el 0
y el 11 %. Tres corridas antiguas salían con 15 a 63 horas "sin modelo": era el
servidor apagado con la corrida a medias (3.755 de 3.900 min en la peor).

El cronómetro de la literatura (`msBases`, `msFuentes`) sigue puesto: la próxima
corrida larga dirá si el bucle de fuentes pesa. Hasta entonces no se toca.

### `mlflow.db`

706 MB de datos muertos. No se borró nada: borrar datos sin que lo pida su
dueño no es una decisión de un agente.

### El guion de tildes

Ver la sección de arriba: quedan los pares nombre/verbo (termino/término/
terminó, numero/número/numeró) que el diccionario resuelve siempre al nombre.

## 29 de septiembre de 2026: lo que propone la revisión de papers (sin decidir)

Detalle, cifras y fuentes en `INVESTIGACION-PAPERS-AI-SCIENTIST-2026-09-29.md`.
Nada de esto está decidido ni empezado; va ordenado por lo que más desbloquea o
por el riesgo que cierra.

1. **GEPA optimiza contra el mismo juez que decide la promoción, y le lee las
   razones.** La métrica pasa el `feedback` de Opus al paso reflexivo
   (`rosa/gepa_continuo.py:583-602`) y el examen final lo corrige el mismo juez
   (`rosa/gepa_continuo.py:754`). Es la condición que en Huang y otros
   (arXiv:2609.28614) duplicó la evasión del revisor (40,5 % frente a 20,3 %).
   Propuesta: juez A para optimizar, juez B sellado más reglas más conjunto
   dorado humano para promover, y alarma si la distancia entre A y B crece. Lo
   mismo en pequeño con la `reformulacion_sugerida` del Killer
   (`rosa/bucle/pasos.py:3335`).
2. **Prueba de evidencia barajada** (Gupta y otros, EMNLP 2025): barajar las
   filas de evidencia entre hipótesis y ver si cambian las decisiones del bucle.
   Si no cambian, la acumulación es decorativa. Cuesta una corrida corta.
3. **Verificación por afirmación contra conectores dentro del Killer**
   (GeneAgent, Nat Methods 2025): cuando una comprobación queda "no
   comprobable", partir la hipótesis en afirmaciones y consultar la base que
   toca por tabla fija; nunca contra la fuente de la que salió. Ataca las 27
   suspendidas y los 71 conectores ociosos.
4. **Regla de ensayo nulo**: si un ensayo de fase 3 del mismo mecanismo salió
   nulo, la certeza queda topada y el dossier debe decir qué diferencia
   comprobable lo explica. Hoy ClinicalTrials.gov solo se usa para factibilidad
   (`rosa/viabilidad.py`) y como fuente (`rosa/comprobaciones.py:159`).
5. **Batería axiomática para `paso_novedad`** (`rosa/bucle/pasos.py:4470`;
   Liu y Zhai, arXiv:2604.15145) y el grafo causal como primer filtro de
   novedad por combinación.
6. **Skill de inversión de firma por tipo celular** sobre SEA-AD (Cell 2025,
   Li y Sirota). El conector LINCS está inerte por cuenta
   (`rosa/conectores/bases2.py:442`), pero L1000 está en GEO (GSE92742,
   GSE70138).
7. **Controles de ruido para el análisis**: correr el paso que escribe el plan
   sobre unas 20 copias barajadas del dataset antes de congelar (arXiv:2604.11003)
   y exigir al menos 3 implementaciones independientes que coincidan en signo
   (arXiv:2607.26587).
8. **Cambiar la prueba retrospectiva con fecha de corte por predicciones
   prospectivas selladas** con `rosa/sello.py`: Astra y Opus ya leyeron lo
   posterior a cualquier corte histórico. Si se hace retrospectiva, con cuatro
   líneas base obligatorias y THBKG (arXiv:2608.05982) como conjunto externo.
9. **Presentar el Elo como opinión del juez, no como calidad** (Si y otros,
   arXiv:2506.20803: tras ejecutar las ideas, el ranking se da la vuelta).

## 29 de septiembre de 2026: siglas clínicas resueltas como genes

Medido sobre el estado (solo lectura), al contar qué entidades reúne todo el
conocimiento de ROSA2018 para la sección molecular. Entre las quince más
frecuentes hay dos genes falsos, con 22 hechos cada uno:

- "ARIA" (anomalías de imagen asociadas al amiloide, el efecto adverso de
  lecanemab) se resolvió como el gen ECSCR (HGNC:35454), que tiene ARIA de alias.
- "ADAS" (la escala ADAS-Cog) se resolvió como el gen AGPS (HGNC:327).

La causa está en `gen_hgnc` (`rosa/ontologias.py:99`): acepta `alias_symbol` y
`prev_symbol` de HGNC sin una lista de siglas clínicas del dominio que no son
genes (ARIA, ADAS, CDR, MMSE, MCI, PET...). Arreglo propuesto: esa lista de
exclusión y, cuando el gen se resuelve por alias y no por símbolo aprobado,
exigir contexto de gen o proteína en el fragmento. Después, volver a normalizar
las entidades de los hechos afectados. Importa para la sección molecular y para
las pistas de redundancia entre hipótesis, que se calculan con estas entidades.

## Git bloqueado por la licencia de Xcode (29 de septiembre de 2026)

`git` en esta máquina es `/usr/bin/git`, el de las herramientas de línea de
comandos de Xcode, y devuelve "You have not agreed to the Xcode license
agreements" en cualquier orden, incluido `git status`. Con eso quedan sin poder
correr, además del commit:

- `python3 scripts/escanear_secretos.py` (usa `git ls-files -z`).
- Cualquier `git add` / `git commit` / `git push`.

Lo desbloquea `sudo xcodebuild -license` en un terminal, aceptando la licencia.
Hasta entonces el trabajo de la sección de laboratorio está en el árbol sin
commitear. Lo demás de la verificación sí corrió y pasó: 2192 tests de backend,
1066 de frontend, ruff limpio, trinquete de mypy en 263 (el límite), acentos
limpios en los dos lados y `tsc --noEmit` sin errores.

Nota aparte: `python3` también es el de Xcode y falla igual; los scripts hay que
correrlos con `./.venv/bin/python`.

## El selector de estilo de la lámina quedó fuera (29 de septiembre de 2026)

`frontend/src/lib/visorMolecular.ts` sigue sirviendo los tres estilos
(`ilustrativa`, `cinta`, `superficie`) y `Visor.estilo()` funciona, pero la
pantalla ya no los ofrece: los seis botones hacían el mando el doble de alto que
el del boceto aprobado y se comían la mitad de la hoja de pedido. Si se quieren
de vuelta, el sitio es un desplegable en el propio mando, no seis botones.

## «Al laboratorio» es global, no de una investigación (29 de septiembre de 2026)

Se construyó dos veces mal antes de quedar bien, y queda escrito para que no
vuelva a pasar. La sección NO es la vista de una hipótesis ni la de una
investigación: es la unión de todo lo que ROSA2018 tiene verificado, de todas
sus investigaciones, en un solo sitio.

- Ruta: `GET /api/laboratorio` (sin identificador) y `#/laboratorio` en la
  interfaz, con `#/laboratorio/<uniprot>` para enlazar una diana. Los enlaces
  viejos a `#/investigaciones/<id>/laboratorio` redirigen.
- Las dianas salen de `hechos[].entidades` (el modelo de mundo, que ya trae
  HGNC, UniProt y Ensembl resueltos) más el `perfilDiana` de las hipótesis, no
  solo de este último. Con datos reales: 17 dianas en vez de 5.
- Los compuestos salen de `entidades[tipo=compuesto]` (CHEBI), no de una regex
  sobre los textos de intervención. PubChem enriquece, no decide: un anticuerpo
  como el lecanemab lo nombran 115 afirmaciones y nunca tendrá ficha de
  molécula pequeña.

Lo que sigue pendiente aquí: el grafo causal solo tiene 46 relaciones y la
mayoría de las dianas salen sin ninguna flecha. Cuando `rosa/causal.py` crezca,
la lámina las enseñará sin tocar nada.

## Los genes falsos por alias se esquivan en el laboratorio, no se arreglan

`rosa/laboratorio.py` exige que el UniProt de una diana se alcance por SÍMBOLO
APROBADO (`entidadesCache[...].resueltoPor == "symbol"`) antes de enseñarla. Sin
eso el muro se llena de proteínas que nadie mencionó: la escala ADAS-Cog entra
como AGPS, la anomalía de imagen ARIA como ECSCR, los trazadores FDG y F18 como
SMUG1 y MAMLD1, GLP como GOLGA6A, CD146 como MCAM. Son 13 en la investigación
del amiloide y la tau.

Eso es un parche local: el fallo está en la normalización de entidades, que
resuelve por alias sin pedir contexto de gen, y ya estaba escrito más arriba en
este fichero. Mientras no se arregle, cualquier sección nueva que lea
`hechos[].entidades` tiene que aplicar el mismo filtro
(`LAB.uniprot_por_simbolo_aprobado`) o enseñará lo mismo.

Casos que el filtro NO coge, por si aparecen: MB (mioglobina, viene de
«MB-2-VHL2») y CPAP (la proteína existe, pero el texto hablaba del aparato).
Los dos tienen una sola mención y los descarta el umbral de dos hechos.

## TREM2 está cacheado en negativo (29 de septiembre de 2026)

`entidadesCache["gen:TREM2"]` vale `null`, así que TREM2 no tiene UniProt aunque
sus entidades en los hechos traigan `HGNC:17761` y lo nombren 18 afirmaciones.
Es uno de los genes de riesgo de Alzheimer mejor establecidos y ahora mismo no
puede enseñar estructura. La sección lo dice en «nombradas y sin estructura que
traer» en vez de callarlo, pero el arreglo de verdad es volver a resolverlo y
limpiar las entradas negativas del caché que sí son genes.

## El zoom y el giro de Mol* comparten bandera (29 de septiembre de 2026)

Trampa para quien toque `frontend/src/lib/visorMolecular.ts`: la inercia al
soltar el ratón parece que se enciende con `trackball.staticMoving = false`,
pero esa bandera vale a la vez para el giro, el zoom y el encuadre
(`mol-canvas3d/controls/trackball.js`). Con ella apagada, el zoom deja de
aplicarse una vez por muesca y pasa a aplicarse en CADA fotograma mientras el
rozamiento frena: con `dynamicDampingFactor` 0,06 eso multiplica una muesca por
unas cincuenta y el zoom se vuelve inusable.

Por eso el zoom se queda crudo (`zoomSpeed` 2,6 en vez de los 7 de fábrica, que
con una proteína de mil residuos salta de la lámina al detalle en dos muescas) y
el lanzamiento lo hace la pantalla: mide la velocidad del arrastre en sus
últimos milisegundos y llama a `Visor.orbitar` con una velocidad que decae.

Sin resolver: el zoom no se puede medir en Playwright. Ni `mouse.wheel` ni un
`WheelEvent` sintético llegan al observador de entrada de Mol*, así que el nivel
del zoom semántico no cambia en las capturas y la sensibilidad hay que juzgarla
a mano. Los tres niveles sí se pueden probar pulsando los botones del mando
(`.capturas/tapa.mjs`).

## 29 de septiembre de 2026: auditoría de «Al laboratorio» (lo que no anotó quien la construye)

Medido sobre el estado real (solo lectura) y el árbol de trabajo de esa tarde,
con la sección todavía sin commitear. Los tests pasan (21 de backend y 15 de
frontend), pero ninguno cubre esto. Lo de TREM2 y los genes falsos por alias ya
está anotado más arriba; aquí va el resto, por lo que más pesa.

Lo que no funciona o dice algo falso:

1. **El muro enseña primero lo que no se puede mandar.** Ordena por número de
   menciones (`rosa/laboratorio.py:412`): tau, GFAP, NfL, APOE y APP arriba. De
   esas cinco, cuatro llevan la hoja con «qué se hace» y «sistema» vacíos,
   porque sus hipótesis son de biomarcadores en sangre y no de laboratorio. 23
   de las 29 hipótesis enlazadas no tienen sistema experimental, y 9 de las 17
   dianas ninguna hipótesis. Las tres que sí traen un experimento (SULF2, TFEB,
   NDST3) salen las últimas, con 0 afirmaciones. Es la trampa de la frecuencia.
2. **Nunca se usa el PDB, aunque el pie diga que sí.** `rosa/laboratorio.py:381`
   pone siempre AlphaFold con clase «predicha». La tarjeta grande del muro es
   tau, cuyo modelo tiene un 7,5 % de confianza alta y un 65,6 % muy baja,
   mientras el PDB tiene 308 estructuras medidas de tau (con los filamentos de
   cerebro con Alzheimer), 431 de BACE1 (con inhibidores unidos) y 265 de APP.
   El conector `pdb_estructuras` existe y no se llama.
3. **El texto sobre TREM2 es falso.** `rosa/laboratorio.py:348` y
   `frontend/src/pantallas/Laboratorio.tsx:1409` dicen «sin acceso de UniProt,
   no hay estructura que traer»; TREM2 es Q9NZC2 y tiene estructura. Lo cierto
   es «no pude resolver su UniProt».
4. **La hoja de SULF2 se contradice.** «Qué se hace» sale de la tarjeta
   («expresión inducible de SULF2 en neuronas», un experimento de laboratorio)
   y «sistema» del contrato, que es «datos públicos existentes» con la actividad
   «extracción crítica de resultados agregados publicados, no generación de
   muestras» (`rosa/laboratorio.py:586-607`).
5. **Las marcas de UniProt están hechas a la medida de SULF2.** `QUE_MARCAR`
   (`Laboratorio.tsx:31-39`) solo reconoce regiones «Catalytic», «Hydrophilic»
   y «Disordered»; en tau ignora el «Microtubule-binding domain», que es donde
   agrega, y solo marca un tramo desordenado.
6. **La química es ruido.** Por coaparición en la misma frase
   (`rosa/laboratorio.py:229-245`), 11 de las 14 dianas con evidencia llevan
   «amyloid-beta» y lecanemab como su química. Los tres «compuestos» de la
   sección son el péptido de la enfermedad, un anticuerpo y la semaglutida (un
   péptido de 4 kDa que no cruza al cerebro): ninguna molécula pequeña pedible.
7. **Un fallo de PubChem queda guardado para siempre como «no existe».**
   `_compuestos_que_faltan` (`rosa/bucle/corrida.py:765`) mete en `ya` también
   los no encontrados, así que un tiempo agotado no se reintenta nunca, y la
   pantalla (`Laboratorio.tsx:1425-1428`) lo presenta como «PubChem no lo
   reconoce». Además `corrida.py:779` se queda con el primer resultado cuando
   PubChem devuelve varios.
8. **Sin freno de certeza.** Detrás de las dianas hay 26 hipótesis que el
   Killer suspende, 2 que propone descartar y 1 que avanza, todas en certeza
   muy baja o baja, bajo el título «Lo que ROSA2018 mandaría al laboratorio»
   (`Laboratorio.tsx:1309`). Nada dice «todavía no se manda».

Ineficiencias:

9. **Cada visita copia el estado entero bajo el candado.** `rosa/servidor.py:540`
   hace `copy.deepcopy` de 37 MB: 0,53 s con las escrituras bloqueadas, para un
   cálculo que tarda 0,01 s. Basta calcular bajo el candado o copiar solo
   `hechos`, `hipotesis`, `relaciones`, `entidadesCache` e `investigaciones`.
10. **La lámina se vuelve a renderizar en cada fotograma mientras gira.**
    `reproyectar` llama a `fijarPuestos(nuevos)` sin comparar
    (`Laboratorio.tsx:759`), y `proyectar` pide `getBoundingClientRect` por cada
    marca en cada fotograma (`frontend/src/lib/visorMolecular.ts:242`). Con el
    giro en reposo a los 3 s, sigue así mientras alguien lee el protocolo.
11. **Cada tarjeta del muro es un Mol* completo girando sin parar**, con
    oclusión ambiental y contorno (`Laboratorio.tsx:1474-1482`). Con el margen
    de 300 px hay varias a la vez, y al desplazarse se destruyen y se vuelven a
    montar. Para miniaturas bastaría una imagen fija; en vivo, solo la grande.
12. **402 KB por visita**: van todos los protocolos enteros de todas las
    hipótesis de todas las dianas (GFAP sola, 172 KB) aunque el muro solo
    enseña un resumen.
13. Menor: en `Miniatura` el fallo no se reinicia (`Laboratorio.tsx:1487` y
    `:1504`); si una carga falla una vez, la tarjeta dice «no pude traer la
    estructura» aunque luego cargue.

## Las pruebas de tiempo del frontend caen con la máquina cargada

`npx vitest run` reparte 104 ficheros entre varios procesos, y las pruebas que
miden tiempo caen de forma intermitente cuando la máquina está ocupada: el paso
de fuerzas del árbol («menos de 8 ms por paso»), el montaje de MapaEnfermedad
(«en un tiempo razonable») y las esperas de `App.cliente.test.tsx`. Cada
ejecución cae en un sitio distinto y todas pasan al correrlas solas.

Para saber si una caída es real: `npx vitest run --no-file-parallelism`. Así la
suite entera pasa (104 ficheros, 1.072 pruebas, 29 de septiembre de 2026), y
tarda 135 s en vez de 20. Si con eso también cae, entonces sí es el código.

Lo que convendría: que esas tres pruebas midan trabajo (pasos por unidad de
trabajo, o comparación contra una referencia medida en la misma ejecución) en
vez de milisegundos de reloj, que dependen de lo que esté haciendo el portátil.

## Revisión de «Al laboratorio»: lo arreglado y lo que queda (29 de septiembre)

Una revisión externa encontró once cosas. Se comprobaron todas contra los
datos reales y todas eran ciertas. Arreglado:

- **El orden ponía arriba lo que no se puede mandar.** Se ordenaba por cuánta
  evidencia nombra a cada proteína, así que salían primero las cuatro de
  biomarcador en sangre con la hoja en blanco, y la única con un experimento
  de banco propuesto (TFEB) quedaba en el puesto 17 de 17. Ahora manda si se
  puede mandar y la cabecera dice cuántas son (una de diecisiete).
- **«TREM2 no tiene acceso de UniProt» era falso**: es Q9NZC2. Quien no lo
  resolvió fue ROSA2018.
- **El pie decía que se usaba el PDB y no se usaba nunca.** Ahora el bucle
  cuenta las estructuras medidas de cada diana (tau tiene 308) y la lámina lo
  dice y enlaza. Lo que se DIBUJA sigue siendo el modelo predicho, que es el
  único de longitud completa; ROSA2018 no elige una medida porque casi todas
  son fragmentos.
- **La hoja se contradecía**: la tarjeta de SULF2 dice «expresión inducible en
  neuronas» y su contrato dice que lo que se hace es revisar literatura. Ahora
  se avisa en la propia hoja.
- **Las zonas marcadas se eligieron mirando SULF2** y no pedían `ft_repeat`,
  así que en tau se ignoraban las cuatro repeticiones de unión a microtúbulos
  (561-685), que es justo donde se agrega. Añadidas, con Motif y Site.
- **Un PubChem que no responde se guardaba como «no existe» para siempre.**
  Ahora se distingue no encontrado de no comprobado y lo segundo se reintenta.
- **El servidor copiaba el estado entero (37 MB) en cada visita**: 0,25 s de
  bloqueo de escritura para un cálculo de 0,004. El cálculo se hace dentro del
  cerrojo sin copiar; la respuesta bajó de 244 ms a 8.
- **La respuesta pesaba 405 KB** con todos los protocolos, que el muro no
  enseña (GFAP sola, 186 KB). Ahora son 163 KB y el contrato se pide aparte en
  `/api/laboratorio/{uniprot}/experimentos`.
- **Las miniaturas eran diecisiete visores 3D girando a la vez** con oclusión
  ambiental. Ya no giran.
- **La proteína giraba mientras se lee** un protocolo de diez pasos. Con un
  panel abierto no gira.

Queda sin resolver:

- **La química es coaparición, y con eso no basta.** Se relaciona una proteína
  con un compuesto si salen en la misma afirmación, y por eso once de catorce
  llevan «beta-amiloide» y lecanemab. Los tres compuestos de la sección son el
  péptido de la enfermedad, un anticuerpo y la semaglutida: ninguna molécula
  pequeña que se pueda pedir. La pantalla dice que es coaparición y no
  afinidad, pero decirlo no lo hace útil. Lo que haría falta es sacar los
  compuestos de las INTERVENCIONES de las hipótesis (lo que ROSA2018 propone
  usar) y dejar la coaparición como contexto, o cruzar con ChEMBL por diana
  para traer ligandos de verdad.
- **Ninguna estructura medida se llega a dibujar.** Elegir bien exige saber
  qué tramo cubre cada entrada del PDB y con qué resolución; el conector
  actual solo da identificadores. Con esos metadatos se podría ofrecer la
  medida cuando cubra la parte que interesa.

## Oligonucleótidos antisentido: lo hecho y lo que falta (29 de septiembre)

`rosa/aso.py` diseña gapmers 5-10-5 de 2'-MOE sobre el transcrito canónico de
cada diana del muro. Es lo ÚNICO que ROSA2018 diseña de verdad, y funciona
porque se calcula desde la secuencia (pública y exacta) y no hace falta
predecir ninguna forma. La secuencia la trae el conector `ensembl_transcrito`
y la guarda el bucle en `estado["secuencias"]`; el cDNA no viaja al navegador.

Contexto de por qué importa: diranersen (BIIB080, Ionis y Biogen), un gapmer
contra el ARN de MAPT por vía intratecal, redujo la patología tau en PET y el
declive cognitivo en la fase 2 CELIA (mayo de 2026). MAPT es además la diana
más nombrada por la evidencia de ROSA2018.

**Lo que falta, y es lo que impide pedir nada:**

- **El cribado de off-target.** Sin alinear cada candidato contra el
  transcriptoma no se puede pedir, y ahora mismo TODOS salen sin cribar (se
  dice en el propio candidato, no solo en la pantalla). Hace falta BLAST
  contra RefSeq, y no solo contra el ARN maduro: el corte promiscuo de
  pre-ARN largos es el mecanismo conocido de hepatotoxicidad de los gapmers
  de alta afinidad (Burel et al., Nucleic Acids Res 44:2093, 2016). La API
  de BLAST del NCBI es asíncrona (se manda, devuelve un RID y se sondea), así
  que necesita un trabajador de fondo con el RID persistido entre tics, no una
  llamada más dentro de `_secuencias_que_faltan`.
- **La fase 2 que Emir eligió: ASO de corte alternativo.** La infraestructura
  de secuencia y de cribado se reutiliza entera; lo que hace falta encima son
  las coordenadas de exón y los sitios de corte (Ensembl los da) para poder
  bloquear un sitio aceptor y desplazar, por ejemplo, el equilibrio 4R/3R de
  tau en vez de bajarla toda.
- **La accesibilidad del sitio.** Las herramientas comerciales predicen la
  estructura secundaria local del ARN para no elegir una ventana que está
  plegada sobre sí misma. No está hecho.

Y una nota de honestidad que hay que conservar en la pantalla: los filtros son
estadística de experimentos pasados, no una predicción. Una patente de Ionis
describe sintetizar 156 oligonucleótidos para llevar unos pocos a dosis; la
propia QIAGEN dice de su herramienta que es en parte empírica. Lo que ROSA2018
produce es una lista corta para cribar.

## El diseño de ASO se calcula en el bucle, nunca al pintar (29 de septiembre)

Se metió y se arregló el mismo día, y queda escrito porque es fácil repetirlo:
al enchufar `rosa/aso.py` a `/api/laboratorio`, la respuesta pasó de 13 ms a
**27,9 segundos**. Dos causas, las dos mías:

1. `diseño()` recorría el transcrito DOS veces: una en `candidatos()` para
   elegir y otra solo para contar cuántas ventanas pasaban los filtros. Ahora
   `_escanear()` lo recorre una vez y devuelve las dos cosas.
2. Aun con un solo recorrido eran 2,2 s por visita con las diecisiete dianas,
   porque se recalculaba en cada petición. Ahora el diseño lo calcula el bucle
   cuando llega la secuencia y se guarda en `estado["secuencias"][uniprot]
   ["diseño"]`; la petición solo lee.

De paso, el cDNA ya no se guarda: son casi siete mil nucleótidos por diana en
un estado que se copia y se sirve entero, y una vez calculado el diseño no
hace falta.

Regla general para esta sección: **cualquier cosa que recorra una secuencia o
llame a una fuente va al bucle**, no a la ruta. La ruta solo lee y arma.

Pendiente menor: la respuesta creció de 163 a 250 KB al añadir los diseños
(ocho candidatos por diana, cada uno con su secuencia, su diana y sus
medidas). Si molesta, el mismo truco que con los protocolos: mandar solo el
primer candidato en el muro y los ocho al abrir el panel.

## La dirección es una PUERTA, no un término (30 de septiembre de 2026)

Un oligonucleótido antisentido solo sabe hacer una cosa: BAJAR la proteína.
Ofrecerlo donde la evidencia pide subirla es proponer lo contrario de lo que
concluyó la propia investigación. La sección lo hacía: enseñaba ocho oligos
para apagar APP y SULF2 cuando sus hipótesis piden AUMENTARLAS. Cada secuencia
estaba bien diseñada y la propuesta estaba al revés.

Lo arregla `LAB.direccion_de`, que lee `hipotesis[].tarjeta.direccion`
(`disminuye`, `aumenta`, `modula`, `sin_intervencion`). De 17 dianas, solo 3
pasan: MAPT, GFAP y NDST3. Once son biomarcadores que ninguna hipótesis
propone tocar, y eso también se dice.

Cualquier modalidad que se añada después (ARN de interferencia, degradadores,
activadores) tiene que declarar su dirección y pasar por la misma puerta.

## La decisión única, y un término que estaba hinchado

`LAB.oligo_que_mandaria` elige UNA diana de todas y enseña cada término de la
cuenta. No existe un oligonucleótido general que las apague todas —empareja
bases con UNA secuencia— así que lo que se reúne de toda la investigación es
la decisión, no la molécula.

Sale GFAP (13,3) por delante de MAPT (12,8), aunque MAPT tenga cuatro veces
más evidencia: GFAP es la única cuya hipótesis llegó a «avanzar» en el Killer.
La pantalla dice esa diferencia y dónde está, para que se pueda discutir.

Un término estaba mal y se corrigió al comprobarlo: «investigaciones que
convergen» contaba las que nombran la diana en una hipótesis SIN aportar ni un
hecho. GFAP figuraba en seis y dos tenían cero hechos, lo que le regalaba 1,2
puntos de convergencia inexistente. Ahora solo cuentan las que aportan
evidencia.

## MANE Select: que la proteína y el ARN sean la misma versión

La pantalla dibuja una proteína (de UniProt, vía AlphaFold) y diseña sobre un
ARN (de Ensembl). Son ramas distintas de la MISMA entidad del modelo de mundo
(HGNC -> UniProt y HGNC -> Ensembl), pero eso no garantiza que sean la misma
isoforma, y un desajuste ahí sería un fallo silencioso.

MANE Select lo certifica: es el transcrito que el NCBI y el EMBL-EBI acuerdan
como representativo, emparejado con la proteína canónica de UniProt. El
conector `ensembl_transcrito` lo consulta y la pantalla lo dice.

Siete de ocho comprobadas coinciden. **MAPT no tiene MANE Select**, y no es un
fallo: es que no hay acuerdo sobre cuál es la versión representativa de tau,
que es exactamente la pregunta abierta de las isoformas 4R y 3R. Cuando falta,
se dice «no se puede confirmar», nunca «no coinciden».

## Sesenta candidatos, no ocho

Ocho era el número equivocado: el protocolo de Ionis describe probar unos
ochenta en células para quedarse con ocho o diez, y esos ocho o diez son el
RESULTADO del cribado, no la entrada. Ahora se diseñan 60 con separación
adaptada al largo del transcrito (con 60 fijos, en un transcrito de 2.300 nt
salían muchos menos de los pedidos). El muro trae ocho y el resto se pide en
`/api/laboratorio/{uniprot}/oligos`.

## La vía intratecal va en la hoja

Los ASO no cruzan la barrera hematoencefálica: son grandes y muy cargados. Para
una diana del sistema nervioso central eso no es un detalle de la hoja, es la
diferencia entre un experimento posible y uno imposible. La hoja dice la vía
(punción lumbar), por qué, el precedente (nusinersén, diranersen) y su límite
conocido (menos fármaco en las regiones profundas del cerebro).

## El oligo SUMA en la priorización, nunca es una puerta (30 de septiembre)

Regla acordada con el compañero de Emir. Las investigaciones y el proceso de
ROSA2018 siguen igual. Lo único que cambia: una hipótesis que además trae un
oligonucleótido antisentido diseñado **se valora más**; no tenerlo **no
penaliza ni aparta a nadie**.

Está en `PR.aso_de` y en el orden de `PR.candidatos`: un plus de 40 sobre la
fuerza (la escala de Elo va hoy de 1.399 a 1.644, así que mueve unos puestos
sin decidir nada). Se anota en `hipotesis[].aso` para que la interfaz pueda
enseñar por qué una subió: un número que mueve el orden y no se explica es un
número mágico.

Por qué suma y no filtra: un ASO solo sabe BAJAR una proteína. Si «poder
fabricarlo» fuera un requisito, ROSA derivaría hacia preguntas del tipo «hay
demasiado de esto» y dejaría de hacer las del tipo «esto falta» o «esto es
protector», que en Alzheimer son una parte grande del problema. Hoy ya se ve:
de 17 dianas, 2 piden SUBIR la proteína.

Cualquier modalidad que se añada después (ARN de interferencia, degradadores,
activadores) entra igual: como plus, no como puerta.

## La decisión mezclaba hipótesis distintas (arreglado el mismo día)

`_terminos` tomaba el mejor Killer y la mejor certeza de CUALQUIER hipótesis de
la diana. En GFAP eso sumaba +3,0 por un «avanzar» que venía de una hipótesis
de biomarcador que no propone intervenir, mientras la única que pide bajarla
está suspendida y en certeza muy baja. Dibujaba una diana más sólida de lo que
ninguna hipótesis sostiene.

Ahora esos dos términos salen SOLO de las hipótesis con `direccion` de
`disminuye`, que son las que un oligonucleótido pondría a prueba. Con eso la
elegida pasa de GFAP (13,3) a MAPT (12,8), que además es la diana de
diranersen.

Regla general: **un término que justifica una decisión tiene que venir de la
misma hipótesis que la sostiene.** Coger lo mejor de cada una es construir una
hipótesis que nadie escribió.

## Lo que un ASO hace y lo que no, dicho en la pantalla

Se decía «el oligonucleótido que la apagaría». Apagar suena a retirar lo que
hay, y no es eso: corta la PRODUCCIÓN y la proteína ya fabricada se queda hasta
que la célula la degrade. Ahora dice «cortarían su producción», y el panel lleva
`QUE_HACE` con lo que no hace, el matiz (los agregados no son un depósito
muerto: cortar el suministro inclina la balanza) y el dato que lo sostiene (la
señal de PET de tau bajó por debajo del inicio en la fase 1b del BIIB080), con
sus dos avisos: dieciséis personas en la dosis alta y el PET de tau no es una
medida perfecta de ovillos.

Y junto a cada oligo va `tarjeta.etapa` de la hipótesis que lo respalda, que en
MAPT dice «modelo celular con inclusiones de tau ya establecidas». Importa
justo por lo anterior.

## Una lectura estaba destruyendo datos (30 de septiembre de 2026)

El fallo más feo de la sesión, y encadenado a una optimización mía.

`aligerar()` recorta la lista de candidatos de oligo a ocho para el muro. Pero
`d["aso"]` se asignaba con la referencia VIVA del estado
(`guardada.get("diseño")`), así que el recorte se comía el diseño guardado:
una sola visita a `/api/laboratorio` dejaba en ocho los sesenta candidatos, y
el almacén lo persistía. Dos dianas llegaron a la base de datos con ocho.

Se detectó porque la misma llamada devolvía 60 la primera vez y 8 la segunda.

Viene de quitar el `deepcopy` del estado para bajar la respuesta de 250 ms a 8.
Aquella optimización era correcta —el cálculo dura 4 ms y se puede hacer dentro
del cerrojo— pero dejó de existir la copia que protegía al estado de lo que la
ruta hiciera después. **Sin copia, todo lo que la ruta modifique hay que
copiarlo a mano antes.** Hay un test que lo fija
(`test_servir_la_pantalla_no_puede_destruir_el_diseño_guardado`).

## Marcador de versión en el diseño, no heurísticas

Para saber si hay que rehacer el diseño de una diana se miraba el número de
candidatos guardados (`< 9`). Eso rehacía para siempre, en cada tic, los
transcritos cortos que dan ocho de verdad. Ahora `rosa/aso.py` lleva `VERSION`
y el bucle rehace cuando la guardada es anterior. Al cambiar las reglas de
diseño hay que subir `VERSION`.

## La tarjeta principal del muro

Ocupaba dos filas, y tenía sentido cuando las pequeñas eran cortas. Con la
evidencia, el Killer, si se puede mandar y el oligonucleótido, cada tarjeta
pequeña pasa de 500 px, así que la principal se estiraba a 1.053 con medio
cuadro vacío. Ahora ocupa dos columnas y una fila.

De paso: al partir la tarjeta en dos botones (proteína y oligonucleótido) se
rompió la cadena de `flex` y el lienzo se quedaba en su mínimo. El botón de
abrir tiene que ser también columna flexible.

Y el margen del IntersectionObserver de las miniaturas pasó de 300 a 900 px:
con 300, bajar una pantalla destruía y rehacía medio muro y se quedaba en
«trayendo la estructura». Con 900 quedan vivos unos ocho contextos WebGL, por
debajo del tope del navegador.

## El cribado contra el transcriptoma ya no es una promesa (30 sep 2026)

Hasta hoy `rosa/aso.py` marcaba TODOS los candidatos como «sin cribar» y su
cabecera decía que alinear contra el transcriptoma era BLAST y minutos por
candidato. Con el servicio de NCBI es verdad: es asíncrono y hay que encolar.
Pero el transcriptoma humano entero se descarga de Ensembl sin clave y ocupa
225 MB (cDNA 184 MB + ncRNA 41 MB), y buscar en él una cadena de veinte letras
es `bytes.find`. Medido: los 787 candidatos de las 17 dianas contra los 669.547
transcritos en 350 s con cuatro procesos. Está en `rosa/criba.py`.

Resultado real: **13 de 787 descartados** por encajar idéntico en otro gen.
Tres modos de fallo, todos conocidos en el diseño de ASO:
- **elementos Alu** (~1 millón de copias en el genoma, muy frecuentes en las
  regiones 3' no traducidas, que es justo donde el diseño busca porque ahí la
  actividad es mayor). El peor, en ATM, cae en 6.299 transcritos de 1.263
  genes;
- **repetidos** CAG y CTG (GFAP, TFEB);
- **parálogos**: el candidato 2 de NDST3 cae en NDST4. Ese no es artefacto de
  repetidos, es un fuera de diana biológico.

### El fallo que casi se cuela: «otro gen» no es «otro nombre»

La primera versión contaba por `gene_symbol` y daba **51** descartados, con
PSEN2 en 38 de 39 (97 %). Era mío, no biología: PSEN2 comparte su locus con
ENSG00000288674, que Ensembl anota como «Novel protein» y todavía no ha
nombrado. Ahora se compara por SITIO del cromosoma (la cabecera FASTA trae
`chromosome:GRCh38:1:226870616:226896098:1`) y un ARN anotado encima del mismo
tramo se cuenta aparte, como «mismo sitio, otro nombre». Los descartados
bajaron de 51 a 13 y los tres modos de fallo de arriba siguen saliendo.

### Lo que este cribado NO cubre, y viaja con el resultado a la pantalla

1. **Solo coincidencia exacta.** Con uno o dos fallos el oligo encaja igual y
   la RNasa H1 corta igual. Hace falta un alineador tolerante a desajustes
   (bowtie2 o blastn, instalables con brew; ninguno está). Por eso el veredicto
   es «sin choque exacto» y nunca «seguro».
2. **Solo ARN maduro.** Ensembl da el transcrito empalmado. El corte promiscuo
   sobre el borrador largo con sus intrones es el mecanismo conocido de
   hepatotoxicidad de los gapmers de alta afinidad (Burel et al., Nucleic Acids
   Res 44:2093, 2016). Pide el genoma con su anotación, no el transcriptoma:
   son ~880 MB y hay que mirar las dos hebras, del orden de 18 minutos.
3. **Una referencia, no todas las personas.** Una variante común en el sitio
   diana haría que el oligo no pegara en parte de la población. ROSA2018 tiene
   conectores de variantes y aquí no se usan.

Pendiente, por orden: el cribado tolerante a desajustes (1), luego el de
pre-ARN (2), luego la comprobación de variantes (3).

### Dos cosas de ingeniería que no son obvias

- Va en **procesos hijos**, no en hilos: `bytes.find` no suelta el GIL, así que
  en un hilo los 350 s colgarían el servidor entero.
- Se dispara por **huella** del conjunto de secuencias, no por contar. Contar
  ya obligó una vez a rehacer en cada tic lo que estaba hecho (ver más arriba).

### El cribado es la segunda puerta de la decisión

`oligo_que_mandaria` cogía el candidato número uno. `criba.pegar` reordena y
manda los descartados al final, y la decisión excluye la diana cuyo mejor
candidato choca. Sin eso ROSA2018 podía estar mandando el oligo de ATM que baja
de paso otros 1.263 ARN. «Sin cribar» sí compite, marcado: no poder comprobar
no es un no.

### El fichero no está en el repositorio

`datos/` está en `.gitignore`, así que los 225 MB no se versionan. Quien monte
ROSA2018 en otra máquina tiene que descargarlos; las URL están en
`rosa/criba.py` (`DE_DONDE`) y sin ellos la pantalla dice «sin cribar» con el
motivo, nunca «limpio». Falta un botón que los traiga: la persona usuaria no
abre la terminal.

## El cribado con fallos, y el azar medido (1 oct 2026)

Con BLAST instalado (binario aarch64 de NCBI en `datos/_herramientas/`, que no
se versiona) el cribado deja de ser solo coincidencia exacta. El índice se
construye en 45 s y pasar los 823 candidatos cuesta 157 s, frente a los 408 s
del barrido exacto y los minutos POR candidato que cuesta encolar en el
servicio del NCBI.

**Validación cruzada**: BLAST encuentra los MISMOS 13 choques exactos que el
barrido de `bytes.find`. Dos implementaciones independientes, mismo resultado.

### Tres cosas que había que medir, no suponer

1. **BLAST busca en las dos hebras y solo una existe.** La hebra de atrás de un
   transcrito no es un ARN de la célula. Sin `-strand plus` salían 97 choques
   exactos donde hay 13.
2. **`word_size` 7 pierde los encajes de 3 fallos.** Con m fallos el trozo
   idéntico más largo puede ser `ceil((20-m)/(m+1))`: 10 para m=1, 6 para m=2,
   5 para m=3. Comprobado mutando 3 letras del sitio de MAPT: con 7 no
   encuentra MAPT, con 6 y con 5 encuentra sus 43 transcritos. Se usa 6, que
   garantiza el rango que decide (hasta 2 fallos). Con 5 el barrido tarda 13
   minutos y da 7 MB de ruido.
3. **El azar se midió.** La cuenta teórica decía 2,3 encajes esperados por
   candidato a dos fallos, y era falsa porque el transcriptoma no son 1.480
   millones de letras DISTINTAS (los transcritos de un gen se solapan). Se
   pasaron 300 secuencias de veinte letras AL AZAR por la misma tubería:

   | peor encaje ajeno con el hueco perfecto | al azar | candidatos reales |
   |---|---|---|
   | exacto | 0,7 % | 1,7 % |
   | 1 fallo en las alas | 0,7 % | 1,9 % |
   | 2 fallos en las alas | 2,7 % | 7,2 % |
   | 3 fallos | 6,3 % | 11,6 % |

   Incluso al azar, el 15 % de las secuencias tienen algún encaje ajeno con el
   hueco perfecto: tener uno no dice nada por sí solo.

### La regla es mecanística, no un recuento

La RNasa H1 no lee las veinte letras: reconoce la dúplex de ADN con ARN que
forma el HUECO de diez del centro. Con el hueco perfecto corta aunque fallen
las alas; con un fallo dentro del hueco, no. Así que se descarta por choque
exacto o por un fallo en las alas (0,7 % al azar los dos), se avisa a dos
(2,7 %, al borde) y de tres en adelante es ruido. El nulo medido viaja a la
pantalla: así nadie tiene que fiarse de la regla.

Resultado: **32 de 823 descartados**, frente a 13 solo con coincidencia exacta.

### Un fallo que habría quemado CPU para siempre

`cribar_con_desajustes` devolvía `VERSION_BLAST` (1) donde el bucle compara
contra `VERSION` (2), así que tras 158 s de BLAST el bucle no reconocía su
propio resultado y volvía a empezar. Es el mismo modo de fallo que la
heurística de contar candidatos, por otra puerta. Hay test.

## Accesibilidad del sitio: el orden estaba casi invertido (1 oct 2026)

`rosa/plegado.py`, con RNAplfold de ViennaRNA (modelo de Turner sobre ventana
deslizante): la probabilidad de que las veinte letras del sitio estén libres a
la vez. Cuesta 0,7 s por transcrito, se calcula en el bucle.

La primera medición en MAPT, con los candidatos elegidos SIN esto:
- de 60, solo **2** con accesibilidad ≥ 0,1;
- el candidato nº1, el que ROSA2018 mandaría, en **0,013**;
- el mejor sitio del transcrito (posición 4585, **0,863**) no estaba en la
  lista;
- y el más accesible de los 60 era el **nº60**, el último.

Dos cambios, los dos con su medición:

1. **La accesibilidad pesa en QUÉ sesenta se eligen**, no solo en cómo se
   enseñan (`ASO.PESO_ACCESIBILIDAD = 6`). Seis porque los motivos van de 0 a
   6, así que un sitio completamente abierto vale lo mismo que seis motivos
   buenos; y porque barriendo el peso de 0 a 12 los candidatos abiertos pasan
   de 1 a 13 y ahí se aplana (con 8 son 14, con 12 también). Se aplica sobre
   la raíz cuadrada porque la distribución está pegada a cero: la mediana de
   todas las ventanas de MAPT es 0,0001.
2. **El filtro de CpG pasó de veto a aviso con penalización** para uno (dos o
   más siguen vetando). Vetaba cualquiera, y eso tiraba los SEIS sitios más
   accesibles del ARN de MAPT por tener un solo CpG. El motivo del filtro es
   que los CpG sin metilar activan TLR9, pero la arquitectura que ROSA2018
   especifica lleva 5-metilcitosina en todas las citosinas, que es justamente
   esa mitigación y la de los tres gapmers aprobados. Vetar por un riesgo que
   la propia química del diseño ya cubre era tirar la mejor respuesta por nada.

Resultado en MAPT: de 2 candidatos abiertos a **13**, y el nº1 pasa de 0,013 a
0,094 (percentil 96 de su transcrito).

Lo que el cálculo NO dice, y viaja a la pantalla: es un modelo y no una medida;
en la célula el ARN va vestido de proteínas, que abren unos sitios y cierran
otros; y el plegado es local (ventana de 80), no de punta a punta.

## La dúplex: por qué NO se hizo en 3D

Se intentó generar un PDB para el visor Mol* que ya tiene la pantalla, y hubo
que tirarlo. Los parámetros publicados de una dúplex híbrida de ARN con ADN
dan la FORMA de la hélice (giro 32,7°, subida 2,62 Å, radio del esqueleto), no
dónde está cada átomo de cada base. Poner esos átomos habría sido inventarlos.

`rosa/duplex.py` da las coordenadas para dibujar lo que sí se sabe: los dos
esqueletos con la forma real de la hélice y los pares que los unen, con las
alas de 2'-MOE de un color y el hueco de ADN de otro. La pantalla lo pinta en
SVG y dice que es un esquema. Sirve para ver por qué la arquitectura es 5-10-5
y por qué la RNasa H1 solo corta en el hueco, que es justo lo que no se
entiende leyendo veinte letras.

De paso, un detalle de dibujo que solo se ve al mirarlo: en cada cruce las dos
hebras se intercambian, así que poner siempre la letra del oligo arriba las
hacía caer en el mismo punto. Cada letra va por fuera de SU hebra.

## Lo que sigue faltando

- **El pre-ARN.** El cribado sigue siendo sobre ARN maduro. El corte promiscuo
  de la RNasa H1 sobre el borrador largo con sus intrones es el mecanismo
  conocido de hepatotoxicidad de los gapmers (Burel et al., Nucleic Acids Res
  44:2093, 2016). Pide el genoma con su anotación (~880 MB, las dos hebras).
- **Variantes en el sitio diana.** Una variante común haría que el oligo no
  pegara en parte de la población. ROSA2018 tiene conectores de variantes y
  aquí no se usan.
- **La química sigue siendo coocurrencia, no afinidad** (11 de 14 dianas llevan
  amiloide-beta y lecanemab).
- **Ninguna estructura medida del PDB se dibuja todavía.**

## Auditoría de integridad y rendimiento corregida (1 de octubre de 2026)

- El resumen del laboratorio conserva estratos de diseño y calcula diferencias
  descriptivas entre dos grupos. No sustituye un análisis ajustado o pareado:
  cuando no reconoce el diseño lo declara no comprobable, sin inventar un p-valor.
- Las entregas de archivos son inmutables. Una evaluación solo se aplica si la
  entrega, el contrato y la versión de la hipótesis siguen siendo los evaluados.
- Cualquier fallo de SQLite, incluido BEGIN, restaura la memoria desde disco.
- El estado se persiste por claves en `estado_partes`, con versión en
  `estado_meta`. La vista `estado` sigue entregando el JSON completo a lectores.
  La migración es transaccional al abrir para escritura; un binario antiguo
  obtiene rowcount cero en la vista y revierte por su control de versión.
  No se debe ejecutar una versión antigua para escribir en una base migrada.
- El análisis guarda código, resultado del sandbox, réplicas e interpretación
  antes de continuar. Al reanudar conserva el plan y el cupo ya consumido.
- Detección del runtime y hash de datos salen del bucle de eventos. Las versiones
  se registran desde el entorno realmente ejecutado, sin sobrescribirlas con la
  imagen tabular. Si la consulta falla no se guarda una caché de versiones falsas.
- La estabilidad compara la misma medida entre semillas. Réplicas incompletas,
  valores ausentes o no finitos son no comprobables y no reciben auditoría válida.
- El límite de cifras también acota resultados por gen; conserva las claves
  principales y cuenta lo omitido. Los valores no finitos del CSV se señalan.
- El hook de altura cumple la convención de React; el fixture del dúplex usa
  caracteres de tipo string para que TypeScript pueda verificarlo.

Pruebas de regresión en `rosa/tests/test_bughunt_integridad.py`, con modelos
simulados y bases temporales, incluidas reanudación tras reabrir SQLite y
protección contra escrituras de un binario anterior. Sobre copias de 39,1 MB,
diez mutaciones pequeñas: mediana de 64,9 a 41,9 ms; WAL de 79 MB a 165 KB.
Sigue existiendo el coste de recorrer el estado para detectar cambios; se
eliminó la reescritura de las claves que no cambian.
