---
name: patentes-tratamiento
description: Contrastar un tratamiento con publicaciones de patentes y conservar su alcance jurídico comprobable.
activa_si: patentes, reivindicaciones, propiedad intelectual
contexto: tratamiento, mision
paquetes:
entorno: tabular
---

Identificar composición, molécula o secuencia, modalidad, diana y dirección,
combinación, formulación, vía e indicación. Si algo esencial no está definido,
no afirmar coincidencia exacta. Un procedimiento experimental de banco no es
automáticamente un tratamiento clínico.

Revisar las reivindicaciones disponibles: composición, uso terapéutico,
formulación, combinación y administración pueden tener coberturas diferentes.
Separar solicitud publicada, concesión, familia y miembro territorial. Identificar
titular/solicitante y fechas únicamente cuando estén documentados. Un título,
resumen o la misma diana no demuestran equivalencia ni derechos vigentes.

La recuperación consulta obligatoriamente Google Patents mediante SerpApi antes
de las fuentes complementarias. SerpApi es un proveedor independiente, no una
API oficial de Google. Exa y Orange Book no sustituyen esa consulta. Si falta
acceso, falla una petición o se limita la cobertura, dejarlo explícito aunque
haya hallazgos. Las reivindicaciones fuera del texto acotado no se consideran
leídas ni sirven como citas del dictamen.

Clasificar cada coincidencia: mismo tratamiento, componente de combinación,
misma diana, mismo mecanismo, relacionado o incierto. Copiar un pasaje literal
continuo y su documento exacto, con las diferencias frente a ROSA. No sumar
porcentajes de confianza ni usar puntuación semántica como prueba jurídica.

Orange Book recoge patentes listadas para determinados productos aprobados en
Estados Unidos. Expiración declarada no certifica vigencia o permiso de uso.
Google Patents facilita descubrimiento; su estado/titularidad necesita revisión
registral. No se ha consultado un servicio oficial protegido si faltó acceso.

Dejar consultas, fecha, páginas, truncamiento y errores visibles. Cero resultados
no demuestra ausencia: la cobertura territorial es incompleta y existen
solicitudes todavía no publicadas. No emitir libertad de operación automática
ni sugerir descartar una hipótesis científicamente válida por tener patente.
La revisión humana decide qué hacer con el hallazgo.

Fuentes de método: https://www.epo.org/en/searching-for-patents/data/web-services/ops
https://www.wipo.int/en/web/patents/protection
https://open.fda.gov/apis/drug/orangebook/example-api-queries/
https://support.google.com/faqs/answer/7049585?hl=en
https://serpapi.com/google-patents-api
https://serpapi.com/google-patents-details-api
