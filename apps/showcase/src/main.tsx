import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

// ── UI Fonts (sans-serif) ──
import '@fontsource-variable/dm-sans/standard.css';
import '@fontsource-variable/outfit';
import '@fontsource-variable/inter';
import '@fontsource-variable/libre-franklin';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/geist';
import '@fontsource-variable/manrope';
import '@fontsource-variable/albert-sans';
import '@fontsource-variable/figtree';

// ── Display Fonts (serif) ──
import '@fontsource/dm-serif-display';
import '@fontsource-variable/playfair-display';
import '@fontsource/libre-baskerville';
import '@fontsource-variable/lora';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/bitter';
import '@fontsource/merriweather';

// ── Code Fonts (monospace) ──
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/source-code-pro';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/inconsolata';

// Label
import '@fontsource-variable/oswald';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
