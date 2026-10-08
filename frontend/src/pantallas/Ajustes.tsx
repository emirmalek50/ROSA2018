// Ajustes: la sesión (correo, si administra la instalación, cerrar sesión),
// permisos concedidos (revocables), dial de autonomía por clase de acción,
// política de esperas (qué pasa con una decisión que nadie toma), memoria de
// ROSA2018 sobre la investigadora, criterios propios de revisión, planes
// guardados, avisos por Slack o correo con el resumen diario, y apariencia.

import { useEffect, useState } from 'react';
import { acciones } from '../datos/almacen';
import { sugerenciasDeAutonomia } from '../datos/acciones';
import type { ClaseAccion, EstadoRosa, NivelAutonomia, PoliticaEsperas } from '../datos/tipos';
import { IconTrash, IconUser, IconGauge, IconBulb, IconMessage, IconGlobe, IconShieldCheck, IconCheck, IconSettings } from '../componentes/icons';
import { CasosDeControl } from '../componentes/CasosDeControl';
import { Chip, Confirmar, Momento, Seccion } from '../componentes/piezas';
import { Conectores, EspejoConvex, IntegridadRegistro, NivelDeAutonomia, Politicas, RegistroAprendizaje, RegistroMetodos, Skills } from '../componentes/Rosa2018';
import { digest, digestComoTexto } from '../lib/digest';
import { ACCION_ESPERA, ALCANCE, CLASE_ACCION, NIVEL_AUTONOMIA, TIPO_PERMISO } from '../lib/etiquetas';
import { useTema, type Tema } from '../lib/theme';
import { Correo } from '../componentes/Correo';
import { ConfiguracionPatentes } from '../componentes/ConfiguracionPatentes';
import { CuentaActual, CuentasDelEquipo, useSesion } from '../componentes/Acceso';
import '../ajustes.css';
import { traducido, tr, trp } from '../lib/idioma';

const CATEGORIAS = traducido([
  { id: 'general', nombre: 'General', descripcion: 'Tu cuenta y tu espacio', icono: IconUser, titulo: 'Un espacio a tu medida', nota: 'Tu cuenta, el equipo y la forma en que ves ROSA2018.' },
  { id: 'autonomia', nombre: 'Autonomía', descripcion: 'Decisiones y permisos', icono: IconGauge, titulo: 'Tú decides hasta dónde', nota: 'Define cuándo ROSA2018 actúa y cuándo necesita tu criterio.' },
  { id: 'memoria', nombre: 'Memoria y criterio', descripcion: 'Preferencias y revisión', icono: IconBulb, titulo: 'Lo que ROSA2018 aprende de ti', nota: 'Revisa sus recuerdos, reutiliza planes y afina tus criterios de investigación.' },
  { id: 'avisos', nombre: 'Avisos', descripcion: 'Canales y novedades', icono: IconMessage, titulo: 'Al tanto, a tu manera', nota: 'Elige qué novedades quieres recibir mientras ROSA2018 investiga.' },
  { id: 'herramientas', nombre: 'Herramientas', descripcion: 'Fuentes, métodos y modelos', icono: IconGlobe, titulo: 'Las piezas de la investigación', nota: 'Explora las fuentes, los métodos y los modelos disponibles para ROSA2018.' },
  { id: 'seguridad', nombre: 'Seguridad', descripcion: 'Políticas y trazabilidad', icono: IconShieldCheck, titulo: 'El control sigue contigo', nota: 'Consulta las políticas, la integridad del registro y la copia del estado.' },
] as const);
type Categoria = typeof CATEGORIAS[number]['id'];

const CRITERIOS_INTEGRADOS = traducido([
  'Toda afirmación lleva una cita que resuelve a la página exacta del dato.',
  'Un identificador (NCT, DOI, PMID) que no aparece en el fragmento citado no se sostiene.',
  'Un dato de otra entidad (otro fármaco, cohorte, estudio) se marca aunque la cifra sea real.',
  'Una declaración de ausencia desmentida por el corpus se bloquea.',
  'Nada se aprueba por omisión: sin veredicto es "sin verificar".',
  'Una "ausencia refutada" solo vale si la búsqueda del tema ha convergido.',
]);

/** Un campo de texto que guarda al salir (o con Enter), no en cada tecla:
 *  cada guardado es una acción que viaja al servidor y queda en el registro. */
function EntradaDiferida({ id, valor, onGuardar, tipo = 'text' }: { id: string; valor: string; onGuardar: (v: string) => void; tipo?: string }) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    setV(valor);
  }, [valor]);
  const guardar = () => {
    if (v !== valor) onGuardar(v);
  };
  return (
    <input
      id={id}
      type={tipo}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') guardar();
      }}
    />
  );
}

function Recuerdo({ id, texto }: { id: string; texto: string }) {
  const [valor, setValor] = useState(texto);
  return (
    <li>
      <textarea
        className="entrada"
        value={valor}
        rows={2}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => {
          if (valor.trim() === '') setValor(texto);
          else acciones.editarRecuerdo(id, valor);
        }}
        aria-label={tr("Recuerdo")}
      />
      <button type="button" className="btn btn-fantasma btn-icono" aria-label={tr("Borrar recuerdo")} onClick={() => acciones.borrarRecuerdo(id)}>
        <IconTrash size={14} />
      </button>
    </li>
  );
}

export function Ajustes({ estado, ahora }: { estado: EstadoRosa; ahora: number }) {
  const sesion = useSesion();
  const [categoria, setCategoria] = useState<Categoria>('general');
  const actual = CATEGORIAS.find((c) => c.id === categoria)!;
  const [tema, setTema] = useTema();
  const [criterio, setCriterio] = useState('');
  const [politica, setPolitica] = useState<PoliticaEsperas>(estado.politicaEsperas);
  // Si la política cambia en el servidor (otra pestaña, otra persona), el
  // formulario la toma; lo que se ve nunca es una copia vieja.
  const firmaPolitica = JSON.stringify(estado.politicaEsperas);
  useEffect(() => {
    setPolitica(estado.politicaEsperas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaPolitica]);
  const avisos = estado.avisos;
  const sugerencias = sugerenciasDeAutonomia(estado);
  const inv = estado.investigaciones[0];
  const ejemploDigest = inv ? digestComoTexto(digest(estado, inv.id, ahora), inv.titulo) : '';

  return (
    <div className="contenido ajustes">
      <header className="ajustes-cabecera">
        <div className="ajustes-emblema"><IconSettings size={25} /></div>
        <div><h2>{tr("Ajustes")}</h2><p>{tr("Tu forma de trabajar con ROSA2018.")}</p></div>
        <span className="ajustes-contexto">Alzheimer Project</span>
        <img className="ajustes-arbol" src="/arbol-marca.png" alt="" aria-hidden="true" />
      </header>
      <div className="ajustes-layout">
        <nav className="ajustes-nav" aria-label={tr("Categorías de ajustes")}>
          <div role="tablist" aria-label={tr("Ajustes")} aria-orientation="vertical" onKeyDown={(e) => {
            const indice = CATEGORIAS.findIndex((c) => c.id === categoria);
            let siguiente = indice;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') siguiente = (indice + 1) % CATEGORIAS.length;
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') siguiente = (indice + CATEGORIAS.length - 1) % CATEGORIAS.length;
            else if (e.key === 'Home') siguiente = 0;
            else if (e.key === 'End') siguiente = CATEGORIAS.length - 1;
            else return;
            e.preventDefault();
            const destino = CATEGORIAS[siguiente]!;
            setCategoria(destino.id);
            document.getElementById(`ajuste-tab-${destino.id}`)?.focus();
          }}>
            {CATEGORIAS.map(({ id, nombre, descripcion, icono: Icono }) => (
              <button key={id} type="button" role="tab" id={`ajuste-tab-${id}`} aria-controls={`ajuste-panel-${id}`} aria-selected={categoria === id} tabIndex={categoria === id ? 0 : -1} onClick={() => setCategoria(id)}>
                <Icono size={19} /><span><strong>{nombre}</strong><small>{descripcion}</small></span>
              </button>
            ))}
          </div>
          <p className="ajustes-nav-nota"><IconShieldCheck size={17} />{tr("ROSA2018 investiga.")}<br />{tr("Tú marcas los límites.")}</p>
        </nav>
        <div className="ajustes-cuerpo">
          <header key={categoria} className="ajustes-intro cambio-panel"><h3>{actual.titulo}</h3><p>{actual.nota}</p></header>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-general" aria-labelledby="ajuste-tab-general" hidden={categoria !== 'general'} tabIndex={0}>
            {sesion && (
              <Seccion titulo={tr("Sesión")} nota={tr("La cuenta con la que has entrado en ROSA2018. Cerrar la sesión te devuelve a la pantalla de acceso; las investigaciones y sus corridas quedan en el servidor.")}>
                <div className="ajustes-identidad"><span className="ajustes-avatar" aria-hidden="true"><IconUser size={23} /></span><CuentaActual /></div>
                <CuentasDelEquipo />
              </Seccion>
            )}

            <Seccion titulo={tr("Apariencia")} nota={tr("Elige cómo quieres ver tu espacio. Se guarda en este navegador.")}>
              <div className="ajustes-temas" role="group" aria-label={tr("Tema")}>
                {(['claro', 'oscuro', 'sistema'] as Tema[]).map((t) => (
                  <button className="ajustes-tema" data-tema={t} key={t} type="button" aria-pressed={tema === t} onClick={() => setTema(t)}>
                    <span className="ajustes-miniatura" aria-hidden="true">
                      <span className="ajustes-mini-lateral"><img src="/arbol-marca.png" alt="" /><i /><i /><i /></span>
                      <span className="ajustes-mini-contenido"><b /><i /><i /><span><i /><i /></span><em><i /><i /><i /></em></span>
                    </span>
                    <span className="ajustes-tema-etiqueta">{t === 'sistema' ? tr('Como el sistema') : t === 'claro' ? 'Claro' : 'Oscuro'}<span className="ajustes-tema-marca">{tema === t && <IconCheck size={13} />}</span></span>
                  </button>
                ))}
              </div>
              <div className="ajustes-recorrido">
                <div><strong>{tr("Vuelve a descubrir ROSA2018")}</strong><p>{tr("Un recorrido breve por tu espacio de investigación.")}</p></div>
                <button type="button" className="btn btn-s" onClick={() => { try { localStorage.removeItem('rosa.recorrido.v1'); } catch { /* sin almacenamiento */ } window.location.reload(); }}>
                  {tr("Ver recorrido")}
                </button>
              </div>
            </Seccion>

          </div>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-autonomia" aria-labelledby="ajuste-tab-autonomia" hidden={categoria !== 'autonomia'} tabIndex={0}>
            <Seccion titulo={tr("Autonomía por clase de acción")} nota={tr("Elige una opción para cada acción. Los cambios se envían al seleccionar; los límites de la investigación siguen vigentes.")}>
              <div className="ajustes-autonomia">
                {(Object.keys(CLASE_ACCION) as ClaseAccion[]).map((c) => (
                  <fieldset className="ajustes-regla" key={c}>
                    <legend>{CLASE_ACCION[c]}</legend>
                    <div className="ajustes-niveles">
                      {(['sugerir', 'preguntar', 'actuar'] as NivelAutonomia[]).map((n) => (
                        <label key={n}>
                          <input type="radio" name={`aut-${c}`} checked={estado.autonomia[c] === n} onChange={() => acciones.fijarAutonomia(c, n)} aria-label={`${CLASE_ACCION[c]}: ${NIVEL_AUTONOMIA[n]}`} />
                          <span>{NIVEL_AUTONOMIA[n]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              {sugerencias.length > 0 && (
                <div className="aviso-muestra">
                  {trp("ROSA2018 ha visto que has concedido {v} con alcance amplio. Si quieres, sube esa clase a \"actuar y avisar\" en los controles de arriba.", { v: sugerencias.map((s) => trp("{veces} permisos de \"{v}\"", { veces: s.veces, v: TIPO_PERMISO[s.tipo as keyof typeof TIPO_PERMISO] ?? s.tipo })).join(' y ') })}
          </div>
        )}
      </Seccion>

      <Seccion titulo={tr("Qué pasa con una decisión que nadie toma")} nota={tr("En una corrida de días la cola envejece. Esto lo decide una persona, nunca la interfaz por accidente.")}>
        <div className="tarjeta seccion">
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor="pe-horas">{tr("Horas de espera")}</label>
              <input id="pe-horas" type="number" min={1} value={politica.horas} onChange={(e) => setPolitica({ ...politica, horas: Number(e.target.value) })} />
            </div>
            <div className="campo">
              <label htmlFor="pe-accion">{tr("Entonces")}</label>
              <select id="pe-accion" value={politica.accion} onChange={(e) => setPolitica({ ...politica, accion: e.target.value as PoliticaEsperas['accion'] })}>
                {(Object.keys(ACCION_ESPERA) as PoliticaEsperas['accion'][]).map((a) => (
                  <option key={a} value={a}>
                    {ACCION_ESPERA[a]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="pe-escalar">{tr("Escalar a")}</label>
              <input id="pe-escalar" value={politica.escalarA} disabled={politica.accion !== 'escalar'} onChange={(e) => setPolitica({ ...politica, escalarA: e.target.value })} />
            </div>
          </div>
          <div className="acciones">
            <button type="button" className="btn btn-primario btn-s" disabled={JSON.stringify(politica) === JSON.stringify(estado.politicaEsperas)} onClick={() => acciones.actualizarPoliticaEsperas(politica)}>
              {tr("Guardar")}
            </button>
            <span className="meta">
              {trp("Hoy: si nadie decide en {horas} h, {v}{v2}.", { horas: estado.politicaEsperas.horas, v: ACCION_ESPERA[estado.politicaEsperas.accion].toLowerCase(), v2: estado.politicaEsperas.accion === 'escalar' ? ` (${estado.politicaEsperas.escalarA})` : '' })}</span>
          </div>
        </div>
      </Seccion>

      <Seccion detalle titulo={tr("Permisos concedidos")} nota={tr("Lo que has permitido con alcance mayor que una vez. Revocar hace que ROSA2018 vuelva a pedirlo con una tarjeta.")}>
        {estado.permisos.length === 0 ? (
          <p className="meta">{tr("Sin permisos concedidos.")}</p>
        ) : (
          <div>
            {estado.permisos.map((p) => {
              const i = p.investigacionId ? estado.investigaciones.find((x) => x.id === p.investigacionId) : null;
              return (
                <div key={p.id} className="ajuste-fila">
                  <div>
                    <span className="mono">{p.recurso}</span>
                    <small>
                      {TIPO_PERMISO[p.tipo]} · {ALCANCE[p.alcance]}
                      {i ? ` · ${i.titulo}` : ''} · <Momento t={p.concedidoEn} ahora={ahora} />
                    </small>
                  </div>
                  <Confirmar etiqueta={tr("Revocar")} pregunta={tr("ROSA2018 dejará de tener este acceso y lo pedirá de nuevo si lo necesita.")} onConfirmar={() => acciones.revocarPermiso(p.id)} />
                </div>
              );
            })}
          </div>
        )}
      </Seccion>

          </div>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-memoria" aria-labelledby="ajuste-tab-memoria" hidden={categoria !== 'memoria'} tabIndex={0}>
            <Seccion titulo={tr("Memoria de ROSA2018 sobre ti")} nota={tr("Hechos cortos sobre la investigadora y sus preferencias. Aparte del modelo de mundo, que es de la investigación.")}>
              {estado.memoria.length === 0 ? (
                <p className="meta">{tr("ROSA2018 no recuerda nada todavía.")}</p>
              ) : (
                <ul className="lista-limpia">
                  {estado.memoria.map((r) => (
                    <Recuerdo key={r.id} id={r.id} texto={r.texto} />
                  ))}
                </ul>
              )}
            </Seccion>

            <Seccion detalle titulo={tr("Planes guardados")} nota={tr("Flujos que funcionaron, reutilizables. ROSA2018 propone usarlos cuando la tarea se parece (memoria de planes, como Magentic-UI).")}>
              {estado.planesGuardados.length === 0 ? (
                <p className="meta">{tr("Sin planes guardados.")}</p>
              ) : (
                <ul className="lista-limpia">
                  {estado.planesGuardados.map((p) => (
                    <li key={p.id}>
                      <div>
                        <strong style={{ fontSize: 13.5 }}>{p.nombre}</strong>
                        <p className="meta">
                          {(p.vecesUsado === 1 ? trp("{v} · usado {vecesUsado} vez, {exitos} con éxito", { v: p.pasos.join(' → '), vecesUsado: p.vecesUsado, exitos: p.exitos }) : trp("{v} · usado {vecesUsado} veces, {exitos} con éxito", { v: p.pasos.join(' → '), vecesUsado: p.vecesUsado, exitos: p.exitos }))}</p>
                      </div>
                      <button type="button" className="btn btn-fantasma btn-icono" aria-label={tr("Borrar plan guardado")} onClick={() => acciones.borrarPlanGuardado(p.id)}>
                        <IconTrash size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            <Seccion detalle titulo={tr("Criterios de revisión")} nota={tr("Los tuyos se suman a los integrados y no pueden debilitarlos. Las debilidades de la meta-revisión se inyectan aquí.")}>
              <div className="tarjeta">
                <p className="campo-etiqueta" style={{ marginBottom: 8 }}>
                  {tr("Integrados (no se pueden quitar)")}
                </p>
                <ul className="lista-limpia">
                  {CRITERIOS_INTEGRADOS.map((c) => (
                    <li key={c}>
                      <span className="meta">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="lista-limpia">
                {estado.criteriosRevision.map((c, i) => (
                  <li key={c}>
                    <span>{c}</span>
                    <button type="button" className="btn btn-fantasma btn-icono" aria-label={tr("Quitar criterio")} onClick={() => acciones.borrarCriterio(i, c)}>
                      <IconTrash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="dirigir">
                <textarea className="entrada" value={criterio} rows={1} placeholder={tr("Un criterio nuevo: 'Toda cifra de eficacia lleva el nombre del ensayo'")} onChange={(e) => setCriterio(e.target.value)} aria-label={tr("Criterio nuevo")} />
                <button
                  type="button"
                  className="btn"
                  disabled={criterio.trim() === ''}
                  onClick={() => {
                    acciones.anadirCriterio(criterio);
                    setCriterio('');
                  }}
                >
                  {tr("Añadir")}
                </button>
              </div>
            </Seccion>

            <RegistroAprendizaje estado={estado} ahora={ahora} />

            {/* Los 17 casos de control. Estaban en la pantalla de Calidad,
                que se retiró el 2 de octubre de 2026; son un criterio de
                investigación, que es de lo que va esta pestaña. */}
            <CasosDeControl casos={estado.casos} />
          </div>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-avisos" aria-labelledby="ajuste-tab-avisos" hidden={categoria !== 'avisos'} tabIndex={0}>
            <Seccion titulo={tr("Avisos")} nota={tr("El bucle trabaja cuando nadie mira. Estos ajustes son de tu cuenta; el correo lleva contadores y un enlace, sin datos sensibles.")}>
              <div className="tarjeta seccion">
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.slack.activo} onChange={(e) => acciones.actualizarAvisos({ ...avisos, slack: { ...avisos.slack, activo: e.target.checked } })} />
                  {tr("Slack")}
                </label>
                {avisos.slack.activo && (
                  <div className="campo">
                    <label htmlFor="slack-canal">{tr("Canal")}</label>
                    <EntradaDiferida id="slack-canal" valor={avisos.slack.canal} onGuardar={(v) => acciones.actualizarAvisos({ ...avisos, slack: { ...avisos.slack, canal: v } })} />
                    <small>{tr("La conexión con Slack se hará con un botón \"Conectar con Slack\" cuando ROSA2018 esté en su servidor; aquí solo se elige el canal.")}</small>
                  </div>
                )}
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.correo.activo} onChange={(e) => acciones.actualizarAvisos({ ...avisos, correo: { ...avisos.correo, activo: e.target.checked } })} />
                  {tr("Correo")}
                </label>
                <p>{tr("Los avisos llegan a la cuenta verificada que inició cada corrida. No se utiliza una dirección global.")}</p>
                <p className="campo-etiqueta">{tr("Avisar cuando")}</p>
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.cuando.hipotesisNueva} onChange={(e) => acciones.actualizarAvisos({ ...avisos, cuando: { ...avisos.cuando, hipotesisNueva: e.target.checked } })} />
                  {tr("Hay una hipótesis nueva en la cola")}
                </label>
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.cuando.permisoPendiente} onChange={(e) => acciones.actualizarAvisos({ ...avisos, cuando: { ...avisos.cuando, permisoPendiente: e.target.checked } })} />
                  {tr("ROSA2018 espera un plan, un permiso o tiene una incidencia")}
                </label>
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.cuando.corridaDetenida} onChange={(e) => acciones.actualizarAvisos({ ...avisos, cuando: { ...avisos.cuando, corridaDetenida: e.target.checked } })} />
                  {tr("Una corrida se detiene, se pausa por presupuesto o termina")}
                </label>
                <label className="interruptor">
                  <input type="checkbox" checked={avisos.cuando.resumenDiario} onChange={(e) => acciones.actualizarAvisos({ ...avisos, cuando: { ...avisos.cuando, resumenDiario: e.target.checked } })} />
                  {tr("Resumen diario de estado (contadores y enlace)")}
                </label>
                {avisos.cuando.resumenDiario && ejemploDigest !== '' && (
                  <div>
                    <p className="campo-etiqueta">{tr("Resumen ampliado solo en ROSA2018; el correo no incluye estos detalles")}</p>
                    <pre className="registro">{ejemploDigest}</pre>
                  </div>
                )}
              </div>
              <Correo servidor={estado.conexion === 'en_linea'} />
            </Seccion>

          </div>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-herramientas" aria-labelledby="ajuste-tab-herramientas" hidden={categoria !== 'herramientas'} tabIndex={0}>
            {categoria === 'herramientas' && <ConfiguracionPatentes servidor={estado.conexion === 'en_linea'} />}
            <Conectores conectores={estado.conectores} />
            <Skills skills={estado.skills} />
            <RegistroMetodos metodos={estado.metodos} ahora={ahora} />
            <Seccion detalle titulo={tr("Modelos de ROSA2018")} nota={tr("Piezas intercambiables dentro de ROSA2018, todas por el AI Gateway de Vercel. Se cambian por la métrica, no por el precio. Si un modelo no responde, ROSA2018 registra la incidencia y reintenta sin sustituir al cerebro por el modelo de volumen.")}>
              <table className="tabla">
                <tbody>
                  <tr>
                    <td>{tr("Cerebro del bucle")}</td>
                    <td className="mono">{"openai/gpt-6-astra"}</td>
                    <td>
                      <Chip tono="ok">{tr("Elegido")}</Chip>
                    </td>
                  </tr>
                  <tr>
                    <td>{tr("Juez del verificador")}</td>
                    <td className="mono">{"anthropic/claude-opus-5"}</td>
                    <td>
                      <Chip tono="aviso">{tr("A confirmar frente a Astra con casos aprobados")}</Chip>
                    </td>
                  </tr>
                  <tr>
                    <td>{tr("Alto volumen sin veto")}</td>
                    <td className="mono">{"anthropic/claude-sonnet-5.5"}</td>
                    <td>
                      <Chip tono="ok">{tr("Elegido")}</Chip>
                    </td>
                  </tr>
                  <tr>
                    <td>{tr("Reserva")}</td>
                    <td className="mono">{"anthropic/claude-fable-5.1"}</td>
                    <td>
                      <Chip tono="mal">{tr("Fuera: filtros de doble uso en biología")}</Chip>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Seccion>
          </div>
          <div className="ajustes-panel" role="tabpanel" id="ajuste-panel-seguridad" aria-labelledby="ajuste-tab-seguridad" hidden={categoria !== 'seguridad'} tabIndex={0}>
            <Politicas politicas={estado.politicas} />
            <NivelDeAutonomia politicas={estado.politicas} />
            {categoria === 'seguridad' && <><IntegridadRegistro /><EspejoConvex ahora={ahora} /></>}
          </div>
        </div>
      </div>
    </div>
  );
}
