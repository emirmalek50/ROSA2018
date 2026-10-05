import { useCallback, useEffect, useRef, useState } from 'react';

type Fase = 'cargando' | 'listo' | 'sin_servidor' | 'sin_respuesta';
type Respuesta<T> = T | null | 'sin_respuesta';
type Lectura<T> = { clave: string; datos: T | null; fase: Fase; actualizando: boolean };

// Las citas viven en lecturas aparte del estado público. Un cambio de corridas
// por SSE puede contener solo evidencia privada: también invalida esta lectura.
// Se agrupan los avisos, sin consultas solapadas ni sondeo de corridas quietas.
export function useLecturaCitas<T>(clave: string, revision: unknown, pedir: () => Promise<Respuesta<T>>) {
  const [lectura, setLectura] = useState<Lectura<T>>({ clave: '', datos: null, fase: 'cargando', actualizando: false });
  const revisionActual = useRef(revision);
  revisionActual.current = revision;
  const pedirActual = useRef(pedir);
  pedirActual.current = pedir;
  const control = useRef<{ invalidar: () => void; repetir: () => void } | null>(null);

  useEffect(() => {
    let vivo = true;
    let enVuelo = false;
    let pendiente = false;
    let ultima = -Infinity;
    let leida = revisionActual.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const programar = (inmediata = false) => {
      if (!vivo || enVuelo || timer !== undefined) return;
      const espera = inmediata ? 0 : Math.max(0, ultima + 2000 - Date.now());
      timer = setTimeout(() => {
        timer = undefined;
        void cargar();
      }, espera);
    };
    const cargar = async () => {
      if (!vivo || enVuelo) return;
      enVuelo = true;
      pendiente = false;
      ultima = Date.now();
      leida = revisionActual.current;
      setLectura((a) => ({ ...a, actualizando: true }));
      let r: Respuesta<T>;
      try {
        r = await pedirActual.current();
      } catch {
        r = 'sin_respuesta';
      }
      if (!vivo) return;
      enVuelo = false;
      const fase = r === null ? 'sin_servidor' : r === 'sin_respuesta' ? 'sin_respuesta' : 'listo';
      setLectura({ clave, datos: fase === 'listo' ? r as T : null, fase, actualizando: false });
      // Si el estado cambió durante la petición, hace falta otra lectura. No
      // se pierde ese aviso ni se deja que una respuesta antigua gane la carrera.
      if (pendiente || leida !== revisionActual.current) programar();
    };
    const mandos = {
      invalidar: () => {
        if (leida !== revisionActual.current) programar();
      },
      repetir: () => {
        pendiente = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        programar(true);
      },
    };
    control.current = mandos;
    setLectura({ clave, datos: null, fase: 'cargando', actualizando: Boolean(clave) });
    if (clave) void cargar();
    return () => {
      vivo = false;
      if (timer !== undefined) clearTimeout(timer);
      if (control.current === mandos) control.current = null;
    };
  }, [clave]);

  useEffect(() => control.current?.invalidar(), [revision]);
  const repetir = useCallback(() => control.current?.repetir(), []);
  const actual = lectura.clave === clave ? lectura : { clave, datos: null, fase: 'cargando' as const, actualizando: true };
  return { ...actual, repetir };
}
