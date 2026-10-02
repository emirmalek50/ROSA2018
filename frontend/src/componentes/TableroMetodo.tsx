// El tablero del método: cómo está investigando ROSA2018, medido por regla al
// cerrar cada iteración (rosa/metodo.py). Es lo que un jefe de laboratorio mira
// antes de opinar: si se busca lo que refuta, si las preguntas abiertas se
// cierran, si el embudo del Killer se mueve, qué forma de generar ideas rinde, si
// se piensa siempre en lo mismo, si se usan las bases que hay y en qué se va el
// tiempo. Las cifras las pone una regla; aquí solo se enseñan. Los avisos van
// primero porque son lo que hay que mirar.
import type { EstadoIndicador, FaseIndicador, IndicadorMetodo, TableroMetodo as Tablero } from '../datos/tipos';
import { traducido, tr, trp } from '../lib/idioma';

const FASE: Record<FaseIndicador, string> = traducido({
  busqueda: 'búsqueda',
  cribado: 'cribado',
  killer: 'Killer',
  equipo: 'equipo de hipótesis',
  conectores: 'conectores',
  bucle: 'bucle',
});

const ESTADO: Record<EstadoIndicador, string> = traducido({ aviso: 'Aviso', bien: 'Bien', sin_datos: 'Sin datos' });

const ORDEN: Record<EstadoIndicador, number> = { aviso: 0, bien: 1, sin_datos: 2 };

function valido(i: unknown): i is IndicadorMetodo {
  return Boolean(i) && typeof i === 'object' && typeof (i as IndicadorMetodo).titulo === 'string' && typeof (i as IndicadorMetodo).estado === 'string';
}

function Fila({ i }: { i: IndicadorMetodo }) {
  const estado: EstadoIndicador = i.estado in ESTADO ? i.estado : 'sin_datos';
  return (
    <li className={`metodo-fila metodo-${estado}`}>
      <div className="metodo-linea">
        <h4>{i.titulo}</h4>
        <span className="metodo-estado">{ESTADO[estado]}</span>
      </div>
      <p className="metodo-cifra">{i.cifra}</p>
      <p className="metodo-texto">{i.texto}</p>
      {estado === 'aviso' && i.queHariaFalta ? (
        <p className="metodo-falta">
          <span>{tr("Haría falta")}</span> {i.queHariaFalta}
        </p>
      ) : null}
      <p className="metodo-fase">{trp("Fase: {v}", { v: FASE[i.fase] ?? i.fase })}</p>
    </li>
  );
}

export function TableroMetodo({ tablero }: { tablero: Tablero | null | undefined }) {
  const indicadores = (Array.isArray(tablero?.indicadores) ? tablero!.indicadores : []).filter(valido);
  if (!tablero || indicadores.length === 0) {
    return (
      <article className="tarjeta metodo" aria-label={tr("Cómo está investigando ROSA2018")}>
        <p className="meta">{tr("Se calcula al cerrar la primera iteración, por regla y sin gastar ninguna llamada: si ROSA2018 busca lo que refuta sus hipótesis, si cierra las preguntas que se apunta, si el embudo del Killer se mueve, qué forma de generar ideas rinde, si piensa siempre en lo mismo, si usa las bases que tiene y en qué se va el tiempo.")}</p>
      </article>
    );
  }
  const ordenados = [...indicadores].sort((a, b) => (ORDEN[a.estado] ?? 3) - (ORDEN[b.estado] ?? 3));
  const avisos = indicadores.filter((i) => i.estado === 'aviso').length;
  // Sin número de iteración es el que el bucle calcula al arrancar para las
  // investigaciones que aún no lo tenían: decir "al cerrar" sería falso.
  const cuando = typeof tablero.iteracion === 'number' ? trp("al cerrar la iteración {iteracion}", { iteracion: tablero.iteracion }) : tr('con lo que había al arrancar ROSA2018; se rehace al cerrar la próxima iteración');
  return (
    <article className="tarjeta metodo" aria-label={tr("Cómo está investigando ROSA2018")}>
      <p className="metodo-resumen">
        {trp("{v} de {indicadores} indicadores, calculado {cuando}.", { v: avisos === 0 ? tr('Ningún aviso') : avisos === 1 ? tr('1 aviso') : `${avisos} avisos`, indicadores: indicadores.length, cuando })}</p>
      <ul className="metodo-lista">
        {ordenados.map((i) => (
          <Fila key={i.clave} i={i} />
        ))}
      </ul>
    </article>
  );
}
