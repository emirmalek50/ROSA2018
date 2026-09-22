import { describe, expect, it } from 'vitest';
import { enLlanoElVeredicto, enLlanoLaClase, trozosDeTexto, type TramoCita } from './citas';

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
    // Uno que no conozcamos se enseña tal cual, no se inventa.
    expect(enLlanoElVeredicto('raro_nuevo').texto).toBe('raro_nuevo');
  });
});
