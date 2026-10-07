import { describe, expect, it, vi } from 'vitest';
import type { EventoVisualLab } from '../../lib/peliculaLab';
import { ColaPelicula } from './colaPelicula';

const IDENTIDAD = 'cor-real/it-real';
const evento = (id: string, cambios: Partial<EventoVisualLab> = {}): EventoVisualLab => ({
  id, sala: 'r3', agentes: ['Analogía'], tipo: 'idea', texto: 'Propuesta registrada',
  dato: { tipo: 'idea', hipotesisId: `hip-${id}`, titulo: 'Propuesta registrada', enfoque: 'analogia' }, ...cambios,
});
function vaciar(cola: ColaPelicula): EventoVisualLab[] {
  const resultado: EventoVisualLab[] = [];
  let siguiente: EventoVisualLab | null;
  while ((siguiente = cola.siguiente(() => true))) resultado.push(siguiente);
  return resultado;
}

describe('cola de escenas del registro real', () => {
  it('consultar una pendiente no la consume ni altera el orden y solo encuentra versiones actuales', () => {
    const cola = new ColaPelicula(), a = evento('a'), b = evento('b');
    cola.recibir([a, b], IDENTIDAD);
    expect(cola.hayPendiente(e => e.id === 'b')).toBe(true);
    expect(cola.hayPendiente(e => e.sala === 'r1')).toBe(false);
    expect(cola.siguiente(() => true)).toBe(a);
    expect(cola.hayPendiente(e => e.id === 'a')).toBe(false);
    const revisado = evento('b', { texto: 'Versión actual' });
    cola.recibir([a, revisado], IDENTIDAD);
    expect(cola.hayPendiente(e => e.texto === b.texto)).toBe(false);
    expect(cola.hayPendiente(e => e.texto === revisado.texto)).toBe(true);
    expect(vaciar(cola)).toEqual([revisado]);
    cola.recibir([a, revisado], IDENTIDAD);
    expect(cola.hayPendiente(() => true)).toBe(false);
  });

  it('conserva todas las acciones que llegan juntas y su orden', () => {
    const cola = new ColaPelicula(), eventos = [evento('a'), evento('b'), evento('c')];
    cola.recibir(eventos, IDENTIDAD);
    expect(vaciar(cola)).toEqual(eventos);
    expect(cola.siguiente(() => true)).toBeNull();
  });

  it('no repite la misma respuesta SSE ni una historia que salió del registro', () => {
    const cola = new ColaPelicula(), a = evento('a'), b = evento('b');
    cola.recibir([a], IDENTIDAD);
    expect(cola.siguiente(() => true)).toBe(a);
    cola.recibir([a], IDENTIDAD);
    cola.recibir([], IDENTIDAD);
    cola.recibir([b], IDENTIDAD);
    cola.recibir([a, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([b]);
  });

  it('el inicio registra la historia sin encolarla y permite elegir una acción actual', () => {
    const cola = new ColaPelicula(), a = evento('historia'), b = evento('actual');
    cola.recibir([a, b], IDENTIDAD, true);
    expect(vaciar(cola)).toEqual([]);
    cola.devolver(b);
    cola.recibir([a, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([b]);
    cola.recibir([a, b, evento('nuevo')], IDENTIDAD);
    expect(vaciar(cola).map((e) => e.id)).toEqual(['nuevo']);
  });

  it('una revisión reemplaza la pendiente conservando el orden de las demás acciones', () => {
    const cola = new ColaPelicula(), a = evento('a'), b = evento('b');
    const revisado = evento('a', { texto: 'Propuesta reformulada' });
    cola.recibir([a, b], IDENTIDAD);
    cola.recibir([revisado, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([revisado, b]);
    cola.recibir([revisado, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
  });

  it('encola una revisión de una acción ya representada', () => {
    const cola = new ColaPelicula(), a = evento('a');
    cola.recibir([a], IDENTIDAD);
    expect(cola.siguiente(() => true)).toBe(a);
    const revisado = evento('a', { agentes: ['Contradicción'], sala: 'r4', tipo: 'revision' });
    cola.recibir([revisado], IDENTIDAD);
    expect(vaciar(cola)).toEqual([revisado]);
  });

  it('el orden de las claves JSON no fabrica una revisión, pero un dato nuevo sí', () => {
    const cola = new ColaPelicula();
    const a = evento('a', { dato: { tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Título real', enfoque: 'analogia' } });
    cola.recibir([a], IDENTIDAD);
    expect(cola.siguiente(() => true)).toBe(a);
    const reordenado: EventoVisualLab = { texto: a.texto, tipo: a.tipo, agentes: a.agentes, sala: a.sala, id: a.id,
      dato: { enfoque: 'analogia', titulo: 'Título real', hipotesisId: 'hip-real', tipo: 'idea' } };
    cola.recibir([reordenado], IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
    const nuevoDato = { ...a, dato: { ...a.dato!, titulo: 'Título revisado' } };
    cola.recibir([nuevoDato], IDENTIDAD);
    expect(vaciar(cola)).toEqual([nuevoDato]);
  });

  it('espera por un actor ocupado sin perder su acción ni bloquear otras salas', () => {
    const cola = new ColaPelicula(), a = evento('a'), b = evento('b', { agentes: ['Juez'], sala: 'r2', tipo: 'evidencia' });
    cola.recibir([a, b], IDENTIDAD);
    const disponible = vi.fn((e: EventoVisualLab) => e.sala !== 'r3');
    expect(cola.siguiente(disponible)).toBe(b);
    expect(cola.siguiente(disponible)).toBeNull();
    expect(cola.siguiente(() => true)).toBe(a);
  });

  it('reencola una cancelación una sola vez y rechaza una revisión antigua', () => {
    const cola = new ColaPelicula(), a = evento('a');
    cola.recibir([a], IDENTIDAD);
    const interrumpido = cola.siguiente(() => true)!;
    cola.devolver(interrumpido); cola.devolver(interrumpido);
    expect(vaciar(cola)).toEqual([a]);
    const nuevo = evento('a', { texto: 'Resultado revisado' });
    cola.recibir([nuevo], IDENTIDAD);
    cola.devolver(interrumpido);
    expect(vaciar(cola)).toEqual([nuevo]);
    cola.devolver(interrumpido);
    expect(vaciar(cola)).toEqual([]);
  });

  it('limita a 100 pendientes recientes y no repite los descartados al recibir SSE', () => {
    const cola = new ColaPelicula(), eventos = Array.from({ length: 130 }, (_, i) => evento(`evento-${i}`));
    cola.recibir(eventos, IDENTIDAD);
    expect(vaciar(cola)).toEqual(eventos.slice(-100));
    cola.recibir(eventos, IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
    cola.recibir(eventos, 'cor-real/it-siguiente');
    expect(vaciar(cola)).toEqual(eventos.slice(-100));
  });

  it('un cambio de identidad borra pendientes y evita devolver escenas ajenas', () => {
    const cola = new ColaPelicula(), anterior = evento('anterior'), nuevo = evento('nuevo');
    cola.recibir([anterior], IDENTIDAD);
    cola.recibir([nuevo], 'cor-siguiente/it-siguiente');
    cola.devolver(anterior);
    expect(vaciar(cola)).toEqual([nuevo]);
    cola.recibir([anterior], 'cor-siguiente/it-siguiente');
    expect(vaciar(cola)).toEqual([anterior]);
  });

  it('limpiar invalida también una cancelación tardía y el historial visto', () => {
    const cola = new ColaPelicula(), a = evento('a');
    cola.recibir([a], IDENTIDAD); cola.siguiente(() => true); cola.limpiar();
    cola.devolver(a);
    expect(vaciar(cola)).toEqual([]);
    cola.recibir([a], IDENTIDAD);
    expect(vaciar(cola)).toEqual([a]);
  });

  it('solo entrega el evento original, sin mutarlo ni fabricar voz o parámetros', () => {
    const cola = new ColaPelicula();
    const a = Object.freeze(evento('real', { texto: 'Registro literal', agentes: Object.freeze(['Analogía']) as unknown as string[],
      dato: Object.freeze({ tipo: 'idea' as const, hipotesisId: 'hip-real', titulo: 'Título real', enfoque: 'analogia' }) }));
    cola.recibir([a], IDENTIDAD);
    expect(cola.siguiente(() => true)).toBe(a);
    expect(a.texto).toBe('Registro literal');
    expect(Object.keys(a).sort()).toEqual(['agentes', 'dato', 'id', 'sala', 'texto', 'tipo']);
  });

  it('conserva las fases distintas de un análisis y las de otras ejecuciones', () => {
    const cola = new ColaPelicula();
    const a = evento('programando', { sala: 'r5', tipo: 'analisis', dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'programando', sintetico: false } });
    const b = evento('terminado', { ...a, id: 'terminado', dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'terminado', sintetico: false } });
    const otra = evento('otra', { ...a, id: 'otra', dato: { tipo: 'analisis', ejecucionId: 'ej-otra', estado: 'ejecutando', sintetico: false } });
    cola.recibir([a, otra, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([a, otra, b]);
    cola.recibir([a, otra, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
  });

  it('la cancelación por IA no revive la fase anterior de la misma entidad con otro ID', () => {
    const cola = new ColaPelicula();
    const a = evento('programando', { dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'programando', sintetico: false } });
    const b = evento('fallido', { dato: { tipo: 'analisis', ejecucionId: 'ej-real', estado: 'fallido', sintetico: false } });
    cola.recibir([a], IDENTIDAD); expect(cola.siguiente(() => true)).toBe(a);
    cola.recibir([a, b], IDENTIDAD); cola.devolver(a);
    expect(vaciar(cola)).toEqual([b]);
    cola.devolver(a); expect(vaciar(cola)).toEqual([]);
  });

  it('agrupa revisiones del artículo por modo sin convertir no comprobado en exclusión', () => {
    const cola = new ColaPelicula();
    const foco = evento('foco', { tipo: 'filtro', dato: { tipo: 'articulo', id: 'pub-real', titulo: 'Artículo real', estado: 'incluido', motivo: 'Relevante', modo: 'foco' } });
    const amplitud = evento('amplitud', { ...foco, id: 'amplitud', dato: { tipo: 'articulo', id: 'pub-real', titulo: 'Artículo real', estado: 'incluido', motivo: 'Relevante', modo: 'amplitud' } });
    const pendiente = evento('sin-respuesta', { ...foco, id: 'sin-respuesta', dato: { tipo: 'articulo', id: 'pub-real', titulo: 'Artículo real', estado: 'no_comprobado', motivo: 'El modelo no respondió', modo: 'foco' } });
    cola.recibir([foco, amplitud, pendiente], IDENTIDAD);
    expect(vaciar(cola)).toEqual([amplitud, pendiente]);
  });

  it('las notas técnicas dejan un contexto reciente por sala, tipo y participantes', () => {
    const cola = new ColaPelicula();
    const a = evento('registro:1', { dato: undefined, tipo: 'revision', agentes: ['Killer', 'Concluidor'], sala: 'r4' });
    const b = evento('registro:2', { ...a, id: 'registro:2', texto: 'Terminó la revisión', agentes: ['Concluidor', 'Killer'] });
    const distinto = evento('registro:3', { ...a, id: 'registro:3', agentes: ['Killer'] });
    cola.recibir([a, distinto, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([distinto, b]);
  });

  it('conserva las comparaciones y los resultados de cada partida real', () => {
    const cola = new ColaPelicula();
    const a = evento('partida:1', { tipo: 'torneo', sala: 'r4', dato: { tipo: 'torneo', hipotesisAId: 'hip-a', hipotesisBId: 'hip-b', tituloA: 'A', tituloB: 'B', estado: 'comparando', porRegla: false } });
    const b = evento('partida:2', { ...a, id: 'partida:2', dato: { ...a.dato! as Extract<NonNullable<EventoVisualLab['dato']>, { tipo: 'torneo' }>, estado: 'a' } });
    const otra = evento('partida:3', { ...a, id: 'partida:3', dato: { tipo: 'torneo', hipotesisAId: 'hip-a', hipotesisBId: 'hip-c', tituloA: 'A', tituloB: 'C', estado: 'tablas', porRegla: false } });
    cola.recibir([a, b, otra], IDENTIDAD);
    expect(vaciar(cola)).toEqual([a, b, otra]);
  });

  it('las afirmaciones sin actor no ocupan plazas ni desplazan acciones reales', () => {
    const cola = new ColaPelicula(), a = evento('real');
    const evidencia = Array.from({ length: 150 }, (_, i) => evento(`afirmacion:it:af-${i}`, { tipo: 'evidencia', dato: undefined, agentes: [] }));
    cola.recibir([a, ...evidencia], IDENTIDAD);
    expect(vaciar(cola)).toEqual([a]);
    cola.devolver(evidencia[0]!); cola.recibir(evidencia, IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
  });

  it('corregir una entrada anterior no desplaza el estado posterior de esa entidad', () => {
    const cola = new ColaPelicula();
    const a = evento('primera', { dato: { tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Primera formulación', enfoque: 'analogia' } });
    const b = evento('segunda', { dato: { tipo: 'idea', hipotesisId: 'hip-real', titulo: 'Formulación actual', enfoque: 'analogia' } });
    cola.recibir([a, b], IDENTIDAD); expect(vaciar(cola)).toEqual([b]);
    cola.recibir([{ ...a, texto: 'Se corrigió la anotación antigua' }, b], IDENTIDAD);
    expect(vaciar(cola)).toEqual([]);
    cola.devolver(a); expect(vaciar(cola)).toEqual([]);
  });
});
