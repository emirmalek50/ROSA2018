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

# El logo del Alzheimer Project, el árbol: es la marca de ROSA2018.
LOGO = Path(__file__).resolve().parent.parent / "frontend" / "public" / "arbol-marca.png"


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


def version_emitida(h: dict[str, Any], version: str) -> dict[str, Any] | None:
    doc = h.get("documentoControlado") if isinstance(h.get("documentoControlado"), dict) else None
    return next((v for v in (doc or {}).get("versiones") or [] if isinstance(v, dict) and v.get("version") == version), None)


# -- El Word ----------------------------------------------------------------------

_MORADO = (0x4B, 0x1D, 0x80)


def _campo(parrafo: Any, instruccion: str) -> None:
    """Un campo automático de Word (PAGE, NUMPAGES): Google Docs los conserva al
    abrir el fichero, y así la numeración nunca va escrita a mano."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    def run_con(hijo: Any) -> None:
        r = parrafo.add_run()
        r._r.append(hijo)

    inicio = OxmlElement("w:fldChar")
    inicio.set(qn("w:fldCharType"), "begin")
    run_con(inicio)
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruccion} "
    run_con(instr)
    separa = OxmlElement("w:fldChar")
    separa.set(qn("w:fldCharType"), "separate")
    run_con(separa)
    parrafo.add_run("1")
    fin = OxmlElement("w:fldChar")
    fin.set(qn("w:fldCharType"), "end")
    run_con(fin)


def _en_linea(parrafo: Any, texto: str, negrita: bool = False) -> None:
    """Texto con **negritas** de Markdown, en trozos."""
    for i, trozo in enumerate(re.split(r"\*\*", texto)):
        if trozo:
            r = parrafo.add_run(trozo)
            r.bold = negrita or i % 2 == 1


def docx(contenido: str, id_doc: str, v: dict[str, Any]) -> bytes:
    """El documento controlado en Word, con la cabecera y el pie de la norma en
    todas las páginas y el dossier que se emitió como cuerpo."""
    from docx import Document
    from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Emu, Mm, Pt, RGBColor

    d = Document()
    estilo = d.styles["Normal"]
    estilo.font.name = "Arial"
    estilo.font.size = Pt(10.5)
    for nombre, tam in (("Title", 22), ("Heading 1", 17), ("Heading 2", 13.5), ("Heading 3", 12)):
        s = d.styles[nombre]
        s.font.name = "Arial"
        s.font.size = Pt(tam)
        s.font.bold = True
        s.font.color.rgb = RGBColor(*_MORADO)

    sec = d.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(22)
    sec.top_margin, sec.bottom_margin = Mm(30), Mm(22)
    sec.header_distance = Mm(10)
    ancho = Emu(int(sec.page_width or 0) - int(sec.left_margin or 0) - int(sec.right_margin or 0))

    # Cabecera: el árbol a la izquierda, la línea de la norma a la derecha, en
    # una tabla de dos celdas sin bordes. Con un tabulador el texto caía debajo
    # del logo en la vista previa de macOS y en Google Docs.
    t_cab = sec.header.add_table(rows=1, cols=2, width=ancho)
    izq, der = t_cab.rows[0].cells
    t_cab.autofit = False
    for col, w in zip(t_cab.columns, (Mm(30), Emu(ancho - Mm(30)))):
        col.width = w
        for c in col.cells:
            c.width = w
    if LOGO.exists():
        izq.paragraphs[0].add_run().add_picture(str(LOGO), height=Mm(11))
    der.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    pd = der.paragraphs[0]
    pd.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = pd.add_run(v["cabecera"])
    r.bold = True
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor(*_MORADO)
    # El párrafo vacío que Word pone en toda cabecera, sin altura: que no empuje.
    vacio = sec.header.paragraphs[0]
    vacio.paragraph_format.space_after = Pt(0)
    vacio.paragraph_format.line_spacing = Pt(1)

    # Pie: la línea de la norma con la página y el total como campos automáticos.
    p = sec.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    def texto_pie(t: str) -> None:
        rr = p.add_run(t)
        rr.font.size = Pt(8.5)
        rr.font.color.rgb = RGBColor(*_MORADO)

    texto_pie(v["pie"].split("Page X of Y")[0] + "Page ")
    _campo(p, "PAGE")
    texto_pie(" of ")
    _campo(p, "NUMPAGES")

    # El bloque de control de la primera página, como el de la propia norma.
    tabla = d.add_table(rows=1, cols=1)
    tabla.alignment = WD_TABLE_ALIGNMENT.CENTER
    celda = tabla.rows[0].cells[0]
    sombra = OxmlElement("w:shd")
    sombra.set(qn("w:val"), "clear")
    sombra.set(qn("w:color"), "auto")
    sombra.set(qn("w:fill"), "F1EAFB")
    celda._tc.get_or_add_tcPr().append(sombra)
    filas = [
        ("Document Status", "Draft (generado por ROSA2018; ninguna persona lo ha revisado todavía)"),
        ("Document ID", id_doc),
        ("Version", v["version"][1:]),
        ("Date", v["fecha"]),
        ("Owner Initials", v["iniciales"]),
        ("Controlled per", f"{SOP} (borrador)"),
    ]
    celda.paragraphs[0].text = ""
    for i, (k, val) in enumerate(filas):
        par = celda.paragraphs[0] if i == 0 else celda.add_paragraph()
        a = par.add_run(f"{k}: ")
        a.bold = True
        a.font.size = Pt(9.5)
        a.font.color.rgb = RGBColor(*_MORADO)
        b = par.add_run(str(val))
        b.font.size = Pt(9.5)
    d.add_paragraph()

    # El cuerpo: el Markdown del dossier emitido, línea a línea.
    for linea in (contenido or "").splitlines():
        t = linea.rstrip()
        if not t.strip():
            continue
        if t.startswith("# "):
            d.add_heading(t[2:].strip(), level=0)
        elif t.startswith("## "):
            d.add_heading(t[3:].strip(), level=1)
        elif t.startswith("### "):
            d.add_heading(t[4:].strip(), level=2)
        elif re.match(r"^\s*[-*] ", t):
            _en_linea(d.add_paragraph(style="List Bullet"), re.sub(r"^\s*[-*] ", "", t))
        else:
            _en_linea(d.add_paragraph(), t)

    salida = io.BytesIO()
    d.save(salida)
    return salida.getvalue()
