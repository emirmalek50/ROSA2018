import type { EventoVisualLab } from '../../lib/peliculaLab';

const LIMITE_PENDIENTES = 100;
type Pendiente = { evento: EventoVisualLab; firma: string; entidad: string | null };
type Version = { id: string; firma: string };
function casoDe(evento: EventoVisualLab): string | null {
  const d = evento.dato;
  if (d?.tipo === 'analisis') return `analisis:${d.ejecucionId}`;
  if (d?.tipo === 'decision_hipotesis') return `decision:${d.hipotesisId}:${d.version}`;
  if (d?.tipo === 'revision_registro') return `registro:${d.iteracionId}`;
  return null;
}

/** La misma respuesta JSON puede ordenar sus claves de otra forma. Eso no
 * cambia la escena; el orden de los elementos de una lista sí la cambia. */
function firmaDe(evento: EventoVisualLab): string {
  return JSON.stringify(evento, (_clave, valor: unknown) => {
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return valor;
    const objeto = valor as Record<string, unknown>;
    return Object.fromEntries(Object.keys(objeto).sort().map((clave) => [clave, objeto[clave]]));
  });
}

/** Una tarea puede escribir varias entradas con IDs diferentes. Si todavía
 * no se ha representado, interesa su estado más reciente, sin reconstruir
 * fases antiguas. Los pares y resultados del torneo conservan cada entrada. */
function entidadDe(evento: EventoVisualLab): string | null {
  const dato = evento.dato;
  if (dato?.tipo === 'idea') return `idea:${dato.hipotesisId}`;
  if (dato?.tipo === 'articulo') return `articulo:${dato.id}:${dato.modo}`;
  if (dato?.tipo === 'analisis') return `analisis:${dato.ejecucionId}:${dato.estado}`;
  if (dato?.tipo === 'decision_hipotesis') return `decision:${dato.hipotesisId}:${dato.version}:${dato.etapa}:${dato.estado}`;
  if (dato?.tipo === 'revision_registro') return `registro:${dato.iteracionId}:${dato.etapa}:${dato.vuelta}:${dato.estado}`;
  if (dato?.tipo === 'asignacion_hecho') return `hecho:${dato.hechoId}:${dato.estado}`;
  if (dato?.tipo === 'torneo') return null;
  // Los resúmenes de estas entidades ya reciben un ID estable en la proyección.
  if (/^(?:plan|fuente|fuente-documento|lectura|afirmacion|verificacion):/.test(evento.id)) return `entidad:${evento.id}`;
  return JSON.stringify(['contexto', evento.sala, evento.tipo, [...evento.agentes].sort()]);
}

/** Espera a que los actores estén libres. No ejecuta tareas de ROSA, no pone
 * voz a los personajes y no modifica los eventos que recibe del registro. */
export class ColaPelicula {
  private identidad: string | null = null;
  private readonly vistas = new Map<string, string>();
  private readonly ultimas = new Map<string, Version>();
  private readonly ultimoCaso = new Map<string, Version>();
  private readonly pendientes: Pendiente[] = [];

  recibir(eventos: readonly EventoVisualLab[], identidad: string, inicial = false): void {
    if (this.identidad !== identidad) {
      this.limpiar();
      this.identidad = identidad;
    }
    const lote = new Map<string, Version>();
    for (const evento of eventos) {
      const firma = firmaDe(evento);
      const caso = casoDe(evento);
      if (caso) this.ultimoCaso.set(caso, { id: evento.id, firma });
      const entidad = entidadDe(evento);
      if (entidad !== null) lote.set(entidad, { id: evento.id, firma });
      if (this.vistas.get(evento.id) === firma) continue;
      this.vistas.set(evento.id, firma);
      const indice = this.pendientes.findIndex((p) => p.evento.id === evento.id);
      // La apertura registra toda la historia sin volver a representarla. El
      // motor puede devolver después una acción actual elegida explícitamente.
      if (inicial || evento.agentes.length === 0) {
        if (indice >= 0) this.pendientes.splice(indice, 1);
        continue;
      }
      if (indice >= 0) this.pendientes[indice] = { evento, firma, entidad };
      else this.pendientes.push({ evento, firma, entidad });
    }
    // El orden del lote decide el estado más reciente incluso si una entrada
    // antigua se corrigió mientras la última conserva la misma firma.
    lote.forEach((version, entidad) => this.ultimas.set(entidad, version));
    this.acotar();
  }

  siguiente(disponible: (evento: EventoVisualLab) => boolean): EventoVisualLab | null {
    const indice = this.pendientes.findIndex((p) => disponible(p.evento));
    return indice < 0 ? null : this.pendientes.splice(indice, 1)[0]!.evento;
  }

  hayPendiente(coincide: (evento: EventoVisualLab) => boolean): boolean {
    return this.pendientes.some((p) => this.actual(p.evento, p.firma, p.entidad) && coincide(p.evento));
  }

  devolver(evento: EventoVisualLab): void {
    const firma = firmaDe(evento);
    const entidad = entidadDe(evento);
    const caso = casoDe(evento), ultima = caso ? this.ultimoCaso.get(caso) : null;
    // Las fases pendientes se conservan, pero una interrupción no resucita
    // una fase ya sustituida por el siguiente resultado del mismo expediente.
    if (ultima && (ultima.id !== evento.id || ultima.firma !== firma)) return;
    // Una cancelación tardía no revive la versión anterior, ni una escena de
    // otra identidad cuya cola ya se limpió. Tampoco duplica una pendiente.
    if (evento.agentes.length === 0 || !this.actual(evento, firma, entidad) || this.pendientes.some((p) => p.evento.id === evento.id)) return;
    this.pendientes.push({ evento, firma, entidad });
    this.acotar();
  }

  limpiar(): void {
    this.identidad = null;
    this.vistas.clear();
    this.ultimas.clear();
    this.ultimoCaso.clear();
    this.pendientes.length = 0;
  }

  private acotar(): void {
    for (let i = this.pendientes.length - 1; i >= 0; i--) {
      const p = this.pendientes[i]!;
      if (!this.actual(p.evento, p.firma, p.entidad)) this.pendientes.splice(i, 1);
    }
    if (this.pendientes.length > LIMITE_PENDIENTES) this.pendientes.splice(0, this.pendientes.length - LIMITE_PENDIENTES);
    // Las firmas vistas sobreviven al recorte de la cola y del registro SSE.
    // Solo un cambio de corrida/iteración o limpiar permite repetir esa historia.
  }

  private actual(evento: EventoVisualLab, firma: string, entidad: string | null): boolean {
    if (this.vistas.get(evento.id) !== firma) return false;
    if (entidad === null) return true;
    const ultima = this.ultimas.get(entidad);
    return ultima?.id === evento.id && ultima.firma === firma;
  }
}
