# Frontend de ROSA2018

La interfaz web de ROSA2018: la vista de una corrida de dias, la cola de revision
de hipotesis con procedencia, el ranking, el explorador del modelo de mundo,
los artefactos versionados, el tablero de calidad y los ajustes. Sigue
`UI-ROSA.md` patron por patron.

## Arrancar

```
npm install
npm run dev        # http://localhost:5174
npm test           # vitest: logica pura y acciones
npm run typecheck  # tsc estricto
npm run build      # produccion en dist/
```

## Estado actual: datos de muestra

ROSA2018 todavia no tiene bucle ni servidor. La interfaz arranca con datos de
muestra del dominio (`src/datos/muestra.ts`) y una corrida que avanza sola
(`src/datos/simulacion.ts`) para poder construirla y juzgarla en vivo. La
cabecera lo dice ("Datos de muestra") y cada pantalla lleva el aviso.

Para conectar ROSA2018 de verdad se cambia un solo modulo, `src/datos/almacen.ts`:
`useRosa()` pasa a leer las suscripciones del servidor (Convex, o Postgres con
suscripciones; decision pendiente) y cada funcion de `acciones` pasa a llamar
a su mutacion, con las mismas firmas. Las pantallas no cambian. Los tipos del
contrato estan en `src/datos/tipos.ts`.

## Como esta organizado

- `src/datos/`: tipos del dominio, muestra, acciones puras (con tests),
  simulacion (con tests) y el almacen reactivo.
- `src/lib/`: logica pura sin React, cada modulo con su test: formato de
  numeros y tiempos, rutas, orden de la cola y del ranking, resumen de la
  verificacion, diff por lineas, etiquetas de cada estado.
- `src/componentes/`: piezas reutilizables: tarjeta de permiso, plan en vivo
  con pistas y transcripcion, verificacion plegable, tarjetas del revisor,
  comentarios anclados, cajon de procedencia de seis pesta�as.
- `src/pantallas/`: una por pantalla.
- `src/styles.css`: el sistema visual, heredado del RAG, con el morado del
  arbol del Alzheimer Project como acento. Claro y oscuro via `data-theme`.

## Reglas que la interfaz hace cumplir

- Una hipotesis no entra al modelo de mundo como aceptada sin pasar por la
  cola, y no se puede aceptar con afirmaciones bloqueantes ni hallazgos
  abiertos del revisor (`motivoNoAceptable`).
- Descartar exige motivo, y el motivo queda en el modelo de mundo.
- Las tarjetas de permiso llevan el nombre exacto del recurso y los alcances
  elegibles; lo concedido con alcance mayor que "una vez" se lista y se revoca
  en Ajustes.
- `sin_verificar` se pinta como aviso, nunca como aprobado. Arriba se resume
  el fallo, no el acierto.
- Los comentarios se anclan a una seleccion de texto, se acumulan como
  pendientes y salen juntos a ROSA2018 con el siguiente mensaje.
- Nada de confirmaciones del navegador: las decisiones irreversibles se
  confirman inline, en dos pasos.


## Conexion con el servidor de ROSA2018

Al arrancar, `src/datos/almacen.ts` pide `/api/estado`. Si el servidor de ROSA2018
responde (`uv run python -m rosa.main`, puerto 8765; Vite reenvia `/api`), la
interfaz entra en modo servidor: el estado llega por Server-Sent Events
(`/api/eventos`, el estado completo en cada cambio) y cada accion se aplica al
instante con el reducer local y se envia por `POST /api/acciones/{nombre}`. Si
el servidor no responde, sigue con los datos de muestra y la simulacion, y lo
avisa en la franja amarilla. Las pantallas no distinguen un modo del otro.

## Rework del 14 de septiembre de 2026: movimiento con significado

La interfaz explica el proceso por si misma. Lo que cambio y donde tocar:

- **Hilo del proceso** (`src/componentes/HiloDelProceso.tsx`): las siete
  etapas (plan, literatura, verificar, modelo de mundo, hipotesis y Killer,
  candidatas, laboratorio) siempre visibles bajo la cabecera, con la activa
  latiendo, las hechas apagadas y lo que espera a una persona marcado. Se
  deriva del estado con `estadoDelHilo`, sin inventar nada.
- **Recorrido de primera vez** (`src/componentes/Recorrido.tsx`): cinco
  pasos; aparece una vez (clave `rosa.recorrido.v1` en el navegador) y vuelve
  desde el boton `?` de la cabecera o desde Ajustes.
- **Deshacer** (`src/componentes/Deshacer.tsx` y `programar` en
  `src/datos/almacen.ts`): aceptar, descartar o refinar una hipotesis se
  aplica al instante y viaja al servidor seis segundos despues; mientras, un
  aviso con barra de tiempo permite deshacer o enviar ya.
- **Sistema de movimiento** (`src/lib/movimiento.ts`,
  `src/componentes/Animado.tsx`, seccion 10 de `styles.css`): duraciones de
  150 a 400 ms, una sola curva, `Aparece`, `ListaAnimada` y
  `ElementoAnimado` (entrada escalonada, reordenacion con resorte, salida
  por decision: aceptar desplaza adelante, descartar apaga, refinar devuelve
  arriba), `Contador` (el Elo corre hasta su valor), `Destello`. Todo
  respeta `prefers-reduced-motion`. La libreria es Motion (`motion/react`).
- **Estados vacios que ensenan** (`Vacio` con `pasos` y `accion` en
  `piezas.tsx`) y **secciones que entran al aparecer** (`Seccion`).
- Cambio de pantalla con fundido (`App.tsx`), pistas con franja de actividad
  y pasos que se iluminan (`PlanEnVivo.tsx`), hechos que se mueven entre
  columnas (`ModeloDeMundo.tsx`), tarjetas de inicio escalonadas.

## Menos complicado: modo Sencillo y Detalle (14 de septiembre de 2026)

- **Interruptor en la cabecera** (`src/lib/modo.ts`): en Sencillo, las
  secciones marcadas `detalle` (ingenieria y auditoria: hashes, tolerancias,
  kappa, entorno, conectores, politicas) quedan plegadas tras una linea de
  resumen, y cada nota larga se reduce a su primera frase. En Detalle se abre
  todo. Se recuerda en el navegador.
- **Ayuda con glosario** (`src/lib/glosario.ts`): el boton `?` de cada
  seccion muestra la explicacion completa y define los terminos tecnicos que
  nombra (Elo, GRADE, kappa, prerregistro, puerta de reproduccion...).
- **Secciones plegables** (`Seccion` en `piezas.tsx`: `detalle`, `plegable`,
  `abierta`, `resumen`, `id`) y `SoloDetalle` para bloques que no son
  secciones (el gasto de la corrida).
- **"Que toca hacer aqui"** arriba de Objetivo y datos: mision sin aprobar,
  datasets pendientes, puerta bloqueada, sin corridas; cada cosa con su boton.
- **Formularios solo cuando hacen falta**: subir dataset y registrar una
  reproduccion viven tras un boton; el de reproduccion se abre solo si la
  puerta esta bloqueada.

## Continuidad al abrir y cambiar contenido (5 de octubre de 2026)

`Desplegable` anima la altura al abrir y cerrar secciones, verificaciones y
hallazgos del revisor. No monta el contenido cerrado: conserva la carga bajo
demanda y lo desmonta al terminar el cierre. Durante la salida queda `inert`
y oculto al lector de pantalla para que no se puedan accionar controles que
están desapareciendo. Con movimiento reducido el cambio es inmediato.

`movimiento.css` añade fundidos de 240 ms a las pestañas de Ajustes, la ficha
de hipótesis, Procedencia y los experimentos del laboratorio. Los paneles de
Ajustes y de la ficha siguen montados y usan `hidden`: el efecto no reinicia
formularios ni hace peticiones. También acompaña las confirmaciones y los
detalles de la hoja del laboratorio. No hay esperas artificiales ni bucles
decorativos. `MotionConfig` aplica la preferencia de movimiento reducido a
los desplazamientos de la aplicación, además de las reglas CSS existentes.

## Auditoria visual (Playwright)

`npm run auditoria-visual` abre cada pantalla de ROSA2018 en un Chromium real
(servida por el servidor de ROSA2018 en el 8765) a cuatro anchos (1440, 1100,
800 y 420) y en los dos modos, despliega las secciones de detalle y busca lo
que las pruebas de DOM no ven: texto recortado por su caja o por un
antecesor, texto superpuesto (comparando las cajas de cada linea), texto
fuera de la ventana y scroll horizontal de la pagina. Deja capturas de
pagina completa y `informe.json` en `frontend/auditoria/` (fuera de git).
Correrla despues de cualquier cambio de estilos; el objetivo es cero.

## Tildes y ñ en los textos visibles

Todo texto en castellano de la interfaz lleva tilde y ñ (regla de Emir del
14 de septiembre de 2026: "acostúmbrate desde ahora a poner tilde y ñ a
todas las palabras que lo tengan"). Los textos nuevos se escriben ya
acentuados; `python3 scripts/acentuar.py` (desde `frontend/`) es la revisión.

Qué hace el script. Recorre `src/` con un diccionario cerrado de palabras
(`PALABRAS`, conservando mayúsculas) más cuatro reglas: toda palabra en
-ción singular lleva tilde; tras "¿" los interrogativos (qué, cómo, dónde,
cuándo, cuál, quién, cuánto) la llevan, y también "Qué" y "Cómo" al empezar
una cadena salvo que siga un artículo, un demostrativo o una mayúscula ("Que
el efecto sea independiente" es completivo); "esta" pasa a "está" solo cuando
le sigue un participio conocido, un gerundio o una palabra de estado (en,
por, ya, listo, pausada...), nunca un sustantivo ("esta corrida" se queda);
"aun" pasa a "aún" salvo en "aun así". Un texto que parece inglés (the, of,
and, with) no se toca: los títulos de artículos de la muestra siguen como
están.

Dónde mira. Texto JSX entre etiquetas, atributos de texto (`titulo`, `nota`,
`placeholder`, `aria-label`, `title`...), plantillas con texto (nunca las de
`className`, `id`, `key`, rutas), cadenas largas que empiezan por mayúscula
y, en todos los `.ts` de `lib/` y `datos/` salvo `tipos.ts`, cualquier cadena
con un espacio y sin pinta de código (una clave, una ruta o un valor que se
compara con el servidor nunca llevan espacio). No toca identificadores,
clases CSS ni valores literales de tipo (`'sistematica'`, `'vacio'`: `tsc`
avisa si los acentuara).

Qué queda fuera a propósito. Las palabras que cambian de sentido con la
tilde y no se resuelven por contexto simple: como/cómo y que/qué en medio de
una frase, solo, si/sí, paso/pasó, cambio/cambió, valido/validó,
critico/criticó, publico/publicó, cortes/cortés, este/esté. Esas se escriben
a mano (y una pasada temprana las estropeó: "se le crítico", "los cortés").
Los textos que genera el backend en Python (eventos, dossier, pistas,
frases GRADE) tienen su propia pasada, `python3 scripts/acentuar_py.py` en la
raíz del repositorio: usa el mismo diccionario y las mismas reglas, pero
recorre los ficheros con `tokenize` para tocar solo los literales de cadena
(nunca comentarios ni código), deja fuera las cadenas crudas (expresiones
regulares), el SQL y las que llevan `_ $ / \ < > | * ^ [ ]`, y en las
f-strings solo acentúa el texto fuera de las llaves (contando la profundidad,
para no tocar `{(inv or {}).get('titulo')}`). Una línea con el comentario
`# sin tildes` se respeta tal cual.

Cómo se completó el diccionario. Cada palabra visible se pasó por un
diccionario de frecuencias del castellano (`pyspellchecker`, en el venv del
backend): las que solo existen con tilde entraron directamente y las que
existen de las dos formas se revisaron por contexto. El diccionario va en
líneas cortas a propósito: Python 3.9 falla con "Non-UTF-8 code" en líneas de
miles de caracteres con tildes.

Guardas. `src/clases.test.ts` falla si una clase del JSX lleva caracteres
fuera de ASCII o no existe en `styles.css` (la primera pasada convirtió
`seccion` en `sección` y los estilos desaparecieron). La auditoría visual
revisa cualquier título, no solo los que están dentro de una sección.

## Reglas de los hooks: `npm run lint`

El 15 de septiembre de 2026, al arrancar la primera corrida de una
investigación, la pantalla pasó de "sin corridas" a "corrida 1" dentro del
mismo componente con más hooks que en el render anterior y React falló
("Rendered more hooks than during the previous render"); el límite de error
lo mostró en vez de dejar la pantalla en negro. La pantalla se dividió en un
componente que decide y otro (`CorridaViva`) con todos los hooks
incondicionales, y `Corrida.hooks.test.tsx` hace esa transición sobre la
misma raíz. Para que no vuelva a pasar en ninguna pantalla, `npm run lint`
corre ESLint con una sola regla, `react-hooks/rules-of-hooks`, como error;
se pasa antes de cada commit junto a `tsc` y los tests.

## Si una pantalla falla al pintarse

`componentes/Limite.tsx` es un limite de error de React. Sin el, un fallo al
pintar cualquier pantalla desmonta el arbol entero y se ve la pagina vacia
(negra en tema oscuro). Con el, la barra y la cabecera siguen en su sitio y
en el hueco de la pagina aparece el mensaje del fallo con tres salidas:
volver a intentar, ir al inicio o recargar. Hay uno alrededor de cada
pantalla (`App.tsx`) y otro en la raiz (`main.tsx`).

La transicion entre pantallas es un fundido cruzado (`AnimatePresence` en
modo `popLayout`) y su clave es la pantalla, no el detalle: abrir una
hipotesis en su cajon o un artefacto no vuelve a montar la pagina. Antes la
clave incluia el detalle y el modo era `wait`, asi que al abrir una hipotesis
la pagina entera salia con fundido y volvia a entrar; medido con Playwright
(`auditoria/hueco.mjs`, fuera de git) el hueco sin pagina era de unos 105 ms
en un navegador ocioso y se alargaba cuando el navegador estaba ocupado con
el flujo de eventos del final de una corrida. Ahora es 0 ms.

## El árbol: fuerzas acotadas

`pantallas/Arbol.tsx` dibuja el grafo de la investigación con una disposición
por fuerzas (`lib/arbol.ts`, función `paso`): repulsión entre todos los nodos,
un resorte por enlace, empuje entre etiquetas que se solapan, el tronco fijo
y una gravedad suave. Con muchos nodos desplegados y un arrastre, la versión
original se descontrolaba: dos nodos casi encima producían una repulsión
enorme (va con el inverso del cuadrado de la distancia), un solape de
etiquetas de cien unidades se convertía en un salto de decenas por paso y
nada limitaba la velocidad. Emir lo describió como "se empieza a volver
loco". Desde el 14 de septiembre de 2026 la repulsión se satura por debajo de
12 unidades, el empuje por solape se acota a 24 unidades de solape y cada
nodo tiene un tope de velocidad proporcional a la energía (2 + 28 · alfa
unidades por paso). `lib/arbol.estabilidad.test.ts` arrastra un nodo con todo
desplegado en el árbol de muestra y en uno sintético de 250 nodos: la
velocidad máxima de los vecinos bajó de 27 a 31 unidades por paso a 9,5 a
11,8, y el árbol se asienta en unos cien fotogramas al soltar.

Legibilidad. Con eso el árbol dejó de temblar, pero las etiquetas seguían
montándose unas sobre otras ("¿no consideras que están DEMASIADO pegados?").
Dos cambios más: los enlaces son más largos que una etiqueta media (cita
110, entidad 130, respalda 140, rama 230 unidades) y hay una restricción de
posición, `separarEtiquetas`, que en cada paso desplaza una fracción del
solape a los dos nodos cuyas cajas de texto se pisan, por el eje de menor
solape (ante la duda, en vertical, porque las etiquetas son anchas). Al ser
un desplazamiento acotado no puede disparar nada, y actúa también casi en
reposo (más despacio, para que un árbol denso sin sitio no tiemble).
`lib/arbol.solapes.test.ts` cuenta los pares de etiquetas solapadas en el
árbol de muestra desplegado del todo: de 7 a 0.

## La puerta: acceso por correo corporativo

`componentes/Acceso.tsx` envuelve la aplicación (ver `main.tsx`): sin sesión
verificada no se carga ningún estado de investigación. La lógica (estado de
sesión, solicitar enlace, confirmar, salir, configurar el correo de la
instalación) es la de Codex, descrita en `CORREO-Y-ACCESO.md`. La
presentación se rehízo el 14 de septiembre de 2026 a petición de Emir ("está
súper feo y genérico"): a la izquierda, sobre el fondo de la marca, el árbol
vivo (`componentes/ArbolVivo.tsx`), un árbol de conocimiento en SVG que se
balancea y se ilumina etapa a etapa (objetivo, literatura, verificación,
modelo de mundo, hipótesis y Killer, laboratorio) con una frase por etapa,
para que quien llega vea qué hace ROSA2018 antes de entrar; a la derecha, la
tarjeta con un solo campo y tres estados: formulario (iniciar sesión o
registrarse, con un control deslizante), enlace enviado ("Revisa tu correo",
con la dirección y la caducidad de 15 minutos) y confirmación del enlace. El
tono del mensaje (éxito o error) lo decide quien lo escribe, no una
expresión sobre el texto. Con movimiento reducido no hay balanceo ni cambio
de etapa. `auditoria/captura-acceso.mjs` (fuera de git) captura los estados
con la API de acceso simulada, sin enviar correos.

La auditoría visual entra por la puerta sin sesión real: manda la cabecera
`x-rosa-interno` con el token de `datos/_token_interno` (solo legible en la
máquina del servidor) y simula `/api/acceso/estado` con una sesión de
auditoría; así las pantallas se auditan igual que antes.
