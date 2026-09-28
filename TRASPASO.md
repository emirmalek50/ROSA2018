# Traspaso: del RAG de FIREtech a ROSA2018, la IA del proyecto Alzheimer

Este documento existe porque la memoria de Claude Code va atada a la carpeta
del proyecto. Al cambiar de carpeta, la sesión nueva empieza sin ninguno de
los archivos ni de las memorias de la anterior. Aquí está todo lo que hace
falta para continuar. **Léelo entero antes de tocar nada en el proyecto
nuevo.** La carpeta `memoria/` de al lado contiene las reglas de trabajo de
la persona responsable tal como se guardaron; hay que copiarlas al directorio de memoria del
proyecto nuevo (`~/.claude/projects/<carpeta-con-guiones>/memory/`) para que
se apliquen desde la primera sesión.

Fecha del traspaso: 9 de septiembre de 2026. Junto a este documento está
`GUIA-ROSA.md` (10 de septiembre): el conocimiento de fondo del proyecto, el
Alzheimer a nivel de ingeniero, el investigador principal, las fuentes de
datos con sus APIs y límites, la ingeniería del bucle con la API exacta de
GEPA, la evaluación, y el marco legal y ético dominicano. Se lee después de
este. Y `UI-ROSA.md` (10 de septiembre): la interfaz de ROSA2018 tomando como
referencia la de Claude Science, patrón por patrón, más lo que ROSA2018 añade.

## 1. Quién y para qué

- **la persona responsable** (correo de empresa contacto-interno@example.invalid, solo para
  identificarlo, nunca enviarlo a servicios externos). Ingeniero de IA en
  **AI Robotix**, República Dominicana. Lleva una semana en la empresa.
- **El proyecto**: investigación del Alzheimer, alianza entre el INTEC
  (Instituto Tecnológico de Santo Domingo) y AI Robotix, anunciada en febrero
  de 2026, con respaldo anunciado del Gobierno dominicano. Investigador
  principal: el neurólogo argentino **el investigador clinico principal**. CEO de AI Robotix:
  la direccion ejecutiva. La plataforma pública ya procesó más de 232.000
  artículos y repositorios de RNA-Seq, aisló 3.223 conjuntos de datos
  candidatos, y se conecta a NVIDIA BioNeMo, Amazon Bio Discovery y Cloud
  Sciences. Fase siguiente anunciada: estudios en modelos preclínicos.
- **El equipo del agente nuevo son dos personas**: la persona responsable y un compañero que es
  a la vez ingeniero de IA, médico e investigador (él propuso a la persona responsable al jefe).
  Los programadores de la empresa no participan.
- **El sistema se llama ROSA2018.** Es la IA del proyecto Alzheimer, y lo que la persona responsable
  construye ya es ROSA2018, no un prototipo aparte: su compañero fue explícito en
  que "es parte del sistema completo, no hay individualidad, todo va de la
  mano". Cuando la persona responsable dice "el modelo" suele referirse al sistema completo, no
  a un modelo de lenguaje; los modelos del gateway son piezas intercambiables
  dentro de ROSA2018, como el índice o el juez.
- **Lo que van a construir**, según se lo explicó el compañero a la persona responsable: un
  bucle en el que ROSA2018 investiga en internet literatura del Alzheimer sin
  tiempo definido (días), acumula lo relevante y "se hace experta". Usarán
  **DSPy** y su optimizador **GEPA**. Los detalles finos aún no se los han
  dado; la persona responsable irá contando lo que le expliquen.
- **El RAG anterior** (`/Users/usuario/FIREtech-RAG`, repositorio PÚBLICO
  `organizacion-anonimizada/FIREtech-RAG`) es un asistente para una médica que
  responde solo con documentos indexados, con cita por afirmación y una
  barrera de verificación antes de publicar. Sigue en producción (despliegue
  de Convex `gregarious-pony-327`, sitio `https://rag-ai-robotix.vercel.app`)
  y **no hay que tocarlo desde el proyecto nuevo**. la persona responsable decidió que las
  piezas útiles del RAG se **portan** al proyecto nuevo, no se llaman como
  servicio.

## 2. Reglas de trabajo de la persona responsable (resumen; el detalle está en `memoria/`)

1. **Proveedor de modelos: el AI Gateway de Vercel, nunca la API de OpenAI
   directa.** La empresa cubre el gateway. Clave `vck_…` y
   `OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1`; los modelos llevan
   prefijo de proveedor (`openai/gpt-5.4`, `openai/gpt-5.4-mini`,
   `openai/text-embedding-3-large`). El gateway es multiproveedor: los
   modelos de Anthropic y otros se piden con su prefijo (`anthropic/…`) con
   la misma clave; el catálogo exacto se consulta en `GET /v1/models`. **El
   coste por token no es criterio de decisión**; se argumenta por calidad,
   latencia y capacidad. La clave está en
   `/Users/usuario/FIREtech-RAG/backend/.env` (variables `OPENAI_API_KEY` y
   `OPENAI_BASE_URL`); se lee de ahí, nunca se copia a un chat ni a un repo.
2. **La persona usuaria final es médica, no programadora.** Todo lo que deba
   hacer ella va con botones y estado visible en la interfaz, en español,
   nunca con variables de entorno, tokens ni terminal.
3. **Intentar romper el propio cambio antes de cerrarlo**: escribir el test
   adversarial, ejecutar el camino modificado de punta a punta, preguntarse
   qué asume el cambio que antes no se asumía. No concluir con muestras de
   cinco; medir con diez.
4. **Aplicar los arreglos ya diagnosticados sin pedir permiso.** Y cuando
   la persona responsable dice "arréglalo" tras una lista de hallazgos, se refiere a la lista
   entera: partirla en "estos los hago, estos los decides tú" y ejecutar solo
   la primera parte lo lee como trabajo esquivado. Si algo de verdad necesita
   su decisión, se le pregunta explícitamente y aparte, antes de empezar.
5. **Probar con preguntas humanas y ambiguas**, como las escribiría una médica
   con prisa, no con prompts perfectos. Los fallos que le importan son los
   realistas, no los conseguidos con abusos de volumen.
6. **Las referencias a documentos son genéricas** ("el PDF", "el documento de
   sistemas eléctricos"): cualquier función que resuelva una referencia debe
   contemplar el nombre, la pista genérica y la descripción por tema.
7. **Las citas resuelven a la página exacta**: un desfase de una página es un
   fallo grave, porque la usuaria lo comprueba contra el PDF.
8. **Mejorar el agente significa hacerlo más inteligente** (razonar y
   recuperar mejor), no trabajo periférico de robustez.
9. **Verificar credenciales y configuraciones empíricamente** contra el
   servicio real antes de descartarlas por su forma.
10. Higiene del repositorio: escanear antes de cada commit los patrones
    `sk-proj-`, `sb_secret_`, `vcp_`, `vck_`, `github_pat_`, `ghp_`,
    `eyJhbGci`, `eyJ2MiI6`, `ntn_`, `secret_`, `GOCSPX-`. Cualquier clave que
    aparezca en un chat se rota. Sin guiones largos (U+2014) en código,
    comentarios ni interfaz. Sin límites artificiales que hagan fallar una
    operación: si algo tarda, se enseña progreso.
11. la persona responsable habla en español coloquial dominicano ("bro", "klk", "dale"). Se le
    responde en español, directo, con el resultado aplicado y verificado, y
    diciendo con honestidad lo que no se pudo verificar.

### 2.1 Catálogo del gateway, comprobado el 9 sep 2026

Consultado `GET /v1/models` con la clave de la persona responsable: 373 modelos de 36
proveedores, entre ellos `anthropic`, `openai`, `google`, `meta`, `mistral`,
`deepseek`, `nvidia`, `cohere`, `voyage` y `perplexity`. Modelos de Anthropic
disponibles con esa misma clave: `anthropic/claude-fable-5.1`,
`anthropic/claude-fable-5`, `anthropic/claude-opus-5`,
`anthropic/claude-opus-5-fast`, `anthropic/claude-sonnet-5`,
`anthropic/claude-haiku-4.5`, y las series 4.x (opus 4 a 4.8, sonnet 4 a 4.6,
3-haiku). Es decir: **no hay que seguir con GPT por obligación**; se elige el
modelo por calidad y latencia para cada componente, y se cambia con el nombre.

### 2.2 Modelos elegidos para el agente nuevo (decisión de la persona responsable, 9 sep 2026)

**Por ahora: `openai/gpt-6-astra`, `anthropic/claude-opus-5` y
`anthropic/claude-sonnet-5`. Claude Fable 5.1 queda fuera de ROSA2018 (ver 2.3).**
El RAG anterior sigue con sus modelos
(`openai/gpt-5.4`, `openai/gpt-5.4-mini`, `openai/text-embedding-3-large`);
la decisión es para el proyecto nuevo.

Reparto decidido por la persona responsable el 9 sep 2026, a confirmar midiendo:

| Pieza | Modelo | Por qué |
|---|---|---|
| Cerebro del bucle: planificar, generar hipótesis, meta-revisión, coherencia en contexto largo | **GPT-6 Astra** | Primero en los rankings agregados de razonamiento; GPQA Diamond 96,0; Frontier Math nivel 4 97,6; ARC-AGI-2 95; y en contexto largo MRCR v2 con ocho agujas acierta el 100 % entre 256K y 512K y el 96,3 % entre 512K y 1M (Fable no publica esa cifra). Robustez documentada a inyección de instrucciones del 99,79 % y a la jerarquía de instrucciones del 99,99 %. Retención de datos "parcial" según el gateway: revisar la política antes de material sensible |
| Juez del verificador: la métrica de GEPA y el veto final, de otra familia que el cerebro | **Claude Opus 5** | Primera fila (HLE con herramientas 63,6), retención cero de datos y sin entrenamiento, y respondió las tres preguntas de biología molecular que a Fable le bloqueó el filtro de doble uso. la persona responsable había elegido a Fable 5.1 por intuición de que "acierta más que GPT", y los datos lo sostenían en conocimiento (AA-Omniscience 85 % de precisión frente a 81 % de Astra, HLE 65,0 frente a 57,2), pero Fable no puede ser juez de ROSA2018: ver 2.3. Sigue vigente la prueba comparada como jueces (Opus 5 frente a Astra) sobre casos aprobados por humanos |
| Alto volumen sin poder de veto: extractor de afirmaciones, calificador, triaje previo del juez | Claude Sonnet 5 | Nivel alto a velocidad de Sonnet, retención cero. El triaje deja pasar solo lo claramente sostenido y manda al juez lo dudoso más una muestra aleatoria de lo aprobado |
| Reserva | Claude Fable 5.1, solo si la empresa obtiene acceso verificado para ciencias de la vida | Ver 2.3 |

**Condición sobre el juez, antes de fijarlo**: prueba comparada de Opus 5 y
GPT-6 Astra como jueces sobre los casos aprobados por humanos, midiendo
acuerdo con la etiqueta humana y, por separado, cuántas veces cada uno dice
"sin verificar" cuando no sabe. No hay benchmark público de jueces con estos
modelos; los estudios de acuerdo con humanos que existen son de generaciones
anteriores y sitúan a todos los de frontera por encima del 90 %, así que la
calibración con casos humanos pesa más que la elección. La pareja Astra de
cerebro y Opus 5 de juez cumple lo que el diseño exige: familias distintas
(no comparten puntos ciegos) y un juez de primera fila.

### 2.3 Por qué Claude Fable 5.1 queda fuera de ROSA2018 (comprobado el 10 sep 2026)

la persona responsable preguntó si era cierto que "Fable 5.1 no responde nada científico". Lo
es en parte, y la parte que falla es la que ROSA2018 necesita:

- **Política de Anthropic.** Fable 5 y 5.1 llevan clasificadores de seguridad
  para capacidades de doble uso. En biología bloquean **virología,
  toxicología, diseño de fármacos y diseño molecular**, y Anthropic lo dice
  literalmente: Fable "isn't yet usable for professional biology research and
  drug development". En claude.ai una consulta bloqueada se desvía a Opus 5 y
  el usuario ve un aviso. **En la API el desvío automático no está activo por
  defecto**: la respuesta llega con un motivo de parada especial. La vía para
  investigación legítima es el programa de acceso verificado para ciencias de
  la vida (por invitación) y los programas de acceso de confianza de Mythos.
- **Medido por el gateway con la clave de la persona responsable.** De diez preguntas del
  dominio del Alzheimer, Fable respondió las de biomarcadores, mecanismo
  APOE4/TREM2, mecanismo del lecanemab, diseño de análisis de RNA-seq y una
  tarea de juez; y devolvió **vacío con `finish_reason: content-filter`** en
  cinéticas de agregación del beta amiloide, en generación de hipótesis
  mecanísticas sobre el inflamasoma NLRP3 y la propagación de tau, y en
  evidencia genética y agonistas en ensayo de TREM2 como diana (en esta
  última generó 357 tokens y los filtró). Opus 5, GPT-6 Astra y Sonnet 5
  respondieron las tres.
- **Consecuencia.** Un juez o un cerebro que devuelve vacío justo en las
  hipótesis mecanísticas y en las dianas terapéuticas rompe ROSA2018 donde más
  importa. Fable no entra en ninguna pieza de ROSA2018 mientras la empresa no
  tenga acceso verificado; si lo consigue, se reevalúa con la misma prueba.
  Y ojo con la generación de hipótesis en general: los filtros distinguen mal
  entre "diseño molecular" y "mecanismo de enfermedad", así que cualquier
  modelo con salvaguardas parecidas hay que probarlo con las preguntas reales
  antes de fijarlo, mirando `finish_reason` y el campo `model` de cada
  respuesta.

Descartados por ahora y por qué: **DeepSeek V4 Pro** (entrena con datos según
el gateway), **Gemini 3.8 Flash** (buen candidato para triaje por fidelidad y
velocidad, no elegido de momento).
Embeddings: se mantiene `openai/text-embedding-3-large` hasta medir
`voyage/voyage-4-large` con las métricas de recuperación del RAG. Rerankers
(`voyage/rerank-2.5`, `cohere/rerank-v4-pro`) como experimento para
sustituir la primera pasada del calificador, medido contra los casos.

Configuración en DSPy (endpoint compatible con OpenAI del gateway):

```python
import dspy
lm = dspy.LM("openai/anthropic/claude-opus-5",
             api_base="https://ai-gateway.vercel.sh/v1",
             api_key=CLAVE_VCK)   # la clave sale del entorno, nunca del código
dspy.configure(lm=lm)
```

El prefijo `openai/` es el de LiteLLM para "endpoint compatible con OpenAI"; el
resto es el id del modelo en el gateway. **Comprobado el 9 sep 2026**: los tres
ids responden por `POST /v1/chat/completions` del gateway con la clave de la persona responsable
(una llamada mínima a cada uno devolvió la palabra pedida y su `usage`), así
que la configuración de arriba funciona sin ningún adaptador. Los optimizadores de DSPy producen
prompts específicos de cada modelo: al cambiar de modelo se reoptimiza, así que
el arnés de comparación queda montado desde el principio.

## 3. Estado del entorno de la persona responsable

- Mac con Apple Silicon. `uv` instalado en `~/.local/bin/uv`. Python 3.12.14
  instalado por uv (`~/.local/bin/python3.12`); el Python del sistema es
  3.9.6 y **no sirve** (DSPy exige 3.10 o superior).
- Versiones en PyPI a la fecha: `dspy` 3.3.1 (requiere Python de 3.10 a
  3.14), `mlflow` 3.16.0.
- Node y `npx convex` funcionan desde `/Users/usuario/FIREtech-RAG/frontend`
  (la clave de despliegue de producción está en su `.env.local`).
- Conectores de claude.ai disponibles pero **sin autorizar** en la cuenta de
  la persona responsable: PubMed, ChEMBL, Clinical Trials, bioRxiv. Serían útiles para el
  proyecto nuevo; se autorizan desde los ajustes de conectores de claude.ai.

## 4. Lo que el RAG tiene y conviene portar

Rutas absolutas en `/Users/usuario/FIREtech-RAG/frontend/convex/`. Están en
TypeScript (Convex). El proyecto nuevo será Python (DSPy), así que "portar" es
reescribir con los mismos contratos y traer los tests adversariales.

| Orden | Pieza | Fichero | Líneas | Por qué |
|---|---|---|---|---|
| 1 | Citas y localizadores | `lib/citas.ts` | 178 | Formato de cita, patrón, clave de comparación, fórmulas de abstención |
| 1 | Núcleo determinista del verificador | `agente/verificador.ts` | 1.407 (la mitad es determinista) | Troceo en afirmaciones, resolución de citas, identificadores, cifras, ausencias puras |
| 2 | El juez del verificador | `agente/verificador.ts` (`SISTEMA`, `dictaminar`, `dictaminarEnLotes`) | | Como módulo de DSPy, optimizable contra casos aprobados por humanos |
| 3 | La crítica por afirmación | `agente/revisor.ts` (`_critica`) | 948 en total | Es el feedback textual que GEPA aprovecha |
| 4 | Comprobación de ausencias contra el índice | `agente/ausencias.ts` | 247 | Cuando exista corpus indexado en el proyecto nuevo |
| 5 | Búsqueda híbrida, términos, calificador | `search/hybrid.ts`, `search/terminos.ts`, `agente/calificador.ts` | 583 + 165 + 271 | Capa de lectura del corpus |
| 5 | Ingesta de PDF por página, contexto por fragmento | `ingesta/pdf.ts`, `ingesta/chunking.ts`, `ingesta/contexto.ts` | 1.145 + 261 + 305 | Fragmentos que no cruzan de página; contexto de recuperación |
| 5 | Retractaciones (Crossref) | `retracciones.ts` | 203 | Filtro de entrada: no construir sobre artículos retractados |
| 6 | Telemetría y gateway | `lib/telemetry.ts`, `lib/gateway.ts` | 194 + 424 | Coste y tiempo por componente; política de reintentos y de razonamiento |
| 6 | Puntuación de la evaluación | `evaluacion/puntuar.ts` | 941 | Métricas de recuperación: MRR, hit@k, precisión de contexto, atribuciones de entidad, etapa de fallo |

Documentación de referencia del RAG: `/Users/usuario/FIREtech-RAG/SPEC.md`
(la especificación completa, secciones 7 a 11 para clasificación, evidencia,
citas, verificador y barrera), `/Users/usuario/FIREtech-RAG/frontend/convex/CONTRATO.md`
(interfaces), `/Users/usuario/FIREtech-RAG/docs/OPERACION.md`.

### 4.1 Contratos del verificador que hay que conservar

- **Veredictos**: `sostenida`, `parcial`, `no_sostenida` (los tres los da el
  juez), y los deterministas `cita_no_resuelve`, `sin_cita`,
  `ausencia_refutada`, más `sin_verificar` por defecto (nunca se aprueba por
  omisión). `entidad_distinta` es una marca sobre `no_sostenida`: el dato es
  real pero de otra entidad (otro fármaco, cohorte, población, estudio).
- **Bloquean la publicación**: `no_sostenida`, `cita_no_resuelve`,
  `sin_cita`, `ausencia_refutada`. `parcial` y `sin_verificar` no bloquean
  (medido: exigir todo sostenido tumbaba 7 de cada 10 respuestas reales).
  Nunca se aprueba un informe sin ninguna señal.
- **Fidelidad** = sostenidas / juzgadas por el juez. `null` si no se juzgó nada.
- **Troceo**: la cita `[fuente, localizador]` respalda todo el tramo desde la
  cita anterior; la última frase del tramo es la dueña y se audita siempre;
  las demás se auditan contra la misma cita, salvo las declaraciones puras de
  ausencia. Varias citas seguidas son de la misma frase. Lo que queda tras la
  última cita sin cita propia es `sin_cita`. Encabezados de lista, restos sin
  letras y frases con `[inventario del índice]` no se juzgan.
- **Fórmulas de abstención** (patrones, sin distinguir mayúsculas):
  `no (?:lo |la )?encuentro`, `no (?:aparece|figura|consta)`,
  `no hay (?:evidencia|informaci[oó]n|datos)`,
  `los documentos no (?:indican|mencionan|contienen|permiten)`,
  `no (?:pude|se pudo|fue posible) comprobar`. Distinguir siempre "no está en
  los documentos" (ausencia) de "no pude comprobar" (la búsqueda o la
  comprobación no llegó): confundirlas es el error que más daño hace a quien
  investiga.
- **Ausencia pura**: casa con las fórmulas y no afirma nada de su cosecha. Lo
  que la descalifica es una cifra con forma de medida (decimal, porcentaje, o
  número tras un verbo de afirmación como fue, hubo, alcanzó) o una segunda
  cláusula (pero, aunque, sin embargo, no obstante, en cambio, mientras que,
  punto y coma). Un entero pegado a un nombre ("GEN 1", "28 Vcc", "2023") NO
  la descalifica. Antes era "no contiene dígitos" y borraba declaraciones
  honestas: nunca volver a eso.
- **Ausencia refutada**: la frase declara ausente una expresión identificadora
  (sigla en mayúsculas, nombre propio, o token con dígitos que no sea número
  pequeño suelto ni año), esa expresión no está en ningún fragmento
  recuperado, y sí aparece como palabra entera y frase contigua en un
  fragmento del alcance. Entonces la ausencia es una búsqueda que no llegó.
  Condiciones mínimas: identificadores, no palabras corrientes ("cuatro" no
  cuenta); frase contigua ("90 KVA", no "90" y "KVA" sueltos); palabra entera
  ("737" no casa en "1737"). La fórmula "no pude comprobar" no se refuta.
- **Identificadores** (NCT, DOI, rs, PMID): si no aparecen en el fragmento
  citado, `no_sostenida` determinista, sin juez. Las cifras se normalizan
  (coma o punto decimal, separadores de miles) y van al juez como pista, no
  como veredicto.
- **Literalidad con elisiones** (tanda 2, 18 sep 2026): una elisión ("...",
  "[...]") parte el pasaje en tramos que tienen que estar enteros y en el mismo
  orden en la fuente. La cifra que sigue a una elisión es un dato y se comprueba
  ("phosphorylated tau ... 181"), salvo que el texto entero demuestre que es
  numeración de líneas (una cadena ascendente en al menos tres elisiones y en
  la mitad de ellas, como en un resumen recortado de un preprint): solo
  entonces se quita antes de comparar. Un tramo que es solo una cifra de una a
  cuatro posiciones ("999 ... 3.0 (1.6)") no se comprueba suelto ni se
  descarta: bloquea con el motivo "el tramo es solo una cifra: suelta no es
  comprobable y no se da por literal", porque compacta casaría dentro de
  cualquier número más largo ("161" dentro de "1610"). Quien lea ese texto en
  un `cita_no_resuelve` sabe que el extractor copió una cifra aislada, no que
  la fuente falte (rosa/verificador.py `_es_solo_cifra` y
  `_quitar_numeros_de_linea_tras_elisiones`).
- **Entidad**: el juez recibe la pregunta y el apartado (encabezado) de cada
  frase; `entidad_distinta` solo si la otra entidad aparece en el texto o en
  el encabezado del fragmento, no solo en su contexto; las comparaciones
  explícitas están exentas.
- **Cita de PDF**: `[fuente, pág. N]`, y `pág. N-M` si el fragmento cruza de
  página (solo pasa cuando el propio párrafo lo hace). La fuente es la
  referencia corta ("Cohorte clinica, 2023") si la autoría está corroborada, si
  no el nombre del fichero; nunca el título.
- **Tres textos de abstención**: "no encuentro respaldo suficiente" solo cuando
  el borrador se comprobó y no se sostuvo; "no pude comprobar la respuesta en
  el tiempo disponible" cuando venció el reloj; "la comprobación no estuvo
  disponible" cuando el juez no dictaminó. Antes había uno solo y mentía.
- **Crítica al redactor** (`_critica`): una línea por afirmación no sostenida
  con veredicto, texto, cita y motivo; instrucciones especiales para
  `entidad_distinta` (atribuir a la otra entidad o quitar) y para
  `ausencia_refutada` (cambiar "no encuentro X" por "no pude comprobar X" sin
  contar lo que dice esa página); y por punto del plan, qué hacer con la
  evidencia no usada.

### 4.2 Otras decisiones medidas que valen para el agente nuevo

- Los fragmentos de PDF **no cruzan de página** (empaquetado por sección y
  página); el solape no arrastra la página anterior. Medido: citar la primera
  página de un fragmento de tres páginas dejaba citas desfasadas.
- **Recuperación contextual**: una o dos frases escritas por un modelo al
  indexar que sitúan el fragmento (estudio, población, biomarcador, sección).
  Entran en el embedding y en un índice léxico propio; **no son evidencia**:
  el redactor y el juez solo leen el texto original.
- **La evidencia la recupera código, no el modelo**: plan de puntos (o partes
  de una pregunta compuesta), búsqueda paralela por punto, calificador que
  lee cada candidato y da grado (directa, parcial, ninguno), fusión RRF de
  denso y léxico. El modelo solo tiene búsquedas extra acotadas.
- **Verificación anticipada**: juzgar el borrador por párrafos mientras se
  redacta; la misma frase con la misma cita y apartado recibe el mismo
  veredicto, así que se reutiliza (clave de afirmación = texto + cita +
  encabezado).
- **Presupuesto**: el turno del RAG tiene 540 s. Medido: una petición de 150
  afirmaciones dejó al redactor 383 s y la auditoría no cupo. Para un bucle de
  días, la lección es presupuesto por iteración con punto de guardado, no un
  reloj total.
- **Alcance a un documento**: la pista se resuelve por nombre y título, por
  formato si es genérica ("el PDF" con un solo PDF), y por contenido (aciertos
  léxicos con dominio: 60 % de la muestra y el doble que el siguiente) si no
  encaja ningún nombre. Si no identifica uno, se busca en todos y la respuesta
  dice de dónde sale cada dato.
- **Preguntas compuestas**: el clasificador devuelve las partes (hasta cuatro,
  con inglés) y en modo normal cada una tiene su búsqueda. Sin esto, una
  pregunta con cuatro dudas repartía diez fragmentos y declaraba ausente lo
  que el documento sí trataba.
- **Ataques que el RAG resiste**, útiles como suite de regresión del agente
  nuevo: premisas falsas con valores equivocados, cita a figura inexistente,
  cálculo no documentado, documento inexistente, entidad fuera del corpus,
  inyección de instrucciones contra las citas y contra las declaraciones de
  ausencia, extracción del prompt, porcentaje de confianza inventado,
  inundación del contexto con una falsedad repetida 120 veces con citas
  falsas, y prohibición de citar con exigencia de respaldo. Falló solo en
  volumen (150 afirmaciones) y en una ausencia falsa por ambigüedad, ya
  arreglada.

### 4.3 Casos de control

`casos_evaluacion.jsonl` (al lado de este documento): los 17 casos de control
que el RAG generó sobre el corpus de la persona responsable. Campos: `clave`, `categoria`
(single_hop, multi_hop, tabla, abstencion, entidad), `pregunta`,
`respuestaEsperada`, `definicion` (con `answer_must_contain`,
`answer_must_not_contain`, `evidence`, `critical`), `modo`, `estado`. **Los 17
están en estado `propuesto`, sin aprobar por un humano**: sirven para probar el
ciclo de optimización, no como verdad de referencia. la persona responsable o su compañero deben
revisarlos (en el RAG: Ajustes > Calidad) o escribir casos nuevos del dominio
del Alzheimer.

## 5. Lo investigado sobre el agente nuevo

### 5.1 Referencias que ya hacen lo que el compañero describe

- **Kosmos** (Edison Scientific, antes FutureHouse; artículo arXiv
  2511.02824). Corridas largas sobre una pregunta: lee unos 1.500 artículos y
  ejecuta unas 42.000 líneas de código de análisis por corrida, alternando
  literatura, análisis de datos e hipótesis; devuelve un informe con cada
  conclusión trazable al pasaje o a la línea de código. Precisión declarada
  por ellos: 79,4 % de conclusiones correctas. Innovación central: un **modelo
  de mundo estructurado** que acumula lo extraído de cientos de trayectorias
  y mantiene la coherencia durante decenas de millones de tokens. Fallo que
  reconocen: perseguir "agujeros de conejo" estadísticamente significativos
  pero irrelevantes; lo mitigan con varias corridas por objetivo. Los
  usuarios estiman una corrida en seis meses de trabajo. Avisa por Slack,
  Teams y correo; tiene API (subir datos, definir tareas en Python). Producto
  cerrado, on-prem, SOC2.
- **Co-Scientist** (Google DeepMind, publicado en Nature en 2026). Sistema
  multiagente asíncrono: generación (lee literatura y propone hipótesis),
  reflexión (revisor por pares), proximidad (agrupa y quita duplicados),
  ranking por **torneo Elo**, evolución (refina las mejores), meta-revisión
  (hoja de ruta), supervisor. Objetivo en lenguaje natural; la científica
  puede aportar ideas. Producto cerrado (Gemini Enterprise, por contacto
  comercial).
- **Ninguno hace que el modelo aprenda pesos durante el bucle.** Lo que
  aprende es el sistema: memoria estructurada con procedencia, hipótesis
  clasificadas, corpus curado. La literatura lo llama aprendizaje continuo en
  tiempo de inferencia. El ajuste de pesos es un paso aparte, al final, con
  datos curados (DSPy tiene `BootstrapFinetune` para destilar prompts en
  pesos).

### 5.2 DSPy y GEPA

- DSPy: framework de Python del grupo de PLN de Stanford, licencia MIT.
  Primitivas: **Signature** (entrada y salida), **Module** (estrategia:
  `Predict`, `ChainOfThought`, `ReAct`), **Program** (módulos compuestos),
  **Metric** (función que puntúa, mayor es mejor), **Optimizer** (compila el
  programa contra la métrica). Tú escribes los módulos, el optimizador
  escribe los prompts. Un optimizador necesita programa, métrica y datos
  (bastan 5 a 10 ejemplos para empezar).
- Optimizadores: `LabeledFewShot`, `BootstrapFewShot` (unos 10 ejemplos),
  `BootstrapFewShotWithRandomSearch` (50 o más), `KNNFewShot`, `COPRO`,
  `MIPROv2` (200 o más; bayesiano sobre instrucciones y ejemplos), `SIMBA`,
  **`GEPA`** (reflexivo: lee las trayectorias, razona en texto sobre qué
  falló, propone prompts; explota el feedback textual), `BootstrapFinetune`,
  `Ensemble`, `BetterTogether`.
- GEPA (arXiv 2507.19457): supera a MIPROv2 en más de un 10 % y al refuerzo
  (GRPO) con hasta 35 veces menos intentos; la razón que dan es que el
  lenguaje enseña más que una recompensa escalar. **Encaje con el RAG**: la
  crítica por afirmación del verificador es exactamente ese feedback textual;
  la tasa de sostenidas y la cobertura son la métrica; los casos de control
  son el conjunto de desarrollo.
- Observabilidad: MLflow con `mlflow.dspy.autolog()` registra cada
  compilación como corrida con sus evaluaciones anidadas, parámetros del
  optimizador y progresión de la métrica; la pestaña de trazas enseña paso a
  paso cada módulo. No hay que construir esa interfaz.
- DSPy usa LiteLLM por debajo; con un endpoint compatible con OpenAI se
  configura `dspy.LM("openai/<id del modelo en el gateway>", api_base=<URL
  del gateway>, api_key=<clave vck>)`. Con el gateway, el id lleva su prefijo
  de proveedor dentro (por ejemplo `openai/openai/gpt-5.4` o
  `openai/anthropic/<modelo>`); comprobarlo empíricamente con una llamada.
- **Circularidad a evitar**: el juez no se optimiza contra la métrica que él
  mismo define. El juez se optimiza contra etiquetas humanas (casos
  aprobados); el extractor de afirmaciones y el generador de hipótesis se
  optimizan contra el juez. Mantener las guardias deterministas y los casos
  con verdad conocida dentro de la métrica, para que el programa no aprenda a
  contentar al juez.

### 5.3 Arquitectura propuesta del bucle

Iteraciones cortas con presupuesto propio y punto de guardado, no una corrida
de días: planificar, buscar (PubMed, bioRxiv, Open Targets: 7,8 millones de
asociaciones diana-enfermedad con evidencia y API GraphQL gratuita), extraer
afirmaciones con procedencia, verificar, actualizar el modelo de mundo,
reordenar las preguntas abiertas, volver a empezar. Antes de la primera
iteración: qué cuenta como relevante, quién revisa, cuándo se para. Filtro de
retractaciones a la entrada. **La aprobación va antes del efecto**: una
hipótesis no entra al modelo de mundo como aceptada ni se gasta un presupuesto
grande en ella sin que alguien la haya visto (estado durable durante la
espera, pantalla de revisión con contexto, rastro de auditoría).

### 5.4 Interfaz

Lo que corre sin pantalla: el bucle, los conectores, el verificador, el
modelo de mundo, la optimización con DSPy (MLflow presta su interfaz). Lo que
sí necesita pantalla: definir el objetivo con límites y condición de parada;
ver el avance de una corrida larga y dirigirla o ramificarla; cola de
revisión de hipótesis (aceptar, descartar, refinar) con la procedencia al
lado; informe navegable con citas; explorador de la memoria (qué se sabe, qué
está abierto, qué se descartó y por qué); calidad y operación. El frontend
del RAG (React, suscripciones reactivas de Convex, pasos en vivo, panel de
fuentes con página exacta, insignia de verificación por afirmación, pestaña de
Calidad) cubre la mitad y sirve de modelo. Avisos por correo o Slack cuando
haya hallazgos que revisar, porque el bucle trabaja cuando nadie mira.

## 6. Plan acordado para el primer día

1. la persona responsable crea un repositorio y una carpeta nuevos (fuera del RAG). Pendiente:
   la ruta.
2. Entorno con `uv` y Python 3.12, `dspy` y `mlflow`; DSPy apuntando al AI
   Gateway de Vercel con los tres modelos elegidos (ver 2.2); una llamada de
   prueba con cada uno.
3. Portar la pieza 1 (citas y núcleo determinista del verificador) con sus
   tests adversariales traídos del RAG.
4. Un primer programa DSPy: extraer afirmaciones con cita a partir de
   fragmentos, con el verificador como métrica, sobre los 17 casos
   (recordando que no están aprobados). Primero `BootstrapFewShot`, luego
   `GEPA` con la crítica como feedback.
5. Copiar la carpeta `memoria/` al directorio de memoria del proyecto nuevo, y
   dejar este documento dentro del repo (por ejemplo `docs/TRASPASO.md`) con
   un `CLAUDE.md` que lo señale.

## 7. Los modelos dentro de ROSA2018, el ajuste posterior y las tres Mac

la persona responsable preguntó si importaba que los modelos del gateway no fueran "el modelo"
final; aclaró después que con "modelo" se refería al sistema completo, que es
ROSA2018, y que la empresa tiene **tres Mac de gama alta de Apple** para ROSA2018 (falta confirmar chip y memoria unificada de cada
una; la referencia de septiembre de 2026 es el Mac Studio con M5 Ultra, hasta
512 GB de memoria unificada y 1,2 TB/s, disponible en octubre en la
configuración de 512 GB). Lo acordado como flujo:

1. **Hoy los modelos del gateway son los maestros, no el producto final.** El
   diseño mantiene el modelo como pieza intercambiable (DSPy separa programa y
   modelo). Lo que se acumula y vale es independiente del modelo: el corpus
   curado, el modelo de mundo (hechos con procedencia), los casos etiquetados
   por humanos, las trayectorias que pasaron al juez, y la métrica. Todo se
   registra (MLflow) porque esas trazas son el conjunto de entrenamiento del
   futuro.
2. **Qué se entrena y qué no.** No se entrena un modelo para que "sepa
   Alzheimer": el conocimiento vive en el corpus y en el modelo de mundo, que
   se mantienen al día y se citan; meterlo en pesos lo congela y le quita la
   procedencia. Sí se entrenan comportamientos: el extractor de afirmaciones
   con cita, el juez (calibración y formato) a partir de veredictos humanos,
   un modelo de embeddings del dominio (pares de la literatura del Alzheimer:
   barato y muy efectivo), y un modelo de recompensa para clasificar hipótesis
   a partir de las preferencias humanas y de los torneos.
3. **Destilación en las Mac.** Con MLX (`mlx-lm`, `mlx-tune`) se ajustan
   modelos abiertos con LoRA o QLoRA en una sola máquina de 512 GB: un modelo
   de 70.000 millones de parámetros en 4 bits ocupa unos 40 GB, uno de
   405.000 millones en 4 bits cabe entero, y `gpt-oss-120b` (pesos abiertos de
   OpenAI, disponible también en el gateway) cabe con holgura. DSPy tiene
   `BootstrapFinetune` para destilar un programa optimizado con el maestro en
   los pesos de un alumno, y `BetterTogether` para alternar prompts y pesos.
   Orden de sustitución: primero el extractor (alto volumen, tarea acotada),
   luego el juez para material sensible (los datos no salen de la empresa),
   y el cerebro solo si supera la misma evaluación que el modelo del gateway.
4. **Lo que las Mac no hacen.** Preentrenar ni ajustar por completo un modelo
   de frontera; la pila biológica de NVIDIA (BioNeMo, Parabricks) exige CUDA;
   tres Mac no suman su memoria (no hay NVLink; el entrenamiento distribuido
   entre Mac por Thunderbolt o red es posible con MLX pero lento), así que se
   usan como tres máquinas independientes: una entrena, dos sirven (juez
   local, embeddings, rerankers, extractor).
5. **Ciclo continuo.** El bucle genera datos verificados; cada cierto tiempo
   se reajusta el alumno y se compara contra el conjunto de evaluación y los
   casos humanos, con la misma métrica que todo lo demás. Los modelos del
   gateway siguen como maestros y jueces de última instancia.


### 7.4 Sonnet nunca es el cerebro (regla de Emir, 18 de septiembre de 2026)

Cuando GPT-6 Astra no responde, ROSA2018 espera y reintenta con Astra (espera
creciente, sondeos al gateway) el tiempo que haga falta; nunca degrada el rol
de cerebro a Claude Sonnet 5 ni a otro modelo menor. Palabras de Emir: "nunca
dejes que Sonnet sea el cerebro, Sonnet no es para investigaciones de ese
nivel; que siga intentando con Astra hasta que vuelva". Esto deroga el respaldo
que hoy tiene `Ctx.llamar` en rosa/bucle/pasos.py ("si el modelo devuelve
vacío o lo bloquea un filtro, reintenta una vez con el modelo de volumen"):
para el cerebro, un filtro o una respuesta vacía se reintenta con Astra
variando `rollout_id` y, si persiste, el paso falla con incidencia clara. El
juez (Opus 5) tampoco se sustituye por Sonnet por defecto. Sonnet queda para el
rol de volumen. Aplicado el 18 de septiembre de 2026 en el bloque del
vigilante de modelos: `rosa/vigilante_modelos.py` (reintentos con el mismo
modelo, sondeos al gateway, incidencia `modelo_sin_respuesta` que ROSA2018 abre
y resuelve sola), `Ctx.llamar` en rosa/bucle/pasos.py sin respaldo al modelo de
volumen (un filtro o un vacío se reintenta con el mismo modelo variando
`rollout_id` y, si persiste, el paso falla con `modelo_bloqueado`), los
ejecutores de pasos.py, analisis.py y evidencia.py relanzan
`ModeloSinRespuesta` para que el paso se retome cuando el modelo vuelva, un
corte por tiempo con el sondeo vivo cuenta como "lento" y no como caída, y
`gateway.lm` deja `num_retries` a 0 para que el único que reintente sea el
vigilante. La guardia está en rosa/tests/test_vigilante_regla_sonnet.py.

## 8. Skills instaladas para ROSA2018 (9 sep 2026)

Instaladas a nivel de usuario en `~/.claude/skills/` con el instalador
`skills` de Vercel (`npx skills add <repo> -g -a claude-code -s <skill> -y`),
así que están disponibles en cualquier carpeta, incluida la de ROSA2018 cuando
exista. Cada fuente se vetó antes: metadatos del repositorio (licencia,
actividad, estrellas), lectura de al menos una `SKILL.md` buscando
instrucciones sospechosas (descargar y ejecutar código externo, enviar datos a
servicios no declarados, pedir credenciales, tocar ficheros fuera del
proyecto). Ninguna las tenía. Regla que vale siempre: **una skill son
instrucciones que el agente ejecuta con todos sus permisos; se revisa antes de
usarla y no se instala de repositorios sin procedencia clara.**

| Fuente | Skills instaladas | Notas |
|---|---|---|
| `intertwine/dspy-agent-skills` (MIT, 277 estrellas, activo) | `dspy-fundamentals`, `dspy-evaluation-harness`, `dspy-gepa-optimizer`, `dspy-advanced-workflow`, `dspy-rlm-module` | Validadas contra DSPy 3.2.x; la versión actual es 3.3.1, así que si algo no casa se mira el changelog antes de culpar al código. Exigen métrica con feedback textual y conjuntos de entrenamiento y validación separados, que es justo el diseño de ROSA2018 |
| `anthropics/skills` (oficial) | `pdf`, `docx`, `xlsx`, `skill-creator`, `mcp-builder`, `webapp-testing`, `frontend-design` | `skill-creator` es para escribir las skills propias de ROSA2018; `mcp-builder` para los conectores (PubMed, Open Targets); `pdf` para leer artículos |
| `Aperivue/medsci-skills` (MIT, médico investigador, paquete npm verificado) | `search-lit`, `fulltext-retrieval`, `verify-refs`, `manage-refs`, `peer-review`, `review-paper`, `deidentify`, `analyze-stats`, `meta-analysis`, `design-study`, `check-reporting` | APIs públicas sin clave (PubMed, CrossRef, OpenAlex, Unpaywall). `search-lit` prohíbe generar una referencia de memoria: toda cita sale de una búsqueda verificada. `verify-refs` audita referencias contra PubMed y CrossRef y marca las fabricadas. `deidentify` es para datos de pacientes |
| `K-Dense-AI/scientific-agent-skills` (MIT con licencia por skill, 44.000 estrellas, escáner de seguridad y tests) | `paper-lookup`, `literature-review`, `database-lookup`, `citation-management`, `hypothesis-generation`, `hypogenic`, `scientific-critical-thinking`, `primekg`, `ncats-arax`, `gget`, `pathway-enrichment`, `bulk-rnaseq`, `pydeseq2`, `scanpy`, `statistical-analysis`, `experimental-design`, `scholar-evaluation`, `markitdown`, `uncertainty-and-units`, `esm` | `paper-lookup` consulta once índices (PubMed, PMC, Europe PMC, bioRxiv, medRxiv, arXiv, OpenAlex, Crossref, Semantic Scholar, CORE, Unpaywall) con procedencia reproducible y solo biblioteca estándar. `primekg` es el grafo de conocimiento de medicina de precisión (129.000 nodos, 4 millones de aristas, se descarga de Harvard Dataverse). Se dejaron fuera a propósito las que dependen de servicios de pago o nube de terceros (`paperclip`, `exa-search`, `parallel-web`, `research-lookup`, que usa Parallel por defecto y se desinstaló tras verlo, `modal`, `tamarind`, integraciones de laboratorio) y las que chocan de nombre con las ya instaladas (`pdf`, `docx`, `xlsx`, `peer-review`) |

Para llevarlas al repositorio de ROSA2018 como skills de proyecto (versionadas
con el código) se repite el mismo comando sin `-g` desde la carpeta del repo;
`npx skills list` enseña lo instalado y `npx skills update` las actualiza.
Descartadas: `OmidZamani/dspy-skills` (redundante con intertwine),
`lingzhi227/agent-research-skills` y `luwill/research-skills` (sin licencia
declarada). Los conectores de claude.ai para PubMed, ChEMBL, ensayos clínicos y
bioRxiv siguen sin autorizar en la cuenta de la persona responsable; `search-lit` los usa si
están y si no cae a las E-utilities de NCBI.

## 9. Fuentes de lo investigado

- Mac Studio M5 Ultra: https://www.apple.com/newsroom/2026/08/apple-introduces-new-mac-studio-with-m5-max-and-m5-ultra/
- Ajuste fino con MLX: https://github.com/ARahim3/mlx-tune y https://insiderllm.com/guides/fine-tuning-mac-lora-mlx/
- Kosmos: https://advances.edisonscientific.com/research/announcing-kosmos/ y
  https://arxiv.org/abs/2511.02824
- Edison Scientific: https://edisonscientific.com/ y su API
  https://edisonscientific.gitbook.io/edison-cookbook/edison-client/docs/edison_analysis_tutorial
- Co-Scientist: https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/
  y https://www.nature.com/articles/s41586-026-10644-y
- DSPy optimizadores: https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md
- GEPA: https://arxiv.org/abs/2507.19457
- DSPy con MLflow: https://dspy.ai/tutorials/optimizer_tracking/
- Open Targets: https://platform-docs.opentargets.org/associations
- Biomni (agente biomédico abierto de Stanford, 105 paquetes, 59 bases de
  datos, 150 herramientas): https://www.epocrates.com/online/article/stanford-open-source-ai-agent-runs-biomedical-lab-research
- Proyecto Alzheimer INTEC y AI Robotix: https://www.intec.edu.do/en/notas-de-prensa-investigacion/item/intec-y-empresa-ai-robotix-generan-modelo-de-ia-para-investigar-alzheimer

## Pendientes del 16 y 17 de septiembre de 2026: estado al 18

La revisión completa de fallos está en `REVISION-BUGS-2026-09-17.md` (96
hallazgos verificados, plan en tres tandas). La tanda 1 se aplicó el 17 por la
tarde (commit de la tanda 1) y cambia el diagnóstico de varios pendientes:

- **Afirmaciones bloqueadas por "cita no resuelve" (corridas 7 a 12): resuelto,
  y la causa anotada el 16 era incorrecta.** No eran fuentes sin texto completo:
  el verificador no reconocía el localizador "texto web, parte N" del texto que
  baja Exa (875 de 875 bloqueadas) y la comparación literal contra el PDF fallaba
  con ligaduras, guiones de fin de línea y comillas (284 de 540). Ahora la cita
  se resuelve por fuente y localizador (rosa/verificador.py) y la comparación
  usa una normalización compartida (rosa/fuentes/pdf.py). Las afirmaciones
  bloqueadas de corridas pasadas no se reverifican solas; el script de solo
  lectura scripts/diagnostico_citas.py dice cuántas resolverían hoy.
- **El bucle vuelve sobre las hipótesis en cola: resuelto.** La evidencia nueva
  marca la hipótesis para que el Killer la vuelva a juzgar (62b327b); al arrancar
  y al cerrar cada iteración se marcan también las que tienen una huella de
  evidencia distinta de la de su última decisión (rosa/killer.py
  huella_evidencia); un juez que no responde ya no suspende (reintenta hasta
  tres veces); "supuestos" suspende en vez de descartar; la auditoría en
  desacuerdo tiene consecuencia; un "avanzar" posterior saca a la hipótesis de
  "en revisión".
- **Novedad "sin precedente" con cero obras: resuelto.** La consulta a OpenAlex
  sale en inglés con siglas y genes, y con cero obras o el modelo caído el estado
  es "no comprobado" (migración de las hipótesis afectadas al arrancar).
- **Reloj de la corrida, espera humana, sueño del Mac e iteración vacía:
  resuelto** (8a4eb64): tiempo de trabajo, la parada propia manda sobre la de la
  investigación, cierre sin llamadas cuando todos los pasos se omiten, y el tic
  ya no escribe el estado por segundos.
- **`hipotesisNuevas` mal contado: resuelto.** Una sola función
  `hipotesis_nacidas_en` por ventana temporal (rosa/progreso.py) en los cinco
  sitios; el resumen y el llano reciben la cola completa por regla.
- **Coste mostrado al doble: resuelto.** El gasto usa el coste que factura el
  gateway (`gasto.usdReal`) y la tabla de precios corregida como respaldo.
- **Dos procesos sobre la misma base: resuelto.** Cerrojo de instancia
  (rosa.db.lock con el PID) y escrituras condicionadas por versión
  (rosa/estado/almacen.py). Poner `ROSA_ADMIN=<correo>` en `.env`: con la regla
  nueva la primera cuenta creada ya no es administradora por orden de llegada.
  Regla del 19 de septiembre (rosa/acceso.py, rosa/servidor.py): sin `ROSA_ADMIN`
  administra la cuenta de `ROSA_LOGIN_EMAIL`, la única que puede entrar; las
  cuentas heredadas de la puerta antigua (confirmadas por enlace antes del 18)
  no administran, y `rosa.main` lo avisa por consola al arrancar.
- **Evento "hecho nuevo" duplicado: no era doble emisión**, eran hechos
  duplicados por paráfrasis (M-08 de la revisión): pendiente, tanda 2.
- **Temas focales con 0 leídos: causa distinta a la anotada.** No es el reparto
  foco/amplitud: son consultas de foco hiperespecíficas sin relajación, la red de
  seguridad por nombre apagada por una comprobación de subcadena y la caché de
  exclusiones (S-07): pendiente, tanda 2.
- **Consultas demasiado anchas (3.377 identificados)**: pendiente, dentro de S-07.
- **Hechos repetidos de corridas anteriores (Belder, Chatterjee)**: pendiente
  (M-08 y S-06, memoria de fuentes entre corridas), tanda 2.
- **`hechosNuevos` cuenta también las preguntas que entran al modelo de mundo**
  (hallado por el test de punta a punta rosa/tests/test_bucle_iteracion.py):
  pendiente menor.
- **Física del árbol** (rejilla espacial o Barnes-Hut en `paso` y `paso3d`, Web
  Worker): pendiente, tanda 3.
- **Servidor reiniciado el 18 a las 06:30 con la tanda 1 completa** (sin corrida
  viva, corrida 3 detenida antes por estar horas esperando un permiso). El
  consejo del 18 fue bien, según Emir.
- **Textos de la interfaz corregidos tras la revisión de la guía del consejo (18 sep):**
  "Por qué esta certeza" y "no escribió" (EnLlano.tsx), "midió" (Calidad.tsx),
  "corrigió" (etiquetas.ts), "lanzó" y "subió" (muestra.ts); el Killer tiene
  quince comprobaciones (rosa/killer.py), no catorce, y así lo dicen ya
  ArbolVivo, HiloDelProceso, Recorrido y glosario.ts; la cabecera del Ranking
  ya no dice "más probable que sea correcta" (chocaba con GRADE).
- **`frontend/scripts/acentuar.py` tiene dos defectos que lo hacen peligroso sin
  `--comprobar`:** rompe el espaciado de un operador ternario (`a ? b : ''` pasa a
  `a ? b: ''` en CifrasAprendizaje.tsx) y acentuaría identificadores dentro de
  plantillas de cadena (`${cuenta(cifras.iteracion)}`), y un tercero visto el
  18 al integrar la tanda 2: acentúa palabras dentro de una ruta de fichero
  (dejó "rosa/políticas.py" en la nota de Políticas de Ajustes, una ruta que no
  existe; corregido a mano en Rosa2018.tsx, y `--comprobar` lo volverá a marcar
  hasta que la herramienta salte los tramos con `/`). Hasta arreglarlo: correr
  solo `--comprobar`, o correrlo sobre una copia en un directorio temporal y
  aplicar a mano las palabras que señale. El diccionario ya incluye los
  pretéritos en -ió que se le escapaban (escribió, subió, corrigió, midió).
- **Guía del consejo** (`~/Downloads/Preparacion-consejo-ROSA2018.html` y `.pdf`,
  fuera del repositorio): revisada con cuatro lentes de agentes; la lente de
  hechos del backend no llegó a correr porque el portátil perdió la red. Las
  afirmaciones sobre el backend (GRADE, Killer, ruta, sellos, coste) quedan sin
  verificación independiente.
- **Comparar corridas antes y después de un cambio** (regla de Emir del 18 de
  septiembre: los bloques se validan por resultado, con una corrida de
  referencia y otra posterior sobre la misma investigación): `python -m
  scripts.comparar_corridas --investigacion <id> --ultimas 3` lee rosa.db en
  solo lectura y saca las mismas cifras por corrida (coste, embudo, consultas
  de foco sin relevantes, fuentes nuevas y repetidas, afirmaciones por
  veredicto y por localizador, hechos e hipótesis nuevas, peldaños,
  conclusiones rehechas). Línea base de la tanda 1: corrida 12 de la
  investigación grande, 25,7 % de afirmaciones resueltas, texto web 0/36,
  25 de 59 fuentes repetidas, 8 consultas de foco sin relevante, 0 peldaños.
  La corrida 13 (18 sep, 12:08, tope 4 h / 7 it) corre con la tanda 1 y es la
  referencia para la tanda 2.
- **Políticas nuevas de la tanda 2 en `rosa/politicas.py`** (junto a
  `MAX_CLAUSULAS_AND = 3` y `MAX_FRAGMENTOS_POR_FUENTE = 6`; el servidor las
  sirve en `politicas.resumen()` y la pantalla de Ajustes las enseña):
  `MAX_FORZADOS_POR_NOMBRE = 12` (tope de artículos que pasan al modelo sin
  reranker por nombrar el objetivo), `MAX_CONSULTAS_POR_NOMBRE_SIN_RELEVANTES = 2`
  (la red por nombre deja de insistir), `DIAS_VIGENCIA_COMPROBACION_RETRACCION = 90`
  (una comprobación de Crossref más vieja, o que no llegó, se repite), y las de
  extracción `MAX_CARACTERES_POR_LLAMADA_EXTRACTOR = 6000` y
  `MAX_PARTES_POR_FRAGMENTO = 3` (hasta 18 llamadas al extractor por fuente en
  vez de 6). Los límites viven en el código, no en el estado: cambiarlos es un
  commit.
- **Vigilante de modelos (18 sep):** cuando GPT-6 Astra (cerebro) o Claude
  Opus 5 (juez) no responden, ROSA2018 reintenta con el MISMO modelo y nunca
  degrada el rol a Sonnet (regla de Emir, sección 7.4). `rosa/vigilante_modelos.py`
  acota cada intento (`TIEMPO_AVISO_S`: cerebro 240 s, juez 300 s, volumen
  120 s, réplica 300 s), reintenta hasta `MAX_INTENTOS = 4` con esperas
  `ESPERAS_S = (15, 30, 60, 60)` sondeando el gateway (`gateway.sondear`:
  `chat/completions` con `max_tokens` 1 y 20 s, nunca lanza) cada
  `INTERVALO_SONDEO_S = 60`; un vacío o un filtro en el cerebro, el juez o la
  réplica se reintenta hasta `MAX_REINTENTOS_CONTENIDO = 2` veces con
  `lm.copy(rollout_id=n)` y, si persiste, `ModeloBloqueado` con incidencia
  `modelo_bloqueado`; un corte por tiempo con el sondeo respondiendo es "lento
  con esta petición" (tope ampliado una vez hasta `TOPE_LENTO_S = 600`), no una
  caída. Lo escribe donde se ve: incidencia `modelo_sin_respuesta` (la abre y
  la resuelve ROSA2018; no retiene la aprobación ni sale en "Algo impide
  seguir"), eventos `modelo_sin_respuesta` y `modelo_recuperado`, `saludModelos`
  en la raíz del estado (por rol: modelo, estado ok/lento/sin_respuesta, desde,
  intentos, próximo intento, última respuesta y latencia, caídas, recuperado) y
  `esperandoModelo` en la corrida. Tras agotar los intentos la corrida pasa a
  `esperando_modelo` (su tiempo va a `pausaMs`, no es espera humana), la tarea
  termina limpia y el supervisor (rosa/bucle/corrida.py) sondea desde el tic
  (`TOPE_SONDEO_S`, un sondeo en vuelo por corrida) y relanza el paso pendiente
  cuando el modelo vuelve; "Reintentar ahora" (reanudar) no espera al sondeo;
  detener o terminar la corrida borra la espera y resuelve la incidencia. Las
  peticiones de la persona, la vigilancia de literatura y el índice corren como
  tareas de fondo con tope (`_lanzar_fondo`, `TOPE_FONDO_S = 600`,
  `TOPE_PETICIONES_S = 7200`): el tic ya no las espera (la hora perdida de la
  corrida 13, 12:34 a 13:33). `gateway.lm` deja `num_retries = 0` y el contador
  registra las llamadas fallidas con `ok = 0`. Interfaz: estado
  `esperando_modelo`, tipos `EsperaModelo` y `SaludModelo`, franja de modelos
  (`VigilanteModelos.tsx`) en la corrida con el botón "Reintentar ahora", caídas
  contadas en el resumen (`digest.ts`), reloj de trabajo parado en la espera.
  Migración: `saludModelos = {}` y `esperandoModelo = None` en registros
  antiguos. Ficheros: rosa/vigilante_modelos.py, rosa/gateway.py,
  rosa/bucle/pasos.py, corrida.py, analisis.py y evidencia.py,
  rosa/modulos/contador.py, rosa/estado/acciones.py, plantilla.py y almacen.py,
  frontend/src/datos/tipos.ts y acciones.ts, componentes/VigilanteModelos.tsx,
  Resumen.tsx y HiloDelProceso.tsx, pantallas/Corrida.tsx e Inicio.tsx,
  lib/digest.ts y etiquetas.ts, styles.css; tests rosa/tests/test_vigilante_*.py
  y frontend/src/**/vigilante_*.test.ts(x). Pendientes: (1)
  `test_vigilante_llamadas_adversario.py::test_atender_peticiones_no_espera_al_vigilante_dentro_del_bucle_de_tics`
  exige que `_atender_peticiones` vuelva en menos de 0,2 s mientras
  test_tanda1_cierre.py y test_tanda1_corrida.py exigen que la misma llamada
  deje el trabajo hecho en línea: contratos incompatibles sobre el mismo
  método; el hueco real está cerrado (`correr()` la lanza con `_lanzar_fondo`)
  y el test debería medir los tics de `correr()`. (2) BarraLateral.tsx línea 70
  (fichero del bloque del atlas): excluir `modelo_sin_respuesta` de la cuenta de
  "Corrida en vivo", como hace `loQueEspera`. (3)
  vigilante_frontend_adversario.test.tsx línea 84: aserción por subcadena
  falsa ("4 intentos" dentro de "34 intentos"); cambiar a
  `not.toMatch(/(^|[^\d])4 intentos sin respuesta/)`. (4) `fijar_espera_modelo`
  anota la espera con la corrida pausada (lo exige test_vigilante_llamadas.py
  línea 395) mientras `_entrar_en_esperando_modelo` no la escribe en esos
  estados: decidir una sola regla. (5) `_atender_peticiones` reintenta en cada
  tic una petición cuyo modelo está caído (cuatro intentos por vuelta); valorar
  saltarla mientras `saludModelos[rol].proximoIntentoEn` no venza. (6)
  VigilanteModelos.tsx: enseñar la incidencia `modelo_bloqueado` con motivo
  "lento" como "lento con una petición", no como caída. (7)
  `acentuar.py --comprobar` marca `reintento` (sustantivo) en
  VigilanteModelos.tsx: falso positivo. (8) Commit y push del bloque con la
  suite pasando y el escaneo de secretos limpio.

- **El resumen en llano de la iteración se escribe antes de reconcluir (18 sep,
  visto por Emir en la corrida 13): resuelto el 19 de septiembre.** El módulo
  nuevo rosa/bucle/cierre_texto.py compara la certeza y la dirección de cada
  hipótesis viva antes y después del cierre y, si algo cambió, redacta por
  regla un párrafo ("Subió: X, de muy baja a baja") que pega al resumen, al
  llano (lista `cambios`) y al informe, y antepone `AVISO_DESFASE` cuando el
  llano afirma un nivel que ya no es el de la hipótesis que nombra (aviso por
  hipótesis, no por nivel global). Lo llama `_cerrar_iteracion`
  (rosa/bucle/corrida.py, `CIERRE.texto_del_cierre`, ~2200) sin pagar otra
  llamada al modelo. Tests: test_cierre_llano_reconclusion.py,
  test_cierre_llano_reconclusion_por_hipotesis.py y
  test_llano_adversario_19sep.py. El diagnóstico original era: en
  `_cerrar_iteracion` el orden es resumen,
  meta-revisión, `_explicar_en_llano`, acumular evidencia y después reconcluir
  (rosa/bucle/corrida.py, ~2099 frente a ~2125). Si una hipótesis sube de nivel
  en ese cierre, el texto dice "todas mantienen una certeza muy baja" mientras
  el estado ya dice "baja". Arreglo pendiente: añadir por regla, tras reconcluir,
  una frase al llano y al resumen con los cambios de certeza del cierre
  ("Subió: X, de muy baja a baja"), sin volver a pagar al modelo; o mover el
  llano detrás de la reconclusión.
- **Sala de control en vivo (candidata a la siguiente sección impactante, elegida
  por Emir como segunda opción tras el atlas):** panel de misión para la corrida
  en marcha: pulso de los tres modelos (se apoya en `saludModelos` del vigilante),
  artículos entrando al cribado como partículas, veredictos del verificador
  cayendo, comprobaciones del Killer encendiéndose, coste real y reloj de trabajo
  frente al tope. Necesita un canal de eventos más fino en el servidor.
- **Ajustes del atlas acordados con Emir (a aplicar al integrar el dibujo
  ganador del concurso):** bandeja de "no localizados" fuera del contorno (los
  registros en `cerebro_sin_region` y `neocorteza` son localizaciones fallidas,
  no lugares); color por cohortes distintas y número por registros; extremos
  numéricos en la barra de la leyenda; línea honesta bajo el mapa (cuántos
  registros en fluidos, cuántos en tejido localizado, cuántos sin localizar);
  marca de discordia donde un hecho tenga `contradiceA`; dos rayados distintos
  para "no buscado" y "buscado sin hallazgo"; ventrículos finos; "se recalcula al
  cerrar cada iteración"; y ninguna puntuación compuesta ni porcentaje de
  confianza inventado.
- **Definición de beta acordada con Emir (18 sep):** una hipótesis puede subir a
  "moderada" con datos públicos sin terminal; ningún fallo transitorio deja la
  corrida esperando a una persona; arnés de paridad Python/TypeScript en la
  suite; el Killer medido con al menos cien etiquetas humanas por comprobación;
  y nada de lo pagado se pierde (afirmaciones bloqueadas reverificadas,
  novedades de la vigilancia entrando al bucle). Los pendientes se marcan contra
  esa lista. Ver INVESTIGACION-FEATURES-2026-09-18.md.
- **Errores cerrados el 19 de septiembre (prueba de punta a punta de los
  bloques del mapa, del cierre en llano y del acceso):**
  - Aplicado el parche del fallo 5 a rosa/metodos.py: `_nombre_identificado`
    descarta un nombre de cohorte que solo dice "varias" ("multiple
    population-based cohorts", "múltiples ensayos de terapias dirigidas al
    amiloide") si no resuelve al catálogo ni a un NCT; "Multiple sclerosis" se
    conserva y "The study" sigue contando (lo exige
    test_certeza_adversarial.py). Entran en `_GENERICOS_COHORTE` "cohorts",
    "cohortes", "population-based" y los cuantificadores. El techo GRADE, el
    ranking, el Killer y el atlas vuelven a contar con la misma regla;
    rosa/tests/test_mapa_adversario_19sep.py queda en verde.
  - Los tres fallos de test_cierre_llano_reconclusion_por_hipotesis.py y el
    error de importación de test_llano_adversario_19sep.py que anotaron los
    otros bloques ya estaban cerrados por el constructor del llano al correr
    esta prueba; test_acceso_adversario_19sep.py también pasa.
  - Suite completa de Python sin deseleccionar nada: `1645 passed, 3 skipped`
    en 34,78 s, código de salida 0 (registro en el scratchpad de la sesión,
    suite_completa_19sep.log). Los tres saltados, con su motivo literal:
    test_datasets_programa.py:437 "anndata no está instalado en este
    entorno", test_rosa2018.py:210 "hay un runtime de contenedores: esta
    prueba cubre el aislamiento blando" y test_tanda1_corrida.py:701 "sin
    copia del estado real"; ninguno es un fallo.
  - Guiones largos (U+2014): ninguno en los ficheros tocados; las tres
    aserciones de ausencia de los tests del mapa pasaron a `"\u2014"` para que
    el fichero tampoco lleve el carácter.
  - Escaneo de secretos limpio: los prefijos solo aparecen en la documentación
    que describe el propio escaneo (CLAUDE.md, AGENTS.md, TRASPASO.md, memoria/).
  - `python3 scripts/acentuar_py.py --seco`: 18 ficheros cambiarían, casi todo
    falsos positivos (identificadores dentro de cadenas de código, `reintento`
    sustantivo en los tests del vigilante, palabras ya acentuadas). Un acierto
    real fuera de estos bloques: rosa/causal.py dice "planteo" por "planteó".
    No se corrió sin `--seco`.
  - Queda para quien integra: reiniciar el servidor (pid 11370, corre HEAD desde
    hace más de un día; hasta entonces no están vivos el parche de métodos, el
    cierre en llano, el 410 de la puerta sin verificar, el tope de intentos ni
    la regla del administrador); commit y push del bloque, añadiendo los
    ficheros sin seguimiento (rosa/bucle/cierre_texto.py,
    rosa/tests/test_cierre_llano_reconclusion.py,
    test_cierre_llano_reconclusion_por_hipotesis.py,
    test_llano_adversario_19sep.py, test_mapa_adversario_19sep.py,
    test_mapa_enfermedad_cohortes.py, test_mapa_enfermedad_cohortes_reparacion.py
    y test_acceso_adversario_19sep.py) junto a los modificados, rosa/metodos.py
    incluido.
  - Queda para el bloque del frontend (ficheros ajenos): `misionAprobada?:
    boolean` en frontend/src/datos/tipos.ts y su uso en Atlas.tsx para enseñar
    la misión como propuesta; usar `cohortesPorRegion` del backend en
    frontend/src/lib/atlas.ts; borrar el componente Instalacion de Acceso.tsx
    y, si se quiere, leer `accesoConfigurado` de /api/acceso/estado para
    deshabilitar el botón de entrar.
  - Decisiones abiertas que no toma esta fase: la regla "todos los tokens
    genéricos no identifican cohorte" (rompe
    test_certeza_adversarial.py::test_cohortes_en_ingles_y_en_castellano_son_la_misma);
    rellenar `fuente['metodo']` una sola vez en las 295 fuentes antiguas al
    cargar el estado (rosa/estado/almacen.py); que `metodos._nombre` lea
    también `metodo.cohorte` para que el techo y el atlas cuenten igual; si
    `_cuestiones_por_hueco` (rosa/bucle/corrida.py) debe abrir cuestiones solo
    con la misión aprobada; subir `MAX_MOTIVO` a 220 en cierre_texto.py (obliga
    a cambiar el aserto del adversario). scripts/probar_acceso_visual.py sigue
    describiendo la pantalla antigua (Playwright no está en .venv).

- **Atlas 3D de Codex, revisado el 21 de septiembre:** compila, lint limpio, 102
  tests del atlas en verde y su prueba de navegador (frontend/scripts/probar-atlas3d.mjs,
  con Vite arrancado) pasa entera. Fallos reales anotados: etiquetas huérfanas al
  girar (sin líneas guía), colores distintos del 2D (el lienzo ignora
  `color-mix`, así que caía a una mezcla lineal: por eso el LCR salía beige; la
  fórmula en código está ahora en frontend/src/lib/atlas_color.ts con test),
  sin test en la suite (solo el guion de Playwright), y un riesgo sin
  comprobar en Safari (`getTotalLength` sobre un `<path>` sin insertar en el
  documento; no hay WebKit instalado). La "superficie cerebral rosada" del
  segundo commit de Codex se retiró a petición de Emir (a192972).
- **Cambio de rumbo del atlas (21 sep, decisión de Emir):** el dibujo
  geométrico se sustituye por una ilustración anatómica real en colores
  naturales: la lámina de Patrick J. Lynch y C. Carl Jaffe (Yale, 2006,
  CC BY 2.5, https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg),
  copiada a frontend/src/datos/atlas/ con su licencia; las veinte regiones se
  retrazan sobre esa anatomía; la evidencia pasa a ser un tinte cálido sobre el
  tejido (sin violeta base); el 3D extruye la misma lámina, entra de frente
  idéntico al 2D y gira suave; crédito visible en la pantalla. El generador
  shapely de frontend/scripts/atlas/ queda obsoleto (se conserva por historia).
  Alternativas descartadas: la lámina 720 de Gray (dominio público, pero grabado
  en blanco y negro) y los esquemas coloreados de Commons (colores de escuela).
- **El cerebro en tres dimensiones de verdad (21 sep, decisión de Emir):** el
  relieve del corte, por bueno que quede, sigue siendo el dibujo sagital con
  cuerpo detrás. Emir lo dijo sin rodeos con dos imágenes de referencia:
  "literalmente el cerebro en 3d", un encéfalo entero con sus circunvoluciones,
  girable, y "rellenar esos espacios marrones sin nada vacío". Lo que se
  descartó por el camino, para no repetirlo: (a) extruir la silueta un grosor
  fijo deja una pared lisa del tamaño del cerebro, que es lo que se ve en un
  sello de goma; (b) levantar un mapa de alturas sobre el corte (hemisferio
  idealizado, faldón hasta el contorno, surcos por ondulación y luz envolvente,
  en lib/atlas_relieve.ts) sí llena esa pared con tejido y va a sesenta
  fotogramas por segundo, pero de frente casi no se distingue del 2D y de lado
  solo se ve el canto: no es un cerebro. Se queda como paso intermedio mientras
  llega el modelo.
  El camino bueno, ya construido a falta de los datos: una MALLA ANATÓMICA por
  estructura, con licencia comprobada, pintada con WebGL. Las piezas nuevas son
  lib/matriz4.ts (cámara en órbita, perspectiva, matriz de normales, encuadre;
  ocho pruebas), lib/cerebro_malla.ts (formato binario R2M1: marca, número de
  vértices y de triángulos, banderas, posiciones, normales e índices, más el
  indice.json con crédito, licencia, ejes y caja por estructura; seis pruebas) y
  componentes/Cerebro3D.tsx (luz difusa con relleno, luz de borde y brillo corto,
  selección leyendo el color de un pase invisible, y la corteza translúcida al
  señalar una estructura profunda como el hipocampo). La pantalla del atlas ya
  pregunta por hayModeloCerebro(): si el modelo está en src/datos/cerebro3d, la
  vista 3D es el cerebro; si no, el relieve del corte. La vista 3D es además la
  que abre por defecto, a petición de Emir.
- **El cerebro anatómico ya está (21 sep, noche):** las mallas salen de
  BodyParts3D 4.0 (DBCLS, Japón, CC BY 4.0, atribución literal en
  frontend/src/datos/cerebro3d/LICENCIA.md y en pantalla). Diecisiete
  estructuras, cada una compuesta de los giros de BodyParts3D que le tocan
  (tabla en frontend/scripts/cerebro3d/estructuras.py, correspondencia con los
  OBJ en procedencia.json), unos 224.000 triángulos y 5,3 MB en total, en el
  formato R2M1 de lib/cerebro_malla.ts. Se regeneran con
  frontend/scripts/cerebro3d/generar.py a partir del zip original (136 MB, no
  se guarda; su SHA-256 está en procedencia.json). Lo que la fuente no tiene:
  el bulbo olfatorio; el precúneo va dentro del parietal; la corteza entorrinal
  se enseña como giro parahipocampal; la barrera hematoencefálica es el árbol
  arterial. Tres claves nuevas sin evidencia del atlas (corteza
  sensitivomotora, ínsula, cuerpo calloso) se pintan en tejido. Lo comprobado
  en Chromium con el estado real: carga, luz, giro, señalado por color y el
  cerebro abierto al mirar el hipocampo (todo fantasma y el hipocampo entero,
  como una radiografía). Sin GPU (SwiftShader) va a unos 180 ms por fotograma;
  con la tarjeta de la Mac tiene que ir suelto, y hay que mirarlo ahí. Con el
  modelo instalado, lib/atlas_relieve.ts y componentes/Atlas3D.tsx quedan solo
  como respaldo si alguien borra la carpeta del modelo.
  Pendientes anotados: el lienzo del cerebro sigue oscuro en tema claro; el
  peso de 5,3 MB se descarga entero al abrir el atlas (comprimir en el servidor
  o cargar por demanda); etiquetas con nombre sobre el cerebro; y el corte
  sagital dentro del 3D (enseñar la lámina de Lynch como plano de corte).
- **La siguiente sección interactiva es el mapa causal ("Mecanismos"),
  decisión de Emir del 21 sep:** el árbol dice qué se investiga, el atlas
  dónde, y esta el porqué. Los datos ya viajan al navegador (el grafo causal
  local por hipótesis con aristas tipadas y la identificación por regla, de
  rosa/causal.py, con la base curada del marco ATN) y hoy no se ven en ninguna
  pantalla. Boceto acordado en ~/Downloads/boceto-mecanismos.png: mapa por
  capas (factores, patología, daño, marcadores y desenlace), el camino que
  afirma la hipótesis en ámbar con el grosor por afirmaciones sostenidas, lo
  supuesto en punteado, el consenso del campo en tenue, las amenazas
  (confusor, causa inversa, artefacto) cruzando en rojo, y al pulsar una
  flecha la evidencia con su cita a la página; panel con el veredicto
  (identificable, acotado, sin resolver) y los supuestos que faltan. Después,
  el torneo de hipótesis en vivo como cuarta.
- **Cerrado el 22 sep de madrugada, tras dos quejas de Emir sobre el cerebro:**
  "no salen los nombres de las cosas, tampoco las demás cosas del 2D
  (plasma, sangre)" y "tiene algunos parpadeos raros". Los nombres van en un
  lienzo plano encima del de WebGL, repartidos en dos columnas sin pisarse y
  con guía hasta la estructura (lib/rotulos3d.ts, probado): las de dentro
  solo se nombran con el cerebro abierto. Los tres compartimentos de fuera son
  cuerpos generados por código (lib/formas3d.ts: esfera, sólido de revolución,
  tubo con transporte paralelo; probados por volumen con signo): el globo
  ocular con su iris delante de los frontales, y la gota y el tubo debajo, la
  gota delante y el tubo detrás para que no se tapen de lado; reciben el tinte
  de la evidencia como el resto y la leyenda dice que son esquemáticos. El
  parpadeo era la selección por color: se pintaba en el lienzo visible y se
  repintaba al fotograma siguiente; ahora la escena de verdad se vuelve a
  pintar en la misma tarea, así que la copia de colores nunca se presenta. La
  carga ya no enseña las piezas una a una: espera a todas y entra girando.
- **Los nombres del cerebro 3D, segunda vuelta (22 sep):** las dos columnas
  con guías largas hasta los bordes le parecieron a Emir "horribles, ni ganas
  dan de leerlos". Ahora cada nombre va pegado a su estructura, desplazado
  hacia fuera del centro del cerebro con una guía corta y un punto en el
  ancla, letra de 13 px con halo del color del fondo, y si pisa a otro se
  aleja por su radio y por un abanico de ángulos hasta que cabe
  (lib/rotulos3d.ts, cinco pruebas). Con el cerebro abierto se nombra también
  lo de dentro y queda denso pero legible.
- **Tercera vuelta del cerebro 3D (22 sep), tras "no sé bien cuál es cuál,
  está lioso":** el problema era que todo el cerebro iba del mismo rosa y
  había diez nombres encima. Ahora cada región lleva su tono de tejido
  (paleta natural pero distinta por lóbulo, como en los atlas), en la escena
  solo se nombran las estructuras con evidencia y la que se señala, y debajo
  del lienzo hay una fila de chips con el punto de color de cada estructura:
  pasar el ratón la enciende entera en ámbar con su nombre, pulsar abre su
  ficha. Es el patrón de los visores anatómicos serios (BioDigital: la
  estructura elegida se ilumina y su nombre sale al tocarla; el resto se
  navega por una lista). Los ojos llevan córnea que asoma dos milímetros,
  pupila y nervio óptico hasta el quiasma: sin nervio parecían bolas de
  billar. Los rótulos no entran en la franja de los botones.
- **Qué secciones interactivas vienen después (22 sep):** investigación en
  `INVESTIGACION-SECCIONES-2026-09-22.md`, cruzando tres fuentes: las
  herramientas de referencia comprobadas página a página (cinco informes con
  URL por afirmación, copiados a ~/Downloads/informes-secciones-rosa2018), una
  auditoría de solo lectura de qué datos tiene ya cada candidata con fichero y
  línea y los recuentos reales de rosa.db, y el criterio del plan del sistema
  (nivel 5 de evaluación: reconstruir y cuestionar decisiones; "a visually
  clear report is not an independent scientific success measure").
  El hallazgo que ordena la lista: de diez herramientas de literatura, ninguna
  resuelve la cita a la página exacta del PDF; las mejores llegan al fragmento.
  Es la regla no negociable de ROSA2018 y hoy no se ve en pantalla.
  Orden recomendado: mesa de la Killer (2 a 3,5 días, 59 decisiones ya en el
  estado), escalera de certeza GRADE (3 a 4, las 28 conclusiones listas), visor
  de citas a la página (5 a 7, hace falta endpoint de PDF); después PRISMA,
  torneo y línea de tiempo, que son baratas y tienen datos; luego sala de
  control y grafo del modelo de mundo; al final las que dependen de datos que
  aún no existen (etiquetado a ciegas con 0 etiquetas, procedencia con 0
  sellos, costes sin hipótesis en la tabla de llamadas, ensayo en seco con 0
  registros). Cuatro dudas para Emir al final del documento.
- **Visor de citas a la página exacta (22 sep), primera de las secciones
  nuevas.** Emir lo aprobó desde un boceto ("no se ve mal, hazlo"). El hallazgo
  que lo justifica está en INVESTIGACION-SECCIONES: de diez herramientas de
  literatura, ninguna resuelve la cita a la página del PDF; ROSA2018 ya lo hacía
  por dentro y no se veía.
  Backend: `rosa/citas.py` localiza el pasaje DENTRO del texto de la página y
  devuelve los tramos a resaltar en coordenadas del texto original. Compara por
  palabras con su posición (NFKC más la normalización del verificador), parte
  el pasaje por elisiones y exige cada tramo en orden, y salta las palabras que
  son solo un número (los números de línea de los preprints). Cuando un tramo
  no está, lo devuelve: eso es el motivo del veredicto. El texto no se relee
  del PDF, se usa el que guardó el verificador. Tres endpoints nuevos en
  `rosa/servidor.py`: lista, ficha y PDF; el PDF solo se sirve si la ruta cae
  dentro de config.DIR_PDFS, porque la ruta viene del estado y el estado no
  decide qué ficheros publica ROSA2018. Quince pruebas del módulo y tres del
  servidor.
  Frontend: `lib/citas.ts` (tipos y reparto del texto en trozos marcados, nueve
  pruebas), `pantallas/Citas.tsx` y `citas.css`, con ruta, entrada en la barra
  lateral y esqueletos. La hoja se desplaza sola hasta el primer resaltado. El
  panel de abajo enfrenta lo que dijo ROSA2018 con el veredicto del verificador
  y su motivo; si falta un tramo, sale tachado en rojo. Lo que no tiene página
  (resumen, sección, texto web) lo dice con esas palabras y no inventa una.
  Cifras reales de la corrida 16: 609 afirmaciones, 41 con página exacta, 350
  de texto web, 145 de resumen y 73 de sección.
  PENDIENTE AL REINICIAR: el servidor vivo arrancó antes que estos endpoints,
  así que la pantalla dirá "no pude comprobar las citas" hasta el primer
  reinicio. No se reinició porque la corrida 16 está en marcha (regla de Emir).
  Para la prueba se levantó una instancia aparte en el 8799 sobre una copia de
  la base, ya cerrada.
- **Las dos señales de una cita, y un hallazgo gordo (22 sep).** Revisando el
  visor, Emir señaló una contradicción visible: una tarjeta decía "la cita no
  resuelve" y a la vez que el pasaje estaba literal en la fuente. Tenía razón y
  el diagnóstico era exacto: se estaban colapsando dos preguntas distintas en
  una sola etiqueta. Ahora van separadas en pantalla y en `rosa/citas.py`
  (`comprobacion_de_hoy`): (1) si la cita APUNTA a un sitio que existe (fuente
  más localizador) y (2) si el pasaje ESTÁ ahí, literal. Se pueden dar las
  cuatro combinaciones.
  Al investigar la causa apareció algo mayor: esos veredictos son de cuando se
  extrajo la afirmación, con el verificador de entonces. Pasando las 609
  afirmaciones de la corrida 16 por el verificador de HOY (410 ms, cero
  llamadas a modelos): 151 de las 157 que estaban en `cita_no_resuelve`
  resuelven, más 14 `no_sostenida`; en total 166 bloqueos que ya no se
  sostienen. Casi todos son citas a "texto web, parte N", el localizador que
  llegó con Exa. La pantalla lo marca con un chip "hoy resolvería", tiene un
  filtro para verlas y lo dice en la cabecera; NO reescribe el veredicto
  guardado, porque para pasar a sostenida hace falta el juez, que cuesta
  llamadas. Esto es exactamente la prioridad 5 de INVESTIGACION-FEATURES
  ("recuperar las afirmaciones bloqueadas, la mitad gratis") y ahora se ve.
  La pantalla también aguanta un servidor anterior que no mande las señales:
  lo dice en una línea en vez de romperse (se rompió una vez en pruebas).
  ERROR MÍO QUE NO SE REPITE: reinicié el servidor con la corrida 16 en marcha.
  La comprobación previa lo decía y aun así encadené el parón en el mismo
  comando sin leer su salida. Cerró limpio en 20 s y la corrida reanudó sola
  (iteración 1, 6 de 7 pasos), pero la regla es no hacerlo: comprobar, LEER la
  respuesta, y solo entonces parar.
- **El enlace lleva al pasaje, no al documento (22 sep, petición de Emir:
  "que cuando le des a ver cita te lleve literalmente al texto").** En
  `lib/citas.ts`, `enlaceAlPasaje` construye la dirección según la fuente: un
  PDF se abre en su página con `#page=N`, que es lo que entienden los visores
  de los navegadores, y una página web usa un FRAGMENTO DE TEXTO
  (`#:~:text=inicio,fin`), con lo que el navegador baja solo hasta el pasaje y
  lo resalta. Con pasajes largos se dan los dos extremos, seis palabras cada
  uno; con uno corto, el pasaje entero; las comas y los guiones se escapan
  porque significan otra cosa en esa sintaxis. Solo se ancla a la dirección
  que ROSA2018 leyó de verdad. Donde el navegador no entienda el fragmento, o
  donde la página haya cambiado, se abre por arriba, y la pantalla lo avisa en
  una línea. Comprobado contra el servidor real: el botón sale como "Ver la
  cita en el PDF, página 3" y apunta a `.../pdf#page=3`; el PDF se sirve
  (1,8 MB). En la corrida 16, las 481 afirmaciones de texto web traen su
  dirección propia.
- **Dos correcciones tras una revisión externa (22 sep).** Emir pasó el arreglo
  de las citas por otra instancia de Claude, que encontró dos cosas, las dos
  ciertas:
  1. **La cuenta estaba inflada.** El chip decía "hoy resolvería" cuando las
     dos señales de la CITA estaban bien, pero el verificador comprueba más
     cosas: los identificadores que la afirmación nombra y las ausencias que
     declara. Medido en la corrida 16: 185 con la cita en orden, pero solo 183
     que el verificador de hoy ya no bloquearía. Las dos de diferencia siguen
     caídas, una porque cita el ensayo NCT04592874 que no aparece en el
     fragmento y otra porque declara ausente KISUNLA, que sí está en la fuente.
     Ahora `bloquea_hoy` usa el verificador entero, el chip dice "ya no
     bloquearía", y la ficha explica el caso intermedio ("la cita está en
     orden, pero sigue bloqueada por..."). Los identificadores de las dos
     listas quedaron exportados para poder auditarlas.
  2. **El reinicio con corrida viva era un near-miss, no un descuido.** La
     regla estaba escrita y se comprobó; el agente obtuvo "la 16 está en
     marcha" y siguió. Una regla que quien la ejecuta puede razonar y saltarse
     no está implementada. Ahora es `scripts/parar_servidor.py`, que lee la
     base en solo lectura, se niega con cualquier estado vivo, sale con código
     2 sin mandar ninguna señal, y trata "no pude leer la base" como motivo
     para no parar; `scripts/reiniciar_servidor.sh` no arranca nada si la
     parada no se completó. Quince pruebas, incluidas las de forzar (exige
     motivo escrito) y las de que un fallo de lectura bloquea. En CLAUDE.md.
  Qué se arriesgaba de verdad, medido en el código y no supuesto: el estado NO
  se corrompe (cada cambio es una transacción con hash encadenado) y lo ya
  hecho NO se repite (el bucle escribe por unidad terminada, con sus marcas);
  lo que se pierde es el trabajo en vuelo de la unidad en curso, con sus
  llamadas ya pagadas. Y si dos procesos escriben a la vez, el registro se
  bifurca: ya pasó el 15 de septiembre y la comprobación de integridad lo
  detecta y lo nombra. El reinicio del 22 de septiembre NO dejó rotura: la
  única de la cadena sigue siendo la del 15.
- **Reverificar de verdad, y que el enlace lleve al texto (22 sep, Emir: "si
  necesita del juez se le llame y ya, no que salga ROSA con que el juez cuesta
  llamada").** Dos cosas:
  1. **Botón "Reverificar".** `rosa/citas.py::reverificar` vuelve a pasar las
     afirmaciones que hoy ya no bloquearían por `PASOS.verificar_afirmaciones`,
     el MISMO camino del bucle: deterministas y, para las que las pasan, el
     juez. Escribe el veredicto nuevo, gasta del presupuesto de la corrida y
     queda en el registro de llamadas. Endpoint
     `POST /api/corridas/{id}/citas/reverificar`; el servidor necesita los
     programas y los modelos, así que `main.py` le pasa el supervisor por
     `app.state`. Se niega si la corrida está trabajando (dos manos sobre las
     mismas afirmaciones). Fuera los avisos de "cuesta llamadas": el botón lo
     hace y cuenta el resultado.
  2. **El enlace lleva al texto siempre que haya manera.** Antes, 407 de 1091
     afirmaciones de la corrida 16 solo abrían la ficha del artículo, porque
     citaban el resumen y no se anclaba sin dirección leída. Ahora se ancla
     también por doi o PubMed (el resumen suele estar en esa página) y en los
     PDF el ancla lleva además `search=` con las cinco primeras palabras del
     pasaje, así que el visor abre la página Y marca el texto. Reparto actual:
     762 al texto con salto y resaltado, 203 al PDF en su página buscando el
     pasaje, 126 sin destino (fuentes sin doi, sin PubMed y sin dirección).

## Por qué "ver la cita" abría la página sin marcar nada (22 de septiembre de 2026)

Emir: "cuando le doy a ver cita en la fuente solo me abre la pagina pero no el
texto marcado". La causa no era el pasaje, ni la página, ni el enlace: es que
**el visor de PDF de Chrome no sabe resaltar**. Su analizador de parámetros de
apertura (`chrome/browser/resources/pdf/open_pdf_params_parser.ts`) lee
`nameddest`, `navpanes`, `page`, `toolbar`, `view` y `zoom`, y nada más; la
cadena `search` no aparece en el fichero. ROSA2018 mandaba `#page=N&search=...`,
así que el navegador abría por la página buena y tiraba la búsqueda sin avisar.
El síntoma era exactamente el que describía Emir.

Lo que se hizo: como el PDF lo sirve ROSA2018, la marca la pone ROSA2018.
`rosa/citas.py` renderiza la página con el pasaje pintado encima
(`pagina_marcada`) y el servidor la da en `GET
/api/corridas/{id}/citas/{af}/pagina.png`. La pantalla de citas la enseña
dentro, con un conmutador entre "Texto leído" y "Página N del PDF".

La regla del resaltado es la MISMA que la del panel de texto: los mismos tramos
por elisión, la misma normalización y el mismo `_buscar_tramo`, solo que sobre
las palabras del PDF con su rectángulo en vez de sobre posiciones de una
cadena. Medido sobre las 203 citas con PDF de la corrida 16: **la marca del PDF
y la del texto coinciden en 203 de 203**, 173 marcadas y 30 sin marcar (las 30
son citas que el panel de texto tampoco resuelve, o sea citas malas de verdad).
Coste: 88 ms de mediana por página, 314 KB de mediana por imagen, y solo se
pide si se pulsa.

Tres decisiones que conviene conservar:

- Una página sin el pasaje **se enseña igual**, sin marca y diciéndolo. Es lo
  que permite discutir el veredicto; esconderla, no.
- Un PDF roto (`PdfIlegible`, 422) no es un PDF que falta (404). Si se juntaran
  las dos cosas, un fallo quedaría escondido detrás de una ausencia.
- Un número de página que no cae dentro del PDF no dice dónde mirar: se busca
  el pasaje por el documento en vez de enseñar la primera página y callarse.

### Lo que se midió sobre el salto en páginas web, y una hipótesis que era falsa

De las 1091 citas de la corrida 16: 203 con PDF, 888 web (126 sin ninguna
dirección a la que ir, 470 a doi.org, 249 a alzforum, el resto a
clinicaltrials, pubmed y pmc).

Se probó el salto contra las páginas de verdad con un navegador. Resultados que
conviene no volver a investigar:

- **El fragmento de texto funciona**, y `page.goto` lo activa: control en
  Wikipedia, `scrollY` 0 -> 32242. La selección del DOM sale siempre vacía
  (Chrome usa `::target-text`, no una selección), así que **no sirve** para
  detectar el salto; hay que comparar `scrollY` con y sin fragmento.
- **La hipótesis del apóstrofo era falsa.** Parecía que "Alzheimer's" (U+0027)
  guardado no casaría con "Alzheimer’s" (U+2019) de la página, porque
  `innerText.includes()` fallaba ahí. Pero el navegador **salta igual**: su
  comparador normaliza esas diferencias, al revés que una comparación de
  cadenas a pelo. Comprobado en medRxiv, que pinta el rizado.
- **Los 403 de PubMed, PMC y Alzforum eran del robot**, no del enlace: con un
  agente de usuario y cabeceras de navegador de verdad, Alzforum responde 200 y
  salta. No son un problema para Emir, que navega con su navegador.
- Lo que sí no puede funcionar: **ClinicalTrials.gov** (es una aplicación que
  pinta el texto después de la carga, y esa ficha además da error) y las 470 de
  **doi.org**, que redirigen a la página del editor, a menudo de pago, donde el
  pasaje no está en el documento.

Con eso, el ancla web se cambió de un rango `inicio,fin` a **un solo trozo
tomado del principio del pasaje**: el rango exige que casen los DOS extremos y
basta que falle uno para que no se resalte nada. Sobre páginas reales los dos
saltaban igual, así que **esto es tolerancia, no un arreglo**, y así está
escrito en el código para que nadie lo lea como la causa del fallo de Emir.

## Mecanismos, la tercera pantalla de estructura (22 de septiembre de 2026)

Emir pidió una tercera sección al nivel del Atlas y del Árbol. El hueco era el
eje que faltaba:

- **Atlas**: el **dónde** (espacio, el cuerpo).
- **Árbol**: el **de dónde** (linaje de las hipótesis).
- **Mecanismos**: el **por qué** (la cadena causal, y qué la rompe).

No hay endpoint nuevo. Cada hipótesis ya trae su `grafoCausal`, lo calcula
`rosa/causal.py` sin modelo y ya viajaba al navegador dentro del estado. La
pantalla junta los 21 grafos de la corrida 16 para dibujar la cascada del campo
una sola vez, con los nodos de cada hipótesis encima.

Lo que la hace herramienta y no adorno: **se puede encender un supuesto que hoy
falta y ver el veredicto recalculado**, por la misma regla del servidor
(`identificable` si no falta nada, `acotado` si falta algo y se cumple algo,
`sin_resolver` si no se cumple nada). La pantalla avisa de que eso es una
pregunta y no un resultado, y sigue enseñando lo que ROSA2018 tiene guardado.

Lo medido sobre la corrida 16, que es lo que la pantalla enseña:

- 21 hipótesis con grafo: **4 identificables, 17 acotadas**, ninguna sin resolver.
- 294 aristas: **118 supuestos, 176 consenso del campo y CERO sostenidas por
  evidencia propia**. Eso no se esconde: sale en un aviso arriba, y la leyenda
  pone "(0 en esta corrida)" en rojo. Que el contador esté a cero es el dato.
- Supuestos: **Ajuste por confusores falta en 16 de 21**, Replicación
  independiente en 9 de 21, Temporalidad solo en 1 de 21.

### Tres fallos de datos que aparecieron al construirla

**1. `función renal` era un identificador con tilde.** Todos sus hermanos van
sin ella (`neurodegeneracion`, `cognicion`, `neuroinflamacion`), así que los
grafos calculados antes de la pasada de tildes guardaron `funcion renal` y los
de después `función renal`: la misma cosa, dos nodos en la cascada. Arreglado en
`rosa/causal.py` (identificador sin tilde, `ETIQUETAS` aparte para leer) y
normalizado al leer en `frontend/src/lib/mecanismos.ts`, que los grafos ya
guardados no cambian solos. El guion `scripts/acentuar_py.py` seguirá pidiendo
la tilde ahí: **es un identificador y se decide a mano**, como dice la regla.

**2. Un mismo supuesto se llamaba distinto según se cumpliera o faltara.** El
cumplido era "Ajuste" y el faltante "Confusión"; el cumplido "Replicación
independiente" y el faltante "Replicación". La pantalla los contaba como cuatro
supuestos en vez de dos. Se ve en que las cuentas suman 21: 5 + 16 y 12 + 9.
Unificados en `rosa/causal.py`, con un test que lo sujeta
(`test_un_supuesto_se_llama_igual_se_cumpla_o_falte`) y un alias en el frontend
para los grafos ya guardados.

**3. Mi propia cuenta de cobertura estaba mal.** Al preparar el boceto conté
"cuántas hipótesis tocan cada nodo" con un patrón que buscaba `APOE4` mientras
los textos dicen `APOE ε4`: daba 0 y la hipótesis del ejemplo era justamente
sobre APOE ε4. La versión buena no usa patrones en TypeScript: cuenta **en
cuántos grafos aparece el nodo**, que sale del dato y no duplica en el frontend
lo que ya decide Python. Ojo con leerlo: es "en juego en N hipótesis, como
actor o como confusor", no "N la estudian". Por eso `funcion renal` sale en 20
de 21 (es confusor conocido de NfL) y `cognicion` en 5.

### Dos reglas de la pantalla que conviene conservar

- **El realce de un nodo va por cuánto pesa en el programa, no por estar en el
  grafo de la hipótesis elegida.** El grafo de una hipótesis trae casi siempre
  los once nodos de la base, así que "está en el grafo" encendía todo y no
  distinguía nada.
- **Las clases CSS van con prefijo `mec-`.** La primera versión usó `.barra`,
  que ya existe en `styles.css` (es la barra superior de la aplicación) y le
  pisaba la altura al recuento de supuestos. El guardia `src/clases.test.ts`
  comprueba que la clase exista, no que no choque.

La muestra (`frontend/src/datos/muestra.ts`) lleva ahora tres grafos causales,
uno de ellos `identificable`, para que la pantalla no salga vacía sin servidor.

### La paleta: el primer intento estaba mal (22 de septiembre de 2026)

Emir, al verla: *"que son esos colores? no va con ningun apartado de rosa, no
convinan"*. Tenía razón. La pinté con la paleta oscura del Atlas, y el Atlas es
oscuro porque es un visor 3D; el resto de ROSA2018 es claro con acento morado
(`--accent: #5b2aa8`). La pantalla parecía pegada de otro programa.

Rehecha con los tokens de `styles.css` y ninguno propio. Ahora el color dice
qué CLASE de afirmación es una flecha, y nada más:

- **gris** (`--text-3`): lo que el campo da por sentado y ROSA2018 no ha comprobado.
- **morado** (`--accent`): lo que afirma la hipótesis, sin dato propio. Es el
  acento de la aplicación, y aquí significa "suposición".
- **rojo** (`--red`): lo que lo tumbaría (confusor, artefacto, selección, causa inversa).
- **verde** (`--green`): un supuesto que la evidencia sí cumple.
- **ámbar** (`--amber`): un supuesto que falta.

Y el interruptor que la persona enciende a mano va en morado, no en verde: no
es un supuesto cumplido, es una suposición suya.

La otra mitad de esa queja era que no se entendía. La pantalla ahora se explica
sola: cabecera con `AYUDA` y `META` como las demás (qué es identificable, cuáles
son las tres amenazas clásicas y de dónde sale el veredicto), y una tira "Cómo
se lee" encima del lienzo en vez de una leyenda al final.

### El cerrojo de rosa.db salvó un reinicio mal hecho (22 de septiembre de 2026)

Al cerrar el bloque encadené `parar_servidor.py` con el arranque en la misma
orden. El guardián hizo su trabajo y se NEGÓ a parar (corrida 16 en marcha,
código 2), pero el `&&` solo encadenaba la parada, así que el arranque se
ejecutó igual y hubo dos procesos vivos un minuto.

No pasó nada, y conviene saber por qué: ROSA2018 tiene un SEGUNDO cerrojo, a
nivel de proceso, sobre `rosa.db`. El proceso nuevo lo detectó y se quedó
esperando sin escribir ni una fila ("Otra ROSA2018 (PID 37222) sigue cerrando
rosa.db... espero"). La cadena de auditoría sigue con una sola rotura, la del
15 de septiembre en la fila 6450, sobre 25.743 filas.

Lección para la próxima: **el arranque no puede colgar de un `&&` con la
parada**, porque `&&` encadena con la orden anterior y no con el código de
salida del guardián. Para reiniciar está `./scripts/reiniciar_servidor.sh`, que
comprueba el código y no arranca si la parada no se completó. Usarlo.

### El morado tenía dos significados (22 de septiembre de 2026)

Emir: *"por que algunos estan morados y otros grises?"*. Porque el peso de un
nodo (en cuántas hipótesis entra en juego) se pintaba con el acento morado, y
el morado ya significaba "lo que la hipótesis supone, sin dato propio" en las
flechas. Dos sentidos para el mismo color en la misma pantalla.

Ahora el peso va en una escala NEUTRA (relleno y borde, sin tono nuevo) y el
morado significa una sola cosa: suposición. Eso incluye el interruptor que la
persona enciende a mano, que por eso también es morado y no verde.

Regla que sale de aquí: en esta pantalla **un color es un significado**. Si
hace falta codificar algo más, se hace con forma, relleno o grosor, no con un
tono nuevo.

Nota práctica: el servidor sirve `frontend/dist` como ficheros estáticos, así
que **un cambio solo de interfaz se ve con reconstruir y recargar**, sin parar
ni reiniciar nada.

### El grafo causal perdía las amenazas ya conocidas (22 de septiembre de 2026)

Emir: *"ya no aparecen los cuadros rojos que iban abajo de las lineas, que
hiciste"*. No lo hice yo: lo destapó la pantalla nueva.

Una hipótesis de la corrida 16 ("El acoplamiento de la respuesta de GFAP o
P-tau181 con NfL...") tenía **12 explicaciones alternativas guardadas** en
`x["alternativas"]`, y su grafo, recalculado a las 15:32, salió con **cero**.
Las otras ocho de esa investigación seguían con cuatro.

Dos fallos encadenados en `rosa/bucle/pasos.py`:

1. El grafo se construía **solo con las alternativas de esa ronda**
   (`rev.alternativas`, recortadas a 4). Si el juez no devolvía ninguna, el
   grafo se quedaba sin amenazas aunque hubiera doce apuntadas.
2. El grafo se construía **antes** de `anadir_alternativas`, así que nunca veía
   siquiera las que acababan de llegar.

Arreglado: se acumula primero y el grafo cae en las conocidas cuando la ronda
no trae ninguna. Las de la ronda siguen mandando cuando las hay. Dos tests lo
sujetan, uno de ellos comprobando el ORDEN de las dos llamadas, que es la mitad
del fallo.

Regla que sale de aquí: **una amenaza conocida no deja de existir porque una
llamada no la repita.** Es la misma familia que "una fuente que no responde es
'no pude comprobar', nunca 'no hay'".

En la pantalla, cero amenazas ya no es un hueco mudo: se dice, y se aclara que
no significa que la hipótesis esté limpia. Los grafos ya guardados con cero no
se arreglan solos; se corrigen cuando esa hipótesis se vuelva a juzgar.

### Una flecha que cruza una caja se lee como si saliera de ella (22 de septiembre de 2026)

Emir, leyendo el dibujo: *"por que amiloide apunta tambien a neurodegeneracion
si lo que deberia apuntar es a tau?"*. Buena pregunta, y la respuesta es que
**esa flecha no existe**. Lo que veía era `edad -> neurodegeneracion` cruzando
por detrás de la caja de `amiloide`. Lo mismo con la que parecía
`neurodegeneracion -> GFAP`, que era `amiloide -> GFAP` pasando por detrás de
`neurodegeneracion`.

Es el fallo más grave que ha tenido la pantalla: **hacía leer relaciones
causales que no están en los datos**. Quitar la transparencia de las cajas no
bastó; las líneas seguían pasando por detrás.

Dos arreglos:

1. `desvioDeArco` (en `frontend/src/lib/mecanismos.ts`): si el tramo recto
   cruzaría por una caja que no es ninguna de sus dos puntas, la flecha se
   arquea y la rodea, por el lado con más sitio.
2. Los nodos se ordenan **dentro de su columna por profundidad en la cascada**
   (camino más largo desde una raíz) y no por popularidad. Antes `tau` salía
   encima de `amiloide` porque aparecía en más grafos, y la flecha
   `amiloide -> tau` apuntaba hacia arriba.

Regla que sale de aquí, y que vale para cualquier grafo que se pinte en
ROSA2018: **si el dibujo permite leer una arista que no existe, el dibujo está
mal, por bonito que sea.** En un programa cuyo trabajo es no afirmar de más,
una flecha fantasma es del mismo tipo de error que una cita que no resuelve.

### La hipótesis no estaba en el mapa, y las flechas rojas apuntaban a cualquier sitio (22 de septiembre de 2026)

Emir pidió dos cosas: resaltar las conexiones al pasar el ratón, e iluminar lo
que tiene que ver con la hipótesis elegida. Al ir a hacerlo apareció un fallo
peor que los dos anteriores.

**Las flechas de amenaza apuntaban a una caja elegida por índice**
(`casc.nodos[i * 3 + 3]`), o sea inventada. En los datos las amenazas apuntan
siempre a `X` (32 veces) o a `Y` (51) y **nunca** a un nodo de la cascada,
porque atacan a lo que la hipótesis mueve o a donde lo lee. Y la pantalla no
dibujaba ni X ni Y.

De ahí salía la pregunta de Emir: *"si lo que realmente importaría serían los
cuadros rojos... no entiendo para qué tendría sentido seguir viendo esos
cuadritos"*. Tenía razón por una razón que yo no había visto: **la hipótesis no
estaba en el mapa**, así que el mapa no podía decir nada de ella.

Arreglado: se dibujan `LO QUE MUEVE` y `Y LO LEE EN` (X e Y) en su propia
banda, en morado discontinuo porque es lo que la hipótesis afirma sin dato
propio, y cada amenaza apunta a X, a Y o a las dos **según sus aristas**. Una
amenaza que ataca a los dos dibuja dos flechas.

Y con eso, señalar un nodo enciende sus flechas y sus vecinos y apaga el resto,
que es lo que hace legible un grafo de quince aristas.

**Un tercer fantasma, de regalo.** Las aristas de la misma columna se dibujaban
con un bucle hacia abajo cuya caída era la distancia vertical, así que se
salían de la cascada y entraban en la banda de la hipótesis: parecía que
`amiloide` conectaba con `LO QUE MUEVE`. Ahora rodean por el lado y se quedan
dentro.

### Lo que hice mal en este bloque, para no repetirlo

Emir, con razón: *"estas cometiendo demasiados errores"*. En esta pantalla
metí, por orden: paleta del Atlas en una aplicación clara, cajas con fondo
translúcido que dejaban ver las flechas por detrás, un morado con dos
significados, flechas que cruzaban cajas y se leían como aristas que no
existen, un número sin explicar, y flechas rojas con destino inventado.

Dos causas, y las dos tienen el mismo remedio:

1. **Cambiar lo visual sin mirarlo.** Los tests pasaban en todos esos casos:
   ninguno comprueba que una flecha acabe donde dice. Antes de tocar el dibujo,
   renderizar y mirar.
2. **Aceptar el marco de quien pregunta sin comprobarlo.** Cuando preguntó si
   las líneas grises deberían cambiar según la hipótesis, le dije que sí. Es
   que no: la cascada es la biología y no cambia. Lo implementé, rompió la
   cadena (apagaba `tau` y `amiloide -> tau -> neurodegeneracion` aparecía
   partida) y hubo que revertirlo. **Comprobar primero, contestar después**, y
   decir que no cuando toca.

### Tres supuestos causales en verde no quieren decir que haya con qué (23 de septiembre de 2026)

Emir preguntó si la hipótesis "La normalización de P-tau181, no su reducción
porcentual, predice el beneficio clínico" era buena, porque el panel le daba
3/3. La respuesta corta es que **3/3 no significa buena**: significa que, SI el
efecto existiera, el diseño podría detectarlo sin que otra cosa lo confunda. Es
una afirmación sobre si la pregunta se puede contestar, no sobre la respuesta.

Mirando el resto de lo que ROSA2018 sabe de ella:

- 15 afirmaciones, 14 sostenidas y 1 parcial, **ninguna bloqueada**. Limpio.
- Elo 1590 en 20 partidos, alto.
- Pero el Killer dice **suspender**, `candidata: false`, y tiene un bloqueo
  abierto (`revision_registro_abierta`).
- Y sobre todo: de sus **12 supuestos de ficha, 10 sin evidencia y 1
  contradicho**. Entre los que faltan está el que la define: que exista un
  intervalo de referencia de P-tau181 en amiloide-negativos, fijado ANTES de
  consultar los resultados clínicos. Sin eso, "normalización" no tiene
  definición y el umbral se puede colocar donde dé la razón.

**El fallo de la pantalla era que nada de eso se veía.** Mecanismos enseñaba
los tres supuestos causales en verde y la hipótesis parecía impecable. Ahora,
cuando la ficha tiene supuestos sin evidencia o contradichos, sale un aviso al
lado del veredicto con la cuenta y un enlace a la hipótesis.

Los dos grupos de supuestos no son lo mismo y conviene no confundirlos nunca:

- **Los tres causales** (temporalidad, ajuste, replicación): ¿el efecto sería
  *identificable*?
- **Los de la ficha**: ¿existen los *ingredientes*?

Pueden ir en direcciones opuestas, y en esta hipótesis van: identificable con
once de doce ingredientes sin sostener.

### Por qué 0 de 294 flechas tienen evidencia, y por qué NO se arregla con texto (23 de septiembre de 2026)

En Mecanismos, ninguna arista X -> Y sale como `inferencia_con_evidencia`. Le
dije a Emir que eso era una regla rota y que la evidencia existía sin llegar al
grafo. **Era medio falso**, y conviene que quien venga detrás no repita el error.

Lo que sí es cierto: la regla (`rosa/causal.py`, `grafo_local`) mira si los
primeros 12 caracteres de X y de Y aparecen en el texto de una afirmación
sostenida. Se diseñó para X e Y cortos ("GFAP", "NfL"), y ahí funciona: el test
de `test_rosa2018.py` con "GFAP rose before NfL in longitudinal follow-up" es un
caso legítimo. Pero en producción X e Y son frases largas ("sin diana", "GFAP y
NfL plasmáticos seriados...") y nunca casa.

Lo que NO es cierto: que se pueda arreglar con otra regla de texto. Medido sobre
las 21 hipótesis con grafo de la corrida 16:

- **Casar por entidades** (la afirmación nombra algo de X y algo de Y): 16 de 21
  pasarían a "con evidencia". Leídas a mano, la mayoría son falsas. "Los
  portadores de APOE ε4 mostraron mayores incrementos de p-tau181 y GFAP" casa
  con una hipótesis sobre la brecha GFAP-NfL y ni siquiera nombra el NfL.
- **Casar por lo propio de cada lado** (algo de X que no está en Y y al revés):
  1 de 21, y también falso (nombra "Alzheimer" y "P-tau181"; la hipótesis va de
  carga vascular).
- **16 de las 21 tienen X e Y hechas de las mismas entidades**, porque tratan de
  relaciones ENTRE biomarcadores (orden temporal, brecha, dependencia de dosis),
  no de "exposición causa desenlace". Ahí no hay nada que separar por nombres.

Y además 4 tienen X = "sin diana", que no es una exposición sino el marcador de
"no hay diana terapéutica".

Conclusión: **nombrar dos cosas no es sostener que una lleva a la otra**, y eso
lo decide un juicio, no una comparación de cadenas. Así que se quitó la regla:
la flecha X -> Y sale siempre como `supuesto`, con el texto
`causal.CONTEXTO_XY`, que dice justo eso, en vez de "ninguna afirmación
sostenida nombra las dos cosas a la vez" (falso en 16 de 21). Los grafos ya
guardados se corrigen al cargar (`_migrar_contexto_xy` en
`rosa/estado/almacen.py`; si alguna flecha hubiera subido a "con evidencia" solo
por nombrar las dos cosas, vuelve a supuesto con su relación del modelo de
mundo, pero en la base real no había ninguna). El tipo de arista llega al
modelo de mundo (`registrar_relacion`), donde afirmar de más es peor que
afirmar de menos. Los veredictos de identificación no dependen del tipo de
arista, así que nada de esto los mueve.

El arreglo de verdad, pendiente: que el juez (el Killer, que ya lee cada
hipótesis con sus afirmaciones) devuelva qué afirmaciones sostienen la relación
X -> Y. Cuesta llamadas y cambia la firma del juez, así que es decisión de
Emir, no algo que se mete de paso.

## Qué desbloquea más, la cuarta pantalla de estructura (23 de septiembre de 2026)

Emir pidió otra sección al nivel del Atlas, el Árbol y Mecanismos. Es la pareja
de Mecanismos: aquella dice qué le falta a **una** hipótesis; esta junta lo que
les falta a **todas** y contesta la pregunta de quien dirige el laboratorio:
qué conseguir primero. Boceto en ~/Downloads/boceto-que-desbloquea-mas.png,
hecho con los datos reales antes de construirla.

No hay endpoint nuevo. Los supuestos de la ficha de cada hipótesis ya viajan
en el estado, con su estado (respaldado, plausible, sin evidencia,
contradicho). La pantalla (`frontend/src/pantallas/Desbloqueo.tsx`) y su regla
(`frontend/src/lib/desbloqueo.ts`) trabajan en el navegador. Cuentan las
hipótesis vivas: ni descartadas ni fundidas en otra.

**Un ingrediente** es lo que haría falta tener para poder comprobar un
supuesto sin evidencia. Hay once, en cuatro vías, porque la vía decide quién
se mueve:

- Buscar en lo publicado: resultados de ensayos clínicos, intervalo de
  referencia, fiabilidad de la medida, resultados de cohortes por subgrupo,
  desenlace clínico comparable.
- Pedir datos de una cohorte: tamaño del subgrupo (ADNI, de acceso
  controlado, que hoy el proyecto no solicita), muestras seriadas frecuentes,
  estado amiloide de cada persona, covariables para ajustar.
- Hacer el análisis, sin pedir nada: que el análisis se pueda estimar (se
  prueba con datos sintéticos, el ensayo en seco).
- Investigación nueva: biología sin medir. No entra en el plan de pedidos,
  porque un estudio nuevo no es un trámite.

**Cómo se clasifica cada supuesto:** reglas de palabras, sin modelo, en orden;
gana la primera que casa y se guarda la frase y su posición, para que la
pantalla subraye por qué. Las reglas se escribieron leyendo los 164 supuestos
flojos de la base de hoy, y se miden contra una lectura hecha a mano de esos
mismos 164 (`frontend/src/lib/desbloqueo.casos.json`; cuando un supuesto pide
de verdad dos cosas lleva las dos etiquetas). La primera medición dio 154 de
164, y los fallos tenían una causa común: **una palabra que el supuesto solo
menciona ganaba a lo que pide** ("adicional a la del propio estado amiloide"
no pide el estado amiloide; "en ambos compartimentos" no pide armonizar nada).
Con las reglas exigiendo la necesidad y no la palabra: **162 de 164, cero mal
clasificados**, y los 2 que quedan salen como "sin clasificar", a la vista.
Los tests sujetan las dos cosas (al menos 162, y ninguno en un ingrediente
equivocado). "Ensayo" en castellano es también el de laboratorio ("específico
del ensayo"), así que la regla de ensayos clínicos exige otra palabra de ensayo
clínico al lado.

**Una corrección a lo que le dije a Emir con la tabla rápida:** "estado
amiloide" salía en 20 de 28 hipótesis, contando la palabra. Leídos uno a uno,
son **3 supuestos en 3 hipótesis**: casi siempre "amiloide" sale porque el
intervalo de referencia se calcula en amiloide-negativos o porque el subgrupo
de ADNI es amiloide-positivo, y eso son otros ingredientes. Lo que más se
repite de verdad, con los datos de hoy (155 supuestos sin evidencia en 28
hipótesis, 9 contradichos, 2 sin clasificar):

- Biología sin medir: 15 hipótesis, 30 supuestos (no se pide, se investiga).
- Fiabilidad de la medida: 13 hipótesis, 22 supuestos.
- Intervalo de referencia: 12 hipótesis, 21 supuestos.
- Resultados de ensayos clínicos: 11 hipótesis, 31 supuestos. Es donde más
  rendiría leer los resultados estructurados de ClinicalTrials.gov.

**El plan** ("si se pidieran en este orden") es voraz: en cada paso gana el
ingrediente que deja más hipótesis con todo lo pendiente comprobable; a
igualdad, el que más acerca a las que pueden quedar así; y a igualdad, el que
más supuestos abre. El segundo criterio se añadió porque, sin él, con los datos
de muestra tardaba seis pasos en liberar la única hipótesis liberable. Con los
diez ingredientes pedibles, **12 de 28** hipótesis quedan con todo lo pendiente
comprobable (123 de 155 supuestos); de las otras 16, 15 piden biología sin
medir y 1 tiene un supuesto sin clasificar, y 7 tienen ya algún supuesto
contradicho, que ningún ingrediente arregla. Comprobable no es confirmado: el
dato puede quitarle la razón al supuesto, y la pantalla lo dice.

**Lo que queda abierto, y es decisión de Emir:** las reglas se hicieron
leyendo estos 164, así que con supuestos nuevos acertarán menos y crecerá
"sin clasificar". Si crece de verdad, clasificar con modelo y medirlo contra el
mismo conjunto hecho a mano; hasta entonces, reglas a la vista.

### Los supuestos estaban viejos: auditoría, sello de vigencia y reevaluación (23 de septiembre de 2026)

Otra instancia de Claude le preguntó a Emir si el estado de los supuestos que
alimenta "Qué desbloquea más" estaba al día. No lo había comprobado. La
clasificación en ingredientes se recalcula en el navegador cada vez, pero el
estado de cada supuesto (respaldado, plausible, sin evidencia, contradicho) lo
pone el evaluador al revisar la hipótesis y no se recalcula solo.

**Auditoría sin modelo, sobre la base real:** ningún fallo del modelo guardado
como "sin evidencia", ninguno sin evaluar y ningún recorte de la evidencia
propia con el código de hoy. Pero solo **27 de los 164 supuestos flojos**
estaban al día:

- **107, de 20 hipótesis, se evaluaron antes del arranque del 18 de septiembre
  a las 05:48** (el que cargó el commit 80bc256). Hasta entonces el evaluador
  recibía los primeros 8000 caracteres de las afirmaciones de toda la corrida,
  no la evidencia propia de la hipótesis, y un "contradicho" valía sin señalar
  la afirmación que lo negaba. En 8 de esas hipótesis vio 6 de sus 60
  afirmaciones.
- **30, de 4 hipótesis, tenían evidencia llegada después.** La revisión estaba
  pedida pero atascada: la corrida 16 está pausada por presupuesto.
- **El Killer había propuesto descartar 4 hipótesis por supuestos con la regla
  vieja** (122, 52, 898, 5575). La 898, por "INVOKE-2 publica p-tau181",
  contradicho solo porque ninguna afirmación nombra ese ensayo; la 122, por
  supuestos sin respaldo, que hoy ya no tumban nada; y en las cuatro, hoy un
  contradicho suspende, no descarta.

**El arreglo (rosa/vigencia.py):**

- Cada evaluación deja un sello público, `supuestosEvaluados`: cuándo, con qué
  regla (`REGLA_SUPUESTOS = 2`), cuántas afirmaciones veía la hipótesis y
  cuántos supuestos no pudo evaluar el modelo. Si hoy tiene más afirmaciones,
  llegó evidencia después.
- La migración `_migrar_supuestos_evaluados` reconstruye el sello de lo
  evaluado antes (fecha de la revisión profunda, no la de
  `ultimaRevisionAutomatica`, que `solicitar_revision` pone al pedir; y las
  afirmaciones de entonces por los eventos "Evidencia nueva para") y **pide una
  sola vez la revisión de las hipótesis vivas evaluadas con la regla 1**, con
  el visto bueno de Emir. El bucle la hace como cuando llega evidencia nueva:
  reevalúa los supuestos contra la evidencia propia y vuelve a pasar el Killer
  (no en las aceptadas). Descartar sigue necesitando a una persona (autonomía
  "preguntar"). `REEVALUAR_AL_CARGAR_HASTA_REGLA` impide que una regla futura
  gaste sola: subirla es decidir gastar.
- La revisión se cobra a la última corrida de cada investigación. Si no tiene
  presupuesto, se abandona y el sello lo dice (`noAtendida`). Las 6 hipótesis
  de "Qué distingue a un biomarcador..." esperan a que la corrida 16 tenga
  presupuesto; en "GFAP y NfL en portadores de APOE4" quedaban 68 llamadas para
  6 hipótesis, así que alguna puede quedarse sin hacer.
- La pantalla lo enseña: un aviso con cuántos supuestos están por reevaluar y
  por qué, un botón para pedirlo (acción `reevaluarSupuestos`), una marca en
  cada hipótesis que no está al día y la advertencia en el plan de que el orden
  es provisional. La regla está en los dos lados, uno a uno
  (`vigencia` en rosa/vigencia.py y en frontend/src/lib/desbloqueo.ts).

**La lección**, también en la memoria de Claude: un número que sale de estados
guardados se compara, antes de darlo por bueno, con las fechas de los cambios
de regla y con la llegada de evidencia.

## Las cifras ahora dicen de quién son (23 de septiembre de 2026)

Viene de leer veinte conversaciones de Claude Science del científico biomédico
argentino que trabaja con el programa. La parte útil no fue su ciencia sino la
auditoría de su propio revisor: 213 hallazgos sobre el agente científico, de
los que 64 son fallos. La mitad de esos fallos son de cifras, y el más repetido
(13 de 64) es el mismo: un número correcto colgado del sujeto equivocado. El
umbral de un marcador escrito sobre otro, el valor de una cohorte atribuido a
otra. Su verificador no lo veía, y su revisor dijo por qué con una frase que
describe también lo que ROSA2018 tenía: "only tests whether a numeral STRING
exists anywhere in the spec, not whether it is attached to the correct field".

`corpus_del_registro` construía `numeros`, un conjunto plano con todas las
cifras de la investigación entera, y `comprobaciones_deterministas` daba por
buena cualquier cifra del resumen que apareciera en él. Una cifra existía o no
existía; de qué era, no se preguntaba.

Ahora cada cifra se guarda con las entidades que la rodean en su propio texto
(`anclar_numeros`, `anclas_cerca`), y una cifra del resumen que existe en el
registro pero referida a otra cosa es un hallazgo aparte,
`cifra_fuera_de_contexto`, de gravedad alta. Las anclas salen del diccionario
curado de `rosa/ontologias.py` (determinista, sin red), de los identificadores
de conjunto de datos y de ensayo, y de las siglas del dominio. La clase nueva
sale SOLO de la regla: `CLASES_JUEZ` mantiene las seis de siempre para que el
modelo no la use de comodín.

Tres decisiones que conviene conservar, las tres salidas de intentar romperlo:

1. **Manda el dueño, no el contexto** (`_discrepan`). Cuando las dos frases
   nombran gen, marcador, cohorte o ensayo, se comparan esos y no el resto: un
   umbral de un marcador puesto sobre otro discrepa aunque las dos digan "en
   plasma". El tejido, la célula, la enfermedad y el compuesto son contexto, y
   dos medidas distintas comparten contexto todo el rato. Cuando alguna de las
   dos no nombra dueño, hace falta que no coincida nada para hablar.

2. **Solo se pregunta por las medidas, no por la contabilidad** (`es_medida`).
   Un decimal ya es medida; un entero solo si lleva unidad detrás. La primera
   versión no distinguía y dio 16 avisos falsos en los 41 resúmenes reales del
   estado, todos de recuentos del tipo "de 35 afirmaciones, 29 sostenidas", que
   se anclaban al marcador que la frase nombrara de paso. Un recuento no tiene
   dueño biológico, y además ya tiene su propia comprobación
   (`recuentos_del_registro`), que lo recalcula del estado.

3. **Callar cuando no se puede saber.** Si la frase no nombra a nadie, o el
   registro no ancló esa cifra, no se dice nada. Un falso positivo aquí hace
   que se deje de mirar la lista entera.

Comprobado contra el estado real: 0 avisos falsos en los 41 resúmenes de
iteración guardados, y un fallo inyectado a mano (un decimal de un marcador
atribuido a otro, sobre el registro de la corrida 1) se detecta con la frase y
los dos dueños a la vista.

### Un fallo que estaba desde antes: "0,027" se leía como 27

Lo encontraron los tests nuevos. `_norm` trataba la coma como separador de
miles siempre que el patrón cuadrara, así que "0,027" pasaba a "0027" y de ahí
a 27, y una p de "0,001" a 1. Son justo las cifras que ROSA2018 más escribe.
"1,234" es ambiguo de verdad (mil doscientos treinta y cuatro en inglés, uno
coma doscientos treinta y cuatro en castellano) y se sigue leyendo como miles,
que es de donde vienen los fragmentos en inglés; pero "0,027" no lo es, porque
nadie escribe un grupo de miles con un cero delante. Arreglado solo ese caso.

### Lo que NO se trajo de Claude Science, y por qué

- **La rúbrica de ocho parámetros.** Sus propios datos la entierran como
  criterio de selección: al repuntuar 28 expedientes a ciegas, la correlación
  de Spearman entre rondas fue 0,03 en falsabilidad y 0,04 en confiabilidad, y
  27 de los 28 bajaron de nota; sobre 69 expedientes, la correlación de rangos
  del compuesto fue 0,17 y solo 26 cayeron en la misma banda de tercios (por
  azar caerían 23). Su conclusión, textual: "El compuesto no sirve para elegir
  qué expediente financiar; sirve para el perfil de la cartera". ROSA2018 no
  tiene número compuesto: `rosa/priorizacion.py` descarta por bloqueos que no
  se compensan y ordena por Bradley-Terry con diversidad, que es la respuesta
  correcta al problema que ellos documentaron. No añadir puntuaciones.
- **Su forma de guardar memoria.** De sus 222 filas, 34 retractan algo escrito
  antes, y la memoria no se edita en sitio: la versión mala y la corregida
  conviven, con 10 cadenas de reescritura casi literal. ROSA2018 tiene
  `sustituyeA`, `sustituidoPor` y `contradiceA` mas la propagacion de
  `rosa/dependencias.py`, que marca como pendiente lo que colgaba de lo que
  cambió.
- **Sus resultados científicos tal cual.** Son juicio de un modelo sobre
  cohortes públicas, sin aprobar por ninguna persona. Entran como propuestas a
  la cola si entran, nunca al modelo de mundo.

### Lo que queda pendiente de esta lectura

- **El efecto mínimo detectable en la evaluación de evidencia.** Hoy `potencia`
  solo existe en el dossier de experimentos de laboratorio. Sin MDE, ROSA2018
  no puede escribir "refutado en un rango acotado" ni separar "plano con
  potencia" de "no medible", y su `sin_evidencia` mezcla "miré y no hay" con
  "las citas de esta corrida no lo tocan". Es lo siguiente por valor.
- **Que el juez del revisor pueda recalcular con los datos**, no solo leer el
  registro. El de ellos recomputa en una caja de arena; el nuestro lee. Si se
  hace, con Opus: Sonnet nunca juzga (TRASPASO 7.4).

## "Sin evidencia" ahora dice qué quiere decir: regla 3 de los supuestos (23 de septiembre de 2026)

La segunda cosa que se trajo de las conversaciones de Claude Science. Su agente
nunca escribe "refutado" a secas: separa "no evaluado" de "refutado", y un
resultado nulo con potencia de uno sin ella ("no evaluado no es refutado",
escrito en la propia celda de su tabla de veredictos). ROSA2018 tenía la regla
para las fuentes ("una fuente que no responde es no pude comprobar, nunca no
hay") pero no la aplicaba a los supuestos: `sin_evidencia` decía lo mismo cuando
las afirmaciones de la corrida no hablaban del tema que cuando hablaban y no lo
resolvían. El primero no informa de nada; el segundo, sí.

Lo que cambió:

- `EvaluarSupuesto` devuelve además `indices_que_lo_tocan` (qué afirmaciones
  tratan el tema aunque no lo resuelvan), `donde_se_responde` (literatura,
  catálogo de cohorte, registro de ensayos, análisis de datos, experimento
  nuevo) y `cota` (el límite de un nulo con intervalo o potencia declarada). Y
  su instrucción dice ahora que un nulo sin intervalo ni potencia no
  contradice: no se sabe si el efecto no existe o si el estudio no podía verlo.
- `alcance_del_supuesto` (rosa/bucle/pasos.py) guarda en cada supuesto su
  `alcance`: resuelto, tocado sin respuesta, no tocado, o no evaluado (el modelo
  no respondió). Lo decide la regla con los índices, no el modelo, y los índices
  se validan contra la lista numerada igual que los de S-10.
- La ficha de la hipótesis lo enseña debajo de cada supuesto ("Las fuentes
  reunidas no hablan de esto · se respondería en el catálogo de una cohorte").
  A lo evaluado con una regla anterior no se le inventa nada.

Por qué `dondeSeResponde` importa: en las dos primeras hipótesis reevaluadas
esta mañana, la mayoría de los supuestos "sin evidencia" no eran preguntas de
literatura ("existe un subconjunto suficientemente grande de participantes de
ADNI portadores de APOE ε4", "esos umbrales son transportables entre
plataformas"). Se contestan mirando el catálogo de la cohorte, no PubMed, y
marcarlos "sin evidencia" tras preguntar en el sitio equivocado sonaba a "no
hay".

**Es una regla nueva, la 3** (`REGLA_SUPUESTOS` en rosa/vigencia.py y en
frontend/src/lib/desbloqueo.ts): todo lo evaluado con la 1 o la 2 sale en "Qué
desbloquea más" como por reevaluar, porque su estado puede cambiar (un
"contradicho" que se apoyaba en un nulo sin potencia ya no lo es). **No se pide
solo**: `REEVALUAR_AL_CARGAR_HASTA_REGLA` sigue en 1, y subirlo es decidir
gastar. La reevaluación se pide con el botón de la pantalla.

Los textos del aviso dicen ahora con qué regla se evaluó cada cosa
(`LO_QUE_FALTABA`): antes decían siempre "antes del 18 de septiembre", que con
la regla 3 habría sido falso para todo lo evaluado con la 2. De paso se
corrigió "1 evaluadas".

Un test intermitente de la interfaz falló una vez en cinco pases completos y no
se pudo ver cuál era; los cuatro pases siguientes, limpios. Queda para la
revisión de fallos.

## El juez del revisor recalcula en vez de estimar (23 de septiembre de 2026)

La tercera cosa traída de Claude Science. Su revisor no lee: abre los ficheros
y recalcula en una caja de arena. El nuestro leía el registro, y el registro
recorta cada afirmación a 160 caracteres, todo el texto a 9000 y de cada
ejecución solo da pares clave=valor. Dos piezas:

**Una regla, `cuentas_que_no_cuadran`**, clase nueva `cuenta_que_no_cuadra` de
gravedad alta, solo de regla. Caza sin modelo una cifra derivada que no sale de
las que da el propio texto: "N veces más", "el doble", "de A a B, una subida del
N %", y el log2 convertido a veces. Los dos ejemplos literales del revisor de
Claude Science los caza: "−1,352 log2, es decir cinco veces más alto" (2
elevado a 1,352 es 2,55) y "cuatro veces más alta" con 0,2195 frente a 0,0149
(el cociente es 14,7). Tres decisiones para no dar avisos falsos, salidas de
intentar romperla:
- "Tres veces" solo es cociente con un comparativo detrás; "se extrajo sangre
  tres veces en cinco años" es una frecuencia.
- El porcentaje y el "de A a B" tienen que ir pegados, y "de 60 a 80 años" es
  un rango, no un antes y un después.
- "1,352" es uno coma tres en castellano y mil trescientos en inglés, y el
  texto mezcla frases propias con fragmentos de fuentes: se prueban todas las
  lecturas de cada cifra y solo se avisa si la cuenta falla con todas. Con más
  o menos de dos cifras candidatas en la frase, se calla.

Contra el estado real: 0 avisos en 97 textos (resúmenes, conclusiones,
enunciados y mecanismos). Pero solo 1 de esos 97 contiene una cuenta derivada:
ROSA2018 casi no escribe cuentas, así que hoy la regla vigila poco. Es barata y
queda puesta para cuando las escriba.

**Tres herramientas de solo lectura para el juez** (`HERRAMIENTAS_JUEZ`):
`calcular` (aritmética con `ast` en lista blanca: números, operadores,
paréntesis y log2, log10, ln, exp, sqrt, abs, round, min, max; nada de nombres,
atributos ni llamadas fuera de esa lista; admite coma decimal),
`leer_afirmacion` (entera, por su número: el registro ahora numera A1, A2...) y
`leer_ejecucion` (entera, por su id). El programa `revisar_registro` pasa de
`ChainOfThought` a `ReAct` con esas tres herramientas y `MAX_VUELTAS_REVISOR` =
4. Lo que devuelven va marcado como DATO DEL REGISTRO, nunca instrucción.

Dos detalles de ingeniería que conviene conservar:
- Las herramientas leen el registro de la revisión en curso desde una variable
  de contexto (`en_revision`), no desde un global: DSPy llama a las
  herramientas en la misma tarea, y dos iteraciones que cierran a la vez no se
  leen la una a la otra (hay un test con las dos a la vez).
- El programa sigue siendo el mismo objeto de `Programas`, no uno fabricado en
  cada llamada: los tests reconocen al juez por ese objeto, y el servicio de
  GEPA también (`resolver` va por `id(programa)`).

Presupuesto: el corte está antes de cada `ctx.llamar` y las vueltas se cuentan
dentro por el callback, así que el revisor puede pasarse del tope en hasta
cuatro llamadas al cerrar una iteración. Por eso el tope de vueltas es bajo.

Lo que no se ha probado todavía: el juez con herramientas contra el modelo de
verdad. Los tests cubren la estructura, las herramientas y la variable de
contexto; la primera prueba real será el siguiente cierre de iteración tras
reiniciar el servidor.

## Palabras que afirman de más, comprobadas por código (23 de septiembre de 2026)

La cuarta cosa traída de Claude Science: su agente pasaba por código una lista
de palabras prohibidas antes de entregar un documento. ROSA2018 tenía las
prohibiciones escritas en CLAUDE.md (sin "demostrado" ni "confirmado", sin
porcentajes de confianza inventados, sin recomendaciones clínicas), y las
frases de las conclusiones ya salen de plantillas que no las usan; pero el
texto libre del modelo (el resumen de la iteración, el resumen en llano) no lo
comprobaba nadie. Los resaltados en ámbar de la interfaz
(frontend/src/lib/calidad.ts) pintan, no comprueban.

`sobreafirmaciones` en rosa/revisor_registro.py, dentro de
`comprobaciones_deterministas`: sale como `conclusion_no_sigue` de gravedad
media con origen "regla". Cubre demostrado y confirmado en sus formas, "prueba
que", "sin duda", "obviamente", "inequívoco", "revolucionario", "sin
precedentes", "cambio de paradigma", "crucial", "prometedor", "es la causa
de", los porcentajes de certeza (el intervalo de confianza del 95 % no entra) y
las recomendaciones de tratar, administrar o prescribir. "Clave" se deja fuera:
en castellano es demasiado corriente.

Las negadas no cuentan ("no se ha demostrado" es justo lo contrario de
sobreafirmar), con hasta tres palabras entre la negación y la expresión, y "no
solo se demostró" sí cuenta. La tercera palabra la destapó la prueba contra los
resúmenes reales: "las hipótesis pendientes no equivalen a resultados
confirmados" daba un aviso falso. Tras el arreglo, 0 avisos en 81 textos reales
del estado.

## Qué desbloquea más, rehecha como candados y llaves (23 de septiembre de 2026)

Emir paró la primera versión: "siento que está demasiado complicado, a
cualquiera le hartaría ver eso, nosotros tenemos cosas mucho mejores, como el
atlas, el árbol". Tenía razón. Eran cuatro zonas compitiendo (ingredientes,
hilos, hipótesis con cuadritos, detalle y una gráfica de escalones), dos
párrafos de explicación y cinco códigos visuales antes de entender nada, y la
respuesta a la pregunta que le da nombre estaba abajo a la derecha.

Ahora es una sola imagen, con la metáfora de su propio icono. Cada hipótesis
viva es un **candado**, con una muesca por cada dato que le falta. Cada dato es
una **llave**, y las llaves van en fila en el orden del plan. Se elige hasta
qué llave se llega ("Siguiente llave" o pinchando una) y se ve qué candados se
abren; un contador grande dice cuántos. Pasando por una llave se ve a quién
llega ella sola; pasando por un candado sale una tarjeta con lo que le falta
(y con qué llave); pinchándolo, sus supuestos con la frase que decidió cada uno
marcada, y el enlace a la ficha.

Lo que nunca se abre pidiendo datos se ve distinto, para que nadie crea que
solo faltan más llaves: interrogación ámbar, biología que nadie ha medido;
grieta roja, algo ya en contra; muesca punteada, un supuesto que ninguna regla
clasifica. La leyenda los cuenta.

La lógica no cambió (`tablero`, `plan`, `vigencia` en lib/desbloqueo.ts). El
aviso de lo que está por reevaluar es una línea con el botón, y el porqué va en
su título y en la tarjeta de cada candado. Boceto antes de construir, como con
las otras pantallas: ~/Downloads/boceto-candados-y-llaves.png, y la pantalla
hecha, con los datos de hoy, en ~/Downloads/que-desbloquea-mas-nueva.png.

### Lo que destapó construirla: 45 supuestos nuevos y 12 candados que no se abrían

Al pintarla con los datos reales, la leyenda decía que 12 hipótesis tenían un
supuesto que ninguna regla clasifica; por la mañana eran 2 supuestos. Las
reevaluaciones de la mañana volvieron a pasar la revisión inicial y dejaron 45
supuestos nuevos (los flojos pasaron de 164 a 190), redactados de otra forma, y
las reglas de palabras, ajustadas sobre los 164 de la mañana, dejaron 19 sin
clasificar. Como una hipótesis con un supuesto sin clasificar no puede abrirse
nunca en el plan, la pantalla decía que había 12 bloqueadas que no lo estaban.

Arreglo: los 45 se leyeron uno a uno (los leyó Claude, no una persona; con dos
etiquetas válidas donde de verdad piden dos cosas) y se añadieron al conjunto
de casos, y se añadieron doce reglas AL FINAL de la lista. Como gana la primera
regla que casa, ninguna de las nuevas puede cambiar el ingrediente de los 164
de la mañana. Resultado sobre 209 casos: 207 bien, 2 sin clasificar (los mismos
de la mañana), 0 mal. Con el estado real, el plan pasa de abrir 12 hipótesis
con 10 llaves a abrir 17.

**Lo que ese 207 de 209 no dice**, y hay que tener presente: las reglas se
escribieron mirando esos textos, así que acertar ahí no es generalizar. La
medida honesta de generalización es la de ANTES de añadir reglas: con los 45
supuestos nuevos, las reglas clasificaron 26 (58 %) y no se equivocaron en
ninguno. Es decir, nunca mandan un supuesto al dato equivocado, pero con
redacciones nuevas se les escapan cuatro de cada diez. Va a volver a pasar con
cada tanda de supuestos nuevos. Arreglo de raíz pendiente: usar el
`dondeSeResponde` de la regla 3 (que ya da el modelo al evaluar cada supuesto)
como respaldo para lo que las reglas no reconocen, midiendo antes si acierta.

Y una corrección de un texto mío de la mañana: el test de la clasificación
decía que las etiquetas se las "puso una persona leyéndolo". Las puso Claude;
ninguna persona del equipo las ha revisado todavía. Ya lo dice así.

## Documentos de hipótesis controlados, según la norma de la abogada (25 de septiembre de 2026)

Monica Duarte mandó la norma AP-DOC-002 v01, "Hypothesis Document Control"
(borrador del 17 de septiembre de 2026, pendiente de revisión de la
dirección). Pide que cada documento de hipótesis lleve un código AP-HYP-NNN
correlativo, tipo DOC, versión v01, v02..., esta cabecera y este pie:

    [nombre corto] | DOC | AP-HYP-001 | v01
    Confidential | Alzheimer Project | AI Robotix | Sep-17-2026 | [iniciales] | Page X of Y

con la numeración de página como campo automático, y ocho comprobaciones antes
de darlo por controlado.

En ROSA2018 el documento de hipótesis es el dossier para el laboratorio. En
Artefactos, al abrir un dossier, sale el panel "Documento controlado":
nombre corto, botón de emitir, las versiones emitidas con sus comprobaciones y
"Descargar Word vNN". Lo hace rosa/documento_controlado.py:

- **Emitir es un acto aparte y lo hace el servidor** (acción `emitirDocumento`,
  sin reductor en el navegador): el código AP-HYP se asigna la primera vez y
  queda para siempre; nunca se calcula en el navegador, para que dos pestañas
  no den el mismo. El contador guarda el último asignado y además mira el
  mayor que haya en las hipótesis, así que un código no se reutiliza aunque se
  pierda el contador o desaparezca la hipótesis.
- **Cada versión guarda lo que llevaba** (nombre, fecha, iniciales, cabecera,
  pie, qué versión del dossier, las ocho comprobaciones): la v01 se descarga
  igual aunque luego cambie el nombre o las iniciales. La misma versión del
  dossier no se emite dos veces; para una v02 se regenera el dossier.
- **El Word** se construye al descargarlo (`/api/documentos/{hipótesis}/{vNN}.docx`,
  con python-docx): el árbol del Alzheimer Project y la cabecera arriba, el pie
  con PAGE y NUMPAGES como campos de Word, un bloque de control como el de la
  propia norma ("Document Status: Draft", código, versión, fecha, iniciales) y
  el dossier emitido como cuerpo. Exige sesión, como el resto del servidor: es
  confidencial.

Dos decisiones de Emir, a confirmar con Monica:
- **Las iniciales del pie son "AP"** (Alzheimer Project) en todos, no las de
  una persona. La norma pide las del dueño y su ejemplo es MD. Si cambia, es
  `INICIALES_RESPONSABLE`, y las versiones ya emitidas conservan las suyas.
- **El nombre corto es un resumen del título** que hace ROSA2018 con el modelo
  de volumen (`NombreCortoHipotesis`, de tres a ocho palabras) cuando la
  hipótesis tiene dossier. Se pide en `_atender_peticiones`, como lo que deja
  marcado la persona, porque generar el dossier lo es y las corridas de esas
  hipótesis suelen estar paradas. Si el modelo devuelve más de diez palabras o
  no hay presupuesto, la casilla sale vacía y lo escribe quien emite: nunca se
  recorta el título a ciegas. Siempre se puede cambiar antes de emitir.

Tres cosas que no están resueltas:
- Los dossiers viejos (los dos que hay, del 11 de septiembre) salen sin tildes,
  porque se generaron con código anterior. Regenerados, salen con tildes.
- La vista previa de macOS pone el texto de la cabecera pegado al logo en vez
  de a la derecha: no respeta los anchos de columna. Falta abrirlo en Word y en
  Google Docs de verdad.
- Las iniciales, el nombre corto y que "el documento de hipótesis" sea el
  dossier son lecturas nuestras de un borrador: hay que enseñárselo a Monica.

## Cuatro fallos graves de la caza, arreglados (25 de septiembre de 2026)

Del informe `INFORME-CAZA-FALLOS-2026-09-23.md`, los cuatro que Emir pidió
primero.

**Detener y pausar cortan el paso en curso.** El estado de la corrida solo se
miraba entre paso y paso, y la corrida 15 hizo 146 de sus 148 llamadas después
de que la detuvieran. Ahora `Ctx.llamar` lo mira antes de cada llamada y lanza
`CorridaParada` si la corrida está detenida, terminada o pausada. Solo lo hace
en el contexto que ejecuta pasos (`de_paso=True`, en `_ejecutar_paso`): el
trabajo de fondo que pide la persona sobre una corrida parada sigue
funcionando. `CorridaParada` hereda de `BaseException`, como la cancelación de
asyncio, para que los `except Exception` de dentro de los pasos (que se tragan
el fallo de cada elemento) no la absorban; está en
`EXCEPCIONES_QUE_CORTAN_EL_PASO`, así que `_en_paralelo` cancela a las
hermanas. El paso vuelve a pendiente y sus pistas en curso quedan "detenida".
Comprobado: sin el arreglo, el test da 19 llamadas después de detener; con él,
cero. Lo que no corta: el cierre de iteración, que si empezó termina sus pocas
llamadas para no dejar la iteración sin resumen.

**Un resultado negativo del laboratorio cuenta en contra.** La afirmación del
laboratorio se guardaba sin `relacion`, y certeza.py lee "sin relación" como
apoyo de origen: un negativo interpretable subía la certeza. Ahora
`RELACION_LABORATORIO` da "apoya" al apoyo reproducido y "contradice" al
negativo; el inconcluso no entra en la evidencia, y la corrección de contexto
solo apoya a la hipótesis derivada. La migración `_migrar_relacion_laboratorio`
arregló la única afirmación así del estado, la de hip-mtvulxbg-140, que además
venía de `datos_gfap_nfl_sintetico.csv` sin marcar como sintética (se guardó
antes de S-18): ahora es sintética y no cuenta como evidencia real.

**GWAS Catalog filtra por gen.** La API v2 ignora `gene_name` y devolvía el
catálogo entero (1.192.604 asociaciones); se miraban las 50 primeras, de cáncer
de pulmón, y ROSA2018 escribía que APOE no tiene asociaciones con Alzheimer.
Con `mapped_gene` y `efo_id=MONDO_0004975` son 138. El conector hace dos
consultas filtradas y comprueba fila a fila que cada asociación es del gen; si
la API vuelve a ignorar el filtro, lanza FuenteNoDisponible ("no pude
comprobar") en vez de contar un cero. `_migrar_gwas_sin_filtro` devolvió a "por
comprobar" lo que salió del conector roto: 12 novedades genéticas y 23 capas
genéticas de perfiles de diana. Para GFAP el cero era cierto por casualidad.

**El juez de verificación ve el pasaje.** Recibía los primeros 6.000
caracteres del fragmento aunque el extractor lea 18.000; cuando el pasaje caía
más abajo, juzgaba sin él. `ventana_para_juez` le da una ventana de 6.000
centrada en el pasaje que copió el extractor, con marcas de lo omitido. En el
estado real había 35 afirmaciones así (17 rechazadas, más de la mitad de todas
las rechazadas, y 5 aprobadas sin ver su respaldo): ahora el juez ve el pasaje
en las 35. No se han vuelto a verificar: cuesta llamadas al juez y es decisión
de Emir.

### El dossier se descarga con el diseño del Alzheimer Project (25 de septiembre de 2026)

Pedido de Emir: que "Descargar" de un dossier dé el Word con el diseño de la
norma de Monica. El diseño es el suyo, no una imitación:
`rosa/plantillas/documento_hipotesis.docx` se sacó de su Word original
(AP_DOC_Hypothesis_Document_Control_SOP_v0.1_2026-09-17_MD.docx) quitándole el
texto y dejando la cabecera (el árbol con "ALZHEIMER PROJECT" y la línea de
control a la derecha), el pie (con PAGE y NUMPAGES) y un párrafo de muestra de
cada tipo: título, subtítulo, línea de datos, sección, texto, recuadro y
viñeta. `documento_controlado.docx` copia esas muestras con el texto del
dossier, así que letra, colores (#3B145F, #613D8F, #1E2126), tamaños y
espaciados son los de la norma. Se pone Arial explícito en cada trozo porque la
vista previa de macOS no aplica la fuente por defecto del documento (al Word
original de Monica le pasa igual).

En Artefactos, al abrir un dossier, el botón es ahora "Descargar vN (Word)"
(`/api/artefactos/{id}/v/{n}.docx`); el texto plano sigue en "Texto (.md)".
Si esa versión del dossier se emitió como documento controlado, sale con su
código AP-HYP; si no, sale como borrador, con "sin código: no emitido" en la
cabecera y en el bloque de datos, para que nadie lo tome por uno controlado.
Sin nombre corto todavía, el borrador usa el título cortado por palabra entera.
Los dossiers generados antes del 14 de septiembre salen sin tildes: basta
regenerarlos.

### Corrección: el dossier se descarga en PDF, no en Word (25 de septiembre de 2026)

Emir: "era en pdf, no en word". Los dos botones de Artefactos ("Descargar vN
(PDF)" del dossier y "Descargar PDF vNN" de cada versión emitida) dan ahora un
PDF (`/api/artefactos/{id}/v/{n}.pdf` y `/api/documentos/{hipótesis}/{vNN}.pdf`),
hecho con `documento_controlado.pdf` sobre PyMuPDF, sin Word ni LibreOffice.
Las medidas se leyeron del PDF de la norma de Monica: A4, márgenes de 72 pt,
logo en su sitio, cabecera 8,5 pt a la derecha, título 20 pt, subtítulo 11 pt,
franja lila #F3ECFB en las líneas de datos, secciones 13 pt, cuerpo 10,5 pt y
pie 8 pt con "Page X of Y" contado. La fuente es la de su PDF, Liberation Sans
(SIL OFL, `rosa/plantillas/fuentes` con su licencia), que tiene griego (ε, Δ), y
el logo es la imagen de su PDF (`rosa/plantillas/logo_alzheimer_project.jpg`).
El Word (`documento_controlado.docx` y su plantilla) se queda en el código,
sin botón, por si hace falta editable.

Y el panel "Documento controlado" ya no enseña la frase sobre la norma
AP-DOC-002: a Emir le parecía código interno.

### El PDF, sin datos crudos (25 de septiembre de 2026)

Emir: "esos datos crudos no deberían verse en el pdf". `para_lector` en
rosa/documento_controlado.py limpia el dossier antes de maquetar el PDF (y el
Word); el artefacto guardado no se toca, sigue entero para auditoría. Fuera:
"Controlled per" del bloque de datos, la línea del commit y el nivel de
autonomía, los ids internos (hip-, art-, run-, huellas), el Elo, la línea de
novedad con puntuaciones, la tabla "Qué dicen las bases de la diana" (con
nombres de conectores), los resultados y la línea base del análisis en
clave=valor y su "pasaje", las comprobaciones una a una del auditor y de cada
decisión, el nombre del modelo y "killer_1", los volcados en bruto de la
respuesta del modelo, las decisiones técnicas ("El juez no respondió"), los
campos vacíos ("no declarados", "sin criterio"), la revisión del registro por
regla, los nombres de fichero y la nota del evaluador tras cada supuesto. Se
traducen las etiquetas ([sostenida, dato, clase literatura], muy_baja,
revision_registro_abierta, Killer) a texto normal. Un test lista todo lo que
no debe llegar.

Y la franja lila de los datos ya no se repite arriba de cada página: la Story
de PyMuPDF volvía a pintar el fondo CSS en las páginas siguientes; ahora se
pinta a mano solo en la primera, por debajo del texto.

## El arnés de Yoon traído entero: cuatro piezas (25 de septiembre de 2026)

Emir mandó el artículo de Yoon y otros (2026, Anthropic) sobre el arnés con el
que corrieron 119 tareas y 949 sesiones sin intervención humana, y pidió traer
lo que sirviera. De ahí salieron cuatro piezas, diseñadas por cuatro
exploradores en solo lectura y cruzadas por un escéptico que buscó los choques
entre ellas antes de tocar nada. El orden de implementación es el que ese
informe recomendó, y sus tres recortes de alcance se respetaron.

Lo que el artículo tiene y ROSA2018 no tenía, en una frase por pieza: el
supervisor devuelve el trabajo, un agente puede abrir tareas nuevas con una
cola que las acepta o las rechaza por escrito, el torneo compara a ciegas con
descalificación automática, y cada etapa se cierra con una comprobación
programada.

### 1. El torneo, a ciegas y con pérdida automática por solidez

La tarjeta que ve el juez ya no lleva título, cluster ni el bloque de revisiones
automáticas, que llevaba dentro el veredicto del Killer, el de la novedad y
"Partido en la iteración N contra <título del rival>: ganó". La caza del 23 de
septiembre midió la consecuencia: el orden de Bradley-Terry de inv-mu2sz2ns-3
seguía al veredicto del Killer, y las tres últimas eran justo las tres
descartadas. `contexto.hipotesis_para_torneo` se renombró a
`hipotesis_con_revisiones` porque no es la tarjeta del torneo: alimenta el
panorama de MetaRevisar, que sí debe verlo todo.

Y se arregló de raíz quién cuenta como persona. Cualquier firma distinta de
"Rosa" contaba como humana, y el Killer firma con el id del modelo juez: 131
revisiones de modelo (127 de Opus, 4 de Astra) llegaban al torneo y a la
conclusión GRADE por el campo `revisiones_humanas`, cuya descripción decía "Lo
que dijeron las personas" y cuyo docstring añadía que pesan más que las
automáticas. En las 28 hipótesis del estado hay CERO revisiones humanas reales.
Las 26 conclusiones escritas así se rehacen al próximo cierre y el motivo lo
dice con esas palabras, no "la evidencia contada cambió": la evidencia no
cambió, cambió quién se creía que la había revisado.

`rosa/solidez.py` es la pérdida automática, por regla y sin modelo. Se toma de
Yoon que solidez 2 o menos pierde el partido; se tira la rúbrica del 1 al 5 con
pesos 0,35/0,30/0,25/0,10, porque las 20 conversaciones de Claude Science
midieron 0,03 de correlación de Spearman entre dos rondas de repuntuación a
ciegas de lo mismo, y entre impacto y novedad hay cinco centésimas: un punto de
temblor cambia el ganador. Descalifican los cuatro veredictos que ya bloquean la
candidatura, una fuente retractada, el descarte del Killer y los dos bloqueos de
análisis. NO descalifican "sin verificar", ni el Killer sin juzgar, ni las
puertas de proceso, que hoy tiene el 100 % de las hipótesis vivas. El partido de
una descalificada se resuelve sin llamar al juez y ANTES del primer partido con
juez, así que el torneo sigue dando resultado con el presupuesto agotado (hoy,
sin presupuesto, no hacía nada).

La rejilla: `emparejar` gastaba cada hipótesis en un solo par por ronda, así que
con 9 vivas devolvía 4 pares de los 36 posibles; siete pares no se jugaron nunca
y uno se jugó 9 veces. Con `una_vez_por_ronda=False` el guardia pasa a ser por
par, y `MAX_PARTIDOS_CON_JUEZ_POR_ITERACION = 6` reparte la rejilla diciendo en
voz alta cuántos pares aplaza. Medido sobre inv-mu2sz2ns-3: 6 al juez (12
llamadas), 13 por regla (0 llamadas), 4 aplazados.

El par que se forzaba para siempre: `registrar_partido` solo guardaba la
relación cuando no era "distintas", y `_torneo` fuerza el par redundante
mientras ningún partido suyo tenga relación. Ahora se guarda siempre y el
dirimente se marca aparte con `_dirimidoCon`, que distingue "se lo preguntamos
antes" de "se lo preguntamos por la redundancia". La primera versión conflaba
las dos cosas y un test lo cazó.

### 2. Cada etapa se cierra con una comprobación escrita en código

`rosa/comprobaciones.py`, nueve reglas para las nueve herramientas, cero
llamadas. El estado dice si el paso TERMINÓ; la comprobación dice si SIRVIÓ. En
el estado guardado son 256 pasos en "hecho" que nadie miró, y la prueba está en
la novedad: 30 pasos cerrados como hechos mientras 20 de 28 hipótesis siguen con
la novedad pendiente. No se parsea el resumen del ejecutor porque hay uno que
miente: `paso_novedad` devuelve "Novedad comprobada en N hipótesis" donde N es
cuántas intentó.

Cuatro resultados y la diferencia es la regla de la casa: `pasa`, `sin_materia`
(no es un fallo), `falla` y `no_comprobable`. En novedad nunca hay `falla`: ahí
quien no responde es la base. La puerta de la cadena pide DOS condiciones a la
vez (la etapa anterior falló y esta no tiene materia propia), que es lo que
impide romper el camino real.

Consecuencias, todas gratis: chip en el plan en vivo, lección por regla que ya
entra en los prompts siguientes, hallazgo del revisor y evento. Sin reintento
automático: gasta dinero sin permiso y estos fallos son los que repetir igual
repite. Y si una iteración cierra sin que NINGUNA etapa cumpla y con al menos
una fallando, ROSA2018 se pausa a sí misma. En las 50 iteraciones guardadas ese
caso ocurre una vez: la iteración en la que el gateway devolvió un error de
facturación y las cinco etapas siguientes giraron en vacío mientras la corrida
seguía como si nada.

### 3. El revisor devuelve el trabajo

170 hallazgos en 33 iteraciones, los 170 abiertos, ninguno atendido nunca. La
puerta de entrada (un hallazgo grave abierto) dispara en 15 de 33 iteraciones,
45 %, casi la tasa de Yoon (49 de 119). Rehace el cerebro, que escribió el
texto; comprueba el juez, con sus herramientas de solo lectura. Si el juez
reescribiera, corregiría su propia nota.

Tres candados deterministas: las reglas se vuelven a correr enteras (39 de los
170 hallazgos son de regla y se cierran sin llamar a nadie); `RR.toco_el_texto`
exige que el texto cambiara DONDE el hallazgo señalaba, que es el fallo de Yoon
cazado por código y no por otro modelo; y una vuelta que sube el peso de las
reglas se rechaza y vuelve al texto anterior. Escribir el test del tercero
encontró un fallo mío: comparaba contra el peso de los hallazgos de regla de la
revisión en vez de contra las reglas corridas sobre el texto viejo, así que con
hallazgos solo del juez la base era cero y toda vuelta se rechazaba.

Una vuelta, no dos: Yoon no fija tope y una de sus tareas se quedó colgada tras
diez revisiones. Un hallazgo rebatido NO queda cerrado y sigue reteniendo la
publicación en los dos lados de la regla: la rebatida la escribe la misma parte
que escribió el texto. Y `etapa_incumplida` es clase propia con
`reparablePorTexto: false`, porque si abriera vuelta el bucle la cerraría
reescribiendo el resumen PARA QUE MENCIONE la etapa rota: blanqueo por prosa.

Dos arreglos adyacentes: el texto revisable pasa a incluir las listas del llano
(mediana de 2.419 a 4.173 caracteres, máximo 6.517, corte de 6.000 a 12.000), y
la partida `reparacion` entra en `desglose_previsto_del_cierre`, que es lo único
que alimenta `reserva_cierre`; sin ella el cierre pausaría la corrida justo en
las iteraciones con hallazgos graves, que es S-14 otra vez.

### 4. Un paso puede pedir trabajo: la cola de triaje

`rosa/tareas.py`. Cero llamadas nuevas: las propuestas viajan como campo de
salida de `ActualizarModeloDeMundo`, `GenerarHipotesis` y `RevisionRegistro`, y
el triaje es regla pura. El sitio del generador de hipótesis es el equivalente
exacto del caso de Yoon: ahí una propuesta que no cita afirmaciones sostenidas
se descarta en silencio y lo que vio se pierde.

El rechazo lleva SIEMPRE motivo escrito, que es la mitad del valor de la cola. La
equivalencia no se reinventa: es `cuestiones.equivalencia`. Y una cuestión dice
qué NO sabemos; una tarea dice qué se HACE para saberlo, así que no entran por
ahí (las cuestiones están en 60 abiertas de 60).

Se ejecuta en la iteración siguiente, nunca en la que corre: el tope se fija al
nacer y meter un paso a mitad dejaría el cierre sin reserva, y además el plan lo
aprueba una persona. `ProponerPlan` recibe la cola y devuelve
`tareas_no_programadas`: dejar una tarea fuera es una decisión que hay que
defender por escrito.

La cola no sube el nivel de autonomía (sigue en el 2 de Beal y Rogers): las
herramientas que una tarea puede pedir son las nueve que ya existen, todas leen
o calculan, y `contactar_laboratorio` se queda fuera. Hay un test que lo fija.

### Los tres recortes del verificador de choques, respetados

La **tarea forzada por regla** se dejó fuera: hasta 90 llamadas
(`COSTE_POR_TIPO["hipotesis"]`) y el mismo efecto antienterramiento sale gratis
porque el planificador tiene que explicar cada tarea que deja fuera y la que
nadie explica caduca sola. La **segunda vuelta de reparación** se dejó en una,
por lo medido. Y las **tareas del revisor** se registran en la mutación del
cierre y no dentro de `_revisar_registro`, porque una vuelta rechazada dejaría
tareas escritas que la sobreviven; `RevisarReparacion` no tiene campo `tareas` a
propósito, o la segunda vuelta duplicaría cada una.

### Lo medido contra el estado real después de reiniciar (25 de septiembre, 13:50)

Las migraciones entraron: la clave `tareas` existe, y 26 de las 28 hipótesis
quedaron marcadas para rehacer su conclusión con el motivo "se escribió contando
revisiones de modelo como si fueran de personas". El campo `revisiones_humanas`
devuelve ahora "Ninguna." en las 28, que es la verdad.

Las cifras exactas de lo que cambia, medidas sobre las tarjetas reales y no
estimadas:

- La cabecera que se quita (título, mecanismo, comprobación y cluster) es una
  mediana de 2.862 caracteres, y el bloque de revisiones automáticas otros 2.335.
  La tarjeta entera encoge una mediana de 2.486 caracteres (de 1.517 a 3.122); el
  resto del hueco lo ocupan afirmaciones de verdad, porque el recorte de las
  afirmaciones ya estaba en su tope de 6.000.
- **28 de 28 tarjetas llevaban dentro el título de un rival**, y 4 de 28 llevaban
  un veredicto de descarte.
- El campo `revisiones_humanas` traía una mediana de 921 caracteres (máximo
  3.640) a 26 de las 28 hipótesis, y todo era salida de modelo. En un partido
  medio eran unos 1.842 caracteres de opinión de modelo presentada al juez como
  humana, junto a la instrucción de que las humanas pesan más.
- El torneo de inv-mu2sz2ns-3 pasa de 4 pares con juez (8 llamadas) a 6 con juez
  (12 llamadas) más 14 por regla (0 llamadas) y 8 aplazados a las iteraciones
  siguientes.
- En los 50 planes guardados hay **5 combinaciones distintas** de tipos de paso, y
  una sola sale en 35 de ellos. Eso es lo que la cola de triaje viene a mover.

### Lo que este bloque destapó y no se arregló aquí

La regla de veredictos de `rosa/solidez.py` no puede disparar hoy: a una
hipótesis solo se le atan afirmaciones sostenidas o parciales
(`evidencia.afirmaciones_nuevas`) y la réplica baja el veredicto sobre COPIAS
(`corrida._preparar_copias_replica`, `dict(a, ...)`). O sea que si la réplica
dice "esta afirmación no se sostiene al releerla", eso no llega nunca a la
afirmación guardada. Está dicho en el docstring del módulo para que no parezca
una protección que protege. Escribir de vuelta el veredicto de la réplica es una
decisión aparte y no se tomó aquí.

## Prueba de humo: ROSA2018 sobre Vercel Workflows (26 de septiembre de 2026)

El jefe de Emir propuso Vercel Workflows en vez de un VPS. Antes de migrar nada se
desplegó una prueba mínima en el equipo AI Robotix de Vercel (plan Pro), en un
proyecto aparte, `rosa-workflow-prueba`, protegido con una llave para que nadie de
fuera pueda gastar llamadas. El código vive fuera de este repositorio, en
`~/rosa-workflow-prueba`: un workflow de Python con dos pasos y una siesta.

Lo que había que saber, y lo que salió:

- **Python, DSPy y un modelo por el AI Gateway: funciona.** `vercel-workflow`
  0.11.0 (Python en beta) con `dspy` 3.3.1. Sonnet respondió; 8,5 s la primera
  llamada (arranque en frío, con la importación de DSPy) y 1,4 s en caliente. La
  función se autentica en el gateway con el token OIDC que Vercel le da, sin subir
  ninguna clave: el gasto va a la cuenta de Vercel de AI Robotix.
- **Dormir y seguir: funciona.** La ejecución durmió 240 s sin consumir y siguió
  donde iba, con unos 3 s de desfase.
- **Sobrevivir a un despliegue: funciona, y con una propiedad que importa.** Se
  redesplegó a mitad de la siesta y la ejecución terminó bien, pero en el
  despliegue con el que había empezado: Vercel fija cada ejecución a su despliegue
  (Skew Protection). Para ROSA2018 eso quiere decir que un push no corta una
  corrida y que el código nuevo solo lo usan las corridas nuevas. Es lo que hoy
  hace a mano `scripts/parar_servidor.py`, sin tener que esperar.
- **El tamaño cabe.** La página de límites de funciones de Vercel da 500 MB sin
  comprimir para Python (5 GB con Large Functions, en beta). ROSA2018 instalada
  sin mlflow son 277 MB medidos; mlflow y lo que arrastra (pyarrow, matplotlib,
  scikit-learn, sqlalchemy) son unos 250 MB más y solo lo usan los dos módulos de
  GEPA, que no tienen por qué correr en la nube. La prueba ya llevaba DSPy y
  litellm, que es lo más pesado del resto.

Lo que la prueba NO resuelve, y sigue en pie del diseño revisado por el escéptico:
el estado tiene que salir de SQLite a Convex (1 MiB por documento en Convex contra
30 MB de estado, así que partido); cada paso sigue limitado a 800 s; y el botón
Detener y el tope de gasto tienen que leer la corrida en Convex antes de cada
llamada al modelo, porque en Vercel ya no comparten memoria con la interfaz.

## El equipo de generación de hipótesis (27 de septiembre de 2026)

Emir pasó dos artículos y un blog. De Park y otros ("Scaling Discovery through
Test-Time Communication", arXiv 2609.21032): varios agentes que comparten un
tablón rinden mucho más que los mismos aislados (en ARC-AGI-3, 5 agentes que se
comunican rinden como 33 independientes), con dos condiciones: un marcador fiable
que puedan consultar mientras trabajan y reglas contra el rebaño. De Shen,
Druckmann y Zou ("Unlocking LLM Creativity in Science through Analogical
Reasoning", arXiv 2605.11258): los modelos colapsan hacia las mismas soluciones
(1,6 % de novedad con Claude pidiendo soluciones a secas) y una analogía estructural
con otro campo lo sube al 50-69 %. El blog de Wenhao Chai sobre enjambres es una
simulación sin código y se usó solo como apoyo.

Yo había propuesto no montar el equipo todavía por el coste: la historia entera de
ROSA2018 son 7,4 millones de tokens de salida y un experimento de Park son 24
millones. Emir decidió que sí, y tenía razón por una regla de la casa: el coste por
token no es criterio.

`rosa/equipo.py` y `pasos._equipo_de_hipotesis`. Cuatro miembros, cada uno una
llamada al cerebro con un enfoque distinto (analogía entre campos, contradicción,
mecanismo opuesto, otra escala), en dos rondas. El marcador es POR REGLA, sin
ningún modelo: las mismas reglas con las que ROSA2018 ya decide si una propuesta
vale (cita afirmaciones sostenidas, nace con dos cohortes, es falsable, no repite,
no vuelve a los marcadores que dominan). En la segunda ronda cada miembro lee el
tablón con la puntuación de cada propuesta y por qué, las que fallaron incluidas.
Al final entran dos, las de más puntos, sin repetir enfoque ni idea. El equipo
cambia la calidad y no la cantidad: sigue entrando el mismo tope de propuestas, y
lo que entra sigue el camino de siempre (vivero, revisión, supuestos, Killer).

Probarlo con los modelos de verdad destapó dos fallos que ninguna prueba sin red
habría visto, y el primero era anterior al equipo:

1. **El generador solo veía el 4 % de la evidencia, y siempre la misma.** Recibía
   el texto de las afirmaciones sostenidas cortado a 12.000 caracteres en orden de
   extracción: de las 1.149 de la corrida viva veía 54, todas de la primera
   iteración y de 4 fuentes. Las 712 de las iteraciones 2 y 3 no las vio nunca
   ningún generador. Es una causa directa de las hipótesis repetidas. Ahora cada
   miembro recibe un trozo distinto, con lo más reciente primero y una fuente
   distinta por afirmación: entre los cuatro ven 195, de 47 fuentes cada uno.
2. **Los miembros se autocensuraban.** Con la instrucción del generador único
   ("devolver la lista vacía es una respuesta válida y frecuente"), los ocho
   devolvieron cero propuestas: veían ideas nuevas y las descartaban ellos mismos
   porque "no constituyen validación en dos cohortes clínicas". Pero esa regla la
   aplica `destino_de_propuesta` después. El mandato del equipo les dice que su
   trabajo es proponer y no filtrar, sin inventar: cada propuesta cita
   afirmaciones sostenidas por su número.

Con los dos arreglos, el equipo produjo 7 propuestas y entraron 2. Ninguna de las
9 hipótesis vivas de esa investigación trataba esos temas, y las dos se apoyan en
afirmaciones sostenidas que ya estaban en el registro:
- **Por analogía con la identificación de sistemas en ingeniería** (separar una
  respuesta transitoria de una deriva del proceso): la pérdida cortical tardía,
  separada del cambio de volumen inicial, predice mejor la respuesta clínica que el
  cambio total de resonancia. Se apoya en que el grosor cortical puede estar
  confundido por pseudoatrofia en los ensayos anti-amiloide (Biel 2025, pág. 2) y
  en los cambios de volumen con bapineuzumab y verubecestat.
- **Por contradicción**: el descenso de neurogranina acompañado de preservación
  de NPTX2 distingue menos lesión de pérdida de señal sináptica. Se apoya en lo
  que gantenerumab hizo a esos marcadores (Bittner 2025).

Coste: ocho llamadas al cerebro en vez de una en el paso de hipótesis. La reserva
del paso sube de 90 a 97 llamadas.
