import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActividadLab } from './labVivo';
import { dialogoDeActividad } from './dialogoLaboratorio';
import { fijarIdioma } from './idioma';

function registro(texto: string, tipo: ActividadLab['tipo'] = 'accion'): ActividadLab {
  return { id: 'pista:0:1', agente: 'Killer', sala: 'r4', texto, tipo, pistaId: 'pista', pasoId: 'paso', fuente: 'PubMed', titulo: 'Revisión', enCurso: true, t: 1 };
}
beforeEach(() => fijarIdioma('es'));
afterEach(() => fijarIdioma('es'));

describe('los personajes hablan de su actividad en primera persona', () => {
  it('el Killer habla en primera persona y conserva completa la hipótesis de la captura', () => {
    const titulo = '«La severidad basal indicada por NfL modifica el valor clínico de una reducción de P-tau181»';
    const e = Object.freeze(registro('El Killer revisa ' + titulo));
    expect(dialogoDeActividad(e, true)).toBe('Estoy revisando ' + titulo);
    expect(e.texto).toBe('El Killer revisa ' + titulo);
    expect(e.pistaId).toBe('pista');
  });

  it.each(['Analogía', 'Contradicción', 'Mecanismo opuesto', 'Otra escala'])('el miembro %s conserva la ronda y su propio estado', (nombre) => {
    const e = registro(`El miembro «${nombre}» genera propuestas en la ronda 2`);
    expect(dialogoDeActividad(e, true)).toBe('Estoy generando propuestas en la ronda 2.');
    expect(dialogoDeActividad(e, false)).toBe('Estaba generando propuestas en la ronda 2.');
    expect(dialogoDeActividad(registro(`El miembro «${nombre}» terminó la ronda 2`, 'resultado'), false)).toBe('Ya terminé la ronda 2.');
  });

  it('distingue terminar, interrumpir y esperar una respuesta', () => {
    expect(dialogoDeActividad(registro('Terminó la tarea: El Killer revisa «MAPT»', 'resultado'), false)).toBe('Ya terminé de revisar «MAPT»');
    expect(dialogoDeActividad(registro('No se completó la tarea: El Killer revisa «MAPT»', 'error'), false)).toBe('No pude terminar esta tarea: «El Killer revisa «MAPT»».');
    expect(dialogoDeActividad(registro('El miembro «Otra escala» espera al modelo en la ronda 3', 'error'), false)).toContain('Me quedé esperando');
    expect(dialogoDeActividad(registro('El miembro «Otra escala» interrumpió la ronda 3', 'error'), false)).toBe('Tuve que interrumpir la ronda 3.');
    expect(dialogoDeActividad(registro('El miembro «Otra escala» no respondió en la ronda 3: tiempo agotado', 'error'), false)).toBe('No pude completar la ronda 3: tiempo agotado');
  });

  it('un registro de apertura antiguo no se presenta como trabajo actual ni como tarea completada', () => {
    expect(dialogoDeActividad(registro('El Killer revisa «MAPT»'), false)).toBe('Estaba revisando «MAPT»');
    expect(dialogoDeActividad(registro('Consulta: MAPT'), false)).toBe('Estaba buscando: MAPT');
    expect(dialogoDeActividad(registro('Análisis de APOE4', 'estado'), false)).toBe('Mi último registro dice: «Análisis de APOE4».');
  });

  it('conserva las cifras, las fuentes y los límites de los resultados', () => {
    expect(dialogoDeActividad(registro('87 resultados en PubMed; 30 para cribar', 'resultado'), true)).toBe('Encontré 87 resultados en PubMed; 30 para cribar');
    expect(dialogoDeActividad(registro('Juez: 210 de 243', 'resultado'), true)).toBe('Llevo 210 de 243 afirmaciones verificadas.');
    expect(dialogoDeActividad(registro('Juez: 210 de 243', 'resultado'), false)).toContain('En ese momento llevaba 210 de 243');
    expect(dialogoDeActividad(registro('14 fuentes, 247 afirmaciones con cita', 'resultado'), false)).toBe('Leí 14 fuentes y extraje 247 afirmaciones con cita.');
  });

  it.each(['resultado', 'nota'] as const)('no cambia una afirmación científica aunque tenga un prefijo de acción (%s)', (tipo) => {
    const texto = 'El Killer revisa «MAPT» no implica beneficio clínico ni refuta la hipótesis; solo evidencia parcial.';
    const dialogo = dialogoDeActividad(registro(texto, tipo), true);
    expect(dialogo).toContain('«' + texto + '»');
    expect(dialogo).not.toContain('Estoy revisando');
  });

  it('un error de fuente no se convierte en ausencia de información', () => {
    const texto = 'No se pudo consultar PubMed: tiempo agotado; no pude comprobar si hay estudios.';
    expect(dialogoDeActividad(registro(texto, 'error'), false)).toBe('Encontré un problema: «' + texto + '».');
  });

  it('no vuelve a envolver una frase que ya está en primera persona', () => {
    const texto = 'Estoy leyendo el artículo sobre APOE4';
    expect(dialogoDeActividad(registro(texto), true)).toBe(texto);
  });

  it('el inglés reconoce tanto registros originales como los ya traducidos', () => {
    fijarIdioma('en');
    expect(dialogoDeActividad(registro('El Killer revisa «MAPT»'), true)).toBe("I'm reviewing «MAPT»");
    expect(dialogoDeActividad(registro('The Killer reviews “MAPT”'), true)).toBe("I'm reviewing “MAPT”");
    expect(dialogoDeActividad(registro('The "Analogy" member generates proposals in round 2'), true)).toBe("I'm generating proposals in round 2.");
    expect(dialogoDeActividad(registro('The "Analogy" member finished round 2', 'resultado'), false)).toBe('I finished round 2.');
    expect(dialogoDeActividad(registro('Judge: 30 of 33', 'resultado'), true)).toBe("I've verified 30 of 33 claims.");
    expect(dialogoDeActividad(registro('No se pudo consultar PubMed', 'error'), false)).toBe('I ran into a problem: “No se pudo consultar PubMed”.');
  });
});
