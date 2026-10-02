import { readFileSync } from 'node:fs';
import { construirAtlas } from '../src/lib/atlas';
import { cascada, recuentoAristas, recuentoVeredictos, supuestosAgregados } from '../src/lib/mecanismos';
import type { EstadoRosa } from '../src/datos/tipos';
const { estado, investigacion, vista, filtros } = JSON.parse(readFileSync(0, 'utf8')) as { estado: EstadoRosa; investigacion: string; vista: string; filtros: Record<string, unknown> };
const inv = estado.investigaciones.find(i => i.id === investigacion);
if (!inv) process.stdout.write(JSON.stringify({ ok: false, error: 'Investigación desconocida' }));
else if (vista === 'atlas') process.stdout.write(JSON.stringify({ ok: true, datos: construirAtlas(estado, inv, filtros), fuente: 'construirAtlas, compartido con la interfaz' }));
else if (vista === 'mecanismos') {
  const hs = estado.hipotesis.filter(h => h.investigacionId === investigacion && h.grafoCausal);
  process.stdout.write(JSON.stringify({ ok: true, datos: { cascada: cascada(hs), aristas: recuentoAristas(hs), veredictos: recuentoVeredictos(hs), supuestos: supuestosAgregados(hs) }, fuente: 'Funciones de mecanismos compartidas con la interfaz' }));
} else process.stdout.write(JSON.stringify({ ok: false, error: 'Vista desconocida' }));
