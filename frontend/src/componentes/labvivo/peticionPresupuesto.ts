import { ALCANCE } from '../../lib/etiquetas';
import { formatearEntero } from '../../lib/formato';
import { tr, trp } from '../../lib/idioma';
import type { DatosLab, PeticionLab } from '../../lib/labVivo';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La misma pantalla de permiso sirve para el gasto propuesto y la pausa real.
 * Otros argumentos siguen en la corrida, donde tienen su editor completo. */
export function esPeticionDePresupuesto(p: PeticionLab): boolean {
  return !!p.presupuesto && (p.clase === 'presupuesto' || (p.tipo === 'presupuesto_grande'
    && p.argumentos?.length === 1 && p.argumentos[0]?.nombre === 'llamadas' && p.argumentos[0].editable));
}

export function llamadasPropuestas(p: PeticionLab): number {
  if (p.clase === 'presupuesto') return Math.max(p.presupuesto!.limite, p.presupuesto!.usado + 1);
  return Number(p.argumentos?.[0]?.valor);
}

export function vozDePresupuesto(p: PeticionLab): string {
  return p.clase === 'presupuesto' ? p.titulo : trp('¿Puedo gastar {n} llamadas?', { n: formatearEntero(llamadasPropuestas(p)) });
}

export function pintarPeticionPresupuesto(el: HTMLElement, d: DatosLab, nombre: string, modelo: string | null, sprite: HTMLCanvasElement): void {
  const p = d.pide!, pr = p.presupuesto!, pausa = p.clase === 'presupuesto';
  const restantes = Math.max(0, pr.limite - pr.usado), propuesto = llamadasPropuestas(p);
  const alcance = (a: typeof p.alcances[number]) => a === 'una_vez' ? tr('Solo esta vez') : a === 'esta_corrida' ? tr('Toda esta corrida') : ALCANCE[a];
  const pasos = d.pasos.lista;
  el.innerHTML = `<div class="lv-permiso-escena" aria-hidden="true">
      <span class="lv-permiso-lugar">${esc(tr('La pizarra del plan'))}</span>
      <div class="lv-permiso-personaje"></div>
      <div class="lv-permiso-pizarra">${pasos.slice(0, 4).map((_, i) => `<i data-estado="${d.pasos.estados[i] ?? 'pendiente'}"><b></b><span></span></i>`).join('')}</div>
      <span class="lv-permiso-voz">${esc(vozDePresupuesto(p))}</span>
    </div>
    <div class="lv-permiso-cuerpo">
      <div class="lv-permiso-autor"><strong>${esc(nombre)}${modelo ? ` · ${esc(modelo)}` : ''}</strong><span>${esc(pausa ? tr('espera tu respuesta') : tr('pide permiso de gasto'))}</span></div>
      <h3>${esc(pausa ? tr('Revisemos el presupuesto de la corrida') : p.titulo)}</h3>
      <p>${esc(trp('{n} llamadas utilizadas de {m} autorizadas en la corrida.', { n: formatearEntero(pr.usado), m: formatearEntero(pr.limite) }))}</p>
      ${pausa ? `<details class="lv-permiso-motivo" open><summary>${esc(tr('Por qué me detuve'))}</summary><p>${esc(p.detalle)}</p></details>` : `<p>${esc(p.detalle)}</p>`}
      ${pasos.length ? `<details class="lv-permiso-plan"><summary>${esc(tr('Para qué, según el plan'))}</summary><ol>${pasos.map((paso) => `<li><b>${esc(paso.titulo)}</b>${paso.detalle ? `<small>${esc(paso.detalle)}</small>` : ''}</li>`).join('')}</ol></details>` : ''}
      <div class="lv-permiso-ajustes"><label>${esc(pausa ? tr('Tope total de la corrida') : tr('Llamadas que permites'))}<input class="lv-llamadas" type="number" step="1" min="${pausa ? pr.usado + 1 : 1}" ${pausa ? '' : `max="${restantes}"`} value="${propuesto}" required></label>
        ${!pausa && p.alcances.length ? `<fieldset><legend>${esc(tr('Alcance del permiso'))}</legend>${p.alcances.map((a, i) => `<label><input type="radio" name="lv-alcance" class="lv-alcance" value="${a}" ${i === 0 ? 'checked' : ''}><span>${esc(alcance(a))}</span></label>`).join('')}</fieldset>` : ''}</div>
      ${pausa && restantes > 0 ? `<p class="lv-permiso-margen">${esc(trp('Quedan {n} llamadas autorizadas. Puedes conservar el tope o ampliarlo.', { n: formatearEntero(restantes) }))}</p>` : ''}
      <div class="lv-permiso-acciones"><span>${esc(tr('Enter aprueba · Esc cierra'))}</span><button type="button" class="no" data-a="${pausa ? 'luego' : 'no'}">${esc(pausa ? tr('Ahora no') : tr('Rechazar'))}</button><button type="button" class="yes" data-a="${pausa ? 'presupuesto' : 'si'}">${esc(pausa ? tr('Aplicar tope y continuar') : trp('Aprobar {n}', { n: formatearEntero(propuesto) }))}</button></div>
      <p class="lv-respuesta" role="status"></p>
      <button type="button" class="luego" data-a="ver">${esc(tr('Verlo en la corrida'))}</button>
    </div>
    <div class="lv-permiso-espera">${esc(tr('Mientras no respondas, el laboratorio espera.'))}</div>`;
  const ampliado = sprite.cloneNode(true) as HTMLCanvasElement;
  ampliado.getContext('2d')?.drawImage(sprite, 0, 0);
  el.querySelector('.lv-permiso-personaje')!.append(ampliado);
  if (!pausa) el.querySelector<HTMLInputElement>('.lv-llamadas')!.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    el.querySelector('[data-a=si]')!.textContent = input.validity.valid
      ? trp('Aprobar {n}', { n: formatearEntero(input.valueAsNumber) }) : tr('Aprobar');
  });
}
