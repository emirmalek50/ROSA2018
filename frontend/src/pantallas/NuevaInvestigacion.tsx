// Definir una investigación, rehecha el 5 de octubre de 2026 sobre el diseño
// "Nueva investigación · v1": un banco arriba con los campos necesarios que
// ya están (título, objetivo, parada), cinco pasos a la izquierda (el
// objetivo con su revisión, qué buscar y qué no, cuándo parar y quién
// revisa, el punto de partida y la misión) y a la derecha lo que va a pasar
// al crear y la configuración que ROSA2018 leerá. Debajo, tres paráfrasis
// para ver la sensibilidad al fraseo antes de gastar.
//
// La revisión del objetivo son los avisos de lib/objetivo (las reglas de
// Edison para Kosmos), la configuración la propone proponerConfiguracion
// (como la de Co-Scientist) y la parada se lee con lib/parada, la misma
// regla que el servidor. Los límites se guardan uno por línea y los
// revisores separados por coma, como antes.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { acciones } from '../datos/almacen';
import { fundirHechosRepetidos, nuevoId, type DatosInvestigacion } from '../datos/acciones';
import { AvisoMuestra } from '../componentes/piezas';
import type { EstadoRosa } from '../datos/tipos';
import { IconoEsc, type NombreIcono } from '../componentes/IconosEscenario';
import { IconAlert } from '../componentes/icons';
import { avisosDelObjetivo, parafrasis, proponerConfiguracion, type AvisoObjetivo } from '../lib/objetivo';
import { partesAutomatizadas, textoAutomatizacion } from '../lib/parada';
import { formatearEntero, plural } from '../lib/formato';
import { rutaDe } from '../lib/ruta';
import { tr, trp, useIdioma } from '../lib/idioma';
import '../nueva.css';

type TipoAviso = AvisoObjetivo['tipo'];
type Tono = 'ok' | 'aviso' | 'neutro';

/** Las comprobaciones que se ven en verde, una por aviso del objetivo. */
const REVISION: [TipoAviso, string][] = [
  ['corto', 'Concreto'],
  ['varios_objetivos', 'Un solo objetivo'],
  ['respuesta_obvia', 'Pide un mecanismo, no una lista'],
  ['sin_contexto', 'Términos del campo'],
  ['sin_comprobacion', 'Dice cómo se comprueba'],
];

const VISIBLES_PARTIDA = 5;

function separarRevisores(texto: string): string[] {
  return [...new Set(texto.split(/[\n,]/).map((r) => r.trim()).filter(Boolean))];
}

function lineas(texto: string): string[] {
  return [...new Set(texto.split('\n').map((l) => l.trim()).filter(Boolean))];
}

function Estado({ tono, children }: { tono: Tono; children: string }) {
  return (
    <span className={`ni-estado ni-estado-${tono}`}>
      {tono === 'ok' && <IconoEsc nombre="check" size={12} />}
      {tono === 'aviso' && <IconAlert size={12} />}
      {children}
    </span>
  );
}

function Paso({ n, titulo, sub, estado, children }: { n: number; titulo: string; sub: string; estado: ReactNode; children: ReactNode }) {
  return (
    <section className="ni-paso" aria-labelledby={`ni-paso-${n}`}>
      <header className="ni-paso-cabecera">
        <span className="ni-paso-numero" aria-hidden="true">
          {n}
        </span>
        <div className="ni-paso-titulo">
          <h3 id={`ni-paso-${n}`}>{titulo}</h3>
          <p>{sub}</p>
        </div>
        {estado}
      </header>
      {children}
    </section>
  );
}

export function NuevaInvestigacion({ estado, irA }: { estado: EstadoRosa; irA: (hash: string) => void }) {
  const idioma = useIdioma();
  const [titulo, setTitulo] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [relevancia, setRelevancia] = useState('');
  const [limitesEditados, setLimites] = useState<string | null>(null);
  const limites = limitesEditados ?? tr('Solo literatura publicada y bases curadas: sin datos de pacientes.\nIgnorar artículos retractados o con expresión de preocupación.');
  const [parada, setParada] = useState('');
  const [revisores, setRevisores] = useState('');
  const [borradorRevisor, setBorradorRevisor] = useState('');
  const [heredar, setHeredar] = useState<string>('');
  const [verTodas, setVerTodas] = useState(false);
  const [verParafrasis, setVerParafrasis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verMision, setVerMision] = useState(false);
  const [mision, setMision] = useState({ poblacion: '', etapa: '', celulaTejido: '', mecanismo: '', tipoIntervencion: '', capacidades: '' });
  const [editandoConfig, setEditandoConfig] = useState(false);
  const [creando, setCreando] = useState(false);
  const enVuelo = useRef(false);
  const montada = useRef(true);
  const solicitud = useRef<{ borrador: string; id: string } | null>(null);
  useEffect(() => { montada.current = true; return () => { montada.current = false; }; }, []);
  const hayMision = verMision && Object.values(mision).some((v) => v.trim() !== '');
  const limitesRef = useRef<HTMLDivElement>(null);

  const avisos = useMemo(() => avisosDelObjetivo(objetivo, parada), [objetivo, parada, idioma]);
  const propuesta = useMemo(() => proponerConfiguracion(objetivo, relevancia, limites.split('\n')), [objetivo, relevancia, limites, idioma]);
  const [config, setConfig] = useState<{ preferencias: string; atributos: string; restricciones: string } | null>(null);
  const configEfectiva = config ?? { preferencias: propuesta.preferencias, atributos: propuesta.atributos.join('\n'), restricciones: propuesta.restricciones.join('\n') };
  const tres = useMemo(() => (verParafrasis ? parafrasis(objetivo) : []), [objetivo, verParafrasis, idioma]);

  const hayTitulo = titulo.trim() !== '';
  const hayObjetivo = objetivo.trim() !== '';
  const hayParada = parada.trim() !== '';
  const avisosObjetivo = avisos.filter((a) => a.tipo !== 'sin_parada' && a.tipo !== 'parada_no_medible');
  const avisoParada = avisos.find((a) => a.tipo === 'parada_no_medible');
  const fallan = new Set(avisosObjetivo.map((a) => a.tipo));
  const partes = useMemo(() => partesAutomatizadas(parada), [parada]);
  const listaRevisores = separarRevisores(revisores);
  const revisoresEfectivos = separarRevisores(`${revisores},${borradorRevisor}`);
  const listaLimites = limites === '' ? [] : limites.split('\n');

  const necesarios: [string, boolean][] = [
    [tr('Título'), hayTitulo],
    [tr('Objetivo'), hayObjetivo],
    [tr('Parada'), hayParada],
  ];
  const listos = necesarios.filter(([, ok]) => ok).length;

  const medibles: string[] = [];
  if (partes.iteraciones !== null) medibles.push(plural(partes.iteraciones, tr('iteración'), tr('iteraciones')));
  if (partes.tiempo) medibles.push(partes.tiempo);
  if (partes.llamadas !== null) medibles.push(plural(partes.llamadas, tr('llamada'), tr('llamadas')));

  // Las investigaciones de las que se puede partir, de la que más sabe a la
  // que menos: los nodos son los hechos del modelo de mundo que se copian.
  const partidas = useMemo(
    () => estado.investigaciones.map((i) => ({ id: i.id, titulo: i.titulo, nodos: fundirHechosRepetidos(estado.hechos.filter((h) => h.investigacionId === i.id), 0).hechos.length })).sort((a, b) => b.nodos - a.nodos),
    [estado.investigaciones, estado.hechos],
  );
  const indiceElegida = partidas.findIndex((p) => p.id === heredar);
  const partidasVisibles = verTodas || indiceElegida >= VISIBLES_PARTIDA ? partidas : partidas.slice(0, VISIBLES_PARTIDA);
  const restantes = partidas.length - VISIBLES_PARTIDA;
  const elegida = indiceElegida >= 0 ? partidas[indiceElegida] : undefined;
  const mostrarPartida = partidas.length > 0 || heredar !== '';

  const fijarLimites = (nuevas: string[]) => setLimites(nuevas.join('\n'));
  const anadirLimite = (despuesDe?: number) => {
    const nuevas = [...listaLimites];
    const en = despuesDe === undefined ? nuevas.length : despuesDe + 1;
    nuevas.splice(en, 0, '');
    fijarLimites(nuevas);
    requestAnimationFrame(() => limitesRef.current?.querySelectorAll<HTMLInputElement>('input')[en]?.focus());
  };

  const sumarRevisor = () => {
    const nuevos = separarRevisores(borradorRevisor);
    if (nuevos.length === 0) return;
    setRevisores(separarRevisores([...listaRevisores, ...nuevos].join(', ')).join(', '));
    setBorradorRevisor('');
  };
  const teclaRevisor = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      sumarRevisor();
    } else if (e.key === 'Backspace' && borradorRevisor === '' && listaRevisores.length > 0) {
      setRevisores(listaRevisores.slice(0, -1).join(', '));
    }
  };

  const crear = async () => {
    if (enVuelo.current) return;
    if (!hayTitulo || !hayObjetivo || !hayParada) {
      setError(tr('Faltan el título, el objetivo o la condición de parada. Sin condición de parada la corrida no sabe cuándo terminar.'));
      return;
    }
    if (heredar && !elegida) {
      setError(tr('La investigación de partida ya no existe. Elige otra o empieza con el modelo en blanco.'));
      return;
    }
    const datos: DatosInvestigacion = {
      titulo: titulo.trim(), objetivo: objetivo.trim(), relevancia: relevancia.trim(),
      limites: lineas(limites), condicionParada: parada.trim(), revisores: revisoresEfectivos,
      configuracion: { preferencias: configEfectiva.preferencias.trim(), atributos: lineas(configEfectiva.atributos), restricciones: lineas(configEfectiva.restricciones) },
      heredarModeloDe: heredar || null,
      mision: hayMision ? { poblacion: mision.poblacion.trim(), etapa: mision.etapa.trim(), celulaTejido: mision.celulaTejido.trim(), mecanismo: mision.mecanismo.trim(), tipoIntervencion: mision.tipoIntervencion.trim(), capacidadesLaboratorio: lineas(mision.capacidades) } : undefined,
    };
    const borrador = JSON.stringify(datos);
    // El mismo borrador conserva su ID al reintentar tras perder la respuesta.
    if (solicitud.current?.borrador !== borrador) solicitud.current = { borrador, id: globalThis.crypto?.randomUUID ? `inv-${globalThis.crypto.randomUUID()}` : nuevoId('inv') };
    enVuelo.current = true;
    setCreando(true);
    setError(null);
    try {
      const resultado = await acciones.crearInvestigacion(datos, solicitud.current.id);
      if (!montada.current) return;
      if (resultado.estado === 'creada') irA(rutaDe(resultado.investigacionId, 'corrida'));
      else setError(resultado.estado === 'rechazada'
        ? tr('ROSA2018 rechazó la creación. Revisa los campos y la investigación de partida; el formulario se conserva.')
        : tr('No pude confirmar que se guardara. El formulario se conserva: reintenta sin cambiarlo para recuperar la misma investigación.'));
    } finally {
      enVuelo.current = false;
      if (montada.current) setCreando(false);
    }
  };

  const estadoPaso1 =
    !hayTitulo || !hayObjetivo ? (
      <Estado tono="neutro">{tr('pendiente')}</Estado>
    ) : avisosObjetivo.length > 0 ? (
      <Estado tono="aviso">{plural(avisosObjetivo.length, tr('aviso'), tr('avisos'))}</Estado>
    ) : (
      <Estado tono="ok">{tr('listo')}</Estado>
    );
  const estadoPaso3 = !hayParada ? <Estado tono="neutro">{tr('pendiente')}</Estado> : partes.automatizada ? <Estado tono="ok">{tr('listo')}</Estado> : <Estado tono="aviso">{tr('no medible')}</Estado>;

  const filasResumen: { icono: NombreIcono; clave: string; valor: string; tono: Tono }[] = [
    {
      icono: 'target',
      clave: tr('Objetivo'),
      valor: !hayObjetivo ? tr('sin escribir') : avisosObjetivo.length === 0 ? tr('sin avisos') : plural(avisosObjetivo.length, tr('aviso'), tr('avisos')),
      tono: !hayObjetivo ? 'neutro' : avisosObjetivo.length === 0 ? 'ok' : 'aviso',
    },
    {
      icono: 'square-stop',
      clave: tr('Para sola'),
      valor: !hayParada ? tr('falta la condición') : partes.automatizada ? medibles.join(tr(' o ')) : tr('solo con Detener'),
      tono: !hayParada ? 'neutro' : partes.automatizada ? 'ok' : 'aviso',
    },
    {
      icono: 'users',
      clave: tr('Revisan'),
      valor: revisoresEfectivos.length === 0 ? tr('nadie todavía') : plural(revisoresEfectivos.length, tr('persona'), tr('personas')),
      tono: 'neutro',
    },
    {
      icono: 'share-2',
      clave: tr('Modelo de mundo'),
      valor: elegida ? plural(elegida.nodos, tr('nodo heredado'), tr('nodos heredados')) : heredar ? tr('partida no disponible') : tr('en blanco'),
      tono: 'neutro',
    },
  ];

  const atributos = lineas(configEfectiva.atributos);
  const restricciones = lineas(configEfectiva.restricciones);
  const volverPropuesta = config !== null && (
    <button type="button" className="ni-enlace" onClick={() => setConfig(null)}>
      <IconoEsc nombre="rotate-ccw" size={13} />
      {tr('Volver a la propuesta de ROSA2018')}
    </button>
  );

  return (
    <form
      className="contenido ni-pagina"
      aria-busy={creando}
      onSubmit={(e) => {
        e.preventDefault();
        void crear();
      }}
    >
      <AvisoMuestra conexion={estado.conexion} />
      <fieldset disabled={creando} style={{ display: 'contents' }}>
      <section className="ni-banco" aria-labelledby="ni-titular">
        <div className="ni-etiquetas">
          <span className="ni-pill">
            <IconoEsc nombre="sparkles" size={14} />
            {tr('Nueva investigación')}
          </span>
          <span className="ni-cuenta">{tr('Lo que ROSA2018 lee antes de cada iteración')}</span>
        </div>
        <div className="ni-banco-cuerpo">
          <div className="ni-titular">
            <h2 id="ni-titular">{tr('Qué tiene que encontrar ROSA2018')}</h2>
            <p>{tr('Un objetivo, lo que cuenta como relevante, sus límites y cuándo parar. Se puede cambiar después, pero la primera corrida arranca con esto.')}</p>
          </div>
          <div className="ni-cifra">
            <div className="ni-cifra-fila">
              <b className={listos === 3 ? 'ni-cifra-completa' : undefined}>{listos}</b>
              <div className="ni-cifra-pie">
                <span>{tr('de 3')}</span>
                <small>{tr('campos necesarios listos')}</small>
              </div>
            </div>
            <ul className="ni-necesarios">
              {necesarios.map(([nombre, ok]) => (
                <li key={nombre} className={ok ? 'ni-necesario-ok' : undefined}>
                  <IconoEsc nombre={ok ? 'check' : 'circle-dot'} size={13} />
                  {nombre}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="ni-mesa">
        <div className="ni-pasos">
          <Paso n={1} titulo={tr('El objetivo')} sub={tr('Qué quieres que encuentre, en una o dos frases. Un solo objetivo por investigación.')} estado={estadoPaso1}>
            <div className="ni-campo">
              <div className="ni-campo-cabecera">
                <label htmlFor="n-titulo">{tr('Título')}</label>
              </div>
              <input id="n-titulo" className="ni-caja" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tr('Biomarcadores plasmáticos y progresión en Alzheimer familiar')} />
            </div>
            <div className="ni-campo">
              <div className="ni-campo-cabecera">
                <label htmlFor="n-objetivo">{tr('Objetivo')}</label>
                {hayObjetivo && <span className="ni-pista">{plural(objetivo.trim().length, tr('carácter'), tr('caracteres'))}</span>}
              </div>
              <textarea id="n-objetivo" className="ni-caja ni-caja-objetivo" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} rows={3} placeholder={tr('Qué quieres que ROSA2018 encuentre, en una o dos frases. Un solo objetivo por investigación.')} />
            </div>
            {hayObjetivo && (
              <div className="ni-revision">
                <ul className="ni-comprobaciones" aria-label={tr('Revisión del objetivo')}>
                  {REVISION.map(([tipo, etiqueta]) => (
                    <li key={tipo} className={fallan.has(tipo) ? 'ni-comprobacion-falla' : undefined}>
                      {fallan.has(tipo) ? <IconAlert size={12} /> : <IconoEsc nombre="check" size={12} />}
                      {tr(etiqueta)}
                    </li>
                  ))}
                </ul>
                {avisosObjetivo.length === 0 ? (
                  <p className="ni-ok">{tr('El objetivo tiene contexto, comprobación y una sola dirección.')}</p>
                ) : (
                  <ul className="ni-avisos" aria-label={tr('Avisos sobre el objetivo')}>
                    {avisosObjetivo.map((a) => (
                      <li key={a.tipo}>
                        <IconAlert size={13} />
                        <span>{a.texto}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Paso>

          <Paso
            n={2}
            titulo={tr('Qué buscar y qué no')}
            sub={tr('El criterio con el que ROSA2018 prioriza y con el que el revisor juzga.')}
            estado={relevancia.trim() !== '' ? <Estado tono="ok">{tr('listo')}</Estado> : <Estado tono="neutro">{tr('opcional')}</Estado>}
          >
            <div className="ni-campo">
              <div className="ni-campo-cabecera">
                <label htmlFor="n-relevancia">{tr('Qué cuenta como relevante')}</label>
              </div>
              <textarea id="n-relevancia" className="ni-caja" value={relevancia} onChange={(e) => setRelevancia(e.target.value)} rows={2} placeholder={tr('Una diana nueva, una hipótesis mecanística, una asociación biomarcador-progresión, un candidato a reposicionamiento...')} />
              <p className="ni-tenue">{tr('Si está vacío, ROSA2018 perseguirá todo lo que parezca significativo.')}</p>
            </div>
            <div className="ni-campo" role="group" aria-labelledby="n-limites">
              <div className="ni-campo-cabecera">
                <span id="n-limites" className="ni-etiqueta">
                  {tr('Límites')}
                </span>
                <span className="ni-pista">{tr('uno por línea')}</span>
              </div>
              <div className="ni-lista" ref={limitesRef}>
                {listaLimites.map((l, i) => (
                  <div className="ni-limite" key={i}>
                    <IconoEsc nombre="ban" size={15} />
                    <input
                      value={l}
                      aria-label={trp('Límite {n}', { n: i + 1 })}
                      placeholder={tr('Un límite nuevo')}
                      onChange={(e) => fijarLimites(listaLimites.map((x, j) => (j === i ? e.target.value : x)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          anadirLimite(i);
                        }
                      }}
                    />
                    <button type="button" className="ni-quitar" aria-label={trp('Quitar el límite {n}', { n: i + 1 })} onClick={() => fijarLimites(listaLimites.filter((_, j) => j !== i))}>
                      <IconoEsc nombre="x" size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="ni-anadir" onClick={() => anadirLimite()}>
                  <IconoEsc nombre="plus" size={15} />
                  {tr('Añadir un límite')}
                </button>
              </div>
            </div>
          </Paso>

          <Paso n={3} titulo={tr('Cuándo parar y quién revisa')} sub={tr('Sin condición de parada la corrida no sabe cuándo terminar y gasta hasta el tope.')} estado={estadoPaso3}>
            <div className="ni-campo">
              <div className="ni-campo-cabecera">
                <label htmlFor="n-parada">{tr('Condición de parada')}</label>
              </div>
              <input id="n-parada" className="ni-caja" value={parada} onChange={(e) => setParada(e.target.value)} placeholder={tr('3 iteraciones, o 72 horas, lo que ocurra primero')} />
              <div className="ni-automatico" aria-live="polite">
                {hayParada && partes.automatizada ? (
                  <>
                    <div className="ni-automatico-fila">
                      <span>{tr('ROSA2018 para sola al llegar a')}</span>
                      {partes.iteraciones !== null && (
                        <span className="ni-chip-acento">
                          <IconoEsc nombre="repeat" size={13} />
                          {plural(partes.iteraciones, tr('iteración'), tr('iteraciones'))}
                        </span>
                      )}
                      {partes.tiempo && (
                        <span className="ni-chip-acento">
                          <IconoEsc nombre="timer" size={13} />
                          {trp('{tiempo} de corrida', { tiempo: partes.tiempo })}
                        </span>
                      )}
                      {partes.llamadas !== null && (
                        <span className="ni-chip-acento">
                          <IconoEsc nombre="cpu" size={13} />
                          {plural(partes.llamadas, tr('llamada'), tr('llamadas'))}
                        </span>
                      )}
                    </div>
                    <p className="ni-tenue">
                      {tr('O al agotar el presupuesto de la misión.')}
                      {partes.resto && ` ${trp('El resto («{resto}») lo decides tú con el botón de detener.', { resto: partes.resto.slice(0, 80) })}`}
                    </p>
                  </>
                ) : hayParada ? (
                  <p className="ni-aviso-linea">
                    <IconAlert size={13} />
                    <span>
                      {textoAutomatizacion(partes)} {avisoParada?.texto}
                    </span>
                  </p>
                ) : (
                  <p className="ni-tenue">{tr('ROSA2018 para sola cuando se cumple una cifra: iteraciones, minutos u horas de corrida, o llamadas al modelo. El resto de la frase lo lee para planificar, pero la decisión de parar por otro motivo es tuya.')}</p>
                )}
              </div>
            </div>
            <div className="ni-campo">
              <div className="ni-campo-cabecera">
                <label htmlFor="n-revisores">{tr('Quién revisa')}</label>
                <span className="ni-pista">{tr('Intro o coma para añadir')}</span>
              </div>
              <div className="ni-caja ni-fichas">
                {listaRevisores.map((r, i) => (
                  <span className="ni-ficha" key={`${r}-${i}`}>
                    {r}
                    <button type="button" aria-label={trp('Quitar a {r}', { r })} onClick={() => setRevisores(listaRevisores.filter((_, j) => j !== i).join(', '))}>
                      <IconoEsc nombre="x" size={12} />
                    </button>
                  </span>
                ))}
                <input
                  id="n-revisores"
                  value={borradorRevisor}
                  onChange={(e) => setBorradorRevisor(e.target.value)}
                  onKeyDown={teclaRevisor}
                  onBlur={sumarRevisor}
                  placeholder={listaRevisores.length > 0 ? tr('Añadir...') : tr('la persona responsable, Compañero, el investigador clínico principal')}
                />
              </div>
            </div>
          </Paso>

          {mostrarPartida && (
            <Paso
              n={4}
              titulo={tr('Punto de partida')}
              sub={tr('ROSA2018 arranca sabiendo lo que ya se supo, se abrió y se descartó en esa investigación.')}
              estado={elegida ? <Estado tono="ok">{tr('heredado')}</Estado> : <Estado tono="neutro">{tr('opcional')}</Estado>}
            >
              <div className="ni-lista ni-partidas" role="radiogroup" aria-label={tr('Partir del modelo de mundo de')}>
                <label className={`ni-partida${heredar === '' ? ' ni-partida-elegida' : ''}`}>
                  <input type="radio" name="n-heredar" id="n-heredar" value="" checked={heredar === ''} onChange={() => setHeredar('')} />
                  <span className="ni-radio" aria-hidden="true" />
                  <span className="ni-partida-texto">
                    <b>{tr('Empezar en blanco')}</b>
                    <small>{tr('sin modelo de mundo previo')}</small>
                  </span>
                </label>
                {partidasVisibles.map((p) => (
                  <label key={p.id} className={`ni-partida${heredar === p.id ? ' ni-partida-elegida' : ''}`}>
                    <input type="radio" name="n-heredar" value={p.id} checked={heredar === p.id} onChange={() => setHeredar(p.id)} />
                    <span className="ni-radio" aria-hidden="true" />
                    <span className="ni-partida-texto">
                      <span>{p.titulo}</span>
                    </span>
                    <span className="ni-nodos">
                      <IconoEsc nombre="share-2" size={12} />
                      {plural(p.nodos, tr('nodo'), tr('nodos'))}
                    </span>
                  </label>
                ))}
                {restantes > 0 && indiceElegida < VISIBLES_PARTIDA && (
                  <button type="button" className="ni-ver-mas" aria-expanded={verTodas} onClick={() => setVerTodas((v) => !v)}>
                    {verTodas ? tr('Ver menos') : restantes === 1 ? tr('Ver la restante') : trp('Ver las {n} restantes', { n: formatearEntero(restantes) })}
                    <IconoEsc nombre="chevron-down" size={14} className={verTodas ? 'ni-girado' : undefined} />
                  </button>
                )}
              </div>
            </Paso>
          )}

          <Paso
            n={mostrarPartida ? 5 : 4}
            titulo={tr('Misión')}
            sub={tr('Población, etapa, célula o tejido, mecanismo, intervención y capacidades del laboratorio.')}
            estado={hayMision ? <Estado tono="ok">{tr('escrita por ti')}</Estado> : <Estado tono="neutro">{tr('opcional')}</Estado>}
          >
            <div className="ni-mision">
              <p>{verMision ? tr('Si escribes algún campo, la misión queda aprobada por ti; los campos vacíos quedan sin especificar. Si la dejas totalmente vacía, ROSA2018 la propone con el primer plan.') : tr('ROSA2018 propone el marco y las áreas por donde empezar, y tú lo apruebas con el primer plan. Si ya lo tienes claro, escríbelo aquí y queda aprobado por ti.')}</p>
              <button type="button" className="ni-boton" aria-expanded={verMision} onClick={() => setVerMision((v) => !v)}>
                <IconoEsc nombre={verMision ? 'rotate-ccw' : 'pencil'} size={14} />
                {verMision ? tr('Dejar que ROSA2018 la proponga') : tr('Escribirla yo')}
              </button>
            </div>
            {verMision && (
              <div className="ni-rejilla-2">
                {(
                  [
                    ['poblacion', tr('Población'), tr('Adultos con deterioro cognitivo leve, amiloide positivos')],
                    ['etapa', tr('Etapa'), tr('Prodrómica')],
                    ['celulaTejido', tr('Célula o tejido'), tr('Astrocitos; plasma')],
                    ['mecanismo', tr('Mecanismo'), tr('Reactividad astrocitaria')],
                    ['tipoIntervencion', tr('Tipo de intervención o resultado'), tr('Biomarcador de progresión')],
                    ['capacidades', tr('Capacidades del laboratorio (una por línea)'), tr('Inmunoensayo Simoa en plasma')],
                  ] as const
                ).map(([k, label, marcador]) => (
                  <div className="ni-campo" key={k}>
                    <div className="ni-campo-cabecera">
                      <label htmlFor={`nm-${k}`}>{label}</label>
                    </div>
                    {k === 'capacidades' ? (
                      <textarea id={`nm-${k}`} className="ni-caja" rows={2} value={mision[k]} placeholder={marcador} onChange={(e) => setMision({ ...mision, [k]: e.target.value })} />
                    ) : (
                      <input id={`nm-${k}`} className="ni-caja" value={mision[k]} placeholder={marcador} onChange={(e) => setMision({ ...mision, [k]: e.target.value })} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Paso>
        </div>

        <aside className="ni-panel">
          <section className="ni-tarjeta" aria-labelledby="ni-crear-titulo">
            <div className="ni-encabezado">
              <p className="ni-kicker">{tr('Antes de crear')}</p>
              <h3 id="ni-crear-titulo">{tr('Así arrancará la primera corrida')}</h3>
            </div>
            <dl className="ni-resumen">
              {filasResumen.map((f) => (
                <div key={f.icono}>
                  <dt>
                    <IconoEsc nombre={f.icono} size={14} />
                    {f.clave}
                  </dt>
                  <dd className={`ni-valor-${f.tono}`}>{f.valor}</dd>
                </div>
              ))}
            </dl>
            {error && (
              <p role="alert" className="ni-error">
                <IconAlert size={13} />
                <span>{error}</span>
              </p>
            )}
            <button type="submit" className="ni-primario" disabled={creando}>
              <IconoEsc nombre="sparkles" size={15} />
              {creando ? tr('Guardando investigación…') : tr('Crear investigación')}
            </button>
            <div className="ni-crear-pie">
              <span>{tr('después se abre la corrida')}</span>
              <a href="#/" aria-disabled={creando} onClick={(e) => { if (creando) e.preventDefault(); }}>{tr('Cancelar')}</a>
            </div>
          </section>

          <section className="ni-tarjeta" aria-labelledby="ni-config-titulo">
            <div className="ni-config-cabecera">
              <div className="ni-encabezado">
                <p className="ni-kicker">{tr('Lo que ROSA2018 leerá')}</p>
                <h3 id="ni-config-titulo">{tr('Configuración')}</h3>
              </div>
              <button type="button" className="ni-boton ni-boton-s" aria-expanded={editandoConfig} onClick={() => setEditandoConfig((v) => !v)}>
                <IconoEsc nombre={editandoConfig ? 'check' : 'pencil'} size={13} />
                {editandoConfig ? tr('Listo') : tr('Editar')}
              </button>
            </div>
            <p className="ni-nota">{tr('Sugerencia calculada con reglas locales a partir del objetivo. Se guarda para orientar la generación, la revisión y los debates del torneo.')}</p>
            {editandoConfig ? (
              <div className="ni-config-edicion">
                <div className="ni-campo">
                  <label htmlFor="n-pref">{tr('Preferencias')}</label>
                  <textarea id="n-pref" className="ni-caja" value={configEfectiva.preferencias} rows={4} onChange={(e) => setConfig({ ...configEfectiva, preferencias: e.target.value })} />
                </div>
                <div className="ni-campo">
                  <label htmlFor="n-atr">{tr('Atributos deseables (uno por línea)')}</label>
                  <textarea id="n-atr" className="ni-caja" value={configEfectiva.atributos} rows={4} onChange={(e) => setConfig({ ...configEfectiva, atributos: e.target.value })} />
                </div>
                <div className="ni-campo">
                  <label htmlFor="n-res">{tr('Restricciones (una por línea)')}</label>
                  <textarea id="n-res" className="ni-caja" value={configEfectiva.restricciones} rows={4} onChange={(e) => setConfig({ ...configEfectiva, restricciones: e.target.value })} />
                </div>
                {volverPropuesta}
              </div>
            ) : (
              <>
                <div className="ni-config-bloque">
                  <h4>{tr('Preferencias')}</h4>
                  {configEfectiva.preferencias.trim() ? <p className="ni-config-texto">{configEfectiva.preferencias}</p> : <p className="ni-tenue">{tr('Salen del objetivo y de lo que cuenta como relevante.')}</p>}
                </div>
                <div className="ni-config-bloque">
                  <h4>{tr('Atributos deseables')}</h4>
                  <ul className="ni-config-lista">
                    {atributos.map((a) => (
                      <li key={a}>
                        <IconoEsc nombre="plus" size={13} className="ni-icono-ok" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="ni-config-bloque">
                  <h4>{tr('Restricciones')}</h4>
                  {restricciones.length > 0 ? (
                    <ul className="ni-config-lista">
                      {restricciones.map((r) => (
                        <li key={r}>
                          <IconoEsc nombre="ban" size={13} />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ni-tenue">{tr('Ninguna: ni límites ni frases con «sin» o «solo» en el objetivo.')}</p>
                  )}
                </div>
                {volverPropuesta}
              </>
            )}
          </section>
        </aside>
      </div>

      <section className="ni-tarjeta ni-fraseo" aria-labelledby="ni-fraseo-titulo">
        <div className="ni-fraseo-cabecera">
          <div className="ni-encabezado">
            <p className="ni-kicker">{tr('Sensibilidad al fraseo')}</p>
            <h3 id="ni-fraseo-titulo">{tr('Tres redacciones, tres formas de empezar')}</h3>
            <p className="ni-nota">{tr('Estos ejemplos usan plantillas locales; no son planes generados por la IA. ROSA2018 propondrá el plan real después de crear la investigación.')}</p>
          </div>
          <button type="button" className="ni-boton" disabled={!hayObjetivo} aria-expanded={verParafrasis} onClick={() => setVerParafrasis((v) => !v)}>
            <IconoEsc nombre={verParafrasis ? 'eye-off' : 'sparkles'} size={14} />
            {verParafrasis ? tr('Ocultar') : tr('Probar tres paráfrasis')}
          </button>
        </div>
        {!hayObjetivo && <p className="ni-tenue">{tr('Escribe el objetivo para ver cómo cambia con otra redacción.')}</p>}
        {tres.length > 0 && (
          <div className="ni-redacciones">
            {tres.map((p, i) => (
              <article key={i} className="ni-redaccion">
                <header>
                  <b>{trp('Redacción {n}', { n: i + 1 })}</b>
                  <span className="ni-enfoque">{p.enfoque}</span>
                </header>
                <div className="ni-redaccion-texto">
                  <span className="ni-tenue">{tr('Tu objetivo, y además:')}</span>
                  <p>{p.anadido}</p>
                </div>
                <div className="ni-redaccion-tareas">
                  <p className="ni-kicker">{tr('Primeras tareas')}</p>
                  <ol>
                    {p.primerasTareas.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                </div>
                <button type="button" className="ni-boton ni-usar" onClick={() => setObjetivo(p.redaccion)}>
                  <IconoEsc nombre="arrow-up-left" size={14} />
                  {tr('Usar esta redacción')}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      </fieldset>
    </form>
  );
}
