"""Casos adversarios de alcance global, reinicio y lecturas completas."""
import asyncio
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import dspy
import pymupdf
import pytest

from rosa import asistente_datasets as DS, asistente_documentos as PDF, asistente_operaciones as OP, asistente_servicios as SV, gateway, herramientas as H
from rosa.asistente_lecturas import filas_dataset, trazas_gepa
from rosa.tests.test_asistente_completo import preparar_continuacion
from rosa.tests import test_asistente_servicios as TS


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    yield from TS.entorno.__wrapped__(tmp_path, monkeypatch)


def contenido(s):
    return json.loads(s[s.index('{'):s.rindex('}')+1])


@pytest.mark.asyncio
async def test_herramientas_globales_ven_otras_investigaciones_y_conservan_origen(entorno):
    al, _, _, _ = entorno
    e = al.instantanea()
    e.update(hechos=[{'id':'h1','investigacionId':'inv-a','enunciado':'MAPT y tau','estado':'sabido','procedencia':[]}],
             cuestiones=[{'id':'q1','investigacionId':'inv-a','texto':'Revisar MAPT','estado':'abierta'}])
    t = {t.name:t.func for t in H.herramientas(e,'global',[])}
    for nombre, argumento in [('leer_modelo_de_mundo','MAPT'),('buscar_en_proyecto','MAPT'),('leer_cuestiones','abierta')]:
        salida = await t[nombre](argumento)
        assert 'inv-a' in salida and ('h1' in salida or 'q1' in salida)
    propios = {t.name:t.func for t in H.herramientas(e,'otra',[])}
    assert 'h1' not in await propios['leer_modelo_de_mundo']('MAPT')


@pytest.mark.asyncio
async def test_reinicio_carga_modelo_una_vez_y_continua(entorno, monkeypatch):
    from rosa import asistente as AS
    al, app, _, crear = entorno
    preparar_continuacion(al)
    cargas = []
    modelo = SimpleNamespace(cerebro=object())
    def cargar():
        cargas.append(1)
        return modelo
    monkeypatch.setattr(gateway,'modelos',cargar)
    async def responder(lm,*args,**kwargs):
        assert lm is modelo.cerebro
        return {'respuesta':'Continué tras reiniciar','consultas':[]}
    monkeypatch.setattr(AS,'preguntar',responder)
    r = await OP.continuar(app,al,crear(),('global','q','op'),'persona@rosa.test')
    assert r['ok'] and len(cargas)==1
    assert all(m is modelo for m in await asyncio.gather(*(OP.modelos_del_asistente(app) for _ in range(5))))
    assert len(cargas)==1


@pytest.mark.asyncio
async def test_pdf_escaneado_autorizado_usa_vision_y_cache(entorno, tmp_path, monkeypatch):
    from rosa import datos
    al, _, _, _ = entorno
    ruta=tmp_path/'imagen.pdf'
    with pymupdf.open() as pdf:
        p=pdf.new_page();p.draw_rect(pymupdf.Rect(10,10,60,60),fill=(1,0,0));pdf.save(ruta)
    al.mutar(lambda e:e['investigaciones'][0].update(datasets=[{'id':'ds','procedencia':{'fichero':'imagen.pdf','permiteLlmTerceros':True}}]))
    monkeypatch.setattr(datos,'ruta_dataset',lambda *args:ruta)
    llamadas=[]
    class Vision:
        async def acall(self,**kw):
            assert isinstance(kw['imagen'],dspy.Image)
            llamadas.append(kw['pregunta'])
            return SimpleNamespace(lectura='Se observa un cuadrado rojo')
    monkeypatch.setattr(dspy,'Predict',lambda firma:Vision())
    tool=next(t for t in SV.herramientas_locales(al) if t.name=='consultar_dataset').func
    for _ in range(2):
        r=TS.extraer(await tool('inv-a','ds'))
        assert r['pagina']==1 and r['interpretacionVisual']=='Se observa un cuadrado rojo'
        assert r['origen']=='dataset:inv-a/ds' and 'capa de texto' in r['aviso']
    assert len(llamadas)==1
    al.mutar(lambda e:e['investigaciones'][0]['datasets'][0]['procedencia'].update(permiteLlmTerceros=False))
    assert TS.extraer(await tool('inv-a','ds'))['ok'] is False
    assert len(llamadas)==1


@pytest.mark.asyncio
async def test_vision_caida_no_equivale_a_pagina_vacia(tmp_path, monkeypatch):
    ruta=tmp_path/'pagina.pdf'
    with pymupdf.open() as pdf:
        pdf.new_page();pdf.save(ruta)
    async def fallar(*args):
        raise RuntimeError('No disponible')
    monkeypatch.setattr(PDF,'interpretar',fallar)
    r=await PDF.leer_pdf(ruta,'dataset:prueba',1)
    assert r['lecturaVisualFallida'] and 'no significa' in r['avisoVisual']


@pytest.mark.parametrize('extension,campo', [('csv',''),('json','datos/0/filas')])
def test_indice_no_relee_archivo_al_paginar_y_detecta_cambios(entorno, tmp_path, monkeypatch, extension, campo):
    ruta=tmp_path/('tabla.'+extension)
    filas=[{'id':str(n),'grupo':str(n%2)} for n in range(201)]
    def guardar():
        ruta.write_text('id,grupo\n'+''.join(f"{f['id']},{f['grupo']}\n" for f in filas) if extension=='csv' else json.dumps({'datos':[{'filas':filas}]}))
    guardar()
    original=DS._leer_filas
    lecturas=[]
    def contar(*args):
        lecturas.append(1)
        yield from original(*args)
    monkeypatch.setattr(DS,'_leer_filas',contar)
    for inicio in [0,10,20]:
        p=filas_dataset(ruta,inicio,10,['id'],{'grupo':'1'},campo)
        assert p['totalFiltrado']==100 and p['filas'][0]['valores']['id']==str(inicio*2+1)
    assert len(lecturas)==1
    filas.append({'id':'201','grupo':'1'});guardar()
    assert filas_dataset(ruta,100,10,[],{'grupo':'1'},campo)['totalFiltrado']==101
    assert len(lecturas)==2


def test_json_incompleto_no_deja_cache_valida_y_csv_vacio_conserva_columnas(entorno,tmp_path):
    ruta=tmp_path/'roto.json';ruta.write_text('[{"id":1},')
    with pytest.raises(ValueError):
        filas_dataset(ruta,0,10,[],{})
    ruta.write_text('[]')
    assert filas_dataset(ruta,0,10,[],{})['totalFilas']==0
    csv=tmp_path/'vacio.csv';csv.write_text('id,grupo\n')
    assert filas_dataset(csv,0,10,[],{})['columnas']==['id','grupo']


def test_gepa_pagina_ciclos_independientes_y_fija_instantanea(entorno):
    al, _, _, _ = entorno
    ruta=al.ruta.parent/'datos'/'_gepa'/al.ruta.name/'trazas.db';ruta.parent.mkdir(parents=True)
    with sqlite3.connect(ruta) as db:
        db.executescript('CREATE TABLE trazas(seq INTEGER PRIMARY KEY,fecha REAL,tipo TEXT,programa TEXT,corrida TEXT,json TEXT); CREATE TABLE ciclos(id TEXT PRIMARY KEY,fecha REAL,json TEXT);')
        db.executemany('INSERT INTO ciclos VALUES(?,?,?)',[(str(n),n,json.dumps({'id':n})) for n in range(50)])
    primera=trazas_gepa(al,limite_ciclos=4)
    assert len(primera['ciclos'])==4 and primera['totalCiclos']==50 and primera['siguienteCiclos']==4
    with sqlite3.connect(ruta) as db:
        db.execute('INSERT INTO ciclos VALUES(?,?,?)',('nuevo',100,'{"id":100}'))
    segunda=trazas_gepa(al,desde_ciclos=4,limite_ciclos=4,hasta=primera['hasta'],hasta_ciclos=primera['hastaCiclos'])
    assert [c['id'] for c in segunda['ciclos']]==[45,44,43,42]
    assert segunda['totalCiclos']==50
