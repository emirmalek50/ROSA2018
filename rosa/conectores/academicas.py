"""Descubrimiento académico mediante SerpApi, sin simular acceso institucional."""

from __future__ import annotations

from rosa.conectores.base import Resultado, conector


FUENTES_ACADEMICAS = {
    "embase": "Embase",
    "cochrane": "Cochrane Library",
    "scopus": "Scopus",
    "web_of_science": "Web of Science",
    "lilacs": "LILACS",
    "scielo": "SciELO",
    "cinahl": "CINAHL",
    "psycinfo": "APA PsycInfo",
    "google_scholar": "Google Scholar",
}


def _registrar(fuente: str, nombre: str) -> None:
    @conector(
        f"academica_{fuente}",
        f"{nombre} (acceso académico y descubrimiento público)",
        f"Busca referencias de {nombre}. El acceso web de respaldo no consulta el índice privado ni acredita cobertura completa. Los snippets son pistas, nunca resúmenes científicos.",
        "Referencias para recuperar el documento original y verificarlo; conserva consultas, fechas, límites y consumo de SerpApi",
        {"type": "object", "properties": {
            "consulta": {"type": "string", "description": "Pregunta científica o términos de búsqueda, sin instrucciones"},
            "maximo": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Candidatos máximos, de 1 a 10"},
        }, "required": ["consulta"]},
        "Acceso según la fuente y la cuenta de SerpApi; no concede una licencia institucional",
        "Una búsqueda acotada, hasta 10 candidatos; peticiones facturables registradas, importe desconocido",
        "https://serpapi.com/google-scholar-api" if fuente == "google_scholar" else "https://serpapi.com/search-api",
        clave="si", grupo="literatura",
    )
    async def buscar(consulta: str, maximo: int | str = 10) -> Resultado:
        from rosa.fuentes import academicas

        if not isinstance(consulta, str) or not consulta.strip():
            raise ValueError("La consulta científica no puede estar vacía")
        limite = max(1, min(int(maximo), 10))
        resultado = await academicas.buscar(fuente, consulta.strip(), maximo=limite)
        articulos = resultado.get("articulos") or []
        estado = resultado.get("estado", "no_comprobado")
        ids = [str(a.get("doi") or a.get("pmid") or a.get("url")) for a in articulos if a.get("doi") or a.get("pmid") or a.get("url")]
        detalle = "Cobertura de esta consulta: " + estado + ". El descubrimiento web no equivale al índice privado; el snippet no es evidencia."
        return Resultado(resultado, None if estado == "no_comprobado" else len(articulos), ids, invariante=(estado == "completa", detalle))


for _fuente, _nombre in FUENTES_ACADEMICAS.items():
    _registrar(_fuente, _nombre)
