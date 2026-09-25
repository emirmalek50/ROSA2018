// Los componentes del ranking leídos del estado (lib/ranking.ts): nunca
// lanzan, con o sin conclusión, con registros antiguos a los que les faltan
// listas, con ids heredados (sufijo -inv-), con textos en inglés y en
// castellano, y con valores que esta interfaz no conoce. Los recuentos espejan
// la regla de rosa/certeza.py (apoyos, contras, socavan) y la frase en llano
// sale de la escalera, de `subiria` y de `bajaria`, con tildes y sin guiones
// largos.
import { describe, expect, it } from 'vitest';
import { estadoDeMuestra } from '../datos/muestra';
import type { Afirmacion, ConclusionHipotesis, Hipotesis } from '../datos/tipos';
import { cohortesDe } from './priorizacion';
import { cohortesConNombre, componentesDe, novedadDe, queCambiariaElOrden, recuentoEvidencia } from './ranking';

const SIN_TILDE = /\b(hipotesis|conclusion|iteracion|todavia|segun|habia|subiria|bajaria|direccion|comprobacion|explicacion|seleccion|rehara|fijo|proxima|maximo|numero|tambien|ademas|mas)\b/;

function afirmacion(extra: Partial<Afirmacion> = {}): Afirmacion {
  return { texto: 'x', cita: '[Cohorte clínica, 2025, pág. 7]', veredicto: 'sostenida', motivo: '', entidadDistinta: false, tipo: 'literatura', trayectoria: null, ...extra };
}

function conclusion(extra: Partial<ConclusionHipotesis> = {}): ConclusionHipotesis {
  return {
    certeza: 'muy_baja',
    direccion: 'apoya',
    conclusion: '',
    factores: [],
    base: { afirmaciones: 3, sostenidas: 2, fuentes: 2, datos: 0, interpretaciones: 1 },
    enunciado: '',
    aFavor: [],
    enContra: [],
    loMasFragil: '',
    subiria: '',
    bajaria: '',
    noComprobado: [],
    cambio: null,
    fechaBusqueda: null,
    fecha: 1,
    iteracion: 13,
    ...extra,
  };
}

describe('componentesDe sobre los datos de muestra', () => {
  const estado = estadoDeMuestra();

  it('no lanza con ninguna hipótesis de la muestra y devuelve la forma completa', () => {
    for (const h of estado.hipotesis) {
      const c = componentesDe(estado, h);
      expect(Array.isArray(c.cohortesDistintas)).toBe(true);
      expect(Array.isArray(c.bloqueos)).toBe(true);
      expect(Array.isArray(c.conflictoCon)).toBe(true);
      expect(Array.isArray(c.fusionCon)).toBe(true);
      for (const n of [c.aFavor, c.enContra, c.socavan, c.socavadas, c.partidos]) expect(Number.isInteger(n) && n >= 0).toBe(true);
      expect(['no_comprobado', 'nueva', 'precedente', 'parcial']).toContain(c.novedad.estado);
      expect(typeof c.novedad.detalle).toBe('string');
      expect(typeof c.pendiente).toBe('boolean');
      expect(typeof c.candidata).toBe('boolean');
    }
  });

  it('hip-1: sin conclusión, tres apoyos de origen, cinco partidos (uno por la regla de solidez), precedente parcial, sin Killer ni BT', () => {
    const h = estado.hipotesis.find((x) => x.id === 'hip-1')!;
    const c = componentesDe(estado, h);
    expect(c.certeza).toBeNull();
    expect(c.direccion).toBeNull();
    expect(c.aFavor).toBe(3);
    expect(c.enContra).toBe(0);
    expect(c.socavan).toBe(0);
    expect(c.partidos).toBe(5); // cuatro con juez y uno por la regla de solidez
    expect(c.novedad.estado).toBe('parcial');
    expect(c.killer).toBeNull();
    expect(c.bt).toBeNull();
    expect(c.conflictoCon).toEqual([]);
    expect(c.fusion).toBeNull();
    expect(c.pendiente).toBe(false);
    expect(c.pasoRuta).toBeNull();
    // Las cohortes son las mismas que cuenta la regla espejada de priorización.
    expect(c.cohortesDistintas.length).toBe(cohortesDe(h).length);
    // Los bloqueos vienen de la regla, no del servidor, y una hipótesis sin
    // experimento con criterios no puede ser candidata.
    expect(c.bloqueosOrigen).toBe('regla');
    expect(c.bloqueos).toContain('sin_experimento_interpretable');
  });

  it('es determinista: la misma entrada da la misma salida', () => {
    const h = estado.hipotesis[0]!;
    expect(componentesDe(estado, h)).toEqual(componentesDe(estado, h));
  });
});

describe('componentesDe con hipótesis inyectadas', () => {
  const estado = estadoDeMuestra();
  const base = estado.hipotesis.find((x) => x.id === 'hip-1')!;

  it('lee la certeza con su techo acotado y la dirección sin recalcular nada', () => {
    const h: Hipotesis = { ...base, conclusion: conclusion({ certeza: 'baja', direccion: 'mixta', techo: { nivel: 'muy_baja', motivo: 'solo literatura de una sola cohorte', acotada: true, certezaDelJuez: 'moderada' } }) };
    const c = componentesDe(estado, h);
    expect(c.certeza).toEqual({ nivel: 'baja', etiqueta: 'Certeza baja', techo: { nivel: 'muy_baja', etiqueta: 'Certeza muy baja', acotada: true, motivo: 'solo literatura de una sola cohorte' } });
    expect(c.direccion).toBe('mixta');
  });

  it('una conclusión antigua sin techo ni escalera sale con techo null', () => {
    const h: Hipotesis = { ...base, conclusion: conclusion({ certeza: 'moderada' }) };
    const c = componentesDe(estado, h);
    expect(c.certeza?.techo).toBeNull();
    expect(c.certeza?.etiqueta).toBe('Certeza moderada');
  });

  it('un nivel de certeza que la interfaz no conoce no rompe: etiqueta de repuesto', () => {
    const h = { ...base, conclusion: conclusion({ certeza: 'altisima' as ConclusionHipotesis['certeza'] }) };
    const c = componentesDe(estado, h);
    expect(c.certeza?.nivel).toBe('altisima');
    expect(c.certeza?.etiqueta).toBe('Certeza altisima');
  });

  it('resuelve los títulos de los conflictos, deja el id si no existe y se quita a sí misma', () => {
    const h: Hipotesis = { ...base, conflictoCon: ['hip-2', 'hip-999-inv-7', base.id] };
    const c = componentesDe(estado, h);
    expect(c.conflictoCon.map((x) => x.id)).toEqual(['hip-2', 'hip-999-inv-7']);
    expect(c.conflictoCon[0]!.titulo).toBe(estado.hipotesis.find((x) => x.id === 'hip-2')!.titulo);
    expect(c.conflictoCon[1]!.titulo).toBe('hip-999-inv-7');
  });

  it('fusionada en otra manda sobre absorber, y absorber se lee cuando no está fusionada', () => {
    const fusionada: Hipotesis = { ...base, fusionadaEn: 'hip-2', absorbe: ['hip-3'] };
    expect(componentesDe(estado, fusionada).fusion).toBe('fusionada');
    expect(componentesDe(estado, fusionada).fusionCon.map((x) => x.id)).toEqual(['hip-2']);
    const absorbe: Hipotesis = { ...base, fusionadaEn: null, absorbe: ['hip-3', 'hip-4'] };
    expect(componentesDe(estado, absorbe).fusion).toBe('absorbe');
    expect(componentesDe(estado, absorbe).fusionCon.map((x) => x.titulo)).toEqual(['hip-3', 'hip-4'].map((id) => estado.hipotesis.find((x) => x.id === id)!.titulo));
    expect(componentesDe(estado, { ...base, fusionadaEn: '', absorbe: [] }).fusion).toBeNull();
  });

  it('lee Killer, candidata, BT, paso de la ruta y pendiente de revisar tal como están', () => {
    const h: Hipotesis = {
      ...base,
      decisionKiller: 'avanzar',
      candidata: true,
      bt: { fuerza: 1520, ic95: [1480, 1560], partidos: 4 },
      tarjeta: { diana: 'NLRP3', celula: 'microglía', etapa: 'preclínica', intervencion: 'inhibir', direccion: 'disminuye', prediccionFalsable: 'x', riesgos: [], pasoRuta: 'compromiso_diana' },
      pendienteRevision: { causa: 'fuente_retractada', detalle: 'La fuente 2 se retractó.', origenId: 'f-2', desde: 1 },
      experimento: { protocolo: '1', ensayo: 'e', costeEstimado: '', laboratorio: null, estado: 'propuesto', ficheroDatos: null, analisisPedido: '', confirma: 'sube', refuta: 'baja' },
    };
    const c = componentesDe(estado, h);
    expect(c.killer).toBe('avanzar');
    expect(c.candidata).toBe(true);
    expect(c.bt).toEqual({ fuerza: 1520, ic95: [1480, 1560] });
    expect(c.pasoRuta).toBe('compromiso_diana');
    expect(c.pendiente).toBe(true);
    expect(c.pendienteDetalle).toBe('La fuente 2 se retractó.');
    // Pendiente de revisar es un bloqueo no compensable por la regla espejada.
    expect(c.bloqueos).toContain('dependencia_pendiente');
  });

  it('un BT corrupto (intervalo incompleto o NaN) sale como null, no como cifra', () => {
    expect(componentesDe(estado, { ...base, bt: { fuerza: 1500, ic95: [1400] as unknown as [number, number], partidos: 1 } }).bt).toBeNull();
    expect(componentesDe(estado, { ...base, bt: { fuerza: Number.NaN, ic95: [1, 2], partidos: 1 } }).bt).toBeNull();
  });

  it('un registro antiguo sin listas ni novedad no rompe: ceros, null y "no comprobado"', () => {
    const vieja = { id: 'hip-vieja-inv-1', investigacionId: 'inv-1', titulo: 'Old record', estado: 'propuesta' } as unknown as Hipotesis;
    const c = componentesDe(estado, vieja);
    expect(c.aFavor).toBe(0);
    expect(c.partidos).toBe(0);
    expect(c.cohortesDistintas).toEqual([]);
    expect(c.certeza).toBeNull();
    expect(c.novedad.estado).toBe('no_comprobado');
    expect(c.novedad.detalle).toContain('No se pudo comprobar');
    expect(c.bloqueos).toContain('trazabilidad_insuficiente');
    expect(c.killer).toBeNull();
    expect(c.fusion).toBeNull();
  });

  it('con un estado parcial (sin investigaciones ni ejecuciones) tampoco lanza', () => {
    const c = componentesDe({ hipotesis: [base] }, base);
    expect(c.bloqueosOrigen).toBe('regla');
    expect(c.aFavor).toBe(3);
  });

  it('si la regla de bloqueos no puede evaluar un veredicto desconocido, usa los del servidor y lo dice', () => {
    const h = { ...base, afirmaciones: [afirmacion(), afirmacion({ veredicto: 'raro' as Afirmacion['veredicto'] })], bloqueos: ['fuente_retractada'] } as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.bloqueosOrigen).toBe('servidor');
    expect(c.bloqueos).toEqual(['fuente_retractada']);
  });
});

describe('recuentoEvidencia espeja la regla de rosa/certeza.py', () => {
  it('cuenta apoyos de origen, directos e indirectos; contras; socavan; y descuenta los socavados', () => {
    const afs: Afirmacion[] = [
      afirmacion(),
      afirmacion({ relacion: 'apoya' }),
      afirmacion({ relacion: 'apoya_indirecta', veredicto: 'parcial' }),
      afirmacion({ relacion: 'contradice' }),
      afirmacion({ relacion: 'socava', socavaA: 'a-1' }),
      afirmacion({ relacion: 'apoya', socavadaPor: ['a-5'] }),
      afirmacion({ relacion: 'apoya', socavadaPor: 'a-5' as unknown as string[] }),
    ];
    expect(recuentoEvidencia({ afirmaciones: afs })).toEqual({ aFavor: 3, enContra: 1, socavan: 1, socavadas: 2 });
  });

  it('lo no sostenido y lo sintético no cuentan; la relación se normaliza; una lista vacía de socavadores no socava', () => {
    const afs: Afirmacion[] = [
      afirmacion({ veredicto: 'no_sostenida' }),
      afirmacion({ veredicto: 'sin_verificar', relacion: 'contradice' }),
      afirmacion({ sintetico: true }),
      afirmacion({ relacion: ' Contradice ' as Afirmacion['relacion'] }),
      afirmacion({ relacion: 'APOYA' as Afirmacion['relacion'], socavadaPor: [] }),
    ];
    expect(recuentoEvidencia({ afirmaciones: afs })).toEqual({ aFavor: 1, enContra: 1, socavan: 0, socavadas: 0 });
  });

  it('afirmaciones ausentes o con basura dentro no rompen', () => {
    expect(recuentoEvidencia({ afirmaciones: undefined as unknown as Afirmacion[] })).toEqual({ aFavor: 0, enContra: 0, socavan: 0, socavadas: 0 });
    expect(recuentoEvidencia({ afirmaciones: [null, 3, 'x', afirmacion()] as unknown as Afirmacion[] })).toEqual({ aFavor: 1, enContra: 0, socavan: 0, socavadas: 0 });
  });
});

describe('cohortesConNombre', () => {
  it('agrupa por nombre sin distinguir mayúsculas y conserva el nombre de la primera fuente', () => {
    const base = estadoDeMuestra().hipotesis[0]!;
    const fuentes = base.procedencia.fuentes.slice(0, 1);
    const f = fuentes[0]!;
    const h = { procedencia: { ...base.procedencia, fuentes: [{ ...f, id: 'f-a', cohorte: 'ADNI' }, { ...f, id: 'f-b', cohorte: ' adni ' }, { ...f, id: 'f-c', cohorte: 'BioFINDER' }, { ...f, id: 'f-d', cohorte: '' }, { ...f, id: 'f-e', cohorte: null }] } };
    expect(cohortesConNombre(h)).toEqual(['ADNI', 'BioFINDER']);
  });

  it('sin procedencia o sin fuentes devuelve la lista vacía', () => {
    expect(cohortesConNombre({ procedencia: undefined as unknown as Hipotesis['procedencia'] })).toEqual([]);
    expect(cohortesConNombre({ procedencia: { fuentes: undefined } as unknown as Hipotesis['procedencia'] })).toEqual([]);
  });
});

describe('novedadDe', () => {
  const novedad = (precedente: Hipotesis['novedad']['precedente']): Pick<Hipotesis, 'novedad'> => ({ novedad: { openTargets: { estado: 'no_comprobado', detalle: '' }, ensayos: { estado: 'no_comprobado', detalle: '', nct: null }, agora: { estado: 'no_nominada', detalle: '' }, precedente } });

  it('mapea los cuatro estados y no convierte "no comprobado" en "nueva"', () => {
    expect(novedadDe(novedad({ estado: 'sin_precedente', detalle: 'Nada igual en PubMed ni Europe PMC.' }))).toEqual({ estado: 'nueva', detalle: 'Nada igual en PubMed ni Europe PMC.' });
    expect(novedadDe(novedad({ estado: 'parcial', detalle: 'Dos artículos parecidos.' })).estado).toBe('parcial');
    expect(novedadDe(novedad({ estado: 'ya_publicado', detalle: 'Smith 2024.' })).estado).toBe('precedente');
    expect(novedadDe(novedad({ estado: 'no_comprobado', detalle: 'PubMed no respondió.' })).estado).toBe('no_comprobado');
    // La plantilla por defecto parece una ausencia pero su detalle dice que no se comprobó.
    expect(novedadDe(novedad({ estado: 'sin_precedente', detalle: 'No comprobado: la pista de novedad no corrió.' })).estado).toBe('no_comprobado');
  });

  it('sin novedad registrada o con un estado desconocido, es "no comprobado" con el motivo', () => {
    expect(novedadDe({ novedad: undefined as unknown as Hipotesis['novedad'] }).estado).toBe('no_comprobado');
    const raro = novedadDe(novedad({ estado: 'sospechoso' as Hipotesis['novedad']['precedente']['estado'], detalle: 'x' }));
    expect(raro.estado).toBe('no_comprobado');
    expect(raro.detalle).toContain('sospechoso');
  });
});

describe('queCambiariaElOrden', () => {
  it('sin conclusión, dice que el puesto lo fija solo el torneo', () => {
    const t = queCambiariaElOrden({ conclusion: null });
    expect(t).toContain('torneo');
    expect(t).not.toMatch(SIN_TILDE);
    expect(queCambiariaElOrden({ conclusion: undefined })).toBe(t);
  });

  it('con escalera, subiría y bajaría, compone la frase en llano con los niveles GRADE', () => {
    const t = queCambiariaElOrden({
      conclusion: conclusion({
        certeza: 'muy_baja',
        escalera: [
          { de: 'muy_baja', a: 'baja', falta: 'Una segunda cohorte distinta que sostenga el mismo resultado.' },
          { de: 'baja', a: 'moderada', falta: 'Evidencia directa.' },
        ],
        subiria: 'Una segunda cohorte independiente con el mismo resultado',
        bajaria: 'Que la cohorte de FLENI no muestre anticipación del cociente',
      }),
    });
    expect(t).toBe('Para pasar de certeza muy baja a certeza baja le falta: una segunda cohorte distinta que sostenga el mismo resultado. Lo que la subiría, según el juez: una segunda cohorte independiente con el mismo resultado. Lo que la bajaría: que la cohorte de FLENI no muestre anticipación del cociente.');
    expect(t).not.toContain('\u2014');
  });

  it('respeta una sigla al principio y deja pasar un texto en inglés sin traducirlo', () => {
    const t = queCambiariaElOrden({ conclusion: conclusion({ escalera: [{ de: 'muy_baja', a: 'baja', falta: 'PET de amiloide en la misma cohorte' }], subiria: 'A second independent cohort with the same result.' }) });
    expect(t).toContain('le falta: PET de amiloide en la misma cohorte.');
    expect(t).toContain('según el juez: a second independent cohort with the same result.');
  });

  it('sin escalera: en alta dice que no hay peldaño; en otro nivel dice que la conclusión es anterior a la escalera', () => {
    expect(queCambiariaElOrden({ conclusion: conclusion({ certeza: 'alta' }) })).toContain('no hay peldaño por encima');
    const t = queCambiariaElOrden({ conclusion: conclusion({ certeza: 'baja', escalera: [] }) });
    expect(t).toContain('certeza baja');
    expect(t).toContain('se rehará');
    expect(t).not.toMatch(SIN_TILDE);
  });

  it('un peldaño sin texto de falta cuenta como sin escalera; una escalera con basura no rompe', () => {
    const t = queCambiariaElOrden({ conclusion: conclusion({ certeza: 'baja', escalera: [{ de: 'baja', a: 'moderada', falta: '   ' }] }) });
    expect(t).toContain('se rehará');
    expect(() => queCambiariaElOrden({ conclusion: conclusion({ escalera: [null, 3] as unknown as ConclusionHipotesis['escalera'] }) })).not.toThrow();
  });
});

describe('adversario: entradas raras que un registro antiguo o un modelo pueden producir', () => {
  const estado = estadoDeMuestra();
  const base = estado.hipotesis.find((x) => x.id === 'hip-1')!;

  it('una afirmación nula o una fuente nula dentro de las listas no tumban la regla de bloqueos', () => {
    const h = { ...base, afirmaciones: [null, ...base.afirmaciones], procedencia: { ...base.procedencia, fuentes: [null, ...base.procedencia.fuentes] } } as unknown as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.bloqueosOrigen).toBe('regla');
    expect(c.aFavor).toBe(3);
    expect(c.cohortesDistintas.length).toBe(cohortesDe(base).length);
  });

  it('si la regla no puede evaluar y el servidor no guardó bloqueos, es "no comprobado", nunca "sin bloqueos"', () => {
    const h = { ...base, afirmaciones: [afirmacion(), afirmacion({ veredicto: 'raro' as Afirmacion['veredicto'] })], bloqueos: undefined } as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.bloqueos).toEqual([]);
    expect(c.bloqueosOrigen).toBe('no_comprobado');
  });

  it('los bloqueos del servidor salen sin repetidos ni basura', () => {
    const h = { ...base, afirmaciones: [afirmacion(), afirmacion({ veredicto: 'raro' as Afirmacion['veredicto'] })], bloqueos: ['fuente_retractada', 'fuente_retractada', '', 3, null] } as unknown as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.bloqueosOrigen).toBe('servidor');
    expect(c.bloqueos).toEqual(['fuente_retractada']);
  });

  it('un texto que no es texto (objeto, lista) sale vacío, nunca "[object Object]"', () => {
    const h = {
      ...base,
      conclusion: conclusion({ certeza: 'baja', techo: { nivel: 'muy_baja', motivo: { a: 1 } as unknown as string, acotada: true, certezaDelJuez: 'baja' } }),
      pendienteRevision: { causa: 'hecho_contradicho', detalle: {} as unknown as string, origenId: 'x', desde: 1 },
      novedad: { ...base.novedad, precedente: { estado: 'parcial', detalle: ['x'] as unknown as string } },
    } as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.certeza?.techo?.motivo).toBe('');
    expect(c.pendienteDetalle).toBeNull();
    expect(c.novedad.detalle).not.toContain('object');
    expect(JSON.stringify(c)).not.toContain('[object Object]');
  });

  it('el veredicto se compara exacto, como rosa/certeza.py: "Sostenida" con mayúscula no cuenta', () => {
    expect(recuentoEvidencia({ afirmaciones: [afirmacion({ veredicto: 'Sostenida' as Afirmacion['veredicto'] }), afirmacion()] })).toEqual({ aFavor: 1, enContra: 0, socavan: 0, socavadas: 0 });
  });

  it('pendiente de revisar sigue la misma verdad que el bloqueo dependencia_pendiente aunque el registro sea raro', () => {
    const h = { ...base, pendienteRevision: true as unknown as Hipotesis['pendienteRevision'] } as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.pendiente).toBe(true);
    expect(c.pendienteDetalle).toBeNull();
    expect(c.bloqueos).toContain('dependencia_pendiente');
  });

  it('un estado con entradas nulas en sus listas no tumba la regla', () => {
    const raro = { ...estado, investigaciones: [null, ...estado.investigaciones], planesAnalisis: [null], ejecuciones: [null], hipotesis: [null, ...estado.hipotesis] } as unknown as typeof estado;
    const c = componentesDe(raro, base);
    expect(c.bloqueosOrigen).toBe('regla');
  });

  it('conflictoCon con basura, repetidos y la propia id queda limpio y en orden de llegada', () => {
    const h = { ...base, conflictoCon: ['hip-2', 3, null, 'hip-2', base.id, '', 'hip-3'] } as unknown as Hipotesis;
    expect(componentesDe(estado, h).conflictoCon.map((x) => x.id)).toEqual(['hip-2', 'hip-3']);
  });

  it('con ids repetidos en el estado, el título resuelto es el del primero (determinista)', () => {
    const duplicado = { ...estado, hipotesis: [...estado.hipotesis, { ...estado.hipotesis[1]!, titulo: 'Copia posterior' }] };
    const h = { ...base, conflictoCon: ['hip-2'] } as Hipotesis;
    expect(componentesDe(duplicado, h).conflictoCon[0]!.titulo).toBe(estado.hipotesis[1]!.titulo);
  });

  it('una hipótesis nula o un estado nulo no lanzan', () => {
    expect(() => componentesDe(null as unknown as typeof estado, null as unknown as Hipotesis)).not.toThrow();
    expect(componentesDe(null as unknown as typeof estado, null as unknown as Hipotesis).partidos).toBe(0);
  });

  it('novedad: "no comprobado" en minúscula o "No se pudo comprobar" también son no comprobado', () => {
    const conPrecedente = (estado: string, detalle: string) => ({ novedad: { ...base.novedad, precedente: { estado: estado as Hipotesis['novedad']['precedente']['estado'], detalle } } });
    expect(novedadDe(conPrecedente('sin_precedente', 'no comprobado todavía')).estado).toBe('no_comprobado');
    expect(novedadDe(conPrecedente('sin_precedente', 'No se pudo comprobar: PubMed no respondió.')).estado).toBe('no_comprobado');
    expect(novedadDe(conPrecedente('sin_precedente', 'No consta precedente en PubMed.')).estado).toBe('nueva');
  });

  it('queCambiariaElOrden: un peldaño sin "de" usa la certeza de la conclusión y no duplica la puntuación final', () => {
    const t = queCambiariaElOrden({ conclusion: conclusion({ certeza: 'baja', escalera: [{ de: '' as ConclusionHipotesis['certeza'], a: 'moderada', falta: '¿Hay evidencia directa?' }], subiria: 'Más datos...' }) });
    expect(t).toContain('Para pasar de certeza baja a certeza moderada le falta: ¿hay evidencia directa?');
    expect(t).not.toContain('?.');
    expect(t).toContain('según el juez: más datos.');
    expect(t).not.toContain('...');
  });

  it('miles de hipótesis con conflictos se resuelven en tiempo lineal por fila', () => {
    const muchas: Hipotesis[] = Array.from({ length: 3000 }, (_, i) => ({ ...base, id: `hip-m-${i}`, conflictoCon: [`hip-m-${(i + 1) % 3000}`, `hip-m-${(i + 2) % 3000}`] }));
    const grande = { ...estado, hipotesis: muchas };
    const t0 = performance.now();
    for (const h of muchas.slice(0, 300)) componentesDe(grande, h);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

describe('ruta evaluada', () => {
  it('lee cubiertos, siguiente y coherente de h.ruta y los acota; sin ruta devuelve null', () => {
    const estado = estadoDeMuestra();
    const base = estado.hipotesis[0]!;
    const con = componentesDe(estado, { ...base, ruta: { cubiertos: 5, siguiente: 'opciones_intervencion', coherente: false } as unknown as Hipotesis['ruta'] });
    expect(con.ruta).toEqual({ cubiertos: 5, siguiente: 'opciones_intervencion', coherente: false });
    expect(componentesDe(estado, { ...base, ruta: null }).ruta).toBeNull();
    expect(componentesDe(estado, { ...base, ruta: undefined }).ruta).toBeNull();
    // Registros rotos: cubiertos fuera de rango o sin número, siguiente que no es texto.
    expect(componentesDe(estado, { ...base, ruta: { cubiertos: 99, siguiente: 7, coherente: true } as unknown as Hipotesis['ruta'] }).ruta).toEqual({ cubiertos: 8, siguiente: null, coherente: true });
    expect(componentesDe(estado, { ...base, ruta: { cubiertos: 'x' } as unknown as Hipotesis['ruta'] }).ruta).toBeNull();
    expect(componentesDe(estado, { ...base, ruta: 'texto' as unknown as Hipotesis['ruta'] }).ruta).toBeNull();
  });
});

describe('motivo del Killer y razones del juez', () => {
  it('lee el motivo de la última revisión del Killer y cuenta las razones en contra de la conclusión', () => {
    const estado = estadoDeMuestra();
    const base = estado.hipotesis[0]!;
    const h = {
      ...base,
      decisionKiller: 'suspender',
      revisiones: [
        { fecha: 1, quien: 'rosa', accion: 'killer', nota: 'suspender: primera', aCiegas: false },
        { fecha: 2, quien: 'rosa', accion: 'suspendida', nota: 'otra cosa', aCiegas: false },
        { fecha: 3, quien: 'rosa', accion: 'killer', nota: 'suspender: Hace falta más o mejor evidencia antes de seguir: sesgo_evidencia: una sola fuente', aCiegas: false },
      ],
      conclusion: { ...(base.conclusion ?? {}), enContra: ['No consta ningún par de ensayos comparables', 'Sin comparabilidad analítica', '', 7] },
    } as unknown as Hipotesis;
    const c = componentesDe(estado, h);
    expect(c.killerMotivo).toBe('suspender: Hace falta más o mejor evidencia antes de seguir: sesgo_evidencia: una sola fuente');
    expect(c.razonesEnContra).toBe(2);
    expect(componentesDe(estado, { ...base, revisiones: [], conclusion: null } as unknown as Hipotesis).killerMotivo).toBeNull();
    expect(componentesDe(estado, { ...base, revisiones: 'texto', conclusion: { enContra: 'no lista' } } as unknown as Hipotesis).razonesEnContra).toBe(0);
  });
});

// M-04 (17 de septiembre de 2026): la cuenta de cohortes que guarda el
// servidor (la misma que usó el techo GRADE) manda; la regla espejada solo
// entra si el registro no la trae.
describe('cohortes del servidor frente a la regla espejada', () => {
  it('lee hipotesis.cohortesDistintas, si no conclusion.cohortesDistintas, y solo recalcula si faltan', () => {
    const estado = estadoDeMuestra();
    const base = estado.hipotesis.find((h) => h.procedencia.fuentes.length > 0)!;
    const fuentes = base.procedencia.fuentes.map((f, i) => ({ ...f, cohorte: i % 2 === 0 ? 'ADNI' : 'BioFINDER' }));
    const h = { ...base, procedencia: { ...base.procedencia, fuentes }, afirmaciones: [] } as Hipotesis;
    const porRegla = componentesDe(estado, h);
    expect(porRegla.cohortesOrigen).toBe('regla');
    expect(porRegla.cohortesDistintas).toEqual(fuentes.length > 1 ? ['ADNI', 'BioFINDER'] : ['ADNI']);
    const enConclusion = componentesDe(estado, { ...h, conclusion: { ...(h.conclusion ?? ({} as NonNullable<Hipotesis['conclusion']>)), cohortesDistintas: ['Study 201', 'TRAILBLAZER-ALZ 2', 'TRAILBLAZER-ALZ 2'] } } as Hipotesis);
    expect(enConclusion.cohortesOrigen).toBe('servidor');
    expect(enConclusion.cohortesDistintas).toEqual(['Study 201', 'TRAILBLAZER-ALZ 2']);
    const enHipotesis = componentesDe(estado, { ...h, cohortesDistintas: ['ADAD'], conclusion: { ...(h.conclusion ?? ({} as NonNullable<Hipotesis['conclusion']>)), cohortesDistintas: ['otra'] } } as Hipotesis);
    expect(enHipotesis.cohortesDistintas).toEqual(['ADAD']);
    // Una lista vacía del servidor es una respuesta ("ninguna cohorte que cuente"), no un hueco.
    expect(componentesDe(estado, { ...h, cohortesDistintas: [] } as Hipotesis)).toMatchObject({ cohortesDistintas: [], cohortesOrigen: 'servidor' });
    // Basura en la lista se limpia; una lista que no es lista se ignora y se recalcula.
    expect(componentesDe(estado, { ...h, cohortesDistintas: ['ADNI', 3, null, '  ', 'ADNI'] as never } as Hipotesis).cohortesDistintas).toEqual(['ADNI']);
    expect(componentesDe(estado, { ...h, cohortesDistintas: 'ADNI' as never } as Hipotesis).cohortesOrigen).toBe('regla');
  });
});
