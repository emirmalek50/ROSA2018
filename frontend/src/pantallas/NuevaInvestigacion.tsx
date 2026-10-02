// Definir una investigacion: objetivo, que cuenta como relevante, limites,
// condicion de parada, quien revisa. Con avisos sobre como esta escrito el
// objetivo (las reglas de Edison para Kosmos), la configuracion que ROSA2018
// propone (preferencias, atributos, restricciones, como Co-Scientist),
// tres parafrasis para ver la sensibilidad al fraseo antes de gastar, y la
// opcion de heredar el modelo de mundo de otra investigacion.

import { useMemo, useState } from 'react';
import { acciones } from '../datos/almacen';
import type { EstadoRosa } from '../datos/tipos';
import { Chip, Seccion } from '../componentes/piezas';
import { IconAlert } from '../componentes/icons';
import { avisosDelObjetivo, parafrasis, proponerConfiguracion } from '../lib/objetivo';
import { partesAutomatizadas, textoAutomatizacion } from '../lib/parada';
import { rutaDe } from '../lib/ruta';
import { tr, trp } from '../lib/idioma';

export function NuevaInvestigacion({ estado, irA }: { estado: EstadoRosa; irA: (hash: string) => void }) {
  const [titulo, setTitulo] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [relevancia, setRelevancia] = useState('');
  const [limites, setLimites] = useState(tr('Solo literatura publicada y bases curadas: sin datos de pacientes.\nIgnorar artículos retractados o con expresión de preocupación.'));
  const [parada, setParada] = useState('');
  const [revisores, setRevisores] = useState('');
  const [heredar, setHeredar] = useState<string>('');
  const [verParafrasis, setVerParafrasis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verMision, setVerMision] = useState(false);
  const [mision, setMision] = useState({ poblacion: '', etapa: '', celulaTejido: '', mecanismo: '', tipoIntervencion: '', capacidades: '' });

  const avisos = useMemo(() => avisosDelObjetivo(objetivo, parada), [objetivo, parada]);
  const propuesta = useMemo(() => proponerConfiguracion(objetivo, relevancia, limites.split('\n')), [objetivo, relevancia, limites]);
  const [config, setConfig] = useState<{ preferencias: string; atributos: string; restricciones: string } | null>(null);
  const configEfectiva = config ?? { preferencias: propuesta.preferencias, atributos: propuesta.atributos.join('\n'), restricciones: propuesta.restricciones.join('\n') };
  const tres = useMemo(() => (verParafrasis ? parafrasis(objetivo) : []), [objetivo, verParafrasis]);

  const crear = () => {
    const id = acciones.crearInvestigacion({
      titulo,
      objetivo,
      relevancia,
      limites: limites.split('\n'),
      condicionParada: parada,
      revisores: revisores.split(/[\n,]/),
      configuracion: { preferencias: configEfectiva.preferencias, atributos: configEfectiva.atributos.split('\n'), restricciones: configEfectiva.restricciones.split('\n') },
      heredarModeloDe: heredar || null,
      mision: verMision ? { poblacion: mision.poblacion, etapa: mision.etapa, celulaTejido: mision.celulaTejido, mecanismo: mision.mecanismo, tipoIntervencion: mision.tipoIntervencion, capacidadesLaboratorio: mision.capacidades.split('\n') } : undefined,
    });
    if (id === null) {
      setError(tr('Faltan el título, el objetivo o la condición de parada. Sin condición de parada la corrida no sabe cuando terminar.'));
      return;
    }
    irA(rutaDe(id, 'corrida'));
  };

  return (
    <div className="contenido" style={{ maxWidth: 800 }}>
      <div className="pantalla-cabecera">
        <div>
          <h2>{tr("Nueva investigación")}</h2>
          <p>{tr("Lo que ROSA2018 lee antes de cada iteración. Se puede cambiar después, pero la primera corrida arranca con esto.")}</p>
        </div>
      </div>
      <form
        className="seccion"
        onSubmit={(e) => {
          e.preventDefault();
          crear();
        }}
      >
        <div className="campo">
          <label htmlFor="n-titulo">{tr("Título")}</label>
          <input id="n-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tr("Biomarcadores plasmáticos y progresión en Alzheimer familiar")} />
        </div>
        <div className="campo">
          <label htmlFor="n-objetivo">{tr("Objetivo")}</label>
          <textarea id="n-objetivo" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} rows={3} placeholder={tr("Qué quieres que ROSA2018 encuentre, en una o dos frases. Un solo objetivo por investigación.")} />
          {objetivo.trim() !== '' && avisos.length > 0 && (
            <ul className="avisos-objetivo" aria-label={tr("Avisos sobre el objetivo")}>
              {avisos.map((a) => (
                <li key={a.tipo}>
                  <IconAlert size={13} /> {a.texto}
                </li>
              ))}
            </ul>
          )}
          {objetivo.trim() !== '' && avisos.length === 0 && <small className="tono-ok">{tr("El objetivo tiene contexto, comprobación y una sola dirección.")}</small>}
        </div>
        <div className="campo">
          <label htmlFor="n-relevancia">{tr("Qué cuenta como relevante")}</label>
          <textarea id="n-relevancia" value={relevancia} onChange={(e) => setRelevancia(e.target.value)} rows={2} placeholder={tr("Una diana nueva, una hipótesis mecanística, una asociación biomarcador-progresión, un candidato a reposicionamiento...")} />
          <small>{tr("Es el criterio con el que ROSA2018 prioriza y con el que el revisor juzga. Si está vacío, ROSA2018 perseguira todo lo que parezca significativo.")}</small>
        </div>
        <div className="campo">
          <label htmlFor="n-limites">{tr("Límites (uno por línea)")}</label>
          <textarea id="n-limites" value={limites} onChange={(e) => setLimites(e.target.value)} rows={4} />
        </div>
        <div className="campo">
          <label htmlFor="n-parada">{tr("Condición de parada")}</label>
          <input id="n-parada" value={parada} onChange={(e) => setParada(e.target.value)} placeholder={tr("3 iteraciones, o 72 horas, lo que ocurra primero")} />
          <p className="meta">{parada.trim() ? textoAutomatizacion(partesAutomatizadas(parada)) : tr('ROSA2018 para sola cuando se cumple una cifra: iteraciones, minutos u horas de corrida, o llamadas al modelo. El resto de la frase lo lee para planificar, pero la decisión de parar por otro motivo es tuya.')}</p>
        </div>
        <div className="campo">
          <label htmlFor="n-revisores">{tr("Quien revisa (separados por coma)")}</label>
          <input id="n-revisores" value={revisores} onChange={(e) => setRevisores(e.target.value)} placeholder={tr("la persona responsable, Compañero, el investigador clínico principal")} />
        </div>

        <Seccion titulo={tr("Configuración que ROSA2018 leerá")} nota={tr("Propuesta a partir del objetivo. Es lo que alimenta la generación, la revisión y los debates del torneo. Edítala si no encaja.")}>
          <div className="campo">
            <label htmlFor="n-pref">{tr("Preferencias")}</label>
            <textarea id="n-pref" value={configEfectiva.preferencias} rows={2} onChange={(e) => setConfig({ ...configEfectiva, preferencias: e.target.value })} />
          </div>
          <div className="rejilla-2">
            <div className="campo">
              <label htmlFor="n-atr">{tr("Atributos deseables (uno por línea)")}</label>
              <textarea id="n-atr" value={configEfectiva.atributos} rows={4} onChange={(e) => setConfig({ ...configEfectiva, atributos: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="n-res">{tr("Restricciones (una por línea)")}</label>
              <textarea id="n-res" value={configEfectiva.restricciones} rows={4} onChange={(e) => setConfig({ ...configEfectiva, restricciones: e.target.value })} />
            </div>
          </div>
          {config !== null && (
            <button type="button" className="enlace" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setConfig(null)}>
              {tr("Volver a la propuesta de ROSA2018")}
            </button>
          )}
        </Seccion>

        <Seccion
          titulo={tr("Misión (opcional)")}
          nota={tr("El objetivo puede ser amplio: ROSA2018 propone el marco (población, etapa, célula o tejido, mecanismo, tipo de intervención, capacidades del laboratorio) y las áreas por donde empezar, y tu lo apruebas con el primer plan. Si ya lo tienes claro, escribelo aquí y queda aprobado por ti.")}
          acciones={
            <button type="button" className="btn btn-s" onClick={() => setVerMision((v) => !v)}>
              {(verMision ? tr("Dejar que ROSA2018 la proponga") : tr("Escribirla yo"))}
            </button>
          }
        >
          {verMision && (
            <div className="rejilla-2">
              {(
                [
                  ['poblacion', tr('Población'), tr('Adultos con deterioro cognitivo leve, amiloide positivos')],
                  ['etapa', 'Etapa', 'Prodromica'],
                  ['celulaTejido', 'Célula o tejido', tr('Astrocitos; plasma')],
                  ['mecanismo', 'Mecanismo', tr('Reactividad astrocitaria')],
                  ['tipoIntervencion', tr('Tipo de intervención o resultado'), tr('Biomarcador de progresión')],
                  ['capacidades', tr('Capacidades del laboratorio (una por línea)'), tr('Inmunoensayo Simoa en plasma')],
                ] as const
              ).map(([k, label, marcador]) => (
                <div className="campo" key={k}>
                  <label htmlFor={`nm-${k}`}>{label}</label>
                  {k === 'capacidades' ? <textarea id={`nm-${k}`} rows={2} value={mision[k]} placeholder={marcador} onChange={(e) => setMision({ ...mision, [k]: e.target.value })} /> : <input id={`nm-${k}`} value={mision[k]} placeholder={marcador} onChange={(e) => setMision({ ...mision, [k]: e.target.value })} />}
                </div>
              ))}
            </div>
          )}
        </Seccion>

        <Seccion
          titulo={tr("Sensibilidad al fraseo")}
          nota={tr("Edison admite que las direcciones de Kosmos cambian con la redacción del objetivo. Antes de gastar, mira que primeras tareas propondría ROSA2018 con tres redacciones.")}
          acciones={
            <button type="button" className="btn btn-s" disabled={objetivo.trim() === ''} onClick={() => setVerParafrasis((v) => !v)}>
              {(verParafrasis ? tr("Ocultar") : tr("Probar tres paráfrasis"))}
            </button>
          }
        >
          {tres.length > 0 && (
            <div className="rejilla-3">
              {tres.map((p, i) => (
                <div key={i} className="tarjeta" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontSize: 13 }}>{p.redaccion}</p>
                  <p className="campo-etiqueta">{tr("Primeras tareas")}</p>
                  <ol className="lista-limpia" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    {p.primerasTareas.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                  <button type="button" className="btn btn-s" onClick={() => setObjetivo(p.redaccion)}>
                    {tr("Usar esta redacción")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Seccion>

        {estado.investigaciones.length > 0 && (
          <div className="campo">
            <label htmlFor="n-heredar">{tr("Partir del modelo de mundo de")}</label>
            <select id="n-heredar" value={heredar} onChange={(e) => setHeredar(e.target.value)}>
              <option value="">{tr("Empezar en blanco")}</option>
              {estado.investigaciones.map((i) => (
                <option key={i.id} value={i.id}>
                  {trp("{titulo} ({length} nodos)", { titulo: i.titulo, length: estado.hechos.filter((h) => h.investigacionId === i.id).length })}</option>
              ))}
            </select>
            <small>{tr("ROSA2018 arranca sabiendo lo que ya se supo, se abrió y se descarto en esa investigación.")}</small>
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>
            {error}
          </p>
        )}
        <div className="acciones">
          <button type="submit" className="btn btn-primario">
            {tr("Crear investigación")}
          </button>
          <a className="btn btn-fantasma" href="#/">
            {tr("Cancelar")}
          </a>
          {avisos.length > 0 && objetivo.trim() !== '' && <Chip tono="aviso">{(avisos.length === 1 ? trp("{avisos} aviso sobre el objetivo", { avisos: avisos.length }) : trp("{avisos} avisos sobre el objetivo", { avisos: avisos.length }))}</Chip>}
        </div>
      </form>
    </div>
  );
}
