// Guarda contra clases CSS rotas en el JSX. Nacio el 14 de septiembre de 2026,
// cuando una pasada automatica de tildes convirtio `seccion` en `sección` en
// varios className: los estilos desaparecieron y los textos quedaron pegados.
// Dos comprobaciones: ningun className lleva caracteres fuera de ASCII, y cada
// clase estatica existe en styles.css o esta en la lista de marcadores
// semanticos (clases que solo sirven para localizar o para tests).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 'podio-tarjeta-entrada' es el envoltorio que motion necesita para no pisar
// el :hover del boton: no lleva estilo, solo nombre.
const MARCADORES = new Set(['podio-tarjeta-entrada', 'conclusion', 'llano-bloque', 'plan-edicion', 'lista-plana', 'campo-fila', 'revision-registro', 'procedencia-artefacto', 'pestanas-s', 'embudo', 'arbol-afirmaciones']);

function ficheros(d: string, extension = /\.tsx$/): string[] {
  const salida: string[] = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) salida.push(...ficheros(p, extension));
    else if (extension.test(p) && !/\.test\.tsx$/.test(p)) salida.push(p);
  }
  return salida;
}

describe('clases CSS del JSX', () => {
  const css = ficheros(__dirname, /\.css$/).map((p) => readFileSync(p, 'utf8')).join('\n');
  const definidas = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  const usos: { fichero: string; texto: string }[] = [];
  for (const f of ficheros(__dirname)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) usos.push({ fichero: f, texto: m[1] ?? m[2] ?? '' });
  }

  it('ningun className lleva caracteres fuera de ASCII', () => {
    const malos = usos.filter((u) => /[^\x20-\x7e]/.test(u.texto)).map((u) => `${u.fichero}: ${u.texto}`);
    expect(malos).toEqual([]);
  });

  it('cada clase estatica existe en styles.css o es un marcador conocido', () => {
    const faltan = new Set<string>();
    for (const u of usos) {
      const estatico = u.texto.replace(/\$\{[^}]*\}/g, ' ');
      for (const c of estatico.split(/\s+/)) {
        if (!c || c.endsWith('-') || !/^[a-zA-Z_][\w-]*$/.test(c)) continue;
        if (!definidas.has(c) && !MARCADORES.has(c)) faltan.add(`${c} (${u.fichero.split('/src/')[1]})`);
      }
    }
    expect([...faltan]).toEqual([]);
  });
});

describe('las barras pegadas no dejan ver lo de detrás', () => {
  it('ninguna barra sticky tiene el fondo transparente en su borde', () => {
    // El compositor del chat iba con `linear-gradient(transparent, var(--bg)
    // 22px)`: los primeros 22 px eran transparentes, así que lo que pasaba
    // por debajo al hacer scroll se veía a través de la barra, y con los
    // avatares de los modelos (círculos de alto contraste) se leía como si
    // la atravesaran (Emir, 2 de octubre de 2026). El desvanecido va en un
    // ::before ARRIBA de la barra, donde no hay nada que tapar.
    const css = ['mundo.css', 'styles.css', 'vivo.css', 'citas.css']
      .map((f) => {
        try { return readFileSync(join(__dirname, f), 'utf8'); } catch { return ''; }
      })
      .join('\n');
    const malas: string[] = [];
    // Cada regla con `position: sticky` y, en el MISMO bloque, un fondo que
    // empieza en transparente.
    for (const m of css.matchAll(/([.#][\w-]+(?:[^{};]*)?)\{([^}]*)\}/g)) {
      const cuerpo = m[2]!;
      if (!/position:\s*sticky/.test(cuerpo)) continue;
      const fondo = /background(?:-image)?:\s*([^;]+)/.exec(cuerpo)?.[1] ?? '';
      // `::before`/`::after` pueden ser transparentes: son la franja de
      // desvanecido, no la barra.
      if (/^::/.test(m[1]!.split(/\s/).pop() ?? '')) continue;
      if (/linear-gradient\(\s*to bottom\s*,\s*transparent/.test(fondo) || /^\s*transparent/.test(fondo)) {
        malas.push(`${m[1]!.trim()} -> ${fondo.trim().slice(0, 60)}`);
      }
    }
    expect(malas).toEqual([]);
  });
});
