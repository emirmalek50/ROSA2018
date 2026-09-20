# Acceso y correo de ROSA2018

ROSA2018 se abre con una sola cuenta de `@alzheimerproject.com` y una
contraseña, las dos fijadas en el `.env` del servidor (desde el 18 de
septiembre de 2026). La pantalla de acceso tiene dos campos, correo y
contraseña; no hay registro ni enlace por correo. El correo de esta sección
sirve para los avisos de las corridas, no para entrar.

## Entrada con correo y contraseña

En `.env` del equipo que corre ROSA2018:

```
ROSA_LOGIN_EMAIL=persona@alzheimerproject.com
ROSA_LOGIN_PASSWORD_HASH=<64 caracteres hexadecimales>
ROSA_ADMIN=persona@alzheimerproject.com
```

- `ROSA_LOGIN_EMAIL` es la única cuenta que puede entrar. Tiene que ser una
  dirección `@alzheimerproject.com` sin tildes, ñ ni espacios.
- `ROSA_LOGIN_PASSWORD_HASH` es la huella scrypt de la contraseña; la
  contraseña en claro no vive en ningún sitio. Se genera con
  `uv run python -m rosa.acceso --huella`: pide la contraseña dos veces sin
  mostrarla y escribe la línea para `.env`. `uv run python -m rosa.acceso
  --comprobar` dice si lo que hay en `.env` sirve, sin imprimir valores.
- `ROSA_ADMIN` (opcional) fija la cuenta administradora, la que puede conectar
  el correo, cambiar políticas y ver GEPA. Sin `ROSA_ADMIN` administra la
  cuenta de `ROSA_LOGIN_EMAIL`, la única que puede entrar; nunca una cuenta
  heredada de la puerta antigua ni una que confirmó un enlace antes del cambio.
- Al arrancar, ROSA2018 avisa por consola si falta o está mal alguna de las
  dos credenciales (huella de 63 caracteres por un carácter perdido al pegar,
  correo fuera del dominio). Mientras tanto la pantalla de acceso dice que el
  acceso con contraseña no está configurado y ningún intento cuenta contra
  el tope; nadie puede entrar hasta corregir `.env` y reiniciar.
- Topes: tres contraseñas erróneas por correo en 15 minutos, 20 intentos por
  IP y 100 en total por hora. Acertar borra los intentos de ese correo, así
  que dos erratas y dos entradas seguidas no bloquean a nadie. Un correo o
  una contraseña incorrectos reciben el mismo mensaje, para no revelar cuentas.
- La sesión dura 12 horas en una cookie HttpOnly y se revoca al cerrar sesión.

La puerta sin verificación del 15 de septiembre de 2026 (entrar con cualquier
dirección del dominio mientras no había correo) está cerrada:
`POST /api/acceso/entrar_sin_verificar` contesta 410 con la explicación de
cómo entrar, con sesión y sin ella, y no toca la base. Las rutas del enlace
por correo (`/api/acceso/solicitar` y `/api/acceso/confirmar`) se retiraron
del servidor el 19 de septiembre; la clase `rosa/acceso.py` conserva
`solicitar` y `confirmar` para el día que vuelva el enlace.

## Dos transportes: Google Workspace por SMTP o Resend

Desde el 15 de septiembre de 2026 el correo de ROSA2018 sale por uno de dos
caminos, a elegir en «Configurar correo de esta instalación» (la puerta) o en
Ajustes:

- **Google Workspace u otro servidor SMTP** (por defecto). Envía desde el
  buzón corporativo que ya existe (`smtp.gmail.com`, puerto 587 con STARTTLS
  o 465 con TLS), con el usuario de esa cuenta y una **contraseña de
  aplicación** (Cuenta de Google, Seguridad, Verificación en dos pasos,
  Contraseñas de aplicaciones), nunca la contraseña normal. No hay que
  registrar nada en un tercero ni verificar un dominio, y el correo llega a
  cualquier persona del equipo desde el primer día. El remitente debe ser la
  misma cuenta o un alias suyo; Google rechaza otros.
- **Resend**, como estaba: clave de API y dominio verificado.

`rosa/correo.py` guarda `proveedor`, `smtpServidor`, `smtpPuerto` y
`smtpUsuario` junto al remitente y la clave; `_enviar_smtp` corre en un hilo
(smtplib es bloqueante) y pone el id de la cola en el `Message-ID`. Política
de reintentos: usuario o contraseña rechazados y destinatario o remitente
rechazados no se reintentan; una respuesta 4xx del servidor o la red caída
sí, con el mismo mensaje. Pruebas en `rosa/tests/test_correo_smtp.py` con
un servidor falso, sin red ni contraseñas reales.

## Primera instalación

1. Con Google Workspace: generar una contraseña de aplicación de la cuenta
   corporativa que enviará los correos. Con Resend: crear la cuenta,
   verificar el dominio y generar una clave con permiso de envío.
2. Arrancar el backend actualizado y abrir ROSA2018 **en el equipo del servidor**.
   La pantalla de acceso muestra «Configurar correo de esta instalación».
3. Elegir el proveedor y guardar los datos (con SMTP: cuenta, contraseña de
   aplicación, servidor y puerto; con Resend: remitente y clave) y la URL de
   ROSA2018. La URL local solo funciona en ese equipo. Para otros equipos hace falta un despliegue
   HTTPS accesible, con los hosts admitidos configurados en el servidor.
4. Entrar con `ROSA_LOGIN_EMAIL` y la contraseña cuya huella está en `.env`
   (ver «Entrada con correo y contraseña»). Esa cuenta, o la de `ROSA_ADMIN`
   si se fijó, administra la conexión de correo. Completar este paso antes
   de publicar el servidor para el resto del equipo.
5. En Ajustes, revisar los avisos y usar «Enviar correo de prueba». La prueba
   se envía exclusivamente a la cuenta de la sesión.

La configuración inicial se permite solo desde loopback, antes de crear una
cuenta, sin cabeceras de proxy y con origen local. Después solo la cuenta
administradora puede cambiar o desconectar el proveedor. No hay un acceso de
demostración que permita saltarse la contraseña si falta el proveedor.
El arranque en una dirección distinta de loopback conserva además los
requisitos existentes de configuración del servidor.

## A quién llegan los avisos

- El backend toma la identidad de la sesión, no de un campo editable del
  navegador, y la guarda al crear una investigación o iniciar una corrida.
- Los avisos de una corrida llegan a quien la inició. Iniciar sesión desde
  otra cuenta no cambia el destinatario de corridas anteriores.
- Las hipótesis que genera el bucle conservan la referencia a su corrida de
  origen; los permisos y las incidencias se resuelven por su corrida.
- Las investigaciones y corridas antiguas no se asignan por suposición a la
  primera persona que entre. Una nueva corrida sí tendrá responsable.
- Cada cuenta tiene sus propias preferencias. Los avisos inmediatos están
  activados por defecto para cuentas verificadas; el resumen diario se activa
  expresamente en Ajustes. La preferencia antigua de dirección global no se usa.
- El equipo comparte el espacio de investigaciones: este cambio identifica
  autores y destinatarios, **no crea espacios privados separados por cuenta**.

Se avisa de nuevas hipótesis, planes/decisiones pendientes, incidencias y
corridas pausadas o finalizadas. El resumen diario contiene contadores propios
y un enlace, no conclusiones científicas ni datos clínicos. Por defecto se
programa a las 08:00 de `America/Santo_Domingo`, configurable por administrador.
Al habilitar o arrancar por primera vez no se envía todo el historial antiguo.
El trabajador comprueba el estado cada cinco segundos; no es un registro de
transiciones instantáneas que desaparezcan entre dos comprobaciones.

## Persistencia y seguridad

`datos/_correo/<nombre de la base>.db` guarda proveedor, preferencias, cuentas,
enlaces, sesiones y cola de correo. Está fuera de Git y de Convex, con permiso
de archivo `0600`. La clave se almacena localmente **sin cifrado de aplicación**:
proteger el equipo y las copias de seguridad; el permiso no sustituye al cifrado
de disco. Ni el API de configuración ni el estado compartido devuelven la clave.

Las sesiones duran 12 horas, se almacenan por hash, se revocan al salir y viajan
en una cookie HttpOnly, SameSite=Strict y Secure cuando la URL configurada es
HTTPS. Los enlaces (cuando vuelvan) se guardan por hash; la cola necesita el
enlace mientras espera el envío y elimina su cuerpo al concluir. Se limitan
los intentos de contraseña por dirección, IP y volumen total, y acertar borra
los de esa dirección. Todas las rutas de investigación
requieren sesión; se conserva la credencial interna existente para procesos
de confianza del servidor. El flujo SSE también comprueba la vigencia de sesión.

La cola reintenta fallos de red, HTTP 429 y 5xx hasta cinco intentos, manteniendo
el mismo contenido y clave de idempotencia. No reintenta después de 23 horas
desde el primer intento, dentro de las 24 horas que documenta Resend. Los
enlaces de acceso no se envían después de caducar. Un fallo que no permite
confirmar el resultado queda visible, no se convierte en éxito.

«Aceptado por Resend» **no confirma entrega al buzón**: los rebotes y la entrega
se consultan en el panel del proveedor; todavía no hay webhook de entregas.
Desactivar avisos cancela lo pendiente, pero no puede retirar un correo que
ya se está enviando. ROSA2018 debe permanecer en ejecución para enviar avisos.
Los mensajes no llaman a modelos de IA; el proveedor puede cobrar por envío.

## Verificación

- Backend: `uv run python -m pytest rosa/tests -q`.
- Frontend: `cd frontend && npm test -- --silent` y `npm run build`.
- Transporte y autenticación se prueban con datos temporales y HTTP simulado,
  sin gastar tokens y sin enviar correos externos.
- `scripts/probar_acceso_visual.py` describe todavía la pantalla antigua
  (botones «Continuar con mi correo», «Registrarse» y el flujo `#acceso=`);
  está pendiente de rehacerlo para la pantalla de contraseña.
- Pruebas del acceso con contraseña: `rosa/tests/test_acceso_contrasena.py`,
  `rosa/tests/test_acceso_sin_verificar.py`, `rosa/tests/test_acceso_correo.py`
  y `rosa/tests/test_acceso_adversario_19sep.py`.

Documentación utilizada: [envío de Resend](https://resend.com/docs/api-reference/emails/send-email),
[idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys),
[sesiones de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
y [tokens de un solo uso](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
