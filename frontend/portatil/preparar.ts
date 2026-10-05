import { acciones, aplicar, arrancarMuestra } from '../src/datos/almacen';
import { nuevaIteracion } from '../src/datos/simulacion';
import { nuevoId } from '../src/datos/acciones';
import { AHORA_MUESTRA, estadoDeMuestra } from '../src/datos/muestra';
import type { EstadoRosa, PreguntaABases } from '../src/datos/tipos';
import type { AfirmacionCitada, FichaCita } from '../src/lib/citas';
import { SIN_COMPROBAR } from '../src/lib/citas';
import { DATOS, CONTRATOS } from './laboratorio';

// Toda la interacción usa reducers locales y fixtures; nunca estado del servidor.
const desplazamiento = Date.now() - AHORA_MUESTRA;
const muestra = JSON.parse(JSON.stringify(estadoDeMuestra()), (_k, v: unknown) =>
  typeof v === 'number' && v > 1_000_000_000_000 && v < 2_000_000_000_000 ? v + desplazamiento : v,
) as EstadoRosa;
muestra.investigaciones.forEach(i => {
  i.revisores = ['Persona de ejemplo'];
  const regiones = ['hipocampo', 'corteza_entorrinal', 'corteza_prefrontal'];
  i.mapaEnfermedad = {
    ejes: { estadio: {}, nivel: {}, region: { hipocampo: 6, corteza_entorrinal: 5, corteza_prefrontal: 4 }, tipoCelular: { neurona: 15 } },
    celdas: regiones.map((region, n) => ({ estadio: null, region, tipoCelular: 'neurona',
      hechos: muestra.hechos.filter((_, j) => j % 3 === n).map(h => h.id),
      hipotesis: muestra.hipotesis.filter((_, j) => j % 3 === n).map(h => h.id), preguntas: [],
      certezaMax: 'muy_baja', certezaMotivo: 'Ejemplo ilustrativo para revisar la interfaz.', cohortes: ['Cohorte ficticia'], porMision: 0,
    })), huecos: [], sinEjes: 0, hipotesisSinEjes: 0, heredados: 0,
    mision: { estadio: null, estadios: [], region: regiones, tipoCelular: ['neurona'], motivos: { estadio: null, estadios: {}, region: {}, tipoCelular: {} } },
    resumen: 'Mapa ficticio para revisar filtros, regiones y paneles.', fecha: Date.now(), iteracion: 14,
  };
  i.preguntasABases = [{
    id: 'demo-chat-inicial', fecha: Date.now() - 60_000,
    pregunta: '¿Qué puedo revisar en esta copia de ROSA?',
    respuesta: '**Esta es la interfaz real de ROSA con datos de muestra.** Puedes recorrer las investigaciones, abrir hipótesis, probar el ranking, filtrar los hechos y explorar las fichas del laboratorio.\n\nEl asistente muestra respuestas de ejemplo; no utiliza IA ni consulta internet en esta copia.',
    limites: 'Demostración de interfaz, sin investigación ni resultados reales.',
    herramientas: [], consultas: [], iteraciones: 0, quien: 'Persona de ejemplo', error: null,
  }];
});
muestra.asistenteGlobal = { ...muestra.investigaciones[0]!, id: 'global', titulo: 'Asistente de ROSA', datasets: [], memoria: [] };
muestra.avisos.correo = { activo: false, direccion: '' };
muestra.avisos.slack = { activo: false, canal: '' };
aplicar(() => muestra);

// Varias alternativas permiten recorrer la tabla y los gráficos sin diseñar moléculas.
for (const d of DATOS.dianas) {
  d.investigaciones = [{ id: 'inv-1', titulo: muestra.investigaciones[0]!.titulo, hechos: d.hechos }];
  d.loQueSeSabe.forEach(s => { s.referencia = 'Documento ilustrativo de la demo'; s.fragmento = 'Texto de muestra para revisar la presentación de la evidencia.'; });
  if (d.aso) {
    const base = d.aso.candidatos[0]!;
    d.aso.candidatos = Array.from({ length: 8 }, (_, i) => ({ ...base, posicion: 500 + i * 670, hasta: 519 + i * 670, gc: .4 + (i % 5) * .05, motivosBuenos: 3 + i % 4 }));
    d.aso.candidatosEnTotal = 8;
  }
}
acciones.laboratorio = async () => DATOS;
acciones.experimentosDe = async uniprot => uniprot === 'P10636' ? CONTRATOS : [];
acciones.oligosDe = async uniprot => DATOS.dianas.find(d => d.uniprot === uniprot)?.aso ?? null;

acciones.iniciarCorrida = (investigacionId, parada = null) => {
  aplicar(e => {
    if (e.corridas.some(c => c.investigacionId === investigacionId && ['en_marcha', 'esperando_plan'].includes(c.estado))) return e;
    const ahora = Date.now();
    const id = nuevoId('demo-cor');
    return { ...e, corridas: [...e.corridas, {
      id, investigacionId, numero: e.corridas.filter(c => c.investigacionId === investigacionId).length + 1,
      estado: 'esperando_plan', empezadaEn: ahora, terminadaEn: null, iteracionActual: 1,
      gasto: { tokensEntrada: 0, tokensSalida: 0, llamadas: 0, segundos: 0, articulosLeidos: 0 },
      motivoCierre: null, presupuesto: { limiteLlamadas: 3000, alertas: [.5, .8], avisadas: [] },
      contexto: { tokensUsados: 0, tokensLimite: 1000000, compactaciones: 0, ultimaCompactacion: null },
      busqueda: { identificados: 0, cribados: 0, textoCompleto: 0, usados: 0, consultas: [] },
      coberturas: [], metaRevisiones: [], procesos: [], panorama: [], autoAprobarPlanSegundos: null, parada,
    }], iteraciones: [...e.iteraciones, nuevaIteracion(id, 1, ahora)] };
  });
};
const crear = acciones.crearInvestigacion;
acciones.crearInvestigacion = datos => {
  const id = crear(datos);
  if (id) acciones.iniciarCorrida(id);
  return id;
};
const canceladas = new Set<string>();
acciones.cancelarRespuesta = async (_id, seguimiento) => { canceladas.add(seguimiento); return null; };
acciones.preguntarALasBases = async (investigacionId, pregunta, hilo, seguimiento) => {
  await new Promise(resolve => setTimeout(resolve, 700));
  if (seguimiento && canceladas.delete(seguimiento)) return null;
  const turno: PreguntaABases = {
    id: `demo-${Date.now()}`, fecha: Date.now(), pregunta,
    respuesta: '**Respuesta de ejemplo de ROSA.**\n\nEn esta copia puedes explorar los hechos, sus fuentes y las hipótesis de la investigación desde las pestañas del modelo de mundo. El laboratorio incluye fichas, controles y candidatos de muestra.\n\nEsta respuesta es fija y sirve para revisar el diseño del chat. No he consultado bases, ejecutado herramientas ni iniciado una investigación.',
    limites: 'Contenido ficticio para una revisión de frontend.', herramientas: [], consultas: [], iteraciones: 0,
    quien: 'Persona de ejemplo', error: null, hilo, seguimiento, duracionMs: 700,
  };
  aplicar(e => investigacionId === 'global' ? {
    ...e, asistenteGlobal: { ...e.asistenteGlobal!, preguntasABases: [...(e.asistenteGlobal?.preguntasABases ?? []), turno] },
  } : { ...e, investigaciones: e.investigaciones.map(i => i.id === investigacionId ? { ...i, preguntasABases: [...(i.preguntasABases ?? []), turno] } : i) });
  return null;
};

// La pantalla de citas conserva la lista, los filtros y el panel de detalle.
const afirmaciones: AfirmacionCitada[] = Array.from({ length: 6 }, (_, i) => ({
  id: `cita-demo-${i}`, texto: ['La señal del biomarcador cambia en la cohorte de ejemplo.', 'La hipótesis necesita una réplica independiente.', 'Los controles permiten comparar las dos condiciones.'][i % 3]!,
  cita: `[Documento de muestra ${i + 1}, sección Resultados]`, veredicto: i % 3 === 1 ? 'parcial' : 'sostenida',
  iteracion: 13, fuenteId: `fuente-demo-${i}`, referencia: `Documento de muestra ${i + 1}`,
  localizador: 'Resultados', clase: 'seccion', conTexto: true, conPdf: false,
  hoy: { ...SIN_COMPROBAR }, bloqueoViejo: false,
}));
acciones.citasDe = async corridaId => ({ corridaId, afirmaciones, resumen: {
  total: 6, porVeredicto: { sostenida: 4, parcial: 2 }, porClase: { seccion: 6 },
  conPagina: 0, conPdf: 0, bloqueosViejos: 0, conCitaEnOrden: 0, bloqueadasConCitaEnOrden: 0, resuelvenHoy: 0, literalesHoy: 0,
} });
acciones.citaDe = async (_corrida, id): Promise<FichaCita | null> => {
  const a = afirmaciones.find(v => v.id === id);
  if (!a) return null;
  return { hoy: { ...SIN_COMPROBAR }, bloqueoViejo: false,
    afirmacion: { ...a, pasaje: a.texto }, fuente: { id: a.fuenteId, referencia: a.referencia, titulo: a.referencia, textoCompleto: true },
    localizador: 'Resultados', clase: 'seccion', pagina: null, encabezado: 'Documento ilustrativo',
    texto: `Texto ficticio para comprobar el diseño de una cita. ${a.texto} No procede de una publicación ni de una investigación real.`,
    tramos: [], falta: null, completo: true, conPdf: false, url: '', leidos: [],
  };
};

const aviso = document.createElement('div');
aviso.className = 'portatil-aviso';
const texto = document.createElement('span');
texto.textContent = 'ROSA · Demo interactiva de frontend · Datos de muestra · Sin backend ni 3D';
const reiniciar = document.createElement('button');
reiniciar.textContent = 'Reiniciar demo';
reiniciar.addEventListener('click', () => location.reload());
aviso.append(texto, reiniciar);
document.body.prepend(aviso);
arrancarMuestra();
