"""Documentos de hipótesis controlados, según la norma AP-DOC-002 v01
("Hypothesis Document Control", borrador del 17 de septiembre de 2026, de
Monica Duarte, pendiente de revisión de la dirección).

Qué pide la norma a cada documento de hipótesis:

- Un código propio, correlativo y que no se reutiliza: AP-HYP-001, AP-HYP-002...
  (AP de Alzheimer Project, HYP de hipótesis, tres cifras).
- Tipo DOC, aunque el contenido sea científico.
- Versión con dos cifras enteras: v01, v02...
- Cabecera: [nombre oficial corto] | DOC | AP-HYP-NNN | vNN
- Pie: Confidential | Alzheimer Project | AI Robotix | MMM-DD-YYYY | [iniciales
  del responsable] | Page X of Y, con la numeración como campo automático, nunca
  escrita a mano.
- Una lista de ocho comprobaciones antes de darlo por controlado.

En ROSA2018 el documento de hipótesis es el dossier para el laboratorio
(rosa/dossier.py), que ya se guarda como artefacto con versiones. Emitirlo como
documento controlado es un acto aparte y deliberado (`emitir`): el código lo
asigna siempre el servidor, la primera vez, y queda en la hipótesis para
siempre; cada emisión nueva sube la versión y guarda con ella lo que llevaba
(nombre, fecha, iniciales, cabecera, pie y el resultado de las ocho
comprobaciones), de modo que la v01 se descarga igual aunque luego cambie el
nombre corto o las iniciales. El Word se construye al descargarlo a partir de
esa versión y del contenido del dossier que se emitió (`docx`).

La norma es un borrador: todo lo que fija está aquí, en un solo sitio.
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

SOP = "AP-DOC-002 v01"
PREFIJO = "AP"
AREA = "HYP"
TIPO = "DOC"
CONFIDENCIALIDAD = "Confidential"
PROYECTO = "Alzheimer Project"
ORGANIZACION = "AI Robotix"

# Las iniciales del responsable que van en el pie. La norma pide las del dueño
# del documento (su propio ejemplo es MD, una persona). Emir pidió "AP" el 23 de
# septiembre de 2026, a confirmar con Monica: si cambia, las versiones ya
# emitidas conservan las suyas y las nuevas llevan las nuevas.
INICIALES_RESPONSABLE = "AP"

# La fecha del pie, en el formato de la norma (Sep-17-2026). Los meses van en
# inglés como en su ejemplo, y fijos: no dependen del idioma de la máquina.
_MESES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

RE_ID = re.compile(rf"^{PREFIJO}-{AREA}-\d{{3,}}$")
RE_VERSION = re.compile(r"^v\d{2,}$")
RE_FECHA = re.compile(r"^(" + "|".join(_MESES) + r")-\d{2}-\d{4}$")
RE_INICIALES = re.compile(r"^[A-Z]{2,4}$")
RE_CABECERA = re.compile(rf"^[^|]+ \| {TIPO} \| {PREFIJO}-{AREA}-\d{{3,}} \| v\d{{2,}}$")
RE_PIE = re.compile(rf"^{CONFIDENCIALIDAD} \| {PROYECTO} \| {ORGANIZACION} \| (" + "|".join(_MESES) + r")-\d{2}-\d{4} \| [A-Z]{2,4} \| Page X of Y$")

MAX_NOMBRE = 80


def id_documento(n: int) -> str:
    return f"{PREFIJO}-{AREA}-{n:03d}"


def version_documento(n: int) -> str:
    return f"v{n:02d}"


def fecha_documento(ms: int) -> str:
    d = datetime.fromtimestamp(ms / 1000)
    return f"{_MESES[d.month - 1]}-{d.day:02d}-{d.year}"


def cabecera(nombre: str, id_doc: str, version: str) -> str:
    return f"{nombre} | {TIPO} | {id_doc} | {version}"


def pie(fecha: str, iniciales: str) -> str:
    """El pie tal como lo escribe la norma; en el Word, "X" e "Y" son los
    campos automáticos de página y de número de páginas."""
    return f"{CONFIDENCIALIDAD} | {PROYECTO} | {ORGANIZACION} | {fecha} | {iniciales} | Page X of Y"


def limpiar_nombre(nombre: Any) -> str:
    """El nombre corto tal como puede ir en la cabecera: sin la barra vertical,
    que partiría la cabecera, sin comillas ni punto final, en una línea."""
    t = re.sub(r"\s+", " ", str(nombre or "").replace("|", " ")).strip().strip("\"'«»“”").strip().rstrip(".").strip()
    return t[:MAX_NOMBRE].strip()


def numero_de(id_doc: Any) -> int:
    m = re.match(rf"^{PREFIJO}-{AREA}-(\d+)$", str(id_doc or ""))
    return int(m.group(1)) if m else 0


def siguiente_numero(e: dict[str, Any]) -> int:
    """El siguiente número libre. Se guarda el último asignado y además se mira
    el mayor que haya en las hipótesis: aunque el contador se perdiera, un
    código ya usado no vuelve a salir."""
    ultimo = int((e.get("documentosControlados") or {}).get("ultimo") or 0)
    usados = [numero_de((h.get("documentoControlado") or {}).get("id")) for h in e.get("hipotesis", []) if isinstance(h, dict)]
    return max([ultimo, *usados]) + 1


# Las ocho comprobaciones de la sección 8 de la norma, con su texto original.
COMPROBACIONES = (
    (1, "Header follows the approved format", "La cabecera sigue el formato aprobado"),
    (2, "Footer follows the approved format", "El pie sigue el formato aprobado"),
    (3, "Document type is DOC", "El tipo de documento es DOC"),
    (4, "Area code is HYP", "El código de área es HYP"),
    (5, "Document ID follows AP-HYP-[Sequential Number]", "El código sigue AP-HYP-[número correlativo]"),
    (6, "Version is assigned", "La versión está asignada"),
    (7, "Date is included in the footer", "La fecha está en el pie"),
    (8, "Owner initials are included in the footer", "Las iniciales del responsable están en el pie"),
)


def comprobar(id_doc: str, v: dict[str, Any]) -> list[dict[str, Any]]:
    """La lista de la sección 8, por regla, sobre lo que se va a imprimir. Como
    lo genera ROSA2018, debería salir siempre entera; está para que un cambio de
    configuración (unas iniciales vacías, un nombre con barra) no emita un
    documento que no cumple sin que nadie lo vea."""
    cab, pi = str(v.get("cabecera") or ""), str(v.get("pie") or "")
    ok = {
        1: bool(RE_CABECERA.match(cab)) and bool(limpiar_nombre(v.get("nombre"))),
        2: bool(RE_PIE.match(pi)),
        3: f" | {TIPO} | " in cab,
        4: f"-{AREA}-" in str(id_doc),
        5: bool(RE_ID.match(str(id_doc))),
        6: bool(RE_VERSION.match(str(v.get("version") or ""))),
        7: bool(RE_FECHA.match(str(v.get("fecha") or ""))) and f" | {v.get('fecha')} | " in pi,
        8: bool(RE_INICIALES.match(str(v.get("iniciales") or ""))) and f" | {v.get('iniciales')} | Page" in pi,
    }
    return [{"n": n, "norma": en, "texto": es, "ok": ok[n]} for n, en, es in COMPROBACIONES]


def emitir(e: dict[str, Any], h: dict[str, Any], nombre_corto: Any, quien: str, ahora: int) -> dict[str, Any] | str:
    """Emite como documento controlado la última versión del dossier de la
    hipótesis. Devuelve la versión emitida o, si no se puede, el motivo."""
    art_id = h.get("dossierArtefactoId")
    art = next((a for a in e.get("artefactos", []) if isinstance(a, dict) and a.get("id") == art_id), None) if art_id else None
    if not art or not art.get("versiones"):
        return "La hipótesis no tiene dossier: genéralo primero."
    n_art = len(art["versiones"])
    doc = h.get("documentoControlado") if isinstance(h.get("documentoControlado"), dict) else None
    versiones = doc.get("versiones") if doc and isinstance(doc.get("versiones"), list) else []
    if versiones and versiones[-1].get("artefactoId") == art_id and versiones[-1].get("versionArtefacto") == n_art:
        return f"Esa versión del dossier ya está emitida como {versiones[-1].get('version')}: vuelve a generar el dossier si ha cambiado."
    nombre = limpiar_nombre(nombre_corto) or limpiar_nombre((doc or {}).get("nombreCorto")) or limpiar_nombre(h.get("nombreCorto"))
    if not nombre:
        return "Falta el nombre corto de la cabecera."
    if doc is None:
        n = siguiente_numero(e)
        e.setdefault("documentosControlados", {})["ultimo"] = n
        doc = {"id": id_documento(n), "nombreCorto": nombre, "versiones": []}
        h["documentoControlado"] = doc
        versiones = doc["versiones"]
    else:
        doc["nombreCorto"] = nombre
        doc["versiones"] = versiones
    fecha = fecha_documento(ahora)
    version = version_documento(len(versiones) + 1)
    v: dict[str, Any] = {
        "version": version,
        "emitidaEn": ahora,
        "fecha": fecha,
        "iniciales": INICIALES_RESPONSABLE,
        "nombre": nombre,
        "cabecera": cabecera(nombre, doc["id"], version),
        "pie": pie(fecha, INICIALES_RESPONSABLE),
        "artefactoId": art_id,
        "versionArtefacto": n_art,
        "quien": quien,
        "norma": SOP,
    }
    v["comprobaciones"] = comprobar(doc["id"], v)
    v["controlado"] = all(c["ok"] for c in v["comprobaciones"])
    versiones.append(v)
    return v


def para_descargar(e: dict[str, Any], art_id: str, n: int, ahora: int) -> tuple[str, str | None, dict[str, Any]] | None:
    """Lo que hace falta para descargar la versión `n` de un dossier: su
    contenido, el código y la versión emitida si esa versión del dossier se
    emitió, o un borrador si no. None si no existe."""
    art = next((a for a in e.get("artefactos", []) if isinstance(a, dict) and a.get("id") == art_id), None)
    if not art or art.get("tipo") != "dossier" or not 1 <= n <= len(art.get("versiones") or []):
        return None
    contenido = str(art["versiones"][n - 1].get("contenido") or "")
    h = next((x for x in e.get("hipotesis", []) if isinstance(x, dict) and x.get("dossierArtefactoId") == art_id), None) or {}
    doc = h.get("documentoControlado") if isinstance(h.get("documentoControlado"), dict) else None
    v = next((x for x in reversed((doc or {}).get("versiones") or []) if isinstance(x, dict) and x.get("artefactoId") == art_id and x.get("versionArtefacto") == n), None)
    if v and doc:
        return contenido, str(doc["id"]), dict(v)
    return contenido, None, borrador(str((doc or {}).get("nombreCorto") or h.get("nombreCorto") or h.get("titulo") or ""), ahora)


def version_emitida(h: dict[str, Any], version: str) -> dict[str, Any] | None:
    doc = h.get("documentoControlado") if isinstance(h.get("documentoControlado"), dict) else None
    return next((v for v in (doc or {}).get("versiones") or [] if isinstance(v, dict) and v.get("version") == version), None)


# -- El Word ----------------------------------------------------------------------
#
# El diseño es el de la propia norma: la plantilla rosa/plantillas/
# documento_hipotesis.docx se sacó del Word de Monica Duarte (25 de septiembre
# de 2026) con su cabecera (el árbol del Alzheimer Project y la línea de control
# a la derecha), su pie (con PAGE y NUMPAGES como campos de Word) y un párrafo de
# muestra de cada tipo: título, subtítulo, línea de datos, sección, texto,
# recuadro y viñeta. Cada párrafo del documento es una copia de su muestra con
# otro texto, así que la letra, los colores, los tamaños, el sombreado lila y los
# espaciados son los suyos, no una imitación.

PLANTILLA = Path(__file__).resolve().parent / "plantillas" / "documento_hipotesis.docx"
MAX_NOMBRE_BORRADOR = 50
MUESTRAS = ("titulo", "subtitulo", "vacio", "dato", "seccion", "texto", "recuadro", "vineta")


def borrador(nombre: str, ahora: int) -> dict[str, Any]:
    """La cabecera y el pie de un dossier que todavía no se ha emitido como
    documento controlado: el mismo diseño, pero sin código AP-HYP, que solo lo
    da la emisión, y dicho en la cabecera para que nadie lo tome por uno."""
    fecha = fecha_documento(ahora)
    nombre = limpiar_nombre(nombre) or "Dossier para el laboratorio"
    # Si todavía no hay nombre corto llega el título entero: se corta por una
    # palabra entera, para que la cabecera quepa en una línea.
    if len(nombre) > MAX_NOMBRE_BORRADOR:
        nombre = nombre[:MAX_NOMBRE_BORRADOR].rsplit(" ", 1)[0].rstrip(" ,;:-–") + "…"
    return {"version": "borrador", "fecha": fecha, "iniciales": INICIALES_RESPONSABLE, "nombre": nombre, "cabecera": f"{nombre} | {TIPO} | sin código: no emitido | borrador", "pie": pie(fecha, INICIALES_RESPONSABLE), "emitido": False}


def _con_texto(muestra: Any, texto: str) -> Any:
    """Una copia del párrafo de muestra con otro texto. Las **negritas** del
    Markdown del dossier se conservan como trozos en negrita con el mismo
    formato de la muestra."""
    import copy

    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    nuevo = copy.deepcopy(muestra)
    runs = nuevo.findall(qn("w:r"))
    base = copy.deepcopy(runs[0]) if runs else None
    for r in runs:
        nuevo.remove(r)
    if base is None:
        return nuevo
    for t in base.findall(qn("w:t")):
        base.remove(t)
    for i, trozo in enumerate(re.split(r"\*\*", texto)):
        if not trozo:
            continue
        r = copy.deepcopy(base)
        if i % 2 == 1:
            rpr = r.find(qn("w:rPr"))
            if rpr is None:
                rpr = OxmlElement("w:rPr")
                r.insert(0, rpr)
            if rpr.find(qn("w:b")) is None:
                rpr.append(OxmlElement("w:b"))
        # Arial explícito, como el PDF de la norma: el Word lo trae como fuente por
        # defecto del documento, y hay visores (la vista previa de macOS) que no la
        # aplican y ponen Times.
        rpr = r.find(qn("w:rPr"))
        if rpr is None:
            rpr = OxmlElement("w:rPr")
            r.insert(0, rpr)
        if rpr.find(qn("w:rFonts")) is None:
            fuentes = OxmlElement("w:rFonts")
            for k in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
                fuentes.set(qn(k), "Arial")
            rpr.insert(0, fuentes)
        t = OxmlElement("w:t")
        t.set(qn("xml:space"), "preserve")
        t.text = trozo
        r.append(t)
        nuevo.append(r)
    return nuevo


def docx(contenido: str, id_doc: str | None, v: dict[str, Any]) -> bytes:
    """El dossier en Word con el diseño de la norma AP-DOC-002. `v` es una
    versión emitida (con su código `id_doc`) o un `borrador`."""
    from docx import Document

    d = Document(str(PLANTILLA))
    sec = d.sections[0]
    # Cabecera y pie: se cambia el texto y se conservan logo y campos.
    cab = next(p for p in sec.header.paragraphs if "{{cabecera}}" in p.text)
    cab.runs[0].text = v["cabecera"]
    pie_p = sec.footer.paragraphs[0]
    pie_p.runs[0].text = v["pie"].split("Page X of Y")[0] + "Page "
    for r in (*cab.runs, *pie_p.runs):
        r.font.name = "Arial"

    cuerpo = d.element.body
    muestras = {}
    for p in list(d.paragraphs):
        clave = p.text.strip().strip("{}")
        if clave in MUESTRAS:
            muestras[clave] = p._p
            cuerpo.remove(p._p)
    fin = cuerpo[-1] if len(cuerpo) and cuerpo[-1].tag.endswith("sectPr") else None

    def poner(tipo: str, texto: str = "") -> None:
        el = _con_texto(muestras[tipo], texto) if texto else _con_texto(muestras["vacio"], "")
        if fin is not None:
            fin.addprevious(el)
        else:
            cuerpo.append(el)

    lineas = [x.rstrip() for x in (contenido or "").splitlines()]
    titulo = next((x[2:].strip() for x in lineas if x.startswith("# ")), "Dossier para el laboratorio")
    emitido = v.get("emitido", True)
    poner("titulo", titulo)
    poner("subtitulo", "Dossier para el laboratorio, generado por ROSA2018")
    poner("vacio")
    datos = [
        f"Document Status: Draft{'' if emitido else ' (no emitido como documento controlado)'}",
        f"Document ID: {id_doc if emitido and id_doc else 'sin asignar (se da al emitir)'}",
        f"Version: {v['version'][1:] if emitido else 'borrador'}",
        f"Date: {v['fecha']}",
        f"Owner Initials: {v['iniciales']}",
        f"Controlled per: {SOP} (borrador de la norma)",
    ]
    for x in datos:
        poner("dato", x)
    poner("vacio")
    vio_titulo = False
    for x in lineas:
        if not x.strip():
            continue
        if x.startswith("# ") and not vio_titulo:
            vio_titulo = True  # ya es el título del documento
            continue
        if x.startswith("#"):
            poner("vacio")
            poner("seccion", x.lstrip("#").strip())
        elif re.match(r"^\s*[-*] ", x):
            poner("vineta", "- " + re.sub(r"^\s*[-*] ", "", x))
        else:
            poner("texto", x)

    salida = io.BytesIO()
    d.save(salida)
    return salida.getvalue()
