// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarDocumento, crearAjustadorTextos, type LimitesTexto, type RectanguloTexto } from './textos';

let raiz: HTMLDivElement, limites: LimitesTexto, obstaculos: RectanguloTexto[], lecturas: number;
const ajustes: ReturnType<typeof crearAjustadorTextos>[] = [];
const num = (el: HTMLElement, prop: string) => Number.parseFloat(el.style.getPropertyValue(prop));
function documento(sala = 'r7', texto = 'El ensayo registrado compara MAPT con su control', altura: number | ((ancho: number) => number) = 76) {
  const el = document.createElement('div'); el.className = 'lv-documento';
  const cuarto = sala === 'r4' ? [0, 608, 432, 312] as const : [440, 608, 624, 144] as const;
  el.style.cssText = sala === 'r4' ? 'left:12px;top:650px;width:390px;max-height:38px' : 'left:770px;top:618px;width:270px;max-height:38px';
  Object.defineProperties(el, {
    offsetLeft: { get: () => num(el, 'left') }, offsetTop: { get: () => num(el, 'top') },
    offsetWidth: { get: () => { lecturas++; return num(el, 'width'); } },
    offsetHeight: { get: () => { lecturas++; return typeof altura === 'number' ? altura : altura(num(el, 'width')); } },
  });
  raiz.append(el); configurarDocumento(el, sala, cuarto); el.textContent = texto; el.title = texto;
  return el;
}
function ajustar() {
  const a = crearAjustadorTextos(raiz, () => limites, () => obstaculos); ajustes.push(a); a.actualizar(); return a;
}
function dentro(el: HTMLElement, alto: number) {
  expect(num(el, 'left')).toBeGreaterThanOrEqual(limites.izq);
  expect(num(el, 'left') + num(el, 'width')).toBeLessThanOrEqual(limites.der);
  expect(num(el, 'top')).toBeGreaterThanOrEqual(limites.arr);
  expect(num(el, 'top') + alto).toBeLessThanOrEqual(limites.aba);
}
beforeEach(() => {
  raiz = document.createElement('div'); document.body.append(raiz); lecturas = 0;
  limites = { izq: 0, arr: 0, der: 1064, aba: 1312 }; obstaculos = [];
  vi.stubGlobal('ResizeObserver', undefined);
});
afterEach(() => { ajustes.splice(0).forEach(a => a.limpiar()); raiz.remove(); vi.unstubAllGlobals(); });

describe('los documentos conservan líneas completas dentro de la cámara', () => {
  it('registra la posición antes de recibir el contenido y elimina el tope que cortaba la segunda línea', () => {
    const el = documento(); ajustar();
    expect(el.dataset.sala).toBe('r7'); expect(el.style.maxHeight).toBe('none'); expect(el.style.overflow).toBe('visible');
    expect(el.textContent).toBe('El ensayo registrado compara MAPT con su control'); dentro(el, 76);
  });

  it.each(['r4', 'r7'])('el texto en %s cabe por completo al acercar la cámara sin cambiar títulos o citas', sala => {
    const texto = 'Treatment comparison: NCT00000001, phase 2. The citation remains exactly as recorded.';
    const el = documento(sala, texto, w => w < 220 ? 108 : 76);
    limites = sala === 'r4' ? { izq: 0, arr: 630, der: 300, aba: 820 } : { izq: 790, arr: 608, der: 1030, aba: 800 };
    ajustar(); dentro(el, num(el, 'width') < 220 ? 108 : 76);
    expect(el.style.maxHeight).toBe('none'); expect(el.textContent).toBe(texto); expect(el.title).toBe(texto);
  });

  it('no arrastra a la cámara el documento de una sala que ya no está visible', () => {
    const el = documento('r4'); const a = ajustar();
    limites = { izq: 770, arr: 608, der: 1040, aba: 752 }; a.actualizar();
    expect(num(el, 'left')).toBe(12); expect(num(el, 'top')).toBe(650); expect(num(el, 'width')).toBe(390);
    expect(el.style.maxHeight).toBe('none');
  });

  it('el tribunal utiliza un hueco alternativo cuando el lugar original invade las caras', () => {
    const el = documento('r4', 'Dos líneas completas del resultado registrado', 48);
    obstaculos = [{ x: 0, y: 664, w: 432, h: 72 }]; ajustar();
    const y = num(el, 'top'); expect(y + 48 <= 664 || y >= 736).toBe(true); dentro(el, 48);
  });

  it('el expediente de Novedad encuentra el espacio entre los dos especialistas', () => {
    const el = documento('r7', 'La fuente diferencia dosis y vía de administración', w => w < 240 ? 80 : 60);
    obstaculos = [{ x: 580, y: 664, w: 48, h: 64 }, { x: 860, y: 664, w: 48, h: 64 }]; ajustar();
    const x = num(el, 'left'); expect(x).toBeGreaterThanOrEqual(628); expect(x + num(el, 'width')).toBeLessThanOrEqual(860);
    expect(el.style.maxHeight).toBe('none'); dentro(el, 80);
  });

  it('un informe largo puede flotar sobre los especialistas sin tapar cuerpos, nombres o cabecera', () => {
    const el = documento('r7', 'The complete report includes the exact sources, treatment differences and limitations.', 132);
    obstaculos = [
      { x: 448, y: 616, w: 310, h: 32 },
      { x: 580, y: 664, w: 48, h: 64 }, { x: 554, y: 730, w: 100, h: 36 },
      { x: 860, y: 664, w: 48, h: 64 }, { x: 834, y: 730, w: 100, h: 36 },
      { x: 448, y: 768, w: 400, h: 36 },
    ]; ajustar(); dentro(el, 132);
    const x = num(el, 'left'), y = num(el, 'top'), w = num(el, 'width');
    for (const r of obstaculos) expect(x + w <= r.x || x >= r.x + r.w || y + 132 <= r.y || y >= r.y + r.h).toBe(true);
    expect(el.style.maxHeight).toBe('none'); expect(num(el, 'top')).toBeLessThan(608);
  });

  it('si los nombres ocupan el corredor del tribunal busca otra posición antes de taparlos', () => {
    const el = documento('r4', 'Comparación completa entre dos hipótesis, conservando el resultado registrado.', 103);
    obstaculos = [{ x: 8, y: 616, w: 260, h: 26 }, { x: 0, y: 664, w: 432, h: 110 }, { x: 0, y: 792, w: 432, h: 102 }];
    ajustar(); dentro(el, 103);
    const x = num(el, 'left'), y = num(el, 'top'), w = num(el, 'width');
    for (const r of obstaculos) expect(x + w <= r.x || x >= r.x + r.w || y + 103 <= r.y || y >= r.y + r.h).toBe(true);
    expect(el.style.overflow).toBe('visible');
  });

  it('si el texto supera la ventana conserva todas las líneas con desplazamiento accesible', () => {
    const texto = 'Registered evidence and exact citations '.repeat(25), el = documento('r7', texto, 500);
    limites = { izq: 760, arr: 608, der: 1044, aba: 808 }; ajustar();
    expect(el.style.overflow).toBe('auto'); expect(num(el, 'max-height')).toBeLessThanOrEqual(200);
    expect(el.tabIndex).toBe(0); expect(el.getAttribute('aria-label')).toBe(texto); expect(el.textContent).toBe(texto);
    expect(el.dataset.desplazable).toBe('true');
  });

  it('al volver a caber o salir de cámara elimina las señales de desplazamiento', () => {
    const el = documento('r7', 'Complete document', 500);
    limites = { izq: 760, arr: 608, der: 1044, aba: 808 }; const a = ajustar();
    expect(el.dataset.desplazable).toBe('true');
    limites = { izq: 440, arr: 0, der: 1064, aba: 1312 }; a.actualizar();
    expect(el.dataset.desplazable).toBeUndefined(); expect(el.hasAttribute('tabindex')).toBe(false);
    limites = { izq: 760, arr: 608, der: 1044, aba: 808 }; a.actualizar();
    expect(el.dataset.desplazable).toBe('true');
    limites = { izq: 0, arr: 0, der: 432, aba: 600 }; a.actualizar();
    expect(el.dataset.desplazable).toBeUndefined(); expect(el.style.maxHeight).toBe('none');
  });

  it('sin documentos evita consultar las geometrías de agentes y deja de hacerlo después de retirar el último', () => {
    const caras = vi.fn(() => []), a = crearAjustadorTextos(raiz, () => limites, caras); ajustes.push(a);
    for (let i = 0; i < 20; i++) a.actualizar();
    expect(caras).not.toHaveBeenCalled();
    const el = documento(); a.actualizar(); expect(caras).toHaveBeenCalledTimes(1);
    el.remove(); for (let i = 0; i < 20; i++) a.actualizar();
    expect(caras).toHaveBeenCalledTimes(1);
  });

  it('con zoom y ficha usa un hueco libre con scroll si el informe entero taparía etiquetas o cabeceras', () => {
    const texto = 'The report distinguishes exact treatment matches, routes, doses, original sources and documented limitations.';
    const el = documento('r7', texto, w => w < 220 ? 260 : 132);
    limites = { izq: 353, arr: 510, der: 887, aba: 1167 };
    obstaculos = [
      { x: 520, y: 538, w: 104, h: 36 }, { x: 448, y: 624, w: 228, h: 27 },
      { x: 580, y: 664, w: 48, h: 64 }, { x: 554, y: 730, w: 100, h: 28 },
      { x: 860, y: 664, w: 48, h: 64 }, { x: 834, y: 730, w: 100, h: 28 },
      { x: 448, y: 768, w: 440, h: 34 }, { x: 646, y: 778, w: 152, h: 126 },
      ...[596, 680, 764, 848].flatMap(x => [{ x, y: 808, w: 48, h: 64 }, { x: x - 26, y: 874, w: 100, h: 36 }]),
      ...[356, 508, 660, 812].flatMap(x => [{ x, y: 998, w: 48, h: 64 }, { x: x - 26, y: 1066, w: 100, h: 36 }]),
    ]; ajustar();
    expect(el.dataset.desplazable).toBe('true'); expect(el.tabIndex).toBe(0); expect(el.textContent).toBe(texto);
    const x = num(el, 'left'), y = num(el, 'top'), w = num(el, 'width'), h = num(el, 'max-height');
    expect(h).toBeGreaterThanOrEqual(64); expect(h).toBeLessThan(132); dentro(el, h);
    for (const r of obstaculos) expect(x + w <= r.x || x >= r.x + r.w || y + h <= r.y || y >= r.y + r.h).toBe(true);
  });

  it('leer el papel o su scroll no propaga el click que cierra el zoom, sin interceptar la rueda', () => {
    const el = document.createElement('div'); el.className = 'lv-documento'; raiz.append(el);
    const cerrarZoom = vi.fn(), rueda = vi.fn(), registrar = vi.spyOn(el, 'addEventListener');
    raiz.addEventListener('click', cerrarZoom); raiz.addEventListener('wheel', rueda);
    configurarDocumento(el, 'r7', [440, 608, 624, 144]); configurarDocumento(el, 'r7', [440, 608, 624, 144]);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(cerrarZoom).not.toHaveBeenCalled(); expect(rueda).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it('el tribunal puede estrechar el informe con la ficha abierta y conservar todo el texto sin tapar la escena', () => {
    const texto = 'Las fuentes y las limitaciones quedan adjuntas al informe. La comparación conserva las diferencias y el resultado registrado.';
    const el = documento('r4', texto, w => w <= 180 ? 240 : w <= 240 ? 180 : 103);
    limites = { izq: 0, arr: 379, der: 500, aba: 1035 };
    obstaculos = [
      { x: 8, y: 616, w: 260, h: 26 }, { x: 448, y: 616, w: 360, h: 26 },
      { x: 63, y: 640, w: 152, h: 136 },
      { x: 232, y: 344, w: 48, h: 64 }, { x: 206, y: 410, w: 100, h: 36 },
      { x: 32, y: 424, w: 48, h: 64 }, { x: 6, y: 490, w: 100, h: 36 },
      { x: 6, y: 580, w: 494, h: 22 },
      ...[10, 80, 150, 210, 298].flatMap(x => [{ x, y: 672, w: 48, h: 64 }, { x: x - 26, y: 738, w: 100, h: 36 }]),
      ...[10, 80, 150, 220, 290].flatMap(x => [{ x, y: 792, w: 48, h: 64 }, { x: x - 26, y: 858, w: 100, h: 36 }]),
      { x: 8, y: 936, w: 300, h: 26 },
    ]; ajustar();
    expect(num(el, 'width')).toBeLessThanOrEqual(240); expect(el.textContent).toBe(texto); expect(el.title).toBe(texto);
    const x = num(el, 'left'), y = num(el, 'top'), w = num(el, 'width');
    const h = el.dataset.desplazable === 'true' ? num(el, 'max-height') : w <= 180 ? 240 : 180;
    dentro(el, h);
    for (const r of obstaculos) expect(x + w <= r.x || x >= r.x + r.w || y + h <= r.y || y >= r.y + r.h).toBe(true);
  });

  it('no vuelve a medir el layout en cada frame cuando cámara y contenido permanecen iguales', () => {
    documento(); const a = ajustar(), inicial = lecturas;
    for (let i = 0; i < 120; i++) a.actualizar();
    expect(lecturas).toBe(inicial);
  });

  it('un resultado nuevo invalida la altura y un documento retirado no recibe más ajustes', async () => {
    let altura = 44; const el = documento('r7', 'A preliminary registered result', () => altura), a = ajustar(), inicial = lecturas;
    altura = 96; el.textContent = 'The longer English result includes the original study citation.'; await Promise.resolve(); a.actualizar();
    expect(lecturas).toBeGreaterThan(inicial); dentro(el, 96);
    el.remove(); await Promise.resolve(); const retirado = lecturas; a.actualizar(); expect(lecturas).toBe(retirado);
    a.limpiar(); limites = { izq: 0, arr: 0, der: 10, aba: 10 }; a.actualizar(); expect(lecturas).toBe(retirado);
  });
});
