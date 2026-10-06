import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('la auditoría separa la plantilla de trp de sus valores sin traducir', () => {
  const temporal = mkdtempSync(join(tmpdir(), 'rosa-auditoria-'));
  try {
    mkdirSync(join(temporal, 'src'));
    writeFileSync(join(temporal, 'src', 'fixture.ts'), `
      const sinTraducir = trp('Quedan {n}', { n: 'muchos más' });
      const correcta = trp('Quedan {n}', { n: tr('muchos menos') });
      const ternario = trp(n === 1 ? 'Queda uno' : 'Quedan varios', { n });
      const estado = 'esperando_plan';
    `);
    const salida = join(temporal, 'resultado.json');
    execFileSync(process.execPath, [resolve('scripts/i18n/resto_tsx.mjs'), '--salida', salida], { cwd: temporal });
    const pendientes = JSON.parse(readFileSync(salida, 'utf8')) as { t: string }[];
    expect(pendientes.map(p => p.t)).toEqual(['muchos más']);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

it('la revisión de tildes conserva los identificadores de las plantillas', () => {
  const resultado = execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('acentos', 'scripts/acentuar.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print(m.acentuar_texto('Titulo {titulo}; investigacion {investigacion}; simbolo {simbolo}'))
`], { encoding: 'utf8' }).trim();
  expect(resultado).toBe('Título {titulo}; investigación {investigacion}; símbolo {simbolo}');
});
