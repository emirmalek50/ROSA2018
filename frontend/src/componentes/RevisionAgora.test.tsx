// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Hipotesis, Novedad, RevisionAgora as Informe, SeccionAgora } from '../datos/tipos';
import { fijarIdioma } from '../lib/idioma';
import { EstadoAgora, ResumenAgora, RevisionAgora } from './RevisionAgora';

let nodo: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fijarIdioma('es');
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); fijarIdioma('es'); });

const fecha = Date.UTC(2026, 9, 8, 12);
function seccion(id: string): SeccionAgora {
  return {
    id, nombre: id, estado: 'comprobado', resumen: 'Datos del registro consultado.', fecha,
    fuentes: [{ nombre: 'Agora', url: 'https://agora.adknowledgeportal.org/genes/ENSG00000130203', version: '2026.1' }],
    consultas: [{ url: 'https://agora.adknowledgeportal.org/api/genes/ENSG00000130203', fecha, n: 1, parametros: { gene: 'ENSG00000130203' }, error: null }],
    datos: { cohort: 'ROSMAP', tissue: 'DLPFC', log2_fc: -0.23, adj_p_val: 1.2e-8, count: 0 }, limitaciones: [],
  };
}
function informe(): Informe {
  return {
    version: 1, versionHipotesis: 1, huella: 'APOE-contexto', vigente: true, hipotesisId: 'h1', corridaId: 'c1', iteracionId: 'i1', fecha,
    estado: 'completa', resumen: 'Las secciones consultadas conservan sus resultados.', artefactoId: 'agora-json', limitaciones: [],
    genes: [{ consultado: 'APOE', simbolo: 'APOE', ensembl: 'ENSG00000130203', url: 'https://agora.adknowledgeportal.org/genes/ENSG00000130203', estadoResolucion: 'resuelto', secciones: ['gene_search', 'comparison_rna', 'comparison_proteina', 'nominated_targets', 'nominated_drugs'].map(seccion) }],
  };
}
function hipotesis(r: Informe | null = informe()): Pick<Hipotesis, 'id' | 'investigacionId' | 'version' | 'revisionAgora'> {
  return { id: 'h1', investigacionId: 'inv1', version: 1, revisionAgora: r };
}

it.each(['No comprobado: Agora no tiene API pública estable.', 'Pendiente de comprobar', 'No pude comprobar la fuente'])('no pinta ausencia ni verde para el estado histórico %s', async detalle => {
  await act(async () => root.render(<EstadoAgora valor={{ estado: 'no_nominada', detalle }} />));
  expect(nodo.textContent).toBe('No comprobado');
  expect(nodo.querySelector('.chip-ok')).toBeNull();
});

it.each<[Novedad['agora']['estado'], string, string]>([
  ['no_nominada', 'No aplica: sin diana molecular', 'No aplica'],
  ['parcial', 'Falta proteína', 'Revisión parcial'],
  ['no_comprobado', '', 'No comprobado'],
])('respeta el alcance %s sin afirmar nominación', async (estado, detalle, esperado) => {
  await act(async () => root.render(<EstadoAgora valor={{ estado, detalle }} />));
  expect(nodo.textContent).toBe(esperado);
  expect(nodo.querySelector('.chip-ok')).toBeNull();
});

it('una hipótesis sin revisión no aparenta consulta ni ausencia de datos', async () => {
  await act(async () => root.render(<RevisionAgora h={hipotesis(null)} />));
  expect(nodo.querySelector('[role="status"]')?.textContent).toContain('Todavía no consta');
  expect(nodo.textContent).toContain('No comprobado');
  expect(nodo.querySelectorAll('.agora-seccion')).toHaveLength(0);
  expect(nodo.textContent).not.toContain('Sin datos en la consulta');
});

it('conserva resultados de ARN si falla proteína y no convierte un total desconocido en cero', async () => {
  const r = informe(), s = r.genes[0]!.secciones[2]!;
  s.estado = 'no_comprobado'; s.resumen = 'Proteína no disponible'; s.datos = {};
  s.consultas = [{ ...s.consultas[0]!, n: null, total: null, error: 'Timeout', completa: false }];
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  expect(nodo.querySelector('.agora-cabecera')?.textContent).toContain('Revisión parcial');
  expect(nodo.textContent).toContain('4 de 5 secciones consultadas');
  const arn = nodo.querySelectorAll('.agora-seccion')[1]!;
  expect(arn.textContent).toContain('ROSMAP');
  expect(arn.textContent).toContain('DLPFC');
  expect(arn.textContent).toContain('"log2_fc": -0.23');
  expect(arn.textContent).toContain('"adj_p_val": 1.2e-8');
  expect(arn.textContent).toContain('"count": 0');
  const proteina = nodo.querySelectorAll('.agora-seccion')[2]!;
  expect(proteina.textContent).toContain('Registros devueltos: No registrado');
  expect(proteina.textContent).toContain('No pude comprobar: Timeout');
  expect(proteina.textContent).not.toContain('Total declarado: 0');
  expect(proteina.textContent).not.toContain('Sin datos en la consulta');
});

it('no considera completa una revisión sin todas las secciones y muestra datos adicionales', async () => {
  const r = informe();
  r.genes[0]!.secciones = [seccion('gene_search'), { ...seccion('metabolomica'), nombre: 'Metabolómica' }];
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  expect(nodo.querySelector('.agora-cabecera')?.textContent).toContain('Revisión parcial');
  expect(nodo.textContent).toContain('Esta sección no está en la revisión guardada.');
  expect(nodo.textContent).toContain('Metabolómica');
  expect(nodo.querySelectorAll('.agora-seccion')).toHaveLength(6);
});

it('un registro de consulta fallida prevalece sobre una sección que dice sin datos', async () => {
  const r = informe(), s = r.genes[0]!.secciones[4]!;
  s.estado = 'sin_datos'; s.consultas[0]!.error = 'HTTP 503';
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  const drogas = nodo.querySelectorAll('.agora-seccion')[4]!;
  expect(drogas.getAttribute('data-estado')).toBe('parcial');
  expect(drogas.textContent).not.toContain('Sin datos en la consulta');
});

it.each([false, true])('marca histórico un informe incompatible con la versión actual aunque vigente sea %s', async vigente => {
  const h = hipotesis(); h.version = 2; h.revisionAgora!.vigente = vigente;
  await act(async () => root.render(<RevisionAgora h={h} />));
  expect(nodo.querySelector('[role="status"]')?.textContent).toContain('Hace falta revisar esta versión');
  expect(nodo.querySelector<HTMLDetailsElement>('.agora-historico')?.open).toBe(false);
  expect(nodo.querySelector('.agora-cabecera')?.textContent).not.toContain('Revisión completa');
  await act(async () => root.render(<ResumenAgora h={h} onAbrir={() => undefined} />));
  expect(nodo.textContent).toContain('El informe anterior no describe esta versión');
  expect(nodo.textContent).not.toContain('5 de 5');
});

it('no muestra datos de otra hipótesis aunque el objeto se haya asociado por error', async () => {
  const r = informe(); r.hipotesisId = 'h-ajena';
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  expect(nodo.textContent).not.toContain('ROSMAP');
  expect(nodo.textContent).toContain('Todavía no consta');
});

it('muestra fecha, procedencia, URLs exactas, versión de fuente y artefacto completo', async () => {
  await act(async () => root.render(<RevisionAgora h={hipotesis()} />));
  expect(nodo.querySelector('.agora-cabecera')?.textContent).toContain('Revisión completa');
  expect(nodo.textContent).toContain('5 de 5 secciones consultadas');
  expect(nodo.querySelector('time')?.dateTime).toBe('2026-10-08T12:00:00.000Z');
  expect(nodo.textContent).toContain('2026.1');
  expect(nodo.querySelector('.agora-fuentes a')?.getAttribute('href')).toBe(informe().genes[0]!.url);
  expect(nodo.querySelector('.agora-artefacto')?.getAttribute('href')).toContain('/artefactos/agora-json');
});

it('no crea enlaces ejecutables, conserva el texto como dato y tolera fechas inválidas', async () => {
  const r = informe(), g = r.genes[0]!;
  r.fecha = 1e30; g.url = 'javascript:alert(1)';
  for (const s of g.secciones) { s.fuentes[0]!.url = 'file:///etc/passwd'; s.consultas[0]!.url = 'javascript:alert(2)'; s.datos = { value: '<img src=x onerror=alert(1)>' }; }
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  expect(nodo.querySelector('img')).toBeNull();
  expect(nodo.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
  expect(nodo.textContent).toContain('Fecha no disponible');
  expect(nodo.querySelector('pre')?.textContent).toContain('<img src=x onerror=alert(1)>');
});

it('traduce los controles al inglés y conserva cifras y texto fuente', async () => {
  fijarIdioma('en');
  await act(async () => root.render(<RevisionAgora h={hipotesis()} />));
  expect(nodo.textContent).toContain('Agora review');
  expect(nodo.textContent).toContain('Gene Comparison: RNA');
  expect(nodo.textContent).toContain('Nominated Drugs');
  expect(nodo.textContent).toContain('5 of 5 sections checked');
  expect(nodo.textContent).toContain('Datos del registro consultado.');
  expect(nodo.querySelector('pre')?.hasAttribute('data-sin-traducir')).toBe(true);
});

it('el resumen abre la evidencia y el estado en curso no aparenta cierre', async () => {
  const r = informe(); r.estado = 'en_curso'; const onAbrir = vi.fn();
  await act(async () => root.render(<ResumenAgora h={hipotesis(r)} onAbrir={onAbrir} />));
  expect(nodo.textContent).toContain('Revisión en curso');
  await act(async () => nodo.querySelector('button')!.click());
  expect(onAbrir).toHaveBeenCalledOnce();
});

it('renderiza la forma pública de TREM2: fechas ISO, versión de Synapse y vista previa acotada', async () => {
  // Forma comprobada contra _gen_publico y una respuesta guardada de Agora.
  // Se conserva una fila; la prueba no consulta la API ni depende de /tmp.
  const r = informe(), g = r.genes[0]!;
  g.consultado = 'TREM2'; g.simbolo = 'TREM2'; g.ensembl = 'ENSG00000095970';
  g.url = 'https://agora.adknowledgeportal.org/genes/ENSG00000095970';
  const version = { data_file: 'syn13363290', data_version: '119', team_images_id: 'syn12861877' };
  g.datos = { version, identidad: { ensembl_gene_id: g.ensembl, hgnc_symbol: 'TREM2' } };
  const iso = '2026-10-08T21:26:50.810836+00:00';
  for (const s of g.secciones) {
    s.fecha = iso;
    s.fuentes = [{ nombre: 'Agora', url: g.url, version }];
    s.consultas = [{ url: 'https://agora.adknowledgeportal.org/api/v1/genes/ENSG00000095970', parametros: { category: 'RNA' }, fecha: '2026-10-08T21:26:51.287888+00:00', n: 1, error: null, http: 200 }];
  }
  g.secciones.push({ ...seccion('rna'), fecha: iso, fuentes: g.secciones[0]!.fuentes, consultas: g.secciones[0]!.consultas,
    datos: { recuperados: 36, esperados: null, vistaPrevia: [{ logfc: -0.484669059891765, fc: 0.7146609872982237, ci_l: -0.803128189105737, ci_r: -0.166209930677794, adj_p_val: 0.0120962351599541, tissue: 'CBE', study: 'MayoRNAseq', model: 'AD Diagnosis (males and females)' }], alcanceVista: 'Hasta 12 filas por lista. Los datos completos se conservan en agora.json del RO-Crate.' } });
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  expect(nodo.querySelector('.agora-cabecera')?.textContent).toContain('Revisión completa');
  expect(nodo.textContent).toContain('syn13363290');
  expect(nodo.querySelector('.agora-seccion time')?.getAttribute('datetime')).toBe('2026-10-08T21:26:50.810Z');
  expect(nodo.textContent).toContain('"recuperados": 36');
  expect(nodo.textContent).toContain('"esperados": null');
  expect(nodo.textContent).toContain('-0.484669059891765');
  expect(nodo.textContent).toContain('MayoRNAseq');
  expect(nodo.textContent).toContain('Hasta 12 filas por lista');
  expect(nodo.textContent).toContain('"category": "RNA"');
  expect(nodo.textContent).not.toContain('[object Object]');
  expect(nodo.textContent).not.toContain('Fecha no disponible');
});

it('muestra el análisis íntegro más allá de doce filas sin duplicarlo en la vista previa ni traducir cifras', async () => {
  fijarIdioma('en');
  const r = informe(), s = r.genes[0]!.secciones[1]!;
  const filas = Array.from({ length: 13 }, (_, i) => `Medición ${i + 1}: cohorte C${i + 1}, cambio ${i === 12 ? '-0.484669059891765' : '0.105611975268665'}.`);
  s.datos = { recuperados: 13, esperados: 13, vistaPrevia: filas.slice(0, 12), analisisDescriptivo: filas.join('\n') };
  await act(async () => root.render(<RevisionAgora h={hipotesis(r)} />));
  const seccion = nodo.querySelectorAll('.agora-seccion')[1]!;
  const analisis = seccion.querySelector<HTMLDetailsElement>('.agora-analisis')!;
  expect(analisis.querySelector('summary')?.textContent).toBe('Analysis of retrieved data');
  await act(async () => analisis.querySelector('summary')!.click());
  expect(analisis.open).toBe(true);
  expect(analisis.querySelector('p')?.textContent).toBe(filas.join('\n'));
  expect(analisis.querySelector('p')?.hasAttribute('data-sin-traducir')).toBe(true);
  expect(analisis.textContent).toContain(filas[12]);
  const preview = seccion.querySelector('.agora-datos pre')!;
  expect(preview.textContent).not.toContain('analisisDescriptivo');
  expect(preview.textContent).not.toContain(filas[12]);
  expect(preview.textContent).toContain('"recuperados": 13');
  expect(Array.from(seccion.children).indexOf(analisis)).toBeLessThan(Array.from(seccion.children).indexOf(seccion.querySelector('.agora-datos')!));
});
