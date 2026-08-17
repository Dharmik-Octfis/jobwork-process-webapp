import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Prevent number inputs from changing value on scroll globally across the entire project
document.addEventListener(
  'wheel',
  (event) => {
    if (document.activeElement?.tagName === 'INPUT') {
      const input = document.activeElement as HTMLInputElement;
      if (input.type === 'number') {
        input.blur();
      }
    }
  },
  { passive: true }
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
