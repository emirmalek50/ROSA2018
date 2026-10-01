// El hilo del proceso: las siete etapas por las que pasa una investigacion,
// visibles durante una corrida activa, con la etapa activa latiendo y lo que
// espera a una persona marcado. Es lo que convierte doce pantallas en una
// historia que se sigue: buscar literatura, verificar lo que dice, actualizar
// el modelo de mundo, generar hipotesis y pasarlas por el Killer, elegir
// candidatas y llevarlas al laboratorio. Cada etapa lleva a su pantalla.

import { motion } from 'motion/react';
import { iteracionActualDe } from '../datos/acciones';
import type { Corrida, EstadoRosa, Investigacion, TipoPista } from '../datos/tipos';
import { pendientesDeRevision } from '../lib/hipotesis';
import { useMovimientoReducido } from '../lib/movimiento';
import { rutaDe, vistaDeRanking, type Pantalla } from '../lib/ruta';
import { proponiendoPlan } from '../lib/etiquetas';
import { traducido, tr } from '../lib/idioma';

export type Etapa = 'plan' | 'literatura' | 'verificar' | 'mundo' | 'hipotesis' | 'candidatas' | 'laboratorio';

export const ETAPAS: { clave: Etapa; nombre: string; corto: string; explicacion: string; pantalla: Pantalla; detalle?: string }[] = traducido([
  { clave: 'plan', nombre: 'Plan', corto: 'Plan', explicacion: 'ROSA2018 propone el plan de la iteración y espera tu aprobación antes de ejecutar nada.', pantalla: 'corrida' },
  { clave: 'literatura', nombre: 'Buscar literatura', corto: 'Literatura', explicacion: 'Consultas a PubMed, Europe PMC, ensayos clínicos y bases curadas. Cada consulta queda registrada con fecha.', pantalla: 'corrida' },
  { clave: 'verificar', nombre: 'Verificar afirmaciones', corto: 'Verificar', explicacion: 'Cada afirmación extraida se contrasta con su pasaje literal; el juez decide si la fuente la sostiene.', pantalla: 'corrida' },
  { clave: 'mundo', nombre: 'Modelo de mundo', corto: 'Mundo', explicacion: 'Lo sostenido entra como hecho con su procedencia; lo abierto queda como pregunta. Se ve como árbol: que sostiene a que.', pantalla: 'arbol' },
  { clave: 'hipotesis', nombre: 'Hipótesis y Killer', corto: 'Hipótesis', explicacion: 'ROSA2018 genera hipótesis, el Killer las somete a quince comprobaciones y tú decides sobre las que quedan en la cola.', pantalla: 'ranking', detalle: 'pendientes' },
  { clave: 'candidatas', nombre: 'Candidatas', corto: 'Candidatas', explicacion: 'El torneo (Elo y Bradley-Terry) y los bloqueos deciden cuales llegan al laboratorio: hasta tres por ciclo.', pantalla: 'ranking', detalle: 'podio' },
  { clave: 'laboratorio', nombre: 'Laboratorio', corto: 'Laboratorio', explicacion: 'El experimento se prerregistra y se sella con un tercero; los datos vuelven y ROSA2018 actualiza su conclusión. Aquí se ven solo las hipótesis que están en ese tramo.', pantalla: 'ranking', detalle: 'laboratorio' },
]);

const ETAPA_POR_PISTA: Record<TipoPista, Etapa> = {
  literatura: 'literatura',
  ensayos: 'literatura',
  grafo: 'literatura',
  extraccion: 'verificar',
  verificacion: 'verificar',
  modelo: 'mundo',
  novedad: 'hipotesis',
  replicacion: 'hipotesis',
};

export interface EstadoHilo {
  activa: Etapa | null;
  hechas: Set<Etapa>;
  esperan: Partial<Record<Etapa, number>>;
  cuentas: Partial<Record<Etapa, string>>;
  viva: boolean;
}

/** Deriva el estado del hilo del estado de ROSA2018. Determinista; no inventa. */
export function estadoDelHilo(estado: EstadoRosa, inv: Investigacion, corrida: Corrida | null): EstadoHilo {
  const hip = estado.hipotesis.filter((h) => h.investigacionId === inv.id);
  const hechos = estado.hechos.filter((h) => h.investigacionId === inv.id);
  const afirmaciones = hip.flatMap((h) => h.afirmaciones);
  const sostenidas = afirmaciones.filter((a) => a.veredicto === 'sostenida' || a.veredicto === 'parcial').length;
  const candidatas = hip.filter((h) => h.candidata && (h.bloqueos ?? []).length === 0);
  const enLab = hip.filter((h) => h.experimento && h.experimento.estado !== 'propuesto');
  const it = corrida ? iteracionActualDe(estado, corrida) : null;
  const viva = Boolean(corrida && corrida.estado !== 'terminada' && corrida.estado !== 'detenida');
  const hechas = new Set<Etapa>();
  if (corrida && corrida.busqueda.identificados > 0) hechas.add('literatura');
  if (afirmaciones.length > 0) hechas.add('verificar');
  if (hechos.length > 0) hechas.add('mundo');
  if (hip.length > 0) hechas.add('hipotesis');
  if (candidatas.length > 0) hechas.add('candidatas');
  if (enLab.length > 0) hechas.add('laboratorio');
  if (it?.planAprobado) hechas.add('plan');
  let activa: Etapa | null = null;
  if (corrida && viva) {
    if (!it || !it.planAprobado || corrida.estado === 'esperando_plan') activa = 'plan';
    else {
      const enCurso = it.pistas.filter((p) => p.estado === 'en_curso');
      const tipos = new Set(enCurso.map((p) => ETAPA_POR_PISTA[p.tipo]));
      const orden: Etapa[] = ['literatura', 'verificar', 'mundo', 'hipotesis'];
      activa = orden.find((e) => tipos.has(e)) ?? null;
      if (!activa) {
        const paso = it.plan.find((p) => p.estado === 'en_curso');
        const t = (paso?.titulo ?? '').toLowerCase();
        if (/hipotes|killer|torneo|novedad/.test(t)) activa = 'hipotesis';
        else if (/verific|extra|afirmac/.test(t)) activa = 'verificar';
        else if (/mundo|hecho/.test(t)) activa = 'mundo';
        else if (/liter|busc|pubmed|ensayo|fuente/.test(t)) activa = 'literatura';
        else if (/candidat|ranking|prioriz|dossier/.test(t)) activa = 'candidatas';
        else if (paso) activa = 'literatura';
      }
    }
  }
  const esperan: Partial<Record<Etapa, number>> = {};
  // Solo cuenta como "te espera" cuando hay un plan que aprobar; mientras ROSA2018 lo escribe no hay nada que hacer.
  if (corrida && (corrida.estado === 'esperando_aprobacion' || (corrida.estado === 'esperando_plan' && !proponiendoPlan(corrida, it)))) esperan.plan = 1;
  const pendientes = pendientesDeRevision(hip);
  if (pendientes > 0) esperan.hipotesis = pendientes;
  const propuestos = hip.filter((h) => h.experimento && h.experimento.estado === 'propuesto' && h.candidata).length;
  if (propuestos > 0) esperan.laboratorio = propuestos;
  const datosPendientes = inv.datasets.filter((d) => d.estado === 'pendiente').length;
  if (datosPendientes > 0) esperan.mundo = (esperan.mundo ?? 0) + datosPendientes;
  const cuentas: Partial<Record<Etapa, string>> = {
    plan: it ? `iteración ${it.numero}` : '',
    literatura: corrida ? `${corrida.busqueda.cribados} fuentes` : '',
    verificar: afirmaciones.length ? `${sostenidas} de ${afirmaciones.length} sostenidas` : '',
    mundo: hechos.length ? `${hechos.length} hechos` : '',
    hipotesis: hip.length ? `${hip.filter((h) => h.estado !== 'descartada').length} vivas` : '',
    candidatas: candidatas.length ? `${candidatas.length}` : '',
    laboratorio: enLab.length ? `${enLab.length}` : '',
  };
  return { activa, hechas, esperan, cuentas, viva };
}

export function HiloDelProceso({ estado, inv, pantalla, detalleId = null, compacto = false }: { estado: EstadoRosa; inv: Investigacion; pantalla: Pantalla | null; detalleId?: string | null; compacto?: boolean }) {
  const reducido = useMovimientoReducido();
  const corrida = estado.corridas.filter((c) => c.investigacionId === inv.id && ['en_marcha', 'esperando_plan', 'esperando_aprobacion', 'esperando_modelo'].includes(c.estado)).sort((a, b) => b.numero - a.numero)[0] ?? null;
  if (!corrida) return null;
  const hilo = estadoDelHilo(estado, inv, corrida);
  return (
    <nav className={`hilo ${compacto ? 'hilo-compacto' : ''}`} aria-label={tr("Etapas de la investigación")}>
      {ETAPAS.map((e, i) => {
        const activa = hilo.activa === e.clave;
        const hecha = hilo.hechas.has(e.clave) && !activa;
        const espera = hilo.esperan[e.clave] ?? 0;
        // Tres etapas comparten la pantalla del ranking (hipótesis,
        // candidatas y laboratorio), así que para saber en cuál estás hay que
        // mirar también la vista. La ficha de una hipótesis
        // (`hipotesis/<id>`) resalta «Hipótesis y Killer», que es de donde
        // sale.
        const aqui =
          e.pantalla === 'ranking'
            ? (pantalla === 'ranking' && vistaDeRanking(detalleId) === e.detalle) || (pantalla === 'hipotesis' && e.detalle === 'pendientes')
            : pantalla === e.pantalla && (e.pantalla !== 'corrida' || e.clave === (hilo.activa ?? 'plan'));
        return (
          <a key={e.clave} className={`hilo-etapa ${activa ? 'hilo-activa' : ''} ${hecha ? 'hilo-hecha' : ''} ${espera ? 'hilo-espera' : ''} ${aqui ? 'hilo-aqui' : ''}`} href={rutaDe(inv.id, e.pantalla, e.detalle)} title={`${e.nombre}. ${e.explicacion}${espera ? ` Te espera${espera > 1 ? 'n' : ''} ${espera}.` : ''}`} aria-current={aqui ? 'step' : undefined}>
            <span className="hilo-punto" aria-hidden="true">
              {activa && !reducido && <motion.i className="hilo-latido" animate={{ scale: [1, 1.9, 1], opacity: [0.55, 0, 0.55] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />}
              {hecha ? '✓' : i + 1}
            </span>
            <span className="hilo-texto">
              <span className="hilo-nombre">{compacto ? e.corto : e.nombre}</span>
              {!compacto && hilo.cuentas[e.clave] && <span className="hilo-cuenta">{hilo.cuentas[e.clave]}</span>}
            </span>
            {espera > 0 && (
              <span className="hilo-aviso" title={tr("Espera una decisión tuya")}>
                {espera}
              </span>
            )}
            {i < ETAPAS.length - 1 && <span className="hilo-linea" aria-hidden="true" />}
          </a>
        );
      })}
    </nav>
  );
}
