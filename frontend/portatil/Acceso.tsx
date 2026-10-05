import type { ReactNode } from 'react';
import { tr } from '../src/lib/idioma';

// Solo se incluye en la exportación HTML. La entrada normal conserva su acceso.
export function Acceso({ children }: { children: ReactNode }) { return <>{children}</>; }
export function useSesion() { return { correo: 'revision@example.invalid', administrador: false, solicitudesPendientes: 0 }; }
export function CuentaActual() { return <p className="nota">{tr('Demostración local con datos de muestra. No requiere una cuenta.')}</p>; }
export function CuentasDelEquipo() { return <p className="nota">{tr('Las cuentas del equipo no se incluyen en esta copia.')}</p>; }
