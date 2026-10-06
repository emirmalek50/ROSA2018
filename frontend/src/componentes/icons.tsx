// Íconos SVG inline del producto: trazo lineal 1.75, currentColor.
// Sin dependencias; cada ícono es un componente pequeño y tipado.

import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(size: number, props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
}

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Panel izquierdo (toggle del sidebar). */
export function IconPanelLeft({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
    </svg>
  );
}

/** Panel derecho (toggle de fuentes). */
export function IconPanelRight({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M14.5 4v16" />
    </svg>
  );
}

export function IconArrowUp({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 2.2 })}>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

/** Cuadrado de "detener generación". */
export function IconStop({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden
      focusable={false}
      {...props}
    >
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

export function IconSearch({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

/** Chevron simple hacia abajo (rota vía CSS al expandir). */
export function IconChevronDown({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconDocument({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function IconThumbUp({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6, fill: filled ? 'currentColor' : 'none' })}>
      <path d="M7 10.5v9.5H4.5a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5H7Zm0 0 4-7a2.4 2.4 0 0 1 2.4 2.4V9h5.1a2 2 0 0 1 2 2.4l-1.2 6.5a2 2 0 0 1-2 1.6H7" />
    </svg>
  );
}

export function IconThumbDown({ size = 16, filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6, fill: filled ? 'currentColor' : 'none' })}>
      <path d="M17 13.5V4h2.5A1.5 1.5 0 0 1 21 5.5V12a1.5 1.5 0 0 1-1.5 1.5H17Zm0 0-4 7a2.4 2.4 0 0 1-2.4-2.4V15H5.5a2 2 0 0 1-2-2.4l1.2-6.5a2 2 0 0 1 2-1.6H17" />
    </svg>
  );
}

export function IconAlert({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/** Spinner fino (la animación de giro vive en CSS: clase .spin). */
export function IconSpinner({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 2, className: `spin ${props.className ?? ''}` })}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

export function IconX({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Dos rectángulos superpuestos (copiar al portapapeles). */
export function IconCopy({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.8 })}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8v.7" />
    </svg>
  );
}

export function IconCheck({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 2.2 })}>
      <path d="m5 12.5 4.7 4.7L19 7.5" />
    </svg>
  );
}

/** Flecha hacia arriba saliendo de una bandeja (subir documento). */
export function IconUpload({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M12 15V4M7 8.5 12 3.5l5 5" />
      <path d="M4 15v3a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-3" />
    </svg>
  );
}

export function IconTrash({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M18.5 6.5 17.6 19a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

/** Flecha circular: reintentar la indexación de un documento fallido. */
export function IconRefresh({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

/** Candado cerrado (catálogos base, no borrables). */
export function IconLock({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Un signo de interrogación en un círculo: el recorrido de ROSA2018.
 *  Vivía como texto en la cabecera; al ponerle el selector de idioma pasó al
 *  menú, y ahí hace falta un icono como los demás. */
export function IconAyuda({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Engranaje de ajustes: corona de seis dientes y eje central. */
export function IconSettings({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.6M12 18.8v2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.6 12h2.6M18.8 12h2.6M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9" />
    </svg>
  );
}

/** Una persona (fila de cuenta en el panel de usuarios). */
export function IconUser({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20v-1.2A4.8 4.8 0 0 1 9.8 14h4.4a4.8 4.8 0 0 1 4.8 4.8V20" />
    </svg>
  );
}

/** Dos personas (gestión de usuarios): una en primer plano y otra detrás. */
export function IconUsers({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 20v-1a4.5 4.5 0 0 1 4.5-4.5h3a4.5 4.5 0 0 1 4.5 4.5v1" />
      <path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.7a4.5 4.5 0 0 1 2.5 4V20" />
    </svg>
  );
}

/** Puerta con flecha saliendo (cerrar sesión). */
export function IconLogout({ size = 15, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <path d="M10 20.5H6.5A2.5 2.5 0 0 1 4 18V6a2.5 2.5 0 0 1 2.5-2.5H10" />
      <path d="m16 16.5 4.5-4.5L16 7.5" />
      <path d="M20.5 12H9.5" />
    </svg>
  );
}

/** Circulo vacio: punto del plan pendiente de buscar. */
export function IconCircle({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

/** Circulo medio lleno: punto respondido solo parcialmente. */
export function IconCircleHalf({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Circulo con guion: el punto no esta en los documentos. Es informacion,
 *  no un fallo, asi que no es una cruz ni un triangulo. */
export function IconMinusCircle({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12h7" />
    </svg>
  );
}

/** Visto bueno en un círculo: una parte de la pregunta respondida. */
export function IconCheckCircle({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </svg>
  );
}

/** Exclamación en un círculo: una parte que no se pudo comprobar. */
export function IconAlertCircle({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, { ...props, strokeWidth: 1.6 })}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.2v4.6M12 15.6v.1" />
    </svg>
  );
}

/** Bombilla: el paso de pensar o entender, en la línea de tiempo del turno. */
export function IconBulb({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2h5c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z" />
    </svg>
  );
}

/** Pluma: el paso de redactar. */
export function IconPen({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Escudo con tic: el paso de comprobar cada afirmación. */
export function IconShieldCheck({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3 4.5 6v5.2c0 4.5 3.2 8.2 7.5 9.8 4.3-1.6 7.5-5.3 7.5-9.8V6L12 3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Cuatro esquinas: ver en grande. */
export function IconMaximize({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconMinus({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M5 12h14" />
    </svg>
  );
}

/* ---- Iconos propios de ROSA2018 ---- */

export function IconPause({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function IconPlay({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M7 5l12 7-12 7z" />
    </svg>
  );
}

export function IconBranch({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M18 11.5c0 3-3 4-6 4H8" />
    </svg>
  );
}

export function IconActivity({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}

export function IconFlask({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3" />
    </svg>
  );
}

export function IconTrophy({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4" />
    </svg>
  );
}

export function IconGlobe({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function IconLayers({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" />
    </svg>
  );
}

export function IconTree({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 22v-8" />
      <path d="M12 14c-3.3 0-6-2.4-6-5.5S8.7 3 12 3s6 2.4 6 5.5-2.7 5.5-6 5.5Z" />
      <path d="M12 14l-3-3M12 11l3-3M12 8l-2-2" />
    </svg>
  );
}

export function IconGauge({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4-5" />
      <circle cx="12" cy="15" r="1.2" />
    </svg>
  );
}

export function IconMessage({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

export function IconMenu({ size = 18, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconStar({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
    </svg>
  );
}

export function IconExternal({ size = 12, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />
    </svg>
  );
}

export function IconClock({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** Un marcapáginas: el punto del hilo donde ROSA2018 se guardó algo tuyo. */
export function IconBookmark({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Un micrófono: hablar con ROSA2018 de viva voz. */
export function IconMic({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Un altavoz: leer una respuesta en voz alta. */
export function IconVolumen({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

/** Base de datos: tres discos apilados. */
export function IconDatabase({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v6.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.5" />
      <path d="M5 12v6.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V12" />
    </svg>
  );
}

export function IconFolder({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** Hoja con renglones: un registro o un documento que se lee. */
export function IconFileText({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function IconBook({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 6.5C10.5 5 8.3 4.5 4 4.5v13c4.3 0 6.5.5 8 2 1.5-1.5 3.7-2 8-2v-13c-4.3 0-6.5.5-8 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  );
}

/** Rejilla de cuatro: un catálogo. */
export function IconGrid({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

/** Servidor: un servicio externo del catálogo. */
export function IconServer({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </svg>
  );
}

export function IconPlug({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M9 3v4M15 3v4" />
      <path d="M6 7h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 16v5" />
    </svg>
  );
}

export function IconCompass({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  );
}

/** Tabla: filas y columnas de un dataset. */
export function IconTable({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10" />
    </svg>
  );
}

