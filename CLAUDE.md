# ROSA2018

Este repositorio es ROSA2018, la IA del proyecto Alzheimer de AI Robotix y el
INTEC. Antes de tocar nada, leer en este orden:

1. `TRASPASO.md`: decisiones tomadas, reglas de trabajo de la persona responsable, modelos
   elegidos y por que, contratos del verificador que hay que conservar, plan.
2. `GUIA-ROSA.md`: el conocimiento de fondo (Alzheimer a nivel de ingeniero,
   fuentes de datos y sus APIs, DSPy y GEPA con la API exacta, evaluacion,
   marco legal dominicano).
3. `UI-ROSA.md`: la interfaz, patron por patron, tomando Claude Science como
   referencia y a�adiendo lo que ROSA2018 necesita y aquella no tiene.
4. `INVESTIGACION-INTERFACES.md`: lo que hacen Claude Science, Kosmos,
   Co-Scientist, Biomni y las herramientas de literatura, y la lista
   priorizada de lo que le falta al frontend de ROSA2018.
5. `INVESTIGACION-BACKEND.md`: los AI scientists estudiados a nivel de codigo
   (Kosmos, Co-Scientist, PaperQA, Robin, Agent Laboratory, Denario, Curie,
   SciAgents, ResearchAgent, HypoGeniC, Biomni), las APIs de las fuentes con
   sus limites reales, y la arquitectura del backend que se construyo.
6. `INVESTIGACION-CONCLUSIONES.md`: como presentan sus conclusiones los AI
   scientists y las herramientas de literatura, las convenciones de la
   medicina basada en evidencia (GRADE, Cochrane, AAN, IPCC, ICD 203) y lo que
   se fusiono en la "Conclusion de ROSA2018" y el resumen de cada iteracion.
7. `ROSA2018_SYSTEM_PLAN.md`: el plan completo del sistema (10 de septiembre
   de 2026), tal como lo mando la persona responsable del programa. Es el
   documento que manda sobre la arquitectura; el concepto del MVP es su
   primer demostrador.
8. `PLAN-ROSA2018.md`: los dos documentos del programa (el concepto del MVP
   del 31 de octubre y el plan completo del sistema en etapas A a G) mapeados
   a lo que ROSA2018 tiene y le falta, con el orden de trabajo. Manda sobre el
   alcance.
9. `INVESTIGACION-ROSA2018.md`: los cuatro informes (Killer, procedencia,
   ejecucion in silico, priorizacion y aprendizaje) que sostienen las
   decisiones de dise�o de ROSA2018 en ROSA2018, con URL por afirmacion.
10. `INVESTIGACION-SECCIONES-2026-09-22.md`: qué secciones interactivas
    construir y en qué orden, cruzando las herramientas de referencia
    comprobadas una a una (AI scientists, literatura, GRADE, portales de
    Alzheimer, procedencia, visualización causal), la auditoría de qué datos
    tiene ya cada candidata con fichero y línea, y el criterio del plan del
    sistema (reconstruir y cuestionar decisiones).
11. `README.md`: como arrancar ROSA2018 y como se investiga con ella.

`casos_evaluacion.jsonl` son los 17 casos de control del RAG anterior, todos
sin aprobar por un humano.

## Estructura

- `rosa/`: el backend en Python (DSPy, GEPA, FastAPI, SQLite). El estado
  canonico tiene la misma forma que `frontend/src/datos/tipos.ts`; los
  reducers de la interfaz estan portados uno a uno en
  `rosa/estado/acciones.py` (misma regla en los dos lados). El bucle
  (`rosa/bucle/`) escribe en ese estado; el servidor (`rosa/servidor.py`) lo
  sirve por `/api/estado`, lo empuja por SSE en `/api/eventos` y recibe las
  acciones en `POST /api/acciones/{nombre}`. Arranque: `uv run python -m
  rosa.main` o `./rosa.sh` (servidor mas interfaz).
  Piezas con regla propia: `rosa/killer.py` (Killer, misma cohorte,
  direccion y unidades), `rosa/causal.py` (grafo causal tipado, base
  curada), `rosa/torneo.py` (Elo y Bradley-Terry), `rosa/secuencial.py`
  (e-valores), `rosa/priorizacion.py`, `rosa/politicas.py`, y
  `rosa/evaluacion/panel_killer.py` (panel con fallos plantados; cuesta
  llamadas al juez, no correrlo sin motivo). Lo tomado de Claude Science:
  `rosa/conectores/` (80 conectores a bases publicas con registro de
  consulta e invariante; los inertes llevan motivo), `rosa/herramientas.py`
  (ReAct acotado con conectores, busqueda en el proyecto y modelo de mundo),
  `rosa/revisor_registro.py` (seis clases de hallazgo al cerrar iteracion y
  dossier), `rosa/skills/` (SKILL.md por metodo, cargadas por palabras de
  activacion) y `rosa/sandbox/Dockerfile.celula` (segundo entorno). Ver
  `INVESTIGACION-HERRAMIENTAS-CLAUDE-SCIENCE.md`. Del 14 de septiembre:
  `rosa/sesgo.py` (riesgo de sesgo por instrumento, veredicto por regla),
  `rosa/acuerdo.py` y `rosa/acuerdo_dorado.py` (kappa, conjunto dorado),
  `rosa/sello.py` (RFC 3161), `rosa/prisma.py` (PRISMA 2020 y trAIce),
  `rosa/sintetico.py` (ensayo en seco), `rosa/ontologias.py` (entidades
  canonicas), `rosa/costes.py`, `rosa/rocrate.py` (RO-Crate con PROV),
  `rosa/parada.py`. Ver `INVESTIGACION-AI-SCIENTIST-2026.md`.
  Del 30 de septiembre y el 1 de octubre, el diseño de oligos antisentido:
  `rosa/aso.py` (gapmer 5-10-5 por regla desde la secuencia del transcrito;
  la accesibilidad pesa en qué candidatos se eligen, y un CpG avisa en vez de
  vetar porque la 5-metilcitosina de la arquitectura ya lo cubre),
  `rosa/criba.py` (cribado contra los 669.547 transcritos humanos de Ensembl:
  con BLAST tolera fallos y decide por si el HUECO de ADN encaja, que es lo
  que lee la RNasa H1, con el azar MEDIDO sobre 300 secuencias aleatorias; sin
  BLAST cae al barrido exacto, en procesos hijos porque `bytes.find` no suelta
  el GIL), `rosa/plegado.py` (accesibilidad del sitio con RNAplfold de
  ViennaRNA: si el ARN está abierto ahí o plegado sobre sí mismo) y
  `rosa/duplex.py` (la geometría para dibujar la dúplex; es un esquema con los
  parámetros publicados, NO una estructura, y por eso no lleva coordenadas
  atómicas), `rosa/especie.py` (si el mismo oligo se puede probar en un ROEDOR,
  ratón o rata, que es donde se investiga; misma regla del hueco usada al
  revés, y el gen equivalente se busca por el nombre, que es heurístico y
  falla en CA2, que en ratón es Car2) y
  `rosa/fiabilidad.py` (de qué fiarse y de qué no, por niveles: lo exacto, lo
  modelado, la estadística y lo que decidió ROSA2018 y nadie ha validado; va a
  la pantalla y al texto del pedido). Ver `PENDIENTE.md`.

  Lo que hace falta en la máquina y NO se versiona (todo bajo `datos/`, que
  está en `.gitignore`):
  - `datos/_transcriptoma/cdna.fa.gz` y `ncrna.fa.gz`: 225 MB de Ensembl
    GRCh38. Las URL están en `rosa/criba.py` (`DE_DONDE`).
  - Los transcriptomas de los roedores, para saber si el oligo se puede
    probar en un animal: ratón (`raton_*.fa.gz`, GRCm39, 156 MB) y rata
    (`rata_*.fa.gz`, GRCr8, 57 MB). Las URL están en `rosa/especie.py`
    (`ESPECIES[clave]["de"]`).
  - `datos/_transcriptoma/blastdb/` (humano, ratón y rata) y los mapas
    `mapa.tsv`, `mapa_raton.tsv` y `mapa_rata.tsv`:
    los índices de BLAST y los mapas de transcrito a gen y locus, que se
    construyen de esos ficheros.
  - `datos/_herramientas/ncbi-blast-2.17.0+/`: el binario aarch64 de NCBI.
  - `ViennaRNA` en el entorno (`uv pip install ViennaRNA`).
  Sin cualquiera de ellos la pantalla dice «no pude comprobar» con su motivo,
  nunca «limpio» ni «tapado». Falta un botón que los traiga: la persona
  usuaria no abre la terminal.
- `frontend/`: la interfaz web de ROSA2018 (React, Vite, TypeScript). Ver su
  `README.md`. `frontend/src/datos/almacen.ts` prueba el servidor al arrancar
  y, si no responde, cae a los datos de muestra con la corrida simulada.
- Los datos de trabajo de una corrida (fuentes con fragmentos, afirmaciones
  con veredicto) viven en claves privadas de la corrida que empiezan por `_`
  y no viajan al navegador.

## Reglas que no se negocian

- Modelos solo por el AI Gateway de Vercel, nunca por APIs directas. El
  coste por token no es criterio. Claude Fable 5.1 queda fuera de ROSA2018
  (filtros de doble uso en biologia; ver `TRASPASO.md` 2.3).
- La persona usuaria es medica, no programadora: botones y estado visible,
  en espa�ol, nunca variables de entorno ni terminal.
- Las citas resuelven a la pagina exacta. Un desfase de una pagina es un
  fallo grave.
- Sin guiones largos (U+2014) en codigo, comentarios ni interfaz.
- Todo texto en castellano lleva sus tildes y sus ñ (regla de Emir, 14 de
  septiembre de 2026): cadenas de la interfaz, textos que genera el backend,
  docstrings, documentación, mensajes de commit y respuestas. Los
  identificadores (variables, claves, clases CSS, rutas, valores que se
  comparan con el servidor) se quedan sin acento. Revisión:
  `python3 scripts/acentuar.py --comprobar` en `frontend/` (sin `--comprobar`
  reescribe los ficheros) y `python3 scripts/acentuar_py.py --seco` en la raíz
  (sin `--seco` reescribe el árbol entero y ha corrompido identificadores); las palabras que cambian de sentido con la tilde se deciden a
  mano por contexto.
- Antes de cada commit, escanear `sk-proj-`, `sb_secret_`, `vcp_`, `vck_`,
  `github_pat_`, `ghp_`, `eyJhbGci`, `eyJ2MiI6`, `ntn_`, `secret_`, `GOCSPX-`.
  Lo hace `python3 scripts/escanear_secretos.py`. Antes de cada commit también
  `uvx ruff check rosa scripts` (config en `ruff.toml`) y
  `./.venv/bin/python scripts/trinquete_mypy.py` (falla si suben los errores de
  tipos; si bajan, bajar `LIMITE`). El CI de GitHub (`.github/workflows/ci.yml`)
  corre todo eso más los tests de backend y frontend en cada push a `main`.
- El servidor se para SOLO con `./.venv/bin/python scripts/parar_servidor.py`,
  que se niega si hay una corrida viva (en marcha, esperando aprobación,
  esperando plan o esperando modelo) y sale con código 2 sin tocar nada; para
  reiniciar, `./scripts/reiniciar_servidor.sh`, que no arranca nada si la
  parada no se completó. Nada de `kill` a mano: la regla escrita ya se saltó
  una vez (22 de septiembre de 2026: se comprobó que la corrida 16 estaba en
  marcha y se paró igual), y dos procesos escribiendo a la vez bifurcan el
  registro de auditoría, como pasó el 15 de septiembre. Con `--estado` se
  consulta sin tocar; `--forzar` exige `--motivo` escrito y es para un servidor
  colgado, no para desplegar.
- Commit y push al cerrar cada bloque de trabajo, sin esperar a que se pida
  (regla de Emir, 11 de septiembre de 2026), con los tests pasando y el
  escaneo de secretos limpio. Remoto `origin`, rama `main`.
- La marca grafica de ROSA2018 es el arbol del Alzheimer Project; no se usa el
  logo de AI Robotix.
- Intentar romper el propio cambio antes de cerrarlo: test adversarial,
  camino de punta a punta, y preguntarse que asume el cambio que antes no.
- Una fuente que no responde es "no pude comprobar", nunca "no hay". Un
  tiempo agotado no es "sin ensayos".
- Al modelo de mundo solo entran afirmaciones sostenidas o parciales; las
  hipotesis nuevas entran a la cola como propuestas y las decide una persona.
- Mientras se construye algo, se explica como funciona: quien opera ROSA2018 es
  el ingeniero de IA que la construye, no la medica; necesita entender la
  ingenieria y el dominio, con los conceptos por su nombre y su definicion.
- Las conclusiones de ROSA2018 siguen GRADE: certeza y direccion por separado,
  factores que bajan o suben la certeza a la vista, frases plantilla por nivel
  generadas por regla, sin porcentajes de confianza inventados, sin
  "demostrado" ni "confirmado", sin recomendaciones clinicas.
- Sonnet nunca es el cerebro ni el juez: cuando Astra u Opus no responden se
  reintenta con el mismo modelo (rosa/vigilante_modelos.py); ver TRASPASO 7.4.
