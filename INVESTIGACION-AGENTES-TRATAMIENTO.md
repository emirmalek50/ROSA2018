# Especialistas de tratamiento de ROSA2018

Implementación del 7 de octubre de 2026. Dos funciones separadas revisan el
tratamiento de cada hipótesis durante una corrida: **Sofía**, especialista en
patentes, y **Damián**, especialista en programas de compañías. Son funciones
del equipo de ROSA, no fuentes independientes de eficacia ni asesoría jurídica.

## Ejecución y modelos

El cerebro configurado de la corrida define la identidad: molécula/secuencia,
modalidad, dirección, indicación, combinación, formulación, vía y dosis. Cada
especialista razona con ese mismo cerebro y su protocolo de método. El juez
configurado audita el informe por separado. Todas las llamadas pasan por
`Ctx.llamar`, el contador, la vigilancia y el AI Gateway de Vercel. El modelo
de volumen no decide estos informes; los IDs reales de cerebro/juez quedan
registrados para comprobar qué modelos se usaron.

El inventario de documentos delimita lo que ambos modelos pudieron leer. Una
barrera determinista rechaza IDs desconocidos, citas ausentes y pasajes de
documentos omitidos. Las coincidencias distinguen tratamiento exacto,
componente de combinación, diana, mecanismo y relación incierta. Los hallazgos
no alteran aceptación humana, veredictos científicos ni certeza GRADE.

Se ejecutan antes de revisar las hipótesis y en el paso de novedad, aunque la
novedad antigua ya estuviera resuelta. Si el experimento concreta otra
intervención, se revisa esa nueva versión durante una corrida activa. Hasta
seis hipótesis por barrido, con turno por último intento para evitar inanición.
El presupuesto reserva hasta 30 llamadas por barrido: un perfil y dos parejas
especialista/juez por hipótesis. Búsquedas e informes completos se reutilizan
al reanudar; fuentes y borradores pendientes permanecen privados. Otra corrida
actualiza las fuentes. Cambiar la propuesta invalida los informes anteriores;
un resultado tardío no se aplica a otra versión ni a una hipótesis eliminada.

## Fuentes y cobertura real

**Patentes:** Exa descubre publicaciones en Google Patents, WIPO, EPO y USPTO
y recupera sus textos. Cuatro consultas como máximo y lectura de ocho páginas
de patente hasta 12.000 caracteres cada una. Exa no devuelve un censo mundial,
por lo que sus consultas nunca se marcan exhaustivas. Los resúmenes y cortes
se señalan. Orange Book de openFDA permite consultar ingredientes exactos de
productos estadounidenses aprobados, hasta tres páginas de 100 productos por
ingrediente y ocho patentes únicas. Se conservan composición, solicitud,
número de patente, fechas declaradas e indicadores originales.

El endpoint público comprobado es
`https://api.fda.gov/drug/orangebook.json`; el ensayo de conectividad real con
SEMAGLUTIDE respondió con 29 productos. No se añadieron credenciales.
[Consultas de openFDA](https://open.fda.gov/apis/drug/orangebook/example-api-queries/),
[campos del registro](https://open.fda.gov/fields/drugorangebook.yaml),
[datos Orange Book de FDA](https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files).

Descubrir una publicación no certifica reivindicaciones vigentes ni libertad
de operación. No se simula acceso autenticado a EPO OPS, USPTO ODP o los
servicios de WIPO. La API antigua de PatentsView ha migrado; no se introdujo
como dependencia ficticia. También quedan fuera solicitudes no publicadas y
parte de la cobertura territorial.
[EPO OPS](https://www.epo.org/en/searching-for-patents/data/web-services/ops),
[migración de PatentsView](https://www.uspto.gov/subscription-center/2026/patentsview-migrating-uspto-open-data-portal-march-20),
[cobertura de Google Patents](https://support.google.com/faqs/answer/7049585?hl=en).

**Compañías:** ClinicalTrials.gov API v2 busca nombres de intervención sin
filtro de enfermedad, país o estado. Hasta seis términos, tres páginas de
50 estudios por término. Conserva NCT, patrocinador/colaboradores y su clase,
alias, brazos, fases, estados, fechas, causas de parada y resultados publicados.
Un ensayo académico solo acredita compañía si existe participación industrial
documentada. Exa busca además programas preclínicos e históricos en la web,
con lectura acotada de los dos primeros términos. Fuentes secundarias son
pistas; no se presentan como programa corporativo confirmado.
[ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api),
[alcance del registro según NLM](https://support.nlm.nih.gov/knowledgebase/article/KA-03869/en-us).

No se ha integrado el servicio protegido de ICTRP ni una API de CTIS. Ninguna
combinación de estas consultas permite certificar que ninguna compañía del
mundo haya investigado un tratamiento.
[Registros internacionales de la OMS](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal).

## Resultado visible

`hipotesis.revisionTratamiento` contiene perfil y dos informes independientes,
fecha, modelos, citas, URLs, diferencias, consultas, paginación, errores y
limitaciones. Los informes completos tienen su pantalla **Novedad** en cada
investigación, con índice de tratamientos y acceso separado a cada especialista.
La pestaña de evidencia de la hipótesis enlaza directamente a ambos dossiers.
En el laboratorio pixel art, Sofía y Damián comparten un cuarto propio sin
otros agentes. Pulsar su personaje abre Novedad con su informe y la hipótesis
asociada al registro real de la iteración; si ese registro antiguo no guarda
la asociación, se abre el índice del especialista sin adivinar un tratamiento.
La selección queda en la URL para conservarla al recargar o volver atrás.
La novedad previa sigue
existiendo: anterioridad científica y propiedad intelectual son cuestiones
distintas. Las conclusiones reciben el dossier completo; nuevas fuentes
invalidan su huella, volver a consultar lo mismo no la cambia por una fecha.

Estados: coincidencias documentadas, sin coincidencias en las fuentes
consultadas, no comprobado o no aplica a una propuesta observacional. Nunca
se convierte un error/timeout en ausencia, ni una patente expirada en libertad
de operación. Una parada administrativa de ensayo no demuestra ineficacia.
La prosa sigue el traductor existente ES/EN; citas, nombres e identificadores
originales quedan protegidos.

Las pruebas usan modelos y fuentes sustituidos, sin pagar corridas reales.
Cubren citas inventadas, fuentes caídas, paginación/truncamiento, identidad
incompleta, patrocinio académico, cambios/borrado durante llamadas, concurrencia,
checkpoint de borrador y juez, presupuesto, refresco por corrida y presentación
de escritorio/móvil en ambos idiomas.
