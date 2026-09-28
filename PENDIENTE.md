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
