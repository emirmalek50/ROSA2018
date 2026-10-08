"""Agora: revisión de la evidencia pública de un gen humano."""

from rosa.conectores.base import Resultado, conector
from rosa.fuentes import agora


@conector(
    "agora", "Agora (AD Knowledge Portal)",
    "Revisión de un gen humano: identidad, expresión, dominios, nominaciones y fármacos vinculados",
    "Evidencia génica y proteica del Alzheimer con cobertura y procedencia por apartado",
    {"type": "object", "properties": {"gen": {"type": "string", "description": "Símbolo humano, alias exacto de Agora o identificador Ensembl ENSG"}}, "required": ["gen"]},
    "Datos públicos de Agora; respetar la atribución y las condiciones de cada conjunto de origen",
    "3 peticiones/s; paginación completa o cobertura parcial explícita", agora.DOC, grupo="alzheimer",
)
async def revision_gen(gen: str) -> Resultado:
    datos = await agora.revisar_gen(gen)
    # Conservar incluso los fallos con su auditoría. El paso de cierre publica
    # error y n=None cuando estado=no_disponible, sin perder estas consultas.
    identidad = datos.get("gen") or {}
    identificador = identidad.get("ensembl_gene_id")
    version = datos.get("version") or {}
    return Resultado(datos=datos, n=int(bool(identificador)), ids=[identificador] if identificador else [],
                     version=str(version.get("data_version", "")) or None,
                     invariante=(datos["estado"] == "completa", f"Revisión de Agora: {datos['estado']}; identidad exacta y cobertura por apartado"))
