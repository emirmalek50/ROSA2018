"""Internet en el asistente: recuperación, permisos, fallos y atribución."""
import asyncio
import importlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from rosa import asistente as AS, config, herramientas as H
from rosa.conectores import web
from rosa.conectores.base import PERMISOS, REGISTRO, consultar


@pytest.fixture(autouse=True)
def conexion(monkeypatch):
    previa = config.CLAVE_EXA
    monkeypatch.setattr(config, 'CLAVE_EXA', 'clave_de_prueba_web')
    importlib.reload(web)
    yield
    monkeypatch.setattr(config, 'CLAVE_EXA', previa)
    importlib.reload(web)


def respuesta(monkeypatch, datos):
    llamadas = []

    async def pedir(metodo, url, limitador, **kwargs):
        llamadas.append((url, kwargs))
        return httpx.Response(200, json=datos, request=httpx.Request(metodo, url))

    monkeypatch.setattr(web, 'pedir', pedir)
    return llamadas


def test_busca_web_sin_filtro_cientifico_y_con_urls_hasta_el_ultimo_resultado(monkeypatch):
    paginas = [{'url': f'https://example.org/{i}', 'title': f'Página {i}', 'text': 'texto ' * 200} for i in range(5)]
    llamadas = respuesta(monkeypatch, {'results': paginas})
    registro = []
    tool = next(t for t in H.herramientas({}, 'global', registro) if t.name == 'buscar_web')
    salida = asyncio.run(tool.acall(consulta='Documentación pública de Python'))
    cuerpo = llamadas[0][1]['json']
    assert 'category' not in cuerpo and cuerpo['type'] == 'auto'
    assert 'summary' not in str(cuerpo) and '/search' in llamadas[0][0]
    assert 'https://example.org/4' in salida and '[recortado]' not in salida
    assert registro[0]['n'] == 5 and len(registro[0]['ids']) == 5
    assert 'clave_de_prueba_web' not in salida + json.dumps(registro)


def test_lectura_reciente_paginada_y_con_procedencia(monkeypatch):
    llamadas = respuesta(monkeypatch, {'results': [{'url': 'https://example.org/final', 'text': 'A' * 5000 + 'segunda página'}], 'statuses': [{'status': 'success', 'source': 'livecrawl'}]})
    primera = asyncio.run(web.leer_pagina_web('https://example.org/pagina'))
    segunda = asyncio.run(web.leer_pagina_web('https://example.org/pagina', '5000'))
    assert primera.datos['siguienteDesde'] == 5000
    assert segunda.datos['texto'] == 'segunda página' and segunda.datos['siguienteDesde'] is None
    assert primera.ids == ['https://example.org/final']
    assert primera.datos['urlSolicitada'] == 'https://example.org/pagina'
    assert llamadas[0][1]['json']['maxAgeHours'] == 0
    assert primera.datos['consultadoEn'] and primera.datos['origenContenido'] == ['livecrawl']


@pytest.mark.parametrize('datos', [
    {'results': [], 'statuses': [{'status': 'error', 'error': {'tag': 'CRAWL_TIMEOUT'}}]},
    {'results': [{'url': 'https://example.org', 'text': ''}]},
])
def test_una_pagina_inaccesible_no_es_ausencia_de_informacion(monkeypatch, datos):
    respuesta(monkeypatch, datos)
    reg, datos = asyncio.run(consultar('leer_pagina_web', url='https://example.org'))
    assert reg['error'] and reg['n'] is None and datos is None


def test_error_de_red_no_se_presenta_como_busqueda_sin_resultados(monkeypatch):
    from rosa.fuentes.base import FuenteNoDisponible

    async def caida(*a, **kw):
        raise FuenteNoDisponible('Tiempo agotado')

    monkeypatch.setattr(web, 'pedir', caida)
    reg, datos = asyncio.run(consultar('buscar_web', consulta='hora en Santo Domingo'))
    assert reg['error'] and reg['n'] is None and datos is None


def test_cero_resultados_es_distinto_de_respuesta_rota(monkeypatch):
    respuesta(monkeypatch, {'results': []})
    reg, _ = asyncio.run(consultar('buscar_web', consulta='consulta'))
    assert reg['error'] is None and reg['n'] == 0
    respuesta(monkeypatch, {})
    reg, _ = asyncio.run(consultar('buscar_web', consulta='consulta'))
    assert reg['error'] and reg['n'] is None


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'http://localhost/', 'http://127.0.0.1:8765/', 'http://10.0.0.1/', 'https://usuario:clave@example.org', 'http://[::1]/'])
def test_no_envia_rutas_privadas_ni_credenciales(monkeypatch, url):
    llamadas = respuesta(monkeypatch, {})
    with pytest.raises(ValueError):
        asyncio.run(web.leer_pagina_web(url))
    assert not llamadas


def test_sin_clave_exa_se_muestra_el_motivo_y_el_reloj_sigue_disponible(monkeypatch):
    monkeypatch.setattr(config, 'CLAVE_EXA', '')
    importlib.reload(web)
    nombres = {t.name for t in H.herramientas({}, 'global', [])}
    assert 'buscar_web' not in nombres and 'leer_pagina_web' not in nombres
    assert REGISTRO['buscar_web'].estado == 'requiere_cuenta'
    assert 'hora_actual' in nombres


def test_respeta_permisos_y_no_exige_confirmacion_para_leer(monkeypatch):
    monkeypatch.setitem(PERMISOS, 'buscar_web', 'bloquear')
    monkeypatch.setitem(PERMISOS, 'leer_pagina_web', 'solo_persona')
    assert 'buscar_web' not in {t.name for t in H.herramientas({}, 'global', [])}
    assert 'leer_pagina_web' not in {t.name for t in H.herramientas({}, 'global', [], origen='bucle')}
    assert 'leer_pagina_web' in {t.name for t in H.herramientas({}, 'global', [], origen='persona')}


def test_reloj_santo_domingo_usa_el_instante_actual_no_un_fragmento_web():
    inicio = datetime.now(timezone.utc)
    r = asyncio.run(web.hora_actual('America/Santo_Domingo'))
    local = datetime.fromisoformat(r.datos['fechaHora'])
    assert local.utcoffset() == timedelta(hours=-4)
    assert abs((local - inicio).total_seconds()) < 2
    with pytest.raises(ValueError):
        asyncio.run(web.hora_actual('zona-inventada'))


def test_url_inventada_o_ampliada_no_se_marca_como_respaldada():
    a = H.atribucion('[Oficial](https://example.org/Info) y https://example.org/inventada.', '{"url":"https://example.org/Info"}')
    assert a == {'citadas': ['https://example.org/Info', 'https://example.org/inventada'], 'sinRespaldo': ['https://example.org/inventada']}
    assert H.atribucion('https://example.org', 'https://example.org.evil/')['sinRespaldo'] == ['https://example.org']
    assert H.atribucion('https://example.org/info', 'https://example.org/Info')['sinRespaldo']
    assert H.atribucion('[Wiki](https://example.org/Pagina_(tema))', '{"url":"https://example.org/Pagina_(tema)"}')['sinRespaldo'] == []


def test_el_asistente_recibe_y_ejecuta_web_con_registro_y_citas(monkeypatch):
    respuesta(monkeypatch, {'results': [{'url': 'https://example.org/web', 'title': 'Web', 'text': 'Contenido público'}]})

    class Agente:
        def __init__(self, firma, tools, max_iters):
            self.tools = {t.name: t for t in tools}
            assert {'buscar_web', 'leer_pagina_web', 'hora_actual'} <= self.tools.keys()

        async def acall(self, **kw):
            observacion = await self.tools['buscar_web'].acall(consulta=kw['pregunta'])
            return SimpleNamespace(respuesta='[Fuente](https://example.org/web)', limites='', cobertura='respondido | Buscar en internet | Página pública', trajectory={'tool_name_0': 'buscar_web', 'observation_0': observacion})

    monkeypatch.setattr(AS.dspy, 'ReAct', Agente)
    almacen = SimpleNamespace(instantanea=lambda: {'investigaciones': []})
    r = asyncio.run(AS.preguntar(None, {}, 'global', 'Busca en internet', '', almacen=almacen))
    assert r['herramientas'] == ['buscar_web'] and r['consultas'][0]['n'] == 1
    assert r['atribucion'] == {'citadas': ['https://example.org/web'], 'sinRespaldo': []}
    assert not r['acciones']
