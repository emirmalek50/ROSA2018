import { describe, expect, it } from 'vitest';
import { formatearRuta, parsearRuta, rutaDe, vistaDeRanking } from './ruta';

describe('parsearRuta', () => {
  it('reconoce las rutas simples', () => {
    expect(parsearRuta('')).toEqual({ tipo: 'asistente' });
    expect(parsearRuta('#/')).toEqual({ tipo: 'asistente' });
    expect(parsearRuta('#/asistente')).toEqual({ tipo: 'asistente' });
    expect(parsearRuta('#/inicio')).toEqual({ tipo: 'inicio' });
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
    const rutas = ['#/asistente', '#/inicio', '#/nueva', '#/ajustes', '#/investigaciones/inv-1/ranking', '#/investigaciones/inv-1/artefactos/art-2'];
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
  it('un enlace guardado a "Qué desbloquea más" lleva al ranking de la misma investigación', () => {
    // Se retiró el 25 de septiembre de 2026; los datos siguen en el estado.
    // Llevaba a la cola de hipótesis, que desde el 1 de octubre vive dentro
    // del ranking.
    expect(parsearRuta('#/investigaciones/inv-1/desbloqueo')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'ranking', detalleId: null });
    expect(parsearRuta('#/investigaciones/inv-1/desbloqueo/hip-3')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'ranking', detalleId: 'hip-3' });
  });

  it('la LISTA de hipótesis lleva al ranking, y la FICHA se queda donde estaba', () => {
    // Esta es la distinción que sostiene toda la fusión. Si la ficha también
    // se redirigiera, los treinta enlaces que llegan a ella desde el árbol,
    // el atlas, la búsqueda, calidad, mecanismos y los eventos del inicio
    // abrirían el ranking en vez de la hipótesis que se pidió.
    expect(parsearRuta('#/investigaciones/inv-1/hipotesis')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'ranking', detalleId: 'pendientes' });
    expect(parsearRuta('#/investigaciones/inv-1/hipotesis/laboratorio')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'ranking', detalleId: 'laboratorio' });
    expect(parsearRuta('#/investigaciones/inv-1/hipotesis/hip-3')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'hipotesis', detalleId: 'hip-3' });
  });

  it('un enlace guardado a Calidad lleva a Ajustes, que es donde están los casos', () => {
    // Calidad se retiró el 2 de octubre de 2026 (Emir: «no sirve para nada y
    // dudo que alguien lo use»). Lo único que no era de solo lectura, los 17
    // casos de control, está en Ajustes > Memoria y criterio.
    expect(parsearRuta('#/investigaciones/inv-1/calidad')).toEqual({ tipo: 'ajustes' });
  });

  it('una hipótesis que se llamara como una vista seguiría abriendo su ficha', () => {
    // El centinela va en la misma ranura que el id, así que conviene saber
    // qué gana. Solo «laboratorio» está reservado, porque es el único que ya
    // se usaba así; «pendientes» o «podio» como id abren la ficha.
    expect(parsearRuta('#/investigaciones/inv-1/hipotesis/pendientes')).toEqual({ tipo: 'investigacion', investigacionId: 'inv-1', pantalla: 'hipotesis', detalleId: 'pendientes' });
  });
});

describe('las vistas del ranking', () => {
  it('la vista viaja en la URL y vuelve a leerse', () => {
    expect(rutaDe('inv-1', 'ranking', 'pendientes')).toBe('#/investigaciones/inv-1/ranking/pendientes');
    expect(vistaDeRanking(parsearRuta('#/investigaciones/inv-1/ranking/clusters').tipo === 'investigacion' ? 'clusters' : null)).toBe('clusters');
  });

  it('lo que no es una vista conocida cae en el podio, no en blanco', () => {
    // En esa ranura puede llegar el id de una hipótesis de un enlace viejo.
    for (const v of [null, undefined, '', 'hip-3', 'laboratorioX', 'PODIO']) {
      expect(vistaDeRanking(v), `${String(v)} no es una vista`).toBe('podio');
    }
    for (const v of ['podio', 'pendientes', 'lista', 'clusters', 'laboratorio'] as const) {
      expect(vistaDeRanking(v)).toBe(v);
    }
  });
});
