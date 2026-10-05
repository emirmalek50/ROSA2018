import { describe, expect, it } from 'vitest';
import { enLlanoElVeredicto, enLlanoLaClase, enlaceAlPasaje, etiquetaLocalizador, trozosDeTexto, type FichaCita, type TramoCita } from './citas';
import { fijarIdioma } from './idioma';

const T = (inicio: number, fin: number, texto = ''): TramoCita => ({ inicio, fin, texto });

describe('el reparto del texto de la página en trozos resaltados', () => {
  it('parte el texto por el tramo y conserva todo el contenido, en orden', () => {
    const texto = 'Antes del pasaje. El pasaje que cita. Después del pasaje.';
    const trozos = trozosDeTexto(texto, [T(18, 36)]);
    expect(trozos.map((t) => t.texto).join('')).toBe(texto);
    expect(trozos.map((t) => t.marcado)).toEqual([false, true, false]);
    expect(trozos[1]!.texto).toBe('El pasaje que cita');
  });

  it('marca varios tramos de una cita con elisión, en orden y sin perder lo de en medio', () => {
    const texto = 'uno dos tres cuatro cinco seis';
    const trozos = trozosDeTexto(texto, [T(0, 7), T(20, 25)]);
    expect(trozos.map((t) => t.texto).join('')).toBe(texto);
    expect(trozos.filter((t) => t.marcado).map((t) => t.texto)).toEqual(['uno dos', 'cinco']);
    expect(trozos.map((t) => t.marcado)).toEqual([true, false, true, false]);
  });

  it('un tramo que empieza al principio o acaba al final no deja trozos vacíos', () => {
    expect(trozosDeTexto('abcdef', [T(0, 6)])).toEqual([{ texto: 'abcdef', marcado: true }]);
    expect(trozosDeTexto('abcdef', [T(0, 3)]).length).toBe(2);
    expect(trozosDeTexto('abcdef', [T(3, 6)]).length).toBe(2);
    expect(trozosDeTexto('abcdef', []).map((t) => t.texto)).toEqual(['abcdef']);
  });

  it('dos tramos que se solapan o se tocan se funden en uno', () => {
    const trozos = trozosDeTexto('abcdefghij', [T(2, 6), T(4, 8)]);
    expect(trozos.filter((t) => t.marcado).map((t) => t.texto)).toEqual(['cdefgh']);
    const pegados = trozosDeTexto('abcdefghij', [T(2, 5), T(5, 8)]);
    expect(pegados.filter((t) => t.marcado).map((t) => t.texto)).toEqual(['cdefgh']);
  });

  it('los tramos desordenados se ordenan solos', () => {
    const trozos = trozosDeTexto('uno dos tres', [T(8, 12), T(0, 3)]);
    expect(trozos.filter((t) => t.marcado).map((t) => t.texto)).toEqual(['uno', 'tres']);
  });

  it('un tramo imposible no desplaza el texto: se descarta y se pinta entero', () => {
    const texto = 'un texto corto';
    for (const malo of [T(-5, 3), T(10, 4), T(5, 5), T(99, 120), T(Number.NaN, 4), T(2, Number.NaN)]) {
      const trozos = trozosDeTexto(texto, [malo]);
      expect(trozos.map((t) => t.texto).join('')).toBe(texto);
    }
    // El que se sale por el final se recorta al texto, no lo alarga.
    const recortado = trozosDeTexto(texto, [T(9, 99)]);
    expect(recortado.map((t) => t.texto).join('')).toBe(texto);
    expect(recortado.filter((t) => t.marcado).map((t) => t.texto)).toEqual(['corto']);
  });

  it('con texto vacío no hay trozos', () => {
    expect(trozosDeTexto('', [T(0, 3)])).toEqual([]);
  });
});

describe('cómo se nombra en llano de qué se apoya una cita', () => {
  it('traduce los rótulos sin cambiar el número ni el nombre literal de la sección', () => {
    try {
      fijarIdioma('en');
      expect(enLlanoLaClase('pagina', 'pág. 3508')).toBe('p. 3508');
      expect(enLlanoLaClase('seccion', 'sección Resultados')).toBe('section Resultados, no page number');
      expect(etiquetaLocalizador('texto web, parte 4')).toBe('web text, part 4');
      expect(etiquetaLocalizador('resumen')).toBe('abstract');
      expect(etiquetaLocalizador('Results section')).toBe('Results section');
    } finally { fijarIdioma('es'); }
  });
  it('la página se nombra tal cual y lo demás dice que no tiene número de página', () => {
    expect(enLlanoLaClase('pagina', 'pág. 3508')).toBe('pág. 3508');
    expect(enLlanoLaClase('resumen', 'resumen')).toContain('sin número de página');
    expect(enLlanoLaClase('seccion', 'sección Resultados')).toContain('sin número de página');
    expect(enLlanoLaClase('web', 'texto web, parte 2')).toContain('sin número de página');
    expect(enLlanoLaClase('otro', '')).toBe('sin localizador');
  });

  it('cada veredicto del verificador tiene su nombre en llano y su tono', () => {
    expect(enLlanoElVeredicto('sostenida')).toEqual({ texto: 'sostenida', tono: 'bien' });
    expect(enLlanoElVeredicto('no_sostenida').tono).toBe('mal');
    expect(enLlanoElVeredicto('parcial').tono).toBe('medio');
    expect(enLlanoElVeredicto('cita_no_resuelve').texto).toBe('la cita no resuelve');
    expect(enLlanoElVeredicto('ausencia_refutada').tono).toBe('mal');
    expect(enLlanoElVeredicto('sin_verificar')).toEqual({ texto: 'sin verificar', tono: 'medio' });
    // Uno que no conozcamos se enseña tal cual, no se inventa.
    expect(enLlanoElVeredicto('raro_nuevo').texto).toBe('raro_nuevo');
  });
});

describe('el enlace que lleva al texto, no solo al documento', () => {
  const base = {
    clase: 'pagina' as const,
    pagina: 3508,
    url: '',
    conPdf: true,
    afirmacion: { pasaje: 'Plasma GFAP was associated with amyloid beta PET burden independently of tau PET in the cohort' } as FichaCita['afirmacion'],
    fuente: { doi: '10.1093/brain/awab223', pmid: '34273149' } as FichaCita['fuente'],
  };

  it('en un PDF lleva a la página exacta y NO pide una búsqueda que el visor ignora', () => {
    const r = enlaceAlPasaje(base, '/api/corridas/c/citas/af-1/pdf');
    expect(r).toBe('/api/corridas/c/citas/af-1/pdf#page=3508');
    // `search=` no lo lee el visor de Chrome (solo nameddest, navpanes, page,
    // toolbar, view y zoom), así que prometía una marca que nunca llegaba.
    expect(r).not.toContain('search=');
  });

  it('si el PDF lleva token, el ancla se añade sin romper la dirección', () => {
    const r = enlaceAlPasaje(base, '/api/corridas/c/citas/af-1/pdf?token=abc');
    expect(r.startsWith('/api/corridas/c/citas/af-1/pdf?token=abc#page=3508')).toBe(true);
  });

  it('un PDF sin página conocida se abre tal cual, sin ancla inventada', () => {
    expect(enlaceAlPasaje({ ...base, pagina: null }, '/x.pdf')).toBe('/x.pdf');
    expect(enlaceAlPasaje({ ...base, pagina: null, afirmacion: { pasaje: '' } as FichaCita['afirmacion'] }, '/x.pdf')).toBe('/x.pdf');
  });

  it('si el PDF no está guardado no se inventa una dirección de PDF: se va a la fuente', () => {
    const r = enlaceAlPasaje({ ...base, conPdf: false }, '/x.pdf');
    expect(r.startsWith('https://doi.org/10.1093/brain/awab223')).toBe(true);
    expect(r).not.toContain('/x.pdf');
    expect(r).not.toContain('page=');
  });

  it('en una página web ancla por el PRINCIPIO del pasaje, con un solo trozo', () => {
    const r = enlaceAlPasaje({ ...base, clase: 'web', conPdf: false, pagina: null, url: 'https://ejemplo.org/articulo' });
    expect(r.startsWith('https://ejemplo.org/articulo#:~:text=')).toBe(true);
    const trozo = r.split('#:~:text=')[1]!;
    // Un ancla, no un rango `inicio,fin`: el rango exige que casen los dos
    // extremos y basta que falle uno para que no se resalte nada.
    expect(trozo.split(',').length).toBe(1);
    expect(decodeURIComponent(trozo)).toBe('Plasma GFAP was associated with amyloid beta PET burden independently of tau');
  });

  it('el ancla empieza donde empieza el pasaje, para no dejar al lector en mitad', () => {
    const r = enlaceAlPasaje({ ...base, clase: 'web', conPdf: false, pagina: null, url: 'https://ejemplo.org/a' });
    expect(decodeURIComponent(r.split('#:~:text=')[1]!).startsWith('Plasma GFAP')).toBe(true);
  });

  it('si el pasaje arranca con algo inestable, se cae al tramo estable más largo', () => {
    const r = enlaceAlPasaje({
      ...base,
      clase: 'web',
      conPdf: false,
      pagina: null,
      url: 'https://ejemplo.org/a',
      afirmacion: { pasaje: '95 % de los casos mostraron reduccion sostenida de amiloide' } as FichaCita['afirmacion'],
    });
    // "%" se queda fuera: un espacio de más ahí no lo normaliza nadie.
    expect(decodeURIComponent(r.split('#:~:text=')[1]!)).toBe('de los casos mostraron reduccion sostenida de amiloide');
  });

  it('un pasaje corto va entero en el ancla, sin partirlo en dos', () => {
    const r = enlaceAlPasaje({ ...base, clase: 'web', conPdf: false, url: 'https://ejemplo.org/a', afirmacion: { pasaje: 'sube el GFAP en plasma' } as FichaCita['afirmacion'] });
    expect(r).toBe('https://ejemplo.org/a#:~:text=sube%20el%20GFAP%20en%20plasma');
    expect(r.split(',').length).toBe(1);
  });

  it('la coma y el guion nunca llegan crudos al ancla: ahí significan otra cosa', () => {
    const r = enlaceAlPasaje({
      ...base,
      clase: 'web',
      conPdf: false,
      pagina: null,
      url: 'https://ejemplo.org/a',
      afirmacion: { pasaje: 'p-tau181, GFAP y NfL subieron en plasma de forma sostenida' } as FichaCita['afirmacion'],
    });
    const trozo = r.split('#:~:text=')[1]!;
    expect(trozo.split(',').length).toBe(1);
    expect(trozo).not.toContain('-');
    // El ancla se toma del tramo estable: "p-tau181," y su coma quedan fuera.
    expect(decodeURIComponent(trozo)).toBe('GFAP y NfL subieron en plasma de forma sostenida');
  });

  it('una cita al resumen también intenta el salto al texto: el resumen suele estar en la página del artículo', () => {
    const r = enlaceAlPasaje({ ...base, clase: 'resumen', conPdf: false, pagina: null, url: '' });
    expect(r.startsWith('https://doi.org/10.1093/brain/awab223#:~:text=')).toBe(true);
  });

  it('sin pasaje con el que señalar no se ancla nada: se abre la fuente y punto', () => {
    const r = enlaceAlPasaje({ ...base, conPdf: false, pagina: null, url: '', afirmacion: { pasaje: 'dos palabras' } as FichaCita['afirmacion'] });
    expect(r).toBe('https://doi.org/10.1093/brain/awab223');
  });

  it('con una dirección que redirige (un doi) se ancla igual: el ancla sobrevive al salto o la página abre por arriba', () => {
    const r = enlaceAlPasaje({ ...base, clase: 'web', conPdf: false, pagina: null, url: 'https://doi.org/10.1001/jamaneurol.2022.2793' });
    expect(r.startsWith('https://doi.org/10.1001/jamaneurol.2022.2793#:~:text=')).toBe(true);
  });

  it('sin nada a donde ir devuelve vacío en vez de un enlace roto', () => {
    expect(enlaceAlPasaje({ ...base, conPdf: false, url: '', fuente: {} as FichaCita['fuente'] })).toBe('');
  });
});
