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
//   #/ajustes

export type Pantalla = 'corrida' | 'hipotesis' | 'ranking' | 'panorama' | 'mundo' | 'arbol' | 'atlas' | 'mecanismos' | 'citas' | 'artefactos' | 'calidad' | 'investigacion';

export const PANTALLAS: Pantalla[] = ['corrida', 'hipotesis', 'ranking', 'panorama', 'mundo', 'arbol', 'atlas', 'mecanismos', 'citas', 'artefactos', 'calidad', 'investigacion'];

export type Ruta =
  | { tipo: 'inicio' }
  | { tipo: 'nueva' }
  | { tipo: 'ajustes' }
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
  if (partes[0] === 'nueva') return { tipo: 'nueva' };
  if (partes[0] === 'ajustes') return { tipo: 'ajustes' };
  if (partes[0] === 'investigaciones' && partes[1]) {
    // "Qué desbloquea más" se retiró el 25 de septiembre de 2026 (a petición de
    // Emir: ya hay bastantes apartados que dicen si una hipótesis es buena). Un
    // enlace guardado a esa pantalla lleva a las hipótesis de la misma
    // investigación en vez de a la página de inicio.
    const pantalla = partes[2] === 'desbloqueo' ? 'hipotesis' : (partes[2] ?? 'corrida');
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
    case 'nueva':
      return '#/nueva';
    case 'ajustes':
      return '#/ajustes';
    case 'investigacion': {
      const base = `#/investigaciones/${encodeURIComponent(ruta.investigacionId)}/${ruta.pantalla}`;
      return ruta.detalleId ? `${base}/${encodeURIComponent(ruta.detalleId)}` : base;
    }
  }
}

/** Atajo para las pantallas de una investigacion. */
export function rutaDe(investigacionId: string, pantalla: Pantalla, detalleId: string | null = null): string {
  return formatearRuta({ tipo: 'investigacion', investigacionId, pantalla, detalleId });
}
