// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InformeTratamiento, RevisionTratamiento as Revision } from '../datos/tipos';
import { fijarIdioma } from '../lib/idioma';
import { RevisionTratamiento } from './RevisionTratamiento';

let nodo: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fijarIdioma('es');
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); vi.unstubAllGlobals(); });

function informe(): InformeTratamiento {
  return {
    agente: 'patentes', estado: 'coincidencias', resumen: 'Una coincidencia parcial requiere revisar la intervención.',
    fecha: Date.UTC(2026, 9, 7, 12), modelo: 'openai/gpt-6-astra', revisor: 'anthropic/claude-opus-5',
    hallazgos: [{ id: 'patente-real', titulo: 'Document about TREM2', url: 'https://patents.google.com/patent/US123B2/en', fuente: 'Google Patents', relacion: 'misma_diana', cita: 'La molécula A actúa sobre TREM2. <b>Texto original</b>', explicacion: 'No es la molécula propuesta.', diferencias: ['Otra molécula.'], datos: { patent_number: 'US123B2', expiration_date: '2034-05-01' } }],
    consultas: [{ fuente: 'Registro de patentes', consulta: 'TREM2 AND antibody', url: 'https://patents.google.com/?q=TREM2', total: 50, recuperados: 5, paginas: 1, completa: false, error: null }],
    limitaciones: ['La vigencia no se resolvió.'],
  };
}

it('un cambio de tratamiento oculta las coincidencias de la versión anterior', async () => {
  const r = revision(); r.vigente = false;
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.querySelector('[role="status"]')?.textContent).toContain('El tratamiento cambió');
  expect(nodo.textContent).not.toContain(r.patentes!.hallazgos[0]!.cita);
});
function revision(): Revision {
  return { version: 1, huella: 'tratamiento-real', fecha: Date.UTC(2026, 9, 7, 12), perfil: { tipo: 'intervencion', nombre: 'TREM2 antibody', ingredientes: ['A'], sinonimos: [], dianas: ['TREM2'], modalidad: 'antibody', direccion: 'agonist', indicacion: 'Alzheimer', combinacion: [], consultasPatentes: [], consultasProgramas: [] }, patentes: informe() };
}

it('las hipótesis antiguas muestran ambos especialistas pendientes sin inventar una ausencia', async () => {
  await act(async () => root.render(<RevisionTratamiento />));
  expect(nodo.querySelectorAll('section[aria-label] h3')).toHaveLength(2);
  expect(nodo.textContent).toContain('Especialista en patentes');
  expect(nodo.textContent).toContain('Especialista en compañías');
  expect(nodo.textContent).toContain('No comprobado');
  expect(nodo.textContent).not.toContain('Sin coincidencias');
  expect(nodo.textContent).not.toContain('No existe patente');
});

it('separa una coincidencia de diana del mismo tratamiento y conserva cita y enlace exactos', async () => {
  await act(async () => root.render(<RevisionTratamiento revision={revision()} />));
  expect(nodo.textContent).toContain('Misma diana, tratamiento distinto');
  expect(nodo.textContent).toContain('Diferencias con la propuesta de ROSA');
  expect(nodo.querySelector('blockquote')?.textContent).toBe(informe().hallazgos[0]!.cita);
  expect(nodo.querySelector('blockquote')?.hasAttribute('data-sin-traducir')).toBe(true);
  expect(nodo.querySelector('blockquote b')).toBeNull();
  expect(nodo.querySelector('article a')?.getAttribute('href')).toBe(informe().hallazgos[0]!.url);
  expect(nodo.querySelector('time')?.dateTime).toBe('2026-10-07T12:00:00.000Z');
  expect(nodo.textContent).toContain('Consultas registradas: 1; incompletas o sin respuesta: 1.');
  expect(nodo.textContent).toContain('5 de 50');
  expect(nodo.textContent).toContain('Fecha de caducidad declarada');
  expect(nodo.textContent).not.toContain('Patente vigente');
});

it('una fuente caída y un total desconocido no se convierten en cero resultados', async () => {
  const r = revision();
  r.patentes = { ...informe(), estado: 'no_comprobado', hallazgos: [], consultas: [{ ...informe().consultas[0]!, total: null, recuperados: 0, error: 'Timeout' }] };
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.textContent).toContain('La fuente no respondió: Timeout');
  expect(nodo.textContent).toContain('0 de total desconocido');
  expect(nodo.textContent).not.toContain('0 de 0');
  expect(nodo.textContent).toContain('No comprobado');
});

it('muestra los datos anidados reales de Orange Book sin inventar titularidad ni vigencia', async () => {
  const r = revision();
  r.patentes!.hallazgos[0]!.fuente = 'openFDA Orange Book';
  r.patentes!.hallazgos[0]!.datos = { pais: 'US', ingrediente: 'lecanemab', ingredientes: ['lecanemab'], patente: { patent_number: '12345678', expiration_date: '2034-05-01', patent_submission_date: '2023-03-10', drug_substance_flag: true }, actualizadoEn: '2026-10-01', estadoJuridicoVerificado: false };
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.textContent).toContain('12345678');
  expect(nodo.textContent).toContain('Fecha de caducidad declarada'); expect(nodo.textContent).toContain('2034-05-01');
  expect(nodo.textContent).toContain('Fecha de presentación declarada'); expect(nodo.textContent).toContain('2023-03-10');
  expect(nodo.textContent).not.toContain('Solicitud regulatoria'); expect(nodo.textContent).not.toContain('Titular');
  expect(nodo.textContent).not.toContain('Patente vigente');
});

it('muestra compañía, estado y parada registrados sin atribuir un resultado negativo', async () => {
  const r = revision();
  r.companias = { ...informe(), agente: 'companias', hallazgos: [{ ...informe().hallazgos[0]!, id: 'nct-real', url: 'https://clinicaltrials.gov/study/NCT12345678', datos: { nct: 'NCT12345678', patrocinador: { nombre: 'Example Biotech', clase: 'INDUSTRY' }, colaboradores: [{ nombre: 'Example Lab', clase: 'OTHER' }], estado: 'TERMINATED', fases: ['PHASE2'], whyStopped: 'Business decision', hasResults: false, fechas: { inicio: { fecha: '2024-01-01', tipo: 'ACTUAL' }, finalizacionPrimaria: { fecha: '2025-09-30', tipo: 'ACTUAL' }, finalizacion: { fecha: '2026-01-01', tipo: 'ESTIMATED' }, ultimaActualizacion: { fecha: '2026-09-01', tipo: 'ACTUAL' } } } }] };
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.textContent).toContain('Example Biotech'); expect(nodo.textContent).toContain('Example Lab');
  expect(nodo.textContent).toContain('PHASE2'); expect(nodo.textContent).toContain('TERMINATED');
  expect(nodo.textContent).toContain('Business decision'); expect(nodo.textContent).toContain('2024-01-01');
  expect(nodo.textContent).toContain('Finalización primaria registrada'); expect(nodo.textContent).toContain('2025-09-30');
  expect(nodo.textContent).toContain('2026-01-01'); expect(nodo.textContent).toContain('2026-09-01');
  expect(nodo.textContent).toContain('Resultados publicados en el registro');
  expect(nodo.textContent).not.toContain('Resultado negativo');
});

it('traduce la interfaz al inglés y conserva el pasaje original de la fuente', async () => {
  fijarIdioma('en'); const r = revision();
  r.perfil = { ...r.perfil, sinonimos: ['Código experimental'], via: 'Intravenous', dosis: '10 mg', formulacion: 'Solution', secuencia: 'ABCDEFGHIJKLMNOP' };
  r.patentes = { ...informe(), estado: 'sin_coincidencias_en_fuentes_consultadas', resumen: 'No matching intervention found in the public records searched.', limitaciones: ['Legal status could not be checked.'] };
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.textContent).toContain('Patent specialist'); expect(nodo.textContent).toContain('Company research specialist');
  expect(nodo.textContent).toContain('No matches found in the sources searched');
  expect(nodo.textContent).toContain('Same target, different treatment');
  expect(nodo.textContent).toContain('Sources and search coverage');
  expect(nodo.textContent).toContain('Reported expiration date');
  expect(nodo.textContent).toContain('Proposed route of administration'); expect(nodo.textContent).toContain('Proposed dose');
  expect(nodo.textContent).toContain('Proposed formulation'); expect(nodo.textContent).toContain('Proposed sequence');
  expect(nodo.textContent).toContain('Direction of the intervention'); expect(nodo.textContent).toContain('Documented aliases');
  expect(nodo.textContent).toContain('Código experimental');
  expect(nodo.textContent).toContain('10 mg'); expect(nodo.textContent).toContain('ABCDEFGHIJKLMNOP');
  expect(nodo.querySelector('blockquote')?.textContent).toBe(informe().hallazgos[0]!.cita);
  expect(nodo.textContent).not.toContain('Especialista'); expect(nodo.textContent).not.toContain('Consulta parcial');
});

it('no crea enlaces ejecutables y tolera una fecha malformada', async () => {
  const r = revision(); r.patentes!.hallazgos[0]!.url = 'javascript:alert(1)'; r.patentes!.fecha = 1e30;
  r.patentes!.consultas[0]!.url = 'file:///etc/passwd';
  await act(async () => root.render(<RevisionTratamiento revision={r} />));
  expect(nodo.querySelectorAll('a')).toHaveLength(0);
  expect(nodo.textContent).toContain('Enlace de la fuente no disponible');
  expect(nodo.textContent).toContain('Fecha no disponible');
});
