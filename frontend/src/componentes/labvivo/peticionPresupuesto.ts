import { ALCANCE, TIPO_INCIDENCIA } from '../../lib/etiquetas';
import { formatearEntero } from '../../lib/formato';
import { tr, trp } from '../../lib/idioma';
import type { DatosLab, PeticionLab } from '../../lib/labVivo';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Lucide zoom-in y hourglass, los iconos del diseño («Laboratorio en vivo · pixel art · aprobación»).
const LUPA = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>';
const AVISO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/></svg>';
const RELOJ = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>';

/** La misma pantalla sirve para el gasto propuesto y para la pausa real por
 * presupuesto. Otros argumentos siguen en la corrida, donde tienen su editor completo. */
export function esPeticionDePresupuesto(p: PeticionLab): boolean {
  return !!p.presupuesto && (p.clase === 'presupuesto' || (p.tipo === 'presupuesto_grande'
    && p.argumentos?.length === 1 && p.argumentos[0]?.nombre === 'llamadas' && p.argumentos[0].editable));
}

/** Gasto: las llamadas que pide el permiso. Pausa: las llamadas de más que
 * propone el planificador (el mínimo que escribió el servidor, si lo hay). */
export function llamadasPropuestas(p: PeticionLab): number {
  if (p.clase === 'presupuesto') return Math.max(1, p.presupuesto!.propuesta ?? 1);
  return Number(p.argumentos?.[0]?.valor);
}

/** El tope total de la corrida al aprobar `n` llamadas más durante una pausa. */
export function topeConLlamadasMas(p: PeticionLab, n: number): number {
  const pr = p.presupuesto!;
  return Math.max(pr.limite, pr.usado) + n;
}

export function vozDePresupuesto(p: PeticionLab, n = llamadasPropuestas(p)): string {
  return p.clase === 'presupuesto'
    ? trp('¿Puedo gastar {n} llamadas más?', { n: formatearEntero(n) })
    : trp('¿Puedo gastar {n} llamadas?', { n: formatearEntero(n) });
}

export function pintarPeticionPresupuesto(el: HTMLElement, d: DatosLab, nombre: string, modelo: string | null, sprite: HTMLCanvasElement): void {
  const p = d.pide!, pr = p.presupuesto!, pausa = p.clase === 'presupuesto';
  const restantes = Math.max(0, pr.limite - pr.usado), propuesto = llamadasPropuestas(p);
  const alcance = (a: typeof p.alcances[number]) => a === 'una_vez' ? tr('Solo esta vez') : a === 'esta_corrida' ? tr('Toda esta corrida') : ALCANCE[a];
  const pasos = d.pasos.lista;
  // «Para qué, según su plan»: el primer paso que falta y, en una línea, los demás.
  const i0 = Math.max(0, d.pasos.estados.findIndex((e) => e !== 'hecho' && e !== 'omitido'));
  const resto = pasos.slice(i0 + 1);
  const plan = pasos[i0] ? `<div class="lv-permiso-plan"><small>${esc(tr('Para qué, según su plan'))}</small><b>${esc(`${i0 + 1}. ${pasos[i0].titulo}`)}</b>${resto.length ? `<span>${esc(resto.length === 1 ? trp('y 1 paso más: {t}', { t: resto[0]!.titulo }) : trp('y {n} pasos más: {t}', { n: resto.length, t: resto.map((x) => x.titulo).join(', ') }))}</span>` : ''}</div>` : '';
  const tope = (n: number) => trp('Tope nuevo de la corrida: {n}', { n: formatearEntero(topeConLlamadasMas(p, n)) });
  el.innerHTML = `<div class="lv-permiso-escena" aria-hidden="true">
      <span class="lv-permiso-lugar">${LUPA}${esc(tr('×2,5 sobre la Pizarra'))}</span>
      <div class="lv-permiso-pizarra">${pasos.slice(0, 4).map((_, i) => `<i data-estado="${d.pasos.estados[i] ?? 'pendiente'}"><b></b><span></span></i>`).join('')}</div>
      <div class="lv-permiso-personaje"></div>
      <span class="lv-permiso-voz">${esc(vozDePresupuesto(p))}</span>
    </div>
    <div class="lv-permiso-cuerpo">
      <div class="lv-permiso-autor"><i></i><strong>${esc(nombre)}${modelo ? ` · ${esc(modelo)}` : ''}</strong><span>${esc(pausa ? tr('pide más presupuesto') : tr('pide permiso de gasto'))}</span></div>
      <h3>${esc(p.titulo)}</h3>
      <p>${esc(p.detalle)}</p>
      ${plan}
      <div class="lv-permiso-ajustes"><label class="lv-permiso-cifra"><input class="lv-llamadas" type="number" inputmode="numeric" step="1" min="1" ${pausa ? '' : `max="${restantes}"`} value="${propuesto}" required aria-label="${esc(pausa ? tr('Llamadas más que permites') : tr('Llamadas que permites'))}"><span>${esc(pausa ? tr('llamadas más') : tr('llamadas'))}</span></label>
        ${pausa ? `<span class="lv-permiso-tope">${esc(tope(propuesto))}</span>` : p.alcances.length ? `<fieldset><legend>${esc(tr('Alcance del permiso'))}</legend>${p.alcances.map((a, i) => `<label><input type="radio" name="lv-alcance" class="lv-alcance" value="${a}" ${i === 0 ? 'checked' : ''}><span>${esc(alcance(a))}</span></label>`).join('')}</fieldset>` : ''}</div>
      <div class="lv-permiso-acciones"><span>${esc(tr('Enter aprueba · Esc cierra'))}</span><button type="button" class="no" data-a="${pausa ? 'luego' : 'no'}">${esc(pausa ? tr('Ahora no') : tr('Rechazar'))}</button><button type="button" class="yes" data-a="${pausa ? 'presupuesto' : 'si'}">${esc(trp('Aprobar {n}', { n: formatearEntero(propuesto) }))}</button></div>
      <p class="lv-respuesta" role="status"></p>
    </div>
    <div class="lv-permiso-espera">${RELOJ}<span>${esc(tr('Mientras no respondas, el laboratorio espera.'))}</span></div>`;
  ponerPersonaje(el, sprite);
  el.querySelector<HTMLInputElement>('.lv-llamadas')!.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement, ok = input.validity.valid && Number.isSafeInteger(input.valueAsNumber);
    el.querySelector('.lv-permiso-acciones .yes')!.textContent = ok ? trp('Aprobar {n}', { n: formatearEntero(input.valueAsNumber) }) : tr('Aprobar');
    if (!ok) return;
    el.querySelector('.lv-permiso-voz')!.textContent = vozDePresupuesto(p, input.valueAsNumber);
    const t = el.querySelector('.lv-permiso-tope');
    if (t) t.textContent = tope(input.valueAsNumber);
  });
}

function ponerPersonaje(el: HTMLElement, sprite: HTMLCanvasElement): void {
  const ampliado = sprite.cloneNode(true) as HTMLCanvasElement;
  ampliado.getContext('2d')?.drawImage(sprite, 0, 0);
  el.querySelector('.lv-permiso-personaje')!.append(ampliado);
}

/** Algo impide seguir: la misma lupa, con lo que propone ROSA2018 y sitio para otra resolución. */
export function pintarPeticionIncidencia(el: HTMLElement, d: DatosLab, nombre: string, sprite: HTMLCanvasElement): void {
  const p = d.pide!, inc = p.incidencia!, pasos = d.pasos.lista;
  const aplicar = (propia: boolean) => propia || !inc.alternativa ? tr('Aplicar mi resolución') : tr('Aplicar lo que propone');
  el.innerHTML = `<div class="lv-permiso-escena" aria-hidden="true">
      <span class="lv-permiso-lugar">${AVISO}${esc(tr('Algo impide seguir'))}</span>
      <div class="lv-permiso-pizarra">${pasos.slice(0, 4).map((_, i) => `<i data-estado="${d.pasos.estados[i] ?? 'pendiente'}"><b></b><span></span></i>`).join('')}</div>
      <div class="lv-permiso-personaje"></div>
      <span class="lv-permiso-voz">${esc(tr('Algo me impide seguir'))}</span>
    </div>
    <div class="lv-permiso-cuerpo">
      <div class="lv-permiso-autor"><i></i><strong>${esc(nombre)}${inc.recurso ? ` · ${esc(inc.recurso)}` : ''}</strong><span>${esc(TIPO_INCIDENCIA[inc.tipo] ?? tr('encontró un problema'))}</span></div>
      <h3>${esc(p.titulo)}</h3>
      ${p.detalle ? `<p>${esc(p.detalle)}</p>` : ''}
      ${inc.alternativa ? `<div class="lv-permiso-plan lv-propuesta"><small>${esc(tr('Lo que propone ROSA2018'))}</small><span>${esc(inc.alternativa)}</span></div>` : ''}
      <label class="lv-permiso-otra"><span>${esc(inc.alternativa ? tr('Otra resolución (opcional)') : tr('Tu resolución'))}</span><input class="lv-resolucion" type="text" maxlength="500" ${inc.alternativa ? '' : 'required'} placeholder="${esc(tr('Escribe cómo quieres resolverlo'))}"></label>
      <div class="lv-permiso-acciones"><button type="button" class="no" data-a="luego">${esc(tr('Ahora no'))}</button><button type="button" class="no" data-a="ver">${esc(tr('Verlo en la corrida'))}</button><button type="button" class="yes" data-a="incidencia">${esc(aplicar(false))}</button></div>
      <p class="lv-respuesta" role="status"></p>
    </div>
    <div class="lv-permiso-espera">${RELOJ}<span>${esc(inc.corridaEnMarcha ? tr('La corrida sigue con lo demás mientras decides.') : tr('Mientras no respondas, el laboratorio espera.'))}</span></div>`;
  ponerPersonaje(el, sprite);
  el.querySelector<HTMLInputElement>('.lv-resolucion')!.addEventListener('input', (e) => {
    el.querySelector('.lv-permiso-acciones .yes')!.textContent = aplicar((e.target as HTMLInputElement).value.trim() !== '');
  });
}

/** El que pide, nítido en su sitio del laboratorio: halo, aviso encima y etiqueta debajo. */
export function pintarFoco(el: HTMLElement, nombre: string, que: string, sprite: HTMLCanvasElement): void {
  el.innerHTML = `<span class="lv-foco-luz"></span><i></i><i></i><i></i><span class="lv-foco-alerta"></span><span class="lv-foco-pide"><b>${esc(nombre)}</b>${esc(que)}</span>`;
  const c = sprite.cloneNode(true) as HTMLCanvasElement;
  c.getContext('2d')?.drawImage(sprite, 0, 0);
  el.insertBefore(c, el.querySelector('.lv-foco-alerta'));
}
