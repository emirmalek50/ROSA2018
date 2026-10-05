# ROSA en un HTML

Copia interactiva para revisar el frontend sin instalar ROSA, entrar con una cuenta o tener un servidor. Compila las pantallas React, sus estilos y las fuentes en un único archivo. No es una colección de capturas.

Desde la raíz del proyecto:

```sh
node frontend/scripts/exportar-html.mjs
```

Se crea `frontend/dist-portatil/ROSA-interactivo.html`. También se puede indicar una ruta de salida como segundo argumento. El destinatario abre el HTML con doble clic. No debe compartir el código fuente, el `.env` ni la base de datos para usarlo.

## Qué se puede probar

Navegación, nueva investigación, avance simulado, revisión de planes e hipótesis, ranking, búsqueda, modelo de mundo, formularios, ajustes, citas y fichas del laboratorio. El árbol conserva la vista plana. Las estructuras 3D se sustituyen por marcadores, sin Molstar ni mallas anatómicas. El asistente devuelve un texto de demostración claramente identificado y permite cancelar.

Los datos salen de `src/datos/muestra.ts` y de fixtures de pruebas, no de investigaciones de la instalación. Las cifras y los textos sirven para revisar la interfaz; no son resultados científicos de esta copia. La exportación conserva el catálogo de traducciones de ROSA, pero no llama a un modelo para traducir prosa libre.

Los cambios y las preferencias duran hasta recargar el archivo. «Reiniciar demo» vuelve al estado inicial. Las funciones que necesitan servidor, como enviar correo, analizar archivos o emitir un documento científico, no se ejecutan. Se mantiene el diseño de sus pantallas cuando es posible.

## Separación respecto a ROSA

El compilador sustituye módulos solo durante esta exportación. La aplicación habitual conserva su autenticación, conexiones y visualizaciones. No se leen variables de entorno ni bases de datos. La copia utiliza almacenamiento en memoria, intercepta las peticiones y añade una política de contenido que impide conexiones y recursos externos automáticos. Los enlaces bibliográficos siguen siendo enlaces públicos: solo se abren si el revisor los pulsa.

## Comprobación

```sh
frontend/node_modules/.bin/tsc --noEmit -p frontend/portatil/tsconfig.json
node frontend/scripts/probar-html-portatil.mjs /ruta/ROSA-interactivo.html
```
