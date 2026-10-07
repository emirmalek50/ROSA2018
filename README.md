# ROSA2018

ROSA2018 es la IA de investigacion del Alzheimer Project (AI Robotix e INTEC): un
bucle que busca literatura, extrae afirmaciones con cita a la pagina exacta,
las verifica, mantiene un modelo de mundo, propone hipotesis y las somete a un
torneo, siempre con una persona decidiendo en la cola. Este repositorio tiene
el backend (Python, DSPy, GEPA) y la interfaz (React).

## Arrancar ROSA2018

Con dos ventanas de terminal, o con el script que hace las dos cosas:

```bash
./rosa.sh          # Mac y Linux
.\rosa.ps1         # Windows, en PowerShell (si se niega: powershell -ExecutionPolicy Bypass -File .\rosa.ps1)
```

Eso arranca el servidor de ROSA2018 (puerto 8765), la interfaz (puerto 5174) y abre
el navegador cuando el servidor ya responde (la primera vez instala todo y tarda
uno o dos minutos). Lo que tiene que haber en la máquina, y que el script
comprueba y dice cómo instalar si falta: `uv` (instala Python 3.12 y las
dependencias), Node.js (la interfaz) y el `.env` de abajo. Se entra por
http://localhost:5174, no por el puerto del servidor, que sin la interfaz
compilada responde 404. Con un correo @alzheimerproject.com se crea la cuenta
desde la pantalla de acceso y se entra en el acto. A mano:

```bash
uv run python -m rosa.main          # el servidor y el bucle
cd frontend && npm run dev          # la interfaz en http://localhost:5174
```

Si el servidor no esta, la interfaz muestra datos de muestra con una corrida
simulada y lo avisa con una franja amarilla.

### Compartir ROSA2018 con el equipo

Hay UNA ROSA2018: la del servidor donde vive `rosa.db`. Una copia del repo en
otra máquina arranca vacía, porque los datos (`rosa.db`, `datos/`) no se
versionan. Para que todo el equipo vea y trabaje sobre los mismos datos
(decisión de Emir, 5 de octubre de 2026), el servidor se saca a un enlace:

```bash
./scripts/compartir.sh            # arranca el túnel y escribe el enlace
./scripts/compartir.sh --estado   # el enlace actual
./scripts/compartir.sh --parar    # cierra el túnel; el servidor sigue
```

Quien recibe el enlace crea su cuenta con su correo @alzheimerproject.com y
entra en el acto. El túnel (Cloudflare, `brew install cloudflared`) solo
reenvía al 127.0.0.1 y el enlace cambia cada vez que se arranca.

**El enlace fijo: `https://rosa.alzheimerproject.com`** (decisión de Emir del
5 de octubre de 2026, «no quiero que ese sea el enlace» al ver el nombre de
Tailscale). Dos piezas, las dos con lo que la empresa ya tiene:

1. **Tailscale Funnel** (`scripts/compartir_fijo.sh`) publica el servidor en
   `https://<este-mac>.<red>.ts.net`: arranca con Tailscale al iniciar sesión
   en el Mac, se reconecta solo y el nombre no cambia. Ese nombre no lo ve
   nadie: es el que usa Vercel por detrás. Una sola vez:

   ```bash
   brew install --cask tailscale-app   # pide la contraseña del Mac; abrir la app e iniciar sesión
   ./scripts/compartir_fijo.sh         # publica; la primera vez enseña el enlace para activar Funnel (un clic)
   ```

2. **Vercel** sirve la interfaz en `rosa.alzheimerproject.com` y reenvía
   `/api` al nombre de Tailscale (`vercel.json`, `rewrites`). El dominio
   `alzheimerproject.com` vive en el equipo AI Robotix de Vercel (registrador
   y DNS), y el subdominio `rosa` solo resolvía por el comodín: el proyecto
   `rosa2018` de ese equipo lo reclama. Desde la raíz del repo, con la sesión
   de Vercel de Emir:

   ```bash
   vercel deploy --scope ai-robotix --yes      # vista previa: comprobar que entra y se ve
   vercel --prod --scope ai-robotix            # producción
   vercel domains add rosa.alzheimerproject.com rosa2018 --scope ai-robotix   # una vez
   ```

   Cada cambio de la interfaz se despliega con el segundo comando (o
   conectando el repositorio al proyecto en el panel de Vercel para que lo haga
   cada `push` a `main`). Si cambia el nombre de Tailscale (otro Mac, o la
   máquina renombrada), se cambia en `vercel.json` y se vuelve a desplegar.

**Si el enlace deja de funcionar** («El enlace no devolvió una respuesta de
ROSA2018»): `./scripts/compartir_fijo.sh --estado` lo comprueba desde internet,
no desde el propio Mac. Si dice que Funnel está encendido pero no responde, el
arreglo visto el 6 de octubre de 2026 es cerrar la app de Tailscale (icono de
la barra de menús, Quit) y volver a abrirla: el Mac había cambiado de red y los
relés de Tailscale seguían sin encontrarlo. El servidor tiene que estar
arrancado y el Mac despierto: un portátil que duerme corta el enlace para
todo el mundo (hay un `caffeinate` puesto mientras no exista el Mac fijo).

Lo que hay que saber del reenvío: Vercel corta cada petición reenviada a los
120 segundos, así que el canal en vivo (`/api/eventos`) se reabre cada dos
minutos; no cuesta nada (el canal solo avisa de la versión, el estado se baja
aparte y solo si cambió) y la interfaz espera 8 s antes de decir «sin
conexión» para no parpadear (`GRACIA_CAIDA_MS`). Quien entra no necesita
Tailscale ni Vercel: el enlace es público y delante está la pantalla de
acceso. El servidor admite `*.ts.net` y `*.alzheimerproject.com`.

La clave del gateway va en `.env` (`ROSA_GATEWAY_KEY`), copiada del `.env` del
RAG o pasada por quien administra ROSA2018 por un canal privado. Nunca al
código, al repo ni a un chat. Sin ella el servidor no arranca.

## Lo que trae ROSA2018 (septiembre de 2026)

El documento de concepto del programa y el plan completo del sistema (ver
`PLAN-ROSA2018.md`) a�aden a ROSA2018 estas piezas. Todas estan en la interfaz;
nada de esto se opera desde la terminal.

- **Mision y areas.** Al arrancar la primera corrida ROSA2018 propone la mision
  (poblacion, etapa, celula o tejido, mecanismo, tipo de intervencion,
  capacidades del laboratorio, presupuesto en llamadas, dolares y horas) y las
  areas de investigacion que comparo para elegir por donde empezar. Se
  aprueba con el primer plan o en Objetivo y datos. Cada corrida lleva su
  pregunta con plantilla (contexto, etapa, intervencion, comparador,
  desenlace, ventana, unidad biologica, mecanismos, decision, umbral).
- **Datasets con libro de procedencia.** En Objetivo y datos se sube un CSV,
  TSV o JSON: el servidor calcula el sha256, cuenta filas y columnas, detecta
  valores centinela y prepara el diccionario. Antes de aprobar el contrato hay
  que completar origen, licencia y si el uso con IA esta autorizado. Las filas
  individuales no salen hacia un modelo salvo que el libro lo permita (solo
  datos abiertos o sinteticos).
- **Puerta de reproduccion.** ROSA2018 no descubre con datos hasta reproducir
  tres analisis publicados dentro de una tolerancia fijada antes (hay tres
  precargados: GSE1297, OASIS-1, SEA-AD). Se puede eximir con motivo: queda
  registrado como cambio de politica.
- **Analisis in silico.** Desde la ficha de una hipotesis, con un dataset
  aprobado: ROSA2018 congela un plan de analisis sin ver las filas, escribe el
  codigo, lo corre en un sandbox sin red (Docker Desktop encendido, o Apple
  `container`), interpreta las cifras contra el umbral del plan y un auditor
  independiente dice si el analisis vale. Solo lo valido entra como evidencia.
  Con datasets sinteticos funciona sin Docker, con aislamiento blando.
- **Hypothesis Killer.** Cada hipotesis pasa una lista fija de catorce
  comprobaciones; la decision (avanzar, reformular, suspender, descartar en
  este contexto) se deriva por regla y cada comprobacion tiene una
  consecuencia declarada cuando falla (`rosa/killer.py`, tabla
  `CONSECUENCIA`): descartan citas y fidelidad; reformulan
  causalidad, falsabilidad, factibilidad, redundancia, direccion de la
  evidencia, unidades y novedad; suspenden fuente primaria, riesgo de sesgo,
  identificadores que no resuelven y supuestos contradichos (desde el 17 de
  septiembre de 2026: el evaluador de supuestos daba por contradicho lo que
  ninguna afirmación mencionaba y descartaba hipótesis buenas); una sola
  cohorte avanza con la certeza limitada. Una comprobación por regla que encontró algo (una cifra fuera
  del pasaje) no la puede borrar el juez. Reformular crea una version nueva
  (hasta dos por politica). Un tercio de los descartes lo audita otro modelo
  defendiendo la hipotesis. Todo queda en el registro de decisiones, y cada
  comprobacion se puede etiquetar a mano: es el conjunto dorado con el que se
  mide el acuerdo juez-humano (kappa por comprobacion, pantalla Calidad).
- **Candidatas y dossier.** El ranking muestra las candidatas al laboratorio
  (hasta tres, sin repetir cluster) y por que las demas no lo son (bloqueos
  no compensables). El dossier en siete partes se genera desde la ficha y
  queda en Artefactos.
- **Retorno.** Los datos del laboratorio se clasifican en seis clases con
  definiciones operativas mas las dimensiones que coexisten; cada clase
  dispara una accion distinta (una correccion de contexto crea una hipotesis
  derivada; un fallo tecnico no toca la hipotesis).
- **Aprendizaje y metodos.** En Ajustes: el registro de aprendizaje en tres
  niveles (creencias; criterios y programas, que ROSA2018 propone y una persona
  evalua y promueve; politicas), el registro de metodos con su estado, y las
  politicas tal como estan en el codigo.

- **Ranking por Bradley-Terry y evidencia acumulada.** Las candidatas se
  ordenan por la fuerza de Bradley-Terry sobre los partidos del torneo, con
  intervalo del 95 % por bootstrap; el Elo queda como vista. Cuando un plan
  de analisis tiene aleatoriedad (permutacion, bootstrap) el sandbox lo
  repite con dos semillas mas. Los p-valores de los analisis validos de una
  hipotesis se agregan con e-valores (producto de kappa p^(kappa-1)), que
  controlan el error aunque se sigan a�adiendo pruebas.
- **Misma cohorte sin nombre y comprobaciones de registro.** Dos fuentes
  primarias que comparten dos autores, o el centro y un autor, con pocos a�os
  de diferencia cuentan como una sola cohorte aunque no la nombren. El Killer
  comprueba ademas que la evidencia sostenida va en la direccion del enunciado
  (si va al reves, reformula) y que las cifras comparadas estan en la misma
  unidad (si no, avisa).
- **Protocolo real y enmiendas fechadas.** En la ficha del experimento, tras
  asignarlo, se registra lo que el laboratorio hizo de verdad (protocolo
  ejecutado, desviaciones, identidad de las muestras) y cualquier cambio del
  prerregistro queda como enmienda con fecha, autor, texto anterior y motivo.
  El juez lee las tres cosas al evaluar los datos.
- **Gobierno de areas y jerarquia.** Cada area del programa se puede elegir,
  pausar con la condicion que la reabriria, reabrir, dejar sin explorar o
  asignar a una campana (corrida); todo con historial. En Objetivo y datos se
  ve la jerarquia programa, areas, campanas y preguntas con sus huecos.
- **Comprobador heuristico de supuestos causales.** No es un motor causal
  (sin modelo estructural ni descubrimiento de estructura desde datos, que la
  literatura de 2026 no considera listo para biologia). Cada hipotesis
  juzgada lleva un grafo local con aristas tipadas (supuesto, inferencia con
  evidencia, base curada de quince relaciones del Alzheimer escritas a mano),
  las alternativas que planteo el Killer como nodos, y una identificacion por
  regla: identificable, acotado (con los supuestos que faltan) o sin
  resolver. El resultado entra al Killer como la comprobacion
  `direccion_causal` (no comprobable con los supuestos que faltan, hasta que
  el juez o un experimento los resuelvan). La base curada vive en
  `rosa/causal.py`.
- **Panel del Killer.** Un panel con fallos plantados en hipotesis reales
  (cifra alterada, prediccion no falsable, causalidad sin temporalidad, misma
  cohorte, supuesto contradicho) y un conjunto gris mide la tasa de deteccion,
  si lo vio el juez, la abstencion y cuanto mata de mas. Se corre con el
  servidor encendido (cuesta llamadas al juez) y el resultado queda en Calidad:

  ```
  uv run python -m rosa.evaluacion.panel_killer --hipotesis 5
  ```

## Programa: ruta, mapa, datasets, perfil de diana, contrato del experimento y cifras de aprendizaje (16 de septiembre de 2026)

Hasta aquí ROSA2018 miraba cada hipótesis por separado. Estas seis piezas la hacen
mirar también el conjunto (lo que ROSA2018 llama "vista de programa") y le
exigen a cada experimento que diga, antes de tener datos, qué medirá y cómo
leerá un resultado negativo. Todas son reglas fijas en Python (sin modelo de
lenguaje) que leen el estado y escriben en él; el modelo solo interviene donde
se dice. Nada se opera desde la terminal: todo se ve en la interfaz y un
registro guardado antes de hoy sigue cargando (las claves nuevas nacen en
`None` o en lista vacía y `rosa/estado/almacen.py` las añade al arrancar).

Cómo se enlazan: el bucle escribe `ruta`, `perfilDiana` y `alternativas` en
cada hipótesis (en el Killer y al concluir), el contrato dentro de
`experimento` al proponerlo, y al cerrar cada iteración las tres vistas de la
investigación (`mapaEnfermedad`, `mapaRuta`, `cifrasAprendizaje`) más los
datasets que los conectores devolvieron en `estado.datasetsPrograma`. El
servidor las sirve dentro de `/api/estado` y a demanda en
`GET /api/investigaciones/{id}/ruta`, `/mapa` y `/cifras`,
`GET /api/experimento/vocabularios` y `GET /api/hipotesis/{id}/contrato`.

### Ruta terapéutica evaluada (`rosa/ruta.py`)

- **Qué hace.** La ruta terapéutica son los ocho pasos que separan una idea
  biológica de un tratamiento: mecanismo, opciones de intervención,
  compromiso de diana (la intervención llega de verdad a su blanco), efecto
  funcional, selectividad y toxicidad, entrega y exposición, replicación
  independiente y evidencia en la población. `evaluar_ruta(e, h)` mira la
  evidencia que ya tiene la hipótesis (afirmaciones sostenidas, ejecuciones
  válidas, resultado del laboratorio, grafo causal) y marca cada paso como
  cubierto, parcial, vacío o no comprobable (una fuente que no respondió no
  es "no hay"). Dice cuál es el siguiente paso y si el paso que la tarjeta
  declara es coherente con lo cubierto. `mapa_ruta(e, inv_id)` agrupa las
  hipótesis vivas por diana y cuenta cuántas cubren cada paso.
- **Dónde se ve.** En la ficha de la hipótesis, dentro de la tarjeta
  (`frontend/src/componentes/Rosa2018.tsx`, `RutaTerapeutica`): un símbolo
  por paso con el motivo al pasar el ratón, el resumen en llano encima y un
  chip ámbar si la tarjeta declara un paso por delante del primero vacío. En
  la pantalla de la investigación, sección "Programa", la tarjeta "Mapa de la
  ruta terapéutica" (`frontend/src/componentes/MapaRuta.tsx`). En el dossier,
  sección 2, sustituye a la frase fija de antes.
- **Qué toca Emir.** El vocabulario por regla de cada paso (`_INTERVENCION`,
  `_FUNCIONAL`, `_SEGURIDAD`, `_EXPOSICION` en `ruta.py`), los diseños que
  cuentan como evidencia en población (`DISENOS_HUMANOS`, `N_MINIMO_POBLACION`),
  la definición de cada paso (`DEFINICIONES_PASO`, copiada en
  `frontend/src/lib/etiquetas.ts` como `DEFINICION_PASO_RUTA`) y los colores
  de los estados (`COLOR_ESTADO_PASO` en `Rosa2018.tsx`). Dónde se recalcula:
  `_ruta_segura` en `rosa/bucle/corrida.py` y el Killer en `rosa/bucle/pasos.py`.

### Mapa de la enfermedad (`rosa/mapa_enfermedad.py`)

- **Qué hace.** Sitúa cada hecho y cada hipótesis de la investigación en
  cuatro ejes leídos por regla del texto y de las entidades: estadio de la
  enfermedad (preclínica, prodrómica o DCL, demencia leve, moderada o grave,
  autosómica dominante; también desde Braak, CDR, MMSE, Thal o CERAD), región
  del cerebro, tipo celular y nivel biológico (molecular, celular, tisular,
  clínico). `mapa(e, inv_id)` devuelve las celdas con sus recuentos y la
  certeza GRADE máxima, los registros que no pudo situar y los "huecos": las
  combinaciones que la misión nombra y nada cubre. Al cerrar la iteración cada
  hueco abre una cuestión para que el planificador busque en amplitud por ahí
  (`_cuestiones_por_hueco` en `rosa/bucle/corrida.py`, tope de 6 por cierre),
  y el texto del mapa entra en el prompt del modelo de mundo
  (`rosa/bucle/contexto.py`).
- **Dónde se ve.** Sección "Programa" de la investigación, tarjeta "Mapa de la
  enfermedad" (`frontend/src/componentes/MapaEnfermedad.tsx`): resumen en
  llano, aviso de lo no situado, lista de huecos con su motivo y, plegada en
  modo sencillo, la rejilla estadio por región con fichas por tipo celular.
- **Qué toca Emir.** Las tablas `REGIONES`, `TIPOS_CELULARES`, `ESTADIOS` y
  las correspondencias `BRAAK_A_ESTADIO`, `CDR_A_ESTADIO`, `THAL_A_ESTADIO`,
  `CERAD_A_ESTADIO` y `mmse_a_estadio` (heurísticas que el equipo de Allegri
  debería validar). Las etiquetas visibles viajan en `mapa.etiquetas`; la
  copia de reserva del frontend es `ETIQUETAS_MAPA` en `MapaEnfermedad.tsx`.

### Registro de datasets del programa (`rosa/datasets_programa.py`)

- **Qué hace.** Un registro único de los conjuntos de datos que ROSA2018 ha visto:
  cada serie GEO y colección CELLxGENE que devuelven los conectores en el paso
  de novedad, y cada fichero que una persona sube en Objetivo y datos. De cada
  uno deduce por regla tipo (bulk, célula única, proteómica...), tejido,
  región, estadio, n, plataforma y acceso, y guarda el motivo de cada
  deducción. El acceso más restrictivo gana: un dataset de ADNI, ROSMAP o MSBB
  queda marcado como controlado y "el proyecto no lo pide"; se registra para
  que conste, nunca se propone para análisis. `coincidencias(e, pregunta)`
  le da al planificador (`ProponerPlan.datasets_disponibles`) los que casan
  con la pregunta de la corrida. `pseudobulk_por_donante` y la skill
  `rosa/skills/pseudobulk-por-donante/SKILL.md` explican cómo agregar célula
  única por donante para que el n sea de donantes, no de células.
- **Dónde se ve.** Sección "Programa", tarjeta "Datasets del programa"
  (`frontend/src/componentes/DatasetsPrograma.tsx`): por defecto los usados
  en esa investigación, con un botón para ver todo el registro; cada fila con
  fuente, accession, acceso, n y el detalle "Cómo se dedujo cada dato".
- **Qué toca Emir.** Los vocabularios `FUENTES`, `TIPOS`, `ACCESOS` y sus
  alias (`_ALIAS_*`), las cohortes `COHORTES_CONTROLADAS` y
  `COHORTES_CON_REGISTRO`, las reglas `inferir_tipo`, `inferir_tejido`,
  `inferir_estadio`. El registro desde el bucle está en
  `registrar_datasets_programa` (`rosa/bucle/pasos.py`) y desde una subida en
  `_registrar_en_programa` (`rosa/estado/acciones.py`).

### Perfil de evidencia por diana (`rosa/dianas.py`)

- **Qué hace.** La diana es el gen o la proteína a la que apunta la
  hipótesis. `perfil_de_diana` la consulta en seis capas, cada una con su
  pregunta: genética humana (Open Targets: ¿la variación del gen cambia el
  riesgo, y en qué dirección?), expresión en tejido (HPA y GTEx), expresión
  por tipo celular (HPA célula única), proteína y función (UniProt, STRING,
  Reactome), farmacología (ChEMBL: ¿hay moléculas que la toquen?) y
  literatura (PubTator). Cada capa responde presente, ausente o "no pude
  comprobar", con el registro de cada consulta. Sobre ese perfil el Killer
  tiene una comprobación nueva por regla, `contexto_humano`: falla solo si HPA
  no detecta la diana en cerebro y la hipótesis afirma un mecanismo cerebral;
  un fallo lleva a reformular, no a descartar. El perfil entra también en el
  texto que leen el juez del Killer y el proponente de experimentos.
- **Dónde se ve.** Ficha de la hipótesis, bloque "Qué dicen las bases de la
  diana" debajo del contexto de bases (`PerfilDeLaDiana` en `Rosa2018.tsx`):
  seis filas fijas con la pregunta en llano, el estado, el detalle y las bases
  consultadas. También en el dossier, sección 2.
- **Qué toca Emir.** `CAPAS`, `PREGUNTA_CAPA` y `ETIQUETAS_CAPA` (copiadas en
  `etiquetas.ts` como `CAPA_DIANA`), el tejido GTEx por defecto
  (`TEJIDO_GTEX_POR_DEFECTO`), la regla de `comprobacion_contexto_humano` y su
  lugar en `REFORMULAN` (`rosa/killer.py`). El conector `gtex_gen` vive en
  `rosa/conectores/bases.py`; el perfil se construye en `contexto_de_bases`
  (`rosa/bucle/pasos.py`).

### Contrato del experimento (`rosa/experimento.py`)

- **Qué hace.** Cuando ROSA2018 propone un experimento, además del protocolo fija
  un contrato: las lecturas (cada medida, con qué la confirma, qué la refuta,
  control y unidad; la de "compromiso de diana" prueba que la intervención
  tocó su blanco, separada de la de "efecto"), el sistema experimental (en qué
  se hace, qué prueba y qué no representa de la biología humana), el
  propósito BEST del biomarcador (la clasificación de la FDA y el NIH de para
  qué sirve: riesgo, diagnóstico, monitorización, pronóstico, predicción de
  respuesta, farmacodinámico, seguridad), el nivel del desenlace y el puente
  al beneficio (por qué cambiar esa medida importaría a una persona).
  `validar_contrato` lista en castellano lo que falta; `hash_lecturas` es la
  huella que el prerregistro congela (si alguien cambia una lectura después,
  deja de coincidir). Con el resultado, `veredicto_por_lecturas` juzga cada
  lectura por regla con la cifra que la nombra (sin cifra, "no evaluable",
  nunca "sin efecto") y `lectura_del_negativo` dice si un negativo cuestiona
  el mecanismo (diana comprometida y sin efecto) o solo el ensayo (diana no
  comprometida). La acción `enmendarLectura` corrige un campo de una lectura
  tras prerregistrar, con motivo, autor y los dos hashes.
- **Dónde se ve.** Ficha de la hipótesis, sección "Experimento propuesto",
  bloque `ContratoDelExperimento` (`Rosa2018.tsx`): tabla de lecturas con
  botón "Enmendar", sistema, propósito y nivel con su definición, avisos del
  contrato y, con resultado, el veredicto por lectura y "Qué dice el
  negativo". El prerregistro congelado lleva el bloque de lecturas y el hash
  (`bloque_prerregistro`, espejado en `frontend/src/datos/acciones.ts`).
- **Qué toca Emir.** Los cuatro vocabularios cerrados (`TIPOS_LECTURA`,
  `SISTEMAS_EXPERIMENTALES`, `PROPOSITOS_BIOMARCADOR`, `NIVELES_DESENLACE`,
  copiados en `acciones.ts` con el mismo nombre), la lista de datos
  controlados que un protocolo no puede pedir (`DATOS_ACCESO_CONTROLADO`), las
  reglas de lectura de cifras (`_SUBE`, `_BAJA`, `evaluar_criterio`) y los
  campos enmendables (`CAMPOS_LECTURA_ENMENDABLES` en `rosa/estado/acciones.py`).
  La firma DSPy que pide el contrato al modelo es `ExperimentoPropuesto` en
  `rosa/modulos/firmas.py`.

### Cifras de aprendizaje (`rosa/cifras_aprendizaje.py`)

- **Qué hace.** Tres medidas de si ROSA2018 aprende, calculadas al cerrar cada
  iteración: acierto prerregistrado (de las predicciones que dejó por escrito
  antes de mirar los datos, en planes de análisis y experimentos, cuántas
  salieron como dijo; sin casos no se inventa un 0 %), tiempo hasta decisión
  (horas desde que nace una hipótesis hasta su primera decisión de cada
  etapa, mediana y p90) y reutilización de lo heredado (cuántos hechos
  copiados de otra investigación usó alguna hipótesis viva). Cada cifra lleva
  su regla, el detalle caso a caso y un glosario; el texto en llano se pega al
  resumen de la iteración (`resumenLlano.aprendizaje`) y la métrica de la
  corrida (`rosa/progreso.py`, `frase_acierto`) lo dice en una frase.
- **Dónde se ve.** Sección "Programa", tarjeta "Aprendizaje"
  (`frontend/src/componentes/CifrasAprendizaje.tsx`): tres fichas con el
  texto del servidor, la regla y el detalle plegado; los términos del glosario
  se explican al pasar el ratón.
- **Qué toca Emir.** `REGLA_ACIERTO`, `REGLA_TIEMPO`, `REGLA_REUTILIZACION`,
  `GLOSARIO` y `ETAPAS`; la frase de la métrica en `frase_acierto`
  (`rosa/progreso.py`). El cierre que las escribe es
  `_vistas_de_programa_al_cerrar` en `rosa/bucle/corrida.py`.

### Ranking explicado y explicaciones alternativas

- **Qué hace.** `frontend/src/lib/ranking.ts` descompone, sin sumarlos, los
  componentes que ROSA2018 calcula sobre cada hipótesis (certeza GRADE y su
  techo, dirección, cohortes distintas, a favor y en contra, Killer,
  bloqueos, Bradley-Terry, partidos, novedad) y dice en una frase qué la
  movería en el orden. Las alternativas son lo que también explicaría lo
  observado sin que la hipótesis sea cierta (causa inversa, confusor,
  selección, artefacto) y qué observación las separaría; las escribe el juez
  del Killer y las clasifica por regla `clasificar_alternativa`
  (`rosa/bucle/pasos.py`).
- **Dónde se ve.** `FranjaRanking` bajo cada fila del Ranking y bajo el
  título de la ficha; sección "Explicaciones alternativas" de la ficha
  (`frontend/src/componentes/Alternativas.tsx`).
- **Qué toca Emir.** Los chips y sus definiciones en `ranking.ts` y
  `FranjaRanking.tsx`; las clases de alternativa en `rosa/causal.py`.

Comprobar que todo sigue en pie tras un cambio: la suite de Python
(`rosa/tests/test_integracion_estado.py`, `test_integracion_pasos.py`,
`test_integracion_corrida.py` y los `test_<modulo>.py` de cada pieza) y, en
`frontend/`, `npx vitest run`, `npx eslint src`, `npx tsc --noEmit -p
tsconfig.json` y `npm run build`. Para revisar tildes sin escribir nada:
`python3 scripts/acentuar.py --comprobar` desde `frontend/`.

## Lo que ROSA2018 tomo de Claude Science (11 de septiembre de 2026)

La investigacion completa esta en `INVESTIGACION-HERRAMIENTAS-CLAUDE-SCIENCE.md`.
Lo aplicado:

- **Conectores a bases publicas** (`rosa/conectores/`): 80 conectores en 21
  grupos, 57 activos sin clave (OLS, MyGene, MyVariant, Ensembl, UniProt,
  GTEx, Human Protein Atlas, STRING, Reactome, GWAS Catalog, ClinVar,
  ClinGen, CIViC, Open Targets por GraphQL, ChEMBL, PubChem, BindingDB,
  DGIdb, openFDA, GEO, ArrayExpress, PRIDE, MetaboLights, Expression Atlas,
  CELLxGENE, Synapse, PDB, AlphaFold, EMDB, IntAct, Complex Portal, InterPro,
  QuickGO, ENCODE, JASPAR, UniBind, cBioPortal, UCSC, Enrichr, g:Profiler,
  NIAGADS, bioRxiv, Semantic Scholar, Europe PMC Annotations, arXiv,
  Grants.gov, Antibody Registry, CellGuide, FinnGen) y 23 inertes con su
  motivo (Benchling, BioRender, 10x, Owkin, Medidata, Wiley, Consensus,
  KEGG por licencia, DrugBank, AlzForum sin API, ADNI y UK Biobank por acceso
  controlado, ARCHS4 por fichero de 30 GB). Cada llamada deja un registro de
  consulta (herramienta, argumentos, fecha, resultados, identificadores,
  invariante comprobada) en la hipotesis; el catalogo con licencias, limites
  y permisos esta en Ajustes.
- **Novedad ampliada**: ademas de Open Targets, ClinicalTrials.gov y el
  precedente en la literatura, cada hipotesis comprueba la genetica humana
  (GWAS Catalog, ClinVar), los farmacos contra la diana (ChEMBL, DGIdb) y si
  hay datos publicos para comprobarla (GEO, CELLxGENE).
- **La diana en las bases**: identificadores estables (MyGene), funcion
  (UniProt), expresion en cerebro (Human Protein Atlas), interactores
  (STRING) y rutas (Reactome) debajo de la tarjeta; el Killer comprueba
  `identificadores_resuelven`.
- **Preguntar a las bases** (en Modelo de mundo): un bucle acotado de
  herramientas (ReAct, hasta seis pasos) con los conectores, la busqueda en el
  proyecto y el modelo de mundo; la respuesta llega con sus consultas.
- **Permisos por conector** (permitir, solo si pregunta una persona,
  bloquear) y **memoria del proyecto** (hechos cortos que ROSA2018 lee en cada
  mision), en Ajustes y en Objetivo y datos.
- **Revisor de registro**: al cerrar cada iteracion y en el dossier, lo que
  ROSA2018 dice se compara con lo que el registro prueba (seis clases de
  hallazgo, por regla y con el juez); los hallazgos se ven como tarjetas en
  la corrida.
- **Artefactos con cinco pestanas de procedencia** (mensajes, codigo,
  registro de ejecucion, entorno, revision) y versiones por nombre.
- **Skills de metodo** (`rosa/skills/`): expresion GEO, tamano muestral (con
  modulo importable en el sandbox), control de calidad de celula unica,
  fila de evidencia, eleccion de problema, reproduccion publicada, revision
  de literatura. El planificador, el escritor de codigo y el proponente de
  areas las cargan por palabras de activacion.
- **Dos entornos de sandbox**: `rosa-sandbox:1` (tabular) y
  `rosa-sandbox-celula:1` (scanpy, anndata); el plan declara el entorno y la
  ejecucion registra la imagen y las versiones de paquetes.
- **Panel del Killer** en Calidad, con dos corridas registradas (deteccion
  del 16 % al 67 % tras hacer `supuestos` una regla y suspender cuando juez y
  regla discrepan).

Lo que Claude Science tiene y ROSA2018 no copia, y por que: kernels persistentes
de Python y R, notebooks y entornos con instalacion libre (ROSA2018 es un
investigador autonomo con contrato de salida y reproducibilidad exigida;
instalar a demanda la rompe), trabajos remotos en Slurm o Modal (sin
infraestructura ni necesidad hoy), y las plataformas de pago sin datos
publicos. scvi-tools no entra en la imagen de celula unica porque arrastra
PyTorch y no hay GPU.

## Lo que ROSA2018 tomo de la revision de un AI scientist profesional (14 de septiembre de 2026)

Un informe externo listo quince huecos entre el MVP y un sistema en operacion
profesional; se verifico cada afirmacion contra las fuentes (ver
`INVESTIGACION-AI-SCIENTIST-2026.md`, con las correcciones: PRISMA 2026 no
existe, la mayoria de los laboratorios autonomos esta en el nivel 3, DrugBank
no es abierto) y se aplico lo que aportaba:

- **Riesgo de sesgo por instrumento** (`rosa/sesgo.py`): RoB 2, ROBINS-I V2,
  QUADAS-2, ROBIS y SYRCLE. El juez responde las preguntas de senalizacion
  con cita y la regla del instrumento pone el veredicto; la comprobacion
  `sesgo_evidencia` del Killer y el factor GRADE salen de ahi.
- **Conjunto dorado y calibracion** (`rosa/acuerdo.py`,
  `rosa/acuerdo_dorado.py`): cada comprobacion del Killer se etiqueta a mano
  desde la ficha; Calidad muestra el kappa de Cohen por comprobacion (y AC1
  de Gwet); el panel de fallos plantados reporta kappa; si cambia el modelo
  del juez o cae el acuerdo, queda una incidencia.
- **Sello externo del prerregistro** (`rosa/sello.py`): RFC 3161 con freeTSA,
  DigiCert y Sectigo al asignar un experimento; verificable con `openssl ts
  -verify` sin ROSA2018. **Registro encadenado por hashes** (Ajustes, Integridad
  del registro).
- **PRISMA 2020** (`rosa/prisma.py`): el cribado registra cada excluido con
  su motivo; la corrida exporta el flujo con las variables oficiales del
  diagrama, los items 6, 7, 8, 16a y 16b, la extension PRISMA-LSR y la
  declaracion de la IA (PRISMA-trAIce).
- **Ensayo en seco** (`rosa/sintetico.py`): el plan congelado corre sobre una
  tabla sintetica con la forma del dataset antes de tocar los datos reales.
- **Entidades canonicas** (`rosa/ontologias.py`): HGNC, MONDO, CL, UBERON,
  GO y ChEBI en hechos, hipotesis y nodos causales; el modelo de mundo se
  busca por identificador o alias; redundancia por identificador.
- **Politica de contexto**: presupuesto de tokens por rol
  (`politicas.TOKENS_MAX_POR_ROL`), recortes registrados como compactacion y
  el acuerdo juez-humano por tamano del modelo de mundo en Calidad.
- **Nivel de autonomia declarado**: 2 de 5 en la escala de Beal y Rogers, en
  Ajustes y en cada dossier. **Coste por decision** (`rosa/costes.py`):
  modelo mas horas de revision a tarifa declarada, por dossier, candidata y
  decision. **Conocimiento operativo del laboratorio** como clase de
  evidencia propia. **RO-Crate con PROV** (`rosa/rocrate.py`) desde la ficha.

Reglas de concurrencia (lo que antes no estaba escrito): un solo escritor
(el proceso de ROSA2018, con cerrojo reentrante); cada mutacion es atomica y se
persiste con su fila del registro en la misma transaccion; una lectura ve
siempre una version completa (la instantanea se toma bajo el cerrojo); una
decision humana lleva la version de la hipotesis que veia y el servidor la
rechaza si cambio (la interfaz recarga y avisa); el espejo de Convex y las
exportaciones leen bajo el cerrojo en un hilo. Si algun dia hay varios
procesos escribiendo, esta seccion es lo que hay que revisar primero.

## Espejo del estado en Convex

Con `CONVEX_URL` y `CONVEX_DEPLOY_KEY` en el `.env` del servidor, ROSA2018 copia
cada entidad publica del estado a una tabla de Convex (`frontend/convex/`:
esquema y funciones `espejo:sincronizar`, `espejo:meta`, `espejo:coleccion`,
`espejo:entidad`, `espejo:hashes`), actualizando solo lo que cambio pocos
segundos despues de cada mutacion. SQLite sigue siendo la fuente de verdad y
el unico que escribe; el espejo sirve para leer el estado desde cualquier
sitio y para que varias personas lo vean a la vez. Estado en Ajustes y en
`GET /api/espejo`. Despliegue de las funciones: `cd frontend && npx convex
deploy` con la clave en el entorno. La clave nunca va al estado, al
navegador ni al repositorio.

Los datasets admiten hasta 200 MB (una matriz de expresion de GEO en formato
largo ronda los 100 MB). Arrancar Docker Desktop antes de una demostracion con
datos reales: sin runtime de aislamiento, los analisis quedan en "no ejecutado"
con el motivo.

## Exa: búsqueda semántica de publicaciones (15 de septiembre de 2026)

Exa (exa.ai) recupera por significado, con embeddings, sobre un índice de
unos 350 millones de publicaciones (`category="publication"`). ROSA2018 lo usa
como complemento de PubMed, Europe PMC y OpenAlex, no en su lugar:

- **Búsqueda de literatura.** El planificador (`GenerarConsultas`) recibe las
  bases disponibles y, si Exa está, escribe al menos una consulta en lenguaje
  natural para ella; las demás siguen siendo booleanas. Los resultados pasan
  por el mismo cribado, la misma fusión por DOI, PMID o título y el mismo
  registro que los de las otras bases (`rosa/fuentes/exa.py` los devuelve con
  la misma forma). Si el plan elige Exa y no hay clave, la consulta se desvía
  a Europe PMC con una nota: nunca se pierde por falta de clave.
- **Novedad del Killer.** Además de OpenAlex por términos clave, Exa busca el
  enunciado entero de la hipótesis: es la herramienta para "¿alguien ya
  propuso esto con otras palabras?". Los candidatos de las dos bases se
  puntúan juntos con el mismo programa de relevancia.
- **Conectores** `exa_publicaciones`, `exa_similares` (documentos parecidos
  a una URL) y `exa_referencias` (los enlaces bibliográficos de la página de
  un artículo) en el catálogo, con registro de consulta e invariante. Sin
  clave quedan como "requiere cuenta" con el motivo.

Ampliado el 15 de septiembre en cuatro partes:

- **Pasajes guiados y afinidad.** Los pasajes destacados se piden con la
  pregunta abierta (o el enunciado) como guía; Exa devuelve la similitud del
  mejor pasaje, que ordena los artículos antes del cribado y queda en cada
  uno (`similitud`).
- **Literatura gris.** Base «gris» del planificador: la misma búsqueda
  semántica acotada a FDA, EMA, registros de ensayos, OMS, NIA, Alzforum y
  preprints (`exa.DOMINIOS_GRIS`).
- **Novedad honesta y más amplia.** El precedente, las patentes (Google
  Patents, WIPO, Espacenet, Justia, FPO) y los proyectos financiados (NIH
  RePORTER, Grantome, CORDIS, UKRI, ADDF) se buscan solo entre lo publicado
  antes de que ROSA2018 propusiera la hipótesis (`endPublishedDate`), con la
  misma regla de puntuación que el precedente. Dos apartados nuevos en
  "Novedad" de cada hipótesis.
- **Vigilancia diaria** (`rosa/vigilancia.py`): una búsqueda al día por
  hipótesis viva de lo publicado desde la última comprobación, sin modelos,
  con evento en la línea de tiempo y sección plegable en la hipótesis. No
  repite lo conocido y no afirma "nada nuevo" si Exa no responde.
- **Texto de la página como último recurso** para el texto completo, en
  partes con localizador explícito ("texto web, parte N"): sirve para
  verificar contra el pasaje literal, no sustituye la cita a la página.
- **Gasto.** Cada búsqueda suma a `gasto.exaUsd` de la corrida; el coste por
  decisión (`rosa/costes.py`) incluye Exa (`usdExa`), con la vigilancia.

Solo se usan los endpoints de recuperación (`search`, `contents`,
`findSimilar`); nunca `answer`, `research` ni los tipos `deep`, que razonan
con modelos de Exa fuera del AI Gateway. La clave va en `ROSA_EXA_KEY` en el
`.env` del servidor (se crea en dashboard.exa.ai; 20 USD de crédito inicial y
10 al mes gratis) y viaja solo en la cabecera `x-api-key`. Exa devuelve URL:
ROSA2018 extrae el DOI de la URL cuando lo lleva y el PMID de las de PubMed; lo
demás queda como URL. Coste: 7 USD por mil búsquedas y 1 USD por mil páginas;
ROSA2018 anota `costDollars` en la pista. Lo que se envía a Exa es la consulta o
el enunciado de la hipótesis: es texto del equipo que sale a un proveedor
externo; la retención cero de datos solo está en su plan Enterprise. Pruebas
sin red en `rosa/tests/test_exa.py`.

## Grafo de evidencia: el modelo de mundo se mantiene, no solo crece (16 de septiembre de 2026, noche)

Lo que rekursiv.ai llama Trackinizer (un grafo tipado de indagaciones, cuestiones,
artefactos, experimentos y creencias con aristas con valencia), en ROSA2018 sin motor de
grafo aparte: el estado canónico ya es el grafo y lo que faltaba eran los enlaces, el
peso y las reglas que lo mantienen. Además, las cuatro propuestas de Codex.

- **Hechos con procedencia hasta la afirmación.** Cada hecho guarda `afirmacionIds`
  (las afirmaciones con fragmento y cita que lo sostienen) y `citas` al estilo Scite
  (apoya, menciona, contrasta), rellenadas desde la extracción y desde el laboratorio.
  El hecho del laboratorio enlaza su afirmación y su hipótesis por id, no por texto.
- **Sustituir, contradecir y resolver.** El paso de modelo de mundo recibe los hechos
  existentes y las cuestiones abiertas numerados, y cada hecho nuevo puede decir a
  cuáles sustituye (el viejo queda como sustituido, con `sustituidoPor`, sin borrarse
  ni tocar `actualizadoEn`), con cuáles choca (`contradiceA`, más una cita "contrasta"
  sobre el viejo) y qué cuestiones resuelve (`resuelveA`; la pregunta del modelo pasa a
  respondida). Al heredar o bifurcar, los enlaces se remapean a las copias.
- **Cuestiones persistentes** (`rosa/cuestiones.py`, lo que rekursiv llama Issues).
  Cada una tiene origen (pregunta del modelo, lo que pide el Killer, el peldaño
  siguiente de la escalera, una persona), qué la resolvería, a qué hipótesis y hechos
  toca, prioridad, historial; se deduplican por texto y por solape de palabras, se
  cierran cuando un hecho las responde, se podan al volver a una iteración, se indexan
  por significado y entran al criterio de relevancia con lo que las resolvería. La
  interfaz las enseña en la investigación ("Cuestiones abiertas") y la herramienta
  `leer_cuestiones` las expone al agente.
- **Valencia con peso y relación "socava"** (`rosa/certeza.py`, `rosa/bucle/evidencia.py`).
  Cada apoyo pesa por regla (relación, diseño del estudio, riesgo de sesgo, tamaño de
  muestra) y el techo GRADE lo usa: una fuente que solo contradice ya no suma cohorte,
  dos revisiones narrativas no llegan a baja, y si la evidencia en contra pesa tanto
  como la a favor el techo es muy baja. La relación nueva `socava` (propuesta de Codex,
  del modelo de micropublicaciones) no habla de la hipótesis sino de UN apoyo concreto
  (`socavaA`): ataca su método o su inferencia, y el apoyo socavado deja de contar.
- **Método como nodo** (`rosa/metodos.py`, propuesta de Codex). Catálogo canónico de
  cohortes, plataformas de medida y muestras con alias; sustituye la lista escrita a
  mano de cohortes del Killer y unifica las tres reglas de "misma cohorte" que había
  (priorización, certeza, Killer). ROSA2018 puede decir "todas las fuentes miden con Simoa:
  la concordancia no es independiente del instrumento".
- **Grafo materializado en el backend** (`rosa/grafo.py`). El árbol que dibuja la
  interfaz, portado uno a uno y ampliado con nodos de dato (afirmaciones con dato,
  ejecuciones, conjuntos de datos, resultados de laboratorio). El modelo de mundo que
  lee el cerebro y `leer_modelo_de_mundo` incluyen los vecinos de cada hecho (qué
  hipótesis respalda). **Profundidad hasta el dato** (propuesta de Codex): saltos desde
  cada nodo hasta la medición propia más cercana (ejecución válida, resultado de
  laboratorio, observación original) y hasta la literatura leída; el árbol se puede
  colorear por esa distancia.
- **Ataques y marcos de argumentación** (`rosa/argumentacion.py`, propuesta de Codex
  aplicada con cautela). Los ataques solo son explícitos: el juez del torneo o el
  Killer declaran que dos hipótesis no pueden ser ciertas a la vez, o dos hipótesis
  afirman la misma arista causal con signo opuesto (`signo` en `relaciones`). Con eso
  ROSA2018 calcula la extensión fundamentada de Dung y marca `conflictoCon` entre las
  candidatas al laboratorio. Marca, nunca descarta: decide la persona.
- **Fusión de ramas por torneo** (`rosa/torneo.py`, `fusionar_hipotesis`). El Killer
  anota con quién es redundante cada hipótesis (`redundanteCon`); el torneo les fuerza
  un partido dirimente y el juez dice qué son una respecto a la otra (equivalentes, una
  subsume a la otra, incompatibles), solo si lo dice igual en las dos lecturas. Si son
  equivalentes, la ganadora hereda la evidencia y la otra queda fusionada (no refutada);
  con autonomía "preguntar" es una propuesta que la persona acepta o rechaza.
- **Propagación de dependencias** (`rosa/dependencias.py`) y bloqueo
  `dependencia_pendiente`. Cuando una fuente se retracta, un hecho se sustituye o
  contradice, o una hipótesis se reformula, todo lo que dependía (hipótesis, hechos,
  planes, derivadas) queda "pendiente de revisar" y fuera de las candidatas hasta que
  ROSA2018 lo vuelve a concluir o una persona lo atiende.
- **Diff entre versiones** (`rosa/registro.py`, `frontend/src/lib/registro.ts`). Cada
  versión guardada de una hipótesis lleva qué cambió campo a campo, la certeza y el
  Elo que tenía; la ficha lo enseña ("De la v1 a la v2: cambió la cohorte") y el
  RO-Crate exporta las revisiones como `wasRevisionOf` de PROV.

## GEPA continuo (16 de septiembre de 2026)

Codex construyó el servicio de optimización automática de prompts
(`rosa/gepa_continuo.py`, documentado en `GEPA-CONTINUO.md`): captura las
trazas de cada llamada, separa entrenamiento, validación y examen final, corre
GEPA sobre un programa por ciclo y solo activa para corridas nuevas lo que pasa
el examen sin regresiones. La revisión posterior arregló lo que impedía que
aprendiera de verdad (regla de permisos que excluía la investigación principal,
puerta imposible de pasar con un juez ruidoso, comprobación cada 30 segundos
que recargaba miles de trazas, casos consumidos antes de optimizar, examen no
separado por investigación) y lo conectó con el resto: registro de aprendizaje,
arnés público, gasto contabilizado. El detalle está al final de
`GEPA-CONTINUO.md`.

## Meta-campaña del arnés (16 de septiembre de 2026, noche)

Lo que rekursiv.ai llama auto-autoresearch, con puerta. Al terminar una corrida, el
cerebro lee cómo rindió (peldaños por dólar, hipótesis en baja o más, fallidos,
lecciones, hallazgos del revisor) y propone hasta tres cambios del arnés
(`RevisarArnes`). Un criterio de revisión entra como cambio de nivel 2 propuesto y se
evalúa solo contra las decisiones humanas; **si empeora el acuerdo se revierte solo**,
si iguala o mejora queda evaluado y lo promueve una persona. Una política queda
registrada como nivel 3 para que la decida una persona. Puerta "solo mejor o igual" en
`promover_aprendizaje`: nada evaluado que empeore se puede promover, ni desde el botón.
Los prompts no se tocan aquí: la optimización de programas (GEPA) es otra pieza, en
construcción aparte.

## Rigor del trabajador de evidencia (16 de septiembre de 2026, noche)

Lo que rekursiv.ai exige a su "evidence worker" (predicción antes de mirar,
tres semillas, aceptación por regla, cadena de ejecuciones, auditoría
adversarial), en ROSA2018 así:

- **Predicción antes del dato.** Cada plan de análisis lleva "si confirma",
  "si refuta" y "si no es evaluable" (qué hará ROSA2018 en cada caso) y cada paso
  del plan de la iteración lleva "espera" y "si no aparece". Los campos entran
  en el hash congelado del plan, de modo que no se pueden retocar después de
  ver el resultado. Un paso de literatura que esperaba algo y encuentra cero
  relevantes deja una lección. En la interfaz: "Qué hará ROSA2018 según salga".
- **Tres semillas siempre.** Todo análisis completado y evaluable se repite
  con dos semillas más. La comprobación determinista `estabilidad_semillas`
  es crítica: si el p-valor principal cruza el alfa con otra semilla, la
  ejecución es `no_valido` y el análisis no cuenta como efecto.
- **Interpretación por regla.** El estado del análisis (efecto detectado, sin
  efecto detectable, no evaluable) lo fija `interpretacion_por_regla` con el
  alfa congelado, el control negativo y las repeticiones; el juez sigue
  escribiendo la lectura en llano pero su estado queda guardado como
  `estadoJuez`, no manda. Sin p-valor impreso decide el juez como antes.
- **Cadena de planes.** Un plan nuevo sobre la misma hipótesis apunta al
  anterior (`planPadre`) y dice qué cambia respecto a él (`cambioRespectoAlPadre`:
  otra cohorte, otra prueba, misma receta). El plan congelado se sella por
  RFC 3161 (`selloExterno`), igual que el prerregistro del experimento.
- **Regresión entre versiones.** Si al reformular una hipótesis una
  comprobación del Killer que pasaba en la versión anterior ahora falla,
  la decisión "avanzar" se convierte en "reformular" con el motivo delante.
- **Puerta de prerregistro.** No se asigna un experimento al laboratorio sin
  criterio de confirmación y de refutación (o el ensayo con criterios del
  esquema anterior); la interfaz y el backend aplican la misma regla y dejan
  una incidencia.
- **Puerta de publicación.** Un hallazgo grave y abierto del revisor de
  registro (en el dossier o en la última iteración cerrada) retiene la
  hipótesis como candidata: bloqueo `revision_registro_abierta`, visible en
  el ranking.
- **Réplica con su propio modelo.** El paso de replicación usa un rol
  `replica` (mismo modelo que el juez, temperatura alta, presupuesto propio),
  de modo que las trayectorias no comparten la muestra del cerebro.
- **Panel del auditor** (`rosa/evaluacion/panel_auditor.py`). Fallos plantados
  (identificador inventado, ejecución afirmada y no completada, recuento que
  no cuadra, cita sin fuente, p-valor inestable) que el revisor de registro y
  las comprobaciones deterministas tienen que detectar sin falsos positivos
  sobre un caso limpio. Corre en la suite, sin llamadas a modelos.

## Memoria de errores, progreso y traspaso (16 de septiembre de 2026, tarde)

Lo que rekursiv.ai llama aprender de los errores entre iteraciones, en ROSA2018
por regla y sin modelos:

- **Progreso y métrica** (`rosa/progreso.py`). Al cerrar cada iteración se
  guarda en la corrida una instantánea: certeza de cada hipótesis viva
  (peldaño GRADE 0 a 3), peldaños subidos y bajados, hechos e hipótesis
  nuevas, fallidos (pasos, pistas, cierres del Killer, afirmaciones
  bloqueadas) y gasto. Al terminar, la métrica única: peldaños netos por
  dólar, hipótesis en baja o más y la puntuación del banco si encaja. La
  interfaz dibuja el progreso de la investigación a través de todas las
  corridas, con banda de fallidos y marcas de cambio de arnés.
- **Parada por peldaños y por estancamiento**: "para cuando N hipótesis
  lleguen a certeza X" o "para si N iteraciones no suben nada ni añaden
  hechos", en el formulario de Nueva corrida.
- **Lecciones** (`rosa/lecciones.py`). Al cerrar la iteración se generan por
  regla: pasos y pistas fallidos con motivo y racha, consultas con cero
  resultados o cero relevantes, bases que no respondieron, hallazgos del
  revisor, hipótesis cerradas por el Killer con la comprobación que falló,
  ideas retiradas del vivero, análisis sin efecto o no evaluables,
  incidencias. Se guardan sin repetir (una repetida suma veces), se indexan
  por significado y cada paso pide las suyas antes de actuar: el
  planificador, el generador de consultas, la exploración en amplitud y el
  generador de hipótesis las reciben como entrada. La investigación las
  enseña en "Lo que ROSA2018 aprendió a no repetir".
- **Consultas previas de toda la investigación con rendimiento** (resultados
  y relevantes por consulta) en lugar de las de la corrida en curso; los
  artículos ya excluidos con claridad no se vuelven a cribar (se reutiliza el
  motivo); los hechos descartados del núcleo del modelo de mundo se eligen
  por parecido con el paso; el descarte que el Killer propone y espera a la
  persona se ve como tal; el vivero recuerda las ideas retiradas; el
  resultado del laboratorio entra al modelo de mundo como hecho.
- **Traspaso ejecutable** (`contexto.traspaso_iteracion`,
  `contexto.traspaso_de_corrida`): lo que la iteración o la corrida anterior
  deja, del registro y no del modelo (pasos fallidos con motivo, consultas
  que no rindieron, bases caídas, afirmaciones sin verificar, hipótesis
  cerradas y por qué, cambios de creencia, balance), como entrada del
  planificador; la corrida lo guarda y la interfaz lo enseña.
- El índice semántico cubre ahora también afirmaciones, lecciones,
  decisiones negativas, semillas del vivero y ejecuciones.

Pruebas: `rosa/tests/test_progreso.py`, `rosa/tests/test_lecciones.py`.

## Búsqueda en amplitud: los diamantes de al lado (16 de septiembre de 2026)

Regla de Emir y de su compañero: una ROSA2018 que solo mira la pregunta se
pierde la mayor parte de lo que hay sobre Alzheimer. Cada paso de literatura
busca ahora en dos modos:

- **Foco**: la pregunta de la corrida y el peldaño que le falta a cada
  hipótesis (lo que había).
- **Amplitud**: una parte de las consultas explora fuera de la pregunta.
  Tres clases: la **novedad del campo** (determinista: el objetivo por
  significado en Exa, acotado a los últimos 180 días), los **temas
  adyacentes** que rodean al objetivo en el mapa del modelo de mundo y que el
  árbol no cubre, y la **sorpresa** (por significado, con vocabulario distinto
  al del árbol). Las escribe el cerebro con `ExplorarAlrededor`, viendo el
  mapa del árbol, las hipótesis con su peldaño y el vivero; cada una dice en
  `porque` qué podría cambiar si aparece algo.

Lo explorado se criba con otra pregunta (`PuntuarRelevanciaAmplitud`: ¿podría
cambiar una hipótesis viva o una idea del vivero, aportar una segunda cohorte
o un contraejemplo, abrir una línea sobre el objetivo?), sin castigar que no
responda a la pregunta, con el listón un punto más bajo, y el reranker ordena
contra el objetivo y el "por qué" de la consulta. Lo que pasa se extrae y va
por la acumulación de evidencia y el vivero como todo lo demás: la amplitud
alimenta lo que ya existe, no multiplica hipótesis.

La persona elige la amplitud por investigación con tres botones en
"Configuración que ROSA2018 lee": **enfocada** (nada), **equilibrada** (un tercio
de las consultas, por defecto) y **amplia** (la mitad). Queda en
`configuracion.amplitud` (`fijarAmplitud`). Cada consulta y cada fuente
llevan su `modo`; la tabla de consultas de la corrida lo enseña, la
acumulación cuenta cuántas afirmaciones enlazadas llegaron por amplitud y
"Mientras no estabas" lo resume como "hallazgos fuera del foco". Pruebas:
`rosa/tests/test_amplitud.py`, `frontend/src/datos/amplitud.test.ts`.

## Parada propia de cada corrida (15 de septiembre de 2026, noche)

Al pulsar "Nueva corrida" se elige cuánto debe durar como mucho: horas,
iteraciones, llamadas al modelo, o una condición en palabras. La corrida se
detiene con lo que llegue primero, y la condición de parada de la
investigación sigue valiendo además. Los campos vienen rellenos con la
parada de la corrida anterior; vacíos, la corrida se comporta como antes.
Lo que se fija queda en `corrida.parada` (`rosa/parada.py`:
`normalizar_parada`, `resumen_parada`, `texto_condicion`), lo comprueba el
bucle en cada paso y al cerrar cada iteración (`_condicion_de_parada`), lo ve
el planificador como parte de la condición, y la cabecera de la corrida lo
enseña ("Se detiene con 2 horas o 6 iteraciones, lo que llegue primero"). Si
se fijan llamadas y no hay tope de presupuesto, el tope pasa a ser ese mismo
número. Pruebas: `rosa/tests/test_parada_corrida.py`, `frontend/src/lib/parada.test.ts`.

## Vivero de ideas: una hipótesis nace cuando su evidencia da para certeza baja (15 de septiembre de 2026, noche)

Regla de Emir: el valor de una corrida es cuánto suben las hipótesis que ya
existen, no cuántas nacen; y una hipótesis nueva nace cuando hay evidencia
suficiente para entrar en certeza baja, no en muy baja.

- **Regla de nacimiento** (`pasos.destino_de_propuesta`). Cada propuesta del
  generador se mide con el techo por regla sobre sus afirmaciones y fuentes:
  si da para baja (dos cohortes distintas), nace como hipótesis; si no, va
  al **vivero** de la investigación (`investigacion.vivero`) con todo lo que
  hará falta para nacer después sin volver a llamar al modelo, y con "qué le
  falta" por regla. Las hipótesis que escribe una persona no pasan por aquí.
- **Cohortes distintas con alias** (`certeza.cohortes_distintas`): "ADAD",
  "ADAD (Belder et al.)" y "Belder et al., cohorte ADAD" cuentan como una;
  una fuente sin cohorte identificada no cuenta como independiente y la
  escalera lo dice ("nombrar la cohorte puede bastar").
- **Maduración** (`evidencia.acumular_vivero`, al cerrar cada iteración): las
  ideas del vivero reciben la misma acumulación de evidencia que las
  hipótesis vivas; la que llega al listón nace (propuesta, con revisión y
  novedad pendientes) y la que pasa seis iteraciones sin ganar nada sale con
  su motivo. Tope de doce ideas.
- **El plan y las consultas ven el peldaño**: cada hipótesis viva lleva "para
  subir a X le falta Y" y sus cohortes; el vivero se lista con lo que le
  falta a cada idea. `GenerarHipotesis` pasa de 1 a 3 propuestas a 0 a 2, y
  devolver la lista vacía es la respuesta esperada cuando la evidencia
  encaja en algo que ya existe. Hipótesis vivas por misión: de 20 a 10.
- Interfaz: sección "Vivero de ideas" bajo la cola de hipótesis, con lo que
  le falta a cada una; evento «Vivero de ideas» en la línea de tiempo.

Pruebas: `rosa/tests/test_vivero.py`.

## Acumulación de evidencia y techo de certeza (15 de septiembre de 2026, noche)

Hasta hoy una hipótesis nacía con las afirmaciones y fuentes que la motivaron
y ahí se quedaba: lo que ROSA2018 leía después no se le sumaba (solo un resultado
de laboratorio o un análisis in silico), y la conclusión se rehacía al cerrar
cada iteración sobre la misma evidencia. Por eso 23 de 25 hipótesis estaban en
certeza muy baja sin moverse.

- **Acumulación** (`rosa/bucle/evidencia.py`, al cerrar cada iteración). Para
  cada hipótesis viva: candidatas entre las afirmaciones sostenidas de la
  iteración (embeddings y coseno; sin embeddings, términos clave compartidos),
  quitando las que ya tiene, las de otra entidad y las sospechosas de
  inyección; un modelo de volumen decide por población, marcador y sentido si
  cada una la apoya, la apoya de forma indirecta, la contradice o no habla de
  ella (`AsignarEvidencia`; en la duda, fuera); las aceptadas entran con su
  cita, cohorte, relación e iteración, la fuente entra en la procedencia (y
  con ella la cohorte), queda línea en el registro y evento, y la conclusión
  se rehace primero para las que ganaron evidencia. El juez, el Killer y el
  torneo ven las marcas «EN CONTRA» y «apoyo indirecto».
- **Techo por regla** (`rosa/certeza.py`). El nivel del juez queda acotado por
  lo contado: solo literatura de una cohorte, muy baja (baja si documenta un
  efecto grande); dos o más cohortes, como mucho baja; evidencia directa
  (laboratorio o análisis sobre datos reales, nunca sintéticos) de una
  cohorte, como mucho moderada; con réplica, alta. La **escalera** dice por
  regla qué falta para cada nivel, y la interfaz la enseña junto a la
  etiqueta; «muy baja» va en tono neutro como punto de partida.

Con esto, encontrar una segunda cohorte en la literatura sube una hipótesis
de muy baja a baja sin intervención; pasar de baja exige datos (un dataset
público aprobado y el análisis congelado, o el laboratorio). Pruebas:
`rosa/tests/test_evidencia.py`, `rosa/tests/test_certeza.py`.

## Conocimiento y criterio: el modelo de mundo se lee bajo demanda (15 de septiembre de 2026, noche)

La corrida 2 sobre biomarcadores y beneficio clínico juzgó la relevancia con
las preguntas abiertas heredadas de la investigación anterior (GFAP, NfL,
APOE ε4, Alzheimer autosómico dominante): Exa trajo los artículos correctos
sobre donanemab, AL002 y semaglutida y el cribado los excluyó "por ser
Alzheimer esporádico, no ADAD". Tres cambios en `rosa/bucle/contexto.py`:

- **El criterio de relevancia empieza por el objetivo y la pregunta de la
  corrida** (`preguntas_abiertas`, que reciben el reranker, el cribado, el
  generador de consultas y el extractor). Después van las preguntas abiertas
  propias por prioridad. Una pregunta heredada de otra investigación solo
  entra si nombra algo del objetivo (un nombre propio o dos términos clave),
  y va marcada «(heredada)». El conocimiento heredado sigue en el modelo de
  mundo; lo que no hereda es la decisión de qué se lee.
- **El modelo de mundo por paso** (`modelo_de_mundo_para`): un mapa del árbol
  (cuántos hechos por estado, temas, cuántos heredados y de qué
  investigación), el núcleo que entra siempre (preguntas abiertas propias y
  hechos descartados con su motivo) y, hasta el tope, los hechos más
  parecidos a lo que se hace en ese paso según el índice semántico (el plan
  recibe los parecidos al objetivo y la pregunta; el Killer, los parecidos a
  la hipótesis). Sin índice, se completa por prioridad como antes. Cada hecho
  heredado lleva `[heredado de «título»]`, siguiendo la cadena de copias
  hasta la investigación original, para que un dato medido en Alzheimer
  familiar no se use como si valiera para los ensayos en esporádico.
- **La herramienta `leer_modelo_de_mundo`** del bucle ReAct busca por
  significado con el mismo índice cuando lo hay; por texto si no.

Además, la consulta a ClinicalTrials.gov usa solo nombres propios y siglas
(`terminos_registro`) unidos con OR: antes mandaba palabras sueltas en
castellano ("mantiene precedencia GFAP", 0 estudios). Pruebas en
`rosa/tests/test_criterio_y_mundo.py`.

## Reranker, índice semántico, PubTator 3 y banco de objetivos (15 de septiembre de 2026, tarde)

Cuatro piezas que atacan lo que la revisión de la primera corrida señaló:
demasiadas llamadas de Sonnet a candidatos que no venían al caso, hipótesis
repetidas con otras palabras, aristas causales sin evidencia contada, y
ningún número que diga si un cambio mejora o empeora.

- **Reranker** (`rosa/reranker.py`). Un reranker recibe una pregunta y N
  documentos y devuelve la pertinencia de cada uno en una sola llamada; es
  un modelo pequeño (Cohere rerank-v3.5) y va por el AI Gateway como todo lo
  demás (`/v2/rerank`). ROSA2018 trae hasta 30 candidatos por consulta
  (`MAX_FUENTES_CON_RERANKER`), el reranker ordena, y Sonnet solo criba los
  12 mejores (`MAX_CRIBADO_MODELO`); los demás quedan registrados como
  excluidos "fuera del corte del reranker" con su pertinencia, nunca se
  pierden en silencio. En la novedad del Killer ordena los candidatos de
  OpenAlex y Exa antes de juzgarlos. Si el gateway no responde, ROSA2018 sigue
  como antes (cribado completo). `ROSA_RERANK_MODELO=` vacío lo apaga.
- **Índice semántico del registro** (`rosa/indice_semantico.py`). Cada
  hecho, hipótesis y fuente de una investigación se convierte en un vector
  (embedding `openai/text-embedding-3-small`, por el gateway) y se guarda en
  SQLite (`datos/_indice/<base>.db`), con coseno en numpy: no hay servicio
  aparte. Se reindexa cada 10 minutos solo lo que cambió (por hash). Dos
  usos: la **redundancia semántica** del Killer (una hipótesis nueva con
  similitud de 0,90 o más con una existente lo dice, y si la parecida ya
  está descartada con 0,95 o más, falla la prueba), y la **búsqueda por
  significado** en la búsqueda global de la interfaz (`GET /api/buscar`),
  que encuentra "astrocitos antes que axones" aunque el hecho diga GFAP y
  NfL. `ROSA_EMBEDDINGS_MODELO=` vacío lo apaga.
- **PubTator 3** (`rosa/conectores/pubtator.py`): tres conectores sin clave
  sobre la API del NCBI. `pubtator_entidad` resuelve un término a su
  identificador (`@GENE_GFAP`, `@DISEASE_Alzheimer_Disease`);
  `pubtator_relaciones` devuelve las relaciones extraídas de la literatura y
  cuántas publicaciones sostienen cada una (GFAP con Alzheimer: 343 el 15 de
  septiembre); `pubtator_literatura` busca artículos que co-mencionan
  entidades por identificador, sin depender de sinónimos. Es la evidencia
  contada para las aristas del grafo causal.
- **Banco de objetivos** (`rosa/evaluacion/banco.py`,
  `banco_objetivos.jsonl`): cinco objetivos con respuesta conocida (nombres
  propios que deben buscarse, títulos que deben aparecer, temas que no
  deberían dominar) y una puntuación de 0 a 1 por criterio sobre el registro
  de una corrida real, sin modelos: cobertura de nombres, títulos
  esperados, fuera de objetivo, y "estado honesto" (una hipótesis que el
  Killer cerró no puede aparecer como viva en el resumen). Se corre con
  `python -m rosa.evaluacion.banco <corrida_id>` después de cada cambio del
  bucle; la primera corrida real habría sacado 0 de 7 en nombres buscados.

Pruebas sin red: `rosa/tests/test_reranker_indice.py`,
`rosa/tests/test_banco_y_pubtator.py`; `rosa/tests/conftest.py` apaga el
reranker y los embeddings en la suite para que nunca salga a la red.

## Despliegue: Vercel para la interfaz, un proceso persistente para ROSA2018

El proyecto `rosa-mvp` de Vercel está hoy configurado con el preset FastAPI
y raíz `.`, es decir, para desplegar el backend como funciones sin servidor.
Eso no puede funcionar para ROSA2018: el backend es un proceso que vive (el
bucle de investigación con tareas asyncio de horas, el flujo SSE, el
trabajador de correo cada cinco segundos, el espejo de Convex) y escribe en
un SQLite local que es la fuente de verdad. Una función sin servidor es
efímera, pierde el disco entre llamadas y corta la ejecución a los pocos
minutos. La división correcta:

- **Vercel sirve la interfaz.** `vercel.json` en la raíz fija el preset Vite,
  la instalación y la construcción dentro de `frontend/` y la salida
  `frontend/dist`, por encima del preset FastAPI del proyecto. Cuando exista
  el backend público, se añade una regla `rewrites` que mande `/api/(.*)` a
  su URL: así la interfaz y la API comparten origen y la cookie de sesión
  (SameSite=Strict) sigue valiendo. Hasta entonces la interfaz desplegada
  muestra la puerta con «No se puede conectar con ROSA2018», que es la verdad.
- **ROSA2018 corre en una máquina persistente**: una VPS o un servicio de
  procesos largos (Fly.io, Railway, Render), o el equipo del servidor
  expuesto con un túnel HTTPS (Cloudflare Tunnel, Tailscale). Con HTTPS
  público, esa dirección va en «Dirección web de ROSA2018» de la configuración de
  correo, porque es la que viaja en los enlaces de acceso.

Vercel además bloquea un despliegue si el correo del autor del commit no
pertenece a la cuenta de GitHub conectada. Desde el 27 de septiembre de 2026 el
repositorio vive en la cuenta `emirmalek50` (`emirmalek50/ROSA2018`; antes
`EmirMaleckFrias/ROSA-MVP`), así que el autor se fija con
`git config user.email 327970878+emirmalek50@users.noreply.github.com`, la
dirección sin correo real que GitHub reconoce siempre como propia de la cuenta.
Un proyecto de Vercel conectado al repositorio antiguo hay que reconectarlo al
nuevo desde su panel.

## Como se investiga

1. **Nueva investigacion**: titulo, objetivo, que cuenta como relevante,
   limites, condicion de parada (si dice "N iteraciones", ROSA2018 para sola al
   llegar). Al crearla arranca la corrida 1.
2. **Plan**: ROSA2018 propone el plan de la iteracion (4 a 7 pasos con su tipo y
   su coste en llamadas) y espera. Se puede editar, reordenar o aprobar. Con
   "autoaprobar tras N segundos" no espera.
3. **Pasos**: cada paso lanza pistas en paralelo con su transcripcion en vivo.
   Literatura (PubMed, Europe PMC, preprints), ensayos (ClinicalTrials.gov),
   extraccion (Sonnet 5), verificacion (deterministas y juez Opus 5), modelo de
   mundo (GPT-6 Astra), hipotesis (generar, revisar, torneo), novedad (Open
   Targets, ClinicalTrials.gov, OpenAlex), meta-revision.
4. **Cola de hipotesis**: cada hipotesis llega con sus afirmaciones y
   veredictos, sus fuentes con pagina, sus supuestos, sus revisiones y su
   novedad. Aceptar la mete al modelo de mundo como abierta; descartar exige
   motivo; "no puedo juzgar" hace que ROSA2018 la aclare.
5. **Presupuesto**: la corrida tiene un tope de llamadas al modelo (1500 por
   defecto). Al llegar se pausa y pide ampliarlo; nunca muere en silencio.

## Estructura

```
rosa/                 backend (ver INVESTIGACION-BACKEND.md, seccion 7)
  estado/             estado canonico (misma forma que tipos.ts), reducers, SQLite
  fuentes/            PubMed, Europe PMC, Crossref, OpenAlex, Unpaywall,
                      ClinicalTrials.gov, Open Targets, PDF por pagina
  modulos/            firmas DSPy y contador de llamadas
  bucle/              supervisor, ejecutores de paso, pistas
  verificador.py      contratos de TRASPASO 4.1
  torneo.py           Elo por pares con debias
  servidor.py         FastAPI: /api/estado, /api/eventos (SSE), /api/acciones
  main.py             arranque
  tests/              pytest
frontend/             interfaz (ver frontend/README.md)
rosa.db               estado (SQLite, ignorado por git)
mlflow.db, mlruns/    corridas de GEPA (las trazas de cada llamada, en datos/_gepa)
```

## Comprobar que todo funciona

```bash
uv run python -m pytest rosa/tests -q      # reglas del dominio y verificador
cd frontend && npm run typecheck && npm test
uv run python rosa/prueba_gateway.py       # los tres modelos responden
uv run mlflow ui --backend-store-uri sqlite:///mlflow.db   # optimizaciones en :5000
```

En `frontend/`, además de `npm test` y `npm run build`, `npm run lint` corre la
regla de los hooks de React (ningún hook condicional): un hook tras un
return temprano rompe la pantalla al cambiar de estado, como pasó al arrancar
la primera corrida el 15 de septiembre de 2026.

## Documentos

- `TRASPASO.md`: decisiones, reglas de trabajo, modelos, contratos.
- `GUIA-ROSA.md`: Alzheimer, fuentes, DSPy y GEPA, evaluacion, marco legal.
- `UI-ROSA.md` e `INVESTIGACION-INTERFACES.md`: la interfaz y lo que se copio
  de otros sistemas.
- `INVESTIGACION-BACKEND.md`: los AI scientists estudiados, las APIs de las
  fuentes y la arquitectura del backend.
- `INVESTIGACION-AI-SCIENTIST-2026.md`: los quince huecos de un AI scientist
  profesional verificados contra las fuentes, con las correcciones al informe
  externo y lo que ROSA2018 tomo de cada uno.

## ROSA como asistente del proyecto (2 de octubre de 2026)

La conversación del modelo de mundo usa `rosa/asistente.py`: ROSA tiene identidad
propia, conserva el contexto del hilo y consulta todas las investigaciones, no
solo la abierta. Comparte los conectores permitidos de `rosa/herramientas.py` y
puede contar registros, buscar proteínas y leer hechos, citas, hipótesis,
corridas, planes, fuentes, datasets, memoria y el estado público del programa.
El historial de conversaciones es general: reúne los hilos del asistente y los
que se guardaron antes dentro de cada investigación. Se puede abrir cualquiera
desde el asistente o desde otra investigación, conservando su contexto y sus
acciones pendientes. Las conversaciones nuevas se guardan en el asistente
general. Al entrar o recargar ROSA se muestra una conversación nueva y vacía;
los hilos anteriores se recuperan desde «Conversaciones anteriores».
Las búsquedas devuelven el total y páginas explícitas; no confunden una página
parcial con todos los resultados. Los servicios especializados recuperan la
evidencia y los archivos del proyecto sin exponer credenciales ni rutas libres.

Para operar el proyecto, ROSA consulta el catálogo de acciones de la interfaz y
prepara un cambio con sus argumentos. La conversación muestra el cambio y los
botones para aplicarlo o cancelarlo. Solo la sesión que lo pidió puede resolverlo.
La ejecución se guarda con su autoría y su resultado, dentro de la transacción
del almacén; repetir una confirmación no repite la operación. Si el estado cambió
o una regla del dominio impide actuar, aparece «No se aplicó». Las propuestas no
se presentan como operaciones ya ejecutadas.

Ejemplos: «¿Qué hechos tiene ROSA sobre MAPT en todas las investigaciones?»,
«Inicia la investigación de GFAP», «Pausa esta corrida», «Prepara la revisión de
esta hipótesis». Para crear y arrancar una investigación nueva hace falta su
título, objetivo y condición de parada. Crear una corrida conserva las puertas
de aprobación del plan, de la evidencia y de los permisos; el asistente no las
salta.

`rosa/asistente_servicios.py` conecta la conversación con las mismas rutas que
usan las pantallas: laboratorio global, oligonucleótidos, contratos experimentales,
citas con página exacta, evidencia, PRISMA, costes, llamadas y errores, ruta
terapéutica, mapa, cifras de aprendizaje, integridad, acuerdo, búsqueda semántica
global, políticas, conectores, salud y sincronización. También puede leer las
skills y la documentación del sistema. Los resultados largos tienen paginación
y selección de campos; las páginas de un resultado comparten una instantánea
durante el turno. Una ruta nueva requiere clasificación explícita en el catálogo.

La sesión se conserva al consultar cada servicio; el asistente no obtiene una
credencial privilegiada. GEPA, gestión de cuentas, configuración de correo sin
claves, avisos, prueba de correo, sellado y reanclaje se proponen con confirmación.
Los permisos se comprueban de nuevo al ejecutar. Los servicios con efectos externos
se marcan `en_curso` antes de llamarlos: un doble clic no repite el efecto. Si se
interrumpe el servidor entre el efecto y su registro, el arranque los marca como
resultado desconocido. La conversación consulta el estado sin repetir el efecto,
guarda la comprobación y conserva la incertidumbre cuando no existe un comprobante. No se promete una
transacción atómica entre SQLite y un proveedor externo.

El chat permite adjuntar datasets o resultados experimentales mediante los mismos
endpoints de carga y procedencia. Las descargas de PDF y RO-Crate aparecen como
enlaces. `leer_dataset` solo lee contenido si el libro autoriza modelos de
terceros; de lo contrario entrega metadatos. Contraseñas y claves se introducen
exclusivamente en sus formularios de Ajustes. La pantalla del modelo de mundo
transmite su vista, filtros y selección como contexto, nunca como autorización;
no transmite la cámara ni los filtros de otras pestañas.


La entrada **Asistente de ROSA** de la barra lateral funciona incluso sin
investigaciones. Su conversación se guarda por separado, sin crear investigaciones
ficticias. Tras aplicar una operación, ROSA continúa la petición en el mismo hilo;
si falla esa continuación, se puede reintentar sin repetir el cambio. Las
continuaciones simultáneas se deduplican dentro de la transacción.

Las preguntas se conservan completas, con un límite explícito de 256 KiB por
petición (HTTP 413 al superarlo), sin la antigua cuota global de 40 preguntas.
El contexto automático incluye turnos completos hasta 60.000 caracteres y un
índice del historial; `leer_conversacion` permite recuperar el resto por páginas.
Una fuente con identificador repetido exige indicar su investigación o corrida.

Las llamadas al modelo tienen paginación con un límite de secuencia estable:
se conserva `hasta` al avanzar con `siguiente`. `consultar_dataset` recorre filas
CSV, TSV y JSON autorizadas, con columnas y filtros exactos. `consultar_gepa`
recupera trazas y evaluaciones detalladas. La documentación disponible incluye
los Markdown versionados del proyecto, sin archivos de configuración ni secretos.
`leer_documento` extrae el texto por página física de PDF y puede interpretar
figuras mediante el modelo del Gateway; esa interpretación se etiqueta como no
verificada y conserva el enlace a la página original.

Atlas y Mecanismos se calculan con las mismas funciones TypeScript de sus
pantallas. `npm run build` en `frontend/` genera también
`dist/servicios-vistas.cjs`; el servidor necesita Node para ejecutar ese cálculo.
En desarrollo puede regenerarse con `npm run build:vistas`. Si falta el cálculo,
ROSA muestra que no pudo comprobarlo, nunca un resultado vacío inventado.


La conversación global conserva el alcance de todas las investigaciones también
en las herramientas de búsqueda heredadas. **Conversaciones anteriores** permite
buscar y recuperar hilos guardados al abrir otra pestaña. **Adjuntar datos** en
el chat global pide la investigación destinataria y ofrece sus experimentos;
si todavía no existe ninguna, enlaza a la creación de una investigación.

También puedes pedir «Borra esta conversación» o «Elimina la conversación sobre
MAPT». `listar_conversaciones` identifica el hilo actual y permite buscar en todo
el proyecto. ROSA prepara `eliminarConversacion` y muestra **Eliminar conversación**
para confirmarlo; si hay varias coincidencias, debe aclarar cuál. Se borran todos
los mensajes del hilo elegido del historial y del contexto activo, incluida la
petición de borrado cuando está en ese hilo. Se conservan investigaciones, hechos,
archivos, auditoría y copias de seguridad.

El borrado detiene respuestas pendientes y guarda únicamente el ID del hilo
borrado para rechazar respuestas tardías o envíos desde pestañas antiguas. La
interfaz abre una conversación nueva sin perder el borrador. No se genera una
continuación automática después de borrar. Si una operación está ejecutándose
en ese hilo, hay que esperar a que termine para conservar su resultado.

«Elimina la investigación MAPT» prepara `eliminarInvestigacion` después de
consultar `prever_eliminacion_investigacion`. La tarjeta identifica la investigación
y cuenta sus registros; **Eliminar investigación** confirma el borrado del estado
activo, incluidas corridas, iteraciones, hipótesis, hechos y conversaciones. Los
archivos y la auditoría se conservan. Las referencias de otras investigaciones
impiden borrar evidencia que estas necesitan; nunca se borran esas investigaciones
en cascada. También se comprueba que no haya trabajo en curso, incluso si una
corrida detenida todavía está terminando una llamada.

Al borrar la investigación abierta, la interfaz pasa al asistente global. El
índice semántico excluye inmediatamente sus resultados y las respuestas pendientes
se detienen. Una pestaña antigua o una respuesta tardía no vuelven a crearla.

Las continuaciones inicializan el modelo por el Gateway cuando el servidor acaba
de reiniciar. Los PDF adjuntos autorizados comparten la lectura de documentos:
si una página no tiene capa de texto, se intenta leer visualmente, indicando su
procedencia y que esa lectura no es evidencia verificada. Un fallo visual queda
explícito y puede reintentarse.

Las tablas CSV, TSV y JSON se leen en flujo y se indexan una vez por versión en
`datos/_asistente_indices/`, con permisos locales restringidos. Las siguientes
páginas y filtros consultan SQLite. Un cambio en el archivo invalida el índice;
la autorización de procedencia se comprueba antes de cada consulta. El lector
JSON incremental usa [ijson](https://github.com/ICRAR/ijson). GEPA pagina los ciclos
separadamente con `desde_ciclos` y `limite_ciclos`; las respuestas incluyen
`siguienteCiclos`, `hasta` y `hastaCiclos` para recorrer el historial sin incorporar
las nuevas inserciones a mitad de la consulta.

### Conversaciones del laboratorio pixel art

Los 43 compañeros tienen voces propias y responden por separado al turno real
de su interlocutor. La memoria oral conserva lo que cada personaje dijo a
otros compañeros de la misma corrida e idioma, incluso entre iteraciones;
esa memoria no cuenta como evidencia. Las aperturas recientes ayudan a evitar
muletillas compartidas. Un comentario largo repetido se reformula una sola vez
y la nueva versión también pasa por el juez; las reacciones breves pueden repetirse.
No hay un banco de frases ni una secuencia obligatoria de pregunta y asentimiento.

Los autores no reutilizan respuestas de la caché de DSPy. Se conserva el muestreo
nativo de los modelos: el [catálogo del Gateway](https://ai-gateway.vercel.sh/v1/models)
no anuncia `temperature` para los modelos actuales, y la
[API de Claude](https://platform.claude.com/docs/en/api/messages/create#body-temperature)
ya no permite ajustarla en las generaciones posteriores a Opus 4.6. Las referencias,
el presupuesto y la reserva del cierre siguen siendo obligatorios. La voz v3 se
activa conjuntamente en servidor e interfaz; las conversaciones anteriores permanecen
guardadas, pero no se reproducen como si fueran nuevas.
