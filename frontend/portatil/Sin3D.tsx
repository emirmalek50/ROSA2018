import { tr } from '../src/lib/idioma';

export function Atlas3D() { return <div className="portatil-sin-3d"><strong>{tr('Atlas cerebral')}</strong><p>{tr('Visualización 3D omitida en esta copia. Puedes explorar los filtros, las regiones y sus fichas.')}</p></div>; }
export const Cerebro3D = Atlas3D;
export function hayModeloCerebro() { return false; }
