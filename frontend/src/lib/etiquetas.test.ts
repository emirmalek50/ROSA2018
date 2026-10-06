import { afterEach, describe, expect, it } from 'vitest';
import { detalleRiesgoSesgo, etiquetaCorrida, mostrarTexto, proponiendoPlan } from './etiquetas';
import { fijarIdioma } from './idioma';

afterEach(() => fijarIdioma('es'));

it('traduce el dominio y el juicio RoB 2 sin modificar el registro científico', () => {
  const riesgo = { instrumento: 'RoB 2', global: 'algunas_dudas' as const, dominios: [{ id: 'D1', nombre: 'Proceso de aleatorización', juicio: 'algunas_dudas' as const }] };
  const copia = JSON.stringify(riesgo);
  fijarIdioma('en');
  expect(detalleRiesgoSesgo(riesgo)).toContain('D1 Randomization process: some concerns');
  expect(JSON.stringify(riesgo)).toBe(copia);
  fijarIdioma('es');
  expect(detalleRiesgoSesgo(riesgo)).toContain('D1 Proceso de aleatorización: algunas dudas');
});

// La captura del 15 de septiembre: la corrida recién creada decía "Esperando que
// apruebes el plan" durante los 93 segundos en que ROSA2018 aún escribía el plan y
// no había nada que aprobar.
describe('proponiendoPlan y etiquetaCorrida', () => {
  it('sin iteración, esperando_plan significa que ROSA2018 escribe el plan', () => {
    expect(proponiendoPlan({ estado: 'esperando_plan' }, null)).toBe(true);
    expect(etiquetaCorrida({ estado: 'esperando_plan' }, null)).toBe('ROSA2018 está proponiendo el plan');
  });
  it('con un plan propuesto y sin aprobar, sí hay algo que aprobar', () => {
    const it = { planAprobado: false, terminadaEn: null };
    expect(proponiendoPlan({ estado: 'esperando_plan' }, it)).toBe(false);
    expect(etiquetaCorrida({ estado: 'esperando_plan' }, it)).toBe('Esperando que apruebes el plan');
  });
  it('entre iteraciones (la última cerrada) vuelve a ser ROSA2018 escribiendo', () => {
    expect(proponiendoPlan({ estado: 'esperando_plan' }, { planAprobado: true, terminadaEn: 1 })).toBe(true);
  });
  it('en otros estados no cambia la etiqueta', () => {
    expect(proponiendoPlan({ estado: 'en_marcha' }, null)).toBe(false);
    expect(etiquetaCorrida({ estado: 'terminada' }, null)).toBe('Terminada');
  });
});

// M-36 (17 de septiembre de 2026): un veredicto o un nivel de certeza que el
// servidor añada y esta versión no conozca no puede tumbar la Cola, el Ranking
// ni la Trazabilidad. VEREDICTO responde a cualquier clave con una entrada
// bloqueante ("no pude comprobar" no es "no hay"); CERTEZA_EVIDENCIA sigue
// siendo una tabla normal (varias pantallas la usan para decidir si pintan un
// chip) y quien lee .etiqueta o .tono sin riesgo usa certezaDe.
describe('veredictos y certezas que esta versión no conoce', () => {
  it('VEREDICTO[clave nueva] devuelve una entrada bloqueante con la clave legible, sin tumbar nada', async () => {
    const { VEREDICTO, veredictoDe } = await import('./etiquetas');
    const raro = (VEREDICTO as Record<string, { etiqueta: string; tono: string; bloquea: boolean }>)['sin_texto_completo']!;
    expect(raro.bloquea).toBe(true);
    expect(raro.tono).toBe('aviso');
    expect(raro.etiqueta).toContain('no conoce');
    expect(raro.etiqueta).toContain('sin texto completo');
    // Las conocidas siguen intactas y las utilidades del objeto no cambian.
    expect(VEREDICTO.sostenida.bloquea).toBe(false);
    expect(Object.keys(VEREDICTO)).toEqual(['sostenida', 'parcial', 'no_sostenida', 'cita_no_resuelve', 'sin_cita', 'ausencia_refutada', 'sin_verificar']);
    expect(Object.hasOwn(VEREDICTO, 'sin_texto_completo')).toBe(false);
    expect('sin_texto_completo' in VEREDICTO).toBe(false);
    expect(typeof VEREDICTO.toString).toBe('function');
    // veredictoDe acepta cualquier cosa.
    expect(veredictoDe(null).bloquea).toBe(true);
    expect(veredictoDe(undefined).etiqueta).toContain('sin veredicto');
    expect(veredictoDe(42).etiqueta).toContain('42');
    expect(veredictoDe('constructor').bloquea).toBe(true);
    expect(veredictoDe('sostenida')).toBe(VEREDICTO.sostenida);
  });

  it('las reglas que indexan VEREDICTO directamente (resumirVerificacion, bloqueosDe, candidatos) no lanzan con un veredicto inventado y lo tratan como bloqueante', async () => {
    const { resumirVerificacion, motivoNoAceptable } = await import('./hipotesis');
    const { bloqueosDe, candidatos } = await import('./priorizacion');
    const { estadoDeMuestra } = await import('../datos/muestra');
    const e = estadoDeMuestra();
    const base = e.hipotesis.find((h) => h.afirmaciones.length > 0)!;
    const h = { ...base, decisionKiller: 'avanzar' as const, afirmaciones: [{ ...base.afirmaciones[0]!, veredicto: 'sin_texto_completo' as never }] };
    expect(() => resumirVerificacion(h.afirmaciones)).not.toThrow();
    expect(resumirVerificacion(h.afirmaciones).bloqueantes).toBe(1);
    expect(motivoNoAceptable(h)).toContain('bloquea');
    expect(bloqueosDe(e, h)).toContain('trazabilidad_insuficiente');
    expect(candidatos({ ...e, hipotesis: [h] }, h.investigacionId).map((x) => x.id)).not.toContain(h.id);
  });

  it('certezaDe da una etiqueta legible y tono neutro para un nivel desconocido, y CERTEZA_EVIDENCIA sigue sin inventar entradas', async () => {
    const { CERTEZA_EVIDENCIA, certezaDe } = await import('./etiquetas');
    expect((CERTEZA_EVIDENCIA as Record<string, unknown>)['altisima']).toBeUndefined();
    expect(certezaDe('altisima').etiqueta).toBe('Certeza sin clasificar (altisima)');
    expect(certezaDe('altisima').tono).toBe('borde');
    expect(certezaDe(null).etiqueta).toContain('sin nivel');
    expect(certezaDe('muy_baja')).toBe(CERTEZA_EVIDENCIA.muy_baja);
  });
});

// S-09: una avería del juez (el modelo no respondió) no es un juicio
// científico. La interfaz lo dice como "pendiente de juicio".
describe('killerPendienteDe', () => {
  it('lee la clave pública killerPendiente del servidor, con o sin motivo', async () => {
    const { killerPendienteDe } = await import('./etiquetas');
    expect(killerPendienteDe({ decisionKiller: 'suspender', killerPendiente: true })).toBe('Pendiente de juicio: el modelo no respondió');
    expect(killerPendienteDe({ decisionKiller: 'avanzar', killerPendiente: { intentos: 2, motivo: 'el adaptador JSON no pudo leer la respuesta' } })).toBe('Pendiente de juicio: el adaptador JSON no pudo leer la respuesta');
    expect(killerPendienteDe({ decisionKiller: 'avanzar', killerPendiente: false })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'avanzar', killerPendiente: null })).toBeNull();
  });
  it('sin clave pública, reconoce la suspensión técnica por la nota de la última revisión del Killer (caso real hip-mu2uqqzu-5871)', async () => {
    const { killerPendienteDe } = await import('./etiquetas');
    const revisiones = [
      { fecha: 1, quien: 'Rosa', accion: 'killer', nota: 'suspender: sesgo_evidencia falla: toda la evidencia es observacional' },
      { fecha: 2, quien: 'Rosa', accion: 'killer', nota: 'suspender: El juez no respondió: no se puede dar por revisada' },
    ];
    expect(killerPendienteDe({ decisionKiller: 'suspender', revisiones })).toBe('Pendiente de juicio: el modelo no respondió');
    // La última revisión manda: si después hubo un juicio de verdad, ya no está pendiente.
    expect(killerPendienteDe({ decisionKiller: 'suspender', revisiones: [...revisiones, { fecha: 3, quien: 'Rosa', accion: 'killer', nota: 'suspender: hace falta más evidencia' }] })).toBeNull();
    // Un descarte con esa nota no se disfraza: solo "suspender" puede ser técnico.
    expect(killerPendienteDe({ decisionKiller: 'descartar_en_contexto', revisiones })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: null, revisiones })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'suspender', revisiones: 'rara' as never })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'suspender', revisiones: [null, 3, { accion: 'killer', nota: 7 }] as never })).toBeNull();
  });
  it('adversario: en la fase de reintentos del servidor (S-09) no hay decisión nueva, solo un mensaje del revisor; si es posterior a la última revisión del Killer, está pendiente', async () => {
    const { killerPendienteDe } = await import('./etiquetas');
    const texto = 'El juez del Killer no respondió (motivo técnico, intento 1 de 3): tiempo agotado. La decisión anterior se conserva y la revisión se repite en el siguiente paso.';
    const revisiones = [{ fecha: 10, quien: 'Rosa', accion: 'killer', nota: 'avanzar: pasa todo' }];
    const mensajes = [{ id: 'm1', de: 'revisor', texto, creadoEn: 20 }];
    // La decisión "avanzar" que se ve es la anterior: el juicio nuevo está pendiente.
    expect(killerPendienteDe({ decisionKiller: 'avanzar', revisiones, procedencia: { mensajes } })).toBe('Pendiente de juicio: el modelo no respondió');
    // Sin ninguna decisión todavía y el juez caído: también pendiente.
    expect(killerPendienteDe({ decisionKiller: null, revisiones: [], procedencia: { mensajes } })).toBe('Pendiente de juicio: el modelo no respondió');
    // Después llegó un juicio de verdad (fecha posterior al mensaje): ya no.
    expect(killerPendienteDe({ decisionKiller: 'avanzar', revisiones: [...revisiones, { fecha: 30, quien: 'Rosa', accion: 'killer', nota: 'avanzar: pasa todo' }], procedencia: { mensajes } })).toBeNull();
    // Un mensaje de la investigadora con ese texto, o sin fecha, no cuenta.
    expect(killerPendienteDe({ decisionKiller: 'avanzar', revisiones, procedencia: { mensajes: [{ ...mensajes[0], de: 'investigadora' }] } })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'avanzar', revisiones, procedencia: { mensajes: [{ ...mensajes[0], creadoEn: 'ayer' }] } })).toBeNull();
    // Registros raros no lanzan.
    expect(killerPendienteDe({ decisionKiller: 'avanzar', procedencia: null })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'avanzar', procedencia: { mensajes: 'x' } })).toBeNull();
    expect(killerPendienteDe({ decisionKiller: 'avanzar', procedencia: { mensajes: [null, 4, { de: 'revisor', texto: 9 }] } })).toBeNull();
  });
});

// Los eventos guardados antes del 18 de septiembre de 2026 dicen "Rosa"; en
// pantalla el producto se llama ROSA2018. La sustitución es solo al mostrar.
describe('mostrarTexto', () => {
  it('sustituye la palabra Rosa entera por ROSA2018', () => {
    expect(mostrarTexto('Rosa propone el plan de la iteración 2')).toBe('ROSA2018 propone el plan de la iteración 2');
    expect(mostrarTexto('Aprobado por Rosa.')).toBe('Aprobado por ROSA2018.');
  });
  it('no toca palabras que contienen Rosa ni la minúscula ni lo ya renombrado', () => {
    expect(mostrarTexto('Rosalía revisó la rosa del jardín; Rosario también')).toBe('Rosalía revisó la rosa del jardín; Rosario también');
    expect(mostrarTexto('ROSA2018 propone')).toBe('ROSA2018 propone');
  });
  it('devuelve cadena vacía si el texto no es una cadena', () => {
    expect(mostrarTexto(undefined)).toBe('');
    expect(mostrarTexto(null)).toBe('');
  });
});
