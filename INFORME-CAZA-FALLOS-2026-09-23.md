# Caza de fallos de ROSA2018 (23 de septiembre de 2026)

Nueve cazadores en solo lectura, uno por parte de ROSA2018 (bucle, hipótesis, juicio, evidencia, estado, interfaz, eficiencia, datos reales, tests), y un escéptico por cazador que intentó refutar cada hallazgo leyendo el código o reproduciéndolo. Ninguno fue refutado. Los escépticos de eficiencia, datos reales y tests no llegaron a correr (se agotó el límite de sesión), así que sus hallazgos van como SIN VERIFICAR.

Total: 91 hallazgos. CONFIRMADO critica: 4; CONFIRMADO alta: 17; CONFIRMADO media: 28; CONFIRMADO baja: 9; PLAUSIBLE alta: 1; PLAUSIBLE baja: 1; SIN VERIFICAR alta: 10; SIN VERIFICAR media: 14; SIN VERIFICAR baja: 7

## [CONFIRMADO · critica · fallo] El conector de GWAS Catalog ignora el filtro por gen y ROSA2018 afirma que APOE no tiene asociaciones con Alzheimer

`rosa/conectores/bases.py:206`

**Qué pasa.** La API v2 de GWAS Catalog no reconoce el parámetro `gene_name` y devuelve el catálogo entero sin filtrar (1.192.604 asociaciones). El conector solo mira las 50 primeras, que son de cáncer de pulmón. `n_alzheimer` sale 0 para cualquier gen y la invariante devuelve siempre True.

**Escenario.** Hipótesis sobre APOE, en el paso de novedad o en su perfil de diana: GET /associations?gene_name=APOE&size=50 devuelve totalElements 1192604 y como primeras filas GCST90994723 (lung cancer, genes TTC28 y ZBTB46). ROSA2018 escribe «APOE: 0 asociaciones GWAS con Alzheimer» en la novedad y «GWAS Catalog: 0 asociaciones con Alzheimer entre las 50 vistas de 1192604 registradas del gen» en el perfil. Ese perfil lo lee el juez del Killer (pasos.py:3173) y también la auditoría de descarte y la reformulación. Con la consulta correcta hay 138.

**Evidencia.** Estado real: los 20 registros de gwas_asociaciones_gen (GFAP, APOE, MAPT y APP) tienen n=1192604 e invariante {'ok': True, 'detalle': '0 de 50 asociaciones vistas son de Alzheimer'}. 12 hipótesis tienen novedad.genetica en 'sin_vinculo' («GFAP: sin asociaciones GWAS con Alzheimer entre 1192604 registradas del gen»). hip-mtxfoq5o-16 dice «APOE: 0 asociaciones GWAS con Alzheimer». Los 23 perfiles de diana repiten el texto, entre ellos hip-mu1mrftd-377 para APOE. Prueba en vivo de hoy: gene_name=APOE da total 1192604; mapped_gene=APOE da 4630; mapped_gene=APOE&efo_id=MONDO_0004975 da 138; mapped_gene=GFAP&efo_id=MONDO_0004975 da 0.

**Propuesta.** Pedir `mapped_gene={simbolo}&efo_id=MONDO_0004975` (y EFO_0000249) con sort=p_value&direction=asc, y tomar como n_alzheimer el page.totalElements de esa consulta ya filtrada. La invariante tiene que comprobar que cada fila trae el símbolo en mapped_genes; si no, lanzar FuenteNoDisponible («la API ignoró el filtro»). No escribir «registradas del gen» si el total no sale de una consulta filtrada por gen. Después, repetir la novedad genética y el perfil de diana de las hipótesis afectadas.

**Escéptico.** Leí rosa/conectores/bases.py:204-217: pide gene_name con size=50, n_alzheimer se cuenta solo sobre esas 50 filas y la invariante es siempre (True, ...). Hice GET públicos de solo lectura a la API: gene_name=APOE y gene_name=GFAP dan los dos totalElements 1.192.604 y como primeras filas GCST90994723 (lung cancer, TTC28). mapped_gene=APOE da 4.630. mapped_gene=APOE&efo_id=MONDO_0004975 da 138. MAPT da 7, APP 10, GFAP 0 y NEFL 0. En la copia del estado (solo lectura), los 20 registros de consulta tienen n=1192604 para GFAP, APOE, MAPT y APP. hip-mtxfoq5o-16 dice «APOE: 0 asociaciones GWAS con Alzheimer». Los 23 perfiles de diana repiten «0 ... de 1192604 registradas del gen», también hip-mu1mrftd-377 (APOE). El perfil llega al juez del Killer (pasos.py:3173, corrida.py:820 y 997), a la auditoría de descarte (3376) y a la reformulación (3478). El detalle de novedad entra al generador de la conclusión (corrida.py:1061). Además, n_alzheimer no depende del gen: si el estudio más reciente del catálogo fuera de Alzheimer, todos los genes saldrían con vínculo. Bajo la severidad a alta porque hoy ningún estado de novedad salió mal. GFAP y NEFL tienen de verdad 0 asociaciones con Alzheimer. En APOE, MAPT y APP, ClinVar deja la novedad en vinculo_conocido, y el mismo perfil trae la asociación genética de Open Targets (0,86 en APOE). Lo falso son el texto y el denominador, y queda latente un «sin_vinculo» falso para cualquier gen con GWAS y sin ClinVar. No encontré ninguna decisión del Killer que citara GWAS. TRASPASO no lo menciona.

## [CONFIRMADO · critica · fallo] Un fallo al guardar deja el cambio en memoria y bloquea todas las escrituras hasta reiniciar

`rosa/estado/almacen.py:365`

**Qué pasa.** mutar aplica el reductor sobre el estado en memoria antes de serializar, calcular el hash y guardar. _serializar (línea 355) y hash_fila (365) están fuera del try, y el except de 373-396 solo recarga desde disco cuando el error es EscritorObsoleto. Si falla cualquiera de esos pasos, el cambio se queda en memoria sin guardar y, en el caso de _serializar, _partes ya se ha actualizado. Mientras ese valor siga en memoria, fallan todas las mutaciones siguientes.

**Escenario.** Una acción, o un texto de una fuente externa, trae un sustituto UTF-16 suelto. Por ejemplo, POST /api/acciones/anadirCriterio con {"texto":"criterio \ud83d"}, que es lo que produce JSON.stringify de una cadena cortada a mitad de un emoji. La primera acción responde 400. Desde ese momento, cada acción de la persona también responde 400 ('Argumentos inválidos... UnicodeEncodeError'), pero su reductor ya se ha aplicado en memoria. Las mutaciones del bucle fallan igual: la versión no sube, el SSE no empuja nada y la interfaz se queda en la última instantánea buena, mientras /api/salud responde ok. El bucle sigue avanzando en memoria y pagando llamadas. Como el Contador llama a registrar_llamada después de mutar (contador.py:182-183) y DSPy se traga la excepción del callback, esas llamadas tampoco quedan en la tabla llamadas. Al reiniciar se pierde todo lo hecho desde el fallo. Un valor que no se puede pasar a JSON (un set o un numpy.int64) produce el mismo efecto, porque _serializar lanza TypeError.

**Evidencia.** Prueba en una base temporal: aplicar('anadirCriterio', {'texto': 'criterio \ud83d'}) lanza UnicodeEncodeError, que es subclase de ValueError y por eso el servidor responde 400, y deja 'criterio \ud83d' en memoria. La acción siguiente ('criterio normal') y una mutación del bucle lanzan 'surrogates not allowed' dentro de _guardar. En disco sigue la versión 0 y en memoria hay tres criterios nuevos. El estado real no tiene hoy sustitutos sueltos, pero sí 77 caracteres fuera del plano básico (𝛽, 𝜀, 𝜷) en _fuentes y en busqueda.excluidos.

**Propuesta.** Meter en el try todo lo que viene después de fn (serializar, hash y guardar) y llamar a _recargar_desde_disco() ante cualquier excepción, no solo con EscritorObsoleto. Validar antes de tocar el disco con texto.encode('utf-8') en modo estricto y json.dumps(..., allow_nan=False), para que la mutación que mete el valor malo se rechace y se deshaga. Rechazar en leer_json_acotado los cuerpos con sustitutos sueltos, y sustituirlos por U+FFFD en los textos que llegan de los conectores. En el Contador, llamar a registrar_llamada antes de mutar (o en un finally). Que /api/salud informe del último fallo de guardado.

**Escéptico.** Lo reproduje en una base temporal siguiendo el mismo camino que el servidor. json.loads(b'{"texto":"criterio \\ud83d"}') deja un sustituto suelto. Al llamar a aplicar('anadirCriterio'), hash_fila lanza UnicodeEncodeError (almacen.py:365, fuera del try) cuando el criterio ya está en memoria. La acción siguiente y una mutación 'tick' fallan con 'surrogates not allowed' dentro de _guardar, porque el except de 373-396 solo recarga si el error es EscritorObsoleto. Resultado: en disco sigue la versión 0, hay 0 filas en acciones y en memoria hay tres criterios nuevos. UnicodeEncodeError es subclase de ValueError, así que servidor.py:409-411 responde 400 junto a un comentario que dice que el almacén ya deshizo la mutación, y no es verdad. /api/salud solo mira obsoleto. contador.py llama a mutar antes que a registrar_llamada, y DSPy 3.3.1 (_execute_end_callbacks) se limita a registrar un aviso, así que las llamadas pagadas no quedan en 'llamadas'. Hay un matiz que no cambia la conclusión: si el TypeError salta en _serializar, _partes NO se actualiza (la comprensión lanza antes de asignarlo); se actualiza cuando fallan hash_fila o _guardar. Ningún test cubre los fallos posteriores al reductor. Bajo la severidad de crítica a alta porque el disparador es raro. Hoy el estado no tiene sustitutos sueltos. Con un PDF fabricado comprobé que PyMuPDF convierte en U+FFFD un sustituto que llega por ToUnicode, así que la vía de los PDF no lo produce. Quedan dos vías. Una son las respuestas JSON de los conectores, que no pude comprobar sin red. La otra es la cita del comentario, que Comentarios.tsx recorta con slice(0, 237): parte un par sustituto si en esa posición hay un carácter fuera del plano básico. Hoy esos caracteres solo están en _fuentes, _afirmaciones y busqueda.excluidos, ninguno en campos que se puedan comentar. Sobre 'sigue pagando': cada tarea de corrida muere en su siguiente mutar (Pista no captura el error) y el supervisor la relanza con retroceso, así que hay gasto que no se guarda, pero acotado.

## [CONFIRMADO · critica · fallo] El generador de hipótesis solo lee los primeros 12.000 caracteres de las afirmaciones, y siempre son las mismas

`rosa/bucle/pasos.py:3769`

**Qué pasa.** paso_hipotesis pasa al generador texto_af[:12000]. texto_af numera todas las afirmaciones sostenidas de la corrida en orden de extracción (contexto.py:280). Con cientos de afirmaciones el modelo ve solo las 44 a 54 primeras, todas de la iteración 1, y la última cortada a media palabra; la evidencia nueva nunca le llega. El mismo corte afecta al reformulador (texto_af[:8000], pasos.py:3478), a la evidencia común del torneo (texto_af[:6000], pasos.py:3669) y a la consulta con la que se eligen el modelo de mundo y las lecciones (texto_af[:1500], pasos.py:3767-3768). Además, respaldo acepta cualquier índice hasta len(validas) (pasos.py:3780), así que un índice que el modelo no vio engancha una afirmación que no leyó.

**Escenario.** Corrida cor-mucppi81-3411, iteración 2 (22/09 10:30): hay 887 afirmaciones sostenidas (1.149 al final). El generador recibe las 54 primeras (6 %), sacadas de 4 fuentes de las 70 y todas de la iteración 1; el texto acaba en «54. (interpretacion) Sims argumentó que no es necesario realizar PET de ta». Devuelve una lista vacía con el argumento de que no hay dos cohortes distintas. En cor-mu75kw1i-752 las tres llamadas del 18/09 (12:20, 14:51 y 15:36) vieron las mismas 47 afirmaciones mientras la corrida pasaba de 100 a 335 y a 430.

**Evidencia.** Estado: la última hipótesis nacida en toda ROSA2018 es del 15/09 16:56. Desde entonces, inv-mu2sz2ns-3 tuvo 15 pasos de hipótesis y 14 llamadas al generador, con 0 hipótesis nacidas y 0 semillas en el vivero (el vivero está vacío en las 5 investigaciones). Trazas de MLflow (spans Predict.forward de GenerarHipotesis, 13 desde el 16/09): el campo afirmaciones_sostenidas mide exactamente 12.000 caracteres en 12 de las 13, contiene de 44 a 54 líneas numeradas y la salida es siempre "hipotesis": [], con razonamientos como «no cumplen el requisito de evidencia procedente de dos cohortes distintas». En cor-mucppi81-3411 lo que ve son 54 afirmaciones de 4 fuentes; lo que nunca ve son 1.095 afirmaciones de 66 fuentes, de ellas 696 datos y 699 con cohorte.

**Propuesta.** Elegir lo que entra en vez de cortar: (1) primero las afirmaciones nuevas desde la última generación que no estén enlazadas a una hipótesis viva; (2) ordenadas por el índice semántico contra las cuestiones abiertas y el objetivo (ya hay 2.696 vectores de afirmación); (3) con tope por fuente y diversidad por cohorte, porque la regla de nacimiento pide dos cohortes; (4) datos antes que introducciones; (5) corte por líneas completas con un presupuesto de tokens. Numerar solo lo que se muestra y rechazar índices de fuera. Al reformulador, darle la evidencia propia de la hipótesis (texto_afirmaciones_killer) y el resumen del precedente cuando falla la novedad. Medir: % de las afirmaciones nuevas de la iteración que llegan al generador (hoy 0 % desde la iteración 2), fuentes y cohortes distintas en el prompt (hoy 4 fuentes), propuestas por llamada, fracción que nace frente a la que va al vivero y nacimientos por cada 100 afirmaciones nuevas. Añadir un test de camino: una afirmación añadida en la iteración 2 tiene que aparecer en la entrada del generador.

**Escéptico.** Código: pasos.py:3769 pasa texto_af[:12000]; contexto.py:280 numera todas las sostenidas/parciales en el orden de corrida['_afirmaciones'], que solo crece por extend (pasos.py:1964), así que el corte siempre cae sobre las más antiguas. También confirmados los cortes de 3478 (reformulador, 8000), 3669 (torneo, 6000), 3767-3768 (consulta, 1500) y que 3780 acepta cualquier índice 1..len(validas). Simulación sobre rosa.db (solo lectura): en cor-mucppi81-3411 hasta la iteración 2 hay 887 válidas y los 12.000 caracteres contienen 54 líneas de 4 fuentes (de 51), todas de la iteración 1, y la última es literalmente «54. (interpretacion) Sims argumentó que no es necesario realizar PET de ta»; en cor-mu75kw1i-752, 47 líneas con 100, 335 y 430 válidas. MLflow (mlflow.db en solo lectura, spans Predict.forward del generador): desde el 16/09 hay 15 llamadas (no 13), 13 con exactamente 12.000 caracteres, y todas las salidas desde el 15/09 17:37 son lista vacía; el propio modelo escribe «La afirmación 47 está truncada y no es utilizable» y «En las afirmaciones numeradas suministradas no aparecen mediciones comparables». Última hipótesis nacida: 15/09 16:56; vivero vacío en las 5 investigaciones; inv-mu2sz2ns-3 tiene 9 vivas (tope 10), así que el tope no explica el vacío. Matiz: algo de la evidencia nueva llega por el modelo de mundo (la traza del 22/09 cita GRADUATE I/II desde ahí), pero no puede usarse como respaldo, porque nacer exige índices numerados. TRASPASO solo documenta el corte de 8000 del evaluador de supuestos (arreglado el 18/09); este no está documentado ni tiene test.

## [CONFIRMADO · critica · fallo] Los veredictos del Killer llegan al torneo y a la conclusión GRADE como revisiones humanas

`rosa/bucle/contexto.py:335`

**Qué pasa.** revisiones_humanas cuenta como humana cualquier revisión cuyo autor no sea "Rosa", pero el Killer firma con el id del modelo juez, "openai/anthropic/claude-opus-5" (pasos.py:3299-3301). Por eso sus decisiones, incluidas las antiguas, las tomadas con una regla ya retirada y las técnicas de «el juez no respondió», llegan al juez del torneo como «Lo que dijeron las personas sobre A y B» (firmas.py:418), junto con la instrucción «Las revisiones humanas pesan más que las automáticas» (firmas.py:412). También llegan así a ConcluirHipotesis (corrida.py:1062). Además, la tarjeta del torneo lleva el veredicto del Killer y el último resultado de partido (hipotesis_para_torneo, pasos.py:2555-2564). El torneo deja de ser una segunda opinión y ROSA2018 escribe que hubo personas donde no las hubo.

**Escenario.** Traza del 22/09 15:03 (CompararHipotesis): el campo revisiones_humanas dice «Sobre A: openai/anthropic/claude-opus-5 (killer): descartar en contexto: ... supuestos contradichos...». Es la decisión del 15/09 sobre hip-mu2zedte-898, tomada con la regla anterior al 17/09; con la regla de hoy daría suspender. El juez escribe en los debates frases como «B tiene un veredicto humano de descarte en contexto» y «killer humano: descartar en contexto frente a suspender». La conclusión GRADE de hip-mu1k00o4-61 dice «La revisión humana dictaminó suspender por riesgo de sesgo alto».

**Evidencia.** Estado: 0 revisionesHumanas en las 28 hipótesis. De las 133 revisiones con autor distinto de «Rosa», 131 son de modelos (76 killer, 47 suspendida y 4 reformulada de Opus, más 4 de GPT-6 Astra); las únicas de una persona son 2 «aceptada» de Emir del 10/09. 55 de los 94 resúmenes de debate atribuyen veredictos a humanos, y 12 conclusiones GRADE lo hacen en 19 frases distintas. Bradley-Terry en inv-mu2sz2ns-3: las tres últimas (1044, 1119 y 1216) son justo las tres que tienen Killer «descartar», y dos de esos descartes salieron de la regla vieja de supuestos.

**Propuesta.** Guardar en cada revisión el tipo de autor (persona, modelo o rosa) y que revisiones_humanas solo lea personas. Que el torneo compare a ciegas, como Co-Scientist: la hipótesis y su evidencia, sin «Revisiones automáticas» ni resultados de partidos anteriores. En la conclusión, pasar el veredicto del Killer etiquetado como decisión automática. Migración: rehacer las 12 conclusiones y marcar los 55 debates. Medir: 0 debates o conclusiones que mencionen una revisión humana cuando revisionesHumanas está vacío (test por expresión regular sobre el estado), y la correlación entre el orden de Bradley-Terry y el veredicto del Killer antes y después del arreglo.

**Escéptico.** Código: contexto.py:330-341 mete toda revisión con quien distinto de «Rosa»; el Killer firma con quien = ctx.modelos.juez.model (pasos.py, registrar_decision y revisiones killer/suspendida en 3299-3301); firmas.py:412 («Las revisiones humanas pesan más») y 418 («Lo que dijeron las personas»); corrida.py:1062 pasa lo mismo a ConcluirHipotesis. Estado: 0 revisionesHumanas; 133 revisiones de autor distinto de Rosa, 131 de modelos (76+47+4 de Opus, 2+2 de GPT-6 Astra) y 2 «aceptada» de Emir con la nota vacía, que ni siquiera entran. Traza MLflow del 22/09 15:03:58: «Sobre A: openai/anthropic/claude-opus-5 (killer): descartar en contexto: ... supuestos contradichos»; otras trazas meten como humana la nota técnica «El juez no respondió: no se puede dar por revisada». 55 de 94 resúmenes de debate mencionan «human*»; entre 9 y 14 conclusiones, según la expresión regular, atribuyen algo a una «revisión humana» (hip-mu1k00o4-61: «según la revisión humana»). Bradley-Terry de inv-mu2sz2ns-3: las tres últimas (1044, 1119, 1216) son las tres con descartar_en_contexto. La tarjeta del torneo (pasos.py:2555-2564) incluye además el veredicto del Killer y el último partido como «Revisiones automáticas». No está documentado ni tiene test. Mantengo crítica: ROSA2018 escribe en su conclusión principal que hubo revisión humana donde no la hubo.

## [CONFIRMADO · alta · fallo] El juez solo ve los primeros 6.000 caracteres del fragmento y bloquea afirmaciones cuyo pasaje literal está más abajo

`rosa/bucle/pasos.py:2045`

**Qué pasa.** `juzgar` pasa al juez `frag.texto[:6000]`. En cambio, el extractor lee hasta 3 partes de 6.000 caracteres (18.000 desde la tanda 2), y el determinista ya comprobó que el pasaje está en el fragmento entero. Cuando el pasaje cae después del carácter 6.000, el juez decide sin verlo. Además, las pistas le dicen «Cifras presentes en el fragmento» con cifras que él no ve.

**Escenario.** Corrida 16, af-mucq0n1k-4732, fuente FDA (4), con un «resumen» de 7.950 caracteres. El pasaje «time saved of 4.4 (1.87, 6.85) months ... 1.4 (0.46, 2.3) months» está literal entre los caracteres 7.043 y 7.295. Las pistas decían «Cifras presentes en el fragmento: 0.46, 1.4, 1.87, 18, 2.3, 4.4, 6.85». Veredicto: no_sostenida, porque «no reporta ninguna estimación de 'tiempo ahorrado' en meses ni las cifras 4.4 (1.87, 6.85)». Una afirmación verdadera queda bloqueada y no entra al modelo de mundo.

**Evidencia.** En el estado hay 35 afirmaciones con el pasaje entero más allá del carácter 6.000 de su fragmento: 17 no_sostenida, 13 parcial y 5 sostenida (en estas 5 el juez aprobó sin ver el respaldo). Esas 17 son más de la mitad de las 31 no_sostenida de todo el estado. Salen de resúmenes de Exa de unos 8.000 caracteres (FDA (2), (4) y (8), Pontecorvo et al., 2022, Ackley et al., 2023) y de páginas de PDF densas (Chen et al., 2026, pág. 6, 8.740 caracteres; Rabinovici et al., 2025, pág. 7).

**Propuesta.** Dar al juez una ventana centrada en el pasaje: situarlo con `_posicion_del_tramo` o con `citas.marcar_pasaje` y cortar unos 3.000 caracteres a cada lado. Otra opción es darle el fragmento entero con el mismo tope que al extractor. En los dos casos, pasarle aparte el pasaje copiado. Calcular las pistas de cifras sobre el mismo texto que ve el juez. Reverificar las 35 afirmaciones.

**Escéptico.** pasos.py:2045 le pasa al juez frag.texto[:6000]. En cambio, comprobar_determinista (verificador.py:629-660) comprueba el pasaje y calcula las pistas de cifras sobre el texto entero, y el extractor lee hasta 3 partes de 6.000 (politicas.py:202-203). Lo reproduje con af-mucq0n1k-4732. El resumen de FDA (4) tiene 7.950 caracteres y «time saved» solo aparece en la posición 7.019. pasaje_en_texto da True sobre el texto entero y False sobre texto[:6000]. Las cifras en común con los 6.000 primeros caracteres son solo «18». Con el texto entero son 0.46, 1.4, 1.87, 18, 2.3, 4.4 y 6.85, justo lo que dicen las pistas. El motivo del juez dice que el fragmento no da ninguna estimación de «tiempo ahorrado». Contando en todo el estado: 52 afirmaciones juzgadas tienen un pasaje que no cabe entero en los 6.000 primeros caracteres (21 no_sostenida, 24 parcial y 7 sostenida), y 44 empiezan después de ese punto. Las cifras del hallazgo (35: 17, 13 y 5) se quedan cortas, no son exageradas. Son 21 de las 31 no_sostenida del estado. «Reverificar» no lo arreglaría, porque pasa por el mismo juzgar. TRASPASO solo documenta el tope del extractor.

## [CONFIRMADO · alta · fallo] Los destacados de Exa se guardan y se citan como «resumen», y desplazan al resumen real

`rosa/fuentes/exa.py:111`

**Qué pasa.** En un resultado de Exa, `resumen` son los pasajes destacados de la página unidos: introducción, métodos, resultados y discusión. `_fragmentos_de` los guarda con localizador «resumen» (pasos.py:630), así que las afirmaciones salen citadas «[ref, resumen]» aunque el pasaje no esté en el resumen del artículo. `_registrar_fuente` deduplica los fragmentos por localizador (pasos.py:557-558): si Exa llega antes, se tira el resumen real de PubMed o Europe PMC. Y `es_de_fondo` nunca marca un «resumen», de modo que un texto de introducción o de discusión pesa en la certeza como resultado propio.

**Escenario.** O'Connor et al., 2022 (JNNP, doi 10.1136/jnnp-2022-329663, una carta sin resumen). Su «resumen» en ROSA2018 empieza «Glial fibrillar acidic protein (GFAP) ... biomarker of Alzheimer's disease (AD). 1 GFAP expression correlates...»: es la introducción, con marcas de cita. Nueve afirmaciones sostenidas lo citan «[O'Connor et al., 2022, resumen]». Una de ellas es una frase de la discusión («supporting previous findings that plasma GFAP is associated with amyloid burden») y tiene deFondo vacío. La médica que abre el resumen no encuentra ninguno de esos pasajes.

**Evidencia.** Estado real: en 274 de las 287 fuentes traídas solo por Exa, el «resumen» lleva elisiones «...» o supera los 3.000 caracteres (hasta unos 8.000). Lo citan como «resumen» 492 afirmaciones, 377 de ellas sostenidas. En 12 fuentes que también trajeron PubMed o Europe PMC se quedó el texto de Exa como resumen, por ejemplo Bateman et al., 2023 (NEJM, 7.981 caracteres) y Lu et al., 2025 (JAMA Neurol).

**Propuesta.** Dar a los destacados un localizador propio, por ejemplo «texto web, destacados», admitirlo en LOCALIZADORES_ADMITIDOS y tratarlo en la interfaz como texto web. En `_registrar_fuente`, si llega un resumen de PubMed o Europe PMC y el guardado viene de Exa, sustituirlo o guardarlo aparte en vez de descartarlo por localizador repetido. No contar estos fragmentos como resumen en `citas.resumen` ni en la certeza.

**Escéptico.** exa.py:111 usa summary (que la búsqueda no pide) o, si no, los destacados unidos. pasos.py:629-630 lo guarda como «resumen». pasos.py:557-558 descarta un fragmento nuevo cuyo localizador ya existe. La vía de reutilización (pasos.py:1433) excluye «resumen» a propósito, así que el resumen de PubMed o Europe PMC no entra nunca después de Exa. es_de_fondo (pasos.py:1692) deja fuera el resumen por diseño. En el estado, O'Connor et al., 2022 tiene un «resumen» de 7.368 caracteres. Empieza por la introducción con marcas de cita («(AD). 1 GFAP expression...») y sigue con los métodos, separados por «...». Nueve sostenidas lo citan como «[O’Connor et al., 2022, resumen]», con deFondo None. Reproduje las cifras exactas: 287 fuentes solo de Exa, 274 de ellas con elisiones o más de 3.000 caracteres, 492 afirmaciones que las citan como resumen y 377 sostenidas. Hay entre 13 y 14 fuentes que también trajeron PubMed o Europe PMC y conservan el texto de Exa (Bateman et al., 2023, 7.981 caracteres; Lu et al., 2025, 7.997). No está documentado ni en TRASPASO ni en README; el README solo describe los pasajes guiados.

## [CONFIRMADO · alta · fallo] A la regex de Open Targets le falta la tilde: «Sin evidencia previa» con APOE a 0,677

`rosa/bucle/pasos.py:4175`

**Qué pasa.** `_punt` busca «asociacion (\d+...)» sin tilde. Desde el commit fda20e7 (14 de septiembre, la pasada de tildes), el texto de la línea 4170 dice «asociación». La regex nunca casa, `_punt` devuelve 0 y `con_asociacion` es siempre False. Toda hipótesis con diana en Open Targets queda en «sin_evidencia».

**Escenario.** hip-mtvulxbg-140 y otras 15. Su detalle dice «GFAP: asociación 0.124 ...; NEFL: asociación 0.122 ...; APOE: asociación 0.677 (literature 0.999, ...)» y su estado es 'sin_evidencia'. La ficha (Hipotesis.tsx:455) enseña el chip verde «Sin evidencia previa» y el registro de procedencia apunta «Open Targets sin_evidencia».

**Evidencia.** Estado real: 16 hipótesis tienen novedad.openTargets en 'sin_evidencia' con alguna puntuación de 0,3 o más en su propio detalle. Las 9 que están en 'evidencia_previa' son anteriores al cambio. `git log -L4170,4170` muestra que fda20e7 cambió «asociacion» por «asociación» en el texto pero no en la regex.

**Propuesta.** No leer la cifra del texto: guardar en una lista las puntuaciones numéricas (`r['puntuacion']`) y decidir con ellas. Si se mantiene la regex, usar `asociaci[oó]n`. Añadir un test con un detalle con tilde y 0,677. Recalcular la novedad de Open Targets de las 16 hipótesis; no hace falta ninguna llamada, porque la puntuación ya está en el detalle.

**Escéptico.** pasos.py:4170 escribe «asociación» y la regex de la línea 4175 busca «asociacion». Ejecuté re.search sobre «APOE: asociación 0.677 (...)» y devuelve None. git log -L confirma que fda20e7 cambió solo el texto. En el estado hay 16 hipótesis con openTargets en sin_evidencia y una puntuación de 0,3 o más en su propio detalle (APOE 0,677, APP 0,807, MAPT 0,374). Las 9 que están en evidencia_previa llevan «asociacion» sin tilde, así que son anteriores. Bajo la severidad a media porque ese estado solo lo usan el chip de Hipotesis.tsx:455, el registro de procedencia (pasos.py:4298) y el dossier. El Killer mira precedente (killer.py:182-197) y la conclusión recibe el detalle, que trae la cifra correcta. Sigue siendo una etiqueta falsa en pantalla y en el dossier exportado. Ningún test cubre _punt.

## [CONFIRMADO · alta · fallo] Un NaN en el estado impide que los navegadores lean la instantánea, y la reproducción se marca 'fallida'

`rosa/estado/almacen.py:327`

**Qué pasa.** _serializar (línea 285) e instantanea_json (327) usan json.dumps con allow_nan=True, que es el valor por defecto, así que escriben NaN e Infinity tal cual. JSON.parse los rechaza. Al abrir un evento SSE ilegible, almacen.ts (405-412) lo descarta sin avisar. Al entrar, conectar(false) falla y Acceso.tsx muestra 'No se puede conectar con ROSA2018. Comprueba que el servidor está encendido'.

**Escenario.** El script de una reproducción imprime 'RESULTADO valor_reproducido=nan'. Pasa, por ejemplo, con la media de pandas de una columna vacía. ejecucion.py:219-226 guarda ese valor como texto sin validarlo, y analisis.py:477 lo convierte con float('nan'). Como abs(nan - x) <= tol da False, la reproducción queda marcada 'fallida' y ROSA2018 dice que la cifra publicada no se reproduce, cuando el script no produjo ningún número. Después, _estado_rep (analisis.py:533) escribe valorObtenido = NaN. A partir de ahí, las pestañas abiertas se quedan congeladas en 'en línea' sin ningún aviso y nadie más puede entrar.

**Evidencia.** Prueba en una base temporal: _valor_reproducido({'valor_reproducido': 'nan'}) devuelve nan y la reproducción pasa a 'fallida'. almacen.instantanea_json() contiene '"valorObtenido":NaN', y JSON.parse en Node responde "SyntaxError: Unexpected token 'N'... is not valid JSON". Hoy el estado real no tiene ningún NaN ni Infinity.

**Propuesta.** Usar allow_nan=False en _serializar para que la mutación falle y se deshaga (con el arreglo del hallazgo anterior), o convertir los números no finitos en None antes de guardar. En _valor_reproducido, rechazar lo que no pase math.isfinite y registrarlo como error_tecnico, no como 'fallida'. En el frontend, cuando la instantánea no se pueda leer, decirlo en vez de mostrar 'sin conexión' o no mostrar nada.

**Escéptico.** _valor_reproducido({'valor_reproducido':'nan'}) devuelve nan, y como abs(nan - x) <= tol da False, la reproducción pasa a 'fallida'. En una base temporal, _estado_rep escribe valorObtenido y instantanea_json() contiene '"valorObtenido":NaN'. JSON.parse en Node responde "Unexpected token 'N'". En almacen.ts, el manejador del evento SSE 'estado' se traga el error con un catch vacío y los latidos siguen poniendo 'en línea'. conectar(false) llama a r.json(), que lanza, y Acceso.tsx:120 muestra 'No se puede conectar con ROSA2018'. Es peor de lo que dice el hallazgo: _serializar escribe el NaN en rosa.db y el json.loads de Python lo vuelve a leer, así que reiniciar no lo arregla y la médica se queda fuera hasta que alguien edite la base a mano. Con 'inf' pasa lo mismo. El camino está vivo: el estado real tiene 11 reproducciones (4 fallidas, 3 superadas y 4 con error técnico). Hoy no hay ningún NaN ni Infinity; lo comprobé con parse_constant en solo lectura.

## [CONFIRMADO · alta · fallo] Un negativo o inconcluso del laboratorio cuenta como apoyo en GRADE (fuera de mi parte)

`rosa/bucle/corrida.py:1231`

**Qué pasa.** Al evaluar los datos del laboratorio, el bucle añade una afirmación con veredicto 'sostenida', tipo 'dato' y clase 'observacion_original', pero sin el campo relacion. Lo hace para apoyo_reproducido, negativo_interpretable, inconcluso y correccion_contexto. certeza.py trata relacion ausente como apoyo 'de origen' (RELACIONES_APOYO = (None, 'apoya', 'apoya_indirecta'), línea 149), y corrida.py:2915 cuenta igual. Así, un resultado que refuta la predicción sube el balance a favor y además cuenta como 'evidencia directa (resultado de laboratorio)'.

**Escenario.** El laboratorio devuelve un negativo interpretable, por ejemplo 'el tratamiento no cambió GFAP'. La hipótesis gana un apoyo de peso 1 y ninguno en contra. Con 1,5 de peso a favor procedente de la literatura, su techo sube a 'moderada' gracias a la evidencia directa. Lo encontré al comprobar el hallazgo siguiente; el fallo está en corrida.py y certeza.py, no en mi parte.

**Evidencia.** Prueba con rosa.certeza sobre una hipótesis que solo tiene la afirmación que escribe corrida.py:1231 para un negativo interpretable: apoyos 1, contras 0, balance {'aFavor': 1.0, 'enContra': 0.0} y techo 'baja' con el motivo 'por la clase de evidencia llegaría a moderada (hay evidencia directa (resultado de laboratorio)...'.

**Propuesta.** Poner relacion según la clasificación: 'apoya' para apoyo_reproducido y 'contradice' para negativo_interpretable. Inconcluso y correccion_contexto no deben entrar como apoyo sostenido de la hipótesis original. Añadir un test que pase por certeza.techo con cada clasificación.

**Escéptico.** corrida.py:1231 añade la afirmación sin 'relacion', y certeza.py:149 cuenta None como apoyo 'de origen' de peso 1 y como evidencia directa. La evidencia del hallazgo se reproduce tal cual (apoyos 1, contras 0 y techo 'baja' con el motivo que cita). Además ejecuté _evaluar_resultado de punta a punta con los ayudantes de rosa/tests/test_integracion_corrida.py, con un juez simulado y una base temporal. En la hipótesis de prueba (dos cohortes, techo 'baja'), un resultado 'inconcluso' sube el techo a 'alta' ('hay evidencia directa (resultado de laboratorio) y 2 cohortes distintas') y la dirección por regla queda en 'apoya'. Con el juez en alta, la conclusión dice 'La evidencia reunida sostiene que GFAP se altera antes que NfL'. Un negativo interpretable da 'en_contra' con certeza alta y un balance de 3,0 a favor y 0 en contra, porque la refutación cuenta como apoyo. Es peor de lo descrito: basta un experimento inconcluso para llegar a certeza alta, y solo el nivel que ponga el juez lo frena. Con los análisis in silico 'sin_efecto_detectable' pasa lo mismo (analisis.py:440-456, también sin relacion). Solo evidencia.py asigna relacion, y solo a la literatura. TRASPASO no lo documenta. Hoy está latente: la única afirmación de laboratorio real es sintética. Subo la severidad a crítica porque cualquier retorno no confirmatorio del laboratorio, que es el flujo normal, hace que ROSA2018 afirme un apoyo que no existe.

## [CONFIRMADO · alta · fallo] Reevaluar los datos del laboratorio borra el resultado pero deja su evidencia contando, y pisa el fichero

`rosa/estado/acciones.py:1445`

**Qué pasa.** registrar_protocolo_real (1442-1446) y registrar_datos_experimento (1500-1501) quitan experimento.resultado y _resultadoEvaluado para que el bucle vuelva a evaluar. Ninguno de los dos retira ni archiva lo que produjo la evaluación anterior: la afirmación de laboratorio 'sostenida' y el hecho 'sabido' del modelo de mundo. La nueva evaluación (corrida.py:1229-1240) añade otra afirmación y otro hecho encima. En fallo_tecnico (1241-1243) solo cambia estado y ficheroDatos. Por otro lado, subir_datos guarda el fichero con su nombre (servidor.py:727, datos.py:47 write_bytes) y pisa el anterior sin guardar su hash.

**Escenario.** El laboratorio sube resultados.csv y la evaluación da 'confirma'. Después registra el protocolo real con desviaciones, un camino normal que además dispara la reevaluación, o vuelve a subir un resultados.csv corregido; el formulario sigue visible en 'datos_recibidos' (Hipotesis.tsx:853). Si la nueva evaluación da fallo técnico o negativo, la afirmación y el hecho 'sabido' de la primera siguen contando como evidencia directa, y el fichero que los respaldaba ya no existe. Si se sube el mismo fichero dos veces, esa evidencia cuenta dos veces.

**Evidencia.** Prueba en memoria sobre un experimento ya evaluado con una afirmación de laboratorio 'af-lab-1'. registrar_protocolo_real devuelve True y deja resultado None y _resultadoEvaluado None, pero 'af-lab-1' sigue en afirmaciones. registrar_datos_experimento con el mismo nombre de fichero da el mismo resultado. No hay ningún código que retire afirmaciones con cita '[Datos del laboratorio...' (grep en rosa/).

**Propuesta.** Antes de reevaluar, archivar el resultado anterior en experimento.resultadosAnteriores con el sha256 del fichero, y retirar o marcar como socavadas la afirmación y el hecho que salieron de él, para que la nueva evaluación los sustituya en vez de acumularse. Guardar cada subida con un nombre único y su hash, sin pisar nunca la anterior.

**Escéptico.** Lo comprobé en memoria. registrar_protocolo_real (acciones.py:1442-1446) y registrar_datos_experimento (1500-1501) devuelven True y quitan resultado y _resultadoEvaluado, pero 'af-lab-1' y el hecho siguen ahí. Después de evaluar, el experimento sigue en 'datos_recibidos' (solo fallo_tecnico lo cambia), así que corrida.py:1305 lo vuelve a evaluar y añade otra afirmación y otro hecho sin retirar los anteriores; certeza.py no deduplica afirmaciones. Las dos vías están a la vista: el formulario de subida (Hipotesis.tsx:853) y el botón 'Actualizar protocolo real' (ProtocoloYEnmiendas en Rosa2018.tsx, que se ve aunque haya resultado). datos.guardar hace write_bytes sobre el mismo nombre y no guarda ningún hash. Con dos afirmaciones de laboratorio iguales, un único experimento sin literatura pasa de techo 'baja' a 'moderada' (2,0 a favor). No está documentado.

## [CONFIRMADO · alta · fallo] La certeza «baja» de las dos únicas hipótesis que la tienen sale de un «efecto grande» del juez sin cifra, y en una viene de datos sintéticos

`rosa/certeza.py:874`

**Qué pasa.** `efecto_grande_documentado` sube el techo de muy baja a baja con cualquier factor `efecto_grande` con efecto «sube» que escriba el juez. No exige cifra ni que la cifra venga de evidencia real, y le da igual que el mismo juez haya bajado la certeza por imprecisión o sesgo (GRADE solo sube por efecto grande sin limitaciones serias). Además, `T.resultado_experimental` (rosa/bucle/contexto.py:614) le pasa al juez el resultado de laboratorio sin decir que es sintético. `reacotar_conclusion` reutiliza para siempre los factores guardados.

**Escenario.** hip-mtvulxbg-140: la regla ya excluye las afirmaciones sintéticas del techo, pero el juez recibe «Veredicto contra el prerregistro: confirma. Entre los 105 de 120...» del fichero datos_gfap_nfl_sintetico.csv. Con eso escribe efecto_grande «sube» (104 de 120 frente a 13 de 120) y replicación independiente «sube» (cuenta el análisis como tercera fuente), y el techo pasa a baja. La frase que ve la médica es «La evidencia sugiere, con limitaciones, que...». hip-mtxcyxox-61 (la única con Killer «avanzar») sube a baja por un contraste «cualitativo y no de grado»: «NfL no aparece entre los marcadores alterados en la amiloide-negativa». Es una ausencia leída como efecto, y el propio juez dice en imprecisión que puede ser falta de potencia.

**Evidencia.** certeza.techo(h, factores) = baja; sin el factor efecto_grande = muy_baja en las dos. Techo guardado de hip-mtvulxbg-140: «solo literatura de una sola cohorte (...), pero el juez documentó un efecto grande». experimento.resultado.fichero = 'datos_gfap_nfl_sintetico.csv', sin campo sintetico. Registro del 18-09 20:52: «el techo por regla pasó de moderada a baja sin mover la certeza» (el recálculo conservó el factor sintético). Texto del juez: «El análisis del laboratorio cumplió el criterio congelado, con una mediana de 3,0 años».

**Propuesta.** En `efecto_grande_documentado`: exigir una magnitud numérica (RR, OR o HR ≥ 2 o ≤ 0,5, o una razón explícita) que case con el `efecto` de una afirmación sostenida no sintética, y no subir si el juez bajó por riesgo de sesgo o imprecisión. En `resultado_experimental`: marcar «SINTÉTICO: no cuenta como evidencia» cuando `r.sintetico`, `x.ensayoEnSeco` o `CERTEZA.NOMBRE_SINTETICO` casen con `r.fichero`; lo mismo en `T.direccion_por_regla` (contexto.py:901 acepta un «refuta» sintético). Migración: poner `sintetico: true` en la afirmación del CSV y reacotar sin el factor que la cita.

**Escéptico.** Leí certeza.py:819-875: efecto_grande_documentado solo mira factor efecto_grande con efecto sube, sin cifra ni fuente. Lo reproduje con el estado de rosa.db abierto en modo ro: C.techo(h, factores) da baja en hip-mtvulxbg-140 y en hip-mtxcyxox-61, y muy_baja si se quita ese factor. En la 140 el factor dice «104 de 120 (86,7%) frente a 13 de 120 (10,8%)»: son las cifras de experimento.resultado, que viene de datos_gfap_nfl_sintetico.csv y no lleva campo sintetico. T.resultado_experimental(h) no dice «sintético» en ningún sitio. La afirmación 9, la del CSV, tiene sintetico=False, así que en _concluir_hipotesis (corrida.py:1058) el juez tampoco la ve marcada «SINTÉTICO»: solo es_sintetica la reconoce, por el nombre del fichero. Encima, la firma le dice al juez que el resultado experimental «pesa más que la literatura». En la 61 el propio juez escribe «cualitativo y no de grado» y, en imprecisión, que puede ser falta de potencia. contexto.direccion_por_regla con un refuta marcado sintético devuelve en_contra; la versión local de corrida.py sí filtra lo sintético. La línea 12 del registro de la 140 confirma el techo por efecto grande. Que un efecto grande suba a baja está documentado (docstring y test_certeza.py); que ese efecto pueda salir de datos sintéticos, no, y choca con «lo sintético no cuenta como evidencia».

## [CONFIRMADO · alta · fallo] La regla «ausencia no es negación» borra contradicciones con índices válidos

`rosa/bucle/pasos.py:2649`

**Qué pasa.** `_AUSENCIA` casa frases que niegan el apoyo («ninguna afirmación lo respalda», «no hay evidencia de...», «No hay ninguna afirmación que muestre...»). Son justo las frases con que se explica una contradicción. `validar_supuesto_evaluado` rebaja a «sin_evidencia» si casa, aunque el evaluador haya señalado afirmaciones válidas que lo niegan (`if not validos or ausencia`), y borra los ids. Es negación leída como ausencia.

**Escenario.** hip-mu2tgh7o-1740, supuesto «En los ensayos donde hubo beneficio clínico (lecanemab, donanemab) se observó atenuación de NfL...». El evaluador escribe «Las afirmaciones 7 y 8 indican explícitamente que en los ensayos con donanemab no hubo disminución de NfL... No hay ninguna afirmación que muestre atenuación», y ROSA2018 lo guarda como «sin evidencia» con la nota «ninguna afirmación lo menciona».

**Evidencia.** Estado: evidencia del supuesto «...| Rebajado a 'sin evidencia' por regla: la evidencia dice que ninguna afirmación lo menciona; ausencia no es negación.» Reproducido: validar_supuesto_evaluado('contradicho', <ese texto>, [7, 8], afs) devuelve ('sin_evidencia', ..., []). También 'Ninguna afirmación lo respalda; la afirmación 3 muestra lo contrario' con [2, 3] da 'sin_evidencia'. alcance_del_supuesto lo deja en 'tocado_sin_respuesta'.

**Propuesta.** Aplicar la regla de texto solo cuando no hay índices válidos. Quitar del patrón «respalda/respaldan» y el genérico «no hay evidencia»: dejar solo los verbos de mención (menciona, toca, habla, trata, aborda, nombra, se refiere). Al rebajar, guardar los índices originales en un campo aparte para poder auditarlo. Test: ese texto con [7, 8] se queda en «contradicho».

**Escéptico.** Lo reproduje: validar_supuesto_evaluado('contradicho', texto real, [7, 8], afs) devuelve sin_evidencia con los ids vacíos. Con «Ninguna afirmación lo respalda; la afirmación 3 muestra lo contrario» y [2, 3] pasa lo mismo. En el estado, el supuesto sup-mu5u97um-12021 de hip-mu2tgh7o-1740 guarda la nota falsa «ninguna afirmación lo menciona» y niegaAfirmaciones vacío. S-10 (REVISION-BUGS) pedía rebajar solo «ninguna afirmación menciona». El patrón de pasos.py:2649 va más allá: añade respalda, contradice, niega y «no hay afirmación/evidencia». Bajo la severidad por cuatro motivos. Es el único caso en el estado. Esa hipótesis sigue en falla por otro supuesto contradicho (sup-mu5u97nz-12020). test_tanda1_pasos_killer fija a propósito que «No hay evidencia sobre este punto» con índice se rebaje. Y con la regla 3 un nulo sin potencia ya no contradice, así que en este ejemplo el estado final podría ser el correcto por otra razón. Lo que queda mal es la nota y los ids borrados.

## [CONFIRMADO · alta · fallo] Dos propuestas de descarte vivas se apoyan en una novedad calculada para la versión 1 y nunca recomprobada

`rosa/bucle/pasos.py:4125`

**Qué pasa.** El arreglo S-11 (reiniciar la novedad al reformular) solo vale para lo que se reformule de ahora en adelante. Las v3 reformuladas antes conservan el precedente de la v1. `novedad_pendiente` no las recoge («ya_publicado» no cuenta como pendiente), y `decidir` (killer.py:283) las descarta con «Agotó las 2 reformulaciones y sigue fallando: novedad» cada vez que el Killer vuelve a pasar.

**Escenario.** hip-mtvulxbg-140 (v3, «Valor pronóstico de la duración conjunta GFAP–NfL...») se juzgó hoy a las 11:13 con «Ya publicado: Milà‐Alomà 2024 (8/10)». Ese precedente se calculó en la iteración 1 para «Precedencia de la anormalidad plasmática de GFAP sobre NfL...», antes de las líneas «versión 2» y «versión 3». Con hip-mu35joen-2494 pasó lo mismo cinco veces (el 22 de septiembre, la última) con Willis 2024. La auditoría discrepó cuatro veces. La autonomía está en «preguntar»: a la médica se le pide que decida un descarte cuya base nunca se comprobó para el texto actual.

**Evidencia.** novedad_pendiente(h) = False y _novedadIntentos = None en las dos. `versiones` sin novedad guardada. Orden del registro: «iteración 1: novedad -> ... precedente ya_publicado», luego «versión 2 (...)» y «versión 3 (...)». Hallazgos abiertos: «El Killer propone descartarla en este contexto».

**Propuesta.** Migración al cargar: toda hipótesis con versión > 1 cuya última línea «novedad ->» sea anterior a su versión actual vuelve a `P.novedad_no_comprobada(version)` en precedente, patentes y financiación. En `decidir`: no descartar por «agotó reformulaciones» si lo que falla es una novedad calculada para otra versión. Reabrir las dos propuestas con una nota.

**Escéptico.** Estado: hip-mtvulxbg-140 v3 e hip-mu35joen-2494 v3 conservan el precedente ya_publicado (Milà-Alomà 2024 8/10; Willis 2024 9/10). En el registro, la última línea «novedad ->» es anterior a «versión 2» y «versión 3» (17-09 20:32 y 20:38 UTC; 16-09 12:25 y 12:28 UTC). Las versiones guardadas no llevan clave novedad, novedad_pendiente da False y _novedadIntentos es None. El reinicio de la novedad al reformular (acciones.py:832-849) entró con 80bc256 el 18-09 a las 05:30, después de esas reformulaciones. Ninguna migración de almacen.py lo corrige: _migrar_novedad_no_comprobada solo toca «entre 0 obras». Decisiones: la 140 se volvió a descartar hoy a las 11:13, y la 2494 seis veces entre el 16 y el 22-09, siempre con el mismo motivo. descartar_hipotesis está en preguntar y los dos hallazgos «El Killer propone descartarla» siguen abiertos. Mis recuentos difieren un poco (seis descartes, tres desacuerdos de auditoría), sin cambiar el fondo. No está documentado como decisión.

## [CONFIRMADO · alta · fallo] Un fallo del evaluador de supuestos borra un «contradicho» anterior, cierra su hallazgo con un texto falso y el Killer avanza

`rosa/bucle/pasos.py:3549`

**Qué pasa.** Si `evaluar_supuesto` lanza cualquier excepción que no sea presupuesto ni `ModeloSinRespuesta`, el supuesto se sobrescribe con estado «sin_evidencia». Eso incluye un fallo de parseo de Sonnet, que el vigilante no reintenta en el rol de volumen, y `ModeloBloqueado`. Se pierde el estado anterior, aunque fuera «contradicho». Después, `aplicar` cierra el hallazgo con «El supuesto ya no aparece contradicho al reevaluarlo con la evidencia acumulada» (línea 3588) y el Killer se ejecuta en el acto con supuestos «pasa». La regla 3 añade campos Literal nuevos a la salida, así que el riesgo de parseo sube.

**Escenario.** Hipótesis con un supuesto contradicho por la afirmación 2 y su hallazgo abierto. En la reevaluación, el evaluador devuelve un `donde_se_responde` fuera de la lista y el adaptador falla. Resultado: supuesto «sin_evidencia / no_evaluado», hallazgo «atendido» con el texto de arriba y decisión del Killer «avanzar».

**Evidencia.** Test de caza (base temporal, modelos simulados): ESTADO: sin_evidencia | No se pudo evaluar: el modelo no respondió (RuntimeError) | alcance no_evaluado. HALLAZGO: atendido | El supuesto ya no aparece contradicho al reevaluarlo con la evidencia acumulada. KILLER: avanzar | supuestos: pasa.

**Propuesta.** En la rama de excepción: conservar `estado`, `evidencia` y `niegaAfirmaciones` previos y añadir `alcance: no_evaluado` más la nota. No cerrar los hallazgos «Supuesto contradicho» de supuestos cuya evaluación falló. En `comprobaciones_deterministas`: si el sello trae `fallidos > 0`, dejar supuestos en «no_comprobable» (crítica: suspende), no en «pasa».

**Escéptico.** Leí pasos.py:3533-3590 y lo reproduje con un test en el scratchpad: almacén temporal, modelos simulados, y evaluar_supuesto lanza un ValueError de parseo. El supuesto, que antes estaba contradicho, queda sin_evidencia con alcance no_evaluado. El hallazgo «Supuesto contradicho» pasa a atendido con «El supuesto ya no aparece contradicho al reevaluarlo con la evidencia acumulada». Y el Killer decide avanzar, con supuestos en pasa. El vigilante (vigilante_modelos.py:605-624) no reintenta los fallos de contenido en volumen: relanza la excepción original. Un ModeloBloqueado por lentitud también cae en el except genérico. killer.py no mira supuestosEvaluados.fallidos. donde_se_responde es Literal, así que un valor fuera de la lista rompe el parseo. Es latente: hoy no hay ningún «No se pudo evaluar» en el estado. Pero hay 11 supuestos contradichos en 8 hipótesis y una reevaluación en marcha.

## [CONFIRMADO · alta · fallo] Detener o pausar no cortan el paso en curso: sigue pagando llamadas hasta el final

`rosa/bucle/pasos.py:406`

**Qué pasa.** El estado de la corrida solo se mira al principio de cada vuelta de `correr_corrida` (corrida.py:1599). `Ctx.llamar` (pasos.py:406) solo comprueba el presupuesto. Ni `detener_corrida` ni `pausar_corrida` (acciones.py:86-131, y lo mismo en acciones.ts) paran las pistas, así que el paso en vuelo sigue llamando al modelo hasta terminar y además queda marcado como hecho.

**Escenario.** Corrida 15 ("corrida equivocada"): arrancó el 21-09 a las 16:49:35 y la persona la detuvo a las 16:52:16, con 2 llamadas hechas. El paso de literatura siguió y pagó 146 llamadas más (690.866 tokens de entrada) hasta las 16:54:32, y quedó "hecho": el 98,6 % del gasto de la corrida (148 llamadas, 2,58 USD) llegó después de pulsar Detener. En la corrida 6 hubo 96 llamadas en los 40 s posteriores. Con una verificación como la de la corrida 16 (247 afirmaciones), Detener dejaría correr hasta 247 llamadas a Opus.

**Evidencia.** Tabla `llamadas`, leída en solo lectura: cor-mubpxsn0-1870 tiene 2 llamadas antes de su terminadaEn y 146 después; cor-mu4j43rw-153 tiene 89 antes y 96 después. Test `test_detener_la_corrida_no_para_el_paso_en_curso`: se llama a `detenerCorrida` durante la primera llamada del juez y aun así `paso_verificacion` hace las 20. PENDIENTE.md:37-38 promete que "una corrida parada no gasta".

**Propuesta.** Antes de cada llamada, `Ctx.llamar` debe comprobar el estado de la corrida y lanzar una excepción propia (CorridaParada) si está detenida, terminada o pausada; lo que corre en fondo y tiene permiso explícito va en una lista blanca. `_ejecutar_paso` trata esa excepción como una cancelación: el paso vuelve a pendiente y sus pistas pasan a "detenida" con el motivo. Si además la acción cancela la tarea de la corrida (`app.state.supervisor.tareas`), el corte es inmediato. Test: detener a mitad de la extracción y a mitad de la verificación deja 0 llamadas después.

**Escéptico.** Lo confirman el código, un test y los datos. En el código: pausar_corrida y detener_corrida (rosa/estado/acciones.py:86-131) solo cambian el estado; no tocan pistas ni tareas. El endpoint POST /api/acciones (rosa/servidor.py:385-411) aplica el reducer sin cancelar supervisor.tareas, y el tic (rosa/bucle/corrida.py:332-360) salta las corridas detenidas sin cancelar su tarea. Ctx.llamar (rosa/bucle/pasos.py:406) solo mira presupuesto_ok. El vigilante solo mira detenida o terminada al agotar los reintentos (rosa/vigilante_modelos.py:723-766), y _en_paralelo no mira nada. En la prueba: ejecuté el test del cazador en un directorio aislado del scratchpad, con la red bloqueada y base temporal. Con detenerCorrida dentro de la primera llamada del juez, paso_verificacion hace igual las 20 llamadas. En los datos (rosa.db en solo lectura), corrida 15 (cor-mubpxsn0-1870, motivo 'corrida equivocada'): se detuvo a las 16:52:16 con 2 llamadas hechas; después hubo 146 más (144 de volumen y 2 de cerebro, 690.866 tokens de entrada) hasta las 16:54:32, y el paso de literatura quedó 'hecho'. Corrida 6: 89 llamadas antes de detenerla y 96 en los 40 s siguientes. El diálogo de Detener (frontend/src/pantallas/Corrida.tsx:313-325) no avisa de que el paso siga, y PENDIENTE.md:37-38 promete que 'una corrida parada no gasta'. TRASPASO no lo recoge como decisión. Matiz: que Pausar deje terminar el paso podría defenderse como diseño, aunque no está escrito; en Detener es un fallo claro.

## [CONFIRMADO · alta · fallo] El trabajo de fondo de una corrida detenida o terminada se corta por el tope de una iteración muerta, con un aviso falso

`rosa/bucle/corrida.py:601`

**Qué pasa.** Lo que corre en fondo sobre la última corrida de una investigación (revisión pedida, datos del laboratorio, evaluación de criterios) usa un Ctx atado a su última iteración (`_ctx`, 1362-1364). El corte mira también el tope de esa iteración (601, 801, pasos.py:406, contador.py:55-60). Si la corrida está detenida o terminada, esa iteración no volverá a correr, pero su tope sigue cortando. El aviso dice "la corrida N no tiene presupuesto" (2769-2774), y es falso.

**Escenario.** "GFAP y NfL en portadores de APOE4": la corrida 3 está detenida desde el 18-09, tiene un tope de 1500 llamadas y ha gastado 728, así que le quedan 772. Su iteración 2 quedó abierta con tope 447. Hoy la reevaluación de supuestos cargó 71 llamadas a esa iteración (de 379 a 450 usadas). Al pasar de 447 se abandonaron 3 revisiones: hip-mtxcyxox-61 quedó a medias (supuestos con regla 2, sin Killer) y hip-mtxd120r-18 y hip-mtxfgfpi-70 ni empezaron. Las tres llevan el evento "la corrida 3 no tiene presupuesto. Amplíalo o abre otra corrida". TRASPASO.md:1637-1639 lo cuenta como "quedaban 68 llamadas", pero es peor: esas 68 eran lo que sobraba de una iteración muerta y la corrida tenía 772. Con el mismo estado, unos datos de laboratorio subidos para una hipótesis de GFAP no se evaluarían nunca: `_evaluar_resultado` lanza PresupuestoAgotado, `_completar_en_llano` (1289-1292) se lo traga y vuelve a leer el fichero en cada tic, sin evento. En las otras tres investigaciones con la corrida terminada, el trabajo de fondo queda limitado a 63, 161 y 165 llamadas, cuando a esas corridas les quedan 1171, 2074 y 1224.

**Evidencia.** En rosa.db (solo lectura), cor-mu5xub9l-12629 tiene gasto 728/1500 y su iteración 2 está en {'limite': 447, 'usado': 450}. Hay 71 llamadas ok del 23-09 con iteracion=2, `supuestosEvaluados.noAtendida` en las 3 hipótesis y 3 eventos "No se pudo revisar...". Tests: `test_revision_pedida_se_abandona_con_presupuesto_de_sobra` (se abandona sin llegar a intentar ninguna llamada) y `test_datos_del_laboratorio_no_se_evaluan_nunca_y_nadie_lo_dice` (3 vueltas, el fichero se lee 3 veces y el estado no cambia de versión).

**Propuesta.** Para el trabajo de fondo sobre una corrida detenida o terminada, cortar solo por el tope de la corrida: `tope_agotado_en(e, id, None)` en 601 y 801, y un Ctx de fondo cuyo presupuesto no mire la iteración (así el Contador tampoco infla el `usado` de una iteración cerrada). El aviso debe decir qué tope cortó, igual que `motivo_de_pausa_por_presupuesto`. En los datos del laboratorio, dejar una marca y un evento en vez de reintentar en cada tic. Después, volver a pedir las 3 revisiones de GFAP.

**Escéptico.** Código: rosa/bucle/corrida.py:601 y :801 pasan corrida['iteracionActual'] a tope_agotado_en, que corta también por el tope de la iteración (rosa/modulos/contador.py:55-60). _ctx (1362-1364) ata el Ctx a esa iteración. Datos (rosa.db en solo lectura): cor-mu5xub9l-12629 (corrida 3, detenida) lleva 728 de 1500 llamadas; su iteración 2 sigue abierta con {'limite': 447, 'usado': 450}. Hoy hubo 71 llamadas ok con iteracion=2, entre las 11:01 y las 11:49. En hip-mtxcyxox-61 se reevaluaron hoy los supuestos (regla 2, 11:48), pero su última decisión del Killer es del 17-09. hip-mtxd120r-18 y hip-mtxfgfpi-70 siguen con la regla 1. Las tres llevan noAtendida 'La corrida 3 no tiene presupuesto' y su evento. El panel de Presupuesto se pinta también en corridas paradas (Corrida.tsx:455) y dice 728 de 1500: el aviso contradice la pantalla. Comprobé los restos 63, 161 y 165 frente a 1171, 2074 y 1224. TRASPASO (hacia la línea 1637) habla de 'quedaban 68 llamadas' como si fueran de la corrida, así que es peor de lo documentado. Los dos tests del cazador pasan. Un test mío (scratchpad, base temporal, sin red) muestra que es todavía peor. Como el PresupuestoAgotado de _evaluar_resultado sale de _completar_en_llano_paso, la hipótesis atascada bloquea todo el relleno de fondo que va detrás en la lista: la versión en llano de una hipótesis de OTRA investigación, con su corrida en marcha, no se rellena nunca. En el control sin datos atascados sí se rellena. Hay salida: 'Ampliar tope' en la corrida sube también el tope de la iteración (acciones.py:134-190). Pero el aviso no lo explica.

## [CONFIRMADO · alta · fallo] Si el paso de hipótesis se interrumpe, las hipótesis ya creadas no se revisan y el generador se paga otra vez

`rosa/bucle/pasos.py:3838`

**Qué pasa.** El paso añade cada hipótesis nueva al estado (3830) antes de revisarla. `a_revisar` (3838) solo recoge las nacidas en esta ejecución, las humanas sin revisar y las que tienen `_revisionPedida`. Si el paso se corta durante la revisión (ModeloSinRespuesta, PresupuestoAgotado, o un reinicio que cancela la tarea y deja el paso en_curso, que pasa a pendiente en corrida.py:163-166), el reintento vuelve a llamar al generador. Las hipótesis de la primera ejecución que no llegaron a revisarse no vuelven a entrar, y `pedir_revision_por_huella` salta las que nunca juzgó el Killer (corrida.py:2887-2888).

**Escenario.** GPT-6 Astra propone A y B y las dos se añaden. Opus no responde al revisar A, así que el paso vuelve a pendiente y la corrida pasa a esperando_modelo. Cuando Opus vuelve, el paso se repite: se paga Astra otra vez, propone "A reformulada" y C, y se revisan esas dos. A y B se quedan en la cola como propuestas, sin supuestos evaluados y sin Killer, hasta que les llegue evidencia nueva o alguien pida la revisión. Mientras tanto la cola las cuenta como "sin juzgar" y el torneo las empareja.

**Evidencia.** Test `test_hipotesis_de_un_paso_interrumpido_no_se_revisan_nunca`: el generador se llama 2 veces, solo se revisan "Hipótesis A reformulada" y "Hipótesis C", quedan 4 hipótesis en el estado, B tiene ultimaRevisionAutomatica None, sin marca ni decisión, y `pedir_revision_por_huella` devuelve 0. En el estado real de hoy no hay ninguna hipótesis así (lo comprobé): el fallo está latente. Pero hubo 14 reinicios en una semana y la corrida 16 agota el tope en cada iteración.

**Propuesta.** Poner `_revisionPedida` en la misma mutación que añade la hipótesis (3830) y dejar que la quite solo el Killer al juzgar, como ya hace M-19. Guardar en la iteración qué hipótesis generó cada paso y, si ya existen, saltar el generador en el reintento. Que `pedir_revision_por_huella` pida también la revisión de las vivas que el Killer nunca juzgó.

**Escéptico.** Código: rosa/bucle/pasos.py:3830 añade cada hipótesis en su propia mutación, antes de revisarla. En 3838, a_revisar solo recoge las nuevas_ids de esta ejecución, las humanas sin revisar y las que tienen _revisionPedida. _revisar_hipotesis relanza PresupuestoAgotado y ModeloSinRespuesta, y _ejecutar_paso devuelve el paso a pendiente (corrida.py:1971-1993), igual que el reinicio (163-166). Al reintentar se vuelve a llamar al generador. pedir_revision_por_huella (corrida.py:2886-2888) salta las nunca juzgadas con el comentario 'la juzga el paso de hipótesis como nueva', que aquí es falso. El test del cazador pasa: 2 llamadas al generador, solo se revisan 'A reformulada' y 'C', B queda sin revisión ni decisión, y la huella devuelve 0. En rosa.db hoy hay 0 hipótesis vivas sin decisión del Killer (de 26): el fallo es latente. Bajo la severidad por tres motivos. PR.candidatos exige decisionKiller 'avanzar' (rosa/priorizacion.py:105), así que no pueden llegar al laboratorio. vigencia las marca 'sin_sello' en la pantalla. Y la evidencia nueva del cierre (rosa/bucle/evidencia.py:384-385) puede ponerles _revisionPedida. Lo que se paga de más es una llamada al cerebro.

## [CONFIRMADO · alta · fallo] La comprobación de cifras suspende por redondeos, restas y números escritos con letra, también en afirmaciones sintéticas

`rosa/killer.py:115`

**Qué pasa.** cifras_fuera_del_pasaje (killer.py:505-532) compara las cadenas numéricas de forma exacta. Por eso cuentan como cifras ausentes del pasaje: «-0.38» frente a «-0.37961» de la salida de un análisis; «12.6», que es 38,7 menos 26,1; «25 %» frente a «about a quarter»; y «76» frente a «Seventy-six». Una sola deja fidelidad_evidencia en no_comprobable, y como es una comprobación crítica (killer.py:72) la hipótesis queda suspendida; el juez no puede levantarla (sospechosas, killer.py:226). Se aplica también a afirmaciones sintéticas, que certeza.es_sintetica excluye como evidencia, y a pasajes recortados a 600 caracteres al nacer la hipótesis (pasos.py:3784). No hay ninguna acción en la interfaz para revisar la marca, así que la suspensión no tiene salida.

**Escenario.** hip-mtvulxbp-150, la primera de inv-gfap por Bradley-Terry (1898 guardado), pasó hoy a las 11:22 de avanzar a suspender por una sola afirmación: «En las 47 personas simuladas ... -0.38 pg/mL ... IC95% de -1.82 a 1.06». Sale de un análisis sobre datos sintéticos cuya salida dice -0.37961, -1.81759 y 1.05837.

**Evidencia.** Reproducido: cifras_fuera_del_pasaje('la estimación es -0.38 pg/mL (IC95% -1.82 a 1.06), p=0.597', 'beta=-0.37961; ic95_inf=-1.81759; ic95_sup=1.05837; p=0.597379') devuelve ['0.38','1.82','1.06','0.597']. De las 10 afirmaciones marcadas en el estado: 3 son de análisis sintéticos (redondeo), 4 son la resta 12,6 de Malotaux 2026, 1 es «a quarter» y 1 es «Seventy-six». Solo 1 («16 ensayos») trae una cifra que no sale del pasaje. Aplicando killer.decidir a las mismas comprobaciones sin esta marca, 5 de las 21 suspendidas pasan a avanzar: hip-mtvulxbp-150, hip-mtxd120r-18, hip-mtxfgfpi-70, hip-mtvuvbm2-10 y hip-mu2zz5y8-2440.

**Propuesta.** Tolerar el redondeo (diferencia de como mucho media unidad del último decimal que escribe la afirmación). Reconocer números con letra y fracciones comunes (quarter, half, third). Marcar las cifras que salen de sumar, restar o dividir dos números del pasaje como «derivada por ROSA2018» en vez de tratarlas como fallo. Comparar las afirmaciones de análisis con la salida completa de la ejecución. Saltarse las afirmaciones sintéticas en el Killer, como ya hace certeza.es_sintetica. Añadir en la ficha una acción «revisar cifra» para que una persona cierre la marca. Medir: falsos positivos sobre las 10 marcadas hoy (9 de 10) e hipótesis suspendidas solo por esta comprobación (hoy 5).

**Escéptico.** Reproducido: cifras_fuera_del_pasaje devuelve ['0.38','1.82','1.06','0.597'] con el ejemplo; también '76' frente a «Seventy-six», '12.6' frente a 38.7 y 26.1, y '25' frente a «about a quarter». Código: killer.py:115-117 lo deja en no_comprobable sin filtrar sintéticas; fidelidad_evidencia está en CRITICAS (72) y sospechosas (226) impide que el «pasa» del juez lo levante. Estado: exactamente 10 afirmaciones marcadas con el desglose dicho. hip-mtvulxbp-150 pasó de avanzar (11/09) a suspender hoy a las 11:22 solo por la afirmación sintética (sintetico true, clase derivado), cuyo fragmento está además cortado («...delta_»). Rehaciendo killer.decidir con esa comprobación en «pasa», salen justo las 5 citadas a avanzar. etiquetar_comprobacion (acciones.py:720) solo alimenta el conjunto dorado y no cambia la decisión. Matices: 12.6 y 25 % son cifras derivadas que no están literalmente en el pasaje, y marcarlas es justo para lo que se diseñó la regla («para que alguien la mire»), así que «9 de 10 falsos positivos» depende del criterio; los inequívocos son los redondeos sintéticos y el 76. Además, una persona sí puede aceptar la hipótesis y asignar un experimento (asignar_experimento no exige candidata): lo que no tiene salida es el camino Killer y candidata, porque no hay forma de registrar «cifra revisada». No está documentado.

## [CONFIRMADO · alta · fallo] La marca de candidata al laboratorio se queda vieja cuando el Killer juzga fuera del cierre de iteración

`rosa/estado/acciones.py:529`

**Qué pasa.** Tras decidir, el Killer llama a recalcular_bloqueos (pasos.py:3323), que solo pone candidata=False si aparecen bloqueos, y suspender o reformular no son bloqueos. Las candidatas solo se recalculan al cerrar una iteración (corrida.py:2243). Las revisiones pedidas con la corrida detenida, que es el camino que usa la reevaluación de hoy (corrida.py:593-611), juzgan sin cerrar iteración. La ficha de la hipótesis y el hilo del proceso leen la marca guardada (Hipotesis.tsx:135, Rosa2018.tsx:570, HiloDelProceso.tsx:53), mientras que la pantalla Ranking la recalcula (Ranking.tsx:121): la interfaz se contradice.

**Escenario.** inv-gfap cerró su última iteración el 17/09 a las 16:21; la corrida cor-mu5xub9l-12629 quedó detenida. hip-mtxfgfpi-70 pasó a suspender el 17/09 a las 19:36 y hip-mtvulxbp-150 hoy a las 11:22. Las dos siguen con candidata=True, y su ficha dice «Candidata al laboratorio: sin bloqueos, el Killer la dejó avanzar». En cambio hip-mtxcyxox-61, la única con Killer avanzar, tiene candidata=False.

**Evidencia.** priorizacion.candidatos(e, 'inv-gfap') sobre el estado actual devuelve ['hip-mtxcyxox-61']; lo guardado es ['hip-mtvulxbp-150', 'hip-mtxfgfpi-70']. En las otras cuatro investigaciones lo guardado y lo recalculado coinciden. hip-mtvulxbp-150 ya tiene un dossier para el laboratorio generado el 15/09.

**Propuesta.** Poner candidata=False siempre que decisionKiller no sea avanzar, ya sea en recalcular_bloqueos o al final del aplicar del Killer y de reformular_hipotesis. Llamar a PR.marcar_candidatas de la investigación tras cada decisión del Killer (es una regla, no cuesta llamadas), también en _atender_peticiones. Comprobar al cargar y en un test la invariante «candidata implica Killer avanzar y sin bloqueos» (hoy la incumplen 2).

**Escéptico.** Código: recalcular_bloqueos (acciones.py:521-534) solo pone candidata=False si hay bloqueos, y suspender no es un bloqueo; el aplicar del Killer acaba ahí; marcar_candidatas solo se llama en corrida.py:2243; el camino de revisión con la corrida parada (corrida.py:593-633) y _cerrar_peticion_de_revision no recalculan. Estado: priorizacion.candidatos(e,'inv-gfap') devuelve ['hip-mtxcyxox-61'] y lo guardado es ['hip-mtvulxbp-150','hip-mtxfgfpi-70'], las dos con suspender y bloqueos []; último cierre de inv-gfap el 17/09 a las 16:21; hip-mtxcyxox-61 tuvo avanzar a las 16:59 y está con candidata False. En las otras 4 investigaciones coincide. Interfaz: Hipotesis.tsx:135 y 344, Rosa2018.tsx:567-570 y HiloDelProceso.tsx:53 leen la marca guardada; Ranking.tsx:121 la recalcula. Peor de lo que dice el hallazgo: dossier.py:121 escribiría «Candidata al laboratorio en este ciclo» junto a «Decisión del Killer: suspender», y costes.py:43 la cuenta como candidata. Parte de la propuesta ya está cubierta: reformular_hipotesis sí pone candidata=False (acciones.py:829).

## [CONFIRMADO · alta · fallo] El Killer reformula una hipótesis ya prerregistrada y con datos: el resultado y la conclusión de la versión 1 se quedan en la 3

`rosa/estado/acciones.py:796`

**Qué pasa.** reformular_hipotesis no mira experimento.prerregistradoEn ni experimento.resultado. Cambia título y enunciado y sube la versión, pero deja intactos el experimento prerregistrado, su veredicto y la conclusión GRADE anterior. El prerregistro promete que «si la hipótesis cambia después, se comprobará la compatibilidad» (acciones.py:1285), pero ningún código lo hace. resultado_experimental (contexto.py:614) pasa «Veredicto contra el prerregistro: confirma» a la conclusión de la versión nueva sin decir qué versión se probó. En la práctica es reescribir la hipótesis después de conocer el resultado.

**Escenario.** hip-mtvulxbg-140: el experimento se prerregistró el 11/09 a las 08:39 para «Precedencia de la anormalidad plasmática de GFAP sobre NfL en APOE ε4 con amiloide positivo», y los datos llegaron con veredicto «confirma». El 17/09 a las 16:32 y a las 16:38 el Killer la reformuló hasta la versión 3, «Valor pronóstico de la duración conjunta GFAP-NfL frente a sus historias marginales». Hoy la ficha muestra ese título con el experimento en «confirma» y una conclusión del 17/09 16:16 que habla de otra afirmación: «GFAP plasmática se vuelve anormal antes que NfL ... El análisis del laboratorio cumplió el criterio congelado».

**Evidencia.** Estado: versión 3; experimento en datos_recibidos con veredicto confirma y fichero datos_gfap_nfl_sintetico.csv (lo sintético ya está documentado en S-18); el resultado no guarda versionProbada; conclusion.hipotesisBreve corresponde a la versión 1; pendienteRevision es None; las revisiones «reformulada» las firma openai/anthropic/claude-opus-5. Buscando «compatib» en rosa/, solo dossier.py:241 lee versionProbada y compatibleConActual, dos campos que este resultado no tiene.

**Propuesta.** Si hay un experimento prerregistrado, el Killer no reformula en sitio: crea una hipótesis derivada (derivadaDe) y la prerregistrada queda congelada. Si la reformula una persona, guardar versionProbada en el resultado, marcar la conclusión como pendiente de revisar y que resultado_experimental diga «se probó la versión 1; la actual es la 3». Invariante: resultado.versionProbada coincide con la versión actual o la compatibilidad está evaluada (hoy la incumple 1 hipótesis).

**Escéptico.** Código: reformular_hipotesis (acciones.py:796-866) no lee experimento, prerregistradoEn ni resultado, y no hay ninguna guarda en el bucle (grep de «prerregistr» en pasos.py y corrida.py: solo un texto en corrida.py:1175). La promesa de acciones.py:1285 no está implementada: versionProbada y compatibleConActual solo se leen en dossier.py:240-241 y nadie los escribe. propagar_reformulacion marca derivadas, planes y hechos, pero no el resultado propio ni la conclusión. resultado_experimental (contexto.py:614-634) no dice qué versión se probó. Estado de hip-mtvulxbg-140: versión 3; prerregistro del 11/09 08:39 (versionPrerregistrada None, porque es anterior al campo); resultado «confirma» sin versionProbada; conclusion.hipotesisBreve es la de la versión 1; pendienteRevision None; reformulada por Opus el 17/09 a las 16:32 y 16:38 por novedad; después «agotó reformulaciones» y descartar en contexto (16:41 y hoy a las 11:13). Atenuante: el único caso es un experimento sintético (S-18) y la hipótesis ya está propuesta para descarte, pero el mecanismo es general y no está documentado.

## [CONFIRMADO · alta · fallo] La candidatura al laboratorio se pinta con un campo guardado viejo y contradice al Ranking y al Killer

`frontend/src/lib/ranking.ts:328`

**Qué pasa.** El chip de la franja del ranking, la cola, la ficha y el filtro Laboratorio leen h.candidata tal como está guardado, y el servidor solo lo recalcula al cerrar una iteración (marcar_candidatas, rosa/bucle/corrida.py:2243). La tarjeta de candidatas del Ranking, en cambio, recalcula en vivo con candidatos(). Si el Killer cambia de decisión entre dos cierres, las dos fuentes nombran candidatas distintas.

**Escenario.** Estado real, investigación «GFAP y NfL en portadores de APOE4»: la corrida 3 está detenida y su último cierre fue el 17/09 a las 16:21. Después de ese cierre, hip-mtxcyxox-61 pasó a avanzar (17/09 16:59), hip-mtxfgfpi-70 pasó a suspender (17/09 19:36) y hip-mtvulxbp-150 pasó a suspender (23/09 11:22). En el Ranking pintado, la tarjeta «Candidatas al laboratorio» nombra solo «Especificidad amiloide de la brecha positiva GFAP-NfL». La lista «Por qué las demás no son candidatas» dice de «Valor pronóstico incremental...» y de «Concordancia de la brecha...» «El Killer decidió: suspendida». Pero las filas de esas dos, en la misma pantalla, dicen «Killer: Suspendida · Candidata al laboratorio», y la candidata real sale como «Sin bloqueos». La cola repite «Killer: Suspendida · Candidata». En la ficha, el chip lleva de título «el Killer la dejó avanzar». El filtro Laboratorio («candidatas que esperan laboratorio»), que es desde donde se asigna el experimento, enseña las dos suspendidas y oculta la candidata real.

**Evidencia.** Con vite-node sobre el estado real: candidatos() devuelve [hip-mtxcyxox-61] y h.candidata guardado da [hip-mtvulxbp-150, hip-mtxfgfpi-70]. Texto pintado de la cola: «...Certeza muy bajaKiller: SuspendidaCandidataIterac...». Código: ranking.ts:328 `candidata: Boolean(h.candidata)`, que usa FranjaRanking.tsx:121; Hipotesis.tsx:135; Hipotesis.tsx:344 `<Bloqueos bloqueos={bloqueosDe(estado, h)} candidata={h.candidata} />` (bloqueos en vivo con candidatura guardada); Hipotesis.tsx:1136 (filtro Laboratorio); Rosa2018.tsx:570 (título del chip). Ranking.tsx:121 sí usa candidatos(estado, invId). En el servidor, recalcular_bloqueos (acciones.py:521) solo pone candidata=False cuando aparece un bloqueo.

**Propuesta.** Derivar la candidatura en el navegador con una sola regla: calcular una vez por investigación el conjunto de ids de candidatos(estado, invId) y usarlo en componentesDe (ranking.ts), FilaCola, el Bloqueos de la ficha, enLaboratorio, HiloDelProceso.tsx:53 y 90 y arbol.ts:281 y 360. Como mínimo, exigir decisionKiller === 'avanzar' junto a h.candidata. En el servidor, recalcular las candidatas cuando el Killer escribe una decisión fuera del cierre de iteración (_atender_peticiones y _revisar_hipotesis).

**Escéptico.** Leí ranking.ts:328 (candidata: Boolean(h.candidata)), FranjaRanking.tsx:121, Hipotesis.tsx:135, 344 y 1136, Rosa2018.tsx:570 y HiloDelProceso.tsx:53 y 90. Todos leen el campo guardado. Solo calcularRanking (Ranking.tsx) usa candidatos(). En el servidor, candidata=True solo lo escribe marcar_candidatas (priorizacion.py:121), que solo se llama desde corrida.py:2243 al cerrar una iteración. recalcular_bloqueos (acciones.py:521) y la carga (almacen.py:1083) solo lo ponen a False si aparece un bloqueo, y 'suspender' no es un bloqueo. En rosa.db (solo lectura), inv-gfap: la corrida 3 está detenida y su último cierre fue el 17/09 16:21:34. hip-mtxcyxox-61 tiene Killer avanzar (17/09 16:59) y candidata False. hip-mtxfgfpi-70 tiene suspender (17/09 19:36) y candidata True. hip-mtvulxbp-150 tiene suspender (23/09 11:22) y candidata True. PR.candidatos() devuelve solo la 61. Con vite-node sobre el estado ya limpio, como lo sirve el servidor, componentesDe da el chip de candidata a true en las dos suspendidas y a false en la 61, y estadoDelHilo dice {laboratorio: 2}. Las tres tienen el experimento 'propuesto', así que el filtro Laboratorio enseña las dos suspendidas y oculta la 61. Las otras cuatro investigaciones no tienen desfase hoy. TRASPASO no lo documenta. Mantengo alta: la interfaz dice «el Killer la dejó avanzar» de dos hipótesis suspendidas y lleva la asignación, que congela un prerregistro inmutable, hacia ellas.

## [PLAUSIBLE · alta · fallo] La novedad anterior a S-02 sigue leyéndose como comprobada: el Killer da «pasa» y la interfaz pinta «Sin precedente» y «Sin ensayo»

`rosa/killer.py:196`

**Qué pasa.** El código viejo escribía «Sin precedente claro entre {total} obras que casan con: {términos}» tras tragarse los fallos del modelo de relevancia (`except Exception: continue`). No distinguía «no evalué nada» de «no se parece». La migración de S-02 solo recuperó los «entre 0 obras». El Killer da «pasa» a cualquier «sin_precedente», y `novedad_pendiente` (pasos.py:4136) no los repesca. Los ensayos buscados con palabras en castellano cortadas en la tilde siguen en «sin_ensayo».

**Escenario.** Seis hipótesis vivas tienen hoy novedad «pasa» en su última decisión del Killer por consultas como «reducci GFAP eliminaci cerebral» (hip-mu2uajpx-4553), «severidad indicada modifica reducci» (hip-mu2tskgf-2920) o «vascular cerebral reducci P-tau181» (hip-mu30n7o9-4025); también hip-mu2tgh7o-1740, hip-mtvulxbp-150 y hip-mtxfoq5o-16. La ficha enseña el chip verde «Sin precedente» y el ranking las llama «nueva». En 27 de 28 hipótesis, «Ningún ensayo registrado con: Precedencia anormalidad GFAP / definici temporal modifica» sale como chip verde «Sin ensayo», y el juez de la conclusión lo lee como comprobado.

**Evidencia.** Código anterior a 80bc256: `novedad["precedente"] = {"estado": "sin_precedente", "detalle": f"Sin precedente claro entre {total} obras que casan con: {termino}"}` después de `except Exception: continue`. Hipotesis.tsx:551: chip 'ok' para sin_precedente cuando el detalle no empieza por «No comprobado». ranking.ts:220 devuelve 'nueva'. El comentario de pasos.py:4186 reconoce que «Precedencia anormalidad» daba 0 ensayos.

**Propuesta.** En `novedad_pendiente`: tratar como pendiente todo precedente con el formato viejo (`^Sin precedente claro entre \d+ obras`, sin «obras evaluadas») y todo «Ningún ensayo registrado con:» cuyo término no salga de `terminos_para_ingles`. En killer.py: aceptar «sin_precedente» como pasa solo si el detalle trae un recuento de obras evaluadas mayor que 0.

**Escéptico.** La mitad del precedente no se sostiene. Los siete registros con el formato viejo «entre N obras» salieron de Exa: OpenAlex dio 0 y Exa 6 documentos, según las pistas. S-02 ya lo anotó («las 6 entre 6 obras se deben solo a Exa») al decidir migrar solo «entre 0 obras». En cada pista de novedad de esas iteraciones hubo 11 llamadas de volumen y todas tienen ok=1 en la tabla llamadas. Los dicts de Exa del código viejo traían resumen, referencia y doi. No hay rastro de que el cribado fallara en silencio, así que ese pasa del Killer se apoya en una evaluación real, aunque solo con Exa. La mitad de los ensayos sí se confirma. 27 de 28 hipótesis tienen sin_ensayo con consultas en castellano cortadas en la tilde («Precedencia anormalidad GFAP», «reducci GFAP eliminaci»), a las que ClinicalTrials.gov devolvió 0. El código actual usa terminos_para_ingles, pero no hubo migración y novedad_pendiente no mira los ensayos. Hipotesis.tsx:460 pinta el chip ok «Sin ensayo» en 26 de ellas (la que dice «No comprobado todavia» sale como no comprobada) y el juez de la conclusión lo recibe como hecho. No mueve al Killer.

## [SIN VERIFICAR · alta · fallo] El juez de verificación decide sin ver el pasaje: solo recibe los primeros 6.000 caracteres del fragmento

`rosa/bucle/pasos.py:2045`

**Qué pasa.** verificar_afirmaciones solo le pasa al juez frag.texto[:6000]. Desde la tanda 2 (18 de septiembre), el extractor lee cada fragmento en hasta 3 partes de 6.000 caracteres (politicas.py:202-203; pasos.py:1890 y 1916), y el determinista busca el pasaje en el fragmento entero (verificador.py:632). Así, una afirmación sacada de la parte 2 o 3 pasa el determinista, y el juez la juzga sin el texto que la sostiene.

**Escenario.** En la corrida 16, la afirmación af-mucq0n1k-4732 cita un documento de la FDA cuyo fragmento «resumen» mide 7.950 caracteres. El pasaje «time saved of 4.4 (1.87, 6.85) months» empieza en el carácter 7.130. El juez solo vio 6.000 y dictó no_sostenida con este motivo: «no reporta ... las cifras 4.4 (1.87, 6.85)». La afirmación es cierta y el pasaje está literal en la fuente.

**Evidencia.** En el estado real hay 52 afirmaciones juzgadas cuyo pasaje no está entero en los primeros 6.000 caracteres (V.pasaje_en_texto da False sobre texto[:6000] y True sobre el texto entero). Todas son de la corrida 16: 21 no_sostenida, 24 parcial y 7 sostenida. La corrida 16 tiene 23 no_sostenida y 33 parcial en total, así que el recorte explica el 91 % y el 73 %. De los fragmentos, 86 de la corrida 16 pasan de 6.000 caracteres (271 en todo el estado). Las 21 no_sostenida están en citas.a_reverificar (citas.py:544-553): el botón Reverificar las volvería a juzgar por el mismo camino, con el mismo recorte y el mismo prompt, que DSPy sirve desde la caché.

**Propuesta.** Pasar al juez la ventana del fragmento que contiene el pasaje (el determinista ya lo localiza) o la misma parte que leyó el extractor (partes_de_fragmento), en vez del principio. Añadir un test adversarial con el pasaje detrás del carácter 6.000. Después, reverificar las 52 con el prompt nuevo, para que no salgan de la caché: unas 52 llamadas a Opus, alrededor de 1,2 USD a 0,023 USD por llamada (medido).

## [SIN VERIFICAR · alta · fallo] El tope por iteración sale de estimaciones anteriores a la tanda 2 y para las corridas a mitad de verificación

`rosa/bucle/corrida.py:107`

**Qué pasa.** COSTE_POR_TIPO presupuesta 80 llamadas para verificación y 60 para extracción. El tope de la iteración es la suma del plan más la reserva del cierre (corrida.py:1844), y tope_agotado_en (contador.py:55-60) pausa la corrida en cuanto lo alcanza. Desde el 18 de septiembre la extracción saca entre 2,5 y 4 veces más afirmaciones, y cada una que pasa el determinista es una llamada a Opus. Además, la única forma de seguir es inflar el tope de la corrida (acciones.py:134-168).

**Escenario.** Las tres iteraciones de la corrida 16 se pausaron por el tope de la iteración cuando la corrida iba al 31 %, 46 % y 52 % del suyo (evento: «La iteración 1 gastó las 466 llamadas que le tocaban (la corrida lleva 468 de 1500)»). Las pausas duraron 17 min y 3 h 59 min, y la tercera sigue abierta desde el 22 sep a las 15:38 (unas 23 h). Para retomarla, Emir subió el tope de la corrida de 1.500 a 2.250 y luego a 3.375, sin que la corrida llegara a acercarse. La parada también bloquea las 6 revisiones pedidas de esa investigación: no hay ninguna llamada registrada desde las 12:16:57 de hoy.

**Evidencia.** Llamadas del juez de verificación (JuzgarAfirmacion en mlflow.db, por ventana de iteración) en la corrida 16: 273, 369 y 212 cuando se cortó, con 33 afirmaciones sin_verificar y los pasos modelo, hipótesis y novedad pendientes. El plan presupuestaba 80. Las iteraciones gastaron 580 y 723 llamadas, con topes de 466 y 463. En la corrida 13 (18 sep) la verificación fueron 100, 235 y 95. config.py:68 sigue diciendo «Una iteración completa cuesta entre 120 y 250 llamadas (medido)». Además, 22 de las 463 llamadas de la iteración 3 fueron aciertos de caché (0 tokens, 50 ms o menos) contados como llamadas; es la parte de S-20 que no se aplicó. Las afirmaciones que luego usa algún hecho o hipótesis no crecieron al mismo ritmo: 46, 74 y 53 por iteración en la corrida 13 frente a 62 y 112 en la 16.

**Propuesta.** Presupuestar la verificación con el dato real: las afirmaciones pendientes al terminar la extracción, o la mediana por tipo de paso de las últimas iteraciones según la tabla llamadas. Comprobar el tope antes de extraer, para no cortar a mitad de verificar lo ya extraído y pagado. Contar aparte los aciertos de caché. Permitir ampliar la iteración sin inflar el tope de la corrida. Con el agrupamiento del hallazgo siguiente, el juez habría gastado unas 6 veces menos, y las iteraciones 1 y 2 habrían cabido en su tope (estimación).

## [SIN VERIFICAR · alta · ineficiencia] Las llamadas por elemento reenvían siempre el mismo contexto grande, sin caché de prompt

`rosa/bucle/pasos.py:1359`

**Qué pasa.** El cribado, el juez de verificación, los supuestos y el torneo hacen una llamada por artículo, afirmación, supuesto o partido, y cada una repite el mismo contexto. Las llamadas a Claude se facturan lineales, sin descuento de caché. En tres firmas, además, el campo compartido va detrás del que cambia, así que ni una caché de prefijo lo aprovecharía.

**Escenario.** En el cribado en amplitud (PuntuarRelevanciaAmplitud, Sonnet), cada artículo manda 12.380 caracteres de hipotesis_y_vivero para recibir 348 de respuesta. En 1.103 llamadas ese campo solo tomó 14 valores distintos: cada uno se envió 78,8 veces de media.

**Evidencia.** Medido sobre los 9.701 prompts de mlflow.db:
- PuntuarRelevancia: 2.901 llamadas; preguntas_abiertas (2.510 caracteres) se repite ×44,6.
- JuzgarAfirmacion (Opus): 2.355 llamadas; fragmento (3.191 caracteres) ×6,4, con 367 fragmentos distintos.
- EvaluarSupuesto: 892 llamadas; afirmaciones_sostenidas (6.970 caracteres) ×18,2.
- CompararHipotesis (Opus): 251 llamadas, dos por par; evidencia (22.169 caracteres) ×8,4.
En total son 7.502 de 9.701 llamadas (77 %) y unos 38,5 M caracteres repetidos: del orden de 16 M tokens, un 40 % de los 39,9 M de entrada de la tabla llamadas, y unos 47 USD de los 304 estimados con la tabla de precios. La facturación es lineal: REVISION-BUGS-2026-09-17.md:397 da Sonnet 2/10 y Opus 5/25 exactos, y en la corrida 16 la tabla da 51,28 USD frente a 51,32 facturados. Orden de campos en firmas.py: afirmacion va antes de fragmento (294-297), supuesto antes de afirmaciones_sostenidas (373-374) e hipotesis_a/b antes de evidencia (415-417). En el torneo, evidencia son los primeros 6.000 caracteres de afirmaciones de la corrida (pasos.py:3669): de sus 23,6 afirmaciones de media, 2,1 son de A o de B, y en 136 de 251 llamadas ninguna.

**Propuesta.** 1) Agrupar: un juicio por fragmento con todas sus afirmaciones (en la corrida 16 hay entre 5,6 y 6,8 afirmaciones juzgadas por fragmento), un cribado por consulta de hasta 12 artículos y una evaluación de supuestos por hipótesis. Estimado: de 7.502 llamadas a unas 1.150. 2) Poner primero lo compartido en esas firmas y probar la caché de prompt de Anthropic a través del gateway. 3) En el torneo, usar como evidencia las afirmaciones de A y B. Cambiar las firmas invalida la caché de DSPy y los programas optimizados: comparar contra una corrida de referencia.

## [SIN VERIFICAR · alta · fallo] Las afirmaciones heredadas de otra corrida llegan con el veredicto viejo y bloquean la evidencia central

`rosa/bucle/pasos.py:1133`

**Qué pasa.** `_reutilizar_fuente` copia con `copy.deepcopy(a_prev)` las afirmaciones de una fuente ya leída en otra corrida, con su veredicto y su motivo, sin pasarlas por el verificador determinista de hoy, que es gratis. Los bloqueos «cita_no_resuelve» que puso el verificador anterior al 18 de septiembre (el del texto web) se propagan de corrida en corrida (5 → 15 → 16). Además, la copia se marca con la iteración actual (`nueva["iteracion"] = ctx.numero`), así que cuenta como trabajo de esta iteración.

**Escenario.** Corrida 16, iteración 1 (22 sep): 339 de las 609 afirmaciones son copias, y las 157 bloqueadas por la cita son todas copias. En toda la corrida, 213 de 225 «cita_no_resuelve» son heredadas; 170 llevan el mensaje «no apunta a ninguna fuente ni localizador conocidos», que el código dejó de producir el 18 sep (commit 80bc256). `citas.bloquea_hoy` desbloquearía 200 de las 225. En la corrida 15 son 107 de 107 heredadas, de las que 103 se desbloquearían. Las fuentes afectadas son el núcleo de la pregunta: van Dyck 2022, CLARITY AD (21); Sims 2023, TRAILBLAZER-ALZ 2 (13); Lu 2025 (33); Shcherbinin 2022 (25); Willis 2024 (7); AAIC 2023 (51). Nada de eso llega a las hipótesis. El llano de esa iteración dice «609 verificaciones: 421 sostenidas… 157 cuya cita no resolvía», con las copias contadas como verificadas en la iteración.

**Evidencia.** pasos.py:1129-1143 y el docstring de `_reutilizar_fuente`: «el mismo veredicto (no vuelven a la cola de verificación)». Recuento en solo lectura sobre `corridas[]._afirmaciones` (campo `_reutilizadaDe`) y `rosa.citas.bloquea_hoy`. TRASPASO (22 sep) atribuye los 157 bloqueos de la corrida 16 al «verificador de entonces» y los trata con un chip y un botón Reverificar manual por corrida. No dice que cada corrida nueva vuelve a heredarlos: es peor de lo documentado.

**Propuesta.** Al copiar, pasar cada afirmación por `V.comprobar_determinista` contra los fragmentos copiados. Si el veredicto guardado bloquea y el de hoy no, copiarla como `sin_verificar` para que vaya a la cola del juez, y guardar el veredicto original en `_reutilizadaDe`. Contar las heredadas aparte en `_explicar_en_llano`, `recuentos_del_registro` y el informe. Test: una fuente de una corrida vieja con «cita_no_resuelve» y localizador «texto web, parte 2» que hoy resuelve tiene que quedar `sin_verificar` en la corrida nueva.

## [SIN VERIFICAR · alta · fallo] «Qué cambió desde la iteración anterior» cuenta cambios de certeza que no ocurrieron, a veces al revés

`rosa/bucle/corrida.py:912`

**Qué pasa.** `_explicar_en_llano` le pasa al modelo, para cada hipótesis, «(antes: X)» sacado de `conclusion.cambio`. Ese campo describe el cambio de la última reconclusión, sea de cuando sea, y no se borra si la hipótesis no se reconcluye. Como el llano se escribe antes de reconcluir, el modelo anuncia como nuevo el cambio de la iteración anterior o de otra corrida. La firma pide cambios «respecto a la iteración anterior» y la interfaz los enseña bajo ese título.

**Escenario.** Corrida 16, iteración 1 (22 sep): la lista `cambios` dice que la hipótesis de normalizar P-tau181 «subió de certeza muy baja a baja». Es el cambio del 18 sep, en la corrida 13. En la misma lista, el párrafo por regla dice que esa hipótesis «bajó de baja a muy baja». En la iteración 2 narra tres cambios y no cambió ninguna certeza ni dirección (las instantáneas de it1 e it2 son idénticas). Las 12 iteraciones con instantánea de progreso narran algún cambio que no ocurrió en ellas: 8 no tuvieron ningún cambio real, y en 2 (it-mu75mpoe-802 e it-mucpr0cn-3461) la dirección narrada es la contraria a la real.

**Evidencia.** corrida.py:909-913: `cambio = f" (antes: {k['cambio']['de']['certeza']}, ...)" if k.get("cambio")`. corrida.py:1082-1084 solo escribe `cambio` al reconcluir. firmas.py:488 y 520 dicen «respecto a la iteración anterior». EnLlano.tsx:56. Comparé `resumenLlano.cambios` con `corridas[].progreso[].certezas` y con el registro `aprendizaje` de creencias. TRASPASO da por resuelto el 19 sep el llano desfasado, pero ese arreglo (cierre_texto) solo añade el párrafo por regla y el aviso para frases de «se mantiene». Los dos cierres del 22 sep siguen mal.

**Propuesta.** No pasar `cambio` al llano, o pasarlo solo si `conclusion.fecha >= it.empezadaEn`. Mejor aún: que la lista `cambios` salga solo de `CIERRE.texto_del_cierre`, calculada por regla entre la última instantánea de la investigación y la actual. Test: una hipótesis con `cambio` de una corrida anterior y sin reconclusión tiene que dejar `cambios` vacío.

## [SIN VERIFICAR · alta · fallo] El juez del revisor lee un registro cortado a 9000 caracteres y emite hallazgos graves falsos que bloquean todas las hipótesis

`rosa/revisor_registro.py:816`

**Qué pasa.** `texto_registro` pone delante el plan, las pistas, las búsquedas y las hipótesis, y corta el total a 9000 caracteres. En las iteraciones grandes las afirmaciones empiezan hacia el carácter 7500, así que el juez ve unas 7. EJECUCIONES, REPRODUCCIONES, CONSULTAS y FUENTES no le llegan nunca. El registro tampoco trae el objetivo ni la certeza de cada hipótesis. El juez dice «no consta» de lo que no ve, y un hallazgo alto abierto en la última iteración cerrada bloquea con `revision_registro_abierta` todas las hipótesis de la investigación.

**Escenario.** Corrida 16, iteración 2 (482 afirmaciones, 443 sostenidas): el juez vio de A1 a A7, las siete copias heredadas de Mintun 2023 con «cita_no_resuelve» (hallazgo anterior). Escribió en gravedad alta: «En el registro no consta ninguna afirmación con veredicto sostenida». En la iteración 1 (609) vio siete copias de Shcherbinin 2022 y escribió en alta: «todas las afirmaciones listadas tienen veredicto [cita_no_resuelve]». Resultado: las 9 hipótesis de «Qué distingue a un biomarcador…» llevan el bloqueo, y su dossier dice «NO es candidata al laboratorio». Reconstruido con el código de hoy: 25 de 33 revisiones salieron cortadas, y en las de más de 100 afirmaciones el juez vio entre 7 y 19. Otros 11 hallazgos del juez dicen que «certeza muy baja» no tiene respaldo porque el registro no trae certezas. De los 14 que marcan la frase «comparar semaglutida, posdinemab y AL002», 11 describen el objetivo, que tampoco está en el registro.

**Evidencia.** revisor_registro.py:779 (`maximo: int = 9000`) y 816 (`return "\n".join(lineas)[:maximo]`). En it-mucrsqg6-345 la sección AFIRMACIONES empieza en el carácter 7527. El propio juez escribe «las siete afirmaciones listadas». priorizacion.py:78-100 bloquea con cualquier hallazgo alto y abierto, y 170 de 170 siguen abiertos. Las herramientas de hoy (e0381a1) no lo resuelven: `leer_afirmacion` llega como mucho a A60 y el listado no dice cuántas hay; `leer_ejecucion` pide un id que está en la sección cortada.

**Propuesta.** Repartir un presupuesto por sección. Primero van los recuentos por veredicto (total, sostenidas, bloqueadas, heredadas), el objetivo y la certeza y dirección de cada hipótesis. Después, una muestra estratificada de afirmaciones (no las primeras 60) y siempre la lista de ids de ejecuciones y fuentes; recortar pistas y búsquedas antes que afirmaciones. Marcar `registroRecortado` en la revisión y no dejar que un «no consta» del juez sea de gravedad alta si el registro se recortó. Reevaluar los dos hallazgos altos de la corrida 16.

## [SIN VERIFICAR · alta · fallo] La coma decimal con cero delante se sigue leyendo como miles en los datos de laboratorio y en el Killer

`rosa/datos.py:55`

**Qué pasa.** El arreglo de hoy («0,027» leído como 27) se hizo solo en revisor_registro._norm. datos._numero, que hace el resumen de los CSV de laboratorio y de los datasets, y killer._normaliza_num, que busca cifras fuera del pasaje, conservan la regla vieja. El test de datos (test_rosa2018.py:731) cubre «0,8» pero no «0,027», y TRASPASO solo habla del revisor.

**Escenario.** La médica sube un resultados_ELISA.csv exportado de Excel en español (punto y coma, coma decimal) con GFAP 0,8; 0,027; 0,15; 0,9; 0,031; 0,7. _evaluar_resultado (rosa/bucle/corrida.py:1164) solo le da al juez el resumen agregado de D.resumir (las filas no salen), y ese resumen dice media=10.09, sd=13.42, Q3=28, max=31: dos valores entran multiplicados por mil y el juez decide confirma o refuta contra el prerregistro con esas cifras. En el Killer, la afirmación real «-0,050 puntos en ADCOMS (IC 95%: -0,074 a -0,027)» contra su pasaje «-0.050 (95% CI, -0.074 to -0.027)» sale con cifras fuera del pasaje ['0,050', '0,074', '0,027']. Si estuviera sostenida en una hipótesis, fidelidad_evidencia quedaría no_comprobable con detalle, el juez no puede levantarla y el Killer suspende.

**Evidencia.** D._numero('0,027') = 27.0; K._normaliza_num('0,027') = '27' y ('0,001') = '1'; RR._norm('0,027') = '0.027'. Resumen reproducido con D._leer_tabla y D._resumen_tabla sobre el CSV de arriba. En el Killer hoy es latente: ninguna afirmación de hipótesis del estado real lleva «0,ddd», pero hay 38 apariciones en afirmaciones de corridas.

**Propuesta.** Una sola función de normalización compartida (la de revisor_registro, con el caso del cero) para datos, killer y revisor. En un CSV cuyo delimitador detectado sea ';', tratar la coma siempre como decimal. Añadir tests con '0,027', '-0,050', '0,001' y una tabla con punto y coma.

## [SIN VERIFICAR · alta · fallo] Las reglas nuevas del revisor dan avisos, casi todos falsos, en 25 de 28 dossiers reales

`rosa/estado/acciones.py:1133`

**Qué pasa.** generar_dossier pasa el dossier entero por comprobaciones_deterministas, y las tres reglas de hoy (sobreafirmaciones, cifra_fuera_de_contexto, cuenta_que_no_cuadra) solo se validaron contra los resúmenes de iteración. El dossier lleva protocolo, tarjeta, supuestos y perfil de diana, y ahí disparan casi siempre: con terminología clínica, con condicionales y con unidades que se toman por dueño. Ningún test genera un dossier con las reglas nuevas.

**Escenario.** Pulsar «Generar dossier» en cualquier hipótesis. Generado en memoria con A.generar_dossier sobre una copia del estado real (versión 28161, sin escribir nada): 25 de 28 dossiers llevan conclusion_no_sigue y 24 de 28 una cifra_fuera_de_contexto de gravedad alta, en la sección «Revisión del registro (por regla)» que va al laboratorio.

**Evidencia.** Recuento de clases nuevas: cifra_fuera_de_contexto 24, conclusion_no_sigue 25, cuenta_que_no_cuadra 1. Ejemplos: «confirmada» en «positividad amiloide confirmada (PET/CSF) en la visita basal»; «demuestra» en «también bajaría si se demuestra que semaglutida no produce cambio»; «confirmado» en «Evaluar sensibilidad a cruce confirmado»; «0.6 está en el registro, pero de GFAP, MAPT (tau)..., no de TPM» (TPM es una unidad y _SIGLA la convierte en dueño). Sobre los 81 resúmenes, 0 avisos, como dice el commit, pero ese no era el único consumidor. El único test del dossier (test_rosa2018.py:185) no mira la revisión.

**Propuesta.** Aplicar sobreafirmaciones y cuentas solo al texto libre del modelo (resumen y llano), no al dossier armado por plantilla. Sacar de _sujetos las siglas que son unidades o escalas (TPM, SUVR, FPKM, CDR, MMSE). Añadir un test que genere el dossier de la muestra y exija cero hallazgos de las clases nuevas sobre texto de plantilla.

## [SIN VERIFICAR · alta · riesgo] El test de la parada del servidor se parametriza con la misma constante que debería vigilar

`rosa/tests/test_parar_servidor.py:43`

**Qué pasa.** @pytest.mark.parametrize('estado', list(PS.ESTADOS_VIVOS)) toma de scripts/parar_servidor.py la lista de estados que deben impedir la parada. Si alguien quita un estado vivo de la tupla, el caso desaparece en vez de fallar. Es la regla que se saltó el 22 de septiembre.

**Escenario.** Mutación en una copia: ESTADOS_VIVOS sin 'esperando_modelo'. La suite completa pasa con 1789 tests, uno menos que la base. Con ese cambio, parar_servidor.py pararía el servidor con una corrida esperando al juez, que es trabajo vivo (TRASPASO 7.4), y dos procesos podrían volver a bifurcar el registro.

**Evidencia.** test_parar_servidor.py:43-48 y scripts/parar_servidor.py:55. Solo 'en_marcha' tiene un test propio (línea 29). Resultado del arnés: [M4_parar_ignora_esperando_modelo] SOBREVIVE, 1789 passed, 5 skipped.

**Propuesta.** Escribir a mano en el test los cuatro estados esperados. Añadir un test que compruebe que ESTADOS_VIVOS y la lista de estados permitidos cubren exactamente EstadoCorrida de frontend/src/datos/tipos.ts, para que un estado nuevo obligue a decidir.

## [SIN VERIFICAR · alta · riesgo] Ningún test protege que al modelo de mundo solo entren afirmaciones sostenidas o parciales

`rosa/bucle/contexto.py:283`

**Qué pasa.** La única barrera es el filtro de afirmaciones_sostenidas. paso_modelo (rosa/bucle/pasos.py:2299, y lo mismo en 3780) toma el respaldo de cada hecho de esa lista numerada sin volver a mirar el veredicto, y ningún test prueba el filtro con una lista mezclada.

**Escenario.** Mutación en una copia: el filtro admite también 'sin_verificar'. La suite completa pasa (1790). Con ese cambio, si el cerebro cita el número de una afirmación que el juez aún no ha verificado, nace un hecho respaldado solo por ella, en contra de una de las reglas que no se negocian.

**Evidencia.** [M6_mundo_admite_sin_verificar] SOBREVIVE, 1790 passed. El único test que llama al filtro directamente (test_tanda2_literatura_segunda.py:573) usa afirmaciones ya verificadas y además exige que no quede ninguna sin_verificar.

**Propuesta.** Añadir un test de paso_modelo con una afirmación sin_verificar y otra sostenida en la misma iteración y un cerebro falso que cite el índice 1, con la aserción de que todo hecho nacido tiene solo afirmaciones sostenidas o parciales. Añadir también una segunda comprobación con hechos.VEREDICTOS_QUE_SOSTIENEN al construir respaldo.

## [CONFIRMADO · media · fallo] Dos secciones con el mismo nombre comparten localizador: la cita es ambigua y el visor enseña la otra

`rosa/bucle/pasos.py:660`

**Qué pasa.** El localizador de Europe PMC es `sección {título[:60]}`, y `europepmc.texto_completo` (europepmc.py:102) recorre todos los `<sec>` del JATS: también los del resumen estructurado y las subsecciones con el mismo nombre en Métodos y en Resultados. Así, dos fragmentos de una misma fuente acaban con el mismo localizador. El verificador elige el que contiene el pasaje, pero `citas._fragmento_de` (citas.py:215) devuelve el primero. Además, `paso_extraccion` marca como leídos todos los homónimos (pasos.py:1970) aunque solo se leyera uno.

**Escenario.** Zimmer et al., 2026 (extensión abierta de TRAILBLAZER-ALZ 2) tiene «sección Efficacy» en Métodos (3.830 caracteres) y en Resultados (1.580). «Participants» y «Safety» también salen dos veces. af-mucq0e6f-4709 («donanemab treatment slowed disease progression among early start participants...») viene de Resultados, pero la ficha de la cita enseña Efficacy de Métodos, sin marca y con completo=False. Mientras, «Lo que se comprueba hoy» dice que el pasaje es literal. La cita «[Zimmer et al., 2026, sección Efficacy]» no dice cuál de las dos es.

**Evidencia.** Estado real: 21 fuentes tienen localizadores repetidos: «sección Sin título» en 11, «Background» en 6, «METHODS», «RESULTS» y «DISCUSSION» en 4 (resumen frente a cuerpo), y «Efficacy», «Participants» y «Safety» en Zimmer. Hay 10 afirmaciones sostenidas cuya ficha enseña una sección que no contiene su pasaje: citas.ficha devuelve completo=False y en falta el propio pasaje.

**Propuesta.** Hacer único el localizador, con la ruta de secciones («sección Methods > Efficacy») o con un ordinal («sección Efficacy (2)»). Etiquetar las secciones del resumen como «resumen: Results» o saltarlas, porque el resumen ya se guarda. En `_fragmento_de`, elegir el candidato que contiene el pasaje, como hace el verificador. Marcar `extraido` por fragmento y no por localizador.

**Escéptico.** europepmc.texto_completo recorre todos los <sec> con raiz.iter, también los del resumen estructurado. pasos.py:660 usa «sección {título[:60]}» sin ruta. citas._fragmento_de (citas.py:214) devuelve el primer fragmento con ese localizador, y pasos.py:1970 marca extraido por localizador. Lo reproduje con citas.ficha sobre af-mucq0e6f-4709. La ficha enseña el «Efficacy» de Métodos (3.830 caracteres), con tramos vacíos, completo=False y el pasaje entero en falta, mientras que hoy.literal=True. El pasaje está en el otro «Efficacy» (1.580 caracteres). En el estado hay 21 fuentes con localizadores repetidos y 10 sostenidas de Zimmer (Efficacy y Participants) cuya ficha enseña un fragmento que no contiene su pasaje. El verificador sí elige el que lo contiene (verificador.py:629-634), así que el veredicto es correcto. Fallan la cita y el visor.

## [CONFIRMADO · media · fallo] De cada PDF solo se guardan las 14 primeras páginas con texto y nadie lo dice

`rosa/bucle/pasos.py:645`

**Qué pasa.** `pdf.paginas(ruta)[:MAX_PAGINAS_PDF]` se queda con las 14 primeras páginas no vacías. La pista dice «PDF con 14 páginas leídas» sin dar el total, y la fuente queda con textoCompleto=True. Lo que esté de la página 15 en adelante ni se extrae ni entra en el alcance con el que se refutan las ausencias.

**Escenario.** La revisión de la FDA de donanemab tiene 621 páginas y se guardan 14 (hasta la 19, porque hay páginas vacías). La ficha dice «texto completo». Una afirmación del tipo «la FDA no informa X», sacada de otra fuente, no se refuta aunque X esté en la página 200.

**Evidencia.** De los 18 PDF distintos del estado, 13 tienen más páginas que las guardadas: FDA 621 (14 guardadas), «Sin autor» 139 y 43, Brown et al., 2025 28, Belder et al., 2026 19, Shulman et al., 2023 19, McDade et al., 2022 17. MAX_PAGINAS_PDF no aparece ni en TRASPASO.md ni en README.md.

**Propuesta.** Guardar `paginasTotales` en la fuente y decir «14 de 621 páginas» en la pista y en la ficha. No poner textoCompleto=True cuando hubo corte, o usar un estado parcial. Guardar el texto de todas las páginas (el PDF ya se abre entero) y dejar que `elegir_fragmentos` decida cuáles se extraen.

**Escéptico.** pasos.py:645 corta a MAX_PAGINAS_PDF=14 páginas no vacías, aunque pdf.paginas devuelve todas. La pista solo dice «PDF con N páginas leídas», textoCompleto queda en True (pasos.py:599) y Procedencia.tsx:70 enseña «texto completo» con el título «ROSA2018 leyó el texto completo». Abrí en solo lectura los PDF guardados: 13 de 18 tienen más páginas que las guardadas (FDA 621, con 14 guardadas hasta la 19; luego 165, 139, 43, 33, 28...), todos con textoCompleto True. Un matiz: el tope de 14 páginas sí está anotado como riesgo en INVESTIGACION-SECCIONES-2026-09-22.md:171. Lo que no se dice es que la interfaz lo presente como texto completo ni el total de páginas. Lo de las ausencias se sigue del alcance (solo entran los fragmentos guardados), pero no lo reproduje con un caso real.

## [CONFIRMADO · media · fallo] «Las fuentes reunidas no hablan de esto» se decide sobre unas 31 de 1.149 afirmaciones

`rosa/bucle/pasos.py:2723`

**Qué pasa.** La regla 3 (commit 25ddec4) pone el alcance en 'no_tocado' cuando ninguna afirmación de `lista_sup` toca el supuesto, y la interfaz lo traduce como «Las fuentes reunidas no hablan de esto» (etiquetas.ts:339). Pero `afirmaciones_para_supuestos` (pasos.py:2801-2809) corta la lista a 8.000 caracteres: primero van las afirmaciones propias de la hipótesis y luego las de la corrida por orden de llegada, no por pertinencia. Lo que el evaluador no llegó a ver se da como que las fuentes no hablan de ello: un «no se miró» convertido en «no hay».

**Escenario.** Corrida 16: hay 1.149 afirmaciones sostenidas o parciales y, para cada hipótesis, el evaluador ve entre 30 y 33 (de 4 a 13 propias más las unas 20 primeras de la corrida). Un supuesto que traten afirmaciones de la iteración 5, por ejemplo sobre el intervalo de referencia de GFAP en plasma, sale 'no_tocado', y la ficha dice que las fuentes reunidas no hablan de ello.

**Evidencia.** Cálculo sobre el estado con `afirmaciones_para_supuestos`: en la corrida 16, de 1.149 sostenidas o parciales entran 30 a 33 en la lista; en la corrida 3, de 164 entran 30 o 31. La copia del estado aún no trae supuestos con `alcance`, porque la reevaluación sigue en marcha.

**Propuesta.** Guardar en cada supuesto cuántas afirmaciones vio el evaluador y cuántas había (N de M). Si hubo corte, usar otro alcance ('no_tocado_en_lo_visto', con un texto del tipo «ninguna de las 31 revisadas, de 1.149»). Elegir las afirmaciones de la corrida por parecido con el supuesto (índice semántico o reranker) y no por orden de llegada.

**Escéptico.** alcance_del_supuesto (pasos.py:2686) da no_tocado cuando ningún índice de lista_sup toca el supuesto. afirmaciones_para_supuestos (pasos.py:2771-2809) corta a 8.000 caracteres: primero las afirmaciones propias y luego las de la corrida por orden de llegada. etiquetas.ts:339 lo traduce como «Las fuentes reunidas no hablan de esto». Ejecuté la función sobre el estado real. En la corrida 16 hay 1.149 sostenidas o parciales y la lista tiene entre 30 y 33. En la corrida 3 hay 164 y entran 30 o 31. Un ejemplo: el supuesto de hip-mu2uqqzu-5871 sobre un intervalo de referencia de P-tau181. La corrida tiene dos afirmaciones con puntos de corte de p-tau181 (af-mud2hzc4-4459 y 4461, de la iteración 3) que quedan fuera de la lista. La regla 3 en TRASPASO no menciona el corte. Ningún supuesto de la copia del estado trae aún alcance, así que el rótulo equivocado no lo vi en un caso real; el mecanismo sí queda demostrado.

## [CONFIRMADO · media · fallo] «Ya no bloquearía» incluye veredictos del juez y afirmaciones sin pasaje

`rosa/citas.py:289`

**Qué pasa.** `bloquea_hoy` solo corre las comprobaciones deterministas. Toda afirmación que las pasa, como las que el juez declaró no_sostenida, sale con bloqueoViejo, y la ficha dice que «quedó bloqueada con una versión anterior del verificador y hoy ya no lo estaría». Además, `comprobar_determinista` se salta la literalidad cuando el pasaje viene vacío (verificador.py:631). Por eso una afirmación bloqueada porque el extractor no devolvió pasaje también entra en `a_reverificar` (citas.py:552) y va al juez sin pasaje: puede acabar sostenida sin fragmento que la respalde.

**Escenario.** af-mu5y14bq-13907 (corrida 3) es no_sostenida por el juez, con el motivo «las cifras son exactas, pero provienen de una cohorte amiloide-negativa». La lista de citas la marca «ya no bloquearía» y el botón «Reverificar» la cuenta. Prueba sintética: una afirmación con cita que resuelve, fragmento vacío y veredicto cita_no_resuelve («El extractor no devolvió el pasaje»). `a_reverificar` la devuelve y el determinista da sin_verificar con necesita_juez=True.

**Evidencia.** Estado real: 25 de las 31 no_sostenida, todas con motivo del juez, salen con bloqueoViejo=True. La pantalla cuenta en total 1.947 que «ya no bloquearían» (1.922 cita_no_resuelve y 25 no_sostenida). El caso sin pasaje no existe hoy en el estado (0 afirmaciones con pasaje vacío): es latente, pero el mecanismo está demostrado.

**Propuesta.** Guardar de dónde sale cada veredicto (regla o juez) y marcar bloqueoViejo solo en los de regla. En `comprobar_determinista`, un pasaje vacío con una cita que resuelve tiene que devolver cita_no_resuelve con el motivo del extractor, igual que hace paso_extraccion.

**Escéptico.** bloquea_hoy (citas.py:195-212) solo corre comprobar_determinista. Para todo lo que pasa las reglas, eso devuelve sin_verificar con necesita_juez, que no bloquea. Así, bloqueoViejo (citas.py:289) y a_reverificar (citas.py:545-553) incluyen los no_sostenida del juez. Pasé citas.lista sobre el estado: salen 1.947 con bloqueoViejo (1.922 cita_no_resuelve y 25 no_sostenida). De esas 25, de un total de 31 no_sostenida, ninguna tiene un motivo de regla («Identificadores...»): todas son del juez. Aun así, Citas.tsx:466 dice «hoy ya no lo estaría». Hice una prueba sintética en memoria: una afirmación con el fragmento vacío y cita_no_resuelve entra en a_reverificar, y el determinista da sin_verificar con necesita_juez=True. Esa parte es latente, porque hay 0 afirmaciones sin pasaje en el estado. TRASPASO (22 de septiembre) cuenta «14 no_sostenida» como bloqueos que ya no se sostienen sin advertir que son del juez, y el propio docstring de bloquea_hoy dice que inflar esa cifra es lo que no se hace.

## [CONFIRMADO · media · fallo] El Killer vacía el índice semántico: hechos, fuentes y lecciones desaparecen hasta la siguiente reindexación

`rosa/indice_semantico.py:255`

**Qué pasa.** `hipotesis_parecidas` llama a `indice.indexar` solo con las hipótesis de la investigación, e `indexar` empieza borrando todo id que no esté en esa lista (líneas 103-109). Cada comprobación de redundancia del Killer deja el índice con esas hipótesis y nada más. El torneo, que va justo después, pide el modelo de mundo por parecido (pasos.py:3669, que llama a contexto.py:136) y recibe cero hechos. Aun así, el texto que llega al modelo dice «por parecido con este paso», porque `modo` se fija antes de mirar si hubo resultados. A los diez minutos, `indexar_estado` vuelve a incrustar todo el estado.

**Escenario.** En el paso de hipótesis, el Killer revisa una hipótesis de inv-mu2sz2ns-3 que no tiene redundancia por entidades y llama a hipotesis_parecidas. Se borran 2.251 afirmaciones, 574 fuentes, 460 hechos y 200 lecciones, además de todo lo de las otras cuatro investigaciones. Hasta la siguiente pasada devuelven vacío `leer_modelo_de_mundo`, las lecciones por parecido y la búsqueda global por significado.

**Evidencia.** Prueba en memoria, sin red y con los hashes ya al día: con un índice que contiene hipotesis:h1, hecho:x1, fuente:f1 e hipotesis:h9 (de otra investigación), después de indexar([hipotesis:h1]) solo queda ['hipotesis:h1']. En datos/_indice/rosa.db.db, leído en solo lectura, los unos 4.500 vectores de todos los tipos e investigaciones tienen actualizado a las 11:42 de hoy, lo que cuadra con un borrado y un reincrustado completos.

**Propuesta.** Separar podar de insertar: llamar a `indexar(items, podar=False)` desde hipotesis_parecidas, o podar solo dentro de su ámbito (tipo 'hipotesis' y esa investigación). En `modelo_de_mundo_para` y en `lecciones.para`, poner el modo «por parecido» solo si hubo resultados.

**Escéptico.** hipotesis_parecidas (indice_semantico.py:246-255) llama a indexar solo con las hipótesis de la investigación, e indexar (líneas 103-109) borra todo id que no esté en la lista. Lo reproduje en memoria, sin red y con los hashes al día: después de indexar([hipotesis:h1]) solo queda hipotesis:h1. La llamada sale del Killer (pasos.py:3136), y justo después el propio Killer pide el modelo de mundo por parecido (pasos.py:3165). Corrijo un detalle del hallazgo: no recibe «cero hechos». modelo_de_mundo_para completa por prioridad (contexto.py:159), pero lo rotula «por parecido con este paso», porque modo se fija en la línea 139 antes de saber si hubo resultados. leer_modelo_de_mundo cae a búsqueda por texto y lecciones.para se queda con las recientes. /api/buscar sí queda solo con hipótesis. Solo pasa cuando no hubo redundancia por entidades. En el índice (solo lectura), 4.438 de 4.455 vectores tienen actualizado a las 11:42 de hoy sin que items_del_estado haya cambiado desde el 18, lo que cuadra con un borrado y un reincrustado. El coste de reincrustar son céntimos.

## [CONFIRMADO · media · fallo] Un error GraphQL de Open Targets tumba el paso de novedad con un NameError

`rosa/fuentes/opentargets.py:10`

**Qué pasa.** `_sin_errores` lanza `FuenteNoDisponible`, pero el módulo no la importa. Cuando Open Targets responde 200 con `errors`, salta un NameError que el `except FuenteNoDisponible` de paso_novedad (pasos.py:4171) no captura. Falla el paso entero, y las hipótesis que quedaban del lote de seis se quedan sin ninguna comprobación de novedad (ensayos, precedente, patentes, genética), cuando lo que tocaba era «Open Targets no respondió; no se afirma ausencia».

**Escenario.** Un símbolo que la búsqueda GraphQL rechaza, o un cambio de esquema en `associatedDiseases(Bs:)`, hace que llegue el cuerpo {"errors": [...]}. Salta NameError: name 'FuenteNoDisponible' is not defined, y el paso queda «fallido» con ese motivo técnico a la vista.

**Evidencia.** `./.venv/bin/python -c "from rosa.fuentes import opentargets as O; O._sin_errores({'errors':[{'message':'boom'}]})"` da NameError: name 'FuenteNoDisponible' is not defined. Los 149 tests de citas, verificador, dianas, Exa e índice pasan porque ninguno cubre esta rama.

**Propuesta.** Añadir FuenteNoDisponible al import desde rosa.fuentes.base y un test que simule el cuerpo con `errors`. De paso, cambiar `r.json()` por `json_de(r)` en clinicaltrials.buscar, europepmc.buscar, crossref y openalex, para que un HTML con 200 sea «no pude comprobar» y no un ValueError que también tumba el paso de novedad.

**Escéptico.** opentargets.py:10 importa solo Limitador, json_de y pedir, pero _sin_errores lanza FuenteNoDisponible. Lo ejecuté y da NameError: name 'FuenteNoDisponible' is not defined. paso_novedad (pasos.py:4171) solo captura FuenteNoDisponible, y _ejecutar_paso (corrida.py:1987-2003) marca el paso como fallido con ese motivo. Lo agrava algo más: _novedadIntentos solo sube en aplicar (pasos.py:4289) y los pendientes se ordenan por menos intentos (4149). Si el error persiste, por ejemplo con un cambio de esquema, la misma hipótesis vuelve a ir primera y el paso cae en cada iteración. También confirmé r.json() sin json_de en clinicaltrials.py:25 y 48, europepmc.py:55, crossref.py:30 y 47, y openalex.py:67 y 73. Hoy es latente: las consultas actuales funcionan (hay 16 detalles recientes con puntuación). Nota ajena al hallazgo: durante la revisión apareció modificado frontend/src/pantallas/Desbloqueo.tsx (14:47). No lo toqué. Solo hice lecturas, scripts en memoria o sobre una copia del estado en el scratchpad, GET públicos y tests con -p no:cacheprovider.

## [CONFIRMADO · media · fallo] El presupuesto por paso que fija la persona en el plan no cambia el tope que aplica el bucle

`rosa/estado/acciones.py:207`

**Qué pasa.** El tope de la iteración (presupuesto.limite) se calcula una sola vez, al proponer el plan: max(suma de pasos, 20) más la reserva del cierre (corrida.py:1844). editar_plan (acciones.py:200-208) y editarPlan (acciones.ts:225-231) solo sustituyen el plan. El bucle solo aplica it.presupuesto.limite (corrida.py:1880) y nada lee el presupuesto de cada paso.

**Escenario.** El editor dice 'fija el presupuesto de cada uno' (PlanEnVivo.tsx:131) y muestra 'hasta N llamadas' en cada paso (:219). La persona baja dos pasos de 150 a 10 llamadas para gastar menos y aprueba el plan. El bucle puede gastar igualmente hasta 340 llamadas, y con gastar_grande en 'actuar' ni siquiera pregunta. Al revés, si sube los pasos, la corrida se pausa por presupuesto antes de lo que la persona planeó.

**Evidencia.** Prueba: un plan de 150 + 150 llamadas con reserva de 40 da un tope de 340. editar_plan con 10 llamadas por paso devuelve True, los pasos quedan en [10, 10] y el tope sigue en 340. El único sitio del bucle que lee el presupuesto por paso es corrida.py:1844.

**Propuesta.** Al editar el plan, en los dos lados, recalcular it.presupuesto.limite = max(suma, 20) + reservaCierre con la misma fórmula que corrida.py:1844, sin bajar de lo ya usado. La alternativa es aplicar un tope por paso en el bucle. Añadir un test de paridad.

**Escéptico.** El tope de la iteración solo se calcula en corrida.py:1844. editar_plan (acciones.py:200-208), aprobar_plan y editarPlan (acciones.ts:225-231) no lo tocan. presupuesto_ok solo mira presupuesto.limite, y el grep muestra que nada más lee p['presupuesto']. PlanEnVivo.tsx:131 promete 'fija el presupuesto de cada uno' y en :219 enseña 'hasta N llamadas'. Lo dejo en media porque el tope de la corrida (limiteLlamadas) sigue cortando. No está documentado en TRASPASO ni en PENDIENTE.

## [CONFIRMADO · media · ineficiencia] S-17 está peor de lo documentado: el estado pesa 31 MB, cada versión empuja 16 MB y el cerrojo congela el servidor

`rosa/estado/almacen.py:285`

**Qué pasa.** REVISION-BUGS-2026-09-17 (S-17) hablaba de 17 MB con las claves privadas y 10 MB de instantánea. Seis días después son 31,1 MB y 15,9 MB (+83 % y +59 %). En el primer corte faltan dos partes: el reloj y el contador todavía mutan. Además, mientras el cerrojo del almacén está tomado para leer, el mutar del bucle espera en el mismo bucle de eventos que uvicorn (main.py:118-156), así que todo el servidor se congela durante esa espera.

**Escenario.** Con una corrida en marcha, cada llamada al modelo y cada tick serializan el estado entero: _serializar tarda unos 130 ms dentro del cerrojo. Cada versión reconstruye una instantánea de unos 120 ms y la manda sin comprimir por SSE a cada pestaña (GZip no se aplica a text/event-stream). El espejo de Convex, que está activo en .env, tiene el cerrojo 144-176 ms en cada sincronización (entidades_de, cada ~4 s), y GET /api/investigaciones/{id}/mapa lo tiene 75-744 ms. Durante esos intervalos no responde ninguna petición ni sale ningún SSE.

**Evidencia.** Medido leyendo rosa.db en solo lectura: estado de 31.138.665 bytes (versión 28080), instantánea pública de 15.945.431 bytes y 14,66 MB privados en corridas. corridas.busqueda ocupa 4,07 MB públicos (el documento hablaba de 2,1 MB sin ningún lector). 2.659 escrituras en 24 h; en 7 días, llamada_modelo 6.255 y tick 5.045 de 17.453 (65 %). A 15,9 MB por versión, una pestaña abierta todo el día recibiría hasta ~42 GB. Los comentarios de almacen.py:318 y servidor.py:191 siguen diciendo 10 MB.

**Propuesta.** Terminar el primer corte: contador y reloj en memoria. Guardar solo las claves que cambian (_serializar ya calcula cambiaron), por ejemplo en una fila por clave de primer nivel. Sacar _fuentes y _afirmaciones de las corridas terminadas a una tabla aparte. Tomar la copia del espejo y del mapa por versión, sin retener el cerrojo durante el cálculo, y ejecutar mutar fuera del hilo del bucle de eventos. Actualizar las cifras de S-17.

**Escéptico.** Medido en solo lectura: el estado pesa 31.138.665 bytes (versión 28133), la instantánea pública 15.945.242 bytes, las claves privadas de las corridas 14,66 MB y busqueda 3,94 MB en formato compacto. Sobre una copia: _serializar tarda 134-139 ms, la instantánea 151-170 ms, entidades_de del espejo 170-239 ms y el mapa 76-931 ms. En el registro hay 2.656 filas en 24 h; en 7 días, llamada_modelo suma 6.255 y tick 5.100 de 17.505. El espejo está activo (.env tiene CONVEX_URL y CONVEX_DEPLOY_KEY con valor) y toma almacen._lock dentro de to_thread. El supervisor y uvicorn comparten el bucle de eventos (main.py). Ctx.mutar llama a almacen.mutar en ese hilo y el tic toma el cerrojo cada 2 s aunque no escriba, así que mientras otro hilo tiene el cerrojo el bucle entero espera. La GZipMiddleware de Starlette 1.6 excluye text/event-stream. Un matiz: el reloj ya no escribe en cada tic sino cada 30 s (RELOJ_VOLCADO_MS); el contador sí sigue mutando en cada llamada. La congelación la deduzco del código y de los tiempos medidos; no la medí en el servidor vivo. Es S-17 agravado; S-17 está en REVISION-BUGS, no en TRASPASO.

## [CONFIRMADO · media · fallo] Un reductor que escribe y luego devuelve False deja el cambio en memoria, y lo guarda y lo firma la mutación siguiente

`rosa/estado/almacen.py:353`

**Qué pasa.** Cuando el reductor devuelve False, mutar no guarda, no avisa y tampoco deshace. Varios reductores escriben antes de devolver False. asignar_experimento (1256-1258), promover_aprendizaje (964-967) y abrir_cuestion (1037-1039) añaden un evento de incidencia. cambiar_estado_area (775-786) cambia el estado y el historial del área antes de rechazar una corrida de otra investigación.

**Escenario.** La persona pulsa 'Asignar a laboratorio' sin criterios. El servidor responde ok:false y la interfaz muestra el aviso genérico 'la regla no se cumplía (otro cambio llegó antes)'. Al resincronizar recibe la instantánea en caché, que no trae el evento con el motivo real. Ese evento aparece después, cuando lo guarda una mutación ajena como 'tick' o 'llamada_modelo', con actor None en la cadena de hashes. Si antes falla otro reductor, la recarga lo borra. En cambiarEstadoArea el problema es un cambio de estado real que se confirma después de haberlo rechazado.

**Evidencia.** Prueba en una base temporal: cambiarEstadoArea con 'elegida' y una corrida inexistente devuelve False y la versión no cambia. En memoria el área está 'elegida' con historial firmado 'medica@x'; en disco sigue 'propuesta'. Tras una mutación 'tick', el disco dice 'elegida' y la última fila es ('tick', '{"cambiaron": ["investigaciones", "ultimaVisita"]}', None). asignarExperimento sin criterios devuelve False con un evento más en memoria y la misma versión.

**Propuesta.** Cuando el reductor devuelva False, comprobar con el diff de _serializar si cambió algo. Si cambió, deshacerlo, o guardarlo con su propia fila y su actor. Arreglar los cuatro reductores para que devuelvan el motivo (y el evento se guarde) en vez de escribir y devolver False, y hacer que la interfaz muestre ese motivo.

**Escéptico.** Lo reproduje en una base temporal. cambiarEstadoArea con 'elegida' y una corrida inexistente devuelve False y la versión sigue en 2; en memoria el área queda 'elegida' con historial firmado y en disco sigue 'propuesta'. Tras un 'tick', el disco dice 'elegida' y la última fila es ('tick', '{"cambiaron": ["investigaciones", "ultimaVisita"]}', None). mutar (almacen.py:353-354) devuelve False sin deshacer nada. Bajo la severidad a baja porque el único caso que confirma un cambio de estado rechazado, estado más una corrida ajena, no se puede producir desde la interfaz: los controles de Rosa2018.tsx:1694-1712 mandan estado sin corrida o corrida sin estado, y con estado None no se escribe nada antes del return False. Los casos que sí se alcanzan (asignarExperimento sin criterios, promoverAprendizaje cuando la evaluación empeora, abrirCuestion con el tope lleno) solo dejan un evento de incidencia que se guarda tarde, en una fila ajena y sin actor, además del aviso genérico que engaña. Un barrido AST de acciones.py no encontró más reductores que escriban algo relevante antes de devolver False: los otros avisos eran bucles o setdefault de claves que las migraciones ya crean.

## [CONFIRMADO · media · fallo] Volver a una iteración anterior borra hechos que ya existían en ese punto

`rosa/estado/acciones.py:331`

**Qué pasa.** La poda del modelo de mundo borra todo hecho con actualizadoEn posterior al punto de vuelta cuyo historial sea entero de ROSA. Se fija en la última actualización, no en la creación, así que también borra hechos creados antes del punto que ROSA tocó después, por ejemplo con la fusión de duplicados que hace la carga. acciones.ts:315 aplica la misma regla. En cambio, CU.podar_desde, en la misma operación, distingue las cuestiones creadas antes y solo revierte sus movimientos posteriores.

**Escenario.** En los datos reales, 'Volver a la iteración 2 (mundo)' de la corrida 13, o a la 1 de la corrida 16, borraría el hecho 'sabido' he-mu7betsx-7535, que existía en ese punto y citan hip-mu2tskgf-2920 e hip-mu2uqqzu-5871. Las dos hipótesis se quedarían apuntando a un hecho que ya no existe.

**Evidencia.** Lectura en solo lectura: he-mu7betsx-7535 se creó el 18-09 a las 14:51 ('Añadido en la iteración 2', Rosa) y el 22-09 a las 14:52 lo tocó la migración de hechos repetidos ('Fundido ...', Rosa). Su actualizadoEn, 1790103169745, es posterior a los dos puntos de vuelta (1789758733246 y 1790087240209).

**Propuesta.** Borrar solo los hechos creados después del límite (historial[0].fecha), y en los anteriores deshacer los movimientos posteriores que haya hecho solo ROSA, con la misma regla que CU.podar_desde. Aplicarlo en acciones.py y en acciones.ts, con un test de paridad.

**Escéptico.** acciones.py:331 y acciones.ts:315 filtran por actualizadoEn > terminadaEn y por historial entero de 'Rosa', sin mirar cuándo se creó el hecho. CU.podar_desde, en cambio, sí distingue las cuestiones creadas antes del punto. En el estado real, he-mu7betsx-7535 ('sabido', inv-mu2sz2ns-3) tiene dos entradas de historial de Rosa, 18-09 14:51 'Añadido en la iteración 2' y 22-09 14:52 'Fundido...', y actualizadoEn 1790103169745. Se borraría al volver (mundo) a las iteraciones 2 o 3 de la corrida 13, a la 1 de la 14 o a la 1 de la 16, aunque en todos esos puntos ya existía. Lo citan hip-mu2tskgf-2920 e hip-mu2uqqzu-5871, pero solo en 'ruta' (un campo derivado que se recalcula al concluir) y en vistas de la investigación, no en su evidencia. Hoy es el único hecho afectado en cada uno de esos puntos. El botón existe en Corrida.tsx:681.

## [CONFIRMADO · media · fallo] «La diana no resuelve a un gen» cuando MyGene no respondió o cuando el registro es de un código viejo, y nunca se reintenta

`rosa/killer.py:170`

**Qué pasa.** El Killer da `identificadores_resuelven` en «falla» (y suspende) cuando existe `consultadoEn` y no hay Ensembl, sin mirar si la consulta tuvo error. `contexto_al_dia` (pasos.py:4017) da por al día cualquier contexto sin Ensembl, así que un corte de MyGene, o un registro hecho con la extracción de candidatos anterior al 14 de septiembre, queda en falla para siempre. Incumple «una fuente que no responde es no pude comprobar».

**Escenario.** hip-mtxfoq5o-16 está suspendida desde el 18 de septiembre por «'Dependencia de dosis de APOE ε4...' no resuelve a un gen humano: la diana es un proceso, un texto libre o un símbolo mal escrito». Su contextoBases es del 11 de septiembre, sin clave `candidatos` (código anterior a fe7547f). Con el código de hoy, los candidatos son ['APOE', 'GFAP', 'NEFL'], y MyGene resolvió APOE para esta misma hipótesis el 17 de septiembre. Es la única comprobación que la suspende: con ella en «pasa», `decidir` da «avanzar».

**Evidencia.** Consulta del 17-09 16:51: mygene_gen {'simbolo': 'APOE'} n=1, invariante 'un único gen con Ensembl'. contexto_al_dia(h) = True. Test de caza con MyGene caído: «KILLER: suspender | identificadores: falla 'APOE' no resuelve a un gen humano...», consultas con error «No pude comprobar: tiempo agotado», y contexto_al_dia devuelve True.

**Propuesta.** En `contexto_de_bases`: si todas las consultas mygene_gen traen `error`, guardar el fallo y no `consultadoEn`. En killer.py: «falla» solo si MyGene contestó sin Ensembl para todos los candidatos; si no, «no_comprobable». `contexto_al_dia` debe devolver False para registros sin `candidatos` o con fallo. Ojo: al arreglarlo, hip-mtxfoq5o-16 avanzaría con la novedad hueca del hallazgo anterior.

**Escéptico.** killer.py:168-170 da falla si hay consultadoEn y no hay Ensembl, sin mirar si la consulta tuvo error. _consultar (conectores/base.py) devuelve el registro con error y datos None, y contexto_de_bases escribe consultadoEn igual. contexto_al_dia (pasos.py:4001-4016) da True cuando no hay Ensembl ni perfil. Lo reproduje en el scratchpad con conectores caídos: sale «'APOE' no resuelve a un gen humano ... la diana es un proceso», con errores «No pude comprobar: tiempo agotado», y contexto_al_dia da True. Estado: hip-mtxfoq5o-16 tiene contextoBases del 11-09 sin candidatos, y la consulta de MyGene para APOE del 17-09 dio n=1 con la invariante bien. Si recalculo decidir con identificadores en pasa, sale avanzar. No hay acción ni migración que rehaga contextoBases dentro de la misma versión. Dos matices. La novedad de esa hipótesis no parece hueca (ver el hallazgo de S-02). Y identificadores_resuelven no está en CRITICAS: si se deja en no_comprobable, no suspende.

## [CONFIRMADO · media · fallo] `fusionar` deja que el juez decida `sesgo_evidencia` de memoria, y lo usa para la indirección

`rosa/killer.py:265`

**Qué pasa.** sesgo.py existe para que el veredicto de sesgo lo ponga el instrumento y no un juicio libre. Pero cuando la regla da «no_comprobable» (ninguna fuente evaluada, por ejemplo porque todas son tipoEstudio «otro»), `fusionar` sustituye esa comprobación por lo que diga el juez, porque `sesgo_evidencia` no está entre las protegidas. El juez escribe «falla» por motivos que son indirección (otra población), no riesgo de sesgo, y como `sesgo_evidencia` suspende, la hipótesis queda suspendida.

**Escenario.** Hoy (11:39 y 11:48), hip-mtwztiwr-154 y hip-mtx4tbe3-122 tienen `sesgo_evidencia` «falla»: «Toda la evidencia citada procede de cohortes autosómicas dominantes y se aplica a Alzheimer esporádico». La regla daba «Ninguna fuente primaria tiene todavía riesgo de sesgo evaluado por instrumento». Otras hipótesis reciben un «pasa» libre (hip-mtvuvbm2-10, hip-mtxfoq5o-16) sin ninguna fuente evaluada.

**Evidencia.** En 39 de 78 decisiones, el resultado de sesgo_evidencia no es de la regla: 17 falla, 12 pasa y 10 no_comprobable. SESGO.comprobacion_sesgo(fuentes) para esas dos hipótesis devuelve no_comprobable. Sus fuentes (Johansson 2023, Belder 2026, Bateman 2012 de DIAN) tienen tipoEstudio «otro», y `instrumento_para('otro')` devuelve None.

**Propuesta.** Tratar `sesgo_evidencia` como `novedad` en `fusionar`: el juez no convierte un «no_comprobable» de la regla en pasa o falla; su texto va a la nota y al factor GRADE que corresponda (evidencia_indirecta). Aparte: clasificar mejor el diseño, porque una cohorte como DIAN no debería quedarse en «otro» sin instrumento.

**Escéptico.** fusionar (killer.py:218-266) solo protege DISCREPABLES, identificadores y novedad. Si la regla deja sesgo_evidencia en no_comprobable, lo sustituye lo que diga el juez. La firma MatarHipotesis incluso se lo pide al juez, pero INVESTIGACION-AI-SCIENTIST (H05) y la cabecera de sesgo.py dicen que sesgo_evidencia sale del instrumento. Estado: con las fuentes de hip-mtwztiwr-154 e hip-mtx4tbe3-122 (todas tipoEstudio otro, sin riesgoSesgo), comprobacion_sesgo da no_comprobable, y la decisión guardada dice falla por «cohortes autosómicas dominantes... Alzheimer esporádico», que es indirección. En mi recuento, 40 de 78 resultados no vienen de la regla: 17 falla, 12 pasa y 11 no_comprobable. Hoy esas dos seguirían suspendidas igual por la novedad no comprobada. Pero, recalculando con la regla actual, ese falla del juez fue lo único que suspendió a hip-mu2zz5y8-2440 (15-09) y a hip-mu2tgh7o-1740 (17-09, con el texto «Toda la evidencia aportada es indirecta»).

## [CONFIRMADO · media · ineficiencia] «Reformular» pasa por delante de «no evaluable»: se gastan las reformulaciones y a la tercera versión se descarta

`rosa/killer.py:282`

**Qué pasa.** `decidir` resuelve las comprobaciones reformulables antes que las que suspenden y que las críticas no comprobables. Si la fidelidad o la novedad no se pueden evaluar, o el sesgo falla, igualmente se paga una reformulación (cerebro y otro Killer). Reescribir no arregla ni la fidelidad ni el sesgo. Al agotar las dos reformulaciones, `decidir` descarta por «Agotó las reformulaciones». Esto choca con la regla del propio módulo: «suspender si una comprobación crítica quedó sin poder comprobarse».

**Escenario.** Las 5 decisiones «reformular» del estado se tomaron con una comprobación crítica «no_comprobable» o una que suspende en «falla». En hip-mtvulxbg-140 y hip-mu35joen-2494 las dos reformulaciones se gastaron con fidelidad_evidencia «no_comprobable», y la v3 terminó en propuesta de descarte. hip-mtvwd0tn-66 (hoy 11:32) iba a reformular por factibilidad con la novedad «no_comprobable» y el sesgo en «falla»; la salvó la auditoría, que solo muestrea el 34 %.

**Evidencia.** killer.py:275-289: primero `fallan_descarte`, luego `if fallan_reform:` (reformular o descartar), y después `fallan_suspenden` y `no_comp`. Recuento en el estado: reformular con bloqueantes a la vez = 5 de 5.

**Propuesta.** Orden: descartar, luego suspender (críticas no comprobables y SUSPENDEN), luego reformular. O, como mínimo, no reformular mientras `fidelidad_evidencia`, `citas_reales` o `supuestos` estén en no_comprobable, porque reescribir no los cambia.

**Escéptico.** killer.py:275-289 resuelve fallan_reform antes que fallan_suspenden y no_comp, y ningún test fija esa precedencia. Las 5 decisiones reformular del estado tenían a la vez una comprobación crítica en no_comprobable (fidelidad o novedad), y dos de ellas además el sesgo en falla. hip-mtvwd0tn-66: reformular hoy a las 11:32 y suspender por killer_2 a las 11:33, tras la auditoría. Bajo la severidad por cuatro motivos. La reformulación atiende una comprobación que sí falla (la novedad). En la 140 y la 2494 el descarte final viene sobre todo de la novedad caducada del hallazgo de las dos propuestas de descarte. Suspender primero las dejaría atascadas por la cifra, que no tiene salida (hallazgo de las paráfrasis numéricas). Y descartar sigue pidiendo a una persona, porque la autonomía está en preguntar. CLAUDE.md dice que el coste por token no es criterio.

## [CONFIRMADO · media · fallo] La comprobación de cifras suspende por paráfrasis numéricas y no deja salida

`rosa/killer.py:115`

**Qué pasa.** `cifras_fuera_del_pasaje` solo reconoce números escritos con dígitos. «about a quarter» contra «25 %» y «Seventy-six weeks» contra «76 semanas» dan fidelidad «no_comprobable», que es crítica y suspende. `fusionar` ignora al juez aunque diga «pasa» (conjunto `sospechosas`) y la interfaz no tiene ninguna acción para confirmar la cifra, así que la suspensión se repite en cada pase.

**Escenario.** hip-mu2zz5y8-2440 está suspendida desde el 18 de septiembre solo por esto: la afirmación dice «regresaron cerca de un 25 %» y el pasaje «crept back up by about a quarter». Con la fidelidad en «pasa», `decidir` da «avanzar». hip-mu35joen-2494 también tiene la fidelidad «no_comprobable» por «76 semanas» / «Seventy-six weeks».

**Evidencia.** Detalle guardado: «1 afirmaciones con cifras que no están en su pasaje: '...' (25) | El juez dice que pasa, pero la regla no pudo confirmarlo: se mantiene sin comprobar.» Recálculo con fidelidad en pasa: avanzar. grep en frontend/src: nada resuelve esta bandera.

**Propuesta.** Normalizar los números escritos con palabras y las fracciones comunes (quarter, half, third, two-fold, seventy-six) antes de comparar. Marcar las cifras derivadas por aritmética de las del pasaje (por ejemplo 38,7 − 26,1 = 12,6) como «derivada», no como ausente. Añadir en la ficha una acción de persona «la cifra es fiel» que cierre la comprobación con su nombre.

**Escéptico.** cifras_fuera_del_pasaje (killer.py:499-524) solo compara dígitos. Estado: «cerca de un 25%» frente a «by about a quarter» (hip-mu2zz5y8-2440) y «76 semanas» frente a «Seventy-six weeks» (hip-mu35joen-2494) dejan la fidelidad en no_comprobable, con la nota «El juez dice que pasa, pero la regla no pudo confirmarlo». Con la fidelidad en pasa, decidir da avanzar para la 2440, suspendida desde el 18-09 a las 14:58. etiquetarComprobacion existe en la interfaz, pero solo escribe en conjuntoDorado y no cambia el Killer. Matiz: la persona sí puede aceptar la hipótesis entera con revisar_hipotesis, así que salida hay, aunque no una proporcionada para una sola cifra.

## [CONFIRMADO · media · fallo] Las comprobaciones de dirección y unidades no han corrido nunca y el detalle dice algo falso

`rosa/killer.py:457`

**Qué pasa.** `consistencia_medidas` filtra las afirmaciones por `bio in texto`, donde `bio` es `comprobacion.biomarcador` entero: un texto libre de 214 a 757 caracteres que ninguna afirmación contiene. `direccion_evidencia` (que es reformulable) y `unidades` salen «no_aplica» siempre, con el detalle «Sin afirmaciones sostenidas con dirección sobre el biomarcador». Es ausencia leída como negación en la salida del propio Killer.

**Escenario.** hip-mu2tgh7o-1740 tiene 8 afirmaciones sostenidas con dirección sobre GFAP y el Killer dice que no hay ninguna. Con una clave corta (GFAP, P-tau181), la regla daría «falla» en 6 de 18 hipótesis (por ejemplo hip-mtx08plv-390: «El enunciado dice que gfap baja y todas las afirmaciones sostenidas dicen que sube»). Alguna puede ser un falso positivo de la heurística de palabras.

**Evidencia.** Recuento en las 78 decisiones: ('direccion_evidencia', 'no_aplica') 76 y ('unidades', 'no_aplica') 76. Longitud de biomarcador: 214 a 757 caracteres; 'relevantes' = 0 en las 28 hipótesis.

**Propuesta.** Sacar la clave del biomarcador con `simbolos_de_genes` y las entidades de la tarjeta, no con el texto libre. Si no sale ninguna, devolver «no_comprobable: no pude identificar el biomarcador», nunca «no_aplica». Antes de activarla (reformula), calibrar `_SUBE` y `_BAJA` con esos 6 casos: «reducción» como nombre de tratamiento, «mayor» dentro de «mayoría», «superior» o «inferior» anatómicos.

**Escéptico.** consistencia_medidas (killer.py:450-480) filtra por bio, que es comprobacion.biomarcador entero. En el estado ese texto mide entre 214 y 757 caracteres, y relevantes queda vacío en las 28 hipótesis. En las 78 decisiones, direccion_evidencia sale no_aplica 76 veces y unidades otras 76; las 2 restantes no traen esas comprobaciones. El detalle «Sin afirmaciones sostenidas con dirección sobre el biomarcador» es falso donde sí hay afirmaciones sobre GFAP con dirección. Con una clave corta (GFAP o P-tau181 del título), la regla daría falla en 6 hipótesis; algunas serían probablemente falsos positivos de _SUBE y _BAJA, como advierte el hallazgo. No está documentado como limitación.

## [CONFIRMADO · media · fallo] ROBINS-I: responder «sí, hay potencial de confusión» basta para dar riesgo alto, aunque el estudio ajustara

`rosa/sesgo.py:62`

**Qué pasa.** La pregunta 1.1 («Is there potential for confounding...?») está marcada `riesgoSi=True`. En `juzgar_dominio`, una Y segura suma 1,5 y el dominio queda «alto». En ROBINS-I, 1.1 es la pregunta de entrada: un sí lleva a 1.2 y 1.3, no a riesgo alto. Como casi todo estudio observacional tiene potencial de confusión, D1 sale «alto», `juicio_util` da «alto» y el peso GRADE baja a 0,5.

**Escenario.** O'Connor et al., 2022: 1.1=Y, 1.2=PY (ajustó por edad y sexo) y 1.3=PY (medidas válidas), y D1 sale «alto». Yakoub 2023 y Biel 2025 tienen riesgo global «alto» solo por D1 con 1.1=Y. Con 1.1 tratada como pregunta de entrada, el peso a favor de hip-mtvulxbp-150 pasa de 4,5 a 5,4 y el de hip-mtvulxbg-140 de 4,75 a 5,35. Hoy ningún nivel cambia, porque manda la estructura.

**Evidencia.** Fuente privada f-mu2u6wsm-4085, respuestas de D1: 1.1 Y, 1.2 PY, 1.3 PY; motivo «respuestas en el sentido del riesgo: 1.1=Y (seguro)». Hay 6 dominios D1 en «alto» con ese mismo motivo exacto.

**Propuesta.** Tratar 1.1 como pregunta de entrada: con N o PN, D1 es «bajo»; con Y o PY, deciden 1.2 y 1.3. Revisar igual las preguntas de conocimiento de la asignación de RoB 2 (2.1 y 2.2), que en el algoritmo oficial dependen de 2.3 a 2.5. Rehacer por regla las evaluaciones guardadas: las respuestas están en las copias privadas.

**Escéptico.** sesgo.py:62 marca la pregunta 1.1 («Is there potential for confounding...») con riesgoSi=True, y juzgar_dominio suma 1,5 por una Y segura, así que el dominio sale alto. En ROBINS-I (2016) esa pregunta es de entrada: N o PN da bajo; Y o PY lleva a 1.2 y 1.3. En la V2 no es una pregunta de riesgo. La docstring habla de una versión conservadora, pero el diseño (H05) dice que el veredicto sale del algoritmo. Estado: O'Connor 2022, con 1.1=Y, 1.2=PY y 1.3=PY, da D1 alto, y hay 6 D1 en alto con el motivo exacto «1.1=Y (seguro)» (Yakoub, Xie tres veces, Biel y O'Connor). Matiz: O'Connor y las copias de Xie siguen en alto por D2 o D3, así que las suspensiones del Killer por sesgo que hay hoy no cambian. Yakoub y una copia de Biel sí pasarían a sin evaluar o a algunas dudas.

## [CONFIRMADO · media · fallo] Certeza y dirección mezcladas: una hipótesis contradicha por evidencia sólida sale «muy incierta», igual que una sin nada

`rosa/certeza.py:888`

**Qué pasa.** El techo mide la certeza de que la hipótesis se sostiene, no la de la dirección que se concluye. Con dirección «en_contra» (contras sin apoyos, o que pesan más), el techo es siempre muy baja. `VERBO_CONTRA['muy_baja']` es idéntico a `VERBO_CERTEZA['muy_baja']`, así que la frase no se distingue de «a favor». La escalera pide «resolver la evidencia en contra» para subir. GRADE separa la certeza de la dirección: tres ensayos con bajo riesgo de sesgo que no ven efecto dan certeza alta de que no lo hay.

**Escenario.** Tres afirmaciones sostenidas «contradice», de ADNI, A4 y BIOCARD, con riesgo de sesgo bajo y n de 400 a 1.700, sin apoyos. Resultado: techo muy_baja, frase «La evidencia es muy incierta sobre si la reducción de GFAP predice beneficio clínico» (la misma que con dirección «apoya»), y escalera que pide «una segunda cohorte independiente» (ya hay tres) y «resolver la evidencia en contra».

**Evidencia.** Salida reproducida: techo ('muy_baja', 'la evidencia en contra pesa tanto o más que la a favor (a favor 0, en contra 3)'). frase_plantilla('en_contra', 'muy_baja', t) == frase_plantilla('apoya', 'muy_baja', t). `acotar` (certeza.py:904) no recibe la dirección. En el estado de hoy no hay ninguna conclusión «en_contra».

**Propuesta.** Pasar la dirección a `acotar`, `techo` y `escalera`. Con «en_contra», calcular estructura y peso sobre las contras (cohortes, diseño, sesgo) y tratar los apoyos como la inconsistencia. Frase propia para «en_contra» en muy baja, y una escalera que pida réplica de la evidencia en contra, no «resolverla».

**Escéptico.** Lo reproduje con una hipótesis de prueba con 3 afirmaciones que la contradicen (ADNI, A4, BIOCARD, riesgo de sesgo bajo). El techo sale muy_baja con el motivo «la evidencia en contra pesa tanto o más». frase_plantilla('en_contra', 'muy_baja') es idéntica a la de 'apoya'. Y la escalera pide «una segunda cohorte independiente» y «resolver la evidencia en contra». acotar y techo no reciben la dirección. La regla está en la docstring de certeza.py («en contra pesa: muy baja»), pero choca con los dos ejes separados de INVESTIGACION-CONCLUSIONES y con la regla de CLAUDE.md. Además, VERBO_CONTRA tiene frases para alta, moderada y baja a las que, sin apoyos, la regla nunca deja llegar. Es latente: hoy no hay ninguna conclusión en_contra, y solo hip-mu35joen-2494 tiene algo de peso en contra (0,5 frente a 8,26).

## [CONFIRMADO · media · fallo] Sin presupuesto, las peticiones de la persona se consumen como si el modelo hubiera fallado

`rosa/bucle/corrida.py:1447`

**Qué pasa.** `_replicar_paso` deja pasar ModeloSinRespuesta, pero PresupuestoAgotado es un RuntimeError y cae en `except Exception`: la trayectoria se cuenta como hecha y "no comprobable" (1484-1486). Pasa lo mismo en `_responder_comentarios` (1387-1388) y `_aclarar` (1374-1376), donde la petición se cierra diciendo "el modelo no respondió". El análisis pedido (646-649) y la reproducción (662-665) también consumen la petición.

**Escenario.** Hoy la corrida 16 está pausada por presupuesto y la de GFAP tiene el tope de una iteración muerta. Si la persona lanza "replicar x3" sobre una hipótesis de esas investigaciones, en tres vueltas del supervisor (unos 6 s) la réplica aparece terminada: "0 de 3 trayectorias sostienen las afirmaciones, 0 las contradicen y 3 no se pudieron comprobar", sin una sola llamada al juez. Si deja un comentario, recibe "No pude responder ahora: el modelo no respondió (Presupuesto ... agotado)" y la marca se quita, así que al ampliar el presupuesto nadie le contesta.

**Evidencia.** Tests `test_replica_sin_presupuesto_consume_las_trayectorias` (3 trayectorias hechas, 3 no comprobables, 0 llamadas) y `test_comentario_con_corrida_pausada_por_presupuesto_se_da_por_respondido`. El comentario de las líneas 1441-1446 dice que este hueco se cerró para ModeloSinRespuesta; para el presupuesto sigue abierto.

**Propuesta.** `except PresupuestoAgotado: raise` sin consumir la trayectoria ni la marca en `_replicar_paso`, `_responder_comentarios`, `_aclarar`, el análisis y la reproducción. En `_atender_peticiones`, comprobar el tope antes de lanzar cualquiera de ellas y dejar el aviso "espera a que amplíes el presupuesto".

**Escéptico.** PresupuestoAgotado hereda de RuntimeError (contador.py:27). En _replicar_paso (corrida.py:1441) solo se relanza ModeloSinRespuesta. verificar_afirmaciones relanza el PresupuestoAgotado (pasos.py:2050-2051), que cae en el except Exception; la trayectoria suma hechas y noComprobables (corrida.py:1484). _atender_peticiones (587-591) no mira el presupuesto antes de aclarar, responder comentarios ni replicar: solo lo hace la revisión pedida (601). _responder_comentarios (1387-1388) y _aclarar (1374-1376) cierran la petición con 'el modelo no respondió (Presupuesto ... agotado)' y quitan la marca. El análisis pedido (646-649) quita _analisisPedido y la reproducción (662-665) pasa a error técnico. replicar_hipotesis (acciones.py:1196) no comprueba el presupuesto al lanzarla. Ejecuté los dos tests del cazador aislados. Réplica: 3 trayectorias hechas, 3 no comprobables y 0 llamadas; el mensaje final no nombra el presupuesto. Comentario: queda respondido con el texto de fallo y la marca desaparece. Atenúa un poco que en comentarios y análisis la causa real sale entre paréntesis.

## [CONFIRMADO · media · fallo] El tiempo con el servidor apagado se cuenta como trabajo de la corrida

`rosa/bucle/corrida.py:497`

**Qué pasa.** Al arrancar, el reloj en memoria de cada corrida empieza con `_ultimoTic: None` (497) y el primer tic no cuenta el hueco (3653-3656). Como `tiempo_trabajo_ms` es el reloj de pared menos la espera humana y las pausas (3645), todo el tiempo con el proceso parado cuenta como trabajo, también el de una corrida pausada o esperando a una persona.

**Escenario.** La corrida 16 está pausada por presupuesto, lleva 2,17 h de trabajo y tiene una parada propia de 4 h. Si el Mac se apaga o el servidor cae y vuelve 2 h después, al ampliar el presupuesto `_condicion_de_parada` (1629) da "Se cumplió el tiempo fijado para esta corrida (4 horas)": se omiten los 4 pasos pendientes, se paga el cierre y la corrida termina sin haber trabajado ese tiempo.

**Evidencia.** Estado real de la corrida 16, pausada por presupuesto todo el rato: gasto.segundos era 7491 en la versión 28070 (14:01:52) y 7800 en la 28093 (14:17:10), 309 s más, justo el hueco del reinicio entre las 14:01:52 y las 14:07:00. Los tres reinicios de hoy dejaron huecos de 5,1 a 5,2 min. Test `test_el_apagado_cuenta_como_trabajo_y_cierra_la_corrida_al_volver`: 2,17 h más 3 h apagado dan más de 5,1 h de trabajo y el motivo "tiempo fijado".

**Propuesta.** Guardar en la corrida la marca del último volcado del reloj y, en `recuperar_tras_reinicio`, sumar el hueco hasta el arranque a `pausaMs`, porque es tiempo con el proceso parado y no trabajo. También sirve tomar como referencia el `actualizado_en` de la fila del estado.

**Escéptico.** Código: _reloj_en_memoria crea el reloj con _ultimoTic None (corrida.py:497) y contabilizar_tiempo (3653-3656) no cuenta el primer hueco. recuperar_tras_reinicio (149-222) no toca los relojes. tiempo_trabajo_ms (3645) es el reloj de pared menos la espera humana y las pausas. Busqué pausaMs y _ultimoTic en todo el backend y no hay otro sitio que compense. Datos (rosa.db en solo lectura), corrida 16: pausada por presupuesto, pausaMs 0, gasto.segundos 7800 todavía a las 14:55 (no se mueve mientras sigue pausada), parada propia de 4 h y 2,167 h de trabajo. En el registro de acciones está el volcado 'reloj' a las 14:01:52 y el arranque a las 14:06:58, 5,1 min después; los otros reinicios de hoy dejan entre 5,1 y 5,2 min. No pude leer el 7491 de la versión 28070, porque la base solo guarda el estado actual, pero 7800 menos 309 cuadra con ese hueco. El test del cazador pasa: 2,17 h más 3 h apagado dan más de 5,1 h y el cierre 'tiempo fijado'. TRASPASO da por resuelto el reloj con el sueño del Mac (8a4eb64), que cubre el proceso dormido con UMBRAL_SUSPENSION_MS pero no el proceso muerto. Eso no está documentado.

## [CONFIRMADO · media · fallo] Si se detiene la corrida durante el cierre, el cierre la reescribe como terminada y lanza la meta-campaña

`rosa/bucle/corrida.py:2276`

**Qué pasa.** Si se cumple la parada, la mutación final de `_cerrar_iteracion` escribe estado "terminada", el motivoCierre y `_revisarArnes` sin mirar si la persona detuvo la corrida mientras el cierre pagaba a los modelos. `_proponer_plan` sí tiene esa guarda (1848-1853: "la orden de detener manda").

**Escenario.** Es la última iteración de una corrida con parada de "3 iteraciones". La persona pulsa Detener, con su motivo, mientras el cierre rehace las conclusiones con Opus, lo que tarda minutos. Al acabar el cierre, la corrida queda "terminada: Se alcanzaron las 3 iteraciones", el motivo de la persona se pierde y `_revisarArnes` hace que `_atender_peticiones` lance la meta-campaña (el cerebro más hasta 12 llamadas al juez por criterio) sobre una corrida que la persona paró.

**Evidencia.** Test `test_detener_durante_el_cierre_se_pisa_con_terminada_y_meta_campana`: con `detenerCorrida` dentro de la llamada del resumen, la corrida acaba "terminada", con motivoCierre "Se alcanzaron...", sin el "La paro" de la persona y con `_revisarArnes` True. En el estado real no hay casos (revisé los 25 pares de eventos detenida y terminada).

**Propuesta.** En la `fn` final de `_cerrar_iteracion`, si la corrida ya está detenida o terminada, cerrar la iteración sin tocar estado, motivo ni `_revisarArnes`. Con el arreglo del primer hallazgo, además, el cierre no seguiría pagando.

**Escéptico.** La mutación final de _cerrar_iteracion (corrida.py:2276-2286) escribe 'terminada', motivoCierre y _revisarArnes sin mirar si la corrida ya está detenida. _proponer_plan sí tiene esa guarda (1848-1853). El test del cazador pasa: acaba terminada, con el motivo 'Se alcanzaron...' y _revisarArnes True. Solo ocurre cuando terminar no es None, es decir, en el cierre que iba a terminar la corrida de todos modos; si la detienen en un cierre intermedio, se conserva como detenida. Bajo la severidad por tres motivos: la ventana es solo ese cierre final; el evento 'Corrida N detenida: motivo' sigue en el registro de eventos; y lo único que se gasta de más frente a no haber pulsado nada es la meta-campaña. No revisé por mi cuenta los 25 pares de eventos que cita el cazador.

## [CONFIRMADO · media · fallo] Incidencias automáticas que nadie cierra impiden que la corrida siga después de ampliar el presupuesto

`rosa/bucle/corrida.py:3400`

**Qué pasa.** Si queda alguna incidencia pendiente fuera de INCIDENCIAS_QUE_NO_BLOQUEAN (2314), `_pausar_por_presupuesto` pone la corrida en esperando_aprobacion en vez de pausada_por_presupuesto. Nadie cierra `juez_sin_respuesta` (pasos.py:2934), `auditoria_sin_respuesta` (3388) ni `fuente_sin_respuesta` (1557) cuando el problema desaparece, así que se van acumulando. `ampliar_presupuesto` (acciones.py:169) solo reanuda desde pausada_por_presupuesto, y el tic (382-390) no saca a la corrida de esperando_aprobacion mientras quede alguna.

**Escenario.** Una corrida viva tiene una `juez_sin_respuesta` de hace horas; el Killer ya juzgó después. Se agota el presupuesto y la corrida queda "esperando aprobación" con el aviso "Amplía el tope para seguir". La persona amplía y no pasa nada hasta que encuentra y cierra una incidencia que no tiene que ver con el presupuesto.

**Evidencia.** En el estado real hay 3 `juez_sin_respuesta` pendientes desde el 18-09 en las corridas 12 y 13, ya terminadas, y una `modelo_bloqueado` en la 14, detenida: nadie las cierra. Test `test_ampliar_no_reanuda_si_queda_una_incidencia_del_killer_pendiente`: después de pausar, ampliar y dar un tic, la corrida sigue en esperando_aprobacion.

**Propuesta.** Añadir esos tres tipos a INCIDENCIAS_QUE_NO_BLOQUEAN, porque su propio texto dice que ROSA2018 sigue sola, o resolverlos cuando el Killer decide o la fuente vuelve a responder. Que `ampliar_presupuesto` saque la corrida de esperando_aprobacion cuando no haya solicitudes pendientes.

**Escéptico.** Código: INCIDENCIAS_QUE_NO_BLOQUEAN (corrida.py:2314) solo incluye modelo_bloqueado, bucle_reventado y modelo_sin_respuesta. _pausar_por_presupuesto (3399-3401) deja la corrida en esperando_aprobacion si queda otra incidencia pendiente. ampliar_presupuesto (acciones.py:169) solo reanuda desde pausada_por_presupuesto, y el tic (382-390) no la saca mientras quede una. Busqué quién resuelve: solo modelo_sin_respuesta se resuelve sola (acciones.py:123, corrida.py:3305 y 3566, vigilante_modelos.py:872); el resto, a mano con resolverIncidencia. En rosa.db hay 3 juez_sin_respuesta pendientes (corridas 12 y 13) y 3 modelo_bloqueado (12, 13 y 14). juez_sin_respuesta sigue siendo alcanzable con el vigilante: ModeloBloqueado es un RuntimeError aparte (vigilante_modelos.py:136) que _killer convierte en juez_sin_respuesta (pasos.py:3191-3208), como en el par de la corrida 13 a las 15:45. El test del cazador pasa. Hoy es latente: la corrida 16 no tiene incidencias. La pantalla sí enseña la incidencia en 'Algo impide seguir', con su botón de resolver (Corrida.tsx:227, 342 y 740), así que hay salida visible; pero el aviso dice 'Amplía el tope para seguir' y ampliar no basta. resolver_solicitud no tiene el problema.

## [CONFIRMADO · media · fallo] El sesgo de «toda la evidencia» se decide con una de ocho fuentes: el 69 % de las fuentes son «otro» y nunca se evalúan

`rosa/sesgo.py:313`

**Qué pasa.** comprobacion_sesgo falla si todas las fuentes evaluadas tienen riesgo alto, sin mirar cuántas fuentes de la hipótesis se evaluaron de verdad. Solo se evalúan las que tienen instrumento según su tipoEstudio (pasos.py:2957), con un tope de 3 por pasada (pasos.py:2416). tipo_estudio (pubmed.py:107) decide con el PublicationType de PubMed o, si no lo hay (OpenAlex, Exa, Europe PMC), solo con el título. Así 99 de las 143 fuentes de hipótesis quedan como «otro»: sin instrumento y fuera de las primarias (killer.py:141). B-11 lo documenta como gravedad baja («el peso a favor frenado»), pero es peor: decide el veredicto del Killer.

**Escenario.** hip-mu2tskgf-2920 (22/09 14:55) pasa citas, fidelidad, supuestos, independencia de cohortes (4 a 5 cohortes: TRAILBLAZER-ALZ, CLARITY AD, TRAILBLAZER-ALZ 2 y 3), falsabilidad y fuente primaria. Se suspende solo por «Toda la evidencia primaria evaluada (1 fuentes) tiene riesgo de sesgo alto: Raket et al., 2026». De sus 8 fuentes, 6 son «otro», entre ellas Johansson 2023, que es un estudio de cohorte sueco; Raket 2026 aparece dos veces.

**Evidencia.** killer.decidir sobre esas mismas comprobaciones, con el sesgo en no_comprobable, devuelve avanzar. El fallo de sesgo_evidencia es motivo decisivo en 11 de las 26 últimas decisiones del Killer y aparece en 27 de las 49 suspensiones registradas. Tipos de las fuentes de hipótesis: otro 99, cohorte 29, ensayo_aleatorizado 9, revisiones 6.

**Propuesta.** Exigir cobertura: que falle solo si las fuentes evaluadas suman al menos la mitad del peso de apoyo de la hipótesis; si no, que quede no_comprobable con «evaluadas k de n». Clasificar el diseño de las fuentes que no vienen de PubMed con el tipo que da OpenAlex o Europe PMC, o preguntándolo al extractor con cita, y evaluar por hipótesis hasta cubrir la mitad, sin el tope de 3 por pasada. Medir: cobertura de sesgo por hipótesis (hoy 1 de 8 en hip-mu2tskgf-2920) y suspensiones por sesgo con menos del 50 % de cobertura.

**Escéptico.** Código: sesgo.py:313 falla si todas las «informadas» tienen riesgo alto, sin mirar la cobertura; instrumento_para devuelve None para «otro» salvo vocabulario diagnóstico; tope de 3 por pasada en pasos.py:2416; tipo_estudio (pubmed.py:107) solo mira PublicationType y título. Estado: 99 de 143 entradas de fuente (57 de 79 únicas) son «otro». hip-mu2tskgf-2920 tiene 8 fuentes y 6 son «otro» (Johansson 2023, «Plasma biomarker profiles in autosomal dominant Alzheimer's disease», entre ellas); Raket 2026 aparece con dos ids, las dos con riesgo alto. La decisión del 22/09 14:55 suspende solo por sesgo, y con sesgo en no_comprobable decidir devuelve avanzar. 27 de las 49 suspensiones incluyen sesgo_evidencia en falla: confirmado. Exagerado: «motivo decisivo en 11 de las 26 últimas». Sesgo aparece en el motivo de 11, pero es la única causa de suspensión solo en 2, las dos sobre hip-mu2tskgf-2920; en las demás también suspenden supuestos o novedad no_comprobable. B-11 (REVISION-BUGS-2026-09-17.md) lo pone en baja y solo habla del peso; su efecto sobre el veredicto del Killer no está documentado, así que sí es peor de lo que dice. Media es adecuada: hoy cambia el veredicto de una hipótesis.

## [CONFIRMADO · media · ineficiencia] La redundancia por entidades marca el 91 % de los pares y el torneo repite sin fin los partidos forzados

`rosa/bucle/pasos.py:3129`

**Qué pasa.** Dos hipótesis cuentan como redundantes si comparten 2 identificadores canónicos (ontologias.py:191). En una investigación de Alzheimer casi todas comparten «Alzheimer disease» (que además absorbe MCI y «AD») con tau, plasma o amiloide. Como esta comprobación va primero, la búsqueda por significado, que también mira las descartadas, no llega a ejecutarse (pasos.py:3134). redundanteCon guarda las 3 primeras según el orden de la lista, no las más parecidas. En el torneo, los pares redundantes se juegan siempre, saltándose la regla de no repetir sin evidencia nueva (pasos.py:3633), hasta que el juez declare una relación. Pero registrar_partido no guarda la relación «distintas» (torneo.py:167), así que el par se vuelve a forzar en cada iteración.

**Escenario.** En inv-mu2sz2ns-3, hip-mu2tgh7o-1740 contra hip-mu2tskgf-2920 se jugó 9 veces (dos de ellas seguidas con la misma huella de evidencia), y hip-mu2uajpx-4553 contra hip-mu2uqqzu-5871 se jugó 6 veces con el mismo ganador. Desde el 16/09, 25 de los 47 partidos de esa investigación fueron entre pares marcados como redundantes. Esos 47 partidos son 94 llamadas al juez, y salvo una hora del 17/09 ninguna hipótesis de ahí tenía Killer avanzar, así que no podían cambiar las candidatas.

**Evidencia.** 69 de los 76 pares dentro de una misma investigación comparten 2 o más entidades. 0 de las 78 decisiones del Killer registran redundancia «por significado». Los 142 registros de partido de inv-mu2sz2ns-3 no declaran ninguna relación. Simulación con pares_del_torneo y registrar_partido: un par forzado con evidencia idéntica y juez «distintas» se juega en las rondas 1, 2 y 3. El test test_torneo_no_rejuega_un_par_sin_evidencia_nueva_salvo_forzado solo comprueba una repetición.

**Propuesta.** Ponderar las entidades por su rareza dentro de la investigación y excluir las omnipresentes (MONDO:0004975, plasma, LCR). Ejecutar siempre la comparación por significado y ordenar redundanteCon por similitud. Guardar el partido dirimente aunque diga «distintas» (con la relación o con una marca de dirimido junto a las huellas), para que el par forzado se juegue una vez por estado de la evidencia. No jugar torneo en una investigación donde ninguna hipótesis puede llegar a candidata. Medir: fracción de pares marcados como redundantes (hoy 91 %) y partidos forzados repetidos con la misma huella.

**Escéptico.** Código: ontologias.comparten con mínimo 2 (191); en pasos.py:3124-3129 la redundancia por entidades va primero y guarda parecidas[:3] en el orden de la lista; 3134 se salta la búsqueda por significado si ya hay «redundancia»; _torneo fuerza el par hasta que un partido tenga «relacion» (3661), registrar_partido solo la guarda si no es «distintas» (torneo.py:167), y pares_del_torneo exime a los forzados de la regla de evidencia nueva (3633). Estado: 69 de 76 pares dentro de una investigación comparten 2 o más ids (los más repetidos son CHEBI:64645 y MONDO:0004975); 0 de 78 decisiones del Killer con redundancia «Por significado» y 49 con «Comparte entidades»; hip-mu2tgh7o-1740 contra hip-mu2tskgf-2920 jugó 9 partidos, el 7.º y el 8.º con huellas idénticas; 142 registros de partido sin ninguna relación. Simulación con pares_del_torneo y registrar_partido: un par forzado, con la misma evidencia y juez «distintas», se juega en las rondas 1, 2 y 3. Consecuencia extra: el único camino que pone redundancia en falla (repetir una descartada con similitud de 0,95 o más) casi nunca llega a ejecutarse. Cada partido son 2 llamadas al juez. No está documentado.

## [CONFIRMADO · media · fallo] El chip «Evidencia estadística: Moderada» se inventa al nacer: lo llevan 21 de 28 hipótesis, 20 de ellas con certeza GRADE muy baja

`rosa/bucle/pasos.py:3814`

**Qué pasa.** paso_hipotesis pone evidenciaEstadistica="moderada" en cuanto alguna afirmación de apoyo es de tipo «dato», sin que haya ningún análisis estadístico detrás; vivero.py:141 hace lo mismo. La ficha lo muestra como chip de aviso «Moderada» bajo «Evidencia estadística» (Hipotesis.tsx:427-431), junto a una certeza GRADE que la regla deja en muy baja. Contradice la norma de ROSA2018 de no dar grados de confianza sin una regla que los sostenga.

**Escenario.** hip-mu2uajpx-4553 tiene certeza GRADE muy baja y está suspendida, pero su ficha dice «Evidencia estadística: Moderada» porque una de sus 16 afirmaciones es un «dato».

**Evidencia.** Estado: 21 hipótesis con evidenciaEstadistica moderada y 7 con no_aplica. De las 21, 20 tienen conclusion.certeza muy_baja y 1 baja. Solo corrida.py:1232 y analisis.py:459 fijan este campo a partir de un resultado real de laboratorio o de análisis.

**Propuesta.** Que la hipótesis nazca con no_aplica y que el campo solo lo escriban un resultado de laboratorio o un análisis in silico no sintético, como ya hacen corrida.py:1232 y analisis.py:459. Añadir una migración que pase a no_aplica las 21 que no tienen resultado. Medir: hipótesis con evidenciaEstadistica distinta de no_aplica sin una ejecución o un resultado detrás (hoy 21).

**Escéptico.** Código: pasos.py:3814 y vivero.py:141 ponen «moderada» si alguna afirmación es de tipo dato; solo corrida.py:1232 y analisis.py:459 lo fijan a partir de un resultado real; Hipotesis.tsx:428-431 lo pinta como chip de aviso «Moderada». Estado: 21 con moderada y 7 con no_aplica; de las 21, 20 tienen certeza muy_baja y 1 baja, y ninguna tiene resultado de laboratorio ni ejecución detrás. Detalle menor del escenario: hip-mu2uajpx-4553 tiene 11 «dato» de 16, no uno, pero la regla salta con cualquiera. No figura como decisión en la documentación (solo REVISION-BUGS pide no_aplica para lo sintético).

## [CONFIRMADO · media · fallo] Mecanismos y la ficha pintan el estado de los supuestos sin decir que está por reevaluar

`frontend/src/pantallas/Mecanismos.tsx:472`

**Qué pasa.** Solo «Qué desbloquea más» usa vigencia(). El aviso de Mecanismos «Ojo: N de M supuestos de su ficha no sostienen nada» y la sección Supuestos de la ficha (Hipotesis.tsx:615-619) enseñan como actuales los estados guardados, «Contradicho» incluido, aunque se evaluaran con la regla 1, que leía la ausencia como negación.

**Escenario.** hip-mu2zedte-898 y hip-mu31b467-5575 están «en revisión», con el Killer en «descartar en contexto», esperando la decisión de una persona. Sus supuestos se evaluaron con la regla 1 el 15/09, y la reevaluación que se pidió hoy a las 11:00 espera a que la corrida 16 tenga presupuesto. De la 898, Mecanismos dice «Ojo: 7 de 8 supuestos de su ficha no sostienen nada (6 sin evidencia, 1 contradicho)» y enlaza a la ficha. La ficha pinta «Contradicho: El ensayo INVOKE-2 (AL002) publica mediciones de P-tau181 en plasma y en LCR», con la nota «...no a ningún ensayo llamado INVOKE-2 (AL002). Ninguna af...». Es justo el contradicho que TRASPASO (23/09) pone como ejemplo de fallo de la regla 1. Mientras tanto, «Qué desbloquea más» dice de la misma hipótesis «Sus supuestos se evaluaron antes del 18 de septiembre, cuando el evaluador no miraba la evidencia propia...».

**Evidencia.** supuestosDeLaFicha() y vigencia() sobre el estado real: la 898 tiene 7 de 8 supuestos flojos y vigencia con motivo 'regla' y regla 1; la 5575 tiene 8 de 8 y regla 1. Según grep, ni Hipotesis.tsx ni Mecanismos.tsx importan vigencia ni leen supuestosEvaluados. Hoy hay 2 contradichos y 23 sin evidencia evaluados con la regla 1, y 9 y 156 con la regla 2.

**Propuesta.** Reutilizar vigencia() y vigenciaEnLlano() de lib/desbloqueo.ts en el aviso de Mecanismos y en la cabecera de la sección Supuestos de la ficha, y junto al chip del Killer cuando su motivo sale de los supuestos. Por ejemplo: «Evaluados con la regla N el <fecha>: por reevaluar», con pedidaEn o noAtendida si los hay.

**Escéptico.** Según grep, vigencia y supuestosEvaluados solo se usan en Desbloqueo.tsx, lib/desbloqueo.ts y datos/acciones.ts. El aviso de Mecanismos (Mecanismos.tsx:472-484, con supuestosDeLaFicha) y la sección Supuestos de la ficha (Hipotesis.tsx:614-618, ArbolSupuestos en la 186, con chip y evidencia) no dicen nada de la vigencia. En rosa.db, 898 y 5575 están en_revision con el Killer en descartar_en_contexto, sello de la regla 1 del 15/09 y pedidaEn del 23/09 a las 11:00:42. La 898 tiene 8 supuestos: 6 sin evidencia, 1 contradicho y 1 plausible. La 5575 tiene 7 sin evidencia y 1 contradicho. Las dos tienen grafoCausal, así que salen en Mecanismos. La evidencia del contradicho de la 898 es el texto de INVOKE-2 que TRASPASO (línea 1614) pone como fallo de la regla 1. Entre las vivas, con la regla 1 hay 2 contradichos y 23 sin evidencia; con la regla 2, 9 y 156. TRASPASO solo documenta la marca de vigencia en Qué desbloquea más. Media: es en la ficha donde se decide el descarte que propone el Killer, y no avisa de que esos supuestos vienen de la regla vieja.

## [CONFIRMADO · media · seccion] Los contadores de «te espera» cuentan cosas de corridas cerradas que ninguna pantalla enseña ni deja resolver

`frontend/src/lib/digest.ts:92`

**Qué pasa.** loQueEspera alimenta la cabecera, el título de la pestaña, las tarjetas de Inicio y el resumen «Mientras no estabas». Suma las solicitudes e incidencias pendientes de todas las corridas de la investigación y todo plan sin aprobar, aunque la corrida esté terminada o detenida y la iteración cerrada. La barra lateral (BarraLateral.tsx:114-115) cuenta de otra forma. La pantalla Corrida solo enseña la última corrida (Corrida.tsx:91 y 222), así que esos pendientes ni se ven ni se pueden resolver, y el número no baja nunca.

**Escenario.** Estado real, «Qué distingue a un biomarcador que predice beneficio clínico». Pintado: la cabecera dice «17 esperan»; la barra lateral pone «Corrida en vivo 8» y «Cola de hipótesis 9»; la pantalla Corrida (corrida 16, pausada por presupuesto) no tiene ninguna sección de pendientes. Los 8 que sobran son 6 incidencias del 17 al 21 de septiembre de las corridas 12 y 13 (terminadas) y 14 (detenida), como «El Killer no pudo juzgar...» o «No se pudo proponer el plan con el modelo», más los planes de la iteración 2 de las corridas 3 y 14, las dos detenidas, que ya no se pueden aprobar. En «La disociación...», loQueEspera da 4: 3 hipótesis y el plan de la corrida 3, detenida.

**Evidencia.** loQueEspera() sobre el estado real devuelve 17 (9 hipótesis, 6 incidencias y 2 planes). Barra lateral: 0 permisos + 6 incidencias + 2 planes = 8. En la corrida 16 no hay ni incidencias, ni permisos, ni planes pendientes. En digest.ts, las líneas 88 y 93 no miran el estado de la corrida ni terminadaEn.

**Propuesta.** Una sola función de pendientes para la cabecera, Inicio, digest y la barra lateral, que cuente solo lo que se puede hacer: planes de iteraciones abiertas de corridas vivas, y solicitudes e incidencias de la corrida que enseña la pantalla Corrida. Las incidencias pendientes de corridas cerradas deberían, o cerrarse en el servidor al terminar o detener la corrida, o salir listadas en la pantalla Corrida con su botón de resolver.

**Escéptico.** En digest.ts:83-97, loQueEspera suma solicitudes e incidencias pendientes de todas las corridas, y toda iteración sin planAprobado, sin mirar el estado de la corrida ni terminadaEn. La usan la cabecera y el título de la pestaña (App.tsx:150 y 172), Inicio.tsx:86 y el digest. Corrida.tsx:91 elige la corrida de mayor número y las líneas 219-228 filtran por ella. resolverIncidencia solo se ofrece en Corrida.tsx:740. detener_corrida (acciones.py:107) solo cierra las modelo_sin_respuesta. En rosa.db, inv-mu2sz2ns-3 da 17: 0 solicitudes, 6 incidencias (corridas 12 y 13 terminadas y 14 detenida, del 17 al 21/09), 9 hipótesis y 2 planes (iteración 2 de las corridas 3 y 14, las dos detenidas). La corrida 16, pausada_por_presupuesto, no tiene nada pendiente. inv-mtwz8pbn-1 da 4: 3 hipótesis y el plan de la corrida 3, detenida. Matiz: la barra lateral suma lo mismo (0+6+2=8 y 9 hipótesis). Solo añade terminadaEn === null en los planes, y eso aquí no cambia nada. El fallo no es que cuenten distinto, sino que esos 8 no se ven ni se pueden resolver en ninguna pantalla. TRASPASO no lo documenta.

## [CONFIRMADO · media · fallo] El test intermitente: App.cliente.test.tsx deja la App montada y sus relojes disparan después de desmontar jsdom

`frontend/src/App.cliente.test.tsx:50`

**Qué pasa.** Ningún test falla: vitest sale con código 1 por «Unhandled Errors». montar() crea raíces con createRoot y nunca las desmonta, y afterEach solo vacía document.body, lo que no desmonta React. Los intervalos de useAhora (1 s en App.tsx:138 y 250 ms en ToastDeshacer, Deshacer.tsx:38) siguen vivos. Cuando vitest retira jsdom, el siguiente tic llama a setAhora y react-dom lee window: ReferenceError. Que pase o no depende de si el proceso del fichero sigue vivo en ese tic, por eso es intermitente.

**Escenario.** Seis pases completos de npx vitest run en frontend/. Los pases 1 y 6 salen con código 1 y el resumen «Test Files 98 passed (98) · Tests 1030 passed (1030) · Errors 5 errors» (1 error en el pase 6), así que no aparece ningún test fallido. En los seis pases sale además, a nivel de fichero y después de su último test, «stderr | src/App.cliente.test.tsx · Warning: An update to ToastDeshacer inside a test was not wrapped in act(...)»: la fuga está siempre y el error solo a veces.

**Evidencia.** Traza: «ReferenceError: window is not defined ❯ getCurrentEventPriority react-dom.development.js:10993 ❯ dispatchSetState ❯ Timeout.actualizar src/lib/useAhora.ts:7:30 ❯ listOnTimeout node:internal/timers», con «This error originated in "src/App.cliente.test.tsx" ... caught after test environment was torn down». Recuento de createRoot frente a unmount por fichero: App.cliente.test.tsx 1/0 (montar() se llama 15 veces) y datos/almacen.deshacer.test.tsx 3/0. Los otros 42 ficheros desmontan.

**Propuesta.** Que montar() guarde cada raíz en una lista y que afterEach las desmonte con `await act(async () => root.unmount())` antes de vaciar el body. Lo mismo en almacen.deshacer.test.tsx. Con eso desaparecen el aviso de act y los errores tras el desmontaje.

**Escéptico.** En App.cliente.test.tsx:46-62, montar() crea la raíz con createRoot y nunca la desmonta, y afterEach (41-44) solo vacía el body. De los 44 tests que usan createRoot, solo App.cliente.test.tsx (1/0) y datos/almacen.deshacer.test.tsx (3/0) no desmontan. useAhora usa setInterval en App.tsx:138 (1 s) y en Deshacer.tsx:38 (250 ms). Corrí el fichero solo 8 veces: siempre sale con código 0, pero en 6 de las 8 hay avisos de act después del último test (hasta 115, de App). Corrí la suite completa 5 veces. El pase 5 salió con código 1, con 'Test Files 98 passed, Tests 1034 passed, Errors 1 error' y la traza exacta: ReferenceError: window is not defined en getCurrentEventPriority, desde Timeout.actualizar en useAhora.ts:7, con 'originated in src/App.cliente.test.tsx... caught after test environment was torn down'. Hay una segunda fuente de intermitencia: en el pase 1 falló src/lib/arbol3d.test.ts:354 (umbral de 8 ms, midió 8,37 ms). Esa sí sale con su nombre, así que la de TRASPASO:1792 ('no se pudo ver cuál') encaja con la de App.cliente. TRASPASO la deja pendiente sin explicarla.

## [CONFIRMADO · media · fallo] Si el servidor rechaza una acción con 5xx, queda aplicada en pantalla sin aviso, y la franja dice «Sin conexión a internet»

`frontend/src/datos/almacen.ts:433`

**Qué pasa.** enviar() trata cualquier 5xx como un corte de red: marca conexion 'sin_conexion' y no resincroniza ni avisa. El cambio optimista, ya aplicado, se queda. El siguiente latido SSE (cada 15 s, almacen.ts:401) vuelve a 'en_linea' y quita la franja. Solo lo corrige un estado nuevo del servidor, que sin ninguna corrida viva (el caso de hoy) puede tardar. La franja dice «Sin conexión a internet» (App.tsx:285) aunque el servidor haya contestado.

**Escenario.** Simulado con vite-node, sin red y con fetch y EventSource falsos: conectar() con el estado real, luego acciones.reevaluarSupuestos(null) y el POST contesta 500. La pantalla pasa de 6 a 28 hipótesis con «reevaluación pedida» y la conexión queda en 'sin_conexion'. Tras un latido, la conexión vuelve a 'en_linea' y las 28 siguen «pedidas» sin ningún aviso. La promesa resuelve bien, así que el botón en vuelo se apaga como si todo hubiera ido bien. El servidor devuelve 503 con motivo en EscritorObsoleto (servidor.py:408), y 500 con cualquier excepción que no esté en la lista de servidor.py:409.

**Evidencia.** Salida de la simulación: «conexión tras el 500: sin_conexion · hipótesis con la reevaluación pedida: antes 6 después 28 · conexión tras el siguiente latido: en_linea | siguen pedidas en pantalla: 28». Código: almacen.ts:433-436 `if (r.status >= 500) { ... conexion: 'sin_conexion' ...; return; }`.

**Propuesta.** Tratar el 5xx como el 4xx: fijarAviso con el motivo que traiga el cuerpo («El servidor no pudo aplicar ... (500)») y resincronizar(). Dejar 'sin_conexion' solo para cuando falla el fetch. Cambiar el texto de la franja a «Sin conexión con ROSA2018»: el servidor es local y no tiene que ver con internet.

**Escéptico.** En almacen.ts:433-436, un 5xx solo pone conexion='sin_conexion' y vuelve, sin fijarAviso ni resincronizar. El 4xx sí hace las dos cosas. El latido (almacen.ts:401-404) solo vuelve a en_linea y no compara la versión que trae (servidor.py:371 manda almacen.version). vigilarFlujo solo resincroniza tras 45 s sin señal. Lo reproduje con vite-node, con fetch y EventSource falsos y el estado real ya limpio. reevaluarSupuestos(null) con el POST en 500: las pedidas pasan de 6 a 28 y la conexión queda en sin_conexion. Tras un latido vuelve a en_linea y las 28 siguen pedidas. La franja (App.tsx:285) dice 'Sin conexión a internet'. servidor.py:404-408 devuelve 503 con el motivo de EscritorObsoleto, y su comentario dice 'La persona lo sabe, en vez de un 500 mudo', pero el cliente no lee el cuerpo. Alcance: revisarHipotesis (aceptar y descartar) va por enviarYComprobar con reintentos y aviso, así que eso no se ve afectado. Sí se ven afectadas las unas 80 acciones que usan enviar(), entre ellas asignarExperimento, aprobarPlan, resolverIncidencia y detenerCorrida.

## [SIN VERIFICAR · media · ineficiencia] Cada llamada al modelo reescribe 31 MB de estado y para el bucle de eventos (S-17, hoy peor de lo documentado)

`rosa/modulos/contador.py:182`

**Qué pasa.** REVISION-BUGS lo documentó como S-17 cuando el estado pesaba 17 MB. Hoy pesa 31,1 MB y su propuesta (b), el contador en memoria, no se aplicó. Cada llamada, también un acierto de caché de 1 ms, hace almacen.mutar: serializa el estado entero (almacen.py:285) y lo escribe en SQLite. Todo ocurre en el hilo del bucle de eventos, porque DSPy ejecuta los callbacks en línea dentro de acall (dspy/utils/callback.py).

**Escenario.** En la iteración 3 de la corrida 16 hubo 859 mutaciones en 17 minutos (463 de ellas llamada_modelo), y ninguna llegó menos de 100 ms después de la anterior: p1 de 205 ms y mediana de 391 ms. El 15 de septiembre, con el estado pequeño, 505 de 1.206 huecos estaban por debajo de 100 ms.

**Evidencia.** - Serializar el estado real (_serializar) tarda 0,21 a 0,25 s; S-17 documentaba 71 a 92 ms.
- Medido en una copia: una actualización que cambia la longitud escribe 31,4 MB en el WAL (commit de 0,29 s) y otros tantos en el checkpoint; con la misma longitud escribe 0,01 MB.
- 14,7 MB del estado (47 %) son corridas cerradas que no cambian.
- llamada_modelo son 9.661 de las 28.118 filas del registro y 1.767 de las 3.745 de la corrida 16; 718 fueron aciertos de caché (0 tokens, 50 ms o menos).
- La instantánea pública pesa 15,9 MB (S-17: 10) y va por SSE sin comprimir en cada versión. A 51 versiones por minuto son hasta unos 800 MB por minuto por pestaña (estimación; S-17 medía 443), con un JSON.parse de 53 a 138 ms en cada empuje (medido en Node).
- Con la corrida en pausa, pausaMs sube la versión cada 30 s: son 789 de las 1.339 mutaciones desde las 15:40 del 22 sep.

**Propuesta.** Aplicar ya S-17 (b): el contador acumula en memoria, presupuesto_ok lee de memoria y el gasto se vuelca con la siguiente mutación real o cada pocos segundos (la tabla llamadas ya guarda cada llamada). No subir la versión por pausaMs ni esperaHumanaMs: guardar el instante de inicio y que la interfaz calcule. Después, sacar _fuentes y _afirmaciones de las corridas cerradas a una tabla propia.

## [SIN VERIFICAR · media · ineficiencia] El espejo de Convex escanea el estado entero con el cerrojo del almacén tomado: 0,6 a 0,77 s cada vez

`rosa/espejo_convex.py:132`

**Qué pasa.** _entidades hace _limpiar_para_cliente, json.dumps(sort_keys=True) y sha256 de 1.764 entidades (14,1 MB) dentro de with self.almacen._lock. Mientras tanto, cualquier mutar del bucle espera en el hilo del bucle de eventos, y con él se paran el servidor HTTP y el SSE. El escaneo se lanza tras cada cambio, agrupando 4 s (líneas 180-185).

**Escenario.** Con la corrida 16 en pausa, cada volcado del reloj cambia pausaMs cada 30 s. Cada vez, el espejo vuelve a escanear 0,6 a 0,77 s con el cerrojo y sube la corrida entera a Convex (485 KB) sin que haya pasado nada. En una iteración activa hay un escaneo cada 4 s aproximadamente, lo que retiene el almacén del orden de un 10 a 15 % del tiempo (estimación).

**Evidencia.** entidades_de sobre el estado real: 0,651, 0,601 y 0,771 s. REVISION-BUGS M-24 lo documentaba como 85 ms bajo el cerrojo. CONVEX_URL y CONVEX_DEPLOY_KEY tienen valor en .env, así que el espejo arranca (main.py:130-134).

**Propuesta.** Calcular los hashes fuera del cerrojo, a partir del JSON por versión que ya cachea instantanea_json o de una copia superficial tomada bajo el cerrojo. Excluir del hash los campos de reloj y no disparar el espejo por un tic.

## [SIN VERIFICAR · media · fallo] Las revisiones pedidas se cargan a iteraciones cerradas hace días y el coste de corridas terminadas cambia después

`rosa/bucle/corrida.py:1364`

**Qué pasa.** _atender_peticiones construye el contexto con _ctx(ultima_corrida), y su número de iteración es el iteracionActual de esa corrida aunque ya esté terminada. El contador suma entonces al gasto de la corrida cerrada y al usado de su última iteración, y la tabla llamadas guarda las llamadas con ese número. La metrica de la corrida (usd y peldaños por dólar) se calculó al cerrarla y no se rehace.

**Escenario.** Hoy, la reevaluación dejó 105 llamadas en la iteración 2 de la corrida 1 (terminada el 10 sep a las 15:22) y 71 en la iteración 2 de la corrida 3 (detenida el 18 sep), que queda en 450 de un tope de 447. costes.py (por_iteracion, líneas 52-59) atribuye ese gasto a iteraciones de hace días y altera tendenciaUsdPorIteracion.

**Evidencia.** metrica.usd frente a gasto.usd:
- corrida 12: 74,56 frente a 77,31 (112 llamadas después de terminar);
- corrida 3: 41,96 frente a 47,16 (86);
- corrida 13: 38,89 frente a 41,68 (83).
La pantalla de la corrida enseña gasto.usd (Corrida.tsx:278), mientras que «por dólar» sale de metrica (lib/progreso.ts:67).

**Propuesta.** Registrar las llamadas de las peticiones fuera de cualquier iteración (iteración nula u origen «petición») y en un acumulado de la investigación, no en el gasto de una corrida cerrada; o rehacer metrica cuando cambie el gasto.

## [SIN VERIFICAR · media · fallo] Código nuevo: la unidad «DE» casa con la preposición «de» y convierte recuentos en medidas con hallazgo de gravedad alta

`rosa/revisor_registro.py:131`

**Qué pasa.** `_UNIDAD` se compila con `re.IGNORECASE` e incluye `DE\b` (desviación estándar), así que cualquier «N de …» cuenta como medida. `cifras_fuera_de_contexto` la ancla a las siglas cercanas y, si el número existe en el registro con otras anclas, emite `cifra_fuera_de_contexto` de gravedad alta. Eso bloquea por `revision_registro_abierta` todas las hipótesis de la investigación. Además, los miles con punto («4.070 resultados») se leen como 4.07 y también cuentan como medida.

**Escenario.** `es_medida("12 de 40 hechos","12",2)` y `es_medida("17 de las 20 fuentes","17",2)` devuelven True. Pasé la regla de hoy por los 41 resúmenes guardados con el texto que arma el revisor (resumen más campos de texto del llano). Salen 2 hallazgos de gravedad alta y los 2 son falsos: son recuentos de búsqueda, «30 de reguladores, registros y portales» (it-mu2zvjkv-1867) y «60 de reguladores…» (it-mu75mpoe-802), «dicho de ARIA, CDR, WMH, no de PMC». TRASPASO dice «0 avisos falsos en los 41 resúmenes», pero esa prueba no incluyó el llano, que es donde está la frase.

**Evidencia.** revisor_registro.py:129-131 (`…|z\b|SD\b|DE\b|…`, IGNORECASE) y 136-140 (`es_medida`). test_cifras_ancladas.py:119-131 no tiene ningún caso «N de …». `_norm("4.070")` da "4.07". Los 77 tests del revisor pasan.

**Propuesta.** Sacar `DE`/`SD` del patrón con IGNORECASE: exigirlos en mayúscula y en contexto de medida. Tratar «N de M» y «N de <sustantivo>» como contabilidad. Leer «d.ddd» como miles en texto castellano cuando no es un decimal plausible. Añadir los casos «12 de 40 hechos» y «30 de reguladores» al test parametrizado.

## [SIN VERIFICAR · media · ineficiencia] El tope de iteración sale de costes fijos y pausa la corrida en cada iteración con buena parte del presupuesto sin gastar; GEPA queda parado detrás

`rosa/bucle/corrida.py:1844`

**Qué pasa.** El límite de cada iteración es la suma de costes fijos por tipo de paso (`COSTE_POR_TIPO`: 94+94+60+80+4+90+25 = 447 en las seis iteraciones de las corridas 13 y 16) más una reserva de cierre de 16 a 19. No mira cuántas fuentes, afirmaciones o revisiones pedidas trae la iteración. El gasto real lo supera, la corrida entera se pausa y la única salida que se ofrece es subir el tope global. Mientras tanto, `ciclo` de GEPA cuenta como viva cualquier corrida que no esté terminada ni detenida, pausadas incluidas.

**Escenario.** Corrida 16: las 3 iteraciones agotaron su tope y pausaron la corrida con 468 de 1500, 1046 de 2250 y 1770 de 3375 llamadas, es decir, con el 69 %, el 54 % y el 48 % del tope de la corrida sin gastar. Emir subió el tope global dos veces (1500 → 2250 → 3375) para desbloquear topes de iteración. La iteración 1 acabó gastando 580 y la 2, 723. La 3 se pausó con 4 de 7 pasos pendientes y sigue así desde el 22 sep a las 15:38. Desde entonces `gepaAutomatico` dice «Hay 1 corrida en marcha: GEPA no optimiza», y `gepa` sigue vacío.

**Evidencia.** corrida.py:107 y 1840-1844. Eventos «presupuesto» del 22 sep a las 09:48, 10:45 y 15:38; acciones `ampliarPresupuesto` a las 10:05 y a las 14:43. gepa_continuo.py:645: `vivas = [c for c in e["corridas"] if c.get("estado") not in ("terminada", "detenida")]`.

**Propuesta.** Estimar el coste de cada paso con lo medido en la investigación (media de llamadas por tipo de paso, o por fuentes y afirmaciones pendientes). Mientras quede tope de corrida, avisar o pedir permiso de gasto de iteración en vez de pausarla. En GEPA, contar como vivas solo `en_marcha`, `esperando_plan`, `esperando_aprobacion` y `esperando_modelo`, la misma lista que usa scripts/parar_servidor.py.

## [SIN VERIFICAR · media · fallo] El revisor cuenta las preguntas como hechos y marca como contradicción un recuento correcto en cada iteración

`rosa/revisor_registro.py:328`

**Qué pasa.** `recuentos_del_registro` y la línea «HECHOS NUEVOS O ACTUALIZADOS» del registro del juez cuentan todas las entradas de `e["hechos"]`, que también guarda las preguntas abiertas. El paso del modelo de mundo, y con él el resumen, dice bien «N hechos y M preguntas», pero el revisor solo admite N+M.

**Escenario.** Los 12 hallazgos por regla del tipo «N hechos» (el registro admite …) son exactamente N más las preguntas: 10+1, 14+3, 26+4, 13+3, 15+4, 18+3 (dos veces), 14+2, 20+4, 23+6, 23+5 y 21+2. El juez cae en lo mismo al menos 5 veces, por ejemplo «21 hechos y 2 preguntas» frente a «HECHOS NUEVOS: 23». Cada uno se convierte en lección y entra en el traspaso de la iteración siguiente (contexto.py:701: los 5 primeros abiertos).

**Evidencia.** revisor_registro.py:311 y 328 cuentan `hechos` sin filtrar por tipo, y 802-803 hacen lo mismo en el registro del juez. pasos.py:2365 separa hechos y preguntas. Tipos en el estado: hecho 569, pregunta 140, hipótesis 6.

**Propuesta.** Filtrar `tipo == "hecho"` en las dos cuentas y admitir las preguntas con su propia clave en `_RECUENTO`. Test: «21 hechos y 2 preguntas» frente a 21 hechos y 2 preguntas no debe dar hallazgo.

## [SIN VERIFICAR · media · riesgo] El revisor no lee la mitad del resumen en llano: las listas quedan fuera

`rosa/bucle/corrida.py:2018`

**Qué pasa.** El texto que revisan las reglas y el juez es `resumen + " ".join(str(v) for v in llano.values() if isinstance(v, str))`. Las listas `mensajesClave`, `queEncontro`, `cambios` y `quePropone`, que es lo primero que lee la médica, no entran. Por eso el fallo de «Qué cambió» nunca salió en el revisor. La regla de sobreafirmaciones de hoy (f9a74d6), que dice mirar «el resumen en llano», tampoco las mira.

**Escenario.** Los 40 resúmenes en llano del estado tienen 405 elementos de lista con 65.600 caracteres, frente a 67.709 en los campos de texto que sí se revisan: el 49 % del llano no pasa por ninguna comprobación. «Subió de certeza muy baja a baja» (corrida 16, iteración 1) no se contrastó con nada.

**Evidencia.** corrida.py:2016-2018; recuento sobre `iteraciones[].resumenLlano`.

**Propuesta.** Construir el texto del revisor con todos los campos del llano, listas incluidas y aplanadas con su clave. Test: una sobreafirmación metida en `queEncontro` tiene que dar hallazgo.

## [SIN VERIFICAR · media · fallo] La métrica de peldaños da por subidos los niveles que ya había y no cuenta las bajadas de la primera iteración

`rosa/progreso.py:105`

**Qué pasa.** `instantanea` compara con la instantánea anterior de la misma corrida. En la primera iteración no hay ninguna, así que cada hipótesis que ya existía suma su peldaño actual como subida y las bajadas no se cuentan. Es la métrica única de la corrida (la vara de Emir) y entra en `traspaso_de_corrida` y en la meta-campaña.

**Escenario.** La corrida 14 (21 sep) no hizo ninguna llamada al modelo porque no había saldo en el gateway, y su métrica dice peldanosSubidos 1, peldanosNetos 1 por una hipótesis que ya estaba en baja desde el 18 sep. En la iteración 1 de la corrida 16 esa misma hipótesis bajó de baja a muy baja, y la instantánea dice peldanosBajados 0.

**Evidencia.** progreso.py:105-121 (`if antes is None: subidos += p`). `metrica` de cor-mubl0qbd-1418 con usd 0.0 y gasto.llamadas 0; `progreso` de cor-mucppi81-3411.

**Propuesta.** En la primera iteración de una corrida, tomar como anterior la última instantánea de la investigación, sea de la corrida que sea, o las `certezasAntes` del primer cierre. Contar como subida solo el nacimiento de hipótesis dentro de la ventana de la corrida.

## [SIN VERIFICAR · media · inteligencia] Lo que enseña el revisor no llega a quien escribe el resumen, y los criterios propuestos no se pueden evaluar

`rosa/lecciones.py:98`

**Qué pasa.** Cada hallazgo del revisor se guarda como lección con su texto literal, cifras incluidas, así que nunca coincide con otra y `veces` no sube. Son lecciones de ámbito «resumen», pero ni `resumir` ni `en_llano` reciben lecciones, y el planificador pide ámbitos sin «resumen». Con el tope de 200 por investigación, este ruido desplaza lecciones útiles. En paralelo, la meta-revisión propone 6 criterios en cada cierre y no se pueden evaluar: la evaluación exige decisiones humanas con etapa «persona» y no hay ninguna.

**Escenario.** 208 de 209 lecciones tienen veces=1, y 96 vienen del revisor. El juez marcó la frase «comparar semaglutida, posdinemab y AL002 con lecanemab y donanemab» en 14 iteraciones seguidas, del 15 al 17 sep, y el resumen no cambió. Hay 186 criterios de nivel 2 propuestos: 180 sin evaluar y 6 evaluados con «casos: 0». `criteriosRevision` sigue con los 4 originales.

**Evidencia.** lecciones.py:97-98; `registrar` deduplica por texto exacto. corrida.py:2097 (`resumir` sin lecciones) y 1777 (ámbitos sin «resumen»). pasos.py:4342 y corrida.py:786 (`etapa == "persona"`). `decisiones` solo tiene las etapas killer_1 y killer_2.

**Propuesta.** Normalizar la lección del revisor por clase y patrón, sin cifras, para que se acumule en `veces`. Pasar a `resumir` y `en_llano` las lecciones de ámbito «resumen» con veces > 1. No proponer más criterios mientras el conjunto de evaluación esté vacío, y decirle a la persona que sin decisiones suyas el aprendizaje de nivel 2 no funciona.

## [SIN VERIFICAR · media · riesgo] El registro del servidor se borra en cada reinicio, y con él las trazas de los fallos que el bucle captura

`scripts/reiniciar_servidor.sh:38`

**Qué pasa.** El arranque redirige con `>` a /tmp/rosa2018-servidor.log, así que el fichero se vacía en cada reinicio. 47 sitios del backend (39 en corrida.py) capturan la excepción y solo hacen `traceback.print_exc()`, que es la única huella de los fallos del cierre, la meta-revisión, la acumulación de evidencia o las conclusiones.

**Escenario.** El registro de hoy tiene 133 bytes: dos líneas de arranque de las 14:07. Desde que existe el guión (22 sep, 11:07) hubo 10 reinicios (eventos «volvió a arrancar»). Los errores del bucle de esas horas, incluidos los de la corrida 16 y los de la reevaluación de supuestos de esta mañana, no se pueden auditar.

**Evidencia.** reiniciar_servidor.sh:38: `nohup $PY -m rosa.main > "$LOG" 2>&1 &`. Recuento de `traceback.print_exc` y tamaño del fichero.

**Propuesta.** Añadir con `>>` y rotar por fecha. Mejor aún, guardar cada excepción capturada en la base (corrida, iteración, paso y traza) para que la vean una incidencia o el revisor.

## [SIN VERIFICAR · media · fallo] App.cliente.test.tsx deja vivas las raíces de React y la suite sale con código 1 sin ningún test fallido

`frontend/src/App.cliente.test.tsx:46`

**Qué pasa.** montar() crea una raíz con createRoot en cada llamada (nueve dentro del bucle de la línea 113) y nunca la desmonta: afterEach (línea 41) solo vacía document.body. El setInterval de useAhora sobrevive al entorno jsdom. Cuando ese mismo proceso ejecuta después un fichero de entorno node, el intervalo lanza «ReferenceError: window is not defined», vitest lo cuenta como error no controlado y sale con código 1 con todos los tests en verde. Es el test intermitente que TRASPASO dejó para la revisión de fallos.

**Escenario.** En seis pasadas completas con el reporter por defecto, tres terminaron con «Errors 13 errors», «2 errors» y «4 errors», todos «originated in src/App.cliente.test.tsx». La pasada final sobre HEAD 90b2727 dio «Tests 1034 passed», «Errors 1 error» y código 1. Con solo el reporter JSON no se ve ningún nombre: una pasada así salió con código 1 y 0 tests fallidos.

**Evidencia.** Traza: «ReferenceError: window is not defined ❯ Timeout.actualizar src/lib/useAhora.ts:7:30 ... This error was caught after test environment was torn down». Ningún unmount en todo App.cliente.test.tsx.

**Propuesta.** Guardar cada root y desmontarlo en afterEach con act(() => root.unmount()), como hace Corrida.vigilante.test.tsx. En el bucle de pantallas, desmontar antes de montar la siguiente.

## [SIN VERIFICAR · media · fallo] Las esperas fijas de 60 y 120 ms compiten con el pintado diferido y hacen fallar cuatro tests distintos con carga

`frontend/src/pantallas/Corrida.vigilante.test.tsx:95`

**Qué pasa.** esperarPintado (copiada en 19 ficheros, casi todas con 60 ms) y el montar de App.cliente (120 ms) esperan un tiempo de reloj a que useCalculoDiferido (rAF más setTimeout(0)) sustituya el esqueleto. Si el proceso se retrasa más que ese margen, el temporizador del test vence antes que el setTimeout(0) que programa el rAF y las aserciones leen el esqueleto. En ese caso, además, las aserciones negativas (not.toContain) pasan en vacío.

**Escenario.** En las pasadas completas, con otros agentes y pytest corriendo a la vez, fallaron: Corrida.vigilante.test.tsx:156 («expected 'Cargando la corridaCorrida 3' to contain '2 cosas impiden seguir'»), Artefactos.esqueleto.test.tsx:173 (boton('Regenerar dossier') undefined) y Hipotesis.test.tsx:184 (h2 null). En una prueba de dos ficheros en un solo proceso, App.cliente.test.tsx:123 (la esfera del árbol, null).

**Evidencia.** Sumando este mecanismo y el anterior, 7 de 18 pasadas completas salieron con código distinto de 0. El test de 4,6 s de arbol.estabilidad no es el culpable: en vitest 2.1.9, withTimeout no corta un test síncrono.

**Propuesta.** Sustituir la espera fija por una espera a una condición (que desaparezca el esqueleto o aparezca el elemento buscado) con plazo generoso, por ejemplo un bucle de act con setTimeout de 20 ms hasta 2 s, en un solo helper compartido. Otra opción: requestAnimationFrame síncrono con vi.stubGlobal y vi.useFakeTimers para avanzar el reloj.

## [SIN VERIFICAR · media · riesgo] El test del Killer sobre el juez que confirma una sospecha comprueba lo contrario y termina en 'or True'

`rosa/tests/test_auditoria2.py:59`

**Qué pasa.** El comentario dice que el juez sí puede confirmar la sospecha de la regla (falla). La aserción espera 'no_comprobable', que es falso, y termina en 'or True', así que no puede fallar. El comportamiento real ('falla') no lo protege ningún test.

**Escenario.** Mutación en una copia: en killer.fusionar, un 'falla' del juez sobre una comprobación sospechosa se ignora. Pasan los 1790 tests. Con ese cambio, una hipótesis cuyas cifras el juez confirma como inventadas se suspende (no_comprobable en una comprobación crítica) en vez de descartarse en contexto, porque fidelidad_evidencia está en DESCARTAN.

**Evidencia.** K.fusionar(regla no_comprobable con detalle, juez falla) devuelve {'resultado': 'falla', 'detalle': 'inventada'}. La línea 59 compara con 'no_comprobable' y acaba en 'or True'. [M1_killer_juez_no_confirma_sospecha] SOBREVIVE. De paso: el detalle de la regla («La cifra 42 % no aparece en el pasaje citado») se pierde, sustituido por el del juez.

**Propuesta.** Quitar el 'or True', esperar 'falla' y comprobar que K.decidir con ese resultado da 'descartar_en_contexto'. Conservar el detalle de la regla al fusionar.

## [SIN VERIFICAR · media · fallo] Regla 3: si el modelo omite los campos nuevos, se guarda «no hablan de esto» y «en la literatura», y un test lo da por bueno

`rosa/modulos/firmas.py:182`

**Qué pasa.** indices_que_lo_tocan tiene default_factory=list y donde_se_responde tiene default='literatura'. Una omisión del modelo no se distingue de «ninguna afirmación toca el tema, se respondería en la literatura», y alcance_del_supuesto la convierte en no_tocado. test_vigencia.py:193-194 lo fija como correcto («el modelo no dio índices», «el valor por defecto de la firma»). Mientras, test_alcance_del_supuesto_no_adivina_donde (test_tanda1_pasos_killer.py:222) presume que no se adivina, pero solo prueba la función con None, que el camino real nunca le pasa.

**Escenario.** El evaluador devuelve {'estado': 'sin_evidencia', 'evidencia': 'Las afirmaciones 2 y 5 tratan el tiempo de cruce pero no lo resuelven', 'indices_que_lo_niegan': []} sin los campos nuevos. Se guarda {'alcance': 'no_tocado', 'dondeSeResponde': 'literatura'}, y la ficha dice «Las fuentes reunidas no hablan de esto · se respondería en la literatura» justo debajo de una evidencia que cita dos afirmaciones.

**Evidencia.** Reproducido sin modelo con TypeAdapter(F.SupuestoEvaluado).validate_python(...) y PASOS.alcance_del_supuesto. En el estado real aún no hay supuestos con alcance (28 sellos, con las reglas 1 y 2).

**Propuesta.** Declarar los tres campos opcionales con None por defecto. En alcance_del_supuesto, índices None dan 'no_evaluado' y dónde None da dondeSeResponde None. Cambiar las dos aserciones de test_vigencia.py a ese comportamiento.

## [CONFIRMADO · baja · fallo] En modo servidor, la interfaz anuncia resultados que no ocurrieron: 'sin hallazgos nuevos' y retractaciones 'sin cambios'

`frontend/src/datos/acciones.ts:548`

**Qué pasa.** Los reductores TS que se aplican de forma optimista con servidor no hacen lo mismo que los de Python. solicitarRevision (540-553) marca como 'hecha' cada revisión automática pendiente, con 'Revisada a petición de la investigadora: sin hallazgos nuevos.'. recomprobarRetracciones (1333-1341) pone retraccionComprobadaEn = ahora en todas las fuentes y crea el evento 'Retractaciones recomprobadas contra Crossref y Retraction Watch: sin cambios'. Python (acciones.py:1160-1170 y 1586-1594) solo deja constancia de la petición.

**Escenario.** La persona pulsa 'Pedir revisión' o 'Recomprobar retractaciones' (almacen.ts:641-644 y 733-736). Hipotesis.tsx:626 muestra 'Hecha' con 'sin hallazgos nuevos' y Procedencia.tsx:99 muestra 'retractación comprobada hace un momento' sin que se haya comprobado nada. Si el POST falla por red o por un 5xx, enviar solo marca 'sin conexión' y la afirmación falsa se queda en pantalla hasta el siguiente empuje.

**Evidencia.** En acciones.ts:548, revisionesAutomaticas: map(r => r.estado === 'pendiente' ? {...r, estado: 'hecha', resumen: 'Revisada a petición de la investigadora: sin hallazgos nuevos.'} : r). En acciones.py:1166-1168, ultimaRevisionAutomatica = ahora, _revisionPedida y el mensaje 'ROSA2018 la hará en cuanto tenga el modelo libre'.

**Propuesta.** Que en modo servidor los reductores TS hagan lo mismo que Python, es decir, marcar solo 'pedida', y dejar la simulación de resultados en simulacion.ts. Añadir un test de paridad para las dos acciones.

**Escéptico.** acciones.ts:540-553 marca las revisiones como 'Hecha' con 'sin hallazgos nuevos', y acciones.ts:1333-1341 pone retraccionComprobadaEn = ahora en todas las fuentes y crea el evento 'sin cambios'. almacen.ts:641-644 y 733-736 aplican los dos de forma optimista también en modo servidor, mientras que Python (acciones.py:1160-1170 y 1586-1594) solo deja constancia de la petición. Hipotesis.tsx pinta 'Hecha' y Procedencia.tsx:99 'retractación comprobada...'. recibirRemoto sustituye el estado entero en el siguiente empuje, así que en uso normal el texto falso dura segundos. Se queda en pantalla si el POST falla o si el SSE deja de traer estados legibles (ver el hallazgo del NaN).

## [CONFIRMADO · baja · riesgo] La firma de la sesión (S-22) no llega a la misión creada con la investigación ni a las subidas

`rosa/estado/acciones.py:1643`

**Qué pasa.** crear_investigacion no tiene parámetro quien, así que no está en ACCIONES_CON_QUIEN, y aprueba la misión con datos['quien'], que manda el navegador. almacen.ts:739 envía la constante QUIEN = 'la persona responsable'. Además, subir_datos (servidor.py:730) y subir_dataset (777) llaman a almacen.aplicar sin actor, así que la fila del registro no lleva el correo de la sesión y no se marca _correoResponsable.

**Escenario.** Una persona crea una investigación con la misión escrita. mision.aprobadaPor y el evento dicen 'Misión aprobada por la persona responsable', no su correo. Cuando un laboratorio sube datos que cambian la evidencia GRADE, la fila de registrarDatosExperimento en la cadena de hashes no dice quién los subió. Esto contradice la guardia 4 del docstring de servidor.py.

**Evidencia.** En el estado real, cuatro misiones tienen aprobadaPor 'la persona responsable' (creadas antes del arreglo de S-22, pero el camino sigue abierto). Las columnas de acciones incluyen actor. Las llamadas de servidor.py:730 y 777 no pasan actor=request.state.usuario.

**Propuesta.** Dar a crear_investigacion un parámetro quien que el servidor sobrescriba con el actor, y dejar de leer datos['quien']. Pasar actor=request.state.usuario en las dos subidas.

**Escéptico.** crear_investigacion no tiene parámetro quien, así que no entra en ACCIONES_CON_QUIEN, y llama a aprobar_mision con datos['quien']; almacen.ts:739 manda QUIEN = 'la persona responsable'. En una base temporal, con actor 'medica@x', mision.aprobadaPor quedó en 'la persona responsable'. La fila del registro y _correoResponsable sí llevan el correo (el actor entra en el hash), lo que lo atenúa. servidor.py:730 y 777 llaman a aplicar sin actor: en el registro real, las 2 filas de registrarDatosExperimento y las 5 de anadirDataset tienen actor NULL. Hay 4 misiones aprobadas por 'la persona responsable', creadas antes del arreglo de S-22.

## [CONFIRMADO · baja · fallo] Pistas "en curso" para siempre en iteraciones ya cerradas

`rosa/bucle/corrida.py:155`

**Qué pasa.** `recuperar_tras_reinicio` solo arregla las pistas de iteraciones abiertas (155-156). `paso_meta` abre su pista y, si la llamada lanza, no la cierra (pasos.py:4324-4328), mientras el cierre se traga la excepción (corrida.py:2113-2115). Las pistas de fondo (revisión pedida, reproducción) se cuelgan de la última iteración de la corrida aunque esté cerrada. La rama de PresupuestoAgotado de `_ejecutar_paso` (1971-1973) tampoco cierra las pistas en curso.

**Escenario.** La pantalla y el registro que lee el revisor enseñan tareas "empezando" que nunca van a terminar, en iteraciones ya cerradas, y ningún reinicio las limpia.

**Evidencia.** Estado real: pi-mubl3c3y-1547 "Meta-revisión y panorama", en_curso desde el 21-09 en la iteración 1 de la corrida 14 (cerrada a las 14:33:58); pi-mu2v4qp2-6704 "Revisión pedida: La normalización de P-tau181..." en la iteración 4 de cor-mu2sz2th-52, cerrada el 15-09; y dos "Reproduccion: Blalock et al., 2004" en cor-mtvueyz4-1. Todas con 0 líneas.

**Propuesta.** En `recuperar_tras_reinicio`, marcar como fallidas con motivo las pistas en_curso de todas las iteraciones. En `paso_meta`, envolver la llamada y usar `pista.fallar` si falla. En la rama de presupuesto de `_ejecutar_paso`, cerrar las pistas del paso igual que en las otras ramas.

**Escéptico.** Código: recuperar_tras_reinicio (corrida.py:155-156) salta las iteraciones con terminadaEn. paso_meta (pasos.py:4324-4328) abre la pista y llama al modelo sin try. El cierre se traga la excepción (2113-2115) y marca metaHecha. La rama de PresupuestoAgotado de _ejecutar_paso (1971-1973) no cierra las pistas. Datos: en rosa.db hay exactamente las 4 pistas en_curso citadas, todas en iteraciones cerradas y con 0 líneas: pi-mubl3c3y-1547 (corrida 14, cerrada a las 14:33:58), pi-mu2v4qp2-6704 (cor-mu2sz2th-52) y las dos de Blalock en cor-mtvueyz4-1. El efecto se queda en la pantalla y el registro.

## [CONFIRMADO · baja · ineficiencia] La revisión inicial de Opus ya pagada se pierde si falla la evaluación de un supuesto

`rosa/bucle/pasos.py:3551`

**Qué pasa.** La revisión inicial (Opus) y los supuestos (Sonnet) se guardan en una sola mutación al final (3555-3591). Si una evaluación lanza ModeloSinRespuesta o PresupuestoAgotado, `_en_paralelo` cancela las demás y no se guarda nada, tampoco `_revisionInicialVersion`. El reintento vuelve a pagar la revisión inicial y los supuestos que ya se habían evaluado.

**Escenario.** Una revisión pedida con 8 supuestos: Opus responde a la revisión inicial, se evalúan 5 supuestos y el sexto cae porque Sonnet no responde. Se pierden 6 llamadas pagadas, y cuando Sonnet vuelve se repiten todas.

**Evidencia.** Test `test_revision_inicial_pagada_se_pierde_si_cae_un_supuesto`: 1 llamada a revisar_inicial, la excepción sale, y `_revisionInicialVersion` y `ultimaRevisionAutomatica` quedan en None.

**Propuesta.** Guardar la revisión inicial, con `_revisionInicialVersion`, en su propia mutación en cuanto llega, y guardar aparte las evaluaciones de supuestos terminadas para reutilizarlas en el reintento.

**Escéptico.** _revisar_hipotesis (pasos.py:3496-3595) hace la revisión inicial y después evalúa los supuestos con _en_paralelo (3551). Si uno lanza ModeloSinRespuesta o PresupuestoAgotado, _en_paralelo (122-158) cancela los demás y relanza. Todo se guarda en una sola mutación al final, _revisionInicialVersion incluido, así que al reintentar ya_revisada es False y la revisión inicial se paga otra vez. El test del cazador pasa: 1 llamada a revisar_inicial, la excepción sale, y _revisionInicialVersion y ultimaRevisionAutomatica quedan en None. Es una ineficiencia acotada a las caídas del modelo.

## [CONFIRMADO · baja · fallo] Los aciertos de caché cuentan como llamadas gastadas del presupuesto

`rosa/modulos/contador.py:164`

**Qué pasa.** `sumar` suma 1 a `gasto.llamadas` y al `usado` de la iteración por cada fin de llamada sin excepción, también cuando DSPy responde desde la caché: `usage` llega vacío, 0 tokens y 0 USD. La caché se deja encendida a propósito para que "los repetidos salgan gratis" (gateway.py:46-50), y salen gratis en dinero pero no en el tope. El arreglo propuesto en S-20 (REVISION-BUGS-2026-09-17.md:411) quería sacarlos del presupuesto, y eso no está hecho.

**Escenario.** Una iteración que repite juicios ya hechos agota su tope antes de tiempo, y `gasto.llamadas` no es el número de llamadas pagadas que ve la persona.

**Evidencia.** En `llamadas`, contando las filas con 0 tokens y menos de 50 ms, que son aciertos de caché: 42 de las 1770 que cuenta la corrida 16 y 68 de las 1142 de la 13. `gasto.llamadas` es igual al número de filas ok, aciertos incluidos. Desde el 19-09 son 102 de 2244 llamadas con corrida.

**Propuesta.** Detectar el acierto de caché (`cache_hit` o `usage` vacío con ms bajos) y registrarlo aparte, sin sumarlo a `llamadas` ni al `usado` de la iteración.

**Escéptico.** En DSPy 3.3.1 (instalado en .venv), BaseLM.__call__ y acall llevan @with_callbacks (base_lm.py:321 y 375), y un acierto de caché devuelve usage {} con cache_hit True (cache.py:149-157). Por tanto on_lm_end corre también en los aciertos. Contador.sumar (contador.py:158-173) suma 1 a gasto.llamadas y al usado de la iteración sin mirar cache_hit. Datos (rosa.db en solo lectura): corrida 16, 42 filas ok con 0 tokens y menos de 50 ms, de 1770 (gasto.llamadas es 1770, igual a las filas ok); corrida 13, 68 de 1142. Desde el 19-09 me salen 102 de 2216 llamadas ok con corrida; el cazador dice 2244, seguramente contando también las ok=0. S-20 (REVISION-BUGS-2026-09-17.md) proponía no sumarlos: no está hecho y TRASPASO no lo recoge como decisión. Es entre el 2 y el 6 % del tope.

## [CONFIRMADO · baja · ineficiencia] Una rama no ve las hipótesis ni las lecciones de su origen y las vuelve a proponer

`rosa/estado/acciones.py:1735`

**Qué pasa.** bifurcar_investigacion copia los hechos (copiar_hechos), pero no las hipótesis ni las lecciones. El generador solo ve las hipótesis de su propia investigación (contexto.py:294, pasos.py:3776); la búsqueda por significado del Killer, también (indice_semantico.py:254), y las lecciones van por investigación. Con el mismo objetivo, la rama vuelve a generar las hipótesis del origen y las hace pasar otra vez por el Killer, la novedad y el torneo.

**Escenario.** inv-mu1fyy6i-1 es una rama de inv-gfap creada el 14/09 con el mismo objetivo, y sus 5 hipótesis repiten las del origen. «La dosis de APOE ε4 amplía la brecha GFAP-NfL...» frente a «La dosis de APOE ε4 modifica la brecha...» tienen un coseno de 0,971. «Brecha GFAP-NfL corta como predictor incremental de progresión a MCI» frente a «Valor pronóstico incremental de la brecha GFAP-NfL para MCI» tienen 0,926.

**Evidencia.** Con los vectores ya guardados en el índice semántico (datos/_indice/rosa.db.db, leído en solo lectura): 7 pares de investigaciones distintas tienen coseno de 0,90 o más, y 5 de ellos son rama contra origen. Dentro de una misma investigación solo 1 par llega a 0,90 (máximo 0,904). La rama tiene 5 hipótesis y 0 lecciones.

**Propuesta.** Pasar al generador y al índice de la rama las hipótesis del origen como heredadas (solo lectura, con su veredicto del Killer) y copiar las lecciones de hipótesis, o exigir al crear la rama un motivo que cambie el objetivo. Medir: pares rama-origen con coseno de 0,90 o más (hoy 5).

**Escéptico.** Código: bifurcar_investigacion (acciones.py:1709-1736) copia en profundidad la investigación y copia los hechos, pero no las hipótesis ni las lecciones; hipotesis_existentes (contexto.py:294), hipotesis_parecidas (indice_semantico.py:254) y LEC.para (lecciones.py:149) filtran por investigacion_id; ramaDe no se lee en ningún sitio del backend. Vectores de datos/_indice/rosa.db.db (solo lectura): 7 pares de investigaciones distintas con coseno de 0,90 o más, 5 de ellos rama contra origen (0,971, 0,926, 0,903, 0,902 y 0,901), y el máximo dentro de una misma investigación es 0,904. Lecciones: 200 en inv-mu2sz2ns-3, 9 en inv-gfap y 0 en la rama. Matiz: el objetivo de la rama no es idéntico (añade «Rama: persigue una hipotesis que valga la pena llevar al laboratorio»), aunque la pregunta es la misma; UI-ROSA.md dice que las ramas son «para perseguir dos hipótesis rivales», así que dar a la rama el origen en solo lectura encaja con esa intención. Es un caso único, del 14/09.

## [CONFIRMADO · baja · fallo] «Evaluadas antes del 23 de septiembre» es falso para 16 de las 24 hipótesis evaluadas con la regla 2

`frontend/src/lib/desbloqueo.ts:378`

**Qué pasa.** LO_QUE_FALTABA[2] sitúa la regla 2 «antes del 23 de septiembre». Pero la regla 3 entró el 23 a las 12:19 (commit 25ddec4), y la reevaluación de esta mañana se hizo con la regla 2 entre las 11:00 y las 12:12. El comentario de la propia tabla promete que «nunca se nombra una fecha que no le corresponde».

**Escenario.** Estado real. «Qué desbloquea más» pintada dice: «190 de 190 supuestos flojos están por reevaluar, en 28 hipótesis: 4 evaluadas antes del 18 de septiembre...; 24 evaluadas antes del 23 de septiembre, cuando «sin evidencia» no decía...». 16 de esas 24 tienen el sello del 23/09, entre las 11:00:45 y las 12:12:25. Al elegir hip-mtxcyxox-61, con sello del 23/09 a las 11:48:10, el detalle dice «Sus supuestos se evaluaron antes del 23 de septiembre».

**Evidencia.** Texto pintado de desbloqueo para inv-gfap con el estado real; fechas supuestosEvaluados.en de las 28 hipótesis; vigenciaEnLlano(vigencia(hip-mtxcyxox-61)); git log: 25ddec4 el 2026-09-23 a las 12:19:50.

**Propuesta.** Nombrar la regla y no una fecha de corte («con la regla anterior a la de hoy, en la que «sin evidencia» no decía...»), o usar la fecha real del sello (evaluadosEn): «evaluada el 23 de septiembre a las 11:48 con la regla 2».

**Escéptico.** LO_QUE_FALTABA[2] está ahora en desbloqueo.ts:397. El commit 90b2727 (23/09 14:58, rehace Qué desbloquea más) movió la línea sin cambiar el texto. El texto sale en el title del aviso (Desbloqueo.tsx:208) y en cada tarjeta a través de vigenciaEnLlano (Desbloqueo.tsx:521). El texto «190 de 190 supuestos flojos...» que cita el hallazgo era de la versión anterior. En rosa.db hay 24 vivas con la regla 2, y 16 tienen sello del 23/09, entre las 11:00:45 y las 12:12:25. hip-mtxcyxox-61 lo tiene a las 11:48:10. Según git, 25ddec4 es del 2026-09-23 a las 12:19:50. «Antes del 23 de septiembre» es falso para esas 16, y el comentario de la tabla (392-394) promete lo contrario. TRASPASO (1787-1790) cuenta que el texto se cambió para no fechar mal lo evaluado con la regla 2, pero no recoge este caso.

## [CONFIRMADO · baja · riesgo] El botón «Reevaluar N hipótesis» cuenta menos hipótesis de las que piden los dos reductores

`frontend/src/pantallas/Desbloqueo.tsx:423`

**Qué pasa.** El botón cuenta t.porReevaluar (desbloqueo.ts:487), que exige tener supuestos flojos. Pero reevaluarSupuestos, en acciones.ts:563 y en reevaluar_supuestos de acciones.py, pide revisar toda hipótesis viva que no esté al día, tenga flojos o no. Cada revisión gasta llamadas (supuestos y Killer).

**Escenario.** Una hipótesis viva evaluada con la regla 2 que tenga todos sus supuestos respaldados o plausibles: vigencia().alDia es false (motivo 'regla'). No entra en porReevaluar ni suma en el botón, pero el reductor la marca y el bucle la revisa. Con el estado de hoy no pasa: las 28 tienen flojos y el botón dice 22, igual que el reductor. Pero en cuanto una hipótesis quede con todo respaldado, el botón se queda corto en el gasto que anuncia.

**Evidencia.** Medido en el estado real: el botón dice 22 y el reductor pide 22 (hoy no hay ningún caso). Código: desbloqueo.ts:487 `filas.filter((f) => !f.vigencia.alDia && f.pendientes.length + f.contradichos.length > 0)`; acciones.ts:563 `if (vigencia(h).alDia || h.supuestosEvaluados?.pedidaEn) return h;`; reevaluar_supuestos de acciones.py sigue la misma regla que el TS.

**Propuesta.** Usar el mismo criterio en los tres sitios: o el botón cuenta todas las que no están al día y no están pedidas, o los reductores (TS y Python a la vez) se limitan a las que tienen supuestos flojos, que son las que la pantalla dice que va a reevaluar.

**Escéptico.** porReevaluar (desbloqueo.ts:506) exige supuestos flojos. El botón cuenta sinPedir sobre porReevaluar (Desbloqueo.tsx:202 y 230, tras 90b2727). acciones.ts:563 y acciones.py:1187 marcan toda hipótesis viva que no está al día y no está pedida, tenga flojos o no. Con el estado real, el reductor pide 22, el botón dice 22 y no hay ninguna sin flojos, como dice el hallazgo. Reproduje la divergencia con vite-node sobre la muestra: una viva con un único supuesto respaldado y sello de la regla 2 no suma en el botón (2) y el reductor sí la marca (3). Es un riesgo latente que hoy no tiene ningún caso.

## [CONFIRMADO · baja · riesgo] El visor de la página del PDF pone la página citada y no la que el servidor pintó de verdad

`frontend/src/pantallas/Citas.tsx:388`

**Qué pasa.** Cuando la página citada no está dentro del PDF, pagina_marcada (rosa/citas.py:503-514) pinta la página donde encuentra el pasaje, o la primera, y lo avisa en las cabeceras X-Rosa-Pagina y X-Rosa-Marcado, puestas «para no prometer una marca que no está». La interfaz carga la imagen con <img src> y no lee ninguna. El botón, el alt y el número bajo la imagen dicen «Página {ficha.pagina} del PDF», y la nota de «sin marcar» depende de ficha.completo (el panel de texto), no de X-Rosa-Marcado.

**Escenario.** Una cita con localizador «página 70» en un PDF de 12 páginas cuyo pasaje está en la 7: la pantalla dice «Página 70 del PDF» y enseña la 7, o la 1 si no encuentra el pasaje. Hoy no ocurre: medí las 971 citas con PDF del estado real y todas citan una página que está dentro del PDF.

**Evidencia.** servidor.py:688-692 manda X-Rosa-Marcado, X-Rosa-Pagina y X-Rosa-Paginas; grep sobre frontend/src: nadie lee esas cabeceras; Citas.tsx:388 y 396-407.

**Propuesta.** Pedir la imagen con fetch (con el token), leer X-Rosa-Pagina y X-Rosa-Marcado, pasar un object URL al <img> y rotular con la página que de verdad se pintó. Si no coincide con la citada, decirlo: «La cita dice página 70, que no existe en este PDF; el pasaje está en la 7».

**Escéptico.** citas.py:500-514: si la página citada no está en el PDF, se pinta la del pasaje o la primera. servidor.py:687-689 manda X-Rosa-Marcado, X-Rosa-Pagina y X-Rosa-Paginas, y según grep nada en frontend/src las lee. Citas.tsx:383-396 rotula con ficha.pagina, y el alt y la nota (402-407) dependen de ficha.completo. Medí en solo lectura las 971 citas con PDF (17 PDF): ninguna cae fuera de rango, como dice el hallazgo. Pero la misma causa ya da un fallo visible hoy. En 10 citas (por ejemplo cor-mu36fyv2-9, af-mu36t32z-2436, página 5), ficha.completo es False y rectangulos_del_pasaje encuentra parte del pasaje en la página. La imagen sale con marca naranja (marcado 'si'), mientras el alt dice 'sin marcar: el pasaje no se encontró en ella' y la nota dice 'El pasaje no está en esta página, así que no hay nada que marcar'. Baja: en las 971 citas se enseña la página citada.

## [PLAUSIBLE · baja · seccion] «Evaluar» un criterio gasta hasta 12 llamadas al juez sin dar ninguna señal en pantalla

`frontend/src/datos/almacen.ts:918`

**Qué pasa.** acciones.evaluarAprendizaje solo llama a enviar(): no tiene reductor local, no devuelve la promesa, y el botón (Rosa2018.tsx:1410) ni se deshabilita ni marca que está en vuelo. El servidor guarda la petición en una clave privada (c["_evaluar"], acciones.py:501) que no viaja al navegador. Ni recargando se ve que hay una evaluación en cola o en curso hasta que termina.

**Escenario.** Estado real: hay 186 cambios de nivel 2 de tipo «criterio» en estado «propuesto», cada uno con su botón «Evaluar» en el Registro de aprendizaje (hasta 40 a la vista en modo Detalle). Como hay 2 hipótesis aceptadas por una persona, cada pulsación corre el Killer con y sin el criterio (_evaluar_cambio, corrida.py:777: hasta 6 hipótesis y 12 llamadas). La persona pulsa, no ve nada, pulsa otros «Evaluar», y el bucle los va atendiendo de uno en uno sin decir cuántos quedan.

**Evidencia.** almacen.ts:918-920 `evaluarAprendizaje: (cambioId) => { enviar('evaluarAprendizaje', ...) }`; el botón de Rosa2018.tsx:1410 no tiene disabled ni atributosEnVuelo; acciones.py:501 `c["_evaluar"] = ahora`; en el estado real hay 186 cambios de nivel 2, criterio, propuesto.

**Propuesta.** Guardar la petición en un campo público (por ejemplo evaluacionPedidaEn) con su reductor gemelo en acciones.ts, hacer que la acción devuelva la promesa de enviar() y envolver el botón con useEnVuelo. Pintar «Evaluación en cola» o «en curso» y deshabilitar el botón mientras dure.

**Escéptico.** El código es como dice el hallazgo. almacen.ts:918-920 no tiene reductor ni devuelve la promesa. El botón (Rosa2018.tsx:1410) no tiene disabled ni atributosEnVuelo. acciones.py:501 guarda c['_evaluar'], que _limpiar_para_cliente quita. Hay 186 cambios de nivel 2, tipo criterio, en estado propuesto. Pero el escenario no se cumple hoy. _evaluar_cambio (corrida.py:777) arma el conjunto reservado con decisiones de etapa 'persona' (aceptada o descartada), y rosa.db no tiene ninguna: solo 76 killer_1 y 2 killer_2. Las 2 aceptadas (hip-mtvwqw1i-37 y hip-mtvwqw1z-46) no tienen su decisión registrada. Con el conjunto vacío, cada pulsación gasta 0 llamadas y en el tic siguiente se fija la nota 'Sin conjunto reservado todavía', que la tarjeta pinta. El gasto de hasta 12 llamadas sin señal (6 hipótesis y 2 pasadas) solo llegará cuando haya decisiones humanas nuevas; revisar_hipotesis ya las registra (acciones.py:482). Aparte: con 0 casos, _fijar_evaluacion escribe el evento 'Criterio evaluado sobre 0 casos: acuerdo None antes, None después', con el None de Python en un texto que se ve.

## [SIN VERIFICAR · baja · fallo] El revisor con ReAct hace de 2 a 5 llamadas a Opus, pero las dos estimaciones del cierre siguen contando 1

`rosa/bucle/corrida.py:2443`

**Qué pasa.** Desde e0381a1, revisar_registro es dspy.ReAct con max_iters=4 (firmas.py:1206): hasta 4 llamadas de razonamiento más la de extracción, y cada una reenvía texto, registro y la trayectoria acumulada. desglose_previsto_del_cierre (2443) y coste_estimado_del_cierre (2406) siguen reservando 1 llamada, y dos tests fijan ese 1 (test_tanda2_cierre.py:200 y test_tanda2_cierre_reparacion.py:264).

**Escenario.** Cada cierre se pasa de su reserva en al menos 1 llamada y hasta en 4. El aviso de pausa del cierre («necesita unas N llamadas») se queda corto. El revisor pasa a costar de 2 a 5 veces lo de antes: la versión ChainOfThought mandaba 13.817 caracteres de media, medidos en 39 llamadas.

**Evidencia.** Lo conté sin red, con DummyLM sobre el programa real de Programas(). Salida: «termina en la primera vuelta: 2 llamadas al modelo»; «usa las cuatro vueltas: 5 llamadas al modelo». TRASPASO documenta que el revisor puede pasarse del tope en hasta cuatro llamadas, pero no que la estimación del cierre siga en 1.

**Propuesta.** Reservar MAX_VUELTAS_REVISOR + 1 en las dos estimaciones y ajustar los dos tests, o comprobar el presupuesto dentro del bucle de ReAct.

## [SIN VERIFICAR · baja · ineficiencia] MLflow guarda cada prompt tres veces, sin lector ni retención: 720 MB

`rosa/main.py:46`

**Qué pasa.** mlflow.dspy.autolog(log_traces=True) escribe la traza de cada llamada en mlflow.db, y el mismo prompt queda guardado en ChatAdapter.format, en LM.__call__ y en Predict.forward. Nada en rosa/ ni en frontend/ lee esas trazas y no tienen retención. GEPA ya guarda sus propias trazas, con retención, en datos/_gepa (163 MB).

**Escenario.** En un día de corrida (22 sep, 1.755 trazas a 69 KB de media) mlflow.db crece unos 120 MB, y el exportador serializa decenas de KB por llamada dentro del proceso del bucle.

**Evidencia.** du da 720 MB para mlflow.db. Son 9.524 trazas con 657 MB de carga útil. Por nombre de span: ChatAdapter.format 221,6 MB, LM.__call__ 148,1 MB y Predict.forward 109,5 MB (SQL en solo lectura).

**Propuesta.** Apagar log_traces en el servidor, o muestrear, y dejarlo para sesiones de depuración; o añadirle retención.

## [SIN VERIFICAR · baja · fallo] Incidencias que se quedan pendientes para siempre aunque su causa ya pasó

`rosa/bucle/corrida.py:3294`

**Qué pasa.** Al cerrar o detener una corrida solo se resuelven las incidencias `modelo_sin_respuesta`. Las de `juez_sin_respuesta` y `modelo_bloqueado` siguen pendientes aunque la hipótesis se haya juzgado después o la corrida haya terminado. Las de parseo se titulan «no respondió» cuando el juez sí respondió y fue el adaptador el que no pudo leer la respuesta.

**Escenario.** Hay 6 incidencias pendientes. 3 son «El Killer no pudo juzgar» de hipótesis que el Killer juzgó bien después: hip-mu2zz5y8-2440 el 18 sep a las 14:58, hip-mu2uqqzu-5871 el 18 sep a las 16:14 y hip-mu2uajpx-4553 el 22 sep a las 14:57. 2 son `modelo_bloqueado` de las corridas 12 y 13, terminadas el 17 y el 18 sep. La sexta es la falta de saldo de la corrida 14, detenida.

**Evidencia.** corrida.py:3294-3308, que solo filtra `tipo == "modelo_sin_respuesta"`. `incidencias[].estado == "pendiente"` cruzado con `decisiones` y con el estado de las corridas.

**Propuesta.** Resolver `juez_sin_respuesta` cuando llega una decisión del Killer con juez sobre ese recurso, y resolver `modelo_bloqueado` al terminar o detener su corrida. Titular las de AdapterParseError como «respuesta que no se pudo leer».

## [SIN VERIFICAR · baja · riesgo] Dos aserciones del camino de las citas no pueden fallar, y las dos vigilan código muerto

`rosa/tests/test_tanda1_verificador.py:116`

**Qué pasa.** La línea 116 («resuelve por la cola») termina en 'is None or True'. Con la cita que usa no resuelve, y comprobar_determinista da cita_no_resuelve, justo lo contrario del comentario. Aparte, test_tanda1_cierre.py:275 afirma que la extracción no reabre el PDF espiando pdf.fragmento_en_pagina, una función que ningún código de producción llama: el espía no puede dispararse.

**Escenario.** Mutación en una copia: eliminar entera la rama por_cola de candidatos_cita (verificador.py:580) deja pasar los 1790 tests. Una regresión que reabriera el PDF por afirmación con pymupdf.open o pdf.paginas tampoco rompería la aserción de test_tanda1_cierre.py:275.

**Evidencia.** V.resolver_cita('[Cummings 2026 (resumen)]', frags, 'f-res') devuelve None, mientras '[Cummings 2026 resumen]' sí resuelve por la cola. fragmento_en_pagina solo aparece en rosa/fuentes/pdf.py:171 y en tests. En el estado real, 0 de 4747 citas se salen del patrón, así que la rama por_cola no se usa. [M2_cita_por_cola_eliminada] SOBREVIVE.

**Propuesta.** O borrar la rama por_cola y fragmento_en_pagina con sus tests, o probar la rama con '[Cummings 2026 resumen]' y sin 'or True'. El espía de test_tanda1_cierre.py:258 debería ir sobre pymupdf.open o pdf.paginas.

## [SIN VERIFICAR · baja · riesgo] Los tests escriben en el directorio real de datos del repositorio

`rosa/tests/test_tanda1_cierre.py:150`

**Qué pasa.** test_tanda1_cierre.py:150 y 158 y test_auditoria2.py:159 y 168 suben ficheros por la API de un servidor de prueba sin redirigir D.DIR_DATOS ni D.DIR_DATASETS. Cada pasada crea directorios en datos/ del repositorio (gitignorado), mezclados con los datos reales de laboratorio. Los tests también leen el token interno real de datos/_token_interno, y lo crean ahí si falta.

**Escenario.** Mis pasadas crearon, por ejemplo, datos/hip-muefwb3x-1167/r.csv y datos/_datasets/inv-muefuyht-1164/ds-muefuyhy-1165/t.csv: 24 ficheros nuevos en la última hora. Hay 417 directorios hip-* que no corresponden a ninguna hipótesis del estado real y 265 t.csv, acumulados desde el 14 de septiembre.

**Evidencia.** rosa/datos.py:21 define DIR_DATOS = RAIZ/'datos'. Solo test_integracion_corrida.py:223 lo redirige a tmp_path.

**Propuesta.** Un fixture autouse en rosa/tests/conftest.py que redirija DIR_DATOS, DIR_DATASETS, ejecucion.DIR_TRABAJO y la ruta del token interno a tmp_path.

## [SIN VERIFICAR · baja · riesgo] Los tres tests sobre el estado real no corren nunca, y uno tiene una precondición caducada

`rosa/tests/test_tanda1_almacen_servidor.py:48`

**Qué pasa.** test_tanda1_almacen_servidor.py:48 y test_bucle_iteracion.py:66 apuntan a un fichero del scratchpad de una sesión concreta de Claude (/private/tmp/claude-502/.../scratchpad/estado_ahora.json). test_tanda1_corrida.py:37 usa una variable de entorno cuyo valor por defecto no existe. Los tres se saltan siempre, y entre ellos está el único test de que el estado real carga con las migraciones nuevas.

**Escenario.** Los ejecuté llamando a las funciones sobre un volcado de solo lectura del estado (versión 28161). test_el_estado_real_carga_con_las_migraciones_nuevas y test_las_frases_de_la_cola_por_regla_sobre_el_estado_real_van_con_tildes pasan. test_sobre_el_estado_real_las_nuevas_fantasma_desaparecen_y_la_cola_se_cuenta_bien falla en la línea 706: espera antes[12] == [3, 2, 2] y hoy es [0, 0, 0].

**Evidencia.** pytest -rs: «SKIPPED sin copia del estado real» y «no está la copia del estado real» en los tres.

**Propuesta.** Usar una sola variable ROSA_ESTADO_REAL para los tres y volcar el estado en solo lectura antes de cada pase de cierre de bloque. Quitar o actualizar la precondición de la línea 706.

## [SIN VERIFICAR · baja · ineficiencia] La calculadora del juez anuncia round, pero round con decimales falla siempre

`rosa/revisor_registro.py:711`

**Qué pasa.** _evaluar convierte todos los números a float, así que round(x, 1) llega como round(x, 1.0) y lanza TypeError. La docstring de calcular, que DSPy le pasa al juez como descripción de la herramienta, dice que admite round. Cada intento fallido gasta una de las cuatro vueltas del ReAct con Opus.

**Escenario.** calcular('round(0.2195/0.0149, 1)') devuelve «No se pudo calcular ...: 'float' object cannot be interpreted as an integer». calcular('round(14.7315)') sí funciona.

**Evidencia.** _FUNCIONES en revisor_registro.py:689 incluye round. test_calcular_hace_la_cuenta (test_juez_recalcula.py:97) no prueba round con dos argumentos.

**Propuesta.** Convertir a int el segundo argumento de round cuando sea entero, y añadir 'round(2.5553, 2)' a los casos del test.
