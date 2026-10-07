import { useEffect, useMemo, useRef, useState } from 'react';
import { cabeceras } from '../datos/almacen';
import type { Idioma } from './idioma';
import type { EventoLab } from '../datos/tipos';

export const ESTILO_LABORATORIO = 'conversacion-natural-v3';
const ESTILOS_COMPATIBLES = ['conversacion-natural-v2', ESTILO_LABORATORIO] as const;
type EstiloCompatible = typeof ESTILOS_COMPATIBLES[number];
export type EmocionLaboratorio = 'neutral' | 'curioso' | 'alegre' | 'frustrado' | 'preocupado' | 'sorprendido';
export type GestoLaboratorio = 'ninguno' | 'asentir' | 'negar';
export interface MaterialCharla {
  id: string; clase: 'registro' | 'afirmacion' | 'plan' | 'tarea' | 'objetivo'; texto: string;
  titulo?: string; cita?: string | null; fragmento?: string | null;
  veredicto?: string | null; pistaId?: string;
  pregunta?: string; detalle?: string; tipo?: string; estado?: string;
  pasoId?: string | null; agente?: string; hipotesisId?: string; entradaId?: string;
  aprobado?: boolean; pasos?: { id: string; tipo?: string; titulo?: string; detalle?: string; valorDecision?: string; espera?: string; siNoAparece?: string }[];
  evento?: EventoLab; hipotesis?: { id: string; titulo?: string; enunciado?: string; mecanismo?: string; estado?: string; version?: number };
}
export interface TurnoLaboratorio {
  estilo?: string;
  tipoConversacion?: 'actividad' | 'companeros';
  momento?: 'plan_propuesto' | 'inicio_tarea' | 'hallazgo';
  id: string; temaId: string; iteracionId: string; idioma: Idioma;
  agente: string; destinatario: string; texto: string; fecha: number;
  modelo: string; materiales: MaterialCharla[];
  emocion?: EmocionLaboratorio; gesto?: GestoLaboratorio;
}
export type EstadoCharla = 'cargando' | 'conversando' | 'esperando_hallazgos' | 'pausada' | 'sin_presupuesto' | 'no_disponible' | 'actualizando';
interface Respuesta { estado: EstadoCharla; turnos: TurnoLaboratorio[]; estilo?: string }

export function useConversacionesLaboratorio(corridaId: string, iteracionId: string | null, idioma: Idioma, disponible: boolean, activo: boolean): Respuesta {
  const cliente = useRef<string>();
  if (!cliente.current) cliente.current = crypto.randomUUID();
  // El contador sobrevive a los efectos: una retirada anterior puede llegar
  // después de reactivar la vista y debe conservar su orden de emisión.
  const secuenciaVisita = useRef(0);
  // La actualización se conserva al pausar o cambiar de iteración: una respuesta
  // de un servidor anterior no puede devolver esta sesión a la voz v2.
  const estiloSeleccionado = useRef<EstiloCompatible | null>(null);
  const clave = useMemo(() => ({}), [corridaId, iteracionId, idioma, disponible, activo]);
  const [datos, setDatos] = useState<Respuesta & { clave: object }>({ estado: 'cargando', turnos: [], clave });
  useEffect(() => {
    if (!disponible || !iteracionId) return;
    let vivo = true, compatible = false, timer: ReturnType<typeof setTimeout> | null = null;
    const url = `/api/corridas/${encodeURIComponent(corridaId)}/laboratorio/conversaciones`;
    let peticion: AbortController | null = null;
    const cuerpo = (habilitado: boolean) => JSON.stringify({ iteracionId, idioma, cliente: cliente.current, activo: habilitado, secuencia: ++secuenciaVisita.current });
    const visitar = async () => {
      if (peticion || !vivo) return;
      const abortar = new AbortController(); peticion = abortar;
      const tope = setTimeout(() => abortar.abort(), 12000);
      let espera = activo ? 2000 : 10000;
      try {
        // Comprobar primero la versión sin encargar voz antigua que no se verá.
        const r = await fetch(url, { method: 'POST', headers: cabeceras(), body: cuerpo(activo && compatible && !document.hidden), signal: abortar.signal });
        if (!r.ok) throw new Error('No disponible');
        const d: Respuesta = await r.json();
        if (!Array.isArray(d.turnos)) throw new Error('Respuesta inválida');
        if (!vivo) return;
        // v2 también es conversación natural. Permitirla durante una corrida
        // evita silenciarla cuando la interfaz se actualiza antes que el backend.
        // La versión debe venir declarada; turnos sueltos no negocian el protocolo.
        const anunciado = ESTILOS_COMPATIBLES.find((e) => e === d.estilo) ?? null;
        if (anunciado === ESTILO_LABORATORIO || estiloSeleccionado.current === null) estiloSeleccionado.current = anunciado;
        const anterior = compatible;
        compatible = anunciado !== null && anunciado === estiloSeleccionado.current;
        const turnos = compatible ? d.turnos.filter((t) => t.estilo === estiloSeleccionado.current) : [];
        const estado = compatible ? d.estado : activo ? 'actualizando' : 'pausada';
        if (compatible && !anterior && activo) espera = 0;
        else if (estado === 'conversando' && activo) espera = 1000;
        setDatos({ estado, turnos, estilo: estiloSeleccionado.current ?? undefined, clave });
      } catch {
        if (vivo) setDatos((anterior) => ({ estado: 'no_disponible', turnos: anterior.clave === clave ? anterior.turnos : [], clave }));
      } finally {
        peticion = null;
        clearTimeout(tope);
        if (vivo && !document.hidden) timer = setTimeout(() => void visitar(), espera);
      }
    };
    const visibilidad = () => {
      if (timer) clearTimeout(timer);
      if (document.hidden) {
        peticion?.abort();
        void fetch(url, { method: 'POST', headers: cabeceras(), body: cuerpo(false), keepalive: true }).catch(() => undefined);
      } else void visitar();
    };
    void visitar();
    document.addEventListener('visibilitychange', visibilidad);
    return () => {
      vivo = false; peticion?.abort(); if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilidad);
      void fetch(url, { method: 'POST', headers: cabeceras(), body: cuerpo(false), keepalive: true }).catch(() => undefined);
    };
  }, [clave, corridaId, iteracionId, idioma, disponible, activo]);
  if (!disponible || !iteracionId) return { estado: 'pausada', turnos: [] };
  return datos.clave === clave ? datos : { estado: 'cargando', turnos: [] };
}
