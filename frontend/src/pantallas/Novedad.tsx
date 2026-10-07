// Dossier de los dos especialistas de tratamiento, aislado por investigación.
// La selección vive en la URL y los informes obsoletos nunca se presentan como vigentes.
import { useMemo, useState } from 'react';
import type { EstadoRosa, Hipotesis, Investigacion, RevisionTratamiento as Revision } from '../datos/tipos';
import { AvisoMuestra } from '../componentes/piezas';
import { etiquetaEstado, FechaRevision, RevisionTratamiento, type AgenteTratamiento } from '../componentes/RevisionTratamiento';
import { tr, trp, useIdioma } from '../lib/idioma';
import { rutaDe, rutaNovedad, seleccionDeNovedad } from '../lib/ruta';
import '../novedad.css';

const ESPECIALISTAS = [
  { agente: 'patentes', nombre: 'Sofía', especialidad: 'Patentes', alcance: 'Composición, reivindicaciones y uso terapéutico' },
  { agente: 'companias', nombre: 'Damián', especialidad: 'Compañías', alcance: 'Desarrollo actual e histórico del tratamiento' },
] as const;

function vigente(h: Hipotesis): Revision | undefined {
  const r = h.revisionTratamiento;
  return r && r.vigente !== false ? r : undefined;
}

function buscarEn(h: Hipotesis, consulta: string): boolean {
  const normalizar = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const p = vigente(h)?.perfil;
  return normalizar([h.titulo, p?.nombre, ...(p?.ingredientes ?? []), ...(p?.sinonimos ?? []), ...(p?.dianas ?? [])].filter(Boolean).join(' '))
    .includes(normalizar(consulta.trim()));
}

export function Novedad({ inv, estado, detalleId }: { inv: Investigacion; estado: EstadoRosa; detalleId: string | null }) {
  useIdioma();
  const [busqueda, setBusqueda] = useState('');
  const seleccion = seleccionDeNovedad(detalleId);
  const agente: AgenteTratamiento = seleccion.agente ?? 'patentes';
  const propias = useMemo(() => estado.hipotesis.filter(h => h.investigacionId === inv.id), [estado.hipotesis, inv.id]);
  // Abrir un informe existente primero, sin esconder las propuestas aún pendientes.
  const primera = propias.find(h => vigente(h)?.[agente]) ?? propias[0];
  const h = seleccion.hipotesisId ? propias.find(x => x.id === seleccion.hipotesisId) : primera;
  const visibles = propias.filter(x => buscarEn(x, busqueda));
  const r = h ? vigente(h) : undefined;
  const especialista = ESPECIALISTAS.find(x => x.agente === agente)!;
  const revisadas = propias.filter(x => vigente(x)?.[agente]).length;
  const informe = r?.[agente];
  const corrida = informe?.corridaId ? estado.corridas.find(c => c.id === informe.corridaId && c.investigacionId === inv.id) : undefined;
  const iteracion = corrida && informe?.iteracionId ? estado.iteraciones.find(it => it.id === informe.iteracionId && it.corridaId === corrida.id) : undefined;

  return <div className="contenido novedad-pagina">
    <AvisoMuestra conexion={estado.conexion} />
    {estado.conexion === 'conectando' && <p className="novedad-conexion" role="status">{tr('Conectando con ROSA para cargar las revisiones guardadas.')}</p>}
    {estado.conexion === 'sin_conexion' && <p className="novedad-conexion" role="status">{tr('Sin conexión con ROSA. Los informes visibles corresponden a la última actualización recibida; no se están actualizando.')}</p>}
    <header className="novedad-cabecera">
      <div>
        <h2>{tr('Novedad del tratamiento')}</h2>
        <p>{tr('Qué está patentado y quién lo está desarrollando, con el tratamiento concreto y sus fuentes a la vista.')}</p>
      </div>
      <p className="novedad-investigacion">{inv.titulo}</p>
    </header>

    <nav className="novedad-especialistas" aria-label={tr('Especialistas de novedad')}>
      {ESPECIALISTAS.map(x => {
        const inf = r?.[x.agente];
        return <a key={x.agente} className={`novedad-especialista ${agente === x.agente ? 'seleccionado' : ''}`}
          href={rutaNovedad(inv.id, h?.id ?? null, x.agente)} aria-current={agente === x.agente ? 'page' : undefined}>
          <span className="novedad-especialista-identidad"><strong>{x.nombre}</strong><span>{tr(x.especialidad)}</span></span>
          <span className="novedad-especialista-alcance">{tr(x.alcance)}</span>
          <span className="novedad-especialista-estado">{etiquetaEstado(inf)}</span>
          {inf && <span className="novedad-especialista-fecha"><FechaRevision fecha={inf.fecha} /></span>}
        </a>;
      })}
    </nav>

    <div className="novedad-mesa">
      <aside className="novedad-indice" aria-label={tr('Tratamientos de esta investigación')}>
        <div className="novedad-indice-cabecera">
          <h3>{tr('Tratamientos')}</h3>
          <p>{trp('{n} de {total} con informe de {nombre}', { n: revisadas, total: propias.length, nombre: especialista.nombre })}</p>
        </div>
        <label className="novedad-busqueda">
          <span>{tr('Buscar tratamiento o diana')}</span>
          <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder={tr('Nombre, alias o proteína')} />
        </label>
        <ul className="novedad-tratamientos">
          {visibles.map(x => {
            const revision = vigente(x);
            return <li key={x.id}><a href={rutaNovedad(inv.id, x.id, agente)} aria-current={h?.id === x.id ? 'page' : undefined}>
              <strong>{x.titulo}</strong>
              {revision?.perfil?.nombre && <span className="novedad-tratamiento-nombre" data-sin-traducir>{revision.perfil.nombre}</span>}
              <span className="novedad-tratamiento-estado">{x.revisionTratamiento?.vigente === false ? tr('Revisión pendiente') : etiquetaEstado(revision?.[agente])}</span>
            </a></li>;
          })}
        </ul>
        {!visibles.length && <p className="novedad-indice-vacio">{propias.length ? tr('No hay tratamientos que coincidan con esta búsqueda.') : tr('Las propuestas de esta investigación aparecerán aquí.')}</p>}
      </aside>

      <section className="novedad-lectura" aria-label={trp('Informe de {nombre}', { nombre: especialista.nombre })}>
        {h ? <>
          <header className="novedad-tratamiento-cabecera">
            <p className="novedad-firma">{trp('Informe de {nombre}', { nombre: especialista.nombre })}<span>{tr(especialista.especialidad)}</span></p>
            <h3>{h.titulo}</h3>
            {informe && <p className="novedad-ejecucion">{corrida ? trp('Corrida {n}', { n: corrida.numero }) : tr('Corrida de la revisión no disponible')}{iteracion && <> · {trp('Iteración {n}', { n: iteracion.numero })}</>}</p>}
            <a className="enlace novedad-ver-hipotesis" href={rutaDe(inv.id, 'hipotesis', h.id)}>{tr('Ver la hipótesis y su experimento')}</a>
          </header>
          <RevisionTratamiento revision={h.revisionTratamiento} agente={agente} dossier />
        </> : <div className="novedad-vacio" role="status">
          <h3>{tr(seleccion.hipotesisId ? 'La propuesta no está disponible' : estado.conexion === 'conectando' ? 'Cargando revisiones guardadas' : 'La revisión empieza con un tratamiento')}</h3>
          <p>{tr(seleccion.hipotesisId ? 'Este enlace no corresponde a una hipótesis de esta investigación. Selecciona una propuesta del índice.' : 'Cuando ROSA proponga una intervención, Sofía y Damián contrastarán sus patentes y programas empresariales dentro de una corrida.')}</p>
          {!seleccion.hipotesisId && <a className="enlace" href={rutaDe(inv.id, 'ranking')}>{tr('Ver las hipótesis de la investigación')}</a>}
        </div>}
      </section>
    </div>
  </div>;
}
