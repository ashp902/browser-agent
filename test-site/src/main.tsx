import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installHarness } from './state/harness';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element missing');
}

installHarness();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
