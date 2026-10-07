// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { EstadoRosa, Hipotesis, InformeTratamiento, Investigacion, RevisionTratamiento } from '../datos/tipos';
import { fijarIdioma } from '../lib/idioma';
import { parsearRuta, rutaNovedad } from '../lib/ruta';
import { Novedad } from './Novedad';

let nodo: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fijarIdioma('es');
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); vi.unstubAllGlobals(); });

function informe(agente: 'patentes' | 'companias'): InformeTratamiento {
  return { agente, estado: 'coincidencias', fecha: Date.UTC(2026, 9, 7, agente === 'patentes' ? 10 : 12),
    resumen: `Informe guardado de ${agente}.`, modelo: 'modelo/especialista', revisor: 'modelo/juez',
    hallazgos: [{ id: `documento-${agente}`, titulo: `Fuente exclusiva de ${agente}`,
      url: agente === 'patentes' ? 'https://patents.google.com/patent/US123B2/en#claims' : 'https://clinicaltrials.gov/study/NCT12345678',
      fuente: agente === 'patentes' ? 'Google Patents' : 'ClinicalTrials.gov', relacion: 'misma_diana',
      cita: `Pasaje literal de ${agente}: la diana es TREM2. <b>Sin ejecutar HTML.</b>`,
      explicacion: 'Una misma diana no demuestra un tratamiento equivalente.', diferencias: ['La composición no coincide.'], datos: {} }],
    consultas: [{ fuente: 'Registro público', consulta: 'TREM2 antibody', url: 'https://example.org/consulta',
      total: 20, recuperados: 4, paginas: 1, completa: false, error: null }],
    limitaciones: ['La búsqueda tiene cobertura acotada.'] };
}

function revision(): RevisionTratamiento {
  return { version: 1, vigente: true, huella: 'tratamiento-test', fecha: Date.UTC(2026, 9, 7),
    perfil: { tipo: 'intervencion', nombre: 'Anticuerpo TREM2', ingredientes: ['Compuesto A'], sinonimos: ['Código AZ'],
      dianas: ['TREM2'], modalidad: 'Anticuerpo', direccion: 'Activar', indicacion: 'Alzheimer', combinacion: ['Compuesto B'],
      via: 'Intravenosa', dosis: '10 mg', formulacion: 'Solución', secuencia: 'AAATTTCCC',
      consultasPatentes: ['TREM2 antibody composition'], consultasProgramas: ['Código AZ'] },
    patentes: informe('patentes'), companias: informe('companias') };
}

function datos(): { estado: EstadoRosa; inv: Investigacion; h: Hipotesis; otra: Hipotesis } {
  const estado = structuredClone(estadoDeMuestra());
  estado.conexion = 'en_linea';
  const inv = estado.investigaciones[0]!;
  const base = estado.hipotesis.find(x => x.investigacionId === inv.id)!;
  const h = { ...base, id: 'hip-propia', titulo: 'Hipótesis propia sobre TREM2', revisionTratamiento: revision() };
  const otra = { ...structuredClone(base), id: 'hip-ajena', investigacionId: 'inv-ajena', titulo: 'Propuesta confidencial ajena', revisionTratamiento: revision() };
  otra.revisionTratamiento!.perfil.nombre = 'Tratamiento ajeno';
  estado.hipotesis = [h, otra];
  return { estado, inv, h, otra };
}

async function montar(inv: Investigacion, estado: EstadoRosa, detalleId: string | null = null) {
  await act(async () => root.render(<Novedad inv={inv} estado={estado} detalleId={detalleId} />));
}

it('muestra solo propuestas e informe del especialista de la investigación seleccionada', async () => {
  const { estado, inv } = datos();
  await montar(inv, estado);
  expect(nodo.textContent).toContain('Sofía'); expect(nodo.textContent).toContain('Damián');
  expect(nodo.textContent).toContain('Fuente exclusiva de patentes');
  expect(nodo.textContent).not.toContain('Fuente exclusiva de companias');
  expect(nodo.textContent).not.toContain('Propuesta confidencial ajena');
  expect(nodo.textContent).not.toContain('Tratamiento ajeno');
  expect(nodo.querySelector('.novedad-lectura')?.getAttribute('aria-label')).toBe('Informe de Sofía');
  expect(nodo.querySelectorAll('.revision-informe')).toHaveLength(1);
  expect(nodo.querySelectorAll('main')).toHaveLength(0);
  expect(nodo.querySelector('.novedad-pagina')).not.toBeNull();
  expect(nodo.querySelector('.novedad')).toBeNull();
});

it('el enlace directo selecciona a Damián, preserva la URL exacta y conserva el pasaje literal', async () => {
  const { estado, inv, h } = datos();
  const url = rutaNovedad(inv.id, h.id, 'companias');
  const ruta = parsearRuta(url);
  expect(ruta.tipo).toBe('investigacion');
  if (ruta.tipo !== 'investigacion') throw new Error('La ruta de novedad no se reconoció');
  await montar(inv, estado, ruta.detalleId);
  expect(nodo.querySelector('.novedad-lectura')?.getAttribute('aria-label')).toBe('Informe de Damián');
  expect(nodo.textContent).toContain('Fuente exclusiva de companias');
  expect(nodo.textContent).not.toContain('Fuente exclusiva de patentes');
  expect(nodo.querySelector('article a')?.getAttribute('href')).toBe(h.revisionTratamiento!.companias!.hallazgos[0]!.url);
  expect(nodo.querySelector('blockquote')?.textContent).toBe(h.revisionTratamiento!.companias!.hallazgos[0]!.cita);
  expect(nodo.querySelector('blockquote b')).toBeNull();
  expect(nodo.querySelector('blockquote')?.hasAttribute('data-sin-traducir')).toBe(true);
});

it('la navegación usa enlaces de hash y cambiar de especialista conserva la hipótesis', async () => {
  const { estado, inv, h } = datos();
  await montar(inv, estado, `patentes:${h.id}`);
  const enlaces = nodo.querySelectorAll('.novedad-especialistas a');
  expect(enlaces[0]!.getAttribute('href')).toBe(rutaNovedad(inv.id, h.id, 'patentes'));
  expect(enlaces[1]!.getAttribute('href')).toBe(rutaNovedad(inv.id, h.id, 'companias'));
  expect(enlaces[0]!.getAttribute('aria-current')).toBe('page');
  await montar(inv, estado, `companias:${h.id}`);
  expect(nodo.querySelectorAll('.novedad-especialistas a')[1]!.getAttribute('aria-current')).toBe('page');
  expect(nodo.querySelector('.novedad-tratamientos a')?.getAttribute('aria-current')).toBe('page');
  // Volver recupera la selección anterior directamente desde el contrato de URL.
  await montar(inv, estado, `patentes:${h.id}`);
  expect(nodo.textContent).toContain('Fuente exclusiva de patentes');
});

it('una revisión antigua se oculta entera, incluidos perfil y pasajes, y queda pendiente', async () => {
  const { estado, inv, h } = datos();
  h.revisionTratamiento!.vigente = false;
  await montar(inv, estado, `companias:${h.id}`);
  expect(nodo.textContent).toContain('El tratamiento cambió');
  expect(nodo.textContent).toContain('Revisión pendiente');
  expect(nodo.textContent).not.toContain('Fuente exclusiva');
  expect(nodo.textContent).not.toContain('Compuesto A');
  expect(nodo.querySelectorAll('blockquote')).toHaveLength(0);
  expect(nodo.textContent).toContain('0 de 1 con informe de Damián');
});

it('sin informe completo muestra no comprobado, nunca ausencia de patentes ni compañías', async () => {
  const { estado, inv, h } = datos();
  h.revisionTratamiento = null;
  await montar(inv, estado, `companias:${h.id}`);
  expect(nodo.textContent).toContain('No comprobado');
  expect(nodo.textContent).toContain('Este agente todavía no ha completado la revisión');
  expect(nodo.textContent).not.toContain('Sin coincidencias');
  expect(nodo.querySelectorAll('article')).toHaveLength(0);
});

it('un informe fallido conserva cobertura y fecha sin describirlo como verificado', async () => {
  const { estado, inv, h } = datos();
  h.revisionTratamiento!.companias = { ...informe('companias'), estado: 'no_comprobado',
    resumen: 'No pude comprobar el programa empresarial.', hallazgos: [],
    consultas: [{ ...informe('companias').consultas[0]!, total: null, recuperados: 0, completa: false, error: 'Timeout' }] };
  await montar(inv, estado, `companias:${h.id}`);
  expect(nodo.textContent).toContain('1 de 1 con informe de Damián');
  expect(nodo.textContent).toContain('No comprobado');
  expect(nodo.textContent).toContain('Revisión registrada el');
  expect(nodo.textContent).toContain('La fuente no respondió: Timeout');
  expect(nodo.textContent).toContain('0 de total desconocido');
  expect(nodo.textContent).not.toContain('Sin coincidencias');
  expect(nodo.textContent).not.toContain('revisados por');
});

it('un informe histórico sin perfil no rompe el índice ni inventa un tratamiento', async () => {
  const { estado, inv, h } = datos();
  h.revisionTratamiento!.perfil = null as unknown as RevisionTratamiento['perfil'];
  await montar(inv, estado);
  expect(nodo.textContent).toContain('Fuente exclusiva de patentes');
  expect(nodo.querySelector('.revision-perfil')).toBeNull();
});

it('un enlace a otra investigación no filtra sus datos ni elige otra propuesta silenciosamente', async () => {
  const { estado, inv, otra } = datos();
  await montar(inv, estado, `companias:${otra.id}`);
  expect(nodo.textContent).toContain('La propuesta no está disponible');
  expect(nodo.textContent).not.toContain('Tratamiento ajeno');
  expect(nodo.textContent).not.toContain('Fuente exclusiva');
});

it('muestra perfil completo, revisión independiente, diferencias, consultas y límites', async () => {
  const { estado, inv, h } = datos();
  await montar(inv, estado, h.id);
  for (const valor of ['Compuesto A', 'Compuesto B', 'Código AZ', '10 mg', 'AAATTTCCC', 'Intravenosa', 'Solución',
    'TREM2 antibody composition', 'modelo/especialista', 'modelo/juez', 'La composición no coincide.',
    '4 de 20', 'Consulta parcial', 'La búsqueda tiene cobertura acotada.']) expect(nodo.textContent).toContain(valor);
  expect(nodo.querySelector('.revision-informe time')?.getAttribute('datetime')).toBe('2026-10-07T10:00:00.000Z');
  expect(nodo.querySelector('details summary')?.textContent).toBe('Fuentes y cobertura de la búsqueda');
});

it('atribuye el informe solo a su corrida y no a la corrida más reciente', async () => {
  const { estado, inv, h } = datos();
  const corrida = estado.corridas.find(c => c.investigacionId === inv.id)!;
  const iteracion = estado.iteraciones.find(it => it.corridaId === corrida.id)!;
  corrida.numero = 7; iteracion.numero = 2;
  estado.corridas.push({ ...structuredClone(corrida), id: 'cor-mas-reciente', numero: 99 });
  h.revisionTratamiento!.patentes!.corridaId = corrida.id;
  h.revisionTratamiento!.patentes!.iteracionId = iteracion.id;
  await montar(inv, estado);
  expect(nodo.querySelector('.novedad-ejecucion')?.textContent).toBe('Corrida 7 · Iteración 2');
  delete h.revisionTratamiento!.patentes!.corridaId;
  await montar(inv, estado);
  expect(nodo.querySelector('.novedad-ejecucion')?.textContent).toBe('Corrida de la revisión no disponible');
  expect(nodo.querySelector('.novedad-ejecucion')?.textContent).not.toContain('99');
});

it('busca por alias y diana sin mezclar hipótesis, y recibe actualizaciones del estado real', async () => {
  const { estado, inv, h } = datos();
  estado.hipotesis.push({ ...structuredClone(h), id: 'hip-segunda', titulo: 'Segunda propuesta', revisionTratamiento: null });
  await montar(inv, estado);
  const input = nodo.querySelector('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'codigo az');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(nodo.querySelectorAll('.novedad-tratamientos li')).toHaveLength(1);
  const actualizado = structuredClone(estado);
  actualizado.hipotesis[0]!.revisionTratamiento!.patentes!.resumen = 'Nueva revisión recibida por el servidor.';
  await montar(inv, actualizado);
  expect(nodo.textContent).toContain('Nueva revisión recibida por el servidor.');
});

it('traduce la interfaz al inglés y mantiene originales las fuentes', async () => {
  const { estado, inv, h } = datos();
  fijarIdioma('en');
  await montar(inv, estado, `companias:${h.id}`);
  expect(nodo.textContent).toContain('Treatment novelty');
  expect(nodo.textContent).toContain('Companies'); expect(nodo.textContent).toContain('Patents');
  expect(nodo.textContent).toContain('Current and historical treatment development');
  expect(nodo.textContent).toContain('Search by treatment or target');
  expect(nodo.textContent).toContain('View the hypothesis and its experiment');
  expect(nodo.textContent).toContain('Profile of the treatment reviewed');
  expect(nodo.textContent).toContain('Independent review');
  expect(nodo.textContent).toContain('Sources and search coverage');
  expect(nodo.textContent).not.toContain('Novedad del tratamiento');
  expect(nodo.textContent).not.toContain('Perfil del tratamiento comparado');
  expect(nodo.querySelector('blockquote')?.textContent).toBe(h.revisionTratamiento!.companias!.hallazgos[0]!.cita);
});

it('distingue una conexión pendiente de informes guardados sin conexión', async () => {
  const { estado, inv } = datos();
  estado.conexion = 'conectando';
  await montar(inv, estado);
  expect(nodo.querySelector('.novedad-conexion')?.textContent).toContain('Conectando con ROSA');
  estado.conexion = 'sin_conexion';
  await montar(inv, estado);
  expect(nodo.querySelector('.novedad-conexion')?.textContent).toContain('no se están actualizando');
  expect(nodo.textContent).toContain('Fuente exclusiva de patentes');
});

it('la investigación vacía ofrece contexto sin fabricar informes ni fuentes', async () => {
  const { estado, inv } = datos(); estado.hipotesis = [];
  await montar(inv, estado);
  expect(nodo.textContent).toContain('La revisión empieza con un tratamiento');
  expect(nodo.querySelectorAll('article')).toHaveLength(0);
  expect(nodo.querySelectorAll('.novedad-tratamientos li')).toHaveLength(0);
  expect(nodo.textContent).not.toContain('Sin coincidencias');
});
