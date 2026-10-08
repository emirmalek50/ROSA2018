import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { cabeceras } from '../datos/almacen';
import { Seccion } from './piezas';
import { idiomaActual, useIdioma } from '../lib/idioma';

const texto = (es: string, en: string) => idiomaActual() === 'en' ? en : es;

const RUTA = '/api/academicas/configuracion';
const CAMPOS = {
  elsevier_api_key: ['Clave API de Elsevier', 'Elsevier API key'],
  elsevier_insttoken: ['Token institucional de Elsevier (si corresponde)', 'Elsevier institutional token (if required)'],
  wos_api_key: ['Clave API de Web of Science', 'Web of Science API key'],
  ebsco_user: ['Usuario de la API de EBSCO', 'EBSCO API user'],
  ebsco_password: ['Contraseña de la API de EBSCO', 'EBSCO API password'],
  ebsco_profile: ['Perfil de EBSCO', 'EBSCO profile'],
  cinahl_db: ['Identificador de la base CINAHL', 'CINAHL database identifier'],
  psycinfo_db: ['Identificador de la base PsycINFO', 'PsycINFO database identifier'],
} as const;
type Campo = keyof typeof CAMPOS;
const GRUPOS: { nombre: string; campos: Campo[] }[] = [
  { nombre: 'Embase / Scopus', campos: ['elsevier_api_key', 'elsevier_insttoken'] },
  { nombre: 'Web of Science', campos: ['wos_api_key'] },
  { nombre: 'CINAHL / PsycINFO (EBSCO)', campos: ['ebsco_user', 'ebsco_password', 'ebsco_profile', 'cinahl_db', 'psycinfo_db'] },
];
type Estado = { administrador: boolean; campos: { id: Campo; configurado: boolean }[] };
function interpretar(v: unknown): Estado {
  if (!v || typeof v !== 'object') throw new Error('formato');
  const o = v as Record<string, unknown>;
  if (typeof o.administrador !== 'boolean' || !Array.isArray(o.campos)) throw new Error('formato');
  const campos = o.campos.map(c => {
    if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(CAMPOS, c.id) || typeof c.configurado !== 'boolean') throw new Error('formato');
    return { id: c.id as Campo, configurado: c.configurado };
  });
  return { administrador: o.administrador, campos };
}

export function ConfiguracionAcademicas({ servidor = true }: { servidor?: boolean }) {
  useIdioma();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valores, setValores] = useState<Partial<Record<Campo, string>>>({});
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const actual = useRef<AbortController | null>(null);
  const consultar = useCallback(async (cuerpo?: { valores?: Partial<Record<Campo, string>>; eliminar?: Campo[] }) => {
    if (actual.current) return;
    const control = new AbortController();
    actual.current = control; setOcupado(true); setMensaje('');
    const reloj = setTimeout(() => control.abort(), 15_000);
    try {
      const r = await fetch(RUTA, { method: cuerpo ? 'POST' : 'GET', headers: cabeceras(), credentials: 'same-origin', cache: 'no-store', signal: control.signal, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) { setEstado(null); setValores({}); }
        throw new Error('respuesta');
      }
      const datos = interpretar(await r.json());
      if (actual.current !== control) return;
      setEstado(datos);
      if (cuerpo) setMensaje(texto('Configuración guardada. El permiso de acceso se comprobará al realizar una búsqueda.', 'Configuration saved. Access permissions will be checked when a search runs.'));
    } catch {
      if (actual.current === control) setMensaje(texto('No pude comprobar la configuración. Actualiza el estado antes de repetir el cambio.', 'The configuration could not be checked. Refresh the status before retrying the change.'));
    } finally {
      clearTimeout(reloj);
      if (actual.current === control) { actual.current = null; setOcupado(false); }
    }
  }, []);
  useEffect(() => {
    if (servidor) void consultar();
    return () => { const control = actual.current; actual.current = null; control?.abort(); };
  }, [servidor, consultar]);
  const guardar = (e: FormEvent, campos: Campo[]) => {
    e.preventDefault();
    if (!estado?.administrador || actual.current) return;
    const nuevos = Object.fromEntries(campos.filter(k => valores[k]).map(k => [k, valores[k]]));
    if (!Object.keys(nuevos).length) return;
    setValores({});
    void consultar({ valores: nuevos });
  };

  return <Seccion titulo={texto('Fuentes académicas', 'Academic sources')}>
    <div className="tarjeta seccion" aria-busy={ocupado || undefined}>
      <p>{texto('ROSA busca en Embase, Cochrane Library, Scopus, Web of Science, LILACS, SciELO, CINAHL, PsycINFO y Google Scholar.', 'ROSA searches Embase, Cochrane Library, Scopus, Web of Science, LILACS, SciELO, CINAHL, PsycINFO and Google Scholar.')}</p>
      <p>{texto('Sin acceso institucional, el descubrimiento público usa la conexión de SerpApi de esta pantalla. Se identifica como cobertura parcial de páginas públicas, sin acceso al índice completo. Cada consulta puede consumir cuota de SerpApi.', 'Without institutional access, public discovery uses the SerpApi connection on this screen. It is identified as partial coverage of public pages, without access to the full index. Each query may consume SerpApi quota.')}</p>
      <p className="meta">{texto('Los resultados distinguen referencias, resúmenes y texto completo leído. Guardar credenciales no confirma una suscripción ni acceso autorizado.', 'Results distinguish references, abstracts and full text actually read. Saving credentials does not confirm a subscription or authorized access.')}</p>
      {!servidor ? <p>{texto('Se necesita conexión con el servidor de ROSA.', 'A connection to the ROSA server is required.')}</p> : <>
        <button type="button" className="btn btn-s" disabled={ocupado} onClick={() => void consultar()}>{texto('Actualizar estado', 'Refresh status')}</button>
        {estado && GRUPOS.map(g => <div className="seccion" key={g.nombre}>
          <h3>{g.nombre}</h3>
          <form onSubmit={e => guardar(e, g.campos)}>
            {g.campos.map(k => <div className="campo" key={k}>
              <label htmlFor={`academica-${k}`}>{texto(CAMPOS[k][0], CAMPOS[k][1])}</label>
              <small>{estado.campos.find(c => c.id === k)?.configurado ? texto('Configurado; permiso sin comprobar.', 'Configured; permission not checked.') : texto('Sin configurar.', 'Not configured.')}</small>
              {estado.administrador && <input id={`academica-${k}`} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={2048} value={valores[k] ?? ''} disabled={ocupado} onChange={e => setValores(v => ({ ...v, [k]: e.target.value }))} />}
            </div>)}
            {estado.administrador && <div className="acciones">
              <button className="btn btn-primario btn-s" disabled={ocupado || !g.campos.some(k => valores[k])}>{texto('Guardar acceso', 'Save access')}</button>
              <button type="button" className="btn btn-s" disabled={ocupado || !g.campos.some(k => estado.campos.find(c => c.id === k)?.configurado)} onClick={() => { setValores({}); void consultar({ eliminar: g.campos }); }}>{texto('Desconectar acceso institucional', 'Disconnect institutional access')}</button>
            </div>}
          </form>
        </div>)}
        {estado && !estado.administrador && <p>{texto('Solo administración puede modificar los accesos.', 'Only administrators can change access credentials.')}</p>}
        {mensaje && <p role="status">{mensaje}</p>}
      </>}
    </div>
  </Seccion>;
}
