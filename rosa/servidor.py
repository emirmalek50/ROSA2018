"""El servidor HTTP de ROSA2018 (FastAPI).

Tres rutas y nada más, porque el frontend ya sabe hacer el resto:

- `GET /api/estado`: la instantánea completa del estado (forma `EstadoRosa`).
- `GET /api/eventos`: Server-Sent Events. Cada vez que el estado cambia, el
  servidor manda la instantánea completa con `id` igual a la versión. El
  navegador reconecta solo si se corta.
- `POST /api/acciones/{nombre}`: una acción de la interfaz con sus
  argumentos en JSON. Devuelve `{ok, resultado, version}`.

Además `GET /api/llamadas/{corridaId}` da las últimas llamadas a modelos y,
si existe `frontend/dist`, sirve la interfaz compilada en la raíz.

Guardias, en este orden (17 de septiembre de 2026, hallazgos S-21, S-22 y
M-29):

1. Si hay `ROSA_TOKEN` configurado, toda la API lo exige (cabecera
   `X-Rosa-Token` o `?token=` para el SSE), con o sin sesión y también en las
   rutas de acceso: es la llave de red. Solo el token interno del propio
   servidor lo salta.
2. Sesión por cookie: sin ella, 401 salvo en las rutas públicas de acceso.
3. Toda escritura desde el navegador lleva la cabecera `X-Rosa` (CSRF).
4. Los cuerpos se leen por trozos con tope, rechazando antes por
   `Content-Length`, y la firma (`quien`) de cada acción es la sesión, no lo
   que mande el navegador.

Las respuestas grandes van comprimidas (GZip) y la instantánea del estado se
serializa una vez por versión para todos los clientes (S-17, primer corte).
"""

from __future__ import annotations

import asyncio
import json
import contextlib
import copy
import time
import sys
import secrets
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

from rosa import config
from rosa.estado import plantilla as P
from rosa.estado.almacen import ACCIONES, Almacen, EscritorObsoleto, componer_bytes_con_avisos
from rosa.acceso import Acceso, COOKIE, DURACION, MENSAJE_PUERTA_CERRADA, MENSAJE_SIN_CONFIGURAR, diagnostico_credenciales
from urllib.parse import urlsplit


# Acciones que solo aplica el propio servidor (subidas, panel del Killer,
# preguntas con herramientas): no se aceptan desde el navegador.
ACCIONES_INTERNAS = {"registrarPreguntaBases", "registrarEvaluacion", "registrarDatosExperimento", "registrarSelloExterno"}
MAX_CUERPO_ACCION = 1_000_000
MAX_CUERPO_PEQUENO = 4096
MAX_CUERPO_PREGUNTA = 16_384
HOSTS_LOCALES = ("127.0.0.1", "localhost", "::1")
# La puerta sin verificar sigue siendo pública aunque esté cerrada: así quien la
# llame sin sesión (una interfaz antigua) recibe el 410 con la explicación y no
# un 401 que le pida iniciar sesión sin decirle cómo.
RUTAS_PUBLICAS = ('/api/acceso/estado', '/api/acceso/entrar', '/api/acceso/registrar', '/api/acceso/salir', '/api/acceso/configuracion', '/api/acceso/entrar_sin_verificar')


async def leer_json_acotado(request: Request, maximo: int) -> Any:
    """Lee el cuerpo de una petición con tope, antes de tenerlo entero en
    memoria (M-29): rechaza de entrada si `Content-Length` declara más de
    `maximo` y, si no lo declara o miente, lee por trozos y corta al pasarlo.
    Devuelve el JSON decodificado. Errores: 413 (grande), 400 (no es JSON)."""
    declarado = request.headers.get("content-length")
    if declarado is not None:
        try:
            if int(declarado) > maximo:
                raise HTTPException(413, f"El cuerpo no puede pasar de {maximo // 1000} kB")
        except ValueError:
            raise HTTPException(400, "Content-Length inválido") from None
    cuerpo = bytearray()
    async for parte in request.stream():
        cuerpo.extend(parte)
        if len(cuerpo) > maximo:
            raise HTTPException(413, f"El cuerpo no puede pasar de {maximo // 1000} kB")
    try:
        return json.loads(bytes(cuerpo) or b"{}")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "El cuerpo no es JSON válido") from None


async def _leer_acotado(fichero: UploadFile, maximo: int) -> bytes:
    """Lee una subida por trozos y corta en cuanto pasa el máximo, antes de
    cargarla entera en memoria."""
    declarado = fichero.size
    if declarado is not None and declarado > maximo:
        raise HTTPException(413, f"El fichero supera los {maximo // (1024 * 1024)} MB")
    partes: list[bytes] = []
    total = 0
    while True:
        trozo = await fichero.read(1024 * 1024)
        if not trozo:
            break
        total += len(trozo)
        if total > maximo:
            raise HTTPException(413, f"El fichero supera los {maximo // (1024 * 1024)} MB")
        partes.append(trozo)
    return b"".join(partes)


def token_interno() -> str:
    """Un secreto por instalación, en un fichero fuera de git, para las
    acciones internas (el panel del Killer lo lee del mismo disco)."""
    ruta = config.RAIZ / "datos" / "_token_interno"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    if not ruta.exists():
        ruta.write_text(secrets.token_hex(24), encoding="utf-8")
        ruta.chmod(0o600)
    return ruta.read_text(encoding="utf-8").strip()


def igual_secreto(dado: Any, esperado: Any) -> bool:
    """Comparación en tiempo constante que no lanza: `secrets.compare_digest` con
    cadenas exige ASCII y una cabecera con tildes o emojis tumbaba la petición con
    TypeError (visto en el log el 17 de septiembre de 2026). Se compara en bytes."""
    try:
        return secrets.compare_digest(str(dado or "").encode("utf-8", "surrogateescape"), str(esperado or "").encode("utf-8", "surrogateescape"))
    except Exception:  # noqa: BLE001
        return False


def crear_app(almacen: Almacen) -> FastAPI:
    @contextlib.asynccontextmanager
    async def _vida(_app: FastAPI):
        # Arranque: el almacen conoce el bucle de eventos para despertar a los
        # suscriptores del SSE desde el hilo del bucle de investigacion.
        almacen.enganchar_bucle(asyncio.get_running_loop())
        from rosa.correo import Correo

        correo = Correo(almacen)
        app.state.correo = correo
        app.state.acceso = Acceso(correo)
        tarea = asyncio.create_task(correo.correr())
        try:
            yield
        finally:
            tarea.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarea
            correo.cerrar()

    app = FastAPI(title="ROSA2018", version="0.1", lifespan=_vida)
    app.state.almacen = almacen
    app.state.token_interno = token_interno()
    app.state.semaforo_preguntas = asyncio.Semaphore(2)
    app.state.preguntas_hoy = {"dia": "", "n": 0}

    def instalacion_local(request):
        # Solo instalación local directa, nunca por un proxy o desde la red.
        origen = request.headers.get('origin')
        return (config.HOST in HOSTS_LOCALES and request.client is not None
                and request.client.host in HOSTS_LOCALES and request.url.hostname in HOSTS_LOCALES
                and (not origen or urlsplit(origen).hostname in HOSTS_LOCALES)
                and not request.headers.get('x-forwarded-for')
                and not app.state.acceso.db.execute('SELECT 1 FROM cuentas LIMIT 1').fetchone())

    def es_admin(email):
        # Administrador explícito (ROSA_ADMIN en .env) o, si falta, la cuenta de
        # ROSA_LOGIN_EMAIL, la única que puede entrar; nunca una creada sin
        # verificar ni una confirmada por enlace antes del cambio (S-21).
        juez = getattr(getattr(app.state, 'acceso', None), 'es_admin', None)
        return bool(email and juez is not None and juez(email))

    async def estado_json_de(request, desde: int | None = None) -> tuple[int, bytes, bool]:
        """`(versión, JSON, parcial)` de la instantánea para esta persona: la parte
        compartida sale de la caché por clave del almacén (en un hilo aparte, fuera
        del bucle de eventos), entera o solo lo cambiado desde `desde`, y se le
        añaden sus avisos (siempre, también en la parcial: son pocos bytes). Las
        preferencias se leen aquí, en el hilo del bucle: la conexión SQLite del
        correo no admite otros hilos."""
        if request.state.usuario:
            avisos = json.dumps(app.state.correo.preferencias(request.state.usuario), ensure_ascii=False, separators=(",", ":"))
            version, cuerpo, parcial = await asyncio.to_thread(almacen.instantanea_desde, desde, True)
            return version, componer_bytes_con_avisos(cuerpo, avisos), parcial
        return await asyncio.to_thread(almacen.instantanea_desde, desde, False)

    # Solo se aceptan peticiones dirigidas al nombre con el que se sirve ROSA2018:
    # frena el "DNS rebinding" (una web ajena que resuelve a 127.0.0.1).
    permitidos = list(HOSTS_LOCALES) + ([config.HOST] if config.HOST not in HOSTS_LOCALES else []) + [f"{h}:{config.PUERTO}" for h in HOSTS_LOCALES]
    # Nunca un comodin: en 0.0.0.0 (el unico caso en que el ataque tiene sentido)
    # los nombres con los que se sirve ROSA2018 van en ROSA_HOSTS.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=permitidos + list(config.HOSTS_PERMITIDOS))
    # Respuestas grandes comprimidas (la instantánea pesa 10 MB; en gzip, menos
    # de 2). Starlette no comprime `text/event-stream`, así que el SSE no cambia.
    app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)

    @app.middleware("http")
    async def _guardias(request: Request, call_next):
        path = request.url.path
        publico = path in RUTAS_PUBLICAS
        acceso = getattr(app.state, 'acceso', None)
        usuario = acceso.usuario(request.cookies.get(COOKIE)) if acceso else None
        request.state.usuario = usuario
        interno = igual_secreto(request.headers.get('x-rosa-interno', ''), app.state.token_interno)
        # 1. La llave de red (S-21): si hay ROSA_TOKEN configurado, toda la API lo
        #    exige antes de mirar la sesión y sin excepción para las rutas
        #    públicas ni para quien ya tenga cookie. Va por cabecera o, para el
        #    flujo SSE, por parámetro. Solo el token interno del servidor lo salta.
        if config.ROSA_TOKEN and path.startswith("/api/") and not interno:
            dado = request.headers.get("x-rosa-token") or request.query_params.get("token")
            if not dado or not igual_secreto(dado, config.ROSA_TOKEN):
                return JSONResponse({"detail": "Falta el token de acceso a ROSA2018"}, status_code=401)
        # 2. La sesión: quién es la persona.
        if path.startswith('/api/') and not publico and not usuario and not interno:
            return JSONResponse({'detail': 'Inicia sesión con tu correo corporativo y tu contraseña'}, status_code=401)
        # 3. Toda escritura desde el navegador lleva la cabecera X-Rosa: una página
        #    ajena no puede mandarla sin preflight, y sin CORS el preflight falla.
        if request.method == "POST" and request.url.path.startswith("/api/") and request.headers.get("x-rosa") != "1" and not request.headers.get("x-rosa-interno"):
            return JSONResponse({"detail": "Falta la cabecera X-Rosa (la interfaz la manda siempre)"}, status_code=403)
        respuesta = await call_next(request)
        if path.startswith('/api/'):
            respuesta.headers['Cache-Control'] = 'no-store'
        respuesta.headers['Referrer-Policy'] = 'no-referrer'
        return respuesta

    @app.get('/api/acceso/estado')
    async def acceso_estado(request: Request):
        c = app.state.correo.estado()
        local = instalacion_local(request)
        ultimo = next((x for x in c['historial'] if x['tipo'] == 'acceso'), None) if local else None
        aviso = (ultimo['error'] or ('El proveedor aceptó el último correo de acceso. Comprueba el buzón y spam.' if ultimo['estado'] == 'aceptado' else 'El último correo de acceso está ' + ultimo['estado'])) if ultimo else None
        # Sin credenciales válidas en .env nadie puede entrar: la pantalla lo dice
        # antes de que alguien pruebe contraseñas. El detalle (qué variable falla)
        # solo sale por el arranque, no por esta ruta pública.
        acceso_configurado = not diagnostico_credenciales()
        if not acceso_configurado:
            aviso = MENSAJE_SIN_CONFIGURAR
        administrador = es_admin(request.state.usuario)
        pendientes = sum(1 for x in app.state.acceso.solicitudes() if x['estado'] == 'pendiente') if administrador else 0
        return {'correo': request.state.usuario, 'administrador': administrador,
                'correoConfigurado': c['configurado'], 'accesoConfigurado': acceso_configurado,
                'instalacionLocal': local, 'avisoInstalacion': aviso, 'solicitudesPendientes': pendientes}

    async def objeto_pequeno(request):
        obj = await leer_json_acotado(request, MAX_CUERPO_PEQUENO)
        if not isinstance(obj, dict):
            raise HTTPException(400, 'Se espera un objeto JSON')
        return obj

    @app.post('/api/acceso/configuracion')
    async def acceso_configurar(request: Request):
        if not instalacion_local(request):
            raise HTTPException(403, 'La instalación inicial solo se configura en el equipo de ROSA2018 antes de crear cuentas')
        obj = await objeto_pequeno(request)
        try:
            app.state.correo.configurar(obj)
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None
        return {'ok': True}

    # Las rutas del enlace por correo (/api/acceso/solicitar y /confirmar) se
    # retiraron el 19 de septiembre de 2026: desde el 18 la entrada es la
    # contraseña, la interfaz no las llamaba y, detrás de sesión, permitían a una
    # sesión heredada de la puerta antigua confirmarse un enlace a sí misma. La
    # clase Acceso conserva `solicitar` y `confirmar` para el día que vuelva.
    @app.post('/api/acceso/entrar')
    async def acceso_entrar(request: Request):
        obj = await objeto_pequeno(request)
        email = obj.get('correo')
        contrasena = obj.get('contrasena')
        if not isinstance(email, str) or not isinstance(contrasena, str):
            raise HTTPException(400, 'Indica el correo y la contraseña')
        try:
            token, email = app.state.acceso.entrar_con_contrasena(email, contrasena, request.client.host if request.client else 'desconocida')
        except ValueError as ex:
            raise HTTPException(401, str(ex)) from None
        respuesta = JSONResponse({'ok': True, 'correo': email})
        seguro = urlsplit(app.state.correo._config()['url']).scheme == 'https'
        respuesta.set_cookie(COOKIE, token, max_age=DURACION, httponly=True, secure=seguro, samesite='strict', path='/')
        return respuesta

    @app.post('/api/acceso/registrar')
    async def acceso_registrar(request: Request):
        # Cualquier correo @alzheimerproject.com pide cuenta; queda pendiente hasta
        # que la cuenta administradora la aprueba (rosa/acceso.py, 25 de septiembre
        # de 2026). No abre sesión: eso lo hace entrar, una vez aprobada.
        obj = await objeto_pequeno(request)
        email = obj.get('correo')
        contrasena = obj.get('contrasena')
        if not isinstance(email, str) or not isinstance(contrasena, str):
            raise HTTPException(400, 'Indica el correo y la contraseña')
        try:
            estado = app.state.acceso.registrar(email, contrasena, request.client.host if request.client else 'desconocida')
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None
        return {'ok': True, 'estado': estado, 'mensaje': 'Solicitud enviada. Quien administra ROSA2018 tiene que aprobarla; después podrás entrar con tu contraseña.'}

    def solo_admin(request: Request) -> str:
        if not es_admin(request.state.usuario):
            raise HTTPException(403, 'Solo la cuenta administradora puede gestionar las cuentas del equipo')
        return str(request.state.usuario)

    @app.get('/api/acceso/solicitudes')
    async def acceso_solicitudes(request: Request):
        solo_admin(request)
        return {'cuentas': app.state.acceso.solicitudes()}

    @app.post('/api/acceso/decidir')
    async def acceso_decidir(request: Request):
        quien = solo_admin(request)
        obj = await objeto_pequeno(request)
        email, estado = obj.get('correo'), obj.get('estado')
        if not isinstance(email, str) or estado not in ('activa', 'rechazada'):
            raise HTTPException(400, 'Indica el correo y si se aprueba o se rechaza')
        try:
            app.state.acceso.decidir_cuenta(email, estado, quien)
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None
        return {'ok': True, 'cuentas': app.state.acceso.solicitudes()}

    @app.post('/api/acceso/entrar_sin_verificar')
    async def acceso_sin_verificar(request: Request):
        # La puerta abierta al dominio (15 de septiembre de 2026, mientras no
        # había correo) se cerró el 18 al llegar la contraseña. No lee el cuerpo
        # ni toca la base: 410 Gone con la explicación de cómo entrar.
        raise HTTPException(410, MENSAJE_PUERTA_CERRADA)

    @app.post('/api/acceso/salir')
    async def acceso_salir(request: Request):
        app.state.acceso.salir(request.cookies.get(COOKIE))
        respuesta = JSONResponse({'ok': True})
        respuesta.delete_cookie(COOKIE, path='/')
        return respuesta


    @app.get("/api/estado")
    async def estado(request: Request) -> Response:
        # La serialización se hace una vez por cambio de cada clave, en el almacén y
        # fuera del hilo del bucle de eventos. Con `?desde=N` (la versión que el
        # navegador ya tiene) solo viajan las claves que cambiaron después, con la
        # cabecera X-Rosa-Parcial; sin él, o si no se puede, el estado entero. La
        # versión de la cabecera es la del contenido, no la que haya al terminar.
        crudo = request.query_params.get("desde")
        desde = int(crudo) if crudo is not None and crudo.isdigit() else None
        version, cuerpo, parcial = await estado_json_de(request, desde)
        cabeceras = {"Cache-Control": "no-store", "X-Rosa-Version": str(version)}
        if parcial:
            cabeceras["X-Rosa-Parcial"] = "1"
            cabeceras["X-Rosa-Desde"] = str(desde)
        return Response(content=cuerpo, media_type="application/json", headers=cabeceras)

    @app.get("/api/correo")
    async def correo_estado(request: Request):
        resultado = app.state.correo.estado()
        resultado['administrador'] = es_admin(request.state.usuario)
        if not resultado['administrador']:
            resultado['historial'] = [x for x in resultado['historial'] if x['destinatario'] == request.state.usuario]
        return JSONResponse(resultado, headers={"Cache-Control": "no-store"})

    @app.post("/api/correo/configuracion")
    async def correo_configuracion(request: Request):
        if not es_admin(request.state.usuario):
            raise HTTPException(403, 'Solo el administrador puede configurar el proveedor')
        cambios = await leer_json_acotado(request, MAX_CUERPO_PEQUENO)
        try:
            if not isinstance(cambios, dict):
                raise ValueError("Se espera un objeto de configuración")
            resultado = app.state.correo.configurar(cambios)
        except (ValueError, UnicodeDecodeError) as ex:
            raise HTTPException(400, str(ex)) from None
        return JSONResponse(resultado, headers={"Cache-Control": "no-store"})

    @app.post("/api/correo/prueba")
    async def correo_prueba(request: Request):
        try:
            id_ = app.state.correo.prueba(request.state.usuario)
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None
        return {"ok": True, "id": id_}

    @app.get("/api/eventos")
    async def eventos(request: Request) -> EventSourceResponse:
        cola = almacen.suscribir()

        async def generar():
            # El flujo solo AVISA de que hay una versión nueva; el estado se lo baja
            # el navegador con GET /api/estado, que va comprimido (25 de septiembre de
            # 2026). Antes cada evento llevaba el estado entero: 16 MB sin comprimir,
            # porque la compresión no se aplica a text/event-stream. En el Mac no se
            # notaba; por un túnel a 1 MB por segundo cada evento tardaba más que los
            # 45 segundos del vigilante de la interfaz, que cerraba el flujo y abría
            # otro, que volvía a empezar los 16 MB: la primera persona que entró desde
            # fuera se quedó cargando para siempre. La versión que este cliente ya
            # recibió sigue sin repetirse (S-17).
            ultima_enviada = -1
            try:
                ultima_enviada = almacen.version
                yield {"event": "version", "id": str(ultima_enviada), "data": "", "retry": 2000}
                while True:
                    if request.state.usuario and not app.state.acceso.usuario(request.cookies.get(COOKIE)):
                        break
                    if await request.is_disconnected():
                        break
                    try:
                        aviso = await asyncio.wait_for(cola.get(), timeout=10)
                    except asyncio.TimeoutError:
                        continue
                    # Coalescer: si llegaron varias versiones, solo importa la ultima.
                    # Un aviso `None` es un empuje forzado (cambiaron los avisos de la
                    # persona, que no viven en el estado) y se manda aunque la
                    # versión sea la misma.
                    forzar = aviso is None
                    while not cola.empty():
                        forzar = cola.get_nowait() is None or forzar
                    if request.state.usuario and not app.state.acceso.usuario(request.cookies.get(COOKIE)):
                        break
                    version = almacen.version
                    if version == ultima_enviada and not forzar:
                        continue
                    ultima_enviada = version
                    # `forzar`: cambiaron los avisos de la persona, que no viven en el
                    # estado; el navegador vuelve a pedirlo aunque la versión sea la misma.
                    yield {"event": "version", "id": str(version), "data": "forzar" if forzar else ""}
            finally:
                almacen.desuscribir(cola)

        # El latido es un evento real (no un comentario) para que el navegador
        # pueda detectar un flujo muerto: si pasa por un proxy (Vite en
        # desarrollo) y el servidor se reinicia, el proxy puede dejar la
        # conexion abierta sin datos y EventSource no se entera solo.
        return EventSourceResponse(generar(), ping=15, ping_message_factory=lambda: ServerSentEvent(event="latido", data=str(almacen.version)), headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/gepa/{accion_gepa}")
    async def controlar_gepa(accion_gepa: str, request: Request):
        if not es_admin(request.state.usuario):
            raise HTTPException(403, "Solo administración puede controlar la optimización global")
        servicio = getattr(almacen, "gepa_servicio", None)
        if servicio is None:
            raise HTTPException(503, "El servicio GEPA no está iniciado en este servidor")
        if accion_gepa not in ("pausar", "reanudar", "restablecer"):
            raise HTTPException(400, "Control GEPA desconocido")
        servicio.control(accion_gepa)
        return {"ok": True}

    @app.post("/api/acciones/{nombre}")
    async def accion(nombre: str, request: Request) -> dict[str, Any]:
        if nombre not in ACCIONES:
            raise HTTPException(404, f"Acción desconocida: {nombre}")
        if nombre in ACCIONES_INTERNAS and not igual_secreto(request.headers.get("x-rosa-interno", ""), app.state.token_interno):
            raise HTTPException(403, f"{nombre} solo la aplica el servidor de ROSA2018")
        if "application/json" not in request.headers.get("content-type", ""):
            raise HTTPException(415, "Los argumentos van como application/json")
        args = await leer_json_acotado(request, MAX_CUERPO_ACCION)
        if not isinstance(args, dict):
            raise HTTPException(400, "Los argumentos van como objeto JSON")
        try:
            if nombre == 'actualizarAvisos' and request.state.usuario:
                resultado = app.state.correo.guardar_preferencias(request.state.usuario, args.get('avisos'))
                almacen._avisar(forzar=True)
            else:
                # El actor es la sesión: el almacén lo guarda en la fila del registro
                # (dentro del hash) y lo pone como `quien` en los reducers que firman
                # decisiones, ignorando el que mande el navegador (S-22).
                resultado = almacen.aplicar(nombre, args, actor=request.state.usuario)
        except EscritorObsoleto as ex:
            # Otro proceso escribió sobre la base (S-01): este servidor ya no guarda
            # nada y se está cerrando. La persona lo sabe, en vez de un 500 mudo.
            raise HTTPException(503, f"Esta ROSA2018 ya no puede guardar cambios: {str(ex)[:300]}") from None
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError, IndexError) as ex:
            # El almacen ya deshizo la mutacion a medias; el cliente recibe un 400 con el motivo.
            raise HTTPException(400, f"Argumentos inválidos para {nombre}: {type(ex).__name__}: {str(ex)[:200]}")
        if nombre == "asignarExperimento" and resultado is not False and isinstance(args.get("hipotesis_id"), str):
            # El prerregistro recien congelado se sella con un tercero, fuera de la peticion.
            asyncio.get_running_loop().create_task(_sellar_prerregistro(args["hipotesis_id"]))
        return {"ok": resultado is not False, "resultado": resultado, "version": almacen.version}

    async def _sellar_prerregistro(hipotesis_id: str) -> dict[str, Any]:
        """Sella el artefacto de prerregistro (RFC 3161, dos o tres autoridades)
        y lo registra en la hipótesis. Nunca lanza: el fallo queda en el estado."""
        from rosa import sello as S

        h = next((x for x in almacen.estado["hipotesis"] if x["id"] == hipotesis_id), None)
        x = (h or {}).get("experimento") or {}
        art = next((a for a in almacen.estado.get("artefactos", []) if a["id"] == x.get("prerregistroArtefactoId")), None)
        if not h or not art:
            return {"ok": False, "error": "sin prerregistro que sellar"}
        contenido = (art.get("versiones") or [{}])[-1].get("contenido") or ""
        resultado = await asyncio.to_thread(S.sellar, contenido)
        almacen.aplicar("registrarSelloExterno", {"hipotesis_id": hipotesis_id, "sello": resultado})
        return resultado

    @app.post("/api/hipotesis/{hipotesis_id}/sellar")
    async def sellar(hipotesis_id: str) -> dict[str, Any]:
        """Botón "Sellar con un tercero": pide (o repite) el sello del prerregistro."""
        return await _sellar_prerregistro(hipotesis_id)

    @app.get("/api/corridas/{corrida_id}/prisma")
    async def prisma_de(corrida_id: str) -> dict[str, Any]:
        """El flujo de búsqueda en PRISMA 2020 (variables oficiales del diagrama,
        ítems 6, 7, 8, 16a y 16b), la extensión viva y la declaración de la IA,
        con el Markdown listo para un manuscrito. Sin ningún modelo."""
        from rosa import prisma as PRISMA

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                c = next((x for x in almacen.estado["corridas"] if x["id"] == corrida_id), None)
                if not c:
                    return None
                return PRISMA.informe(almacen.estado, c, almacen.llamadas_de(corrida_id, 5000), P.ahora_ms())

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Corrida desconocida")
        return r

    @app.get("/api/investigaciones/{investigacion_id}/costes")
    async def costes(investigacion_id: str) -> dict[str, Any]:
        """Coste por decisión de una investigación: dólares del modelo más horas
        de revisión humana a la tarifa declarada; por dossier, por candidata y
        por decisión; y la tendencia por iteración."""
        from rosa import costes as C

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                if not any(i["id"] == investigacion_id for i in almacen.estado["investigaciones"]):
                    return None
                por_corrida = {c["id"]: almacen.llamadas_de(c["id"], 20000) for c in almacen.estado["corridas"] if c.get("investigacionId") == investigacion_id}
                return C.costes_de_investigacion(almacen.estado, investigacion_id, por_corrida)

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Investigación desconocida")
        return r

    @app.get("/api/investigaciones/{investigacion_id}/ruta")
    async def ruta_de(investigacion_id: str) -> dict[str, Any]:
        """La vista de programa de la ruta terapéutica (rosa/ruta.py): las
        hipótesis vivas agrupadas por diana, cuántas cubren cada uno de los ocho
        pasos y los huecos. Por regla, sin modelo; se calcula bajo demanda."""
        from rosa import ruta as RUTA

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                if not any(i["id"] == investigacion_id for i in almacen.estado["investigaciones"]):
                    return None
                return RUTA.mapa_ruta(almacen.estado, investigacion_id)

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Investigación desconocida")
        return r

    @app.get("/api/investigaciones/{investigacion_id}/mapa")
    async def mapa_de(investigacion_id: str) -> dict[str, Any]:
        """El mapa del estado de la enfermedad (rosa/mapa_enfermedad.py): dónde
        está la evidencia por estadio, región, célula y nivel, y los huecos que
        nombra la misión; con su texto en castellano. Recalculado a demanda,
        para el botón "Actualizar mapa" sin esperar al cierre de iteración."""
        from rosa import mapa_enfermedad as MAPA

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                if not any(i["id"] == investigacion_id for i in almacen.estado["investigaciones"]):
                    return None
                m = MAPA.mapa(almacen.estado, investigacion_id)
                return {"mapa": m, "texto": MAPA.texto_mapa(almacen.estado, investigacion_id, precalculado=m)}

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Investigación desconocida")
        return r

    @app.get("/api/investigaciones/{investigacion_id}/cifras")
    async def cifras_de(investigacion_id: str) -> dict[str, Any]:
        """Las tres cifras de aprendizaje (rosa/cifras_aprendizaje.py): acierto
        prerregistrado, tiempo hasta decisión y reutilización heredada, con su
        texto en llano y su glosario. Misma forma que `cifrasAprendizaje` en la
        investigación, pero al momento."""
        from rosa import cifras_aprendizaje as CIFRAS

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                if not any(i["id"] == investigacion_id for i in almacen.estado["investigaciones"]):
                    return None
                return CIFRAS.resumen_cifras(almacen.estado, investigacion_id, P.ahora_ms())

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Investigación desconocida")
        return r

    @app.get("/api/experimento/vocabularios")
    async def vocabularios_experimento() -> dict[str, Any]:
        """Los vocabularios cerrados del contrato del experimento (propósito BEST
        del biomarcador, nivel del desenlace, sistema experimental, tipo de
        lectura), cada clave con su etiqueta y su definición en una frase: la
        interfaz los usa para los selectores y para explicar cada término."""
        from rosa import experimento as XP

        return XP.vocabularios()

    @app.get("/api/hipotesis/{hipotesis_id}/contrato")
    async def contrato_de(hipotesis_id: str) -> dict[str, Any]:
        """El contrato del experimento de una hipótesis juzgado por regla: los
        problemas (en castellano, uno por frase), el texto para la ficha y el
        hash de las lecturas (lo que el prerregistro congela)."""
        from rosa import experimento as XP

        def armar() -> dict[str, Any] | None:
            with almacen._lock:
                h = next((x for x in almacen.estado["hipotesis"] if x["id"] == hipotesis_id), None)
                if not h:
                    return None
                x = h.get("experimento") or {}
                return {"problemas": XP.validar_contrato(x), "texto": XP.texto_contrato(x), "hash": XP.hash_lecturas(x) if x else ""}

        r = await asyncio.to_thread(armar)
        if r is None:
            raise HTTPException(404, "Hipótesis desconocida")
        return r

    @app.get("/api/hipotesis/{hipotesis_id}/rocrate")
    async def rocrate_de(hipotesis_id: str) -> Response:
        """El expediente de la hipótesis como RO-Crate (zip) con procedencia
        W3C PROV: verificable con herramientas de terceros, sin ROSA2018."""
        from rosa import rocrate as RC

        def armar() -> bytes | None:
            with almacen._lock:
                h = next((x for x in almacen.estado["hipotesis"] if x["id"] == hipotesis_id), None)
                if not h:
                    return None
                return RC.zip_bytes(RC.armar(almacen.estado, h, P.ahora_ms()))

        datos = await asyncio.to_thread(armar)
        if datos is None:
            raise HTTPException(404, "Hipótesis desconocida")
        return Response(content=datos, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="rosa-{hipotesis_id}.crate.zip"', "Cache-Control": "no-store"})

    @app.get("/api/registro/integridad")
    async def integridad() -> dict[str, Any]:
        """Recorre la cadena de hashes del registro de acciones y distingue una
        bifurcación por reinicio (dos procesos a la vez) de una fila borrada o
        alterada; cuenta los cortes documentados con `reanclaje_registro`."""
        return await asyncio.to_thread(almacen.verificar_cadena)

    @app.post("/api/registro/reanclar")
    async def reanclar(request: Request) -> dict[str, Any]:
        """Documenta las roturas actuales de la cadena con un motivo escrito y
        vuelve a anclarla desde ahí. Solo administración; la fila guarda quién
        y por qué, y no toca el estado."""
        if not es_admin(request.state.usuario):
            raise HTTPException(403, "Solo administración puede documentar un corte del registro")
        obj = await objeto_pequeno(request)
        try:
            return await asyncio.to_thread(almacen.reanclar_registro, str(obj.get("motivo", "")), request.state.usuario)
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None

    @app.get("/api/calidad/acuerdo")
    async def acuerdo_jueces() -> dict[str, Any]:
        """Acuerdo juez-humano del conjunto dorado, por comprobación."""
        from rosa import acuerdo_dorado as ACU

        return ACU.acuerdo_dorado(almacen.instantanea())

    @app.get("/api/llamadas/{corrida_id}")
    async def llamadas(corrida_id: str) -> list[dict[str, Any]]:
        return almacen.llamadas_de(corrida_id)

    @app.get("/api/corridas/{corrida_id}/evidencia")
    async def evidencia(corrida_id: str) -> JSONResponse:
        datos = almacen.evidencia_de(corrida_id)
        if datos is None:
            raise HTTPException(404, "Corrida desconocida")
        return JSONResponse(content=datos, headers={"Cache-Control": "no-store"})

    @app.get("/api/corridas/{corrida_id}/citas")
    async def citas_de(corrida_id: str) -> JSONResponse:
        """Las afirmaciones de la corrida con su veredicto y de qué se apoyan,
        para la columna de la izquierda del visor de citas."""
        from rosa import citas as CI

        c = next((x for x in almacen.estado["corridas"] if x["id"] == corrida_id), None)
        if not c:
            raise HTTPException(404, "Corrida desconocida")

        # Recorrer las afirmaciones de una corrida grande cuesta 1,2 s de CPU (1.431
        # afirmaciones, medido el 29 de septiembre de 2026): en el bucle de eventos
        # eso congela el SSE, la corrida y el resto del servidor. Va a un hilo, y lo
        # que el hilo lee es una COPIA hecha aquí sin ceder el control: ningún
        # reducer puede correr entre estas dos líneas, así que la copia sale
        # coherente y el hilo no lee una lista que la corrida está modificando.
        instante = {"_afirmaciones": copy.deepcopy(c.get("_afirmaciones") or []), "_fuentes": copy.deepcopy(c.get("_fuentes") or [])}

        def _calcular() -> dict[str, Any]:
            filas = CI.lista(instante)
            return {"corridaId": corrida_id, "resumen": CI.resumen(instante, filas), "afirmaciones": filas}

        return JSONResponse(content=await asyncio.to_thread(_calcular), headers={"Cache-Control": "no-store"})

    @app.get("/api/corridas/{corrida_id}/citas/{afirmacion_id}")
    async def cita(corrida_id: str, afirmacion_id: str) -> JSONResponse:
        """La página tal como ROSA2018 la leyó, con el pasaje localizado dentro
        de ella y, si no está entero, el tramo que falta."""
        from rosa import citas as CI

        c = next((x for x in almacen.estado["corridas"] if x["id"] == corrida_id), None)
        if not c:
            raise HTTPException(404, "Corrida desconocida")
        ficha = CI.ficha(c, afirmacion_id)
        if ficha is None:
            raise HTTPException(404, "Afirmación desconocida")
        return JSONResponse(content=ficha, headers={"Cache-Control": "no-store"})

    @app.get("/api/artefactos/{artefacto_id}/v/{n}.pdf")
    async def dossier_pdf(artefacto_id: str, n: int) -> Response:
        """Una versión de un dossier en PDF con el diseño de la norma AP-DOC-002:
        con su código si esa versión se emitió como documento controlado, como
        borrador sin código si no."""
        from rosa import documento_controlado as DC

        r = DC.para_descargar(almacen.estado, artefacto_id, n, P.ahora_ms())
        if r is None:
            raise HTTPException(404, "Ese dossier o esa versión no existen")
        contenido, id_doc, v = r
        datos = await asyncio.to_thread(DC.pdf, contenido, id_doc, v)
        nombre = f"{id_doc}_{v['version']}.pdf" if id_doc else f"Dossier_borrador_v{n}.pdf"
        return Response(
            content=datos,
            media_type="application/pdf",
            headers={"Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{nombre}"'},
        )

    @app.get("/api/documentos/{hipotesis_id}/{version}.pdf")
    async def documento_pdf(hipotesis_id: str, version: str) -> Response:
        """El documento controlado de una hipótesis (norma AP-DOC-002) en Word,
        tal como se emitió esa versión: la cabecera y el pie de la norma en
        cada página, con la numeración como campo automático, y como cuerpo el
        dossier que se emitió, no el de hoy."""
        from rosa import documento_controlado as DC

        h = next((x for x in almacen.estado["hipotesis"] if x.get("id") == hipotesis_id), None)
        if not h:
            raise HTTPException(404, "Hipótesis desconocida")
        v = DC.version_emitida(h, version)
        if not v:
            raise HTTPException(404, "Esa versión del documento no está emitida")
        art = next((a for a in almacen.estado.get("artefactos", []) if a.get("id") == v.get("artefactoId")), None)
        n = int(v.get("versionArtefacto") or 0)
        if not art or not 1 <= n <= len(art.get("versiones") or []):
            raise HTTPException(404, "El dossier que se emitió ya no está en el estado")
        # Una copia de lo que se lee, y el Word fuera del bucle: son décimas de CPU.
        id_doc, meta, contenido = str(h["documentoControlado"]["id"]), dict(v), str(art["versiones"][n - 1].get("contenido") or "")
        datos = await asyncio.to_thread(DC.pdf, contenido, id_doc, meta)
        return Response(
            content=datos,
            media_type="application/pdf",
            headers={"Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{id_doc}_{meta["version"]}.pdf"'},
        )

    @app.get("/api/corridas/{corrida_id}/citas/{afirmacion_id}/pdf")
    async def cita_pdf(corrida_id: str, afirmacion_id: str) -> FileResponse:
        """El PDF del que salió esa página. Solo se sirve si está dentro del
        directorio de PDF: la ruta viene del estado y el estado no decide qué
        ficheros publica ROSA2018."""
        from rosa import citas as CI

        c = next((x for x in almacen.estado["corridas"] if x["id"] == corrida_id), None)
        if not c:
            raise HTTPException(404, "Corrida desconocida")
        ruta = CI.ruta_pdf(c, afirmacion_id)
        if ruta is None:
            raise HTTPException(404, "Esa cita no tiene PDF guardado")
        return FileResponse(str(ruta), media_type="application/pdf", headers={"Cache-Control": "no-store", "Content-Disposition": f'inline; filename="{ruta.name}"'})

    @app.get("/api/corridas/{corrida_id}/citas/{afirmacion_id}/pagina.png")
    async def cita_pagina(corrida_id: str, afirmacion_id: str) -> Response:
        """La página del PDF con el pasaje ya pintado encima.

        El visor de PDF de Chrome no sabe resaltar: de los parámetros de
        apertura solo lee `nameddest`, `navpanes`, `page`, `toolbar`, `view` y
        `zoom`, y tira `search=` sin avisar. Como el PDF lo sirve ROSA2018, la
        marca la pone ROSA2018 y llega hecha, con la misma regla de palabras
        que usa el panel de texto."""
        from rosa import citas as CI

        c = next((x for x in almacen.estado["corridas"] if x["id"] == corrida_id), None)
        if not c:
            raise HTTPException(404, "Corrida desconocida")
        try:
            hecho = await asyncio.to_thread(CI.pagina_marcada, c, afirmacion_id)
        except CI.PdfIlegible as ex:
            # Un PDF roto no es un PDF que falta: se dice lo que pasa.
            raise HTTPException(422, str(ex)) from ex
        if hecho is None:
            raise HTTPException(404, "Esa cita no tiene PDF guardado")
        png, info = hecho
        return Response(
            content=png,
            media_type="image/png",
            headers={
                "Cache-Control": "no-store",
                # La interfaz necesita saber si de verdad se marcó algo para no
                # prometer una marca que no está.
                "X-Rosa-Marcado": "si" if info["marcado"] else "no",
                "X-Rosa-Pagina": str(info["pagina"]),
                "X-Rosa-Paginas": str(info["paginas"]),
                "X-Rosa-Palabras": str(info["palabras"]),
            },
        )

    @app.post("/api/corridas/{corrida_id}/citas/reverificar")
    async def reverificar_citas(corrida_id: str, request: Request) -> dict[str, Any]:
        """Lo que hacía el botón "Reverificar" de una corrida, ahora completo y
        en segundo plano (28 de septiembre de 2026): pide la recuperación de
        citas de esa corrida (rosa/recuperacion_citas.py), que además de volver
        a juzgar enlaza a las hipótesis lo que sale sostenido y rehace sus
        conclusiones. Antes esperaba la pasada entera del juez dentro de la
        petición y se quedaba en el veredicto. El avance vive en el estado."""
        corrida = next((c for c in almacen.estado["corridas"] if c["id"] == corrida_id), None)
        if corrida is None:
            raise HTTPException(404, "Corrida desconocida")
        pedida = await asyncio.to_thread(almacen.aplicar, "pedirRecuperacionCitas", {"investigacion_id": corrida["investigacionId"], "corrida_id": corrida_id}, actor=request.state.usuario)
        if pedida is False:
            return {"ok": False, "motivo": "Ya hay una recuperación de citas pedida o en curso en esta investigación: el avance se ve en la pantalla de Citas."}
        return {"ok": True, "pedida": True, "revisadas": 0, "recuento": {}, "desbloqueadas": 0, "motivo": "Pedida: se hace en segundo plano y el avance se ve en la pantalla de Citas."}

    @app.get("/api/investigaciones/{investigacion_id}/citas/recuperables")
    async def citas_recuperables(investigacion_id: str) -> dict[str, Any]:
        """Sin modelo: cuántas afirmaciones bloqueadas de la investigación ya no
        lo estarían hoy, cuántas se quedaron sin juez y cuántas recuperadas
        faltan por enlazar, por corrida (rosa/recuperacion_citas.py)."""
        from rosa import recuperacion_citas as RC

        if not any(i.get("id") == investigacion_id for i in almacen.estado["investigaciones"]):
            raise HTTPException(404, "Investigación desconocida")
        for intento in range(3):
            try:
                return await asyncio.to_thread(RC.recuperables, almacen.estado, investigacion_id)
            except RuntimeError:
                # El bucle añadió algo a una lista mientras se leía: se vuelve a contar.
                if intento == 2:
                    raise HTTPException(503, "El estado cambiaba mientras se contaba: inténtalo otra vez.") from None
        raise HTTPException(503, "No se pudo contar")

    @app.post("/api/hipotesis/{hipotesis_id}/datos")
    async def subir_datos(hipotesis_id: str, fichero: UploadFile = File(...), analisis: str = Form(""), sintetico: str = Form("no")) -> dict[str, Any]:
        """Los datos del laboratorio para una hipótesis con experimento
        asignado: se guardan en `datos/<hipotesis>/` y se registra el fichero;
        el bucle los evalúa contra el prerregistro y rehace la conclusión.
        `sintetico` es la casilla "son datos de prueba" de la ficha (S-18): el
        reducer la guarda en `experimento.datosSinteticos` y esa evidencia no
        sube nunca el techo GRADE."""
        from rosa import datos as D

        h = next((x for x in almacen.estado["hipotesis"] if x["id"] == hipotesis_id), None)
        if not h or not h.get("experimento"):
            raise HTTPException(404, "Hipótesis sin experimento propuesto")
        contenido = await _leer_acotado(fichero, D.MAX_BYTES)
        tamano = len(contenido)
        try:
            ruta = await asyncio.to_thread(D.guardar, hipotesis_id, fichero.filename or "datos", contenido)
        except ValueError as ex:
            raise HTTPException(413, str(ex))
        resultado = almacen.aplicar("registrarDatosExperimento", {"hipotesis_id": hipotesis_id, "fichero": ruta.name, "analisis": analisis, "sintetico": sintetico})
        return {"ok": resultado is not False, "fichero": ruta.name, "bytes": tamano, "version": almacen.version}

    @app.post("/api/investigaciones/{investigacion_id}/datasets")
    async def subir_dataset(investigacion_id: str, fichero: UploadFile = File(...), nombre: str = Form(""), descripcion: str = Form(""), sintetico: str = Form("no")) -> dict[str, Any]:
        """Un dataset con su libro de procedencia: el fichero se guarda en
        `datos/_datasets/<investigacion>/<dataset>/`, se calcula su sha256, se
        perfila (columnas, filas, centinelas, duplicados, diccionario por
        rellenar) y queda pendiente hasta que la persona complete origen,
        licencia y permisos y apruebe el contrato. Nada del fichero pasa por
        un modelo aqui."""
        from rosa import datos as D
        from rosa.ejecucion import hash_fichero
        from rosa.estado import plantilla as P

        inv = next((i for i in almacen.estado["investigaciones"] if i["id"] == investigacion_id), None)
        if not inv:
            raise HTTPException(404, "Investigación desconocida")
        contenido = await _leer_acotado(fichero, D.MAX_BYTES)
        tamano = len(contenido)
        dataset_id = P.nuevo_id("ds")
        try:
            ruta = await asyncio.to_thread(D.guardar_dataset, investigacion_id, dataset_id, fichero.filename or "datos", contenido)
        except ValueError as ex:
            raise HTTPException(413, str(ex))
        del contenido
        try:
            # El perfilado y el hash de un fichero de 100 MB tardan segundos: fuera del bucle de eventos.
            perfil = await asyncio.to_thread(D.perfil_dataset, ruta)
        except Exception as ex:  # noqa: BLE001
            with contextlib.suppress(OSError):
                ruta.unlink()
            raise HTTPException(400, f"No se pudo perfilar el fichero: {type(ex).__name__}: {str(ex)[:160]}")
        es_sintetico = sintetico.strip().lower() in ("si", "sí", "true", "1", "yes")
        procedencia = {**P.procedencia_dataset_vacia(), "hash": await asyncio.to_thread(hash_fichero, ruta), "fichero": ruta.name, "filas": perfil["filas"], "diccionario": perfil["diccionario"], "columnas": perfil["columnas"], "sintetico": es_sintetico, "fechaObtencion": P.ahora_ms(), "clase": "prediccion" if es_sintetico else "observacion_original", "permiteLlmTerceros": es_sintetico}
        dataset = {
            "nombre": nombre.strip() or (fichero.filename or "datos"),
            "descripcion": descripcion.strip(),
            "tamanoMb": round(tamano / (1024 * 1024), 2),
            "columnas": len(perfil["columnas"]),
            "columnasSinDiccionario": len(perfil["diccionario"]),
            "valoresCentinela": perfil["valoresCentinela"],
            "nombresDuplicados": perfil["nombresDuplicados"],
            "clasificacion": "publico" if es_sintetico else "interno",
            "origen": "subida",
            "procedencia": procedencia,
        }
        resultado = almacen.aplicar("anadirDataset", {"investigacion_id": investigacion_id, "dataset": dataset, "id_": dataset_id})
        return {"ok": resultado is not False, "datasetId": dataset_id, "fichero": ruta.name, "bytes": tamano, "perfil": {k: perfil[k] for k in ("filas", "valoresCentinela", "nombresDuplicados", "tabular")}, "version": almacen.version}

    @app.get("/api/politicas")
    async def politicas_actuales() -> dict[str, Any]:
        from rosa import politicas

        return politicas.resumen()

    @app.post("/api/investigaciones/{investigacion_id}/preguntar")
    async def preguntar_con_herramientas(investigacion_id: str, request: Request) -> dict[str, Any]:
        """Una pregunta con herramientas (conectores, búsqueda en el proyecto,
        modelo de mundo) hecha por una persona desde la interfaz. Corre un
        ReAct acotado con el cerebro y guarda la respuesta con sus consultas.
        El cuerpo se lee con tope (la pregunta se recorta a 2000 caracteres) y
        la autoría es la sesión, no lo que mande el navegador (M-29)."""
        from rosa import herramientas as H
        from rosa.bucle.pasos import _texto_mision
        from rosa.gateway import modelos as cargar_modelos

        if "application/json" not in request.headers.get("content-type", ""):
            raise HTTPException(415, "La pregunta va como application/json")
        cuerpo = await leer_json_acotado(request, MAX_CUERPO_PREGUNTA)
        if not isinstance(cuerpo, dict):
            raise HTTPException(400, "Se espera un objeto JSON con la pregunta")
        inv = next((i for i in almacen.estado["investigaciones"] if i["id"] == investigacion_id), None)
        pregunta = str(cuerpo.get("pregunta", "")).strip()
        if not inv or not pregunta:
            raise HTTPException(400, "Falta la pregunta o la investigación")
        quien = str(request.state.usuario or "servidor")[:80]
        hoy = time.strftime("%Y-%m-%d")
        cont = app.state.preguntas_hoy
        if cont["dia"] != hoy:
            cont.update(dia=hoy, n=0)
        if cont["n"] >= config.PREGUNTAS_MAX_DIA:
            raise HTTPException(429, f"Tope de {config.PREGUNTAS_MAX_DIA} preguntas con herramientas por día alcanzado (ROSA_PREGUNTAS_MAX_DIA)")
        cont["n"] += 1
        modelos_ = getattr(app.state, "modelos", None) or cargar_modelos()
        app.state.modelos = modelos_
        async with app.state.semaforo_preguntas:
            try:
                r = await asyncio.wait_for(H.preguntar(modelos_.cerebro, almacen.estado, investigacion_id, pregunta[:2000], f"Objetivo: {inv['objetivo']}. {_texto_mision(inv)}", almacen=almacen), timeout=600)
                r["pregunta"], r["quien"], r["error"] = pregunta[:2000], quien, None
            except Exception as ex:  # noqa: BLE001
                print(f"preguntar con herramientas fallo: {type(ex).__name__}: {str(ex)[:300]}", file=sys.stderr)
                r = {"pregunta": pregunta[:2000], "quien": quien, "respuesta": "", "limites": "", "herramientas": [], "consultas": [], "iteraciones": 0, "error": "El modelo o una herramienta no respondieron; el detalle está en el registro del servidor"}
        almacen.aplicar("registrarPreguntaBases", {"investigacion_id": investigacion_id, "pregunta": r})
        return {"ok": r.get("error") is None, "resultado": {k: v for k, v in r.items() if k != "consultas"} | {"consultas": len(r.get("consultas", []))}, "version": almacen.version}

    @app.get("/api/espejo")
    async def espejo_estado() -> dict[str, Any]:
        """Estado del espejo del estado en Convex (apagado si no hay clave)."""
        esp = getattr(app.state, "espejo", None)
        if esp is None:
            from rosa import espejo_convex

            return {"activo": espejo_convex.activo(), "url": None, "ultimaVersion": None, "sincronizadoEn": None, "entidades": 0, "pendiente": False, "error": None, "envios": 0, "ms": 0}
        return {k: (v if k != "url" else (v.split("//")[-1] if v else None)) for k, v in esp.estado.items()}

    @app.get("/api/skills")
    async def skills_actuales() -> list[dict[str, Any]]:
        from rosa import skills as SK

        return SK.catalogo()

    @app.get("/api/buscar")
    async def buscar_por_significado(q: str, investigacion: str | None = None, k: int = 8):
        """Búsqueda por significado en el registro (hechos, hipótesis, fuentes)
        con el índice semántico; complementa a la búsqueda por palabras de la
        interfaz. Sin clave del gateway devuelve una lista vacía y lo dice."""
        from rosa import indice_semantico

        if not indice_semantico.disponible():
            return {"disponible": False, "resultados": []}
        indice = indice_semantico.de_almacen(almacen)
        try:
            resultados = await indice.buscar(q[:500], k=max(1, min(k, 30)), investigacion_id=investigacion or None)
        except Exception as ex:  # noqa: BLE001
            return {"disponible": True, "resultados": [], "error": f"No se pudo buscar: {str(ex)[:120]}"}
        return {"disponible": True, "resultados": resultados}

    @app.get("/api/conectores")
    async def conectores_actuales() -> list[dict[str, Any]]:
        from rosa.conectores import catalogo

        return catalogo()

    @app.get("/api/salud")
    async def salud() -> dict[str, Any]:
        # `obsoleto`: otro proceso escribió sobre la base y este ya no guarda (S-01).
        return {"ok": not almacen.obsoleto, "version": almacen.version, "obsoleto": almacen.obsoleto}

    if config.FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

        raiz_dist = config.FRONTEND_DIST.resolve()

        @app.get("/{ruta:path}")
        async def frontend(ruta: str) -> FileResponse:
            # Sin salto de directorio: el fichero tiene que quedar dentro de dist.
            candidato = (raiz_dist / ruta).resolve()
            if ruta and candidato.is_relative_to(raiz_dist) and candidato.is_file():
                return FileResponse(candidato)
            return FileResponse(raiz_dist / "index.html")

    return app
