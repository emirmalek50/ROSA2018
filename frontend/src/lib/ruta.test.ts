import { describe, expect, it } from 'vitest';
import { formatearRuta, parsearRuta, rutaDe } from './ruta';

describe('parsearRuta', () => {
  it('reconoce las rutas simples', () => {
    expect(parsearRuta('')).toEqual({ tipo: 'inicio' });
    expect(parsearRuta('#/')).toEqual({ tipo: 'inicio' });
    expect(parsearRuta('#/nueva')).toEqual({ tipo: 'nueva' });
    expect(parsearRuta('#/ajustes/')).toEqual({ tipo: 'ajustes' });
  });
  it('reconoce una investigacion con pantalla y detalle', () => {
    expect(parsearRuta('#/investigaciones/inv-1/hipotesis/hip-2')).toEqual({
      tipo: 'investigacion',
      investigacionId: 'inv-1',
      pantalla: 'hipotesis',
      detalleId: 'hip-2',
    });
  });
  it('sin pantalla va a la corrida', () => {
    expect(parsearRuta('#/investigaciones/inv-1')).toEqual({
      tipo: 'investigacion',
      investigacionId: 'inv-1',
      pantalla: 'corrida',
      detalleId: null,
    });
  });
  it('una pantalla desconocida no rompe: vuelve al inicio', () => {
    expect(parsearRuta('#/investigaciones/inv-1/loquesea')).toEqual({ tipo: 'inicio' });
    expect(parsearRuta('#/otra/cosa')).toEqual({ tipo: 'inicio' });
  });
  it('decodifica ids con caracteres escapados', () => {
    const ruta = parsearRuta('#/investigaciones/inv%201/corrida');
    expect(ruta.tipo === 'investigacion' && ruta.investigacionId).toBe('inv 1');
  });
});

describe('formatearRuta', () => {
  it('es inverso de parsearRuta', () => {
    const rutas = ['#/', '#/nueva', '#/ajustes', '#/investigaciones/inv-1/ranking', '#/investigaciones/inv-1/artefactos/art-2'];
    for (const r of rutas) expect(formatearRuta(parsearRuta(r))).toBe(r);
  });
  it('escapa los ids', () => {
    expect(rutaDe('inv 1', 'corrida')).toBe('#/investigaciones/inv%201/corrida');
  });
});

describe('parsearRuta con URL rota', () => {
  it('un porcentaje suelto no lanza: va al inicio', () => {
    expect(parsearRuta('#/investigaciones/inv%/hipotesis')).toEqual({ tipo: 'inicio' });
    expect(parsearRuta('#/investigaciones/%E0%A4%A/corrida')).toEqual({ tipo: 'inicio' });
  });
});

describe('pantallas retiradas', () => {
  it('un enlace guardado a "Qué desbloquea más" lleva a las hipótesis de la misma investigación', () => {
    // Se retiró el 25 de septiembre de 2026; los datos siguen en el estado.
    expect(parsearRuta('#/investigaciones/inv-1/desbloqueo')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'hipotesis', detalleId: null });
    expect(parsearRuta('#/investigaciones/inv-1/desbloqueo/hip-3')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'hipotesis', detalleId: 'hip-3' });
  });
});
