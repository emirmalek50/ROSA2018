// @vitest-environment jsdom
// Lo que va al laboratorio: que el muro sea la UNIÓN de todas las
// investigaciones y no la vista de una hipótesis, que el peso de la evidencia
// se vea, que la decisión del Killer se vea (una hipótesis suspendida no puede
// presentarse como algo que ya se podría pedir), que un compuesto que PubChem
// no tiene entre en la lista igual si la evidencia lo nombra, que la fórmula
// nunca haga de identificador, y que sin servidor lo diga en vez de enseñar
// estructuras de muestra.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Laboratorio as Datos } from '../lib/laboratorio';
import { Laboratorio, _olvidarMiniaturas } from './Laboratorio';
import { fijarIdioma } from '../lib/idioma';

const respuestas = vi.hoisted(() => ({
  datos: null as Datos | null | 'sin_respuesta',
  experimentos: null as unknown,
  oligos: null as unknown,
}));
vi.mock('../datos/almacen', async (original) => ({
  ...(await original<typeof import('../datos/almacen')>()),
  acciones: {
    laboratorio: vi.fn(async () => respuestas.datos),
    // El contrato entero se pide aparte al abrir el experimento.
    experimentosDe: vi.fn(async () => respuestas.experimentos),
    oligosDe: vi.fn(async () => respuestas.oligos),
  },
}));

// Mol* no arranca en jsdom (no hay WebGL) y pesa 5 MB. El visor está detrás de
// una interfaz fina justo para poder cambiarlo por esto: lo que se prueba aquí
// es la pantalla, no el motor de dibujo.
const visor = vi.hoisted(() => ({
  cargados: [] as string[],
  revienta: false,
  enfocado: null as [number, number] | null,
  // Quien esté bajo el ratón, que es lo que la pantalla abre al pulsar.
  señalado: null as { numero: number; aa: string; plddt: number; centro: [number, number, number] } | null,
  aviso: null as ((r: unknown) => void) | null,
  // El fotograma, para poder pedirlo desde la prueba: la pantalla recalcula el
  // nivel del zoom y coloca las etiquetas cuando el visor dibuja.
  dibujar: null as (() => void) | null,
  nivel: 0,
}));
vi.mock('../lib/visorMolecular', () => ({
  crearVisor: vi.fn(async () => ({
    cargar: vi.fn(async (url: string) => {
      if (visor.revienta) throw new Error('la red no llega a AlphaFold');
      visor.cargados.push(url);
      return { atomos: 7063, residuos: 870, plddtMedio: 71.2, fiable: 0.68 };
    }),
    estilo: vi.fn(async () => undefined),
    encuadrar: vi.fn(),
    // El muro: un visor compartido vacia, carga y captura cada miniatura.
    vaciar: vi.fn(async () => undefined),
    capturar: vi.fn(async () => 'data:image/png;base64,AAAA'),
    distancia: () => 100 * (visor.nivel === 2 ? 0.3 : visor.nivel === 1 ? 0.8 : 1),
    irA: vi.fn(),
    proyectar: () => ({ x: 10, y: 10 }),
    // Sin proteína sobre ningún texto: el despeje por choque no se dispara y
    // las pruebas miden lo que enseña la pantalla, no el encuadre.
    pisa: (rects: unknown[]) => rects.map(() => 0),
    centroDe: () => [0, 0, 0],
    residuo: () => undefined,
    residuosDe: (desde: number, hasta: number) =>
      // Un tramo corto de secuencia real, para comprobar que sale en la ficha.
      ['MET', 'GLY', 'ALA', 'PRO', 'CYS'].slice(0, hasta - desde + 1).map((aa, i) => ({ numero: desde + i, aa, plddt: 82, centro: [0, 0, 0] as [number, number, number] })),
    enfocar: (desde: number, hasta: number) => {
      visor.enfocado = [desde, hasta];
      return true;
    },
    orbitar: vi.fn(),
    // La pantalla coloca las etiquetas en el fotograma dibujado; sin un
    // fotograma no hay etiquetas que pulsar.
    alDibujar: (fn: () => void) => {
      visor.dibujar = fn;
      const t = setTimeout(fn, 0);
      return () => {
        visor.dibujar = null;
        clearTimeout(t);
      };
    },
    alSeñalar: (fn: (r: unknown) => void) => {
      visor.aviso = fn;
      return () => {
        visor.aviso = null;
      };
    },
    vecinos: () => 24,
    girar: vi.fn(),
    destruir: vi.fn(),
  })),
}));

/** La diana principal: la nombran dos investigaciones y una hipótesis la
 *  propone. Es el caso que importa, porque es el que la primera versión de la
 *  sección no sabía representar. */
const DIANA: Datos['dianas'][number] = {
  uniprot: 'P10636',
  simbolo: 'MAPT',
  nombre: 'microtubule associated protein tau',
  hgnc: 'HGNC:6893',
  tambienLlamada: 'tau',
  hechos: 405,
  sabidos: 322,
  abiertos: 83,
  fuentes: 94,
  loQueSeSabe: [
    {
      tema: 'Orden temporal',
      enunciado: 'El p-tau181 en plasma se separa de los controles antes que el NfL.',
      referencia: 'Xie et al., 2026',
      fragmento: 'plasma p-tau181 diverged from stable controls earliest',
      investigacion: 'GFAP y NfL en portadores de APOE4',
    },
  ],
  causal: {
    aguasArriba: [{ otro: 'amiloide', tipo: 'base_curada', contexto: 'La patología amiloide precede a la propagación de tau' }],
    aguasAbajo: [{ otro: 'neurodegeneracion', tipo: 'base_curada', contexto: 'La tau patológica se asocia a la pérdida neuronal' }],
  },
  investigaciones: [
    { id: 'inv-1', titulo: 'Reducir amiloide y tau', hechos: 216 },
    { id: 'inv-2', titulo: 'Qué distingue a un biomarcador', hechos: 162 },
  ],
  deDonde: 'ambas',
  quimica: [
    // Un compuesto que PubChem sí tiene, con su fórmula, dentro de la diana.
    { nombre: 'donepezilo', juntas: 12, ontologiaId: 'CHEBI:53289', enPubchem: true, cid: 3152, formula: 'C24H29NO3', peso: '379.5', smiles: 'COC1=CC=C2C(=O)C(CC3CCN(CC3)CC4=CC=CC=C4)CC2=C1', inchikey: 'ADEBPBSSDYVVLD-UHFFFAOYSA-N', cerebro: { veredicto: 'compatible', motivo: 'peso 380, logP 4,2 y superficie polar 38,8 Å² están en la banda' }, url2d: null },
  ],
  deBanco: true,
  direccion: { pide: 'bajar', cuenta: { disminuye: 1 }, asoEncaja: true, motivo: '1 hipótesis pide bajarla' },
  // El oligonucleótido que ROSA2018 diseñaría: lo único que diseña de verdad.
  aso: {
    transcrito: 'ENST00000262410',
    esCanonico: true,
    maneSelect: null,
    // MAPT no tiene MANE Select: no hay acuerdo sobre cuál es la versión
    // representativa de tau, que es justo la pregunta de las isoformas 4R/3R.
    mismaIsoformaQueLaProteina: null,
    inicioCds: 151,
    finCds: 2652,
    transcritosDelGen: 55,
    largo: 6815,
    build: 'GRCh38',
    quimica: {
      arquitectura: 'gapmer 5-10-5',
      alas: "2'-O-metoxietilo (2'-MOE)",
      hueco: 'ADN (2\'-desoxi), es lo que reconoce la RNasa H1',
      enlaces: 'fosforotioato en todos los enlaces',
      citosinas: '5-metilcitosina',
      porQue: 'Es la arquitectura de los tres gapmers aprobados',
    },
    queHace: {
      hace: 'corta la producción: destruye el ARN mensajero',
      noHace: 'no toca la proteína que ya está fabricada; esa se va con el recambio normal de la célula',
      matiz: 'los agregados no son un depósito muerto: crecen reclutando proteína soluble',
      evidencia: 'en la fase 1b del BIIB080 la señal de PET bajó por debajo del punto de partida',
      aviso: 'eran dieciséis personas en la dosis alta',
    },
    via: {
      via: 'intratecal (punción lumbar)',
      porQue: 'los oligonucleótidos antisentido NO cruzan la barrera hematoencefálica',
      precedente: 'es la vía del nusinersén y la del diranersen contra tau',
      limite: 'la distribución por difusión deja menos fármaco en las regiones profundas',
    },
    candidatos: [
      {
        secuencia: 'CTCTCCCACTCCCACTTCTT',
        partes: { ala5: 'CTCTC', hueco: 'CCACTCCCAC', ala3: 'TTCTT' },
        posicion: 3230,
        hasta: 3249,
        diana: 'AAGAAGTGGGAGTGGGAGAG',
        region: 'región 3\' no traducida',
        gc: 0.55,
        cpg: 0,
        g4: false,
        autocomplementariedad: 0,
        rachaMasLarga: 3,
        motivosBuenos: 6,
        motivosMalos: 0,
        puntuacionMotivos: 6,
        pasa: true,
        cribado: false,
        avisoCribado: 'Sin alinear contra el transcriptoma. Un oligo encaja también donde el texto es casi igual, y ahí la RNasa H1 corta igual: sin este cribado el candidato no se puede pedir.',
        criba: {
          cribado: false,
          veredicto: 'sin cribar' as const,
          propios: 0,
          fuera: [],
          genesFuera: 0,
          transcritosFuera: 0,
          mismoSitioOtroNombre: [],
          genesMismoSitio: 0,
          transcritosMismoSitio: 0,
          porQue: 'Todavía sin comparar contra el transcriptoma humano.',
        },
      },
    ],
    ventanas: 6796,
    pasanFiltros: 1964,
    cribados: 0,
  },
  asoSinComprobar: false,
  // Tau: el modelo que se dibuja es predicho, y el PDB tiene cientos medidas.
  estructura: { url: 'https://alphafold.ebi.ac.uk/files/AF-P10636-F1-model_v6.cif', fuente: 'AlphaFold DB', licencia: 'CC BY 4.0', clase: 'predicha', medidas: 308, entradasPDB: ['5O3L'], urlPDB: 'https://www.rcsb.org/search?x' },
  hipotesis: [
    {
      id: 'h1',
      investigacionId: 'inv-1',
      titulo: 'Reducir MAPT limita la amplificación local de tau',
      estado: 'propuesta',
      decisionKiller: 'suspender',
      certeza: 'muy_baja',
      intervencion: 'Supresión de MAPT en neuronas hipocampales',
      direccion: 'disminuye',
      etapa: 'Modelo celular con inclusiones de tau ya establecidas',
      prediccionFalsable: 'se amplifica menos',
      sistema: 'ipsc',
      refuta: 'que la amplificación no cambie',
      controles: 'vector vacío y rescate',
      nivelDesenlace: 'celular',
      estadoExperimento: 'propuesto',
      prerregistradoEn: null,
    },
  ],
  enHipotesis: 1,
  intervenciones: ['Supresión de MAPT en neuronas hipocampales'],
  hojaDePedido: {
    hipotesis: 'Reducir MAPT limita la amplificación local de tau',
    certeza: 'muy_baja',
    queSeHace: 'Supresión de MAPT en neuronas hipocampales',
    identificador: 'UniProt P10636',
    sistema: 'ipsc',
    controles: 'vector vacío y rescate',
    refuta: 'que la amplificación no cambie',
    otrosExperimentos: [],
    sinExperimento: false,
    deBanco: true,
    contradiceLaIntervencion: false,
    faltan: [],
  },
};

/** Una diana que la evidencia señala y ninguna hipótesis propone: el hueco del
 *  programa, que es información y tiene que verse. */
const SIN_EXPERIMENTO: Datos['dianas'][number] = {
  ...DIANA,
  uniprot: 'P14136',
  simbolo: 'GFAP',
  nombre: 'glial fibrillary acidic protein',
  hgnc: 'HGNC:4235',
  tambienLlamada: '',
  hechos: 96,
  sabidos: 75,
  abiertos: 21,
  fuentes: 31,
  loQueSeSabe: [],
  investigaciones: [{ id: 'inv-1', titulo: 'Reducir amiloide y tau', hechos: 96 }],
  deDonde: 'evidencia',
  quimica: [],
  deBanco: false,
  // Aquí un oligo iría al revés de lo que concluyó la investigación.
  direccion: { pide: 'subir', cuenta: { aumenta: 1 }, asoEncaja: false, motivo: '1 hipótesis pide SUBIRLA. Un oligonucleótido antisentido la bajaría' },
  aso: null,
  asoSinComprobar: false,
  estructura: { url: 'https://alphafold.ebi.ac.uk/files/AF-P14136-F1-model_v6.cif', fuente: 'AlphaFold DB', licencia: 'CC BY 4.0', clase: 'predicha', medidas: null, entradasPDB: [], urlPDB: 'https://www.rcsb.org/search?y' },
  hipotesis: [],
  enHipotesis: 0,
  intervenciones: [],
  hojaDePedido: {
    hipotesis: null, certeza: null, queSeHace: '', identificador: 'UniProt P14136', sistema: null,
    controles: '', refuta: '', otrosExperimentos: [], sinExperimento: true, deBanco: false,
    contradiceLaIntervencion: false, faltan: [],
  },
};

/** El contrato largo llega aparte, al abrir el experimento. */
const CONTRATOS = [
  {
    ...DIANA.hipotesis[0]!,
    protocolo: '1. Diferenciar neuronas isogénicas de iPSC.\n2. Suprimir MAPT con dos guías independientes.\n3. Sembrar con lisado de cerebro humano y lavar.\n4. Medir la siembra a los 14 días.',
    ensayo: 'Bioensayo celular de siembra validado, con inmunodetección de tau insoluble.',
    quePrueba: 'Permite separar la amplificación local de la captación inicial.',
    lecturas: [
      { nombre: 'Actividad de siembra intracelular', tipo: 'mecanismo', queConfirma: 'Baja con la supresión y se recupera con el rescate.', queRefuta: 'No cambia con compromiso de diana confirmado.' },
    ],
    confirma: 'Reducción de la siembra con dos guías y rescate.',
    tamanoMuestral: 'Tres diferenciaciones independientes por brazo.',
    alternativa: 'Que baje la captación inicial en vez de la amplificación.',
    decisionQueCambia: 'Si no cambia, se abandona MAPT como diana de amplificación local.',
    costeEstimado: 'Ocho semanas, 12.000 a 18.000 euros.',
    puenteAlBeneficio: 'Haría falta demostrar que la bajada de siembra se traduce en función neuronal.',
  },
];

const DATOS: Datos = {
  oligoQueMandaria: {
    simbolo: 'MAPT',
    uniprot: 'P10636',
    nombre: 'microtubule associated protein tau',
    tambienLlamada: 'tau',
    candidato: DIANA.aso!.candidatos[0]!,
    criba: DIANA.aso!.candidatos[0]!.criba,
    diseño: { ...DIANA.aso!, candidatos: undefined } as never,
    puntos: 12.8,
    porQue: [
      { criterio: 'afirmaciones que la sostienen', valor: '322 de 405', puntos: 5.02 },
      { criterio: 'lo más lejos que llegó en el Killer', valor: 'suspender', puntos: 1.0 },
    ],
    frenteA: [{ simbolo: 'GFAP', uniprot: 'P14136', puntos: 11.2, porQueNo: 'suma 11.2 frente a 12.8; donde más pierde es en fuentes distintas' }],
    fueraDeConcurso: { subir: ['APP'], ninguna: ['NEFL'] },
    queLaCambiaria: 'Que aparezca evidencia de que bajar MAPT hace daño: la dirección es una puerta y no un término.',
  },
  dianas: [DIANA, SIN_EXPERIMENTO],
  compuestos: [
    {
      nombre: 'donepezilo',
      menciones: 12,
      sostenidos: 9,
      ontologiaId: 'CHEBI:53289',
      ontologia: 'CHEBI',
      enPubchem: true,
      cid: 3152,
      formula: 'C24H29NO3',
      peso: '379.5',
      iupac: '2-[(1-benzylpiperidin-4-yl)methyl]-5,6-dimethoxy-2,3-dihydro-1H-inden-1-one',
      smiles: 'COC1=C(C=C2CC(CC3CCN(CC3)CC4=CC=CC=C4)C(=O)C2=C1)OC',
      inchikey: 'ADEBPBSSDYVVLD-UHFFFAOYSA-N',
      logp: 4.2,
      tpsa: 38.8,
      cerebro: { veredicto: 'compatible', motivo: 'peso 380, logP 4,2 y superficie polar 38,8 Å² están en la banda' },
      url2d: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/3152/PNG?image_size=400x300',
      url3d: null,
    },
    // Un anticuerpo: lo nombran 115 afirmaciones y PubChem no lo tiene como
    // molécula pequeña. Entra igual, y se dice por qué no hay SMILES.
    {
      nombre: 'lecanemab',
      menciones: 115,
      sostenidos: 88,
      ontologiaId: 'CHEBI:229272',
      ontologia: 'CHEBI',
      enPubchem: false,
      motivo: 'PubChem no tiene ningún compuesto con ese nombre',
      cid: null,
      formula: null,
      peso: null,
      iupac: null,
      smiles: null,
      inchikey: null,
      logp: null,
      tpsa: null,
      cerebro: { veredicto: 'no_comprobable', motivo: 'faltan propiedades para juzgarlo' },
      url2d: null,
      url3d: null,
    },
  ],
  nombradasSinEstructura: [{ simbolo: 'TREM2', hechos: 18, sabidos: 14, motivo: 'resuelta en HGNC pero sin acceso de UniProt' }],
  descartadasPorAlias: [{ simbolo: 'AGPS', hechos: 11, sabidos: 8, motivo: 'el nombre que la trajo era un alias' }],
  sinResolver: [],
  resumen: {
    dianas: 2,
    compuestos: 2,
    hipotesisVivas: 34,
    hipotesisConDiana: 29,
    sinDiana: 5,
    afirmaciones: 501,
    sostenidas: 397,
    hechosDeLaInvestigacion: 1242,
    sinExperimento: 1,
    deBanco: 1,
    conAso: 1,
    asoAlReves: 1,
    investigaciones: 6,
  },
};

let nodo: HTMLDivElement;
let root: Root;
// `fetch` se pisa en la prueba de las partes (las anotaciones las trae el
// navegador de UniProt) y hay que devolverlo: vitest reparte los ficheros
// entre unos pocos procesos y dejarlo pisado rompe pruebas de otros ficheros
// que sí lo usan, de forma intermitente y difícil de atribuir.
const fetchDeVerdad = global.fetch;
// La diana abierta va en la URL, así que la pantalla no la guarda: la sube.
let abierta: string | null = null;
let panelAbierto: 'aso' | null = null;

beforeEach(() => {
  abierta = null;
  panelAbierto = null;
  respuestas.datos = DATOS;
  _olvidarMiniaturas();
  respuestas.experimentos = CONTRATOS;
  respuestas.oligos = DIANA.aso;
  visor.cargados = [];
  visor.revienta = false;
  visor.enfocado = null;
  visor.señalado = null;
  visor.dibujar = null;
  visor.nivel = 0;
  nodo = document.createElement('div');
  document.body.appendChild(nodo);
  root = createRoot(nodo);
});
afterEach(async () => {
  await act(async () => root.unmount());
  nodo.remove();
  global.fetch = fetchDeVerdad;
  fijarIdioma('es');
});

const pintar = () =>
  root.render(
    <Laboratorio
      dianaId={abierta}
      panel={panelAbierto}
      alAbrirDiana={(u, p) => {
        abierta = u;
        panelAbierto = p ?? null;
        pintar();
      }}
    />,
  );
const montar = async () => {
  await act(async () => pintar());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const texto = () => nodo.textContent ?? '';
const pulsar = async (el: Element) => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe('lo que va al laboratorio', () => {
  it('traduce la decisión y la fiabilidad en inglés sin esperar al traductor remoto', async () => {
    fijarIdioma('en');
    const aso = {
      ...DIANA.aso!,
      criba: { hecho: true, fecha: 1, transcritos: 669547, ficheros: ['cdna.fa.gz', 'ncrna.fa.gz'], segundos: 197.6, motivo: '', limites: [] },
      fiabilidad: {
        version: 1,
        niveles: [{
          nivel: 'mio' as const,
          titulo: 'Esto lo decidió ROSA2018, y nadie lo ha validado',
          resumen: 'El eslabón más flojo de toda la pantalla, y el que más fácil sería callar.',
          cosas: [{ que: 'Los pesos que combinan todo lo anterior', porQue: 'La puntuación con la que ROSA2018 elige a qué proteína ir también es suya. Cada término se enseña para poder discutirlo, que es justo porque no está validado.' }],
        }],
        noComprobado: [{ que: 'El borrador largo del ARN, con sus intrones', porQue: 'El cribado mira el ARN ya empalmado. El corte promiscuo de la RNasa H1 sobre el pre-ARN es el mecanismo conocido de toxicidad hepática de los gapmers de alta afinidad (Burel et al., Nucleic Acids Res 44:2093, 2016), y eso NO se está mirando. Pide el genoma con su anotación, no el transcriptoma.' }],
        queEsEsto: {
          es: 'La entrada de un cribado primario: la lista que un laboratorio sintetiza para probar en células.',
          noEs: 'No es un fármaco ni un candidato a fármaco, y el número uno no es «el bueno».',
          comoSeUsa: 'Una campaña de verdad sintetiza del orden de ochenta oligos, los prueba en células, se queda con ocho o diez y de ahí salen uno o dos líderes. Lo que hay aquí es el principio de ese embudo, no el final.',
          yLaPremisa: 'Y por encima de todo esto: que bajar esta proteína ayude en el Alzheimer es una HIPÓTESIS, con la certeza que diga su ficha GRADE. Un oligo bien diseñado contra una diana equivocada sigue siendo un oligo contra una diana equivocada.',
        },
      },
    };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }] };
    respuestas.oligos = aso;
    const original = JSON.stringify(respuestas.datos);
    await montar();
    expect(texto()).toContain('322 of 405');
    expect(texto()).toContain("3' untranslated region");
    expect(texto()).toContain('supporting claims');
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    const fiabilidad = nodo.querySelector('.fia')!;
    expect(texto()).toContain('669,547 Ensembl transcripts (GRCh38, cdna.fa.gz and ncrna.fa.gz) in 197.6 s');
    expect(fiabilidad.textContent).toContain('ROSA2018 decided this, and nobody has validated it');
    expect(texto()).toContain('Unspliced precursor RNA, including its introns');
    expect(texto()).toContain('is a HYPOTHESIS');
    expect(texto()).not.toContain('Esto lo decidió');
    expect(texto()).not.toContain('El borrador largo');
    expect(JSON.stringify(respuestas.datos)).toBe(original);
  });

  it('es la unión de todas las investigaciones, no la vista de una', async () => {
    await montar();
    expect(texto()).toContain('Lo que ROSA2018 mandaría al laboratorio');
    expect(texto()).toContain('las 6 investigaciones');
    // El peso de la evidencia manda, y se ve en la tarjeta.
    expect(texto()).toContain('322 afirmaciones sostenidas');
    expect(texto()).toContain('94 fuentes');
    expect(texto()).toContain('2 investigaciones');
    expect(texto()).toContain('MAPT');
    expect(texto()).toContain('tau');
  });

  it('una diana que la evidencia señala y ninguna hipótesis propone es un hueco, y se dice', async () => {
    await montar();
    expect(texto()).toContain('ninguna hipótesis la propone');
    expect(texto()).toContain('SIN EXPERIMENTO');
  });

  it('dice que ROSA2018 no ha diseñado ninguna y de dónde vienen las estructuras', async () => {
    await montar();
    expect(texto()).toContain('ROSA2018 no ha diseñado ninguna');
    expect(texto()).toContain('AlphaFold DB');
    expect(texto()).toContain('CC0');
    // Una predicción no es una medición, y la tarjeta lo marca.
    expect(texto()).toContain('predicha');
  });

  it('enseña la decisión del Killer: una hipótesis suspendida no se presenta como lista para pedir', async () => {
    await montar();
    expect(texto()).toContain('el Killer la tiene suspendida');
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    expect(texto()).toContain('el Killer la tiene suspendida');
    expect(texto()).toContain('certeza muy baja · GRADE');
  });

  it('la lámina baja la estructura de la fuente y enseña la hoja de pedido con su identificador', async () => {
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    expect(visor.cargados).toContain('https://alphafold.ebi.ac.uk/files/AF-P10636-F1-model_v6.cif');
    expect(texto()).toContain('Para el laboratorio');
    expect(texto()).toContain('UniProt P10636');
    expect(texto()).toContain('neuronas de iPSC humanas');
    expect(texto()).toContain('Qué la refutaría');
  });

  it('el experimento entero se puede abrir desde la lámina, con su protocolo y su química', async () => {
    // Lo que se busca al abrir una diana es qué se va a hacer. Antes solo se
    // veía la intervención de una línea; el contrato tiene protocolo, lecturas,
    // controles, coste y qué decisión cambia, y todo eso es lo que se manda.
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-experimento:not(.lab-abrir-aso)')!);
    expect(texto()).toContain('EL PROTOCOLO, PASO A PASO');
    expect(nodo.querySelectorAll('.lab-pasos li').length).toBe(4);
    expect(texto()).toContain('Bioensayo celular de siembra');
    expect(texto()).toContain('Actividad de siembra intracelular');
    expect(texto()).toContain('LA EXPLICACIÓN RIVAL');
    expect(texto()).toContain('QUÉ DECISIÓN CAMBIA');
    expect(texto()).toContain('12.000 a 18.000 euros');
    // Y la química va con la proteína, no en otra pantalla.
    expect(texto()).toContain('C24H29NO3');
    expect(texto()).toContain('ADEBPBSSDYVVLD-UHFFFAOYSA-N');
    expect(texto()).toContain('en 12 afirmaciones junto a esta proteína');
  });

  it('sin experimento prerregistrado no se rellena un protocolo por rellenarlo', async () => {
    await montar();
    await pulsar(nodo.querySelectorAll('.lab-pieza-abrir')[1]!);
    await pulsar(nodo.querySelector('.lab-abrir-experimento:not(.lab-abrir-aso)')!);
    expect(texto()).toContain('ninguna hipótesis viva propone todavía un experimento');
    expect(texto()).not.toContain('EL PROTOCOLO, PASO A PASO');
  });

  it('pulsar una parte de la proteína la enfoca y dice qué es, con su secuencia y su prueba', async () => {
    // Las etiquetas no son adorno: leer «residuos 1 a 5» sin ver dónde están
    // no dice nada, así que la cámara va y el panel explica a la vez.
    const marca = { nombre: 'Péptido señal', detalle: 'se corta al secretarse', desde: 1, hasta: 5, descripcion: '', pruebas: [{ codigo: 'ECO:0000255', fuente: '' }] };
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [{ type: 'Signal', description: '', evidences: [{ evidenceCode: 'ECO:0000255' }], location: { start: { value: marca.desde }, end: { value: marca.hasta } } }] }),
    })) as unknown as typeof fetch;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    const etiqueta = nodo.querySelector('.lab-ancla');
    expect(etiqueta).not.toBeNull();
    await pulsar(etiqueta!);
    expect(visor.enfocado).toEqual([1, 5]);
    expect(texto()).toContain('Péptido señal');
    // La secuencia en una letra, que es lo que se manda para hacer un péptido.
    expect(texto()).toContain('MGAPC');
    // Y con qué prueba lo anota UniProt: esto está PREDICHO, no medido.
    expect(texto()).toContain('predicho por un modelo de secuencia');
    expect(texto()).toContain('ECO:0000255');
  });

  it('pulsar un residuo lo abre con su química, dónde cae y su tramo de secuencia', async () => {
    // En el nivel de átomos el rótulo al pasar por encima decía el nombre y se
    // iba. Pulsándolo se queda, con lo que hace falta para decidir si tocarlo.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [{ type: 'Active site', description: 'Nucleophile', evidences: [], location: { start: { value: 3 }, end: { value: 3 } } }] }),
    })) as unknown as typeof fetch;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    // Al nivel de átomos y con un residuo bajo el ratón.
    visor.nivel = 2;
    await act(async () => {
      visor.dibujar?.();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      visor.aviso?.({ numero: 3, aa: 'CYS', plddt: 91, centro: [0, 0, 0] });
      await new Promise((r) => setTimeout(r, 20));
    });
    await pulsar(nodo.querySelector('.lab-lienzo')!);
    expect(texto()).toContain('cisteína 3');
    // Su química, que es lo que decide si una mutación cambia algo.
    expect(texto()).toContain('puentes disulfuro');
    expect(texto()).toContain('polar');
    // Lo enterrado que está, dicho como la cuenta cruda que es.
    expect(texto()).toContain('enterrado en el interior');
    expect(texto()).toContain('no superficie accesible al disolvente');
    // Y dónde cae respecto de lo que UniProt anota.
    expect(texto()).toContain('dentro de');
    expect(texto()).toContain('sitio activo');
  });

  it('la decisión va primero: cuál apagar, con cada término de la cuenta a la vista', async () => {
    // No existe un oligo que las apague todas. Lo que se puede reunir de toda
    // la investigación es a cuál apuntar, y lo que lo hace útil es que la
    // cuenta se vea y se pueda discutir.
    await montar();
    expect(texto()).toContain('Si hubiera que mandar uno, sería contra');
    expect(texto()).toContain('No existe un oligonucleótido que las apague todas');
    expect(texto()).toContain('afirmaciones que la sostienen');
    expect(texto()).toContain('322 de 405');
    // Por qué no las otras, y las que ni compitieron.
    expect(texto()).toContain('GFAP');
    expect(texto()).toContain('la evidencia pide SUBIRLAS');
    // Y qué la cambiaría, como el Killer con las hipótesis.
    expect(texto()).toContain('Qué la cambiaría');
  });

  it('donde la evidencia pide subir la proteína, se dice que el oligo iría al revés', async () => {
    await montar();
    expect(texto()).toContain('un oligonucleótido la bajaría, y la evidencia pide subirla');
  });

  it('dice si la proteína y el ARN son la misma versión del gen', async () => {
    await montar();
    // MAPT no tiene MANE Select, así que no se puede confirmar. Y eso se dice.
    expect(texto()).toContain('No se puede confirmar que sea la misma versión del gen');
  });

  it('el oligonucleótido se alcanza desde el muro en un solo paso', async () => {
    // Estaba escondido: había que entrar en la proteína y buscar un botón
    // secundario en el panel lateral. Desde el muro se ve la secuencia y se
    // abre directo.
    await montar();
    expect(texto()).toContain('CON OLIGO DISEÑADO');
    const atajo = nodo.querySelector('.lab-pieza-aso');
    expect(atajo).not.toBeNull();
    expect(atajo!.textContent).toContain('CCACTCCCAC');
    await pulsar(atajo!);
    expect(nodo.querySelector('.aso-hueco')?.textContent).toBe('CCACTCCCAC');
  });

  it('el oligonucleótido antisentido se abre desde la lámina, con su secuencia partida y su aviso', async () => {
    // Es lo único que ROSA2018 diseña de verdad: se calcula desde la secuencia
    // y no hace falta predecir ninguna forma. Y sin cribar no se puede pedir.
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    // La secuencia partida en sus tres tramos, que es como se escribe un pedido.
    expect(nodo.querySelector('.aso-hueco')?.textContent).toBe('CCACTCCCAC');
    expect([...nodo.querySelectorAll('.aso-ala')].map((x) => x.textContent)).toEqual(['CTCTC', 'TTCTT']);
    // El mecanismo dicho en una frase.
    expect(texto()).toContain('la RNasa H1, corta el ARN');
    // El aviso de que no está cribado, que es lo que impide pedirlo.
    expect(texto()).toContain('Sin cribar contra el transcriptoma');
    // La vía, que para una diana del cerebro decide si el experimento es
    // posible: los ASO no cruzan la barrera hematoencefálica.
    // Lo que NO hace, que es lo primero que se malentiende.
    expect(texto()).toContain('no toca la proteína que ya está fabricada');
    // Y a qué momento de la enfermedad apunta la hipótesis que lo respalda.
    expect(texto()).toContain('inclusiones de tau ya establecidas');
    expect(texto()).toContain('intratecal');
    expect(texto()).toContain('NO cruzan la barrera hematoencefálica');
    // Y la decisión que ROSA2018 no toma.
    expect(texto()).toContain('55');
    expect(texto()).toContain('Cuál bajar no es lo mismo que cuánta bajar');
    // Los filtros son estadística, y se dice.
    expect(texto()).toContain('no una predicción');
  });

  it('sin secuencia todavía lo dice, y distingue no traída de no comprobable', async () => {
    await montar();
    // La segunda diana no tiene diseño: no debe ofrecer el botón.
    await pulsar(nodo.querySelectorAll('.lab-pieza-abrir')[1]!);
    expect(nodo.querySelector('.lab-abrir-aso')).toBeNull();
  });

  it('la ficha del compuesto lleva SMILES e InChIKey, y dice que la fórmula no identifica', async () => {
    await montar();
    expect(texto()).toContain('ADEBPBSSDYVVLD-UHFFFAOYSA-N');
    expect(texto()).toContain('COC1=C(C=C2CC(CC3CCN(CC3)CC4=CC=CC=C4)C(=O)C2=C1)OC');
    expect(texto()).toContain('La fórmula NO identifica un compuesto');
    expect(texto()).toContain('perfil compatible con llegar al cerebro');
  });

  it('en inglés, g/mol se presenta como masa molar y conserva su valor', async () => {
    fijarIdioma('en');
    await montar();
    expect([...nodo.querySelectorAll('dt')].some((dt) => dt.textContent === 'MOLAR MASS')).toBe(true);
    expect(texto()).toContain('379.5');
    expect(texto()).toContain('g/mol');
    expect(texto()).toContain('ADEBPBSSDYVVLD-UHFFFAOYSA-N');
  });

  it('la vista de proteína usa overview y ofrece reducir expresión, sin prometer eliminación total', async () => {
    fijarIdioma('en');
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    expect(nodo.querySelector('.lab-niveles')?.textContent).toContain('OVERVIEW');
    expect(texto()).toContain('Explore oligonucleotides');
    expect(texto()).toContain('colors indicate local model confidence');
    expect(texto()).not.toContain('Shut down production');
  });

  it('un compuesto que PubChem no tiene entra igual si la evidencia lo nombra', async () => {
    // Quien decide qué compuestos salen es la evidencia, no PubChem: el
    // lecanemab es un anticuerpo, nunca tendrá ficha de molécula pequeña, y
    // dejarlo fuera escondería 115 afirmaciones.
    await montar();
    expect(texto()).toContain('lecanemab');
    expect(texto()).toContain('CHEBI:229272');
    expect(texto()).toContain('115');
  });

  it('lo que se quedó fuera del muro se dice, con EL MOTIVO QUE DA EL SERVIDOR', async () => {
    // El motivo iba escrito en duro en la pantalla y decía que TREM2 «no tiene
    // acceso de UniProt»: es Q9NZC2 y sí lo tiene. Ahora sale el del servidor,
    // así que arreglarlo en un sitio lo arregla en los dos.
    respuestas.datos = {
      ...DATOS,
      nombradasSinEstructura: [{ simbolo: 'TREM2', hechos: 18, sabidos: 14, motivo: 'ROSA2018 no consiguió resolver su acceso de UniProt' }],
    };
    await montar();
    expect(texto()).toContain('TREM2');
    expect(texto()).toContain('ROSA2018 no consiguió resolver su acceso de UniProt');
    expect(texto()).not.toContain('sin acceso de UniProt, así que no hay modelo');
    expect(texto()).toContain('AGPS');
    expect(texto()).toContain('alias');
  });

  it('la cabecera dice cuántas se pueden mandar de verdad, no solo cuántas hay', async () => {
    // El título promete «lo que mandaría al laboratorio» de diecisiete
    // proteínas cuando hoy se puede mandar una. Se dice el número.
    await montar();
    expect(texto()).toContain('hoy se podría mandar una');
    expect(texto()).toContain('SE PUEDEN MANDAR');
    // Y en cada tarjeta, si se puede o no.
    expect(texto()).toContain('se puede mandar: hay un experimento de banco');
    expect(texto()).toContain('no hay experimento que mandar todavía');
  });

  it('dice cuántas estructuras medidas hay en el PDB en vez de prometerlo en el pie', async () => {
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    expect(texto()).toContain('308 estructuras medidas');
    expect(texto()).toContain('el único de longitud completa');
  });

  it('si la estructura no llega lo dice, en vez de quedarse en «trayendo» para siempre', async () => {
    // El fichero lo baja el navegador de AlphaFold, no el servidor de ROSA2018:
    // una red que no llega allí deja la tarjeta sin proteína y hay que decirlo.
    visor.revienta = true;
    await montar();
    expect(texto()).toContain('no pude traer la estructura de AlphaFold');
    expect(texto()).not.toContain('% del modelo con confianza alta');
    // Y el muro no se rompe: la diana sigue con su nombre y su identificador.
    expect(texto()).toContain('MAPT');
  });

  it('sin servidor no enseña estructuras de muestra: lo dice', async () => {
    respuestas.datos = null;
    await montar();
    expect(texto()).toContain('datos de muestra');
    expect(texto()).not.toContain('MAPT');
    expect(visor.cargados).toEqual([]);
  });

  it('un servidor que no responde es "no pude comprobar", nunca "no hay dianas"', async () => {
    respuestas.datos = 'sin_respuesta';
    await montar();
    expect(texto()).toContain('No pude comprobar');
    expect(texto()).toContain('No quiere decir que no haya dianas');
  });

  it('sin ninguna diana lo dice y no finge', async () => {
    respuestas.datos = { ...DATOS, dianas: [], compuestos: [], nombradasSinEstructura: [], descartadasPorAlias: [], resumen: { ...DATOS.resumen, dianas: 0, compuestos: 0 } };
    await montar();
    expect(texto()).toContain('Todavía ninguna afirmación verificada nombra una proteína');
    expect(visor.cargados).toEqual([]);
  });

  it('un candidato sin cribar NO se pinta como limpio', async () => {
    // La regla de ROSA2018: no poder comprobar no es un no, y desde luego no
    // es un sí. «Sin cribar» y «sin choque exacto» no se pueden confundir.
    await montar();
    expect(texto()).toContain('Sin cribar contra el transcriptoma');
    expect(texto()).not.toContain('sin choque exacto en ningún otro ARN humano');
  });

  it('el candidato que encaja en otro gen lo dice, con cuántos y cuáles', async () => {
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      cribado: true,
      criba: {
        cribado: true,
        veredicto: 'descartado' as const,
        propios: 21,
        fuera: ['A1BG', 'AACS', 'AARS1'],
        genesFuera: 1263,
        transcritosFuera: 6299,
        mismoSitioOtroNombre: [],
        genesMismoSitio: 0,
        transcritosMismoSitio: 0,
        porQue: 'El tramo diana aparece IDÉNTICO en 6299 transcritos de 1263 genes en otro sitio del genoma.',
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c], limpios: 0, descartadosPorCriba: 1, criba: { hecho: true, fecha: 1, transcritos: 669547, ficheros: ['cdna.fa.gz'], segundos: 350, motivo: '', limites: [{ que: 'Solo coincidencia exacta', porQue: 'con uno o dos fallos encaja igual' }] } };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('No se puede pedir: encaja en otro gen donde la RNasa H1 cortaría');
    // El número exacto, no el de la lista cortada: decir «3 genes» donde son
    // 1.263 sería mentir por omisión.
    expect(texto()).toContain('1263');
    expect(texto()).toContain('A1BG');
    // Y lo que el cribado NO cubre viaja con el resultado.
    expect(texto()).toContain('Solo coincidencia exacta');
  });

  it('el cribado limpio dice que es exacto y sobre ARN maduro, no "seguro"', async () => {
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      cribado: true,
      criba: {
        cribado: true,
        veredicto: 'sin choque exacto' as const,
        propios: 55,
        fuera: [],
        genesFuera: 0,
        transcritosFuera: 0,
        mismoSitioOtroNombre: [],
        genesMismoSitio: 0,
        transcritosMismoSitio: 0,
        porQue: 'No hay ningún otro ARN humano con este tramo idéntico. Ojo: esto es coincidencia exacta sobre ARN maduro.',
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c], limpios: 1, descartadosPorCriba: 0, criba: { hecho: true, fecha: 1, transcritos: 669547, ficheros: ['cdna.fa.gz', 'ncrna.fa.gz'], segundos: 350, motivo: '', limites: [{ que: 'Solo ARN maduro, sin intrones', porQue: 'el corte promiscuo sobre el borrador largo no se mira' }] } };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('Sin choque exacto en ningún otro ARN humano');
    expect(texto()).toContain('coincidencia exacta sobre ARN maduro');
    expect(texto()).toContain('669.547');
    // Nunca «seguro».
    expect(texto()).not.toContain('es seguro');
  });

  it('la horquilla del ARN se dibuja y marca el tramo del oligo', async () => {
    // Un oligo no entra en un tramo emparejado dentro de una horquilla, por
    // buenas que sean sus veinte letras. Los arcos resaltados son los que hay
    // que abrir.
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      sitio: {
        accesibilidad: 0.0938, etiqueta: 'medio' as const,
        comoSeLee: 'El tramo está a medias: libre entero 9,4 de cada 100 veces.',
        percentil: 95.7, mejorDelTranscrito: 0.8628, posicionMejor: 4585,
        medianaDelTranscrito: 0.0001, ventana: 80, alcance: 40, version: 1,
      },
    };
    const aso = {
      ...DIANA.aso!,
      candidatos: [c],
      plegado: {
        hecho: true, version: 1, ventana: 80, alcance: 40, motivo: '',
        avisos: [{ que: 'Es un modelo, no una medida', porQue: 'un sitio accesible funciona más a menudo, no siempre' }],
        mejorDelTranscrito: 0.8628, posicionMejor: 4585, medianaDelTranscrito: 0.0001, abiertos: 13,
        dibujo: {
          desde: 100, hasta: 160, secuencia: 'AUGC'.repeat(15) + 'A', estructura: '((' + '.'.repeat(57) + '))',
          energia: -21.2, pares: [[1, 61], [2, 60]] as [number, number][],
          letras: Array.from({ length: 61 }, (_, k) => ({
            i: k + 1, pos: 100 + k, letra: 'AUGC'[k % 4]!,
            x: (k % 10) / 9, y: Math.floor(k / 10) / 6,
            emparejada: k < 2 || k > 58,
            enElSitio: 100 + k >= 120 && 100 + k <= 139,
          })),
          proporcion: 1.5, disposicion: 'naview (ViennaRNA)',
        },
        dibujoSitio: [120, 139] as [number, number],
      },
    };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    // Lo que pidió el compañero de Emir: que manden las letras del ARN.
    expect(nodo.querySelector('.arn-svg')).not.toBeNull();
    expect(nodo.querySelectorAll('.arn-letra').length).toBe(61);
    // Las veinte del tramo del oligo (120 a 139) van encendidas y más grandes.
    expect(nodo.querySelectorAll('.arn-n-sitio').length).toBe(20);
    // Y cada letra lleva su color, para reconocerla de un vistazo.
    expect(nodo.querySelectorAll('.arn-a').length).toBeGreaterThan(0);
    expect(nodo.querySelectorAll('.arn-u').length).toBeGreaterThan(0);
    expect(texto()).toContain('tiene que abrir para entrar');
    const coordenadas = [...nodo.querySelectorAll('.arn-letra')].map(el => [el.getAttribute('x'), el.getAttribute('y')]);
    await pulsar(nodo.querySelector('[aria-label="Acercar ARN"]')!);
    expect(nodo.querySelector('.arn-escala')!.getAttribute('style')).toContain('150%');
    expect([...nodo.querySelectorAll('.arn-letra')].map(el => [el.getAttribute('x'), el.getAttribute('y')])).toEqual(coordenadas);
    await pulsar(nodo.querySelector('.arn-n')!);
    expect(nodo.querySelector('.arn-pie-cuenta')!.textContent).toContain('posición');
    expect(nodo.querySelector('.arn-n-pareja')).not.toBeNull();
    await act(async () => nodo.querySelector('.arn-svg')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));

    expect(texto()).toContain('El tramo está a medias');
    // Cuántas hay que abrir, que es el dato que importa de todo el dibujo.
    expect(nodo.querySelector('.arn-pie-nota')!.textContent).toContain('Cada letra es un nucleótido');
    // Decimales con coma, que es la regla del proyecto.
    expect(texto()).toContain('0,0938');
    expect(texto()).not.toContain('0.0938');
    // Y lo que el cálculo NO dice.
    expect(texto()).toContain('Es un modelo, no una medida');
  });

  it('sin ViennaRNA se dice que no se pudo calcular, no que esté tapado', async () => {
    // La regla de ROSA2018: no poder comprobar no es un no.
    const aso = {
      ...DIANA.aso!,
      candidatos: [{ ...DIANA.aso!.candidatos[0]!, sitio: null }],
      plegado: { hecho: false, version: 1, ventana: 80, alcance: 40, avisos: [], motivo: 'ViennaRNA no está instalado, así que no se pudo calcular si el sitio está abierto. No quiere decir que esté tapado.' },
    };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('No se pudo calcular');
    expect(texto()).toContain('No quiere decir que esté tapado');
    expect(nodo.querySelector('.arn-svg')).toBeNull();
  });

  it('la dúplex marca el hueco de ADN y dice que es un esquema, no una estructura', async () => {
    const pares = Array.from({ length: 20 }, (_, k) => ({
      i: k + 1,
      aso: 'ACGT'.charAt(k % 4),
      arn: 'UGCA'.charAt(k % 4),
      quimica: (k < 5 || k >= 15 ? 'ala' : 'hueco') as 'ala' | 'hueco',
      posAso: 20 - k,
      z: k * 2.62,
      giro: (k * 32.7) % 360,
    }));
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      duplex: {
        version: 1, aso: 'A'.repeat(20), diana: 'T'.repeat(20), pares,
        alas: [[1, 5], [16, 20]] as [number, number][], hueco: [6, 15] as [number, number], dondeCorta: [7, 14] as [number, number], huecoEnElOligo: [6, 15] as [number, number], dianaEnAdn: 'T'.repeat(20),
        queEs: { ala: "2'-MOE", hueco: 'ADN, es lo ÚNICO que la RNasa H1 reconoce', arn: 'el ARN de la diana' },
        avisos: [{ que: 'No es una estructura resuelta', porQue: 'nadie ha cristalizado este oligo con este ARN' }],
        largoAngstroms: 49.8, vueltas: 1.73, giroPorPar: 32.7, subidaPorPar: 2.62, surcoMenor: 9.5,
        porQueHibrida: 'no es ni de forma B ni de forma A',
        porQueSoloElHueco: 'la RNasa H1 necesita ver ADN de verdad',
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(nodo.querySelectorAll('.dux-par').length).toBe(20);
    // Diez de los veinte pares son el hueco de ADN, que es lo que corta.
    expect(nodo.querySelectorAll('.dux-par-hueco').length).toBe(10);
    // El ARN manda: hay una letra de ARN por par, y es la más grande.
    expect(nodo.querySelectorAll('.dux-arn').length).toBe(20);
    expect(nodo.querySelectorAll('.dux-aso').length).toBe(20);
    expect(texto()).toContain('la RNasa H1 necesita ver ADN de verdad');
    // Lo que NO es: no se puede vender un esquema como una estructura.
    expect(texto()).toContain('No es una estructura resuelta');
    expect(texto()).toContain('49,8 Å');
  });

  it('la dúplex dice el sentido de cada cadena, que es antiparalela', async () => {
    // Los 5' y 3' no son decoración: una dúplex es antiparalela, y sin eso el
    // dibujo diría que las dos cadenas se leen igual.
    const pares = Array.from({ length: 20 }, (_, k) => ({
      i: k + 1, aso: 'A', arn: 'U', quimica: (k < 5 || k >= 15 ? 'ala' : 'hueco') as 'ala' | 'hueco',
      posAso: 20 - k, z: k * 2.62, giro: (k * 32.7) % 360,
    }));
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      duplex: {
        version: 1, aso: 'A'.repeat(20), diana: 'T'.repeat(20), pares,
        alas: [[1, 5], [16, 20]] as [number, number][], hueco: [6, 15] as [number, number], dondeCorta: [7, 14] as [number, number], huecoEnElOligo: [6, 15] as [number, number], dianaEnAdn: 'T'.repeat(20),
        queEs: { ala: 'a', hueco: 'b', arn: 'c' }, avisos: [],
        largoAngstroms: 49.8, vueltas: 1.73, giroPorPar: 32.7, subidaPorPar: 2.62, surcoMenor: 9.5,
        porQueHibrida: 'x', porQueSoloElHueco: 'y',
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    const extremos = [...nodo.querySelectorAll('.dux-extremo')].map((x) => x.textContent);
    expect(extremos).toEqual(["5'", "3'", "3'", "5'"]);
  });

  it('la fila del ARN va en alfabeto de ARN: con U, nunca con T', async () => {
    // El ARN mensajero no tiene timina. Enseñar una T en la fila del ARN es
    // un error que cualquiera que sepa biología ve de un vistazo, y se coló
    // porque el tramo diana viene del cDNA, que sí se escribe con T.
    const pares = 'GAGAGGGUGAGGGUGAAGAA'.split('').map((arn, k) => ({
      i: k + 1, aso: 'CTCTCCCACTCCCACTTCTT'[k]!, arn,
      quimica: (k < 5 || k >= 15 ? 'ala' : 'hueco') as 'ala' | 'hueco',
      posAso: 20 - k, z: k * 2.62, giro: (k * 32.7) % 360,
    }));
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      duplex: {
        version: 1, aso: 'CTCTCCCACTCCCACTTCTT', diana: 'GAGAGGGUGAGGGUGAAGAA', pares,
        alas: [[1, 5], [16, 20]] as [number, number][], hueco: [6, 15] as [number, number], dondeCorta: [7, 14] as [number, number], huecoEnElOligo: [6, 15] as [number, number], dianaEnAdn: 'T'.repeat(20),
        queEs: { ala: 'a', hueco: 'b', arn: 'c' }, avisos: [],
        largoAngstroms: 49.8, vueltas: 1.73, giroPorPar: 32.7, subidaPorPar: 2.62, surcoMenor: 9.5,
        porQueHibrida: 'x', porQueSoloElHueco: 'y',
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    const arn = [...nodo.querySelectorAll('.dux-arn')].map((x) => x.textContent).join('');
    expect(arn).toBe('GAGAGGGUGAGGGUGAAGAA');
    expect(arn).not.toContain('T');
    // Y el oligo sí lleva T, porque es ADN en el hueco.
    const oligo = [...nodo.querySelectorAll('.dux-aso')].map((x) => x.textContent).join('');
    expect(oligo).toBe('CTCTCCCACTCCCACTTCTT');
  });

  it('dice si se puede probar en un roedor, que es la pregunta práctica', async () => {
    // Si encaja, el experimento se hace con ESTA molécula. Si no, hay que
    // diseñar un sustituto, que es trabajo de más.
    const esp = (clave: 'raton' | 'rata', nombre: string, latin: string, sirve: boolean | null, orto: string) => ({
      comprobado: true, version: 4, clave, nombre, latin, papel: 'roedor' as const,
      via: `cómo se administra en ${nombre}`, simboloHumano: 'MAPT', ortologo: orto,
      veredicto: (sirve ? 'sirve tal cual' : sirve === false ? 'no sirve' : 'no pude comprobar') as 'sirve tal cual' | 'no sirve' | 'no pude comprobar',
      sirve, porQue: `qué pasa en ${nombre}`,
    });
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      especies: {
        veredicto: 'se puede probar' as const,
        porQue: 'Se puede empezar mañana: encaja en ratón.',
        sirvenEn: ['ratón'], noSirvenEn: ['rata'], sinComprobar: [],
        sePuedeProbar: true, cuantas: 1, deCuantas: 2,
        marco: {
          paraInvestigar: 'Para investigar basta con poder probarlo en un roedor, y no hay ningún requisito que cumplir.',
          siNoEncaja: 'Que no encaje es LO NORMAL y se resuelve con un oligo sustituto.',
        },
        avisos: [{ que: 'Encajar no es funcionar', porQue: 'dice que PUEDE cortar' }],
        porEspecie: {
          raton: esp('raton', 'ratón', 'Mus musculus', true, 'Mapt'),
          rata: esp('rata', 'rata', 'Rattus norvegicus', false, 'Mapt'),
        },
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('¿SE PUEDE PROBAR EN UN ROEDOR?');
    expect(texto()).toContain('el experimento se hace con esta misma molécula');
    // Las dos, con su nombre latino.
    expect(nodo.querySelectorAll('.esp-tabla tbody tr').length).toBe(2);
    expect(texto()).toContain('Mus musculus');
    expect(texto()).toContain('Rattus norvegicus');
    // Nada de primates: se quitó a propósito, cuestan demasiado.
    expect(texto()).not.toContain('macaco');
    // Y que no encaje no es un muro.
    expect(texto()).toContain('oligo sustituto');
  });

  it('no encontrar el gen equivalente NO se pinta como que no sirve', async () => {
    // Pasa de verdad: CA2 en ratón se llama Car2.
    const c = {
      ...DIANA.aso!.candidatos[0]!,
      especies: {
        veredicto: 'no pude comprobar' as const, porQue: 'No se pudo encontrar el gen equivalente.',
        sirvenEn: [], noSirvenEn: [], sinComprobar: ['ratón'], sePuedeProbar: false, cuantas: 0, deCuantas: 2,
        marco: { paraInvestigar: 'a', siNoEncaja: 'b' },
        avisos: [],
        porEspecie: {
          raton: {
            comprobado: true, version: 4, clave: 'raton' as const, nombre: 'ratón', latin: 'Mus musculus',
            papel: 'roedor' as const, via: 'ventrículo', simboloHumano: 'CA2', ortologo: '',
            veredicto: 'no pude comprobar' as const, sirve: null,
            porQue: 'No encontré en ratón ningún gen que se llame como CA2. NO quiere decir que el oligo no sirva.',
          },
        },
      },
    };
    const aso = { ...DIANA.aso!, candidatos: [c] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('No se pudo comprobar');
    expect(texto()).toContain('NO quiere decir que el oligo no sirva');
    expect(nodo.querySelector('.esp-duda')).not.toBeNull();
  });

  it('la pantalla dice de qué fiarse y de qué no, incluido lo que decidió ROSA2018', async () => {
    // Lo pidió Emir: que la justificación esté en la interfaz y no en los
    // comentarios del código. Lo que no puede faltar es el nivel «mío».
    const aso = {
      ...DIANA.aso!,
      fiabilidad: {
        version: 1,
        niveles: [
          { nivel: 'exacto' as const, titulo: 'Exacto: se puede comprobar', resumen: 'aritmética sobre secuencias reales', cosas: [{ que: 'La secuencia del oligo', porQue: 'está LITERALMENTE en el ARN de Ensembl' }] },
          { nivel: 'mio' as const, titulo: 'Esto lo decidió ROSA2018, y nadie lo ha validado', resumen: 'el eslabón más flojo', cosas: [{ que: 'Los pesos', porQue: 'NADIE ha comprobado que esa combinación prediga potencia' }] },
        ],
        noComprobado: [{ que: 'El borrador largo del ARN', porQue: 'el corte sobre el pre-ARN no se mira' }],
        queEsEsto: { es: 'La entrada de un cribado primario.', noEs: 'No es un fármaco.', comoSeUsa: 'Se prueban ochenta en células.', yLaPremisa: 'Que bajar esta proteína ayude es una HIPÓTESIS.' },
      },
    };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }], oligoQueMandaria: null };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    expect(texto()).toContain('DE QUÉ FIARSE Y DE QUÉ NO');
    // Lo que es exacto se dice que lo es.
    expect(texto()).toContain('LITERALMENTE');
    // Y lo que es una apuesta de ROSA2018 también, que es lo que más fácil
    // sería callar.
    expect(nodo.querySelector('.fia-mio')).not.toBeNull();
    expect(texto()).toContain('nadie lo ha validado');
    expect(texto()).toContain('NADIE ha comprobado');
    // Qué es esto, y la premisa de arriba del todo.
    expect(texto()).toContain('No es un fármaco');
    expect(texto()).toContain('HIPÓTESIS');
  });
});


describe('la ficha visual y sus gráficas', () => {
  it('oculta ficha, niveles y confianza juntos al acercar y los recupera al alejar', async () => {
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    for (const nivel of [1, 2, 0]) {
      visor.nivel = nivel;
      await act(async () => {
        visor.dibujar?.();
        await new Promise((r) => setTimeout(r, 20));
      });
      for (const selector of ['.lab-hoja', '.lab-mando', '.lab-leyenda']) {
        expect(nodo.querySelector(selector)!.classList.contains('lab-fuera')).toBe(nivel > 0);
      }
      expect(nodo.querySelector('.lab-mando button')!.getAttribute('tabindex')).toBe(nivel > 0 ? '-1' : '0');
    }
  });

  it('mantiene el conflicto del contrato fuera de la zona desplazable', async () => {
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, hojaDePedido: { ...DIANA.hojaDePedido, contradiceLaIntervencion: true } }] };
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    const alerta = nodo.querySelector('.lab-hoja-alerta')!;
    expect(alerta.textContent).toContain('Esta ficha no es un pedido');
    expect(alerta.closest('.lab-hoja-cuerpo')).toBeNull();
    expect(nodo.querySelector('.lab-hoja-estado')!.textContent).toContain('Contrato por revisar');
    expect(nodo.querySelector('.lab-hoja-acciones .lab-abrir-aso')).not.toBeNull();
    await pulsar(nodo.querySelector('.lab-hoja-toggle')!);
    expect(nodo.querySelector('.lab-hoja-toggle')!.getAttribute('aria-expanded')).toBe('true');
    await pulsar(nodo.querySelector('[aria-label="Cerrar panel del laboratorio"]')!);
    expect(nodo.querySelector('.lab-hoja-toggle')!.getAttribute('aria-expanded')).toBe('false');
    expect(nodo.querySelector('.lab-hoja')!.classList.contains('lab-hoja-cerrada')).toBe(true);
    await pulsar(nodo.querySelector('.lab-hoja-toggle')!);
    expect(nodo.querySelector('.lab-hoja')!.classList.contains('lab-hoja-abierta')).toBe(true);
  });

  it('el mapa selecciona por teclado otro candidato y actualiza el diseño', async () => {
    const primero = DIANA.aso!.candidatos[0]!;
    const aso = { ...DIANA.aso!, candidatos: [primero, { ...primero, posicion: 1800, hasta: 1819, gc: .55 }] };
    respuestas.datos = { ...DATOS, dianas: [{ ...DIANA, aso }] };
    respuestas.oligos = aso;
    await montar();
    await pulsar(nodo.querySelector('.lab-pieza-abrir')!);
    await pulsar(nodo.querySelector('.lab-abrir-aso')!);
    const puntos = nodo.querySelectorAll<SVGGElement>('.aso-punto');
    expect(puntos).toHaveLength(2);
    expect(puntos[1]!.getAttribute('aria-label')).toContain('G y C 55 por ciento');
    await act(async () => puntos[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(nodo.querySelector('.aso-punto-activo')!.getAttribute('aria-label')).toContain('posición 1800');
    expect(nodo.querySelector('.aso-mapa-seleccion')!.textContent).toContain('55 %');
    expect(texto()).toContain('EL CANDIDATO 2 DE 2');
  });
});

describe('el muro: las miniaturas son imagenes de un solo visor', () => {
  it('con muchas tarjetas a la vista se crea UN visor, cada estructura se carga una vez y cada tarjeta acaba con imagen', async () => {
    // Antes cada tarjeta era un visor WebGL vivo que se creaba y destruia al
    // hacer scroll: 30 fotogramas en 4 s de scroll con uno de 1114 ms, y
    // tarjetas en blanco al pasar del tope de contextos del navegador (5 de
    // octubre de 2026). Ahora un visor oculto las pinta en serie y las
    // captura a imagen.
    const { crearVisor } = await import('../lib/visorMolecular');
    (crearVisor as unknown as { mockClear: () => void }).mockClear();
    visor.cargados.length = 0;
    // jsdom no trae IntersectionObserver: el componente lo trata como visible.
    const antes = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const muchas = Array.from({ length: 6 }, (_, i) => ({ ...DIANA, uniprot: `P0000${i}`, simbolo: `GEN${i}`, estructura: { ...DIANA.estructura, url: `https://alphafold.ebi.ac.uk/files/AF-P0000${i}-F1-model_v6.cif` } }));
    respuestas.datos = { ...DATOS, dianas: muchas, resumen: { ...DATOS.resumen, dianas: muchas.length } };
    try {
      await montar();
      // La cola es en serie: se le da tiempo a recorrer las seis.
      for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(crearVisor).toHaveBeenCalledTimes(1);
      expect(new Set(visor.cargados).size).toBe(6);
      expect(visor.cargados.length).toBe(6);
      expect(nodo.querySelectorAll('.lab-mini-lista img').length).toBe(6);
      expect(texto()).not.toContain('trayendo la estructura');
    } finally {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = antes;
    }
  });
});
