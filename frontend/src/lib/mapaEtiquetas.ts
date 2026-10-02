import type { EjeMapa, MapaEnfermedad as Mapa } from '../datos/tipos';
import { tr, traducido } from './idioma';

/** Etiquetas de reserva, copiadas de rosa/mapa_enfermedad.py ETIQUETAS. Las
 *  que llegan con el mapa (mapa.etiquetas) mandan; estas cubren un mapa
 *  servido a demanda, que no las trae. */
export const ETIQUETAS_MAPA: Record<EjeMapa, Record<string, string>> = traducido({
  estadio: {
    preclinica: 'preclínica',
    prodromica_dcl: 'prodrómica o DCL',
    demencia_leve: 'demencia leve',
    demencia_moderada_grave: 'demencia moderada o grave',
    autosomico_dominante: 'autosómica dominante',
  },
  region: {
    hipocampo: 'hipocampo',
    corteza_entorrinal: 'corteza entorrinal',
    corteza_prefrontal: 'corteza frontal y prefrontal',
    corteza_temporal: 'corteza temporal',
    corteza_parietal: 'corteza parietal',
    cingulo_precuneo: 'cíngulo y precúneo',
    corteza_occipital: 'corteza occipital',
    amigdala: 'amígdala',
    ganglios_basales_talamo: 'ganglios basales y tálamo',
    tronco_locus_coeruleus: 'tronco encefálico y locus coeruleus',
    cerebelo: 'cerebelo',
    sustancia_blanca: 'sustancia blanca',
    vascular_bhe: 'vasculatura cerebral y barrera hematoencefálica',
    bulbo_olfatorio: 'bulbo y vía olfatoria',
    retina: 'retina',
    intestino_microbiota: 'intestino y microbiota',
    plasma: 'sangre, plasma y suero (compartimento periférico)',
    lcr: 'líquido cefalorraquídeo (LCR)',
    neocorteza: 'corteza cerebral (sin región concreta)',
    cerebro_sin_region: 'cerebro (sin región concreta)',
  },
  tipoCelular: {
    astrocito: 'astrocito',
    microglia: 'microglía',
    neurona: 'neurona',
    oligodendrocito: 'oligodendrocito',
    opc: 'OPC (célula precursora de oligodendrocitos)',
    endotelio: 'endotelio',
    pericito: 'pericito',
    inmune_periferico: 'célula inmune periférica (linfocito, monocito, macrófago)',
  },
  nivel: { molecular: 'molecular', celular: 'celular', tisular: 'tisular', clinico: 'clínico' },
});

/** Definiciones de reserva (rosa/mapa_enfermedad.py DEFINICIONES_ESTADIO y DEFINICIONES_NIVEL). */
export const DEFINICIONES_MAPA: { estadio: Record<string, string>; nivel: Record<string, string> } = traducido({
  estadio: {
    preclinica: 'biomarcadores alterados sin síntomas cognitivos',
    prodromica_dcl: 'deterioro cognitivo leve, síntomas sin demencia',
    demencia_leve: 'demencia establecida en su fase inicial',
    demencia_moderada_grave: 'demencia moderada o grave',
    autosomico_dominante: 'forma hereditaria por mutación en PSEN1, PSEN2 o APP; cohortes como DIAN',
  },
  nivel: {
    molecular: 'genes, proteínas, biomarcadores y metabolitos',
    celular: 'tipos celulares, cultivos y célula única',
    tisular: 'regiones, atrofia, imagen y neuropatología',
    clinico: 'pacientes, cognición, escalas, diagnóstico y ensayos',
  },
});

/** La etiqueta visible de un valor de un eje. Con null, "sin situar".
 *
 *  Manda la que trae el mapa, despues la de reserva, despues la clave.
 *
 *  La del mapa va por `tr()`: viene del servidor en castellano y es la MISMA
 *  frase que la de reserva (esta tabla esta copiada de
 *  `rosa/mapa_enfermedad.py`), asi que esta en el catalogo. Sin eso los
 *  filtros del atlas se quedaban en castellano con la interfaz en ingles
 *  («preclinica», «astrocito», «celula inmune periferica»), porque la de
 *  reserva, que si pasa por `traducido()`, nunca llegaba a usarse (2 de
 *  octubre de 2026). */
export function etiquetaEje(mapa: Mapa | null | undefined, eje: EjeMapa, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return tr('sin situar');
  const propias = mapa?.etiquetas && typeof mapa.etiquetas === 'object' ? mapa.etiquetas[eje] : undefined;
  const delServidor = propias && typeof propias === 'object' && typeof propias[valor] === 'string' ? propias[valor] : undefined;
  return (delServidor && tr(delServidor)) || ETIQUETAS_MAPA[eje][valor] || valor;
}
