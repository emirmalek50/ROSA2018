import { IconMenu, IconSearch } from './icons';
import { t } from '../lib/idioma';
import { fijarModo, useModo } from '../lib/modo';
import { SelectorIdioma } from './Idioma';

interface Props {
  miga: string | null;
  titulo: string;
  /** Decisiones que esperan a una persona en la investigacion actual. */
  esperan: number;
  onMenu: () => void;
  onBuscar: () => void;
}

export function Cabecera({ miga, titulo, esperan, onMenu, onBuscar }: Props) {
  const modo = useModo();
  return (
    <header className="cabecera">
      <button type="button" className="btn btn-fantasma btn-icono btn-menu" aria-label={t('Abrir el menú')} onClick={onMenu}>
        <IconMenu />
      </button>
      {miga && <span className="cabecera-miga">{miga} /</span>}
      <h1>{titulo}</h1>
      <div className="cabecera-derecha">
        {esperan > 0 && (
          <span className="chip chip-aviso" title={t('Permisos, incidencias, planes e hipótesis que esperan tu decisión')}>
            {esperan} {t(esperan === 1 ? 'espera' : 'esperan')}
          </span>
        )}
        <button type="button" className="btn btn-fantasma btn-icono" aria-label={t('Buscar (Cmd+K)')} onClick={onBuscar}>
          <IconSearch size={15} />
        </button>
        <div className="segmentos segmentos-modo" role="group" aria-label={t('Modo de la interfaz')} title={t('Sencillo: lo que decides tú, con la ingeniería plegada. Detalle: todo abierto.')}>
          <button type="button" aria-pressed={modo === 'sencillo'} onClick={() => fijarModo('sencillo')}>
            {t('Sencillo')}
          </button>
          <button type="button" aria-pressed={modo === 'detalle'} onClick={() => fijarModo('detalle')}>
            {t('Detalle')}
          </button>
        </div>
        {/* Donde estaba el «?». El recorrido no se pierde: se movió al
            menú lateral, que es donde se busca algo que se ve una vez. */}
        <SelectorIdioma />
      </div>
    </header>
  );
}
