// Voz de los personajes a partir del registro real. Solo se adapta la frase
// de presentación; los títulos, las cifras y las afirmaciones se conservan.
// El registro original sigue disponible en la transcripción y en el tooltip.
import type { ActividadLab } from './labVivo';
import { tr, trp } from './idioma';

interface AccionPersonal {
  patron: RegExp;
  ahora: string;
  antes: string;
  terminada: string;
}
const ACCIONES: AccionPersonal[] = [
  { patron: /^(?:El Killer revisa|(?:The )?Killer (?:reviews|is reviewing))\s+(.+)$/i, ahora: 'Estoy revisando {detalle}', antes: 'Estaba revisando {detalle}', terminada: 'Ya terminé de revisar {detalle}' },
  { patron: /^(?:Revisión inicial de|Initial review of)\s+(.+)$/i, ahora: 'Estoy haciendo la revisión inicial de {detalle}', antes: 'Estaba haciendo la revisión inicial de {detalle}', terminada: 'Ya terminé la revisión inicial de {detalle}' },
  { patron: /^(?:Consulta|Query):\s*(.+)$/i, ahora: 'Estoy buscando: {detalle}', antes: 'Estaba buscando: {detalle}', terminada: 'Ya terminé esta búsqueda: {detalle}' },
  { patron: /^(?:Evaluando|Evaluating)\s+(.+)$/i, ahora: 'Estoy evaluando {detalle}', antes: 'Estaba evaluando {detalle}', terminada: 'Ya terminé de evaluar {detalle}' },
  { patron: /^(?:Comparando|Comparing)\s+(.+)$/i, ahora: 'Estoy comparando {detalle}', antes: 'Estaba comparando {detalle}', terminada: 'Ya terminé de comparar {detalle}' },
  { patron: /^(?:Generando|Generating)\s+(.+)$/i, ahora: 'Estoy generando {detalle}', antes: 'Estaba generando {detalle}', terminada: 'Ya terminé de generar {detalle}' },
  { patron: /^(?:Leyendo|Reading)\s+(.+)$/i, ahora: 'Estoy leyendo {detalle}', antes: 'Estaba leyendo {detalle}', terminada: 'Ya terminé de leer {detalle}' },
  { patron: /^(?:Buscando|Searching for)\s+(.+)$/i, ahora: 'Estoy buscando {detalle}', antes: 'Estaba buscando {detalle}', terminada: 'Ya terminé de buscar {detalle}' },
  { patron: /^(?:Extrayendo|Extracting)\s+(.+)$/i, ahora: 'Estoy extrayendo {detalle}', antes: 'Estaba extrayendo {detalle}', terminada: 'Ya terminé de extraer {detalle}' },
  { patron: /^(?:Verificando|Verifying)\s+(.+)$/i, ahora: 'Estoy verificando {detalle}', antes: 'Estaba verificando {detalle}', terminada: 'Ya terminé de verificar {detalle}' },
  { patron: /^(?:Actualizando|Updating)\s+(.+)$/i, ahora: 'Estoy actualizando {detalle}', antes: 'Estaba actualizando {detalle}', terminada: 'Ya terminé de actualizar {detalle}' },
  { patron: /^(?:Revisando|Reviewing)\s+(.+)$/i, ahora: 'Estoy revisando {detalle}', antes: 'Estaba revisando {detalle}', terminada: 'Ya terminé de revisar {detalle}' },
  { patron: /^(?:Ejecutando|Running)\s+(.+)$/i, ahora: 'Estoy ejecutando {detalle}', antes: 'Estaba ejecutando {detalle}', terminada: 'Ya terminé de ejecutar {detalle}' },
];
function accionPersonal(texto: string, tiempo: 'ahora' | 'antes' | 'terminada'): string | null {
  for (const a of ACCIONES) {
    const m = a.patron.exec(texto);
    if (m) return trp(a[tiempo], { detalle: m[1]! });
  }
  return null;
}

/** En vivo solo cuando esta función sigue activa en la corrida. Un registro
 * histórico de apertura no prueba que la tarea haya terminado. */
export function dialogoDeActividad(e: ActividadLab, enVivo: boolean): string {
  const texto = e.texto.trim();
  const miembro = /^(?:El miembro «[^»]+»|The ["“][^"”]+["”] member)\s+(.+)$/i.exec(texto)?.[1];
  if (miembro) {
    let m = /^(?:genera propuestas en la ronda|generates proposals in (?:the )?round)\s+(\d+)$/i.exec(miembro);
    if (m) return trp(enVivo ? 'Estoy generando propuestas en la ronda {n}.' : 'Estaba generando propuestas en la ronda {n}.', { n: m[1]! });
    m = /^(?:terminó la ronda|finished (?:the )?round)\s+(\d+)$/i.exec(miembro);
    if (m) return trp('Ya terminé la ronda {n}.', { n: m[1]! });
    m = /^(?:espera al modelo en la ronda|is waiting for the model in (?:the )?round|waits for the model in (?:the )?round)\s+(\d+)$/i.exec(miembro);
    if (m) return trp(enVivo ? 'Estoy esperando la respuesta del modelo en la ronda {n}.' : 'Me quedé esperando la respuesta del modelo en la ronda {n}.', { n: m[1]! });
    m = /^(?:interrumpió la ronda|interrupted (?:the )?round)\s+(\d+)$/i.exec(miembro);
    if (m) return trp('Tuve que interrumpir la ronda {n}.', { n: m[1]! });
    m = /^(?:no respondió en la ronda|did not respond in (?:the )?round)\s+(\d+):\s*(.*)$/i.exec(miembro);
    if (m) return trp('No pude completar la ronda {n}: {motivo}', { n: m[1]!, motivo: m[2]! });
  }
  const completada = /^(?:Terminó la tarea|(?:The )?task (?:finished|completed)):\s*(.+)$/i.exec(texto);
  if (completada) return accionPersonal(completada[1]!, 'terminada') ?? trp('Ya terminé esta tarea: «{detalle}».', { detalle: completada[1]! });
  const fallida = /^(?:No se completó la tarea|The task was not completed|Task did not complete):\s*(.+)$/i.exec(texto);
  if (fallida) return trp('No pude terminar esta tarea: «{detalle}».', { detalle: fallida[1]! });
  // Solo los mensajes de acción admiten pasar a presente. Una afirmación
  // científica con estas mismas palabras nunca se transforma en una acción.
  if (e.tipo === 'accion' || e.tipo === 'estado') {
    const accion = accionPersonal(texto, enVivo ? 'ahora' : 'antes');
    if (accion) return accion;
    if (/^Reranker$/i.test(texto)) return tr(enVivo ? 'Estoy ordenando los artículos por relevancia.' : 'Estaba ordenando los artículos por relevancia.');
    if (/^(?:esearch \+ efetch|REST search|search \(neural\))$/i.test(texto) && e.fuente) return trp(enVivo ? 'Estoy consultando {fuente}.' : 'Estaba consultando {fuente}.', { fuente: e.fuente });
  }
  if (e.tipo === 'resultado') {
    let m = /^(\d[\d.,]*) (?:resultados en|results in) (.+)$/i.exec(texto);
    if (m) return trp('Encontré {n} resultados en {detalle}', { n: m[1]!, detalle: m[2]! });
    m = /^(?:Juez|Judge):\s*(\d[\d.,]*) (?:de|of) (\d[\d.,]*)$/i.exec(texto);
    if (m) return trp(enVivo ? 'Llevo {n} de {m} afirmaciones verificadas.' : 'En ese momento llevaba {n} de {m} afirmaciones verificadas.', { n: m[1]!, m: m[2]! });
    m = /^(\d[\d.,]*) (?:fuentes|sources), (\d[\d.,]*) (?:afirmaciones con cita|claims with (?:a )?citation)$/i.exec(texto);
    if (m) return trp('Leí {n} fuentes y extraje {m} afirmaciones con cita.', { n: m[1]!, m: m[2]! });
  }
  // Lo que ya está en primera persona conserva sus palabras. Todo formato
  // desconocido se cita: evita reinterpretar una conclusión o un veredicto.
  if (/^(?:Estoy |Estaba |Ya terminé |No pude |Encontré |Leí |Llevo |Anoté |Necesito |¿Me |I(?:['’]m | am | was | found | read | have | could not | need |['’]ve ))/i.test(texto)) return texto;
  if (e.tipo === 'error') return trp('Encontré un problema: «{texto}».', { texto });
  if (e.tipo === 'nota') return trp('Anoté esto: «{texto}».', { texto });
  if (e.tipo === 'resultado') return trp('Obtuve este resultado: «{texto}».', { texto });
  return trp(enVivo ? 'Estoy trabajando en esto: «{texto}».' : 'Mi último registro dice: «{texto}».', { texto });
}
