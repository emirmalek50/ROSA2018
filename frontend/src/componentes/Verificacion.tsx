// Informe de verificacion de una hipotesis, plegable. Mismas decisiones que
// la insignia del RAG: arriba se resume el fallo, no el acierto; sin_verificar
// se pinta como aviso, nunca como aprobado; cerrado por defecto.
//
// Anade el tipo de cada afirmacion (dato, literatura, interpretacion: Kosmos
// midio 85, 82 y 58 % de acierto respectivamente), la trayectoria y celda
// que produjo una cifra, y la degradacion de "ausencia refutada" cuando la
// busqueda del tema no ha convergido.

import { useState } from 'react';
import type { Afirmacion, Cobertura } from '../datos/tipos';
import { veredictoConCobertura } from '../lib/cobertura';
import { TIPO_AFIRMACION, tipoAfirmacion, VEREDICTO } from '../lib/etiquetas';
import { resumirVerificacion } from '../lib/hipotesis';
import { IconAlert, IconCheck, IconChevronDown } from './icons';
import { Chip } from './piezas';
import { tr } from '../lib/idioma';

interface Props {
  afirmaciones: Afirmacion[];
  cobertura?: Cobertura | null;
  /** Ocultar las citas (revision a ciegas). */
  ocultarCitas?: boolean;
  onVerTrayectoria?: (id: string, celda: number) => void;
}

export function Verificacion({ afirmaciones, cobertura = null, ocultarCitas = false, onVerTrayectoria }: Props) {
  const [abierto, setAbierto] = useState(false);
  const efectivas = afirmaciones.map((a) => ({ a, ...veredictoConCobertura(a.veredicto, cobertura) }));
  const r = resumirVerificacion(efectivas.map((x) => ({ ...x.a, veredicto: x.veredicto })));
  const porTipo = { dato: 0, literatura: 0, interpretacion: 0 };
  for (const a of afirmaciones) porTipo[a.tipo]++;
  return (
    <div className={`verif verif-${r.tono}`}>
      <button type="button" className="verif-cabecera" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} disabled={r.total === 0}>
        {r.tono === 'ok' ? <IconCheck size={13} /> : <IconAlert size={13} />}
        <span className="verif-frase">{r.frase}</span>
        {porTipo.interpretacion > 0 && (
          <Chip tono="aviso" title={TIPO_AFIRMACION.interpretacion.nota}>
            {porTipo.interpretacion} {porTipo.interpretacion === 1 ? 'interpretacion' : 'interpretaciones'}
          </Chip>
        )}
        {r.total > 0 && (
          <span style={{ transform: abierto ? 'rotate(180deg)' : 'none', display: 'inline-flex' }}>
            <IconChevronDown size={12} />
          </span>
        )}
      </button>
      {abierto && (
        <ul className="verif-lista">
          {efectivas.map(({ a, veredicto, nota }, i) => {
            const v = VEREDICTO[veredicto];
            const etiqueta = a.entidadDistinta ? 'Dato de otra entidad' : v.etiqueta;
            return (
              <li key={i} className="verif-item">
                <span className={`verif-veredicto tono-${v.tono}`}>
                  {etiqueta}
                  <br />
                  <Chip tono={a.tipo === 'interpretacion' ? 'aviso' : 'borde'} title={tipoAfirmacion(a.tipo).nota}>
                    {tipoAfirmacion(a.tipo).etiqueta}
                  </Chip>
                  {a.relacion && (
                    <>
                      <br />
                      <Chip tono={a.relacion === 'contradice' ? 'mal' : a.relacion === 'apoya' ? 'ok' : 'aviso'} title={`${a.motivoRelacion ?? ''}${a.relacion === 'socava' ? tr(' Ataca el método o la inferencia de otro apoyo de esta hipótesis, no la hipótesis; el apoyo socavado deja de contar para el techo de certeza.') : ''}${a.iteracion ? ` Enlazada al cerrar la iteración ${a.iteracion}, después de nacer la hipótesis.` : ''}`.trim()}>
                        {a.relacion === 'contradice' ? tr('En contra') : a.relacion === 'apoya' ? tr('A favor') : a.relacion === 'socava' ? tr('Socava un apoyo') : tr('Apoyo indirecto')}
                      </Chip>
                    </>
                  )}
                </span>
                <span className="verif-texto">
                  <span className="texto-comentable" data-campo="afirmacion">
                    {a.texto}
                  </span>
                  {!ocultarCitas && a.cita !== '' && <span className="verif-cita">{a.cita}</span>}
                  {ocultarCitas && a.cita !== '' && <span className="verif-cita">{tr("[cita oculta: revisión a ciegas]")}</span>}
                  {!ocultarCitas && a.fragmento && (
                    <details className="verif-fragmento">
                      <summary>{tr("Lo que dice la fuente, literal")}</summary>
                      <blockquote>{a.fragmento}</blockquote>
                    </details>
                  )}
                  {a.trayectoria && onVerTrayectoria && (
                    <button type="button" className="chip chip-acento" style={{ alignSelf: 'flex-start' }} onClick={() => onVerTrayectoria(a.trayectoria!.id, a.trayectoria!.celda)}>
                      Trayectoria {a.trayectoria.id}, celda {a.trayectoria.celda}
                    </button>
                  )}
                  {!ocultarCitas && a.motivo !== '' && <span className="verif-motivo">{a.motivo}</span>}
                  {nota && <span className="verif-motivo tono-aviso">{nota}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
