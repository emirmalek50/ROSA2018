"""Puente del asistente a la API de ROSA con la sesión de quien pregunta.

Catálogo explícito y comprobable: ninguna URL libre, credencial generada ni
llamada a la red. Las rutas conservan sus validaciones y permisos habituales.
"""
from __future__ import annotations

import asyncio
import json
import re
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote

import dspy
import httpx

from rosa import killer as K

# nombre: (ruta, descripción). Los parámetros se descubren en OpenAPI.
LECTURAS = {
    "eliminacion_dataset": ("/api/investigaciones/{investigacion_id}/datasets/{dataset_id}/eliminacion", "Comprueba el dataset, los usos que impiden borrarlo y si una eliminación anterior retiró también su archivo."),
    "laboratorio": ("/api/laboratorio", "Laboratorio global calculado: resumen, dianas, compuestos y descartes. Usa camino=resumen o dianas."),
    "experimentos_diana": ("/api/laboratorio/{uniprot}/experimentos", "Experimentos completos de una proteína UniProt."),
    "oligonucleotidos": ("/api/laboratorio/{uniprot}/oligos", "Cribado actualizado y candidatos de oligonucleótidos."),
    "evidencia": ("/api/corridas/{corrida_id}/evidencia", "Procedencia, consultas, fuentes y afirmaciones con veredicto."),
    "citas": ("/api/corridas/{corrida_id}/citas", "Afirmaciones verificadas y resumen de sus citas."),
    "cita": ("/api/corridas/{corrida_id}/citas/{afirmacion_id}", "Pasaje original, página exacta y localización de una cita."),
    "citas_recuperables": ("/api/investigaciones/{investigacion_id}/citas/recuperables", "Citas pendientes que se pueden recuperar."),
    "prisma": ("/api/corridas/{corrida_id}/prisma", "Informe PRISMA calculado y declaración de IA."),
    "costes": ("/api/investigaciones/{investigacion_id}/costes", "Costes por decisión, revisión e iteración."),
    "ruta": ("/api/investigaciones/{investigacion_id}/ruta", "Ruta terapéutica y huecos actuales."),
    "mapa": ("/api/investigaciones/{investigacion_id}/mapa", "Mapa de enfermedad recién calculado."),
    "cifras": ("/api/investigaciones/{investigacion_id}/cifras", "Métricas de aprendizaje actuales."),
    "vocabularios": ("/api/experimento/vocabularios", "Vocabularios y definiciones del contrato experimental."),
    "contrato": ("/api/hipotesis/{hipotesis_id}/contrato", "Validador del experimento: problemas, texto y hash."),
    "integridad": ("/api/registro/integridad", "Verificación de la cadena de auditoría."),
    "acuerdo": ("/api/calidad/acuerdo", "Acuerdo entre juez y humanos, calculado."),
    "llamadas": ("/api/llamadas/{corrida_id}", "Todas las llamadas al modelo, errores, tiempos y tokens. Usa desde=siguiente y conserva hasta para recorrer una instantánea estable."),
    "busqueda_semantica": ("/api/buscar", "Búsqueda por significado global; q es la pregunta, investigacion es opcional."),
    "skills": ("/api/skills", "Catálogo de métodos científicos; leer_skill abre su contenido."),
    "conectores": ("/api/conectores", "Todos los conectores, disponibilidad y motivos de bloqueo."),
    "estado_google_patents": ("/api/patentes/configuracion", "Estado de la conexión de Google Patents mediante SerpApi, sin credenciales. Configurada no significa conexión verificada; la prueba está en Ajustes > Herramientas."),
    "politicas": ("/api/politicas", "Políticas vigentes de ROSA."),
    "salud": ("/api/salud", "Estado del servidor y capacidad de guardar."),
    "espejo": ("/api/espejo", "Sincronización del espejo y errores."),
    "correo": ("/api/correo", "Estado del correo y avisos visibles para esta sesión, sin credenciales."),
    "acceso": ("/api/acceso/estado", "Permisos de la sesión actual."),
    "cuentas": ("/api/acceso/solicitudes", "Solicitudes del equipo; solo administración."),
    "exportar_rocrate": ("/api/hipotesis/{hipotesis_id}/rocrate", "Descarga del expediente reproducible RO-Crate."),
    "exportar_artefacto": ("/api/artefactos/{artefacto_id}/v/{n}.pdf", "Descarga PDF de una versión de artefacto."),
    "exportar_documento": ("/api/documentos/{hipotesis_id}/{version}.pdf", "Descarga PDF de una versión del documento."),
    "pdf_cita": ("/api/corridas/{corrida_id}/citas/{afirmacion_id}/pdf", "PDF original de una cita."),
    "pagina_cita": ("/api/corridas/{corrida_id}/citas/{afirmacion_id}/pagina.png", "Imagen de la página exacta de una cita."),
}
# Las escrituras se guardan como operaciones pendientes y se confirman en el chat.
# Campos permitidos y requeridos del cuerpo, además de los parámetros de ruta.
ESCRITURAS = {
    "eliminar_dataset": ("/api/investigaciones/{investigacion_id}/datasets/{dataset_id}/eliminar", "Eliminar el dataset y su carpeta de ROSA. Conserva la auditoría y los registros compartidos. Consulta eliminacion_dataset antes: no borra datos usados por análisis registrados ni corridas activas.", (), (), False),
    "sellar": ("/api/hipotesis/{hipotesis_id}/sellar", "Pedir o repetir el sello externo del prerregistro", (), (), False),
    "gepa": ("/api/gepa/{accion_gepa}", "Pausar, reanudar o restablecer GEPA", (), (), True),
    "reanclar": ("/api/registro/reanclar", "Documentar un corte del registro y reanclarlo", ("motivo",), ("motivo",), True),
    "decidir_cuenta": ("/api/acceso/decidir", "Aprobar o rechazar una solicitud del equipo", ("correo", "estado"), ("correo", "estado"), True),
    "preferencias_avisos": ("/api/acciones/actualizarAvisos", "Cambiar los avisos de la sesión actual", ("avisos",), ("avisos",), False),
    "configurar_correo": ("/api/correo/configuracion", "Configurar remitente, proveedor y servidor de correo sin cambiar la clave", ("remitente", "url", "zona", "proveedor", "smtpServidor", "smtpUsuario", "smtpPuerto"), (), True),
    "probar_correo": ("/api/correo/prueba", "Enviar un correo de prueba a la persona de esta sesión", (), (), False),
}
CONTEXTO: ContextVar[Any] = ContextVar("servicios_asistente", default=None)


def validar_operacion(nombre: str, argumentos: dict) -> None:
    clave = nombre.removeprefix("servicio:")
    if clave not in ESCRITURAS:
        raise ValueError("Servicio de escritura desconocido")
    ruta, _, campos, requeridos, _ = ESCRITURAS[clave]
    parametros = set(re.findall(r"{(\w+)}", ruta))
    if not isinstance(argumentos, dict) or set(argumentos) - (parametros | set(campos)) or (parametros | set(requeridos)) - set(argumentos):
        raise ValueError("Argumentos incompletos o desconocidos para el servicio")
    construir_ruta(ruta, argumentos)
    if clave == "gepa" and argumentos.get("accion_gepa") not in {"pausar", "reanudar", "restablecer"}:
        raise ValueError("Control GEPA desconocido")
    if clave == "decidir_cuenta" and argumentos.get("estado") not in {"activa", "rechazada"}:
        raise ValueError("Decisión de cuenta desconocida")
    if clave == "reanclar" and not str(argumentos.get("motivo", "")).strip():
        raise ValueError("Explica el motivo del reanclaje")


def construir_ruta(plantilla: str, parametros: dict) -> str:
    def sustituir(m):
        valor = str(parametros.get(m[1], ""))
        if not re.fullmatch(r"[\w.-]{1,160}", valor) or valor in {".", ".."}:
            raise ValueError(f"Identificador inválido: {m[1]}")
        return quote(valor, safe="")
    return re.sub(r"{(\w+)}", sustituir, plantilla)


def paginar(datos: Any, desde: int = 0, camino: str = "") -> str:
    if isinstance(datos, dict) and datos.get("ok") is False:
        camino = ""
    claves = list(datos) if isinstance(datos, dict) else []
    try:
        for parte in camino.split("/") if camino else []:
            datos = datos[int(parte)] if isinstance(datos, list) else datos[parte]
    except (KeyError, ValueError, IndexError, TypeError):
        return json.dumps({"error": "Campo desconocido", "claves": claves}, ensure_ascii=False)
    texto = json.dumps(datos, ensure_ascii=False, default=str)
    desde = max(0, int(desde))
    return K.como_dato(json.dumps({"claves": claves, "camino": camino, "totalCaracteres": len(texto), "desde": desde,
                                 "siguiente": desde + 12000 if desde + 12000 < len(texto) else None,
                                 "contenido": texto[desde:desde + 12000]}, ensure_ascii=False))


class Servicios:
    def __init__(self, app: Any, request: Any, administrador: bool = False):
        self.app = app
        self.administrador = administrador
        # Solo hereda las credenciales de la petición autenticada. No fabrica
        # el token interno ni permite que el modelo elija cabeceras.
        self.headers = {k: request.headers[k] for k in ("cookie", "x-rosa-token", "x-rosa-interno") if k in request.headers}
        self.headers["x-rosa"] = "1"
        self.vista: dict[str, Any] = {}
        self.cache: dict[str, Any] = {}
        self.descargas: list[dict] = []
        self.archivos: dict[str, bytes] = {}
        self.hilo = ""

    async def peticion(self, metodo: str, ruta: str, **kwargs) -> dict:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://127.0.0.1", headers=self.headers) as cliente:
            r = await cliente.request(metodo, ruta, **kwargs)
        if r.status_code >= 400:
            return {"ok": False, "incierto": metodo != "GET" and r.status_code >= 500, "estadoHttp": r.status_code, "error": r.json().get("detail", "No pude comprobar") if "application/json" in r.headers.get("content-type", "") else "No pude comprobar el servicio"}
        if "application/json" in r.headers.get("content-type", ""):
            return {"ok": True, "datos": r.json()}
        self.archivos[ruta] = r.content
        descarga = {"url": ruta, "nombre": r.headers.get("content-disposition", "").split("filename=")[-1].strip('"') or ruta.rsplit("/", 1)[-1], "tipo": r.headers.get("content-type"), "bytes": len(r.content)}
        if descarga not in self.descargas:
            self.descargas.append(descarga)
        return {"ok": True, "datos": {"descarga": ruta, **descarga}}

    def catalogo(self, nombre: str = "") -> dict:
        lecturas = {}
        rutas = self.app.openapi()["paths"]
        for clave, (ruta, descripcion) in LECTURAS.items():
            if clave == "cuentas" and not self.administrador:
                continue
            lecturas[clave] = {"descripcion": descripcion, "parametros": rutas[ruta]["get"].get("parameters", [])}
        escrituras = {"servicio:" + k: {"descripcion": v[1], "argumentos": list(re.findall(r"{(\w+)}", v[0])) + list(v[2]), "obligatorios": list(re.findall(r"{(\w+)}", v[0])) + list(v[3])}
                      for k, v in ESCRITURAS.items() if not v[4] or self.administrador}
        if nombre:
            return lecturas.get(nombre) or escrituras.get(nombre) or {"error": "Servicio desconocido o sin permiso"}
        return {"lecturas": lecturas, "accionesConConfirmacion": escrituras,
                "archivos": "El botón Adjuntar datos del chat carga datasets o resultados con los mismos permisos y procedencia que sus pantallas.",
                "credenciales": "Las contraseñas y claves se introducen en Ajustes, nunca en la conversación."}

    async def consultar(self, nombre: str, parametros: dict, desde: int = 0, camino: str = "") -> str:
        if nombre not in LECTURAS or (nombre == "cuentas" and not self.administrador):
            return paginar({"ok": False, "error": "Servicio desconocido o sin permiso"})
        plantilla = LECTURAS[nombre][0]
        esquema = self.app.openapi()["paths"][plantilla]["get"].get("parameters", [])
        permitidos = {p["name"] for p in esquema}
        if not isinstance(parametros, dict) or set(parametros) - permitidos:
            return paginar({"ok": False, "error": "Parámetros desconocidos", "permitidos": sorted(permitidos)})
        if nombre == "llamadas":
            parametros = {"paginado": True, **parametros}
        ruta = construir_ruta(plantilla, parametros)
        consulta = {p["name"]: parametros[p["name"]] for p in esquema if p["in"] == "query" and p["name"] in parametros}
        clave = json.dumps([nombre, parametros], sort_keys=True)
        if clave not in self.cache:
            self.cache[clave] = await self.peticion("GET", ruta, params=consulta)
        r = self.cache[clave]
        return paginar(r["datos"], desde, camino) if r["ok"] else paginar(r)

    async def leer_documento(self, nombre: str, parametros: dict, pagina: int = 1, desde: int = 0, pregunta_figura: str = "") -> str:
        """Lee una página física exacta de un PDF autorizado o su figura."""
        if nombre not in {"pdf_cita", "exportar_artefacto", "exportar_documento", "pagina_cita"}:
            return paginar({"ok": False, "error": "Selecciona un servicio de PDF o página de cita"})
        await self.consultar(nombre, parametros)
        ruta = construir_ruta(LECTURAS[nombre][0], parametros)
        contenido = self.archivos.get(ruta)
        if contenido is None:
            return await self.consultar(nombre, parametros)
        from rosa.asistente_documentos import interpretar, leer_pdf
        if nombre == 'pagina_cita':
            datos = {'origen': ruta, 'pagina': 'Página exacta de la cita indicada por el servicio'}
            datos.update(await interpretar(contenido, pregunta_figura or 'Describe y transcribe esta página. Señala lo ilegible.'))
        else:
            datos = await leer_pdf(contenido, ruta, pagina, pregunta_figura)
        return paginar(datos, desde)

    async def ejecutar(self, nombre: str, argumentos: dict) -> dict:
        validar_operacion(nombre, argumentos)
        clave = nombre.removeprefix("servicio:")
        plantilla, _, campos, _, admin = ESCRITURAS[clave]
        if admin and not self.administrador:
            return {"ok": False, "error": "Solo administración puede ejecutar esta operación"}
        return await self.peticion("POST", construir_ruta(plantilla, argumentos), json={k: argumentos[k] for k in campos if k in argumentos})

    def herramientas(self) -> list[dspy.Tool]:
        def catalogo_servicios(nombre: str = "") -> str:
            """Servicios de TODO ROSA: laboratorio, evidencia, citas, informes,
            diagnóstico, archivos y administración. Con nombre da sus argumentos.
            Las escrituras se preparan con preparar_accion y se confirman."""
            return json.dumps(self.catalogo(nombre), ensure_ascii=False)

        async def consultar_servicio(nombre: str, parametros: dict[str, Any], desde: int = 0, camino: str = "") -> str:
            """Consulta un servicio del catálogo con sus argumentos exactos.
            Desde pagina por caracteres. Camino selecciona campos separados por
            /, por ejemplo resumen o dianas/0. Cada resultado conserva sus páginas
            durante este turno. Devuelve errores explícitos, nunca ausencia falsa."""
            return await self.consultar(nombre, parametros, desde, camino)

        async def leer_documento(nombre: str, parametros: dict[str, Any], pagina: int = 1, desde: int = 0, pregunta_figura: str = "") -> str:
            """Lee PDFs completos por página física (1 es la primera), sin truncar el texto:
            usa siguientePagina y siguiente para continuar. Servicios: pdf_cita,
            exportar_artefacto, exportar_documento, pagina_cita. Pregunta_figura
            activa lectura visual de gráficos o páginas escaneadas con el modelo."""
            return await self.leer_documento(nombre, parametros, pagina, desde, pregunta_figura)

        def consultar_vista() -> str:
            """Contexto de pantalla, filtros y selección que mandó el navegador.
            Es contexto declarado por el cliente, no evidencia científica ni
            autorización. No conoce cámaras ni paneles de otras pestañas."""
            return paginar(self.vista or {"limite": "Esta petición no incluyó el contexto visual del navegador."})
        return [dspy.Tool(catalogo_servicios), dspy.Tool(consultar_servicio), dspy.Tool(consultar_vista), dspy.Tool(leer_documento)]


def herramientas_locales(almacen: Any) -> list[dspy.Tool]:
    vistas: dict[str, Any] = {}
    paginas_pdf: dict[str, Any] = {}
    paginas_gepa: dict[str, Any] = {}

    def leer_skill(nombre: str, desde: int = 0) -> str:
        """Lee el método científico completo de una skill del catálogo de ROSA.
        Incluye sus scripts de referencia, sin ejecutarlos. Página por caracteres."""
        from rosa import skills
        skill = next((s for s in skills.todas() if s["nombre"] == nombre), None)
        if skill is None:
            return paginar({"error": "Skill desconocida", "nombres": [s["nombre"] for s in skills.todas()]})
        return paginar({**{k: v for k, v in skill.items() if not k.startswith("_")}, "codigoReferencia": skill.get("_scripts", {})}, desde)
    async def leer_dataset(investigacion_id: str, dataset_id: str) -> str:
        """Lee el esquema y una muestra autorizada del dataset real de ROSA.
        Respeta la autorización del libro de procedencia, nunca lee rutas libres.
        Sin permiso para modelos de terceros solo devuelve sus metadatos públicos."""
        from rosa import datos as D
        e = almacen.instantanea()
        inv: dict[str, Any] = next((i for i in e.get("investigaciones", []) if i["id"] == investigacion_id), {})
        ds = next((d for d in inv.get("datasets", []) if d["id"] == dataset_id), None)
        if not ds:
            return paginar({"error": "Dataset desconocido"})
        procedencia = ds.get("procedencia") or {}
        if procedencia.get("permiteLlmTerceros") is not True:
            return paginar({"dataset": ds, "limite": "El libro de procedencia no autoriza enviar el contenido a modelos de terceros."})
        try:
            ruta = D.ruta_dataset(investigacion_id, dataset_id, procedencia.get("fichero", ""))
            texto = await asyncio.to_thread(D.esquema_para_modelo, ruta, procedencia, incluir_filas=True)
            return paginar({"datasetId": dataset_id, "esquema": texto})
        except (OSError, ValueError) as ex:
            return paginar({"error": f"No pude leer el dataset ({type(ex).__name__})"})

    def consultar_documentacion(nombre: str = "", desde: int = 0) -> str:
        """Catálogo y lectura de la documentación de ROSA: arquitectura,
        funcionamiento, alcance y guía de uso. No representa el estado vivo.
        Sin nombre lista documentos. No admite rutas ni archivos de configuración."""
        from rosa.asistente_lecturas import documentos
        from rosa.gepa_continuo import _SECRETOS
        catalogo = documentos()
        if not nombre:
            return paginar({"documentos": list(catalogo)})
        if nombre not in catalogo:
            return paginar({"error": "Documento desconocido", "documentos": list(catalogo)})
        try:
            # Redacción sin recortar el documento: cada bloque conserva su posición.
            texto = catalogo[nombre].read_text()
            texto = _SECRETOS.sub('[REDACTADO]', texto)
            return paginar({"documento": nombre, "texto": texto}, desde)
        except OSError:
            return paginar({"error": "Documento no disponible en esta instalación"})

    async def consultar_dataset(investigacion_id: str, dataset_id: str, desde: int = 0, limite: int = 50, columnas: list[str] | None = None, filtros: dict[str, str] | None = None, campo: str = "", pagina_texto: int = 0, pagina_pdf: int = 1, pregunta_figura: str = "") -> str:
        """Recorre TODAS las filas autorizadas de un CSV, TSV o JSON por páginas.
        desde es índice de fila filtrada; filtros compara valores exactos;
        columnas selecciona campos, campo selecciona una lista dentro de JSON.
        pagina_texto pagina caracteres si una página de filas supera el contexto.
        Para PDF usa pagina_pdf (página física empezando por 1). Los escaneados se leen
        visualmente; pregunta_figura permite consultar gráficos incluso si hay texto."""
        from rosa import datos as D
        from rosa.asistente_lecturas import filas_dataset
        inv = next((i for i in almacen.instantanea().get("investigaciones", []) if i["id"] == investigacion_id), None)
        ds = next((d for d in (inv or {}).get("datasets", []) if d["id"] == dataset_id), None)
        if not ds or (ds.get("procedencia") or {}).get("permiteLlmTerceros") is not True:
            return paginar({"ok": False, "error": "Dataset desconocido o sin autorización para modelos de terceros"})
        try:
            ruta = D.ruta_dataset(investigacion_id, dataset_id, ds["procedencia"].get("fichero", ""))
            if ruta.suffix.lower() == '.pdf':
                from rosa.asistente_documentos import leer_pdf
                stat = ruta.stat()
                clave = json.dumps([str(ruta), stat.st_mtime_ns, stat.st_size, pagina_pdf, pregunta_figura])
                if clave not in paginas_pdf:
                    r = await leer_pdf(ruta, f'dataset:{investigacion_id}/{dataset_id}', pagina_pdf, pregunta_figura)
                    if not r.get('lecturaVisualFallida'):
                        paginas_pdf[clave] = r
                else:
                    r = paginas_pdf[clave]
                return paginar({'datasetId': dataset_id, **r}, pagina_texto)
            r = await asyncio.to_thread(filas_dataset, ruta, desde, limite, columnas or [], filtros or {}, campo)
            return paginar(r, pagina_texto)
        except (OSError, ValueError, KeyError, IndexError, TypeError) as ex:
            return paginar({"ok": False, "error": f"No pude consultar el dataset ({type(ex).__name__})"})

    async def consultar_gepa(desde: int = 0, limite: int = 25, tipo: str = "", programa: str = "", corrida: str = "", pagina_texto: int = 0, desde_ciclos: int = 0, limite_ciclos: int = 10, hasta: int | None = None, hasta_ciclos: int | None = None) -> str:
        """Historial completo y paginado de trazas, evaluaciones y ciclos GEPA.
        Filtra trazas por tipo, programa o corrida. Los ciclos globales tienen
        desde_ciclos y limite_ciclos propios. Conserva hasta y hasta_ciclos al
        avanzar con siguiente y siguienteCiclos. Las credenciales se redactan."""
        from rosa.asistente_lecturas import trazas_gepa
        clave = json.dumps([desde, limite, tipo, programa, corrida, desde_ciclos, limite_ciclos, hasta, hasta_ciclos])
        if clave not in paginas_gepa:
            paginas_gepa[clave] = await asyncio.to_thread(trazas_gepa, almacen, desde, limite, tipo, programa, corrida, desde_ciclos, limite_ciclos, hasta, hasta_ciclos)
        return paginar(paginas_gepa[clave], pagina_texto)

    async def consultar_vista_calculada(investigacion_id: str, vista: str, filtros: dict[str, Any] | None = None, desde: int = 0, camino: str = "") -> str:
        """Atlas o mecanismos calculados por las MISMAS funciones de la interfaz.
        vista: atlas o mecanismos. Sin filtros reproduce la vista predeterminada.
        El atlas usa el mapa guardado igual que la pantalla; no lo inventa."""
        from rosa.asistente_lecturas import vista_compartida
        clave = json.dumps([investigacion_id, vista, filtros or {}], sort_keys=True)
        if clave not in vistas:
            vistas[clave] = await asyncio.to_thread(vista_compartida, almacen.instantanea(), investigacion_id, vista, filtros or {})
        return paginar(vistas[clave], desde, camino)

    return [dspy.Tool(leer_skill), dspy.Tool(leer_dataset), dspy.Tool(consultar_documentacion), dspy.Tool(consultar_dataset), dspy.Tool(consultar_gepa), dspy.Tool(consultar_vista_calculada)]
