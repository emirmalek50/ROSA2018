// Rutas de la aplicacion, en el hash de la URL. Sin dependencia: la app tiene
// una decena de pantallas y un enrutador de biblioteca no aporta nada que
// estas dos funciones no den, y asi cada ruta es un valor tipado que las
// pantallas pueden construir sin escribir cadenas.
//
// Formas:
//   #/nueva
//   #/investigaciones/<id>/<pantalla>
//   #/investigaciones/<id>/hipotesis/<hipotesisId>
//   #/investigaciones/<id>/artefactos/<artefactoId>
//   #/laboratorio
//   #/ajustes

export type Pantalla = 'corrida' | 'hipotesis' | 'ranking' | 'panorama' | 'mundo' | 'arbol' | 'atlas' | 'mecanismos' | 'citas' | 'artefactos' | 'calidad' | 'investigacion';

export const PANTALLAS: Pantalla[] = ['corrida', 'hipotesis', 'ranking', 'panorama', 'mundo', 'arbol', 'atlas', 'mecanismos', 'citas', 'artefactos', 'calidad', 'investigacion'];

export type Ruta =
  | { tipo: 'inicio' }
  | { tipo: 'asistente' }
  | { tipo: 'nueva' }
  | { tipo: 'ajustes' }
  // «Al laboratorio» no cuelga de una investigación: reúne lo que ROSA2018 ha
  // verificado en TODAS. Por eso es una ruta propia y no una pantalla más.
  | { tipo: 'laboratorio'; dianaId: string | null; panel: 'aso' | null }
  | { tipo: 'investigacion'; investigacionId: string; pantalla: Pantalla; detalleId: string | null };

function esPantalla(valor: string): valor is Pantalla {
  return (PANTALLAS as string[]).includes(valor);
}

/** Interpreta el hash. Lo que no se reconoce va al inicio: nunca se pinta
 *  una pantalla en blanco por una URL vieja. */
export function parsearRuta(hash: string): Ruta {
  const limpio = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (limpio === '') return { tipo: 'inicio' };
  let partes: string[];
  try {
    partes = limpio.split('/').map((p) => decodeURIComponent(p));
  } catch {
    return { tipo: 'inicio' }; // un % suelto en la URL no tumba la aplicacion
  }
  if (partes[0] === 'asistente') return { tipo: 'asistente' };
  if (partes[0] === 'nueva') return { tipo: 'nueva' };
  if (partes[0] === 'ajustes') return { tipo: 'ajustes' };
  // #/laboratorio/<uniprot>/aso abre directo el oligonucleótido, para poder
  // enlazarlo y para que se pueda llegar desde el muro sin dar tres pasos.
  if (partes[0] === 'laboratorio') return { tipo: 'laboratorio', dianaId: partes[1] ?? null, panel: partes[2] === 'aso' ? 'aso' : null };
  if (partes[0] === 'investigaciones' && partes[1]) {
    // "Qué desbloquea más" se retiró el 25 de septiembre de 2026 (a petición de
    // Emir: ya hay bastantes apartados que dicen si una hipótesis es buena). Un
    // enlace guardado a esa pantalla lleva a las hipótesis de la misma
    // investigación en vez de a la página de inicio.
    // Enlaces guardados de cuando «Al laboratorio» colgaba de una
    // investigación (29 de septiembre de 2026): llevan al laboratorio global,
    // que es donde está ahora lo que enseñaban.
    if (partes[2] === 'laboratorio') return { tipo: 'laboratorio', dianaId: partes[3] ?? null, panel: null };
    // La cola de hipótesis se mudó al ranking el 1 de octubre de 2026 (Emir):
    // las dos pantallas enseñaban la misma lista con otro orden. La LISTA se
    // va, la FICHA se queda donde estaba, que es lo que mantiene vivos los
    // treinta enlaces repartidos por el árbol, el atlas, la búsqueda, calidad,
    // mecanismos y los eventos del inicio.
    //   hipotesis               -> ranking/pendientes
    //   hipotesis/laboratorio   -> ranking/laboratorio
    //   hipotesis/<id>          -> se queda (es la ficha)
    if (partes[2] === 'hipotesis' && (partes[3] === undefined || partes[3] === 'laboratorio')) {
      return { tipo: 'investigacion', investigacionId: partes[1], pantalla: 'ranking', detalleId: partes[3] ?? 'pendientes' };
    }
    const pantalla = partes[2] === 'desbloqueo' ? 'ranking' : (partes[2] ?? 'corrida');
    if (!esPantalla(pantalla)) return { tipo: 'inicio' };
    return {
      tipo: 'investigacion',
      investigacionId: partes[1],
      pantalla,
      detalleId: partes[3] ?? null,
    };
  }
  return { tipo: 'inicio' };
}

export function formatearRuta(ruta: Ruta): string {
  switch (ruta.tipo) {
    case 'inicio':
      return '#/';
    case 'asistente':
      return '#/asistente';
    case 'nueva':
      return '#/nueva';
    case 'ajustes':
      return '#/ajustes';
    case 'laboratorio': {
      if (!ruta.dianaId) return '#/laboratorio';
      const base = `#/laboratorio/${encodeURIComponent(ruta.dianaId)}`;
      return ruta.panel ? `${base}/${ruta.panel}` : base;
    }
    case 'investigacion': {
      const base = `#/investigaciones/${encodeURIComponent(ruta.investigacionId)}/${ruta.pantalla}`;
      return ruta.detalleId ? `${base}/${encodeURIComponent(ruta.detalleId)}` : base;
    }
  }
}

/** Atajo para el laboratorio, con o sin diana abierta y con o sin panel. */
export function rutaLaboratorio(dianaId: string | null = null, panel: 'aso' | null = null): string {
  return formatearRuta({ tipo: 'laboratorio', dianaId, panel });
}

/** Atajo para las pantallas de una investigacion. */
export function rutaDe(investigacionId: string, pantalla: Pantalla, detalleId: string | null = null): string {
  return formatearRuta({ tipo: 'investigacion', investigacionId, pantalla, detalleId });
}

/** Las vistas del ranking, que viajan en el hueco del detalle de la URL
 *  (`#/investigaciones/<id>/ranking/pendientes`). Van en la URL y no en un
 *  `useState` para que el aviso de pendientes, el hilo del proceso y el
 *  «volver» de una ficha puedan llevar a una vista concreta, y para que el
 *  botón atrás del navegador haga lo que se espera. */
export type VistaRanking = 'podio' | 'pendientes' | 'lista' | 'clusters' | 'laboratorio';

export const VISTAS_RANKING: VistaRanking[] = ['podio', 'pendientes', 'lista', 'clusters', 'laboratorio'];

/** La vista que toca para un `detalleId`. Lo que no sea una vista conocida
 *  cae en el podio: en esa ranura de la URL puede venir el id de una
 *  hipótesis de un enlace viejo, y vale más abrir el podio que una página en
 *  blanco. */
export function vistaDeRanking(detalleId: string | null | undefined): VistaRanking {
  return VISTAS_RANKING.includes(detalleId as VistaRanking) ? (detalleId as VistaRanking) : 'podio';
}
