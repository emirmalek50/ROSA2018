// El selector de idioma de la cabecera.
//
// Ocupa el sitio donde estaba el «?» (el recorrido de ROSA2018), que no se
// pierde: se movió al menú lateral. La cabecera tiene sitio para una cosa más
// y el idioma se usa más que el recorrido, que se ve una vez.
//
// Se dibuja como los otros segmentos de la cabecera (Sencillo / Detalle) en
// vez de como un desplegable: con dos idiomas, un menú que hay que abrir para
// ver dos opciones es un clic de más.

import { IDIOMAS, fijarIdioma, tr, useIdioma } from '../lib/idioma';

export function SelectorIdioma() {
  const idioma = useIdioma();
  return (
    <div className="segmentos segmentos-idioma" role="group" aria-label={tr('Idioma de la interfaz')} title={tr('La interfaz está traducida a mano. Lo que escribió ROSA2018 (hipótesis, hechos, respuestas) lo traduce un modelo al verlo y puede tener errores: el original es el castellano. Lo que no se pudo traducir se ve en castellano.')}>
      {IDIOMAS.map((i) => (
        <button
          key={i.clave}
          type="button"
          aria-pressed={idioma === i.clave}
          // El nombre de cada idioma va en SU idioma, como en cualquier
          // selector: «Español» no se traduce a «Spanish».
          data-sin-traducir=""
          aria-label={i.nombre}
          onClick={() => fijarIdioma(i.clave)}
        >
          {i.bandera}
        </button>
      ))}
    </div>
  );
}
