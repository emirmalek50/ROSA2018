// El ritmo coordina las entradas, no escribe ni cambia lo que se dicen.
// El ID conserva una separación estable al repetir los mismos datos.
function variacion(id: string, amplitud: number): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % (amplitud + 1) / 1000;
}

export const pausaDeRespuesta = (id: string): number => 0.4 + variacion(`respuesta:${id}`, 500);

/** Usa el reloj visual del laboratorio: pausa y velocidad se respetan sin
 * crear temporizadores que sigan hablando cuando la pestaña está oculta. */
export class CadenciaDialogos {
  private proxima = 0;

  puedeHablar(ahora: number): boolean {
    return Number.isFinite(ahora) && ahora >= this.proxima;
  }

  registrar(id: string, ahora: number): boolean {
    if (!this.puedeHablar(ahora)) return false;
    this.proxima = ahora + 1.2 + variacion(id, 1000);
    return true;
  }

  limpiar(): void { this.proxima = 0; }
}
