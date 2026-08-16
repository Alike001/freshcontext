import '@fontsource-variable/inter/wght.css';
import '@fontsource/fragment-mono/latin-400.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './styles/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './app.js';

const root = document.querySelector('#root');
if (!root) throw new Error('FreshContext root element is missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
