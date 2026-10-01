// La tarjeta de actividad en vivo de una corrida (28 de septiembre de 2026).
//
// Lo que faltaba: la pantalla se llama "Corrida en vivo" y en ningún sitio
// decía qué estaba haciendo ROSA2018 en ese momento. Había que deducirlo
// bajando hasta el plan y buscando el paso con el icono girando.
//
// Aquí se contesta de un vistazo, en este orden: si está viva, qué hace
// AHORA, por dónde va la iteración, sus cuatro constantes vitales, y qué
// necesita de ti si necesita algo. Todo lo demás de la pantalla es consulta
// y se queda debajo.
//
// Patrón de las Live Activities de iOS: un estado por tarjeta, una sola cosa
// importante, y el movimiento solo donde de verdad está pasando algo.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Corrida, Iteracion, PasoPlan } from '../datos/tipos';
import { useMovimientoReducido } from '../lib/movimiento';
import { coma, formatearDuracion, formatearEntero } from '../lib/formato';
import { tr } from '../lib/idioma';

// Los resortes de SwiftUI, convertidos a los parámetros de `motion` con las
// fórmulas de Apple (stiffness = (2pi/duración)^2 * masa; damping =
// 4pi(1-rebote)/duración * masa). Se dan por física y no por duración porque
// solo la forma física hereda la velocidad al interrumpirse, como hace
// SwiftUI al redirigir una animación a mitad de camino.
/** `.smooth` de SwiftUI (duración 0,5, rebote 0): aterriza sin rebotar. */
export const SUAVE_IOS = { type: 'spring', stiffness: 157.9, damping: 25.13, mass: 1 } as const;
/** `.snappy` (duración 0,5, rebote 0,15): vivo sin que se note el rebote. */
export const VIVO_IOS = { type: 'spring', stiffness: 157.9, damping: 21.36, mass: 1 } as const;
/** El de los dígitos de los widgets de Apple: `spring(duration: 0.2)`. */
export const CIFRA_IOS = { type: 'spring', stiffness: 987, damping: 62.83, mass: 1 } as const;

type Pulso = 'marcha' | 'espera' | 'quieto';

/** En qué pulso está la corrida: trabajando, esperando a alguien, o parada.
 *  Decide el color del halo, si el punto late y el verbo de la cabecera. */
export function pulsoDe(estado: Corrida['estado']): Pulso {
  if (estado === 'en_marcha') return 'marcha';
  if (estado === 'detenida' || estado === 'terminada') return 'quieto';
  return 'espera';
}

/** Qué está haciendo ROSA2018 ahora mismo, en una frase. Sale del plan, no de
 *  un texto guardado: el paso en curso y, si lo hay, la pista que trabaja.
 *  Cuando no hay paso en curso lo dice el estado de la corrida. */
export function queHaceAhora(corrida: Corrida, iteracion: Iteracion | null): { titulo: string; detalle: string } {
  const enCurso = iteracion?.plan.find((p) => p.estado === 'en_curso') ?? null;
  if (corrida.estado === 'esperando_plan' || (iteracion && !iteracion.planAprobado && !iteracion.terminadaEn)) {
    return iteracion && !iteracion.planAprobado && iteracion.plan.length > 0
      ? { titulo: 'El plan espera tu aprobación', detalle: `${iteracion.plan.length} pasos propuestos para la iteración ${iteracion.numero}.` }
      : { titulo: 'Escribiendo el plan de la iteración', detalle: 'Dos o tres llamadas al cerebro; suele tardar uno o dos minutos.' };
  }
  if (corrida.estado === 'esperando_aprobacion') return { titulo: 'ROSA2018 necesita tu permiso', detalle: 'Nada de lo pedido ocurre hasta que respondas.' };
  if (corrida.estado === 'pausada_por_presupuesto') return { titulo: 'Se acabó el tope de llamadas', detalle: corrida.presupuesto.motivoPausa || 'Amplía el tope para que siga.' };
  if (corrida.estado === 'esperando_modelo') return { titulo: 'Esperando a que el modelo vuelva', detalle: 'ROSA2018 reintenta sola con el mismo modelo; el reloj no corre.' };
  if (corrida.estado === 'pausada') return { titulo: 'En pausa', detalle: corrida.motivoPausaPropia || 'Reanuda cuando quieras; el reloj no corre.' };
  if (corrida.estado === 'detenida') return { titulo: 'Corrida detenida', detalle: corrida.motivoCierre || 'No se reanuda: para seguir hay que arrancar una nueva.' };
  if (corrida.estado === 'terminada') return { titulo: 'Corrida terminada', detalle: corrida.motivoCierre || 'Se cumplió su condición de parada.' };
  if (enCurso) {
    const vivas = (iteracion?.pistas ?? []).filter((p) => p.pasoId === enCurso.id && p.estado === 'en_curso');
    const detalle = vivas.length === 0
      ? enCurso.detalle || 'En marcha.'
      : vivas.length === 1
        ? `${vivas[0]!.titulo}`
        : `${vivas.length} pistas a la vez: ${vivas.slice(0, 2).map((p) => p.titulo).join('; ')}${vivas.length > 2 ? '…' : ''}`;
    return { titulo: enCurso.titulo, detalle };
  }
  if (iteracion && !iteracion.terminadaEn) return { titulo: 'Entre pasos', detalle: 'Guardando lo del paso anterior y preparando el siguiente.' };
  return { titulo: 'En marcha', detalle: 'Cerrando la iteración.' };
}

/** Una cifra que rueda hasta su valor y no baila: los dígitos van en cifra
 *  tabular, así el ancho no cambia mientras corre. */
function Cifra({ valor, decimales = 0, sufijo }: { valor: number; decimales?: number; sufijo?: string }) {
  const reducido = useMovimientoReducido();
  const [mostrado, setMostrado] = useState(valor);
  const desde = useRef(valor);
  useEffect(() => {
    if (reducido || !Number.isFinite(valor)) {
      setMostrado(Number.isFinite(valor) ? valor : 0);
      desde.current = valor;
      return;
    }
    const inicio = desde.current;
    const salto = Math.abs(valor - inicio);
    if (salto === 0) return;
    // Corto: lo justo para que el ojo vea la dirección del cambio.
    const ms = Math.min(700, 220 + salto * 0.6);
    const t0 = performance.now();
    let id = 0;
    const paso = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic, la salida de iOS
      setMostrado(inicio + (valor - inicio) * e);
      if (p < 1) id = requestAnimationFrame(paso);
      else desde.current = valor;
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [valor, reducido]);
  const texto = decimales > 0 ? coma(mostrado.toFixed(decimales)) : formatearEntero(Math.round(mostrado));
  return (
    <>
      {texto}
      {sufijo ? <small>{sufijo}</small> : null}
    </>
  );
}

function Vital({ nombre, children, title, pie }: { nombre: string; children: ReactNode; title?: string; pie?: ReactNode }) {
  return (
    <div className="vivo-vital" title={title}>
      <div className="vivo-vital-cifra">{children}</div>
      <div className="vivo-vital-nombre">{nombre}</div>
      {pie}
    </div>
  );
}

/** El tope gastado, en barra. Las HIG reservan los anillos a los de Actividad
 *  (Mover, Ejercicio, De pie): usarlos para otra cosa los vacía de sentido. */
function BarraTope({ fraccion }: { fraccion: number }) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraccion) ? fraccion : 0));
  return (
    <span className={`vivo-barra ${f > 0.85 ? 'vivo-barra-aviso' : ''}`} aria-hidden="true">
      <i style={{ transform: `scaleX(${f})` }} />
    </span>
  );
}

interface Props {
  corrida: Corrida;
  iteracion: Iteracion | null;
  segundosDeTrabajo: number;
  /** Cuántas cosas esperan a una persona ahora mismo (permisos, incidencias). */
  reclaman: number;
  /** Coste ya formateado, que lo decide la pantalla (facturado o estimado). */
  usd: number | null;
  /** La etiqueta canónica del estado (`etiquetaCorrida`), para que la tarjeta
   *  diga lo mismo que el resto de ROSA2018 y no un sinónimo suyo. */
  etiqueta: string;
  /** Por qué el reloj está parado ("en espera de una persona", "esperando al
   *  modelo"), o null si corre. Sin esto, un reloj quieto parece un fallo. */
  relojParado: string | null;
  acciones?: ReactNode;
}

export function ActividadEnVivo({ corrida, iteracion, segundosDeTrabajo, reclaman, usd, etiqueta, relojParado, acciones }: Props) {
  const reducido = useMovimientoReducido();
  const pulso = pulsoDe(corrida.estado);
  const { titulo, detalle } = queHaceAhora(corrida, iteracion);
  const pasos: PasoPlan[] = iteracion?.plan ?? [];
  const hechos = pasos.filter((p) => p.estado !== 'pendiente' && p.estado !== 'en_curso').length;
  const tope = corrida.presupuesto.limiteLlamadas;
  const fraccionTope = tope > 0 ? corrida.gasto.llamadas / tope : 0;

  return (
    <motion.section
      className={`vivo vivo-${pulso}`}
      aria-label={tr("Qué está haciendo ROSA2018 ahora")}
      initial={reducido ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reducido ? { duration: 0.2 } : SUAVE_IOS}
    >
      <div className="vivo-cabecera">
        <span className="vivo-estado">
          <i className="vivo-punto" aria-hidden="true" />
          {etiqueta}
          {iteracion && <em>{tr("· Iteración")} {iteracion.numero}</em>}
        </span>
        <span className="vivo-reloj" title={tr("Tiempo de trabajo: el reloj de pared menos lo que la corrida pasó esperando a una persona y menos las pausas del proceso.")}>
          <b>{formatearDuracion(segundosDeTrabajo * 1000) || '0 s'}</b> de trabajo
          {relojParado ? ` · ${relojParado}: el reloj no corre` : ''}
        </span>
      </div>

      {/* El titular cambia con el paso. Que se cruce en vez de saltar es lo
          que hace que la pantalla parezca que respira. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={titulo}
          className="vivo-haciendo"
          initial={reducido ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducido ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={reducido ? { duration: 0.15 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          {titulo}
        </motion.p>
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={detalle}
          className="vivo-detalle"
          initial={reducido ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {detalle}
        </motion.p>
      </AnimatePresence>

      {pasos.length > 0 && (
        <>
          <div className="vivo-pasos" role="img" aria-label={`Paso ${Math.min(hechos + 1, pasos.length)} de ${pasos.length}`}>
            {pasos.map((p) => (
              <span key={p.id} className={`vivo-paso vivo-paso-${p.estado}`} title={`${p.titulo} (${p.estado.replace('_', ' ')})`} />
            ))}
          </div>
          <p className="vivo-detalle" style={{ marginTop: 8 }}>
            {iteracion?.terminadaEn ? `${pasos.length} pasos, terminada` : `Paso ${Math.min(hechos + 1, pasos.length)} de ${pasos.length}`}
            {pasos.some((p) => p.estado === 'fallido') && ` · ${pasos.filter((p) => p.estado === 'fallido').length} fallido${pasos.filter((p) => p.estado === 'fallido').length === 1 ? '' : 's'}`}
          </p>
        </>
      )}

      <div className="vivo-vitales">
        <Vital nombre="llamadas al modelo" title={`${formatearEntero(corrida.gasto.llamadas)} de ${formatearEntero(tope)} autorizadas`}>
          <Cifra valor={corrida.gasto.llamadas} />
        </Vital>
        {usd !== null && (
          <Vital nombre="gastados" title={tr("Lo que el AI Gateway facturó por las llamadas de esta corrida.")}>
            <Cifra valor={usd} decimales={2} sufijo=" USD" />
          </Vital>
        )}
        <Vital nombre="artículos leídos">
          <Cifra valor={corrida.gasto.articulosLeidos} />
        </Vital>
        <Vital
          nombre={`del tope · quedan ${formatearEntero(Math.max(0, tope - corrida.gasto.llamadas))}`}
          title={`${formatearEntero(corrida.gasto.llamadas)} de ${formatearEntero(tope)} llamadas autorizadas`}
          pie={<BarraTope fraccion={fraccionTope} />}
        >
          <Cifra valor={Math.round(fraccionTope * 100)} sufijo=" %" />
        </Vital>
      </div>

      {reclaman > 0 && (
        <motion.div className="vivo-reclamo" initial={reducido ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={VIVO_IOS}>
          <svg className="vivo-reclamo-icono" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.8v3.6M8 10.8v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>
            <strong>{reclaman === 1 ? 'Una cosa espera tu respuesta' : `${reclaman} cosas esperan tu respuesta`}</strong>{tr(". Hasta que decidas, ROSA2018 no sigue por ahí.")}
          </span>
        </motion.div>
      )}

      {acciones && <div className="vivo-acciones">{acciones}</div>}
    </motion.section>
  );
}
