// Lo que devuelve /api/laboratorio: TODAS las dianas que ROSA2018 ha verificado,
// de todas sus investigaciones a la vez, con su estructura y con el peso de la
// evidencia que las nombra; y los compuestos que esa evidencia nombra. No cuelga
// de una investigación ni de una hipótesis. Quien decide qué entra es
// rosa/laboratorio.py, por regla y sin modelo; estos tipos copian su forma.

/** Una medida del experimento: qué se mide y qué decide. */
export interface Lectura {
  nombre: string;
  tipo: string | null;
  queConfirma: string;
  queRefuta: string;
}

/** Una hipótesis con el CONTRATO ENTERO de su experimento, tal como quedó
 *  prerregistrado. Es lo que se manda al laboratorio: el protocolo paso a
 *  paso, qué se mide, con qué controles y qué lo refutaría. */
/** Lo que de una hipótesis viaja SIEMPRE: basta para el muro y para la hoja
 *  de la lámina. El contrato largo (protocolo, lecturas, coste) se pide
 *  aparte, con `acciones.experimentosDe`, porque era el 25 % de la respuesta
 *  y el muro no enseña ni uno. */
export interface HipotesisDeDiana {
  id: string;
  investigacionId: string | null;
  titulo: string;
  estado: string;
  decisionKiller: string | null;
  certeza: string | null;
  intervencion: string;
  /** Qué pide hacer con la diana: `disminuye`, `aumenta`, `modula` o
   *  `sin_intervencion`. Un ASO solo sabe bajar. */
  direccion: string | null;
  /** A qué momento de la enfermedad apunta. Para un oligonucleótido importa:
   *  corta la producción, y la proteína ya fabricada se queda. */
  etapa: string;
  prediccionFalsable: string;
  sistema: string | null;
  refuta: string;
  controles: string;
  nivelDesenlace: string | null;
  estadoExperimento: string | null;
  prerregistradoEn: number | null;
}

/** La misma hipótesis con el contrato entero, tal como lo devuelve
 *  `/api/laboratorio/{uniprot}/experimentos`. */
export interface ExperimentoDeDiana extends HipotesisDeDiana {
  protocolo: string;
  ensayo: string;
  quePrueba: string;
  lecturas: Lectura[];
  confirma: string;
  tamanoMuestral: string;
  alternativa: string;
  decisionQueCambia: string;
  costeEstimado: string;
  puenteAlBeneficio: string;
}

/** Un compuesto que la evidencia nombra JUNTO a esta diana. `juntas` es en
 *  cuántas afirmaciones aparecen los dos: coaparición, no afinidad. */
export interface QuimicaDeDiana {
  nombre: string;
  juntas: number;
  ontologiaId: string | null;
  enPubchem?: boolean;
  cid?: number | null;
  formula?: string | null;
  peso?: string | null;
  smiles?: string | null;
  inchikey?: string | null;
  cerebro?: { veredicto: string; motivo: string };
  url2d?: string | null;
  motivo?: string;
}

/** El pedido tal como saldría para el laboratorio. `faltan` dice qué campos
 *  del contrato de la hipótesis están vacíos: se enseña, no se rellena. */
export interface HojaDePedido {
  hipotesis: string | null;
  certeza: string | null;
  queSeHace: string;
  identificador: string;
  sistema: string | null;
  controles: string;
  refuta: string;
  /** Los demás experimentos propuestos sobre la misma diana. No se funden con
   *  el primero: dos protocolos distintos fundidos serían uno que nadie
   *  prerregistró. */
  otrosExperimentos: {
    hipotesis: string | null;
    certeza: string | null;
    decisionKiller: string | null;
    queSeHace: string;
    sistema: string | null;
    controles: string;
    refuta: string;
  }[];
  /** La evidencia la señala y ninguna hipótesis propone nada todavía. */
  sinExperimento: boolean;
  /** El experimento se hace en un laboratorio de verdad, no leyendo lo que ya
   *  está publicado. Es la diferencia entre poder mandarlo y no. */
  deBanco: boolean;
  /** La tarjeta propone una intervención de banco y el contrato dice que lo
   *  que se hace es revisar literatura. Se avisa, no se disimula. */
  contradiceLaIntervencion: boolean;
  faltan: string[];
}

/** Un enunciado sostenido sobre la diana, con de dónde sale. */
export interface LoQueSeSabe {
  tema: string;
  enunciado: string;
  referencia: string;
  fragmento: string;
  investigacion: string;
}

export interface FlechaCausal {
  otro: string;
  tipo: string;
  contexto: string;
}

export interface DianaDeLaboratorio {
  uniprot: string;
  simbolo: string;
  nombre: string;
  hgnc: string | null;
  /** El nombre clínico, cuando lo tiene: MAPT se llama «tau». */
  tambienLlamada: string;
  /** Cuánta evidencia la nombra, sumando todas las investigaciones. */
  hechos: number;
  sabidos: number;
  abiertos: number;
  fuentes: number;
  loQueSeSabe: LoQueSeSabe[];
  causal: { aguasArriba: FlechaCausal[]; aguasAbajo: FlechaCausal[] };
  investigaciones: { id: string; titulo: string; hechos: number }[];
  /** De dónde sale: de la evidencia, de una hipótesis que la propone, o de las dos. */
  deDonde: 'evidencia' | 'hipotesis' | 'ambas';
  /** Si alguno de sus experimentos es de banco. */
  deBanco: boolean;
  /** Qué dirección piden las hipótesis que la nombran, y si un oligonucleótido
   *  antisentido encaja: un ASO solo sabe BAJAR la proteína. */
  direccion: { pide: 'bajar' | 'subir' | 'modular' | 'mezclado' | 'ninguna'; cuenta: Record<string, number>; asoEncaja: boolean; motivo: string };
  /** El oligonucleótido antisentido que ROSA2018 diseñaría sobre esta diana.
   *  `null` cuando todavía no hay secuencia: eso es «no pude comprobar», no
   *  «no se puede diseñar», y `asoSinComprobar` distingue los dos. */
  aso: DisenoAso | null;
  asoSinComprobar: boolean;
  /** La química que su propia evidencia le asocia, con la ficha de PubChem
   *  cuando la hay. Va dentro de la diana para que la lámina pueda enseñar la
   *  fórmula sin salir de la proteína. */
  quimica: QuimicaDeDiana[];
  /** La que se dibuja es siempre la predicha de AlphaFold, que es la única de
   *  longitud completa. `medidas` dice cuántas estructuras REALES tiene el PDB
   *  de esta proteína (null = todavía no se ha podido comprobar), porque para
   *  tau el modelo predicho tiene un 8 % de confianza alta y el PDB guarda
   *  cientos, incluidos los filamentos de cerebros con Alzheimer. */
  estructura: {
    url: string;
    fuente: string;
    licencia: string;
    clase: string;
    medidas: number | null;
    entradasPDB: string[];
    urlPDB: string;
  };
  hipotesis: HipotesisDeDiana[];
  enHipotesis: number;
  intervenciones: string[];
  hojaDePedido: HojaDePedido;
}

export interface CompuestoDeLaboratorio {
  nombre: string;
  /** Cuántas afirmaciones lo nombran, en todas las investigaciones. */
  menciones: number;
  sostenidos: number;
  ontologiaId: string | null;
  ontologia: string | null;
  /** Si PubChem lo tiene como compuesto. Un anticuerpo no lo está, y eso no lo
   *  quita de la lista: lo nombra la evidencia igual. */
  enPubchem: boolean;
  motivo?: string;
  cid: number | null;
  formula: string | null;
  peso: string | null;
  iupac: string | null;
  smiles: string | null;
  inchikey: string | null;
  logp: number | null;
  tpsa: number | null;
  /** Cribado de difusión pasiva por la barrera hematoencefálica, por regla. */
  cerebro: { veredicto: string; motivo: string };
  url2d: string | null;
  url3d: string | null;
}

/** Un término de la decisión: qué se miró, cuánto valía y cuánto suma. */
export interface TerminoDecision {
  criterio: string;
  valor: string;
  puntos: number;
}

/** De todo lo que ROSA2018 ha verificado, cuál apagaría y con qué oligo.
 *  No es una molécula que valga para todas —eso no existe, un ASO empareja
 *  bases con UNA secuencia— sino la decisión, argumentada. */
export interface OligoQueMandaria {
  simbolo: string;
  uniprot: string;
  nombre: string;
  tambienLlamada: string;
  candidato: CandidatoAso;
  diseño: Omit<DisenoAso, 'candidatos'>;
  puntos: number;
  porQue: TerminoDecision[];
  frenteA: { simbolo: string; uniprot: string; puntos: number; porQueNo: string }[];
  fueraDeConcurso: Record<string, string[]>;
  queLaCambiaria: string;
  /** En qué especies se puede probar el elegido. */
  especies?: EnLasEspecies | null;
  /** La SEGUNDA respuesta: el mejor de los que se pueden probar en animales.
   *  Va aparte y no metido en la puntuación a propósito: poder probar en un
   *  animal es una restricción práctica, no una propiedad del oligo. */
  paraAnimales?: {
    hay: boolean;
    completo?: boolean;
    completos: number;
    parciales: number;
    deCuantos: number;
    esElMismo?: boolean;
    candidato?: CandidatoAso;
    sirveEn?: string[];
    porQue: string;
  } | null;
  /** El cribado del candidato elegido, arriba del todo: es lo que decide si
   *  esto se puede pedir hoy o no. */
  criba: CribaCandidato;
}

export interface Laboratorio {
  oligoQueMandaria: OligoQueMandaria | null;
  dianas: DianaDeLaboratorio[];
  compuestos: CompuestoDeLaboratorio[];
  /** Nombradas por la evidencia, resueltas en HGNC y sin acceso de UniProt: no
   *  hay estructura que traer y se dice, en vez de callarlas. */
  nombradasSinEstructura: { simbolo: string; hechos: number; sabidos: number; motivo: string }[];
  /** Descartadas porque el nombre que las trajo era un alias y no el símbolo
   *  aprobado (ADAS la escala entra como AGPS, ARIA como ECSCR). */
  descartadasPorAlias: { simbolo: string; hechos: number; sabidos: number; motivo: string }[];
  sinResolver: { nombre: string; motivo: string }[];
  resumen: {
    dianas: number;
    compuestos: number;
    hipotesisVivas: number;
    hipotesisConDiana: number;
    sinDiana: number;
    afirmaciones: number;
    sostenidas: number;
    hechosDeLaInvestigacion: number;
    sinExperimento: number;
    /** Cuántas se podrían mandar hoy a un laboratorio de verdad. */
    deBanco: number;
    /** Para cuántas hay ya un oligonucleótido antisentido diseñado Y con
     *  sentido: la evidencia pide bajarlas. */
    conAso: number;
    /** En cuántas un oligonucleótido iría al revés de lo que se concluyó. */
    asoAlReves: number;
    investigaciones: number;
  };
}

/* --------------------------------------------------------------------------
   El oligonucleótido antisentido
   --------------------------------------------------------------------------
   Es lo único que ROSA2018 puede DISEÑAR de verdad: se calcula desde la
   secuencia del transcrito, que es pública y exacta, y no hace falta predecir
   ninguna forma. Lo arma rosa/aso.py por regla; estos tipos copian su forma.
   El cDNA no viaja al navegador, solo el diseño. */

/** Por qué un candidato no pasó un filtro, con el filtro nombrado. */
export interface FalloDeFiltro {
  filtro: string;
  motivo: string;
  porQue: string;
}

/** El resultado de comparar un candidato contra los 669.547 transcritos
 *  humanos de Ensembl (rosa/criba.py). Es coincidencia EXACTA y sobre ARN
 *  maduro: «sin choque exacto» quiere decir que no hay otro ARN con este tramo
 *  idéntico, que es bastante menos que «es seguro». */
/** Si el mismo oligo sirve en una especie donde hay que probarlo
 *  (rosa/especie.py). */
export interface EnUnaEspecie {
  comprobado: boolean;
  version: number;
  clave: "raton" | "rata" | "macaco";
  nombre: string;
  latin: string;
  /** Lo que piden los reguladores es UN roedor y UN no roedor, no tres
   *  especies: el papel importa tanto como la especie. */
  papel: "roedor" | "no roedor";
  /** Cómo se administra ahí, que para un oligo del sistema nervioso central
   *  no es un detalle: solo en el macaco la vía es la de la clínica. */
  via: string;
  simboloHumano: string;
  /** El gen equivalente. Se busca POR EL NOMBRE, que es heurístico. */
  ortologo: string;
  veredicto: "sirve tal cual" | "probablemente sirve, con menos fuerza" | "no sirve" | "no pude comprobar";
  /** `null` cuando no se pudo comprobar: no es lo mismo que «no sirve». */
  sirve: boolean | null;
  porQue: string;
  fallos?: number | null;
  dondeFallan?: number[];
  falloEnElHueco?: boolean;
  transcrito?: string;
  transcritosQueEncajan?: number;
}

/** El veredicto de conjunto sobre dónde se puede probar el oligo.
 *
 *  No es «sirve en las tres»: lo que piden ICH M3(R2) y el borrador de la FDA
 *  de 2024 es toxicología en DOS especies, un roedor y un no roedor. Ratón y
 *  rata son los dos roedores, así que hace falta uno de los dos. */
export interface EnLasEspecies {
  veredicto: "paquete completo" | "falta el no roedor" | "falta el roedor" | "hacen falta sustitutos";
  porQue: string;
  sirvenEn: string[];
  noSirvenEn: string[];
  tieneRoedor: boolean;
  tieneNoRoedor: boolean;
  cuantas: number;
  deCuantas: number;
  marco: { queSePide: string; elNoRoedor: string; yEnElCerebro: string; siNoSirve: string };
  avisos: { que: string; porQue: string }[];
  porEspecie: Record<string, EnUnaEspecie>;
}

/** De qué se puede uno fiar en todo esto, por niveles (rosa/fiabilidad.py).
 *  Lo pidió Emir después de preguntar qué tan real era la simulación. */
export interface Fiabilidad {
  version: number;
  niveles: {
    nivel: "exacto" | "modelo" | "estadistica" | "mio";
    titulo: string;
    resumen: string;
    cosas: { que: string; porQue: string }[];
  }[];
  noComprobado: { que: string; porQue: string }[];
  queEsEsto: { es: string; noEs: string; comoSeUsa: string; yLaPremisa: string };
}

export interface CribaCandidato {
  cribado: boolean;
  veredicto: "sin choque exacto" | "descartado" | "revisar" | "sin cribar" | "sin parecido" | "al borde del azar";
  /** En cuántos transcritos de su propio gen encaja. */
  propios: number;
  /** Los genes ajenos donde encaja idéntico, cortados en cuarenta. */
  fuera: string[];
  /** El total exacto, que puede ser mayor que `fuera.length`. Un Alu cae en
   *  más de mil doscientos genes y decir «cuarenta» sería mentir por omisión. */
  genesFuera: number;
  transcritosFuera: number;
  /** Genes anotados en el MISMO sitio del cromosoma con otro nombre. No son un
   *  fuera de diana: son el mismo tramo con otra etiqueta (PSEN2 comparte su
   *  locus con un gen que Ensembl todavía no ha nombrado). */
  mismoSitioOtroNombre: string[];
  genesMismoSitio: number;
  transcritosMismoSitio: number;
  porQue: string;
  /** Solo cuando se cribó con BLAST, que además de los choques exactos
   *  encuentra los encajes con fallos. */
  cribadoConDesajustes?: boolean;
  /** El hueco de ADN del gapmer (posiciones 6 a 15), que es lo que lee la
   *  RNasa H1. Un fallo DENTRO del hueco impide el corte; uno en las alas,
   *  no, y por eso la regla mira dónde cae el fallo y no cuántos hay. */
  huecoDesde?: number;
  huecoHasta?: number;
  /** Genes ajenos donde el hueco encaja perfecto, por fallos en las alas. */
  porFallos?: Record<string, string[]>;
  cuantosPorFallos?: Record<string, number>;
  /** Genes parecidos donde el fallo cae DENTRO del hueco: ahí no corta. */
  conFalloEnElHueco?: number;
  peorFallos?: number | null;
  /** El azar MEDIDO: qué fracción de `nuloN` secuencias al azar tienen un
   *  encaje de ese nivel. Viaja a la pantalla para que nadie tenga que
   *  fiarse de la regla. */
  nulo?: Record<string, number>;
  nuloN?: number;
}

/** Si el ARN está abierto en ese sitio o plegado sobre sí mismo (rosa/plegado.py).
 *  Un oligo no entra en un tramo que está emparejado dentro de una horquilla,
 *  por buenas que sean sus veinte letras. Se calcula con RNAplfold de
 *  ViennaRNA: el modelo de Turner sobre una ventana deslizante. */
export interface SitioDelCandidato {
  /** Probabilidad de que las veinte letras estén libres A LA VEZ. */
  accesibilidad: number;
  etiqueta: "abierto" | "medio" | "tapado";
  comoSeLee: string;
  /** En qué percentil cae dentro de SU transcrito. Importa más que el número
   *  absoluto: 0,05 es malo en un ARN suelto y bueno en uno muy plegado. */
  percentil: number;
  mejorDelTranscrito: number;
  posicionMejor: number;
  medianaDelTranscrito: number;
  ventana: number;
  alcance: number;
  version: number;
}

/** La geometría para dibujar la dúplex del oligo con su ARN (rosa/duplex.py).
 *
 *  Es un ESQUEMA con los parámetros publicados de una hélice híbrida de ARN
 *  con ADN (giro 32,7 grados y subida 2,62 Å por par), no una estructura
 *  resuelta: no hay coordenadas atómicas porque los parámetros dan la forma de
 *  la hélice, no dónde está cada átomo de cada base, y dibujar esos átomos
 *  sería inventarlos. */
export interface Duplex {
  version: number;
  aso: string;
  diana: string;
  /** Una columna por par, con el ARN leído de 5' a 3' de izquierda a derecha,
   *  que es como se escribe. El oligo, debajo, va entonces de 3' a 5': una
   *  dúplex es ANTIPARALELA. */
  pares: {
    /** La columna, de 1 a 20, en el sentido del ARN. */
    i: number;
    arn: string;
    aso: string;
    /** En qué posición del OLIGO cae esta columna (de 1 a 20, de 5' a 3'). */
    posAso: number;
    quimica: "ala" | "hueco";
    /** Avance a lo largo del eje de la hélice, en ángstroms. */
    z: number;
    giro: number;
  }[];
  /** En COLUMNAS del dibujo, no en posiciones del oligo. Con la arquitectura
   *  5-10-5 salen los mismos números porque es simétrica, pero el backend lo
   *  calcula en vez de darlo por hecho. */
  alas: [number, number][];
  hueco: [number, number];
  huecoEnElOligo: [number, number];
  /** Dónde corta la RNasa H1. No es un punto exacto: corta dentro del tramo
   *  que reconoce, y eso es el hueco. */
  dondeCorta: [number, number];
  queEs: { ala: string; hueco: string; arn: string };
  avisos: { que: string; porQue: string }[];
  largoAngstroms: number;
  vueltas: number;
  giroPorPar: number;
  subidaPorPar: number;
  surcoMenor: number;
  porQueHibrida: string;
  porQueSoloElHueco: string;
}

export interface CandidatoAso {
  /** La secuencia del oligo, de 5' a 3'. */
  secuencia: string;
  /** Partido en ala de 2'-MOE, hueco de ADN y ala: así se escribe un pedido. */
  partes: { ala5: string; hueco: string; ala3: string };
  posicion: number;
  hasta: number;
  /** El tramo del transcrito al que va, que es su complemento inverso. */
  diana: string;
  region: string;
  gc: number;
  cpg: number;
  g4: boolean;
  autocomplementariedad: number;
  rachaMasLarga: number;
  motivosBuenos: number;
  motivosMalos: number;
  puntuacionMotivos: number;
  pasa: boolean;
  /** Alineado contra el transcriptoma. Sin esto NO se puede pedir. */
  cribado: boolean;
  avisoCribado: string;
  criba: CribaCandidato;
  /** Si el ARN está abierto en ese sitio. `null` es «no se pudo calcular»
   *  (sin ViennaRNA), no «está tapado». */
  sitio?: SitioDelCandidato | null;
  /** Solo llega al pedir el panel completo (`oligosDe`), no en el muro: son
   *  unos seiscientos bytes por candidato y el muro sirve diecisiete dianas. */
  duplex?: Duplex;
  /** En qué especies se puede probar el mismo oligo. */
  especies?: EnLasEspecies | null;
}

export interface DisenoAso {
  transcrito: string;
  esCanonico: boolean;
  /** El transcrito que el NCBI y el EMBL-EBI acuerdan como representativo del
   *  gen, emparejado con la proteína canónica de UniProt. Es lo que garantiza
   *  que la estructura que se dibuja y este ARN son la misma versión. */
  maneSelect: string | null;
  /** `null` es «no se pudo confirmar», no «no lo son». MAPT no tiene MANE
   *  Select porque no hay acuerdo sobre cuál es la versión representativa de
   *  tau, que es justo la pregunta abierta de las isoformas 4R y 3R. */
  mismaIsoformaQueLaProteina: boolean | null;
  inicioCds: number | null;
  finCds: number | null;
  /** Cuántos transcritos tiene el gen. Cuál se baja no es lo mismo que cuánta
   *  se baja, y esa decisión es de una persona. */
  transcritosDelGen: number;
  largo: number;
  build: string;
  quimica: { arquitectura: string; alas: string; hueco: string; enlaces: string; citosinas: string; porQue: string };
  /** Cómo se administra. Para una diana del sistema nervioso central no es un
   *  detalle: los ASO no cruzan la barrera hematoencefálica, así que se
   *  inyectan en el líquido cefalorraquídeo. */
  via: { via: string; porQue: string; precedente: string; limite: string };
  /** Qué hace y qué NO hace. Es lo primero que se malentiende. */
  queHace: { hace: string; noHace: string; matiz: string; evidencia: string; aviso: string };
  candidatos: CandidatoAso[];
  /** Cuántos se diseñaron en total. El muro trae los ocho primeros; los
   *  sesenta se piden con `acciones.oligosDe`. */
  candidatosEnTotal?: number;
  separacionUsada?: number;
  ventanas: number;
  pasanFiltros: number;
  cribados: number;
  /** De qué fiarse y de qué no. Viaja con el diseño a propósito. */
  fiabilidad?: Fiabilidad;
  /** Si el diseño se hizo teniendo en cuenta la accesibilidad del sitio. */
  conAccesibilidad?: boolean;
  plegado?: {
    hecho: boolean;
    version: number;
    ventana: number;
    alcance: number;
    motivo: string;
    avisos: { que: string; porQue: string }[];
    mejorDelTranscrito?: number;
    posicionMejor?: number;
    medianaDelTranscrito?: number;
    abiertos?: number;
    /** El plegado alrededor del mejor candidato, en notación de paréntesis,
     *  con los pares ya resueltos para poder dibujar los arcos. */
    dibujo?: {
      desde: number;
      hasta: number;
      secuencia: string;
      /** Notación de paréntesis: `.` libre, `(` y `)` emparejada. */
      estructura: string;
      energia: number;
      pares: [number, number][];
      /** Una entrada por nucleótido, con su sitio en el dibujo. Las
       *  coordenadas salen de `naview_xy_coordinates` de ViennaRNA, que es la
       *  disposición clásica del campo (tallos como escaleras, bucles como
       *  círculos, sin que las ramas se pisen), normalizadas a 0..1. */
      letras: {
        /** Posición dentro del trozo dibujado, en base uno. */
        i: number;
        /** Posición en el transcrito entero. */
        pos: number;
        letra: string;
        x: number;
        y: number;
        emparejada: boolean;
        /** Si cae en el tramo al que va el oligo. */
        enElSitio: boolean;
      }[];
      /** Ancho partido por alto, para que el dibujo no salga estirado. */
      proporcion: number;
      disposicion: string;
    } | null;
    dibujoDe?: string;
    dibujoSitio?: [number, number];
  };
  /** Cuántos quedaron fuera por encajar idéntico en otro gen. */
  descartadosPorCriba?: number;
  /** Cuántos cubren el paquete regulatorio entero (un roedor y el no roedor). */
  conPaqueteCompleto?: number;
  limpios?: number;
  criba?: {
    hecho: boolean;
    fecha: number | null;
    transcritos: number;
    ficheros: string[];
    segundos: number | null;
    motivo: string;
    /** Lo que este cribado NO cubre. Viaja con el resultado a propósito. */
    limites: { que: string; porQue: string }[];
  };
}
