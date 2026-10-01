# Las herramientas del inglés

Pasos que se corrieron para traducir ROSA2018, en orden. Todos se ejecutan
**desde `frontend/`**, no desde aquí, porque buscan con `find src`. Sin
`--escribir` ninguno toca nada: enseñan lo que harían.

La clave de traducción es la propia frase en castellano. Lo que no esté en el
catálogo se ve en castellano, que se entiende, en vez de en blanco.

## Envolver

| Paso | Qué hace |
|---|---|
| `extraer.mjs` | El primer codemod: el texto JSX (los hijos de un elemento). |
| `envolver.mjs` | Lo que el primero no alcanza: props, ternarios, valores de objeto, returns. Antes recoge las cadenas que se COMPARAN en cualquier parte del árbol y no las toca. |
| `descongelar.mjs` | `tr()` dentro de una constante de módulo se evalúa al importar y se queda en el idioma del arranque. Esto le quita el `tr()` y envuelve la constante en `traducido()`, que traduce al leer. |
| `mover_tr.mjs` | Lo mismo para `const X = tr('...')` suelto: el `tr()` se mueve a cada uso. |

## Desenvolver, que es lo que de verdad importa

Envolver de más no rompe nada **hoy** (`tr()` sin entrada en el catálogo
devuelve la misma cadena); rompe el día que alguien la traduce. Y no lo caza
la suite, que corre en castellano. Por eso estos cuatro:

| Paso | Qué saca |
|---|---|
| `desenvolver.mjs` | Identificadores y datos de cruce: `id`, `de`, `a`, `alias`, `patron`, `nct`. Aquí viven los 118 alias con los que se reconoce una cohorte en un artículo. |
| `desenvolver_codigo.mjs` | Consultas de API, rutas, identificadores de modelo. |
| `desenvolver_datos.mjs` | Listas de palabras vacías, colores `rgba`, trazados SVG. |
| `desenvolver_css.mjs` | Valores CSS, nombres de clase, licencias, la etiqueta `ER  - ` de RIS. |

Lo defiende `src/lib/traduccion_segura.test.ts`, la única prueba de la suite
que corre en inglés a propósito.

## Medir

| Paso | Qué dice |
|---|---|
| `pendientes.mjs` | Qué está envuelto y todavía no tiene traducción. Escribe `/tmp/faltan.json`, que es la entrada del traductor. |
| `congeladas.mjs` | Cuántos `tr()` quedan en constantes de módulo. Tiene que dar 0. |
| `sospechosas.mjs` | Qué se envolvió sin marca de castellano: nombres propios, siglas, o algo que no debería estar envuelto. |
| `resto_es.mjs` | Recorre ROSA2018 **en inglés** con Playwright y lista lo que sigue en castellano, por pantalla. Es la única medida que no se engaña: necesita el servidor en marcha. |
| `resto_tsx.mjs`, `formas.mjs`, `ids.mjs`, `listar_congeladas.mjs` | Auditorías puntuales que se usaron para decidir cada paso. |

## Traducir

`../../../scripts/traducir_catalogo.py`, desde la raíz del repo. Llama a
Opus 5 por el AI Gateway con las reglas del proyecto en el prompt y rechaza
lo que las incumple. Es resumible: cada lote se escribe en
`traducciones.jsonl` nada más llegar.

```
./.venv/bin/python scripts/traducir_catalogo.py --entrada /tmp/faltan.json
./.venv/bin/python scripts/traducir_catalogo.py --escribir-ts
```
