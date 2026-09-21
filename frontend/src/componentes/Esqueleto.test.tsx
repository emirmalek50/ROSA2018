// @vitest-environment jsdom
// Los esqueletos de carga: cada variante pinta su silueta, el contenedor de
// la espera lleva aria-busy y un rótulo oculto, los bloques quedan fuera del
// árbol accesible, y el CSS apaga el brillo con movimiento reducido.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cargando, Esqueleto, EsqueletoAplicacion, EsqueletoFilas, EsqueletoPantalla, EsqueletoTarjeta, EsqueletoTexto } from './Esqueleto';

let root: Root;
let nodo: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
});
async function montar(elemento: JSX.Element) {
  await act(async () => root.render(elemento));
}
/** El texto que un lector de pantalla encontraría: todo lo que no está aria-hidden. */
function textoAccesible(raiz: Element): string {
  const clon = raiz.cloneNode(true) as Element;
  for (const oculto of clon.querySelectorAll('[aria-hidden="true"]')) oculto.remove();
  return (clon.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('Esqueleto, el bloque base', () => {
  it('es un bloque gris oculto al lector de pantalla, con medidas en línea', async () => {
    await montar(<Esqueleto ancho={120} alto="2rem" radio={6} className="extra" />);
    const bloque = nodo.querySelector('.esqueleto') as HTMLElement;
    expect(bloque.classList.contains('extra')).toBe(true);
    expect(bloque.getAttribute('aria-hidden')).toBe('true');
    expect(bloque.style.width).toBe('120px');
    expect(bloque.style.height).toBe('2rem');
    expect(bloque.style.borderRadius).toBe('6px');
    expect(bloque.textContent).toBe('');
  });
  it('sin medidas no deja estilos en línea, y aria-hidden=false lo deja visible al lector', async () => {
    await montar(<Esqueleto aria-hidden={false} />);
    const bloque = nodo.querySelector('.esqueleto') as HTMLElement;
    expect(bloque.getAttribute('style')).toBeNull();
    expect(bloque.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('EsqueletoTexto, EsqueletoFilas y EsqueletoTarjeta', () => {
  it('pinta las líneas pedidas con la última corta', async () => {
    await montar(<EsqueletoTexto lineas={4} />);
    const lineas = nodo.querySelectorAll('.esqueleto-linea');
    expect(lineas.length).toBe(4);
    expect(lineas[3]?.classList.contains('esqueleto-linea-corta')).toBe(true);
    expect(lineas[0]?.classList.contains('esqueleto-linea-corta')).toBe(false);
  });
  it('con ultimaCorta=false todas las líneas miden lo mismo y nunca hay menos de una', async () => {
    await montar(<EsqueletoTexto lineas={0} ultimaCorta={false} />);
    expect(nodo.querySelectorAll('.esqueleto-linea').length).toBe(1);
    expect(nodo.querySelector('.esqueleto-linea-corta')).toBeNull();
  });
  it('las filas tienen tantas celdas como columnas y la rejilla en línea', async () => {
    await montar(<EsqueletoFilas filas={3} columnas={4} />);
    const filas = nodo.querySelectorAll('.esqueleto-fila');
    expect(filas.length).toBe(3);
    for (const fila of filas) {
      expect(fila.querySelectorAll('.esqueleto-celda').length).toBe(4);
      expect((fila as HTMLElement).style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    }
  });
  it('los valores por defecto de las filas son cinco por tres', async () => {
    await montar(<EsqueletoFilas />);
    expect(nodo.querySelectorAll('.esqueleto-fila').length).toBe(5);
    expect(nodo.querySelectorAll('.esqueleto-celda').length).toBe(15);
  });
  it('la tarjeta usa la clase real de la maqueta y el título es opcional', async () => {
    await montar(<EsqueletoTarjeta lineas={2} />);
    const tarjeta = nodo.querySelector('.tarjeta.esqueleto-tarjeta');
    expect(tarjeta).not.toBeNull();
    expect(tarjeta?.querySelector('.esqueleto-titulo')).not.toBeNull();
    expect(tarjeta?.querySelectorAll('.esqueleto-linea').length).toBe(2);
    await montar(<EsqueletoTarjeta conTitulo={false} />);
    expect(nodo.querySelector('.esqueleto-titulo')).toBeNull();
  });
});

describe('EsqueletoPantalla', () => {
  for (const variante of ['lista', 'ficha', 'figura', 'panel'] as const) {
    it(`la variante ${variante} ocupa el contenido, lleva aria-busy y solo dice "Cargando" al lector`, async () => {
      await montar(<EsqueletoPantalla variante={variante} rotulo="el ranking" />);
      const pantalla = nodo.firstElementChild as HTMLElement;
      expect(pantalla.classList.contains('contenido')).toBe(true);
      expect(pantalla.classList.contains('esqueleto-pantalla')).toBe(true);
      expect(pantalla.getAttribute('aria-busy')).toBe('true');
      expect(pantalla.getAttribute('role')).toBe('status');
      const rotulo = pantalla.querySelector('.sr-only');
      expect(rotulo?.textContent).toBe('Cargando el ranking');
      expect(textoAccesible(pantalla)).toBe('Cargando el ranking');
      expect(pantalla.querySelector('.pantalla-cabecera')).not.toBeNull();
      expect(pantalla.querySelectorAll('.esqueleto').length).toBeGreaterThan(3);
    });
  }
  it('cada variante tiene la silueta de su forma', async () => {
    await montar(<EsqueletoPantalla variante="lista" />);
    expect(nodo.querySelectorAll('.esqueleto-fila').length).toBe(8);
    await montar(<EsqueletoPantalla variante="figura" />);
    expect(nodo.querySelector('.esqueleto-figura')).not.toBeNull();
    expect(nodo.querySelectorAll('.esqueleto-chip').length).toBe(3);
    await montar(<EsqueletoPantalla variante="panel" />);
    expect(nodo.querySelectorAll('.tarjeta').length).toBe(3);
    expect(nodo.querySelector('.rejilla-2')).not.toBeNull();
    await montar(<EsqueletoPantalla variante="ficha" />);
    expect(nodo.querySelectorAll('.tarjeta').length).toBe(1);
    expect(nodo.querySelectorAll('.esqueleto-fila').length).toBe(5);
  });
  it('sin rótulo anuncia "Cargando la pantalla"', async () => {
    await montar(<EsqueletoPantalla variante="lista" />);
    expect(nodo.querySelector('.sr-only')?.textContent).toBe('Cargando la pantalla');
  });
});

describe('EsqueletoAplicacion, la maqueta entera para la carga inicial', () => {
  it('pinta barra lateral con logotipo, búsqueda y cuatro investigaciones, cabecera y contenido con tarjetas', async () => {
    await montar(<EsqueletoAplicacion />);
    const app = nodo.firstElementChild as HTMLElement;
    expect(app.classList.contains('app')).toBe(true);
    expect(app.getAttribute('aria-busy')).toBe('true');
    expect(textoAccesible(app)).toBe('Cargando ROSA2018');
    const barra = app.querySelector('.barra') as HTMLElement;
    expect(barra.querySelector('.marca img')?.getAttribute('src')).toBe('/arbol-marca.png');
    expect(barra.querySelector('.esqueleto-buscar')).not.toBeNull();
    expect(barra.querySelectorAll('.nav-inv').length).toBe(4);
    expect(app.querySelector('.principal .cabecera')).not.toBeNull();
    const contenido = app.querySelector('.principal .contenido') as HTMLElement;
    expect(contenido.querySelector('.pantalla-cabecera')).not.toBeNull();
    expect(contenido.querySelectorAll('.tarjeta').length).toBeGreaterThanOrEqual(2);
    expect(contenido.querySelectorAll('.tarjeta').length).toBeLessThanOrEqual(3);
    expect(app.querySelector('form')).toBeNull();
    expect(app.querySelector('a')).toBeNull();
    expect(app.querySelector('button')).toBeNull();
  });
  it('acepta otro rótulo', async () => {
    await montar(<EsqueletoAplicacion rotulo="la investigación" />);
    expect(textoAccesible(nodo)).toBe('Cargando la investigación');
  });
});

describe('Cargando, el interruptor', () => {
  it('con activo pinta el esqueleto con aria-busy y rótulo, y no los hijos', async () => {
    await montar(
      <Cargando activo rotulo="las llamadas" esqueleto={<EsqueletoFilas filas={2} />}>
        <p>Contenido real</p>
      </Cargando>,
    );
    const espera = nodo.querySelector('.esqueleto-espera') as HTMLElement;
    expect(espera.getAttribute('aria-busy')).toBe('true');
    expect(espera.getAttribute('role')).toBe('status');
    expect(textoAccesible(nodo)).toBe('Cargando las llamadas');
    expect(nodo.querySelectorAll('.esqueleto-fila').length).toBe(2);
    expect(nodo.textContent).not.toContain('Contenido real');
  });
  it('sin activo pinta los hijos y ningún esqueleto ni aria-busy', async () => {
    await montar(
      <Cargando activo={false} rotulo="las llamadas" esqueleto={<EsqueletoFilas />}>
        <p>Contenido real</p>
      </Cargando>,
    );
    expect(nodo.textContent).toBe('Contenido real');
    expect(nodo.querySelector('.esqueleto')).toBeNull();
    expect(nodo.querySelector('[aria-busy]')).toBeNull();
  });
  it('con una EsqueletoPantalla no anida dos rótulos ni dos aria-busy', async () => {
    await montar(
      <Cargando activo rotulo="el árbol" esqueleto={<EsqueletoPantalla variante="figura" />}>
        <p>Contenido real</p>
      </Cargando>,
    );
    expect(nodo.querySelectorAll('[aria-busy="true"]').length).toBe(1);
    expect(nodo.querySelectorAll('.sr-only').length).toBe(1);
    expect(textoAccesible(nodo)).toBe('Cargando el árbol');
    expect(nodo.querySelector('.esqueleto-espera')).toBeNull();
  });
  it('si la EsqueletoPantalla trae su propio rótulo, ese manda', async () => {
    await montar(
      <Cargando activo rotulo="el árbol" esqueleto={<EsqueletoPantalla variante="figura" rotulo="el atlas" />}>
        <p>Contenido real</p>
      </Cargando>,
    );
    expect(textoAccesible(nodo)).toBe('Cargando el atlas');
  });
  it('al pasar de activo a no activo el contenido sustituye al esqueleto', async () => {
    const pintar = (activo: boolean) => (
      <Cargando activo={activo} rotulo="la tabla" esqueleto={<EsqueletoFilas filas={2} />}>
        <table className="tabla">
          <tbody>
            <tr>
              <td>Fila real</td>
            </tr>
          </tbody>
        </table>
      </Cargando>
    );
    await montar(pintar(true));
    expect(nodo.querySelector('.tabla')).toBeNull();
    await montar(pintar(false));
    expect(nodo.querySelector('.tabla')).not.toBeNull();
    expect(nodo.querySelector('.esqueleto')).toBeNull();
  });
});

describe('el CSS de los esqueletos', () => {
  const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
  /** Los bloques `@media (prefers-reduced-motion: reduce) { ... }` del fichero. */
  function bloquesMovimientoReducido(): string[] {
    const bloques: string[] = [];
    const patron = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
    for (const m of css.matchAll(patron)) {
      let nivel = 1;
      let i = m.index + m[0].length;
      const inicio = i;
      while (i < css.length && nivel > 0) {
        if (css[i] === '{') nivel += 1;
        else if (css[i] === '}') nivel -= 1;
        i += 1;
      }
      bloques.push(css.slice(inicio, i - 1));
    }
    return bloques;
  }
  it('define los tokens en el tema claro y en el oscuro', () => {
    const claro = css.match(/:root\s*\{[^}]*--esqueleto-base:[^}]*--esqueleto-brillo:[^}]*\}/);
    const oscuro = css.match(/:root\[data-theme='dark'\]\s*\{[^}]*--esqueleto-base:[^}]*--esqueleto-brillo:[^}]*\}/);
    expect(claro).not.toBeNull();
    expect(oscuro).not.toBeNull();
    expect(claro?.[0]).not.toBe(oscuro?.[0]);
  });
  it('el bloque brilla con una animación y el movimiento reducido la apaga', () => {
    const base = css.match(/\.esqueleto\s*\{[^}]*\}/)?.[0] ?? '';
    expect(base).toMatch(/animation:\s*esqueleto-brillo/);
    expect(css).toMatch(/@keyframes esqueleto-brillo/);
    const apagado = bloquesMovimientoReducido().some((b) => /\.esqueleto\s*\{[^}]*animation:\s*none/.test(b));
    expect(apagado).toBe(true);
  });
  it('el botón en vuelo tiene su regla, su spinner y también se apaga con movimiento reducido', () => {
    expect(css).toMatch(/\.btn\[data-en-vuelo='true'\]\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.btn\[data-en-vuelo='true'\]::before\s*\{[^}]*animation:\s*giro/);
    const apagado = bloquesMovimientoReducido().some((b) => /\.btn\[data-en-vuelo='true'\]::before\s*\{[^}]*animation:\s*none/.test(b));
    expect(apagado).toBe(true);
  });
  it('toda clase esqueleto- que usa el componente existe en styles.css', () => {
    const fuente = readFileSync(join(__dirname, 'Esqueleto.tsx'), 'utf8');
    const definidas = new Set([...css.matchAll(/\.(esqueleto[\w-]*)/g)].map((m) => m[1] ?? ''));
    // Sin los tokens (--esqueleto-base, --esqueleto-brillo), que no son clases.
    const usadas = new Set([...fuente.matchAll(/(?<!-)\b(esqueleto(?:-[a-z]+)+)\b/g)].map((m) => m[1] ?? ''));
    expect(usadas.size).toBeGreaterThan(10);
    const faltan = [...usadas].filter((c) => !definidas.has(c));
    expect(faltan).toEqual([]);
  });
});
