import { describe, expect, it } from 'vitest';
import { INVESTIGACION } from '../datos/muestra';
import { avisosDelObjetivo, paradaMedible, parafrasis, proponerConfiguracion } from './objetivo';
import { fijarIdioma } from './idioma';

describe('avisosDelObjetivo', () => {
  it('un objetivo bien escrito no dispara avisos', () => {
    const avisos = avisosDelObjetivo(INVESTIGACION.objetivo, INVESTIGACION.condicionParada);
    expect(avisos).toEqual([]);
  });
  it('avisa de objetivo corto, sin contexto, sin comprobacion y sin parada', () => {
    const tipos = avisosDelObjetivo('Curar el Alzheimer', '').map((a) => a.tipo);
    expect(tipos).toContain('corto');
    expect(tipos).toContain('sin_contexto');
    expect(tipos).toContain('sin_comprobacion');
    expect(tipos).toContain('sin_parada');
  });
  it('detecta preguntas de lista', () => {
    const tipos = avisosDelObjetivo('Lista todos los genes diferencialmente expresados con p menor que 0,05 en microglia de portadores de APOE4 medidos en la cohorte de ROSMAP con biomarcadores', '72 h').map((a) => a.tipo);
    expect(tipos).toContain('respuesta_obvia');
  });
  it('detecta varios objetivos', () => {
    const o = 'Encontrar biomarcadores de progresion en cohortes. Y tambien mecanismos de la microglia con dianas. Y ademas candidatos a reposicionamiento con ensayos. Por otro lado, evaluar la seguridad de ARIA.';
    expect(avisosDelObjetivo(o, '72 h').map((a) => a.tipo)).toContain('varios_objetivos');
  });
});

describe('proponerConfiguracion', () => {
  it('traduce las sugerencias al idioma actual sin traducir límites escritos por la persona', () => {
    const limites = ['No incluir datos de pacientes'];
    try {
      fijarIdioma('en');
      const c = proponerConfiguracion('', '', limites);
      expect(c.atributos).toEqual(['Novelty relative to Open Targets, ClinicalTrials.gov, Agora, and the literature']);
      expect(c.restricciones).toEqual(limites);
      fijarIdioma('es');
      expect(proponerConfiguracion('', '', []).atributos[0]).toMatch(/^Novedad frente a/);
    } finally { fijarIdioma('es'); }
  });
  it('saca restricciones de los limites y del texto, y atributos de las palabras clave', () => {
    const c = proponerConfiguracion(INVESTIGACION.objetivo, INVESTIGACION.relevancia, INVESTIGACION.limites);
    expect(c.restricciones).toEqual(expect.arrayContaining(INVESTIGACION.limites));
    expect(c.atributos).toEqual(expect.arrayContaining(['Testabilidad con un biomarcador medible', 'Comprobable en una cohorte longitudinal', 'Mecanismo explícito con diana']));
    expect(c.preferencias.startsWith(INVESTIGACION.relevancia)).toBe(true);
  });
  it('con texto vacio devuelve la novedad como unico atributo', () => {
    const c = proponerConfiguracion('', '', []);
    expect(c.atributos).toHaveLength(1);
    expect(c.restricciones).toEqual([]);
  });
});

describe('parafrasis', () => {
  it('devuelve tres redacciones distintas con tareas', () => {
    const p = parafrasis('Encontrar hipotesis sobre biomarcadores.');
    expect(p).toHaveLength(3);
    expect(new Set(p.map((x) => x.redaccion)).size).toBe(3);
    for (const x of p) expect(x.primerasTareas.length).toBeGreaterThan(0);
  });
  it('vacio da vacio', () => {
    expect(parafrasis('  ')).toEqual([]);
  });
});

describe('paradaMedible', () => {
  it('reconoce cifras de iteraciones, tiempo y llamadas y rechaza el resto', () => {
    expect(paradaMedible('5 minutos, luego finalizara')).toBe(true);
    expect(paradaMedible('2 iteraciones o cuando cambie')).toBe(true);
    expect(paradaMedible('72 h')).toBe(true);
    expect(paradaMedible('300 llamadas')).toBe(true);
    expect(paradaMedible('Diez hipotesis sin revisar')).toBe(false);
    expect(paradaMedible('cuando el modelo de mundo deje de cambiar')).toBe(false);
    expect(avisosDelObjetivo('x', 'cuando deje de cambiar').map((a) => a.tipo)).toContain('parada_no_medible');
    expect(avisosDelObjetivo('x', '3 iteraciones').map((a) => a.tipo)).not.toContain('parada_no_medible');
  });
});
