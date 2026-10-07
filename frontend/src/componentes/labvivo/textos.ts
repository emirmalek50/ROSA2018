export interface LimitesTexto { izq: number; arr: number; der: number; aba: number }
export interface RectanguloTexto { x: number; y: number; w: number; h: number }
type Geometria = readonly [number, number, number, number];
interface BaseDocumento { sala: string; cuarto: RectanguloTexto; x: number; y: number; ancho: number }
const bases = new WeakMap<HTMLElement, BaseDocumento>();

/** Registra el lugar preferido del papel. Su contenido puede añadirse después. */
export function configurarDocumento(el: HTMLElement, sala: string, boundsRoom: Geometria): void {
  const [x, y, w, h] = boundsRoom;
  if (!bases.has(el)) el.addEventListener('click', evento => evento.stopPropagation());
  bases.set(el, { sala, cuarto: { x, y, w, h }, x: el.offsetLeft, y: el.offsetTop,
    ancho: el.offsetWidth || Number.parseFloat(el.style.width) || 192 });
  el.dataset.sala = sala;
  el.style.setProperty('max-height', 'none', 'important');
}

const interseccion = (a: RectanguloTexto, b: RectanguloTexto): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const firmaRect = (r: RectanguloTexto): string => [r.x, r.y, r.w, r.h].map(n => Math.round(n * 4)).join(',');
const poner = (el: HTMLElement, clave: string, valor: string) => {
  if (el.style.getPropertyValue(clave) !== valor || el.style.getPropertyPriority(clave) !== 'important') el.style.setProperty(clave, valor, 'important');
};

/** Ajusta solo documentos de salas visibles. Medir un texto no anima ni cambia
 * sus palabras; el reloj de la película sigue perteneciendo al motor. */
export function crearAjustadorTextos(utileria: HTMLElement, limites: () => LimitesTexto, caras: () => RectanguloTexto[] = () => []) {
  const medidas = new Map<HTMLElement, { alturas: Map<number, number>; colocado: string }>();
  const sucios = new Set<HTMLElement>();
  let ultimaFirma = '', terminado = false;
  const mutaciones = new MutationObserver(records => {
    records.forEach(r => {
      const el = r.target instanceof Element ? r.target : r.target.parentElement;
      const doc = el?.closest<HTMLElement>('.lv-documento');
      if (doc) sucios.add(doc);
    });
    ultimaFirma = '';
  });
  mutaciones.observe(utileria, { childList: true, subtree: true, characterData: true });
  const observadorTamanos = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    entries.forEach(e => sucios.add(e.target as HTMLElement)); ultimaFirma = '';
  });

  return {
    actualizar(): void {
      if (terminado) return;
      const l = limites();
      if (![l.izq, l.arr, l.der, l.aba].every(Number.isFinite) || l.der <= l.izq || l.aba <= l.arr) return;
      const visibles: RectanguloTexto = { x: l.izq, y: l.arr, w: l.der - l.izq, h: l.aba - l.arr };
      const documentos = [...utileria.querySelectorAll<HTMLElement>('.lv-documento')].filter(el => bases.has(el));
      const presentes = new Set(documentos);
      for (const el of medidas.keys()) if (!presentes.has(el)) { observadorTamanos?.unobserve(el); medidas.delete(el); sucios.delete(el); }
      if (!documentos.length) { ultimaFirma = ''; sucios.clear(); return; }
      let nuevos = false;
      for (const el of documentos) if (!medidas.has(el)) {
        medidas.set(el, { alturas: new Map(), colocado: '' }); observadorTamanos?.observe(el); nuevos = true;
      }
      const obstaculos = caras().filter(r => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0);
      const firma = firmaRect(visibles) + '/' + obstaculos.map(firmaRect).join(';');
      if (!nuevos && !sucios.size && firma === ultimaFirma) return;
      ultimaFirma = firma;
      const ocupados = [...obstaculos];
      for (const el of documentos) {
        const base = bases.get(el)!, cache = medidas.get(el)!;
        if (sucios.delete(el)) cache.alturas.clear();
        if (!interseccion(base.cuarto, visibles)) {
          if (cache.colocado !== 'base') {
            poner(el, 'left', base.x + 'px'); poner(el, 'top', base.y + 'px'); poner(el, 'width', base.ancho + 'px');
            poner(el, 'max-height', 'none'); poner(el, 'overflow', 'visible'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); delete el.dataset.desplazable; cache.colocado = 'base';
          }
          continue;
        }
        const margen = Math.min(6, visibles.w / 4, visibles.h / 4), ancho = Math.max(1, Math.floor(Math.min(base.ancho, visibles.w - 2 * margen)));
        const altoDisponible = visibles.h - 2 * margen;
        const medir = (w: number): number => {
          poner(el, 'width', w + 'px'); poner(el, 'max-height', 'none'); poner(el, 'overflow', 'visible');
          if (!cache.alturas.has(w)) cache.alturas.set(w, el.offsetHeight);
          return cache.alturas.get(w)!;
        };
        const alto = medir(ancho);
        type Candidato = { x: number; y: number; w: number; alto: number; limite?: number };
        const candidatos: Candidato[] = [{ x: base.x, y: base.y, w: ancho, alto }];
        if (base.sala === 'r4') candidatos.push({ x: base.x, y: 752, w: ancho, alto });
        candidatos.push({ x: base.cuarto.x + 8, y: base.y, w: ancho, alto },
          { x: base.cuarto.x + base.cuarto.w - ancho - 8, y: base.cuarto.y + base.cuarto.h - alto - 8, w: ancho, alto });
        // El papel puede flotar cerca de su cuarto, como un bocadillo. Se
        // prueban bordes de obstáculos, no una rejilla ni nuevas medidas DOM.
        const entorno = { x: base.cuarto.x - ancho, y: base.cuarto.y - 240, w: base.cuarto.w + 2 * ancho, h: base.cuarto.h + 480 };
        const ys = [...new Set(ocupados.filter(r => interseccion(r, entorno)).flatMap(r => [r.y - alto - 6, r.y + r.h + 6]))]
          .sort((a, b) => Math.abs(a - base.y) - Math.abs(b - base.y)).slice(0, 20);
        const xs = [...new Set([base.x, base.cuarto.x + base.cuarto.w - ancho - 8, l.izq + margen, l.der - ancho - margen])];
        for (const y of ys) for (const x of xs) candidatos.push({ x, y, w: ancho, alto });
        if (base.sala === 'r7') {
          // Un expediente puede ocupar el espacio entre Sofía y Damián.
          const franja = { ...base.cuarto, y: base.cuarto.y + 46, h: Math.max(0, base.cuarto.h - 46) };
          const xs = ocupados.filter(r => interseccion(r, franja)).sort((a, b) => a.x - b.x);
          let desde = Math.max(base.cuarto.x + 8, l.izq + margen), mejor: { x: number; w: number } | null = null;
          for (const r of [...xs, { x: Math.min(base.cuarto.x + base.cuarto.w - 8, l.der - margen), y: 0, w: 0, h: 0 }]) {
            const w = r.x - 8 - desde;
            if (w >= 120 && (!mejor || w > mejor.w)) mejor = { x: desde, w };
            desde = Math.max(desde, r.x + r.w + 8);
          }
          if (mejor) { const w = Math.max(1, Math.floor(Math.min(ancho, mejor.w))); candidatos.push({ x: mejor.x, y: base.cuarto.y + 46, w, alto: medir(w) }); }
        }
        if (base.sala === 'r4' && ancho > 240) {
          // Con la ficha abierta una hoja de 390 px puede ocupar todas las
          // columnas. Estas dos anchuras conservan el texto mediante reflow.
          const cercanos = ocupados.filter(r => interseccion(r, entorno));
          for (const w of [240, 180]) {
            const h = medir(w);
            const bordes = [...new Set([base.x, base.cuarto.x + base.cuarto.w - w - 8, l.izq + margen, l.der - w - margen,
              ...cercanos.flatMap(r => [r.x - w - 6, r.x + r.w + 6])])]
              .map(x => Math.max(l.izq + margen, Math.min(l.der - margen - w, x)))
              .sort((a, b) => Math.abs(a - base.x) - Math.abs(b - base.x));
            for (const x of [...new Set(bordes)].slice(0, 16)) candidatos.push({ x, y: base.y, w, alto: h });
          }
        }
        const escoger = (lista: Candidato[]) => {
          let mejor: Candidato | null = null, puntuacion = Infinity, minimoSolape = Infinity;
          for (const c of lista) {
            const h = Math.min(c.alto, c.limite ?? altoDisponible);
            const rect = { x: Math.max(l.izq + margen, Math.min(l.der - margen - c.w, c.x)),
              y: Math.max(l.arr + margen, Math.min(l.aba - margen - h, c.y)), w: c.w, h };
            const solape = ocupados.reduce((n, r) => n + interseccion(rect, r), 0);
            const fuera = rect.w * rect.h - interseccion(rect, base.cuarto);
            const valor = fuera * 10 + Math.hypot(rect.x - base.x, rect.y - base.y);
            if (solape < minimoSolape || (solape === minimoSolape && valor < puntuacion)) {
              minimoSolape = solape; puntuacion = valor; mejor = { ...rect, alto: c.alto, limite: h };
            }
          }
          return { mejor, minimoSolape };
        };
        let elegido = escoger(candidatos);
        const completoLibre = elegido.minimoSolape === 0 && elegido.mejor !== null && elegido.mejor.alto <= altoDisponible;
        if (!completoLibre) {
          // Si el texto entero no tiene sitio libre, se puede leer y desplazar
          // dentro de un hueco real. Primero se buscan huecos para texto entero.
          const columnas = new Map<string, Candidato>();
          candidatos.forEach(c => {
            const x = Math.max(l.izq + margen, Math.min(l.der - margen - c.w, c.x));
            columnas.set(x + '/' + c.w, { ...c, x });
          });
          const huecos: Candidato[] = [];
          for (const c of columnas.values()) {
            const bloqueos = ocupados.filter(r => r.x < c.x + c.w && r.x + r.w > c.x)
              .map(r => [Math.max(l.arr + margen, r.y - 6), Math.min(l.aba - margen, r.y + r.h + 6)] as const)
              .filter(([desde, hasta]) => hasta > desde).sort((a, b) => a[0] - b[0]);
            let desde = l.arr + margen;
            for (const [arr, aba] of [...bloqueos, [l.aba - margen, l.aba - margen] as const]) {
              const espacio = arr - desde;
              if (espacio >= Math.min(64, altoDisponible)) {
                const h = Math.min(c.alto, espacio);
                huecos.push({ ...c, y: Math.max(desde, Math.min(arr - h, base.y)), limite: h });
              }
              desde = Math.max(desde, aba);
            }
          }
          const enteros = huecos.filter(c => c.alto <= c.limite!);
          const disponibles = enteros.length ? enteros : huecos;
          if (disponibles.length) elegido = escoger(disponibles);
        }
        const mejor = elegido.mejor;
        if (!mejor) continue;
        poner(el, 'left', mejor.x + 'px'); poner(el, 'top', mejor.y + 'px'); poner(el, 'width', mejor.w + 'px');
        const altura = mejor.limite ?? altoDisponible, scroll = mejor.alto > altura;
        poner(el, 'max-height', scroll ? altura + 'px' : 'none'); poner(el, 'overflow', scroll ? 'auto' : 'visible');
        if (scroll) { el.tabIndex = 0; el.setAttribute('aria-label', el.title || el.textContent || ''); el.dataset.desplazable = 'true'; }
        else { el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); delete el.dataset.desplazable; }
        cache.colocado = [mejor.x, mejor.y, mejor.w, mejor.alto, scroll].join('/');
        ocupados.push({ x: mejor.x, y: mejor.y, w: mejor.w, h: Math.min(mejor.alto, altura) });
      }
    },
    limpiar(): void { terminado = true; mutaciones.disconnect(); observadorTamanos?.disconnect(); medidas.clear(); sucios.clear(); },
  };
}
