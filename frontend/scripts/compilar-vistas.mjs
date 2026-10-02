import { build } from 'esbuild';
await build({ entryPoints: ['scripts/servicios-vistas.ts'], outfile: 'dist/servicios-vistas.cjs', platform: 'node', format: 'cjs', bundle: true, treeShaking: true, logLevel: 'warning' });
