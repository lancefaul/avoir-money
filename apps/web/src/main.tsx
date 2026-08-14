import React from 'react';
import ReactDOM from 'react-dom/client';
/*
 * The four DS font slots, as Empire and Empire Dark define them.
 *
 * A theme naming a family does nothing on its own — if the face is not loaded
 * here the browser silently falls back to a system font, which looks like the
 * theme "not applying" rather than like a missing import.
 */
import '@fontsource/dm-serif-display'; // display
import '@fontsource-variable/dm-sans/standard.css'; // ui
import '@fontsource-variable/oswald'; // label
import '@fontsource-variable/fira-code'; // code

/*
 * Fira Code moved up into the block above: Empire's code slot is back on it, so
 * it is load-bearing rather than retired-theme baggage. Playfair Display, Libre
 * Franklin and IBM Plex Mono were each used here briefly and have been removed
 * with their dependencies. The showcase keeps all three — its font switcher
 * still offers them.
 */
import App from './App.js';
import './styles/globals.css';
import '@budget-tracker/ui/theme/globals.css.js';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: 'red' }}>
          <h2>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{(this.state.error as Error).message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#666' }}>
            {(this.state.error as Error).stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
