// Objetivo, límites, condición de parada y revisores; la configuración que
// ROSA2018 lee (editable); los datos con su contrato (comprobación previa,
// diccionario, clasificación de sensibilidad) y el catálogo de datos del
// Alzheimer; bifurcar; y las corridas.
//
// Espera visible (estándar de Emir, 19 de septiembre de 2026): lo que se
// deriva del estado se calcula después de pintar la silueta de la ficha
// (EsqueletoPantalla, variante "ficha"), así que abrir una investigación
// nunca deja la pantalla vacía ni congelada. Las cuatro tarjetas del programa
// (aprendizaje, ruta terapéutica, mapa de la enfermedad, datasets) las
// escribe el servidor al cerrar cada iteración: mientras una corrida en
// marcha no ha cerrado ninguna, salen como esqueleto con la forma de lo que
// va a llegar; si ya cerró alguna y siguen sin datos, no hay nada que esperar
// y cada tarjeta lo dice con sus palabras.

import { useState } from 'react';
import { acciones } from '../datos/almacen';
import type { Amplitud, Cuestion, Dataset, EstadoRosa, Investigacion as Inv } from '../datos/tipos';
import { CifrasAprendizaje } from '../componentes/CifrasAprendizaje';
import { DatasetsPrograma } from '../componentes/DatasetsPrograma';
import { Cargando, Esqueleto, EsqueletoFilas, EsqueletoPantalla, EsqueletoTarjeta, EsqueletoTexto } from '../componentes/Esqueleto';
import { MapaEnfermedad } from '../componentes/MapaEnfermedad';
import { TableroMetodo } from '../componentes/TableroMetodo';
import { MapaRuta } from '../componentes/MapaRuta';
import { Chip, Confirmar, Momento, Seccion } from '../componentes/piezas';
import { ConocimientoOperativoDelLaboratorio, FormularioMision, Jerarquia, LibroDeProcedencia, MemoriaDelProyecto, PuertaYReproducciones, SubirDataset } from '../componentes/Rosa2018';
import { useCalculoDiferido } from '../lib/diferido';
import { AMBITO_LECCION, AMPLITUD, CLASIFICACION_DATOS, ESTADO_CORRIDA, ESTADO_INVESTIGACION } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import { partesAutomatizadas, textoAutomatizacion } from '../lib/parada';
import { rutaDe } from '../lib/ruta';

/** Catalogo de datos del Alzheimer, como el de Biomni-AD. Acceso abierto o
 *  controlado; lo controlado pasa por acuerdo de uso y, si hay personas, por
 *  desidentificacion y comite. */
const CATALOGO: { nombre: string; descripcion: string; acceso: 'abierto' | 'controlado'; tamanoMb: number; columnas: number; clasificacion: Dataset['clasificacion'] }[] = [
  { nombre: 'NIAGADS GenomicsDB (GWAS)', descripcion: '69 conjuntos de estadísticas GWAS, 150 millones de variantes anotadas.', acceso: 'abierto', tamanoMb: 2_400, columnas: 12, clasificacion: 'publico' },
  { nombre: 'ADSP (WGS/WES)', descripcion: 'Secuenciación completa del Alzheimer Disease Sequencing Project.', acceso: 'controlado', tamanoMb: 900_000, columnas: 40, clasificacion: 'personas' },
  { nombre: 'SEA-AD (Allen Institute)', descripcion: 'Single-nucleus de corteza en envejecimiento y Alzheimer.', acceso: 'abierto', tamanoMb: 18_000, columnas: 30, clasificacion: 'publico' },
  { nombre: 'ROSMAP (vía AD Knowledge Portal)', descripcion: 'Cohortes longitudinales con multiómica; acuerdo de uso en Synapse.', acceso: 'controlado', tamanoMb: 45_000, columnas: 120, clasificacion: 'personas' },
  { nombre: 'ssREAD', descripcion: 'Atlas de single-cell y espacial de Alzheimer.', acceso: 'abierto', tamanoMb: 12_000, columnas: 25, clasificacion: 'publico' },
  { nombre: 'OASIS-4', descripcion: 'Imagen y clínica longitudinal.', acceso: 'controlado', tamanoMb: 60_000, columnas: 80, clasificacion: 'personas' },
  { nombre: 'GEO (expresión, RNA-Seq)', descripcion: 'Conjuntos de expresión públicos, por accession.', acceso: 'abierto', tamanoMb: 500, columnas: 20, clasificacion: 'publico' },
];

function TarjetaDataset({ d, inv }: { d: Dataset; inv: Inv }) {
  const limpio = d.columnasSinDiccionario === 0 && d.valoresCentinela === 0 && d.nombresDuplicados === 0;
  return (
    <article className="tarjeta dataset">
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong className="mono" style={{ fontSize: 13 }}>
            {d.nombre}
          </strong>
          <p className="meta">
            {d.descripcion} · {d.tamanoMb >= 1000 ? `${(d.tamanoMb / 1000).toFixed(1).replace('.', ',')} GB` : `${d.tamanoMb} MB`} · {d.columnas} columnas
          </p>
        </div>
        <Chip tono={d.estado === 'aprobado' ? 'ok' : d.estado === 'rechazado' ? 'mal' : 'aviso'}>{d.estado === 'aprobado' ? 'Contrato aprobado' : d.estado === 'rechazado' ? 'Rechazado' : 'Comprobación pendiente'}</Chip>
      </div>
      <div className="comprobacion-datos">
        <div className={d.columnasSinDiccionario > 0 ? 'mal' : 'ok'}>
          <strong>{d.columnasSinDiccionario}</strong>
          <span>columnas sin diccionario</span>
          {d.columnasSinDiccionario > 0 && (
            <button type="button" className="btn btn-s" onClick={() => acciones.aprobarDiccionario(inv.id, d.id)}>
              Aprobar el diccionario que propone ROSA2018
            </button>
          )}
        </div>
        <div className={d.valoresCentinela > 0 ? 'mal' : 'ok'}>
          <strong>{d.valoresCentinela}</strong>
          <span>columnas con valores centinela (0, -1, "NA" como texto)</span>
        </div>
        <div className={d.nombresDuplicados > 0 ? 'mal' : 'ok'}>
          <strong>{d.nombresDuplicados}</strong>
          <span>nombres de columna duplicados entre ficheros</span>
        </div>
        {(d.valoresCentinela > 0 || d.nombresDuplicados > 0) && (
          <button type="button" className="btn btn-s" onClick={() => acciones.corregirDataset(inv.id, d.id)}>
            Marcar centinelas y duplicados como corregidos en el fichero
          </button>
        )}
      </div>
      <div className="acciones" style={{ justifyContent: 'space-between' }}>
        <label className="interruptor" style={{ gap: 6 }}>
          <span className="meta">Clasificación</span>
          <select className="entrada entrada-s" style={{ width: 'auto' }} value={d.clasificacion} onChange={(e) => acciones.clasificarDataset(inv.id, d.id, e.target.value as Dataset['clasificacion'])} aria-label="Clasificación de los datos">
            {(Object.keys(CLASIFICACION_DATOS) as Dataset['clasificacion'][]).map((c) => (
              <option key={c} value={c}>
                {CLASIFICACION_DATOS[c]}
              </option>
            ))}
          </select>
        </label>
        {d.estado === 'pendiente' && (
          <div className="acciones">
            <button type="button" className="btn btn-primario btn-s" disabled={!limpio} title={limpio ? '' : 'Primero corrige o documenta lo que falta'} onClick={() => acciones.decidirDataset(inv.id, d.id, 'aprobado')}>
              Aprobar contrato de datos
            </button>
            <button type="button" className="btn btn-s" onClick={() => acciones.decidirDataset(inv.id, d.id, 'rechazado')}>
              Rechazar
            </button>
          </div>
        )}
      </div>
      {d.clasificacion === 'personas' && (
        <p className="aviso-muestra" style={{ marginTop: 4 }}>
          Datos de personas: antes de que ROSA2018 los toque hay que desidentificarlos (la skill deidentify corre en local, sin red) y la fase pasa por un comite certificado y por CONABIOS (Ley 172-13). Las herramientas que envian texto al gateway quedan bloqueadas para este fichero.
        </p>
      )}
      <LibroDeProcedencia inv={inv} d={d} />
    </article>
  );
}

/** Lo primero de la pantalla: que espera aqui una decision tuya, y un boton
 *  que te lleva a cada cosa. Si no hay nada, lo dice. */
function QueToca({ inv, corridas, irA }: { inv: Inv; corridas: EstadoRosa['corridas']; irA: (hash: string) => void }) {
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const puerta = inv.puertaReproduccion;
  const pendientes = inv.datasets.filter((d) => d.estado === 'pendiente').length;
  const tareas: { texto: string; accion: () => void; etiqueta: string }[] = [];
  if (inv.mision && !inv.mision.aprobadaEn) tareas.push({ texto: 'ROSA2018 propuso la misión (población, etapa, mecanismo, presupuesto). Falta que la apruebes o la corrijas.', accion: () => ir('mision'), etiqueta: 'Ver la misión' });
  if (pendientes > 0) tareas.push({ texto: `${pendientes} ${pendientes === 1 ? 'dataset espera' : 'datasets esperan'} que completes su libro de procedencia y lo apruebes.`, accion: () => ir('datos'), etiqueta: 'Ver los datos' });
  if (puerta && puerta.estado === 'bloqueada') tareas.push({ texto: `La puerta de reproducción está bloqueada (${puerta.superadas} de ${puerta.requeridas}): hasta abrirla, ningún análisis con datos cuenta como descubrimiento.`, accion: () => ir('puerta'), etiqueta: 'Ver la puerta' });
  if (corridas.length === 0) tareas.push({ texto: 'Esta investigación no tiene corridas: ROSA2018 todavía no ha empezado a trabajar en ella.', accion: () => irA(rutaDe(inv.id, 'corrida')), etiqueta: 'Arrancar la primera corrida' });
  return (
    <div className={`quetoca ${tareas.length === 0 ? 'quetoca-vacio' : ''}`} role="status">
      <strong>{tareas.length === 0 ? 'Nada te espera aquí.' : tareas.length === 1 ? 'Te espera una cosa:' : `Te esperan ${tareas.length} cosas:`}</strong>
      {tareas.length === 0 ? (
        <span className="meta"> El objetivo, la misión y los datos están en orden. Lo demás de esta pantalla es consulta.</span>
      ) : (
        <ul>
          {tareas.map((t) => (
            <li key={t.etiqueta}>
              <span>{t.texto}</span>
              <button type="button" className="btn btn-s" onClick={t.accion}>
                {t.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Las cuatro piezas del programa las escribe el servidor al cerrar cada
 *  iteración (rosa/bucle/corrida.py, _vistas_de_programa_al_cerrar). Están en
 *  espera de verdad mientras una corrida en marcha no ha cerrado todavía
 *  ninguna (iteración actual 1 o menos); si ya cerró alguna y siguen sin
 *  datos, no hay nada que esperar y cada tarjeta dice lo suyo. */
function programaEnEspera(corridas: EstadoRosa['corridas']): boolean {
  return corridas.some((c) => c.iteracionActual <= 1 && ESTADOS_QUE_TRABAJAN.has(c.estado));
}

/** Los estados en que el bucle está trabajando y por tanto la espera es de
 *  verdad: en marcha, proponiendo el plan o sondeando a un modelo caído. Un
 *  plan sin aprobar, una pausa, un presupuesto agotado o un permiso son
 *  esperas humanas: nadie calcula nada hasta que la persona actúe, y un
 *  esqueleto prometería un resultado que no va a llegar solo. */
const ESTADOS_QUE_TRABAJAN = new Set<EstadoRosa['corridas'][number]['estado']>(['en_marcha', 'esperando_plan', 'esperando_modelo']);

/** Por qué el programa no se calcula todavía cuando la corrida espera a una
 *  persona antes de cerrar su primera iteración: la frase que acompaña a
 *  las cuatro tarjetas en vez del brillo. Vacío si no es el caso. */
export function motivoEsperaHumana(corridas: EstadoRosa['corridas']): string {
  const corrida = corridas.find((c) => c.iteracionActual <= 1 && !ESTADOS_QUE_TRABAJAN.has(c.estado) && c.estado !== 'terminada' && c.estado !== 'detenida');
  if (!corrida) return '';
  const motivo =
    corrida.estado === 'esperando_aprobacion'
      ? 'la corrida espera tu aprobación del plan'
      : corrida.estado === 'pausada_por_presupuesto'
        ? 'la corrida se pausó por presupuesto y espera que lo amplíes'
        : corrida.estado === 'pausada'
          ? 'la corrida está pausada y espera que la reanudes'
          : 'la corrida espera a una persona';
  return `Las cuatro piezas se calculan al cerrar la primera iteración; ${motivo}.`;
}

/** Lo que la pantalla deriva del estado para una investigación: sus corridas
 *  (la más reciente primero), la investigación de la que es rama, sus
 *  lecciones ordenadas y si el programa está en espera. Se calcula después de
 *  pintar la silueta (lib/diferido.ts, useCalculoDiferido). */
function derivarInvestigacion(estado: EstadoRosa, inv: Inv) {
  const corridas = estado.corridas.filter((c) => c.investigacionId === inv.id).sort((a, b) => b.numero - a.numero);
  const origen = inv.ramaDe ? estado.investigaciones.find((i) => i.id === inv.ramaDe) ?? null : null;
  const lecciones = (estado.lecciones ?? []).filter((l) => l.investigacionId === inv.id).sort((a, b) => (b.veces - a.veces) || (b.ultimaVez - a.ultimaVez));
  return { invId: inv.id, corridas, origen, lecciones, programaEnEspera: programaEnEspera(corridas), motivoEsperaHumana: motivoEsperaHumana(corridas) };
}

/** La silueta de la ficha de la investigación: la cabecera con el título real
 *  y el chip de estado en gris (la real mide 55 px), el botón de bifurcar, la
 *  tarjeta de "qué toca" y las dos tarjetas de objetivo y relevancia. */
export function EsqueletoInvestigacion({ inv }: { inv: Inv }) {
  return (
    <EsqueletoPantalla
      variante="ficha"
      rotulo="la investigación"
      cabecera={{
        titulo: inv.titulo,
        descripcion: (
          <p aria-hidden="true">
            <Esqueleto className="esqueleto-chip" ancho={104} />
          </p>
        ),
      }}
      acciones={<Esqueleto className="esqueleto-boton" ancho={92} />}
    >
      <div className="tarjeta" style={{ marginBottom: 20, minHeight: 83 }} aria-hidden="true">
        <EsqueletoTexto lineas={2} />
      </div>
      <div className="rejilla-2" aria-hidden="true">
        <EsqueletoTarjeta lineas={12} alto={400} />
        <EsqueletoTarjeta lineas={12} alto={400} />
      </div>
      <div className="esqueleto-datos">
        <EsqueletoFilas filas={5} columnas={2} />
      </div>
    </EsqueletoPantalla>
  );
}

/** La silueta de una tarjeta del programa mientras el servidor la calcula:
 *  la clase real de la tarjeta (mide lo mismo), el título visible, una nota
 *  de cuándo llega y bloques grises con la forma del contenido. El aria-busy y
 *  el rótulo para el lector de pantalla los pone `Cargando`, que la envuelve. */
function SiluetaPrograma({ clase, titulo, forma }: { clase: 'cifras-ap' | 'mapa-ruta' | 'mapa-enf' | 'dsp'; titulo: string; forma: 'texto' | 'tabla' | 'rejilla' }) {
  const cabecera = clase === 'dsp' ? 'dsp-encabezado' : `${clase}-cabecera`;
  return (
    <article className={`tarjeta ${clase}`} data-esqueleto="programa" aria-label={titulo}>
      <div className={cabecera}>
        <h3>{titulo}</h3>
        <span className="meta">ROSA2018 lo calcula al cerrar la iteración en curso.</span>
      </div>
      {forma === 'texto' && (
        <>
          <EsqueletoTexto lineas={3} />
          <EsqueletoFilas filas={1} columnas={3} />
        </>
      )}
      {forma === 'tabla' && <EsqueletoFilas filas={4} columnas={4} />}
      {forma === 'rejilla' && (
        <>
          <EsqueletoTexto lineas={2} />
          <EsqueletoFilas filas={3} columnas={3} />
        </>
      )}
    </article>
  );
}

export function Investigacion({ inv, estado, ahora, irA }: { inv: Inv; estado: EstadoRosa; ahora: number; irA: (hash: string) => void }) {
  const { valor: base } = useCalculoDiferido(() => derivarInvestigacion(estado, inv), [estado.corridas, estado.investigaciones, estado.lecciones, inv]);
  const [editando, setEditando] = useState(false);
  const [pref, setPref] = useState(inv.configuracion.preferencias);
  const [atr, setAtr] = useState(inv.configuracion.atributos.join('\n'));
  const [res, setRes] = useState(inv.configuracion.restricciones.join('\n'));
  const [verCatalogo, setVerCatalogo] = useState(false);
  // Esqueleto al abrir la ficha (App la monta de nuevo por cada investigación);
  // con una actualización del canal en vivo se conserva lo calculado hasta que
  // llega lo nuevo, un fotograma después.
  if (base === null || base.invId !== inv.id) return <EsqueletoInvestigacion inv={inv} />;
  const { corridas, origen, lecciones } = base;
  const esperaPrograma = base.programaEnEspera;
  const esperaHumana = base.motivoEsperaHumana;

  return (
    <div className="contenido">
      <div className="pantalla-cabecera">
        <div>
          <h2>{inv.titulo}</h2>
          <p>
            <Chip>{ESTADO_INVESTIGACION[inv.estado]}</Chip>{' '}
            {origen && (
              <>
                Rama de <a className="enlace" href={rutaDe(origen.id, 'investigacion')}>{origen.titulo}</a>
              </>
            )}
            {inv.vigilarLiteraturaHasta && inv.vigilarLiteraturaHasta > ahora && (
              <>
                {' '}
                <Chip tono="borde">Vigilando literatura hasta <Momento t={inv.vigilarLiteraturaHasta} ahora={ahora} soloRelativo /></Chip>
              </>
            )}
          </p>
        </div>
        <Confirmar
          etiqueta="Bifurcar"
          pregunta="Se crea una investigación nueva con el mismo objetivo y una copia del modelo de mundo. La original sigue igual."
          pedirTexto={{ etiqueta: 'Nombre de la rama (di para que es)', marcador: 'Secuencia GFAP-NfL solo en Alzheimer familiar' }}
          onConfirmar={(motivo) => {
            const id = acciones.bifurcarInvestigacion(inv.id, motivo);
            if (id) irA(rutaDe(id, 'corrida'));
          }}
        />
      </div>

      <QueToca inv={inv} corridas={corridas} irA={irA} />

      <div className="rejilla-2">
        <div className="tarjeta seccion">
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Objetivo</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{inv.objetivo}</p>
        </div>
        <div className="tarjeta seccion">
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Qué cuenta como relevante</h3>
          <p>{inv.relevancia || 'Sin definir. ROSA2018 perseguira todo lo que parezca significativo.'}</p>
        </div>
        <div className="tarjeta seccion">
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Límites</h3>
          <ul className="lista-limpia">
            {inv.limites.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="tarjeta seccion">
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Condición de parada</h3>
          <p>{inv.condicionParada}</p>
          <p className="meta">{textoAutomatizacion(inv.condicionParadaAutomatizada ?? partesAutomatizadas(inv.condicionParada))}</p>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Quien revisa</h3>
          <div className="acciones">
            {inv.revisores.map((r) => (
              <Chip key={r} tono="borde">
                {r}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <Seccion id="mision" titulo="Misión" nota="El marco que fija el programa antes de la primera corrida (etapa 0 de ROSA2018): a quién aplica, en qué etapa, en qué célula o tejido, qué mecanismo, qué tipo de resultado se busca, qué puede hacer el laboratorio y con qué presupuesto. ROSA2018 propone; una persona aprueba. Debajo, las áreas de investigación que ROSA2018 comparó para elegir por dónde empezar.">
        {inv.mision === undefined || inv.mision === null ? <p className="meta">ROSA2018 propondrá la misión al arrancar la primera corrida. También puedes escribirla tú: arriba a la derecha, "Editar".</p> : null}
        <FormularioMision inv={inv} corridas={corridas} />
      </Seccion>

      <Jerarquia inv={inv} corridas={corridas} />

      <MemoriaDelProyecto inv={inv} />
      <ConocimientoOperativoDelLaboratorio inv={inv} />

      <Seccion
        titulo="Configuración que ROSA2018 lee"
        nota="Preferencias, atributos deseables y restricciones: alimentan la generación, cada revisión y cada debate del torneo. Se versiona con la investigación."
        acciones={
          editando ? (
            <>
              <button
                type="button"
                className="btn btn-primario btn-s"
                onClick={() => {
                  acciones.actualizarConfiguracion(inv.id, { preferencias: pref, atributos: atr.split('\n'), restricciones: res.split('\n'), amplitud: inv.configuracion.amplitud ?? 'equilibrada' });
                  setEditando(false);
                }}
              >
                Guardar
              </button>
              <button type="button" className="btn btn-fantasma btn-s" onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-s" onClick={() => setEditando(true)}>
              Editar
            </button>
          )
        }
      >
        {editando ? (
          <div className="seccion">
            <div className="campo">
              <label htmlFor="c-pref">Preferencias</label>
              <textarea id="c-pref" value={pref} rows={2} onChange={(e) => setPref(e.target.value)} />
            </div>
            <div className="rejilla-2">
              <div className="campo">
                <label htmlFor="c-atr">Atributos (uno por línea)</label>
                <textarea id="c-atr" value={atr} rows={4} onChange={(e) => setAtr(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="c-res">Restricciones (una por línea)</label>
                <textarea id="c-res" value={res} rows={4} onChange={(e) => setRes(e.target.value)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="rejilla-3">
            <div className="tarjeta">
              <p className="campo-etiqueta">Preferencias</p>
              <p style={{ fontSize: 13, marginTop: 6 }}>{inv.configuracion.preferencias || 'Sin definir'}</p>
            </div>
            <div className="tarjeta">
              <p className="campo-etiqueta">Atributos deseables</p>
              <ul className="lista-limpia" style={{ marginTop: 6, fontSize: 13 }}>
                {inv.configuracion.atributos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div className="tarjeta">
              <p className="campo-etiqueta">Restricciones</p>
              <ul className="lista-limpia" style={{ marginTop: 6, fontSize: 13 }}>
                {inv.configuracion.restricciones.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="tarjeta amplitud">
          <p className="campo-etiqueta">Amplitud de búsqueda</p>
          <p className="meta">
            Cuánto explora ROSA2018 fuera de la pregunta en cada paso de literatura. Con foco sube la certeza de lo que ya hay; con amplitud encuentra lo que hay al lado (una segunda cohorte, un contraejemplo, una línea nueva). Se aplica desde el siguiente paso de literatura.
          </p>
          <div className="acciones amplitud-botones" role="radiogroup" aria-label="Amplitud de búsqueda">
            {(['enfocada', 'equilibrada', 'amplia'] as Amplitud[]).map((a) => {
              const activa = (inv.configuracion.amplitud ?? 'equilibrada') === a;
              return (
                <button key={a} type="button" role="radio" aria-checked={activa} className={`btn btn-s ${activa ? 'btn-primario' : ''}`} title={AMPLITUD[a].nota} onClick={() => acciones.fijarAmplitud(inv.id, a)}>
                  {AMPLITUD[a].etiqueta} · {AMPLITUD[a].fraccion}
                </button>
              );
            })}
          </div>
          <p className="meta">{AMPLITUD[inv.configuracion.amplitud ?? 'equilibrada'].nota}</p>
        </div>
      </Seccion>

      <Seccion id="datos"
        titulo="Datos"
        nota="Antes de una corrida larga, la comprobación de datos: columnas sin diccionario, valores centinela y nombres duplicados contaminaron horas de una corrida de Kosmos. Nada se aprueba con esos contadores en rojo."
        acciones={
          <button type="button" className="btn btn-s" onClick={() => setVerCatalogo((v) => !v)}>
            {verCatalogo ? 'Ocultar catálogo' : 'Catálogo de datos del Alzheimer'}
          </button>
        }
      >
        {inv.datasets.length === 0 && <p className="meta">Sin datos adjuntos: ROSA2018 trabaja solo con literatura y bases curadas.</p>}
        {inv.datasets.map((d) => (
          <TarjetaDataset key={d.id} d={d} inv={inv} />
        ))}
        {estado.conexion !== 'muestra' && <SubirDataset inv={inv} />}
        {verCatalogo && (
          <div className="tabla-desliza">
          <table className="tabla tabla-ancha">
            <thead>
              <tr>
                <th>Conjunto</th>
                <th>Qué es</th>
                <th>Acceso</th>
                <th className="num">Tamaño</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {CATALOGO.map((c) => (
                <tr key={c.nombre}>
                  <td>{c.nombre}</td>
                  <td className="meta">{c.descripcion}</td>
                  <td>
                    <Chip tono={c.acceso === 'abierto' ? 'ok' : 'aviso'}>{c.acceso === 'abierto' ? 'Abierto' : 'Controlado'}</Chip>
                  </td>
                  <td className="num">{c.tamanoMb >= 1000 ? `${Math.round(c.tamanoMb / 1000)} GB` : `${c.tamanoMb} MB`}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-s"
                      disabled={inv.datasets.some((d) => d.nombre === c.nombre)}
                      onClick={() =>
                        acciones.anadirDataset(inv.id, {
                          nombre: c.nombre,
                          descripcion: c.descripcion,
                          tamanoMb: c.tamanoMb,
                          columnas: c.columnas,
                          columnasSinDiccionario: 0,
                          valoresCentinela: 0,
                          nombresDuplicados: 0,
                          clasificacion: c.clasificacion,
                          origen: 'catalogo',
                        })
                      }
                    >
                      Usar en esta investigación
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Seccion>

      <PuertaYReproducciones inv={inv} estado={estado} ahora={ahora} />

      <Seccion
        id="programa"
        titulo="Programa"
        nota="La vista de programa de ROSA2018: lo que la investigación aporta al conjunto, no a una hipótesis. Cuatro piezas, calculadas por regla al cerrar cada iteración. Aprendizaje: si las predicciones que ROSA2018 dejó escritas antes de mirar los datos (prerregistro) acertaron, cuánto tarda cada hipótesis en recibir una decisión y si se reutiliza lo heredado de otras investigaciones. Mapa de la ruta terapéutica: por cada diana, cuáles de los ocho pasos entre un mecanismo y un beneficio para una persona están cubiertos. Mapa de la enfermedad: dónde cae la evidencia por fase, región del cerebro y tipo de célula, y qué huecos nombra la misión. Datasets del programa: los conjuntos de datos públicos que ROSA2018 encontró, con su acceso. Los campos que aún no se han calculado lo dicen."
      >
        {esperaHumana !== '' && <p className="meta esqueleto-nota">{esperaHumana}</p>}
        <div className="programa">
          <Cargando activo={esperaPrograma && !inv.cifrasAprendizaje} rotulo="las cifras de aprendizaje" esqueleto={<SiluetaPrograma clase="cifras-ap" titulo="Aprendizaje" forma="texto" />}>
            <CifrasAprendizaje cifras={inv.cifrasAprendizaje ?? null} />
          </Cargando>
          <Cargando activo={esperaPrograma && !inv.mapaRuta} rotulo="el mapa de la ruta terapéutica" esqueleto={<SiluetaPrograma clase="mapa-ruta" titulo="Mapa de la ruta terapéutica" forma="tabla" />}>
            <MapaRuta mapa={inv.mapaRuta ?? null} estado={estado} />
          </Cargando>
          <Cargando activo={esperaPrograma && !inv.mapaEnfermedad} rotulo="el mapa de la enfermedad" esqueleto={<SiluetaPrograma clase="mapa-enf" titulo="Mapa de la enfermedad" forma="rejilla" />}>
            <MapaEnfermedad mapa={inv.mapaEnfermedad ?? null} />
          </Cargando>
          <Cargando activo={esperaPrograma && (estado.datasetsPrograma ?? []).length === 0} rotulo="los datasets del programa" esqueleto={<SiluetaPrograma clase="dsp" titulo="Datasets del programa" forma="tabla" />}>
            <DatasetsPrograma key={inv.id} datasets={estado.datasetsPrograma ?? []} investigacionId={inv.id} />
          </Cargando>
        </div>
      </Seccion>

      <Seccion
        titulo="Cómo está investigando ROSA2018"
        nota="El tablero del método: cifras calculadas por regla sobre lo que ROSA2018 dejó escrito mientras trabajaba, sin gastar ninguna llamada. Es lo que un jefe de laboratorio mira antes de opinar. No decide nada: al terminar cada corrida lo lee el revisor del arnés, que propone cambios, y los cambios los decide una persona."
      >
        <TableroMetodo tablero={inv.metodo ?? null} />
      </Seccion>

      <ColaDeTriaje inv={inv} estado={estado} />
      <Cuestiones inv={inv} estado={estado} />
      {(() => {
        return lecciones.length > 0 ? (
          <Seccion detalle titulo={`Lo que ROSA2018 aprendió a no repetir (${lecciones.length})`} nota="Lecciones generadas por regla al cerrar cada iteración: pasos que fallaron, consultas que no rindieron, bases que no respondieron, hipótesis cerradas por el Killer y por qué, ideas retiradas del vivero, análisis sin efecto. Cada paso las lee antes de actuar; una lección repetida pesa más.">
            <ul className="lista-limpia lecciones">
              {lecciones.slice(0, 40).map((l) => (
                <li key={l.id} className="leccion">
                  <Chip tono="borde">{AMBITO_LECCION[l.ambito]}</Chip>
                  <span>{l.texto}</span>
                  <span className="meta">
                    {l.veces > 1 ? `visto ${l.veces} veces · ` : ''}
                    {l.iteracion ? `iteración ${l.iteracion} · ` : ''}
                    <Momento t={l.ultimaVez} ahora={Date.now()} soloRelativo />
                  </span>
                </li>
              ))}
            </ul>
          </Seccion>
        ) : null;
      })()}

      <Seccion detalle titulo="Corridas" nota="Cada corrida es un arranque del bucle con estas instrucciones.">
        {corridas.length === 0 ? (
          <p className="meta">Sin corridas todavía.</p>
        ) : (
          <div className="tabla-desliza">
          <table className="tabla tabla-ancha">
            <thead>
              <tr>
                <th>Corrida</th>
                <th>Estado</th>
                <th>Empezó</th>
                <th className="num">Iteraciones</th>
                <th className="num">Duración</th>
                <th className="num">Llamadas</th>
                <th>Cierre</th>
              </tr>
            </thead>
            <tbody>
              {corridas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a className="enlace" href={rutaDe(inv.id, 'corrida')}>
                      Corrida {c.numero}
                    </a>
                  </td>
                  <td>{ESTADO_CORRIDA[c.estado]}</td>
                  <td>
                    <Momento t={c.empezadaEn} ahora={ahora} />
                  </td>
                  <td className="num">{c.iteracionActual}</td>
                  <td className="num">{formatearDuracion(c.gasto.segundos * 1000)}</td>
                  <td className="num">
                    {c.gasto.llamadas} / {c.presupuesto.limiteLlamadas}
                  </td>
                  <td className="meta">{c.motivoCierre ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Seccion>
    </div>
  );
}

const ORIGEN_CUESTION: Record<Cuestion['origen']['tipo'], string> = {
  pregunta_modelo: 'pregunta del modelo de mundo',
  killer: 'lo pidió el Killer',
  revisor: 'hallazgo del revisor',
  paso_fallido: 'un paso que falló',
  persona: 'la abrió una persona',
  analisis: 'análisis',
  laboratorio: 'laboratorio',
  escalera: 'peldaño de la escalera de certeza',
};

const ORIGEN_TAREA: Record<string, string> = {
  paso: 'lo vio un paso de la corrida',
  revisor: 'lo vio el revisor de registro al cerrar',
  regla: 'lo detectó una regla',
  persona: 'la abriste tú',
};

/** La cola de triaje: trabajo que ROSA2018 pidió abrir al ver algo que el plan no
 *  cubría. Cada propuesta pasa por un triaje por regla que la acepta o la rechaza,
 *  y el rechazo lleva siempre motivo escrito. */
export function ColaDeTriaje({ inv, estado }: { inv: Inv; estado: EstadoRosa }) {
  const [vio, setVio] = useState('');
  const [haria, setHaria] = useState('');
  const [herramienta, setHerramienta] = useState('literatura');
  const [verCerradas, setVerCerradas] = useState(false);
  const todas = (estado.tareas ?? []).filter((t) => t.investigacionId === inv.id);
  const vivas = todas.filter((t) => ['propuesta', 'aceptada', 'programada'].includes(t.estado)).sort((a, b) => b.veces - a.veces || a.creadaEn - b.creadaEn);
  const cerradas = todas.filter((t) => ['hecha', 'rechazada', 'caducada'].includes(t.estado)).sort((a, b) => b.creadaEn - a.creadaEn);
  return (
    <Seccion detalle titulo={`Cola de trabajo que ROSA2018 pidió abrir (${vivas.length})`} nota="Cuando un paso ve algo que el plan no cubría, lo pide aquí en vez de perderlo. Una regla decide si entra, y si no entra dice por qué. Lo que entra lo programa el plan de la iteración siguiente, que tiene que explicar por escrito cada tarea que deja fuera.">
      {vivas.length === 0 && <p className="meta">Nada en la cola. Es lo normal: ROSA2018 solo pide abrir trabajo cuando ve algo concreto.</p>}
      <ul className="lista-limpia cuestiones">
        {vivas.slice(0, 20).map((t) => (
          <li key={t.id} className="cuestion">
            <div>
              <Chip tono={t.estado === 'programada' ? 'ok' : t.estado === 'aceptada' ? 'acento' : 'borde'}>
                {t.estado === 'programada' ? 'En el plan' : t.estado === 'aceptada' ? 'Esperando plan' : 'Propuesta'}
              </Chip>{' '}
              <span>{t.queHaria}</span>
              <div className="meta">
                Vio: {t.queVio}
                {t.porQue ? ` · Importa porque: ${t.porQue}` : ''}
              </div>
              <div className="meta">
                {t.herramienta} · {ORIGEN_TAREA[t.origen.tipo] ?? t.origen.tipo}
                {t.origen.iteracion ? ` en la iteración ${t.origen.iteracion}` : ''}
                {t.veces > 1 ? ` · pedida ${t.veces} veces` : ''}
                {t.motivo ? ` · ${t.motivo}` : ''}
              </div>
            </div>
            {t.estado !== 'programada' && (
              <span className="acciones">
                <Confirmar etiqueta="Rechazar" pregunta="La tarea sale de la cola y no se vuelve a proponer igual." pedirTexto={{ etiqueta: 'Motivo', marcador: 'Ya lo sabemos por el estudio X' }} onConfirmar={(m) => acciones.decidirTarea(t.id, 'rechazada', m)} />
              </span>
            )}
          </li>
        ))}
      </ul>
      <form
        className="acciones cuestion-nueva"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (vio.trim() === '' || haria.trim() === '') return;
          acciones.abrirTarea(inv.id, vio, haria, '', herramienta);
          setVio('');
          setHaria('');
        }}
      >
        <input value={vio} onChange={(ev) => setVio(ev.target.value)} placeholder="Qué viste" aria-label="Qué viste" />
        <input value={haria} onChange={(ev) => setHaria(ev.target.value)} placeholder="Qué habría que hacer" aria-label="Qué habría que hacer" />
        <select value={herramienta} onChange={(ev) => setHerramienta(ev.target.value)} aria-label="Con qué herramienta">
          {['literatura', 'ensayos', 'extraccion', 'verificacion', 'novedad', 'modelo', 'hipotesis', 'analisis', 'meta'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-s" disabled={vio.trim() === '' || haria.trim() === ''}>
          Pedir
        </button>
      </form>
      {cerradas.length > 0 && (
        <button type="button" className="btn btn-s" onClick={() => setVerCerradas((v) => !v)}>
          {verCerradas ? 'Ocultar' : 'Ver'} {cerradas.length} {cerradas.length === 1 ? 'cerrada' : 'cerradas'}
        </button>
      )}
      {verCerradas && (
        <ul className="lista-limpia cuestiones">
          {cerradas.slice(0, 40).map((t) => (
            <li key={t.id} className="cuestion cuestion-cerrada">
              <div>
                <Chip tono={t.estado === 'hecha' ? 'ok' : 'borde'}>{t.estado === 'hecha' ? 'Hecha' : t.estado === 'caducada' ? 'Caducada' : 'Rechazada'}</Chip> <span>{t.queHaria}</span>
                <div className="meta">{t.motivo || 'sin motivo registrado'}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

/** Cuestiones persistentes (lo que rekursiv.ai llama Issues): qué está abierto, de
 *  dónde salió y qué lo resolvería. ROSA2018 las abre y las cierra; la persona también. */
export function Cuestiones({ inv, estado }: { inv: Inv; estado: EstadoRosa }) {
  const [texto, setTexto] = useState('');
  const [resolveria, setResolveria] = useState('');
  const [verResueltas, setVerResueltas] = useState(false);
  const todas = (estado.cuestiones ?? []).filter((c) => c.investigacionId === inv.id);
  const abiertas = todas.filter((c) => c.estado === 'abierta').sort((a, b) => a.prioridad - b.prioridad || a.creadaEn - b.creadaEn);
  const cerradas = todas.filter((c) => c.estado !== 'abierta').sort((a, b) => (b.resueltaEn ?? b.actualizadaEn) - (a.resueltaEn ?? a.actualizadaEn));
  const titulo = (id: string) => estado.hipotesis.find((h) => h.id === id)?.titulo ?? id;
  return (
    <Seccion detalle titulo={`Cuestiones abiertas (${abiertas.length})`} nota="Lo que la investigación tiene pendiente de responder, con su origen y lo que lo resolvería. ROSA2018 las abre desde las preguntas del modelo de mundo, lo que pide el Killer y el peldaño siguiente de cada hipótesis; las cierra cuando un hecho nuevo las responde. Tú puedes abrir, resolver o descartar.">
      {abiertas.length === 0 && <p className="meta">Ninguna cuestión abierta todavía.</p>}
      <ul className="lista-limpia cuestiones">
        {abiertas.slice(0, 40).map((c) => (
          <li key={c.id} className="cuestion">
            <div>
              <Chip tono="borde" title="Prioridad 1 es lo más urgente">P{c.prioridad}</Chip> <span>{c.texto}</span>
              <div className="meta">
                {ORIGEN_CUESTION[c.origen.tipo]}
                {c.hipotesisIds.length > 0 ? ` · sobre ${c.hipotesisIds.map(titulo).join('; ')}` : ''}
                {c.veces > 1 ? ` · planteada ${c.veces} veces` : ''}
                {c.queLaResolveria ? ` · la resolvería: ${c.queLaResolveria}` : ''}
              </div>
            </div>
            <span className="acciones">
              <Confirmar etiqueta="Resuelta" pregunta="La cuestión queda resuelta y deja de guiar la búsqueda." pedirTexto={{ etiqueta: 'Con qué se resolvió', marcador: 'El estudio X lo responde' }} onConfirmar={(m) => acciones.resolverCuestion(c.id, m)} />
              <Confirmar etiqueta="Descartar" pregunta="La cuestión se descarta con un motivo y no se vuelve a plantear." pedirTexto={{ etiqueta: 'Motivo', marcador: 'No es pertinente para el objetivo' }} onConfirmar={(m) => acciones.descartarCuestion(c.id, m)} />
            </span>
          </li>
        ))}
      </ul>
      <form
        className="acciones cuestion-nueva"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (texto.trim() === '') return;
          acciones.abrirCuestion(inv.id, texto, resolveria);
          setTexto('');
          setResolveria('');
        }}
      >
        <input value={texto} onChange={(ev) => setTexto(ev.target.value)} placeholder="Abrir una cuestión: ¿qué falta por saber?" aria-label="Cuestión nueva" />
        <input value={resolveria} onChange={(ev) => setResolveria(ev.target.value)} placeholder="Qué la resolvería (opcional)" aria-label="Qué la resolvería" />
        <button type="submit" className="btn btn-s" disabled={texto.trim() === ''}>
          Abrir
        </button>
      </form>
      {cerradas.length > 0 && (
        <button type="button" className="btn btn-s" onClick={() => setVerResueltas((v) => !v)}>
          {verResueltas ? 'Ocultar' : 'Ver'} {cerradas.length} {cerradas.length === 1 ? 'resuelta o descartada' : 'resueltas o descartadas'}
        </button>
      )}
      {verResueltas && (
        <ul className="lista-limpia cuestiones">
          {cerradas.slice(0, 40).map((c) => (
            <li key={c.id} className="cuestion cuestion-cerrada">
              <div>
                <Chip tono={c.estado === 'resuelta' ? 'ok' : 'borde'}>{c.estado === 'resuelta' ? 'Resuelta' : 'Descartada'}</Chip> <span>{c.texto}</span>
                <div className="meta">
                  {c.resolucion ? `${c.resolucion.motivo}` : ''}
                  {c.resueltaEn ? <> · <Momento t={c.resueltaEn} ahora={Date.now()} soloRelativo /></> : ''}
                </div>
              </div>
              <span className="acciones">
                <button type="button" className="btn btn-s" onClick={() => acciones.reabrirCuestion(c.id, 'reabierta por una persona')}>
                  Reabrir
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
