import { useEffect, useMemo, useRef, useState } from 'react';
import { cabeceras } from '../datos/almacen';
import type { Idioma } from './idioma';

export const ESTILO_LABORATORIO = 'conversacion-natural-v3';
export type EmocionLaboratorio = 'neutral' | 'curioso' | 'alegre' | 'frustrado' | 'preocupado' | 'sorprendido';
export type GestoLaboratorio = 'ninguno' | 'asentir' | 'negar';
export interface MaterialCharla {
  id: string; clase: 'registro' | 'afirmacion'; texto: string;
  titulo?: string; cita?: string | null; fragmento?: string | null;
  veredicto?: string | null; pistaId?: string;
}
export interface TurnoLaboratorio {
  estilo?: string;
  tipoConversacion?: 'actividad' | 'companeros';
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
  const clave = useMemo(() => ({}), [corridaId, iteracionId, idioma, disponible, activo]);
  const [datos, setDatos] = useState<Respuesta & { clave: object }>({ estado: 'cargando', turnos: [], clave });
  useEffect(() => {
    if (!disponible || !iteracionId) return;
    let vivo = true, compatible = false, timer: ReturnType<typeof setTimeout> | null = null;
    const url = `/api/corridas/${encodeURIComponent(corridaId)}/laboratorio/conversaciones`;
    let peticion: AbortController | null = null;
    const cuerpo = (habilitado: boolean) => JSON.stringify({ iteracionId, idioma, cliente: cliente.current, activo: habilitado });
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
        // No reproducir la voz anterior mientras el servidor termina una corrida
        // y carga la nueva versión. La procedencia del diálogo admitido se conserva.
        const turnos = d.turnos.filter((t) => t.estilo === ESTILO_LABORATORIO);
        const anterior = compatible;
        compatible = d.estilo === ESTILO_LABORATORIO || turnos.length > 0;
        const estado = activo && !compatible ? 'actualizando' : d.estado;
        if (compatible && !anterior && activo) espera = 0;
        else if (estado === 'conversando' && activo) espera = 1000;
        if (vivo) setDatos({ estado, turnos, clave });
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
