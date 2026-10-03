import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import { Limite } from './componentes/Limite';
import { Acceso } from './componentes/Acceso';
import { observarSistema } from './lib/theme';
import './styles.css';
import './vivo.css';
import './mundo.css';
import './ficha.css';
import { tr } from './lib/idioma';

// El tema ya lo aplico el script inline de index.html. Esto solo engancha los
// cambios del sistema para que la opcion 'sistema' siga al SO en vivo.
observarSistema();

// No cargar estado de investigación antes de verificar la sesión.

const raiz = document.getElementById('root');
if (!raiz) throw new Error(tr('No se encontró el elemento #root'));

createRoot(raiz).render(
  <StrictMode>
    <Limite ambito="ROSA2018">
      <Acceso><App /></Acceso>
    </Limite>
  </StrictMode>,
);
