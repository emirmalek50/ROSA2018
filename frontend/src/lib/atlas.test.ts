// Tests del atlas de la enfermedad (lib/atlas.ts): construcción desde un mapa
// con pocas celdas, estado vacío, escala de intensidad, filtros por fase, por
// célula y por iteración, resolución de ids, y la comprobación de que las
// claves de región, fase y célula son las mismas que escribe el backend en
// rosa/mapa_enfermedad.py (se lee el fichero de Python con fs).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { CeldaMapa, Corrida, EstadoRosa, Fuente, HechoMundo, Hipotesis, Investigacion, Iteracion, MapaEnfermedad } from '../datos/tipos';
import { ETIQUETAS_MAPA } from '../componentes/MapaEnfermedad';
import { fijarIdioma } from './idioma';
import { CELULAS_CLAVES, construirAtlas, DEFINICIONES_CELULA, DEFINICIONES_REGION, ESTADIOS_CLAVES, FLUIDOS, hechosDe, hipotesisDe, intensidad, NO_LOCALIZADAS, normalizar, REGIONES_CLAVES, REGIONES_PATRONES, regionesEnTexto, SIN_CELULA, SIN_FASE } from './atlas';

const HORA = 3_600_000;
const T0 = 1_760_000_000_000;

/** Una celda del mapa con lo mínimo; lo demás, vacío. */
function celda(parte: Partial<CeldaMapa>): CeldaMapa {
  return { estadio: null, region: null, tipoCelular: null, hechos: [], hipotesis: [], preguntas: [], certezaMax: null, certezaMotivo: '', cohortes: [], porMision: 0, ...parte };
}

/** Un estado de prueba: la investigación de la muestra con una corrida de tres
 *  iteraciones fechadas (T0 a T0+1h, T0+1h a T0+2h, T0+2h abierta), tres hechos
 *  (uno nacido en la iteración 1, otro en la 2, otro sin fecha) y dos hipótesis
 *  (una de la iteración 1 con certeza baja, otra de la 3 con certeza moderada). */
function estadoDePrueba(mapa: MapaEnfermedad | null | undefined): { estado: EstadoRosa; inv: Investigacion } {
  const base = estadoDeMuestra();
  const invBase = base.investigaciones[0]!;
  const corridaBase = base.corridas[0]!;
  const iteracionBase = base.iteraciones[0]!;
  const hechoBase = base.hechos[0]!;
  const hipBase = base.hipotesis[0]!;
  const inv: Investigacion = { ...invBase, mapaEnfermedad: mapa };
  const corridas: Corrida[] = [{ ...corridaBase, id: 'cor-a', investigacionId: inv.id, numero: 1, empezadaEn: T0, terminadaEn: null }];
  const iteracion = (id: string, numero: number, empezadaEn: number, terminadaEn: number | null): Iteracion => ({ ...iteracionBase, id, corridaId: 'cor-a', numero, empezadaEn, terminadaEn });
  const iteraciones: Iteracion[] = [iteracion('it-a1', 1, T0, T0 + HORA), iteracion('it-a2', 2, T0 + HORA + 1, T0 + 2 * HORA), iteracion('it-a3', 3, T0 + 2 * HORA + 1, null)];
  const hecho = (id: string, fecha: number | null, tema: string): HechoMundo => ({
    ...hechoBase,
    id,
    investigacionId: inv.id,
    tema,
    enunciado: `Enunciado de ${id}`,
    actualizadoEn: fecha === null ? (undefined as unknown as number) : fecha,
    historial: fecha === null ? [] : [{ fecha, de: null, a: 'sabido', quien: 'Rosa', motivo: 'Añadido por el bucle' }],
  });
  const hechos: HechoMundo[] = [hecho('he-viejo', T0 + 10, 'Biomarcadores'), hecho('he-nuevo', T0 + HORA + 10, 'Glía'), hecho('he-sinfecha', null, 'Genética')];
  const hip = (id: string, creadaEn: number, iteracion: number, certeza: 'baja' | 'moderada'): Hipotesis => ({
    ...hipBase,
    id,
    investigacionId: inv.id,
    titulo: `Hipótesis ${id}`,
    creadaEn,
    iteracion,
    conclusion: hipBase.conclusion ? { ...hipBase.conclusion, certeza } : ({ certeza } as unknown as Hipotesis['conclusion']),
  });
  const hipotesis: Hipotesis[] = [hip('hip-a', T0 + 20, 1, 'baja'), hip('hip-b', T0 + 2 * HORA + 20, 3, 'moderada')];
  const estado: EstadoRosa = { ...base, investigaciones: [inv], corridas, iteraciones, hechos, hipotesis };
  return { estado, inv };
}

/** El mapa de prueba: cuatro celdas, dos de ellas en el hipocampo. */
function mapaDePrueba(): MapaEnfermedad {
  return {
    ejes: { estadio: {}, region: {}, tipoCelular: {}, nivel: {} },
    celdas: [
      celda({ estadio: 'preclinica', region: 'hipocampo', tipoCelular: 'astrocito', hechos: ['he-viejo', 'he-nuevo', 'he-fantasma'], hipotesis: ['hip-a'], preguntas: ['pr-1'], certezaMax: 'baja', cohortes: ['ADNI'] }),
      celda({ estadio: 'prodromica_dcl', region: 'hipocampo', tipoCelular: null, hechos: ['he-viejo', 'he-sinfecha'], hipotesis: ['hip-b'], certezaMax: 'moderada', cohortes: ['DIAN', 'ADNI'] }),
      celda({ estadio: null, region: 'plasma', tipoCelular: 'microglia', hechos: ['he-nuevo'] }),
      celda({ estadio: 'preclinica', region: null, tipoCelular: null, hechos: ['he-sinfecha'] }),
    ],
    huecos: [{ estadio: 'demencia_leve', region: 'hipocampo', tipoCelular: null, motivo: 'La misión nombra «demencia leve, hipocampo» y ningún hecho ni hipótesis lo sitúa por su propio contenido.', heredanDeMision: 0 }],
    sinEjes: 7,
    hipotesisSinEjes: 1,
    heredados: 2,
    mision: { estadio: null, estadios: [], region: [], tipoCelular: [], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen: 'Resumen de prueba del mapa.',
    fecha: T0 + 2 * HORA,
    iteracion: 2,
    etiquetas: { estadio: {}, region: { plasma: 'sangre (etiqueta del backend)' }, tipoCelular: {}, nivel: {} },
    definiciones: { estadio: { preclinica: 'definición del backend' }, nivel: {} },
  };
}

describe('el atlas de la enfermedad: construcción', () => {
  const { estado, inv } = estadoDePrueba(mapaDePrueba());
  const atlas = construirAtlas(estado, inv)!;

  it('cambia las etiquetas al cambiar de idioma después de cargar el módulo, conservando las claves', () => {
    const original = JSON.stringify(estado);
    try {
      fijarIdioma('en');
      const ingles = construirAtlas(estado, inv)!;
      expect(ingles.celulas.find((c) => c.clave === SIN_CELULA)!.etiqueta).toBe('no cell type');
      expect(ingles.estadios.find((e) => e.clave === SIN_FASE)!.etiqueta).toBe('no stage identified');
      expect(ingles.regiones.map((r) => r.clave)).toEqual(atlas.regiones.map((r) => r.clave));
      fijarIdioma('es');
      expect(construirAtlas(estado, inv)!.celulas.find((c) => c.clave === SIN_CELULA)!.etiqueta).toBe('sin tipo celular');
      expect(JSON.stringify(estado)).toBe(original);
    } finally { fijarIdioma('es'); }
  });

  it('devuelve null sin mapa, con mapa nulo y con un mapa sin celdas', () => {
    expect(construirAtlas(estadoDePrueba(undefined).estado, estadoDePrueba(undefined).inv)).toBeNull();
    expect(construirAtlas(estadoDePrueba(null).estado, estadoDePrueba(null).inv)).toBeNull();
    const vacio = estadoDePrueba({ ...mapaDePrueba(), celdas: [] });
    expect(construirAtlas(vacio.estado, vacio.inv)).toBeNull();
  });

  it('tiene una región por cada clave del backend, en el mismo orden, aunque esté vacía', () => {
    expect(atlas.regiones.map((r) => r.clave)).toEqual(REGIONES_CLAVES);
    for (const r of atlas.regiones) {
      expect(r.etiqueta).not.toBe('');
      expect(r.definicion).not.toBe('');
      expect(r.conteo).toBe(r.hechos.length + r.hipotesis.length);
    }
    expect(atlas.regiones.filter((r) => r.conteo === 0).length).toBe(REGIONES_CLAVES.length - 2);
  });

  it('cuenta cada hecho e hipótesis una sola vez por región y agrega por fase y por célula', () => {
    const hipocampo = atlas.regiones.find((r) => r.clave === 'hipocampo')!;
    // he-viejo está en dos celdas del hipocampo: cuenta una vez.
    expect(hipocampo.hechos.sort()).toEqual(['he-fantasma', 'he-nuevo', 'he-sinfecha', 'he-viejo']);
    expect(hipocampo.hipotesis.sort()).toEqual(['hip-a', 'hip-b']);
    expect(hipocampo.conteo).toBe(6);
    expect(hipocampo.preguntas).toEqual(['pr-1']);
    expect(hipocampo.cohortes).toEqual(['ADNI', 'DIAN']);
    expect(hipocampo.certezaMax).toBe('moderada');
    expect(hipocampo.porEstadio).toEqual({ preclinica: 4, prodromica_dcl: 3 });
    // La celda sin célula (he-viejo, he-sinfecha, hip-b) tiene su propia barra.
    expect(hipocampo.porCelula).toEqual({ astrocito: 4, [SIN_CELULA]: 3 });
    // he-fantasma no está en el estado: cuenta, pero el panel no lo puede listar.
    expect(hipocampo.sinResolver).toBe(1);
    expect(hipocampo.conteo - hipocampo.sinResolver).toBe(hechosDe(estado, hipocampo.hechos).length + hipotesisDe(estado, hipocampo.hipotesis).length);
    const plasma = atlas.regiones.find((r) => r.clave === 'plasma')!;
    expect(plasma.conteo).toBe(1);
    expect(plasma.certezaMax).toBeNull();
    expect(plasma.porEstadio).toEqual({ [SIN_FASE]: 1 });
    expect(plasma.porCelula).toEqual({ microglia: 1 });
    expect(plasma.sinResolver).toBe(0);
    expect(atlas.maximo).toBe(6);
  });

  it('los chips: fases y células presentes con su conteo, "sin fase" y "sin célula" al final', () => {
    expect(atlas.estadios.map((e) => e.clave)).toEqual(['preclinica', 'prodromica_dcl', SIN_FASE]);
    expect(atlas.estadios.map((e) => e.conteo)).toEqual([5, 3, 1]);
    expect(atlas.estadios[2]!.etiqueta).toBe('sin fase identificada');
    // Sin célula: he-viejo, he-sinfecha, hip-b (celda 2) y he-sinfecha (celda 4) son tres registros.
    expect(atlas.celulas).toEqual([
      { clave: 'astrocito', etiqueta: 'astrocito', conteo: 4 },
      { clave: 'microglia', etiqueta: 'microglía', conteo: 1 },
      { clave: SIN_CELULA, etiqueta: 'sin tipo celular', conteo: 3 },
    ]);
  });

  it('marcar todos los interruptores de célula enseña lo mismo que no marcar ninguno', () => {
    const total = (a: NonNullable<ReturnType<typeof construirAtlas>>) => a.regiones.reduce((s, r) => s + r.conteo, 0) + a.sinRegion;
    const conTodos = construirAtlas(estado, inv, { celulas: atlas.celulas.map((c) => c.clave) })!;
    expect(total(conTodos)).toBe(total(atlas));
    expect(total(conTodos)).toBe(8);
    expect(conTodos.regiones.find((r) => r.clave === 'hipocampo')!.conteo).toBe(6);
  });

  it('sabe en qué iteración seguida se calculó el mapa y cuántos hechos vivos nacieron después', () => {
    // El mapa se fechó al cerrar la iteración 2 (T0+2h, límite incluido).
    expect(atlas.iteracionOrdinal).toBe(2);
    // Ningún hecho del estado de prueba es posterior al mapa.
    expect(atlas.hechosNuevos).toBe(0);
  });

  it('calcula el resumen de las celdas (no imprime el guardado), coteja los ejes guardados y pasa los huecos y las cifras sueltas del mapa', () => {
    // El resumen sale de las celdas con el formato del backend: hechos e hipótesis únicos (he-viejo
    // cae en dos celdas y cuenta una vez), las celdas con algo dentro y los cuatro mayores de cada
    // eje. El guardado queda aparte, solo de consulta: el backend lo deja desfasado al fundir hechos.
    expect(atlas.resumen).toBe('4 hechos y 2 hipótesis situados en 4 celdas (estadio, región y tipo celular). Estadios: preclínica 5, prodrómica o DCL 3. Regiones: hipocampo 6, sangre (etiqueta del backend) 1. Tipos celulares: astrocito 4, microglía 1.');
    expect(atlas.resumenGuardado).toBe('Resumen de prueba del mapa.');
    // Los ejes guardados del mapa de prueba están vacíos: no hay nada que cotejar.
    expect(atlas.ejesDesfasados).toEqual([]);
    // Con un eje guardado que ya no cuadra con las celdas (la sangre a 3 cuando las celdas dan 1) se dice cuál, en legible.
    const desfasado = estadoDePrueba({ ...mapaDePrueba(), ejes: { estadio: { preclinica: 5, prodromica_dcl: 3 }, region: { hipocampo: 6, plasma: 3 }, tipoCelular: {}, nivel: {} } });
    expect(construirAtlas(desfasado.estado, desfasado.inv)!.ejesDesfasados).toEqual(['sangre (etiqueta del backend): 3 en el resumen guardado, 1 en las celdas']);
    // Con filtros el resumen es el de lo filtrado.
    expect(construirAtlas(estado, inv, { estadio: 'inventada' })!.resumen).toBe('Ningún hecho ni hipótesis situados con estos filtros.');
    expect(atlas.huecos).toEqual(['La misión nombra «demencia leve, hipocampo» y ningún hecho ni hipótesis lo sitúa por su propio contenido.']);
    expect(atlas.sinEjes).toBe(7);
    expect(atlas.hipotesisSinEjes).toBe(1);
    expect(atlas.heredados).toBe(2);
    expect(atlas.sinRegion).toBe(1);
    expect(atlas.iteracion).toBe(2);
    expect(atlas.fecha).toBe(T0 + 2 * HORA);
    expect(atlas.iteracionMax).toBe(3);
  });

  it('las etiquetas y definiciones del mapa mandan; las de reserva cubren el resto', () => {
    expect(atlas.regiones.find((r) => r.clave === 'plasma')!.etiqueta).toBe('sangre (etiqueta del backend)');
    expect(atlas.regiones.find((r) => r.clave === 'hipocampo')!.etiqueta).toBe('hipocampo');
    expect(atlas.definiciones.estadio!.preclinica).toBe('definición del backend');
    expect(atlas.definiciones.estadio!.prodromica_dcl).toBe('deterioro cognitivo leve, síntomas sin demencia');
    expect(atlas.definiciones.region!.hipocampo).toBe(DEFINICIONES_REGION.hipocampo);
    expect(atlas.definiciones.tipoCelular!.microglia).toBe(DEFINICIONES_CELULA.microglia);
    expect(atlas.definiciones.nivel!.molecular).toBe('genes, proteínas, biomarcadores y metabolitos');
  });

  it('conserva al final una región que el backend añadiera después, sin perder sus registros', () => {
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ estadio: null, region: 'medula_espinal', tipoCelular: null, hechos: ['he-viejo'] }));
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    const a2 = construirAtlas(e2, i2)!;
    expect(a2.regiones.length).toBe(REGIONES_CLAVES.length + 1);
    // La clave se enseña en legible (sin guiones bajos) y la definición dice que es nueva.
    expect(a2.regiones.at(-1)).toMatchObject({ clave: 'medula_espinal', conteo: 1, etiqueta: 'medula espinal', sinResolver: 0 });
    expect(a2.regiones.at(-1)!.definicion).toMatch(/nueva del backend/);
    // Un hueco sobre esa región también sale legible.
    const conHueco = { ...mapa, huecos: [{ estadio: null, region: 'medula_espinal', tipoCelular: 'celula_rara', motivo: '', heredanDeMision: 0 }] };
    const { estado: e3, inv: i3 } = estadoDePrueba(conHueco);
    expect(construirAtlas(e3, i3)!.huecos[0]).toMatch(/^medula espinal · celula rara: /);
  });

  it('un mapa sin fecha no tiene iteración seguida ni hechos nuevos: no se inventan', () => {
    const { estado: e2, inv: i2 } = estadoDePrueba({ ...mapaDePrueba(), fecha: undefined, iteracion: undefined });
    const a2 = construirAtlas(e2, i2)!;
    expect(a2.iteracion).toBeNull();
    expect(a2.iteracionOrdinal).toBeNull();
    expect(a2.fecha).toBeNull();
    expect(a2.hechosNuevos).toBe(0);
  });

  it('no rompe con celdas a medias ni con cifras que no son números', () => {
    const roto = { ...mapaDePrueba(), celdas: [{ region: 'hipocampo' } as unknown as CeldaMapa, null as unknown as CeldaMapa, celda({ region: 'lcr', hechos: ['he-viejo', 3 as unknown as string] })], sinEjes: 'muchos' as unknown as number, resumen: 4 as unknown as string, huecos: [null as unknown as MapaEnfermedad['huecos'][number]] };
    const { estado: e2, inv: i2 } = estadoDePrueba(roto);
    const a2 = construirAtlas(e2, i2)!;
    expect(a2.regiones.find((r) => r.clave === 'hipocampo')!.conteo).toBe(0);
    expect(a2.regiones.find((r) => r.clave === 'lcr')!.conteo).toBe(1);
    expect(a2.sinEjes).toBe(0);
    expect(a2.resumen).toBe('1 hecho y 0 hipótesis situados en 1 celda (estadio, región y tipo celular). Regiones: líquido cefalorraquídeo (LCR) 1.');
    expect(a2.resumenGuardado).toBe('');
    expect(a2.huecos).toEqual([]);
  });
});

describe('la intensidad de color', () => {
  it('es 0 sin evidencia, 1 en el máximo y crece con el conteo', () => {
    expect(intensidad(0, 104)).toBe(0);
    expect(intensidad(104, 104)).toBe(1);
    expect(intensidad(200, 104)).toBe(1);
    let anterior = 0;
    for (let n = 1; n <= 104; n++) {
      const v = intensidad(n, 104);
      expect(v).toBeGreaterThan(anterior);
      expect(v).toBeLessThanOrEqual(1);
      anterior = v;
    }
  });

  it('es logarítmica: con poco ya se ve algo', () => {
    // En escala lineal 2 de 104 sería 0,02 (invisible); en logarítmica pasa de 0,2.
    expect(intensidad(2, 104)).toBeGreaterThan(0.2);
    expect(intensidad(2, 104)).toBeLessThan(0.5);
  });

  it('no se rompe con un máximo cero, negativo o no numérico', () => {
    expect(intensidad(3, 0)).toBe(0);
    expect(intensidad(3, -1)).toBe(0);
    expect(intensidad(Number.NaN, 5)).toBe(0);
    expect(intensidad(3, Number.NaN)).toBe(0);
  });
});

describe('los filtros del atlas', () => {
  const { estado, inv } = estadoDePrueba(mapaDePrueba());
  const region = (clave: string, filtros?: Parameters<typeof construirAtlas>[2]) => construirAtlas(estado, inv, filtros)!.regiones.find((r) => r.clave === clave)!;

  it('por fase: cambian los conteos y las regiones vacías siguen presentes con 0', () => {
    const a = construirAtlas(estado, inv, { estadio: 'preclinica' })!;
    expect(a.regiones.map((r) => r.clave)).toEqual(REGIONES_CLAVES);
    expect(region('hipocampo', { estadio: 'preclinica' })).toMatchObject({ conteo: 4, certezaMax: 'baja', porEstadio: { preclinica: 4 } });
    expect(region('plasma', { estadio: 'preclinica' }).conteo).toBe(0);
    expect(region('hipocampo', { estadio: 'prodromica_dcl' })).toMatchObject({ conteo: 3, certezaMax: 'moderada' });
    // La fase ausente también se puede pedir.
    expect(region('plasma', { estadio: SIN_FASE }).conteo).toBe(1);
    expect(region('hipocampo', { estadio: SIN_FASE }).conteo).toBe(0);
    // Una fase que no casa deja todo a cero, sin romper.
    expect(construirAtlas(estado, inv, { estadio: 'inventada' })!.maximo).toBe(0);
    expect(a.maximo).toBe(4);
  });

  it('por célula: unión de los tipos pedidos; vacío es todos; "sin célula" se puede pedir', () => {
    expect(region('hipocampo', { celulas: ['microglia'] }).conteo).toBe(0);
    expect(region('plasma', { celulas: ['microglia'] }).conteo).toBe(1);
    expect(region('hipocampo', { celulas: ['astrocito', 'microglia'] }).conteo).toBe(4);
    expect(region('hipocampo', { celulas: [] }).conteo).toBe(6);
    expect(region('plasma', { celulas: ['neurona'] }).conteo).toBe(0);
    // Solo lo que no habla de una célula concreta: la celda 2 del hipocampo y la celda sin región.
    const soloSinCelula = construirAtlas(estado, inv, { celulas: [SIN_CELULA] })!;
    expect(soloSinCelula.regiones.find((r) => r.clave === 'hipocampo')!.conteo).toBe(3);
    expect(soloSinCelula.regiones.find((r) => r.clave === 'plasma')!.conteo).toBe(0);
    expect(soloSinCelula.sinRegion).toBe(1);
    // Con una célula y "sin célula" a la vez: unión.
    expect(region('hipocampo', { celulas: [SIN_CELULA, 'astrocito'] }).conteo).toBe(6);
  });

  it('los chips no cambian al filtrar por la otra dimensión', () => {
    const a = construirAtlas(estado, inv, { estadio: 'preclinica', celulas: ['microglia'] })!;
    expect(a.estadios.map((e) => e.conteo)).toEqual([5, 3, 1]);
    expect(a.celulas.map((c) => c.conteo)).toEqual([4, 1, 3]);
  });

  it('la certeza de una región es la viva de sus hipótesis, y volver al presente nunca la baja', () => {
    // hip-a subió a 'moderada' después de que el backend guardara la celda con 'baja'.
    const { estado: e2, inv: i2 } = estadoDePrueba(mapaDePrueba());
    const subida: EstadoRosa = { ...e2, hipotesis: e2.hipotesis.map((h) => (h.id === 'hip-a' ? { ...h, conclusion: { ...h.conclusion!, certeza: 'moderada' as const } } : h)) };
    const hipocampo = (filtros?: Parameters<typeof construirAtlas>[2]) => construirAtlas(subida, i2, filtros)!.regiones.find((r) => r.clave === 'hipocampo')!;
    expect(hipocampo({ estadio: 'preclinica' }).certezaMax).toBe('moderada');
    expect(hipocampo({ estadio: 'preclinica', hasta: 1 }).certezaMax).toBe('moderada');
    // Y si la ficha perdió la conclusión, el atlas tampoco la inventa desde la instantánea.
    const sinConclusion: EstadoRosa = { ...e2, hipotesis: e2.hipotesis.map((h) => (h.id === 'hip-a' ? { ...h, conclusion: null } : h)) };
    expect(construirAtlas(sinConclusion, i2, { estadio: 'preclinica' })!.regiones.find((r) => r.clave === 'hipocampo')!.certezaMax).toBeNull();
  });

  it('la instantánea del backend solo vale cuando ninguna hipótesis de la celda está en el estado', () => {
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ estadio: 'demencia_leve', region: 'lcr', hipotesis: ['hip-desaparecida'], certezaMax: 'alta' }));
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    const lcr = construirAtlas(e2, i2)!.regiones.find((r) => r.clave === 'lcr')!;
    expect(lcr.certezaMax).toBe('alta');
    expect(lcr.sinResolver).toBe(1);
    // Con una certeza que no es un nivel GRADE, nada.
    mapa.celdas[mapa.celdas.length - 1]!.certezaMax = 'altisima' as unknown as CeldaMapa['certezaMax'];
    expect(construirAtlas(e2, { ...i2, mapaEnfermedad: mapa })!.regiones.find((r) => r.clave === 'lcr')!.certezaMax).toBeNull();
  });

  it('hasta la iteración N: las preguntas se recortan por su fecha igual que los hechos', () => {
    const mapa = mapaDePrueba();
    mapa.celdas[0]!.preguntas = ['pr-1', 'pr-tardia'];
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    const tardia: HechoMundo = { ...e2.hechos[0]!, id: 'pr-tardia', tipo: 'pregunta', actualizadoEn: T0 + 2 * HORA + 30, historial: [{ fecha: T0 + 2 * HORA + 30, de: null, a: 'abierto', quien: 'Rosa', motivo: '' }] };
    const estado2: EstadoRosa = { ...e2, hechos: [...e2.hechos, tardia] };
    // pr-1 no está en el estado: se lista siempre. pr-tardia nació en la 3.
    expect(construirAtlas(estado2, i2, { hasta: 1 })!.regiones.find((r) => r.clave === 'hipocampo')!.preguntas).toEqual(['pr-1']);
    expect(construirAtlas(estado2, i2)!.regiones.find((r) => r.clave === 'hipocampo')!.preguntas.sort()).toEqual(['pr-1', 'pr-tardia']);
  });

  it('cuenta los hechos vivos nacidos después del mapa que aún no están en él', () => {
    const { estado: e2, inv: i2 } = estadoDePrueba(mapaDePrueba());
    const despues = T0 + 2 * HORA + 50;
    const posterior = (id: string, parte: Partial<HechoMundo>): HechoMundo => ({ ...e2.hechos[0]!, id, investigacionId: i2.id, tipo: 'hecho', estado: 'sabido', sustituidoPor: null, actualizadoEn: despues, historial: [{ fecha: despues, de: null, a: 'sabido', quien: 'Rosa', motivo: '' }], ...parte });
    const estado2: EstadoRosa = {
      ...e2,
      hechos: [
        ...e2.hechos,
        posterior('he-posterior', {}),
        posterior('he-posterior-2', { historial: [], actualizadoEn: despues }),
        // Ninguno de estos cuenta: pregunta, descartado, sustituido, de otra investigación, o ya en el mapa.
        posterior('pr-posterior', { tipo: 'pregunta' }),
        posterior('he-descartado', { estado: 'descartado' }),
        posterior('he-sustituido', { sustituidoPor: 'he-posterior' }),
        posterior('he-ajeno', { investigacionId: 'otra' }),
        posterior('he-fantasma', {}),
      ],
    };
    expect(construirAtlas(estado2, i2)!.hechosNuevos).toBe(2);
    // El deslizador no cambia la cifra: habla del presente frente a la instantánea.
    expect(construirAtlas(estado2, i2, { hasta: 1 })!.hechosNuevos).toBe(2);
  });

  it('hasta la iteración N: los hechos nacidos después no cuentan; los sin fecha y los que no están en el estado, siempre', () => {
    // Iteración 1: he-viejo (nació en la 1), he-fantasma (no está en el estado) y
    // he-sinfecha cuentan; he-nuevo (nació en la 2) no; hip-a sí, hip-b (iteración 3) no.
    const h1 = region('hipocampo', { hasta: 1 });
    expect(h1.hechos.sort()).toEqual(['he-fantasma', 'he-sinfecha', 'he-viejo']);
    expect(h1.hipotesis).toEqual(['hip-a']);
    expect(h1.conteo).toBe(4);
    expect(region('plasma', { hasta: 1 }).conteo).toBe(0);
    // Iteración 2: entra he-nuevo.
    expect(region('hipocampo', { hasta: 2 }).conteo).toBe(5);
    expect(region('plasma', { hasta: 2 }).conteo).toBe(1);
    // La última iteración, o una que se pasa, es el presente.
    expect(region('hipocampo', { hasta: 3 }).conteo).toBe(6);
    expect(region('hipocampo', { hasta: 99 }).conteo).toBe(6);
    expect(region('hipocampo', { hasta: null }).conteo).toBe(6);
  });

  it('hasta la iteración N: la certeza es la de las hipótesis que ya existían y el máximo no se reescala', () => {
    const a1 = construirAtlas(estado, inv, { hasta: 1 })!;
    expect(a1.regiones.find((r) => r.clave === 'hipocampo')!.certezaMax).toBe('baja');
    expect(a1.maximo).toBe(6);
    // Preclínica: he-viejo, he-fantasma, hip-a (celda 1) y he-sinfecha (celda sin región); he-nuevo aún no.
    expect(a1.estadios.map((e) => e.conteo)).toEqual([4, 2, 0]);
    expect(a1.sinRegion).toBe(1);
    // Con la iteración 0 solo quedan los que no se pueden fechar.
    const a0 = construirAtlas(estado, inv, { hasta: 0 })!;
    expect(a0.regiones.find((r) => r.clave === 'hipocampo')!.hechos.sort()).toEqual(['he-fantasma', 'he-sinfecha']);
    expect(a0.regiones.find((r) => r.clave === 'hipocampo')!.certezaMax).toBeNull();
  });

  it('usa la numeración seguida cuando hay varias corridas', () => {
    // Una segunda corrida con su iteración 1 empieza después: su ordinal es 4, no 1.
    const { estado: e2, inv: i2 } = estadoDePrueba(mapaDePrueba());
    const corridaB: Corrida = { ...e2.corridas[0]!, id: 'cor-b', empezadaEn: T0 + 5 * HORA, terminadaEn: null };
    const itB: Iteracion = { ...e2.iteraciones[0]!, id: 'it-b1', corridaId: 'cor-b', numero: 1, empezadaEn: T0 + 5 * HORA, terminadaEn: null };
    const hechoTardio: HechoMundo = { ...e2.hechos[0]!, id: 'he-tardio', actualizadoEn: T0 + 5 * HORA + 10, historial: [{ fecha: T0 + 5 * HORA + 10, de: null, a: 'sabido', quien: 'Rosa', motivo: '' }] };
    const estado2: EstadoRosa = { ...e2, corridas: [...e2.corridas, corridaB], iteraciones: [{ ...e2.iteraciones[2]!, terminadaEn: T0 + 3 * HORA }, e2.iteraciones[0]!, e2.iteraciones[1]!, itB], hechos: [...e2.hechos, hechoTardio] };
    const mapa = mapaDePrueba();
    mapa.celdas[2]!.hechos.push('he-tardio');
    const inv2: Investigacion = { ...i2, mapaEnfermedad: mapa };
    const a = construirAtlas(estado2, inv2)!;
    expect(a.iteracionMax).toBe(4);
    expect(construirAtlas(estado2, inv2, { hasta: 3 })!.regiones.find((r) => r.clave === 'plasma')!.hechos).toEqual(['he-nuevo']);
    expect(construirAtlas(estado2, inv2, { hasta: 4 })!.regiones.find((r) => r.clave === 'plasma')!.hechos.sort()).toEqual(['he-nuevo', 'he-tardio']);
    // Un mapa calculado en la iteración 1 de la segunda corrida: el backend
    // anota 1, pero en la numeración del deslizador es la 4 de 4.
    const inv3: Investigacion = { ...inv2, mapaEnfermedad: { ...mapa, fecha: T0 + 5 * HORA + 30 * 60_000, iteracion: 1 } };
    const a3 = construirAtlas(estado2, inv3)!;
    expect(a3.iteracion).toBe(1);
    expect(a3.iteracionOrdinal).toBe(4);
    // Y un mapa fechado en el hueco entre las dos corridas cae en la última iteración cerrada.
    const inv4: Investigacion = { ...inv2, mapaEnfermedad: { ...mapa, fecha: T0 + 4 * HORA, iteracion: 3 } };
    expect(construirAtlas(estado2, inv4)!.iteracionOrdinal).toBe(3);
  });
});

describe('resolver ids', () => {
  const { estado } = estadoDePrueba(mapaDePrueba());

  it('devuelve los hechos que existen, en orden y sin repetir; los que no, se ignoran', () => {
    const hs = hechosDe(estado, ['he-nuevo', 'he-fantasma', 'he-viejo', 'he-nuevo']);
    expect(hs.map((h) => h.id)).toEqual(['he-nuevo', 'he-viejo']);
    expect(hechosDe(estado, [])).toEqual([]);
    expect(hechosDe(estado, ['nada', 'tampoco'])).toEqual([]);
    expect(hechosDe(estado, [undefined as unknown as string, 5 as unknown as string])).toEqual([]);
  });

  it('lo mismo con las hipótesis', () => {
    expect(hipotesisDe(estado, ['hip-b', 'hip-x', 'hip-a']).map((h) => h.id)).toEqual(['hip-b', 'hip-a']);
    expect(hipotesisDe(estado, ['hip-x'])).toEqual([]);
  });

  it('no rompe con un estado sin listas', () => {
    const sin = { ...estado, hechos: undefined as unknown as HechoMundo[], hipotesis: undefined as unknown as Hipotesis[] };
    expect(hechosDe(sin, ['he-viejo'])).toEqual([]);
    expect(hipotesisDe(sin, ['hip-a'])).toEqual([]);
  });
});

describe('las claves coinciden con rosa/mapa_enfermedad.py', () => {
  const fuente = readFileSync(resolve(__dirname, '../../../rosa/mapa_enfermedad.py'), 'utf8');

  /** Las claves de una tupla de tuplas de varias líneas: cada entrada empieza
   *  por `("clave",` en su propia línea, hasta el paréntesis de cierre en la
   *  columna cero. */
  function clavesDeTuplaMultilinea(nombre: string): string[] {
    const inicio = fuente.search(new RegExp(`^${nombre}\\b[^\\n]*=\\s*\\($`, 'm'));
    expect(inicio, `no se encontró ${nombre} en el fichero`).toBeGreaterThanOrEqual(0);
    const cuerpo = fuente.slice(inicio).split('\n').slice(1);
    const claves: string[] = [];
    for (const linea of cuerpo) {
      if (/^\)/.test(linea)) break;
      const m = /^\s*\("([a-z_]+)",/.exec(linea);
      if (m) claves.push(m[1]!);
    }
    return claves;
  }

  /** Las claves de una tupla de textos en una sola línea: NOMBRE = ("a", "b"). */
  function clavesDeTuplaLinea(nombre: string): string[] {
    const m = new RegExp(`^${nombre}\\s*=\\s*\\(([^\\n]*)\\)\\s*$`, 'm').exec(fuente);
    expect(m, `no se encontró ${nombre} en el fichero`).not.toBeNull();
    return [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
  }

  it('REGIONES_CLAVES es la lista del backend, en el mismo orden', () => {
    const backend = clavesDeTuplaMultilinea('REGIONES');
    expect(backend.length).toBe(20);
    expect(REGIONES_CLAVES).toEqual(backend);
  });

  it('REGIONES_PATRONES son las expresiones regulares del backend, carácter a carácter, y compilan en JavaScript', () => {
    // La tercera columna de cada tupla de REGIONES: ("clave", "etiqueta", r"patrón", frozenset(...)).
    const inicio = fuente.search(/^REGIONES\b[^\n]*=\s*\($/m);
    expect(inicio).toBeGreaterThanOrEqual(0);
    const patrones: Record<string, string> = {};
    for (const linea of fuente.slice(inicio).split('\n').slice(1)) {
      if (/^\)/.test(linea)) break;
      const m = /^\s*\("([a-z_]+)",\s*"[^"]*",\s*r"([^"]*)",/.exec(linea);
      if (m) patrones[m[1]!] = m[2]!;
    }
    expect(Object.keys(patrones)).toEqual(REGIONES_CLAVES);
    expect(REGIONES_PATRONES).toEqual(patrones);
    for (const [clave, patron] of Object.entries(REGIONES_PATRONES)) expect(() => new RegExp(patron), clave).not.toThrow();
  });

  it('las fases y los tipos de célula también', () => {
    expect(ESTADIOS_CLAVES).toEqual(clavesDeTuplaLinea('ESTADIOS'));
    expect(CELULAS_CLAVES).toEqual(clavesDeTuplaMultilinea('TIPOS_CELULARES'));
  });

  it('cada clave tiene etiqueta de reserva y definición en llano', () => {
    for (const r of REGIONES_CLAVES) {
      expect(ETIQUETAS_MAPA.region[r], r).toBeTruthy();
      expect(DEFINICIONES_REGION[r], r).toBeTruthy();
    }
    for (const c of CELULAS_CLAVES) {
      expect(ETIQUETAS_MAPA.tipoCelular[c], c).toBeTruthy();
      expect(DEFINICIONES_CELULA[c], c).toBeTruthy();
    }
    for (const e of ESTADIOS_CLAVES) expect(ETIQUETAS_MAPA.estadio[e], e).toBeTruthy();
    // Ni una clave de más en las tablas de reserva.
    expect(Object.keys(DEFINICIONES_REGION).sort()).toEqual([...REGIONES_CLAVES].sort());
    expect(Object.keys(DEFINICIONES_CELULA).sort()).toEqual([...CELULAS_CLAVES].sort());
  });

  it('las definiciones en llano llevan sus tildes y no usan guiones largos', () => {
    const textos = [...Object.values(DEFINICIONES_REGION), ...Object.values(DEFINICIONES_CELULA)];
    for (const t of textos) {
      expect(t).not.toContain('\u2014');
      expect(t).not.toMatch(/\b(region|celula|celulas|informacion|funcion|atrofia\b.*\bregion)\b/);
    }
  });
});

describe('nombrar una regi\u00f3n en un texto, como el backend', () => {
  it('normalizar: min\u00fasculas, sin tildes ni e\u00f1es, guiones tipogr\u00e1ficos a "-", misma longitud', () => {
    expect(normalizar('Am\u00edgdala\u2013hipocampo \u2265 3, se\u00f1al')).toBe('amigdala-hipocampo \u2265 3, senal');
    expect(normalizar('Am\u00edgdala\u2013hipocampo \u2265 3, se\u00f1al').length).toBe('Am\u00edgdala\u2013hipocampo \u2265 3, se\u00f1al'.length);
    expect(normalizar('\u00c1\u00c9\u00cd\u00d3\u00da \u00d1 \u00fc')).toBe('aeiou n u');
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
    expect(normalizar(42)).toBe('42');
  });

  it('regionesEnTexto: las mismas reglas que rosa/mapa_enfermedad.py, incluidas las gen\u00e9ricas que ceden', () => {
    expect(regionesEnTexto('Atrofia del HIPOCAMPO en la resonancia')).toEqual(['hipocampo']);
    expect(regionesEnTexto('hippocampal atrophy and entorhinal thinning')).toEqual(['hipocampo', 'corteza_entorrinal']);
    // "cerebro" y "corteza" a secas ceden ante una regi\u00f3n concreta; "cerebro" cede tambi\u00e9n ante "corteza".
    expect(regionesEnTexto('atrofia del hipocampo y del cerebro')).toEqual(['hipocampo']);
    expect(regionesEnTexto('cerebral cortex and whole brain')).toEqual(['neocorteza']);
    expect(regionesEnTexto('whole-brain volume')).toEqual(['cerebro_sin_region']);
    // Pero no ceden ante un compartimento perif\u00e9rico.
    expect(regionesEnTexto('GFAP en plasma refleja da\u00f1o cerebral')).toEqual(['plasma', 'cerebro_sin_region']);
    // Las exclusiones del patr\u00f3n de plasma y de sangre.
    expect(regionesEnTexto('membrana plasm\u00e1tica de la neurona')).toEqual([]);
    expect(regionesEnTexto('blood-brain barrier leakage')).toEqual(['vascular_bhe']);
    expect(regionesEnTexto('cerebral blood flow')).toEqual(['cerebro_sin_region']);
    expect(regionesEnTexto('peripheral blood mononuclear cells')).toEqual(['plasma']);
    // Hipot\u00e1lamo no es t\u00e1lamo.
    expect(regionesEnTexto('hypothalamus and hipot\u00e1lamo')).toEqual([]);
    expect(regionesEnTexto('thalamus')).toEqual(['ganglios_basales_talamo']);
    expect(regionesEnTexto('L\u00edquido cefalorraqu\u00eddeo y punci\u00f3n lumbar')).toEqual(['lcr']);
    expect(regionesEnTexto('gut microbiome')).toEqual(['intestino_microbiota']);
    expect(regionesEnTexto('')).toEqual([]);
    expect(regionesEnTexto('   ')).toEqual([]);
    expect(regionesEnTexto(null)).toEqual([]);
    expect(regionesEnTexto({ a: 1 })).toEqual([]);
    expect(regionesEnTexto('p-tau217 y GFAP')).toEqual([]);
  });
});

describe('los ajustes del 18 de septiembre: cohortes, bandeja, l\u00ednea honesta, discordia y cobertura', () => {
  it('las cohortes de una regi\u00f3n salen solo de las celdas que aportan alg\u00fan registro, y los extremos de la rampa son reales', () => {
    const { estado, inv } = estadoDePrueba(mapaDePrueba());
    const a = construirAtlas(estado, inv)!;
    const hipocampo = a.regiones.find((r) => r.clave === 'hipocampo')!;
    expect(hipocampo.cohortes).toEqual(['ADNI', 'DIAN']);
    expect(a.regiones.find((r) => r.clave === 'plasma')!.cohortes).toEqual([]);
    // Extremos entre las regiones localizadas con registros: hipocampo 2, plasma 0.
    expect(a.cohortesMax).toBe(2);
    expect(a.cohortesMin).toBe(0);
    // Con la fase precl\u00ednica solo aporta la celda 1 del hipocampo (ADNI) y plasma se queda sin registros.
    const pre = construirAtlas(estado, inv, { estadio: 'preclinica' })!;
    expect(pre.regiones.find((r) => r.clave === 'hipocampo')!.cohortes).toEqual(['ADNI']);
    expect(pre.cohortesMax).toBe(1);
    expect(pre.cohortesMin).toBe(1);
    // Una celda con cohortes pero sin registros no sostiene nada.
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ region: 'plasma', cohortes: ['FANTASMA'] }));
    // Y una celda cuyos registros a\u00fan no exist\u00edan en la iteraci\u00f3n pedida tampoco aporta sus cohortes, aunque s\u00ed al m\u00e1ximo de la rampa.
    mapa.celdas.push(celda({ region: 'plasma', hechos: ['he-nuevo'], cohortes: ['TARDIA'] }));
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    expect(construirAtlas(e2, i2)!.regiones.find((r) => r.clave === 'plasma')!.cohortes).toEqual(['TARDIA']);
    const a1 = construirAtlas(e2, i2, { hasta: 1 })!;
    expect(a1.regiones.find((r) => r.clave === 'plasma')!.cohortes).toEqual([]);
    expect(a1.cohortesMax).toBe(2);
    expect(a1.cohortesMin).toBe(1);
    // Sin ninguna regi\u00f3n localizada con registros, los extremos valen 0.
    expect(construirAtlas(estado, inv, { estadio: 'inventada' })!.cohortesMax).toBe(0);
    expect(construirAtlas(estado, inv, { estadio: 'inventada' })!.cohortesMin).toBe(0);
    // Las cohortes de la bandeja no entran en la rampa.
    const m3 = mapaDePrueba();
    m3.celdas.push(celda({ region: 'cerebro_sin_region', hechos: ['he-viejo'], cohortes: ['A', 'B', 'C', 'D', 'E'] }));
    const { estado: e3, inv: i3 } = estadoDePrueba(m3);
    expect(construirAtlas(e3, i3)!.cohortesMax).toBe(2);
  });

  it('la bandeja "No localizados" y la l\u00ednea honesta cuadran con las regiones', () => {
    expect([...NO_LOCALIZADAS].sort()).toEqual(['cerebro_sin_region', 'neocorteza']);
    expect([...FLUIDOS].sort()).toEqual(['lcr', 'plasma']);
    const { estado, inv } = estadoDePrueba(mapaDePrueba());
    const a = construirAtlas(estado, inv)!;
    expect(a.noLocalizados).toEqual({ conteo: 0, hechos: 0, hipotesis: 0, tambienSituados: 0 });
    // Fluidos: he-nuevo (plasma). Tejido: los 6 del hipocampo. he-nuevo est\u00e1 en los dos. Nada sin localizar: he-sinfecha (celda sin regi\u00f3n) tambi\u00e9n est\u00e1 en el hipocampo.
    expect(a.fluidos).toBe(1);
    expect(a.tejido).toBe(6);
    expect(a.enAmbos).toBe(1);
    expect(a.sinLocalizar).toBe(0);
    expect(a.discordantes).toBe(0);
    // Con registros en las dos claves gen\u00e9ricas, uno repetido entre ellas y dos que adem\u00e1s est\u00e1n en el hipocampo.
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ region: 'cerebro_sin_region', hechos: ['he-viejo', 'he-x'], hipotesis: ['hip-a'] }), celda({ region: 'neocorteza', hechos: ['he-x'], hipotesis: ['hip-x'] }));
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    const b = construirAtlas(e2, i2)!;
    // Las veinte regiones siguen ah\u00ed, en su orden, con las gen\u00e9ricas al final y sus conteos.
    expect(b.regiones.map((r) => r.clave)).toEqual(REGIONES_CLAVES);
    expect(b.regiones.find((r) => r.clave === 'cerebro_sin_region')!.conteo).toBe(3);
    expect(b.regiones.find((r) => r.clave === 'neocorteza')!.conteo).toBe(2);
    expect(b.noLocalizados).toEqual({ conteo: 4, hechos: 2, hipotesis: 2, tambienSituados: 2 });
    expect(b.sinLocalizar).toBe(2);
    expect(b.tejido).toBe(6);
    // Los filtros recortan la bandeja igual que a las regiones.
    expect(construirAtlas(e2, i2, { estadio: 'preclinica' })!.noLocalizados.conteo).toBe(0);
    // Y una celda sin regi\u00f3n con un registro que no est\u00e1 en ninguna regi\u00f3n cuenta como sin localizar.
    mapa.celdas.push(celda({ estadio: 'demencia_leve', hechos: ['he-solo'] }));
    const c = construirAtlas(estadoDePrueba(mapa).estado, estadoDePrueba(mapa).inv)!;
    expect(c.sinRegion).toBe(2);
    expect(c.sinLocalizar).toBe(3);
  });

  it('la discordia sale de contradiceA, no de las citas, y respeta el deslizador', () => {
    const { estado, inv } = estadoDePrueba(mapaDePrueba());
    const conChoque: EstadoRosa = { ...estado, hechos: estado.hechos.map((h) => (h.id === 'he-viejo' ? { ...h, contradiceA: ['he-nuevo'] } : h.id === 'he-nuevo' ? { ...h, citas: [{ referencia: 'X', seccion: 's', clasificacion: 'contrasta' as const, fragmento: 'f' }] } : h)) };
    const a = construirAtlas(conChoque, inv)!;
    expect(a.regiones.find((r) => r.clave === 'hipocampo')!.discordia).toEqual(['he-viejo']);
    // he-nuevo solo tiene una cita "contrasta": no es discordia.
    expect(a.regiones.find((r) => r.clave === 'plasma')!.discordia).toEqual([]);
    expect(a.discordantes).toBe(1);
    // En la iteraci\u00f3n 0 he-viejo a\u00fan no exist\u00eda.
    expect(construirAtlas(conChoque, inv, { hasta: 0 })!.regiones.find((r) => r.clave === 'hipocampo')!.discordia).toEqual([]);
    // contradiceA vac\u00edo, con basura, o un hecho que no est\u00e1 en el estado: nada.
    const sinChoque: EstadoRosa = { ...estado, hechos: estado.hechos.map((h) => (h.id === 'he-viejo' ? { ...h, contradiceA: ['', 3 as unknown as string] } : h)) };
    expect(construirAtlas(sinChoque, inv)!.discordantes).toBe(0);
    // Un choque solo en la bandeja no cuenta en la figura, pero la regi\u00f3n lo lista.
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ region: 'neocorteza', hechos: ['he-choca'] }));
    const { estado: e2, inv: i2 } = estadoDePrueba(mapa);
    const e3: EstadoRosa = { ...e2, hechos: [...e2.hechos, { ...e2.hechos[0]!, id: 'he-choca', contradiceA: ['he-viejo'] }] };
    const b = construirAtlas(e3, i2)!;
    expect(b.regiones.find((r) => r.clave === 'neocorteza')!.discordia).toEqual(['he-choca']);
    expect(b.discordantes).toBe(0);
  });

  it('la cobertura de un hueco: no buscada, o buscada sin hallazgo por consultas, fuentes (sin repetir) o preguntas abiertas', () => {
    const { estado, inv } = estadoDePrueba(mapaDePrueba());
    const corrida = estado.corridas[0]!;
    const fuente = (id: string, titulo: string, fragmento = ''): Fuente => ({ ...estado.hipotesis[0]!.procedencia.fuentes[0]!, id, titulo, fragmento, doi: null });
    const conMenciones: EstadoRosa = {
      ...estado,
      corridas: [
        { ...corrida, busqueda: { ...corrida.busqueda, consultas: [{ base: 'PubMed', consulta: 'hippocampal atrophy', fecha: T0, resultados: 3 }, { base: 'PubMed', consulta: 'tau PET', fecha: T0, resultados: 3, ...({ tema: 'Hipocampo y tau' } as object) }], excluidos: [{ referencia: 'Ojo, 2025', titulo: 'Retinal thinning in preclinical AD', relevancia: 0.1, motivo: 'fuera', iteracion: 1, consulta: 'x' }] } },
        // Una corrida de OTRA investigaci\u00f3n que nombra la am\u00edgdala: no cuenta.
        { ...corrida, id: 'cor-ajena', investigacionId: 'otra', busqueda: { ...corrida.busqueda, consultas: [{ base: 'PubMed', consulta: 'amygdala volume', fecha: T0, resultados: 1 }] } },
        // Y una corrida sin b\u00fasqueda no rompe.
        { ...corrida, id: 'cor-rota', busqueda: undefined as unknown as Corrida['busqueda'] },
      ],
      hipotesis: estado.hipotesis.map((h) => ({ ...h, procedencia: { ...h.procedencia, fuentes: [fuente('f-cerebelo', 'Cerebellar reference region', 'the cerebellum'), fuente('f-plasma', 'Plasma p-tau217')] } })),
      hechos: estado.hechos.map((h) => (h.id === 'he-viejo' ? { ...h, procedencia: [{ fuenteId: 'f-olfato', referencia: 'Olfactory bulb tau, 2024', pagina: null }, { fuenteId: 'f-olfato', referencia: 'Olfactory bulb tau, 2024', pagina: 2 }] } : h)),
    };
    const mapa = mapaDePrueba();
    mapa.celdas.push(celda({ region: 'amigdala', preguntas: ['pr-1'] }));
    const a = construirAtlas(conMenciones, { ...inv, mapaEnfermedad: mapa })!;
    const r = (clave: string) => a.regiones.find((x) => x.clave === clave)!;
    // Con registros: con evidencia, aunque tambi\u00e9n la nombren dos consultas.
    expect(r('hipocampo').cobertura).toBe('con_evidencia');
    expect(r('hipocampo').menciones).toEqual({ consultas: 2, fuentes: 0 });
    // La fuente excluida en el cribado nombra la retina.
    expect(r('retina')).toMatchObject({ cobertura: 'buscada_sin_hallazgo', menciones: { consultas: 0, fuentes: 1 } });
    // La misma fuente citada por las dos hip\u00f3tesis cuenta una vez.
    expect(r('cerebelo')).toMatchObject({ cobertura: 'buscada_sin_hallazgo', menciones: { consultas: 0, fuentes: 1 } });
    // La referencia de la procedencia de un hecho, repetida, cuenta una vez.
    expect(r('bulbo_olfatorio')).toMatchObject({ cobertura: 'buscada_sin_hallazgo', menciones: { consultas: 0, fuentes: 1 } });
    // Una pregunta abierta situada ah\u00ed tambi\u00e9n es "buscada".
    expect(r('amigdala')).toMatchObject({ cobertura: 'buscada_sin_hallazgo', menciones: { consultas: 0, fuentes: 0 }, conteo: 0 });
    // Nadie nombr\u00f3 el tronco.
    expect(r('tronco_locus_coeruleus')).toMatchObject({ cobertura: 'no_buscada', menciones: { consultas: 0, fuentes: 0 } });
    // Sin corridas ni procedencias: todo lo vac\u00edo es no buscado, sin romper.
    const pelado: EstadoRosa = { ...estado, corridas: [], hipotesis: estado.hipotesis.map((h) => ({ ...h, procedencia: undefined as unknown as Hipotesis['procedencia'] })), hechos: estado.hechos.map((h) => ({ ...h, procedencia: undefined as unknown as HechoMundo['procedencia'] })) };
    const b = construirAtlas(pelado, inv)!;
    expect(b.regiones.filter((x) => x.conteo === 0).every((x) => x.cobertura === 'no_buscada')).toBe(true);
    expect(b.iteracionMax).toBeGreaterThanOrEqual(1);
  });
});
