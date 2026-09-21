// Inicio: "ahora" en cada investigación (qué hace ROSA2018, qué espera), y el
// resumen "mientras no estabas" de la que tiene actividad. Es la pantalla
// del que vuelve tras horas, como el dashboard con tarjetas "Now" de Claude
// Science y el recap de la vista de agentes de Claude Code.
//
// Esperas visibles (estándar de Emir, 19 de septiembre de 2026): si el estado
// global todavía no ha llegado se pinta la silueta de las tarjetas
// (EsqueletoPantalla "panel"), nunca una página vacía. El resto se pinta en
// el mismo render, sin diferir: aquí no hay cálculo pesado (un resumen por
// investigación), no hay cambio de investigación que congele nada, y esta
// pantalla también se renderiza en estático (renderToStaticMarkup en los
// tests de punta a punta), donde un contenido diferido no llegaría nunca.

import { acciones } from '../datos/almacen';
import type { EstadoRosa } from '../datos/tipos';
import { iteracionActualDe } from '../datos/acciones';
import { Resumen } from '../componentes/Resumen';
import { Aparece } from '../componentes/Animado';
import { Esqueleto, EsqueletoPantalla, EsqueletoTarjeta } from '../componentes/Esqueleto';
import { Chip, Momento, Vacio } from '../componentes/piezas';
import { digest, loQueEspera } from '../lib/digest';
import { ESTADO_CORRIDA, etiquetaCorrida, proponiendoPlan } from '../lib/etiquetas';
import { formatearDuracion } from '../lib/formato';
import { rutaDe } from '../lib/ruta';

const CABECERA_INICIO = {
  titulo: 'Investigaciones',
  descripcion: 'Cada investigación tiene su objetivo, sus límites y su condición de parada. ROSA2018 corre dentro de ellos y tú revisas lo que propone.',
};
/** Medido en Chromium a 1440 px: cada tarjeta del inicio mide entre 191 y 215 px. */
const ALTO_TARJETA_INICIO = 205;

/** La silueta del inicio: la cabecera con su texto real (mide lo mismo que
 *  la real), el botón de nueva investigación en gris y la rejilla de
 *  tarjetas, tantas como investigaciones haya (y al menos tres). */
export function EsqueletoInicio({ tarjetas }: { tarjetas: number }) {
  return (
    <EsqueletoPantalla variante="panel" rotulo="las investigaciones" cabecera={CABECERA_INICIO} acciones={<Esqueleto className="esqueleto-boton esqueleto-boton-ancho" />}>
      <div className="inicio-rejilla" style={{ marginTop: 20 }} aria-hidden="true">
        {Array.from({ length: Math.min(12, Math.max(3, tarjetas)) }, (_, i) => (
          <EsqueletoTarjeta key={i} lineas={4} alto={ALTO_TARJETA_INICIO} />
        ))}
      </div>
    </EsqueletoPantalla>
  );
}

export function Inicio({ estado, ahora }: { estado: EstadoRosa; ahora: number }) {
  if (estado.conexion === 'conectando') return <EsqueletoInicio tarjetas={estado.investigaciones.length} />;
  return (
    <div className="contenido">
      <div className="pantalla-cabecera">
        <div>
          <h2>{CABECERA_INICIO.titulo}</h2>
          <p>{CABECERA_INICIO.descripcion}</p>
        </div>
        <a className="btn btn-primario" href="#/nueva">
          Nueva investigación
        </a>
      </div>

      {estado.investigaciones.map((inv) => {
        const d = digest(estado, inv.id, ahora);
        if (!d.hayNovedades) return null;
        return <Resumen key={inv.id} d={d} titulo={inv.titulo} ahora={ahora} onVisto={() => acciones.marcarVisita()} />;
      })}

      {estado.investigaciones.length === 0 ? (
        <Vacio
          titulo="Todavía no hay investigaciones"
          pasos={['Escribes el objetivo, los límites y la condición de parada.', 'ROSA2018 propone la misión y el plan de la primera iteración; tú lo apruebas.', 'Busca literatura, verifica, actualiza el modelo de mundo y genera hipótesis.', 'Tú decides sobre las hipótesis; las candidatas van al laboratorio con prerregistro.']}
          accion={
            <a className="btn btn-primario" href="#/nueva">
              Crear la primera investigación
            </a>
          }
        >
          Una investigación es un objetivo con sus límites y su condición de parada. ROSA2018 corre dentro de ellos.
        </Vacio>
      ) : (
        <div className="inicio-rejilla" style={{ marginTop: 20 }}>
          {estado.investigaciones.map((inv, idx) => {
            const corrida = estado.corridas.filter((c) => c.investigacionId === inv.id).sort((a, b) => b.numero - a.numero)[0];
            const it = corrida ? iteracionActualDe(estado, corrida) : null;
            const enCurso = it?.plan.find((p) => p.estado === 'en_curso');
            const espera = loQueEspera(estado, inv.id, ahora);
            const pistasVivas = it?.pistas.filter((p) => p.estado === 'en_curso').length ?? 0;
            return (
              <Aparece key={inv.id} retraso={idx * 0.05}>
              <a className="tarjeta tarjeta-interactiva inicio-tarjeta" href={rutaDe(inv.id, 'corrida')}>
                <h3>{inv.titulo}</h3>
                {corrida ? (
                  <div className="ahora">
                    <Chip tono={corrida.estado === 'en_marcha' ? 'acento' : corrida.estado === 'esperando_plan' || corrida.estado === 'esperando_aprobacion' || corrida.estado === 'pausada_por_presupuesto' || corrida.estado === 'esperando_modelo' ? 'aviso' : undefined}>
                      Corrida {corrida.numero} · {etiquetaCorrida(corrida, it)}
                    </Chip>
                    <p>
                      {corrida.estado === 'en_marcha' && enCurso ? (
                        <>
                          Iteración {corrida.iteracionActual}: <span className="shimmer-text">{enCurso.titulo.toLowerCase()}</span>
                          {pistasVivas > 0 && ` (${pistasVivas} ${pistasVivas === 1 ? 'pista' : 'pistas'} en paralelo)`}
                        </>
                      ) : corrida.estado === 'esperando_plan' ? (
                        proponiendoPlan(corrida, it) ? `ROSA2018 está escribiendo el plan de la iteración ${corrida.iteracionActual}; en uno o dos minutos te lo enseña` : `El plan de la iteración ${corrida.iteracionActual} espera tu aprobación`
                      ) : corrida.motivoCierre ? (
                        corrida.motivoCierre
                      ) : (
                        ESTADO_CORRIDA[corrida.estado]
                      )}
                    </p>
                  </div>
                ) : (
                  <p>{inv.objetivo}</p>
                )}
                <footer>
                  {espera.total > 0 ? (
                    <Chip tono={espera.masAntiguaMs > estado.politicaEsperas.horas * 3_600_000 ? 'mal' : 'aviso'}>
                      {espera.total} {espera.total === 1 ? 'decisión espera' : 'decisiones esperan'}
                      {espera.masAntiguaMs > 60_000 && ` · la más antigua ${formatearDuracion(espera.masAntiguaMs)}`}
                    </Chip>
                  ) : (
                    <Chip tono="ok">Nada espera</Chip>
                  )}
                  {inv.ramaDe && <Chip tono="borde">Rama</Chip>}
                  {inv.vigilarLiteraturaHasta && inv.vigilarLiteraturaHasta > ahora && <Chip tono="borde">Vigilando literatura</Chip>}
                  <span>
                    Creada <Momento t={inv.creadaEn} ahora={ahora} soloRelativo />
                  </span>
                </footer>
              </a>
              </Aparece>
            );
          })}
        </div>
      )}
    </div>
  );
}
